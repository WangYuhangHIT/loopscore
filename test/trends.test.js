'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { timeline, skillUplift, allSkillUplift } = require('../src/trends');

test('timeline: buckets by day, averages the metric, sorted ascending', () => {
  const recs = [
    { ts: Date.parse('2026-06-28T01:00:00Z'), scope: 'session', firstPassRate: 0.6 },
    { ts: Date.parse('2026-06-28T05:00:00Z'), scope: 'session', firstPassRate: 0.8 },
    { ts: Date.parse('2026-06-29T05:00:00Z'), scope: 'session', firstPassRate: 1.0 },
  ];
  const t = timeline(recs, { bucket: 'day', metric: 'firstPassRate' });
  assert.strictEqual(t.length, 2);
  assert.strictEqual(t[0].bucket, '2026-06-28');
  assert.strictEqual(t[0].avg, 0.7);
  assert.strictEqual(t[0].count, 2);
  assert.strictEqual(t[1].bucket, '2026-06-29');
});

test('timeline: ignores wrong scope and null/non-numeric metric', () => {
  const recs = [
    { ts: 1, scope: 'agent', firstPassRate: 0.5 },
    { ts: 1, scope: 'session', firstPassRate: null },
  ];
  assert.strictEqual(timeline(recs, { metric: 'firstPassRate' }).length, 0);
});

test('skillUplift: with vs without means + delta + lowConfidence on small n', () => {
  const mk = (skills, v) => ({ scope: 'session', skills, firstPassRate: v });
  const recs = [mk(['tdd'], 0.9), mk(['tdd'], 0.8), mk([], 0.6), mk([], 0.5)];
  const u = skillUplift(recs, { skill: 'tdd', metric: 'firstPassRate' });
  assert.strictEqual(u.withSkill.n, 2);
  assert.strictEqual(u.without.n, 2);
  assert.ok(u.delta > 0);
  assert.strictEqual(u.lowConfidence, true); // n < 5
});

test('skillUplift: enough samples → lowConfidence false', () => {
  const mk = (s, v) => ({ scope: 'session', skills: s, firstPassRate: v });
  const recs = [];
  for (let i = 0; i < 6; i++) recs.push(mk(['x'], 0.9));
  for (let i = 0; i < 6; i++) recs.push(mk([], 0.5));
  const u = skillUplift(recs, { skill: 'x', metric: 'firstPassRate' });
  assert.strictEqual(u.lowConfidence, false);
  assert.strictEqual(u.delta, 0.4);
});

test('allSkillUplift: one entry per unique skill, sorted by |delta| desc', () => {
  const mk = (s, v) => ({ scope: 'session', skills: s, firstPassRate: v });
  const recs = [mk(['tdd'], 0.9), mk(['debug'], 0.55), mk([], 0.5), mk(['tdd', 'debug'], 0.85)];
  const list = allSkillUplift(recs, { metric: 'firstPassRate' });
  const skills = list.map((u) => u.skill).sort();
  assert.deepStrictEqual(skills, ['debug', 'tdd']);
  assert.ok(Math.abs(list[0].delta) >= Math.abs(list[list.length - 1].delta)); // sorted by impact
});
