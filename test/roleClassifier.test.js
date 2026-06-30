'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { facetScores, classify, classifyLLM, lowDistinctiveness } = require('../src/roleClassifier');

const fakeLLM = (text) => ({ complete: async () => text });

// helper: build a lane event
const ev = (o) => Object.assign({ kind: 'tool_use' }, o);

test('facetScores: backend file + keywords → backend dominant', () => {
  const events = [
    ev({ tool: 'Edit', filePath: 'backend/src/api/orders.js', textSnippet: 'router.post(...)' }),
    ev({ tool: 'Edit', filePath: 'backend/src/api/orders.js', textSnippet: 'res.json({...})' }),
  ];
  const s = facetScores(events, 'You are implementing the orders API endpoint');
  assert.ok(s.backend > s.frontend);
  assert.ok(s.backend > s.test);
});

test('facetScores: test file + prompt → test dominant', () => {
  const events = [
    ev({ tool: 'Write', filePath: 'src/foo.test.js', textSnippet: "expect(x).toBe(1)" }),
  ];
  const s = facetScores(events, 'Review P2 for spec compliance and write tests');
  assert.ok(s.test >= s.backend);
});

test('facetScores: spawn sub-agents + write plan → pm dominant', () => {
  const events = [
    ev({ tool: 'Task', textSnippet: 'spawn backend-eng' }),
    ev({ tool: 'Agent', textSnippet: 'spawn frontend-eng' }),
    ev({ tool: 'TodoWrite', textSnippet: 'plan' }),
  ];
  const s = facetScores(events, 'You are the team lead, decompose and delegate');
  assert.ok(s.pm > s.backend);
});

test('facetScores: empty input does not throw, all 0', () => {
  const s = facetScores([], '');
  assert.deepStrictEqual(Object.values(s).every((v) => v === 0), true);
});

test('classify: single facet → matching role + source=fingerprint', () => {
  const events = [ev({ tool: 'Edit', filePath: 'src/api/orders.js', textSnippet: 'router.post' })];
  const r = classify(events, 'implement the orders API');
  assert.strictEqual(r.facets.includes('backend'), true);
  assert.strictEqual(r.role, 'backend');
  assert.strictEqual(r.source, 'fingerprint');
  assert.ok(r.confidence > 0 && r.confidence <= 1);
});

test('classify: frontend + backend both hit → fullstack', () => {
  const events = [
    ev({ tool: 'Edit', filePath: 'frontend/src/components/X.tsx', textSnippet: 'className' }),
    ev({ tool: 'Edit', filePath: 'backend/src/api/x.js', textSnippet: 'res.json' }),
  ];
  const r = classify(events, '');
  assert.strictEqual(r.role, 'fullstack');
  assert.deepStrictEqual(r.facets.sort(), ['backend', 'frontend']);
});

test('classify: backend + database both hit → backend+database', () => {
  const events = [
    ev({ tool: 'Edit', filePath: 'backend/src/api/x.js', textSnippet: 'router.get' }),
    ev({ tool: 'Edit', filePath: 'backend/migrations/004.sql', textSnippet: 'CREATE INDEX' }),
  ];
  const r = classify(events, '');
  assert.strictEqual(r.role, 'backend+database');
});

test('classify: all 0 → unknown / low confidence', () => {
  const r = classify([], '');
  assert.strictEqual(r.role, 'unknown');
  assert.strictEqual(r.confidence, 0);
});

test('lowDistinctiveness: true when top-two facets are tied, false when clear, false when no signal', () => {
  assert.strictEqual(lowDistinctiveness({ scores: { a: 10, b: 10, c: 0 } }), true);
  assert.strictEqual(lowDistinctiveness({ scores: { a: 10, b: 2 }, role: 'a' }), false);
  assert.strictEqual(lowDistinctiveness({ scores: { a: 0, b: 0 }, role: 'unknown' }), false);
  assert.strictEqual(lowDistinctiveness({ scores: { a: 4, b: 1 }, role: 'unknown' }), true); // had signal but below threshold
});

test('classifyLLM: parses JSON, maps facets to role name, source=llm', async () => {
  const llm = fakeLLM('{"facets":["backend"],"confidence":0.8,"rationale":"edits api routes"}');
  const r = await classifyLLM([], 'do backend work', llm, {});
  assert.strictEqual(r.role, 'backend');
  assert.strictEqual(r.source, 'llm');
  assert.deepStrictEqual(r.facets, ['backend']);
  assert.ok(r.confidence > 0 && r.confidence <= 1);
});

test('classifyLLM: composite facets → composite role name', async () => {
  const r = await classifyLLM([], '', fakeLLM('{"facets":["frontend","backend"],"confidence":0.7}'), {});
  assert.strictEqual(r.role, 'fullstack');
});

test('classifyLLM: bad facets / non-json / llm error → null (caller keeps fingerprint)', async () => {
  assert.strictEqual(await classifyLLM([], '', fakeLLM('garbage'), {}), null);
  assert.strictEqual(await classifyLLM([], '', fakeLLM('{"facets":["nonsense"]}'), {}), null);
  const throwing = { complete: async () => { throw new Error('boom'); } };
  assert.strictEqual(await classifyLLM([], '', throwing, {}), null);
});
