import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const binding = { owner: { threadId: 'thread', workspaceId: 'workspace' }, modelBinding: { modelId: 'model', accountId: 'account' },
  bindingDigest: 'a'.repeat(64), instructionDigest: 'b'.repeat(64), toolRegistryDigest: 'c'.repeat(64), grantDigest: 'd'.repeat(64) };
const source = (sequence: number, generation = 1, category = 'USER') => ({ sequence, id: `native:${generation}:${sequence}`, revision: 1, category, utf8Bytes: 17 + sequence, sha256: hash(['message', sequence]) });
function cut(sources: ReturnType<typeof source>[], previous?: { sourceCount: number; revisionDigest: string }, generation = 1) {
  const reusedSources = previous?.sourceCount ?? 0, schemaDigest = 'e'.repeat(64), change = previous ? sources.length === reusedSources ? 'UNCHANGED' : 'APPEND' : 'RESET';
  const tail = sources.slice(reusedSources);
  return { version: 1, status: 'AVAILABLE', bindingDigest: binding.bindingDigest, schemaDigest, generation,
    previousDigest: previous?.revisionDigest ?? null, revisionDigest: hash([binding.bindingDigest, schemaDigest, generation, sources.map(item => [item.sha256, item.utf8Bytes, item.category])]),
    sourceCount: sources.length, sourceBytes: sources.reduce((sum, item) => sum + item.utf8Bytes, 0), reusedSources, inspectedSources: sources.length, sources: tail, change,
    newToolResults: previous ? tail.filter(item => item.category === 'TOOL').length : null,
    newToolResultBytes: previous ? tail.filter(item => item.category === 'TOOL').reduce((sum, item) => sum + item.utf8Bytes, 0) : null };
}
async function fixture() {
  const loaders = import.meta.glob('../packages/runtime-hermes/context.ts');
  const load = loaders['../packages/runtime-hermes/context.ts'];
  if (!load) throw new Error('Original native context compiler is not connected');
  const module = await load() as typeof import('../packages/runtime-hermes/context.ts');
  return module.createNativeContextCompiler();
}

it('compiles only eligible native tail metadata without a second transcript or invented provider roles', async () => {
  const compiler = await fixture(), initial = cut([source(0, 1, 'SYSTEM'), source(1)]), first = compiler.accept(binding, initial);
  expect(first.projection).toMatchObject({ source: 'ORIGINAL_ACP_MESSAGES', sourceCount: 2, reusedSources: 0, compiledSources: 2, measurement: 'BYTE_ONLY' });
  const next = cut([source(0, 1, 'SYSTEM'), source(1), source(2, 1, 'TOOL')], initial), second = compiler.accept(binding, next);
  expect(second.projection).toMatchObject({ sourceCount: 3, reusedSources: 2, compiledSources: 1, inspectedSources: 3, newToolResults: 1, newToolResultBytes: 19 });
  expect(second.receipt?.segments.slice(0, 2)).toEqual(first.receipt?.segments);
  expect(second.receipt?.segments).toHaveLength(3); expect(second.receipt?.budget).toEqual({ utf8Bytes: 54, tokens: null, measurement: 'BYTE_ONLY' });
  expect(second.receipt?.nativeContext).toBeNull();
  expect(compiler.accept(binding, cut([source(0, 1, 'SYSTEM'), source(1), source(2, 1, 'TOOL')], next)).projection).toMatchObject({ compiledSources: 0, change: 'UNCHANGED' });
});

it.each(['model', 'account', 'workspace', 'instruction', 'grant'] as const)('denies append reuse across changed %s custody', async field => {
  const compiler = await fixture(), initial = cut([source(0)]); compiler.accept(binding, initial);
  const changed = structuredClone(binding);
  if (field === 'model') changed.modelBinding.modelId = 'other';
  if (field === 'account') changed.modelBinding.accountId = 'other';
  if (field === 'workspace') changed.owner.workspaceId = 'other';
  if (field === 'instruction') changed.instructionDigest = 'f'.repeat(64);
  if (field === 'grant') changed.grantDigest = 'f'.repeat(64);
  expect(() => compiler.accept(changed, cut([source(0), source(1)], initial))).toThrow();
});

it('rebuilds a rewind or native compaction generation and does not call old tools new results', async () => {
  const compiler = await fixture(); compiler.accept(binding, cut([source(0), source(1, 1, 'TOOL'), source(2)]));
  const next = compiler.accept(binding, cut([source(0, 2)], undefined, 2));
  expect(next.projection).toMatchObject({ generation: 2, reusedSources: 0, compiledSources: 1, newToolResults: null, newToolResultBytes: null });
  expect(next.receipt?.segments).toHaveLength(1);
});

it.each(['digest', 'prefix', 'sequence', 'bytes', 'rawContent'] as const)('refuses a malformed native %s cut without damaging the last valid projection', async change => {
  const compiler = await fixture(), initial = cut([source(0)]); compiler.accept(binding, initial);
  const next = cut([source(0), source(1)], initial) as ReturnType<typeof cut>;
  if (change === 'digest') next.revisionDigest = '0'.repeat(64);
  if (change === 'prefix') next.previousDigest = '0'.repeat(64);
  if (change === 'sequence') next.sources[0].sequence = 7;
  if (change === 'bytes') next.sourceBytes = 0;
  if (change === 'rawContent') (next.sources[0] as {content?:string}).content = 'PRIVATE_TRANSCRIPT';
  expect(() => compiler.accept(binding, next)).toThrow();
  expect(compiler.accept(binding, cut([source(0), source(1)], initial)).projection).toMatchObject({ compiledSources: 1 });
});

it('bounds visible sources and retires cache after an unavailable native cut', async () => {
  const compiler = await fixture(), initial = cut(Array.from({ length: 100 }, (_, index) => source(index)));
  const value = compiler.accept(binding, initial);
  expect(value.projection?.sources).toHaveLength(32); expect(value.projection?.omittedSources).toBe(68);
  expect(compiler.accept(binding, { version: 1, status: 'UNAVAILABLE', reason: 'SOURCE_LIMIT' })).toEqual({ receipt: null, projection: null, unavailableReason: 'SOURCE_LIMIT' });
  expect(() => compiler.accept(binding, cut([...initial.sources, source(100)], initial))).toThrow();
});
