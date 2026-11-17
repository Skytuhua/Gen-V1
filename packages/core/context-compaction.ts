import { randomUUID } from 'node:crypto';
import type { CompactionBindingV1, CompactionCandidateV1, CompactionMetadataV1 } from '../contracts/request-context.ts';

const sameBinding = (a: CompactionBindingV1, b: CompactionBindingV1) =>
  a.generation === b.generation && a.modelId === b.modelId && a.accountId === b.accountId &&
  a.workspaceId === b.workspaceId && a.instructionDigest === b.instructionDigest &&
  a.toolRegistryDigest === b.toolRegistryDigest && a.sourceCut === b.sourceCut;
const exactBytes = (value: number) => Number.isSafeInteger(value) && value >= 0;

/** No native call or transcript mutation; previews preserve references, not grants. */
export function previewCompaction(input: {
  binding: CompactionBindingV1; unresolvedRefs: readonly string[];
  toolPairs: readonly { call: string; result: string }[];
}): CompactionCandidateV1 {
  return Object.freeze({ binding: Object.freeze({ ...input.binding }), retained: Object.freeze([...input.unresolvedRefs]),
    toolPairs: Object.freeze(input.toolPairs.map(pair => Object.freeze({ ...pair }))), status: 'READY' });
}

/** Eligibility does not indicate application. Only a verified native CAS may apply it. */
export function evaluateCompactionCandidate(input: {
  candidate: CompactionCandidateV1; expected: CompactionBindingV1; current: CompactionBindingV1;
  cancelled: boolean; retainedTailBytes: number; maxRetainedTailBytes: number; nativeCasAvailable: boolean;
}): { status: 'ELIGIBLE' | 'DISCARDED' | 'UNSUPPORTED_COMPACTION' } {
  if (input.cancelled || input.candidate.status !== 'READY' ||
    !sameBinding(input.candidate.binding, input.expected) || !sameBinding(input.expected, input.current) ||
    !exactBytes(input.retainedTailBytes) || !exactBytes(input.maxRetainedTailBytes) ||
    input.retainedTailBytes > input.maxRetainedTailBytes) return { status: 'DISCARDED' };
  return { status: input.nativeCasAvailable ? 'ELIGIBLE' : 'UNSUPPORTED_COMPACTION' };
}

const bindingKey = (binding: CompactionBindingV1) => JSON.stringify([binding.generation, binding.modelId, binding.accountId,
  binding.workspaceId, binding.instructionDigest, binding.toolRegistryDigest, binding.sourceCut]);
const validInterval = (interval: { firstSeq: number; lastSeq: number } | null | undefined): interval is { firstSeq: number; lastSeq: number } | null => {
  if (interval == null) return true;
  if (!Number.isSafeInteger(interval.firstSeq) || !Number.isSafeInteger(interval.lastSeq) || interval.firstSeq < 0 || interval.lastSeq < 0 || interval.firstSeq > interval.lastSeq)
    throw new RangeError('Compaction source interval must be nonnegative integers with firstSeq <= lastSeq');
  return true;
};
const terminal = (status: CompactionCandidateV1['status']) => status === 'DISCARDED' || status === 'APPLIED' || status === 'FAILED';

/** Host candidate registry: one identity per exact binding, minted once and retained across retries. */
export function createCompactionCandidateRegistry(options: { mintId?: () => string } = {}) {
  const mint = options.mintId ?? randomUUID;
  const byId = new Map<string, { metadata: CompactionMetadataV1; candidate: CompactionCandidateV1 }>();
  const activeByBinding = new Map<string, string>();
  const entryFor = (candidateId: string) => {
    const entry = byId.get(candidateId);
    if (!entry) throw new Error('Unknown compaction candidate');
    return entry;
  };
  const transition = (candidateId: string, status: CompactionCandidateV1['status']) => {
    const entry = entryFor(candidateId);
    if (terminal(entry.candidate.status)) throw new Error('Compaction candidate is already terminal');
    entry.candidate = Object.freeze({ ...entry.candidate, status });
    if (terminal(status)) activeByBinding.delete(bindingKey(entry.metadata.binding));
  };
  return {
    prepare(input: { binding: CompactionBindingV1; unresolvedRefs: readonly string[];
      toolPairs: readonly { call: string; result: string }[]; sourceInterval?: { firstSeq: number; lastSeq: number } | null;
    }): { metadata: CompactionMetadataV1; candidate: CompactionCandidateV1 } {
      if (!Number.isSafeInteger(input.binding.generation) || input.binding.generation < 0 || !input.binding.modelId || !input.binding.workspaceId ||
        !input.binding.instructionDigest || !input.binding.toolRegistryDigest || !input.binding.sourceCut)
        throw new Error('Invalid compaction binding identity');
      const interval = input.sourceInterval ?? null;
      validInterval(interval);
      const key = bindingKey(input.binding);
      const active = activeByBinding.get(key);
      if (active !== undefined) return entryFor(active);
      const candidateId = mint();
      if (!candidateId || byId.has(candidateId)) throw new Error('Compaction candidate identity must be unique');
      const preview = previewCompaction({ binding: input.binding, unresolvedRefs: input.unresolvedRefs, toolPairs: input.toolPairs });
      const candidate = Object.freeze({ ...preview, status: 'PREPARING' as const });
      const metadata: CompactionMetadataV1 = Object.freeze({ version: 1 as const, candidateId, binding: Object.freeze({ ...input.binding }),
        summaryRef: null, sourceInterval: interval ? Object.freeze({ ...interval }) : null, usageObservationRef: null });
      const entry = { metadata, candidate };
      byId.set(candidateId, entry);
      activeByBinding.set(key, candidateId);
      return entry;
    },
    markReady(candidateId: string) { transition(candidateId, 'READY'); },
    markDiscarded(candidateId: string) { transition(candidateId, 'DISCARDED'); },
    markFailed(candidateId: string) { transition(candidateId, 'FAILED'); },
    markApplied(candidateId: string) { transition(candidateId, 'APPLIED'); },
    get(candidateId: string) { return byId.get(candidateId); },
  };
}

/** Host apply gate. A stale, cancelled or oversized binding never reaches the native apply operation.
 * Without a native adapter this reports UNSUPPORTED_COMPACTION; it never emulates a native reset. */
export async function applyCompactionCandidate(input: {
  candidate: CompactionCandidateV1; expected: CompactionBindingV1; current: CompactionBindingV1;
  cancelled: boolean; retainedTailBytes: number; maxRetainedTailBytes: number;
  nativeApply?: (candidate: CompactionCandidateV1) => Promise<{ generation: number; usageObservationRef: string }>;
}): Promise<{ status: 'APPLIED'; generation: number; usageObservationRef: string } | { status: 'DISCARDED' | 'UNSUPPORTED_COMPACTION' | 'FAILED' }> {
  const eligibility = evaluateCompactionCandidate({ candidate: input.candidate, expected: input.expected, current: input.current,
    cancelled: input.cancelled, retainedTailBytes: input.retainedTailBytes, maxRetainedTailBytes: input.maxRetainedTailBytes,
    nativeCasAvailable: input.nativeApply !== undefined });
  if (eligibility.status !== 'ELIGIBLE') return { status: eligibility.status };
  try {
    const applied = await input.nativeApply!(input.candidate);
    if (!Number.isSafeInteger(applied.generation) || applied.generation <= input.current.generation || !applied.usageObservationRef)
      return { status: 'FAILED' };
    return { status: 'APPLIED', generation: applied.generation, usageObservationRef: applied.usageObservationRef };
  } catch { return { status: 'FAILED' }; }
}

/** Experimental precompute coordinator: one background summary from a fixed prefix, OFF unless the host
 * enables it. Summarization is injected; this module never calls a model or mutates active context. */
export function createPrecomputeExperiment(options: {
  enabled: () => boolean; maxRetainedTailBytes: number;
  summarize: (input: { binding: CompactionBindingV1; prefixDigest: string }) => Promise<{ summaryRef: string; costBytes: number }>;
}) {
  let slot: { binding: CompactionBindingV1; prefixDigest: string; token: number; summaryRef: string | null } | null = null;
  let tokens = 0;
  const accounting = { attempts: 0, failed: 0, discarded: 0, costBytes: 0 };
  const discard = () => { if (slot) { slot = null; accounting.discarded++; } };
  return {
    prepare(input: { binding: CompactionBindingV1; prefixDigest: string }): { status: 'STARTED' | 'ALREADY_RUNNING' | 'DISABLED' } {
      if (!options.enabled()) return { status: 'DISABLED' };
      if (slot) return { status: 'ALREADY_RUNNING' };
      if (!input.prefixDigest || !Number.isSafeInteger(input.binding.generation) || input.binding.generation < 0) throw new Error('Invalid precompute prefix or binding');
      const token = ++tokens;
      slot = { binding: { ...input.binding }, prefixDigest: input.prefixDigest, token, summaryRef: null };
      accounting.attempts++;
      void options.summarize({ binding: { ...input.binding }, prefixDigest: input.prefixDigest }).then(result => {
        if (typeof result.costBytes === 'number' && Number.isSafeInteger(result.costBytes) && result.costBytes >= 0) accounting.costBytes += result.costBytes;
        if (slot?.token !== token) return;
        if (result.summaryRef) slot.summaryRef = result.summaryRef; else discard();
      }, (cause: unknown) => {
        const cost = (cause as { costBytes?: unknown } | null)?.costBytes;
        if (typeof cost === 'number' && Number.isSafeInteger(cost) && cost >= 0) accounting.costBytes += cost;
        accounting.failed++;
        if (slot?.token === token) slot = null;
      });
      return { status: 'STARTED' };
    },
    use(input: { current: CompactionBindingV1; prefixDigest: string; retainedTailBytes: number }): { status: 'READY'; summaryRef: string } | { status: 'DISCARDED' | 'NOT_READY' } {
      if (!slot || slot.summaryRef === null) return { status: 'NOT_READY' };
      if (!sameBinding(slot.binding, input.current) || slot.prefixDigest !== input.prefixDigest ||
        !exactBytes(input.retainedTailBytes) || !exactBytes(options.maxRetainedTailBytes) || input.retainedTailBytes > options.maxRetainedTailBytes) {
        discard();
        return { status: 'DISCARDED' };
      }
      return { status: 'READY', summaryRef: slot.summaryRef };
    },
    cancel() { tokens++; discard(); },
    accounting() { return { ...accounting }; },
  };
}
