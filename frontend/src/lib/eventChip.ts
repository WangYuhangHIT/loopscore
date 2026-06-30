// Pure event → chip classification (US-007 swimlane).
//
// Mirrors public/app.js `classify()` semantics but emits design-token color
// names (CSS custom properties from `index.css` `.dark { --neon-* }`) so the
// view layer can pick a lane color without any string-to-class branching.
//
// Lane-color contract (also documented in index.css):
//   tool_use            → neon-blue
//   tool_use + skill    → neon-mauve
//   tool_use + mcp      → neon-teal
//   tool_result         → neon-overlay      (success / preview)
//   tool_result error   → neon-red
//   hook                → neon-peach
//   thinking + skill    → neon-mauve
//   thinking            → neon-overlay
//   user                → neon-overlay
//   assistant_text      → neon-sky
//   system / unknown    → neon-overlay

import type { NormalizedEvent } from '@/types/dashboard';

export type ChipColor =
  | 'neon-blue'
  | 'neon-mauve'
  | 'neon-peach'
  | 'neon-teal'
  | 'neon-red'
  | 'neon-overlay'
  | 'neon-sky';

export type ChipKind =
  | 'tool'
  | 'skill'
  | 'mcp'
  | 'hook'
  | 'error'
  | 'result'
  | 'user'
  | 'assistant'
  | 'thinking'
  | 'system';

export type ChipClassification = {
  kind: ChipKind;
  color: ChipColor;
  label: string;   // short uppercase badge ("Edit", "MCP", "ERR", "USER", "HOOK")
  text: string;    // truncated chip body
  title: string;   // full hover tooltip (untruncated where reasonable)
};

const TRUNC = 90;

function trunc(s: string | undefined | null, n = TRUNC): string {
  if (!s) return '';
  const flat = String(s).replace(/\s+/g, ' ').trim();
  return flat.length > n ? flat.slice(0, n - 1) + '…' : flat;
}

function pickText(ev: NormalizedEvent): string {
  // Order: explicit error sig > textSnippet > command > filePath > kind
  const errorSig = typeof ev.errorSig === 'string' ? ev.errorSig : '';
  if (errorSig) return errorSig;
  const snippet = typeof ev.textSnippet === 'string' ? ev.textSnippet : '';
  if (snippet) return snippet;
  if (typeof ev.command === 'string') return ev.command;
  if (typeof ev.filePath === 'string') return ev.filePath;
  return ev.kind;
}

export function classifyEvent(ev: NormalizedEvent): ChipClassification {
  const raw = pickText(ev);
  const text = trunc(raw);
  const title = String(raw).slice(0, 400);

  if (ev.kind === 'tool_result') {
    if (ev.isError) {
      return { kind: 'error', color: 'neon-red', label: 'ERR', text, title };
    }
    return { kind: 'result', color: 'neon-overlay', label: 'res', text, title };
  }

  if (ev.kind === 'tool_use') {
    if (typeof ev.mcpServer === 'string' && ev.mcpServer) {
      const mcpTool = typeof ev.mcpTool === 'string' ? ev.mcpTool : '';
      const label = mcpTool ? `${ev.mcpServer}/${mcpTool}` : ev.mcpServer;
      return { kind: 'mcp', color: 'neon-teal', label: trunc(label, 24), text, title };
    }
    if (typeof ev.skill === 'string' && ev.skill) {
      return { kind: 'skill', color: 'neon-mauve', label: trunc(ev.skill, 24), text, title };
    }
    const toolLabel = typeof ev.tool === 'string' && ev.tool ? ev.tool : 'tool';
    return { kind: 'tool', color: 'neon-blue', label: trunc(toolLabel, 24), text, title };
  }

  if (ev.kind === 'hook') {
    const hook = (ev as { hook?: { subtype?: string } }).hook;
    const subtype = hook && typeof hook.subtype === 'string' ? hook.subtype : 'hook';
    return { kind: 'hook', color: 'neon-peach', label: 'HOOK', text: text || subtype, title };
  }

  if (ev.kind === 'thinking') {
    if (typeof ev.skill === 'string' && ev.skill) {
      return { kind: 'skill', color: 'neon-mauve', label: trunc(ev.skill, 24), text, title };
    }
    return { kind: 'thinking', color: 'neon-overlay', label: 'think', text, title };
  }

  if (ev.kind === 'user') {
    return { kind: 'user', color: 'neon-overlay', label: 'USER', text, title };
  }

  if (ev.kind === 'assistant_text') {
    return { kind: 'assistant', color: 'neon-sky', label: 'AI', text, title };
  }

  return { kind: 'system', color: 'neon-overlay', label: ev.kind || 'sys', text, title };
}

// Tailwind v4 reads `--color-neon-*` from `@theme inline` (see index.css), so
// these strings resolve to real utility classes — they are NOT dynamic at run
// time. Listed here so the Tailwind JIT-via-classregex picks them up.
//
//   text-neon-blue  text-neon-mauve  text-neon-peach  text-neon-teal
//   text-neon-red   text-neon-overlay  text-neon-sky
//   bg-neon-blue/15 bg-neon-mauve/15 bg-neon-peach/15 bg-neon-teal/15
//   bg-neon-red/15  bg-neon-overlay/15 bg-neon-sky/15
//   border-neon-blue/30 ... border-neon-sky/30
export const CHIP_COLOR_TO_CLASSES: Record<ChipColor, { text: string; bg: string; border: string }> = {
  'neon-blue':    { text: 'text-neon-blue',    bg: 'bg-neon-blue/15',    border: 'border-neon-blue/30' },
  'neon-mauve':   { text: 'text-neon-mauve',   bg: 'bg-neon-mauve/15',   border: 'border-neon-mauve/30' },
  'neon-peach':   { text: 'text-neon-peach',   bg: 'bg-neon-peach/15',   border: 'border-neon-peach/30' },
  'neon-teal':    { text: 'text-neon-teal',    bg: 'bg-neon-teal/15',    border: 'border-neon-teal/30' },
  'neon-red':     { text: 'text-neon-red',     bg: 'bg-neon-red/15',     border: 'border-neon-red/35' },
  'neon-overlay': { text: 'text-neon-overlay', bg: 'bg-neon-overlay/12', border: 'border-neon-overlay/25' },
  'neon-sky':     { text: 'text-neon-sky',     bg: 'bg-neon-sky/15',     border: 'border-neon-sky/30' },
};
