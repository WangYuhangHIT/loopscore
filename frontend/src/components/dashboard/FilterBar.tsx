// FilterBar — interactive controls for the agent grid.
//   Left  : status chips (all / running / idle)
//   Mid   : search input (sessionId or branch contains)
//   Right : visible/total counts + density toggle + reset button when filters active
//
// Pure consumer of useFilters — never mutates URL directly. Sits below
// GlobalOverviewBar so the overview totals stay system-wide while the
// FilterBar reflects only the visible subset.

import { cn } from '@/lib/utils';
import type { Density, StatusFilter } from '@/store/useFilters';

export type FilterBarProps = {
  status: StatusFilter;
  query: string;
  visibleCount: number;
  totalCount: number;
  liveCount: number;
  idleCount: number;
  density: Density;
  onStatusChange: (s: StatusFilter) => void;
  onQueryChange: (q: string) => void;
  onDensityChange: (d: Density) => void;
  onReset: () => void;
};

const STATUS_CHIPS: Array<{ value: StatusFilter; label: string; tone: 'mauve' | 'green' | 'overlay' }> = [
  { value: 'all', label: 'All sessions', tone: 'mauve' },
  { value: 'live', label: 'Running', tone: 'green' },
  { value: 'idle', label: 'Idle', tone: 'overlay' },
];

const DENSITY_CHIPS: Array<{ value: Density; label: string; hint: string }> = [
  { value: 'comfortable', label: 'Comfortable', hint: 'Default spacing' },
  { value: 'compact', label: 'Compact', hint: 'Denser multi-column layout' },
];

export function FilterBar({
  status,
  query,
  visibleCount,
  totalCount,
  liveCount,
  idleCount,
  density,
  onStatusChange,
  onQueryChange,
  onDensityChange,
  onReset,
}: FilterBarProps) {
  const filtersActive = status !== 'all' || query.trim() !== '';
  const counts: Record<StatusFilter, number> = {
    all: totalCount,
    live: liveCount,
    idle: idleCount,
  };

  return (
    <div className="sticky top-[var(--overview-offset,0px)] z-[5] border-b border-border bg-card/30 backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 sm:px-6 py-2 text-sm">
        <div role="group" aria-label="Status filter" className="inline-flex items-center gap-1">
          {STATUS_CHIPS.map((chip) => {
            const active = status === chip.value;
            return (
              <button
                key={chip.value}
                type="button"
                onClick={() => onStatusChange(chip.value)}
                aria-pressed={active}
                className={cn(
                  'rounded-md border px-2 py-1 font-mono text-xs uppercase tracking-wider transition-colors',
                  active
                    ? chip.tone === 'green'
                      ? 'border-[var(--neon-green)]/50 bg-[var(--neon-green)]/12 text-[var(--neon-green)]'
                      : chip.tone === 'mauve'
                      ? 'border-neon-mauve/50 bg-neon-mauve/12 text-[var(--neon-mauve)]'
                      : 'border-border bg-card/60 text-foreground'
                    : 'border-border bg-transparent text-muted-foreground hover:text-foreground hover:border-foreground/30',
                )}
              >
                <span>{chip.label}</span>
                <span className="ml-1.5 text-[14px] text-current/80">{counts[chip.value]}</span>
              </button>
            );
          })}
        </div>

        <label className="relative inline-flex flex-1 min-w-[12rem] max-w-md items-center">
          <span className="pointer-events-none absolute left-2 font-mono text-xs text-muted-foreground">
            🔍
          </span>
          <input
            type="search"
            inputMode="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search by sessionId or branch…"
            aria-label="Search by sessionId or branch"
            className={cn(
              'w-full rounded-md border border-border bg-background/60 pl-7 pr-2 py-1',
              'font-mono text-xs text-foreground placeholder:text-muted-foreground/70',
              'focus:outline-none focus:border-neon-mauve/60 focus:bg-background/80',
            )}
          />
        </label>

        <span className="font-mono text-xs text-muted-foreground">
          Showing <span className="text-foreground">{visibleCount}</span>
          <span className="text-muted-foreground/60"> / {totalCount}</span>
        </span>

        <div
          role="group"
          aria-label="Density toggle"
          className="inline-flex items-center gap-1"
          title="Density · comfortable or compact"
        >
          <span className="font-mono text-[14px] uppercase tracking-wider text-muted-foreground/80">
            Density
          </span>
          {DENSITY_CHIPS.map((chip) => {
            const active = density === chip.value;
            return (
              <button
                key={chip.value}
                type="button"
                onClick={() => onDensityChange(chip.value)}
                aria-pressed={active}
                title={chip.hint}
                className={cn(
                  'rounded-md border px-2 py-1 font-mono text-xs uppercase tracking-wider transition-colors',
                  active
                    ? 'border-neon-sky/50 bg-neon-sky/10 text-[var(--neon-sky)]'
                    : 'border-border bg-transparent text-muted-foreground hover:text-foreground hover:border-foreground/30',
                )}
              >
                {chip.label}
              </button>
            );
          })}
        </div>

        {filtersActive ? (
          <button
            type="button"
            onClick={onReset}
            className="rounded-md border border-border px-2 py-1 font-mono text-[15px] uppercase tracking-wider text-muted-foreground hover:text-foreground hover:border-foreground/30"
          >
            Clear filters
          </button>
        ) : null}
      </div>
    </div>
  );
}
