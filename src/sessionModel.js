'use strict';
/**
 * sessionModel.js — in-memory state: sessionId -> session.
 *
 * Holds the timeline (bounded) and lane assignment (main vs sidechain). Status
 * (live/idle) is computed on demand against a caller-supplied `now` so it stays
 * pure/testable. Scoring lives in scorer.js (this module just stores facts).
 *
 *   createModel({ idleSeconds, timelineCap }) ->
 *     { applyEvent, getSnapshot, getSession, subscribe }
 */

const path = require('node:path');
const { classify, roleFromFacets, FACETS } = require('./roleClassifier');
const { roleOverlay } = require('./roleMetrics');
const { teamMetrics } = require('./teamMetrics');

function createModel(opts = {}) {
  const idleSeconds = opts.idleSeconds != null ? opts.idleSeconds : 60;
  const timelineCap = opts.timelineCap != null ? opts.timelineCap : 5000;
  const laneCap = opts.laneCap != null ? opts.laneCap : 200; // events kept per sub-agent lane
  const agentFeedCap = opts.agentFeedCap != null ? opts.agentFeedCap : 400; // interleaved team activity
  const agentsShown = opts.agentsShown != null ? opts.agentsShown : 16; // most-recent agents in a summary
  // Optional evaluator hook (US-003): when injected, each snapshot summary is
  // enriched with the 7-dim evaluation, capability ratios, usage/cost and token
  // totals so the multi-agent dashboard renders without a per-session round-trip.
  // Kept optional so unit tests that exercise raw model behavior do not pay the
  // cost and stay independent of scorer/evaluator shape changes.
  const evaluator = typeof opts.evaluate === 'function' ? opts.evaluate : null;
  // Per-lane evaluator (Phase 2): scores each sub-agent on its OWN events so the
  // team view shows every member's core 7-dim + capability ratios. Optional/injected
  // for the same reason as `evaluate` — raw-model unit tests stay cheap & decoupled.
  const evaluateEvents = typeof opts.evaluateEvents === 'function' ? opts.evaluateEvents : null;
  const evalCfg = opts.evalCfg || {};
  const teamIntervalMs = opts.teamIntervalMs != null ? opts.teamIntervalMs : 2000; // throttle the all-lanes team scan
  const sessions = new Map();
  const subscribers = new Set();

  // A sub-agent (Task/Agent tool, or a workflow agent) runs in its own transcript and
  // carries a stable agentId; give each one its own lane. Everything else is the main
  // conversation. The legacy aggregate 'sidechain' bucket only appears for synthetic
  // events that flag sidechain without an agentId.
  function laneKey(ev) {
    if (ev.agentId) return 'agent:' + ev.agentId;
    return ev.lane === 'sidechain' ? 'sidechain' : 'main';
  }

  function getOrCreate(id) {
    let s = sessions.get(id);
    if (!s) {
      const main = { id: 'main', agentId: null, agentType: null, events: [], lastTsMs: null };
      s = {
        sessionId: id,
        project: undefined,
        gitBranch: undefined,
        firstTsMs: null,
        lastTsMs: null,
        lanes: { main },
        timeline: main.events, // MAIN-session events only — same array as the main lane (no 2× copy)
        agentFeed: [],  // interleaved recent sub-agent events for the team stream
      };
      sessions.set(id, s);
    }
    return s;
  }

  function applyEvent(ev) {
    if (!ev || !ev.sessionId) return;
    const s = getOrCreate(ev.sessionId);
    const tsMs = ev.ts ? Date.parse(ev.ts) : null;
    if (tsMs != null && !Number.isNaN(tsMs)) {
      if (s.firstTsMs == null) s.firstTsMs = tsMs;
      s.lastTsMs = tsMs;
    }
    if (ev.gitBranch) s.gitBranch = ev.gitBranch;
    if (ev.cwd) s.project = ev.cwd;
    if (ev.projectId && !s.projectId) s.projectId = ev.projectId;
    if (ev.cwd) s.projectPath = ev.cwd;

    const lk = laneKey(ev);
    let lane = s.lanes[lk];
    if (!lane) { lane = { id: lk, agentId: ev.agentId || null, agentType: null, events: [], lastTsMs: null }; s.lanes[lk] = lane; }
    if (ev.agentType && !lane.agentType) lane.agentType = ev.agentType;
    if (tsMs != null && !Number.isNaN(tsMs)) lane.lastTsMs = tsMs;
    lane.events.push(ev);
    lane.lastEvent = ev;
    const cap = lk === 'main' ? timelineCap : laneCap;
    if (lane.events.length > cap) lane.events.shift();

    // Main events already populate s.timeline (it aliases the main lane's events array,
    // pushed + capped above) — that is the purification guarantee the evaluator relies on.
    // Only the cross-agent team feed needs a separate copy here.
    if (lk !== 'main' && ev.agentId) {
      s.agentFeed.push(ev);
      if (s.agentFeed.length > agentFeedCap) s.agentFeed.shift();
    }

    for (const cb of subscribers) {
      try { cb(ev, s); } catch { /* subscriber error must not break ingestion */ }
    }
  }

  function statusOf(s, now) {
    if (s.lastTsMs == null) return 'idle';
    return now - s.lastTsMs <= idleSeconds * 1000 ? 'live' : 'idle';
  }

  function laneStatus(lane, now) {
    if (lane.lastTsMs == null) return 'idle';
    return now - lane.lastTsMs <= idleSeconds * 1000 ? 'live' : 'idle';
  }

  // Role fingerprint: take the lane's first user text as the prompt + all its events.
  // Cache on lane.role and only recompute once the event count doubles (cheap; role
  // converges with activity).
  function laneRole(lane) {
    // priority: manual override (locked) > LLM fallback (roleRunner) > fingerprint
    if (lane.roleOverride) return lane.roleOverride;
    const n = lane.events.length;
    if (!(lane._fp && lane._fpAtN && n < lane._fpAtN * 2)) {
      const firstUser = lane.events.find((e) => e.kind === 'user' && e.textSnippet);
      lane._fp = classify(lane.events, firstUser ? firstUser.textSnippet : '');
      lane._fpAtN = n;
    }
    return lane.roleLLM || lane._fp;
  }

  // Per-lane core evaluation (Phase 2). Cached on the lane keyed by event count so a
  // re-summarize without new events is free. Only the sliced (<=agentsShown) lanes are
  // evaluated per call, so cost stays bounded even with hundreds of sub-agents.
  function laneEval(lane) {
    if (!evaluateEvents) return undefined;
    const n = lane.events.length;
    if (lane._eval && lane._evalAtN === n) return lane._eval;
    const ev = evaluateEvents(lane.events, evalCfg);
    // Phase 3: attach role-specific overlay dims (composite = facet union) using the
    // lane's classified facets, scored on the lane's own events.
    const r = laneRole(lane);
    if (r && r.facets && r.facets.length) ev.roleOverlay = roleOverlay(r.facets, lane.events);
    lane._eval = ev;
    lane._evalAtN = n;
    return lane._eval;
  }

  // Compact per-sub-agent roll-up for the dashboard's team view: recent-first, capped.
  function agentSummaries(s, now) {
    const lanes = Object.values(s.lanes).filter((l) => l.agentId);
    lanes.sort((a, b) => (b.lastTsMs || 0) - (a.lastTsMs || 0));
    const live = lanes.filter((l) => laneStatus(l, now) === 'live').length;
    const agents = lanes.slice(0, agentsShown).map((l) => ({
      agentId: l.agentId,
      agentType: l.agentType,
      status: laneStatus(l, now),
      lastTs: l.lastTsMs,
      eventCount: l.events.length,
      last: l.lastEvent || null,
      role: laneRole(l),
      evaluation: laneEval(l),
    }));
    return { agents, agentTotal: lanes.length, agentsLive: live };
  }

  function summarize(s, now) {
    const a = agentSummaries(s, now);
    const base = {
      sessionId: s.sessionId,
      projectId: s.projectId || null,
      gitBranch: s.gitBranch,
      project: s.project,
      status: statusOf(s, now),
      lastTs: s.lastTsMs,
      laneCount: Object.keys(s.lanes).length,
      eventCount: s.timeline.length,
      agents: a.agents,
      agentTotal: a.agentTotal,
      agentsLive: a.agentsLive,
      mainRole: laneRole(s.lanes.main),
    };
    if (evaluator) {
      // `evaluator` reads s.timeline which is main-conversation-only (sub-agent
      // events live in s.agentFeed / s.lanes['agent:*']). That is the existing
      // purification guarantee — DO NOT pass s.lanes here or you'll wreck per
      // session capability ratios.
      const evalResult = evaluator(s, evalCfg);
      // Phase 3: main session overlay from its classified facets (often pm/fullstack),
      // scored on the main-only timeline (purification preserved).
      const mr = base.mainRole;
      if (mr && mr.facets && mr.facets.length) evalResult.roleOverlay = roleOverlay(mr.facets, s.timeline);
      base.evaluation = evalResult;
      const c = evalResult.cost || {};
      const inputTokens = c.inputTokens || 0;
      const outputTokens = c.outputTokens || 0;
      const cacheReadTokens = c.cacheReadTokens || 0;
      const cacheCreationTokens = c.cacheCreationTokens || 0;
      // total includes cached input (a large share of real usage) so the dashboard figure
      // isn't silently low; input/output remain the non-cache split.
      base.tokens = { input: inputTokens, output: outputTokens,
        cacheRead: cacheReadTokens, cacheCreation: cacheCreationTokens,
        total: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens };
    }
    // Team rollup (Phase 4): role coverage / parallelism / collaboration across ALL lanes
    // (main + sub-agents). Scanning every lane's events is the one O(total-events) step, so
    // it's time-throttled (recompute at most once per teamIntervalMs) and cached — a 500-agent
    // session would otherwise pay it on every broadcast. Roles via the cheap cached laneRole;
    // member-concern rollup uses only already-computed evals (sliced lanes).
    if (s._team && s._teamAt != null && now - s._teamAt < teamIntervalMs) {
      base.team = s._team;
    } else {
      const memberLanes = Object.values(s.lanes).map((l) => ({
        id: l.id, agentId: l.agentId, role: laneRole(l), events: l.events, evaluation: l._eval,
      }));
      s._team = teamMetrics(memberLanes);
      s._teamAt = now;
      base.team = s._team;
    }
    return base;
  }

  function getSnapshot(now) {
    const list = [];
    for (const s of sessions.values()) list.push(summarize(s, now));
    // most-recently-active first
    list.sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
    // project rollup: group sessions by projectId; name/path from the session's cwd
    // (accurate, unlike the lossy dir-name encoding).
    const byProject = new Map();
    for (const s of sessions.values()) {
      const pid = s.projectId || 'unknown';
      let p = byProject.get(pid);
      if (!p) {
        p = { projectId: pid, name: s.projectPath ? path.basename(s.projectPath) : pid,
          path: s.projectPath || null, sessions: 0, live: 0, lastTs: null };
        byProject.set(pid, p);
      }
      p.sessions += 1;
      if (statusOf(s, now) === 'live') p.live += 1;
      if (s.lastTsMs != null && (p.lastTs == null || s.lastTsMs > p.lastTs)) p.lastTs = s.lastTsMs;
    }
    const projects = [...byProject.values()].sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
    return { sessions: list, projects };
  }

  function getSession(id, now) {
    const s = sessions.get(id);
    if (!s) return null;
    return Object.assign({}, s, { status: statusOf(s, now) }, agentSummaries(s, now));
  }

  function subscribe(cb) {
    subscribers.add(cb);
    return () => subscribers.delete(cb);
  }

  // Manual role override (Phase 4, design §4.2 "manual selection"): highest priority, locked.
  // agentId 'main' targets the main lane; empty facets clears the override (revert to auto).
  // Returns the override object, { cleared:true }, or null (unknown session/lane / invalid facets).
  function setRoleOverride(sessionId, agentId, facets) {
    const s = sessions.get(sessionId);
    if (!s) return null;
    const key = agentId === 'main' ? 'main' : 'agent:' + agentId;
    const lane = s.lanes[key];
    if (!lane) return null;
    if (facets != null && !Array.isArray(facets)) return null; // invalid (e.g. a string) → 404, never crash on .filter
    if (!facets || !facets.length) { delete lane.roleOverride; return { cleared: true }; }
    const valid = facets.filter((f) => FACETS.includes(f));
    if (!valid.length) return null;
    lane.roleOverride = { role: roleFromFacets(valid), facets: valid, confidence: 1, source: 'manual', locked: true };
    return lane.roleOverride;
  }

  return { applyEvent, getSnapshot, getSession, subscribe, setRoleOverride };
}

module.exports = { createModel };
