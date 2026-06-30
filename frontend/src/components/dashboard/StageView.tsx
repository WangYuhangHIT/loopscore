// StageView — "speaker view" (like a video call): the clicked session becomes the big
// detailed dashboard (the stage), every other session shrinks to a small thumbnail in a
// left filmstrip. Clicking a thumbnail swaps it onto the stage. This REPLACES the old
// full-screen popup (FocusedAgentView) — it's inline, not an overlay.

import type {
  CapabilitySample, Judgment, NormalizedEvent, Review, SessionSummary,
} from '@/types/dashboard';
import { StageDetail } from './StageDetail';
import { RadarMini } from './RadarMini';
import { Truncate } from '@/components/ui/layout';

export type StageViewProps = {
  staged: SessionSummary;
  sessions: SessionSummary[];
  events: Record<string, NormalizedEvent[]>;
  capabilityHistory: Record<string, CapabilitySample[]>;
  reviews: Record<string, Review>;
  judgments: Record<string, Judgment[]>;
  onPick: (id: string) => void;
  onExit: () => void;
};

function projName(p: string | undefined): string {
  if (!p) return 'project';
  const a = p.replace(/\/+$/, '').split('/');
  return a[a.length - 1] || p;
}

function concernColor(concerns: number | null): string {
  if (concerns == null) return 'var(--neon-overlay)';
  if (concerns === 0) return 'var(--neon-green)';
  if (concerns <= 2) return 'var(--neon-yellow)';
  return 'var(--neon-red)';
}

function Thumb({ session, active, onClick }: { session: SessionSummary; active: boolean; onClick: () => void }) {
  const live = session.status === 'live';
  const ev = session.evaluation;
  const concerns = ev?.overall?.concerns ?? null;
  const fpr = ev?.capability?.firstPassRate ?? null;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${projName(session.project)} · ${session.sessionId}`}
      className={`w-full shrink-0 overflow-hidden rounded-lg border p-2.5 text-left transition-colors ${
        active
          ? 'border-[var(--primary)] bg-primary/5 ring-1 ring-[var(--primary)]/40'
          : 'border-border bg-card hover:border-foreground/30 hover:bg-secondary/40'
      }`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className="inline-flex h-2 w-2 shrink-0 rounded-full"
              style={{ background: live ? 'var(--neon-green)' : 'var(--neon-overlay)' }}
              aria-label={session.status}
            />
            <Truncate className="flex-1 text-sm font-semibold text-foreground">{projName(session.project)}</Truncate>
          </div>
          {session.mainRole?.role && session.mainRole.role !== 'unknown' ? (
            <Truncate className="font-mono text-xs uppercase tracking-wider text-[var(--neon-mauve)]">{session.mainRole.role}</Truncate>
          ) : null}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {fpr != null ? <span className="font-mono">first-pass {Math.round(fpr * 100)}%</span> : null}
            {concerns != null ? (
              <span className="ml-auto inline-flex shrink-0 items-center gap-1 font-mono">
                <span className="inline-flex h-1.5 w-1.5 rounded-full" style={{ background: concernColor(concerns) }} />
                {concerns}
              </span>
            ) : null}
          </div>
        </div>
        <RadarMini evaluation={ev} size={52} />
      </div>
    </button>
  );
}

export function StageView({ staged, sessions, events, capabilityHistory, reviews, judgments, onPick, onExit }: StageViewProps) {
  // Ensure the staged session is always reachable in the strip even if filtered out.
  const strip = sessions.some((s) => s.sessionId === staged.sessionId) ? sessions : [staged, ...sessions];

  return (
    <div className="flex min-w-0 gap-4 px-4 sm:px-6 py-4">
      <aside className="sticky top-2 flex max-h-[calc(100vh-1rem)] w-[17rem] shrink-0 flex-col gap-2 overflow-y-auto pr-1">
        <button
          type="button"
          onClick={onExit}
          className="shrink-0 rounded-md border border-border px-2 py-1.5 text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground hover:border-foreground/30"
        >
          ← Back to grid
        </button>
        <div className="shrink-0 px-0.5 text-[13px] uppercase tracking-wider text-muted-foreground/60">
          {strip.length} session{strip.length === 1 ? '' : 's'}
        </div>
        {strip.map((s) => (
          <Thumb key={s.sessionId} session={s} active={s.sessionId === staged.sessionId} onClick={() => onPick(s.sessionId)} />
        ))}
      </aside>

      <div className="min-w-0 flex-1">
        <StageDetail
          session={staged}
          events={events[staged.sessionId] ?? []}
          capabilityHistory={capabilityHistory[staged.sessionId] ?? []}
          review={reviews[staged.sessionId]}
          judgments={judgments[staged.sessionId]}
        />
      </div>
    </div>
  );
}
