'use strict';
/**
 * adapter.js — THE single place that knows Claude Code's transcript JSONL format.
 * Everything format-specific lives here so drift is contained (see spec FR-010).
 *
 *   normalize(rawLine) -> Event | null   (null = irrelevant/garbage; never throws)
 *   schemaCheck(lines) -> { ok, warnings }
 */

const SNIPPET_MAX = 200;

function trunc(s, n = SNIPPET_MAX) {
  if (typeof s !== 'string') return undefined;
  return s.length <= n ? s : s.slice(0, n) + '…';
}

function firstLine(s) {
  if (typeof s !== 'string') return undefined;
  return s.split('\n')[0];
}

// Pull a plain-text preview out of a tool_result content (string or block array).
// Prefer an explicit text/`text` block over the first stringy block, so an image or
// other non-text block ordered first can't short-circuit the preview.
function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const textBlock = content.find((i) => i && i.type === 'text' && typeof i.text === 'string');
    if (textBlock) return textBlock.text;
    for (const item of content) {
      if (typeof item === 'string') return item;
      if (item && typeof item.text === 'string') return item.text;
      if (item && typeof item.content === 'string') return item.content;
    }
  }
  return undefined;
}

const SKIP_TYPES = new Set(['attachment', 'last-prompt', 'queue-operation']);

function normalize(rawLine) {
  let d;
  try { d = JSON.parse(rawLine); } catch { return null; }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;

  const type = d.type;
  if (!type || SKIP_TYPES.has(type)) return null;

  const ev = {
    ts: d.timestamp,
    sessionId: d.sessionId,
    lane: d.isSidechain === true ? 'sidechain' : 'main',
    uuid: d.uuid,
    parentUuid: d.parentUuid,
    gitBranch: d.gitBranch,
    cwd: d.cwd,
  };

  // Sub-agent identity. Subagent transcripts live in <sessionId>/subagents/agent-<id>.jsonl;
  // each line carries the PARENT sessionId plus its own agentId + attributionAgent (the
  // agent type, e.g. "general-purpose"). This is what lets us split sidechain into one
  // lane per sub-agent instead of a single aggregate.
  if (d.agentId) ev.agentId = d.agentId;
  if (d.attributionAgent) ev.agentType = d.attributionAgent;

  // Line-level attribution (rides on whatever the turn is doing).
  if (d.attributionSkill) ev.skill = d.attributionSkill;
  if (d.attributionMcpServer) ev.mcpServer = d.attributionMcpServer;
  if (d.attributionMcpTool) ev.mcpTool = d.attributionMcpTool;

  const usage = d.message && d.message.usage;
  if (usage && (usage.input_tokens != null || usage.output_tokens != null)) {
    // Cache tokens (cache_read/cache_creation) are a large fraction of real input on
    // Claude transcripts — capture them so token/cost totals aren't silently low.
    ev.usage = {
      inputTokens: Number(usage.input_tokens) || 0,
      outputTokens: Number(usage.output_tokens) || 0,
      cacheReadTokens: Number(usage.cache_read_input_tokens) || 0,
      cacheCreationTokens: Number(usage.cache_creation_input_tokens) || 0,
    };
  }

  // --- system entries (hooks) ---
  if (type === 'system') {
    if (String(d.subtype || '').endsWith('_hook_summary')) {
      ev.kind = 'hook';
      ev.hook = {
        subtype: d.subtype,
        count: d.hookCount || 0,
        errors: Array.isArray(d.hookErrors) ? d.hookErrors : [],
        prevented: !!d.preventedContinuation,
      };
    } else {
      ev.kind = 'system';
    }
    return ev;
  }

  // --- user / assistant entries (inspect message content) ---
  const content = d.message && d.message.content;

  // content may be a plain string (typed user text)
  if (typeof content === 'string') {
    ev.kind = type === 'user' ? 'user' : 'assistant_text';
    ev.textSnippet = trunc(content);
    return ev;
  }

  if (Array.isArray(content)) {
    const toolUse = content.find((i) => i && i.type === 'tool_use');
    const toolResult = content.find((i) => i && i.type === 'tool_result');
    const thinking = content.find((i) => i && i.type === 'thinking');
    const text = content.find((i) => i && i.type === 'text');

    if (toolUse) {
      ev.kind = 'tool_use';
      ev.tool = toolUse.name;
      if (toolUse.id) ev.toolUseId = toolUse.id; // lets scoring pair a result to its OWN call
      const input = toolUse.input || {};
      if (typeof input.command === 'string') ev.command = trunc(input.command, 500);
      if (typeof input.file_path === 'string') ev.filePath = input.file_path; // for blast-radius / context
      ev.textSnippet = trunc(input.description || input.command || input.file_path || '');
      return ev;
    }
    if (toolResult) {
      ev.kind = 'tool_result';
      if (toolResult.tool_use_id) ev.toolUseId = toolResult.tool_use_id; // pairs back to the tool_use
      ev.isError = !!toolResult.is_error;
      const txt = resultText(toolResult.content);
      if (ev.isError) ev.errorSig = trunc(firstLine(txt), 160);
      ev.textSnippet = trunc(txt);
      return ev;
    }
    if (thinking) {
      ev.kind = 'thinking';
      ev.textSnippet = trunc(thinking.thinking);
      return ev;
    }
    if (text) {
      ev.kind = type === 'user' ? 'user' : 'assistant_text';
      ev.textSnippet = trunc(text.text);
      return ev;
    }
  }

  // user/assistant with no recognizable content
  ev.kind = type === 'user' ? 'user' : 'assistant_text';
  return ev;
}

/**
 * schemaCheck — given a sample of raw lines, verify the attribution anchors the
 * adapter relies on still appear. If a session shows assistant activity but none
 * of (tool_use name / attributionSkill / attributionMcpTool / hook subtype) are
 * present, the format may have drifted — surface a warning (FR-010), never silent.
 */
function schemaCheck(lines) {
  const warnings = [];
  let parsedAny = false, sawAssistant = false, sawToolUse = false, sawAttribution = false, sawHook = false;
  for (const line of lines) {
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if (!d || typeof d !== 'object') continue;
    parsedAny = true;
    if (d.type === 'assistant') sawAssistant = true;
    if (d.attributionSkill || d.attributionMcpTool) sawAttribution = true;
    if (d.type === 'system' && String(d.subtype || '').endsWith('_hook_summary')) sawHook = true;
    const c = d.message && d.message.content;
    if (Array.isArray(c) && c.some((i) => i && i.type === 'tool_use' && i.name)) sawToolUse = true;
  }
  if (!parsedAny) warnings.push('no parseable transcript lines in sample');
  if (sawAssistant && !sawToolUse && !sawAttribution && !sawHook) {
    warnings.push('expected attribution anchors (tool_use name / attributionSkill / attributionMcpTool / hook subtype) all absent — transcript format may have drifted');
  }
  return { ok: warnings.length === 0, warnings };
}

module.exports = { normalize, schemaCheck };
