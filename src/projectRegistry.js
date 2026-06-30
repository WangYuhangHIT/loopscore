'use strict';
/**
 * projectRegistry.js — discover the Claude Code projects under ~/.claude/projects.
 * Each immediate subdir = one project; its name is cwd with '/' replaced by '-'. That
 * encoding is LOSSY (a real '-' in the path is indistinguishable from a separator '-'),
 * so projectId = the dir name (stable key) and the ACCURATE path/name comes from an
 * event's `cwd` later (handled in sessionModel). decodeProjectDir only provides a
 * best-effort display name before any event arrives. PURE except discover() which lists
 * a directory (read-only). Zero-dep.
 */
const fs = require('node:fs');
const path = require('node:path');

// Best-effort display name from the encoded dir. When the encoded homedir is a prefix
// (the common case: a project directly under home), strip it so the bare folder name
// shows with hyphens intact; otherwise fall back to the last '-' segment.
function decodeProjectDir(dirName, homedir) {
  const encodedHome = homedir ? homedir.replace(/\//g, '-') : ''; // '/Users/dev' -> '-Users-dev'
  let name;
  if (encodedHome && dirName.startsWith(encodedHome + '-')) {
    name = dirName.slice(encodedHome.length + 1);
  } else {
    const parts = dirName.replace(/^-/, '').split('-');
    name = parts[parts.length - 1] || dirName;
  }
  return { projectId: dirName, name: name || dirName };
}

// projectId = the first path segment under projectsRoot. null if filePath is not under
// root (defensive; the tailer always reports paths under root).
function projectIdForPath(projectsRoot, filePath) {
  const rel = path.relative(projectsRoot, filePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const seg = rel.split(path.sep)[0];
  return seg || null;
}

// List immediate subdirs of projectsRoot as projects (read-only). Never throws.
function discover(projectsRoot, homedir) {
  let entries;
  try { entries = fs.readdirSync(projectsRoot, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    out.push(decodeProjectDir(ent.name, homedir));
  }
  return out;
}

module.exports = { decodeProjectDir, projectIdForPath, discover };
