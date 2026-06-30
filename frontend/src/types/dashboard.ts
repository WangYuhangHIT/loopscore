// Mirrors the wire shapes produced by src/sessionModel.js (`summarize`),
// src/evaluator.js (`evaluate`) and src/server.js SSE broadcasts.
//
// Kept permissive on the LLM-shaped sub-payloads (judgment / review / sub-agent
// `last` event) so US-007+ can tighten them when those panels are built.

export type DimensionRating = 'good' | 'ok' | 'concern';

export type DimensionMetrics = {
  rating: DimensionRating;
  [key: string]: unknown;
};

export type Capability = {
  firstPassRate: number | null;
  reworkRate: number;
  recoverySteps: number;
  lookBeforeLeap: number | null;
  autonomySpan: number;
  stuckRisk: number;
};

// Per-session rolling sample of evaluator capability ratios, accumulated by
// dashboardReducer on snapshot/evaluation/session SSE messages. The chart in
// US-008 reads this directly; new fields here are picked up by `appendCapabilitySample`.
export type CapabilitySample = {
  ts: number;
  firstPassRate: number | null;
  reworkRate: number;
  lookBeforeLeap: number | null;
  autonomySpan: number;
  stuckRisk: number;
  recoverySteps: number;
};

export type Cost = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  [k: string]: unknown;
};

// Role-specific overlay dimension (src/roleMetrics.js). value is heterogeneous
// (number / boolean / small object); proxyNote present on INDIRECT dims (honest labeling).
export type RoleDim = { value: unknown; rating: DimensionRating; proxyNote?: string };
// facet name → { dimName → RoleDim }. Composite roles carry multiple facets.
export type RoleOverlay = Record<string, Record<string, RoleDim>>;

export type Evaluation = {
  dimensions: Record<string, DimensionMetrics>;
  capability: Capability;
  usage?: Record<string, unknown>;
  cost?: Cost;
  overall: { concerns: number; label: string };
  bucket: 'deterministic';
  roleOverlay?: RoleOverlay;
};

export type NormalizedEvent = {
  ts: string;
  sessionId: string;
  kind: string;
  tool?: string;
  agentId?: string;
  agentType?: string;
  lane?: string;
  filePath?: string;
  command?: string;
  isError?: boolean;
  [k: string]: unknown;
};

// Role fingerprint from src/roleClassifier.js (classify). Phase 1 is fingerprint-only.
export type Role = {
  role: string;
  facets: string[];
  confidence: number;
  source: string;
};

export type AgentSummary = {
  agentId: string;
  agentType: string | null;
  status: 'live' | 'idle';
  lastTs: number | null;
  eventCount: number;
  last: NormalizedEvent | null;
  role?: Role;
  evaluation?: Evaluation;
};

export type SessionTokens = { input: number; output: number; total: number };

// Team rollup (src/teamMetrics.js). Each block has a heterogeneous `value`, a rating,
// and a plain-language `note` (shown as an ⓘ tooltip — honest about what it estimates).
export type TeamBlock = { value: Record<string, unknown>; rating: DimensionRating; note?: string };
export type TeamMetrics = {
  RoleCoverage: TeamBlock;
  Parallelism: TeamBlock;
  CollaborationHealth: TeamBlock;
  memberCount: number;
  teamConcerns: number | null;
};

export type ProjectSummary = {
  projectId: string;
  name: string;
  path: string | null;
  sessions: number;
  live: number;
  lastTs: number | null;
};

export type SessionSummary = {
  sessionId: string;
  projectId?: string | null;
  gitBranch?: string;
  project?: string;
  status: 'live' | 'idle';
  lastTs: number | null;
  laneCount: number;
  eventCount: number;
  agents: AgentSummary[];
  agentTotal: number;
  agentsLive: number;
  evaluation?: Evaluation;
  tokens?: SessionTokens;
  mainRole?: Role;
  team?: TeamMetrics;
};

export type SnapshotResponse = {
  sessions: SessionSummary[];
  projects?: ProjectSummary[];
  schemaOk?: boolean;
  warnings?: string[];
};

export type Judgment = { sessionId?: string; [k: string]: unknown };
export type Review = { sessionId?: string; [k: string]: unknown };

export type SseEventMessage = { type: 'event'; sessionId: string; event: NormalizedEvent };
export type SseEvaluationMessage = { type: 'evaluation'; sessionId: string; evaluation: Evaluation };
export type SseSessionMessage = { type: 'session'; sessionId: string; session: SessionSummary };
export type SseJudgmentMessage = { type: 'judgment'; sessionId: string; verdict: Judgment };
export type SseReviewMessage = { type: 'review'; sessionId: string; review: Review };
export type SseSchemaWarningMessage = { type: 'schema-warning'; message: string };

export type SseMessage =
  | SseEventMessage
  | SseEvaluationMessage
  | SseSessionMessage
  | SseJudgmentMessage
  | SseReviewMessage
  | SseSchemaWarningMessage;

export type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'error';
