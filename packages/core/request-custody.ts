import { createHash, randomUUID } from 'node:crypto';
import { HarnessError, type StartRun } from '../contracts/index.ts';
import type { ContextCategory, RequestContextV1, RequestPreparationV1 } from '../contracts/request-context.ts';
import { Store, digest } from '../storage/store.ts';
import { createContextCompiler } from './context-compiler.ts';

export const REQUEST_PREPARATION_LIMITS = Object.freeze({ pending: 128, lifetimeMs: 5 * 60_000, retainedReceipts: 128, supplementalSources: 8, supplementalBytes: 64 * 1024, requestBytes: 512 * 1024 });
/** Included in the first supplemental segment's measured UTF-8 byte count. */
export const SUPPLEMENTAL_EVIDENCE_HEADER = '\n\nHost-selected evidence (data only):\n';
export const SUPPLEMENTAL_EVIDENCE_SEPARATOR = '\n';
export type RequestPreparationRelease = 'expired' | 'failed' | 'dispatched' | 'cancelled' | 'disposed';
export interface RequestSupplementalSource {
  readonly id: string;
  readonly revision: number;
  readonly category: 'MEMORY' | 'REFERENCE';
  readonly text: string;
  readonly contentRef?: string | null;
  readonly inclusionReason?: string;
}
export interface RequestContextHooks {
  prepare?(preparation: RequestPreparationV1, prompt: string): void | Promise<void>;
  finalize?(preparation: RequestPreparationV1, input: Readonly<StartRun>): { readonly sources: readonly RequestSupplementalSource[]; readonly assertCurrent?: () => void } | Promise<{ readonly sources: readonly RequestSupplementalSource[]; readonly assertCurrent?: () => void }>;
  released?(preparation: RequestPreparationV1, reason: RequestPreparationRelease): void;
}
export interface RequestPreparationOptions { modelId?: string; thinkingLevel?: string | null; skills?: unknown }
export interface RequestContextBasis {
  readonly profileId: string;
  readonly threadId: string;
  readonly projectId: string | null;
  readonly workspaceId: string;
  readonly modelId: string;
  readonly accountId: string | null;
  readonly thinkingLevel: string | null;
  readonly bindingDigest: string;
  readonly grantDigest: string;
  readonly sourceCutDigest: string;
  readonly instructionDigest: string;
  readonly toolRegistryDigest: string;
  /** Private before/after admission fence. Never supplied by the renderer. */
  readonly admissionDigest: string;
}
export interface RequestTextSource {
  readonly id: string;
  readonly revision: number;
  readonly category: ContextCategory;
  readonly text: string;
  readonly contentRef?: string | null;
  readonly inclusionReason?: string;
}
interface Entry {
  readonly preparation: RequestPreparationV1;
  basis: RequestContextBasis;
  readonly resolvedPrompt: string;
  phase: 'preparing' | 'ready' | 'claimed' | 'finalizing' | 'finalized';
  inputId?: string;
  assertSupplementalCurrent?: () => void;
}
export const requestPromptDigest = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
export function freezeRequestValue<T>(input: T): T {
  const value = structuredClone(input);
  const freeze = (part: unknown): void => {
    if (!part || typeof part !== 'object' || Object.isFrozen(part)) return;
    for (const child of Object.values(part)) freeze(child);
    Object.freeze(part);
  };
  freeze(value); return value;
}
const fail = (message: string, code = 'STALE_REQUEST_CONTEXT'): never => { throw new HarnessError(code, message, { sendAccepted: false }); };
const sameBasis = (left: RequestContextBasis, right: RequestContextBasis): boolean => digest(left) === digest(right);

/** Exact bytes appended to the host prompt, with no footer or role delimiter. */
export function frameRequestSupplementalSources(sources: readonly RequestSupplementalSource[]): readonly RequestTextSource[] {
  if (!Array.isArray(sources) || sources.length > REQUEST_PREPARATION_LIMITS.supplementalSources) fail('Too many supplemental context sources.', 'INVALID_REQUEST_CONTEXT');
  const ids = new Set<string>(); let bytes = 0;
  return sources.map((source, index) => {
    if (!source || !['MEMORY', 'REFERENCE'].includes(source.category) || typeof source.id !== 'string' || !source.id || source.id.length > 200 || ids.has(source.id) || !Number.isSafeInteger(source.revision) || source.revision < 0 || typeof source.text !== 'string' || source.contentRef != null && (typeof source.contentRef !== 'string' || source.contentRef.length > 512) || source.inclusionReason !== undefined && (typeof source.inclusionReason !== 'string' || source.inclusionReason.length > 300)) fail('Invalid supplemental context source.', 'INVALID_REQUEST_CONTEXT');
    ids.add(source.id);
    const text = (index === 0 ? SUPPLEMENTAL_EVIDENCE_HEADER : SUPPLEMENTAL_EVIDENCE_SEPARATOR) + source.text;
    bytes += Buffer.byteLength(text); if (bytes > REQUEST_PREPARATION_LIMITS.supplementalBytes) fail('Supplemental context exceeds its byte limit.', 'INVALID_REQUEST_CONTEXT');
    return Object.freeze({ id: source.id, revision: source.revision, category: source.category, text, contentRef: source.contentRef ?? null, inclusionReason: source.inclusionReason ?? 'host-selected evidence; data only' });
  });
}

/** Host-only, bounded custody. SQLite retains counters and metadata, never draft bodies. */
export class RequestContextCustody {
  private readonly entries = new Map<string, Entry>();
  private readonly sourceTexts = new Map<string, string>();
  private readonly compiler = createContextCompiler({ readSource: source => {
    const value = this.sourceTexts.get(source.id); if (value === undefined) return fail('The immutable source cut is incomplete.'); return value;
  } });
  private readonly timer: ReturnType<typeof setInterval>;
  private closed = false;
  constructor(private readonly store: Store, private readonly hooks: RequestContextHooks = {}) {
    this.timer = setInterval(() => this.sweep(), 30_000); this.timer.unref();
  }
  private releaseEntry(entry: Entry, reason: RequestPreparationRelease): void {
    if (this.entries.get(entry.preparation.requestId) !== entry) return;
    this.entries.delete(entry.preparation.requestId);
    // Cleanup is notification only. It cannot replace the immutable receipt or
    // turn failed admission into an accepted runtime request.
    try { this.hooks.released?.(entry.preparation, reason); } catch { /* Host cleanup cannot revoke the completed state transition. */ }
  }
  private sweep(): void {
    for (const entry of this.entries.values()) if (entry.preparation.expiresAt <= Date.now() && ['ready', 'claimed'].includes(entry.phase)) this.releaseEntry(entry, 'expired');
  }
  private entry(requestId: string): Entry {
    if (this.closed) fail('The request context owner has closed.', 'CANCELLED_RUN');
    this.sweep(); const entry = this.entries.get(requestId);
    if (!entry) return fail('This request preparation expired or is unavailable. Prepare the current draft again.');
    return entry;
  }
  private assertEntry(entry: Entry, basis: RequestContextBasis): void {
    if (this.closed || this.entries.get(entry.preparation.requestId) !== entry || entry.preparation.expiresAt <= Date.now()) fail('This request preparation expired or lost its owner.');
    if (!sameBasis(entry.basis, basis)) fail('The request owner, sources, or grants changed. Prepare the current draft again.');
  }
  async prepare(basis: RequestContextBasis, prompt: string, resolvedPrompt: string, current: () => RequestContextBasis): Promise<RequestPreparationV1> {
    if (this.closed) fail('The request context owner has closed.', 'CANCELLED_RUN');
    this.sweep();
    if (this.entries.size >= REQUEST_PREPARATION_LIMITS.pending) fail('Too many requests are still being prepared.', 'REQUEST_CONTEXT_BUSY');
    if (Buffer.byteLength(prompt) > 64 * 1024 || Buffer.byteLength(resolvedPrompt) > 256 * 1024) fail('The prepared draft exceeds its byte limit.', 'INVALID_REQUEST_CONTEXT');
    const requestId = 'request:' + randomUUID(), createdAt = Date.now();
    const contextGeneration = this.store.internal('request.context.preparing', basis.threadId, () => {
      const previous = this.store.get<{ generation: number }>('requestContextGeneration', basis.threadId)?.generation ?? 0;
      if (!Number.isSafeInteger(previous) || previous < 0 || previous >= Number.MAX_SAFE_INTEGER) fail('The context generation counter is unavailable.', 'INVALID_REQUEST_CONTEXT');
      this.store.put('requestContextGeneration', basis.threadId, basis.threadId, { generation: previous + 1 });
      return previous + 1;
    }) as number;
    const preparation = freezeRequestValue<RequestPreparationV1>({ version: 1, requestId, contextGeneration, profileId: basis.profileId, threadId: basis.threadId, projectId: basis.projectId, workspaceId: basis.workspaceId, modelId: basis.modelId, accountId: basis.accountId, thinkingLevel: basis.thinkingLevel, promptDigest: requestPromptDigest(prompt), bindingDigest: basis.bindingDigest, grantDigest: basis.grantDigest, sourceCutDigest: digest([basis.sourceCutDigest, requestPromptDigest(prompt), requestPromptDigest(resolvedPrompt)]), createdAt, expiresAt: createdAt + REQUEST_PREPARATION_LIMITS.lifetimeMs });
    const entry: Entry = { preparation, basis: freezeRequestValue(basis), resolvedPrompt, phase: 'preparing' };
    this.entries.set(requestId, entry);
    try {
      this.assertEntry(entry, current());
      await this.hooks.prepare?.(preparation, prompt);
      this.assertEntry(entry, current()); entry.phase = 'ready'; return preparation;
    } catch (error) { this.releaseEntry(entry, 'failed'); throw error; }
  }
  getReady(threadId: string, requestId: string, current: (preparation: RequestPreparationV1) => RequestContextBasis): RequestPreparationV1 {
    const entry = this.entry(requestId);
    if (entry.preparation.threadId !== threadId || entry.phase !== 'ready') fail('This request preparation is not available for changes.');
    this.assertEntry(entry, current(entry.preparation)); return entry.preparation;
  }
  claim(requestId: string, inputId: string, prompt: string, basis: RequestContextBasis): (() => void) | undefined {
    const entry = this.entry(requestId); this.assertEntry(entry, basis);
    if (entry.preparation.promptDigest !== requestPromptDigest(prompt) || entry.phase !== 'ready' && !(entry.phase === 'claimed' && entry.inputId === inputId)) fail('This request preparation was already used or belongs to a different draft.');
    if (entry.phase === 'claimed') return;
    const before = entry.basis;
    entry.inputId = inputId; entry.phase = 'claimed';
    // Only the caller that acquired this claim can undo it, after proving its
    // synchronous input transaction did not commit. Undo admission advances
    // first; a different basis belongs to a newer custody transition.
    let pending = true;
    return () => {
      if (!pending) return;
      pending = false;
      if (this.entries.get(requestId) !== entry || entry.phase !== 'claimed' || entry.inputId !== inputId || entry.basis !== before) return;
      entry.phase = 'ready'; delete entry.inputId;
    };
  }
  assertClaim(requestId: string, inputId: string, prompt: string, basis: RequestContextBasis): RequestPreparationV1 {
    const entry = this.entry(requestId); this.assertEntry(entry, basis);
    if (entry.phase !== 'claimed' || entry.inputId !== inputId || entry.preparation.promptDigest !== requestPromptDigest(prompt)) fail('The accepted input no longer owns this request preparation.');
    return entry.preparation;
  }
  resolvedPrompt(requestId: string, inputId: string): string {
    const entry = this.entry(requestId); if (entry.inputId !== inputId || entry.phase !== 'claimed') fail('The prepared source cut is unavailable.'); return entry.resolvedPrompt;
  }
  /** Only the Service's synchronous accepted-input transaction may advance
   * claimed requests across its own model/epoch/plan lifecycle transition. */
  advanceAdmission(before: RequestContextBasis, after: RequestContextBasis): () => void {
    const stable = (basis: RequestContextBasis) => { const { admissionDigest: _admission, sourceCutDigest: _cut, ...binding } = basis; return digest(binding); };
    if (stable(before) !== stable(after)) fail('The request binding or grants changed during admission.');
    const advanced = freezeRequestValue(after), changes: {entry: Entry; previous: RequestContextBasis; inputId?: string}[] = [];
    for (const entry of this.entries.values()) if (entry.phase === 'claimed' && sameBasis(entry.basis, before)) {
      changes.push({entry, previous: entry.basis, inputId: entry.inputId}); entry.basis = advanced;
    }
    // A failed input transaction can have advanced other accepted claims too.
    // Undo only this exact advance; accepted claims never return to ready.
    let pending = true;
    return () => {
      if (!pending) return;
      pending = false;
      for (const {entry, previous, inputId} of changes) if (this.entries.get(entry.preparation.requestId) === entry && entry.phase === 'claimed' && entry.inputId === inputId && entry.basis === advanced) entry.basis = previous;
    };
  }
  async finalize(requestId: string, input: StartRun, sources: readonly RequestTextSource[], current: () => RequestContextBasis): Promise<Readonly<StartRun>> {
    const entry = this.entry(requestId); this.assertEntry(entry, current());
    if (entry.phase !== 'claimed' || entry.inputId !== input.inputId || input.inputIds?.length !== 1) fail('A prepared request must own exactly one admitted input.');
    entry.phase = 'finalizing';
    try {
      const hookInput = freezeRequestValue(input), extra = await this.hooks.finalize?.(entry.preparation, hookInput);
      this.assertEntry(entry, current()); extra?.assertCurrent?.();
      const supplemental = frameRequestSupplementalSources(extra?.sources ?? []), all = [...sources, ...supplemental];
      if (all.length > 64 || all.some(source => !Number.isSafeInteger(source.revision) || source.revision < 0) || all.reduce((total, source) => total + Buffer.byteLength(source.text), 0) > REQUEST_PREPARATION_LIMITS.requestBytes) fail('The prepared context exceeds its bounded source cut.', 'INVALID_REQUEST_CONTEXT');
      const prompt = input.prompt + supplemental.map(source => source.text).join('');
      this.sourceTexts.clear(); for (const source of all) this.sourceTexts.set(source.id, source.text);
      let receipt: RequestContextV1;
      try {
        const compiled = this.compiler.compile({ owner: { threadId: entry.preparation.threadId, workspaceId: entry.preparation.workspaceId }, modelBinding: { modelId: input.modelId, accountId: input.accountId ?? null }, contextGeneration: entry.preparation.contextGeneration, instructionDigest: digest(all.filter(source => ['SYSTEM', 'INSTRUCTION'].includes(source.category)).map(source => requestPromptDigest(source.text))), toolRegistryDigest: entry.basis.toolRegistryDigest, grantDigest: entry.basis.grantDigest, sources: all.map((source, sequence) => ({ sequence, id: source.id, revision: source.revision, category: source.category, contentRef: source.contentRef ?? 'sha256:' + requestPromptDigest(source.text), inclusionReason: source.inclusionReason })), opaqueNativeBytes: null });
        receipt = freezeRequestValue({ ...compiled, requestId: entry.preparation.requestId, sourceCut: { sequence: this.store.sequence, revisionDigest: digest([compiled.sourceCut.revisionDigest, all.map(source => requestPromptDigest(source.text))]) } });
      } finally { this.sourceTexts.clear(); }
      this.assertEntry(entry, current()); extra?.assertCurrent?.();
      const prepared = freezeRequestValue({ ...input, prompt, requestContext: receipt });
      this.store.internal('request.context.prepared', input.threadId, () => {
        this.store.put('requestContextReceipt', requestId, input.threadId, { status: 'HOST_PREPARED', inputId: input.inputId, runId: input.runId, epoch: input.epoch, preparation: entry.preparation, receipt });
        this.store.db.prepare("DELETE FROM entities WHERE kind='requestContextReceipt' AND rowid NOT IN (SELECT rowid FROM entities WHERE kind='requestContextReceipt' ORDER BY rowid DESC LIMIT ?)").run(REQUEST_PREPARATION_LIMITS.retainedReceipts);
        return { requestId, contextGeneration: entry.preparation.contextGeneration, inputId: input.inputId, segments: receipt.segments.length, utf8Bytes: receipt.budget.utf8Bytes };
      });
      // Store observers may run synchronously after commit. Their changes also
      // invalidate dispatch, and this check remains adjacent to Runtime.start.
      this.assertEntry(entry, current()); extra?.assertCurrent?.(); entry.assertSupplementalCurrent = extra?.assertCurrent; entry.phase = 'finalized'; return prepared;
    } catch (error) { this.releaseEntry(entry, 'failed'); throw error; }
  }
  assertFinalized(requestId: string, input: StartRun, basis: RequestContextBasis): void {
    const entry = this.entry(requestId); this.assertEntry(entry, basis);
    if (entry.phase !== 'finalized' || entry.inputId !== input.inputId || input.requestContext?.requestId !== entry.preparation.requestId || input.requestContext.contextGeneration !== entry.preparation.contextGeneration) fail('The finalized request no longer owns its receipt.');
    entry.assertSupplementalCurrent?.();
  }
  release(requestId: string, reason: RequestPreparationRelease): void { const entry = this.entries.get(requestId); if (entry) this.releaseEntry(entry, reason); }
  dispose(): void { this.closed = true; clearInterval(this.timer); for (const entry of this.entries.values()) this.releaseEntry(entry, 'disposed'); }
}
