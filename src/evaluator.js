'use strict';
/**
 * evaluator.js — real-time "AI employee performance" across the 7 capability
 * dimensions from the research (docs/AI_DEV_MONITORING_RESEARCH_2026-06.md §4):
 *   delivery / quality / verification / debugging / context / autonomy / recovery
 *
 * PURE. Computed continuously from the ACTUAL work (not exams). Reuses scorer for
 * the 3 dimensions slice 1 already covered (verification/debugging/autonomy) and
 * adds the 4 it missed (delivery/quality/context/recovery). Deterministic proxies;
 * the subjective parts (architecture relevance, handoff quality) are left for the
 * LLM judge (bucket ②) to enrich — here we compute what data can objectively show.
 */

const { scoreEvents } = require('./scorer');

const DIMENSIONS = ['delivery', 'quality', 'verification', 'debugging', 'context', 'autonomy', 'recovery'];

const CMD = {
  build: /npm run build|vite build|tsc -b|\bmake\b|cargo build|go build/,
  lint: /eslint|npm run lint|\bruff\b|flake8/,
  typecheck: /tsc(\s|$)|--noEmit|npm run typecheck|\bmypy\b/,
};

// Pair each category command with ITS OWN tool_result by tool_use_id; record the latest
// pass/fail. An interleaved Read/Grep result must not be misread as the build/test outcome.
// Falls back to order-pairing only for id-less events (older/synthetic transcripts).
function commandOutcomes(timeline, testRe) {
  const last = { test: null, build: null, lint: null, typecheck: null };
  const pendingById = new Map(); // tool_use_id -> category
  let pendingNoId = null;
  const categoryOf = (cmd) => {
    if (testRe.test(cmd)) return 'test';
    if (CMD.build.test(cmd)) return 'build';
    if (CMD.lint.test(cmd)) return 'lint';
    if (CMD.typecheck.test(cmd)) return 'typecheck';
    return null;
  };
  for (const e of timeline) {
    if (e.kind === 'tool_use' && e.tool === 'Bash' && typeof e.command === 'string') {
      const cat = categoryOf(e.command);
      if (cat) { if (e.toolUseId) pendingById.set(e.toolUseId, cat); else pendingNoId = cat; }
    } else if (e.kind === 'tool_result') {
      if (e.toolUseId && pendingById.has(e.toolUseId)) {
        last[pendingById.get(e.toolUseId)] = !e.isError;
        pendingById.delete(e.toolUseId);
      } else if (!e.toolUseId && pendingNoId) {
        last[pendingNoId] = !e.isError;
        pendingNoId = null;
      }
    }
  }
  return last;
}

function rate(good, concern) { return concern ? 'concern' : good ? 'good' : 'ok'; }
const { round } = require('./round');

/**
 * Capability metrics — RATES/RATIOS over a rolling window (not raw counts), so
 * each one means something about ABILITY (how a real programmer is judged) and
 * moves in real time. Charted on the dashboard.
 */
function computeCapability(timeline, loop, cfg) {
  const W = cfg.capWindow || 40;
  const w = timeline.slice(-W);
  const isEdit = (e) => e.kind === 'tool_use' && (e.tool === 'Edit' || e.tool === 'Write');

  const results = w.filter((e) => e.kind === 'tool_result');
  const firstPassRate = results.length ? round(results.filter((e) => !e.isError).length / results.length) : null;

  const edits = w.filter((e) => isEdit(e) && e.filePath);
  const reworkRate = edits.length ? round(1 - new Set(edits.map((e) => e.filePath)).size / edits.length) : 0;

  const gaps = [];
  for (let i = 0; i < w.length; i++) {
    if (w[i].kind === 'tool_result' && w[i].isError) {
      for (let j = i + 1; j < w.length; j++) {
        if (w[j].kind === 'tool_result' && !w[j].isError) { gaps.push(j - i); break; }
      }
    }
  }
  const recoverySteps = gaps.length ? round(gaps.reduce((a, b) => a + b, 0) / gaps.length, 1) : 0;

  const reads = w.filter((e) => e.kind === 'tool_use' && e.tool === 'Read').length;
  const editCount = w.filter(isEdit).length;
  const lookBeforeLeap = editCount ? round(Math.min(reads / editCount, 5)) : null;

  const tools = w.filter((e) => e.kind === 'tool_use').length;
  const users = w.filter((e) => e.kind === 'user').length;
  const autonomySpan = round(tools / Math.max(1, users));

  const stuckRisk = Math.min(100, (loop.sameErrorStreak || 0) * 25 + (loop.editsSinceLastGreen || 0) * 6);

  return { firstPassRate, reworkRate, recoverySteps, lookBeforeLeap, autonomySpan, stuckRisk };
}

// evaluateEvents — pure over a raw event array (a session's main timeline, OR a
// single sub-agent lane's events). evaluate(session) wraps it for back-compat.
function evaluateEvents(timeline = [], cfg = {}) {
  const s = scoreEvents(timeline, cfg); // verification / debugging(loop) / autonomy / usage / cost
  const testRe = new RegExp(cfg.testCommandPattern || 'jest|npm (run )?test|node --test|vitest|pytest');

  // --- delivery ---
  let commits = 0;
  let editsSinceCommit = 0;
  for (const e of timeline) {
    if (e.kind === 'tool_use' && e.tool === 'Bash' && /git commit/.test(e.command || '')) { commits++; editsSinceCommit = 0; }
    if (e.kind === 'tool_use' && (e.tool === 'Edit' || e.tool === 'Write')) editsSinceCommit++;
  }
  const delivery = { commits, editsSinceCommit,
    rating: rate(commits > 0, commits === 0 && editsSinceCommit > 15) };

  // --- quality ---
  const oc = commandOutcomes(timeline, testRe);
  const editedFiles = new Set();
  let editCount = 0;
  for (const e of timeline) {
    if (e.kind === 'tool_use' && (e.tool === 'Edit' || e.tool === 'Write')) {
      editCount++;
      if (e.filePath) editedFiles.add(e.filePath);
    }
  }
  const anyFailed = [oc.test, oc.build, oc.lint, oc.typecheck].some((v) => v === false);
  const anyPassed = [oc.test, oc.build, oc.lint, oc.typecheck].some((v) => v === true);
  const quality = {
    testPass: oc.test, buildPass: oc.build, lintPass: oc.lint, typecheckPass: oc.typecheck,
    filesTouched: editedFiles.size, editCount,
    rating: anyFailed || editedFiles.size > 15 ? 'concern' : anyPassed ? 'good' : 'ok',
  };

  // --- context / architecture understanding ---
  const readFiles = new Set();
  let exploreReads = 0;
  let sawEdit = false;
  for (const e of timeline) {
    if (e.kind === 'tool_use' && e.tool === 'Read') {
      if (e.filePath) readFiles.add(e.filePath);
      if (!sawEdit) exploreReads++;
    }
    if (e.kind === 'tool_use' && (e.tool === 'Edit' || e.tool === 'Write')) sawEdit = true;
  }
  const blastRadius = editedFiles.size;
  const context = { filesRead: readFiles.size, filesEdited: editedFiles.size, blastRadius, exploreReads,
    rating: rate(exploreReads > 0 && blastRadius <= 10, blastRadius > 15 || (blastRadius > 3 && exploreReads === 0)) };

  // --- recovery / memory ---
  const errors = timeline.filter((e) => e.kind === 'tool_result' && e.isError).length;
  const currentlyStuck = !!s.loop.flagged;
  const recovery = { errors, currentlyStuck, eventCount: timeline.length,
    rating: currentlyStuck ? 'concern' : errors === 0 ? 'good' : 'ok' };

  // --- reuse scorer for 3/4/6 ---
  const verification = { testsRun: s.testDiscipline.testsRun, finishWithoutTest: s.testDiscipline.finishWithoutTest,
    rating: s.testDiscipline.finishWithoutTest ? 'concern' : s.testDiscipline.testsRun > 0 ? 'good' : 'ok' };
  const debugging = { sameErrorStreak: s.loop.sameErrorStreak, editsSinceLastGreen: s.loop.editsSinceLastGreen, flagged: s.loop.flagged,
    rating: s.loop.flagged ? 'concern' : errors === 0 ? 'good' : 'ok' };
  const autonomy = { userTurns: s.autonomy.userTurns, interventions: s.autonomy.interventions, toolCallsPerUserTurn: s.autonomy.toolCallsPerUserTurn,
    rating: rate(s.autonomy.toolCallsPerUserTurn >= 4, s.autonomy.interventions > 6 && s.autonomy.toolCallsPerUserTurn < 2) };

  const dimensions = { delivery, quality, verification, debugging, context, autonomy, recovery };
  const concerns = DIMENSIONS.filter((d) => dimensions[d].rating === 'concern').length;
  const label = concerns === 0 ? 'Steady' : concerns <= 2 ? 'A few to watch' : 'Several issues';

  const capability = computeCapability(timeline, s.loop, cfg);

  return { dimensions, capability, usage: s.usage, cost: s.cost, overall: { concerns, label }, bucket: 'deterministic' };
}

function evaluate(session, cfg = {}) {
  return evaluateEvents((session && session.timeline) || [], cfg);
}

module.exports = { evaluate, evaluateEvents, DIMENSIONS };
