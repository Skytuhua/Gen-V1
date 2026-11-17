import { afterEach, expect, it } from 'vitest';
import { rmSync, copyFileSync, readFileSync, cpSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { memoryFixture } from './project-memory-fixture.ts';
import { ProjectMemory } from '../packages/core/project-memory.ts';
import { Store } from '../packages/storage/store.ts';
import { DatabaseSync } from 'node:sqlite';
import { digest } from '../packages/storage/store.ts';
import type { MemorySourceSnapshot } from '../packages/contracts/project-memory.ts';
import { projectMemoryDeletionLedgerPath } from '../packages/core/security.ts';

const fixtures: Awaited<ReturnType<typeof memoryFixture>>[] = [];
async function fixture(beforeMemoryInit?: Parameters<typeof memoryFixture>[0]) { const value = await memoryFixture(beforeMemoryInit); fixtures.push(value); return value; }
afterEach(() => { for (const f of fixtures.splice(0)) { try { f.store.close(); } catch {} rmSync(f.root, { recursive: true, force: true }); } });

it('forgets immediately, invalidates derived references and rejects source replay and stale restoration', async () => {
  const f = await fixture(), item = f.accept('Durably forgotten claim');
  f.store.internal('derive', null, () => f.store.put('projectMemoryDerived', 'index', null, { id: 'index', projectIdentity: f.access.projectIdentity, accountId: f.access.accountId, refs: [{ itemId: item.id, revision: item.revision }], valid: true }));
  const preview = f.memory.forgetPreview(f.access, item.id, item.revision);
  expect(preview.affectedDerivedArtifacts).toEqual(['index']); expect(preview.externalDeletion).toBe('NOT_SUPPORTED');
  f.act({ action: 'forget', itemId: item.id, baseRevision: item.revision });
  expect(f.memory.accepted(f.access)).toEqual([]);
  expect(f.store.get<any>('projectMemoryDerived', 'index').valid).toBe(false);
  expect(() => f.propose('Recreated', [f.ref])).toThrow();
  f.store.internal('old-replay', null, () => f.store.put('projectMemoryItem', item.id, null, { item, profileId: f.access.profileId, projectId: f.access.projectId, accountId: f.access.accountId, lastUsedAt: null }));
  expect(f.memory.accepted(f.access)).toEqual([]);
  expect(() => f.memory.source(f.access, item.id, item.revision, f.ref.digest)).toThrow();
});

it('invalidates derived references to every claim whose shared source becomes excluded', async () => {
  const f = await fixture(), forgotten = f.accept('Forget this source-linked decision'), related = f.accept('Related claim from the same source');
  f.store.internal('derive-shared-source', null, () => f.store.put('projectMemoryDerived', 'related-index', null, { id: 'related-index', projectIdentity: f.access.projectIdentity, accountId: f.access.accountId, refs: [{ itemId: related.id, revision: related.revision }], valid: true }));
  expect(f.memory.forgetPreview(f.access, forgotten.id, forgotten.revision).affectedDerivedArtifacts).toEqual(['related-index']);
  f.act({ action: 'forget', itemId: forgotten.id, baseRevision: forgotten.revision });
  expect(f.memory.accepted(f.access)).toEqual([]);
  expect(f.store.get<any>('projectMemoryDerived', 'related-index').valid).toBe(false);
  expect(f.memory.read(f.access).tombstones[0].affectedDerivedArtifacts).toEqual(['related-index']);
});

it('bounds each physical purge batch even when an item has a long revision history', async () => {
  const f = await fixture(), item = f.accept('Bounded revision purge');
  const row = f.store.get<any>('projectMemoryItem', item.id);
  f.store.internal('many-old-revisions', null, () => {
    for (let revision = 3; revision <= 800; revision++) f.store.put('projectMemoryRevision', `${item.id}@${revision}`, null, { ...row, item: { ...item, revision } });
    f.store.put('projectMemoryItem', item.id, null, { ...row, item: { ...item, revision: 800 } });
  });
  f.act({ action: 'forget', itemId: item.id, baseRevision: 800 });
  const afterRetention = Date.now() + 8 * 86400000;
  expect(f.memory.purge(afterRetention, 1)).toBe(0);
  const remaining = f.store.all('projectMemoryRevision').length;
  expect(remaining).toBeGreaterThan(0); expect(remaining).toBeLessThan(800);
  expect(f.memory.read(f.access).tombstones[0].purgeStatus).toBe('PENDING');
  let completed = 0;
  for (let batch = 0; batch < 10 && !completed; batch++) completed += f.memory.purge(afterRetention, 1);
  expect(completed).toBe(1); expect(f.store.all('projectMemoryRevision')).toEqual([]);
});

it('does not report physical purge complete while a reader retains old WAL pages', async () => {
  const f = await fixture(), item = f.accept('Read-locked claim');
  const reader = new DatabaseSync(join(f.store.dataDir, 'harness.sqlite'), { readOnly: true });
  reader.exec('BEGIN'); reader.prepare('SELECT COUNT(*) FROM entities').get();
  f.act({ action: 'forget', itemId: item.id, baseRevision: item.revision });
  f.store.db.exec('PRAGMA busy_timeout=0');
  try { expect(f.memory.purge(Date.now() + 8 * 86400000)).toBe(0); expect(f.memory.read(f.access).tombstones[0].purgeStatus).toBe('PENDING'); }
  finally { reader.exec('ROLLBACK'); reader.close(); }
  expect(f.memory.purge(Date.now() + 8 * 86400000)).toBe(1);
});

it('keeps deletion fences across restart and a SQLite backup older than Forget', async () => {
  const f = await fixture(), item = f.accept('Never resurrect this claim');
  f.store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const backup = join(f.root, 'old.sqlite'); copyFileSync(join(f.store.dataDir, 'harness.sqlite'), backup);
  f.act({ action: 'forget', itemId: item.id, baseRevision: item.revision });
  const dataDir = f.store.dataDir; f.store.close();
  copyFileSync(backup, join(dataDir, 'harness.sqlite'));
  f.store = new Store(dataDir);
  const memory = new ProjectMemory(f.store, { enabled: () => true }), access = await memory.access('project', 'thread');
  expect(memory.accepted(access)).toEqual([]);
  expect(memory.read(access).tombstones.map(t => t.itemId)).toContain(item.id);
});

it('keeps an authoritative deletion fence outside an in-place full-profile backup restore', async () => {
  const f = await fixture(), item = f.accept('Do not restore this forgotten claim');
  f.store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const backup = join(f.root, 'old-profile'), dataDir = f.store.dataDir;
  cpSync(dataDir, backup, { recursive: true });
  f.act({ action: 'forget', itemId: item.id, baseRevision: item.revision });
  f.store.close();
  for (const name of readdirSync(dataDir)) rmSync(join(dataDir, name), { recursive: true, force: true });
  cpSync(backup, dataDir, { recursive: true });
  f.store = new Store(dataDir);
  const memory = new ProjectMemory(f.store, { enabled: () => true }), access = await memory.access('project', 'thread');
  expect(memory.accepted(access)).toEqual([]);
  expect(memory.read(access).tombstones.map(t => t.itemId)).toContain(item.id);
  expect(() => memory.source(access, item.id, item.revision, f.ref.digest)).toThrow();
});

it.each(['missing', 'replaced', 'corrupt'] as const)('fails memory closed when its enrolled deletion ledger is %s', async damage => {
  const f = await fixture(); f.accept('An enrolled claim');
  const ledger = projectMemoryDeletionLedgerPath(f.store.dataDir);
  if (damage === 'missing') rmSync(ledger);
  if (damage === 'replaced') { renameSync(ledger, `${ledger}.old`); writeFileSync(ledger, '', { mode: 0o600 }); }
  if (damage === 'corrupt') writeFileSync(ledger, 'invalid tombstone\n', { mode: 0o600 });
  expect(() => new ProjectMemory(f.store, { enabled: () => true })).toThrow();
  if (damage !== 'corrupt') expect(() => f.memory.accepted(f.access)).toThrow();
});

it('physically purges permitted local memory copies while preserving tombstones and original task history', async () => {
  const f = await fixture(), item = f.accept('Erase local memory copies');
  f.act({ action: 'forget', itemId: item.id, baseRevision: item.revision });
  expect(f.memory.purge(Date.now() + 8 * 86400000, 10)).toBe(1);
  expect(f.memory.read(f.access).tombstones[0].purgeStatus).toBe('COMPLETE');
  expect(JSON.stringify(f.store.all('projectMemoryRevision'))).not.toContain('Erase local memory copies');
  expect(readFileSync(join(f.store.dataDir, 'harness.sqlite')).includes(Buffer.from('Erase local memory copies'))).toBe(false);
  const wal = join(f.store.dataDir, 'harness.sqlite-wal');
  expect(readFileSync(wal).includes(Buffer.from('Erase local memory copies'))).toBe(false);
  expect(f.store.get<any>('message', 'source').content).toBe('Use SQLite for project persistence.');
  const exported = f.memory.export(f.access);
  expect(exported.redacted).toBe(true); expect(JSON.stringify(exported)).not.toContain('Erase local memory copies');
});

it.each([64, 128])('purges bytes freed by earlier revisions when SQLite starts with secure_delete disabled (retained padding %i)', async paddingBytes => {
  const f = await fixture(store => {
    store.db.exec('PRAGMA secure_delete=OFF');
    // Retained rows vary page placement, including the layout that exposed this on Windows.
    store.internal('fixture-retained-padding', null, () => store.put('fixturePadding', 'padding', null, { text: 'p'.repeat(paddingBytes) }));
  });
  const text = 'Erase local memory copies', item = f.accept(text);
  f.store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  f.act({ action: 'forget', itemId: item.id, baseRevision: item.revision });
  expect(f.memory.purge(Date.now() + 8 * 86400000, 10)).toBe(1);
  expect(f.memory.read(f.access).tombstones[0].purgeStatus).toBe('COMPLETE');
  expect(readFileSync(join(f.store.dataDir, 'harness.sqlite')).includes(Buffer.from(text))).toBe(false);
  expect(readFileSync(join(f.store.dataDir, 'harness.sqlite-wal')).includes(Buffer.from(text))).toBe(false);
  expect(f.store.get<{ text: string }>('fixturePadding', 'padding')?.text).toBe('p'.repeat(paddingBytes));
  expect(f.store.get<{ content: string }>('message', 'source')?.content).toBe('Use SQLite for project persistence.');
});

it.each([64, 128])('scrubs a legacy profile before acknowledging physical purge after reopen (retained padding %i)', async paddingBytes => {
  const f = await fixture();
  // Published M05 wrote these revisions before secure deletion was enabled.
  f.store.db.exec('PRAGMA secure_delete=OFF');
  f.store.internal('fixture-legacy-profile', null, () => {
    for (const row of f.store.db.prepare("SELECT id FROM entities WHERE kind='projectMemoryStorageFormat'").all() as { id: string }[]) f.store.remove('projectMemoryStorageFormat', row.id);
    f.store.put('fixturePadding', 'padding', null, { text: 'p'.repeat(paddingBytes) });
  });
  const text = 'Erase local memory copies', item = f.accept(text), dataDir = f.store.dataDir;
  f.store.close(); f.store = new Store(dataDir);
  const memory = new ProjectMemory(f.store, { enabled: () => true }), access = await memory.access('project', 'thread');
  memory.review(access, { id: `legacy-forget-${paddingBytes}`, type: 'project.memory.review', threadId: access.threadId, payload: { operation: { action: 'forget', itemId: item.id, baseRevision: item.revision } } }, 'local-user');
  expect(memory.purge(Date.now() + 8 * 86400000, 10)).toBe(1);
  expect(memory.read(access).tombstones[0].purgeStatus).toBe('COMPLETE');
  expect(readFileSync(join(dataDir, 'harness.sqlite')).includes(Buffer.from(text))).toBe(false);
  expect(readFileSync(join(dataDir, 'harness.sqlite-wal')).includes(Buffer.from(text))).toBe(false);
  expect(f.store.get<{ text: string }>('fixturePadding', 'padding')?.text).toBe('p'.repeat(paddingBytes));
  expect(f.store.get<{ content: string }>('message', 'source')?.content).toBe('Use SQLite for project persistence.');
});

it('does not complete the legacy storage migration while an old reader pins pre-scrub pages', async () => {
  const f = await fixture();
  f.store.db.exec('PRAGMA secure_delete=OFF');
  f.store.internal('fixture-old-storage', null, () => {
    f.store.remove('projectMemoryStorageFormat', 'secure-delete-v1');
    f.store.put('fixturePadding', 'padding', null, {text: 'p'.repeat(64)});
  });
  const item = f.accept('Legacy text behind a pinned reader'), dataDir = f.store.dataDir;
  f.act({action: 'forget', itemId: item.id, baseRevision: item.revision});
  f.memory.purge(Date.now() + 8 * 86400000);
  f.store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  f.store.close(); f.store = new Store(dataDir);
  const reader = new DatabaseSync(join(dataDir, 'harness.sqlite'), {readOnly: true});
  reader.exec('BEGIN'); reader.prepare('SELECT COUNT(*) FROM entities').get();
  try {
    expect(() => new ProjectMemory(f.store, {enabled: () => true})).toThrow(/migration|reader|checkpoint/i);
    expect(f.store.get('projectMemoryStorageFormat', 'secure-delete-v1')).toBeNull();
  } finally {reader.exec('ROLLBACK'); reader.close();}
  const reopened = new ProjectMemory(f.store, {enabled: () => true});
  expect(reopened.read(await reopened.access('project', 'thread')).tombstones[0].purgeStatus).toBe('COMPLETE');
  expect(readFileSync(join(dataDir, 'harness.sqlite')).includes(Buffer.from('Legacy text behind a pinned reader'))).toBe(false);
});

it('reopens purge work if an old backup restores already-purged local text', async () => {
  const f = await fixture(), item = f.accept('Previously purged backup claim');
  f.store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); const backup = join(f.root, 'pre-purge.sqlite'); copyFileSync(join(f.store.dataDir, 'harness.sqlite'), backup);
  f.act({ action: 'forget', itemId: item.id, baseRevision: item.revision }); f.memory.purge(Date.now() + 8 * 86400000, 10);
  const dataDir = f.store.dataDir; f.store.close(); copyFileSync(backup, join(dataDir, 'harness.sqlite')); f.store = new Store(dataDir);
  const memory = new ProjectMemory(f.store, { enabled: () => true }), access = await memory.access('project', 'thread');
  expect(memory.accepted(access)).toEqual([]); expect(memory.read(access).tombstones[0].purgeStatus).toBe('PENDING');
  expect(memory.purge(Date.now() + 8 * 86400000, 10)).toBe(1);
  expect(JSON.stringify(f.store.all('projectMemoryRevision'))).not.toContain('Previously purged backup claim');
});

it('reopens physical purge when a replay restores only an excluded source snapshot', async () => {
  const f = await fixture(), item = f.accept('Claim whose source must also stay purged');
  const sourceKey = digest(f.ref), source = f.store.get<MemorySourceSnapshot>('projectMemorySource', sourceKey);
  expect(source).not.toBeNull();
  f.act({ action: 'forget', itemId: item.id, baseRevision: item.revision });
  const afterRetention = Date.now() + 8 * 86400000;
  expect(f.memory.purge(afterRetention)).toBe(1);
  expect(f.memory.read(f.access).tombstones[0].purgeStatus).toBe('COMPLETE');
  expect(f.store.get('projectMemorySource', sourceKey)).toBeNull();
  f.store.internal('fixture-source-only-replay', null, () => f.store.put('projectMemorySource', sourceKey, f.ref.ownerThreadId, source));
  expect(f.memory.sourceAvailable(f.access, f.ref)).toBe(false);
  expect(f.memory.accepted(f.access)).toEqual([]);
  expect(f.memory.read(f.access).tombstones[0].purgeStatus).toBe('PENDING');
  expect(f.memory.purge(afterRetention)).toBe(1);
  expect(f.store.get('projectMemorySource', sourceKey)).toBeNull();
  expect(f.memory.read(f.access).tombstones[0].purgeStatus).toBe('COMPLETE');
});
