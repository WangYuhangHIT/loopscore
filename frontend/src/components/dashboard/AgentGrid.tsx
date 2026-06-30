import type { ReactNode, CSSProperties } from 'react';

export type AgentGridProps = {
  maxColumns?: number;
  // When omitted, the grid inherits its min-column from the active density's
  // `--ds-col-min` CSS variable (US-013). Setting it forces an explicit value
  // regardless of density.
  minColumnPx?: number;
  children: ReactNode;
};

const GAP_PX = 16;
const DEFAULT_MIN_COL_PX = 352;

export function AgentGrid({
  maxColumns = 4,
  minColumnPx,
  children,
}: AgentGridProps) {
  // For the max-width cap we still need a numeric column min; when the consumer
  // didn't supply one, use the comfortable baseline (352px) — it's a hard cap
  // for the centered column, so over-estimating is harmless on wide screens.
  const baseMin = minColumnPx ?? DEFAULT_MIN_COL_PX;
  const maxWidthPx = maxColumns * baseMin + (maxColumns - 1) * GAP_PX;
  const style: CSSProperties = {
    maxWidth: `${maxWidthPx}px`,
    margin: '0 auto',
  };
  if (minColumnPx) {
    (style as Record<string, string>)['--ag-min-col'] = `${minColumnPx}px`;
  }
  return (
    <div className="agent-grid" style={style} data-max-cols={maxColumns}>
      {children}
    </div>
  );
}
