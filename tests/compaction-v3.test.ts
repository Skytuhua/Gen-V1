import { expect, it, vi } from 'vitest';
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

it('mints one candidate identity per exact binding and validates the strict metadata sidecar', async () => {
  const { createCompactionCandidateRegistry } = await loadCompaction() as unknown as {
    createCompactionCandidateRegistry: (options?: { mintId?: () => string }) => {
      prepare(input: { binding: Binding; unresolvedRefs: readonly string[]; toolPairs: readonly { call: string; result: string }[]; sourceInterval?: { firstSeq: number; lastSeq: number } | null }): { metadata: { version: 1; candidateId: string; binding: Binding; summaryRef: string | null; sourceInterval: { firstSeq: number; lastSeq: number } | null; usageObservationRef: string | null }; candidate: Candidate };
      markReady(candidateId: string): void; markDiscarded(candidateId: string): void;
      get(candidateId: string): { metadata: { candidateId: string; sourceInterval: { firstSeq: number; lastSeq: number } | null }; candidate: Candidate } | undefined;
    };
  };
  const minted: string[] = [];
  const registry = createCompactionCandidateRegistry({ mintId: () => { const id = 'candidate-' + minted.length; minted.push(id); return id; } });
  const input = { binding: base, unresolvedRefs: fixture.compaction.keep, toolPairs: fixture.compaction.toolPairs, sourceInterval: { firstSeq: 1, lastSeq: 18 } };
  const first = registry.prepare(input);
  expect(first.metadata).toEqual({ version: 1, candidateId: 'candidate-0', binding: base, summaryRef: null, sourceInterval: { firstSeq: 1, lastSeq: 18 }, usageObservationRef: null });
  expect(first.candidate.status).toBe('PREPARING');
  const retry = registry.prepare(input);
  expect(retry.metadata.candidateId).toBe('candidate-0');
  expect(minted).toEqual(['candidate-0']);
  registry.markReady('candidate-0');
  expect(registry.prepare(input).metadata.candidateId).toBe('candidate-0');
  expect(registry.get('candidate-0')?.candidate.status).toBe('READY');
  registry.markDiscarded('candidate-0');
  const next = registry.prepare(input);
  expect(next.metadata.candidateId).toBe('candidate-1');
  expect(registry.get('candidate-0')?.candidate.status).toBe('DISCARDED');
  expect(() => registry.prepare({ ...input, sourceInterval: { firstSeq: -1, lastSeq: 18 } })).toThrow(RangeError);
  expect(() => registry.prepare({ ...input, sourceInterval: { firstSeq: 4, lastSeq: 3 } })).toThrow(RangeError);
  expect(() => registry.prepare({ ...input, sourceInterval: { firstSeq: 1.5, lastSeq: 18 } })).toThrow(RangeError);
  registry.markDiscarded('candidate-1');
  expect(registry.prepare({ ...input, sourceInterval: null }).metadata.sourceInterval).toBeNull();
  expect(registry.get('candidate-0')?.metadata.sourceInterval).toEqual({ firstSeq: 1, lastSeq: 18 });
});

it('never invokes the native apply operation for a stale or cancelled binding', async () => {
  const { applyCompactionCandidate } = await loadCompaction() as unknown as {
    applyCompactionCandidate: (input: {
      candidate: Candidate; expected: Binding; current: Binding; cancelled: boolean;
      retainedTailBytes: number; maxRetainedTailBytes: number;
      nativeApply?: (candidate: Candidate) => Promise<{ generation: number; usageObservationRef: string }>;
    }) => Promise<{ status: string; generation?: number; usageObservationRef?: string }>;
  };
  const { options } = await setup();
  let applied = 0;
  const nativeApply = async () => { applied++; return { generation: base.generation + 1, usageObservationRef: 'usage-observation-1' }; };
  const stale = await applyCompactionCandidate({ ...options, current: { ...base, generation: base.generation + 1 }, nativeApply });
  expect(stale.status).toBe('DISCARDED');
  expect(applied).toBe(0);
  expect((await applyCompactionCandidate({ ...options, cancelled: true, nativeApply })).status).toBe('DISCARDED');
  expect(applied).toBe(0);
  expect((await applyCompactionCandidate({ ...options, retainedTailBytes: 2048, nativeApply })).status).toBe('DISCARDED');
  expect(applied).toBe(0);
  expect((await applyCompactionCandidate({ ...options })).status).toBe('UNSUPPORTED_COMPACTION');
  const fresh = await applyCompactionCandidate({ ...options, nativeApply });
  expect(fresh).toMatchObject({ status: 'APPLIED', generation: base.generation + 1, usageObservationRef: 'usage-observation-1' });
  expect(applied).toBe(1);
  const failed = await applyCompactionCandidate({ ...options, nativeApply: async () => { applied++; throw new Error('native apply failed'); } });
  expect(failed.status).toBe('FAILED');
  expect(applied).toBe(2);
  expect(options.candidate.status).toBe('READY');
});

it('discards precompute candidates on rewind, instruction change, cancellation and an oversized tail, keeping failed calls in cost accounting', async () => {
  const { createPrecomputeExperiment } = await loadCompaction() as unknown as {
    createPrecomputeExperiment: (options: {
      enabled: () => boolean; maxRetainedTailBytes: number;
      summarize: (input: { binding: Binding; prefixDigest: string }) => Promise<{ summaryRef: string; costBytes: number }>;
    }) => {
      prepare(input: { binding: Binding; prefixDigest: string }): { status: string };
      use(input: { current: Binding; prefixDigest: string; retainedTailBytes: number }): { status: string; summaryRef?: string };
      cancel(): void;
      accounting(): { attempts: number; failed: number; discarded: number; costBytes: number };
    };
  };
  let enabled = true, failNext = false;
  const experiment = createPrecomputeExperiment({
    enabled: () => enabled, maxRetainedTailBytes: 1024,
    summarize: async ({ prefixDigest }) => {
      if (failNext) { failNext = false; throw Object.assign(new Error('background call failed'), { costBytes: 7 }); }
      return { summaryRef: 'summary:' + prefixDigest, costBytes: 11 };
    },
  });
  expect(experiment.use({ current: base, prefixDigest: 'prefix-1', retainedTailBytes: 0 }).status).toBe('NOT_READY');
  expect(experiment.prepare({ binding: base, prefixDigest: 'prefix-1' }).status).toBe('STARTED');
  expect(experiment.prepare({ binding: base, prefixDigest: 'prefix-1' }).status).toBe('ALREADY_RUNNING');
  await vi.waitFor(() => expect(experiment.use({ current: base, prefixDigest: 'prefix-1', retainedTailBytes: 256 }).status).toBe('READY'));
  expect(experiment.use({ current: base, prefixDigest: 'prefix-1', retainedTailBytes: 256 }).summaryRef).toBe('summary:prefix-1');
  expect(experiment.use({ current: { ...base, sourceCut: '1:19' }, prefixDigest: 'prefix-1', retainedTailBytes: 256 }).status).toBe('DISCARDED');
  expect(experiment.prepare({ binding: base, prefixDigest: 'prefix-1' }).status).toBe('STARTED');
  await vi.waitFor(() => expect(experiment.use({ current: base, prefixDigest: 'prefix-1', retainedTailBytes: 0 }).status).toBe('READY'));
  expect(experiment.use({ current: { ...base, instructionDigest: 'instruction-2' }, prefixDigest: 'prefix-1', retainedTailBytes: 0 }).status).toBe('DISCARDED');
  expect(experiment.prepare({ binding: base, prefixDigest: 'prefix-1' }).status).toBe('STARTED');
  await vi.waitFor(() => expect(experiment.use({ current: base, prefixDigest: 'prefix-1', retainedTailBytes: 0 }).status).toBe('READY'));
  expect(experiment.use({ current: { ...base, modelId: 'model-2' }, prefixDigest: 'prefix-1', retainedTailBytes: 0 }).status).toBe('DISCARDED');
  expect(experiment.prepare({ binding: base, prefixDigest: 'prefix-1' }).status).toBe('STARTED');
  await vi.waitFor(() => expect(experiment.use({ current: base, prefixDigest: 'prefix-1', retainedTailBytes: 0 }).status).toBe('READY'));
  expect(experiment.use({ current: base, prefixDigest: 'prefix-1', retainedTailBytes: 1025 }).status).toBe('DISCARDED');
  expect(experiment.prepare({ binding: base, prefixDigest: 'prefix-2' }).status).toBe('STARTED');
  experiment.cancel();
  expect(experiment.use({ current: base, prefixDigest: 'prefix-2', retainedTailBytes: 0 }).status).toBe('NOT_READY');
  failNext = true;
  expect(experiment.prepare({ binding: base, prefixDigest: 'prefix-3' }).status).toBe('STARTED');
  await vi.waitFor(() => expect(experiment.accounting().failed).toBe(1));
  expect(experiment.use({ current: base, prefixDigest: 'prefix-3', retainedTailBytes: 0 }).status).toBe('NOT_READY');
  enabled = false;
  expect(experiment.prepare({ binding: base, prefixDigest: 'prefix-4' }).status).toBe('DISABLED');
  const accounting = experiment.accounting();
  expect(accounting.attempts).toBe(6);
  expect(accounting.failed).toBe(1);
  expect(accounting.discarded).toBeGreaterThanOrEqual(5);
  expect(accounting.costBytes).toBe(5 * 11 + 7);
});

it('gates the shadow relevance phase on an approved auxiliary budget and a fixed six-second timeout', async () => {
  type ShadowCut = { cutId: string; retainedTailStart: number; inspectionBudgetBytes: number; segments: readonly { id: string; inputSequence: number; bytes: number; kind: string; completed: boolean; protected: boolean }[] };
  type ShadowResult = { status: 'OBSERVER_UNAVAILABLE' | 'COMPLETED' | 'TIMED_OUT' | 'FAILED' | 'CANCELLED'; observation: { candidateIds: readonly string[]; estimatedSavingsBytes: number } | null };
  const { createShadowRelevancePhase, SHADOW_OBSERVER_TIMEOUT_MS } = await import('../packages/core/context-relevance.ts') as {
    createShadowRelevancePhase: (options: {
      approval: { modelId: string; accountId: string; budgetCalls: number } | null;
      observe: (cut: ShadowCut) => Promise<{ candidateIds: readonly string[]; estimatedSavingsBytes: number }>;
      schedule?: (callback: () => void, ms: number) => unknown; unschedule?: (handle: unknown) => void;
    }) => { run(cut: ShadowCut): Promise<ShadowResult>; cancel(): void };
    SHADOW_OBSERVER_TIMEOUT_MS: number;
  };
  expect(SHADOW_OBSERVER_TIMEOUT_MS).toBe(6000);
  const cut = Object.freeze({ cutId: 'shadow-cut-1', retainedTailStart: 5, inspectionBudgetBytes: 1000, segments: Object.freeze([
    Object.freeze({ id: 'old', inputSequence: 1, bytes: 100, kind: 'tool-result', completed: true, protected: false }),
  ]) });
  const serialized = JSON.stringify(cut);
  let calls = 0;
  const observe = async () => { calls++; return { candidateIds: ['old'], estimatedSavingsBytes: 100 }; };
  const unapproved = createShadowRelevancePhase({ approval: null, observe });
  expect(await unapproved.run(cut)).toMatchObject({ status: 'OBSERVER_UNAVAILABLE', observation: null });
  expect(calls).toBe(0);
  const scheduled: Array<() => void> = [];
  const phase = createShadowRelevancePhase({
    approval: { modelId: 'aux-model', accountId: 'aux-account', budgetCalls: 1 }, observe,
    schedule: (callback) => { scheduled.push(callback); return scheduled.length; }, unschedule: () => {},
  });
  const pending = phase.run(cut);
  expect(calls).toBe(1);
  scheduled[0]!();
  expect(await pending).toMatchObject({ status: 'TIMED_OUT', observation: null });
  expect(await phase.run(cut)).toMatchObject({ status: 'OBSERVER_UNAVAILABLE', observation: null });
  expect(calls).toBe(1);
  const failing = createShadowRelevancePhase({
    approval: { modelId: 'aux-model', accountId: 'aux-account', budgetCalls: 2 },
    observe: async () => { calls++; throw new Error('observer failed'); },
  });
  expect(await failing.run(cut)).toMatchObject({ status: 'FAILED', observation: null });
  expect(JSON.stringify(cut)).toBe(serialized);
  const cancelled = createShadowRelevancePhase({
    approval: { modelId: 'aux-model', accountId: 'aux-account', budgetCalls: 2 },
    observe: () => new Promise(() => {}),
    schedule: () => 1, unschedule: () => {},
  });
  const running = cancelled.run(cut);
  cancelled.cancel();
  expect(await running).toMatchObject({ status: 'CANCELLED', observation: null });
  const healthy = createShadowRelevancePhase({ approval: { modelId: 'aux-model', accountId: 'aux-account', budgetCalls: 2 }, observe });
  expect(await healthy.run(cut)).toEqual({ status: 'COMPLETED', observation: { candidateIds: ['old'], estimatedSavingsBytes: 100 } });
  expect(JSON.stringify(cut)).toBe(serialized);
  const once = createShadowRelevancePhase({ approval: { modelId: 'aux-model', accountId: 'aux-account', budgetCalls: 3 }, observe });
  const before = calls;
  expect(await once.run(cut)).toMatchObject({ status: 'COMPLETED' });
  expect(await once.run(cut)).toMatchObject({ status: 'OBSERVER_UNAVAILABLE', observation: null });
  expect(calls).toBe(before + 1);
  expect(await once.run({ ...cut, cutId: 'shadow-cut-2' })).toMatchObject({ status: 'COMPLETED' });
  expect(calls).toBe(before + 2);
  expect(await once.run({ ...cut, cutId: '' })).toMatchObject({ status: 'OBSERVER_UNAVAILABLE', observation: null });
  expect(calls).toBe(before + 2);
});

it.each([
  ['an explicit default account', {accountId: null}, true],
  ['a named account', {accountId: 'aux-account'}, true],
  ['a missing account', {}, false],
  ['an undefined account', {accountId: undefined}, false],
  ['an empty account', {accountId: ''}, false],
  ['a non-string account', {accountId: 1}, false],
] as const)('requires an explicit approved shadow route for %s', async (_label, account, available) => {
  const {createShadowRelevancePhase} = await import('../packages/core/context-relevance.ts');
  const observe = vi.fn(async () => ({candidateIds: ['old'], estimatedSavingsBytes: 100}));
  // Malformed runtime objects deliberately exercise the admission boundary.
  const approval = {modelId: 'aux-model', budgetCalls: 1, ...account} as Parameters<typeof createShadowRelevancePhase>[0]['approval'];
  const phase = createShadowRelevancePhase({approval, observe});
  const cut = Object.freeze({cutId: 'account-cut', retainedTailStart: 5, inspectionBudgetBytes: 1000, segments: Object.freeze([
    Object.freeze({id: 'old', inputSequence: 1, bytes: 100, kind: 'tool-result', completed: true, protected: false}),
  ])});
  const before = JSON.stringify(cut);
  expect(await phase.run(cut)).toEqual(available
    ? {status: 'COMPLETED', observation: {candidateIds: ['old'], estimatedSavingsBytes: 100}}
    : {status: 'OBSERVER_UNAVAILABLE', observation: null});
  expect(observe).toHaveBeenCalledTimes(available ? 1 : 0);
  expect(await phase.run({...cut, cutId: 'next-account-cut'})).toEqual({status: 'OBSERVER_UNAVAILABLE', observation: null});
  expect(observe).toHaveBeenCalledTimes(available ? 1 : 0);
  expect(JSON.stringify(cut)).toBe(before);
});

it.each([
  ['a missing model', {}],
  ['an undefined model', {modelId: undefined}],
  ['an empty model', {modelId: ''}],
  ['a non-string model', {modelId: 1}],
] as const)('starts no shadow call for %s', async (_label, model) => {
  const {createShadowRelevancePhase} = await import('../packages/core/context-relevance.ts');
  const observe = vi.fn(async () => ({candidateIds: [], estimatedSavingsBytes: 0}));
  const approval = {accountId: null, budgetCalls: 1, ...model} as Parameters<typeof createShadowRelevancePhase>[0]['approval'];
  const phase = createShadowRelevancePhase({approval, observe});
  expect(await phase.run({cutId: 'invalid-model-cut', retainedTailStart: 1, inspectionBudgetBytes: 0, segments: []}))
    .toEqual({status: 'OBSERVER_UNAVAILABLE', observation: null});
  expect(observe).not.toHaveBeenCalled();
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

it.each(['completed', 'failed'] as const)('ignores a %s shadow result from an expired cut while a newer cut is pending', async outcome => {
  const { createShadowRelevancePhase } = await import('../packages/core/context-relevance.ts');
  type Observation = { candidateIds: readonly string[]; estimatedSavingsBytes: number };
  const timers: Array<() => void> = [];
  const completions: Array<{ resolve(value: Observation): void; reject(error: Error): void }> = [];
  const phase = createShadowRelevancePhase({
    approval: { modelId: 'aux-model', accountId: 'aux-account', budgetCalls: 2 },
    observe: () => new Promise<Observation>((resolve, reject) => completions.push({ resolve, reject })),
    schedule: callback => { timers.push(callback); return timers.length; }, unschedule: () => {},
  });
  const cut = { cutId: 'expired', retainedTailStart: 5, inspectionBudgetBytes: 1000, segments: [] };
  const expired = phase.run(cut);
  timers[0]!();
  expect(await expired).toEqual({ status: 'TIMED_OUT', observation: null });
  const current = phase.run({ ...cut, cutId: 'current' });
  let settled = false;
  void current.then(() => { settled = true; });
  if (outcome === 'completed') completions[0]!.resolve({ candidateIds: ['expired-only'], estimatedSavingsBytes: 900 });
  else completions[0]!.reject(new Error('Expired observer failed'));
  await Promise.resolve();
  await Promise.resolve();
  expect(settled).toBe(false);
  completions[1]!.resolve({ candidateIds: ['current-only'], estimatedSavingsBytes: 40 });
  expect(await current).toEqual({ status: 'COMPLETED', observation: { candidateIds: ['current-only'], estimatedSavingsBytes: 40 } });
});

it('ignores an old timeout callback after the next shadow cut starts', async () => {
  const { createShadowRelevancePhase } = await import('../packages/core/context-relevance.ts');
  const timers: Array<() => void> = [];
  const completions: Array<(value: { candidateIds: readonly string[]; estimatedSavingsBytes: number }) => void> = [];
  const phase = createShadowRelevancePhase({
    approval: { modelId: 'aux-model', accountId: 'aux-account', budgetCalls: 2 },
    observe: () => new Promise(resolve => completions.push(resolve)),
    schedule: callback => { timers.push(callback); return timers.length; }, unschedule: () => {},
  });
  const cut = { cutId: 'first', retainedTailStart: 5, inspectionBudgetBytes: 1000, segments: [] };
  const first = phase.run(cut);
  completions[0]!({ candidateIds: ['first-only'], estimatedSavingsBytes: 20 });
  expect((await first).status).toBe('COMPLETED');
  const current = phase.run({ ...cut, cutId: 'current' });
  timers[0]!();
  completions[1]!({ candidateIds: ['current-only'], estimatedSavingsBytes: 40 });
  expect(await current).toEqual({ status: 'COMPLETED', observation: { candidateIds: ['current-only'], estimatedSavingsBytes: 40 } });
});
