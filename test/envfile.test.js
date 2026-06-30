'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadEnvFile } = require('../src/server');

function tmpEnv(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loopscore-env-'));
  const f = path.join(dir, '.env');
  fs.writeFileSync(f, content);
  return f;
}

test('loadEnvFile: sets vars from KEY=VALUE lines, strips quotes, skips comments', () => {
  delete process.env.DS_TEST_A; delete process.env.DS_TEST_B;
  const f = tmpEnv('# comment\nDS_TEST_A=hello\nDS_TEST_B="quoted-val"\n');
  loadEnvFile(f);
  assert.strictEqual(process.env.DS_TEST_A, 'hello');
  assert.strictEqual(process.env.DS_TEST_B, 'quoted-val');
  delete process.env.DS_TEST_A; delete process.env.DS_TEST_B;
});

test('loadEnvFile: does NOT override a var already set in the process', () => {
  process.env.DS_TEST_C = 'from-shell';
  const f = tmpEnv('DS_TEST_C=from-file\n');
  loadEnvFile(f);
  assert.strictEqual(process.env.DS_TEST_C, 'from-shell');
  delete process.env.DS_TEST_C;
});

test('loadEnvFile: missing file is a silent no-op (never throws)', () => {
  assert.doesNotThrow(() => loadEnvFile(path.join(os.tmpdir(), 'loopscore-nope-' + Date.now())));
});
