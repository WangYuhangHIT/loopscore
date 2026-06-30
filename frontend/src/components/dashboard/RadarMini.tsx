// RadarMini — a tiny role-aware polygon (no axis labels) for thumbnails / dense spots.
// Reads the same role-overlay dims as the big radar so a thumbnail's shape MATCHES its
// stage radar. Falls back to the generic 7-dim when no role overlay is present.

import { PolarGrid, Radar, RadarChart, ResponsiveContainer } from 'recharts';
import type { DimensionRating, Evaluation } from '@/types/dashboard';

const RATING_VALUE: Record<DimensionRating, number> = { good: 1, ok: 0.6, concern: 0.25 };
const GENERIC = ['delivery', 'quality', 'verification', 'debugging', 'context', 'autonomy', 'recovery'];

function rows(evaluation: Evaluation | undefined): { k: string; v: number }[] {
  const overlay = evaluation?.roleOverlay;
  const out: { k: string; v: number }[] = [];
  if (overlay) {
    for (const facet of Object.keys(overlay)) {
      for (const dim of Object.keys(overlay[facet])) {
        const r = (overlay[facet][dim] as { rating?: DimensionRating })?.rating ?? 'ok';
        out.push({ k: `${facet}.${dim}`, v: RATING_VALUE[r] });
      }
    }
  }
  if (out.length >= 3) return out;
  for (const d of GENERIC) {
    const r = (evaluation?.dimensions?.[d]?.rating as DimensionRating) ?? 'ok';
    out.push({ k: d, v: RATING_VALUE[r] });
  }
  return out;
}

function stroke(evaluation: Evaluation | undefined): string {
  const c = evaluation?.overall?.concerns ?? 0;
  return c === 0 ? 'var(--neon-green)' : c <= 2 ? 'var(--neon-sky)' : 'var(--neon-red)';
}

export function RadarMini({ evaluation, size = 64 }: { evaluation: Evaluation | undefined; size?: number }) {
  const data = rows(evaluation);
  const s = stroke(evaluation);
  return (
    <div style={{ width: size, height: size }} className="shrink-0">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="92%" margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <PolarGrid stroke="var(--neon-overlay)" strokeOpacity={0.25} />
          <Radar dataKey="v" stroke={s} strokeWidth={1.3} fill={s} fillOpacity={0.18} isAnimationActive={false} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
