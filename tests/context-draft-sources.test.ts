import { expect, it } from 'vitest';

type Capture = { sourceId: string; revision: string; owner: string; kind: 'FILE' | 'MESSAGE' | 'SESSION'; previewBytes: number; label: string };
type Draft = { owner: string; revision: number; sources: readonly Capture[] };
type Options = { current(source: Capture): (Capture & { canRetainCaptured: boolean }) | null };
type Module = {
  updateDraftSource(draft: Draft, action: { type: 'select' | 'refresh'; capture: Capture } | { type: 'remove'; sourceId: string }): Draft;
  checkDraftSources(draft: Draft, options: Options, keep: readonly string[]): { status: string; sources: readonly Capture[]; needsDecision: readonly string[] };
};
async function module(): Promise<Module> {
  const load = import.meta.glob<Module>('../packages/core/context-draft-sources.ts')['../packages/core/context-draft-sources.ts'];
  if (!load) throw new Error('M04 pinned draft sources are not implemented');
  return load();
}
const old: Capture = { sourceId: 'file-fixture', revision: 'old-revision', owner: 'thread-a', kind: 'FILE', previewBytes: 1024, label: 'notes.md' };
it('preserves the captured revision until the user refreshes or keeps it', async () => {
  const { updateDraftSource, checkDraftSources } = await module();
  const draft = updateDraftSource({ owner: 'thread-a', revision: 0, sources: [] }, { type: 'select', capture: old });
  const changed = { ...old, revision: 'new-revision', canRetainCaptured: true };
  expect(checkDraftSources(draft, { current: () => changed }, [])).toMatchObject({ status: 'NEEDS_DECISION', needsDecision: ['file-fixture'] });
  expect(checkDraftSources(draft, { current: () => changed }, ['file-fixture'])).toMatchObject({ status: 'READY', sources: [old] });
  expect(checkDraftSources(draft, { current: () => ({ ...changed, canRetainCaptured: false }) }, ['file-fixture'])).toMatchObject({ status: 'NEEDS_DECISION' });
  const refreshed = updateDraftSource(draft, { type: 'refresh', capture: { ...old, revision: 'new-revision' } });
  expect(refreshed.sources[0]?.revision).toBe('new-revision');
  expect(draft.sources[0]?.revision).toBe('old-revision');
  const removed = updateDraftSource(refreshed, { type: 'remove', sourceId: old.sourceId });
  expect(removed.sources).toHaveLength(0); expect(refreshed.sources).toHaveLength(1);
});
it('caps references and combined preview bytes, and rejects a lost owner even when keeping', async () => {
  const { updateDraftSource, checkDraftSources } = await module();
  let draft: Draft = { owner: old.owner, revision: 0, sources: [] };
  for (let i = 0; i < 8; i++) draft = updateDraftSource(draft, { type: 'select', capture: { ...old, sourceId: 'file-' + i, previewBytes: 8192 } });
  expect(() => updateDraftSource(draft, { type: 'select', capture: old })).toThrow(/eight/i);
  expect(() => updateDraftSource(draft, { type: 'refresh', capture: { ...old, sourceId: 'file-0', previewBytes: 8193 } })).toThrow(/preview/i);
  expect(() => updateDraftSource(draft, { type: 'select', capture: { ...old, owner: 'foreign' } })).toThrow(/scope/i);
  expect(checkDraftSources(draft, { current: source => ({ ...source, owner: 'foreign', canRetainCaptured: true }) }, ['file-0'])).toMatchObject({ status: 'UNAVAILABLE', sources: [] });
});
