'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTailer } = require('../src/tailer');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'loopscore-tail-'));
}

test('tailer: emits existing lines on first poll (replay)', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.jsonl'), '{"n":1}\n{"n":2}\n');
  const seen = [];
  const t = createTailer(dir, (line) => seen.push(line), { pollMs: 0 });
  t.pollOnce();
  t.close();
  assert.strictEqual(seen.length, 2);
  assert.deepStrictEqual(JSON.parse(seen[0]), { n: 1 });
});

test('tailer: emits only newly appended lines on subsequent poll', () => {
  const dir = tmpDir();
  const f = path.join(dir, 'a.jsonl');
  fs.writeFileSync(f, '{"n":1}\n');
  const seen = [];
  const t = createTailer(dir, (line) => seen.push(line), { pollMs: 0 });
  t.pollOnce();
  assert.strictEqual(seen.length, 1);
  fs.appendFileSync(f, '{"n":2}\n');
  t.pollOnce();
  t.close();
  assert.strictEqual(seen.length, 2);
  assert.deepStrictEqual(JSON.parse(seen[1]), { n: 2 });
});

test('tailer: detects a brand-new file appearing in the dir', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.jsonl'), '{"n":1}\n');
  const seen = [];
  const t = createTailer(dir, (line, file) => seen.push({ line, file }), { pollMs: 0 });
  t.pollOnce();
  fs.writeFileSync(path.join(dir, 'b.jsonl'), '{"n":99}\n');
  t.pollOnce();
  t.close();
  assert.strictEqual(seen.length, 2);
  assert.ok(seen[1].file.endsWith('b.jsonl'));
});

test('tailer: buffers a partial (newline-less) line until completed', () => {
  const dir = tmpDir();
  const f = path.join(dir, 'a.jsonl');
  fs.writeFileSync(f, '');
  const seen = [];
  const t = createTailer(dir, (line) => seen.push(line), { pollMs: 0 });
  fs.appendFileSync(f, '{"part":');
  t.pollOnce();
  assert.strictEqual(seen.length, 0); // not yet terminated
  fs.appendFileSync(f, 'true}\n');
  t.pollOnce();
  t.close();
  assert.strictEqual(seen.length, 1);
  assert.deepStrictEqual(JSON.parse(seen[0]), { part: true });
});

test('tailer: handles truncation/rotation without crashing (re-reads from 0)', () => {
  const dir = tmpDir();
  const f = path.join(dir, 'a.jsonl');
  fs.writeFileSync(f, '{"n":1}\n{"n":2}\n');
  const seen = [];
  const t = createTailer(dir, (line) => seen.push(line), { pollMs: 0 });
  t.pollOnce();
  assert.strictEqual(seen.length, 2);
  fs.writeFileSync(f, '{"n":9}\n'); // truncate to shorter content
  assert.doesNotThrow(() => t.pollOnce());
  t.close();
  assert.strictEqual(seen.length, 3);
  assert.deepStrictEqual(JSON.parse(seen[2]), { n: 9 });
});

test('tailer: ignores non-jsonl files', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.jsonl'), '{"n":1}\n');
  fs.writeFileSync(path.join(dir, 'note.txt'), 'hello\nworld\n');
  const seen = [];
  const t = createTailer(dir, (line) => seen.push(line), { pollMs: 0 });
  t.pollOnce();
  t.close();
  assert.strictEqual(seen.length, 1);
});

test('tailer: recurses into subdirectories (subagents/agent-*.jsonl)', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'main.jsonl'), '{"main":1}\n');
  const sub = path.join(dir, 'sess', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'agent-abc.jsonl'), '{"sub":1}\n');
  const wf = path.join(sub, 'workflows', 'wf_1');
  fs.mkdirSync(wf, { recursive: true });
  fs.writeFileSync(path.join(wf, 'agent-def.jsonl'), '{"wf":1}\n');
  const seen = [];
  const t = createTailer(dir, (line, file) => seen.push({ line, file }), { pollMs: 0 });
  t.pollOnce();
  t.close();
  assert.strictEqual(seen.length, 3, 'main + nested subagent + nested workflow agent');
  assert.ok(seen.some((x) => x.file.endsWith('agent-abc.jsonl')));
  assert.ok(seen.some((x) => x.file.endsWith('agent-def.jsonl')));
});

test('tailer: excludes the memory/ directory', () => {
  const dir = tmpDir();
  const mem = path.join(dir, 'memory');
  fs.mkdirSync(mem, { recursive: true });
  fs.writeFileSync(path.join(mem, 'note.jsonl'), '{"secret":1}\n'); // even if it were jsonl
  fs.writeFileSync(path.join(dir, 'main.jsonl'), '{"main":1}\n');
  const seen = [];
  const t = createTailer(dir, (line) => seen.push(line), { pollMs: 0 });
  t.pollOnce();
  t.close();
  assert.strictEqual(seen.length, 1);
  assert.deepStrictEqual(JSON.parse(seen[0]), { main: 1 });
});

test('tailer: new file appearing inside a subdir is picked up on later poll', () => {
  const dir = tmpDir();
  const sub = path.join(dir, 'sess', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  const seen = [];
  const t = createTailer(dir, (line) => seen.push(line), { pollMs: 0 });
  t.pollOnce();
  assert.strictEqual(seen.length, 0);
  fs.writeFileSync(path.join(sub, 'agent-new.jsonl'), '{"n":1}\n');
  t.pollOnce();
  t.close();
  assert.strictEqual(seen.length, 1);
});

test('tailer: missing directory does not throw on poll', () => {
  const dir = path.join(os.tmpdir(), 'loopscore-nonexistent-' + Date.now());
  const t = createTailer(dir, () => {}, { pollMs: 0 });
  assert.doesNotThrow(() => t.pollOnce());
  t.close();
});
