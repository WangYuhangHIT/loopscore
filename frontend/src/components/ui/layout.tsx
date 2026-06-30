// layout.tsx — overflow-safe layout primitives (design 2026-06-28). Build UI from these
// and horizontal overflow is impossible by construction:
//   • Row / Stack force `min-w-0` on themselves AND their direct children, so the
//     flexbox `min-width:auto` default (root cause of ~all overflow) can never bite.
//   • Cluster wraps instead of spilling.
//   • Truncate / KeyVal ellipsize long values (in a guaranteed min-w-0 parent).
//   • Card clips, so no descendant (incl. Recharts SVG <text>) can escape it.
// Prefer these over ad-hoc `min-w-0`/`truncate` sprinkles.

import type { ElementType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Div = React.HTMLAttributes<HTMLDivElement>;

// Horizontal flex; every direct child can shrink (min-w-0) → children never burst the row.
export function Row({ className, children, ...rest }: Div & { children?: ReactNode }) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2 [&>*]:min-w-0', className)} {...rest}>
      {children}
    </div>
  );
}

// Wrapping row of chips: overflow becomes a new line, never a horizontal spill.
export function Cluster({ className, children, ...rest }: Div & { children?: ReactNode }) {
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-1.5 [&>*]:min-w-0', className)} {...rest}>
      {children}
    </div>
  );
}

// Vertical flex; children min-w-0 so wide content inside never pushes the column wider.
export function Stack({ className, children, ...rest }: Div & { children?: ReactNode }) {
  return (
    <div className={cn('flex min-w-0 flex-col [&>*]:min-w-0', className)} {...rest}>
      {children}
    </div>
  );
}

// Single-line text that ellipsizes. Must live in a min-w-0 parent — Row/Stack provide it.
export function Truncate({
  as: As = 'span' as ElementType,
  className,
  title,
  children,
}: {
  as?: ElementType;
  className?: string;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <As className={cn('block min-w-0 truncate', className)} title={title}>
      {children}
    </As>
  );
}

// Label + value; the value truncates, the label stays. Common "k: v" metric row.
export function KeyVal({
  label,
  className,
  children,
  title,
}: {
  label: ReactNode;
  className?: string;
  children?: ReactNode;
  title?: string;
}) {
  return (
    <Row className={cn('gap-1', className)} title={title}>
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <Truncate className="text-foreground/85">{children}</Truncate>
    </Row>
  );
}

// Clipping surface: descendants (including SVG chart labels) can never escape the card.
export function Card({ className, children, style, ...rest }: Div & { children?: ReactNode }) {
  return (
    <div
      className={cn('min-w-0 overflow-hidden rounded-xl border border-border bg-card', className)}
      style={style}
      {...rest}
    >
      {children}
    </div>
  );
}
