'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createRegistry } = require('../src/llmRegistry');

test('registry: synthesizes a default provider from legacy judge cfg', () => {
  const r = createRegistry({ judge: { provider: 'anthropic-compatible', model: 'test-model', apiKeyEnv: 'FAKE_KEY_X' } },
    { createLLM: () => ({ complete: async () => 'x' }) });
  const list = r.list();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].id, 'default');
  assert.strictEqual(list[0].active, true);
  assert.strictEqual(list[0].keyPresent, false); // FAKE_KEY_X not set
});

test('registry: multiple providers, switch active, proxy delegates to the active one', async () => {
  const make = (c) => ({ complete: async () => c.model });
  const r = createRegistry({ llm: { active: 'a', providers: [{ id: 'a', model: 'ma', apiKeyEnv: 'K' }, { id: 'b', model: 'mb', apiKeyEnv: 'K' }] } },
    { createLLM: make });
  assert.strictEqual(await r.llm.complete({}), 'ma');
  assert.strictEqual(r.setActive('b'), true);
  assert.strictEqual(await r.llm.complete({}), 'mb');
  assert.strictEqual(r.setActive('nope'), false);
  assert.strictEqual(r.activeId(), 'b');
});

test('registry: list reports key PRESENCE only, never the key value', () => {
  process.env.LOOPSCORE_TESTKEY = 'super-secret';
  const r = createRegistry({ llm: { providers: [{ id: 'a', apiKeyEnv: 'LOOPSCORE_TESTKEY', model: 'm' }] } },
    { createLLM: () => ({}) });
  const item = r.list()[0];
  assert.strictEqual(item.keyPresent, true);
  assert.ok(!JSON.stringify(item).includes('super-secret'), 'key value must never appear');
  delete process.env.LOOPSCORE_TESTKEY;
});

// ---- Phase: runtime mutability (UI-driven CRUD) -----------------------------
test('registry.upsert: adds a new provider, list/proxy see it; can switch to it', async () => {
  const make = (c) => ({ complete: async () => c.model });
  const r = createRegistry({ llm: { active: 'a', providers: [{ id: 'a', model: 'ma', apiKeyEnv: 'K' }] } }, { createLLM: make });
  r.upsert({ id: 'b', model: 'mb', apiKeyEnv: 'K' });
  assert.deepStrictEqual(r.list().map((p) => p.id).sort(), ['a', 'b']);
  assert.strictEqual(r.setActive('b'), true);
  assert.strictEqual(await r.llm.complete({}), 'mb');
});

test('registry.upsert: editing an existing provider invalidates cache (proxy uses new model)', async () => {
  const make = (c) => ({ complete: async () => c.model });
  const r = createRegistry({ llm: { active: 'a', providers: [{ id: 'a', model: 'old', apiKeyEnv: 'K' }] } }, { createLLM: make });
  assert.strictEqual(await r.llm.complete({}), 'old');
  r.upsert({ id: 'a', model: 'new', apiKeyEnv: 'K' });
  assert.strictEqual(await r.llm.complete({}), 'new'); // not the stale cached client
});

test('registry.remove: deletes a provider; removing the active one re-points active', async () => {
  const make = (c) => ({ complete: async () => c.model });
  const r = createRegistry({ llm: { active: 'b', providers: [{ id: 'a', model: 'ma', apiKeyEnv: 'K' }, { id: 'b', model: 'mb', apiKeyEnv: 'K' }] } }, { createLLM: make });
  assert.strictEqual(r.remove('b'), true);
  assert.deepStrictEqual(r.list().map((p) => p.id), ['a']);
  assert.strictEqual(r.activeId(), 'a'); // fell back to a surviving provider
  assert.strictEqual(await r.llm.complete({}), 'ma');
  assert.strictEqual(r.remove('nope'), false);
});

test('registry.list: returns full non-secret provider fields (for the editor UI)', () => {
  const r = createRegistry({ llm: { providers: [{ id: 'a', provider: 'anthropic-compatible', baseUrl: 'https://x/v1', model: 'm', temperature: 1, userAgent: 'custom-agent/9.9', apiKeyEnv: 'K', maxTokens: 512 }] } }, { createLLM: () => ({}) });
  const it = r.list()[0];
  assert.strictEqual(it.baseUrl, 'https://x/v1');
  assert.strictEqual(it.temperature, 1);
  assert.strictEqual(it.userAgent, 'custom-agent/9.9');
  assert.strictEqual(it.maxTokens, 512);
});

test('registry.providers: exports the current non-secret config array (to persist to local.json)', () => {
  const r = createRegistry({ llm: { active: 'a', providers: [{ id: 'a', model: 'm', apiKeyEnv: 'K' }] } }, { createLLM: () => ({}) });
  r.upsert({ id: 'b', model: 'm2', apiKeyEnv: 'K' });
  const snap = r.providers();
  assert.strictEqual(snap.length, 2);
  assert.ok(snap.every((p) => !('apiKey' in p)), 'snapshot must hold no secret');
});
