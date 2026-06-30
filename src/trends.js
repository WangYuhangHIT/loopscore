'use strict';
/**
 * trends.js — analysis over the persisted history records (historyStore). PURE, zero-dep.
 *   timeline(records, {bucket,metric,scope,agentId?,sessionId?}) -> [{bucket,avg,count}]
 *   skillUplift(records, {skill,metric,scope,minN}) -> {withSkill,without,delta,lowConfidence}
 *
 * Honesty: skillUplift is a CORRELATION over observed sessions, not a controlled A/B —
 * small samples are flagged lowConfidence (design §3). It says "sessions that used skill
 * X averaged N higher", not "skill X caused the lift".
 */

const { round } = require('./round');

function bucketKey(ts, bucket) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  const day = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  return bucket === 'hour' ? `${day}T${p(d.getUTCHours())}` : day;
}

function timeline(records, opts = {}) {
  const bucket = opts.bucket || 'day';
  const metric = opts.metric || 'firstPassRate';
  const scope = opts.scope || 'session';
  const buckets = new Map();
  for (const r of records || []) {
    if (scope && r.scope !== scope) continue;
    if (opts.agentId && r.agentId !== opts.agentId) continue;
    if (opts.sessionId && r.sessionId !== opts.sessionId) continue;
    const v = r[metric];
    if (v == null || typeof v !== 'number') continue;
    const k = bucketKey(r.ts, bucket);
    let b = buckets.get(k);
    if (!b) { b = { bucket: k, sum: 0, count: 0 }; buckets.set(k, b); }
    b.sum += v; b.count += 1;
  }
  return [...buckets.values()]
    .map((b) => ({ bucket: b.bucket, avg: round(b.sum / b.count), count: b.count }))
    .sort((a, b) => (a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0));
}

function skillUplift(records, opts = {}) {
  const skill = opts.skill;
  const metric = opts.metric || 'firstPassRate';
  const scope = opts.scope || 'session';
  const minN = opts.minN != null ? opts.minN : 5;
  const w = [], wo = [];
  for (const r of records || []) {
    if (scope && r.scope !== scope) continue;
    const v = r[metric];
    if (v == null || typeof v !== 'number') continue;
    const has = Array.isArray(r.skills) && r.skills.includes(skill);
    (has ? w : wo).push(v);
  }
  const mean = (a) => (a.length ? round(a.reduce((x, y) => x + y, 0) / a.length) : null);
  const withMean = mean(w), woMean = mean(wo);
  const delta = (withMean != null && woMean != null) ? round(withMean - woMean) : null;
  return {
    skill, metric,
    withSkill: { mean: withMean, n: w.length },
    without: { mean: woMean, n: wo.length },
    delta,
    lowConfidence: w.length < minN || wo.length < minN,
  };
}

// Uplift for every skill that appears in the records, ranked by absolute impact.
function allSkillUplift(records, opts = {}) {
  const scope = opts.scope || 'session';
  const skills = new Set();
  for (const r of records || []) {
    if (scope && r.scope !== scope) continue;
    for (const s of r.skills || []) skills.add(s);
  }
  return [...skills]
    .map((skill) => skillUplift(records, Object.assign({}, opts, { skill })))
    .sort((a, b) => Math.abs(b.delta || 0) - Math.abs(a.delta || 0));
}

module.exports = { timeline, skillUplift, allSkillUplift };
