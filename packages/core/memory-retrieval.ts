import { sha256Hex } from './hash.ts';
import { HarnessError } from '../contracts/index.ts';
import { memoryContainsSecret } from './memory-publication.ts';
import {
  PROJECT_MEMORY_LIMITS, memoryItemV1Schema, memoryRecallV1Schema, memoryScopeSchema, memoryTombstoneV1Schema,
  type MemoryAccess, type MemoryItemV1, type MemoryRecallResult, type MemoryRecallV1, type MemorySourceRefV1,
  type MemoryTombstoneV1, type StoredMemory,
} from '../contracts/project-memory.ts';

export interface LexicalRecallInput {
  access: MemoryAccess;
  requestId: string;
  contextGeneration: number;
  query: string;
  projectTerms?: string[];
  candidates: StoredMemory[];
  tombstones: MemoryTombstoneV1[];
  sourceAvailable: (ref: MemorySourceRefV1) => boolean;
  excludedIds?: string[];
  budgetBytes?: number;
  now?: number;
  /** Elapsed foreground budget, capped at 750 ms. It is not a wall-clock timestamp. */
  deadlineMs?: number;
}

const MAX_QUERY_BYTES = 4096;
const MAX_TERMS = 32;
const MAX_TOMBSTONE_SOURCES = 4096;
const ID = /^[a-zA-Z0-9:_.-]{1,200}$/;
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const invalid = (message: string): never => { throw new HarnessError('INVALID_MEMORY_RECALL', message); };

function validateAccess(access: MemoryAccess): MemoryAccess {
  if (!access || !ID.test(access.profileId)) invalid('Recall requires a bounded host profile identity.');
  const { profileId, ...scope } = access;
  const parsed = memoryScopeSchema.safeParse(scope);
  if (!parsed.success) invalid('Recall requires the exact admitted project, account and binding scope.');
  return { profileId, ...parsed.data! };
}
function validateRequest(input: Pick<LexicalRecallInput, 'access' | 'requestId' | 'contextGeneration' | 'query'>): MemoryAccess {
  const access = validateAccess(input.access);
  if (!ID.test(input.requestId) || !Number.isSafeInteger(input.contextGeneration) || input.contextGeneration < 0) invalid('A recall request needs a valid request ID and context generation.');
  if (typeof input.query !== 'string' || Buffer.byteLength(input.query, 'utf8') > MAX_QUERY_BYTES) invalid('The recall query exceeds its bounded byte limit.');
  return access;
}
function boundedInteger(value: number, minimum: number, maximum: number, message: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) invalid(message);
  return value;
}
function terms(value: string, cap = MAX_TERMS): string[] {
  return [...new Set(value.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}_$]+(?:[.:/\-][\p{L}\p{N}_$]+)*/gu) ?? [])]
    .filter(term => term.length <= 200).slice(0, cap);
}
function sourceFence(tombstones: MemoryTombstoneV1[], projectIdentity: string): { items: Set<string>; sources: Set<string> } {
  if (!Array.isArray(tombstones) || tombstones.length > PROJECT_MEMORY_LIMITS.items) invalid('The tombstone input exceeds its bounded item limit.');
  const items = new Set<string>(), sources = new Set<string>();
  let sourceCount = 0;
  for (const tombstone of tombstones) {
    if (!tombstone || !Array.isArray(tombstone.sourceExclusions) || (sourceCount += tombstone.sourceExclusions.length) > MAX_TOMBSTONE_SOURCES) invalid('The tombstone source input exceeds its bounded limit.');
    const parsed = memoryTombstoneV1Schema.safeParse(tombstone);
    if (!parsed.success) invalid('A malformed deletion fence cannot authorize recall.');
    if (parsed.data!.projectIdentity !== projectIdentity) continue;
    items.add(parsed.data!.itemId);
    // A renamed source ID or a replayed source revision cannot revive the same
    // forgotten source bytes. The caller already filtered tombstones by account.
    for (const ref of parsed.data!.sourceExclusions) sources.add(ref.digest);
  }
  return { items, sources };
}
function injection(items: MemoryItemV1[], projectIdentity: string): string {
  if (!items.length) return '';
  return JSON.stringify({ kind: 'project-memory-evidence', authority: 'CONTEXT_ONLY', projectIdentity,
    items: items.map(({ id, revision, kind, text, sourceRefs }) => ({ id, revision, kind, text, sourceRefs })) });
}
function frozenCopy<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (!item || typeof item !== 'object' || Object.isFrozen(item)) return;
    for (const nested of Object.values(item)) freeze(nested);
    Object.freeze(item);
  };
  freeze(copy);
  return copy;
}

/** Pure local selection. Host admission and immutable source retention are inputs,
 * not powers inferred from project names, matching words, or recalled text. */
export function lexicalRecall(input: LexicalRecallInput): MemoryRecallResult {
  const started = performance.now(), access = validateRequest(input);
  const budgetBytes = boundedInteger(input.budgetBytes ?? PROJECT_MEMORY_LIMITS.recallBytes, 0, PROJECT_MEMORY_LIMITS.recallBytes, 'The recall byte budget must be between 0 and 4096.');
  const deadline = boundedInteger(input.deadlineMs ?? PROJECT_MEMORY_LIMITS.foregroundMs, 0, PROJECT_MEMORY_LIMITS.foregroundMs, 'The local recall deadline must be between 0 and 750 ms.');
  const observedNow = input.now ?? Date.now();
  if (!Number.isFinite(observedNow) || !Number.isFinite(new Date(observedNow).getTime())) invalid('The recall clock is invalid.');
  if (!Array.isArray(input.candidates) || input.candidates.length > PROJECT_MEMORY_LIMITS.items) invalid('The recall candidate input exceeds its bounded item limit.');
  if (typeof input.sourceAvailable !== 'function') invalid('Recall requires a synchronous source authorization check.');
  if (input.projectTerms && (input.projectTerms.length > MAX_TERMS || input.projectTerms.some(term => typeof term !== 'string' || term.length > 200))) invalid('Project search terms exceed their bounded limit.');
  if (input.excludedIds && (input.excludedIds.length > PROJECT_MEMORY_LIMITS.items || input.excludedIds.some(value => !ID.test(value)))) invalid('Request exclusions exceed their bounded limit.');
  const fence = sourceFence(input.tombstones, access.projectIdentity);
  const queryTerms = terms(input.query), projectTerms = [...new Set((input.projectTerms ?? []).flatMap(value => terms(value)))].slice(0, MAX_TERMS);
  const exclusions: MemoryRecallV1['exclusions'] = [], candidateIds = new Set<string>();
  const exclude = (itemId: string, reason: string) => { if (!exclusions.some(value => value.itemId === itemId && value.reason === reason)) exclusions.push({ itemId, reason }); };
  const recall: MemoryRecallV1 = { requestId: input.requestId, projectIdentity: access.projectIdentity, contextGeneration: input.contextGeneration,
    queryDigest: sha256Hex(input.query), candidateIds: [], selectedRevisions: [], scores: [], exclusions, budgetBytes, producedAt: new Date(observedNow).toISOString(), status: 'COMPLETE' };
  const result = (items: MemoryItemV1[], status: MemoryRecallV1['status'] = 'COMPLETE'): MemoryRecallResult => {
    recall.status = status; recall.candidateIds = [...candidateIds]; recall.selectedRevisions = items.map(({ id, revision }) => ({ itemId: id, revision }));
    return frozenCopy({ recall: memoryRecallV1Schema.parse(recall), items, injection: injection(items, access.projectIdentity) });
  };
  const timedOut = () => performance.now() - started >= deadline;
  if (timedOut()) return result([], 'TIMEOUT');
  const heads = new Map<string, MemoryItemV1>(), conflicts = new Set<string>(), invalidItems = new Set<string>();
  for (const [index, stored] of input.candidates.entries()) {
    if (timedOut()) return result([], 'TIMEOUT');
    const itemId = ID.test(stored?.item?.id ?? '') ? stored.item.id : 'invalid-' + index;
    if (stored?.profileId !== access.profileId) { exclude(itemId, 'PROFILE_MISMATCH'); continue; }
    if (stored.accountId !== access.accountId) { exclude(itemId, 'ACCOUNT_MISMATCH'); continue; }
    if (stored.projectId !== access.projectId || stored.item?.projectIdentity !== access.projectIdentity) { exclude(itemId, 'PROJECT_MISMATCH'); continue; }
    if (!Array.isArray(stored.item.sourceRefs) || stored.item.sourceRefs.length > 8 || !Array.isArray(stored.item.supersedes) || stored.item.supersedes.length > 32) { invalidItems.add(itemId); exclude(itemId, 'INVALID_ITEM'); continue; }
    const parsed = memoryItemV1Schema.safeParse(stored.item);
    if (!parsed.success) { invalidItems.add(itemId); exclude(itemId, 'INVALID_ITEM'); continue; }
    const item = parsed.data;
    candidateIds.add(item.id);
    const previous = heads.get(item.id);
    if (!previous || item.revision > previous.revision) { heads.set(item.id, item); conflicts.delete(item.id); }
    else if (item.revision === previous.revision && JSON.stringify(item) !== JSON.stringify(previous)) conflicts.add(item.id);
  }
  const superseded = new Set<string>();
  for (const item of heads.values()) if (item.state === 'ACCEPTED' && item.reviewDecision && ['ACCEPT', 'EDIT_ACCEPT', 'RESOLVE'].includes(item.reviewDecision.action) && !conflicts.has(item.id) && !invalidItems.has(item.id)) {
    for (const previous of item.supersedes) superseded.add(previous.itemId + '@' + previous.revision);
  }
  const excluded = new Set(input.excludedIds ?? []);
  const ranked: { item: MemoryItemV1; score: MemoryRecallV1['scores'][number] }[] = [];
  for (const item of heads.values()) {
    if (timedOut()) return result([], 'TIMEOUT');
    if (invalidItems.has(item.id)) continue;
    if (fence.items.has(item.id) || item.state === 'DELETED') { exclude(item.id, 'DELETED'); continue; }
    if (item.sourceRefs.some(ref => fence.sources.has(ref.digest))) { exclude(item.id, 'SOURCE_DELETED'); continue; }
    if (conflicts.has(item.id) || item.state === 'CONFLICT') { exclude(item.id, 'CONFLICT'); continue; }
    if (superseded.has(item.id + '@' + item.revision)) { exclude(item.id, 'SUPERSEDED'); continue; }
    if (item.state === 'EXPIRED' || item.expiresAt !== null && Date.parse(item.expiresAt) <= observedNow) { exclude(item.id, 'EXPIRED'); continue; }
    if (item.state !== 'ACCEPTED' || !item.reviewDecision || !['ACCEPT', 'EDIT_ACCEPT', 'RESOLVE'].includes(item.reviewDecision.action)) { exclude(item.id, 'NOT_ACCEPTED'); continue; }
    if (item.scope !== 'PROJECT') { exclude(item.id, 'USER_SCOPE_DISABLED'); continue; }
    if (excluded.has(item.id)) { exclude(item.id, 'REQUEST_EXCLUDED'); continue; }
    if (memoryContainsSecret(item.text)) { exclude(item.id, 'SECRET_REJECTED'); continue; }
    try {
      if (item.sourceRefs.some(ref => input.sourceAvailable(frozenCopy(ref)) !== true)) { exclude(item.id, 'SOURCE_UNAVAILABLE'); continue; }
    } catch { return result([], 'UNAVAILABLE'); }
    if (timedOut()) return result([], 'TIMEOUT');
    const itemTerms = new Set(terms(item.text, PROJECT_MEMORY_LIMITS.textBytes)), projectMatches = projectTerms.filter(term => itemTerms.has(term)), symbolMatches = queryTerms.filter(term => itemTerms.has(term));
    if (!projectMatches.length && !symbolMatches.length) { exclude(item.id, 'NO_MATCH'); continue; }
    ranked.push({ item, score: { itemId: item.id, revision: item.revision, projectOverlap: projectMatches.length, symbolOverlap: symbolMatches.length, matchedTerms: [...new Set([...projectMatches, ...symbolMatches])].slice(0, MAX_TERMS) } });
  }
  ranked.sort((a, b) => b.score.projectOverlap - a.score.projectOverlap || b.score.symbolOverlap - a.score.symbolOverlap || Date.parse(b.item.observedAt) - Date.parse(a.item.observedAt) || compare(a.item.id, b.item.id));
  recall.scores = ranked.map(entry => entry.score);
  const selected: MemoryItemV1[] = [];
  for (const { item } of ranked) {
    if (selected.length === PROJECT_MEMORY_LIMITS.recallItems) { exclude(item.id, 'ITEM_LIMIT'); continue; }
    if (Buffer.byteLength(injection([...selected, item], access.projectIdentity), 'utf8') > budgetBytes) { exclude(item.id, 'BYTE_BUDGET'); continue; }
    selected.push(item);
  }
  return timedOut() ? result([], 'TIMEOUT') : result(selected);
}

const ownerDigest = (access: MemoryAccess) => sha256Hex(JSON.stringify([access.profileId, access.projectId, access.projectIdentity, access.threadId, access.accountId, access.bindingDigest]));
const requestKey = (access: MemoryAccess, requestId: string) => JSON.stringify([access.profileId, requestId]);
interface RecallSnapshot { owner: string; fingerprint: string; captured: boolean; result: MemoryRecallResult }

/** Immutable memory projections. The host supplies M04 request and generation
 * custody. No update can alter a finalized or in-flight prompt. */
export class MemoryRequestSnapshots {
  private readonly snapshots = new Map<string, RecallSnapshot>();
  constructor(private readonly capacity = 128) {
    boundedInteger(capacity, 1, 128, 'The request snapshot capacity must be between 1 and 128.');
  }
  private existing(access: MemoryAccess, requestId: string): RecallSnapshot | undefined {
    const owner = validateAccess(access);
    if (!ID.test(requestId)) invalid('The memory request ID is invalid.');
    const found = this.snapshots.get(requestKey(owner, requestId));
    if (found && found.owner !== ownerDigest(owner)) throw new HarnessError('MEMORY_SCOPE_CHANGED', 'This memory request belongs to a different owner scope.');
    return found;
  }
  prepare(input: LexicalRecallInput): MemoryRecallResult {
    const access = validateRequest(input), found = this.existing(access, input.requestId);
    const fingerprint = sha256Hex(JSON.stringify({ generation: input.contextGeneration, query: input.query, projectTerms: input.projectTerms ?? [],
      budgetBytes: input.budgetBytes ?? PROJECT_MEMORY_LIMITS.recallBytes, excludedIds: [...new Set(input.excludedIds ?? [])].sort(compare) }));
    if (found) {
      if (found.fingerprint !== fingerprint) throw new HarnessError('MEMORY_REQUEST_CHANGED', 'A memory request cannot be recaptured with another query or generation.');
      return frozenCopy(found.result);
    }
    if (this.snapshots.size >= this.capacity) throw new HarnessError('MEMORY_REQUEST_LIMIT', 'The memory request snapshot capacity is full.');
    const result = lexicalRecall(input);
    this.snapshots.set(requestKey(access, input.requestId), { owner: ownerDigest(access), fingerprint, captured: false, result });
    return frozenCopy(result);
  }
  capture(input: LexicalRecallInput): MemoryRecallResult {
    this.prepare(input);
    return this.finalize(input.access, input.requestId);
  }
  finalize(access: MemoryAccess, requestId: string): MemoryRecallResult {
    const found = this.existing(access, requestId);
    if (!found) throw new HarnessError('MEMORY_REQUEST_MISSING', 'Prepare the memory request before finalizing it.');
    found.captured = true;
    return frozenCopy(found.result);
  }
  get(access: MemoryAccess, requestId: string): MemoryRecallResult | null {
    const found = this.existing(access, requestId);
    return found ? frozenCopy(found.result) : null;
  }
  exclude(access: MemoryAccess, requestId: string, itemId: string): MemoryRecallResult {
    const found = this.existing(access, requestId);
    if (!found) throw new HarnessError('MEMORY_REQUEST_MISSING', 'Prepare the memory request before excluding evidence.');
    if (found.captured) throw new HarnessError('MEMORY_REQUEST_CAPTURED', 'A finalized memory request is immutable; exclude evidence from a later request.');
    if (!ID.test(itemId)) invalid('The excluded memory ID is invalid.');
    const updated = structuredClone(found.result);
    if (updated.items.some(item => item.id === itemId)) {
      updated.items = updated.items.filter(item => item.id !== itemId);
      updated.recall.selectedRevisions = updated.items.map(({ id, revision }) => ({ itemId: id, revision }));
      updated.recall.exclusions.push({ itemId, reason: 'REQUEST_EXCLUDED' });
      updated.injection = injection(updated.items, access.projectIdentity);
    }
    found.result = frozenCopy(updated);
    return frozenCopy(found.result);
  }
  release(access: MemoryAccess, requestId: string): void {
    if (this.existing(access, requestId)) this.snapshots.delete(requestKey(access, requestId));
  }
}

export interface MemoryProviderRequest {
  access: MemoryAccess;
  providerId: string;
  requestId: string;
  contextGeneration: number;
  queryDigest: string;
  query: string;
}
export interface ProviderRecallInput {
  access: MemoryAccess;
  providerId: string;
  requestId: string;
  contextGeneration: number;
  query: string;
  tombstones: MemoryTombstoneV1[];
  sourceAvailable: (ref: MemorySourceRefV1) => boolean;
  /** Synchronous host revalidation, called before egress and before publication. */
  isCurrent: () => boolean;
  provider: (request: MemoryProviderRequest, signal: AbortSignal) => Promise<unknown>;
  signal?: AbortSignal;
}
export interface ProviderRecallResult {
  request: MemoryProviderRequest;
  status: 'COMPLETE' | 'TIMEOUT' | 'UNAVAILABLE' | 'CANCELLED';
  proposals: MemoryItemV1[];
  reason: string | null;
}
export interface MemoryProviderOptions {
  enabled?: boolean;
  egressApproved?: boolean;
  approvedProviders?: string[];
  maxInFlight?: number;
  maxKeys?: number;
  foregroundMs?: number;
}
interface ProviderCircuit { pending: number; open: boolean }
interface PendingProviderCall { orphaned: boolean; circuit: ProviderCircuit }
const providerKey = (access: MemoryAccess, providerId: string) => JSON.stringify([access.profileId, access.projectId, access.projectIdentity, access.accountId, providerId]);
const plainObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

/** An injected provider experiment, disabled by default. This class does not
 * configure a provider, start Python threads, cache results, or inject proposals.
 * Aborting the wait never claims that the external call stopped. */
export class BoundedMemoryRecallProvider {
  private readonly enabled: boolean;
  private readonly egressApproved: boolean;
  private readonly approvedProviders: Set<string>;
  private readonly maxInFlight: number;
  private readonly maxKeys: number;
  private readonly foregroundMs: number;
  private readonly circuits = new Map<string, ProviderCircuit>();
  private readonly pending = new Map<string, PendingProviderCall>();
  constructor(options: MemoryProviderOptions = {}) {
    this.enabled = options.enabled === true;
    this.egressApproved = options.egressApproved === true;
    const providers = options.approvedProviders ?? [];
    if (!Array.isArray(providers) || providers.length > 16 || providers.some(provider => !ID.test(provider))) invalid('The approved provider list exceeds its bounded limit.');
    this.approvedProviders = new Set(providers);
    this.maxInFlight = boundedInteger(options.maxInFlight ?? 2, 1, 16, 'The provider in-flight capacity must be between 1 and 16.');
    this.maxKeys = boundedInteger(options.maxKeys ?? 32, 1, 128, 'The provider key capacity must be between 1 and 128.');
    this.foregroundMs = boundedInteger(options.foregroundMs ?? PROJECT_MEMORY_LIMITS.foregroundMs, 1, PROJECT_MEMORY_LIMITS.foregroundMs, 'The provider foreground budget must be between 1 and 750 ms.');
  }
  inspect(): Readonly<{ inFlight: number; orphaned: number; openCircuits: number; keys: number }> {
    return Object.freeze({ inFlight: this.pending.size, orphaned: [...this.pending.values()].filter(value => value.orphaned).length,
      openCircuits: [...this.circuits.values()].filter(value => value.open).length, keys: this.circuits.size });
  }
  resetCircuit(access: MemoryAccess, providerId: string): void {
    const owner = validateAccess(access);
    if (!ID.test(providerId)) invalid('The provider identity is invalid.');
    const key = providerKey(owner, providerId), circuit = this.circuits.get(key);
    if (circuit?.pending) throw new HarnessError('MEMORY_PROVIDER_PENDING', 'Wait for the pending provider call to settle before resetting its circuit.');
    this.circuits.delete(key);
  }
  private proposals(raw: unknown, request: MemoryProviderRequest, input: ProviderRecallInput): MemoryItemV1[] | null {
    if (!plainObject(raw) || Object.keys(raw).some(key => !['request', 'proposals'].includes(key)) || !plainObject(raw.request) || !Array.isArray(raw.proposals) || raw.proposals.length > PROJECT_MEMORY_LIMITS.recallItems) return null;
    const received = raw.request;
    if (Object.keys(received).some(key => !['access', 'providerId', 'requestId', 'contextGeneration', 'queryDigest', 'query'].includes(key))) return null;
    try {
      const access = validateAccess(received.access as MemoryAccess);
      if (ownerDigest(access) !== ownerDigest(request.access) || received.providerId !== request.providerId || received.requestId !== request.requestId || received.contextGeneration !== request.contextGeneration || received.queryDigest !== request.queryDigest || received.query !== request.query) return null;
      const fence = sourceFence(input.tombstones, request.access.projectIdentity), proposals: MemoryItemV1[] = [], ids = new Set<string>();
      for (const candidate of raw.proposals) {
        if (!plainObject(candidate) || !Array.isArray(candidate.sourceRefs) || candidate.sourceRefs.length > 8 || !Array.isArray(candidate.supersedes) || candidate.supersedes.length > 32) return null;
        const parsed = memoryItemV1Schema.safeParse(candidate);
        if (!parsed.success) return null;
        const item = parsed.data;
        if (item.projectIdentity !== request.access.projectIdentity || item.scope !== 'PROJECT' || item.state !== 'PROPOSED' || item.reviewDecision !== null || item.assertedBy.kind !== 'AGENT' || ids.has(item.id) || memoryContainsSecret(item.text) || fence.items.has(item.id)) return null;
        if (item.sourceRefs.some(ref => fence.sources.has(ref.digest) || input.sourceAvailable(frozenCopy(ref)) !== true)) return null;
        ids.add(item.id); proposals.push(item);
      }
      return Buffer.byteLength(JSON.stringify(proposals), 'utf8') <= PROJECT_MEMORY_LIMITS.sourceBytes ? proposals : null;
    } catch { return null; }
  }
  recall(input: ProviderRecallInput): Promise<ProviderRecallResult> {
    const started = performance.now(), access = validateRequest(input);
    if (!ID.test(input.providerId)) invalid('The provider identity is invalid.');
    const request: MemoryProviderRequest = frozenCopy({ access, providerId: input.providerId, requestId: input.requestId, contextGeneration: input.contextGeneration, queryDigest: sha256Hex(input.query), query: input.query });
    const output = (status: ProviderRecallResult['status'], reason: string | null, proposals: MemoryItemV1[] = []): ProviderRecallResult => frozenCopy({ request, status, proposals, reason });
    const reject = (reason: string) => Promise.resolve(output('UNAVAILABLE', reason));
    if (!this.enabled || !this.egressApproved || !this.approvedProviders.has(input.providerId)) return reject('EXPERIMENT_DISABLED');
    if (memoryContainsSecret(input.query)) return reject('SECRET_REJECTED');
    if (typeof input.sourceAvailable !== 'function' || typeof input.isCurrent !== 'function' || typeof input.provider !== 'function') invalid('The provider requires host authorization and bounded source checks.');
    const current = () => { try { return input.isCurrent() === true; } catch { return false; } };
    if (input.signal?.aborted) return Promise.resolve(output('CANCELLED', 'CANCELLED'));
    if (!current()) return reject('OWNER_CHANGED');
    sourceFence(input.tombstones, access.projectIdentity);
    if (input.signal?.aborted) return Promise.resolve(output('CANCELLED', 'CANCELLED'));
    const remainingMs = this.foregroundMs - (performance.now() - started);
    if (remainingMs <= 0) return Promise.resolve(output('TIMEOUT', 'TIMEOUT'));
    const key = providerKey(access, input.providerId), pendingKey = requestKey(access, input.requestId), previous = this.circuits.get(key);
    if (this.pending.has(pendingKey)) return reject('REQUEST_PENDING');
    if (previous?.open) return reject('CIRCUIT_OPEN');
    if (this.pending.size >= this.maxInFlight) return reject('IN_FLIGHT_LIMIT');
    if (!previous && this.circuits.size >= this.maxKeys) return reject('KEY_LIMIT');
    const circuit = previous ?? { pending: 0, open: false };
    this.circuits.set(key, circuit); circuit.pending++;
    const pending: PendingProviderCall = { orphaned: false, circuit };
    this.pending.set(pendingKey, pending);
    const controller = new AbortController();
    let resolve!: (result: ProviderRecallResult) => void;
    const foreground = new Promise<ProviderRecallResult>(done => { resolve = done; });
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (status: ProviderRecallResult['status'], reason: string | null, proposals: MemoryItemV1[] = []) => {
      if (finished) return;
      finished = true; clearTimeout(timer); input.signal?.removeEventListener('abort', cancel);
      resolve(output(status, reason, proposals));
    };
    const abandon = (status: 'TIMEOUT' | 'CANCELLED') => {
      if (finished) return;
      pending.orphaned = true; circuit.open = true;
      finish(status, status); controller.abort();
    };
    const cancel = () => abandon('CANCELLED');
    timer = setTimeout(() => abandon('TIMEOUT'), remainingMs);
    input.signal?.addEventListener('abort', cancel, { once: true });
    const settle = (raw: unknown, failed: boolean) => {
      try {
        if (pending.orphaned) return;
        if (failed) { circuit.open = true; finish('UNAVAILABLE', 'PROVIDER_ERROR'); return; }
        if (!current()) { finish('UNAVAILABLE', 'OWNER_CHANGED'); return; }
        if (performance.now() - started >= this.foregroundMs) { circuit.open = true; finish('TIMEOUT', 'TIMEOUT'); return; }
        const proposals = this.proposals(raw, request, input);
        if (proposals === null) { circuit.open = true; finish('UNAVAILABLE', 'INVALID_RESPONSE'); return; }
        if (!current()) { finish('UNAVAILABLE', 'OWNER_CHANGED'); return; }
        if (performance.now() - started >= this.foregroundMs) { circuit.open = true; finish('TIMEOUT', 'TIMEOUT'); return; }
        finish('COMPLETE', null, proposals);
      } catch { circuit.open = true; finish('UNAVAILABLE', 'INVALID_RESPONSE'); }
      finally {
        this.pending.delete(pendingKey); circuit.pending--;
        if (!circuit.pending && !circuit.open) this.circuits.delete(key);
      }
    };
    let work: Promise<unknown>;
    try { work = Promise.resolve(input.provider(request, controller.signal)); }
    catch { work = Promise.reject(new Error('The bounded recall provider failed.')); }
    void work.then(raw => settle(raw, false), () => settle(undefined, true));
    return foreground;
  }
}
