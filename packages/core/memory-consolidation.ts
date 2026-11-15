import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { HarnessError } from '../contracts/index.ts';
import {
  PROJECT_MEMORY_LIMITS, memoryItemV1Schema, memoryRevisionRefSchema, memoryScopeSchema, memorySourceRefV1Schema, memoryTextSchema, memoryTombstoneV1Schema,
  type MemoryAccess, type MemoryItemV1, type MemoryRevisionRef, type MemorySourceRefV1, type MemorySourceSnapshot, type MemoryTombstoneV1,
} from '../contracts/project-memory.ts';
import { digest, type Store } from '../storage/store.ts';
import { memoryContainsSecret } from './memory-publication.ts';

const identity = z.string().min(1).max(200).regex(/^[a-zA-Z0-9:_.-]+$/);
const accessSchema = z.strictObject({ profileId: identity, ...memoryScopeSchema.shape });
const sourceLimit = PROJECT_MEMORY_LIMITS.sourceBytes;
const tokenUsageSchema = z.strictObject({ inputTokens: z.number().int().nonnegative().nullable().optional(), outputTokens: z.number().int().nonnegative().nullable().optional(), cost: z.number().nonnegative().finite().nullable().optional() });
const providerOutputSchema = z.strictObject({ refs: z.array(memoryRevisionRefSchema).max(PROJECT_MEMORY_LIMITS.items), usage: tokenUsageSchema.optional() });
const fail = (message: string, code = 'INVALID_MEMORY_CONSOLIDATION'): never => { throw new HarnessError(code, message); };
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const refOrder = (a: MemoryRevisionRef, b: MemoryRevisionRef) => order(a.itemId, b.itemId) || a.revision - b.revision;
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
function within(value: unknown, limit: number, label: string): number {
  let size: number;
  try { size = bytes(value); } catch { return fail(`${label} is not a JSON value.`); }
  if (size > limit) return fail(`${label} exceeds its byte limit.`, 'MEMORY_AUXILIARY_LIMIT');
  return size;
}

/** A host-admitted, current source cut. The callback must remain synchronous. */
export interface MemoryConsolidationSnapshot {
  access: MemoryAccess;
  items: readonly MemoryItemV1[];
  watermark: number;
  tombstones: readonly MemoryTombstoneV1[];
}
export interface MemoryDerivedIndex {
  id: string;
  projectIdentity: string;
  profileId: string;
  projectId: string;
  accountId: string | null;
  refs: MemoryRevisionRef[];
  inputDigest: string;
  outputDigest: string;
  watermark: number;
  valid: boolean;
}
export interface MemoryAuxiliaryUsage {
  modelCalls: number;
  inputBytes: number;
  outputBytes: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cost: number | null;
}
export interface MemoryAuxiliaryRecord {
  id: string;
  phase: 'CONSOLIDATION';
  profileId: string;
  projectId: string;
  projectIdentity: string;
  accountId: string | null;
  providerId: string | null;
  status: MemoryConsolidationResult['status'] | 'FAILED';
  settled: boolean;
  startedAt: string;
  finishedAt: string | null;
  usage: MemoryAuxiliaryUsage;
}
export interface MemoryConsolidationInput {
  access: MemoryAccess;
  inputDigest: string;
  watermark: number;
  acceptedRefs: MemoryRevisionRef[];
  changedItems: MemoryItemV1[];
  authority: 'QUOTED_EVIDENCE_ONLY';
}
export interface MemoryConsolidationProvider {
  id: string;
  run(input: MemoryConsolidationInput, signal: AbortSignal): Promise<{ refs: MemoryRevisionRef[]; usage?: z.infer<typeof tokenUsageSchema> }>;
}
export interface MemoryConsolidationHooks {
  snapshot(access: MemoryAccess): MemoryConsolidationSnapshot;
  provider?: MemoryConsolidationProvider;
  now?: () => number;
  leaseMs?: number;
  timeoutMs?: number;
  maxPending?: number;
}
export interface MemoryConsolidationResult {
  status: 'UPDATED' | 'UNCHANGED' | 'BUSY' | 'STALE' | 'CANCELLED' | 'TIMEOUT';
  index?: MemoryDerivedIndex;
  usage: MemoryAuxiliaryUsage;
}
interface Lease { id: string; token: string; expiresAt: number; inputDigest: string; watermark: number }
interface Pending { token: string; cancelled: boolean; stopReason?: 'CANCELLED' | 'TIMEOUT'; controller: AbortController }
const pendingByStore = new WeakMap<Store, Map<string, Pending>>();
const emptyUsage = (): MemoryAuxiliaryUsage => ({ modelCalls: 0, inputBytes: 0, outputBytes: 0, inputTokens: null, outputTokens: null, cost: null });
const scope = ({ profileId, projectId, projectIdentity, accountId }: Pick<MemoryAccess, 'profileId' | 'projectId' | 'projectIdentity' | 'accountId'>) => ({ profileId, projectId, projectIdentity, accountId });

function checkedSnapshot(raw: MemoryConsolidationSnapshot, wanted: MemoryAccess, now: number) {
  const admitted = accessSchema.safeParse(raw?.access);
  if (!admitted.success || digest(admitted.data) !== digest(wanted)) return fail('The admitted memory owner changed.', 'MEMORY_SCOPE_CHANGED');
  if (!Number.isSafeInteger(raw.watermark) || raw.watermark < 0 || !Array.isArray(raw.items) || raw.items.length > PROJECT_MEMORY_LIMITS.items || !Array.isArray(raw.tombstones) || raw.tombstones.length > PROJECT_MEMORY_LIMITS.items) return fail('The memory source cut is invalid.');
  const tombstones = raw.tombstones.map(value => memoryTombstoneV1Schema.parse(value));
  if (tombstones.some(value => value.projectIdentity !== wanted.projectIdentity)) return fail('The tombstone scope changed.', 'MEMORY_SCOPE_CHANGED');
  const deleted = new Set(tombstones.map(value => value.itemId)), excludedSources = new Set(tombstones.flatMap(value => value.sourceExclusions.map(ref => ref.digest)));
  const parsed = raw.items.map(value => memoryItemV1Schema.parse(value));
  if (parsed.some(value => value.projectIdentity !== wanted.projectIdentity)) return fail('The memory project changed.', 'MEMORY_SCOPE_CHANGED');
  if (new Set(parsed.map(value => value.id)).size !== parsed.length) return fail('A current memory source cut contains duplicate item identities.');
  const items = parsed.filter(value => value.state === 'ACCEPTED' && value.scope === 'PROJECT' && (!value.expiresAt || Date.parse(value.expiresAt) > now) && !deleted.has(value.id) && !value.sourceRefs.some(ref => excludedSources.has(ref.digest))).sort((a, b) => order(a.id, b.id));
  if (items.some(value => memoryContainsSecret(value.text))) return fail('Memory must omit credentials.', 'INVALID_MEMORY_SECRET');
  const refs = items.map(value => ({ itemId: value.id, revision: value.revision }));
  return { access: admitted.data, items, refs, watermark: raw.watermark, inputDigest: digest({ owner: scope(wanted), items }) };
}
function verifiedOutput(output: unknown, acceptedRefs: MemoryRevisionRef[]) {
  const parsed = providerOutputSchema.safeParse(output);
  if (!parsed.success) return fail('Consolidation must return only bounded revision references and usage.');
  const refs = parsed.data.refs.sort(refOrder);
  if (digest(refs) !== digest(acceptedRefs)) return fail('Consolidation cannot invent, omit or duplicate accepted revision references.');
  return { refs, usage: parsed.data.usage };
}

/** Host-owned reference consolidation. No provider or runtime is created here. */
export class MemoryConsolidator {
  private readonly now: () => number;
  private readonly leaseMs: number;
  private readonly timeoutMs: number;
  private readonly maxPending: number;
  constructor(private readonly store: Store, private readonly hooks: MemoryConsolidationHooks) {
    this.now = hooks.now ?? Date.now; this.leaseMs = hooks.leaseMs ?? 60_000; this.timeoutMs = hooks.timeoutMs ?? 30_000; this.maxPending = hooks.maxPending ?? 4;
    if (![this.leaseMs, this.timeoutMs, this.maxPending].every(value => Number.isSafeInteger(value) && value > 0) || this.leaseMs > 300_000 || this.timeoutMs > 300_000 || this.maxPending > 16) fail('Choose bounded consolidation limits.');
    if (hooks.provider) identity.parse(hooks.provider.id);
  }
  async consolidate(rawAccess: MemoryAccess, options: { signal?: AbortSignal } = {}): Promise<MemoryConsolidationResult> {
    const access = accessSchema.parse(rawAccess), usage = emptyUsage();
    if (options.signal?.aborted) return { status: 'CANCELLED', usage };
    const key = digest(scope(access)), indexId = 'memory-index:' + key, leaseId = 'memory-consolidation:' + key;
    let pending = pendingByStore.get(this.store);
    if (!pending) { pending = new Map(); pendingByStore.set(this.store, pending); }
    if (pending.has(key) || pending.size >= this.maxPending) return { status: 'BUSY', usage };
    const captured = checkedSnapshot(this.hooks.snapshot(access), access, this.now());
    const old = this.store.get<MemoryDerivedIndex>('projectMemoryDerived', indexId);
    const outputDigest = digest(captured.refs);
    if (old && old.inputDigest === captured.inputDigest && old.outputDigest === outputDigest && digest(old.refs) === outputDigest && digest(scope(old)) === key) {
      const index = { ...old, watermark: captured.watermark, valid: true };
      const accepted = this.store.internal('memory.consolidation.unchanged', null, () => {
        const current = checkedSnapshot(this.hooks.snapshot(access), access, this.now());
        if (current.inputDigest !== captured.inputDigest || current.watermark !== captured.watermark) return false;
        this.store.put('projectMemoryDerived', index.id, null, index); return true;
      });
      return accepted ? { status: 'UNCHANGED', index, usage } : { status: 'STALE', usage };
    }
    const lease: Lease = { id: leaseId, token: randomUUID(), expiresAt: this.now() + this.leaseMs, inputDigest: captured.inputDigest, watermark: captured.watermark };
    const reserved = this.store.internal('memory.consolidation.reserved', null, () => {
      const previous = this.store.get<Lease>('projectMemoryLease', leaseId);
      if (previous && previous.expiresAt > this.now()) return false;
      const current = checkedSnapshot(this.hooks.snapshot(access), access, this.now());
      if (current.inputDigest !== captured.inputDigest || current.watermark !== captured.watermark) return false;
      this.store.put('projectMemoryLease', leaseId, null, lease); return true;
    });
    if (!reserved) return { status: 'BUSY', usage };
    const owner: Pending = { token: lease.token, cancelled: false, controller: new AbortController() };
    pending.set(key, owner);
    const oldRefs = new Set((old?.refs ?? []).map(ref => `${ref.itemId}@${ref.revision}`));
    const input: MemoryConsolidationInput = { access: structuredClone(access), inputDigest: captured.inputDigest, watermark: captured.watermark, acceptedRefs: structuredClone(captured.refs), changedItems: captured.items.filter(value => !oldRefs.has(`${value.id}@${value.revision}`)), authority: 'QUOTED_EVIDENCE_ONLY' };
    const startedAt = new Date(this.now()).toISOString();
    const usageRecord = (status: MemoryAuxiliaryRecord['status'], settled: boolean): MemoryAuxiliaryRecord => ({
      id: lease.token, phase: 'CONSOLIDATION', ...scope(access), providerId: this.hooks.provider?.id ?? null,
      status: owner.stopReason ?? status, settled, startedAt, finishedAt: settled ? new Date(this.now()).toISOString() : null, usage: { ...usage },
    });
    let timer: ReturnType<typeof setTimeout> | undefined, removeAbort = () => {};
    const detach = () => { if (timer) { clearTimeout(timer); timer = undefined; } removeAbort(); removeAbort = () => {}; };
    const release = (status: MemoryAuxiliaryRecord['status']) => {
      detach();
      if (pending!.get(key) === owner) pending!.delete(key);
      if (!this.store.db.isOpen) return;
      this.store.internal('memory.consolidation.released', null, () => {
        this.store.put('projectMemoryAuxiliaryUsage', lease.token, null, usageRecord(status, true));
        if (this.store.get<Lease>('projectMemoryLease', leaseId)?.token === lease.token) this.store.remove('projectMemoryLease', leaseId);
      });
    };
    const work = Promise.resolve().then(async (): Promise<MemoryConsolidationResult> => {
      if (owner.cancelled) return { status: 'CANCELLED', usage: { ...usage } };
      let raw: unknown;
      if (this.hooks.provider) {
        usage.inputBytes = within(input, sourceLimit, 'Consolidation input'); usage.modelCalls = 1;
        raw = await this.hooks.provider.run(structuredClone(input), owner.controller.signal);
        const recorded = tokenUsageSchema.safeParse(raw && typeof raw === 'object' ? (raw as { usage?: unknown }).usage ?? {} : {});
        if (recorded.success) { usage.inputTokens = recorded.data.inputTokens ?? null; usage.outputTokens = recorded.data.outputTokens ?? null; usage.cost = recorded.data.cost ?? null; }
        usage.outputBytes = within(raw, sourceLimit, 'Consolidation output');
      } else { raw = { refs: captured.refs }; usage.inputBytes = bytes(captured.refs); usage.outputBytes = bytes(raw); }
      const output = verifiedOutput(raw, captured.refs);
      usage.inputTokens = output.usage?.inputTokens ?? null; usage.outputTokens = output.usage?.outputTokens ?? null; usage.cost = output.usage?.cost ?? null;
      if (owner.cancelled) return { status: 'CANCELLED', usage: { ...usage } };
      const index: MemoryDerivedIndex = { id: indexId, ...scope(access), refs: output.refs, inputDigest: captured.inputDigest, outputDigest: digest(output.refs), watermark: captured.watermark, valid: true };
      let published = false;
      try {
        published = this.store.internal('memory.consolidation.published', null, () => {
          const currentLease = this.store.get<Lease>('projectMemoryLease', leaseId);
          if (owner.cancelled || currentLease?.token !== lease.token || currentLease.expiresAt <= this.now()) return false;
          const current = checkedSnapshot(this.hooks.snapshot(access), access, this.now());
          if (current.watermark !== captured.watermark || current.inputDigest !== captured.inputDigest) return false;
          this.store.put('projectMemoryDerived', index.id, null, index);
          return true;
        }) === true;
      } catch (error) { if (!(error instanceof HarnessError) || error.code !== 'MEMORY_SCOPE_CHANGED') throw error; }
      return published ? { status: 'UPDATED', index, usage: { ...usage } } : { status: 'STALE', usage: { ...usage } };
    });
    // A deadline revokes publication, not the underlying provider. Occupancy and
    // its lease stay held until the actual call settles, even across instances.
    const settled = work.then(value => { release(value.status); return value; }, error => { release('FAILED'); throw error; });
    const stopped = new Promise<MemoryConsolidationResult>(resolve => {
      const stop = (status: 'CANCELLED' | 'TIMEOUT') => {
        if (owner.cancelled) return;
        owner.cancelled = true; owner.stopReason = status; owner.controller.abort(); detach();
        if (this.store.db.isOpen) this.store.internal('memory.consolidation.pending_cleanup', null, () => this.store.put('projectMemoryAuxiliaryUsage', lease.token, null, usageRecord(status, false)));
        resolve({ status, usage: { ...usage } });
      };
      const abort = () => stop('CANCELLED');
      options.signal?.addEventListener('abort', abort, { once: true });
      removeAbort = () => options.signal?.removeEventListener('abort', abort);
      timer = setTimeout(() => stop('TIMEOUT'), this.timeoutMs); timer.unref?.();
      if (options.signal?.aborted) abort();
    });
    return Promise.race([settled, stopped]);
  }
}

/** Supplied by a host after settlement and source admission, never by a model. */
export interface MemoryExtractionCut {
  access: MemoryAccess;
  settled: boolean;
  sourceRunId: string;
  /** Global captured-source sequence, distinct from consolidation's project watermark. */
  watermark: number;
  authorizedThreadIds: string[];
  sources: MemorySourceSnapshot[];
  explicitPreferenceRefs?: MemorySourceRefV1[];
  tombstones?: MemoryTombstoneV1[];
}
export interface MemoryExtractionOptions {
  assertedBy: string;
  observedAt: string;
  /** Known upstream spend only. This validator itself never calls a model. */
  usage?: { modelCalls: number; inputTokens?: number | null; outputTokens?: number | null; cost?: number | null };
}
export interface MemoryExtractionResult {
  sourceRunId: string;
  watermark: number;
  items: MemoryItemV1[];
  unresolvedWork: { text: string; sourceRefs: MemorySourceRefV1[] }[];
  usage: MemoryAuxiliaryUsage;
}
const extractionCutSchema = z.strictObject({
  access: accessSchema, settled: z.boolean(), sourceRunId: identity, watermark: z.number().int().nonnegative(),
  authorizedThreadIds: z.array(identity).min(1).max(200),
  sources: z.array(z.strictObject({ ref: memorySourceRefV1Schema, projectIdentity: memoryItemV1Schema.shape.projectIdentity, accountId: identity.nullable(), content: z.string().max(sourceLimit), label: z.string().max(1024) })).max(PROJECT_MEMORY_LIMITS.sources),
  explicitPreferenceRefs: z.array(memorySourceRefV1Schema).max(PROJECT_MEMORY_LIMITS.sources).optional(),
  tombstones: z.array(memoryTombstoneV1Schema).max(PROJECT_MEMORY_LIMITS.items).optional(),
});
const extractionCandidatesSchema = z.array(z.strictObject({
  kind: z.enum(['DECISION', 'CONSTRAINT', 'PROCEDURE', 'FACT', 'PREFERENCE', 'UNRESOLVED_WORK']),
  text: memoryTextSchema.refine(value => value.trim().length > 0),
  sourceRefs: z.array(memorySourceRefV1Schema).min(1).max(8),
  scope: z.literal('PROJECT').optional(), state: z.literal('PROPOSED').optional(),
  expiresAt: z.iso.datetime().nullable().optional(), sensitivity: z.enum(['NORMAL', 'SENSITIVE']).optional(),
})).max(16);

/** Validates supplied candidate data. It cannot execute tools or publish records. */
export function validateMemoryExtraction(rawCut: MemoryExtractionCut, candidates: unknown, options: MemoryExtractionOptions): MemoryExtractionResult {
  const inputBytes = within(rawCut, sourceLimit, 'Extraction source cut'), outputBytes = within(candidates, sourceLimit, 'Extraction output');
  if (memoryContainsSecret(JSON.stringify(rawCut)) || memoryContainsSecret(JSON.stringify(candidates))) return fail('Memory extraction must omit credentials.', 'INVALID_MEMORY_SECRET');
  const checked = extractionCutSchema.safeParse(rawCut);
  if (!checked.success) return fail('The extraction source cut is invalid.', 'INVALID_MEMORY_SOURCE');
  const cut = checked.data;
  if (!cut.settled) return fail('Memory extraction requires a settled source task.', 'MEMORY_SOURCE_UNSETTLED');
  const parsed = extractionCandidatesSchema.safeParse(candidates);
  if (!parsed.success) return fail('Extraction accepts at most sixteen bounded proposals without actions or approval.', 'INVALID_MEMORY_EXTRACTION');
  const author = identity.parse(options.assertedBy), observedAt = z.iso.datetime().parse(options.observedAt);
  const spend = options.usage === undefined ? undefined : tokenUsageSchema.extend({ modelCalls: z.number().int().nonnegative().max(16) }).parse(options.usage);
  const authorized = new Set(cut.authorizedThreadIds), sources = new Map<string, MemorySourceSnapshot>();
  const tombstones = cut.tombstones ?? [];
  if (tombstones.some(value => value.projectIdentity !== cut.access.projectIdentity)) return fail('The deletion source scope changed.', 'INVALID_MEMORY_SOURCE');
  const excludedSources = new Set(tombstones.flatMap(value => value.sourceExclusions.map(ref => ref.digest)));
  for (const value of cut.sources) {
    const ref = value.ref, key = digest(ref);
    if (value.projectIdentity !== cut.access.projectIdentity || value.accountId !== cut.access.accountId || !authorized.has(ref.ownerThreadId) || ref.capturedSeq > cut.watermark || createHash('sha256').update(value.content, 'utf8').digest('hex') !== ref.digest || sources.has(key) || excludedSources.has(ref.digest)) return fail('A memory source is unavailable, changed or outside the approved cut.', 'INVALID_MEMORY_SOURCE');
    sources.set(key, value);
  }
  const explicit = new Set((cut.explicitPreferenceRefs ?? []).map(ref => digest(ref)));
  if ([...explicit].some(key => !sources.has(key))) return fail('Reusable preference evidence must belong to the approved cut.', 'INVALID_MEMORY_SOURCE');
  const result: MemoryExtractionResult = {
    sourceRunId: cut.sourceRunId, watermark: cut.watermark, items: [], unresolvedWork: [],
    usage: { modelCalls: spend?.modelCalls ?? 0, inputBytes, outputBytes, inputTokens: spend?.inputTokens ?? null, outputTokens: spend?.outputTokens ?? null, cost: spend?.cost ?? null },
  };
  for (const value of parsed.data) {
    const keys = value.sourceRefs.map(ref => digest(ref));
    if (new Set(keys).size !== keys.length || keys.some(key => !sources.has(key))) return fail('A proposed reference is not an exact authorized source revision.', 'INVALID_MEMORY_SOURCE');
    if (value.kind === 'PREFERENCE' && !keys.some(key => explicit.has(key))) return fail('Reusable preferences require an explicit user source decision.', 'MEMORY_PREFERENCE_CONFIRMATION_REQUIRED');
    if (value.expiresAt && Date.parse(value.expiresAt) <= Date.parse(observedAt)) return fail('A new proposal must not already be expired.', 'INVALID_MEMORY_EXTRACTION');
    if (value.kind === 'UNRESOLVED_WORK') { result.unresolvedWork.push({ text: value.text, sourceRefs: structuredClone(value.sourceRefs) }); continue; }
    result.items.push(memoryItemV1Schema.parse({
      id: randomUUID(), projectIdentity: cut.access.projectIdentity, scope: 'PROJECT', kind: value.kind,
      text: value.text, revision: 1, state: 'PROPOSED', sourceRefs: value.sourceRefs,
      assertedBy: { kind: 'AGENT', id: author }, observedAt, expiresAt: value.expiresAt ?? null,
      supersedes: [], sensitivity: value.sensitivity ?? 'NORMAL', reviewDecision: null,
    }));
  }
  return result;
}

export interface MemoryCheckpointCapability { adapterId: string; apiVersion: number; hostOwned: boolean }
export interface MemoryCheckpointV1 {
  version: 1;
  id: string;
  adapterId: string;
  projectIdentity: string;
  projectId: string;
  profileId: string;
  accountId: string | null;
  threadId: string;
  bindingDigest: string;
  watermark: number;
  capturedAt: string;
  inputDigest: string;
  refs: MemoryRevisionRef[];
  constraints: { itemId: string; revision: number; kind: 'CONSTRAINT' | 'DECISION'; text: string; sourceRefs: MemorySourceRefV1[] }[];
  digest: string;
}
export interface MemoryCheckpointHooks<T> {
  access: MemoryAccess;
  snapshot(access: MemoryAccess): MemoryConsolidationSnapshot;
  capability: MemoryCheckpointCapability | null;
  required: boolean;
  /** Must durably save the packet, register its refs for Forget invalidation,
   * and return {id, persisted:true, digest}. No existing native adapter does so. */
  persist(checkpoint: MemoryCheckpointV1): unknown | Promise<unknown>;
  compact(): T | Promise<T>;
  now?: () => number;
  signal?: AbortSignal;
}
const checkpointCapabilitySchema = z.strictObject({ adapterId: identity, apiVersion: z.literal(2), hostOwned: z.literal(true) });
const checkpointReceiptSchema = z.strictObject({ id: identity, persisted: z.literal(true), digest: z.string().regex(/^[a-f0-9]{64}$/) });

/** A capability gate only. Production adapters remain unchanged and disabled. */
export async function checkpointBeforeCompaction<T>(hooks: MemoryCheckpointHooks<T>): Promise<{ checkpoint: MemoryCheckpointV1 | null; result: T }> {
  const active = () => { if (hooks.signal?.aborted) fail('Memory checkpointing was cancelled.', 'MEMORY_CHECKPOINT_CANCELLED'); };
  active();
  const capability = checkpointCapabilitySchema.safeParse(hooks.capability);
  if (!capability.success) {
    if (hooks.required !== false) return fail('The adapter has no verified host checkpoint API v2.', 'MEMORY_CHECKPOINT_UNSUPPORTED');
    return { checkpoint: null, result: await hooks.compact() };
  }
  const access = accessSchema.parse(hooks.access), now = hooks.now ?? Date.now;
  const captured = checkedSnapshot(hooks.snapshot(access), access, now());
  const constraints = captured.items.filter((value): value is MemoryItemV1 & { kind: 'CONSTRAINT' | 'DECISION' } => value.kind === 'CONSTRAINT' || value.kind === 'DECISION').map(({ id, revision, kind, text, sourceRefs }) => ({ itemId: id, revision, kind, text, sourceRefs }));
  const body = {
    version: 1 as const, id: 'memory-checkpoint:' + randomUUID(), adapterId: capability.data.adapterId,
    ...scope(access), threadId: access.threadId, bindingDigest: access.bindingDigest,
    watermark: captured.watermark, capturedAt: new Date(now()).toISOString(), inputDigest: captured.inputDigest,
    refs: constraints.map(({ itemId, revision }) => ({ itemId, revision })), constraints,
  };
  const checkpoint: MemoryCheckpointV1 = { ...body, digest: digest(body) };
  within(checkpoint, sourceLimit, 'Required memory checkpoint'); active();
  let receipt: unknown;
  try { receipt = await hooks.persist(structuredClone(checkpoint)); }
  catch { return fail('The required memory checkpoint could not be saved. History was not compacted.', 'MEMORY_CHECKPOINT_FAILED'); }
  const saved = checkpointReceiptSchema.safeParse(receipt);
  if (!saved.success || saved.data.id !== checkpoint.id || saved.data.digest !== checkpoint.digest) return fail('Durable checkpoint acknowledgement did not match the saved source cut.', 'MEMORY_CHECKPOINT_FAILED');
  active();
  try {
    const current = checkedSnapshot(hooks.snapshot(access), access, now());
    if (current.inputDigest !== captured.inputDigest || current.watermark !== captured.watermark) return fail('Memory changed during checkpoint persistence. Retry with the current source cut.', 'MEMORY_CHECKPOINT_STALE');
  } catch (error) {
    if (error instanceof HarnessError && error.code === 'MEMORY_CHECKPOINT_STALE') throw error;
    return fail('The memory owner or accepted source cut changed before compaction.', 'MEMORY_CHECKPOINT_STALE');
  }
  return { checkpoint, result: await hooks.compact() };
}
