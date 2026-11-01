import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { HarnessError, type DataRecord, type ResourceGrant, type RunContext, type RuntimeAdapter, type RuntimeEvent, type StartRun, type Thread, type ToolCall } from '../contracts/index.ts';
import {
  AgentProgressSchema, AgentUsageSchema, DelegateSchema, PlanRecordSchema, PlanUpdateSchema, PLANNING_PROVENANCE, planDataId,
  type AgentJob, type AgentUsage, type DelegateArgs, type PlanRecord,
} from '../contracts/planning.ts';
import { digest, Store } from '../storage/store.ts';
import { handleDomainTool, type DomainContext } from '../capabilities/index.ts';
import {accountResolver,assertAccountAvailable,modelProvider} from './accounts.ts';

export interface PlanningHooks {
  store: Store;
  /** Must reject stale epoch/run ownership, including after every awaited operation. */
  assertRun(ctx: RunContext): unknown;
  /** The host context must bind publications and filesystem access to this original context. */
  domainContext(ctx: RunContext, signal: AbortSignal): DomainContext;
  runtimeFactory?: () => RuntimeAdapter | Promise<RuntimeAdapter>;
}
export interface DelegationResult { commandId: string; jobs: AgentJob[] }
interface Batch {
  id: string; threadId: string; parent: RunContext; hash: string; jobIds: string[];
  status: 'pending' | 'completed' | 'interrupted'; result?: DelegationResult;
}
interface ActiveJob {
  id: string; parent: RunContext; child: RunContext; signal: AbortSignal; runtime?: RuntimeAdapter;
  finish: boolean; closed: boolean; lastUsage: number; pendingUsage?: AgentUsage; resolve(): void;
}
const readers = new Set(['repository_files', 'repository_read', 'repository_status', 'repository_diff', 'repository_log', 'text_import', 'knowledge_publish']);
const terminal = new Set<AgentJob['status']>(['completed', 'needs_review', 'failed', 'cancelled', 'interrupted']);
const same = (a: RunContext, b: RunContext) => a.threadId === b.threadId && a.runId === b.runId && a.epoch === b.epoch;
const now = () => new Date().toISOString();
function short(value: unknown): string {
  const text = (typeof value === 'string' ? value : value instanceof Error ? value.message : 'Agent failed').slice(0, 4096);
  const bytes = Buffer.from(text);
  // Leave room for a UTF-8 replacement character at a partial final code point.
  return bytes.byteLength > 1024 ? bytes.subarray(0, 1021).toString('utf8') : text;
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HarnessError('INVALID_PLAN_ARGUMENTS', 'Invalid plan or agent arguments', result.error.issues.map(issue => ({ path: issue.path, message: issue.message })));
  return result.data;
}
function bounded(value: PlanRecord, maxBytes = 128 * 1024): PlanRecord {
  const valid = parse(PlanRecordSchema, value);
  if (Buffer.byteLength(JSON.stringify(valid)) > maxBytes) throw new HarnessError('PLAN_TOO_LARGE', 'The plan exceeds its bounded storage budget');
  return valid;
}

/** Plain coordinator: one parent-owned tool call awaits up to three read-only Pi sessions. */
export class PlanningCoordinator {
  private active = new Map<string, ActiveJob>();
  private batches = new Map<string, Promise<DelegationResult>>();
  private closed = false;
  constructor(private readonly hooks: PlanningHooks) {}

  inspect(threadId: string): (DataRecord & { value: PlanRecord }) | null {
    const record = this.hooks.store.get<DataRecord>('data', planDataId(threadId));
    if (!record || record.threadId !== threadId || record.provenance !== PLANNING_PROVENANCE) return null;
    return { ...record, value: parse(PlanRecordSchema, record.value) };
  }
  private assert(ctx: RunContext, signal?: AbortSignal): void {
    if (this.closed || signal?.aborted) throw new HarnessError('CANCELLED_RUN', 'The parent run no longer owns this work');
    this.hooks.assertRun(ctx);
  }
  private plan(threadId: string): PlanRecord { return this.inspect(threadId)?.value ?? { version: 1, title: 'Plan', steps: [], agents: [] }; }
  /** Caller must already own the surrounding Store transaction. */
  private put(threadId: string, value: PlanRecord): DataRecord & { value: PlanRecord } {
    const previous = this.inspect(threadId), record = {
      id: planDataId(threadId), threadId, revision: (previous?.revision ?? 0) + 1,
      value: bounded(value), provenance: PLANNING_PROVENANCE, createdAt: previous?.createdAt ?? now(),
    };
    this.hooks.store.put('data', record.id, threadId, record);
    this.hooks.store.put('dataVersion', `${record.id}@${record.revision}`, threadId, record);
    return record;
  }
  updatePlan(ctx: RunContext, args: unknown): DataRecord & { value: PlanRecord } {
    this.assert(ctx); const next = parse(PlanUpdateSchema, args);
    const value = bounded({ ...this.plan(ctx.threadId), ...next }, 64 * 1024);
    return this.hooks.store.internal('plan.updated', ctx.threadId, () => {
      this.assert(ctx); return this.put(ctx.threadId, value);
    }) as DataRecord & { value: PlanRecord };
  }
  private change(ctx: RunContext, jobId: string, apply: (job: AgentJob) => AgentJob, lateTerminal = false): AgentJob {
    return this.hooks.store.internal('agent.updated', ctx.threadId, () => {
      if (!lateTerminal) this.assert(ctx);
      const plan = this.plan(ctx.threadId), index = plan.agents.findIndex(job => job.id === jobId);
      if (index < 0) throw new HarnessError('UNKNOWN_AGENT', 'Agent job does not belong to this thread');
      const next = apply(plan.agents[index]);
      plan.agents[index] = { ...next, updatedAt: now() }; this.put(ctx.threadId, plan); return plan.agents[index];
    }) as AgentJob;
  }
  progressFromChild(ctx: RunContext, jobId: string, raw: unknown): AgentJob {
    const job = this.active.get(jobId);
    if (!job || job.closed || !same(job.parent, ctx)) throw new HarnessError('CANCELLED_RUN', 'Agent job is no longer active');
    this.assert(ctx, job.signal);
    const args = parse(AgentProgressSchema, raw);
    return this.change(ctx, jobId, previous => {
      const ids = args.completedRequirementIds ?? previous.completedRequirementIds;
      if (!ids.every(id => previous.requirements.some(item => item.id === id))) throw new HarnessError('INVALID_AGENT_PROGRESS', 'Only declared requirements may be reported complete');
      return { ...previous, ...args, completedRequirementIds: ids };
    });
  }
  async delegate(ctx: RunContext, raw: unknown, signal: AbortSignal): Promise<DelegationResult> {
    ctx = { ...ctx };
    this.assert(ctx, signal);
    const args = parse(DelegateSchema, raw), command = { id: args.commandId, type: 'task.delegate', threadId: ctx.threadId, payload: args };
    // Existing explicit command receipts validate content identity; internal events need none.
    this.hooks.store.receipt(command);
    const existing = this.hooks.store.get<Batch>('planningBatch', args.commandId);
    if (existing) {
      if (existing.threadId !== ctx.threadId || existing.hash !== digest(args)) throw new HarnessError('DUPLICATE_COMMAND', 'Delegation ID reused with different content');
      if (existing.status === 'completed' && existing.result) return existing.result;
      if (existing.status === 'pending' && this.batches.has(args.commandId)) return this.batches.get(args.commandId)!;
      throw new HarnessError('DELEGATION_INTERRUPTED', 'The earlier delegation was interrupted. Use a new explicit command ID to authorize new work.');
    }
    if (this.active.size + args.tasks.length > 3) throw new HarnessError('AGENT_LIMIT', 'At most three auxiliary readers may work at once');
    const thread = this.hooks.store.get<Thread>('thread', ctx.threadId);
    if (!thread?.modelId) throw new HarnessError('MODEL_REQUIRED', 'Select the parent subscription model before delegation');
    const accountId=thread.accountId??null;
    assertAccountAvailable(this.hooks.store,modelProvider(thread.modelId),accountId);
    const plan = this.plan(ctx.threadId);
    if (plan.agents.length + args.tasks.length > 24) throw new HarnessError('AGENT_HISTORY_LIMIT', 'This plan has reached its 24-job history limit');
    if (args.tasks.some(task => task.stepId && !plan.steps.some(step => step.id === task.stepId))) throw new HarnessError('UNKNOWN_PLAN_STEP', 'Agent tasks may reference only existing plan steps');
    const createdAt = now();
    const jobs: AgentJob[] = args.tasks.map(task => ({ id: randomUUID(), commandId: args.commandId, taskId: task.id, name: task.name, task: task.task,
      ...(task.stepId ? { stepId: task.stepId } : {}), status: 'queued', requirements: task.requirements,
      completedRequirementIds: [], reportedPercent: null, createdAt, updatedAt: createdAt }));
    for (const job of jobs) if (job.stepId) {
      const step = plan.steps.find(item => item.id === job.stepId)!; step.agentIds = [...(step.agentIds ?? []), job.id];
    }
    // Reserve room for bounded executor evidence, final summaries and usage reports.
    plan.agents.push(...jobs); bounded(plan, 64 * 1024);
    const batch: Batch = { id: args.commandId, threadId: ctx.threadId, parent: { ...ctx }, hash: digest(args), jobIds: jobs.map(job => job.id), status: 'pending' };
    this.hooks.store.command(command, () => {
      this.assert(ctx, signal); this.put(ctx.threadId, plan); this.hooks.store.put('planningBatch', batch.id, ctx.threadId, batch); return { commandId: batch.id, jobIds: batch.jobIds };
    });
    const resources = this.hooks.store.all<ResourceGrant>('resource', ctx.threadId).map(grant => ({ ...grant, writable: false }));
    const promise = this.runBatch(ctx, args, jobs, thread.modelId,accountId, resources, signal, batch);
    this.batches.set(args.commandId, promise);
    try { return await promise; } finally { if (this.batches.get(args.commandId) === promise) this.batches.delete(args.commandId); }
  }
  private async runBatch(ctx: RunContext, args: DelegateArgs, jobs: AgentJob[], modelId: string,accountId:string|null, resources: ResourceGrant[], signal: AbortSignal, batch: Batch): Promise<DelegationResult> {
    await Promise.all(jobs.map((job, index) => this.runJob(ctx, args.tasks[index], job, modelId,accountId, resources, signal)));
    const result: DelegationResult = { commandId: batch.id, jobs: this.plan(ctx.threadId).agents.filter(job => batch.jobIds.includes(job.id)) };
    this.hooks.store.internal('delegation.finished', ctx.threadId, () => {
      const current = this.hooks.store.get<Batch>('planningBatch', batch.id);
      // A recovery pass has revoked this batch; never overwrite its interrupted state.
      if (current?.status === 'pending') this.hooks.store.put('planningBatch', batch.id, ctx.threadId, { ...current, status: 'completed', result });
      return { commandId: batch.id, statuses: result.jobs.map(job => ({ id: job.id, status: job.status })) };
    });
    return result;
  }
  private async runJob(ctx: RunContext, task: DelegateArgs['tasks'][number], record: AgentJob, modelId: string,accountId:string|null, resources: ResourceGrant[], signal: AbortSignal): Promise<void> {
    let runtime: RuntimeAdapter | undefined;
    let job: ActiveJob | undefined;
    let abort: (() => void) | undefined;
    try {
      this.assert(ctx, signal);
      const child = { threadId: `${ctx.threadId}:agent:${record.id}`, runId: randomUUID(), epoch: 1 };
      let resolve!: () => void; const done = new Promise<void>(res => { resolve = res; });
      const activeJob: ActiveJob = { id: record.id, parent: { ...ctx }, child, signal, finish: false, closed: false, lastUsage: -Infinity, resolve };
      job = activeJob;
      // Register cancellation ownership and reserve the slot before any import/factory await.
      this.active.set(record.id, activeJob);
      abort = () => { void this.stopJob(activeJob, 'cancelled').catch(() => {}); };
      signal.addEventListener('abort', abort, { once: true });
      const creating = Promise.resolve().then(() => this.hooks.runtimeFactory?.() ?? import('../runtime/index.ts').then(({ createRuntime }) => createRuntime({ dataDir: this.hooks.store.dataDir,accounts:accountResolver(this.hooks.store) }))).then(adapter => {
        if (activeJob.closed) { void adapter.dispose().catch(() => {}); throw new HarnessError('CANCELLED_RUN', 'Startup was cancelled'); }
        return adapter;
      });
      const adapter = await Promise.race([creating, done.then(() => { throw new HarnessError('CANCELLED_RUN', 'Startup was cancelled'); })]);
      runtime = adapter; activeJob.runtime = adapter;
      this.assert(ctx, signal);
      if (activeJob.closed) throw new HarnessError('CANCELLED_RUN', 'Startup was cancelled');
      adapter.configure({ onEvent: event => this.event(activeJob, event), onTool: (call, supplied) => this.tool(activeJob, call, supplied) });
      this.change(ctx, record.id, previous => ({ ...previous, status: 'working' }));
      const inputId = randomUUID();
      assertAccountAvailable(this.hooks.store,modelProvider(modelId),accountId);
      const input: StartRun = { ...child,accountId, prompt: this.prompt(task), modelId, thinkingLevel:this.hooks.store.get<Thread>("thread",ctx.threadId)?.thinkingLevel, sessionPath: null, inputId, inputIds: [inputId], resources };
      const started = adapter.start(input).catch(error => { this.fail(activeJob, error); });
      // Settlement/cancellation may arrive during startup. It must still release the root RPC.
      await Promise.race([started.then(() => done), done]);
    } catch (error) {
      if (job) this.fail(job, error);
      else this.change(ctx, record.id, previous => terminal.has(previous.status) ? previous : { ...previous, status: signal.aborted ? 'cancelled' : 'failed', error: short(error) }, true);
    } finally {
      if (abort) signal.removeEventListener('abort', abort);
      if (job) this.active.delete(job.id);
      if (runtime) await runtime.dispose().catch(() => {});
    }
  }
  private prompt(task: DelegateArgs['tasks'][number]): string {
    return `You are an auxiliary read-only reader for a parent task. Work only on the task below using supplied resource IDs. You cannot change files, prepare or execute operations, publish UI, request user input, delegate, or finish the parent task. Use only repository_files, repository_read, repository_status, repository_diff, repository_log, text_import, and knowledge_publish. Report actual completed requirement IDs through agent_progress. Do not estimate progress from elapsed time. Call task_finish with outcome and evidence when your own assigned work is complete; it does not finish the parent. Tool or source failures must be reported honestly.\n\nTask: ${task.task}\nInstructions: ${task.prompt}\nRequirements: ${JSON.stringify(task.requirements)}`;
  }
  private async tool(job: ActiveJob, call: ToolCall, supplied: RunContext): Promise<unknown> {
    if (job.closed || !same(job.child, supplied)) throw new HarnessError('CANCELLED_RUN', 'The child context is no longer active');
    this.assert(job.parent, job.signal);
    if (call.name === 'agent_progress') { job.finish = false; return this.progressFromChild(job.parent, job.id, call.args); }
    if (call.name === 'task_finish') {
      if (typeof call.args.outcome !== 'string' || !call.args.outcome.trim() || call.args.outcome.length > 16_384) throw new HarnessError('INVALID_AGENT_FINISH', 'Report a bounded completion outcome');
      this.change(job.parent, job.id, previous => ({ ...previous, summary: short(call.args.summary ?? call.args.outcome) }));
      job.finish = true; return { accepted: true, scope: 'child', jobId: job.id };
    }
    if (!readers.has(call.name)) throw new HarnessError('AGENT_TOOL_DENIED', 'Auxiliary readers cannot use this tool');
    job.finish = false;
    const domain = this.hooks.domainContext(job.parent, job.signal);
    const check = () => { if (job.closed) throw new HarnessError('CANCELLED_RUN', 'Agent has settled'); this.assert(job.parent, job.signal); };
    const restricted: DomainContext = {
      threadId: job.parent.threadId, signal: job.signal,
      resolveResource: async (id, path, write) => { check(); if (write) throw new HarnessError('AGENT_TOOL_DENIED', 'Read-only resource access'); const result = await domain.resolveResource(id, path, false); check(); return result; },
      ...(domain.withResource ? { withResource: <T>(id: string, path: string | undefined, write: boolean, action: (filename: string) => Promise<T>) => {
        check(); if (write) throw new HarnessError('AGENT_TOOL_DENIED', 'Read-only resource access');
        return domain.withResource!(id, path, false, async filename => { check(); const result = await action(filename); check(); return result; });
      } } : {}),
      publishData: (value, provenance) => {
        check(); const record = domain.publishData(value, provenance); check();
        if (record.threadId !== job.parent.threadId) throw new HarnessError('INVALID_AGENT_EVIDENCE', 'Published evidence must belong to the parent thread');
        this.change(job.parent, job.id, previous => {
          const evidence = [...(previous.evidence ?? [])];
          if (!evidence.some(ref => ref.id === record.id && ref.revision === record.revision)) evidence.push({ id: record.id, revision: record.revision });
          return { ...previous, evidence: evidence.slice(-8), ...(evidence.length > 8 ? { evidenceTruncated: true } : {}) };
        });
        return record;
      },
      prepareOperation: () => { throw new HarnessError('AGENT_TOOL_DENIED', 'Auxiliary readers cannot prepare operations'); },
      progress: (message, counts) => { try { check(); domain.progress(message, counts); } catch { /* Late diagnostics do not revive or mutate a stopped run. */ } },
    };
    const result = await handleDomainTool(call.name, call.args, restricted); check(); return result;
  }
  private event(job: ActiveJob, event: RuntimeEvent): void {
    if (job.closed || !same(job.child, event)) return;
    try { this.assert(job.parent, job.signal); } catch { void this.stopJob(job, 'cancelled').catch(() => {}); return; }
    if (event.type === 'error') { this.fail(job, event.message); return; }
    if (event.type === 'settled') {
      const previous = this.plan(job.parent.threadId).agents.find(item => item.id === job.id);
      if (!previous || terminal.has(previous.status)) { job.closed = true; job.resolve(); return; }
      const complete = job.finish && previous.requirements.every(item => previous.completedRequirementIds.includes(item.id));
      this.change(job.parent, job.id, item => ({ ...item, ...(job.pendingUsage ? { usage: job.pendingUsage } : {}), status: event.aborted === true ? 'cancelled' : complete ? 'completed' : 'needs_review' }));
      job.closed = true; job.resolve(); return;
    }
    if (event.type === 'usage') {
      const parsed = AgentUsageSchema.safeParse(event.usage && typeof event.usage === 'object' ? Object.fromEntries(Object.entries(event.usage).filter(([key]) => ['inputTokens', 'outputTokens', 'contextTokens', 'contextWindow', 'cost', 'sessionPercent', 'weeklyPercent'].includes(key))) : null);
      if (parsed.success) {
        job.pendingUsage = { ...job.pendingUsage, ...parsed.data };
        if (Date.now() - job.lastUsage < 100) return;
        this.change(job.parent, job.id, previous => ({ ...previous, usage: { ...previous.usage, ...job.pendingUsage } })); job.lastUsage = Date.now();
      }
    }
  }
  private fail(job: ActiveJob, error: unknown): void {
    if (job.closed) return;
    void this.stopJob(job, job.signal.aborted ? 'cancelled' : 'failed', short(error)).catch(() => {});
  }
  private async stopJob(job: ActiveJob, status: 'cancelled' | 'failed' | 'interrupted', error?: string): Promise<void> {
    if (job.closed) return;
    job.closed = true;
    this.change(job.parent, job.id, previous => terminal.has(previous.status) ? previous : { ...previous, status, ...(error ? { error } : {}) }, true);
    try { await job.runtime?.cancel(job.child); } finally { job.resolve(); }
  }
  async cancel(ctx: RunContext): Promise<void> {
    await Promise.all([...this.active.values()].filter(job => same(job.parent, ctx)).map(job => this.stopJob(job, 'cancelled')));
  }
  recover(): void {
    if (this.active.size) throw new HarnessError('AGENTS_ACTIVE', 'Recover before starting auxiliary sessions');
    for (const batch of this.hooks.store.all<Batch>('planningBatch')) if (batch.status === 'pending') {
      this.hooks.store.internal('delegation.interrupted', batch.threadId, () => {
        const plan = this.plan(batch.threadId);
        for (const job of plan.agents) if (batch.jobIds.includes(job.id) && !terminal.has(job.status)) { job.status = 'interrupted'; job.updatedAt = now(); }
        this.put(batch.threadId, plan); this.hooks.store.put('planningBatch', batch.id, batch.threadId, { ...batch, status: 'interrupted' }); return { commandId: batch.id };
      });
    }
  }
  async dispose(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.active.values()].map(job => this.stopJob(job, 'interrupted')));
    await Promise.allSettled([...this.batches.values()]);
  }
}
