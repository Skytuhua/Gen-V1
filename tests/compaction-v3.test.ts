import { expect, it } from 'vitest';
import fixture from './fixtures/m04-context-v3.json';

type Binding = { generation: number; modelId: string; accountId: string; workspaceId: string; instructionDigest: string; toolRegistryDigest: string; sourceCut: string };
type Candidate = { retained: readonly string[]; toolPairs: readonly { call: string; result: string }[]; status: string };
type CompactionModule = {
  previewCompaction(input: { binding: Binding; unresolvedRefs: readonly string[]; toolPairs: readonly { call: string; result: string }[] }): Candidate;
  evaluateCompactionCandidate(input: {
    candidate: Candidate; expected: Binding; current: Binding;
    cancelled: boolean; retainedTailBytes: number; maxRetainedTailBytes: number; nativeCasAvailable: boolean;
  }): { status: 'ELIGIBLE' | 'DISCARDED' | 'UNSUPPORTED_COMPACTION' };
};
async function loadCompaction(): Promise<CompactionModule> {
  const load = import.meta.glob<CompactionModule>([
    '../packages/core/context-compiler.ts',
    '../packages/core/context-compaction.ts',
  ]);
  const importer = load['../packages/core/context-compaction.ts'] ?? load['../packages/core/context-compiler.ts'];
  if (!importer) throw new Error('M04 loss-aware compaction has not been implemented');
  return importer();
}
const base: Binding = { generation: 8, modelId: 'model-1', accountId: 'account-1', workspaceId: 'workspace-1', instructionDigest: 'instruction-1', toolRegistryDigest: 'tools-1', sourceCut: '1:18' };
const setup = async () => {
  const api = await loadCompaction();
  const input = { binding: base, unresolvedRefs: fixture.compaction.keep, toolPairs: fixture.compaction.toolPairs };
  const candidate = api.previewCompaction(input);
  return { api, input, options: { candidate, expected: base, current: base, cancelled: false, retainedTailBytes: 256, maxRetainedTailBytes: 1024, nativeCasAvailable: true } };
};
it('retains unresolved references and complete tool pairs without rewriting the source', async () => {
  const { input, options } = await setup();
  expect(options.candidate.retained).toEqual(fixture.compaction.keep);
  expect(options.candidate.toolPairs).toEqual(fixture.compaction.toolPairs);
  expect(options.candidate.status).not.toBe('APPLIED');
  expect(input.binding).toEqual(base);
  expect(input.toolPairs).toEqual([{ call: 'call-2', result: 'result-2' }]);
});
it('refuses each binding change even when an adapter is present', async () => {
  const { api, options } = await setup();
  for (const [field, value] of [
    ['generation', 9], ['modelId', 'model-2'], ['accountId', 'account-2'],
    ['workspaceId', 'workspace-2'], ['instructionDigest', 'instruction-2'],
    ['toolRegistryDigest', 'tools-2'], ['sourceCut', '1:17'],
  ] as const) {
    expect(api.evaluateCompactionCandidate({ ...options, current: { ...base, [field]: value } }).status, field).toBe('DISCARDED');
  }
});
it('refuses cancellation, an oversized new tail, and unavailable native compare-and-swap', async () => {
  const { api, options } = await setup();
  expect(api.evaluateCompactionCandidate({ ...options, cancelled: true }).status).toBe('DISCARDED');
  expect(api.evaluateCompactionCandidate({ ...options, retainedTailBytes: 1025 }).status).toBe('DISCARDED');
  expect(api.evaluateCompactionCandidate({ ...options, nativeCasAvailable: false }).status).toBe(fixture.compaction.unsupportedNativeResult);
});

it('reports only eligible old tool-result savings once, without modifying the projected request', async () => {
  const load = import.meta.glob('../packages/core/context-relevance.ts')['../packages/core/context-relevance.ts'];
  if (!load) throw new Error('M04 report-only relevance observer is not implemented');
  type Result = { id: string; inputSequence: number; bytes: number; kind: 'tool-result' | 'user'; completed: boolean; protected: boolean };
  const { createRelevanceObserver } = await load() as { createRelevanceObserver: () => {
    observe(input: { cutId: string; retainedTailStart: number; inspectionBudgetBytes: number; segments: readonly Result[] }): {
      candidateIds: readonly string[]; estimatedSavingsBytes: number;
    } | null;
  } };
  const observer = createRelevanceObserver();
  const segments: readonly Result[] = Object.freeze([
    Object.freeze({ id: 'old', inputSequence: 1, bytes: 100, kind: 'tool-result' as const, completed: true, protected: false }),
    Object.freeze({ id: 'unresolved', inputSequence: 2, bytes: 200, kind: 'tool-result' as const, completed: true, protected: true }),
    Object.freeze({ id: 'user', inputSequence: 3, bytes: 300, kind: 'user' as const, completed: true, protected: false }),
    Object.freeze({ id: 'tail', inputSequence: 9, bytes: 400, kind: 'tool-result' as const, completed: true, protected: false }),
  ]);
  const serialized = JSON.stringify(segments);
  const input = { cutId: 'cut-1', retainedTailStart: 5, inspectionBudgetBytes: 1000, segments };
  expect(observer.observe(input)).toEqual({ candidateIds: ['old'], estimatedSavingsBytes: 100 });
  expect(observer.observe(input)).toBeNull();
  expect(JSON.stringify(segments)).toBe(serialized);
  expect(observer.observe({ ...input, cutId: 'cut-2', inspectionBudgetBytes: 10 })).toEqual({ candidateIds: [], estimatedSavingsBytes: 0 });
});
