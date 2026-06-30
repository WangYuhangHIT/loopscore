'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readLocal, writeLocal, mergeConfig, setEnvKey } = require('../src/configStore');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loopscore-cfg-')); }

// ---- readLocal / writeLocal -------------------------------------------------
test('readLocal: missing file → {} (never throws)', () => {
  assert.deepStrictEqual(readLocal(path.join(tmpDir(), 'nope.json')), {});
});

test('readLocal: malformed json → {} (never throws)', () => {
  const f = path.join(tmpDir(), 'local.json');
  fs.writeFileSync(f, '{ not json ');
  assert.deepStrictEqual(readLocal(f), {});
});

test('writeLocal then readLocal round-trips', () => {
  const f = path.join(tmpDir(), 'local.json');
  const obj = { llm: { active: 'b', providers: [{ id: 'b', model: 'm' }] }, judge: { enabled: false } };
  writeLocal(f, obj);
  assert.deepStrictEqual(readLocal(f), obj);
});

// ---- mergeConfig ------------------------------------------------------------
test('mergeConfig: local.llm replaces base.llm providers; judge shallow-merges enabled', () => {
  const base = {
    port: 4319,
    judge: { enabled: true, model: 'test-model', apiKeyEnv: 'K', maxTokens: 512 },
    llm: { providers: [{ id: 'default', model: 'test-model' }], active: 'default' },
  };
  const local = {
    judge: { enabled: false }, // only the toggle, must NOT wipe model/apiKeyEnv
    llm: { providers: [{ id: 'b', model: 'gpt' }], active: 'b' },
  };
  const merged = mergeConfig(base, local);
  assert.strictEqual(merged.port, 4319); // base untouched key preserved
  assert.strictEqual(merged.judge.enabled, false); // overridden
  assert.strictEqual(merged.judge.model, 'test-model'); // base judge fields survive
  assert.strictEqual(merged.judge.apiKeyEnv, 'K');
  assert.deepStrictEqual(merged.llm.providers, [{ id: 'b', model: 'gpt' }]); // providers replaced
  assert.strictEqual(merged.llm.active, 'b');
});

test('mergeConfig: empty/absent local → base unchanged (deep clone, not same ref)', () => {
  const base = { judge: { enabled: true }, llm: { providers: [{ id: 'a' }] } };
  const merged = mergeConfig(base, {});
  assert.deepStrictEqual(merged, base);
  assert.notStrictEqual(merged.judge, base.judge); // mutation isolation
});

// ---- setEnvKey --------------------------------------------------------------
test('setEnvKey: creates file with KEY=value when missing', () => {
  const f = path.join(tmpDir(), '.env');
  setEnvKey(f, 'LOOPSCORE_JUDGE_KEY', 'sk-abc');
  assert.strictEqual(fs.readFileSync(f, 'utf8').includes('LOOPSCORE_JUDGE_KEY=sk-abc'), true);
});

test('setEnvKey: updates an existing key, preserves other lines, no duplicate', () => {
  const f = path.join(tmpDir(), '.env');
  fs.writeFileSync(f, '# header\nOTHER=keepme\nLOOPSCORE_JUDGE_KEY=old\n');
  setEnvKey(f, 'LOOPSCORE_JUDGE_KEY', 'new-val');
  const txt = fs.readFileSync(f, 'utf8');
  assert.strictEqual(txt.includes('OTHER=keepme'), true);
  assert.strictEqual(txt.includes('# header'), true);
  assert.strictEqual(txt.includes('LOOPSCORE_JUDGE_KEY=new-val'), true);
  assert.strictEqual((txt.match(/LOOPSCORE_JUDGE_KEY=/g) || []).length, 1); // exactly one
  assert.strictEqual(txt.includes('=old'), false);
});

test('setEnvKey: rejects an invalid env var name (never writes)', () => {
  const f = path.join(tmpDir(), '.env');
  assert.throws(() => setEnvKey(f, 'bad name!', 'x'), /invalid/i);
  assert.strictEqual(fs.existsSync(f), false);
});

test('setEnvKey: writes the .env with owner-only 0600 perms (no group/other read)', () => {
  const f = path.join(tmpDir(), '.env');
  setEnvKey(f, 'LOOPSCORE_JUDGE_KEY', 'sk-abc');
  const mode = fs.statSync(f).mode & 0o777;
  assert.strictEqual(mode, 0o600, `expected 0600, got ${mode.toString(8)}`);
});

test('setEnvKey: rejects a value containing newlines (no .env line injection)', () => {
  const f = path.join(tmpDir(), '.env');
  assert.throws(() => setEnvKey(f, 'KEY', 'val\nINJECTED=evil'), /newline/i);
  const after = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  assert.ok(!/INJECTED=evil/.test(after), 'injected line must not be written');
});
