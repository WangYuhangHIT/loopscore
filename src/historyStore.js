'use strict';
/**
 * historyStore.js — append-only NDJSON history of evaluation snapshots, one file per
 * project: <dataDir>/<projectId>/history.ndjson. Zero-dep (raw fs). Synchronous appends
 * (records are small and written at a ~5-min cadence, so sync is simplest + crash-safe).
 * Permanent retention by design (user choice); compaction can be layered later.
 *
 *   createStore({ dataDir }) -> { append(record), query({projectId,from,to,scope,sessionId,agentId}) }
 */
const fs = require('node:fs');
const path = require('node:path');

// projectId is an already-fs-safe dir name (e.g. -Users-dev-sample-app), but sanitize
// defensively so a weird id can never escape dataDir.
function safeId(id) {
  return String(id || 'unknown')
    .replace(/[^A-Za-z0-9_.-]/g, '_')
    .replace(/\.\.+/g, '_')  // collapse '..' so a projectId can't traverse up out of dataDir
    .replace(/^\.+/, '_');   // no leading-dot ('.', hidden, or relative) component
}

function createStore(opts = {}) {
  const dataDir = opts.dataDir;
  if (!dataDir) throw new Error('historyStore: dataDir required');

  function fileFor(projectId) {
    return path.join(dataDir, safeId(projectId), 'history.ndjson');
  }

  function append(record) {
    if (!record || !record.projectId) return;
    const file = fileFor(record.projectId);
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, JSON.stringify(record) + '\n');
    } catch { /* disk error must never break the live pipeline */ }
  }

  function query(q = {}) {
    if (!q.projectId) return [];
    let txt;
    try { txt = fs.readFileSync(fileFor(q.projectId), 'utf8'); } catch { return []; }
    const out = [];
    for (const line of txt.split('\n')) {
      if (!line.trim()) continue;
      let r;
      try { r = JSON.parse(line); } catch { continue; }
      if (q.from != null && r.ts < q.from) continue;
      if (q.to != null && r.ts > q.to) continue;
      if (q.scope && r.scope !== q.scope) continue;
      if (q.sessionId && r.sessionId !== q.sessionId) continue;
      if (q.agentId && r.agentId !== q.agentId) continue;
      out.push(r);
    }
    return out;
  }

  return { append, query };
}

module.exports = { createStore };
