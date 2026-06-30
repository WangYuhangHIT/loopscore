// PerformanceRadar — 7-dim deterministic performance inside an AgentPanel (US-009).
//
// Dimensions come straight from `src/evaluator.js` (delivery / quality /
// verification / debugging / context / autonomy / recovery). Each carries a
// `rating ∈ {good, ok, concern}`. We render a Recharts RadarChart over those 7
// axes plus a numeric value strip beneath so the panel stays readable even when
// the radar shape is degenerate (e.g. all-good = full heptagon).
//
// Rating → 0..1 mapping is deliberately coarse: the radar is for "spot the dent"
// triage, not for stack-ranking. The headline numbers live in the strip.

import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from 'recharts';
import type { DimensionMetrics, DimensionRating, Evaluation } from '@/types/dashboard';
import { cn } from '@/lib/utils';

export type PerformanceRadarProps = {
  evaluation: Evaluation | undefined;
  role?: string;
  size?: 'md' | 'lg';
};

// Short axis labels so long dim names (AssertionEffectiveness, StabilityHygiene…) don't
// overflow the radar SVG, especially in narrow multi-column cards. Full names stay in the
// RoleOverlayPanel list below.
const DIM_SHORT: Record<string, string> = {
  DecompositionQuality: 'Decomp', DelegationThroughput: 'Deleg', ScopeCreep: 'Scope', Coordination: 'Coord', LoopEndurance: 'Endurance',
  ComponentReuse: 'Reuse', PerfHygiene: 'Perf', A11y: 'A11y', ViewFocus: 'Focus',
  ReliabilityEng: 'Reliab', ApiSurface: 'API', EndpointTestBacking: 'EptTest', ErrorHandling: 'ErrHandle',
  MigrationSafety: 'Migrate', SchemaIntegrity: 'Schema', QueryCare: 'Query', DataSafety: 'DataSafe',
  CorrectnessFirst: 'Correct', EdgeRobustness: 'Edge', OptimizeVerifyLoop: 'OptLoop', ComplexityAwareness: 'BigO',
  TestAuthorship: 'TestWrite', AssertionEffectiveness: 'Assert', DefectDetection: 'Defect', StabilityHygiene: 'Stability',
};

// Role-specific overlay dims (src/roleMetrics.js) → radar rows. This is what makes the
// polygon CHANGE per role: a frontend agent's axes are ComponentReuse/PerfHygiene/…,
// a backend agent's are ReliabilityEng/ApiSurface/…. Composite roles union their facets.
function roleRows(evaluation: Evaluation | undefined) {
  const overlay = evaluation?.roleOverlay;
  if (!overlay) return [] as { key: string; short: string; rating: DimensionRating; value: number; hint: string }[];
  const rows: { key: string; short: string; rating: DimensionRating; value: number; hint: string }[] = [];
  for (const facet of Object.keys(overlay)) {
    for (const dim of Object.keys(overlay[facet])) {
      const d = overlay[facet][dim] as { rating?: DimensionRating };
      const rating = (d?.rating ?? 'ok') as DimensionRating;
      // Consistent with dimsToRows: a missing rating reads as "no data" → 0, not
      // a phantom 'ok' (0.6) that would draw a misleadingly healthy polygon point.
      const value = d?.rating ? RATING_VALUE[d.rating] : 0;
      rows.push({ key: `${facet}.${dim}`, short: DIM_SHORT[dim] ?? dim, rating, value, hint: facet });
    }
  }
  return rows;
}

type DimensionKey =
  | 'delivery'
  | 'quality'
  | 'verification'
  | 'debugging'
  | 'context'
  | 'autonomy'
  | 'recovery';

type DimensionSpec = {
  key: DimensionKey;
  short: string;
  hint: (m: DimensionMetrics | undefined) => string;
};

// Matches `src/evaluator.js` order so a viewer's eye can move sequentially
// through delivery → quality → ... → recovery (same as the legacy tile strip).
const DIMENSIONS: DimensionSpec[] = [
  {
    key: 'delivery',
    short: 'Delivery',
    hint: (m) => (m ? `commits ${num(m.commits)} · uncommitted ${num(m.editsSinceCommit)}` : '—'),
  },
  {
    key: 'quality',
    short: 'Quality',
    hint: (m) => (m ? `touched ${num(m.filesTouched)} · test ${pass(m.testPass)}` : '—'),
  },
  {
    key: 'verification',
    short: 'Rigor',
    hint: (m) => (m ? `${num(m.testsRun)} runs · ${m.finishWithoutTest ? 'untested⚠' : 'tested'}` : '—'),
  },
  {
    key: 'debugging',
    short: 'Debug',
    hint: (m) => (m ? `streak ${num(m.sameErrorStreak)} · ${m.flagged ? 'looping⚠' : 'ok'}` : '—'),
  },
  {
    key: 'context',
    short: 'Arch',
    hint: (m) => (m ? `blast ${num(m.blastRadius)} · explore ${num(m.exploreReads)}` : '—'),
  },
  {
    key: 'autonomy',
    short: 'Autonomy',
    hint: (m) =>
      m ? `${num(m.toolCallsPerUserTurn)}/turn · interventions ${num(m.interventions)}` : '—',
  },
  {
    key: 'recovery',
    short: 'Recovery',
    hint: (m) => (m ? `errors ${num(m.errors)} · ${m.currentlyStuck ? 'stuck⚠' : 'ok'}` : '—'),
  },
];

const RATING_VALUE: Record<DimensionRating, number> = {
  good: 1,
  ok: 0.6,
  concern: 0.25,
};

const RATING_TONE: Record<DimensionRating, string> = {
  good: 'text-[var(--neon-green)] border-[var(--neon-green)]/40 bg-[var(--neon-green)]/8',
  ok: 'text-foreground/85 border-border bg-secondary/40',
  concern: 'text-[var(--neon-red)] border-[var(--neon-red)]/45 bg-[var(--neon-red)]/10',
};

function num(v: unknown): string {
  if (typeof v !== 'number' || Number.isNaN(v)) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function pass(v: unknown): string {
  if (v === true) return '✓';
  if (v === false) return '✗';
  return '—';
}

function dimsToRows(evaluation: Evaluation | undefined) {
  return DIMENSIONS.map((d) => {
    const m = evaluation?.dimensions?.[d.key] as DimensionMetrics | undefined;
    return {
      key: d.key,
      short: d.short,
      rating: (m?.rating ?? 'ok') as DimensionRating,
      value: m ? RATING_VALUE[m.rating] : 0,
      hint: d.hint(m),
    };
  });
}

function worstTone(rows: { rating: DimensionRating }[]): DimensionRating {
  if (rows.some((r) => r.rating === 'concern')) return 'concern';
  if (rows.every((r) => r.rating === 'good')) return 'good';
  return 'ok';
}

function strokeFor(rating: DimensionRating): string {
  if (rating === 'concern') return 'var(--neon-red)';
  if (rating === 'good') return 'var(--neon-green)';
  return 'var(--neon-sky)';
}

export function PerformanceRadar({ evaluation, role, size = 'md' }: PerformanceRadarProps) {
  const generic = dimsToRows(evaluation);
  const rRows = roleRows(evaluation);
  // The radar's axes ARE the role's dims when we have ≥3 (a polygon needs 3 points);
  // otherwise fall back to the generic 7-dim core. The generic core is always shown as
  // a compact strip below, so nothing is lost.
  const roleAware = rRows.length >= 3;
  const rows = roleAware ? rRows : generic;
  const concerns = rows.filter((r) => r.rating === 'concern').length;
  const overall = worstTone(rows);
  const stroke = strokeFor(overall);
  const title = roleAware ? `${role && role !== 'unknown' ? role : 'role'} metrics` : '7-dim performance';

  if (!evaluation) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-[14px] uppercase tracking-wider text-muted-foreground">
          <span>7-dim performance</span>
          <span className="font-mono normal-case text-[14px] text-muted-foreground/80">—</span>
        </div>
        <div className="rounded-md border border-dashed border-border/60 bg-background/40 px-3 py-3 text-center text-[14px] text-muted-foreground">
          Waiting for first evaluation
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[14px] uppercase tracking-wider text-muted-foreground">
        <span>{title}</span>
        <span className="font-mono normal-case text-[14px]" style={{ color: stroke }}>
          {concerns}/{rows.length} flagged
        </span>
      </div>
      <div className={size === 'lg' ? 'h-72 w-full' : 'h-40 w-full'}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={rows} outerRadius={size === 'lg' ? '78%' : '72%'} margin={{ top: 6, right: 24, bottom: 6, left: 24 }}>
            <PolarGrid stroke="var(--neon-overlay)" strokeOpacity={0.3} />
            <PolarAngleAxis
              dataKey="short"
              tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }}
            />
            <PolarRadiusAxis domain={[0, 1]} tick={false} axisLine={false} tickCount={3} />
            <Radar
              name="performance"
              dataKey="value"
              stroke={stroke}
              strokeWidth={1.6}
              fill={stroke}
              fillOpacity={0.18}
              isAnimationActive={false}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      {/* Generic core 7-dim — compact wrap-chips below the (role-aware) radar. Each chip is a
          rating dot + short label; the full hint lives in the title so nothing overflows. */}
      <div className="mt-0.5 text-[13px] uppercase tracking-wider text-muted-foreground/60">Core 7-dim</div>
      <ul className="flex flex-wrap gap-1">
        {generic.map((r) => (
          <li
            key={r.key}
            className={cn(
              'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[13px] leading-tight',
              RATING_TONE[r.rating],
            )}
            title={`${r.short} · ${r.rating} · ${r.hint}`}
          >
            <span className="inline-flex h-1.5 w-1.5 rounded-full" style={{ background: strokeFor(r.rating) }} />
            <span className="uppercase tracking-wider">{r.short}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
