// useDashboard — connects the React tree to /api/snapshot (initial + reconnect
// refresh) and /events (live SSE deltas), reducing both into a normalized
// per-sessionId store.
//
// Reconnect contract: EventSource auto-reconnects with the `retry: 2000` prime
// the server sends on /events. Every time the SSE socket reaches `onopen`
// (initial AND subsequent reconnects) we refetch /api/snapshot and rebuild the
// sessions map from scratch — that's how stale panels for ended sessions get
// cleared.

import { useEffect, useMemo, useReducer, useRef } from 'react';
import {
  dashboardReducer,
  INITIAL_STATE,
  type DashboardState,
} from '@/store/dashboardReducer';
import type {
  AgentSummary,
  SessionSummary,
  SnapshotResponse,
  SseMessage,
} from '@/types/dashboard';

export type UseDashboardOptions = {
  snapshotUrl?: string;
  eventsUrl?: string;
};

export type UseDashboardResult = DashboardState & {
  sessionList: SessionSummary[];
  totals: DashboardTotals;
};

export type DashboardTotals = {
  sessionsTotal: number;
  sessionsLive: number;
  agentsTotal: number;
  agentsLive: number;
  tokensInput: number;
  tokensOutput: number;
  tokensTotal: number;
  concernsTotal: number;
};

const ZERO_TOTALS: DashboardTotals = {
  sessionsTotal: 0,
  sessionsLive: 0,
  agentsTotal: 0,
  agentsLive: 0,
  tokensInput: 0,
  tokensOutput: 0,
  tokensTotal: 0,
  concernsTotal: 0,
};

function computeTotals(sessions: SessionSummary[]): DashboardTotals {
  const t = { ...ZERO_TOTALS };
  for (const s of sessions) {
    t.sessionsTotal += 1;
    if (s.status === 'live') t.sessionsLive += 1;
    t.agentsTotal += s.agentTotal || 0;
    t.agentsLive += s.agentsLive || 0;
    if (s.tokens) {
      t.tokensInput += s.tokens.input || 0;
      t.tokensOutput += s.tokens.output || 0;
      t.tokensTotal += s.tokens.total || 0;
    }
    if (s.evaluation?.overall?.concerns) t.concernsTotal += s.evaluation.overall.concerns;
  }
  return t;
}

function sortSessions(sessions: Record<string, SessionSummary>): SessionSummary[] {
  return Object.values(sessions).slice().sort((a, b) => (b.lastTs ?? 0) - (a.lastTs ?? 0));
}

export function useDashboard(opts: UseDashboardOptions = {}): UseDashboardResult {
  const snapshotUrl = opts.snapshotUrl ?? '/api/snapshot';
  const eventsUrl = opts.eventsUrl ?? '/events';
  const [state, dispatch] = useReducer(dashboardReducer, INITIAL_STATE);
  // Refs let the SSE listener (created once) reuse the latest abort controller
  // without re-subscribing on every snapshot tick.
  const snapshotAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadSnapshot() {
      snapshotAbortRef.current?.abort();
      const ctrl = new AbortController();
      snapshotAbortRef.current = ctrl;
      try {
        const res = await fetch(snapshotUrl, { signal: ctrl.signal, headers: { accept: 'application/json' } });
        if (!res.ok) throw new Error(`snapshot HTTP ${res.status}`);
        const body = (await res.json()) as SnapshotResponse;
        if (cancelled) return;
        dispatch({ type: 'snapshot', payload: body, ts: Date.now() });
      } catch (err) {
        if (cancelled) return;
        if ((err as { name?: string }).name === 'AbortError') return;
        // Snapshot failure leaves prior state intact; surface as connection error
        // so the UI can show a degraded banner instead of vanishing panels.
        dispatch({ type: 'connection', payload: 'error' });
      }
    }

    const es = new EventSource(eventsUrl);
    es.onopen = () => {
      if (cancelled) return;
      // Initial open AND every reconnect → refresh snapshot. This is what
      // clears panels for sessions that ended while we were disconnected.
      dispatch({ type: 'connection', payload: 'open' });
      loadSnapshot();
    };
    es.onerror = () => {
      if (cancelled) return;
      // EventSource auto-reconnects when readyState === CONNECTING (browser
      // honors the `retry: 2000` priming frame from the server). Reflect that
      // in the UI without tearing down the socket ourselves.
      const next = es.readyState === EventSource.CLOSED ? 'closed' : 'reconnecting';
      dispatch({ type: 'connection', payload: next });
    };
    es.onmessage = (msg) => {
      if (cancelled) return;
      let payload: SseMessage;
      try { payload = JSON.parse(msg.data) as SseMessage; } catch { return; }
      dispatch({ type: 'sse', payload, ts: Date.now() });
    };

    return () => {
      cancelled = true;
      snapshotAbortRef.current?.abort();
      es.close();
    };
  }, [snapshotUrl, eventsUrl]);

  const sessionList = useMemo(() => sortSessions(state.sessions), [state.sessions]);
  const totals = useMemo(() => computeTotals(sessionList), [sessionList]);

  return { ...state, sessionList, totals };
}

// Re-export the agent type for the few panel components that already need it.
export type { AgentSummary };
