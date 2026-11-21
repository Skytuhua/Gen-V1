import { test as base, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { launchHost, type RunningHost } from '../apps/server/host.ts';
import { registerWorkspaceHost } from '../apps/server/workspace-host.ts';
import type { RuntimeAdapter, RuntimeCallbacks, StartRun } from '../packages/contracts/index.ts';
import { Service } from '../packages/core/service.ts';
import { Store } from '../packages/storage/store.ts';
import { TerminalHost } from '../packages/workspace/terminal.ts';
import { ProjectTools } from '../packages/workspace/tools.ts';

export const REVIEW_HOST_URL = 'http://127.0.0.1:5561';
export const REVIEW_FIXTURE_LABEL = 'Review-comments host fixture (no model inference)';
export const REVIEW_NOT_CHANGED_NOTE = 'The cited change is already covered by staged work; no edit made.';
const git = promisify(execFile);

// Only the runtime is scripted. App, HTTP/CSRF, commands, review-comment store,
// managed worktree preparation, git status and SSE are production code.
class ReviewRuntime implements RuntimeAdapter {
  private callbacks!: RuntimeCallbacks;
  readonly deliveries: StartRun[] = [];
  readonly resolutions: { commentId: string; outcome: string; result: unknown }[] = [];
  constructor(private readonly folder: string) {}
  configure(callbacks: RuntimeCallbacks) { this.callbacks = callbacks; }
  async models() { return [{ id: 'fixture/review-comments', provider: 'fixture', name: REVIEW_FIXTURE_LABEL }]; }
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
    const ctx = { threadId: input.threadId, runId: input.runId, epoch: input.epoch };
    const sessionPath = join(this.folder, `session-${input.threadId}.json`);
    await writeFile(sessionPath, JSON.stringify([...new Set([...await this.history(sessionPath), ...(input.inputIds ?? [input.inputId])])]));
    this.callbacks.onEvent({ ...ctx, type: 'session', sessionPath });
    this.callbacks.onEvent({ ...ctx, type: 'input.processing', inputIds: input.inputIds ?? [input.inputId] });
    // The scripted agent resolves every delivered comment except the last one,
    // which stays 'sent' so settlement flips it to 'unaddressed'.
    const ids = [...input.prompt.matchAll(/"commentId":"([^"]+)"/g)].map(match => match[1]!);
    for (const [index, commentId] of (ids.length > 1 ? ids.slice(0, -1) : ids).entries()) {
      const args = index === 0 ? { commentId, outcome: 'fixed' } : { commentId, outcome: 'not_changed', note: REVIEW_NOT_CHANGED_NOTE };
      const result = await this.callbacks.onTool({ name: 'review_comment_resolve', args: { ...args, commandId: randomUUID() } }, ctx);
      this.resolutions.push({ commentId, outcome: args.outcome, result });
    }
    this.callbacks.onEvent({ ...ctx, type: 'assistant.message', messageId: randomUUID(), inputIds: input.inputIds ?? [input.inputId],
      content: 'The scripted review fixture addressed the delivered comments.' });
    this.callbacks.onEvent({ ...ctx, type: 'settled' });
  }
}

export class ReviewHostFixture {
  store!: Store;
  service!: Service;
  runtime!: ReviewRuntime;
  projects!: ProjectTools;
  private host?: RunningHost;
  private closing?: Promise<void>;
  readonly projectPath: string;
  constructor(readonly folder: string, readonly reviewEnabled: boolean) { this.projectPath = join(folder, 'project'); }
  async start() {
    this.closing = undefined;
    this.host = await launchHost({ dataDir: join(this.folder, 'profile'), port: 5561, widgetPort: 5562, dev: false,
      pluginDir: join(this.folder, 'plugins'), capabilityFlags: { 'ui.reviewCommentsV1': this.reviewEnabled } }, {
      createRuntime: () => this.runtime = new ReviewRuntime(this.folder),
      createService: (store, runtime) => {
        this.store = store;
        const projects = this.projects = new ProjectTools(store);
        const service = this.service = new Service(store, runtime, {
          prepareWorkspace: thread => projects.prepareWorkspace(thread),
          reviewGitRevision: async (projectId, threadId) => { try { return (await projects.gitStatus(projectId, threadId))?.revision ?? null; } catch { return null; } },
        });
        registerWorkspaceHost(service, { projects, terminals: new TerminalHost(projects) });
        return service;
      },
    });
  }
  close(): Promise<void> {
    return this.closing ??= this.host?.close() ?? Promise.resolve();
  }
  async restart() { await this.close(); await this.start(); }
  async git(...args: string[]) { return (await git('git', ['-C', this.projectPath, ...args])).stdout.trim(); }
  worktree(threadId: string) {
    const binding = this.store.all<{ path: string }>('workspaceBinding', threadId)[0];
    if (!binding) throw new Error('The thread has no managed working copy yet.');
    return binding.path;
  }
}

export const test = base.extend<{ reviewHost: ReviewHostFixture; reviewEnabled: boolean }>({
  reviewEnabled: [true, { option: true }],
  reviewHost: async ({ reviewEnabled }, use, info) => {
    const folder = await mkdtemp(join(tmpdir(), 'gen-review-host-')), host = new ReviewHostFixture(folder, reviewEnabled);
    try {
      await host.start(); await use(host);
    } finally {
      try {
        await writeFile(info.outputPath('review-host-observations.json'), JSON.stringify({ fixture: REVIEW_FIXTURE_LABEL,
          scope: 'Production host composition, profile lease, HostOptions capability activation, App, HTTP/CSRF, Service, Store, ProjectTools working copies and scripted foreground runtime; no native provider, installed desktop or model inference proof.',
          ports: [5561, 5562], reviewEnabled, deliveries: host.runtime?.deliveries ?? [], resolutions: host.runtime?.resolutions ?? [],
          snapshot: host.store?.db.isOpen ? host.store.snapshot() : null }, null, 2));
      } finally {
        await host.close(); await rm(folder, { recursive: true, force: true });
      }
    }
  },
});
export { expect };
