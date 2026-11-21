import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { HarnessError, type ResourceGrant, type Thread } from '../../packages/contracts/index.ts';
import type { ProgramExecutor } from '../../packages/contracts/tool-program.ts';
import type { ToolProgramResult } from '../../packages/core/tool-programs.ts';
import { toolDefinitionDigest } from '../../packages/core/tool-disclosure.ts';
import { buildToolRegistry } from '../../packages/core/tool-authority.ts';
import { resolveGrant } from '../../packages/core/security.ts';
import { createJavaScriptExecutor } from '../../packages/runtime/tool-program-worker.ts';
import { openReplayHarness, REPLAY_OWNER } from './tool-program-replay-harness-v3.ts';

export interface AggregationAnswer {
  paidOrders: number;
  refundedOrders: number;
  soldUnits: number;
  salesCents: number;
  salesCentsByRegion: Record<string, number>;
}
export interface WorkflowMeasurement {
  state: 'SUCCEEDED' | 'FAILED';
  answer: AggregationAnswer | null;
  modelRequests: { setup: number; execution: number; diagnostic: number; total: number };
  modelRoundTrips: number;
  hostReadCalls: number;
  sequentialReadDependencies: number;
  elapsedMs: number;
  modelVisibleBytes: { requests: number; responses: number; total: number; diagnostic: number };
  sourceRowsVisible: boolean;
  bulkInPublicStorage: boolean;
  retainedSourceFailures: number;
  originalFailureInspected: boolean;
  trace: Record<string, unknown>[];
}
export type BenchmarkEncoding = 'cl100k_base' | 'o200k_base';
export interface TokenMeasurement { requests: number; responses: number; total: number; diagnostic: number }
export type BenchmarkTokenCounts = Record<BenchmarkEncoding, Record<'success' | 'source_failure', { direct: TokenMeasurement; program: TokenMeasurement }>>;
export interface AggregationBenchmark {
  schemaVersion: 1;
  kind: 'FIXED_SYNTHETIC_WORKFLOW_MEASUREMENT';
  liveModelEvaluation: false;
  expectedAnswer: AggregationAnswer;
  cases: { name: 'success' | 'source_failure'; direct: WorkflowMeasurement; program: WorkflowMeasurement }[];
  tokenization: { actualCounts: BenchmarkTokenCounts | null; status: string; gate: string; evidence: Record<string, unknown> };
  provenance: Record<string, unknown>;
  methodology: Record<string, unknown>;
}

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RESOURCE = 'benchmark-orders';
const SOURCE_MARKER = 'SYNTHETIC_PRIVATE_ORDER_ROW';
const FAILURE_MESSAGE = 'SYNTHETIC_PRIVATE_SOURCE_FAILURE: third document unavailable';
const REQUESTED_AGGREGATE = 'Count paid and refunded orders; sum paid units and integer USD cents, including paid cents by region. Return no individual orders.';
const EXPECTED: AggregationAnswer = {
  paidOrders: 307, refundedOrders: 77, soldUnits: 1225, salesCents: 274750,
  salesCentsByRegion: { north: 67000, south: 69975, east: 69025, west: 68750 },
};
const REGIONS = ['north', 'south', 'east', 'west'] as const;
type Region = typeof REGIONS[number];
interface Order { id: string; region: Region; status: 'paid' | 'refunded'; units: number; unitCents: number; note: string }
const PATHS = Array.from({ length: 6 }, (_, part) => `page-${createHash('sha256').update(`host-only-fixed-cursor-m12:${part}`).digest('hex').slice(0, 32)}.json`);
interface Part { part: number; rows: Order[]; nextPath: string | null }
const DATA: Part[] = Array.from({ length: 6 }, (_, part) => ({
  part, nextPath: PATHS[part + 1] ?? null,
  rows: Array.from({ length: 64 }, (_, row) => {
    const index = part * 64 + row;
    return { id: `order-${index.toString().padStart(4, '0')}`, region: REGIONS[index % 4]!,
      status: index % 5 === 0 ? 'refunded' : 'paid', units: index % 7 + 1,
      unitCents: 100 + (index % 11) * 25, note: `${SOURCE_MARKER} café ${'x'.repeat(240)}` };
  }),
}));
const SOURCE = `const answer = {paidOrders:0,refundedOrders:0,soldUnits:0,salesCents:0,salesCentsByRegion:{north:0,south:0,east:0,west:0}};
let path = '${PATHS[0]}';
while (path !== null) {
  const data = await tools.call('repository_read', {resourceId:'${RESOURCE}',path});
  for (const order of data.rows) {
    if (order.status === 'refunded') { answer.refundedOrders++; continue; }
    answer.paidOrders++;
    answer.soldUnits += order.units;
    const cents = order.units * order.unitCents;
    answer.salesCents += cents;
    answer.salesCentsByRegion[order.region] += cents;
  }
  path = data.nextPath;
}
return answer;`;
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const encoded = (value: unknown) => JSON.stringify(value);
const SOURCE_FILES = [
  'tests/tool-program-benchmark-v3.test.ts', 'tests/fixtures/tool-program-benchmark-v3.ts',
  'tests/fixtures/tool-program-replay-harness-v3.ts', 'packages/core/tool-programs.ts',
  'packages/core/tool-effects.ts', 'packages/core/tool-disclosure.ts', 'packages/core/tool-results.ts',
  'packages/core/tool-authority.ts', 'packages/core/security.ts', 'packages/storage/store.ts',
  'packages/contracts/tool-program.ts', 'packages/contracts/tool-results.ts', 'packages/contracts/tool-effects.ts',
  'packages/runtime/tool-program-worker.ts', 'packages/runtime/tool-program-worker-child.mjs',
  'package.json', 'pnpm-lock.yaml', 'docs/implementation/v3/m12-artifacts/tokenizer-dependency-review.json',
];
const sourceCut = () => Object.fromEntries(SOURCE_FILES.map(path => [path, sha256(readFileSync(join(ROOT, path)))]));
const milliseconds = (start: number) => Math.round((performance.now() - start) * 1000) / 1000;
type Phase = 'setup' | 'execution' | 'diagnostic';
interface Exchange {
  phase: Phase; tool: string; requestJson: string; responseJson: string; elapsedMs: number; failed: boolean;
}

/** Provider-neutral model/host boundary. This is a fixed controller, never an LLM.
 * Bytes include exact JSON requests (including program source) and complete responses.
 * A round trip is one observed request/response pair, including discovery and inspection. */
class Transcript {
  readonly exchanges: Exchange[] = [];
  async exchange<T>(phase: Phase, name: string, args: Record<string, unknown>, execute: () => Promise<T> | T): Promise<T> {
    const requestJson = encoded({ name, args }), started = performance.now();
    try {
      const value = await execute();
      this.exchanges.push({ phase, tool: name, requestJson, responseJson: encoded(value), elapsedMs: milliseconds(started), failed: false });
      return value;
    } catch (error) {
      const response = { error: { code: error instanceof HarnessError ? error.code : 'SOURCE_FAILED', message: error instanceof Error ? error.message : String(error) } };
      this.exchanges.push({ phase, tool: name, requestJson, responseJson: encoded(response), elapsedMs: milliseconds(started), failed: true });
      throw error;
    }
  }
  measurement(): Pick<WorkflowMeasurement, 'modelRequests' | 'modelRoundTrips' | 'modelVisibleBytes' | 'sourceRowsVisible' | 'trace'> {
    const bytes = (exchange: Exchange) => Buffer.byteLength(exchange.requestJson, 'utf8') + Buffer.byteLength(exchange.responseJson, 'utf8');
    const requests = this.exchanges.reduce((sum, exchange) => sum + Buffer.byteLength(exchange.requestJson, 'utf8'), 0);
    const responses = this.exchanges.reduce((sum, exchange) => sum + Buffer.byteLength(exchange.responseJson, 'utf8'), 0);
    const count = (phase: Phase) => this.exchanges.filter(exchange => exchange.phase === phase).length;
    return {
      modelRequests: { setup: count('setup'), execution: count('execution'), diagnostic: count('diagnostic'), total: this.exchanges.length },
      modelRoundTrips: this.exchanges.length,
      modelVisibleBytes: { requests, responses, total: requests + responses, diagnostic: this.exchanges.filter(exchange => exchange.phase === 'diagnostic').reduce((sum, exchange) => sum + bytes(exchange), 0) },
      sourceRowsVisible: this.exchanges.some(exchange => exchange.responseJson.includes(SOURCE_MARKER)),
      trace: this.exchanges.map(exchange => ({ phase: exchange.phase, tool: exchange.tool, failed: exchange.failed,
        requestBytes: Buffer.byteLength(exchange.requestJson, 'utf8'), responseBytes: Buffer.byteLength(exchange.responseJson, 'utf8'),
        requestSha256: sha256(exchange.requestJson), responseSha256: sha256(exchange.responseJson), elapsedMs: exchange.elapsedMs })),
    };
  }
}

/** Same generated source files and host-classified read are used on both paths.
 * The fixture parses synthetic JSON instead of using the production repository executor.
 * Real resource witnesses, exact owners, disclosure, M02 and private result storage apply. */
async function fixture(executor: ProgramExecutor, failPart: number | null) {
  const directory = await mkdtemp(join(tmpdir(), 'm12-aggregation-'));
  const sources = join(directory, 'sources'); await mkdir(sources);
  await Promise.all(DATA.map(part => writeFile(join(sources, PATHS[part.part]!), encoded(part))));
  const identity = await stat(sources, { bigint: true });
  const grant: ResourceGrant = { id: RESOURCE, threadId: REPLAY_OWNER.threadId, kind: 'project', path: sources,
    label: 'Synthetic benchmark orders', writable: false, createdAt: '2026-11-15T00:00:00.000Z',
    identity: { dev: String(identity.dev), ino: String(identity.ino) } };
  let expectedPath: string | null = PATHS[0]!, predecessor: string | null = null;
  const dependencies: { predecessor: string; disclosedPath: string }[] = [];
  const harness = openReplayHarness(join(directory, 'state'), {
    owner: REPLAY_OWNER, executor,
    executeRead: async (call, owner, signal) => {
      if (signal.aborted) throw signal.reason;
      if (call.name !== 'repository_read' || call.args.resourceId !== RESOURCE || typeof call.args.path !== 'string' || owner.threadId !== REPLAY_OWNER.threadId)
        throw new Error('Unexpected benchmark tool or input');
      if (call.args.path !== expectedPath) throw new HarnessError('BENCHMARK_CURSOR_NOT_DISCLOSED', 'Read the predecessor to obtain the next source cursor');
      if (predecessor !== null) dependencies.push({ predecessor, disclosedPath: call.args.path });
      const part = PATHS.indexOf(call.args.path);
      const path = await resolveGrant(grant, call.args.path, false, harness.store.dataDir);
      if (part === failPart) throw new HarnessError('BENCHMARK_SOURCE_UNAVAILABLE', FAILURE_MESSAGE);
      const data = JSON.parse(await readFile(path, 'utf8')) as Part;
      predecessor = call.args.path; expectedPath = data.nextPath;
      return data;
    },
  });
  const thread: Thread = { id: REPLAY_OWNER.threadId, runId: REPLAY_OWNER.runId, epoch: REPLAY_OWNER.epoch,
    projectId: REPLAY_OWNER.projectId!, workspaceId: REPLAY_OWNER.workspaceId!, accountId: REPLAY_OWNER.accountBinding,
    title: 'Synthetic aggregation', projectName: null, status: 'working', modelId: null, sessionPath: null, createdAt: '', updatedAt: '' };
  harness.store.internal('m12.benchmark.grant', REPLAY_OWNER.threadId, () => {
    harness.store.put('thread', thread.id, thread.id, thread);
    harness.store.put('resource', grant.id, thread.id, grant);
    return { resourceId: grant.id };
  });
  return { ...harness, thread,
    sequentialReadDependencies: () => dependencies.length,
    close: async () => { await harness.close(); await rm(directory, { recursive: true, force: true }); },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function bulkInPublicStorage(harness: Fixture): boolean {
  const projected = encoded([harness.store.snapshot(), harness.store.eventsAfter(0), harness.store.all('toolEffect')]);
  return projected.includes(SOURCE_MARKER) || projected.includes(FAILURE_MESSAGE);
}
function directAnswer(parts: Part[]): AggregationAnswer {
  const orders = parts.flatMap(part => part.rows), paid = orders.filter(order => order.status === 'paid');
  return { paidOrders: paid.length, refundedOrders: orders.length - paid.length,
    soldUnits: paid.reduce((sum, order) => sum + order.units, 0),
    salesCents: paid.reduce((sum, order) => sum + order.units * order.unitCents, 0),
    salesCentsByRegion: Object.fromEntries(REGIONS.map(region => [region, paid.filter(order => order.region === region).reduce((sum, order) => sum + order.units * order.unitCents, 0)])),
  };
}

interface CapturedWorkflow { measurement: WorkflowMeasurement; transcript: Transcript }
async function directWorkflow(executor: ProgramExecutor, failPart: number | null): Promise<CapturedWorkflow> {
  const harness = await fixture(executor, failPart), transcript = new Transcript(), started = performance.now();
  let state: WorkflowMeasurement['state'] = 'SUCCEEDED', answer: AggregationAnswer | null = null;
  try {
    try {
      const parts: Part[] = [];
      let path: string | null = PATHS[0]!;
      while (path !== null) {
        const args: { resourceId: string; path: string } = { resourceId: RESOURCE, path };
        const data: Part = await transcript.exchange('execution', 'repository_read', args, async (): Promise<Part> => {
          harness.disclosure.require(REPLAY_OWNER, 'repository_read');
          const grants = await harness.results.captureGrants(REPLAY_OWNER, [args]);
          return await harness.effects.invoke({ call: { name: 'repository_read', args: { ...args, invocationId: `benchmark-direct:${parts.length}` } },
            ctx: { threadId: REPLAY_OWNER.threadId, runId: REPLAY_OWNER.runId, epoch: REPLAY_OWNER.epoch }, thread: harness.thread, role: 'run' }, async () => {
            try { return await harness.host.executeRead({ name: 'repository_read', args }, REPLAY_OWNER, new AbortController().signal); }
            finally { await harness.results.revalidateGrants(REPLAY_OWNER, grants); }
          }) as Part;
        });
        parts.push(data); path = data.nextPath;
      }
      answer = directAnswer(parts);
    } catch (error) {
      if (!(error instanceof HarnessError) || error.code !== 'BENCHMARK_SOURCE_UNAVAILABLE') throw error;
      state = 'FAILED';
    }
    return { transcript, measurement: { state, answer, ...transcript.measurement(), hostReadCalls: harness.state().reads,
      sequentialReadDependencies: harness.sequentialReadDependencies(),
      elapsedMs: milliseconds(started), bulkInPublicStorage: bulkInPublicStorage(harness),
      retainedSourceFailures: 0, originalFailureInspected: false } };
  } finally { await harness.close(); }
}

async function programWorkflow(executor: ProgramExecutor, failPart: number | null): Promise<CapturedWorkflow> {
  const harness = await fixture(executor, failPart), transcript = new Transcript(), started = performance.now();
  try {
    // Count the full cold disclosure response even though the test harness already
    // knows the eligible read. No discovery/index request is needed for the fixed name.
    await transcript.exchange('setup', 'tool_program_discover', { names: ['repository_read'] }, () => ({ tools: harness.disclosure.disclose(REPLAY_OWNER, ['repository_read']) }));
    const args = { commandId: `aggregation-${failPart === null ? 'success' : 'source-failure'}`, source: SOURCE,
      allowedTools: ['repository_read'], requestedAggregate: REQUESTED_AGGREGATE };
    const result: ToolProgramResult = await transcript.exchange('execution', 'tool_program', args, async () => {
      const prepared = await harness.programs.prepare({ owner: REPLAY_OWNER, language: 'JAVASCRIPT', source: args.source,
        allowedTools: args.allowedTools, requestedAggregate: args.requestedAggregate }, executor);
      return await harness.programs.run(prepared.programId, REPLAY_OWNER, executor);
    });
    const failedSources = harness.programs.calls(result.programId, REPLAY_OWNER).filter(call => call.state === 'FAILED');
    let originalFailureInspected = false;
    if (failedSources.length) {
      const ref = failedSources[0]!.resultRef;
      if (!ref) throw new Error('The failed source did not retain a private handle');
      const query = { programId: result.programId, resultRef: ref, offset: 0, limit: 16384 };
      const page = await transcript.exchange('diagnostic', 'tool_program_result', query,
        () => harness.results.range(REPLAY_OWNER, ref, { programId: result.programId, offset: query.offset, limit: query.limit }));
      originalFailureInspected = page.status === 'FAILED' && JSON.parse(page.text).message === FAILURE_MESSAGE;
    }
    if (result.state !== 'SUCCEEDED' && result.state !== 'FAILED') throw new Error(`Unexpected benchmark terminal state ${result.state}`);
    return { transcript, measurement: { state: result.state, answer: result.aggregate === undefined ? null : result.aggregate as AggregationAnswer,
      ...transcript.measurement(), hostReadCalls: harness.state().reads, elapsedMs: milliseconds(started),
      sequentialReadDependencies: harness.sequentialReadDependencies(),
      bulkInPublicStorage: bulkInPublicStorage(harness), retainedSourceFailures: failedSources.length, originalFailureInspected } };
  } finally { await harness.close(); }
}

type CapturedCase = { name: 'success' | 'source_failure'; direct: CapturedWorkflow; program: CapturedWorkflow };
const TOKENIZER_VERSION = '1.0.21';
const TOKENIZER_INTEGRITY = 'sha512-biOj/6M5qdgx5TKjDnFT1ymSpM5tbd3ylwDtrQvFQSu0Z7bBYko2dF+W/aUkXUPuk6IVpRxk/3Q2sHOzGlS36g==';

async function measureTokens(cases: CapturedCase[]): Promise<AggregationBenchmark['tokenization']> {
  const reviewPath = 'docs/implementation/v3/m12-artifacts/tokenizer-dependency-review.json';
  const review = JSON.parse(readFileSync(join(ROOT, reviewPath), 'utf8')) as { dependency: string; version: string; registryIntegrity: string; reviewedFiles: Record<string, string> };
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const lock = readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8');
  if (review.dependency !== 'js-tiktoken' || review.version !== TOKENIZER_VERSION || review.registryIntegrity !== TOKENIZER_INTEGRITY ||
    manifest.devDependencies?.['js-tiktoken'] !== TOKENIZER_VERSION || !lock.includes('js-tiktoken@' + TOKENIZER_VERSION) || !lock.includes(TOKENIZER_INTEGRITY))
    throw new Error('The reviewed development-only tokenizer pin or lock integrity changed');
  const liteUrl = import.meta.resolve('js-tiktoken/lite'), packageRoot = dirname(dirname(fileURLToPath(liteUrl)));
  const installedManifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  if (installedManifest.name !== review.dependency || installedManifest.version !== TOKENIZER_VERSION) throw new Error('The installed tokenizer is not the reviewed pin');
  const implementationFiles = ['package.json', 'dist/chunk-VL2OQCWN.js', 'dist/lite.js', 'dist/ranks/cl100k_base.js', 'dist/ranks/o200k_base.js'];
  const installedHashes = Object.fromEntries(implementationFiles.map(path => [path, sha256(readFileSync(join(packageRoot, path)))]));
  for (const path of implementationFiles) if (installedHashes[path] !== review.reviewedFiles[path]) throw new Error(`The reviewed tokenizer file changed: ${path}`);
  const fromTokenizer = createRequire(liteUrl), base64ManifestPath = fromTokenizer.resolve('base64-js/package.json');
  const base64Manifest = JSON.parse(readFileSync(base64ManifestPath, 'utf8'));
  if (base64Manifest.version !== '1.5.1') throw new Error('The existing pinned base64-js dependency changed');

  // Import only after the selected installed implementation and static vocabularies
  // match the reviewed file hashes. No vocabulary is downloaded at measurement time.
  const { Tiktoken } = await import('js-tiktoken/lite');
  const ranks = { cl100k_base: (await import('js-tiktoken/ranks/cl100k_base')).default,
    o200k_base: (await import('js-tiktoken/ranks/o200k_base')).default };
  const actualCounts = {} as BenchmarkTokenCounts, vocabularies: Record<string, unknown> = {};
  for (const encoding of ['cl100k_base', 'o200k_base'] as const) {
    const vocabulary = ranks[encoding], tokenizer = new Tiktoken(vocabulary);
    const measuredCases = {} as BenchmarkTokenCounts[BenchmarkEncoding];
    for (const entry of cases) {
      const measured = {} as { direct: TokenMeasurement; program: TokenMeasurement };
      for (const workflow of ['direct', 'program'] as const) {
        const captured = entry[workflow];
        const total: TokenMeasurement = { requests: 0, responses: 0, total: 0, diagnostic: 0 };
        for (const [index, exchange] of captured.transcript.exchanges.entries()) {
          const requestTokens = tokenizer.encode(exchange.requestJson, [], []);
          const responseTokens = tokenizer.encode(exchange.responseJson, [], []);
          if (tokenizer.decode(requestTokens) !== exchange.requestJson || tokenizer.decode(responseTokens) !== exchange.responseJson)
            throw new Error(`Tokenizer ${encoding} failed a lossless transcript round trip`);
          total.requests += requestTokens.length; total.responses += responseTokens.length;
          if (exchange.phase === 'diagnostic') total.diagnostic += requestTokens.length + responseTokens.length;
          const trace = captured.measurement.trace[index]!;
          const traceCounts = trace.tokens as Record<string, unknown> | undefined;
          trace.tokens = { ...traceCounts, [encoding]: { request: requestTokens.length, response: responseTokens.length } };
        }
        total.total = total.requests + total.responses;
        measured[workflow] = total;
      }
      measuredCases[entry.name] = measured;
    }
    actualCounts[encoding] = measuredCases;
    vocabularies[encoding] = { rankModuleSha256: installedHashes[`dist/ranks/${encoding}.js`],
      mergeRankDataSha256: sha256(vocabulary.bpe_ranks), patternSha256: sha256(vocabulary.pat_str),
      specialTokensSha256: sha256(encoded(vocabulary.special_tokens)) };
  }
  return { status: 'MEASURED_OFFLINE', actualCounts,
    gate: 'Named offline transcript encodings are measured. These counts do not measure provider framing, billing, context totals, or live model performance.',
    evidence: { package: 'js-tiktoken', version: TOKENIZER_VERSION, entryPoint: 'js-tiktoken/lite',
      registryIntegrity: TOKENIZER_INTEGRITY, dependencyReviewRef: reviewPath, dependencyReviewSha256: sha256(readFileSync(join(ROOT, reviewPath))),
      implementationFilesSha256: installedHashes, vocabularies,
      transitiveDependency: { name: 'base64-js', version: base64Manifest.version, implementationSha256: sha256(readFileSync(fromTokenizer.resolve('base64-js'))) },
      roundTripValidated: true, networkUsed: false,
      countingRule: 'Sum actual encode(text, [], []).length for every observed serialized request and response independently; special-token-like text is literal data.',
      variability: 'Opaque result identities and elapsed fields are serialized as observed, so exact program token counts can vary between executions.',
    } };
}

async function verifyCursorDependency(executor: ProgramExecutor) {
  const harness = await fixture(executor, null);
  try {
    try {
      await harness.host.executeRead({ name: 'repository_read', args: { resourceId: RESOURCE, path: PATHS[1]! } }, REPLAY_OWNER, new AbortController().signal);
      throw new Error('The source handler accepted a cursor before its predecessor disclosed it');
    } catch (error) {
      if (!(error instanceof HarnessError) || error.code !== 'BENCHMARK_CURSOR_NOT_DISCLOSED') throw error;
    }
    return { outOfOrderReadRejected: true, separateProbeReadAttempts: harness.state().reads, initialKnownPaths: 1 };
  } finally { await harness.close(); }
}

/** A single deterministic success case and a third-read failure case. Timing is
 * diagnostic only: local synthetic reads have no real provider or network latency. */
export async function runAggregationBenchmark(): Promise<AggregationBenchmark> {
  const beganAt = new Date().toISOString(), cut = sourceCut();
  const executor = await createJavaScriptExecutor();
  try {
    const dependencyProof = await verifyCursorDependency(executor);
    const captured: CapturedCase[] = [];
    for (const failPart of [null, 2]) captured.push({ name: failPart === null ? 'success' : 'source_failure',
      direct: await directWorkflow(executor, failPart), program: await programWorkflow(executor, failPart) });
    const tokenization = await measureTokens(captured);
    const cases = captured.map(entry => ({ name: entry.name, direct: entry.direct.measurement, program: entry.program.measurement }));
    if (encoded(cut) !== encoded(sourceCut())) throw new Error('Benchmark source files changed during measurement; rerun the fixed cut');
    const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    return {
      schemaVersion: 1, kind: 'FIXED_SYNTHETIC_WORKFLOW_MEASUREMENT', liveModelEvaluation: false,
      expectedAnswer: structuredClone(EXPECTED), cases,
      tokenization,
      provenance: { beganAt, finishedAt: new Date().toISOString(), gitHead, workingTreeSourceSha256: cut,
        node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch,
        packageManager: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).packageManager,
        reproductionCommand: ['corepack', 'pnpm@10.30.3', 'exec', 'vitest', 'run', 'tests/tool-program-benchmark-v3.test.ts'],
        commandEvidenceNote: 'reproductionCommand is a standalone rerun recipe, not the command observed for this measurement. The outer command recorder and benchmark-execution-link.json identify the actual launch, working directory, timestamps and exit.',
        executorProof: executor.proof, datasetSha256: sha256(encoded(DATA)), programSourceSha256: sha256(SOURCE),
        sourceDefinitionDigest: toolDefinitionDigest(openDefinition()),
      },
      methodology: {
        task: REQUESTED_AGGREGATE, dataset: { partitions: 6, ordersPerPartition: 64, totalOrders: 384, currency: 'USD', arithmetic: 'integer cents', rowNoteBytes: Buffer.byteLength(DATA[0]!.rows[0]!.note) },
        answerQuality: 'Exact object equality against a fixed independently calculated arithmetic oracle. No live model judgement or model success rate is measured.',
        controller: 'Fixed direct-tool controller versus one authored JavaScript program using the real checked QuickJS executor and ToolPrograms host.',
        sourceDependency: 'Only the first opaque source path is initial input. Each read returns nextPath, required by the following read; the host refuses an undisclosed next path. Five sequential information dependencies exist on success. Independent known reads could instead be natively batched and are not this benchmark task.',
        dependencyProof,
        requests: 'Observed provider-neutral scripted model/host request-response exchanges. Direct source requests require the preceding response; the program handles those dependencies privately. Cold program discovery and explicit failed-source inspection are included. No network round trip or LLM request is sent.',
        byteAccounting: 'Sum UTF-8 bytes of JSON.stringify({name,args}) requests and complete JSON.stringify(result) responses. Includes program source, discovery schema, returned opaque handles and envelopes. Shared system prompt, preadvertised schema context, final user-facing answer and provider framing are excluded from both workflows.',
        failure: 'The third sequential repository_read fails before aggregation completes. Neither workflow retries, resumes, or returns a partial answer. Program diagnostics add exactly one explicit bounded retained-source read; they do not execute the source tool again.',
        latency: 'One local run per case. Timings include workflow setup and diagnostics, excluding fixture creation, the separate cursor guard probe, executor startup self-test and token counting. They are not a production speedup estimate.',
        persistence: 'Synthetic repository data only. Program source rows and original source failure remain absent from public snapshot, events and effect projections.',
        toolClassification: 'Existing host repository_read definition with READ_RETRYABLE classification; fixture uses actual file grants and M02 dispatch, with a synthetic JSON read handler.',
      },
    };
  } finally { await executor.stop(); }
}

function openDefinition() {
  // Pure registry metadata; no extra Store or benchmark tool call is opened here.
  return buildToolRegistry().find(definition => definition.id === 'repository_read')!;
}

/** The tracked historical receipt; its SHA-256 is recorded in
 * docs/implementation/v3/m12-artifacts/artifact-integrity.json. */
export const AGGREGATION_ARTIFACT_PATH = resolve(ROOT, 'docs/implementation/v3/m12-artifacts/aggregation-benchmark.json');

/** Writes a report. Publishing or refreshing the tracked receipt is explicit:
 * call with AGGREGATION_ARTIFACT_PATH (the default) from a deliberate evidence
 * step. Tests pass an owned temporary path so a run never rewrites the receipt. */
export async function writeAggregationArtifact(report: AggregationBenchmark, path: string = AGGREGATION_ARTIFACT_PATH): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return path;
}
