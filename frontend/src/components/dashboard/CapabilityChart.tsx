// CapabilityChart — rolling capability ratio curve inside an AgentPanel (US-008).
//
// Data source: dashboardReducer's `capabilityHistory[sessionId]` — a per-session
// ring of `CapabilitySample` accumulated from snapshot + every `evaluation` /
// `session` SSE message (dedup'd; cap CAPABILITY_HISTORY_CAP = 60).
//
// Hero series: `firstPassRate` (first-pass rate) — the most direct "ability" ratio
// (range 0..1). Rendered as a soft area + line via Recharts so the curve fits
// container width without overflow (ResponsiveContainer).
//
// A faint background `stuckRisk` track (range 0..100, scaled into 0..1) hints
// at the "are they spinning" signal without stealing focus from firstPassRate.
//
// Empty-state: when we have <2 samples the chart shows a soft placeholder line
// + the current value, so it never collapses to 0px or jitters on first frame.

import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from 'recharts';
import type { CapabilitySample } from '@/types/dashboard';

export type CapabilityChartProps = {
  history: CapabilitySample[];
};

type ChartRow = {
  i: number;
  firstPassRate: number | null;
  stuckRisk01: number;
  ts: number;
};

function pct(x: number | null | undefined): string {
  if (x == null || Number.isNaN(x)) return '—';
  return `${Math.round(x * 100)}%`;
}

function fmtAge(ts: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

function tone(firstPass: number | null | undefined): string {
  if (firstPass == null) return 'var(--neon-overlay)';
  if (firstPass >= 0.9) return 'var(--neon-green)';
  if (firstPass >= 0.7) return 'var(--neon-yellow)';
  return 'var(--neon-red)';
}

function toRows(history: CapabilitySample[]): ChartRow[] {
  return history.map((s, i) => ({
    i,
    firstPassRate: s.firstPassRate,
    stuckRisk01: Math.max(0, Math.min(1, s.stuckRisk / 100)),
    ts: s.ts,
  }));
}

// Recharts gives the tooltip a richly-typed `payload`, but exporting that type
// across versions is fiddly. We only read `active` + `payload[0].payload`, so a
// minimal local shape keeps the tsc -b build clean without dragging in Recharts'
// generic NameType/ValueType union.
type TooltipBag = {
  active?: boolean;
  payload?: Array<{ payload?: ChartRow }>;
};

function renderTooltip(history: CapabilitySample[]) {
  return ({ active, payload }: TooltipBag) => {
    if (!active || !payload || payload.length === 0) return null;
    const row = payload[0]?.payload;
    if (!row) return null;
    const sample = history[row.i];
    const nowMs = Date.now();
    return (
      <div className="rounded border border-border/70 bg-popover/95 px-2 py-1.5 text-[14px] font-mono leading-snug text-popover-foreground shadow">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">first-pass rate</span>
          <span style={{ color: tone(row.firstPassRate) }}>{pct(row.firstPassRate)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">stuck risk</span>
          <span>{Math.round(row.stuckRisk01 * 100)}</span>
        </div>
        {sample ? (
          <div className="text-muted-foreground">{fmtAge(sample.ts, nowMs)}</div>
        ) : null}
      </div>
    );
  };
}

export function CapabilityChart({ history }: CapabilityChartProps) {
  const last = history[history.length - 1];
  const live = last?.firstPassRate ?? null;
  const liveTone = tone(live);
  const rows = toRows(history);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[14px] uppercase tracking-wider text-muted-foreground">
        <span>Capability curve · first-pass rate</span>
        <span className="font-mono normal-case" style={{ color: liveTone }}>
          {pct(live)}
        </span>
      </div>
      <div className="h-16 w-full">
        {rows.length === 0 ? (
          <div className="flex h-full w-full items-center justify-center rounded-md border border-dashed border-border/60 bg-background/40 text-[14px] text-muted-foreground">
            Waiting for first evaluation
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
              <defs>
                <linearGradient id="capStroke" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={liveTone} stopOpacity={0.55} />
                  <stop offset="100%" stopColor={liveTone} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              {/* Hidden axis: clamp 0..1 so identical points don't auto-zoom into noise. */}
              <YAxis hide domain={[0, 1]} />
              <Tooltip
                cursor={{ stroke: 'var(--neon-overlay)', strokeWidth: 1, opacity: 0.4 }}
                content={renderTooltip(history) as never}
              />
              <Area
                type="monotone"
                dataKey="stuckRisk01"
                stroke="var(--neon-red)"
                strokeOpacity={0.35}
                fill="var(--neon-red)"
                fillOpacity={0.06}
                isAnimationActive={false}
                connectNulls
              />
              <Area
                type="monotone"
                dataKey="firstPassRate"
                stroke={liveTone}
                strokeWidth={1.6}
                fill="url(#capStroke)"
                isAnimationActive={false}
                connectNulls
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
      {/* Secondary read-out line: keeps the headline ratios visible even when
          the curve is short (or all-null), without forcing the user to hover. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[14px] text-muted-foreground">
        <span>
          rework{' '}
          <span className="font-mono text-foreground/80">{pct(last?.reworkRate)}</span>
        </span>
        <span>
          understand{' '}
          <span className="font-mono text-foreground/80">
            {last?.lookBeforeLeap == null ? '—' : last.lookBeforeLeap.toFixed(1)}
          </span>
        </span>
        <span>
          autonomy span{' '}
          <span className="font-mono text-foreground/80">
            {last?.autonomySpan == null ? '—' : last.autonomySpan.toFixed(1)}
          </span>
        </span>
        <span>
          stuck{' '}
          <span className="font-mono text-foreground/80">
            {last?.stuckRisk == null ? '—' : Math.round(last.stuckRisk)}
          </span>
        </span>
      </div>
    </div>
  );
}
