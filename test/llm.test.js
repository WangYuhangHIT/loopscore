'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createLLM } = require('../src/llm');

const CFG = {
  provider: 'anthropic-compatible',
  baseUrl: 'https://api.example.com/v1',
  model: 'test-model',
  temperature: 1,
  userAgent: 'custom-agent/9.9',
  apiKeyEnv: 'LOOPSCORE_TEST_KEY',
};

function fakeFetch(reply) {
  const captured = {};
  const fn = async (url, opts) => {
    captured.url = url; captured.opts = opts;
    return reply;
  };
  fn.captured = captured;
  return fn;
}

const okReply = { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '{"category":"action","rationale":"r"}' }] }) };

test('llm: builds an anthropic-style request to baseUrl/messages with a custom UA + key', async () => {
  process.env.LOOPSCORE_TEST_KEY = 'sk-test-123';
  const f = fakeFetch(okReply);
  const llm = createLLM(CFG, { fetch: f });
  const text = await llm.complete({ system: 'SYS', user: 'USR' });
  assert.strictEqual(text, '{"category":"action","rationale":"r"}');
  assert.strictEqual(f.captured.url, 'https://api.example.com/v1/messages');
  const h = f.captured.opts.headers;
  assert.strictEqual(h['x-api-key'], 'sk-test-123');
  assert.strictEqual(h['User-Agent'], 'custom-agent/9.9');
  const body = JSON.parse(f.captured.opts.body);
  assert.strictEqual(body.model, 'test-model');
  assert.strictEqual(body.temperature, 1);
  assert.strictEqual(body.system, 'SYS');
  assert.strictEqual(body.messages[0].content, 'USR');
  delete process.env.LOOPSCORE_TEST_KEY;
});

test('llm: missing API key → throws a clear error', async () => {
  delete process.env.LOOPSCORE_TEST_KEY;
  const llm = createLLM(CFG, { fetch: fakeFetch(okReply) });
  await assert.rejects(() => llm.complete({ system: 's', user: 'u' }), /key/i);
});

test('llm: non-2xx response → throws with status', async () => {
  process.env.LOOPSCORE_TEST_KEY = 'sk';
  const llm = createLLM(CFG, { fetch: fakeFetch({ ok: false, status: 429, text: async () => 'rate limited' }) });
  await assert.rejects(() => llm.complete({ system: 's', user: 'u' }), /429/);
  delete process.env.LOOPSCORE_TEST_KEY;
});

test('llm: DEFAULT User-Agent is the neutral loopscore/1.0 (no vendor-gating spoof)', async () => {
  process.env.LOOPSCORE_TEST_KEY = 'sk-test-123';
  const f = fakeFetch(okReply);
  const cfgNoUA = { ...CFG }; delete cfgNoUA.userAgent;
  const llm = createLLM(cfgNoUA, { fetch: f });
  await llm.complete({ system: 'S', user: 'U' });
  assert.strictEqual(f.captured.opts.headers['User-Agent'], 'loopscore/1.0');
});
