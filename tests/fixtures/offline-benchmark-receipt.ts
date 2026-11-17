import { expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { benchmarkRecordSchema, type BenchmarkMeasurement, type BenchmarkRecord, type BenchmarkRun } from '../../packages/contracts/implementation-evidence.ts';
import { benchmarkReportHtml } from '../../scripts/research-baseline.ts';

const unknown: BenchmarkMeasurement = {
  elapsedMs: null, coldStartMs: null, firstPublicResponseMs: null, requests: null,
  inputBytes: null, outputBytes: null, cacheInputBytes: null, cacheOutputBytes: null,
  totalCostBytes: null, backgroundCostBytes: null, completionQuality: null,
};
export async function measure<T>(action: () => Promise<T>) {
  const started = performance.now(), value = await action();
  return { value, elapsedMs: performance.now() - started };
}
export function measuredArm(role: BenchmarkRun['role'], elapsedMs: number, inputBytes: number | null, outputBytes: number): BenchmarkRun {
  return { role, status: 'PASS', measurement: { ...unknown, elapsedMs, inputBytes, outputBytes } };
}
export function recordOfflineBenchmark(directory: string, record: BenchmarkRecord, observations: Record<string, unknown>): void {
  benchmarkRecordSchema.parse(record);
  expect(record.model).toBeNull(); expect(record.account).toBeNull();
  for (const run of [record.baseline!, record.candidate!]) {
    expect(run.measurement.elapsedMs).toBeGreaterThanOrEqual(0);
    for (const key of ['coldStartMs', 'firstPublicResponseMs', 'requests', 'cacheInputBytes', 'cacheOutputBytes', 'totalCostBytes', 'backgroundCostBytes', 'completionQuality'] as const)
      expect(run.measurement[key]).toBeNull();
  }
  const receipt = {
    scope: 'OFFLINE_CORE_ONLY', workflowSha: process.env.GITHUB_SHA ?? null,
    runtime: { node: process.version, platform: process.platform, architecture: process.arch },
    sampleCountPerArm: 1, record, observations,
    limitations: [
      'Current code and owned deterministic inputs, with no provider or model request.',
      'Each arm is one measured local sequence. This is not an end-to-end product or statistical performance certification.',
      'PASS means the stated fixture invariants were observed. Actual underlying operation outcomes are recorded separately.',
    ],
  };
  const json = JSON.stringify(receipt);
  writeFileSync(join(directory, 'benchmark.json'), json, { flag: 'wx' });
  writeFileSync(join(directory, 'benchmark.html'), benchmarkReportHtml([record]), { flag: 'wx' });
  expect(JSON.parse(readFileSync(join(directory, 'benchmark.json'), 'utf8'))).toEqual(receipt);
  expect(readFileSync(join(directory, 'benchmark.html'), 'utf8')).toContain(record.fixture);
  // The CI log preserves the receipt after the test removes its owned files.
  console.info('M01_OFFLINE_BENCHMARK ' + json);
}
