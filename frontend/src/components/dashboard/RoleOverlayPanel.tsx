// RoleOverlayPanel — the "second ring": role-specific overlay dimensions that sit
// on top of the generic core 7-dim (design §5.3). Grouped by facet; each dim shows a
// good/ok/concern dot + a compact value + an ⓘ for INDIRECT dims explaining what is
// estimated and why it's only an estimate (design §3 honesty). Read-only.

import type { RoleOverlay, RoleDim, DimensionRating } from '@/types/dashboard';

export type RoleOverlayPanelProps = {
  overlay?: RoleOverlay;
  role?: string;
};

const RATING_COLOR: Record<DimensionRating, string> = {
  good: 'var(--neon-green)',
  ok: 'var(--neon-overlay)',
  concern: 'var(--neon-red)',
};

// Render a heterogeneous dim value (number / boolean / small object) compactly.
function fmtVal(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) =>
        `${k} ${typeof val === 'number' ? val : val === true ? '✓' : val === false ? '✗' : String(val)}`,
      )
      .join(' · ');
  }
  return String(v);
}

export function RoleOverlayPanel({ overlay, role }: RoleOverlayPanelProps) {
  const facets = overlay ? Object.keys(overlay) : [];
  if (!overlay || facets.length === 0) return null;

  return (
    <section
      aria-label="role overlay dimensions"
      className="rounded-md border border-neon-sky/25 border-l-2 border-l-neon-sky/60 bg-neon-sky/5 px-3 py-2.5"
    >
      <div className="flex items-center justify-between text-[14px] uppercase tracking-wider text-neon-sky/85">
        <span>Role overlay</span>
        {role && role !== 'unknown' ? <span className="font-mono text-foreground/80">{role}</span> : null}
      </div>
      <div className="mt-2 flex flex-col gap-2">
        {facets.map((facet) => (
          <div key={facet}>
            <div className="mb-1 font-mono text-[13px] uppercase tracking-wider text-muted-foreground/70">{facet}</div>
            <ul className="flex flex-col gap-1">
              {Object.entries(overlay[facet]).map(([dimName, dim]) => (
                <DimRow key={dimName} name={dimName} dim={dim} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function DimRow({ name, dim }: { name: string; dim: RoleDim }) {
  const color = RATING_COLOR[dim.rating] ?? 'var(--neon-overlay)';
  return (
    <li className="flex items-center gap-1.5 text-[14px]">
      <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} aria-label={dim.rating} />
      <span className="shrink-0 font-mono text-foreground/80">{name}</span>
      {dim.proxyNote ? (
        <span
          className="shrink-0 cursor-help text-neon-sky/80"
          title={`Indirect estimate — ${dim.proxyNote}`}
          aria-label="indirect metric explanation"
        >
          ⓘ
        </span>
      ) : null}
      <span className="ml-auto truncate text-right font-mono text-muted-foreground" title={fmtVal(dim.value)}>
        {fmtVal(dim.value)}
      </span>
    </li>
  );
}
