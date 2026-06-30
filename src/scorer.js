'use strict';
/**
 * scorer.js — bucket ① deterministic process metrics. PURE: score(session, cfg)
 * derives everything from session.timeline with no side effects (same input →
 * same output). These are objective process signals, NOT a verdict on code
 * quality (that needs bucket ②/③, later slices).
 */

// scoreEvents — the real computation, pure over a raw event array. score(session)
// is a thin wrapper so callers with a whole session keep working, while per-lane
// callers (sub-agent scoring) can pass `lane.events` directly.
function scoreEvents(timeline = [], cfg = {}) {
  const testRe = new RegExp(cfg.testCommandPattern || 'jest|npm (run )?test|node --test|vitest|pytest');
  const loopErrorStreak = cfg.loopErrorStreak != null ? cfg.loopErrorStreak : 3;
  const loopEditsThreshold = cfg.loopEditsThreshold != null ? cfg.loopEditsThreshold : 8;

  const isEdit = (e) => e.kind === 'tool_use' && (e.tool === 'Edit' || e.tool === 'Write');
  const isTestCmd = (e) =>
    e.kind === 'tool_use' && e.tool === 'Bash' && typeof e.command === 'string' && testRe.test(e.command);

  const bySkill = {}, byHook = {}, byMcp = {}, byTool = {};
  let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheCreationTokens = 0;
  let userTurns = 0, toolCalls = 0;
  let testsRun = 0, lastTestIdx = -1;
  let editsSinceLastGreen = 0;
  // Pair a test command to ITS OWN result by tool_use_id (the result of an interleaved
  // Read/Grep must not be mistaken for the test outcome). Fall back to order-pairing only
  // for id-less events (older/synthetic transcripts).
  const pendingTestIds = new Set();
  let pendingTestNoId = false;

  timeline.forEach((e, i) => {
    if (e.skill) bySkill[e.skill] = (bySkill[e.skill] || 0) + 1;
    if (e.kind === 'hook' && e.hook && e.hook.subtype) {
      byHook[e.hook.subtype] = (byHook[e.hook.subtype] || 0) + 1;
    }
    if (e.mcpServer) byMcp[e.mcpServer] = (byMcp[e.mcpServer] || 0) + 1;
    if (e.kind === 'tool_use' && e.tool) { byTool[e.tool] = (byTool[e.tool] || 0) + 1; toolCalls++; }
    if (e.usage) {
      inputTokens += e.usage.inputTokens || 0; outputTokens += e.usage.outputTokens || 0;
      cacheReadTokens += e.usage.cacheReadTokens || 0; cacheCreationTokens += e.usage.cacheCreationTokens || 0;
    }
    if (e.kind === 'user') userTurns++;

    if (isTestCmd(e)) { testsRun++; lastTestIdx = i; if (e.toolUseId) pendingTestIds.add(e.toolUseId); else pendingTestNoId = true; }
    if (isEdit(e)) editsSinceLastGreen++;
    if (e.kind === 'tool_result') {
      if (e.toolUseId && pendingTestIds.has(e.toolUseId)) {
        if (!e.isError) editsSinceLastGreen = 0; // green test clears the edit run
        pendingTestIds.delete(e.toolUseId);
      } else if (!e.toolUseId && pendingTestNoId) {
        if (!e.isError) editsSinceLastGreen = 0;
        pendingTestNoId = false;
      }
    }
  });

  const editsAfterLastTest = timeline.filter((e, i) => isEdit(e) && i > lastTestIdx).length;
  const finishWithoutTest = editsAfterLastTest > 0;

  // trailing run of identical error signatures
  const results = timeline.filter((e) => e.kind === 'tool_result');
  let sameErrorStreak = 0, lastSig = null;
  for (let i = results.length - 1; i >= 0; i--) {
    const r = results[i];
    if (!r.isError) break;
    if (sameErrorStreak === 0) { sameErrorStreak = 1; lastSig = r.errorSig; }
    else if (r.errorSig === lastSig) sameErrorStreak++;
    else break;
  }

  const flagged = sameErrorStreak >= loopErrorStreak || editsSinceLastGreen >= loopEditsThreshold;
  const perTurn = Math.round((toolCalls / Math.max(1, userTurns)) * 100) / 100;

  return {
    testDiscipline: { testsRun, finishWithoutTest },
    loop: { sameErrorStreak, editsSinceLastGreen, flagged },
    autonomy: { userTurns, interventions: Math.max(0, userTurns - 1), toolCallsPerUserTurn: perTurn },
    usage: { bySkill, byHook, byMcp, byTool },
    cost: { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, usd: null },
    bucket: 'deterministic',
  };
}

function score(session, cfg = {}) {
  return scoreEvents((session && session.timeline) || [], cfg);
}

module.exports = { score, scoreEvents };
