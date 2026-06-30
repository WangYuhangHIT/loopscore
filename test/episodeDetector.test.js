'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { detect } = require('../src/episodeDetector');

const CFG = { loopErrorStreak: 3, contextWindow: 3 };
const sess = (timeline) => ({ sessionId: 's1', timeline });
const ok = () => ({ kind: 'tool_result', isError: false });
const err = (sig) => ({ kind: 'tool_result', isError: true, errorSig: sig });
const step = (i) => ({ kind: 'tool_use', tool: 'Edit', uuid: 'e' + i });

test('detect: no errors → no episodes', () => {
  assert.deepStrictEqual(detect(sess([step(1), ok(), step(2)]), CFG), []);
});

test('detect: one error → one episode kind=error with signature', () => {
  const eps = detect(sess([step(1), err('TypeError: x')]), CFG);
  assert.strictEqual(eps.length, 1);
  assert.strictEqual(eps[0].kind, 'error');
  assert.strictEqual(eps[0].signature, 'TypeError: x');
  assert.strictEqual(eps[0].sessionId, 's1');
});

test('detect: same error repeated >= loopErrorStreak → single deduped episode kind=loop', () => {
  const eps = detect(sess([err('E'), step(1), err('E'), step(2), err('E')]), CFG);
  assert.strictEqual(eps.length, 1); // deduped by signature
  assert.strictEqual(eps[0].kind, 'loop');
  assert.strictEqual(eps[0].count, 3);
});

test('detect: distinct errors → one episode each', () => {
  const eps = detect(sess([err('A'), err('B')]), CFG);
  assert.strictEqual(eps.length, 2);
  assert.deepStrictEqual(eps.map((e) => e.signature).sort(), ['A', 'B']);
});

test('detect: stable id = sessionId:signature (for dedup across time)', () => {
  const eps = detect(sess([err('boom')]), CFG);
  assert.strictEqual(eps[0].id, 's1:boom');
});

test('detect: context window = up to contextWindow events before the error + the error', () => {
  const tl = [step(1), step(2), step(3), step(4), step(5), err('X')]; // error at idx 5
  const eps = detect(sess(tl), CFG);
  assert.strictEqual(eps[0].events.length, 4); // contextWindow(3) + the error
  assert.strictEqual(eps[0].events[eps[0].events.length - 1].errorSig, 'X');
});

test('detect: error with no signature → grouped under "unknown"', () => {
  const eps = detect(sess([{ kind: 'tool_result', isError: true }]), CFG);
  assert.strictEqual(eps.length, 1);
  assert.strictEqual(eps[0].signature, 'unknown');
});
