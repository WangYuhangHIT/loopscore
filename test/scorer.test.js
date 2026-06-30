'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { score, scoreEvents } = require('../src/scorer');

const CFG = { testCommandPattern: 'jest|npm (run )?test|node --test|vitest|pytest',
  loopErrorStreak: 3, loopEditsThreshold: 8 };

// event builders
const tool = (t, command) => ({ kind: 'tool_use', tool: t, command });
const res = (isError, errorSig) => ({ kind: 'tool_result', isError, errorSig });
const user = () => ({ kind: 'user' });
const asst = (inp, out) => ({ kind: 'assistant_text', usage: { inputTokens: inp, outputTokens: out } });
const skill = (n) => ({ kind: 'thinking', skill: n });
const hook = (sub) => ({ kind: 'hook', hook: { subtype: sub } });
const mcp = (server, t) => ({ kind: 'tool_use', tool: 'mcp__x', mcpServer: server, mcpTool: t });

const S = (timeline) => score({ timeline }, CFG);

test('scoreEvents: pure on an event array, parity with score(session)', () => {
  const tl = [tool('Bash', 'npm test'), res(false, 'e1'), tool('Edit', undefined), user()];
  assert.deepStrictEqual(scoreEvents(tl, CFG), score({ timeline: tl }, CFG));
});

test('scoreEvents: empty array does not throw', () => {
  const r = scoreEvents([], CFG);
  assert.strictEqual(r.autonomy.userTurns, 0);
  assert.strictEqual(r.loop.flagged, false);
});

test('testDiscipline: counts test-command Bash runs', () => {
  const r = S([tool('Bash', 'npm test'), tool('Bash', 'ls -la'), tool('Bash', 'node --test x')]);
  assert.strictEqual(r.testDiscipline.testsRun, 2);
});

test('testDiscipline: finishWithoutTest false when test follows the edits', () => {
  const r = S([tool('Edit', undefined), tool('Bash', 'npm test')]);
  assert.strictEqual(r.testDiscipline.finishWithoutTest, false);
});

test('testDiscipline: finishWithoutTest true when edits come after last test', () => {
  const r = S([tool('Bash', 'npm test'), tool('Edit', undefined)]);
  assert.strictEqual(r.testDiscipline.finishWithoutTest, true);
});

test('testDiscipline: finishWithoutTest true when edits but no test at all', () => {
  const r = S([tool('Write', undefined), tool('Edit', undefined)]);
  assert.strictEqual(r.testDiscipline.finishWithoutTest, true);
});

test('loop: sameErrorStreak counts trailing run of identical error signatures', () => {
  const r = S([res(true, 'ErrX'), res(true, 'ErrX'), res(true, 'ErrX')]);
  assert.strictEqual(r.loop.sameErrorStreak, 3);
  assert.strictEqual(r.loop.flagged, true);
});

test('loop: a different trailing error resets the same-error streak', () => {
  const r = S([res(true, 'ErrX'), res(true, 'ErrY'), res(true, 'ErrX')]);
  assert.strictEqual(r.loop.sameErrorStreak, 1);
});

test('loop: editsSinceLastGreen flags when threshold reached', () => {
  const tl = [tool('Bash', 'npm test'), res(false), ...Array.from({ length: 8 }, () => tool('Edit'))];
  const r = S(tl);
  assert.strictEqual(r.loop.editsSinceLastGreen, 8);
  assert.strictEqual(r.loop.flagged, true);
});

test('loop: a green test resets editsSinceLastGreen', () => {
  const r = S([tool('Edit'), tool('Edit'), tool('Bash', 'npm test'), res(false)]);
  assert.strictEqual(r.loop.editsSinceLastGreen, 0);
});

test('autonomy: user turns, interventions, tool calls per turn', () => {
  const r = S([user(), tool('Read'), tool('Bash', 'x'), user(), tool('Edit')]);
  assert.strictEqual(r.autonomy.userTurns, 2);
  assert.strictEqual(r.autonomy.interventions, 1); // first user turn is the initial prompt
  assert.strictEqual(r.autonomy.toolCallsPerUserTurn, 1.5);
});

test('usage: distributions by skill / hook / mcp / tool', () => {
  const r = S([skill('langfuse'), skill('langfuse'), hook('stop_hook_summary'),
    mcp('Claude in Chrome', 'tabs'), tool('Bash', 'x'), tool('Read')]);
  assert.strictEqual(r.usage.bySkill.langfuse, 2);
  assert.strictEqual(r.usage.byHook.stop_hook_summary, 1);
  assert.strictEqual(r.usage.byMcp['Claude in Chrome'], 1);
  assert.strictEqual(r.usage.byTool.Bash, 1);
  assert.strictEqual(r.usage.byTool.Read, 1);
});

test('cost: sums tokens; usd is null in v1 (token-only, offline)', () => {
  const r = S([asst(10, 5), asst(20, 7)]);
  assert.strictEqual(r.cost.inputTokens, 30);
  assert.strictEqual(r.cost.outputTokens, 12);
  assert.strictEqual(r.cost.usd, null);
});

test('bucket label marks scores as deterministic', () => {
  assert.strictEqual(S([user()]).bucket, 'deterministic');
});

test('score is pure: same input yields identical output', () => {
  const tl = [user(), tool('Bash', 'npm test'), res(false), tool('Edit')];
  assert.deepStrictEqual(S(tl), S(tl));
});

test('id-pairing: an interleaved (non-test) result must NOT clear the edit run', () => {
  const tu = (t, command, id) => ({ kind: 'tool_use', tool: t, command, toolUseId: id });
  const tr = (isError, id) => ({ kind: 'tool_result', isError, toolUseId: id });
  const tl = [
    tu('Edit', undefined, 'e1'),
    tu('Edit', undefined, 'e2'),
    tu('Bash', 'npm test', 't1'), // the test command
    tr(false, 'read-xyz'),        // an interleaved Read result (passing), DIFFERENT id
    tr(true, 't1'),               // the test's OWN result: failing
  ];
  // only the test's own (failed) result counts → edits stay uncleared.
  // The old "first result after the test" heuristic would wrongly clear on the passing Read.
  assert.ok(scoreEvents(tl, CFG).loop.editsSinceLastGreen >= 2);
});

test('id-pairing: the test command\'s own green result DOES clear the edit run', () => {
  const tu = (t, command, id) => ({ kind: 'tool_use', tool: t, command, toolUseId: id });
  const tr = (isError, id) => ({ kind: 'tool_result', isError, toolUseId: id });
  const tl = [
    tu('Edit', undefined, 'e1'),
    tu('Bash', 'npm test', 't1'),
    tr(true, 'read-xyz'), // interleaved failing Read result — must be ignored
    tr(false, 't1'),      // the test passed
  ];
  assert.strictEqual(scoreEvents(tl, CFG).loop.editsSinceLastGreen, 0);
});
