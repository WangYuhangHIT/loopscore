// Pure reducer for the dashboard data layer. Kept side-effect-free so the
// fetch/SSE wiring in `useDashboard` can stay thin and so future stories
// (US-007 swimlanes, US-011 overview bar) can drive it from synthetic data.
//
// Routing invariant (US-004): every per-session SSE payload carries top-level
// `sessionId`. `schema-warning` is the only intentional global payload.
//
// Snapshot replace invariant (US-005): on reconnect we refetch /api/snapshot
// and rebuild `sessions` from scratch — sessions absent from the new snapshot
// disappear from per-session sub-maps (events / evaluations / reviews /
// judgments). Otherwise we'd leave stale panels visible after a session ends.

import type {
  Capability,
  CapabilitySample,
  ConnectionState,
  Evaluation,
  Judgment,
  NormalizedEvent,
  Review,
  SessionSummary,
  ProjectSummary,
  SnapshotResponse,
  SseMessage,
} from '@/types/dashboard';

export type DashboardState = {
  sessions: Record<string, SessionSummary>;
  projects: ProjectSummary[];
  events: Record<string, NormalizedEvent[]>;
  evaluations: Record<string, Evaluation>;
  capabilityHistory: Record<string, CapabilitySample[]>;
  reviews: Record<string, Review>;
  judgments: Record<string, Judgment[]>;
  schemaOk: boolean;
  schemaWarnings: string[];
  connection: ConnectionState;
  lastSnapshotTs: number | null;
  lastEventTs: number | null;
};

export type DashboardAction =
  | { type: 'snapshot'; payload: SnapshotResponse; ts: number }
  | { type: 'sse'; payload: SseMessage; ts: number }
  | { type: 'connection'; payload: ConnectionState };

export const INITIAL_STATE: DashboardState = {
  sessions: {},
  projects: [],
  events: {},
  evaluations: {},
  capabilityHistory: {},
  reviews: {},
  judgments: {},
  schemaOk: true,
  schemaWarnings: [],
  connection: 'connecting',
  lastSnapshotTs: null,
  lastEventTs: null,
};

export const EVENT_RING_CAP = 500;
export const JUDGMENT_CAP_PER_SESSION = 50;
export const SCHEMA_WARNING_CAP = 50;
export const CAPABILITY_HISTORY_CAP = 60;

function pickKnownIds<V>(map: Record<string, V>, ids: Set<string>): Record<string, V> {
  const out: Record<string, V> = {};
  for (const id of Object.keys(map)) if (ids.has(id)) out[id] = map[id]!;
  return out;
}

function pushRing<V>(arr: V[] | undefined, ev: V, cap: number): V[] {
  const next = arr ? arr.slice() : [];
  next.push(ev);
  if (next.length > cap) next.splice(0, next.length - cap);
  return next;
}

function pushWarning(list: string[], msg: string): string[] {
  if (list.includes(msg)) return list;
  const next = list.concat(msg);
  if (next.length > SCHEMA_WARNING_CAP) next.splice(0, next.length - SCHEMA_WARNING_CAP);
  return next;
}

// Dedupe consecutive samples — every snapshot fetch passes through here, so we
// only append when one of the capability ratios actually moved. Without the
// guard the ring fills with N copies of the same point and the chart becomes a
// flat line of duplicates.
function sameSample(a: CapabilitySample, b: CapabilitySample): boolean {
  return (
    a.firstPassRate === b.firstPassRate &&
    a.reworkRate === b.reworkRate &&
    a.lookBeforeLeap === b.lookBeforeLeap &&
    a.autonomySpan === b.autonomySpan &&
    a.stuckRisk === b.stuckRisk &&
    a.recoverySteps === b.recoverySteps
  );
}

function toSample(cap: Capability, ts: number): CapabilitySample {
  return {
    ts,
    firstPassRate: cap.firstPassRate,
    reworkRate: cap.reworkRate,
    lookBeforeLeap: cap.lookBeforeLeap,
    autonomySpan: cap.autonomySpan,
    stuckRisk: cap.stuckRisk,
    recoverySteps: cap.recoverySteps,
  };
}

function appendCapabilitySample(
  history: Record<string, CapabilitySample[]>,
  sessionId: string,
  evaluation: Evaluation | undefined,
  ts: number,
): Record<string, CapabilitySample[]> {
  const cap = evaluation?.capability;
  if (!cap) return history;
  const sample = toSample(cap, ts);
  const prev = history[sessionId] ?? [];
  const last = prev[prev.length - 1];
  if (last && sameSample(last, sample)) return history;
  const next = prev.slice();
  next.push(sample);
  if (next.length > CAPABILITY_HISTORY_CAP) next.splice(0, next.length - CAPABILITY_HISTORY_CAP);
  return { ...history, [sessionId]: next };
}

function applySnapshot(state: DashboardState, payload: SnapshotResponse, ts: number): DashboardState {
  const sessions: Record<string, SessionSummary> = {};
  const evaluations: Record<string, Evaluation> = {};
  const ids = new Set<string>();
  for (const s of payload.sessions || []) {
    sessions[s.sessionId] = s;
    ids.add(s.sessionId);
    if (s.evaluation) evaluations[s.sessionId] = s.evaluation;
  }
  let capabilityHistory = pickKnownIds(state.capabilityHistory, ids);
  for (const s of payload.sessions || []) {
    if (s.evaluation) capabilityHistory = appendCapabilitySample(capabilityHistory, s.sessionId, s.evaluation, ts);
  }
  return {
    sessions,
    projects: payload.projects ?? [],
    events: pickKnownIds(state.events, ids),
    evaluations: { ...pickKnownIds(state.evaluations, ids), ...evaluations },
    capabilityHistory,
    reviews: pickKnownIds(state.reviews, ids),
    judgments: pickKnownIds(state.judgments, ids),
    schemaOk: payload.schemaOk !== false,
    schemaWarnings: payload.warnings ?? [],
    connection: 'open',
    lastSnapshotTs: ts,
    lastEventTs: state.lastEventTs,
  };
}

function applySse(state: DashboardState, msg: SseMessage, ts: number): DashboardState {
  switch (msg.type) {
    case 'event': {
      const ring = pushRing(state.events[msg.sessionId], msg.event, EVENT_RING_CAP);
      return { ...state, events: { ...state.events, [msg.sessionId]: ring }, lastEventTs: ts };
    }
    case 'evaluation': {
      return {
        ...state,
        evaluations: { ...state.evaluations, [msg.sessionId]: msg.evaluation },
        capabilityHistory: appendCapabilitySample(state.capabilityHistory, msg.sessionId, msg.evaluation, ts),
        lastEventTs: ts,
      };
    }
    case 'session': {
      return {
        ...state,
        sessions: { ...state.sessions, [msg.sessionId]: msg.session },
        evaluations: msg.session.evaluation
          ? { ...state.evaluations, [msg.sessionId]: msg.session.evaluation }
          : state.evaluations,
        capabilityHistory: appendCapabilitySample(
          state.capabilityHistory,
          msg.sessionId,
          msg.session.evaluation,
          ts,
        ),
        lastEventTs: ts,
      };
    }
    case 'judgment': {
      const ring = pushRing(state.judgments[msg.sessionId], msg.verdict, JUDGMENT_CAP_PER_SESSION);
      return { ...state, judgments: { ...state.judgments, [msg.sessionId]: ring }, lastEventTs: ts };
    }
    case 'review': {
      return {
        ...state,
        reviews: { ...state.reviews, [msg.sessionId]: msg.review },
        lastEventTs: ts,
      };
    }
    case 'schema-warning': {
      return {
        ...state,
        schemaOk: false,
        schemaWarnings: pushWarning(state.schemaWarnings, msg.message),
        lastEventTs: ts,
      };
    }
  }
}

export function dashboardReducer(state: DashboardState, action: DashboardAction): DashboardState {
  switch (action.type) {
    case 'snapshot': return applySnapshot(state, action.payload, action.ts);
    case 'sse':       return applySse(state, action.payload, action.ts);
    case 'connection': return { ...state, connection: action.payload };
  }
}
