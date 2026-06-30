'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { evaluate, evaluateEvents, DIMENSIONS } = require('../src/evaluator');

const CFG = { testCommandPattern: 'jest|npm (run )?test|node --test', loopErrorStreak: 3, loopEditsThreshold: 8 };
const E = (timeline) => evaluate({ timeline }, CFG);

const bash = (command) => ({ kind: 'tool_use', tool: 'Bash', command });
const res = (isError, errorSig) => ({ kind: 'tool_result', isError, errorSig });
const edit = (fp) => ({ kind: 'tool_use', tool: 'Edit', filePath: fp });
const write = (fp) => ({ kind: 'tool_use', tool: 'Write', filePath: fp });
const read = (fp) => ({ kind: 'tool_use', tool: 'Read', filePath: fp });

test('evaluate: exposes all 7 research dimensions + overall', () => {
  const r = E([read('a')]);
  for (const d of DIMENSIONS) assert.ok(r.dimensions[d], 'missing dimension ' + d);
  assert.ok(r.overall);
});

test('evaluateEvents: pure on an event array, parity with evaluate(session)', () => {
  const tl = [read('a'), edit('b.js'), bash('npm run build'), res(false), bash('npm test'), res(true)];
  assert.deepStrictEqual(evaluateEvents(tl, CFG), evaluate({ timeline: tl }, CFG));
});

test('evaluateEvents: empty array does not throw, yields full shape', () => {
  const r = evaluateEvents([], CFG);
  assert.ok(r.dimensions && r.capability && r.overall);
  for (const d of DIMENSIONS) assert.ok(r.dimensions[d], 'missing dimension ' + d);
});

test('delivery: counts git commits', () => {
  const r = E([edit('a.js'), bash('git commit -m "x"')]);
  assert.strictEqual(r.dimensions.delivery.commits, 1);
});

test('quality: detects build/lint/typecheck/test pass+fail from command results', () => {
  const r = E([bash('npm run build'), res(false), bash('eslint .'), res(true, 'lint err')]);
  assert.strictEqual(r.dimensions.quality.buildPass, true);
  assert.strictEqual(r.dimensions.quality.lintPass, false);
  assert.strictEqual(r.dimensions.quality.rating, 'concern'); // a check failed
});

test('quality + context: blast radius = distinct edited files', () => {
  const r = E([edit('a.js'), edit('a.js'), write('b.js'), write('c.js')]);
  assert.strictEqual(r.dimensions.quality.filesTouched, 3);
  assert.strictEqual(r.dimensions.context.blastRadius, 3);
});

test('context: counts reads before the first edit (exploration before acting)', () => {
  const r = E([read('a'), read('b'), read('c'), edit('a')]);
  assert.strictEqual(r.dimensions.context.exploreReads, 3);
  assert.strictEqual(r.dimensions.context.filesRead, 3);
});

test('recovery: counts errors and flags currently-stuck (loop)', () => {
  const r = E([res(true, 'X'), res(true, 'X'), res(true, 'X')]);
  assert.strictEqual(r.dimensions.recovery.errors, 3);
  assert.strictEqual(r.dimensions.recovery.currentlyStuck, true);
  assert.strictEqual(r.dimensions.recovery.rating, 'concern');
});

test('reuses deterministic dims from scorer (verification/debugging/autonomy)', () => {
  const r = E([bash('npm test'), res(false), edit('a')]);
  assert.strictEqual(r.dimensions.verification.testsRun, 1);
  assert.ok('flagged' in r.dimensions.debugging);
  assert.ok('userTurns' in r.dimensions.autonomy);
});

test('overall: counts concerns and gives a label', () => {
  const clean = E([bash('npm test'), res(false)]);
  assert.strictEqual(typeof clean.overall.concerns, 'number');
  assert.ok(typeof clean.overall.label === 'string');
});

test('evaluate is pure: same input → same output', () => {
  const tl = [read('a'), edit('a'), bash('npm test'), res(false)];
  assert.deepStrictEqual(E(tl), E(tl));
});

test('delivery threshold: 16 edits with no commit → concern; 15 → not', () => {
  const edits = (n) => Array.from({ length: n }, (_, i) => edit('f' + i + '.js'));
  assert.strictEqual(E(edits(16)).dimensions.delivery.rating, 'concern');
  assert.notStrictEqual(E(edits(15)).dimensions.delivery.rating, 'concern');
});

test('context threshold: blast radius of 16 distinct files (no exploration) → concern', () => {
  const r = E(Array.from({ length: 16 }, (_, i) => edit('f' + i + '.js')));
  assert.strictEqual(r.dimensions.context.rating, 'concern');
});

test('quality id-pairing: an interleaved result is not mistaken for the build outcome', () => {
  const bId = (command, id) => ({ kind: 'tool_use', tool: 'Bash', command, toolUseId: id });
  const rId = (isError, id) => ({ kind: 'tool_result', isError, toolUseId: id });
  const r = evaluateEvents([
    bId('npm run build', 'b1'),
    rId(false, 'other'), // unrelated passing result first
    rId(true, 'b1'),     // the build's OWN result: failed
  ], CFG);
  assert.strictEqual(r.dimensions.quality.buildPass, false);
});
