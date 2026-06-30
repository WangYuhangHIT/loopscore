'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createWriter } = require('../src/snapshotWriter');

function fakeSnapshot() {
  return {
    sessions: [{
      projectId: 'P1', sessionId: 's', eventCount: 5, mainRole: { role: 'pm' },
      tokens: { total: 10 },
      evaluation: {
        overall: { concerns: 1, label: 'A few to watch' },
        capability: { firstPassRate: 0.8, reworkRate: 0.1, autonomySpan: 4, stuckRisk: 0 },
        dimensions: { delivery: { rating: 'good' }, quality: { rating: 'ok' } },
        usage: { bySkill: { brainstorming: 2 }, byHook: { stop: 1 }, byMcp: {} },
      },
      agents: [{
        agentId: 'a', eventCount: 3, role: { role: 'backend' },
        evaluation: { overall: { concerns: 0 }, capability: { firstPassRate: 1 }, dimensions: {}, usage: {} },
      }],
    }],
  };
}

test('writer.tick: one record per session + per agent, with metrics & skills', () => {
  const written = [];
  const store = { append: (r) => written.push(r) };
  const w = createWriter({ getSnapshot: () => fakeSnapshot(), store });
  w.tick(1000);
  assert.strictEqual(written.length, 2);
  const sRec = written.find((r) => r.scope === 'session');
  assert.strictEqual(sRec.projectId, 'P1');
  assert.strictEqual(sRec.firstPassRate, 0.8);
  assert.strictEqual(sRec.concerns, 1);
  assert.strictEqual(sRec.role, 'pm');
  assert.deepStrictEqual(sRec.skills, ['brainstorming']);
  assert.strictEqual(sRec.dims.delivery, 'good');
  assert.strictEqual(sRec.ts, 1000);
  const aRec = written.find((r) => r.scope === 'agent');
  assert.strictEqual(aRec.agentId, 'a');
  assert.strictEqual(aRec.role, 'backend');
});

test('writer.tick: dedupes by eventCount (idle → no new write)', () => {
  const written = [];
  const store = { append: (r) => written.push(r) };
  const snap = fakeSnapshot();
  const w = createWriter({ getSnapshot: () => snap, store });
  w.tick(1000);
  w.tick(2000); // same eventCount → nothing new
  assert.strictEqual(written.length, 2);
});

test('writer.tick: writes again when eventCount grows', () => {
  const written = [];
  const store = { append: (r) => written.push(r) };
  let snap = fakeSnapshot();
  const w = createWriter({ getSnapshot: () => snap, store });
  w.tick(1000);
  snap.sessions[0].eventCount = 9; // session advanced
  w.tick(2000);
  assert.strictEqual(written.filter((r) => r.scope === 'session').length, 2);
});

test('writer.tick: skips sessions without a projectId', () => {
  const written = [];
  const store = { append: (r) => written.push(r) };
  const w = createWriter({ getSnapshot: () => ({ sessions: [{ sessionId: 'x', eventCount: 1, agents: [] }] }), store });
  w.tick(1000);
  assert.strictEqual(written.length, 0);
});
