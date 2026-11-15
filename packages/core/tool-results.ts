import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { HarnessError, type ResourceGrant } from '../contracts/index.ts';
import { toolOwnerSchema, type ToolOwner } from '../contracts/tool-effects.ts';
import {
  TOOL_RESULT_LIMITS, privateToolResultRefSchema, sameToolOwner, toolResultErrorSchema, toolResultGrantSchema,
  toolResultStatusSchema, type PrivateToolResultRead, type SaveToolResult, type ToolResultErrorV1,
  type ToolResultGrantV1, type ToolResultLimits, type ToolResultMetadataV1, type ToolResultRange, type ToolResultReadOptions,
} from '../contracts/tool-results.ts';
import { digest, type Store } from '../storage/store.ts';
import { resolveGrant } from './security.ts';

const KIND = 'privateToolResult', ACCESS_KIND = 'privateToolResultAccess';
const hash = z.string().regex(/^[a-f0-9]{64}$/), id = z.string().min(1).max(200);
const grantsSchema = z.array(toolResultGrantSchema).max(TOOL_RESULT_LIMITS.maxGrants);
const recordSchema = z.strictObject({
  version: z.literal(1), resultRef: privateToolResultRefSchema, revision: z.literal(1), owner: toolOwnerSchema,
  ownerDigest: hash, programId: id, invocationId: id.optional(), sha256: hash,
  bytes: z.number().int().nonnegative().max(TOOL_RESULT_LIMITS.maxResultBytes),
  status: toolResultStatusSchema, contentType: z.enum(['application/json', 'text/plain']),
  grants: grantsSchema, createdAt: z.number().int().nonnegative(), base64: z.string(),
});
type PrivateRecord = z.infer<typeof recordSchema>;
interface AccessRecord { version: 1; owner: ToolOwner; resultRef: string; programId: string }
export interface PrivateToolResultHooks {
  currentOwner(threadId: string): ToolOwner;
  /** Authenticated UI history only: verify the captured thread/account/project/workspace
   * against current user access. Run/epoch remain historical. Never expose to a worker. */
  authorizeRetainedOwner?(capturedOwner: ToolOwner): void;
}
/** Only prepare() can produce a usable value. Raw bytes remain in a host-owned WeakMap. */
export interface PreparedToolResult { readonly resultRef: string }
const denied = () => new HarnessError('RESULT_ACCESS_DENIED', 'This private result is unavailable to the current owner.');
const invalid = () => new HarnessError('INVALID_RESULT', 'Use a bounded lossless JSON result or valid UTF-8 text.');
const integrity = () => new HarnessError('RESULT_INTEGRITY', 'The retained private result failed its integrity check.');
const active = (signal?: AbortSignal) => { if (signal?.aborted) throw new HarnessError('RESULT_CANCELLED', 'Private result access was cancelled.'); };
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const utf8 = (bytes: Uint8Array) => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);

function assertJson(value: unknown, ancestors = new Set<object>(), depth = 0, budget = { nodes: 0 }): void {
  if (++budget.nodes > 100_000 || depth > 64) throw invalid();
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw invalid(); return; }
  if (!value || typeof value !== 'object' || ancestors.has(value)) throw invalid();
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw invalid();
  const properties = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(properties).some(key => typeof key !== 'string') || Object.values(properties).some(property => 'get' in property || 'set' in property)) throw invalid();
  if (Object.entries(properties).some(([key, property]) => !property.enumerable && !(Array.isArray(value) && key === 'length'))) throw invalid();
  ancestors.add(value);
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) throw invalid();
    for (let index = 0; index < value.length; index++) { if (!Object.hasOwn(value, index)) throw invalid(); assertJson(value[index], ancestors, depth + 1, budget); }
  } else for (const property of Object.values(properties)) if (property.enumerable) assertJson(property.value, ancestors, depth + 1, budget);
  ancestors.delete(value);
}
function checkedError(input: unknown): ToolResultErrorV1 {
  const parsed = toolResultErrorSchema.safeParse(input);
  if (!parsed.success || Buffer.byteLength(parsed.data.message, 'utf8') > 8192) throw invalid();
  const error = { code: parsed.data.code, message: parsed.data.message, ...(parsed.data.details === undefined ? {} : { details: parsed.data.details }) };
  assertJson(error);
  return error;
}
function metadata(record: PrivateRecord): ToolResultMetadataV1 {
  return { resultRef: record.resultRef, revision: record.revision, sha256: record.sha256, bytes: record.bytes, status: record.status, contentType: record.contentType };
}

/** Host-only immutable result storage. Private entity kinds are never snapshot projections.
 * Transaction callbacks return metadata only. Worker reads must supply programId; omitting
 * it is reserved for authenticated exact-owner inspection and host input authorization. */
export class PrivateToolResults {
  private readonly prepared = new WeakMap<PreparedToolResult, PrivateRecord>();
  private readonly limits: ToolResultLimits;
  constructor(private readonly store: Store, private readonly hooks: PrivateToolResultHooks, limits: Partial<ToolResultLimits> = {}) {
    this.limits = { maxResultBytes: TOOL_RESULT_LIMITS.maxResultBytes, maxProgramBytes: TOOL_RESULT_LIMITS.maxProgramBytes, maxThreadBytes: TOOL_RESULT_LIMITS.maxThreadBytes, ...limits };
    if (Object.keys(limits).some(key => !['maxResultBytes', 'maxProgramBytes', 'maxThreadBytes'].includes(key)) ||
      Object.entries(this.limits).some(([key, value]) => !Number.isSafeInteger(value) || value < 1 || value > TOOL_RESULT_LIMITS[key as keyof ToolResultLimits]))
      throw new HarnessError('INVALID_RESULT_LIMIT', 'Private result limits may only reduce the host maximum.');
  }
  private assertOwner(owner: ToolOwner): void {
    let current: ToolOwner;
    try { current = this.hooks.currentOwner(owner.threadId); } catch { throw denied(); }
    if (!sameToolOwner(owner, current)) throw denied();
  }
  private grantRecord(owner: ToolOwner, witness: ToolResultGrantV1): ResourceGrant {
    const grant = this.store.get<ResourceGrant>('resource', witness.resourceId);
    if (!grant || grant.threadId !== owner.threadId || digest(grant) !== witness.grantDigest) throw denied();
    return grant;
  }
  private witnesses(owner: ToolOwner, grants: readonly ToolResultGrantV1[]): ToolResultGrantV1[] {
    const parsed = grantsSchema.safeParse(grants);
    if (!parsed.success) throw denied();
    const found = new Set<string>();
    for (const witness of parsed.data) {
      const key = witness.resourceId + '\0' + (witness.path ?? '');
      if (found.has(key)) throw denied();
      found.add(key); this.grantRecord(owner, witness);
    }
    return parsed.data;
  }
  private syncGrants(owner: ToolOwner, grants: readonly ToolResultGrantV1[]): ToolResultGrantV1[] {
    this.assertOwner(owner);
    return this.witnesses(owner, grants);
  }
  async captureGrants(owner: ToolOwner, resources: readonly { resourceId: string; path?: string }[], signal?: AbortSignal): Promise<ToolResultGrantV1[]> {
    this.assertOwner(owner); active(signal);
    if (!Array.isArray(resources) || resources.length > TOOL_RESULT_LIMITS.maxGrants) throw denied();
    const witnesses: ToolResultGrantV1[] = [], found = new Set<string>();
    for (const resource of resources) {
      const parsed = toolResultGrantSchema.omit({ grantDigest: true }).safeParse(resource);
      if (!parsed.success) throw denied();
      const key = parsed.data.resourceId + '\0' + (parsed.data.path ?? '');
      if (found.has(key)) continue;
      found.add(key);
      const grant = this.store.get<ResourceGrant>('resource', parsed.data.resourceId);
      if (!grant || grant.threadId !== owner.threadId) throw denied();
      witnesses.push({ ...parsed.data, grantDigest: digest(grant) });
    }
    witnesses.sort((a, b) => (a.resourceId + '\0' + (a.path ?? '')).localeCompare(b.resourceId + '\0' + (b.path ?? '')));
    await this.revalidateGrants(owner, witnesses, signal);
    return witnesses;
  }
  /** Validate original captured witnesses after execution, not newly captured replacement grants. */
  async revalidateGrants(owner: ToolOwner, grants: readonly ToolResultGrantV1[], signal?: AbortSignal): Promise<void> {
    active(signal);
    const witnesses = this.syncGrants(owner, grants);
    for (const witness of witnesses) {
      const grant = this.grantRecord(owner, witness);
      try { await resolveGrant(grant, witness.path, false, this.store.dataDir); }
      catch { active(signal); throw denied(); }
      active(signal); this.assertOwner(owner); this.grantRecord(owner, witness);
    }
    active(signal); this.assertOwner(owner);
  }
  prepare(input: SaveToolResult): PreparedToolResult {
    this.assertOwner(input.owner);
    const owner = toolOwnerSchema.parse(input.owner), grants = this.syncGrants(owner, input.grants);
    if (!id.safeParse(input.programId).success || input.invocationId !== undefined && !id.safeParse(input.invocationId).success) throw invalid();
    const contentType = input.contentType ?? 'application/json';
    if (contentType !== 'application/json' && contentType !== 'text/plain') throw invalid();
    let text: string;
    if (input.status === 'FAILED') {
      if (Object.hasOwn(input, 'value') || contentType !== 'application/json') throw invalid();
      text = JSON.stringify(checkedError(input.error));
    } else if (input.status === 'SUCCEEDED') {
      if (Object.hasOwn(input, 'error') || !Object.hasOwn(input, 'value')) throw invalid();
      if (contentType === 'text/plain') {
        if (typeof input.value !== 'string') throw invalid();
        text = input.value;
        if (utf8(Buffer.from(text, 'utf8')) !== text) throw invalid();
      } else { assertJson(input.value); text = JSON.stringify(input.value); }
    } else throw invalid();
    const bytes = Buffer.from(text, 'utf8');
    if (bytes.length > this.limits.maxResultBytes) throw new HarnessError('RESULT_TOO_LARGE', 'The private result exceeds its byte limit.');
    const resultRef = input.resultRef ?? 'result_' + randomBytes(16).toString('hex');
    if (!privateToolResultRefSchema.safeParse(resultRef).success) throw invalid();
    const record: PrivateRecord = {
      version: 1, resultRef, revision: 1, owner, ownerDigest: digest(owner), programId: input.programId,
      ...(input.invocationId === undefined ? {} : { invocationId: input.invocationId }),
      contentType, status: input.status, bytes: bytes.length, sha256: sha256(bytes), grants,
      createdAt: Date.now(), base64: bytes.toString('base64'),
    };
    const prepared = Object.freeze({ resultRef });
    this.prepared.set(prepared, record);
    return prepared;
  }
  /** Must run inside the caller's result/receipt/journal settlement transaction.
   * Call revalidateGrants first; async filesystem work never enters SQLite transactions. */
  put(prepared: PreparedToolResult): string {
    const record = this.prepared.get(prepared);
    if (!record) throw invalid();
    this.syncGrants(record.owner, record.grants);
    const existing = this.store.get<PrivateRecord>(KIND, record.resultRef);
    if (existing) {
      this.bytes(existing);
      if (digest({ ...existing, createdAt: 0 }) !== digest({ ...record, createdAt: 0 })) throw new HarnessError('RESULT_CONFLICT', 'This private result identity already has a different immutable outcome.');
      // An idempotent retry has the same transaction requirement as its first write.
      this.store.put(KIND, record.resultRef, record.owner.threadId, existing);
      return record.resultRef;
    }
    const totals = this.store.db.prepare("SELECT COALESCE(SUM(json_extract(body,'$.bytes')),0) AS threadBytes, COALESCE(SUM(CASE WHEN json_extract(body,'$.programId')=? AND json_extract(body,'$.ownerDigest')=? THEN json_extract(body,'$.bytes') ELSE 0 END),0) AS programBytes FROM entities WHERE kind=? AND thread_id=?").get(record.programId, record.ownerDigest, KIND, record.owner.threadId) as { threadBytes: number; programBytes: number };
    if (totals.programBytes + record.bytes > this.limits.maxProgramBytes || totals.threadBytes + record.bytes > this.limits.maxThreadBytes)
      throw new HarnessError('RESULT_STORE_LIMIT', 'The retained private result byte budget is exhausted.');
    this.store.put(KIND, record.resultRef, record.owner.threadId, record);
    return record.resultRef;
  }
  async save(input: SaveToolResult): Promise<string> {
    const prepared = this.prepare(input), record = this.prepared.get(prepared)!;
    await this.revalidateGrants(record.owner, record.grants);
    this.store.internal('privateToolResult.stored', record.owner.threadId, () => { this.put(prepared); return metadata(record); });
    return prepared.resultRef;
  }
  private bytes(record: PrivateRecord): Buffer {
    const parsed = recordSchema.safeParse(record);
    if (!parsed.success || record.ownerDigest !== digest(record.owner)) throw integrity();
    const bytes = Buffer.from(record.base64, 'base64');
    if (bytes.toString('base64') !== record.base64 || bytes.length !== record.bytes || sha256(bytes) !== record.sha256) throw integrity();
    try { utf8(bytes); } catch { throw integrity(); }
    return bytes;
  }
  /** Host recovery evidence only, never a worker or UI read endpoint. Verify the
   * exact historical owner/program/invocation and committed bytes without returning
   * payloads, checking present grants, renewing ownership, or authorizing new inputs.
   * An absent invocation is required for aggregate receipts, not a wildcard. */
  recoveryMetadata(owner: ToolOwner, ref: string, binding: { programId: string; invocationId?: string }): ToolResultMetadataV1 {
    if (!toolOwnerSchema.safeParse(owner).success || !privateToolResultRefSchema.safeParse(ref).success ||
      !id.safeParse(binding.programId).success || binding.invocationId !== undefined && !id.safeParse(binding.invocationId).success) throw denied();
    const record = this.store.get<PrivateRecord>(KIND, ref);
    if (!record || record.resultRef !== ref || !sameToolOwner(owner, record.owner) ||
      record.programId !== binding.programId || record.invocationId !== binding.invocationId) throw denied();
    const bytes = this.bytes(record);
    try {
      if (record.status === 'FAILED') {
        if (record.contentType !== 'application/json') throw integrity();
        checkedError(JSON.parse(utf8(bytes)));
      } else if (record.contentType === 'application/json') JSON.parse(utf8(bytes));
    } catch { throw integrity(); }
    return metadata(record);
  }
  private audience(owner: ToolOwner, record: PrivateRecord, programId?: string): void {
    if (programId === undefined || programId === record.programId) return;
    if (!id.safeParse(programId).success) throw denied();
    const access = this.store.get<AccessRecord>(ACCESS_KIND, digest({ owner, resultRef: record.resultRef, programId }));
    if (!access || access.version !== 1 || access.resultRef !== record.resultRef || access.programId !== programId || !sameToolOwner(owner, access.owner)) throw denied();
  }
  private async load(owner: ToolOwner, ref: string, options: ToolResultReadOptions): Promise<{ record: PrivateRecord; bytes: Buffer }> {
    active(options.signal); this.assertOwner(owner);
    if (!privateToolResultRefSchema.safeParse(ref).success) throw denied();
    const record = this.store.get<PrivateRecord>(KIND, ref);
    if (!record || !sameToolOwner(owner, record.owner)) throw denied();
    this.audience(owner, record, options.programId);
    const bytes = this.bytes(record);
    await this.revalidateGrants(owner, record.grants, options.signal);
    this.assertOwner(owner); active(options.signal); this.audience(owner, record, options.programId);
    const current = this.store.get<PrivateRecord>(KIND, ref);
    if (!current || digest(current) !== digest(record)) throw integrity();
    return { record, bytes };
  }
  private async retainedOwner(owner: ToolOwner): Promise<void> {
    if (!toolOwnerSchema.safeParse(owner).success || !this.hooks.authorizeRetainedOwner) throw denied();
    try { await this.hooks.authorizeRetainedOwner(structuredClone(owner)); }
    catch { throw denied(); }
  }
  private async loadRetained(owner: ToolOwner, ref: string, signal?: AbortSignal): Promise<{ record: PrivateRecord; bytes: Buffer }> {
    active(signal);
    if (!privateToolResultRefSchema.safeParse(ref).success) throw denied();
    const record = this.store.get<PrivateRecord>(KIND, ref);
    if (!record || !sameToolOwner(owner, record.owner)) throw denied();
    await this.retainedOwner(owner); active(signal);
    const bytes = this.bytes(record), witnesses = this.witnesses(owner, record.grants);
    for (const witness of witnesses) {
      const grant = this.grantRecord(owner, witness);
      try { await resolveGrant(grant, witness.path, false, this.store.dataDir); }
      catch { active(signal); throw denied(); }
      active(signal); await this.retainedOwner(owner); this.grantRecord(owner, witness);
    }
    await this.retainedOwner(owner); active(signal); this.witnesses(owner, record.grants);
    const current = this.store.get<PrivateRecord>(KIND, ref);
    if (!current || digest(current) !== digest(record)) throw integrity();
    return { record, bytes };
  }
  async read(owner: ToolOwner, ref: string, options: ToolResultReadOptions = {}): Promise<PrivateToolResultRead> {
    const { record, bytes } = await this.load(owner, ref, options), text = utf8(bytes);
    const common = { ...metadata(record), grants: structuredClone(record.grants) };
    try {
      if (record.status === 'FAILED') {
        if (record.contentType !== 'application/json') throw integrity();
        return { ...common, status: 'FAILED', error: checkedError(JSON.parse(text)) };
      }
      return { ...common, status: 'SUCCEEDED', value: record.contentType === 'text/plain' ? text : JSON.parse(text) };
    } catch { throw integrity(); }
  }
  private validRange(offset: number, limit: number): void {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > TOOL_RESULT_LIMITS.maxRangeBytes)
      throw new HarnessError('INVALID_RESULT_RANGE', 'Choose a bounded range at a UTF-8 byte boundary.');
  }
  private page(record: PrivateRecord, bytes: Buffer, offset: number, limit: number): ToolResultRange {
    const badRange = () => new HarnessError('INVALID_RESULT_RANGE', 'Choose a bounded range at a UTF-8 byte boundary.');
    if (offset > bytes.length || offset < bytes.length && (bytes[offset]! & 0xc0) === 0x80) throw badRange();
    let end = Math.min(offset + limit, bytes.length);
    while (end > offset && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
    if (end === offset && offset < bytes.length) throw badRange();
    return { ...metadata(record), offset, end, nextOffset: end < bytes.length ? end : null, totalBytes: bytes.length, text: utf8(bytes.subarray(offset, end)), units: 'UTF-8 bytes' };
  }
  async range(owner: ToolOwner, ref: string, options: ToolResultReadOptions & { offset: number; limit: number }): Promise<ToolResultRange> {
    this.validRange(options.offset, options.limit);
    const { record, bytes } = await this.load(owner, ref, options);
    return this.page(record, bytes, options.offset, options.limit);
  }
  /** Separate authenticated history inspection, never program/worker input authority.
   * The supplied owner must equal the original stored owner. An explicit host hook
   * authenticates present access to that historical scope, and every grant is rechecked.
   * This returns only a byte page; it neither renews a reference nor authorizesInput. */
  async rangeRetained(owner: ToolOwner, ref: string, options: { offset: number; limit: number; signal?: AbortSignal }): Promise<ToolResultRange> {
    this.validRange(options.offset, options.limit);
    const { record, bytes } = await this.loadRetained(owner, ref, options.signal);
    return this.page(record, bytes, options.offset, options.limit);
  }
  /** Host preparation for explicit inputRefs only. The worker bridge must not
   * expose this method. load validates one bounded raw receipt and its grants;
   * it does not JSON-parse/materialize the result value. ToolPrograms separately
   * budgets the combined decoded values before retaining or dispatching them. */
  async authorizeInput(owner: ToolOwner, ref: string, targetProgramId: string): Promise<string> {
    if (!id.safeParse(targetProgramId).success) throw denied();
    const { record } = await this.load(owner, ref, {});
    this.store.internal('privateToolResult.inputAuthorized', owner.threadId, () => {
      this.syncGrants(owner, record.grants);
      const key = digest({ owner, resultRef: ref, programId: targetProgramId });
      this.store.put(ACCESS_KIND, key, owner.threadId, { version: 1, owner: toolOwnerSchema.parse(owner), resultRef: ref, programId: targetProgramId } satisfies AccessRecord);
      return { resultRef: ref, programId: targetProgramId };
    });
    return ref;
  }
}
