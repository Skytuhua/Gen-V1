import { HarnessError, type RuntimeAdapter, type RuntimeEvent, type RunContext, type StartRun, type Thread } from '../contracts/index.ts';
import type { MemoryCheckpointRequestV1, MemoryCheckpointAckV1, MemoryCheckpointRequirementV1 } from '../contracts/memory-checkpoint.ts';
import type { RequestPreparationV1 } from '../contracts/request-context.ts';
import { PROJECT_MEMORY_LIMITS, memoryPreparedRequestSchema, memoryScope, type MemoryAccess, type MemoryAction, type MemoryPreparedRequest, type MemoryRecallResult, type MemoryRecallV1, type MemoryScope, type StoredMemory } from '../contracts/project-memory.ts';
import { Store, digest } from '../storage/store.ts';
import { ProjectMemory } from './project-memory.ts';
import { MemoryRequestSnapshots } from './memory-retrieval.ts';
import { MemoryExtractionCoordinator, type MemoryExtractionAdmission, type MemoryExtractionJob } from './memory-extraction.ts';
import { MemoryConsolidator, checkpointBeforeCompaction } from './memory-consolidation.ts';
import { SUPPLEMENTAL_EVIDENCE_HEADER, frameRequestSupplementalSources, requestPromptDigest, type RequestPreparationRelease, type RequestSupplementalSource } from './request-custody.ts';

interface Prepared {
  preparation: RequestPreparationV1;
  query: string;
  state: 'OFF' | 'DEFERRED' | 'READY' | 'REVOKED';
  access?: MemoryAccess;
  result?: MemoryRecallResult;
  latencyMs: number;
}
interface Captured {
  profileId: string; projectId: string; projectIdentity: string; accountId: string | null;
  threadId: string; runId: string; epoch: number; inputId: string;
  requestId: string; contextGeneration: number; recall: MemoryRecallV1;
  injectedBytes: number; latencyMs: number; expiresAt: string; accepted: boolean;
}
interface Scheduled { id: string; source: RunContext; modelId: string; thinkingLevel: string | null; access: MemoryAccess; controller: AbortController; work?: Promise<void> }
export interface ProjectMemoryHostOptions {
  memory?: ProjectMemory;
  extractionFactory?: (job: Readonly<MemoryExtractionJob>) => RuntimeAdapter | Promise<RuntimeAdapter>;
  extractionAdmission?: MemoryExtractionAdmission;
  canExtract?: () => boolean;
  beforeExtract?: () => Promise<void>;
}
function denied(message: string, code = 'MEMORY_REQUEST_CHANGED'): never { throw new HarnessError(code, message); }
const sameScope = (a: MemoryAccess, b: MemoryAccess) => a.profileId === b.profileId && a.projectId === b.projectId && a.projectIdentity === b.projectIdentity && a.threadId === b.threadId && a.accountId === b.accountId;
const boundedQuery = (prompt: string) => {
  let result = Buffer.from(prompt, 'utf8').subarray(0, 4096).toString('utf8');
  while (Buffer.byteLength(result) > 4096) result = result.slice(0, -1);
  return result;
};

/** Production host custody. Requests retain references; only the memory store retains source text. */
export class ProjectMemoryHost {
  readonly memory: ProjectMemory;
  private readonly snapshots = new MemoryRequestSnapshots();
  private readonly prepared = new Map<string, Prepared>();
  private readonly schedules = new Map<string, Scheduled>();
  private readonly extractor: MemoryExtractionCoordinator;
  private readonly consolidator: MemoryConsolidator;
  private closed = false;
  constructor(private readonly store: Store, private readonly options: ProjectMemoryHostOptions = {}) {
    this.memory = options.memory ?? new ProjectMemory(store);
    this.extractor = new MemoryExtractionCoordinator(store, this.memory, {admit: options.extractionAdmission, factory: job => {
      if (!options.extractionFactory) throw new HarnessError('MEMORY_EXTRACTION_UNAVAILABLE', 'This host has no ephemeral extraction runtime.');
      return options.extractionFactory(job);
    }});
    this.consolidator = new MemoryConsolidator(store, {snapshot: access => this.memory.consolidationSnapshot(access)});
  }
  get busy(): boolean { return this.schedules.size > 0 || this.extractor.busy; }
  private thread(id: string): Thread { const thread = this.store.get<Thread>('thread', id); if (!thread) return denied('The memory request owner is unavailable.', 'CAPABILITY_DENIED'); return thread; }
  private eligible(thread: Thread): boolean { return !!thread.projectId && !thread.sideParentId && !['side', 'delegate'].includes(thread.kind ?? '') && !this.store.get('archivedThread', thread.id); }
  private capture(entry: Prepared, access: MemoryAccess, started: number): void {
    if (this.closed || this.prepared.get(entry.preparation.requestId) !== entry || entry.state === 'REVOKED') denied('The memory preparation owner was released.', 'CANCELLED_RUN');
    const candidates = this.memory.accepted(access), tombstones = this.memory.tombstones(access);
    entry.access = structuredClone(access);
    entry.result = this.snapshots.prepare({access, requestId: entry.preparation.requestId, contextGeneration: entry.preparation.contextGeneration, query: entry.query,
      candidates, tombstones, sourceAvailable: ref => this.memory.sourceAvailable(access, ref),
      budgetBytes: PROJECT_MEMORY_LIMITS.recallBytes - Buffer.byteLength(SUPPLEMENTAL_EVIDENCE_HEADER),
      deadlineMs: Math.max(0, Math.floor(PROJECT_MEMORY_LIMITS.foregroundMs - (performance.now() - started)))});
    entry.latencyMs = performance.now() - started; entry.state = 'READY';
  }
  async prepare(preparation: RequestPreparationV1, prompt: string): Promise<void> {
    if (this.closed) denied('The memory host has closed.', 'CANCELLED_RUN');
    if (this.prepared.size >= 128) denied('The memory preparation capacity is full.', 'MEMORY_REQUEST_LIMIT');
    const started = performance.now(), entry: Prepared = {preparation, query: boundedQuery(prompt), state: 'OFF', latencyMs: 0};
    this.prepared.set(preparation.requestId, entry);
    const thread = this.thread(preparation.threadId);
    if (!this.eligible(thread) || thread.projectId !== preparation.projectId) return;
    const access = await this.memory.access(thread.projectId!, thread.id);
    if (this.closed || this.prepared.get(preparation.requestId) !== entry) denied('The memory preparation owner was released.', 'CANCELLED_RUN');
    // A preview never manufactures authority by replacing the thread account.
    // The admitted dispatch can capture this same generation after first binding.
    if (thread.modelId !== preparation.modelId || access.accountId !== preparation.accountId) {entry.state = 'DEFERRED'; return;}
    if (this.memory.isEnabled(access)) this.capture(entry, access, started);
  }
  private sources(result: MemoryRecallResult): RequestSupplementalSource[] {
    return result.injection ? [{id: 'project-memory:' + result.recall.requestId, revision: result.recall.contextGeneration, category: 'MEMORY', text: result.injection,
      contentRef: 'sha256:' + requestPromptDigest(result.injection), inclusionReason: 'Accepted project evidence with exact source revisions; not instructions or approval.'}] : [];
  }
  private view(entry: Prepared): MemoryPreparedRequest | null {
    if (!entry.result || !entry.access || entry.state !== 'READY') return null;
    const injectedBytes = frameRequestSupplementalSources(this.sources(entry.result)).reduce((sum, source) => sum + Buffer.byteLength(source.text), 0);
    return memoryPreparedRequestSchema.parse({scope: memoryScope(entry.access), requestId: entry.preparation.requestId, contextGeneration: entry.preparation.contextGeneration, phase: 'PREPARING',
      recall: {...entry.result.recall, budgetBytes: PROJECT_MEMORY_LIMITS.recallBytes}, items: entry.result.items, injectedBytes, expiresAt: new Date(entry.preparation.expiresAt).toISOString()});
  }
  preparedView(preparation: RequestPreparationV1): MemoryPreparedRequest | null {
    const entry = this.prepared.get(preparation.requestId);
    if (!entry || digest(entry.preparation) !== digest(preparation)) denied('This memory request has no current preparation.');
    if (entry.state === 'REVOKED') denied('Memory changed after this preparation. Refresh the draft.');
    if (entry.access) this.memory.assertAccess(entry.access);
    return this.view(entry);
  }
  exclude(preparation: RequestPreparationV1, input: {scope: MemoryScope; contextGeneration: number; itemId: string; revision: number}): MemoryPreparedRequest {
    const entry = this.prepared.get(preparation.requestId), view = this.preparedView(preparation);
    if (!entry?.access || !view || digest(view.scope) !== digest(input.scope) || input.contextGeneration !== preparation.contextGeneration || !view.items.some(item => item.id === input.itemId && item.revision === input.revision)) denied('This exclusion does not match the exact prepared revision.', 'CAPABILITY_DENIED');
    entry.result = this.snapshots.exclude(entry.access, preparation.requestId, input.itemId);
    return this.view(entry)!;
  }
  private assertSelection(entry: Prepared, access: MemoryAccess): void {
    if (this.closed || entry.state !== 'READY' || !entry.access || !entry.result || !sameScope(entry.access, access) || !this.memory.isEnabled(access)) denied('Prepared memory lost its owner or project consent.');
    const current = new Map(this.memory.accepted(access).map(row => [row.item.id, row.item]));
    for (const item of entry.result.items) if (digest(current.get(item.id)) !== digest(item)) denied('A selected memory revision or its source changed. Refresh the draft.');
  }
  async finalize(preparation: RequestPreparationV1, input: Readonly<StartRun>): Promise<{sources: readonly RequestSupplementalSource[]; assertCurrent?: () => void}> {
    const entry = this.prepared.get(preparation.requestId);
    if (!entry) return {sources: []};
    if (entry.state === 'REVOKED') denied('Memory was changed after preparation. Refresh the draft.');
    if (entry.state === 'OFF') return {sources: []};
    const thread = this.thread(input.threadId);
    if (!this.eligible(thread) || thread.projectId !== preparation.projectId || input.modelId !== preparation.modelId || (input.accountId ?? null) !== preparation.accountId) denied('The admitted memory owner changed.');
    const started = performance.now(), access = await this.memory.access(thread.projectId!, thread.id);
    if (entry.state === 'DEFERRED') {
      if (!this.memory.isEnabled(access)) return {sources: []};
      this.capture(entry, access, started);
    }
    this.assertSelection(entry, access);
    const result = this.snapshots.finalize(entry.access!, preparation.requestId), view = this.view(entry)!;
    const record: Captured = {...access, runId: input.runId, epoch: input.epoch, inputId: input.inputId, requestId: preparation.requestId, contextGeneration: preparation.contextGeneration,
      // Matched terms can contain forgotten memory words or private draft text.
      // Only the ephemeral preview retains them. Saved receipts keep counts,
      // revision identities and hashes; authorized revisions supply detail.
      recall: {...view.recall, scores: view.recall.scores.map(score => ({...score, matchedTerms: []}))},
      injectedBytes: view.injectedBytes, latencyMs: entry.latencyMs, expiresAt: view.expiresAt, accepted: false};
    this.store.internal('project.memory.request.prepared', input.threadId, () => {
      this.assertSelection(entry, access); this.store.put('projectMemoryPreparedReceipt', record.requestId, input.threadId, record);
      this.store.db.prepare("DELETE FROM entities WHERE kind='projectMemoryPreparedReceipt' AND rowid NOT IN (SELECT rowid FROM entities WHERE kind='projectMemoryPreparedReceipt' ORDER BY rowid DESC LIMIT 128)").run();
      return {requestId: record.requestId, contextGeneration: record.contextGeneration, inputId: record.inputId, injectedBytes: record.injectedBytes};
    });
    return {sources: this.sources(result), assertCurrent: () => this.assertSelection(entry, access)};
  }
  released(preparation: RequestPreparationV1, _reason: RequestPreparationRelease): void {
    const entry = this.prepared.get(preparation.requestId);
    if (entry?.access) this.snapshots.release(entry.access, preparation.requestId);
    this.prepared.delete(preparation.requestId);
  }
  /** Called only after Service accepted this exact native input event. */
  acceptedInput(event: RuntimeEvent): void {
    if (!Array.isArray(event.inputIds)) return;
    const thread = this.thread(event.threadId); if (!this.eligible(thread)) return;
    const access = this.memory.currentAccess(thread.projectId!, thread.id);
    const rows = this.store.db.prepare("SELECT body FROM entities WHERE kind='projectMemoryPreparedReceipt' AND thread_id=? AND json_extract(body,'$.runId')=? AND json_extract(body,'$.epoch')=? AND json_extract(body,'$.accepted')=0").all(event.threadId, event.runId, event.epoch) as {body: string}[];
    for (const row of rows) {
      const record = JSON.parse(row.body) as Captured;
      if (!event.inputIds.includes(record.inputId) || record.profileId !== access.profileId || record.projectIdentity !== access.projectIdentity || record.accountId !== access.accountId) continue;
      this.memory.markUsed(access, record.recall); this.memory.recordRequestUsage(access, record.requestId, record.contextGeneration, record.injectedBytes, record.latencyMs);
      this.store.internal('project.memory.request.accepted', thread.id, () => {this.store.put('projectMemoryPreparedReceipt', record.requestId, thread.id, {...record, accepted: true}); return {requestId: record.requestId};});
    }
  }
  async latest(projectId: string, threadId: string): Promise<MemoryPreparedRequest | null> {
    const access = await this.memory.access(projectId, threadId);
    const row = this.store.db.prepare("SELECT body FROM entities WHERE kind='projectMemoryPreparedReceipt' AND thread_id=? AND json_extract(body,'$.accepted')=1 ORDER BY rowid DESC LIMIT 1").get(threadId) as {body: string} | undefined;
    if (!row) return null;
    const record = JSON.parse(row.body) as Captured;
    if (record.profileId !== access.profileId || record.projectId !== projectId || record.projectIdentity !== access.projectIdentity || record.accountId !== access.accountId) return null;
    const tombstones = this.memory.tombstones(access), deleted = new Set(tombstones.map(item => item.itemId));
    const items = record.recall.selectedRevisions.map(ref => this.store.get<StoredMemory>('projectMemoryRevision', ref.itemId + '@' + ref.revision));
    if (items.some(item => !item || item.profileId !== access.profileId || item.projectId !== projectId || item.accountId !== access.accountId || item.item.projectIdentity !== access.projectIdentity || item.item.state !== 'ACCEPTED' || deleted.has(item.item.id) || item.item.sourceRefs.some(ref => !this.memory.sourceAvailable(access, ref)))) return null;
    this.memory.assertAccess(access);
    return memoryPreparedRequestSchema.parse({scope: memoryScope(access), requestId: record.requestId, contextGeneration: record.contextGeneration, phase: 'CAPTURED', recall: record.recall, items: items.map(item => item!.item), injectedBytes: record.injectedBytes, expiresAt: record.expiresAt});
  }
  async requirement(threadId: string): Promise<MemoryCheckpointRequirementV1 | undefined> {
    const thread = this.thread(threadId); if (!this.eligible(thread)) return;
    return this.memory.isEnabled(await this.memory.access(thread.projectId!, thread.id)) ? {apiVersion: 2, required: true} : undefined;
  }
  async checkpoint(request: MemoryCheckpointRequestV1, assertOwner: () => void): Promise<MemoryCheckpointAckV1> {
    const thread = this.thread(request.ctx.threadId), projectId = thread.projectId;
    const active = () => {
      assertOwner(); const current = this.thread(request.ctx.threadId);
      if (!this.eligible(current) || current.projectId !== projectId || request.apiVersion !== 2 || request.modelId !== current.modelId || request.accountId !== (current.accountId ?? null) || request.sessionPath !== current.sessionPath) denied('The checkpoint has no matching admitted project owner.', 'MEMORY_CHECKPOINT_OWNER');
    };
    active(); const access = await this.memory.access(projectId!, thread.id); active();
    if (!this.memory.isEnabled(access)) denied('Project memory checkpoint consent is unavailable.', 'MEMORY_CHECKPOINT_OWNER');
    const result = await checkpointBeforeCompaction({access, snapshot: value => {active(); return this.memory.consolidationSnapshot(value);}, capability: {adapterId: request.adapterId, apiVersion: request.apiVersion, hostOwned: true}, required: true,
      persist: checkpoint => {active(); return this.memory.persistCheckpoint(access, checkpoint);}, compact: () => {active(); return true;}});
    active(); this.memory.assertCheckpointCurrent(access, result.checkpoint!);
    return {apiVersion: 2, requestId: request.requestId, checkpointId: result.checkpoint!.id, digest: result.checkpoint!.digest, persisted: true};
  }
  /** Synchronous metadata admission inside the accepted settled projection. */
  scheduleSettled(source: RunContext): string | null {
    if (this.closed || this.schedules.size >= 4) return null;
    try {
      const thread = this.thread(source.threadId);
      if (!this.eligible(thread) || thread.runId || thread.epoch !== source.epoch || !thread.modelId || !['ready', 'completed'].includes(thread.status)) return null;
      const access = this.memory.currentAccess(thread.projectId!, thread.id);
      if (!this.memory.isEnabled(access) || !this.memory.read(access).sourceThreadIds.includes(thread.id) || this.store.all<{status: string}>('outbox', thread.id).some(input => input.status !== 'handled')) return null;
      const id = 'memory-schedule:' + digest([access.profileId, source.threadId, source.runId, source.epoch]);
      if (this.store.get('projectMemoryAuxiliaryUsage', id)) return null;
      const job: Scheduled = {id, source: {...source}, modelId: thread.modelId, thinkingLevel: thread.thinkingLevel ?? null, access, controller: new AbortController()};
      this.store.put('projectMemoryAuxiliaryUsage', id, thread.id, {id, phase: 'EXTRACTION', profileId: access.profileId, projectIdentity: access.projectIdentity, projectId: access.projectId, accountId: access.accountId, sourceRunId: source.runId,
        status: 'SCHEDULED', settled: false, startedAt: new Date().toISOString(), finishedAt: null, usage: {modelCalls: 0, inputBytes: 0, outputBytes: 0, inputTokens: 0, outputTokens: 0, cost: 0}});
      this.schedules.set(id, job);
      return id;
    } catch {return null;}
  }
  runScheduled(id: string): Promise<void> {
    const job = this.schedules.get(id); if (!job) return Promise.resolve();
    // Install the owner before source cleanup can invoke any callbacks. A
    // duplicate settlement joins this same work, and cancellation drains it.
    return job.work ??= Promise.resolve().then(() => this.executeScheduled(job));
  }
  private async executeScheduled(job: Scheduled): Promise<void> {
    const id = job.id;
    let status = 'CANCELLED';
    try {
      if (this.closed || job.controller.signal.aborted || this.options.canExtract?.() === false) return;
      await this.options.beforeExtract?.();
      if (this.closed || job.controller.signal.aborted || this.options.canExtract?.() === false) return;
      const access = await this.memory.access(job.access.projectId, job.source.threadId);
      if (!sameScope(access, job.access) || access.bindingDigest !== job.access.bindingDigest) return;
      const outcome = await this.extractor.extract({access, source: job.source, modelId: job.modelId, thinkingLevel: job.thinkingLevel, signal: job.controller.signal});
      status = outcome.status;
      if (['PUBLISHED', 'EMPTY', 'UNCHANGED'].includes(status) && !job.controller.signal.aborted) await this.consolidator.consolidate(access, {signal: job.controller.signal});
    } catch {status = 'FAILED';}
    finally {
      this.schedules.delete(id);
      if (this.store.db.isOpen) this.store.internal('project.memory.extraction.scheduled.ended', job.source.threadId, () => {
        const old = this.store.get<Record<string, unknown>>('projectMemoryAuxiliaryUsage', id);
        if (old) this.store.put('projectMemoryAuxiliaryUsage', id, job.source.threadId, {...old, status, settled: true, finishedAt: new Date().toISOString()});
        return {id, status};
      });
    }
  }
  async runSettled(source: RunContext): Promise<void> {
    const job = [...this.schedules.values()].find(job => job.source.threadId === source.threadId && job.source.runId === source.runId && job.source.epoch === source.epoch);
    if (job) await this.runScheduled(job.id);
  }
  async reviewed(access: MemoryAccess, _operation: MemoryAction): Promise<void> {
    for (const entry of this.prepared.values()) if (entry.access && sameScope({...entry.access, threadId: access.threadId}, access)) {
      this.snapshots.release(entry.access, entry.preparation.requestId); entry.result = undefined; entry.query = ''; entry.state = 'REVOKED';
    }
    await this.cancel();
    const current = await this.memory.access(access.projectId, access.threadId);
    if (sameScope(access, current) && this.memory.isEnabled(current)) await this.consolidator.consolidate(current);
  }
  async cancel(): Promise<void> {
    const running: Promise<void>[] = [];
    for (const job of this.schedules.values()) {
      job.controller.abort();
      if (job.work) running.push(job.work);
      else {
        this.schedules.delete(job.id);
        if (this.store.db.isOpen) this.store.internal('project.memory.extraction.scheduled.cancelled', job.source.threadId, () => {
          const old = this.store.get<Record<string, unknown>>('projectMemoryAuxiliaryUsage', job.id);
          if (old) this.store.put('projectMemoryAuxiliaryUsage', job.id, job.source.threadId, {...old, status: 'CANCELLED', settled: true, finishedAt: new Date().toISOString()});
          return {id: job.id};
        });
      }
    }
    await Promise.all([this.extractor.cancel(), ...running]);
  }
  async dispose(): Promise<void> {
    this.closed = true; for (const entry of this.prepared.values()) if (entry.access) this.snapshots.release(entry.access, entry.preparation.requestId);
    this.prepared.clear(); await this.cancel(); await this.extractor.dispose();
  }
}
