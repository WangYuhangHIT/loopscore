'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createModel } = require('../src/sessionModel');
const { evaluate, evaluateEvents, DIMENSIONS } = require('../src/evaluator');

function ev(over = {}) {
  return Object.assign({
    ts: '2026-06-13T12:00:00Z', sessionId: 's1', lane: 'main', kind: 'user', uuid: 'u',
  }, over);
}

test('applyEvent: creates a session and lists it in snapshot', () => {
  const m = createModel();
  m.applyEvent(ev({ kind: 'user' }));
  const snap = m.getSnapshot(Date.parse('2026-06-13T12:00:01Z'));
  assert.strictEqual(snap.sessions.length, 1);
  assert.strictEqual(snap.sessions[0].sessionId, 's1');
});

test('applyEvent: ignores events without a sessionId', () => {
  const m = createModel();
  m.applyEvent({ kind: 'user' });
  m.applyEvent(null);
  assert.strictEqual(m.getSnapshot(0).sessions.length, 0);
});

test('lanes: main vs sidechain events land in separate lanes', () => {
  const m = createModel();
  m.applyEvent(ev({ lane: 'main', uuid: 'a' }));
  m.applyEvent(ev({ lane: 'sidechain', uuid: 'b' }));
  const s = m.getSession('s1', Date.parse('2026-06-13T12:00:01Z'));
  assert.strictEqual(s.lanes.main.events.length, 1);
  assert.ok(s.lanes.sidechain);
  assert.strictEqual(s.lanes.sidechain.events.length, 1);
});

test('agent lane: events with agentId get their own agent:<id> lane + agentType', () => {
  const m = createModel();
  m.applyEvent(ev({ lane: 'sidechain', agentId: 'abc123', agentType: 'general-purpose', uuid: 'a', kind: 'tool_use', tool: 'Read' }));
  const s = m.getSession('s1', Date.parse('2026-06-13T12:00:01Z'));
  assert.ok(s.lanes['agent:abc123'], 'per-agent lane exists');
  assert.strictEqual(s.lanes['agent:abc123'].agentType, 'general-purpose');
  assert.strictEqual(s.lanes['agent:abc123'].events.length, 1);
  assert.ok(!s.lanes.sidechain, 'not collapsed into aggregate sidechain');
});

test('timeline: main-only — sub-agent events are excluded from s.timeline (scoring stays clean)', () => {
  const m = createModel();
  m.applyEvent(ev({ uuid: 'm1', kind: 'user' }));
  m.applyEvent(ev({ uuid: 'a1', agentId: 'abc', kind: 'tool_use', tool: 'Bash' }));
  m.applyEvent(ev({ uuid: 'm2', kind: 'tool_use', tool: 'Read' }));
  const s = m.getSession('s1', 0);
  assert.strictEqual(s.timeline.length, 2, 'only the 2 main events');
  assert.ok(s.timeline.every((e) => !e.agentId));
});

test('agentFeed: sub-agent events collected (bounded) for the combined team stream', () => {
  const m = createModel({ agentFeedCap: 3 });
  for (let i = 0; i < 5; i++) m.applyEvent(ev({ uuid: 'a' + i, agentId: 'x', kind: 'tool_use', tool: 'Read' }));
  const s = m.getSession('s1', 0);
  assert.strictEqual(s.agentFeed.length, 3, 'capped, oldest dropped');
});

test('snapshot summary: agents[] + agentTotal + agentsLive with per-agent status', () => {
  const m = createModel({ idleSeconds: 60 });
  m.applyEvent(ev({ ts: '2026-06-13T12:00:00Z', agentId: 'fresh', agentType: 'Explore', uuid: 'f', kind: 'tool_use', tool: 'Read' }));
  m.applyEvent(ev({ ts: '2026-06-13T11:00:00Z', agentId: 'stale', agentType: 'general-purpose', uuid: 's', kind: 'tool_use', tool: 'Bash' }));
  const now = Date.parse('2026-06-13T12:00:30Z');
  const sm = m.getSnapshot(now).sessions[0];
  assert.strictEqual(sm.agentTotal, 2);
  assert.strictEqual(sm.agentsLive, 1, 'only the fresh one is live');
  assert.ok(Array.isArray(sm.agents));
  assert.strictEqual(sm.agents[0].agentId, 'fresh', 'recent-first');
  assert.strictEqual(sm.agents[0].status, 'live');
  assert.strictEqual(sm.agents[0].agentType, 'Explore');
  assert.ok(sm.agents[0].last, 'carries last activity for the chip');
});

test('timeline: accumulates events in order', () => {
  const m = createModel();
  m.applyEvent(ev({ uuid: 'a', kind: 'user' }));
  m.applyEvent(ev({ uuid: 'b', kind: 'tool_use', tool: 'Bash' }));
  const s = m.getSession('s1', 0);
  assert.strictEqual(s.timeline.length, 2);
  assert.strictEqual(s.timeline[1].tool, 'Bash');
});

test('timeline: capped at timelineCap (drops oldest)', () => {
  const m = createModel({ timelineCap: 3 });
  for (let i = 0; i < 5; i++) m.applyEvent(ev({ uuid: String(i) }));
  const s = m.getSession('s1', 0);
  assert.strictEqual(s.timeline.length, 3);
  assert.strictEqual(s.timeline[0].uuid, '2'); // oldest two dropped
});

test('status: live within idleSeconds, idle beyond', () => {
  const m = createModel({ idleSeconds: 60 });
  m.applyEvent(ev({ ts: '2026-06-13T12:00:00Z' }));
  const last = Date.parse('2026-06-13T12:00:00Z');
  assert.strictEqual(m.getSnapshot(last + 30 * 1000).sessions[0].status, 'live');
  assert.strictEqual(m.getSnapshot(last + 120 * 1000).sessions[0].status, 'idle');
});

test('subscribe: callback fires on each applyEvent with (event, session)', () => {
  const m = createModel();
  const got = [];
  const off = m.subscribe((e, s) => got.push({ e, sid: s.sessionId }));
  m.applyEvent(ev({ uuid: 'a' }));
  m.applyEvent(ev({ uuid: 'b' }));
  assert.strictEqual(got.length, 2);
  assert.strictEqual(got[0].sid, 's1');
  off();
  m.applyEvent(ev({ uuid: 'c' }));
  assert.strictEqual(got.length, 2); // unsubscribed
});

test('gitBranch/lastTs tracked from latest event', () => {
  const m = createModel();
  m.applyEvent(ev({ ts: '2026-06-13T12:00:00Z', gitBranch: 'main' }));
  m.applyEvent(ev({ ts: '2026-06-13T12:05:00Z', gitBranch: '010-loopscore-monitoring' }));
  const snap = m.getSnapshot(Date.parse('2026-06-13T12:05:01Z'));
  assert.strictEqual(snap.sessions[0].gitBranch, '010-loopscore-monitoring');
});

// --- US-003: snapshot carries per-session evaluation + capability + token + score ---

test('snapshot: when an evaluator is injected, each session summary carries dimensions / capability / usage / cost / overall + tokens', () => {
  const m = createModel({ idleSeconds: 60, evaluate, evalCfg: {} });
  // session A: main test command + green result + usage tokens on the tool_use
  m.applyEvent(ev({
    sessionId: 'A', ts: '2026-06-13T12:00:00Z', gitBranch: 'feat/a', kind: 'user', uuid: 'a1',
  }));
  m.applyEvent(ev({
    sessionId: 'A', ts: '2026-06-13T12:00:01Z', kind: 'tool_use', tool: 'Bash',
    command: 'npm test', uuid: 'a2',
    usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 200, cacheCreationTokens: 20 },
  }));
  m.applyEvent(ev({
    sessionId: 'A', ts: '2026-06-13T12:00:02Z', kind: 'tool_result', isError: false, uuid: 'a3',
  }));
  // session B: a single main user event + one sub-agent tool_use
  m.applyEvent(ev({
    sessionId: 'B', ts: '2026-06-13T12:00:00Z', gitBranch: 'feat/b', kind: 'user', uuid: 'b1',
  }));
  m.applyEvent(ev({
    sessionId: 'B', ts: '2026-06-13T12:00:02Z', agentId: 'x', agentType: 'general-purpose',
    kind: 'tool_use', tool: 'Read', uuid: 'b2', usage: { inputTokens: 10, outputTokens: 5 },
  }));

  const snap = m.getSnapshot(Date.parse('2026-06-13T12:00:30Z'));
  assert.strictEqual(snap.sessions.length, 2);

  const a = snap.sessions.find((x) => x.sessionId === 'A');
  // 7-dim evaluation present
  assert.ok(a.evaluation, 'evaluation present');
  for (const k of DIMENSIONS) {
    assert.ok(a.evaluation.dimensions[k], `missing dim: ${k}`);
    assert.ok(['good', 'ok', 'concern'].includes(a.evaluation.dimensions[k].rating));
  }
  assert.ok(a.evaluation.overall && typeof a.evaluation.overall.concerns === 'number');
  // capability ratios live inside evaluation (and we also expose at top-level for convenience)
  assert.ok(a.evaluation.capability && 'firstPassRate' in a.evaluation.capability);
  // bucket① process metrics surfaced via evaluation.usage / cost (token + skill/hook/mcp breakdown)
  assert.ok(a.evaluation.usage);
  assert.ok(a.evaluation.cost);
  // tokens convenience shape — main timeline only; total now includes cached input
  // (cacheRead 200 + cacheCreation 20) so the dashboard figure isn't silently low.
  assert.deepStrictEqual(a.tokens, { input: 100, output: 50, cacheRead: 200, cacheCreation: 20, total: 370 });
  // existing summary fields preserved
  assert.ok('gitBranch' in a);
  assert.strictEqual(a.gitBranch, 'feat/a');
  assert.ok(['live', 'idle'].includes(a.status));
  assert.ok('agentTotal' in a && 'agentsLive' in a);

  // session B: has 1 sub-agent and the sub-agent token must NOT roll into main tokens
  const b = snap.sessions.find((x) => x.sessionId === 'B');
  assert.strictEqual(b.agentTotal, 1);
  assert.deepStrictEqual(b.tokens, { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 });
});

test('snapshot: omits evaluation/tokens when no evaluator is injected (back-compat for tests/clients that do not care)', () => {
  const m = createModel();
  m.applyEvent(ev({ uuid: 'a' }));
  const sm = m.getSnapshot(Date.parse('2026-06-13T12:00:01Z')).sessions[0];
  assert.strictEqual(sm.evaluation, undefined);
  assert.strictEqual(sm.tokens, undefined);
  // original shape still intact
  assert.strictEqual(sm.sessionId, 's1');
  assert.ok('status' in sm);
});

test('snapshot evaluation: main scoring stays clean — sub-agent error streak does NOT flag main session loop', () => {
  const m = createModel({ evaluate, evalCfg: { loopErrorStreak: 3 } });
  // One main user event (no edits, no errors on the main timeline)
  m.applyEvent(ev({ sessionId: 's1', ts: '2026-06-13T12:00:00Z', kind: 'user', uuid: 'm1' }));
  // Five sub-agent error results with identical signature — would flag the loop if mixed in
  for (let i = 0; i < 5; i++) {
    m.applyEvent(ev({
      sessionId: 's1', ts: `2026-06-13T12:00:0${i + 1}Z`, agentId: 'x',
      kind: 'tool_result', isError: true, errorSig: 'sig:E', uuid: `a${i}`,
    }));
  }
  const sm = m.getSnapshot(Date.parse('2026-06-13T12:00:30Z')).sessions[0];
  assert.strictEqual(sm.evaluation.dimensions.debugging.flagged, false,
    'sub-agent error streak must not propagate into the main session debugging.flagged');
  assert.strictEqual(sm.evaluation.dimensions.debugging.sameErrorStreak, 0);
});

test('role: sub-agent lane classifies its role, agentSummaries exposes role', () => {
  const m = createModel();
  // a backend sub-agent: first user (task prompt) + edits an api file
  m.applyEvent(ev({ agentId: 'be1', agentType: 'general-purpose', kind: 'user', uuid: 'p',
    textSnippet: 'implement the orders API endpoint' }));
  m.applyEvent(ev({ agentId: 'be1', kind: 'tool_use', tool: 'Edit', uuid: 'e1',
    filePath: 'backend/src/api/orders.js', textSnippet: 'router.post' }));
  const s = m.getSession('s1', Date.parse('2026-06-13T12:00:01Z'));
  const a = s.agents.find((x) => x.agentId === 'be1');
  assert.ok(a.role, 'agent summary carries role');
  assert.strictEqual(a.role.role, 'backend');
});

test('eval: sub-agent lane gets its own evaluation when evaluateEvents injected', () => {
  const m = createModel({ evaluateEvents });
  m.applyEvent(ev({ agentId: 'be1', kind: 'tool_use', tool: 'Bash', command: 'npm test', uuid: 'c' }));
  m.applyEvent(ev({ agentId: 'be1', kind: 'tool_result', isError: false, uuid: 'r' }));
  const s = m.getSession('s1', Date.parse('2026-06-13T12:00:01Z'));
  const a = s.agents.find((x) => x.agentId === 'be1');
  assert.ok(a.evaluation, 'agent summary carries its own evaluation');
  assert.ok(a.evaluation.dimensions.verification, '7-dim present on sub-agent eval');
  assert.ok(a.evaluation.capability, 'capability ratios present on sub-agent eval');
});

test('projects: session carries projectId; getSnapshot gives a projects rollup', () => {
  const m = createModel();
  m.applyEvent(ev({ sessionId: 'a', projectId: 'P1', cwd: '/Users/u/sample-app', kind: 'user', uuid: '1' }));
  m.applyEvent(ev({ sessionId: 'b', projectId: 'P2', cwd: '/Users/u/crm-demo', kind: 'user', uuid: '2' }));
  const snap = m.getSnapshot(Date.parse('2026-06-13T12:00:01Z'));
  assert.strictEqual(snap.sessions.find((s) => s.sessionId === 'a').projectId, 'P1');
  assert.ok(Array.isArray(snap.projects));
  const p1 = snap.projects.find((p) => p.projectId === 'P1');
  assert.ok(p1);
  assert.strictEqual(p1.sessions, 1);
  assert.strictEqual(p1.name, 'sample-app'); // accurate name from cwd basename
});

test('manual override: setRoleOverride locks a lane role; clearing reverts to auto', () => {
  const m = createModel();
  m.applyEvent(ev({ agentId: 'x', kind: 'tool_use', tool: 'Edit', uuid: 'e', filePath: 'a.test.js', textSnippet: 'expect(' }));
  const ok = m.setRoleOverride('s1', 'x', ['pm']);
  assert.ok(ok && ok.source === 'manual');
  const a = m.getSession('s1', Date.parse('2026-06-13T12:00:01Z')).agents.find((z) => z.agentId === 'x');
  assert.strictEqual(a.role.role, 'pm');
  assert.strictEqual(a.role.source, 'manual');
  // clear → reverts to auto (fingerprint)
  m.setRoleOverride('s1', 'x', []);
  const a2 = m.getSession('s1', Date.parse('2026-06-13T12:00:01Z')).agents.find((z) => z.agentId === 'x');
  assert.notStrictEqual(a2.role.source, 'manual');
});

test('manual override: unknown session/lane → null, invalid facets → null', () => {
  const m = createModel();
  m.applyEvent(ev({ agentId: 'x', kind: 'tool_use', tool: 'Edit', uuid: 'e', filePath: 'a.js' }));
  assert.strictEqual(m.setRoleOverride('nope', 'x', ['pm']), null);
  assert.strictEqual(m.setRoleOverride('s1', 'ghost', ['pm']), null);
  assert.strictEqual(m.setRoleOverride('s1', 'x', ['nonsense']), null);
});

test('team: snapshot summary carries a team rollup (RoleCoverage / Parallelism / Collaboration)', () => {
  const m = createModel({ evaluate, evaluateEvents });
  m.applyEvent(ev({ kind: 'tool_use', tool: 'Task', uuid: 'm1', textSnippet: 'delegate to backend-eng' }));
  m.applyEvent(ev({ agentId: 'be1', kind: 'tool_use', tool: 'Edit', uuid: 'e1', filePath: 'backend/src/api/x.js', textSnippet: 'router.post' }));
  const sm = m.getSnapshot(Date.parse('2026-06-13T12:00:01Z')).sessions[0];
  assert.ok(sm.team, 'session summary carries team rollup');
  assert.ok(sm.team.RoleCoverage, 'RoleCoverage present');
  assert.ok(sm.team.Parallelism && sm.team.CollaborationHealth);
  assert.ok(sm.team.RoleCoverage.value.covered.includes('backend'), 'covered facets union includes backend');
});

test('roleOverlay: sub-agent evaluation carries role-specific overlay dims', () => {
  const m = createModel({ evaluateEvents });
  m.applyEvent(ev({ agentId: 'be1', kind: 'user', uuid: 'p', textSnippet: 'implement the orders API endpoint' }));
  m.applyEvent(ev({ agentId: 'be1', kind: 'tool_use', tool: 'Edit', uuid: 'e1',
    filePath: 'backend/src/api/orders.js', textSnippet: 'router.post' }));
  const s = m.getSession('s1', Date.parse('2026-06-13T12:00:01Z'));
  const a = s.agents.find((x) => x.agentId === 'be1');
  assert.ok(a.evaluation.roleOverlay, 'overlay attached to sub-agent eval');
  assert.ok(a.evaluation.roleOverlay.backend, 'backend facet dims present in overlay');
  assert.ok(a.evaluation.roleOverlay.backend.ReliabilityEng, 'a backend dim is present');
});

test('eval: agent evaluation omitted when evaluateEvents not injected (back-compat)', () => {
  const m = createModel();
  m.applyEvent(ev({ agentId: 'be1', kind: 'tool_use', tool: 'Read', uuid: 'x' }));
  const a = m.getSession('s1', Date.parse('2026-06-13T12:00:01Z')).agents[0];
  assert.strictEqual(a.evaluation, undefined);
});
