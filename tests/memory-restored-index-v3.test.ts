import { afterEach, expect, it } from 'vitest';
import { copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { memoryFixture } from './project-memory-fixture.ts';
import { Store } from '../packages/storage/store.ts';
import { ProjectMemory } from '../packages/core/project-memory.ts';

const fixtures: Awaited<ReturnType<typeof memoryFixture>>[] = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) { fixture.store.close(); rmSync(fixture.root, { recursive: true, force: true }); } });
async function fixture() { const value = await memoryFixture(); fixtures.push(value); return value; }
function index(f: Awaited<ReturnType<typeof fixture>>, refs: { itemId: string; revision: number }[]) {
  return { id: 'same-index', projectIdentity: f.access.projectIdentity, accountId: f.access.accountId, refs, valid: true };
}

it('recomputes collateral source dependencies when a backup restores an older index payload', async () => {
  const f = await fixture(), forgotten = f.accept('Forgotten decision'), related = f.accept('Related decision from the same source');
  const oldIndex = index(f, [{ itemId: related.id, revision: related.revision }]);
  f.store.internal('fixture.old-index', null, () => f.store.put('projectMemoryDerived', oldIndex.id, null, oldIndex));
  f.store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const backup = join(f.root, 'before-index-rebuild.sqlite'); copyFileSync(join(f.store.dataDir, 'harness.sqlite'), backup);
  // A later consolidation no longer uses this source, so the index is outside
  // the original Forget preview. The older backup still contains those refs.
  f.store.internal('fixture.rebuilt-index', null, () => f.store.put('projectMemoryDerived', oldIndex.id, null, index(f, [])));
  expect(f.memory.forgetPreview(f.access, forgotten.id, forgotten.revision).affectedDerivedArtifacts).toEqual([]);
  f.act({ action: 'forget', itemId: forgotten.id, baseRevision: forgotten.revision });
  const dataDir = f.store.dataDir; f.store.close(); copyFileSync(backup, join(dataDir, 'harness.sqlite')); f.store = new Store(dataDir);
  const memory = new ProjectMemory(f.store, { enabled: () => true }), access = await memory.access('project', 'thread');
  expect(memory.accepted(access)).toEqual([]);
  expect(memory.sourceAvailable(access, f.ref)).toBe(false);
  expect(f.store.get<typeof oldIndex>('projectMemoryDerived', oldIndex.id)?.valid).toBe(false);
  expect(memory.read(access).tombstones[0].affectedDerivedArtifacts).toContain(oldIndex.id);
  expect(memory.purge(Date.now() + 8 * 86400000)).toBe(1);
  expect(f.store.get('projectMemoryDerived', oldIndex.id)).toBeNull();
  const again = new ProjectMemory(f.store, { enabled: () => true });
  expect(again.read(await again.access('project', 'thread')).tombstones[0].affectedDerivedArtifacts).toContain(oldIndex.id);
});

it('invalidates a restored collateral index even when its deletion projection already matches the ledger', async () => {
  const f = await fixture(), forgotten = f.accept('Deleted claim'), related = f.accept('Another claim sharing the source');
  f.act({ action: 'forget', itemId: forgotten.id, baseRevision: forgotten.revision });
  expect(f.memory.read(f.access).tombstones[0].affectedDerivedArtifacts).toEqual([]);
  const restoredIndex = index(f, [{ itemId: related.id, revision: related.revision }]);
  f.store.internal('fixture.derived-only-replay', null, () => f.store.put('projectMemoryDerived', restoredIndex.id, null, restoredIndex));
  const memory = new ProjectMemory(f.store, { enabled: () => true }), access = await memory.access('project', 'thread');
  expect(f.store.get<typeof restoredIndex>('projectMemoryDerived', restoredIndex.id)?.valid).toBe(false);
  expect(memory.read(access).tombstones[0].affectedDerivedArtifacts).toContain(restoredIndex.id);
  expect(memory.purge(Date.now() + 8 * 86400000)).toBe(1);
  expect(f.store.get('projectMemoryDerived', restoredIndex.id)).toBeNull();
});

it('rechecks restored collateral references in the same host before a physical purge batch', async () => {
  const f = await fixture(), forgotten = f.accept('Forgotten source'), related = f.accept('Source dependent claim');
  f.act({ action: 'forget', itemId: forgotten.id, baseRevision: forgotten.revision });
  const restoredIndex = index(f, [{ itemId: related.id, revision: related.revision }]);
  f.store.internal('fixture.live-derived-replay', null, () => f.store.put('projectMemoryDerived', restoredIndex.id, null, restoredIndex));
  expect(f.memory.purge(Date.now() + 8 * 86400000)).toBe(1);
  expect(f.store.get('projectMemoryDerived', restoredIndex.id)).toBeNull();
  expect(f.memory.read(f.access).tombstones[0].affectedDerivedArtifacts).toContain(restoredIndex.id);
});
