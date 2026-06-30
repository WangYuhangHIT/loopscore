'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createRoleRunner } = require('../src/roleRunner');

const tu = (tool, filePath) => ({ kind: 'tool_use', tool, filePath });
// ambiguous lane: test-file edit (+3) tied with migration-file write (+3), no extra kw → margin 0
const ambiguousLane = () => ({ id: 'agent:x', agentId: 'x', events: [tu('Edit', 'a.test.js'), tu('Write', 'migrations/1.sql')] });

test('roleRunner: assigns an LLM role to an ambiguous lane', async () => {
  const llm = { complete: async () => '{"facets":["database"],"confidence":0.9,"rationale":"migrations"}' };
  const runner = createRoleRunner({ cfg: { roleReview: { enabled: true } }, llm });
  const lane = ambiguousLane();
  await runner.consider({ sessionId: 's', lanes: { main: { id: 'main', events: [] }, 'agent:x': lane } });
  assert.ok(lane.roleLLM, 'LLM role assigned');
  assert.strictEqual(lane.roleLLM.source, 'llm');
  assert.strictEqual(lane.roleLLM.role, 'database');
});

test('roleRunner: disabled → no LLM call', async () => {
  const llm = { complete: async () => { throw new Error('should not be called'); } };
  const runner = createRoleRunner({ cfg: { roleReview: { enabled: false } }, llm });
  const lane = ambiguousLane();
  await runner.consider({ sessionId: 's', lanes: { 'agent:x': lane } });
  assert.strictEqual(lane.roleLLM, undefined);
});

test('roleRunner: skips a lane with a manual override (locked)', async () => {
  let called = false;
  const llm = { complete: async () => { called = true; return '{"facets":["backend"]}'; } };
  const runner = createRoleRunner({ cfg: { roleReview: { enabled: true } }, llm });
  const lane = ambiguousLane();
  lane.roleOverride = { role: 'pm', facets: ['pm'], source: 'manual' };
  await runner.consider({ sessionId: 's', lanes: { 'agent:x': lane } });
  assert.strictEqual(called, false);
  assert.strictEqual(lane.roleLLM, undefined);
});

test('roleRunner: does not re-check a lane until enough new events accrue', async () => {
  let calls = 0;
  const llm = { complete: async () => { calls++; return '{"facets":["database"]}'; } };
  const runner = createRoleRunner({ cfg: { roleReview: { enabled: true, recheckEvents: 30 } }, llm });
  const lane = ambiguousLane();
  const session = { sessionId: 's', lanes: { 'agent:x': lane } };
  await runner.consider(session);
  await runner.consider(session); // no new events → no second call
  assert.strictEqual(calls, 1);
});
