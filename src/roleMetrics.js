'use strict';
/**
 * roleMetrics.js — role-specific OVERLAY dimensions that sit on top of the generic
 * core 7-dim evaluation (evaluator.js). One group of dims per atomic facet
 * (frontend/backend/database/algorithm/test/pm), per design §5.2. PURE, zero-dep.
 *
 *   facetDims(facet, events) -> { DimName: { value, rating, proxyNote? } }
 *   roleOverlay(facets, events) -> { [facet]: facetDims(facet, events) }   // composite = union
 *
 * HONESTY (design §3): the transcript can't measure real Web Vitals / p99 / mutation
 * score / big-O. Worse, the adapter does NOT capture edit diffs (an Edit's textSnippet
 * is the file path) — keyword dims read what IS observable: Read/Bash result text,
 * commands, and file paths. So many dims are INDIRECT proxies; those carry a
 * `proxyNote` stating what is estimated and why it's only an estimate. Ratings stay
 * good/ok/concern; thresholds are first-cut and calibrated on real sessions (§5.2 note).
 */

const { SIGNALS } = require('./roleClassifier');

const VIEW_FILE = /\.(tsx|jsx|vue|css|scss|less|html)$/i;
const BUILD_CMD = /vite build|webpack|next build|ng build|npm run build|rollup -c|esbuild/i;
const TEST_FILE = SIGNALS.test.file;
const BACKEND_FILE = SIGNALS.backend.file;
const MIGRATION_FILE = /\/migrations?\/|\.sql$/i;

const isEdit = (e) => e.kind === 'tool_use' && (e.tool === 'Edit' || e.tool === 'Write');
const isCreate = (e) => e.kind === 'tool_use' && e.tool === 'Write'; // Write = new/overwrite; Edit = modify existing
const isBash = (e) => e.kind === 'tool_use' && e.tool === 'Bash';
const textOf = (e) => `${e.textSnippet || ''} ${e.command || ''}`;
const { round } = require('./round');
const rate = (good, concern) => (concern ? 'concern' : good ? 'good' : 'ok');

// Count regex hits across all events' observable text (result text / commands / snippets).
function kwHits(events, re) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let n = 0;
  for (const e of events) {
    const m = textOf(e).match(g);
    if (m) n += m.length;
  }
  return n;
}

// Count error tool_results that are later followed by a green tool_result (recovered).
function recoveryCount(events) {
  let n = 0;
  for (let i = 0; i < events.length; i++) {
    if (events[i].kind === 'tool_result' && events[i].isError) {
      for (let j = i + 1; j < events.length; j++) {
        if (events[j].kind === 'tool_result' && !events[j].isError) { n++; break; }
      }
    }
  }
  return n;
}

// Trailing run of identical error signatures (session ended stuck) >= streak.
function terminalStuck(events, streak = 3) {
  const results = events.filter((e) => e.kind === 'tool_result');
  let run = 0, sig = null;
  for (let i = results.length - 1; i >= 0; i--) {
    const r = results[i];
    if (!r.isError) break;
    if (run === 0) { run = 1; sig = r.errorSig; }
    else if (r.errorSig === sig) run++;
    else break;
  }
  return run >= streak ? 1 : 0;
}

function firstPassRate(events) {
  const r = events.filter((e) => e.kind === 'tool_result');
  return r.length ? r.filter((e) => !e.isError).length / r.length : null;
}

// ---------------------------------------------------------------------------
// PM / orchestration
// ---------------------------------------------------------------------------
const SPAWN_TOOLS = new Set(['Task', 'Agent', 'Workflow']);
const PLAN_TOOLS = new Set(['TodoWrite', 'ExitPlanMode']);

function pmDims(events) {
  let firstSpawnIdx = -1, spawned = 0, planBeforeSpawn = false, planCount = 0, msgs = 0;
  let todoTotal = 0, todoAfterSpawn = 0;
  events.forEach((e, i) => {
    if (e.kind !== 'tool_use' || !e.tool) return;
    if (SPAWN_TOOLS.has(e.tool)) { if (firstSpawnIdx < 0) firstSpawnIdx = i; spawned++; }
    if (PLAN_TOOLS.has(e.tool)) { planCount++; if (firstSpawnIdx < 0) planBeforeSpawn = true; }
    if (e.tool === 'TodoWrite') { todoTotal++; if (firstSpawnIdx >= 0 && i > firstSpawnIdx) todoAfterSpawn++; }
    if (e.tool === 'SendMessage') msgs++;
  });
  const hasPlan = planBeforeSpawn || (firstSpawnIdx < 0 && planCount > 0);
  const scopeCreep = todoTotal ? round(todoAfterSpawn / todoTotal) : 0;
  const coordPerAgent = spawned ? round(msgs / spawned) : 0;

  // --- LoopEndurance (the flagship main-agent metric) ---
  let maxRun = 0, cur = 0;
  for (const e of events) {
    if (e.kind === 'user') cur = 0;                                        // a human turn breaks the autonomous run
    else if (e.kind === 'tool_use') { cur++; if (cur > maxRun) maxRun = cur; } // count only productive (tool) work, not thinking/results
  }
  const enduranceSpan = round(Math.min(1, maxRun / 40));
  const n = events.length, t = Math.floor(n / 3);
  const firstFpr = t ? firstPassRate(events.slice(0, t)) : null;
  const lastFpr = t ? firstPassRate(events.slice(n - t)) : null;
  // ratio of late-vs-early first-pass; >1 = improving. epsilon so "0% → some%" reads as
  // strong improvement (not null), capped at 3 so it stays a readable ratio.
  const driftResistance = (firstFpr != null && lastFpr != null)
    ? round(Math.min(3, lastFpr / Math.max(firstFpr, 0.01))) : null;
  const recoveries = recoveryCount(events);
  const stuck = terminalStuck(events);
  const longHorizonRecovery = (recoveries + stuck) ? round(recoveries / (recoveries + stuck)) : null;
  const loopConcern = stuck === 1 || (driftResistance != null && driftResistance < 0.7);
  const loopGood = enduranceSpan >= 0.5 && (driftResistance == null || driftResistance >= 1) && !stuck;

  return {
    DecompositionQuality: { value: { hasPlan, spawned }, rating: rate(hasPlan, spawned >= 2 && !hasPlan),
      proxyNote: 'Estimates plan quality from "planned before delegating"; cannot see delegated-task outcomes directly.' },
    DelegationThroughput: { value: { spawned }, rating: rate(spawned > 0, false) },
    ScopeCreep: { value: scopeCreep, rating: rate(scopeCreep <= 0.3, scopeCreep > 0.6),
      proxyNote: 'Todo growth after first delegation approximates mid-flight scope creep.' },
    Coordination: { value: { sendMessages: msgs, perAgent: coordPerAgent }, rating: 'ok' },
    LoopEndurance: {
      value: { enduranceSpan, driftResistance, longHorizonRecovery },
      rating: rate(loopGood, loopConcern),
      proxyNote: 'Long-horizon autonomy proxy: longest uninterrupted productive run, late-vs-early first-pass trend, and recover-vs-terminal-stuck. Approximates METR-style endurance from the event stream.',
    },
  };
}

// ---------------------------------------------------------------------------
// Frontend
// ---------------------------------------------------------------------------
function frontendDims(events) {
  const viewEdits = events.filter((e) => isEdit(e) && VIEW_FILE.test(e.filePath || ''));
  const newViews = viewEdits.filter((e) => isCreate(e)).length;
  const reuse = viewEdits.length ? round(1 - newViews / viewEdits.length) : null;
  const allEdits = events.filter(isEdit).length;
  const viewFocus = allEdits ? round(viewEdits.length / allEdits) : null;

  const ranBuild = events.some((e) => isBash(e) && BUILD_CMD.test(e.command || ''));
  const codeSplit = kwHits(events, /lazy\(|import\(|dynamic\(|Suspense/) > 0;
  const ranLighthouse = events.some((e) => isBash(e) && /lighthouse/.test(e.command || ''));
  const a11yHits = kwHits(events, /aria-|role=|alt=|<label|tabIndex/);
  const a11yDensity = viewEdits.length ? round(a11yHits / viewEdits.length) : 0;

  return {
    ComponentReuse: { value: reuse, rating: rate(reuse != null && reuse >= 0.5, reuse != null && reuse < 0.2),
      proxyNote: 'Reuse ≈ editing existing view files rather than creating new ones; cannot inspect actual component graph.' },
    PerfHygiene: { value: { ranBuild, codeSplit, ranLighthouse },
      rating: rate(ranBuild || codeSplit || ranLighthouse, false),
      proxyNote: 'STRONG proxy: cannot measure real LCP/INP/CLS — only whether the agent ran a build / touched code-splitting / ran lighthouse.' },
    A11y: { value: { hits: a11yHits, density: a11yDensity }, rating: rate(a11yDensity > 0, false),
      proxyNote: 'a11y-attribute density approximates accessibility awareness, not WCAG compliance.' },
    ViewFocus: { value: viewFocus, rating: 'ok',
      proxyNote: 'Role-purity signal (corroborates classification), not a quality score.' },
  };
}

// ---------------------------------------------------------------------------
// Backend
// ---------------------------------------------------------------------------
function backendDims(events) {
  const backendEdits = events.filter((e) => isEdit(e) && BACKEND_FILE.test(e.filePath || ''));
  const testEdits = events.filter((e) => isEdit(e) && TEST_FILE.test(e.filePath || '')).length;
  const relHits = kwHits(events, /\btry\b|\bcatch\b|validate|schema|idempoten|retry|timeout|rate.?limit/i);
  const relDensity = backendEdits.length ? round(relHits / backendEdits.length) : 0;
  const endpointHits = kwHits(events, /\.(get|post|put|delete|patch)\(|router\.|app\.(get|post|put|delete|patch)/i);

  return {
    ReliabilityEng: { value: { hits: relHits, density: relDensity }, rating: rate(relHits > 0, backendEdits.length >= 3 && relHits === 0),
      proxyNote: 'Cannot measure p99/success-rate — counts defensive/reliability code keywords as an SLO-mindset proxy.' },
    ApiSurface: { value: { backendFiles: backendEdits.length, endpointHits }, rating: rate(backendEdits.length > 0 || endpointHits > 0, false) },
    EndpointTestBacking: { value: backendEdits.length > 0 && testEdits > 0, rating: rate(backendEdits.length > 0 && testEdits > 0, backendEdits.length >= 3 && testEdits === 0),
      proxyNote: 'Co-occurrence of test edits with backend edits approximates integration-test discipline.' },
    ErrorHandling: { value: { recoveries: recoveryCount(events) }, rating: rate(true, terminalStuck(events) === 1) },
  };
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
function databaseDims(events) {
  const newMigration = events.some((e) => isCreate(e) && MIGRATION_FILE.test(e.filePath || ''));
  const editsHistoricMigration = events.some((e) => e.kind === 'tool_use' && e.tool === 'Edit' && MIGRATION_FILE.test(e.filePath || ''));
  const reversible = kwHits(events, /\bdown\b|rollback|DROP .*-- ?revert/i) > 0;
  const constraintHits = kwHits(events, /\bINDEX\b|\bUNIQUE\b|FOREIGN KEY|\bCHECK\b|NOT NULL/i);
  const ddlChanges = kwHits(events, /CREATE TABLE|ALTER TABLE|CREATE (UNIQUE )?INDEX/i) || (newMigration ? 1 : 0);
  const explained = kwHits(events, /\bEXPLAIN\b/i) > 0;
  const transactional = kwHits(events, /\bBEGIN\b|\bCOMMIT\b|SAVEPOINT/i) > 0;
  const destructive = kwHits(events, /\bDROP\b|\bDELETE\b|TRUNCATE/i) > 0;
  const guarded = transactional || kwHits(events, /backup|pg_dump|dry-?run/i) > 0;

  return {
    MigrationSafety: { value: { newMigration, editsHistoric: editsHistoricMigration, reversible },
      rating: rate(newMigration && !editsHistoricMigration, editsHistoricMigration),
      proxyNote: 'Safe = new migration file (not rewriting history); reversible inferred from down/rollback keywords.' },
    SchemaIntegrity: { value: ddlChanges ? round(constraintHits / Math.max(1, ddlChanges)) : constraintHits,
      rating: rate(constraintHits > 0, false),
      proxyNote: 'Constraint density (INDEX/UNIQUE/FK/CHECK/NOT NULL) approximates integrity discipline.' },
    QueryCare: { value: { explained, transactional }, rating: rate(explained || transactional, false),
      proxyNote: 'Cannot time real execution plans — only whether EXPLAIN / transactions were used.' },
    DataSafety: { value: { destructive, guarded }, rating: rate(!destructive || guarded, destructive && !guarded) },
  };
}

// ---------------------------------------------------------------------------
// Algorithm
// ---------------------------------------------------------------------------
function algorithmDims(events) {
  const firstAlgoEditIdx = events.findIndex((e) => isEdit(e));
  const firstTestIdx = events.findIndex((e) => isEdit(e) && TEST_FILE.test(e.filePath || ''));
  const correctnessFirst = firstTestIdx >= 0 && (firstAlgoEditIdx < 0 || firstTestIdx <= firstAlgoEditIdx);
  const edgeHits = kwHits(events, /\bedge\b|boundary|\bempty\b|\bnull\b|overflow|\bmax\b/i);
  const assertionHits = kwHits(events, /assert\b|expect\(|toBe|toEqual/);
  // optimize→verify loop: green test followed later by another edit on a touched file
  let optimizeVerify = 0;
  for (let i = 1; i < events.length; i++) {
    if (events[i].kind === 'tool_result' && !events[i].isError && events.slice(0, i).some((e) => e.kind === 'tool_use' && e.tool === 'Bash')) {
      if (events.slice(i + 1).some(isEdit)) { optimizeVerify++; break; }
    }
  }
  const complexityHits = kwHits(events, /O\([^)]*\)|complexity|big-?o|benchmark|profile/i);

  return {
    CorrectnessFirst: { value: correctnessFirst, rating: rate(correctnessFirst, false),
      proxyNote: 'Test-before/with-optimization timing approximates a "correctness-first" habit.' },
    EdgeRobustness: { value: { hits: edgeHits, assertions: assertionHits }, rating: rate(edgeHits > 0, false),
      proxyNote: 'Edge-keyword + assertion density approximates boundary robustness.' },
    OptimizeVerifyLoop: { value: optimizeVerify, rating: rate(optimizeVerify > 0, false) },
    ComplexityAwareness: { value: { hits: complexityHits }, rating: rate(complexityHits > 0, false),
      proxyNote: 'WEAK proxy: cannot derive real big-O — counts complexity/benchmark mentions only.' },
  };
}

// ---------------------------------------------------------------------------
// Test / QA
// ---------------------------------------------------------------------------
function testDims(events) {
  const allEdits = events.filter(isEdit).length;
  const testEdits = events.filter((e) => isEdit(e) && TEST_FILE.test(e.filePath || '')).length;
  const authorship = allEdits ? round(testEdits / allEdits) : (testEdits > 0 ? 1 : 0);
  const assertionHits = kwHits(events, /assert\b|expect\(|\.should\b|toBe|toEqual/);
  const assertionPerTestEdit = testEdits ? round(assertionHits / testEdits) : 0;
  const defectDetection = recoveryCount(events); // red → fix → green chains
  const ranCoverage = events.some((e) => isBash(e) && /coverage|--cov|nyc\b|c8\b/.test(e.command || ''));
  const testCmds = events.filter((e) => isBash(e) && SIGNALS.test.cmd.test(e.command || '')).length;

  return {
    TestAuthorship: { value: authorship, rating: rate(authorship > 0, false) },
    AssertionEffectiveness: { value: { hits: assertionHits, perTestEdit: assertionPerTestEdit }, rating: rate(assertionHits > 0, false),
      proxyNote: 'Cannot run mutation testing — assertion density approximates whether tests actually assert.' },
    DefectDetection: { value: defectDetection, rating: rate(defectDetection > 0, false),
      proxyNote: 'Red→fix→green chains approximate defect-detection power (tests that actually caught a bug).' },
    StabilityHygiene: { value: { ranCoverage, testRuns: testCmds }, rating: rate(ranCoverage, false),
      proxyNote: 'Coverage-run + repeated runs approximate coverage/flakiness hygiene.' },
  };
}

const FACET_DIMS = {
  pm: pmDims,
  frontend: frontendDims,
  backend: backendDims,
  database: databaseDims,
  algorithm: algorithmDims,
  test: testDims,
};

function facetDims(facet, events) {
  const fn = FACET_DIMS[facet];
  if (!fn) return {};
  return fn(events || []);
}

// Composite role = union of its facets' dims, keyed by facet so the UI can group/label.
function roleOverlay(facets, events) {
  const out = {};
  for (const f of facets || []) {
    if (FACET_DIMS[f]) out[f] = facetDims(f, events);
  }
  return out;
}

module.exports = { facetDims, roleOverlay, FACET_DIMS };
