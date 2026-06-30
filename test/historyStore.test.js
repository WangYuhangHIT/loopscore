'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../src/historyStore');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'loopscore-hist-')); }

test('append + query round-trips records, filters by time range', () => {
  const store = createStore({ dataDir: tmpDir() });
  store.append({ ts: 1000, projectId: 'P1', sessionId: 's', scope: 'session', firstPassRate: 0.5 });
  store.append({ ts: 2000, projectId: 'P1', sessionId: 's', scope: 'session', firstPassRate: 0.8 });
  store.append({ ts: 1500, projectId: 'P2', sessionId: 'x', scope: 'session' });
  assert.strictEqual(store.query({ projectId: 'P1' }).length, 2);
  const ranged = store.query({ projectId: 'P1', from: 1500 });
  assert.strictEqual(ranged.length, 1);
  assert.strictEqual(ranged[0].firstPassRate, 0.8);
});

test('query: missing project → []', () => {
  const store = createStore({ dataDir: tmpDir() });
  assert.deepStrictEqual(store.query({ projectId: 'nope' }), []);
});

test('query: filters by scope and agentId', () => {
  const store = createStore({ dataDir: tmpDir() });
  store.append({ ts: 1, projectId: 'P1', sessionId: 's', scope: 'session' });
  store.append({ ts: 2, projectId: 'P1', sessionId: 's', scope: 'agent', agentId: 'a' });
  store.append({ ts: 3, projectId: 'P1', sessionId: 's', scope: 'agent', agentId: 'b' });
  assert.strictEqual(store.query({ projectId: 'P1', scope: 'agent' }).length, 2);
  assert.strictEqual(store.query({ projectId: 'P1', scope: 'agent', agentId: 'a' }).length, 1);
});

test('persists across store instances (real file)', () => {
  const dir = tmpDir();
  createStore({ dataDir: dir }).append({ ts: 1, projectId: 'P1', sessionId: 's', scope: 'session' });
  const reopened = createStore({ dataDir: dir });
  assert.strictEqual(reopened.query({ projectId: 'P1' }).length, 1);
});

test('containment: a traversal projectId stays under dataDir (never escapes)', () => {
  const dir = tmpDir();
  const store = createStore({ dataDir: dir });
  // a malicious id that, unsanitized, would write a level (or several) above dataDir
  store.append({ ts: 1, projectId: '../../../tmp/evil', sessionId: 's', scope: 'session' });
  const escaped = path.resolve(dir, '..', '..', '..', 'tmp', 'evil', 'history.ndjson');
  assert.ok(!fs.existsSync(escaped), 'must not write outside dataDir');
  // it still round-trips via the same (sanitized) id, proving it landed UNDER dataDir
  assert.strictEqual(store.query({ projectId: '../../../tmp/evil' }).length, 1);
});

test('containment: a dot-only projectId ("..") cannot escape one level', () => {
  const dir = tmpDir();
  const store = createStore({ dataDir: dir });
  store.append({ ts: 1, projectId: '..', sessionId: 's', scope: 'session' });
  assert.ok(!fs.existsSync(path.resolve(dir, '..', 'history.ndjson')), 'must not write history.ndjson above dataDir');
});
