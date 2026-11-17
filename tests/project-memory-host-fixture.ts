import { test as base, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer, buildWidgetServer, type MountRegistry } from '../apps/server/server.ts';
import type { RuntimeAdapter, RuntimeCallbacks, StartRun } from '../packages/contracts/index.ts';
import type { MemorySourceRefV1 } from '../packages/contracts/project-memory.ts';
import { __setCapabilityFlagForTests } from '../packages/core/capability-flags.ts';
import { Service } from '../packages/core/service.ts';
import { Store } from '../packages/storage/store.ts';

export const MEMORY_HOST_URL = 'http://127.0.0.1:5549';
export const MEMORY_FIXTURE_LABEL = 'Memory host contract fixture (no model inference)';
export const MEMORY_CLAIM = 'Use SQLite for project persistence.';
export const MEMORY_SOURCE = `Scripted source observation. ${MEMORY_CLAIM}`;
export const MEMORY_SOURCE_PROMPT = '[memory-source] Record the SQLite project persistence decision.';

// Only the runtime is scripted. App, HTTP/CSRF, events, source capture,
// extraction scheduling, request custody, review and SQLite are production code.
class MemoryRuntime implements RuntimeAdapter {
  private callbacks!: RuntimeCallbacks;
  readonly deliveries: StartRun[] = [];
  constructor(private readonly folder: string) {}
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
  async dispose() {}
  private async deliver(input: StartRun) {
    this.deliveries.push(input);
    const sessionPath = join(this.folder, `session-${input.threadId}.json`);
    await writeFile(sessionPath, JSON.stringify([...new Set([...await this.history(sessionPath), ...(input.inputIds ?? [input.inputId])])]));
    this.callbacks.onEvent({ ...input, type: 'session', sessionPath });
    this.callbacks.onEvent({ ...input, type: 'input.processing', inputIds: input.inputIds ?? [input.inputId] });
    this.callbacks.onEvent({ ...input, type: 'assistant.message', messageId: randomUUID(), inputIds: input.inputIds,
      content: input.prompt.includes('[memory-source]') ? MEMORY_SOURCE : 'The scripted host contract turn completed.' });
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
  private host!: Awaited<ReturnType<typeof buildServer>>;
  private widgets!: Awaited<ReturnType<typeof buildWidgetServer>>;
  private closing?: Promise<void>;
  readonly generations: MemoryRuntime[] = [];
  readonly extractions: ExtractionRuntime[] = [];
  readonly requests: { method: string; url: string; status: number; csrf: boolean; body: unknown }[] = [];
  readonly preparedResponses: { httpRequestId: string; url: string; threadId: string | null; prompt: string | null; status: number; response: unknown; captureError: string | null }[] = [];
  preparedResponseCaptureError: string | null = null;
  readonly projectPath: string;
  constructor(readonly folder: string) { this.projectPath = join(folder, 'project'); }
  async start() {
    this.closing = undefined;
    this.store = new Store(join(this.folder, 'profile'));
    this.runtime = new MemoryRuntime(this.folder); this.generations.push(this.runtime);
    this.service = new Service(this.store, this.runtime, { memoryExtractionRuntimeFactory: () => {
      const runtime = new ExtractionRuntime(); this.extractions.push(runtime); return runtime;
    } });
    await this.service.recover();
    const mounts: MountRegistry = new Map();
    this.host = await buildServer(this.service, { port: 5549, widgetPort: 5550, mounts, dev: false });
    this.widgets = await buildWidgetServer(this.service, mounts, 5550);
    // Observe the actual serialized HTTP payload before it leaves Fastify.
    // Returning that same payload preserves the production response; CDP may
    // evict its own response-body cache before a later test assertion reads it.
    this.host.addHook('onSend', async (request, reply, payload) => {
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
    this.host.addHook('onResponse', async (request, reply) => {
      if (request.url.startsWith('/api/')) this.requests.push({ method: request.method, url: request.url, status: reply.statusCode,
        csrf: typeof request.headers['x-harness-csrf'] === 'string', body: request.body ?? null });
    });
    try {
      // Bind exclusively. A conflicting listener fails rather than reusing a host.
      await this.host.listen({ port: 5549, host: '127.0.0.1' });
      await this.widgets.listen({ port: 5550, host: 'localhost' });
    } catch (error) { await this.close(); throw error; }
  }
  close(): Promise<void> {
    const { host, widgets, service, store } = this;
    return this.closing ??= (async () => { await host?.close(); await widgets?.close(); await service?.dispose(); store?.close(); })();
  }
  async restart() { await this.close(); await this.start(); }
  async memory(threadId: string) {
    const thread = this.service.thread(threadId);
    if (!thread.projectId) throw new Error('The fixture requires a connected project.');
    return this.service.projectMemory.read(await this.service.projectMemory.access(thread.projectId, threadId));
  }
}

export const test = base.extend<{ memoryHost: MemoryHostFixture }>({
  memoryHost: async ({}, use, info) => {
    const folder = await mkdtemp(join(tmpdir(), 'gen-memory-host-')), host = new MemoryHostFixture(folder);
    await mkdir(host.projectPath); await mkdir(info.outputDir, { recursive: true });
    __setCapabilityFlagForTests('memory.projectV1', true);
    try {
      await host.start(); await use(host);
    } finally {
      try {
        await writeFile(info.outputPath('memory-host-observations.json'), JSON.stringify({ fixture: MEMORY_FIXTURE_LABEL,
          scope: 'Production App, HTTP/CSRF, Service and Store with scripted foreground/extraction runtimes; no native provider, installed desktop or model inference proof.',
          ports: [5549, 5550], requests: host.requests, preparedResponses: host.preparedResponses,
          preparedResponseCaptureError: host.preparedResponseCaptureError, deliveries: host.generations.map(runtime => runtime.deliveries),
          extractionDeliveries: host.extractions.map(runtime => ({ deliveries: runtime.deliveries, disposed: runtime.disposed })),
          snapshot: host.store?.db.isOpen ? host.store.snapshot() : null }, null, 2));
      } finally {
        try { await host.close(); await rm(folder, { recursive: true, force: true }); }
        finally { __setCapabilityFlagForTests('memory.projectV1', undefined); }
      }
    }
  },
});
export { expect };
