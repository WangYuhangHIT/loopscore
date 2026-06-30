// TrendsView — per-project long-term view (Phase 3). Reads persisted history via
// /api/trends (a metric averaged over day buckets) and /api/uplift (skill correlation:
// sessions that used a skill vs those that didn't). Honest: uplift is correlation over
// observed sessions, small samples are flagged low-confidence (greyed + ⓘ), not causal.

import { useEffect, useState } from 'react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export type TrendsViewProps = { projectId: string };

type TrendPoint = { bucket: string; avg: number; count: number };
type Uplift = {
  skill: string; metric: string;
  withSkill: { mean: number | null; n: number };
  without: { mean: number | null; n: number };
  delta: number | null; lowConfidence: boolean;
};

const METRICS: { key: string; label: string }[] = [
  { key: 'firstPassRate', label: 'First-pass rate' },
  { key: 'concerns', label: 'Concerns' },
  { key: 'autonomySpan', label: 'Autonomy span' },
  { key: 'stuckRisk', label: 'Stuck risk' },
  { key: 'reworkRate', label: 'Rework rate' },
];

function fmt(v: number | null): string {
  if (v == null) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

export function TrendsView({ projectId }: TrendsViewProps) {
  const [metric, setMetric] = useState('firstPassRate');
  const [series, setSeries] = useState<TrendPoint[]>([]);
  const [uplifts, setUplifts] = useState<Uplift[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const pid = encodeURIComponent(projectId);
    Promise.all([
      fetch(`/api/trends?projectId=${pid}&metric=${metric}&bucket=day`).then((r) => r.json()).catch(() => ({ series: [] })),
      fetch(`/api/uplift?projectId=${pid}&metric=${metric}`).then((r) => r.json()).catch(() => ({ uplifts: [] })),
    ]).then(([t, u]) => {
      if (!alive) return;
      setSeries(t.series ?? []);
      setUplifts(u.uplifts ?? []);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [projectId, metric]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">Metric</span>
        {METRICS.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMetric(m.key)}
            className={`rounded px-2 py-1 text-xs font-mono ${
              metric === m.key ? 'bg-neon-sky/20 text-[var(--neon-sky)]' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="rounded-md border border-border bg-card/60 p-3">
        <div className="mb-1 text-[14px] uppercase tracking-wider text-muted-foreground">
          {METRICS.find((m) => m.key === metric)?.label} over time (daily avg) · {series.length} day{series.length === 1 ? '' : 's'}
        </div>
        {series.length < 2 ? (
          <p className="py-10 text-center text-xs text-muted-foreground">
            {loading ? 'Loading…' : 'Not enough history yet — trends appear as snapshots accrue over days.'}
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={series} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
              <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} width={36} />
              <Tooltip
                contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', fontSize: 12 }}
                formatter={(v: number, _n, p: { payload?: TrendPoint }) => [`${fmt(v)} (n=${p?.payload?.count ?? 0})`, metric]}
              />
              <Line type="monotone" dataKey="avg" stroke="var(--neon-sky)" strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="rounded-md border border-border bg-card/60 p-3">
        <div className="mb-2 flex items-center gap-1 text-[14px] uppercase tracking-wider text-muted-foreground">
          Skill / harness uplift on {METRICS.find((m) => m.key === metric)?.label}
          <span className="cursor-help text-neon-sky/70" title="Correlation, not causation: sessions that USED a skill vs those that didn't. Low-confidence rows (small samples) are greyed — they're hints, not proof.">ⓘ</span>
        </div>
        {uplifts.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">{loading ? 'Loading…' : 'No skill usage recorded yet.'}</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-[14px] uppercase tracking-wider text-muted-foreground/70">
              <tr><th className="text-left font-normal">Skill</th><th className="text-right font-normal">Used (n)</th><th className="text-right font-normal">Not (n)</th><th className="text-right font-normal">Δ</th></tr>
            </thead>
            <tbody className="font-mono">
              {uplifts.map((u) => (
                <tr key={u.skill} className={u.lowConfidence ? 'text-muted-foreground/50' : ''}>
                  <td className="py-0.5 text-left">
                    {u.skill}
                    {u.lowConfidence ? <span className="ml-1 text-neon-yellow/70" title="Low confidence — too few samples">ⓘ</span> : null}
                  </td>
                  <td className="text-right">{fmt(u.withSkill.mean)} <span className="text-muted-foreground/60">({u.withSkill.n})</span></td>
                  <td className="text-right">{fmt(u.without.mean)} <span className="text-muted-foreground/60">({u.without.n})</span></td>
                  <td className={`text-right ${u.delta != null && u.delta > 0 ? 'text-[var(--neon-green)]' : u.delta != null && u.delta < 0 ? 'text-[var(--neon-red)]' : ''}`}>
                    {u.delta != null ? (u.delta > 0 ? '+' : '') + fmt(u.delta) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
