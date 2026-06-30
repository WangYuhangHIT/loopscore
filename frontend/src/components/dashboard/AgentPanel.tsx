// AgentPanel — single-session card.
//   Header  : live/idle dot + sessionId + branch chip + token + age
//   Body 1  : bucket① score block (test / loop / autonomy / usage / token)
//   Body 2  : capability sparkline (first-pass rate + faint stuck-risk)
//   Body 3  : 7-dim performance radar + reviewer note (US-009)
//   Body 4  : sub-agent roster — mauve-tinted, per-agent micro-stream (US-010)
//   Body 5  : bucket② failure verdicts (LLM judgments) — parity with legacy app.js (US-014)
//   Body 6  : main-loop swimlane timeline of kind-colored event chips
//
// US-013: density-aware padding/gap (via --ds-* CSS vars), equal-height in
// grid rows (h-full + swimlane flex-1), and collapsible secondary blocks on
// narrow viewports (capability / 7-dim+note / sub-agent roster wrap in
// <details> default-closed so the panel reads top-to-bottom without a
// 6-section scroll).

import type { CSSProperties, ReactNode } from 'react';
import type {
  CapabilitySample,
  Judgment,
  NormalizedEvent,
  Review,
  SessionSummary,
} from '@/types/dashboard';
import { cn } from '@/lib/utils';
import { Cluster, Truncate } from '@/components/ui/layout';
import { NARROW_QUERY, useMediaQuery } from '@/lib/useMediaQuery';
import { BucketOneScore } from './BucketOneScore';
import { CapabilityChart } from './CapabilityChart';
import { JudgmentsPanel } from './JudgmentsPanel';
import { PerformanceRadar } from './PerformanceRadar';
import { ReviewerNote } from './ReviewerNote';
import { RoleOverlayPanel } from './RoleOverlayPanel';
import { RoleBadge } from './RoleBadge';
import { TeamRollup } from './TeamRollup';
import { SubAgentRoster } from './SubAgentRoster';
import { SwimlaneTimeline } from './SwimlaneTimeline';

export type AgentPanelProps = {
  session: SessionSummary;
  events: NormalizedEvent[];
  capabilityHistory?: CapabilitySample[];
  review?: Review;
  judgments?: Judgment[];
  // Shared low-frequency clock (App-level useNowMs) so the age label keeps
  // advancing on an idle fleet. Optional: falls back to Date.now() at mount.
  nowMs?: number;
  // When provided, the panel header becomes a button that calls this with the
  // session id — that's the wire-up for the US-012 focused/expanded view.
  // Omit (e.g. inside the StageView stage itself) to render a non-interactive header.
  onFocus?: (sessionId: string) => void;
  // Inline bento zoom (Phase 4): when provided, a toggle in the meta row enlarges this
  // panel (and shrinks siblings, handled by the grid wrapper). `zoomed` reflects state.
  onZoom?: (sessionId: string) => void;
  zoomed?: boolean;
};

function projName(p: string | undefined): string {
  if (!p) return 'project';
  const parts = p.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || p;
}

function fmtTokens(n: number | undefined): string {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtAge(lastTs: number | null | undefined, nowMs: number): string {
  if (!lastTs) return '—';
  const s = Math.max(0, Math.round((nowMs - lastTs) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

const PANEL_STYLE: CSSProperties = {
  paddingLeft: 'var(--ds-panel-px, 1rem)',
  paddingRight: 'var(--ds-panel-px, 1rem)',
  paddingTop: 'var(--ds-panel-py, 1rem)',
  paddingBottom: 'var(--ds-panel-py, 1rem)',
  gap: 'var(--ds-panel-gap, 0.75rem)',
  minHeight: 'var(--ds-panel-min, 18rem)',
};

export function AgentPanel({ session, events, capabilityHistory = [], review, judgments, nowMs, onFocus, onZoom, zoomed }: AgentPanelProps) {
  const ageNow = nowMs ?? Date.now();
  const isLive = session.status === 'live';
  // On narrow viewports the panel is single-column; wrap the secondary blocks
  // in <details> so the user can collapse them. Wide viewports always render
  // them expanded, no <details> wrapper.
  const isNarrow = useMediaQuery(NARROW_QUERY);

  const headerInner = (
    <>
      <span
        className={cn(
          'inline-flex h-2 w-2 shrink-0 rounded-full',
          isLive
            ? 'bg-[var(--neon-green)] shadow-[0_0_8px_var(--neon-green)]'
            : 'bg-[var(--neon-overlay)]/60',
        )}
        aria-label={session.status}
      />
      <span
        className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
        title={`${session.project ?? ''}  ·  ${session.sessionId}`}
      >
        <Truncate className="flex-1 text-sm font-semibold text-foreground">{projName(session.project)}</Truncate>
        {session.mainRole?.role && session.mainRole.role !== 'unknown' ? (
          <span className="shrink-0 font-mono text-xs uppercase tracking-wider text-[var(--neon-mauve)]">{session.mainRole.role}</span>
        ) : null}
        <span className="shrink-0 font-mono text-[13px] text-muted-foreground/55">{session.sessionId.slice(0, 8)}</span>
      </span>
      <span
        className={cn(
          'shrink-0 rounded-md border px-1.5 py-0.5 text-[14px] font-mono uppercase tracking-wider',
          isLive
            ? 'border-[var(--neon-green)]/45 text-[var(--neon-green)]'
            : 'border-border text-muted-foreground',
        )}
      >
        {isLive ? 'live' : 'idle'}
      </span>
      {onFocus ? (
        <span
          aria-hidden="true"
          className="shrink-0 font-mono text-[14px] uppercase tracking-widest text-muted-foreground/70 group-hover:text-[var(--neon-mauve)]"
        >
          Focus ↗
        </span>
      ) : null}
    </>
  );

  return (
    <article
      onClick={onFocus ? () => onFocus(session.sessionId) : undefined}
      role={onFocus ? 'button' : undefined}
      aria-label={onFocus ? `Open ${session.sessionId}` : undefined}
      className={cn(
        'group flex h-full w-full min-w-0 flex-col overflow-hidden rounded-xl border border-border',
        'bg-card/70 backdrop-blur-sm text-sm shadow-sm',
        onFocus && 'cursor-pointer transition-shadow hover:border-neon-mauve/40 hover:shadow-md',
      )}
      style={PANEL_STYLE}
    >
      <header className="flex flex-wrap items-center gap-2">{headerInner}</header>

      <Cluster className="gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {session.gitBranch ? (
          <span className="inline-flex min-w-0 max-w-[14rem] items-center gap-1 rounded-md border border-border px-1.5 py-0.5">
            <span className="shrink-0 text-muted-foreground/70">branch</span>
            <Truncate className="font-mono text-foreground/85" title={session.gitBranch}>
              {session.gitBranch}
            </Truncate>
          </span>
        ) : null}
        <RoleBadge sessionId={session.sessionId} agentId="main" role={session.mainRole} tone="sky" />
        <span>
          sub-agents{' '}
          <span className="font-mono text-foreground/85">
            {session.agentsLive}/{session.agentTotal}
          </span>
        </span>
        <span>
          events{' '}
          <span className="font-mono text-foreground/85">{session.eventCount}</span>
        </span>
        <span>
          token{' '}
          <span className="font-mono text-foreground/85">
            {fmtTokens(session.tokens?.total)}
          </span>
        </span>
        <span className="ml-auto">{fmtAge(session.lastTs, ageNow)}</span>
        {onZoom ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onZoom(session.sessionId); }}
            title={zoomed ? 'Shrink' : 'Enlarge'}
            aria-label={zoomed ? 'shrink panel' : 'enlarge panel'}
            className="shrink-0 rounded px-1 font-mono text-xs text-muted-foreground hover:text-[var(--neon-sky)]"
          >
            {zoomed ? '⤡' : '⤢'}
          </button>
        ) : null}
      </Cluster>

      <TeamRollup team={session.team} />

      <BucketOneScore evaluation={session.evaluation} tokens={session.tokens} />

      <CollapsibleOnNarrow narrow={isNarrow} label="Capability chart">
        <CapabilityChart history={capabilityHistory} />
      </CollapsibleOnNarrow>

      <CollapsibleOnNarrow narrow={isNarrow} label="7-dim performance · Manager note">
        <PerformanceRadar evaluation={session.evaluation} role={session.mainRole?.role} />
        <ReviewerNote review={review} />
      </CollapsibleOnNarrow>

      {session.evaluation?.roleOverlay ? (
        <CollapsibleOnNarrow narrow={isNarrow} label="Role overlay">
          <RoleOverlayPanel overlay={session.evaluation.roleOverlay} role={session.mainRole?.role} />
        </CollapsibleOnNarrow>
      ) : null}

      <CollapsibleOnNarrow narrow={isNarrow} label="Sub-agent team">
        <SubAgentRoster
          sessionId={session.sessionId}
          agents={session.agents}
          agentTotal={session.agentTotal}
          agentsLive={session.agentsLive}
          events={events}
        />
      </CollapsibleOnNarrow>

      <CollapsibleOnNarrow narrow={isNarrow} label="Bucket② failure verdicts">
        <JudgmentsPanel judgments={judgments} />
      </CollapsibleOnNarrow>

      <SwimlaneTimeline events={events} title="Main session lane" />
    </article>
  );
}

// CollapsibleOnNarrow — on narrow viewports wraps children in a <details>
// element so users can fold secondary sections; on wide viewports renders the
// children inline (no <details> shell) so nothing is hidden by default.
function CollapsibleOnNarrow({
  narrow,
  label,
  children,
}: {
  narrow: boolean;
  label: string;
  children: ReactNode;
}) {
  if (!narrow) {
    return <>{children}</>;
  }
  return (
    <details
      className={cn(
        'group rounded-md border border-border/60 bg-background/30 px-2 py-1.5',
        'open:bg-background/40',
      )}
    >
      <summary
        className={cn(
          'flex cursor-pointer list-none items-center justify-between gap-2',
          'font-mono text-[14px] uppercase tracking-wider text-muted-foreground',
          'hover:text-foreground',
        )}
      >
        <span>{label}</span>
        <span aria-hidden="true" className="text-muted-foreground/60 group-open:rotate-90 transition-transform">
          ▸
        </span>
      </summary>
      <div className="mt-2 flex flex-col gap-2">{children}</div>
    </details>
  );
}
