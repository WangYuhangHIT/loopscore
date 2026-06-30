// SubAgentRoster — the sub-agent team view inside a single AgentPanel (US-010).
//
// Wire shape recap:
//   • session.agents          : AgentSummary[] (compact roll-up, capped at
//                               `agentsShown=16` server-side, sorted recent-first).
//   • session.agentTotal/agentsLive : counters for the header.
//   • events                  : the per-session 500-cap ring already routed by
//                               the reducer; sub-agent events carry `agentId`,
//                               main events do not. We filter by agentId to
//                               derive each sub-agent's own micro-stream.
//
// Visual distinction from the main loop (acceptance criterion: distinguish the
// main timeline from sub-agent lanes): the roster sits in a mauve-tinted card with a left
// accent strip. Main `SwimlaneTimeline` stays neutral. Sub-agent rows carry
// the same `classifyEvent()` chip pipeline as the main lane for consistency,
// but tighter (single-line, no header).
//
// Purification: the main session's evaluation score is computed on
// `s.timeline` (main-only) server-side — see `sessionModel.js` `applyEvent`.
// This component is a pure read of `session.agents` + the events ring and does
// NOT feed back into scoring; the existing purification contract is preserved
// by construction.

import { cn } from '@/lib/utils';
import { classifyEvent, CHIP_COLOR_TO_CLASSES } from '@/lib/eventChip';
import type { AgentSummary, NormalizedEvent } from '@/types/dashboard';
import { RoleBadge } from './RoleBadge';

export type SubAgentRosterProps = {
  sessionId: string;
  agents: AgentSummary[];
  agentTotal: number;
  agentsLive: number;
  events: NormalizedEvent[];
  miniStreamWindow?: number;
};

function shortType(t: string | null | undefined): string {
  if (!t) return 'agent';
  return t === 'general-purpose' ? 'gen' : t;
}

// Concern count → traffic-light color, mirrors the main panel's good/ok/concern rating.
function concernColor(concerns: number): string {
  if (concerns === 0) return 'var(--neon-green)';
  if (concerns <= 2) return 'var(--neon-yellow)';
  return 'var(--neon-red)';
}

export function SubAgentRoster({
  sessionId,
  agents,
  agentTotal,
  agentsLive,
  events,
  miniStreamWindow = 6,
}: SubAgentRosterProps) {
  // Empty-state mirrors public/app.js: "no sub-agents spawned in this session".
  if (!agentTotal || agents.length === 0) {
    return (
      <section
        aria-label="sub-agent roster"
        className="rounded-md border border-dashed border-border/70 bg-background/40 px-3 py-3"
      >
        <div className="flex items-center justify-between text-[14px] uppercase tracking-wider text-muted-foreground">
          <span>Sub-agent team</span>
          <span>Single session</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground/80">No sub-agents spawned this session</p>
      </section>
    );
  }

  // Build agentId → recent events index from the per-session events ring so
  // each sub-agent gets its own micro-stream. Truncate per agent so a chatty
  // sub-agent can't crowd the others.
  const perAgent: Record<string, NormalizedEvent[]> = {};
  for (const ev of events) {
    if (!ev.agentId) continue;
    const bucket = perAgent[ev.agentId] || (perAgent[ev.agentId] = []);
    bucket.push(ev);
  }

  return (
    <section
      aria-label="sub-agent roster"
      className={cn(
        'rounded-md border border-neon-mauve/25 border-l-2 border-l-neon-mauve/60',
        'bg-neon-mauve/5 px-3 py-2.5',
      )}
    >
      <div className="flex items-center justify-between text-[14px] uppercase tracking-wider text-neon-mauve/85">
        <span>Sub-agent team</span>
        <span>
          Live <span className="font-mono text-foreground/90">{agentsLive}</span>
          {' / total '}
          <span className="font-mono text-foreground/90">{agentTotal}</span>
        </span>
      </div>
      <ul className="mt-2 flex flex-col gap-1.5">
        {agents.map((a) => {
          const stream = (perAgent[a.agentId] || []).slice(-miniStreamWindow);
          return (
            <AgentRosterRow key={a.agentId} sessionId={sessionId} agent={a} stream={stream} />
          );
        })}
      </ul>
    </section>
  );
}

function AgentRosterRow({
  sessionId,
  agent,
  stream,
}: {
  sessionId: string;
  agent: AgentSummary;
  stream: NormalizedEvent[];
}) {
  const isLive = agent.status === 'live';
  const lastChip = agent.last ? classifyEvent(agent.last) : null;
  const lastPalette = lastChip ? CHIP_COLOR_TO_CLASSES[lastChip.color] : null;
  // Phase 2: this sub-agent's own core evaluation (scored on its own lane events).
  const evalResult = agent.evaluation;
  const concerns = evalResult?.overall?.concerns ?? null;
  const label = evalResult?.overall?.label ?? null;
  const fpr = evalResult?.capability?.firstPassRate ?? null;

  return (
    <li className="flex flex-col gap-1 rounded border border-border/40 bg-background/30 px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-1.5 text-[15px]">
        <span
          className={cn(
            'inline-flex h-2 w-2 shrink-0 rounded-full',
            isLive
              ? 'bg-neon-mauve shadow-[0_0_6px_var(--neon-mauve)]'
              : 'bg-[var(--neon-overlay)]/60',
          )}
          aria-label={agent.status}
        />
        <span className="shrink-0 font-mono uppercase tracking-wider text-neon-mauve/90">
          {shortType(agent.agentType)}
        </span>
        <span
          className="shrink-0 truncate font-mono text-foreground/80"
          title={agent.agentId}
        >
          {agent.agentId.slice(0, 6)}
        </span>
        <RoleBadge sessionId={sessionId} agentId={agent.agentId} role={agent.role} tone="mauve" />
        <span className="ml-auto shrink-0 font-mono text-[14px] text-muted-foreground">
          {agent.eventCount}ev
        </span>
        {lastChip && lastPalette ? (
          <span
            title={lastChip.title}
            className={cn(
              'shrink-0 rounded border px-1 font-mono text-[14px] uppercase tracking-wider',
              lastPalette.text,
              lastPalette.bg,
              lastPalette.border,
            )}
            style={{ maxWidth: '7rem' }}
          >
            <span className="truncate">{lastChip.label}</span>
          </span>
        ) : null}
      </div>
      {evalResult && concerns !== null ? (
        <div className="flex items-center gap-2 text-[14px] text-muted-foreground">
          <span
            className="inline-flex items-center gap-1 font-mono uppercase tracking-wider"
            style={{ color: concernColor(concerns) }}
            title={`core eval · ${concerns} concern${concerns === 1 ? '' : 's'} across 7 dims`}
          >
            <span
              className="inline-flex h-1.5 w-1.5 rounded-full"
              style={{ background: concernColor(concerns) }}
            />
            {label}
          </span>
          {fpr !== null ? (
            <span className="font-mono" title="first-pass rate (rolling): tool_results that succeeded first try">
              first-pass <span className="text-foreground/80">{Math.round(fpr * 100)}%</span>
            </span>
          ) : null}
        </div>
      ) : null}
      {stream.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          {stream.map((ev, i) => {
            const c = classifyEvent(ev);
            const palette = CHIP_COLOR_TO_CLASSES[c.color];
            return (
              <span
                key={`${ev.ts ?? ''}-${i}`}
                title={c.title}
                className={cn(
                  'inline-flex h-2.5 w-2.5 rounded-sm border',
                  palette.bg,
                  palette.border,
                )}
                aria-label={c.label}
              />
            );
          })}
        </div>
      ) : agent.last ? (
        <p className="truncate text-[14px] text-muted-foreground/80" title={String(lastChip?.title ?? '')}>
          {lastChip?.text || lastChip?.label || ''}
        </p>
      ) : null}
    </li>
  );
}
