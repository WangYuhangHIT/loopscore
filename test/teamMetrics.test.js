'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { teamMetrics } = require('../src/teamMetrics');

const tu = (tool, ts) => ({ kind: 'tool_use', tool, ts });

test('teamMetrics: RoleCoverage unions facets, flags nobody-testing', () => {
  const lanes = [
    { id: 'main', role: { facets: ['pm'] }, events: [tu('Edit')] },
    { agentId: 'a', role: { facets: ['backend'] }, events: [] },
  ];
  const t = teamMetrics(lanes);
  assert.deepStrictEqual(t.RoleCoverage.value.covered.sort(), ['backend', 'pm']);
  assert.strictEqual(t.RoleCoverage.value.hasTest, false);
  assert.strictEqual(t.RoleCoverage.rating, 'concern'); // code edited, nobody on test facet
});

test('teamMetrics: parallelism peak from overlapping sub-agent timestamps', () => {
  const lanes = [
    { agentId: 'a', role: { facets: ['backend'] }, events: [tu('Edit', '2026-06-13T12:00:00Z')] },
    { agentId: 'b', role: { facets: ['frontend'] }, events: [tu('Edit', '2026-06-13T12:00:10Z')] },
  ];
  const t = teamMetrics(lanes);
  assert.ok(t.Parallelism.value.peak >= 2, 'two agents active within the window');
  assert.strictEqual(t.Parallelism.value.totalAgents, 2);
});

test('teamMetrics: parallelism peak = 1 when agents are active far apart (window correctness)', () => {
  const lanes = [
    { agentId: 'a', role: { facets: ['backend'] }, events: [tu('Edit', '2026-06-13T12:00:00Z')] },
    { agentId: 'b', role: { facets: ['frontend'] }, events: [tu('Edit', '2026-06-13T12:30:00Z')] }, // 30 min later
  ];
  const t = teamMetrics(lanes);
  assert.strictEqual(t.Parallelism.value.peak, 1, 'no temporal overlap → peak 1');
});

test('teamMetrics: collaboration counts SendMessage + spawns', () => {
  const lanes = [
    { id: 'main', role: { facets: ['pm'] }, events: [tu('Task'), tu('SendMessage')] },
    { agentId: 'a', role: { facets: ['backend'] }, events: [] },
  ];
  const t = teamMetrics(lanes);
  assert.strictEqual(t.CollaborationHealth.value.spawns, 1);
  assert.strictEqual(t.CollaborationHealth.value.sendMessages, 1);
});

test('teamMetrics: rolls up member concerns when lanes carry evaluation', () => {
  const lanes = [
    { id: 'main', role: { facets: ['pm'] }, events: [], evaluation: { overall: { concerns: 2 } } },
    { agentId: 'a', role: { facets: ['test'] }, events: [], evaluation: { overall: { concerns: 0 } } },
  ];
  const t = teamMetrics(lanes);
  assert.strictEqual(t.teamConcerns, 1);
});

test('teamMetrics: empty input does not throw', () => {
  const t = teamMetrics([]);
  assert.strictEqual(t.memberCount, 0);
  assert.deepStrictEqual(t.RoleCoverage.value.covered, []);
});
