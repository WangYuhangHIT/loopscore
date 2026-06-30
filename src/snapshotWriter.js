'use strict';
/**
 * snapshotWriter.js — periodically sample the live model and append compact evaluation
 * records to the history store (one per session + one per shown sub-agent). Dedupes by
 * eventCount: if nothing happened since the last sample for that scope, no record is
 * written (keeps the NDJSON from filling with idle duplicates). PURE-ish: getSnapshot +
 * store are injected, so it mocks cleanly. Zero-dep.
 *
 *   createWriter({ getSnapshot, store }) -> { tick(now) }
 */

function dimRatings(evalObj) {
  const dims = {};
  if (evalObj && evalObj.dimensions) {
    for (const k of Object.keys(evalObj.dimensions)) dims[k] = evalObj.dimensions[k].rating;
  }
  return dims;
}

function recordFrom(base, evalObj, scope, extra) {
  const cap = (evalObj && evalObj.capability) || {};
  const usage = (evalObj && evalObj.usage) || {};
  return Object.assign({
    ts: base.ts,
    projectId: base.projectId,
    sessionId: base.sessionId,
    scope,
    role: base.role || null,
    concerns: evalObj && evalObj.overall ? evalObj.overall.concerns : null,
    label: evalObj && evalObj.overall ? evalObj.overall.label : null,
    dims: dimRatings(evalObj),
    firstPassRate: cap.firstPassRate != null ? cap.firstPassRate : null,
    reworkRate: cap.reworkRate != null ? cap.reworkRate : null,
    autonomySpan: cap.autonomySpan != null ? cap.autonomySpan : null,
    stuckRisk: cap.stuckRisk != null ? cap.stuckRisk : null,
    tokens: base.tokens != null ? base.tokens : null,
    skills: Object.keys(usage.bySkill || {}),
    hooks: Object.keys(usage.byHook || {}),
    mcp: Object.keys(usage.byMcp || {}),
    eventCount: base.eventCount != null ? base.eventCount : null,
  }, extra || {});
}

function createWriter({ getSnapshot, store }) {
  const last = new Map(); // scope-key -> eventCount last written

  function tick(now) {
    let snap;
    try { snap = getSnapshot(now); } catch { return; }
    for (const s of (snap && snap.sessions) || []) {
      if (!s.projectId) continue;
      const sKey = s.projectId + '|' + s.sessionId + '|session';
      if (last.get(sKey) !== s.eventCount) {
        store.append(recordFrom(
          { ts: now, projectId: s.projectId, sessionId: s.sessionId, role: s.mainRole && s.mainRole.role, tokens: s.tokens && s.tokens.total, eventCount: s.eventCount },
          s.evaluation, 'session'));
        last.set(sKey, s.eventCount);
      }
      for (const a of s.agents || []) {
        const aKey = s.projectId + '|' + s.sessionId + '|agent|' + a.agentId;
        if (last.get(aKey) === a.eventCount) continue;
        store.append(recordFrom(
          { ts: now, projectId: s.projectId, sessionId: s.sessionId, role: a.role && a.role.role, tokens: null, eventCount: a.eventCount },
          a.evaluation, 'agent', { agentId: a.agentId }));
        last.set(aKey, a.eventCount);
      }
    }
  }

  return { tick };
}

module.exports = { createWriter };
