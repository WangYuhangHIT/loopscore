'use strict';
/**
 * judgeRunner.js — orchestrates automatic judging (US2 / bucket ②).
 * On each session update: detect failure episodes → skip already-judged ones
 * (dedup by episode id) → stop at the per-session cap → judge → store the verdict
 * on session.judgments and notify. No-op when judging is disabled.
 *
 *   createRunner({ cfg, llm, onVerdict }) -> { consider(session) }
 */

const { detect } = require('./episodeDetector');
const { judge } = require('./judge');

function createRunner({ cfg, llm, onVerdict = () => {} }) {
  const perSession = new Map(); // sessionId -> { seen:Set, count:number }
  const jcfg = (cfg && cfg.judge) || {};
  const detectCfg = { loopErrorStreak: cfg && cfg.loopErrorStreak, contextWindow: jcfg.contextWindow };
  const interval = jcfg.minIntervalMs || 0; // space calls to respect provider rate limits
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let busy = false; // serialize: overlapping passes are skipped (episodes persist for the next event)

  async function consider(session) {
    if (!jcfg.enabled || !session || busy) return;
    busy = true;
    try {
      let state = perSession.get(session.sessionId);
      if (!state) { state = { seen: new Set(), count: 0 }; perSession.set(session.sessionId, state); }

      const episodes = detect(session, detectCfg);
      for (const ep of episodes) {
        if (state.seen.has(ep.id)) continue;
        if (state.count >= (jcfg.maxPerSession || 20)) break;
        state.seen.add(ep.id);
        state.count += 1;
        const verdict = await judge(ep, llm, jcfg);
        if (!session.judgments) session.judgments = [];
        session.judgments.push(verdict);
        try { onVerdict(verdict); } catch { /* notifier error must not break judging */ }
        if (interval > 0) await sleep(interval);
      }
    } finally {
      busy = false;
    }
  }

  return { consider };
}

module.exports = { createRunner };
