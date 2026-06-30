'use strict';
/**
 * roleRunner.js — periodic LLM re-check of role classification during a live session
 * (design §4.2 "periodic re-check"). Mirrors judgeRunner's discipline: serialized (a busy pass
 * is skipped), interval-throttled, and per-pass capped — so it never floods the provider
 * or burns tokens. Only AMBIGUOUS lanes (low fingerprint distinctiveness, §11) are sent,
 * and a lane is only re-checked once it has gained `recheckEvents` new events. Manual
 * overrides are skipped (locked). Writes the verdict to `lane.roleLLM`; sessionModel's
 * laneRole prefers manual > LLM > fingerprint. No-op when disabled or no llm.
 *
 *   createRoleRunner({ cfg, llm, onRole }) -> { consider(session) }
 */

const { classify, classifyLLM, lowDistinctiveness } = require('./roleClassifier');

function createRoleRunner({ cfg, llm, onRole = () => {} }) {
  const rcfg = (cfg && cfg.roleReview) || {};
  const interval = rcfg.minIntervalMs || 0;
  const recheckEvents = rcfg.recheckEvents != null ? rcfg.recheckEvents : 30;
  const maxPerPass = rcfg.maxPerPass != null ? rcfg.maxPerPass : 4;
  const marginThresh = rcfg.marginThresh;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let busy = false;

  async function consider(session) {
    if (!rcfg.enabled || !session || !llm || busy) return;
    busy = true;
    try {
      let calls = 0;
      for (const lane of Object.values(session.lanes || {})) {
        if (calls >= maxPerPass) break;
        if (lane.roleOverride) continue; // manual = locked, never auto-touch
        const n = (lane.events || []).length;
        if (!n) continue;
        if (lane._llmAtN != null && n - lane._llmAtN < recheckEvents) continue; // not enough new events
        const firstUser = lane.events.find((e) => e.kind === 'user' && e.textSnippet);
        const prompt = firstUser ? firstUser.textSnippet : '';
        const fp = classify(lane.events, prompt);
        if (!lowDistinctiveness(fp, marginThresh != null ? { marginThresh } : {})) continue; // clear enough → skip LLM
        const r = await classifyLLM(lane.events, prompt, llm, rcfg);
        lane._llmAtN = n; // mark checked even if it returned null (don't retry same window)
        calls += 1;
        if (r) { lane.roleLLM = r; try { onRole(lane, r); } catch { /* notifier must not break */ } }
        if (interval > 0) await sleep(interval);
      }
    } finally {
      busy = false;
    }
  }

  return { consider };
}

module.exports = { createRoleRunner };
