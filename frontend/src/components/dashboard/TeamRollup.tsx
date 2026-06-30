// TeamRollup — the team-level header for a session card (design §6): a session = a team,
// so above the per-member scores we show how well the TEAM did — does it cover the right
// facets, how parallel was it, how healthy was coordination, and an aggregate concern
// level. Each block carries an ⓘ tooltip (its plain-language `note`) — honest about what
// is estimated. Read-only.

import type { TeamMetrics, DimensionRating } from '@/types/dashboard';

export type TeamRollupProps = { team?: TeamMetrics };

const RATING_COLOR: Record<DimensionRating, string> = {
  good: 'var(--neon-green)',
  ok: 'var(--neon-overlay)',
  concern: 'var(--neon-red)',
};

function Block({ label, text, rating, note }: { label: string; text: string; rating: DimensionRating; note?: string }) {
  return (
    <span
      className="inline-flex min-w-0 max-w-full items-center gap-1 rounded border border-border/50 bg-background/40 px-1.5 py-0.5 text-[14px]"
      title={`${label}: ${text}${note ? ' — ' + note : ''}`}
    >
      <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: RATING_COLOR[rating] }} aria-label={rating} />
      <span className="shrink-0 font-mono uppercase tracking-wider text-muted-foreground/80">{label}</span>
      <span className="min-w-0 truncate font-mono text-foreground/85">{text}</span>
      {note ? <span className="shrink-0 cursor-help text-neon-sky/70" aria-label="estimate explanation">ⓘ</span> : null}
    </span>
  );
}

export function TeamRollup({ team }: TeamRollupProps) {
  if (!team || team.memberCount <= 1) return null; // solo session → no team to roll up

  const cov = team.RoleCoverage;
  const par = team.Parallelism;
  const col = team.CollaborationHealth;
  const covered = (cov.value.covered as string[]) || [];

  return (
    <section
      aria-label="team rollup"
      className="rounded-md border border-neon-green/25 border-l-2 border-l-neon-green/60 bg-neon-green/5 px-3 py-2"
    >
      <div className="mb-1.5 flex items-center justify-between text-[14px] uppercase tracking-wider text-neon-green/85">
        <span>Team</span>
        <span className="font-mono text-foreground/80">
          {team.memberCount} member{team.memberCount === 1 ? '' : 's'}
          {team.teamConcerns != null ? ` · ${team.teamConcerns} avg concern` : ''}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Block label="coverage" text={covered.length ? covered.join('/') : '—'} rating={cov.rating} note={cov.note} />
        <Block label="parallel" text={`peak ${par.value.peak ?? 0}·${par.value.totalAgents ?? 0} agents`} rating={par.rating} note={par.note} />
        <Block label="coord" text={`${col.value.sendMessages ?? 0} msg·${col.value.spawns ?? 0} spawn`} rating={col.rating} note={col.note} />
      </div>
    </section>
  );
}
