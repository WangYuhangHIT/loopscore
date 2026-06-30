'use strict';
/**
 * configStore.js — the mutable config layer for UI-driven LLM settings.
 *
 * Three-layer config (see design 2026-06-28): committed `loopscore.config.json` (base,
 * read-only) ← gitignored `loopscore.local.json` (UI-written non-secret overrides:
 * llm.providers / active / judge.enabled) ← gitignored `.env` (API keys only).
 *
 *   readLocal(file)            -> parsed object | {}  (missing/malformed = {}, never throws)
 *   writeLocal(file, obj)      -> void                (pretty JSON)
 *   mergeConfig(base, local)   -> merged config       (deep clone; llm.providers replaced,
 *                                                       judge shallow-merged so a lone
 *                                                       {enabled} toggle keeps base fields)
 *   setEnvKey(file, name, val) -> void                (upsert KEY=val in .env; validates name;
 *                                                       NEVER logs the value)
 *
 * SECRETS: keys live ONLY in .env (gitignored, user-placed via the UI). They are never
 * written to either json file and never returned to the client.
 */

const fs = require('node:fs');

function readLocal(file) {
  let txt;
  try { txt = fs.readFileSync(file, 'utf8'); } catch { return {}; }
  try {
    const v = JSON.parse(txt);
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
}

function writeLocal(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
}

// Deep clone via structuredClone (Node 18+) so merges never alias base/local internals.
const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

function mergeConfig(base = {}, local = {}) {
  const out = clone(base);
  for (const [k, v] of Object.entries(local || {})) {
    if (k === 'judge' && v && typeof v === 'object' && !Array.isArray(v)) {
      out.judge = Object.assign({}, out.judge || {}, clone(v)); // shallow-merge: keep base judge fields
    } else if (k === 'llm' && v && typeof v === 'object' && !Array.isArray(v)) {
      out.llm = Object.assign({}, out.llm || {}, clone(v)); // providers/active replaced wholesale
    } else {
      out[k] = clone(v);
    }
  }
  return out;
}

const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

function setEnvKey(file, name, value) {
  if (typeof name !== 'string' || !ENV_NAME.test(name)) {
    throw new Error(`invalid env var name: ${JSON.stringify(name)}`);
  }
  const val = value == null ? '' : String(value);
  if (/[\r\n]/.test(val)) throw new Error('env value must not contain newlines'); // block KEY=VALUE line injection
  let lines = [];
  try { lines = fs.readFileSync(file, 'utf8').split('\n'); } catch { lines = []; }
  let replaced = false;
  const out = [];
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=/);
    if (m && m[1] === name) {
      if (!replaced) { out.push(`${name}=${val}`); replaced = true; } // drop any duplicates
    } else {
      out.push(line);
    }
  }
  if (!replaced) {
    while (out.length && out[out.length - 1].trim() === '') out.pop(); // trim trailing blanks before append
    out.push(`${name}=${val}`);
  }
  let text = out.join('\n');
  if (!text.endsWith('\n')) text += '\n';
  // 0600 — the .env holds API keys; keep it owner-read/write only (no group/other).
  fs.writeFileSync(file, text, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* best effort if file pre-existed with looser mode */ }
}

module.exports = { readLocal, writeLocal, mergeConfig, setEnvKey };
