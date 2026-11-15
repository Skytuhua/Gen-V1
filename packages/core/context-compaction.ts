import type { CompactionBindingV1, CompactionCandidateV1 } from '../contracts/request-context.ts';

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
