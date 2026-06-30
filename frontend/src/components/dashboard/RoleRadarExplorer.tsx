// RoleRadarExplorer — the INTERACTIVE hero of the stage. The polygon and the metric list
// are one synced unit: CLICK a legend row or an axis label → that axis highlights on the
// radar, a big detail card shows the dimension's score + rating, and a general explanation
// of what the metric measures fills the space under the polygon. Click-only (no hover) so
// the view is stable — nothing flickers as the cursor passes over.

import { useMemo, useState } from 'react';
import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer } from 'recharts';
import type { DimensionRating, Evaluation } from '@/types/dashboard';
import { ROLE_DIM_INFO } from '@/lib/metricInfo';

type DimRow = { key: string; facet: string; name: string; short: string; value: unknown; rating: DimensionRating; proxyNote?: string };

const RATING_VALUE: Record<DimensionRating, number> = { good: 1, ok: 0.6, concern: 0.25 };
const RATING_COLOR: Record<DimensionRating, string> = { good: 'var(--neon-green)', ok: 'var(--neon-overlay)', concern: 'var(--neon-red)' };
const RATING_WORD: Record<DimensionRating, string> = { good: 'Good', ok: 'OK', concern: 'Needs attention' };

const SHORT: Record<string, string> = {
  DecompositionQuality: 'Decomp', DelegationThroughput: 'Deleg', ScopeCreep: 'Scope', Coordination: 'Coord', LoopEndurance: 'Endurance',
  ComponentReuse: 'Reuse', PerfHygiene: 'Perf', A11y: 'A11y', ViewFocus: 'Focus',
  ReliabilityEng: 'Reliab', ApiSurface: 'API', EndpointTestBacking: 'EptTest', ErrorHandling: 'ErrHandle',
  MigrationSafety: 'Migrate', SchemaIntegrity: 'Schema', QueryCare: 'Query', DataSafety: 'DataSafe',
  CorrectnessFirst: 'Correct', EdgeRobustness: 'Edge', OptimizeVerifyLoop: 'OptLoop', ComplexityAwareness: 'BigO',
  TestAuthorship: 'TestWrite', AssertionEffectiveness: 'Assert', DefectDetection: 'Defect', StabilityHygiene: 'Stability',
};

function fmtVal(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `${k} ${typeof val === 'number' ? val : val === true ? '✓' : val === false ? '✗' : String(val)}`)
      .join(' · ');
  }
  return String(v);
}

function buildRows(evaluation: Evaluation | undefined): DimRow[] {
  const overlay = evaluation?.roleOverlay;
  if (!overlay) return [];
  const rows: DimRow[] = [];
  for (const facet of Object.keys(overlay)) {
    for (const dim of Object.keys(overlay[facet])) {
      const d = overlay[facet][dim] as { value: unknown; rating: DimensionRating; proxyNote?: string };
      rows.push({ key: `${facet}.${dim}`, facet, name: dim, short: SHORT[dim] ?? dim, value: d.value, rating: d.rating, proxyNote: d.proxyNote });
    }
  }
  return rows;
}

export function RoleRadarExplorer({ evaluation }: { evaluation: Evaluation | undefined; role?: string }) {
  const rows = useMemo(() => buildRows(evaluation), [evaluation]);
  const [selected, setSelected] = useState<string | null>(null);
  const activeKey = selected ?? rows[0]?.key ?? null;
  const active = rows.find((r) => r.key === activeKey) ?? rows[0];

  if (rows.length < 3) {
    return <p className="text-sm text-muted-foreground">No role-specific dimensions for this agent yet.</p>;
  }

  const chartData = rows.map((r) => ({ key: r.key, short: r.short, v: RATING_VALUE[r.rating] }));

  // Interactive axis label: highlights when it (or its legend row) is active.
  const Tick = (props: { x?: number; y?: number; textAnchor?: string; index?: number }) => {
    const r = rows[props.index ?? -1];
    if (!r) return null;
    const on = r.key === activeKey;
    return (
      <text
        x={props.x}
        y={props.y}
        textAnchor={props.textAnchor as 'start' | 'middle' | 'end' | undefined}
        dominantBaseline="central"
        fontSize={on ? 13 : 11}
        fontWeight={on ? 700 : 400}
        fill={on ? RATING_COLOR[r.rating] : 'var(--color-muted-foreground)'}
        style={{ cursor: 'pointer' }}
        onClick={() => setSelected(r.key)}
      >
        {r.short}
      </text>
    );
  };

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-2">
      {/* Radar + the clicked dimension's general explanation (fills the space below) */}
      <div className="min-w-0">
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={chartData} outerRadius="74%" margin={{ top: 16, right: 36, bottom: 16, left: 36 }}>
              <PolarGrid stroke="var(--neon-overlay)" strokeOpacity={0.3} />
              <PolarAngleAxis dataKey="short" tick={<Tick />} />
              <Radar dataKey="v" stroke="var(--neon-sky)" strokeWidth={1.8} fill="var(--neon-sky)" fillOpacity={0.16} isAnimationActive={false} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
        {active ? (
          <div className="mt-2 rounded-lg border border-border bg-secondary/30 px-4 py-3">
            <div className="flex items-baseline gap-2">
              <span className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: RATING_COLOR[active.rating] }} />
              <span className="text-base font-semibold text-foreground">{active.name}</span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {ROLE_DIM_INFO[active.name] ?? 'A role-specific quality dimension scored from the event stream.'}
            </p>
          </div>
        ) : (
          <p className="mt-2 text-center text-sm text-muted-foreground">
            Click a dimension — on the chart or in the list — to see what it measures.
          </p>
        )}
      </div>

      {/* Selected detail + synced legend */}
      <div className="flex min-w-0 flex-col gap-3">
        {active ? (
          <div className="rounded-lg border-2 px-4 py-3" style={{ borderColor: RATING_COLOR[active.rating] }}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-xl font-semibold text-foreground">{active.name}</span>
              <span className="shrink-0 text-base font-semibold uppercase tracking-wider" style={{ color: RATING_COLOR[active.rating] }}>
                {RATING_WORD[active.rating]}
              </span>
            </div>
            <div className="mt-1 font-mono text-4xl font-semibold text-foreground [overflow-wrap:anywhere]">{fmtVal(active.value)}</div>
            {active.proxyNote ? (
              <p className="mt-2 text-sm leading-snug text-muted-foreground">
                <span className="text-neon-sky/80">ⓘ </span>{active.proxyNote}
              </p>
            ) : null}
            <div className="mt-1 font-mono text-xs uppercase tracking-wider text-muted-foreground/60">{active.facet}</div>
          </div>
        ) : null}

        <ul className="flex min-w-0 flex-col gap-0.5">
          {rows.map((r) => {
            const on = r.key === activeKey;
            return (
              <li key={r.key}>
                <button
                  type="button"
                  onClick={() => setSelected(r.key)}
                  className={`flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left ${
                    on ? 'bg-secondary' : 'hover:bg-secondary/40'
                  }`}
                >
                  <span className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: RATING_COLOR[r.rating] }} aria-label={r.rating} />
                  <span className={`min-w-0 flex-1 truncate text-sm ${on ? 'font-semibold text-foreground' : 'text-foreground/85'}`}>{r.name}</span>
                  <span className="shrink-0 font-mono text-sm text-muted-foreground">{fmtVal(r.value)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
