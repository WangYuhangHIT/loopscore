'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createRunner } = require('../src/judgeRunner');

const baseCfg = (over = {}) => ({
  loopErrorStreak: 3,
  judge: Object.assign({ enabled: true, maxPerSession: 20, model: 'm', contextWindow: 4 }, over),
});

function mockLLM() {
  const calls = [];
  return { calls, complete: async () => { calls.push(1); return '{"category":"action","rationale":"r"}'; } };
}

const errSession = (sigs) => ({
  sessionId: 's1', judgments: [],
  timeline: sigs.map((s) => ({ kind: 'tool_result', isError: true, errorSig: s })),
});

test('runner: disabled → does not call the LLM', async () => {
  const llm = mockLLM();
  const r = createRunner({ cfg: baseCfg({ enabled: false }), llm, onVerdict: () => {} });
  await r.consider(errSession(['A']));
  assert.strictEqual(llm.calls.length, 0);
});

test('runner: enabled → judges each distinct episode and stores verdict on session', async () => {
  const llm = mockLLM();
  const got = [];
  const r = createRunner({ cfg: baseCfg(), llm, onVerdict: (v) => got.push(v) });
  const s = errSession(['A', 'B']);
  await r.consider(s);
  assert.strictEqual(s.judgments.length, 2);
  assert.strictEqual(got.length, 2);
  assert.strictEqual(s.judgments[0].bucket, 'llm-judge');
});

test('runner: dedup — re-considering the same session does not re-judge seen episodes', async () => {
  const llm = mockLLM();
  const r = createRunner({ cfg: baseCfg(), llm, onVerdict: () => {} });
  const s = errSession(['A']);
  await r.consider(s);
  await r.consider(s); // same episode id
  assert.strictEqual(llm.calls.length, 1);
  assert.strictEqual(s.judgments.length, 1);
});

test('runner: respects maxPerSession cap', async () => {
  const llm = mockLLM();
  const r = createRunner({ cfg: baseCfg({ maxPerSession: 2 }), llm, onVerdict: () => {} });
  await r.consider(errSession(['A', 'B', 'C', 'D']));
  assert.strictEqual(llm.calls.length, 2); // capped
});
