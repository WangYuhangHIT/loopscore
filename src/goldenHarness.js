'use strict';
/**
 * goldenHarness.js — orchestrates golden-task regression (US3 / bucket ③).
 * For each task: create an isolated git worktree at a fixed ref → (optional setup)
 * → run the agent (the REAL harness under test, via runAgent) → run the acceptance
 * command (exit 0 = pass) → ALWAYS remove the worktree → record. Tally a scorecard.
 *
 * exec(cmd, {cwd}) -> {code, stdout, stderr} and runAgent(prompt, cwd) -> {costUsd?}
 * are injected, so orchestration is fully testable without spawning Claude or git.
 */

const path = require('node:path');

async function attemptTask(task, deps) {
  const { exec, runAgent, workRoot } = deps;
  // task.id flows into a filesystem path and a shell command — keep it to a safe charset
  // so a hand-authored task file can't inject shell metacharacters via the worktree path.
  if (!/^[A-Za-z0-9_.-]+$/.test(String(task.id || ''))) {
    return { taskId: task.id, pass: false, durationMs: 0, costUsd: undefined,
      error: 'invalid task.id (allowed: letters, digits, _ . -)' };
  }
  const worktree = path.join(workRoot, task.id);
  const baseRef = task.baseRef || 'HEAD';
  const started = Date.now();
  const result = { taskId: task.id, pass: false, durationMs: 0, costUsd: undefined, error: undefined };

  try {
    await exec(`git worktree add --detach "${worktree}" ${baseRef}`);
    if (task.setup) await exec(task.setup, { cwd: worktree });
    const agentOut = await runAgent(task.prompt, worktree);
    if (agentOut && agentOut.costUsd != null) result.costUsd = agentOut.costUsd;
    const acc = await exec(task.acceptance, { cwd: worktree });
    result.pass = acc.code === 0;
  } catch (e) {
    result.pass = false;
    result.error = e && e.message ? e.message : String(e);
  } finally {
    try { await exec(`git worktree remove --force "${worktree}"`); } catch { /* best-effort cleanup */ }
    result.durationMs = Date.now() - started;
  }
  return result;
}

async function runAll(tasks, deps) {
  const results = [];
  for (const task of tasks) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await attemptTask(task, deps));
  }
  const passed = results.filter((r) => r.pass).length;
  return { total: results.length, passed, results };
}

module.exports = { attemptTask, runAll };
