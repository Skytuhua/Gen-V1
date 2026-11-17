import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Store } from '../packages/storage/store.ts';
import type { Operation, Thread } from '../packages/contracts/index.ts';
import { createContextCompiler, type ImmutableContextCut } from '../packages/core/context-compiler.ts';
import { createContextToolDiscovery, createProgressiveToolSession } from '../packages/core/context-tool-discovery.ts';
import { inspectTask } from '../packages/core/task-inspection.ts';
import {
  benchmarkRecordSchema, type BenchmarkMeasurement, type BenchmarkRecord, type BenchmarkRun,
} from '../packages/contracts/implementation-evidence.ts';
import { benchmarkReportHtml } from '../scripts/research-baseline.ts';

const directories: string[] = [];
const temporary = () => {
  const directory = mkdtempSync(join(tmpdir(), 'm01-offline-workload-'));
  directories.push(directory);
  return directory;
};
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const unmeasured: BenchmarkMeasurement = {
  elapsedMs: null, coldStartMs: null, firstPublicResponseMs: null, requests: null,
  inputBytes: null, outputBytes: null, cacheInputBytes: null, cacheOutputBytes: null,
  totalCostBytes: null, backgroundCostBytes: null, completionQuality: null,
};
function timed<T>(execute: () => T) {
  const started = performance.now(), value = execute();
  return { value, elapsedMs: performance.now() - started };
}
const arm = (role: BenchmarkRun['role'], elapsedMs: number, inputBytes: number | null, outputBytes: number): BenchmarkRun => ({
  role, status: 'PASS', measurement: { ...unmeasured, elapsedMs, inputBytes, outputBytes },
});
function emit(record: BenchmarkRecord, observations: Record<string, unknown>) {
  expect(benchmarkRecordSchema.safeParse(record).success).toBe(true);
  for (const run of [record.baseline!, record.candidate!]) {
    expect(run.measurement.elapsedMs).toBeGreaterThanOrEqual(0);
    for (const field of ['requests', 'coldStartMs', 'firstPublicResponseMs', 'cacheInputBytes', 'cacheOutputBytes', 'totalCostBytes', 'backgroundCostBytes', 'completionQuality'] as const)
      expect(run.measurement[field]).toBeNull();
  }
  const receipt = {
    scope: 'OFFLINE_CORE_ONLY', remainingBenchmarkScenarios: ['oversized-output', 'memory-conflict', 'cancellation', 'concurrent-edits'], workflowSha: process.env.GITHUB_SHA ?? null,
    runtime: { node: process.version, platform: process.platform, architecture: process.arch },
    record, observations,
  };
  const json = JSON.stringify(receipt), directory = temporary();
  writeFileSync(join(directory, 'benchmark.json'), json, { flag: 'wx' });
  writeFileSync(join(directory, 'benchmark.html'), benchmarkReportHtml([record]), { flag: 'wx' });
  expect(JSON.parse(readFileSync(join(directory, 'benchmark.json'), 'utf8'))).toEqual(receipt);
  expect(readFileSync(join(directory, 'benchmark.html'), 'utf8')).toContain(record.fixture);
  // CI retains this measured receipt in the job log. Temporary report files are
  // owned by this test; no historical evidence or production output is replaced.
  console.info('M01_OFFLINE_BENCHMARK ' + json);
}
const limitations = [
  'Current core code with synthetic local inputs; no provider or native model request was executed.',
  'Elapsed time measures one local core call sequence; no latency improvement or product performance claim.',
];

it('measures real SQLite source reads for a 1,024-source growing context', () => {
  const threadId = 'long-session', store = new Store(temporary()), seed = 42;
  const text = (index: number) => 'seed-' + seed + '-message-' + index + ':' + 'é漢字'.repeat(64);
  const sources = Array.from({ length: 1024 }, (_, index) => ({
    sequence: index, id: 'message-' + index, revision: 1, category: 'USER' as const,
  }));
  try {
    store.internal('fixture', threadId, () => {
      for (const source of sources) store.put('data', source.id, threadId, { text: text(source.sequence), revision: source.revision });
    });
    const cuts: ImmutableContextCut[] = Array.from({ length: 16 }, (_, index) => ({
      owner: { threadId, workspaceId: 'fixture-workspace' },
      modelBinding: { modelId: 'no-provider-fixture', accountId: 'no-account-fixture' },
      contextGeneration: 1, instructionDigest: 'fixture-instructions', toolRegistryDigest: 'fixture-tools',
      sources: sources.slice(0, (index + 1) * 64),
    }));
    const run = (incremental: boolean) => {
      let reads = 0, inputBytes = 0;
      const create = () => createContextCompiler({ readSource(source) {
        const row = store.get<{ text: string; revision: number }>('data', source.id);
        if (!row || row.revision !== source.revision) throw new Error('Fixture source revision is unavailable');
        reads++; inputBytes += Buffer.byteLength(row.text);
        return row.text;
      } });
      const compiler = incremental ? create() : undefined;
      const result = timed(() => cuts.map(cut => (compiler ?? create()).compile(cut)));
      return { ...result, reads, inputBytes, outputBytes: bytes(result.value) };
    };
    const baseline = run(false), candidate = run(true);
    expect(candidate.value).toEqual(baseline.value);
    expect(baseline.reads).toBe(8704);
    expect(candidate.reads).toBe(1024);
    expect(candidate.inputBytes).toBe(sources.reduce((total, source) => total + Buffer.byteLength(text(source.sequence)), 0));
    expect(candidate.inputBytes).toBeLessThan(baseline.inputBytes);
    expect(candidate.value.at(-1)!.segments).toHaveLength(1024);
    expect(candidate.value.every(receipt => receipt.budget.tokens === null)).toBe(true);
    emit({
      fixture: 'long-session', model: null, account: null, seed,
      config: '16 growing cuts of 64 sources: fresh compiler per cut versus incremental compiler reuse',
      baseline: arm('baseline', baseline.elapsedMs, baseline.inputBytes, baseline.outputBytes),
      candidate: arm('candidate', candidate.elapsedMs, candidate.inputBytes, candidate.outputBytes),
      notes: [...limitations, 'Input bytes are actual SQLite source text reads, including repeated reads; output bytes are serialized metadata receipts. Fixture writes and output serialization are outside the timer.'],
    }, { sourceCount: sources.length, cuts: cuts.length, baselineSourceReads: baseline.reads, candidateSourceReads: candidate.reads, identicalReceipts: true });
  } finally { store.close(); }
});

it.each([100, 500])('measures independent eager and progressive %i-tool schema projections', count => {
  const seed = 42, selected = 'tool-' + String(seed).padStart(4, '0'), denied = 'tool-' + String(count - 1).padStart(4, '0');
  const entries = Array.from({ length: count }, (_, index) => ({
    name: 'tool-' + String(index).padStart(4, '0'), description: 'Local fixture ' + index,
    schema: { type: 'object', properties: { query: { type: 'string', description: 'q'.repeat(64) } } },
  }));
  const eager = entries.map(entry => ({ ...entry, exposure: 'DIRECT' as const }));
  const progressive = entries.map((entry, index) => ({ ...entry, exposure: index === 0 ? 'DIRECT' as const : 'DEFERRED' as const }));
  const admitted = (name: string) => name !== denied;
  const baseline = timed(() => {
    const projection = createContextToolDiscovery(eager, admitted);
    return [projection.freezeRequest([]), projection.freezeRequest([])];
  });
  const candidate = timed(() => {
    const session = createProgressiveToolSession(progressive, admitted), first = session.capture();
    const described = session.describe(selected), beforeCapture = session.canInvoke(selected);
    const second = session.capture();
    return { snapshots: [first, second], described, beforeCapture, afterCapture: session.canInvoke(selected), denied: session.describe(denied) };
  });
  expect(baseline.value.map(snapshot => snapshot.tools.length)).toEqual([count - 1, count - 1]);
  expect(candidate.value.snapshots.map(snapshot => snapshot.tools.length)).toEqual([1, 2]);
  expect(candidate.value.beforeCapture).toBe(false);
  expect(candidate.value.afterCapture).toBe(true);
  expect(candidate.value.denied).toBeNull();
  expect(candidate.value.described).toEqual(baseline.value[0]!.tools.find(tool => tool.name === selected));
  for (const snapshot of [...baseline.value, ...candidate.value.snapshots]) {
    expect(snapshot.schemaBytes).toBe(bytes(snapshot.tools));
    expect(snapshot.tools.some(tool => tool.name === denied)).toBe(false);
  }
  const baselineBytes = baseline.value.reduce((total, snapshot) => total + snapshot.schemaBytes, 0);
  const candidateBytes = candidate.value.snapshots.reduce((total, snapshot) => total + snapshot.schemaBytes, 0);
  expect(candidateBytes).toBeLessThan(baselineBytes);
  emit({
    fixture: 'tool-catalog-' + count, model: null, account: null, seed,
    config: 'Same admitted schemas, two request projections: all direct versus one direct plus one described deferred tool',
    baseline: arm('baseline', baseline.elapsedMs, bytes(eager), baselineBytes),
    candidate: arm('candidate', candidate.elapsedMs, bytes(progressive), candidateBytes),
    notes: [...limitations, 'Input bytes serialize registered catalog entries; output bytes sum the two actual frozen tool-schema arrays. Discovery permissions are identical; no invocation occurred.'],
  }, { registeredTools: count, baselineVisibleTools: baseline.value.map(snapshot => snapshot.tools.length), candidateVisibleTools: candidate.value.snapshots.map(snapshot => snapshot.tools.length) });
});

it('measures bounded inspection of 2,000 actual SQLite operation records', () => {
  const store = new Store(temporary()), threadId = 'large-history', seed = 42, payload = 'x'.repeat(8192);
  const createdAt = '2026-11-17T00:00:00.000Z';
  const thread: Thread = {
    id: threadId, title: 'Offline retained history', projectName: null, createdAt, updatedAt: createdAt,
    status: 'completed', epoch: 1, runId: null, modelId: null, sessionPath: null,
  };
  const operation = (id: string, owner: string, index: number, result: string): Operation => ({
    id, threadId: owner, revision: 1, kind: 'fixture_read', description: 'Seed ' + seed + ' operation ' + index,
    args: { fixtureIndex: index }, resourceIds: [], preconditions: {}, status: 'succeeded', approved: true, result, createdAt,
  });
  try {
    store.internal('fixture', threadId, () => {
      store.put('thread', thread.id, thread.id, thread);
      store.put('thread', 'other-thread', 'other-thread', { ...thread, id: 'other-thread', title: 'Other retained history' } satisfies Thread);
      for (let index = 0; index < 2000; index++) {
        const record = operation('operation-' + index, threadId, index, payload);
        store.put('operation', record.id, record.threadId, record);
      }
      const foreign = operation('foreign-operation', 'other-thread', 0, 'FOREIGN_SENTINEL');
      store.put('operation', foreign.id, foreign.threadId, foreign);
    });
    const baseline = timed(() => store.all('operation', threadId));
    const candidate = timed(() => inspectTask(store, thread, undefined, {}));
    const baselineBytes = bytes(baseline.value), candidateBytes = bytes(candidate.value);
    expect(baseline.value).toHaveLength(2000);
    expect(candidate.value).toMatchObject({ counts: { operations: 2000 }, truncated: true });
    expect(candidateBytes).toBeLessThanOrEqual(8192);
    expect(candidateBytes).toBeLessThan(baselineBytes);
    expect(JSON.stringify(candidate.value)).not.toContain(payload);
    expect(JSON.stringify(candidate.value)).not.toContain('FOREIGN_SENTINEL');
    expect(store.get<{ result: string }>('operation', 'operation-1999')!.result).toBe(payload);
    emit({
      fixture: 'large-ui-history', model: null, account: null, seed,
      config: 'Same retained operations: full same-thread Store read versus bounded task-inspection metadata projection',
      baseline: arm('baseline', baseline.elapsedMs, null, baselineBytes),
      candidate: arm('candidate', candidate.elapsedMs, null, candidateBytes),
      notes: [...limitations, 'Read-model response bytes only; this does not measure browser rendering or history virtualization. SQLite page input bytes are unmeasured; retained full results are checked after inspection.'],
    }, { retainedOperations: 2000, resultBytesPerOperation: Buffer.byteLength(payload), fullResultsPreserved: true });
  } finally { store.close(); }
});
