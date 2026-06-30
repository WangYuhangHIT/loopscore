'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { normalize, schemaCheck } = require('../src/adapter');

function loadFixtures() {
  const raw = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.jsonl'), 'utf8');
  // non-comment, non-empty lines
  return raw.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
}

// Fixture order is fixed by the extraction script:
const ORDER = ['user_text', 'assistant_tool_use', 'bash_tool_use', 'tool_result',
  'skill', 'mcp', 'hook_system', 'assistant_thinking'];

function byLabel() {
  const lines = loadFixtures();
  const map = {};
  ORDER.forEach((label, i) => { map[label] = lines[i]; });
  return map;
}

test('normalize: garbage / comment lines return null (never throw)', () => {
  assert.strictEqual(normalize('# a comment'), null);
  assert.strictEqual(normalize('not json at all {'), null);
  assert.strictEqual(normalize(''), null);
});

test('normalize: user text → kind=user', () => {
  const e = normalize(byLabel().user_text);
  assert.strictEqual(e.kind, 'user');
  assert.strictEqual(e.lane, 'main');
  assert.ok(e.sessionId);
});

test('normalize: assistant tool_use (Read) → kind=tool_use, tool=Read', () => {
  const e = normalize(byLabel().assistant_tool_use);
  assert.strictEqual(e.kind, 'tool_use');
  assert.strictEqual(e.tool, 'Read');
});

test('normalize: Bash tool_use → tool=Bash with command captured', () => {
  const e = normalize(byLabel().bash_tool_use);
  assert.strictEqual(e.kind, 'tool_use');
  assert.strictEqual(e.tool, 'Bash');
  assert.strictEqual(typeof e.command, 'string');
  assert.ok(e.command.length > 0);
});

test('normalize: tool_result → kind=tool_result, isError falsey for success', () => {
  const e = normalize(byLabel().tool_result);
  assert.strictEqual(e.kind, 'tool_result');
  assert.ok(!e.isError);
});

test('normalize: error tool_result (synthetic) → isError true + errorSig', () => {
  const line = JSON.stringify({
    type: 'user', sessionId: 's1', timestamp: '2026-06-13T00:00:00Z', uuid: 'u1',
    message: { role: 'user', content: [{ type: 'tool_result', is_error: true,
      content: 'Error: command failed\n  at line 3' }] },
  });
  const e = normalize(line);
  assert.strictEqual(e.kind, 'tool_result');
  assert.strictEqual(e.isError, true);
  assert.ok(e.errorSig && e.errorSig.startsWith('Error: command failed'));
});

test('normalize: skill attribution attached (langfuse) on thinking turn', () => {
  const e = normalize(byLabel().skill);
  assert.strictEqual(e.skill, 'langfuse');
  assert.strictEqual(e.kind, 'thinking');
});

test('normalize: MCP call → tool=mcp__*, mcpServer/mcpTool captured', () => {
  const e = normalize(byLabel().mcp);
  assert.strictEqual(e.kind, 'tool_use');
  assert.ok(e.tool.startsWith('mcp__'));
  assert.strictEqual(e.mcpServer, 'Claude in Chrome');
  assert.strictEqual(e.mcpTool, 'tabs_context_mcp');
});

test('normalize: hook summary → kind=hook with subtype/count/prevented', () => {
  const e = normalize(byLabel().hook_system);
  assert.strictEqual(e.kind, 'hook');
  assert.strictEqual(e.hook.subtype, 'stop_hook_summary');
  assert.strictEqual(e.hook.count, 2);
  assert.strictEqual(e.hook.prevented, false);
});

test('normalize: sidechain flag maps to lane=sidechain', () => {
  const line = JSON.stringify({
    type: 'assistant', sessionId: 's1', timestamp: '2026-06-13T00:00:00Z', uuid: 'u2',
    isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
  });
  const e = normalize(line);
  assert.strictEqual(e.lane, 'sidechain');
});

test('normalize: subagent line carries agentId + agentType (attributionAgent)', () => {
  const line = JSON.stringify({
    type: 'user', sessionId: 'parent-sid', timestamp: '2026-06-13T00:00:00Z', uuid: 'u9',
    isSidechain: true, agentId: 'aa4456ad51df4ced5', attributionAgent: 'general-purpose',
    message: { role: 'user', content: [{ type: 'text', text: 'do the thing' }] },
  });
  const e = normalize(line);
  assert.strictEqual(e.sessionId, 'parent-sid'); // grouped under PARENT session
  assert.strictEqual(e.agentId, 'aa4456ad51df4ced5');
  assert.strictEqual(e.agentType, 'general-purpose');
  assert.strictEqual(e.lane, 'sidechain');
});

test('normalize: main-session line has no agentId/agentType', () => {
  const e = normalize(byLabel().user_text);
  assert.strictEqual(e.agentId, undefined);
  assert.strictEqual(e.agentType, undefined);
});

test('normalize: filePath captured for file tools (Read/Edit/Write)', () => {
  const e = normalize(byLabel().assistant_tool_use); // a Read with input.file_path
  assert.strictEqual(typeof e.filePath, 'string');
  assert.ok(e.filePath.length > 0);
});

test('normalize: usage tokens captured from assistant message', () => {
  const e = normalize(byLabel().assistant_tool_use);
  assert.ok(e.usage);
  assert.strictEqual(typeof e.usage.inputTokens, 'number');
  assert.strictEqual(typeof e.usage.outputTokens, 'number');
});

test('normalize: textSnippet is truncated (no full dumps)', () => {
  const big = 'x'.repeat(5000);
  const line = JSON.stringify({
    type: 'assistant', sessionId: 's1', timestamp: '2026-06-13T00:00:00Z', uuid: 'u3',
    message: { role: 'assistant', content: [{ type: 'text', text: big }] },
  });
  const e = normalize(line);
  assert.ok(e.textSnippet.length <= 210);
});

test('schemaCheck: ok=true when attribution fields present in sample', () => {
  const res = schemaCheck(loadFixtures());
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual(res.warnings, []);
});

test('schemaCheck: warns when expected attribution fields vanish', () => {
  // lines with none of the attribution markers the adapter relies on
  const stripped = [
    JSON.stringify({ type: 'assistant', sessionId: 's', uuid: '1',
      message: { role: 'assistant', content: [{ type: 'text', text: 'a' }] } }),
  ];
  const res = schemaCheck(stripped);
  assert.strictEqual(res.ok, false);
  assert.ok(res.warnings.length > 0);
});

test('normalize: usage captures cache tokens (read + creation), not just input/output', () => {
  const line = JSON.stringify({
    type: 'assistant', sessionId: 's', uuid: 'u', timestamp: '2026-01-01T00:00:00Z',
    message: { role: 'assistant',
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 },
      content: [{ type: 'text', text: 'hi' }] },
  });
  const e = normalize(line);
  assert.strictEqual(e.usage.inputTokens, 10);
  assert.strictEqual(e.usage.cacheReadTokens, 1000);
  assert.strictEqual(e.usage.cacheCreationTokens, 200);
});

test('normalize: tool_use and tool_result carry toolUseId so a result pairs to its OWN call', () => {
  const tu = JSON.stringify({ type: 'assistant', sessionId: 's', uuid: 'u1', timestamp: '2026-01-01T00:00:00Z',
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tid-1', name: 'Bash', input: { command: 'npm test' } }] } });
  const tr = JSON.stringify({ type: 'user', sessionId: 's', uuid: 'u2', timestamp: '2026-01-01T00:00:01Z',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tid-1', content: 'ok' }] } });
  assert.strictEqual(normalize(tu).toolUseId, 'tid-1');
  assert.strictEqual(normalize(tr).toolUseId, 'tid-1');
});
