// metricInfo.ts — plain-language explanations of each metric, shown inline in the stage
// detail view (not just tooltips). Grounded in src/evaluator.js + the research baseline.

export const CORE_DIM_INFO: Record<string, { label: string; what: string }> = {
  delivery: { label: 'Delivery', what: 'Commits made vs. how much sits uncommitted — shipping cadence.' },
  quality: { label: 'Quality', what: 'Build / lint / typecheck / test outcomes and how many files were touched.' },
  verification: { label: 'Rigor', what: 'Test discipline — were tests run, and did edits finish untested.' },
  debugging: { label: 'Debugging', what: 'Error-loop detection — same error repeating, or churn without a green test.' },
  context: { label: 'Architecture', what: 'Explore-before-edit and blast radius — understanding before changing.' },
  autonomy: { label: 'Autonomy', what: 'Tool calls per user turn and how often the user had to intervene.' },
  recovery: { label: 'Recovery', what: 'Error count and whether the agent is currently stuck.' },
};

// ROLE_DIM_INFO — plain-language "what this measures" for every role-overlay dimension
// (src/roleMetrics.js). Keyed by the bare dim name. This is the GENERAL explanation shown
// under the polygon on click — distinct from each dim's `proxyNote` (the honesty caveat).
export const ROLE_DIM_INFO: Record<string, string> = {
  // pm / orchestration
  DecompositionQuality: 'Did the agent plan before delegating, and how cleanly it split the work into sub-tasks.',
  DelegationThroughput: 'How many sub-agents / tasks it spawned to parallelize the work.',
  ScopeCreep: 'How much the to-do list grew after work began — staying on scope vs. drifting.',
  Coordination: 'How actively it coordinated its sub-agents (messages sent per agent).',
  LoopEndurance: 'Long-horizon stamina: longest uninterrupted productive run, whether first-pass improved late vs. early, and whether it recovered instead of ending stuck.',
  // frontend
  ComponentReuse: 'Reusing existing view files vs. creating a brand-new component for everything.',
  PerfHygiene: 'Front-end performance discipline — running a build, code-splitting, measuring.',
  A11y: 'Accessibility awareness — use of aria / role / alt / label attributes.',
  ViewFocus: 'How much of the work landed on view/UI files (a role-purity signal, not a quality score).',
  // backend
  ReliabilityEng: 'Reliability mindset — validation, retries, timeouts, idempotency, error handling.',
  ApiSurface: 'How much API / endpoint surface the agent built or touched.',
  EndpointTestBacking: 'Whether backend changes were accompanied by test edits.',
  ErrorHandling: 'Recovering from errors during the run instead of ending stuck.',
  // database
  MigrationSafety: 'Safe schema change — a new migration file rather than rewriting history, and reversibility.',
  SchemaIntegrity: 'Use of integrity constraints (INDEX / UNIQUE / FK / CHECK / NOT NULL).',
  QueryCare: 'Query care — whether EXPLAIN and transactions were used.',
  DataSafety: 'Guarding destructive operations (DROP / DELETE) with transactions or backups.',
  // algorithm
  CorrectnessFirst: 'Writing or keeping tests before/with optimization — correctness before speed.',
  EdgeRobustness: 'Attention to edge cases and boundaries (empty / null / overflow / max).',
  OptimizeVerifyLoop: 'Verifying after optimizing — a green test followed by further edits.',
  ComplexityAwareness: 'Awareness of algorithmic complexity / benchmarking / profiling.',
  // test / qa
  TestAuthorship: 'Share of edits that are actual test files — how much testing was authored.',
  AssertionEffectiveness: 'Whether the tests actually assert (assertion density), not just run.',
  DefectDetection: 'Red → fix → green chains — tests that actually caught a bug.',
  StabilityHygiene: 'Coverage runs and repeated test runs — coverage / flakiness hygiene.',
};

export const CAPABILITY_INFO: { key: string; label: string; what: string; fmt: (v: number | null) => string }[] = [
  { key: 'firstPassRate', label: 'First-pass rate', what: 'Share of tool results that succeeded on the first try (rolling window). Higher = fewer retries.', fmt: (v) => (v == null ? '—' : `${Math.round(v * 100)}%`) },
  { key: 'reworkRate', label: 'Rework rate', what: 'How often the same file is edited again — thrash. Lower is better.', fmt: (v) => (v == null ? '—' : `${Math.round(v * 100)}%`) },
  { key: 'recoverySteps', label: 'Recovery steps', what: 'Average steps from an error to the next green result. Lower = recovers faster.', fmt: (v) => (v == null ? '—' : String(v)) },
  { key: 'lookBeforeLeap', label: 'Look before leap', what: 'Reads per edit — exploring before changing. Higher = more careful.', fmt: (v) => (v == null ? '—' : String(v)) },
  { key: 'autonomySpan', label: 'Autonomy span', what: 'Tool calls per user turn — how far it runs unattended.', fmt: (v) => (v == null ? '—' : String(v)) },
  { key: 'stuckRisk', label: 'Stuck risk', what: '0–100 risk of being stuck (error streak + edits since the last green). Lower is better.', fmt: (v) => (v == null ? '—' : String(v)) },
];
