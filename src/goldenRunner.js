'use strict';
/**
 * goldenRunner.js — real implementations injected into goldenHarness:
 *   realExec(cmd,{cwd})         — run a shell command, resolve {code,stdout,stderr}
 *                                  (never rejects on non-zero exit; code is captured)
 *   realRunAgent(prompt,cwd,cfg)— run the REAL harness under test: `claude -p` headless
 *                                  in the worktree, WITHOUT --bare (so hooks / CLAUDE.md /
 *                                  skills — the whole system — are exercised; decision A).
 */

const { exec, spawn } = require('node:child_process');

function realExec(cmd, opts = {}) {
  return new Promise((resolve) => {
    exec(cmd, { cwd: opts.cwd, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code || 1) : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function realRunAgent(prompt, cwd, cfg = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-p',
      '--permission-mode', cfg.permissionMode || 'acceptEdits',
      '--output-format', 'json'];
    if (cfg.maxBudgetUsd) args.push('--max-budget-usd', String(cfg.maxBudgetUsd));
    if (cfg.model) args.push('--model', cfg.model);
    const child = spawn('claude', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let errout = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { errout += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      let costUsd;
      try { costUsd = JSON.parse(out).total_cost_usd; } catch { /* non-json or partial */ }
      resolve({ costUsd, exitCode: code, raw: (out || errout).slice(0, 2000) });
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

module.exports = { realExec, realRunAgent };
