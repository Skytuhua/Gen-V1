import { describe, expect, it } from 'vitest';
import type { BenchmarkMeasurement, BenchmarkRecord, BenchmarkRun } from '../packages/contracts/implementation-evidence.ts';
import { benchmarkReportHtml } from '../scripts/research-baseline.ts';

const unavailable: BenchmarkMeasurement = {
  elapsedMs: null, coldStartMs: null, firstPublicResponseMs: null, requests: null,
  inputBytes: null, outputBytes: null, cacheInputBytes: null, cacheOutputBytes: null,
  totalCostBytes: null, backgroundCostBytes: null, completionQuality: null,
};
const record = (baseline: BenchmarkRun | null, candidate: BenchmarkRun | null): BenchmarkRecord => ({
  fixture: 'unexecuted paired fixture', model: null, account: null,
  config: 'No provider configured', seed: 42, baseline, candidate,
  notes: ['Report rendering fixture only; no model workload executed.'],
});
const rows = (html: string): string[][] => [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)]
  .map(match => [...match[1]!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(cell => cell[1]!))
  .filter(cells => cells.length > 0);

function expectUnavailable(row: string[] | undefined, role: 'baseline' | 'candidate') {
  expect(row).toBeDefined();
  expect(row!.slice(0, 6)).toEqual([
    'unexecuted paired fixture', 'No provider configured', 'unavailable', role, 'UNAVAILABLE', '42',
  ]);
  expect(row!.slice(6, 17)).toEqual(Array(11).fill('unavailable'));
  expect(row![17]).toContain('no model workload executed');
}

describe('M01 unavailable paired benchmark evidence', () => {
  it('keeps both unavailable arms and the named fixture visible', () => {
    const result = rows(benchmarkReportHtml([record(null, null)]));
    expect(result).toHaveLength(2);
    expectUnavailable(result[0], 'baseline');
    expectUnavailable(result[1], 'candidate');
  });

  it('keeps an unavailable candidate beside an observed baseline', () => {
    const baseline: BenchmarkRun = { role: 'baseline', status: 'PASS', measurement: { ...unavailable, inputBytes: 123 } };
    const result = rows(benchmarkReportHtml([record(baseline, null)]));
    expect(result).toHaveLength(2);
    expect(result[0]![3]).toBe('baseline');
    expect(result[0]![4]).toBe('PASS');
    expect(result[0]![10]).toBe('123 B');
    expectUnavailable(result[1], 'candidate');
  });

  it('keeps an unavailable baseline beside an observed failed candidate', () => {
    const candidate: BenchmarkRun = { role: 'candidate', status: 'FAIL', measurement: unavailable };
    const result = rows(benchmarkReportHtml([record(null, candidate)]));
    expect(result).toHaveLength(2);
    expectUnavailable(result[0], 'baseline');
    expect(result[1]![3]).toBe('candidate');
    expect(result[1]![4]).toBe('FAIL');
  });

  it('preserves distinct present outcomes and unavailable counters', () => {
    const baseline: BenchmarkRun = { role: 'baseline', status: 'SETUP_FAILED', measurement: unavailable };
    const candidate: BenchmarkRun = { role: 'candidate', status: 'EXPECTED_NEGATIVE', measurement: unavailable };
    const result = rows(benchmarkReportHtml([record(baseline, candidate)]));
    expect(result.map(row => row[4])).toEqual(['SETUP_FAILED', 'EXPECTED_NEGATIVE']);
    for (const row of result) expect(row.slice(6, 17)).toEqual(Array(11).fill('unavailable'));
  });
});
