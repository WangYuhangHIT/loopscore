'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { start } = require('../src/server');

function httpGet(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: urlPath, method: 'GET' },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function listening(app) {
  if (!app.server.listening) await new Promise((r) => app.server.once('listening', r));
  return app.server.address().port;
}

function tmpTranscriptDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loopscore-srv-'));
  const lines = [
    { type: 'assistant', sessionId: 't1', timestamp: '2026-06-13T12:00:00Z', uuid: 'a1',
      message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } },
    { type: 'user', sessionId: 't1', timestamp: '2026-06-13T12:00:01Z', uuid: 'a2',
      message: { role: 'user', content: [{ type: 'tool_result', is_error: true, content: 'Error: boom\n  at x.js:3' }] } },
  ];
  fs.writeFileSync(path.join(dir, 't1.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return dir;
}

async function waitFor(fn, ms = 1500) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  return fn();
}

test('server wires US2: a real error episode gets judged and stored on the session', async () => {
  const dir = tmpTranscriptDir();
  const cfg = {
    transcriptDir: dir, port: 0, idleSeconds: 60, loopErrorStreak: 3, pollMs: 0,
    testCommandPattern: 'npm test', timelineWindow: 50,
    judge: { enabled: true, maxPerSession: 20, model: 'fake-judge', contextWindow: 4 },
  };
  const fakeLLM = { complete: async () => '{"category":"action","rationale":"repeated wrong edit"}' };
  const app = start(cfg, { llm: fakeLLM });
  try {
    const judged = await waitFor(() => {
      const s = app.model.getSession('t1', Date.now());
      return s && s.judgments && s.judgments.length ? s.judgments : null;
    });
    assert.ok(judged && judged.length >= 1, 'expected at least one verdict');
    assert.strictEqual(judged[0].category, 'action');
    assert.strictEqual(judged[0].bucket, 'llm-judge');
    assert.strictEqual(judged[0].model, 'fake-judge');
  } finally {
    app.stop();
  }
});

test('server: judge.enabled but no key + no injected llm → boots, no judging (graceful)', async () => {
  delete process.env.LOOPSCORE_JUDGE_KEY;
  const dir = tmpTranscriptDir();
  const cfg = {
    transcriptDir: dir, port: 0, idleSeconds: 60, loopErrorStreak: 3, pollMs: 0,
    testCommandPattern: 'npm test', timelineWindow: 50,
    judge: { enabled: true, maxPerSession: 20, model: 'm', contextWindow: 4, apiKeyEnv: 'LOOPSCORE_JUDGE_KEY' },
  };
  const app = start(cfg); // no deps.llm injected, no key set
  try {
    await new Promise((r) => setTimeout(r, 150));
    const s = app.model.getSession('t1', Date.now());
    assert.ok(!s.judgments || s.judgments.length === 0); // gracefully skipped, no inconclusive spam
  } finally {
    app.stop();
  }
});

test('server: judging disabled → no verdicts (slice 1 unaffected)', async () => {
  const dir = tmpTranscriptDir();
  const cfg = {
    transcriptDir: dir, port: 0, idleSeconds: 60, loopErrorStreak: 3, pollMs: 0,
    testCommandPattern: 'npm test', timelineWindow: 50,
    judge: { enabled: false, maxPerSession: 20, model: 'fake', contextWindow: 4 },
  };
  let called = 0;
  const fakeLLM = { complete: async () => { called++; return '{}'; } };
  const app = start(cfg, { llm: fakeLLM });
  try {
    await new Promise((r) => setTimeout(r, 200));
    const s = app.model.getSession('t1', Date.now());
    assert.ok(!s.judgments || s.judgments.length === 0);
    assert.strictEqual(called, 0);
  } finally {
    app.stop();
  }
});

function tmpDistDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loopscore-dist-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'),
    '<!doctype html><html><head><title>spa</title></head><body><div id="root"></div></body></html>');
  fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log("ok");');
  fs.writeFileSync(path.join(dir, 'assets', 'app.css'), 'body{color:red;}');
  return dir;
}

test('server: serves the SPA index.html from staticDir at / and /index.html', async () => {
  const transcriptDir = tmpTranscriptDir();
  const staticDir = tmpDistDir();
  const cfg = {
    transcriptDir, port: 0, idleSeconds: 60, loopErrorStreak: 3, pollMs: 0,
    testCommandPattern: 'npm test', timelineWindow: 50, staticDir,
    judge: { enabled: false },
  };
  const app = start(cfg);
  try {
    const port = await listening(app);
    const root = await httpGet(port, '/');
    assert.strictEqual(root.status, 200);
    assert.match(root.headers['content-type'] || '', /text\/html/);
    assert.match(root.body, /id="root"/);
    const idx = await httpGet(port, '/index.html');
    assert.strictEqual(idx.status, 200);
    assert.match(idx.body, /id="root"/);
  } finally {
    app.stop();
  }
});

test('server: serves built assets with correct mime types', async () => {
  const transcriptDir = tmpTranscriptDir();
  const staticDir = tmpDistDir();
  const cfg = {
    transcriptDir, port: 0, idleSeconds: 60, loopErrorStreak: 3, pollMs: 0,
    testCommandPattern: 'npm test', timelineWindow: 50, staticDir,
    judge: { enabled: false },
  };
  const app = start(cfg);
  try {
    const port = await listening(app);
    const js = await httpGet(port, '/assets/app.js');
    assert.strictEqual(js.status, 200);
    assert.match(js.headers['content-type'] || '', /text\/javascript|application\/javascript/);
    assert.match(js.body, /console\.log/);
    const css = await httpGet(port, '/assets/app.css');
    assert.strictEqual(css.status, 200);
    assert.match(css.headers['content-type'] || '', /text\/css/);
    assert.match(css.body, /color:red/);
  } finally {
    app.stop();
  }
});

test('server: safeJoin rejects path traversal and sibling-dir prefix escapes', async () => {
  const transcriptDir = tmpTranscriptDir();
  const staticDir = tmpDistDir();
  // a secret in a SIBLING dir whose name shares the static dir's basename prefix (…-secret).
  // A bare startsWith(root) check would let this through; the fix requires root + path.sep.
  fs.mkdirSync(staticDir + '-secret', { recursive: true });
  fs.writeFileSync(path.join(staticDir + '-secret', 'key.txt'), 'TOP_SECRET');
  fs.writeFileSync(path.join(path.dirname(staticDir), 'parent-secret.txt'), 'NOPE');
  const cfg = {
    transcriptDir, port: 0, idleSeconds: 60, loopErrorStreak: 3, pollMs: 0,
    testCommandPattern: 'npm test', timelineWindow: 50, staticDir,
    judge: { enabled: false },
  };
  const app = start(cfg);
  try {
    const port = await listening(app);
    const base = path.basename(staticDir);
    // the sibling-dir prefix escape (the actual bug): must NOT leak the file
    const sib = await httpGet(port, `/../${base}-secret/key.txt`);
    assert.strictEqual(sib.status, 404);
    assert.ok(!/TOP_SECRET/.test(sib.body), 'sibling-dir file must not be served');
    // one-level-up and encoded traversal must not leak the parent secret either
    const up = await httpGet(port, '/../parent-secret.txt');
    assert.ok(!/NOPE/.test(up.body));
    const enc = await httpGet(port, '/%2e%2e/parent-secret.txt');
    assert.ok(!/NOPE/.test(enc.body));
  } finally {
    app.stop();
  }
});

test('server: SPA fallback returns index.html for unknown non-asset routes', async () => {
  const transcriptDir = tmpTranscriptDir();
  const staticDir = tmpDistDir();
  const cfg = {
    transcriptDir, port: 0, idleSeconds: 60, loopErrorStreak: 3, pollMs: 0,
    testCommandPattern: 'npm test', timelineWindow: 50, staticDir,
    judge: { enabled: false },
  };
  const app = start(cfg);
  try {
    const port = await listening(app);
    const spa = await httpGet(port, '/agents/t1');
    assert.strictEqual(spa.status, 200);
    assert.match(spa.headers['content-type'] || '', /text\/html/);
    assert.match(spa.body, /id="root"/);
    // asset-looking missing files should NOT fall back to HTML — they 404
    const miss = await httpGet(port, '/assets/missing.js');
    assert.strictEqual(miss.status, 404);
  } finally {
    app.stop();
  }
});

test('server: /api and /events take precedence over SPA fallback', async () => {
  const transcriptDir = tmpTranscriptDir();
  const staticDir = tmpDistDir();
  const cfg = {
    transcriptDir, port: 0, idleSeconds: 60, loopErrorStreak: 3, pollMs: 0,
    testCommandPattern: 'npm test', timelineWindow: 50, staticDir,
    judge: { enabled: false },
  };
  const app = start(cfg);
  try {
    const port = await listening(app);
    const snap = await httpGet(port, '/api/snapshot');
    assert.strictEqual(snap.status, 200);
    assert.match(snap.headers['content-type'] || '', /application\/json/);
    const parsed = JSON.parse(snap.body);
    assert.ok(Array.isArray(parsed.sessions));
    // /events still upgrades to SSE — just check headers, then drop the connection
    await new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: '/events', method: 'GET' },
        (res) => {
          try {
            assert.strictEqual(res.statusCode, 200);
            assert.match(res.headers['content-type'] || '', /text\/event-stream/);
            res.destroy();
            resolve();
          } catch (err) { reject(err); }
        }
      );
      req.on('error', reject);
      req.end();
    });
  } finally {
    app.stop();
  }
});

function tmpMultiSessionDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loopscore-multi-'));
  const t1Lines = [
    { type: 'user', sessionId: 't1', timestamp: '2026-06-13T12:00:00Z', uuid: 'u1',
      gitBranch: 'feat/one', message: { role: 'user', content: 'hello' } },
    { type: 'assistant', sessionId: 't1', timestamp: '2026-06-13T12:00:01Z', uuid: 'a1',
      message: { role: 'assistant', usage: { input_tokens: 30, output_tokens: 12 },
        content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } },
    { type: 'user', sessionId: 't1', timestamp: '2026-06-13T12:00:02Z', uuid: 'u2',
      message: { role: 'user', content: [{ type: 'tool_result', is_error: false, content: 'ok' }] } },
  ];
  const t2Lines = [
    { type: 'user', sessionId: 't2', timestamp: '2026-06-13T12:00:00Z', uuid: 'u3',
      gitBranch: 'feat/two', message: { role: 'user', content: 'second' } },
    { type: 'assistant', sessionId: 't2', timestamp: '2026-06-13T12:00:01Z', uuid: 'a2',
      message: { role: 'assistant', usage: { input_tokens: 5, output_tokens: 3 },
        content: [{ type: 'text', text: 'sure' }] } },
  ];
  fs.writeFileSync(path.join(dir, 't1.jsonl'), t1Lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 't2.jsonl'), t2Lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return dir;
}

test('server: /api/snapshot enriches every session with evaluation, capability, tokens, branch, sub-agent counts', async () => {
  const transcriptDir = tmpMultiSessionDir();
  const staticDir = tmpDistDir();
  const cfg = {
    transcriptDir, port: 0, idleSeconds: 60, loopErrorStreak: 3, pollMs: 0,
    testCommandPattern: 'npm test', timelineWindow: 50, staticDir,
    judge: { enabled: false },
  };
  const app = start(cfg);
  try {
    const port = await listening(app);
    const res = await httpGet(port, '/api/snapshot');
    assert.strictEqual(res.status, 200);
    const parsed = JSON.parse(res.body);
    assert.ok(Array.isArray(parsed.sessions));
    assert.ok(parsed.sessions.length >= 2, `expected ≥2 sessions, got ${parsed.sessions.length}`);
    const dims = ['delivery', 'quality', 'verification', 'debugging', 'context', 'autonomy', 'recovery'];
    for (const s of parsed.sessions) {
      assert.ok(s.evaluation, `evaluation missing for ${s.sessionId}`);
      for (const k of dims) {
        assert.ok(s.evaluation.dimensions[k], `dim ${k} missing on ${s.sessionId}`);
      }
      assert.ok(s.evaluation.capability && 'firstPassRate' in s.evaluation.capability);
      assert.ok(s.evaluation.usage);
      assert.ok(s.evaluation.cost);
      assert.ok(s.evaluation.overall);
      assert.ok(s.tokens && 'input' in s.tokens && 'output' in s.tokens && 'total' in s.tokens);
      assert.ok('agentTotal' in s);
      assert.ok('agentsLive' in s);
      assert.ok(['live', 'idle'].includes(s.status));
      assert.ok('gitBranch' in s);
    }
    const t1 = parsed.sessions.find((x) => x.sessionId === 't1');
    assert.strictEqual(t1.gitBranch, 'feat/one');
    assert.strictEqual(t1.tokens.input, 30);
    assert.strictEqual(t1.tokens.output, 12);
    assert.strictEqual(t1.tokens.total, 42);
  } finally {
    app.stop();
  }
});

function tmpEmptyTranscriptDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'loopscore-sse-'));
}

function openSse(port) {
  const payloads = [];
  let resObj = null;
  const ready = new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/events', method: 'GET' },
      (res) => {
        resObj = res;
        let buf = '';
        res.on('data', (chunk) => {
          buf += chunk.toString('utf8');
          const frames = buf.split('\n\n');
          buf = frames.pop();
          for (const f of frames) {
            const line = f.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            try { payloads.push(JSON.parse(line.slice(6))); } catch { /* ignore */ }
          }
        });
        resolve();
      }
    );
    req.on('error', reject);
    req.end();
  });
  return { payloads, ready, close() { if (resObj) resObj.destroy(); } };
}

test('server SSE: every per-session payload carries a top-level sessionId so frontend can route by panel', async () => {
  const transcriptDir = tmpEmptyTranscriptDir();
  const staticDir = tmpDistDir();
  const cfg = {
    transcriptDir, port: 0, idleSeconds: 60, loopErrorStreak: 3, pollMs: 30,
    testCommandPattern: 'npm test', timelineWindow: 50, staticDir,
    judge: { enabled: false },
  };
  const app = start(cfg);
  try {
    const port = await listening(app);
    const sse = openSse(port);
    await sse.ready;
    // Give the SSE handler a tick to register the client into sseClients.
    await new Promise((r) => setTimeout(r, 50));

    // Now write two sessions' transcripts AFTER subscribing so the broadcast
    // path runs (it short-circuits when sseClients.size === 0).
    const t1Lines = [
      { type: 'user', sessionId: 't1', timestamp: '2026-06-13T12:00:00Z', uuid: 'u1',
        gitBranch: 'feat/one', message: { role: 'user', content: 'hello' } },
      { type: 'assistant', sessionId: 't1', timestamp: '2026-06-13T12:00:01Z', uuid: 'a1',
        message: { role: 'assistant', usage: { input_tokens: 5, output_tokens: 3 },
          content: [{ type: 'text', text: 'ok' }] } },
    ];
    const t2Lines = [
      { type: 'user', sessionId: 't2', timestamp: '2026-06-13T12:00:00Z', uuid: 'u2',
        gitBranch: 'feat/two', message: { role: 'user', content: 'hi' } },
      { type: 'assistant', sessionId: 't2', timestamp: '2026-06-13T12:00:01Z', uuid: 'a2',
        message: { role: 'assistant', usage: { input_tokens: 7, output_tokens: 2 },
          content: [{ type: 'text', text: 'sure' }] } },
    ];
    fs.writeFileSync(path.join(transcriptDir, 't1.jsonl'),
      t1Lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    fs.writeFileSync(path.join(transcriptDir, 't2.jsonl'),
      t2Lines.map((l) => JSON.stringify(l)).join('\n') + '\n');

    // Wait long enough for the poller (30ms) to pick up both files and broadcast.
    await waitFor(() => {
      const ids = new Set(sse.payloads.filter((p) => p.type !== 'schema-warning').map((p) => p.sessionId));
      return ids.has('t1') && ids.has('t2');
    }, 2000);
    sse.close();

    const tagged = sse.payloads.filter((p) => p.type !== 'schema-warning');
    assert.ok(tagged.length > 0, `expected SSE payloads, got ${sse.payloads.length}`);

    // (1) every per-session payload has a top-level sessionId — this is the new contract.
    for (const p of tagged) {
      assert.ok(typeof p.sessionId === 'string' && p.sessionId.length > 0,
        `payload type=${p.type} missing top-level sessionId: ${JSON.stringify(p)}`);
    }

    // (2) both sessions show up tagged independently — multi-session no cross-contamination.
    const ids = new Set(tagged.map((p) => p.sessionId));
    assert.ok(ids.has('t1'), 'expected at least one payload tagged sessionId=t1');
    assert.ok(ids.has('t2'), 'expected at least one payload tagged sessionId=t2');

    // (3) the {type:'session'} payload (the one that used to lack sessionId) now carries it
    // and its top-level sessionId matches the inner summary.
    const sessionMsgs = tagged.filter((p) => p.type === 'session');
    assert.ok(sessionMsgs.length > 0, 'expected at least one {type:"session"} payload');
    for (const m of sessionMsgs) {
      assert.strictEqual(typeof m.sessionId, 'string');
      assert.strictEqual(m.sessionId, m.session.sessionId,
        'top-level sessionId must equal session.sessionId');
    }

    // (4) per-event payloads are correctly routed: an event whose sess is t1 carries sessionId=t1.
    const eventMsgs = tagged.filter((p) => p.type === 'event');
    assert.ok(eventMsgs.length > 0, 'expected at least one {type:"event"} payload');
    for (const m of eventMsgs) {
      // Adapter stamps the event with sessionId; the wrapper must agree.
      if (m.event && m.event.sessionId) {
        assert.strictEqual(m.sessionId, m.event.sessionId,
          'top-level sessionId must equal event.sessionId');
      }
    }
  } finally {
    app.stop();
  }
});

test('server SSE: schema-warning stays global (no sessionId) so it can render a top bar', async () => {
  const transcriptDir = tmpEmptyTranscriptDir();
  // Seed a malformed JSONL line BEFORE start so the schema check trips on boot.
  fs.writeFileSync(path.join(transcriptDir, 'bad.jsonl'), 'this-is-not-json\n');
  const staticDir = tmpDistDir();
  const cfg = {
    transcriptDir, port: 0, idleSeconds: 60, loopErrorStreak: 3, pollMs: 30,
    testCommandPattern: 'npm test', timelineWindow: 50, staticDir,
    judge: { enabled: false },
  };
  const app = start(cfg);
  try {
    const port = await listening(app);
    const sse = openSse(port);
    await sse.ready;
    // schema-warning is primed onto a new client on subscribe.
    await waitFor(() => sse.payloads.some((p) => p.type === 'schema-warning'), 1500);
    sse.close();
    const warns = sse.payloads.filter((p) => p.type === 'schema-warning');
    assert.ok(warns.length > 0, 'expected at least one schema-warning payload');
    for (const w of warns) {
      assert.ok(!('sessionId' in w),
        `schema-warning must not carry sessionId (got ${JSON.stringify(w)})`);
      assert.ok(typeof w.message === 'string' && w.message.length > 0);
    }
  } finally {
    app.stop();
  }
});

function httpPost(port, urlPath, bodyObj) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(bodyObj));
    const req = http.request(
      { host: '127.0.0.1', port, path: urlPath, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': data.length } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.on('error', reject);
    req.end(data);
  });
}

test('server: POST role override locks a lane role; bad target → 404', async () => {
  const dir = tmpTranscriptDir(); // session 't1', main lane only
  const cfg = {
    transcriptDir: dir, port: 0, idleSeconds: 60, loopErrorStreak: 3, pollMs: 0,
    testCommandPattern: 'npm test', timelineWindow: 50, judge: { enabled: false },
  };
  const app = start(cfg);
  try {
    const port = await listening(app);
    await waitFor(() => app.model.getSnapshot(Date.now()).sessions.length > 0);
    const ok = await httpPost(port, '/api/sessions/t1/agents/main/role', { facets: ['pm'] });
    assert.strictEqual(ok.status, 200);
    const parsed = JSON.parse(ok.body);
    assert.strictEqual(parsed.role.role, 'pm');
    assert.strictEqual(parsed.role.source, 'manual');
    // reflected in the session summary
    const sm = app.model.getSnapshot(Date.now()).sessions.find((s) => s.sessionId === 't1');
    assert.strictEqual(sm.mainRole.source, 'manual');
    // unknown session → 404
    const miss = await httpPost(port, '/api/sessions/nope/agents/main/role', { facets: ['pm'] });
    assert.strictEqual(miss.status, 404);
  } finally {
    app.stop();
  }
});

test('server: multi-project — snapshot lists projects discovered from projectsRoot', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loopscore-root-'));
  const mk = (proj, sid, cwd) => {
    const dir = path.join(root, proj);
    fs.mkdirSync(dir, { recursive: true });
    const line = { type: 'user', sessionId: sid, timestamp: '2026-06-13T12:00:00Z', uuid: sid + '1',
      cwd, message: { role: 'user', content: 'hi' } };
    fs.writeFileSync(path.join(dir, sid + '.jsonl'), JSON.stringify(line) + '\n');
  };
  mk('-Users-u-sample-app', 's1', '/Users/u/sample-app');
  mk('-Users-u-crm-demo', 's2', '/Users/u/crm-demo');
  const cfg = { projectsRoot: root, port: 0, idleSeconds: 60, loopErrorStreak: 3, pollMs: 0,
    testCommandPattern: 'npm test', timelineWindow: 50, judge: { enabled: false } };
  const app = start(cfg);
  try {
    const port = await listening(app);
    await waitFor(() => (app.model.getSnapshot(Date.now()).projects || []).length >= 2);
    const snap = JSON.parse((await httpGet(port, '/api/snapshot')).body);
    assert.ok(snap.projects.length >= 2);
    assert.ok(snap.projects.find((p) => p.name === 'sample-app'));
    assert.strictEqual(snap.sessions.find((s) => s.sessionId === 's1').projectId, '-Users-u-sample-app');
  } finally {
    app.stop();
  }
});

test('server: GET /api/history returns store records; missing projectId → 400', async () => {
  const dir = tmpTranscriptDir();
  const fakeStore = {
    append() {},
    query(q) { return q.projectId === 'P1' ? [{ ts: 1, projectId: 'P1', scope: 'session', firstPassRate: 0.9 }] : []; },
  };
  const cfg = { projectsRoot: dir, port: 0, idleSeconds: 60, loopErrorStreak: 3, pollMs: 0,
    testCommandPattern: 'npm test', timelineWindow: 50, judge: { enabled: false }, historyIntervalMs: 999999 };
  const app = start(cfg, { store: fakeStore });
  try {
    const port = await listening(app);
    const ok = JSON.parse((await httpGet(port, '/api/history?projectId=P1')).body);
    assert.strictEqual(ok.records.length, 1);
    assert.strictEqual(ok.records[0].firstPassRate, 0.9);
    const bad = await httpGet(port, '/api/history');
    assert.strictEqual(bad.status, 400);
  } finally {
    app.stop();
  }
});

test('server: /api/trends and /api/uplift compute over store records', async () => {
  const dir = tmpTranscriptDir();
  const recs = [
    { ts: Date.parse('2026-06-28T01:00:00Z'), projectId: 'P1', scope: 'session', firstPassRate: 0.6, skills: ['tdd'] },
    { ts: Date.parse('2026-06-28T05:00:00Z'), projectId: 'P1', scope: 'session', firstPassRate: 0.8, skills: ['tdd'] },
    { ts: Date.parse('2026-06-29T05:00:00Z'), projectId: 'P1', scope: 'session', firstPassRate: 0.4, skills: [] },
  ];
  const fakeStore = { append() {}, query(q) { return q.projectId === 'P1' ? recs : []; } };
  const cfg = { projectsRoot: dir, port: 0, idleSeconds: 60, loopErrorStreak: 3, pollMs: 0,
    testCommandPattern: 'npm test', timelineWindow: 50, judge: { enabled: false }, historyIntervalMs: 999999 };
  const app = start(cfg, { store: fakeStore });
  try {
    const port = await listening(app);
    const tr = JSON.parse((await httpGet(port, '/api/trends?projectId=P1&metric=firstPassRate&bucket=day')).body);
    assert.strictEqual(tr.series.length, 2);
    assert.strictEqual(tr.series[0].avg, 0.7);
    const up = JSON.parse((await httpGet(port, '/api/uplift?projectId=P1&skill=tdd&metric=firstPassRate')).body);
    assert.strictEqual(up.uplift.withSkill.n, 2);
    assert.strictEqual(up.uplift.without.n, 1);
    assert.ok(up.uplift.delta > 0);
    // no skill → uplift for every skill seen
    const all = JSON.parse((await httpGet(port, '/api/uplift?projectId=P1')).body);
    assert.ok(Array.isArray(all.uplifts) && all.uplifts.find((u) => u.skill === 'tdd'));
    const bad = await httpGet(port, '/api/uplift');
    assert.strictEqual(bad.status, 400);
  } finally {
    app.stop();
  }
});

test('server: /api/config/llm lists providers (key presence only) and switches active', async () => {
  const dir = tmpTranscriptDir();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'loopscore-llmsw-'));
  const cfg = {
    projectsRoot: dir, port: 0, idleSeconds: 60, loopErrorStreak: 3, pollMs: 0,
    testCommandPattern: 'npm test', timelineWindow: 50, judge: { enabled: false }, historyIntervalMs: 999999,
    localConfigFile: path.join(work, 'loopscore.local.json'), envFile: path.join(work, '.env'),
    llm: { active: 'p1', providers: [
      { id: 'p1', provider: 'anthropic-compatible', model: 'test-model', apiKeyEnv: 'LOOPSCORE_NOKEY_A' },
      { id: 'anthropic', provider: 'anthropic', model: 'claude', apiKeyEnv: 'LOOPSCORE_NOKEY_B' },
    ] },
  };
  const app = start(cfg);
  try {
    const port = await listening(app);
    const got = JSON.parse((await httpGet(port, '/api/config/llm')).body);
    assert.strictEqual(got.active, 'p1');
    assert.strictEqual(got.providers.length, 2);
    assert.ok(got.providers.every((p) => 'keyPresent' in p));
    assert.ok(!JSON.stringify(got).toLowerCase().includes('apikey') || !JSON.stringify(got).includes('sk-'));
    // switch active
    const data = Buffer.from(JSON.stringify({ active: 'anthropic' }));
    const switched = await new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port, path: '/api/config/llm', method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': data.length } },
        (res) => { const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString() })); });
      r.on('error', reject); r.end(data);
    });
    assert.strictEqual(switched.status, 200);
    assert.strictEqual(JSON.parse(switched.body).active, 'anthropic');
    assert.strictEqual(app.registry.activeId(), 'anthropic');
  } finally {
    app.stop();
  }
});

test('server: no new runtime npm dependencies were introduced', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0,
    `expected zero runtime deps in root package.json, got: ${JSON.stringify(pkg.dependencies)}`);
});

test('server: LLM config UI endpoints — CRUD + key + enabled, all persisted, key never leaks', async () => {
  const dir = tmpTranscriptDir();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'loopscore-llmcfg-'));
  const localFile = path.join(work, 'loopscore.local.json');
  const envFile = path.join(work, '.env');
  delete process.env.LOOPSCORE_UITEST_KEY;
  const cfg = {
    projectsRoot: dir, port: 0, idleSeconds: 60, loopErrorStreak: 3, pollMs: 0,
    testCommandPattern: 'npm test', timelineWindow: 50, historyIntervalMs: 999999,
    localConfigFile: localFile, envFile,
    judge: { enabled: false },
    llm: { active: 'p1', providers: [{ id: 'p1', provider: 'anthropic-compatible', model: 'test-model', temperature: 1, apiKeyEnv: 'LOOPSCORE_UITEST_KEY' }] },
  };
  const app = start(cfg);
  try {
    const port = await listening(app);

    // GET now exposes `enabled` + full non-secret provider fields
    const g0 = JSON.parse((await httpGet(port, '/api/config/llm')).body);
    assert.strictEqual(g0.enabled, false);
    assert.strictEqual(g0.providers[0].temperature, 1);
    assert.strictEqual(g0.providers[0].keyPresent, false);

    // toggle judge enabled → persisted to local.json
    const e1 = await httpPost(port, '/api/config/llm', { enabled: true });
    assert.strictEqual(e1.status, 200);
    assert.strictEqual(JSON.parse(e1.body).enabled, true);
    assert.strictEqual(JSON.parse(fs.readFileSync(localFile, 'utf8')).judge.enabled, true);

    // add a provider → appears in registry + persisted
    const up = await httpPost(port, '/api/config/llm', { upsertProvider: { id: 'oai', provider: 'openai-compatible', model: 'gpt-x', apiKeyEnv: 'LOOPSCORE_UITEST_KEY' } });
    assert.strictEqual(up.status, 200);
    assert.ok(app.registry.list().find((p) => p.id === 'oai'));
    const localAfterUpsert = JSON.parse(fs.readFileSync(localFile, 'utf8'));
    assert.ok(localAfterUpsert.llm.providers.find((p) => p.id === 'oai'));

    // set the API key → written to .env (gitignored), keyPresent flips, value NEVER returned
    const sk = await httpPost(port, '/api/config/llm', { setKey: { env: 'LOOPSCORE_UITEST_KEY', value: 'sk-super-secret' } });
    assert.strictEqual(sk.status, 200);
    assert.ok(!sk.body.includes('sk-super-secret'), 'response must never echo the key');
    assert.ok(fs.readFileSync(envFile, 'utf8').includes('LOOPSCORE_UITEST_KEY=sk-super-secret'), 'key written to .env');
    assert.ok(!fs.readFileSync(localFile, 'utf8').includes('sk-super-secret'), 'key must NOT land in local.json');
    const g1 = JSON.parse((await httpGet(port, '/api/config/llm')).body);
    assert.strictEqual(g1.providers.find((p) => p.id === 'p1').keyPresent, true); // live flip

    // judging is now live (enabled + active provider has a key) without a restart
    assert.strictEqual(app.isJudgingLive(), true);

    // delete a provider
    const del = await httpPost(port, '/api/config/llm', { deleteProvider: 'oai' });
    assert.strictEqual(del.status, 200);
    assert.ok(!app.registry.list().find((p) => p.id === 'oai'));

    // invalid env var name on setKey → 400, nothing written
    const badEnv = await httpPost(port, '/api/config/llm', { setKey: { env: 'bad name!', value: 'x' } });
    assert.strictEqual(badEnv.status, 400);
  } finally {
    app.stop();
    delete process.env.LOOPSCORE_UITEST_KEY;
  }
});

function httpPostHeaders(port, urlPath, bodyObj, extraHeaders) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(bodyObj));
    const req = http.request(
      { host: '127.0.0.1', port, path: urlPath, method: 'POST',
        headers: Object.assign({ 'content-type': 'application/json', 'content-length': data.length }, extraHeaders || {}) },
      (res) => { const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString() })); }
    );
    req.on('error', reject);
    req.end(data);
  });
}

test('server: mutating POST is localhost-only — foreign Origin / Host rejected (DNS-rebind/CSRF guard)', async () => {
  const dir = tmpTranscriptDir();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'loopscore-guard-'));
  const cfg = {
    projectsRoot: dir, port: 0, idleSeconds: 60, loopErrorStreak: 3, pollMs: 0,
    testCommandPattern: 'npm test', timelineWindow: 50, judge: { enabled: false }, historyIntervalMs: 999999,
    localConfigFile: path.join(work, 'loopscore.local.json'), envFile: path.join(work, '.env'),
    llm: { active: 'a', providers: [{ id: 'a', model: 'm', apiKeyEnv: 'LOOPSCORE_NOKEY_X' }] },
  };
  const app = start(cfg);
  try {
    const port = await listening(app);
    // cross-site Origin → 403
    const evilOrigin = await httpPostHeaders(port, '/api/config/llm', { enabled: true }, { Origin: 'http://evil.example.com' });
    assert.strictEqual(evilOrigin.status, 403);
    // rebinding Host (attacker domain in Host header) → 403
    const evilHost = await httpPostHeaders(port, '/api/config/llm', { enabled: true }, { Host: 'attacker.com' });
    assert.strictEqual(evilHost.status, 403);
    // localhost Origin → allowed
    const okOrigin = await httpPostHeaders(port, '/api/config/llm', { enabled: true }, { Origin: `http://127.0.0.1:${port}` });
    assert.strictEqual(okOrigin.status, 200);
    // no Origin (curl / native) → allowed
    const noOrigin = await httpPostHeaders(port, '/api/config/llm', { active: 'a' }, {});
    assert.strictEqual(noOrigin.status, 200);
  } finally {
    app.stop();
  }
});
