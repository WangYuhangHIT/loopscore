#!/usr/bin/env node
'use strict';
/**
 * Golden-task regression runner (US3 / bucket ③).
 *   node loopscore/golden/run.js
 * Runs every task in loopscore/golden/tasks/*.json through the REAL harness
 * (claude -p in an isolated worktree), checks acceptance, prints a scorecard,
 * and appends a timestamped result file under loopscore/golden/results/.
 *
 * ⚠️ Spends real Anthropic/Max quota — one full Claude Code run per task.
 */

const fs = require('node:fs');
const path = require('node:path');
const { runAll } = require('../src/goldenHarness');
const { realExec, realRunAgent } = require('../src/goldenRunner');

const DIR = __dirname;
const TASKS_DIR = path.join(DIR, 'tasks');
const WORK_ROOT = path.join(DIR, '.work');
const RESULTS_DIR = path.join(DIR, 'results');

function loadConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(DIR, '..', 'loopscore.config.json'), 'utf8'));
    return cfg.golden || {};
  } catch { return {}; }
}

function loadTasks() {
  if (!fs.existsSync(TASKS_DIR)) return [];
  return fs.readdirSync(TASKS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(TASKS_DIR, f), 'utf8')));
}

async function main() {
  const golden = loadConfig();
  const tasks = loadTasks();
  if (!tasks.length) { console.error('No golden tasks (loopscore/golden/tasks/*.json)'); process.exit(1); }
  fs.mkdirSync(WORK_ROOT, { recursive: true });

  console.log(`Running ${tasks.length} golden tasks (real claude -p, mode=${golden.permissionMode || 'acceptEdits'}` +
    `${golden.maxBudgetUsd ? `, budget cap $${golden.maxBudgetUsd}/task` : ''})…\n`);

  const card = await runAll(tasks, {
    exec: realExec,
    runAgent: (prompt, cwd) => realRunAgent(prompt, cwd, golden),
    workRoot: WORK_ROOT,
  });

  console.log('\n=== Scorecard ===');
  for (const r of card.results) {
    const cost = r.costUsd != null ? ` $${r.costUsd.toFixed(4)}` : '';
    console.log(`  ${r.pass ? '✅' : '❌'} ${r.taskId}  (${Math.round(r.durationMs / 1000)}s${cost})${r.error ? ' — ' + r.error : ''}`);
  }
  console.log(`\nPassed ${card.passed}/${card.total}`);

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.join(RESULTS_DIR, `${stamp}.json`);
  fs.writeFileSync(out, JSON.stringify({ at: stamp, ...card }, null, 2));
  console.log(`Results saved to ${path.relative(process.cwd(), out)}`);
}

main().catch((e) => { console.error('harness failed:', e); process.exit(1); });
