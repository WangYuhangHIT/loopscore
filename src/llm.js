'use strict';
/**
 * llm.js — minimal zero-dep LLM client for the judge (US2). Raw `fetch` to an
 * Anthropic-compatible /messages endpoint. Supports a configurable baseUrl so you
 * can point it at any Anthropic-compatible provider (Anthropic, or a compatible
 * gateway). The key always comes from an env var and is never committed.
 *
 *   User-Agent defaults to a neutral `loopscore/1.0`. It is configurable
 *   (cfg.userAgent) for providers that vary behaviour by client, but the shipped
 *   default identifies this tool honestly.
 *
 *   createLLM(cfg, { fetch }) -> { complete({system,user}) -> Promise<text> }
 */

function createLLM(cfg, deps = {}) {
  const doFetch = deps.fetch || globalThis.fetch;

  async function complete({ system, user }) {
    const key = process.env[cfg.apiKeyEnv || 'LOOPSCORE_JUDGE_KEY'];
    if (!key) throw new Error(`judge LLM api key not configured (set env var ${cfg.apiKeyEnv || 'LOOPSCORE_JUDGE_KEY'})`);
    const base = (cfg.baseUrl || 'https://api.anthropic.com/v1').replace(/\/$/, '');
    const res = await doFetch(base + '/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'User-Agent': cfg.userAgent || 'loopscore/1.0',
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: cfg.maxTokens || 512,
        temperature: cfg.temperature != null ? cfg.temperature : 1,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) {
      let detail = '';
      try { detail = await res.text(); } catch { /* ignore */ }
      throw new Error(`judge LLM HTTP ${res.status} ${String(detail).slice(0, 200)}`);
    }
    const data = await res.json();
    const block = data && Array.isArray(data.content) ? data.content.find((c) => c.type === 'text') : null;
    return block ? block.text : '';
  }

  return { complete };
}

module.exports = { createLLM };
