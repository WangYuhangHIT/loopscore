'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { evaluate } = require('../src/evaluator');

const CFG = { testCommandPattern: 'npm test', loopErrorStreak: 3, loopEditsThreshold: 8, capWindow: 40 };
const cap = (timeline) => evaluate({ timeline }, CFG).capability;

const res = (isError, sig) => ({ kind: 'tool_result', isError, errorSig: sig });
const edit = (fp) => ({ kind: 'tool_use', tool: 'Edit', filePath: fp });
const read = (fp) => ({ kind: 'tool_use', tool: 'Read', filePath: fp });
const tool = (t) => ({ kind: 'tool_use', tool: t });
const user = () => ({ kind: 'user' });

test('capability block exists with all metrics', () => {
  const c = cap([res(false)]);
  for (const k of ['firstPassRate', 'reworkRate', 'recoverySteps', 'lookBeforeLeap', 'autonomySpan', 'stuckRisk']) {
    assert.ok(k in c, 'missing ' + k);
  }
});

test('firstPassRate = fraction of tool results without error', () => {
  const c = cap([res(false), res(false), res(true, 'x'), res(false)]); // 3/4
  assert.strictEqual(c.firstPassRate, 0.75);
});

test('reworkRate: re-editing the same files raises it', () => {
  const focused = cap([edit('a'), edit('b'), edit('c')]); // 3 distinct / 3 → rework 0
  assert.strictEqual(focused.reworkRate, 0);
  const churny = cap([edit('a'), edit('a'), edit('a'), edit('b')]); // 2 distinct / 4 → 0.5
  assert.strictEqual(churny.reworkRate, 0.5);
});

test('recoverySteps: avg steps from an error to the next success', () => {
  // error, then 2 steps, then a success → gap 3
  const c = cap([res(true, 'x'), tool('Edit'), tool('Bash'), res(false)]);
  assert.strictEqual(c.recoverySteps, 3);
});

test('lookBeforeLeap = reads / edits (capped)', () => {
  const c = cap([read('a'), read('b'), edit('a')]); // 2 reads / 1 edit = 2
  assert.strictEqual(c.lookBeforeLeap, 2);
});

test('autonomySpan = tool calls per user turn in window', () => {
  const c = cap([user(), tool('Read'), tool('Bash'), tool('Edit')]); // 3 tools / 1 user = 3
  assert.strictEqual(c.autonomySpan, 3);
});

test('stuckRisk rises with repeated same errors', () => {
  const calm = cap([res(false)]);
  const stuck = cap([res(true, 'X'), res(true, 'X'), res(true, 'X')]);
  assert.ok(stuck.stuckRisk > calm.stuckRisk);
  assert.ok(stuck.stuckRisk >= 50);
});

test('window: only the last capWindow events count', () => {
  const cfg = Object.assign({}, CFG, { capWindow: 3 });
  // 10 passing results then nothing — window of 3 → all pass
  const tl = Array.from({ length: 10 }, () => res(false));
  const c = evaluate({ timeline: tl }, cfg).capability;
  assert.strictEqual(c.firstPassRate, 1);
});
