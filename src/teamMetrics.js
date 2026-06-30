'use strict';
/**
 * teamMetrics.js — Session = team rollup (design §6). PURE over the session's lanes
 * (main + agent:<id>), each lane carrying { role, events, evaluation? }. Computes
 * team-level signals ON TOP of the per-member scores: does the team cover the right
 * facets, how parallel was it, how healthy was the coordination, and an aggregate
 * concern level. Zero-dep.
 *
 *   teamMetrics(lanes, opts) -> { RoleCoverage, Parallelism, CollaborationHealth,
 *                                 memberCount, teamConcerns }
 */

const SPAWN_TOOLS = new Set(['Task', 'Agent', 'Workflow']);
const { round } = require('./round');
const rate = (good, concern) => (concern ? 'concern' : good ? 'good' : 'ok');

function teamMetrics(lanes, opts = {}) {
  const windowMs = opts.windowMs || 60000; // "concurrently active" window for parallelism
  const all = lanes || [];
  const subLanes = all.filter((l) => l.agentId);

  // --- RoleCoverage: union of every member's facets; flag if code is being written
  //     but nobody is on the test facet (a real team gap). ---
  const facetSet = new Set();
  for (const l of all) for (const f of (l.role && l.role.facets) || []) facetSet.add(f);
  const covered = [...facetSet];
  const hasTest = facetSet.has('test');
  const teamEdited = all.some((l) => (l.events || []).some((e) => e.kind === 'tool_use' && (e.tool === 'Edit' || e.tool === 'Write')));

  // --- Parallelism: peak number of distinct sub-agents active within a sliding window. ---
  const stamped = [];
  for (const l of subLanes) {
    for (const e of l.events || []) {
      const t = e.ts ? Date.parse(e.ts) : null;
      if (t != null && !Number.isNaN(t)) stamped.push({ t, id: l.agentId });
    }
  }
  stamped.sort((a, b) => a.t - b.t);
  // Two-pointer sliding window with a per-id multiset → O(n) (not O(n²)); on huge teams
  // (500 sub-agents × capped events) the naive nested scan was a real latency landmine.
  let peak = 0, left = 0;
  const counts = new Map();
  for (let right = 0; right < stamped.length; right++) {
    const id = stamped[right].id;
    counts.set(id, (counts.get(id) || 0) + 1);
    while (stamped[right].t - stamped[left].t > windowMs) {
      const lid = stamped[left].id;
      const c = (counts.get(lid) || 0) - 1;
      if (c <= 0) counts.delete(lid); else counts.set(lid, c);
      left++;
    }
    if (counts.size > peak) peak = counts.size;
  }

  // --- CollaborationHealth: SendMessage volume + delegation spawns across the team. ---
  let sendMessages = 0, spawns = 0;
  for (const l of all) {
    for (const e of l.events || []) {
      if (e.kind !== 'tool_use') continue;
      if (e.tool === 'SendMessage') sendMessages++;
      if (e.tool && SPAWN_TOOLS.has(e.tool)) spawns++;
    }
  }
  const coordPerAgent = subLanes.length ? round(sendMessages / subLanes.length) : 0;

  // --- aggregate member concerns (optional; only when lanes carry an evaluation) ---
  const evals = all.map((l) => l.evaluation).filter(Boolean);
  const teamConcerns = evals.length
    ? round(evals.reduce((a, e) => a + ((e.overall && e.overall.concerns) || 0), 0) / evals.length, 1)
    : null;

  return {
    RoleCoverage: {
      value: { covered, hasTest, facetCount: covered.length },
      rating: rate(covered.length >= 3 && hasTest, teamEdited && !hasTest && covered.length > 0),
      note: 'Whether the team spans enough facets — especially whether anyone is on the test facet while code is being written.',
    },
    Parallelism: {
      value: { peak, totalAgents: subLanes.length },
      rating: 'ok',
      note: 'Peak distinct sub-agents active within a 60s window; throughput proxy, not a quality verdict.',
    },
    CollaborationHealth: {
      value: { sendMessages, perAgent: coordPerAgent, spawns },
      rating: 'ok',
      note: 'Coordination volume (SendMessage) and delegation spawns across the team.',
    },
    memberCount: all.length,
    teamConcerns,
  };
}

module.exports = { teamMetrics };
