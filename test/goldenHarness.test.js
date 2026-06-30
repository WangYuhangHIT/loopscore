'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { attemptTask, runAll } = require('../src/goldenHarness');

// Mock exec: records commands, returns canned exit codes keyed by a matcher.
function mockExec(plan = {}) {
  const calls = [];
  return {
    calls,
    exec: async (cmd, opts = {}) => {
      calls.push({ cmd, cwd: opts.cwd });
      for (const [needle, code] of Object.entries(plan)) {
        if (cmd.includes(needle)) return { code, stdout: '', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  };
}

const task = (over = {}) => Object.assign({
  id: 'probe-1', prompt: 'do the thing', acceptance: 'grep -q DONE out.txt', baseRef: 'HEAD',
}, over);

test('attemptTask: sets up worktree, runs agent, runs acceptance, cleans up', async () => {
  const m = mockExec();
  const agentCalls = [];
  const runAgent = async (prompt, cwd) => { agentCalls.push({ prompt, cwd }); return { costUsd: 0.01 }; };
  const r = await attemptTask(task(), { exec: m.exec, runAgent, workRoot: '/tmp/gw' });

  const cmds = m.calls.map((c) => c.cmd).join('\n');
  assert.match(cmds, /git worktree add/);
  assert.match(cmds, /grep -q DONE out\.txt/);        // acceptance ran
  assert.match(cmds, /git worktree remove/);          // cleaned up
  assert.strictEqual(agentCalls.length, 1);           // agent invoked once
  assert.strictEqual(r.pass, true);                   // acceptance exit 0 → pass
  assert.strictEqual(r.taskId, 'probe-1');
});

test('attemptTask: acceptance non-zero → pass=false', async () => {
  const m = mockExec({ 'grep -q DONE': 1 }); // acceptance fails
  const r = await attemptTask(task(), { exec: m.exec, runAgent: async () => ({}), workRoot: '/tmp/gw' });
  assert.strictEqual(r.pass, false);
});

test('attemptTask: runs optional setup before the agent', async () => {
  const m = mockExec();
  const order = [];
  const exec = async (cmd, opts) => { order.push(cmd); return m.exec(cmd, opts); };
  await attemptTask(task({ setup: 'echo prep > state' }), {
    exec, runAgent: async () => { order.push('AGENT'); return {}; }, workRoot: '/tmp/gw',
  });
  const setupIdx = order.findIndex((c) => c.includes('echo prep'));
  const agentIdx = order.indexOf('AGENT');
  assert.ok(setupIdx >= 0 && setupIdx < agentIdx, 'setup must run before agent');
});

test('attemptTask: always removes the worktree even if the agent throws', async () => {
  const m = mockExec();
  const runAgent = async () => { throw new Error('agent blew up'); };
  const r = await attemptTask(task(), { exec: m.exec, runAgent, workRoot: '/tmp/gw' });
  assert.strictEqual(r.pass, false);
  assert.match(r.error || '', /blew up/);
  assert.match(m.calls.map((c) => c.cmd).join('\n'), /git worktree remove/); // cleanup still ran
});

test('runAll: tallies a scorecard across tasks', async () => {
  const exec = async (cmd) => ({ code: cmd.includes('FAILME') ? 1 : 0, stdout: '', stderr: '' });
  const tasks = [task({ id: 'a' }), task({ id: 'b', acceptance: 'FAILME' }), task({ id: 'c' })];
  const card = await runAll(tasks, { exec, runAgent: async () => ({}), workRoot: '/tmp/gw' });
  assert.strictEqual(card.total, 3);
  assert.strictEqual(card.passed, 2);
  assert.strictEqual(card.results.length, 3);
  assert.strictEqual(card.results.find((r) => r.taskId === 'b').pass, false);
});
