'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { realExec } = require('../src/goldenRunner');

// realExec is the real shell I/O adapter injected into goldenHarness — exercise it directly
// (the orchestration is tested with mocks in goldenHarness.test.js, but the actual exit-code
// capture was previously unverified).

test('realExec: captures a non-zero exit code without rejecting', async () => {
  const r = await realExec('exit 3');
  assert.strictEqual(r.code, 3);
});

test('realExec: code 0 + stdout on success', async () => {
  const r = await realExec('echo hello');
  assert.strictEqual(r.code, 0);
  assert.match(r.stdout, /hello/);
});

test('realExec: captures stderr', async () => {
  const r = await realExec('echo oops 1>&2');
  assert.match(r.stderr, /oops/);
});
