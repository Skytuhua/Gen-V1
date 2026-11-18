import { test as base, expect } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../apps/server/server.ts';
import { launchHost, type RunningHost } from '../apps/server/host.ts';
import type { RunContext, RuntimeAdapter, RuntimeCallbacks, StartRun } from '../packages/contracts/index.ts';
import type { MemoryCheckpointAckV1, MemoryCheckpointRequirementV1 } from '../packages/contracts/memory-checkpoint.ts';
import type { NativeCompactionAckV1, NativeCompactionEnvelopeV1, NativeCompactionReceiptV1 } from '../packages/contracts/native-compaction.ts';
import type { MemorySourceRefV1 } from '../packages/contracts/project-memory.ts';
import { Service } from '../packages/core/service.ts';
import { Store } from '../packages/storage/store.ts';

export const MEMORY_HOST_URL = 'http://127.0.0.1:5549';
export const MEMORY_FIXTURE_LABEL = 'Memory host contract fixture (no model inference)';
export const MEMORY_CLAIM = 'Use SQLite for project persistence.';
export const MEMORY_SOURCE = `Scripted source observation. ${MEMORY_CLAIM}`;
export const MEMORY_SOURCE_PROMPT = '[memory-source] Record the SQLite project persistence decision.';
export const COMPACTION_HISTORY_PROMPT = '[compaction-history] Complete the scripted investigation.';
export const COMPACTION_TAIL_PROMPT = '[compaction-tail] Keep the project persistence decision available.';
const COMPACTION_HISTORY = 'Completed scripted investigation with no provider inference. '.repeat(240);
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

// Only the runtime is scripted. App, HTTP/CSRF, events, source capture,
// extraction scheduling, request custody, review and SQLite are production code.
class MemoryRuntime implements RuntimeAdapter {
  private callbacks!: RuntimeCallbacks;
  readonly deliveries: StartRun[] = [];
  readonly compactions: {ctx: RunContext; envelope: NativeCompactionEnvelopeV1; checkpoint: MemoryCheckpointAckV1;
    admission: NativeCompactionAckV1; receipt: NativeCompactionReceiptV1; archivePath: string}[] = [];
  constructor(private readonly folder: string, private readonly protectedCompaction: boolean) {}
  configure(callbacks: RuntimeCallbacks) { this.callbacks = callbacks; }
  async models() { return [{ id: 'fixture/project-memory', provider: 'fixture', name: MEMORY_FIXTURE_LABEL }]; }
  async history(sessionPath: string): Promise<string[]> {
    try { return JSON.parse(await readFile(sessionPath, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
  async start(input: StartRun) { await this.deliver(input); }
  async followUp(input: StartRun) { await this.deliver(input); }
  async cancel() {}
  async compact() { throw new Error('Native compaction is outside this scripted host fixture.'); }
  async nativeHistoryDigest(_ctx: RunContext, sessionPath: string) {
    if (!this.protectedCompaction) throw new Error('Protected compaction requires the explicit fixture option.');
    const source = await readFile(sessionPath + '.native.json', 'utf8');
    return {sha256: sha256(source), messages: JSON.parse(source) as {role: string; content: string}[]};
  }
  async compactProtected(ctx: RunContext, sessionPath: string, modelId: string, accountId: string | null,
    envelope: NativeCompactionEnvelopeV1, requirement?: MemoryCheckpointRequirementV1): Promise<NativeCompactionReceiptV1> {
    if (!this.protectedCompaction || requirement?.apiVersion !== 2 || !requirement.required)
      throw new Error('This fixture requires the admitted protected path and project memory checkpoint.');
    const source = await this.nativeHistoryDigest(ctx, sessionPath);
    if (source.sha256 !== envelope.plan.sourceSha256) throw new Error('The scripted native source changed.');
    this.callbacks.onEvent({...ctx, type: 'compaction.start', reason: 'manual'});
    const checkpoint = await this.callbacks.onMemoryCheckpoint!({apiVersion: 2, requestId: 'fixture-checkpoint-' + randomUUID(),
      adapterId: 'hermes', ctx, sessionPath, modelId, accountId, reason: 'manual'});
    if (!checkpoint.persisted) throw new Error('The real host did not persist its memory checkpoint.');
    const retained = envelope.plan.retainedIndices.map(index => source.messages[index]);
    const summary = {role: 'assistant', content: 'Scripted compaction result. No native compressor or model was invoked. ' + JSON.stringify(envelope.plan.references)};
    const before = JSON.stringify(source.messages), after = JSON.stringify([summary, ...retained]);
    if (Buffer.byteLength(after) >= Buffer.byteLength(before)) throw new Error('The fixture source has no reducible completed response.');
    const archivePath = sessionPath + '.archive-' + envelope.plan.candidateId + '.json';
    await writeFile(archivePath, before);
    if ((await this.nativeHistoryDigest(ctx, sessionPath)).sha256 !== source.sha256) throw new Error('The fixture source changed before host commit.');
    // Invoke the actual Service gate, then commit these scripted fixture bytes
    // synchronously. This is host composition evidence, not native apply proof.
    const admission = this.callbacks.onCompactionCommit!({version: 1, candidateId: envelope.plan.candidateId,
      planDigest: envelope.planDigest, sourceSha256: source.sha256, owner: structuredClone(envelope.plan.owner)});
    if (!admission.accepted || admission.planDigest !== envelope.planDigest) throw new Error('The real host refused the compaction commit.');
    writeFileSync(sessionPath + '.native.json', after);
    const receipt: NativeCompactionReceiptV1 = {version: 1, candidateId: envelope.plan.candidateId, planDigest: envelope.planDigest,
      sourceSha256: source.sha256, status: 'APPLIED', archiveRef: 'native-archive:' + source.sha256, archiveSha256: sha256(before),
      retainedBytes: Buffer.byteLength(JSON.stringify(retained)), protectedRecords: retained.length,
      referenceCount: envelope.plan.references.length, toolPairs: 0, beforeBytes: Buffer.byteLength(before), afterBytes: Buffer.byteLength(after),
      summarySha256: sha256(JSON.stringify(summary)), reason: null};
    this.compactions.push({ctx: {...ctx}, envelope: structuredClone(envelope), checkpoint, admission, receipt, archivePath});
    this.callbacks.onEvent({...ctx, type: 'compaction.end', reason: 'manual', aborted: false});
    this.callbacks.onEvent({...ctx, type: 'settled', aborted: false});
    return receipt;
  }
  async dispose() {}
  private async deliver(input: StartRun) {
    this.deliveries.push(input);
    const sessionPath = join(this.folder, `session-${input.threadId}.json`);
    await writeFile(sessionPath, JSON.stringify([...new Set([...await this.history(sessionPath), ...(input.inputIds ?? [input.inputId])])]));
    const content = input.prompt.includes('[memory-source]') ? MEMORY_SOURCE :
      input.prompt.includes('[compaction-history]') ? COMPACTION_HISTORY : 'The scripted host contract turn completed.';
    if (this.protectedCompaction) {
      let messages: {role: string; content: string}[] = [];
      try {messages = (await this.nativeHistoryDigest(input, sessionPath)).messages;}
      catch (error) {if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;}
      await writeFile(sessionPath + '.native.json', JSON.stringify([...messages, {role: 'user', content: input.prompt}, {role: 'assistant', content}]));
    }
    this.callbacks.onEvent({ ...input, type: 'session', sessionPath });
    this.callbacks.onEvent({ ...input, type: 'input.processing', inputIds: input.inputIds ?? [input.inputId] });
    if (this.protectedCompaction) this.callbacks.onEvent({...input, type: 'context.request', provider: 'hermes',
      sequence: this.deliveries.length, promptBytes: Buffer.byteLength(input.prompt), knownInputs: (input.inputIds ?? [input.inputId]).length});
    this.callbacks.onEvent({ ...input, type: 'assistant.message', messageId: randomUUID(), inputIds: input.inputIds,
      content });
    this.callbacks.onEvent({ ...input, type: 'settled' });
  }
}

class ExtractionRuntime implements RuntimeAdapter {
  private callbacks!: RuntimeCallbacks;
  readonly deliveries: StartRun[] = [];
  disposed = false;
  configure(callbacks: RuntimeCallbacks) { this.callbacks = callbacks; }
  async models() { return []; }
  async history() { return []; }
  async start(input: StartRun) {
    this.deliveries.push(input);
    const cut = JSON.parse(input.prompt.slice(input.prompt.indexOf('\n{') + 1)) as { sources: { ref: MemorySourceRefV1; content: string }[] };
    const source = cut.sources.find(value => value.content === MEMORY_SOURCE);
    const proposals = source ? [{ kind: 'DECISION', text: MEMORY_CLAIM, sourceRefs: [source.ref] }] : [];
    this.callbacks.onEvent({ ...input, type: 'assistant.message', messageId: randomUUID(), content: JSON.stringify(proposals) });
    this.callbacks.onEvent({ ...input, type: 'settled' });
  }
  async followUp() { throw new Error('Each extraction must have a fresh runtime.'); }
  async cancel() {}
  async compact() { throw new Error('Extraction cannot compact native history.'); }
  async dispose() { this.disposed = true; }
}

export class MemoryHostFixture {
  store!: Store;
  service!: Service;
  runtime!: MemoryRuntime;
  private host?: RunningHost;
  private closing?: Promise<void>;
  readonly generations: MemoryRuntime[] = [];
  readonly extractions: ExtractionRuntime[] = [];
  readonly requests: { method: string; url: string; status: number; csrf: boolean; body: unknown }[] = [];
  readonly preparedResponses: { httpRequestId: string; url: string; threadId: string | null; prompt: string | null; status: number; response: unknown; captureError: string | null }[] = [];
  preparedResponseCaptureError: string | null = null;
  readonly projectPath: string;
  constructor(readonly folder: string, readonly protectedCompaction = false, readonly compilerObservation = false) { this.projectPath = join(folder, 'project'); }
  async start() {
    this.closing = undefined;
    this.host = await launchHost({ dataDir: join(this.folder, 'profile'), port: 5549, widgetPort: 5550, dev: false,
      pluginDir: join(this.folder, 'plugins'), capabilityFlags: { 'memory.projectV1': true,
        ...(this.protectedCompaction ? {'context.compilerV1': this.compilerObservation, 'context.lossAwareCompactionV1': true} : {}) } }, {
      createRuntime: () => { this.runtime = new MemoryRuntime(this.folder, this.protectedCompaction); this.generations.push(this.runtime); return this.runtime; },
      createService: (store, runtime) => {
        this.store = store;
        return this.service = new Service(store, runtime, { memoryExtractionRuntimeFactory: () => {
          const extraction = new ExtractionRuntime(); this.extractions.push(extraction); return extraction;
        } });
      },
      buildServer: async (service, options) => {
        const app = await buildServer(service, options);
        // Observe the actual serialized HTTP payload before it leaves Fastify.
        // Returning that same payload preserves the production response; CDP may
        // evict its own response-body cache before a later test assertion reads it.
        app.addHook('onSend', async (request, reply, payload) => {
          if (request.method === 'POST' && request.url.endsWith('/memory/requests/prepare')) {
            if (this.preparedResponses.length >= 32) this.preparedResponseCaptureError = 'Prepared-response observation count exceeded 32.';
            else {
              const body = request.body as { threadId?: unknown; prompt?: unknown } | null;
              const text = typeof payload === 'string' ? payload : Buffer.isBuffer(payload) ? payload.toString('utf8') : null;
              let response: unknown = null, captureError: string | null = null;
              if (text === null || Buffer.byteLength(text, 'utf8') > 64 * 1024) captureError = 'Prepared response was not buffered JSON within 64 KiB.';
              else try { response = JSON.parse(text); } catch { captureError = 'Prepared response was not valid JSON.'; }
              this.preparedResponses.push({ httpRequestId: request.id, url: request.url, status: reply.statusCode,
                threadId: typeof body?.threadId === 'string' ? body.threadId : null, prompt: typeof body?.prompt === 'string' ? body.prompt : null,
                response, captureError });
            }
          }
          return payload;
        });
        app.addHook('onResponse', async (request, reply) => {
          if (request.url.startsWith('/api/')) this.requests.push({ method: request.method, url: request.url, status: reply.statusCode,
            csrf: typeof request.headers['x-harness-csrf'] === 'string', body: request.body ?? null });
        });
        return app;
      },
    });
  }
  close(): Promise<void> {
    return this.closing ??= this.host?.close() ?? Promise.resolve();
  }
  async restart() { await this.close(); await this.start(); }
  async memory(threadId: string) {
    const thread = this.service.thread(threadId);
    if (!thread.projectId) throw new Error('The fixture requires a connected project.');
    return this.service.projectMemory.read(await this.service.projectMemory.access(thread.projectId, threadId));
  }
}

export const test = base.extend<{ memoryHost: MemoryHostFixture; memoryCompaction: boolean; memoryCompilerObservation: boolean }>({
  memoryCompaction: [false, {option: true}],
  memoryCompilerObservation: [false, {option: true}],
  memoryHost: async ({memoryCompaction, memoryCompilerObservation}, use, info) => {
    const folder = await mkdtemp(join(tmpdir(), 'gen-memory-host-')), host = new MemoryHostFixture(folder, memoryCompaction, memoryCompilerObservation);
    await mkdir(host.projectPath); await mkdir(info.outputDir, { recursive: true });
    try {
      await host.start(); await use(host);
    } finally {
      try {
        await writeFile(info.outputPath('memory-host-observations.json'), JSON.stringify({ fixture: MEMORY_FIXTURE_LABEL,
          scope: 'Production host composition, profile lease, HostOptions capability activation, App, HTTP/CSRF, Service and Store with scripted foreground/extraction runtimes; no native provider, installed desktop or model inference proof.',
          protectedCompaction: host.protectedCompaction, compilerObservation: host.compilerObservation,
          compactionScope: 'When explicitly enabled, the scripted adapter invokes the real memory checkpoint and native commit callbacks, then returns injected native-contract receipts. No original native compressor or Windows apply proof.',
          ports: [5549, 5550], requests: host.requests, preparedResponses: host.preparedResponses,
          preparedResponseCaptureError: host.preparedResponseCaptureError, deliveries: host.generations.map(runtime => runtime.deliveries),
          compactions: host.generations.flatMap(runtime => runtime.compactions),
          extractionDeliveries: host.extractions.map(runtime => ({ deliveries: runtime.deliveries, disposed: runtime.disposed })),
          snapshot: host.store?.db.isOpen ? host.store.snapshot() : null }, null, 2));
      } finally {
        await host.close(); await rm(folder, { recursive: true, force: true });
      }
    }
  },
});
export { expect };
