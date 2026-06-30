'use strict';
/**
 * llmRegistry.js — multiple LLM providers + runtime switching (Phase 5). Exposes a
 * stable proxy `llm` (so judge/review/roleRunner hold one reference); switching the
 * active provider changes which underlying client the proxy calls — no re-wiring.
 *
 *   createRegistry(cfg, { createLLM }) -> { llm, list(), setActive(id), activeId(), activeProviderCfg() }
 *
 * Config: cfg.llm.providers = [{id, provider, baseUrl, model, apiKeyEnv, ...}], cfg.llm.active.
 * Back-compat: with no providers array, synthesizes one 'default' provider from cfg.judge.
 * SECURITY: list() reports key PRESENCE (keyPresent) only — never the key value, which
 * lives in env (user-placed), never in config or responses.
 */

const { createLLM } = require('./llm');

function createRegistry(cfg = {}, deps = {}) {
  const make = deps.createLLM || createLLM;
  const llmCfg = cfg.llm || {};
  const providers = Array.isArray(llmCfg.providers) && llmCfg.providers.length
    ? llmCfg.providers.slice()
    : [Object.assign({ id: 'default' }, cfg.judge || {})];
  let activeId = llmCfg.active && providers.some((p) => p.id === llmCfg.active) ? llmCfg.active : providers[0].id;

  const cache = new Map();
  function providerCfg(id) { return providers.find((p) => p.id === id); }
  function llmFor(id) {
    if (!cache.has(id)) cache.set(id, make(providerCfg(id) || {}));
    return cache.get(id);
  }

  // Stable proxy: always routes to the current active provider's client.
  const llm = { complete: (args) => llmFor(activeId).complete(args) };

  function keyEnvOf(p) { return p.apiKeyEnv || 'LOOPSCORE_JUDGE_KEY'; }
  function list() {
    return providers.map((p) => ({
      id: p.id,
      provider: p.provider || null,
      model: p.model || null,
      baseUrl: p.baseUrl || null,
      temperature: p.temperature != null ? p.temperature : null,
      userAgent: p.userAgent || null,
      maxTokens: p.maxTokens != null ? p.maxTokens : null,
      keyEnv: keyEnvOf(p),
      keyPresent: !!process.env[keyEnvOf(p)],
      active: p.id === activeId,
    }));
  }
  function setActive(id) {
    if (!providerCfg(id)) return false;
    activeId = id;
    return true;
  }

  // --- runtime mutation (UI-driven CRUD; persistence is the caller's job) ---
  // Only non-secret fields are kept — a key never lives in a provider object.
  function sanitize(p) {
    const out = {};
    for (const k of ['id', 'provider', 'baseUrl', 'model', 'temperature', 'userAgent', 'apiKeyEnv', 'maxTokens']) {
      if (p[k] !== undefined) out[k] = p[k];
    }
    return out;
  }
  function upsert(p) {
    if (!p || !p.id) return false;
    const clean = sanitize(p);
    const i = providers.findIndex((x) => x.id === clean.id);
    if (i >= 0) providers[i] = clean; else providers.push(clean);
    cache.delete(clean.id); // editing a provider must drop its stale client
    return true;
  }
  function remove(id) {
    const i = providers.findIndex((x) => x.id === id);
    if (i < 0) return false;
    providers.splice(i, 1);
    cache.delete(id);
    if (activeId === id) activeId = providers[0] ? providers[0].id : null; // re-point active
    return true;
  }
  // Non-secret config snapshot — what the server persists to local.json.
  function snapshot() { return providers.map(sanitize); }

  return {
    llm, list, setActive, upsert, remove,
    providers: snapshot,
    activeId: () => activeId,
    activeProviderCfg: () => providerCfg(activeId),
  };
}

module.exports = { createRegistry };
