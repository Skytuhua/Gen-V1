import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGGREGATION_ARTIFACT_PATH, runAggregationBenchmark, writeAggregationArtifact } from './fixtures/tool-program-benchmark-v3.ts';

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

it('measures exact aggregation, complete visible bytes, cold setup and retained failure overhead on the real JavaScript host', async () => {
  const report = await runAggregationBenchmark();
  expect(report.kind).toBe('FIXED_SYNTHETIC_WORKFLOW_MEASUREMENT');
  expect(report.liveModelEvaluation).toBe(false);
  expect(report.methodology).toMatchObject({ dependencyProof: { outOfOrderReadRejected: true, separateProbeReadAttempts: 1, initialKnownPaths: 1 } });
  expect(report.cases.map(value => value.name)).toEqual(['success', 'source_failure']);
  const success = report.cases[0]!, failure = report.cases[1]!;
  const expected = {
    paidOrders: 307, refundedOrders: 77, soldUnits: 1225, salesCents: 274750,
    salesCentsByRegion: { north: 67000, south: 69975, east: 69025, west: 68750 },
  };
  expect(report.expectedAnswer).toEqual(expected);
  expect(success.direct.answer).toEqual(expected);
  expect(success.program.answer).toEqual(expected);
  expect(success.direct.state).toBe('SUCCEEDED');
  expect(success.program.state).toBe('SUCCEEDED');
  expect(success.direct.hostReadCalls).toBe(6);
  expect(success.program.hostReadCalls).toBe(6);
  expect(success.direct.sequentialReadDependencies).toBe(5);
  expect(success.program.sequentialReadDependencies).toBe(5);
  expect(success.direct.modelRequests).toEqual({ setup: 0, execution: 6, diagnostic: 0, total: 6 });
  expect(success.program.modelRequests).toEqual({ setup: 1, execution: 1, diagnostic: 0, total: 2 });
  expect(success.program.modelVisibleBytes.total).toBeLessThan(success.direct.modelVisibleBytes.total);
  expect(success.direct.sourceRowsVisible).toBe(true);
  expect(success.program.sourceRowsVisible).toBe(false);
  expect(success.program.bulkInPublicStorage).toBe(false);

  expect(failure.direct.state).toBe('FAILED');
  expect(failure.program.state).toBe('FAILED');
  expect(failure.direct.answer).toBeNull();
  expect(failure.program.answer).toBeNull();
  expect(failure.direct.hostReadCalls).toBe(3);
  expect(failure.program.hostReadCalls).toBe(3);
  expect(failure.direct.sequentialReadDependencies).toBe(2);
  expect(failure.program.sequentialReadDependencies).toBe(2);
  expect(failure.direct.modelRequests).toEqual({ setup: 0, execution: 3, diagnostic: 0, total: 3 });
  expect(failure.program.modelRequests).toEqual({ setup: 1, execution: 1, diagnostic: 1, total: 3 });
  expect(failure.program.retainedSourceFailures).toBe(1);
  expect(failure.program.originalFailureInspected).toBe(true);
  expect(failure.program.bulkInPublicStorage).toBe(false);
  expect(failure.program.modelVisibleBytes.diagnostic).toBeGreaterThan(0);

  for (const entry of report.cases.flatMap(value => [value.direct, value.program])) {
    expect(entry.modelRoundTrips).toBe(entry.modelRequests.total);
    expect(entry.trace).toHaveLength(entry.modelRequests.total);
    expect(entry.modelVisibleBytes.total).toBe(entry.modelVisibleBytes.requests + entry.modelVisibleBytes.responses);
    expect(entry.elapsedMs).toBeGreaterThanOrEqual(0);
  }
  expect(report.tokenization.status).toBe('MEASURED_OFFLINE');
  const tokenCounts = report.tokenization.actualCounts;
  expect(tokenCounts).not.toBeNull();
  if (!tokenCounts) throw new Error('Actual named-encoding token measurements are required');
  expect(Object.keys(tokenCounts)).toEqual(['cl100k_base', 'o200k_base']);
  for (const encoding of ['cl100k_base', 'o200k_base'] as const) {
    const counts = tokenCounts[encoding];
    expect(counts.success.program.total).toBeLessThan(counts.success.direct.total);
    expect(counts.source_failure.program.diagnostic).toBeGreaterThan(0);
    for (const entry of [counts.success.direct, counts.success.program, counts.source_failure.direct, counts.source_failure.program]) {
      expect(entry.requests).toBeGreaterThan(0);
      expect(entry.responses).toBeGreaterThan(0);
      expect(entry.total).toBe(entry.requests + entry.responses);
      expect(Number.isSafeInteger(entry.total)).toBe(true);
    }
  }
  expect(report.tokenization.evidence).toMatchObject({ package: 'js-tiktoken', version: '1.0.21', roundTripValidated: true });
  // The run writes only into its own temporary directory; the tracked
  // historical receipt and its recorded digest are left exactly as they were.
  const trackedBefore = await readFile(AGGREGATION_ARTIFACT_PATH);
  const directory = await mkdtemp(join(tmpdir(), 'm12-benchmark-'));
  try {
    const artifact = await writeAggregationArtifact(report, join(directory, 'aggregation-benchmark.json'));
    expect(artifact.startsWith(directory)).toBe(true);
    expect(JSON.parse(await readFile(artifact, 'utf8'))).toEqual(report);
  } finally { await rm(directory, { recursive: true, force: true }); }
  const trackedAfter = await readFile(AGGREGATION_ARTIFACT_PATH);
  expect(trackedAfter.equals(trackedBefore)).toBe(true);
  const integrity = JSON.parse(await readFile(new URL('../docs/implementation/v3/m12-artifacts/artifact-integrity.json', import.meta.url), 'utf8')) as { artifacts: { path: string; sha256: string }[] };
  expect(integrity.artifacts.find(entry => entry.path === 'docs/implementation/v3/m12-artifacts/aggregation-benchmark.json')?.sha256).toBe(sha256(trackedAfter));
}, 60000);
