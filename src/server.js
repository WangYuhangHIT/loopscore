'use strict';
/**
 * server.js — wires tailer → adapter → sessionModel → scorer, serves the static
 * dashboard, and streams events + scores over SSE. Local-only (binds 127.0.0.1),
 * read-only on the transcript dir, zero external egress (spec FR-004/009).
 */

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTailer } = require('./tailer');
const { normalize, schemaCheck } = require('./adapter');
const { createModel } = require('./sessionModel');
const { evaluate, evaluateEvents } = require('./evaluator');
const { createRunner } = require('./judgeRunner');
const { createReviewRunner } = require('./reviewer');
const { createRoleRunner } = require('./roleRunner');
const { projectIdForPath } = require('./projectRegistry');
const { createStore } = require('./historyStore');
const { createWriter } = require('./snapshotWriter');
const { timeline, skillUplift, allSkillUplift } = require('./trends');
const { createRegistry } = require('./llmRegistry');
const { readLocal, writeLocal, mergeConfig, setEnvKey } = require('./configStore');

function expandTilde(p) {
  if (typeof p === 'string' && p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return p;
}

function loadConfig() {
  const file = path.join(__dirname, '..', 'loopscore.config.json');
  const base = JSON.parse(fs.readFileSync(file, 'utf8'));
  // Merge the gitignored local override (UI-written LLM providers / active / judge.enabled)
  // so settings changed in the ⚙ panel survive a restart.
  const cfg = mergeConfig(base, readLocal(path.join(__dirname, '..', 'loopscore.local.json')));
  cfg.transcriptDir = expandTilde(cfg.transcriptDir);
  cfg.projectsRoot = expandTilde(cfg.projectsRoot);
  return cfg;
}

/** Load KEY=VALUE lines from a gitignored .env (secrets never live in committed
 *  files). Does not override env vars already set in the process. */
function loadEnvFile(file = path.join(__dirname, '..', '.env')) {
  let txt;
  try { txt = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[1] && !line.trim().startsWith('#') && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

function start(cfg = loadConfig(), deps = {}) {
  loadEnvFile(); // pull LOOPSCORE_JUDGE_KEY etc. from gitignored loopscore/.env if present
  // Multi-project: watch the whole ~/.claude/projects root (each subdir = one project).
  // Back-compat: a legacy single-project `transcriptDir` still works as the root.
  // Resolve where Claude Code stores transcripts. Honor CLAUDE_CONFIG_DIR (Claude Code's
  // own relocation env var) so we find them no matter how/where it was installed; otherwise
  // default to ~/.claude/projects. An explicit cfg.projectsRoot/transcriptDir always wins.
  const ccDir = process.env.CLAUDE_CONFIG_DIR ? expandTilde(process.env.CLAUDE_CONFIG_DIR) : null;
  const defaultProjectsRoot = ccDir ? path.join(ccDir, 'projects') : path.join(os.homedir(), '.claude', 'projects');
  cfg.projectsRoot = expandTilde(cfg.projectsRoot || cfg.transcriptDir) || defaultProjectsRoot;
  const model = createModel({
    idleSeconds: cfg.idleSeconds,
    timelineCap: cfg.timelineWindow ? cfg.timelineWindow * 10 : 5000,
    // US-003: enrich every snapshot summary with the 7-dim evaluation +
    // capability ratios + tokens, so the dashboard can render N panels off
    // a single GET /api/snapshot.
    evaluate,
    evaluateEvents, // Phase 2: score each sub-agent lane on its own events
    evalCfg: cfg,
  });
  const sseClients = new Set();
  const rawRing = [];
  const RING = 300;
  let schemaState = { ok: true, warnings: [] };

  function broadcast(msg) {
    const payload = `data: ${JSON.stringify(msg)}\n\n`;
    for (const res of sseClients) {
      try { res.write(payload); } catch { /* client gone; cleaned up on close */ }
    }
  }

  // US2 LLM judge (bucket ②). Active only when enabled AND a key is available
  // (or an llm is injected for tests). enabled-but-no-key degrades to a no-op +
  // a one-line warning, never inconclusive-spam. Key never lives in a file.
  const judgeCfg = cfg.judge || {};
  const judgeKeyName = judgeCfg.apiKeyEnv || 'LOOPSCORE_JUDGE_KEY';
  // Phase 5: multi-provider registry. `llm` is a stable proxy to the active provider, so
  // switching active (POST /api/config/llm) re-routes judge/review/roleRunner with no re-wire.
  const registry = createRegistry(cfg, {});
  // Files the UI writes to (overridable in tests). Non-secret config → local.json
  // (gitignored); API keys → .env (gitignored). Keys never touch local.json.
  const localFile = cfg.localConfigFile || path.join(__dirname, '..', 'loopscore.local.json');
  const envFile = cfg.envFile || path.join(__dirname, '..', '.env');
  // Live judging gate: enabled toggle (UI) AND the active provider has a key (or an
  // injected test llm). Recomputed each call so UI changes apply with no restart.
  const isJudgingLive = () => !!(cfg.judge && cfg.judge.enabled) && (!!deps.llm || registry.list().some((p) => p.active && p.keyPresent));
  // Persist the current non-secret state to local.json so it survives a restart.
  function persistLocal() {
    try {
      writeLocal(localFile, {
        judge: { enabled: !!(cfg.judge && cfg.judge.enabled) },
        llm: { providers: registry.providers(), active: registry.activeId() },
      });
    } catch { /* persistence failure must not break the request */ }
  }
  const llm = deps.llm || registry.llm;
  const runner = createRunner({ cfg, llm, onVerdict: (v) => broadcast({ type: 'judgment', sessionId: v.sessionId, verdict: v }) });
  // "manager's note" — throttled LLM review of the live 7-dim performance (US2 extended)
  const reviewRunner = createReviewRunner({ cfg: judgeCfg, llm, onReview: (rv, sess) => broadcast({ type: 'review', sessionId: sess.sessionId, review: rv }) });
  // Phase 4: periodic LLM role re-check for ambiguous lanes. Piggybacks the judge LLM +
  // throttle; defaults on whenever judging is active, off otherwise (token-safe).
  // role re-check rides the same live gate; enabled flag is read at call time below.
  const roleReviewCfg = { roleReview: Object.assign({ enabled: true, minIntervalMs: judgeCfg.minIntervalMs }, cfg.roleReview) };
  const roleRunner = createRoleRunner({ cfg: roleReviewCfg, llm });

  // event → model; push to SSE clients (event + fresh scores + session summary)
  model.subscribe((ev, sess) => {
    if (isJudgingLive()) {
      runner.consider(sess).catch(() => {}); // fire-and-forget; must not block ingestion
      roleRunner.consider(sess).catch(() => {}); // periodic LLM role re-check (throttled inside)
    }
    if (sseClients.size === 0) return; // no UI watching → skip evaluate/broadcast (keeps startup replay cheap; clients fetch initial state via /api/sessions)
    broadcast({ type: 'event', sessionId: sess.sessionId, event: ev });
    const evaluation = evaluate(sess, cfg);
    broadcast({ type: 'evaluation', sessionId: sess.sessionId, evaluation });
    const snap = model.getSnapshot(Date.now());
    const summary = snap.sessions.find((x) => x.sessionId === sess.sessionId);
    // US-004: tag every per-session broadcast at the top level so the React data
    // layer can route by `msg.sessionId` without inspecting message-type-specific
    // payload shapes. schema-warning stays global and untagged on purpose.
    if (summary) broadcast({ type: 'session', sessionId: sess.sessionId, session: summary });
    if (isJudgingLive()) reviewRunner.maybeReview(sess, evaluation, Date.now()).catch(() => {}); // throttled inside
  });

  function onLine(line, filePath) {
    rawRing.push(line);
    if (rawRing.length > RING) rawRing.shift();
    const ev = normalize(line);
    if (ev) {
      const pid = filePath ? projectIdForPath(cfg.projectsRoot, filePath) : null;
      if (pid) ev.projectId = pid;
      model.applyEvent(ev);
    }
  }

  function recomputeSchema() {
    const st = schemaCheck(rawRing);
    if (st.ok !== schemaState.ok || st.warnings.join('|') !== schemaState.warnings.join('|')) {
      schemaState = st;
      if (!st.ok) st.warnings.forEach((w) => broadcast({ type: 'schema-warning', message: w }));
    }
  }

  // History persistence (Phase 2): periodically sample the live model into NDJSON per
  // project, so long-term per-project trends survive restarts. dataDir is gitignored.
  const dataDir = expandTilde(cfg.dataDir || path.join(__dirname, '..', 'data'));
  const store = deps.store || createStore({ dataDir });
  const writer = createWriter({ getSnapshot: (t) => model.getSnapshot(t), store });
  const historyIntervalMs = cfg.historyIntervalMs != null ? cfg.historyIntervalMs : 5 * 60 * 1000;
  const historyTimer = setInterval(() => writer.tick(Date.now()), historyIntervalMs);
  if (historyTimer.unref) historyTimer.unref();
  const historySeed = setTimeout(() => writer.tick(Date.now()), 8000); // seed soon after boot
  if (historySeed.unref) historySeed.unref();

  const tailer = createTailer(cfg.projectsRoot, onLine, { pollMs: 0 });
  tailer.pollOnce(); // replay existing transcripts on boot (FR-008)
  recomputeSchema();
  const pollTimer = setInterval(() => { tailer.pollOnce(); recomputeSchema(); }, cfg.pollMs || 1000);
  if (pollTimer.unref) pollTimer.unref();

  // Static root: prefer cfg.staticDir, else the built SPA at frontend/dist.
  // US-014 retired the legacy public/ shell — the React dashboard in frontend/
  // is now the only UI. If frontend/dist is missing the server still boots
  // (so /api + /events keep working for headless / test harnesses) but the
  // static-file responder will 404 until `npm --prefix frontend run build`.
  const repoRoot = path.join(__dirname, '..');
  const distDir = path.join(repoRoot, 'frontend', 'dist');
  const staticDir = cfg.staticDir || distDir;
  const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'text/javascript; charset=utf-8',
    '.mjs':  'text/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg':  'image/svg+xml',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico':  'image/x-icon',
    '.woff': 'font/woff',
    '.woff2':'font/woff2',
    '.map':  'application/json; charset=utf-8',
    '.txt':  'text/plain; charset=utf-8',
  };
  // SPA-route detection: paths without an extension are app routes (e.g. /agents/t1),
  // not files. Keep them off the static-file path so they always fall back to index.html.
  function looksLikeAssetPath(urlPath) {
    return path.extname(urlPath) !== '';
  }
  function safeJoin(root, urlPath) {
    let decoded;
    try { decoded = decodeURIComponent(urlPath.split('?')[0]); }
    catch { return null; } // malformed %-escape — treat as not found, never throw
    const resolved = path.normalize(path.join(root, decoded));
    // Must equal root or live strictly under it. A bare startsWith(root) lets a sibling
    // directory whose name begins with the root's basename (e.g. dist-backup) escape.
    if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
    return resolved;
  }
  function sendFile(res, filePath, fallbackType) {
    fs.readFile(filePath, (err, buf) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      const type = MIME[path.extname(filePath).toLowerCase()] || fallbackType || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      res.end(buf);
    });
  }
  function serveIndex(res) {
    sendFile(res, path.join(staticDir, 'index.html'), 'text/html; charset=utf-8');
  }
  function serveStaticOrSpa(res, urlPath) {
    if (urlPath === '/' || urlPath === '/index.html') return serveIndex(res);
    const filePath = safeJoin(staticDir, urlPath);
    if (!filePath) { res.writeHead(404); res.end('not found'); return; }
    fs.stat(filePath, (err, st) => {
      if (!err && st.isFile()) return sendFile(res, filePath);
      // Asset-looking misses must 404; bare routes get the SPA shell.
      if (looksLikeAssetPath(urlPath)) { res.writeHead(404); res.end('not found'); return; }
      serveIndex(res);
    });
  }
  function json(res, obj, code = 200) {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  }

  // Read a request body (size-capped). Buffers raw bytes and decodes once, so a multi-byte
  // UTF-8 character split across TCP chunks isn't corrupted (vs. string concatenation).
  function readBody(req, limit, cb) {
    const chunks = []; let n = 0; let killed = false;
    req.on('data', (c) => { n += c.length; if (n > limit) { killed = true; req.destroy(); return; } chunks.push(c); });
    req.on('end', () => { if (!killed) cb(Buffer.concat(chunks).toString('utf8')); });
  }

  // Localhost-only guard for state-changing requests. The Host header must name a
  // loopback address (defeats DNS-rebinding: a rebound attacker domain shows up in
  // Host), and any Origin present must be a loopback origin (defeats cross-site POST).
  // GETs stay open (read-only, same-origin-protected by the browser for sensitive data).
  function hostIsLocal(h) {
    if (!h) return true; // no Host (rare) — allow; loopback bind already limits reach
    const name = String(h).replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    return name === '127.0.0.1' || name === 'localhost' || name === '::1';
  }
  function isLocalRequest(req) {
    if (!hostIsLocal(req.headers.host)) return false;
    const origin = req.headers.origin;
    if (origin) {
      try { if (!hostIsLocal(new URL(origin).host)) return false; } catch { return false; }
    }
    return true;
  }

  const server = http.createServer((req, res) => {
   try {
    const url = req.url.split('?')[0];

    // DNS-rebinding defense for ALL requests (reads included): the Host header must name a
    // loopback address — a rebound attacker domain would show up here. The loopback bind
    // stops remote TCP; this stops a rebinding browser / cross-origin page reading eval data.
    if (!hostIsLocal(req.headers.host)) {
      return json(res, { error: 'forbidden: localhost-only' }, 403);
    }
    // State-changing requests additionally require a loopback Origin (anti-CSRF).
    if (req.method !== 'GET' && req.method !== 'HEAD' && !isLocalRequest(req)) {
      return json(res, { error: 'forbidden: localhost-only' }, 403);
    }

    // /api/* and /events must precede static fallback so SPA never shadows them.
    if (url === '/api/snapshot') {
      return json(res, Object.assign(model.getSnapshot(Date.now()), { schemaOk: schemaState.ok, warnings: schemaState.warnings }));
    }

    // History (Phase 2): persisted evaluation records for one project, optionally ranged.
    if (url === '/api/history') {
      const qs = new URLSearchParams(req.url.split('?')[1] || '');
      const projectId = qs.get('projectId');
      if (!projectId) return json(res, { error: 'projectId required' }, 400);
      const records = store.query({
        projectId,
        from: qs.get('from') ? Number(qs.get('from')) : undefined,
        to: qs.get('to') ? Number(qs.get('to')) : undefined,
        scope: qs.get('scope') || undefined,
        sessionId: qs.get('sessionId') || undefined,
        agentId: qs.get('agentId') || undefined,
      });
      return json(res, { records });
    }

    // Trends (Phase 3): metric averaged over time buckets for one project.
    if (url === '/api/trends') {
      const qs = new URLSearchParams(req.url.split('?')[1] || '');
      const projectId = qs.get('projectId');
      if (!projectId) return json(res, { error: 'projectId required' }, 400);
      const scope = qs.get('scope') || 'session';
      const records = store.query({ projectId, scope, sessionId: qs.get('sessionId') || undefined, agentId: qs.get('agentId') || undefined });
      const series = timeline(records, {
        bucket: qs.get('bucket') || 'day', metric: qs.get('metric') || 'firstPassRate',
        scope, agentId: qs.get('agentId') || undefined, sessionId: qs.get('sessionId') || undefined,
      });
      return json(res, { series });
    }

    // Skill uplift (Phase 3): sessions that used a skill vs those that didn't (correlation).
    // With `skill` → one verdict; without → uplift for every skill, ranked by impact.
    if (url === '/api/uplift') {
      const qs = new URLSearchParams(req.url.split('?')[1] || '');
      const projectId = qs.get('projectId');
      if (!projectId) return json(res, { error: 'projectId required' }, 400);
      const scope = qs.get('scope') || 'session';
      const metric = qs.get('metric') || 'firstPassRate';
      const records = store.query({ projectId, scope });
      const skill = qs.get('skill');
      if (skill) return json(res, { uplift: skillUplift(records, { skill, metric, scope }) });
      return json(res, { uplifts: allSkillUplift(records, { metric, scope }) });
    }

    // Multi-LLM config (Phase 5): list providers + key-presence (never the key) + the
    // judge enabled toggle. The UI edits all of this — switch/CRUD/key/enabled.
    if (url === '/api/config/llm' && req.method === 'GET') {
      return json(res, { providers: registry.list(), active: registry.activeId(), enabled: !!(cfg.judge && cfg.judge.enabled) });
    }
    if (url === '/api/config/llm' && req.method === 'POST') {
      readBody(req, 1e5, (body) => {
       try {
        let parsed;
        try { parsed = JSON.parse(body || '{}'); } catch { return json(res, { error: 'bad json' }, 400); }
        // setKey: the ONLY secret write — straight to .env (gitignored), never echoed,
        // never into local.json. Update process.env so keyPresent flips live.
        if (parsed.setKey && typeof parsed.setKey === 'object') {
          const { env, value } = parsed.setKey;
          try { setEnvKey(envFile, env, value); } catch { return json(res, { error: 'invalid env var name' }, 400); }
          process.env[env] = value == null ? '' : String(value);
          return json(res, { ok: true, keyPresent: !!process.env[env] }); // no value in the response
        }
        if (parsed.upsertProvider && typeof parsed.upsertProvider === 'object') {
          if (!registry.upsert(parsed.upsertProvider)) return json(res, { error: 'provider needs an id' }, 400);
          persistLocal();
          return json(res, { ok: true, providers: registry.list(), active: registry.activeId() });
        }
        if (parsed.deleteProvider != null) {
          if (!registry.remove(parsed.deleteProvider)) return json(res, { error: 'unknown provider id' }, 404);
          persistLocal();
          return json(res, { ok: true, providers: registry.list(), active: registry.activeId() });
        }
        if (parsed.enabled != null) {
          cfg.judge = cfg.judge || {};
          cfg.judge.enabled = !!parsed.enabled;
          persistLocal();
          return json(res, { ok: true, enabled: cfg.judge.enabled });
        }
        if (parsed.active != null) {
          if (!registry.setActive(parsed.active)) return json(res, { error: 'unknown provider id' }, 404);
          persistLocal();
          return json(res, { ok: true, active: registry.activeId() });
        }
        return json(res, { error: 'no recognized field' }, 400);
       } catch { return json(res, { error: 'bad request' }, 400); }
      });
      return;
    }

    // Manual role override (Phase 4): POST /api/sessions/:id/agents/:agentId/role  body {facets:[]}
    // agentId 'main' targets the main lane; empty/missing facets clears the override.
    const roleMatch = url.match(/^\/api\/sessions\/([^/]+)\/agents\/([^/]+)\/role$/);
    if (roleMatch && req.method === 'POST') {
      readBody(req, 1e6, (body) => {
       try {
        let parsed;
        try { parsed = JSON.parse(body || '{}'); } catch { return json(res, { error: 'bad json' }, 400); }
        const sessionId = decodeURIComponent(roleMatch[1]);
        const r = model.setRoleOverride(sessionId, decodeURIComponent(roleMatch[2]), parsed.facets);
        if (!r) return json(res, { error: 'not found or invalid facets' }, 404);
        // push a refreshed summary so the UI badge updates immediately (no new event needed)
        const summary = model.getSnapshot(Date.now()).sessions.find((x) => x.sessionId === sessionId);
        if (summary) broadcast({ type: 'session', sessionId, session: summary });
        return json(res, { ok: true, role: r });
       } catch { return json(res, { error: 'bad request' }, 400); }
      });
      return;
    }

    if (url.startsWith('/api/sessions/')) {
      const id = decodeURIComponent(url.slice('/api/sessions/'.length));
      const sess = model.getSession(id, Date.now());
      if (!sess) return json(res, { error: 'not found' }, 404);
      return json(res, { session: sess, evaluation: evaluate(sess, cfg) });
    }

    if (url.startsWith('/api/')) { return json(res, { error: 'not found' }, 404); }

    if (url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(`retry: 2000\n\n`);
      sseClients.add(res);
      // prime new client with current schema state
      if (!schemaState.ok) schemaState.warnings.forEach((w) => res.write(`data: ${JSON.stringify({ type: 'schema-warning', message: w })}\n\n`));
      req.on('close', () => sseClients.delete(res));
      return;
    }

    return serveStaticOrSpa(res, url);
   } catch {
     // A thrown route handler must return 500, never take the daemon down.
     try { json(res, { error: 'internal error' }, 500); } catch { /* response already started */ }
   }
  });

  server.listen(cfg.port, '127.0.0.1', () => {
    // eslint-disable-next-line no-console
    console.log(`LoopScore listening on http://127.0.0.1:${cfg.port}  (watching ${cfg.projectsRoot})`);
    if (!fs.existsSync(path.join(staticDir, 'index.html'))) {
      console.warn(`⚠️  Frontend build not found (${staticDir}/index.html) — the browser will 404. First run: npm --prefix frontend install && npm --prefix frontend run build`);
    }
    if (!schemaState.ok) console.warn('⚠️  schema drift:', schemaState.warnings.join('; '));
    if (cfg.judge && cfg.judge.enabled && !isJudgingLive()) {
      console.warn(`⚠️  judge.enabled=true but no API key for the active provider — auto-judging (bucket②) is skipped. Set the key in the ⚙ LLM settings (or ${judgeKeyName} in .env).`);
    } else if (isJudgingLive()) {
      const ap = registry.activeProviderCfg() || {};
      console.log(`Bucket② LLM judge enabled (provider=${ap.provider}, model=${ap.model})`);
    }
  });

  return { server, model, store, writer, registry, isJudgingLive, stop() { clearInterval(pollTimer); clearInterval(historyTimer); clearTimeout(historySeed); tailer.close(); server.close(); } };
}

// Defense-in-depth for production only (NOT under test, where a global handler could mask
// failures): a stray uncaught error should be logged, not kill the daemon. The per-request
// try/catch above already covers the known throw vectors.
function installCrashGuard() {
  process.on('uncaughtException', (e) => console.error('[loopscore] uncaught exception:', (e && e.message) || e));
  process.on('unhandledRejection', (e) => console.error('[loopscore] unhandled rejection:', (e && e.message) || e));
}

if (require.main === module) { installCrashGuard(); start(); }

module.exports = { start, loadConfig, expandTilde, loadEnvFile };
