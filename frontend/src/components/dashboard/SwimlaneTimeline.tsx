// SwimlaneTimeline — per-panel scroll-stream of recent events (US-007).
//
// The reducer's events ring (per-sessionId) already caps at 500 — that's the
// `timelineWindow=500` contract from the PRD. The DOM-visible window is a
// further cap (default 80) so dozens of panels stay cheap to paint when many
// sessions are live at once. The full 500-event ring is still available for
// future stories that want to scroll history.
//
// Auto-stick-to-bottom: when the user has NOT scrolled up, new events keep the
// view pinned to the latest entry. As soon as they scroll up, we stop forcing
// scroll so they can read older entries without fighting the live tail.

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { classifyEvent, CHIP_COLOR_TO_CLASSES } from '@/lib/eventChip';
import type { NormalizedEvent } from '@/types/dashboard';

export type SwimlaneTimelineProps = {
  events: NormalizedEvent[];
  visibleWindow?: number;
  emptyHint?: string;
  title?: string;
};

const STICK_TOLERANCE_PX = 32;

export function SwimlaneTimeline({
  events,
  visibleWindow = 80,
  emptyHint = 'No real-time events yet — waiting for the next increment…',
  title = 'Swimlane timeline',
}: SwimlaneTimelineProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickyRef = useRef<boolean>(true);

  const start = Math.max(0, events.length - visibleWindow);
  const view = events.slice(start);
  const truncated = events.length - view.length;

  // Track scroll position so we know whether to keep auto-scrolling.
  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickyRef.current = distance <= STICK_TOLERANCE_PX;
  }

  // After each render, if the user is "at the bottom", glue the scroll to the
  // newest chip. Using an effect (not a useLayoutEffect) is fine — the chip is
  // small, a single frame of delay is invisible.
  //
  // Key on the newest event's identity (its ts), NOT events.length: once the
  // 500-cap ring is full the length stays pinned at 500 while content keeps
  // churning, so a length-keyed effect would stop firing and auto-stick would
  // silently break. The last ts changes on every new append.
  const lastTs = events.length > 0 ? events[events.length - 1].ts : null;
  useEffect(() => {
    if (!stickyRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lastTs]);

  if (view.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border/70 bg-background/40 px-3 py-4 text-center text-xs text-muted-foreground">
        {emptyHint}
      </div>
    );
  }

  // The outer is `min-h-0 flex-1` so a parent `flex flex-col` (AgentPanel)
  // hands the swimlane all leftover vertical space — that's how multi-panel
  // rows reach equal height (US-013). The inner scroll gets a min-height so
  // a bare-bones panel still shows a meaningful event window.
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <div className="flex items-center justify-between text-[14px] uppercase tracking-wider text-muted-foreground">
        <span>{title}</span>
        <span>
          {view.length}
          {truncated > 0 ? ` / ${events.length}` : ''}
        </span>
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex min-h-[10rem] flex-1 flex-col gap-1 overflow-y-auto pr-1"
      >
        {view.map((ev, i) => (
          <EventChipRow key={`${ev.ts ?? ''}-${start + i}`} ev={ev} />
        ))}
      </div>
    </div>
  );
}

function EventChipRow({ ev }: { ev: NormalizedEvent }) {
  const c = classifyEvent(ev);
  const palette = CHIP_COLOR_TO_CLASSES[c.color];
  const agentBadge = ev.agentId ? `${shortType(ev.agentType)}·${ev.agentId.slice(0, 6)}` : null;

  return (
    <div
      title={c.title}
      className={cn(
        'flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[15px] leading-tight',
        palette.bg,
        palette.border,
      )}
    >
      {agentBadge ? (
        <span className="shrink-0 rounded bg-secondary/60 px-1 font-mono text-[14px] text-muted-foreground">
          {agentBadge}
        </span>
      ) : null}
      <span
        className={cn(
          'shrink-0 truncate font-mono text-[14px] font-semibold uppercase tracking-wider',
          palette.text,
        )}
        style={{ maxWidth: '10rem' }}
      >
        {c.label}
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground/85">{c.text}</span>
    </div>
  );
}

function shortType(t: string | null | undefined): string {
  if (!t) return 'agent';
  return t === 'general-purpose' ? 'gen' : t;
}
