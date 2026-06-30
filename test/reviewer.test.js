'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { review, createReviewRunner } = require('../src/reviewer');

const EVAL = {
  overall: { label: 'A few to watch', concerns: 2 },
  dimensions: {
    delivery: { rating: 'good', commits: 18, editsSinceCommit: 15 },
    quality: { rating: 'concern', filesTouched: 75, testPass: true, buildPass: null, lintPass: null, typecheckPass: null },
    verification: { rating: 'good', testsRun: 27, finishWithoutTest: false },
    debugging: { rating: 'ok', sameErrorStreak: 0, editsSinceLastGreen: 0, flagged: false },
    context: { rating: 'concern', filesRead: 28, filesEdited: 75, blastRadius: 75, exploreReads: 2 },
    autonomy: { rating: 'good', userTurns: 100, interventions: 99, toolCallsPerUserTurn: 5 },
    recovery: { rating: 'ok', errors: 10, currentlyStuck: false, eventCount: 2400 },
  },
};
const SESSION = { sessionId: 's1', lastTsMs: Date.parse('2026-06-13T12:00:00Z'),
  timeline: [{ kind: 'tool_use', tool: 'Write', filePath: 'a.js' }, { kind: 'tool_result', isError: true, errorSig: 'X' }] };

function mockLLM(reply) {
  const calls = [];
  return { calls, complete: async (p) => { calls.push(p); return reply; } };
}
const JCFG = { model: 'test-model', review: { intervalMs: 120000, minNewEvents: 20 } };

test('review: returns a manager-style note from the LLM', async () => {
  const r = await review(EVAL, SESSION, mockLLM('Steady work; the big blast radius is fine because it is greenfield tooling.'), JCFG);
  assert.match(r.note, /greenfield/);
  assert.strictEqual(r.model, 'test-model');
});

test('review: prompt carries the 7-dim ratings + data-not-instructions defense', async () => {
  const llm = mockLLM('ok');
  await review(EVAL, SESSION, llm, JCFG);
  const blob = JSON.stringify(llm.calls[0]);
  assert.match(blob, /concern/);
  assert.match(blob, /DATA/);
  assert.match(blob, /instructions/);
});

test('review: LLM error → null (never throws)', async () => {
  const llm = { complete: async () => { throw new Error('net'); } };
  assert.strictEqual(await review(EVAL, SESSION, llm, JCFG), null);
});

test('review: strips markdown fences from thinking-model output', async () => {
  const r = await review(EVAL, SESSION, mockLLM('```\nSteady pace lately.\n```'), JCFG);
  assert.strictEqual(r.note, 'Steady pace lately.');
});

test('reviewRunner: reviews once, then throttles within the interval', async () => {
  const llm = mockLLM('note');
  const got = [];
  const big = { sessionId: 's1', timeline: Array.from({ length: 50 }, () => ({ kind: 'tool_use', tool: 'Edit' })) };
  const r = createReviewRunner({ cfg: JCFG, llm, onReview: (rv) => got.push(rv) });
  await r.maybeReview(big, EVAL, 1_000_000);
  await r.maybeReview(big, EVAL, 1_000_000 + 5000); // within interval → skip
  assert.strictEqual(llm.calls.length, 1);
  assert.strictEqual(got.length, 1);
  assert.ok(big.review && big.review.note);
});

test('reviewRunner: skips until enough new events accumulate', async () => {
  const llm = mockLLM('note');
  const small = { sessionId: 's2', timeline: Array.from({ length: 5 }, () => ({ kind: 'user' })) };
  const r = createReviewRunner({ cfg: JCFG, llm, onReview: () => {} });
  await r.maybeReview(small, EVAL, 1_000_000); // only 5 events < minNewEvents(20) → skip
  assert.strictEqual(llm.calls.length, 0);
});
