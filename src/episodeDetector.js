'use strict';
/**
 * episodeDetector.js — find "failure episodes" worth judging, from a session's
 * event stream. PURE. Groups error tool_results by signature (so a repeated error
 * becomes ONE episode, deduped), marks it 'loop' when it recurs >= loopErrorStreak
 * times, and attaches a context window of the events leading up to the failure.
 *
 *   detect(session, cfg) -> Episode[]
 *   Episode { id, sessionId, kind:'error'|'loop', signature, count, events, ts }
 */

function detect(session, cfg = {}) {
  const timeline = (session && session.timeline) || [];
  const sessionId = session && session.sessionId;
  const loopErrorStreak = cfg.loopErrorStreak != null ? cfg.loopErrorStreak : 3;
  const contextWindow = cfg.contextWindow != null ? cfg.contextWindow : 8;

  const groups = new Map(); // signature -> { count, firstIndex, lastIndex }
  timeline.forEach((e, i) => {
    if (e.kind === 'tool_result' && e.isError) {
      const sig = e.errorSig || 'unknown';
      const g = groups.get(sig) || { count: 0, firstIndex: i, lastIndex: -1 };
      g.count += 1;
      g.lastIndex = i;
      groups.set(sig, g);
    }
  });

  const episodes = [];
  for (const [signature, g] of groups) {
    const loop = g.count >= loopErrorStreak;
    // A recurring (loop) episode spans from the FIRST occurrence (minus context) through the
    // last, so the judge sees the whole loop — not just the events before the final retry.
    const start = Math.max(0, (loop ? g.firstIndex : g.lastIndex) - contextWindow);
    episodes.push({
      id: `${sessionId}:${signature}`,
      sessionId,
      kind: loop ? 'loop' : 'error',
      signature,
      count: g.count,
      events: timeline.slice(start, g.lastIndex + 1),
      ts: timeline[g.lastIndex] && timeline[g.lastIndex].ts,
    });
  }
  return episodes;
}

module.exports = { detect };
