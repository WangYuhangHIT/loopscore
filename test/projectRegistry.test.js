'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { decodeProjectDir, projectIdForPath, discover } = require('../src/projectRegistry');

test('decodeProjectDir: home-level project → strip home prefix, keep folder name', () => {
  const r = decodeProjectDir('-Users-dev-sample-app', '/Users/dev');
  assert.strictEqual(r.projectId, '-Users-dev-sample-app');
  assert.strictEqual(r.name, 'sample-app');
});

test('decodeProjectDir: hyphenated folder name kept intact (single segment under home)', () => {
  const r = decodeProjectDir('-Users-dev-crm-demo', '/Users/dev');
  assert.strictEqual(r.name, 'crm-demo');
});

test('decodeProjectDir: no home-prefix match → fall back to last segment', () => {
  const r = decodeProjectDir('-opt-work-thing', '/Users/dev');
  assert.strictEqual(r.projectId, '-opt-work-thing');
  assert.ok(r.name && r.name.length > 0);
});

test('projectIdForPath: takes the first path segment under projectsRoot as projectId', () => {
  const root = '/Users/dev/.claude/projects';
  const fp = root + '/-Users-dev-sample-app/subagents/agent-x.jsonl';
  assert.strictEqual(projectIdForPath(root, fp), '-Users-dev-sample-app');
});

test('projectIdForPath: path not under root → null', () => {
  assert.strictEqual(projectIdForPath('/a/b', '/c/d/x.jsonl'), null);
});

test('discover: lists project dirs under projectsRoot, ignores files', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loopscore-proj-'));
  fs.mkdirSync(path.join(tmp, '-Users-dev-sample-app'));
  fs.mkdirSync(path.join(tmp, '-Users-dev-crm-demo'));
  fs.writeFileSync(path.join(tmp, 'not-a-dir.txt'), 'x');
  const list = discover(tmp, '/Users/dev');
  assert.strictEqual(list.length, 2);
  assert.ok(list.find((p) => p.name === 'sample-app'));
  assert.ok(list.find((p) => p.name === 'crm-demo'));
});
