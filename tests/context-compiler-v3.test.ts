import { expect, it } from 'vitest';
import fixture from './fixtures/m04-context-v3.json';

type Source = { sequence: number; id: string; revision: number; category: 'SYSTEM' | 'INSTRUCTION' | 'USER' };
type Cut = {
  owner: { threadId: string; workspaceId: string };
  modelBinding: { modelId: string; accountId: string };
  contextGeneration: number;
  instructionDigest: string;
  toolRegistryDigest: string;
  sources: readonly Source[];
};
type Compiled = { segments: readonly { sourceId: string; utf8Bytes: number; tokens: number | null; measurement: string }[] };
type CompilerModule = {
  createContextCompiler(options: { readSource: (source: Source) => string }): { compile(cut: Cut): Compiled };
  calculateNextContextBudget(input: {
    observedInputTokens: number; cacheReadSubsetTokens: number;
    newUnreportedToolTokens: number; reservedOutputTokens: number; turnNeedsAnotherRequest: boolean;
  }): { requiredTokens: number; shouldConsiderCompaction: boolean };
};

async function loadCompiler(): Promise<CompilerModule> {
  // Keep this suite executable before the first implementation exists. Once
  // the module lands, its behavior, not mere availability, must pass below.
  const loaders = import.meta.glob<CompilerModule>('../packages/core/context-compiler.ts');
  const load = loaders['../packages/core/context-compiler.ts'];
  if (!load) throw new Error('M04 context compiler has not been implemented');
  return load();
}
const prefix: Source[] = [
  { sequence: -2, id: 'host-policy@1', revision: 1, category: 'SYSTEM' },
  { sequence: -1, id: 'approved-tool-registry@2', revision: 2, category: 'INSTRUCTION' },
];
const cut = (sequences: readonly number[]): Cut => ({
  owner: { threadId: 'fixture-thread', workspaceId: 'fixture-workspace' },
  modelBinding: { modelId: 'fixture-model', accountId: 'fixture-account' },
  contextGeneration: 1, instructionDigest: 'instructions-1', toolRegistryDigest: 'tools-1',
  sources: [...prefix, ...sequences.map(sequence => ({ sequence, id: 'message-' + sequence, revision: 1, category: 'USER' as const }))],
});
const recorder = async () => {
  const api = await loadCompiler(), reads: Source[] = [];
  const compiler = api.createContextCompiler({ readSource(source) { reads.push(source); return fixture.compiler.unicode.value; } });
  const takeReads = () => reads.splice(0).filter(source => source.category === 'USER').map(source => source.sequence);
  return { compiler, takeReads };
};

it('produces the same stable prefix and reads only an eligible appended tail', async () => {
  const { compiler, takeReads } = await recorder();
  const first = compiler.compile(cut(fixture.compiler.sourceCuts[0]!));
  expect(takeReads()).toEqual(fixture.compiler.expectedReads[0]);
  const second = compiler.compile(cut(fixture.compiler.sourceCuts[1]!));
  expect(takeReads()).toEqual(fixture.compiler.expectedReads[1]);
  expect(second.segments.slice(0, first.segments.length)).toEqual(first.segments);
  expect(second.segments.slice(0, 2).map(source => source.sourceId)).toEqual(fixture.compiler.stablePrefix);
});

it('rebuilds after rewinding the same thread', async () => {
  const { compiler, takeReads } = await recorder();
  compiler.compile(cut(fixture.compiler.sourceCuts[1]!)); takeReads();
  const after = compiler.compile(cut(fixture.compiler.sourceCuts[2]!));
  expect(takeReads()).toEqual(fixture.compiler.expectedReads[2]);
  expect(after.segments.map(source => source.sourceId)).toEqual([...fixture.compiler.stablePrefix, 'message-1', 'message-2']);
});

it.each([
  ['a different account', (old: Cut) => ({ ...old, modelBinding: { ...old.modelBinding, accountId: 'fixture-other-account' } })],
  ['a different model', (old: Cut) => ({ ...old, modelBinding: { ...old.modelBinding, modelId: 'fixture-other-model' } })],
  ['a changed workspace', (old: Cut) => ({ ...old, owner: { ...old.owner, workspaceId: 'fixture-other-workspace' } })],
  ['a new generation', (old: Cut) => ({ ...old, contextGeneration: 2 })],
  ['changed instructions', (old: Cut) => ({ ...old, instructionDigest: 'instructions-2' })],
  ['a changed registry', (old: Cut) => ({ ...old, toolRegistryDigest: 'tools-2' })],
  ['a revised source', (old: Cut) => ({ ...old, sources: old.sources.map(source => source.id === 'message-1' ? { ...source, revision: 2 } : source) })],
] as const)('re-reads existing content after %s', async (_name, change) => {
  const { compiler, takeReads } = await recorder();
  const base = cut([1, 2, 3]);
  compiler.compile(base); takeReads();
  compiler.compile(change(base));
  expect(takeReads()).toContain(1);
});

it('counts UTF-8 bytes without inventing tokens when no tokenizer is provided', async () => {
  const { compiler } = await recorder();
  expect(compiler.compile(cut([1])).segments.at(-1)).toMatchObject({
    sourceId: 'message-1', utf8Bytes: fixture.compiler.unicode.utf8Bytes,
    tokens: null, measurement: 'BYTE_ONLY',
  });
});

it('includes cached input, new tool tokens and output reserve in the next request budget', async () => {
  const { calculateNextContextBudget } = await loadCompiler();
  const { expectedNextRequiredTokens, completeTurnRequestsCompaction, ...observed } = fixture.budget;
  expect(calculateNextContextBudget({ ...observed, turnNeedsAnotherRequest: true }).requiredTokens).toBe(expectedNextRequiredTokens);
  expect(calculateNextContextBudget({ ...observed, turnNeedsAnotherRequest: false }).shouldConsiderCompaction).toBe(completeTurnRequestsCompaction);
});
