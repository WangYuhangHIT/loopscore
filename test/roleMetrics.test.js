'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { facetDims, roleOverlay, FACET_DIMS } = require('../src/roleMetrics');

const tu = (o) => Object.assign({ kind: 'tool_use' }, o);
const tr = (isError, o = {}) => Object.assign({ kind: 'tool_result', isError }, o);
const user = () => ({ kind: 'user' });

// ---- PM facet ----
test('pm: LoopEndurance exposes the 3 sub-metrics', () => {
  const events = [user(), tu({ tool: 'Read' }), tu({ tool: 'Edit' }), tr(false), tu({ tool: 'Bash' }), tr(false)];
  const d = facetDims('pm', events);
  assert.ok(d.LoopEndurance, 'LoopEndurance present');
  const v = d.LoopEndurance.value;
  assert.ok('enduranceSpan' in v && 'driftResistance' in v && 'longHorizonRecovery' in v);
});

test('pm: DelegationThroughput counts spawns; DecompositionQuality sees plan-before-spawn', () => {
  const events = [tu({ tool: 'TodoWrite' }), tu({ tool: 'Task' }), tu({ tool: 'Agent' })];
  const d = facetDims('pm', events);
  assert.strictEqual(d.DelegationThroughput.value.spawned, 2);
  assert.strictEqual(d.DecompositionQuality.value.hasPlan, true);
});

test('pm: driftResistance > 1 when later third recovers from an early-failing run', () => {
  const events = [
    tr(true, { errorSig: 'e' }), tr(true, { errorSig: 'e' }), tr(true, { errorSig: 'e' }),
    tu({ tool: 'Edit' }), tu({ tool: 'Edit' }), tu({ tool: 'Edit' }),
    tr(false), tr(false), tr(false),
  ];
  const d = facetDims('pm', events);
  assert.ok(d.LoopEndurance.value.driftResistance > 1, 'late third improves over early');
});

// ---- frontend facet ----
test('frontend: ComponentReuse high editing existing views, low creating new', () => {
  const reuse = facetDims('frontend', [tu({ tool: 'Edit', filePath: 'a.tsx' }), tu({ tool: 'Edit', filePath: 'a.tsx' })]);
  assert.ok(reuse.ComponentReuse.value >= 0.9);
  const create = facetDims('frontend', [tu({ tool: 'Write', filePath: 'a.tsx' }), tu({ tool: 'Write', filePath: 'b.tsx' })]);
  assert.ok(create.ComponentReuse.value <= 0.1);
});

test('frontend: PerfHygiene flags build + code-split (with honest proxyNote)', () => {
  const d = facetDims('frontend', [
    tu({ tool: 'Bash', command: 'npm run build' }),
    tu({ tool: 'Edit', filePath: 'a.tsx', textSnippet: 'React.lazy(() => import(' }),
  ]);
  assert.strictEqual(d.PerfHygiene.value.ranBuild, true);
  assert.strictEqual(d.PerfHygiene.value.codeSplit, true);
  assert.ok(d.PerfHygiene.proxyNote, 'PerfHygiene is indirect → carries proxyNote');
});

// ---- backend facet ----
test('backend: ReliabilityEng counts defensive keywords', () => {
  const d = facetDims('backend', [tu({ tool: 'Edit', filePath: 'backend/api/x.js', textSnippet: 'try { validate(req.body) } catch' })]);
  assert.ok(d.ReliabilityEng.value.hits > 0);
  assert.ok(d.ReliabilityEng.proxyNote);
});

test('backend: EndpointTestBacking true when backend edit accompanied by a test edit', () => {
  const d = facetDims('backend', [tu({ tool: 'Edit', filePath: 'backend/api/x.js' }), tu({ tool: 'Write', filePath: 'x.test.js' })]);
  assert.strictEqual(d.EndpointTestBacking.value, true);
});

// ---- database facet ----
test('database: SchemaIntegrity counts constraints; MigrationSafety flags new migration', () => {
  const d = facetDims('database', [tu({ tool: 'Write', filePath: 'migrations/005.sql', textSnippet: 'CREATE UNIQUE INDEX ... FOREIGN KEY' })]);
  assert.ok(d.SchemaIntegrity.value > 0);
  assert.strictEqual(d.MigrationSafety.value.newMigration, true);
});

// ---- algorithm facet ----
test('algorithm: ComplexityAwareness detects big-O mention', () => {
  const d = facetDims('algorithm', [{ kind: 'thinking', textSnippet: 'this is O(n log n) complexity' }]);
  assert.ok(d.ComplexityAwareness.value.hits > 0);
});

// ---- test facet ----
test('test: TestAuthorship ratio + DefectDetection red→fix→green chain', () => {
  const events = [
    tu({ tool: 'Write', filePath: 'x.test.js' }),
    tu({ tool: 'Bash', command: 'npm test' }), tr(true, { errorSig: 'fail' }),
    tu({ tool: 'Edit', filePath: 'x.js' }),
    tu({ tool: 'Bash', command: 'npm test' }), tr(false),
  ];
  const d = facetDims('test', events);
  assert.ok(d.TestAuthorship.value > 0);
  assert.ok(d.DefectDetection.value >= 1);
});

// ---- roleOverlay (composite = facet union) ----
test('roleOverlay: union of facets keyed by facet name', () => {
  const o = roleOverlay(['backend', 'database'], [
    tu({ tool: 'Edit', filePath: 'backend/api/x.js', textSnippet: 'router.post' }),
    tu({ tool: 'Write', filePath: 'migrations/1.sql', textSnippet: 'CREATE INDEX' }),
  ]);
  assert.ok(o.backend && o.database);
  assert.ok(o.backend.ReliabilityEng && o.database.SchemaIntegrity);
});

test('roleOverlay/facetDims: empty or unknown facet → {} (no throw)', () => {
  assert.deepStrictEqual(roleOverlay([], []), {});
  assert.deepStrictEqual(facetDims('nope', []), {});
  assert.ok(FACET_DIMS.pm && FACET_DIMS.frontend, 'FACET_DIMS registry exported');
});
