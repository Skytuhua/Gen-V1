import { afterEach, expect, it } from 'vitest';
import { rmSync, renameSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { registeredCapabilityFlags } from '../packages/core/capability-flags.ts';
import { memoryFixture } from './project-memory-fixture.ts';
import { memoryItemV1Schema } from '../packages/contracts/project-memory.ts';
import { lexicalRecall } from '../packages/core/memory-retrieval.ts';
import { MemoryConsolidator } from '../packages/core/memory-consolidation.ts';

const fixtures: Awaited<ReturnType<typeof memoryFixture>>[] = [];
async function fixture() { const value = await memoryFixture(); fixtures.push(value); return value; }
afterEach(() => { for (const f of fixtures.splice(0)) { f.store.close(); rmSync(f.root, { recursive: true, force: true }); } });

it('registers only the two host-owned M05 capability flags, disabled by default', () => {
  const flags = registeredCapabilityFlags();
  expect(Object.keys(flags).filter(key => key.startsWith('memory.')).sort()).toEqual(['memory.externalRecallExperimentV1', 'memory.projectV1']);
  expect(flags).toMatchObject({ 'memory.projectV1': false, 'memory.externalRecallExperimentV1': false });
});

it('keeps proposals out of accepted memory and records exact user acceptance without source truth inflation', async () => {
  const f = await fixture(), proposal = f.propose();
  expect(proposal.state).toBe('PROPOSED'); expect(proposal.assertedBy.kind).toBe('AGENT');
  expect(f.memory.accepted(f.access)).toEqual([]);
  f.act({ action: 'accept', itemId: proposal.id, baseRevision: 1 });
  const accepted = f.memory.accepted(f.access)[0].item;
  expect(accepted.revision).toBe(2); expect(accepted.reviewDecision?.userId).toBe('local-user');
  expect(accepted.sourceRefs).toEqual(proposal.sourceRefs); expect(accepted.assertedBy.kind).toBe('AGENT');
  expect(memoryItemV1Schema.parse(accepted)).toEqual(accepted);
});

it('binds identity to physical enrollment and survives only a display rename', async () => {
  const f = await fixture(); f.accept();
  f.store.internal('rename', null, () => f.store.put('workspaceProject', 'project', null, { ...f.store.get<any>('workspaceProject', 'project'), name: 'Renamed' }));
  const renamed = await f.memory.access('project', 'thread');
  expect(renamed.projectIdentity).toBe(f.access.projectIdentity); expect(f.memory.read(renamed).projectName).toBe('Renamed');
  renameSync(f.path, f.path + '-old'); mkdirSync(f.path);
  await expect(f.memory.access('project', 'thread')).rejects.toThrow();
  expect(() => f.memory.read(f.access)).toThrow();
});

it('rejects another account, unapproved source thread, fabricated source and oversized or secret payloads', async () => {
  const f = await fixture(), item = f.accept();
  expect(() => f.memory.read({ ...f.access, accountId: 'someone-else' })).toThrow();
  expect(() => f.propose('Claim', [{ ...f.ref, ownerThreadId: 'other' }])).toThrow();
  expect(() => f.propose('Claim', [{ ...f.ref, digest: 'f'.repeat(64) }])).toThrow();
  expect(() => f.propose('界'.repeat(683))).toThrow();
  expect(() => f.propose('api_key=supersecretcredentialvalue1234567890')).toThrow();
  expect(() => f.propose('-----BEGIN PRIVATE KEY----- unsafe')).toThrow();
  expect(f.memory.read(f.access).items).toHaveLength(1);
  expect(f.memory.source(f.access, item.id, item.revision, f.ref.digest).content).toBe('Use SQLite for project persistence.');
});

it('captures exact settled source revisions and refuses an actively changing task', async () => {
  const f = await fixture(), item = f.accept();
  f.store.internal('change-source', 'thread', () => f.store.put('message', 'source', 'thread', { ...f.store.get<any>('message', 'source'), content: 'Changed API' }));
  expect(f.memory.source(f.access, item.id, item.revision, f.ref.digest).content).toBe('Use SQLite for project persistence.');
  f.store.internal('start', 'thread', () => f.store.put('thread', 'thread', 'thread', { ...f.store.get<any>('thread', 'thread'), runId: 'active', status: 'working' }));
  const active = await f.memory.access('project', 'thread');
  expect(() => f.memory.captureMessage(active, 'source')).toThrow(/settled/i);
});

it('supersedes a correction and retains both concurrent edits as an explicit conflict', async () => {
  const f = await fixture(), original = f.accept();
  f.act({ action: 'edit', itemId: original.id, baseRevision: original.revision, text: 'Use PostgreSQL for the changed API.' });
  expect(f.memory.accepted(f.access)[0].item.text).toContain('PostgreSQL');
  expect(f.memory.accepted(f.access)[0].item.assertedBy).toEqual({ kind: 'USER', id: 'local-user' });
  f.act({ action: 'edit', itemId: original.id, baseRevision: original.revision, text: 'Keep SQLite for offline use.' });
  expect(f.memory.accepted(f.access)).toEqual([]);
  const row = f.memory.read(f.access).items[0];
  expect(row.item.state).toBe('CONFLICT');
  expect(row.conflictRevisions.map(i => i.text)).toEqual(expect.arrayContaining(['Use PostgreSQL for the changed API.', 'Keep SQLite for offline use.']));
  f.act({ action: 'resolve', itemId: original.id, baseRevision: row.item.revision, survivingRevisions: [row.conflictRevisions[0].revision], note: 'Operator selects the online storage requirement.' });
  expect(f.memory.accepted(f.access)).toHaveLength(1);
});

it('keeps memory text out of mutation receipts and permits retained record review after disabling injection', async () => {
  const f = await fixture(), item = f.accept('Unique private project decision');
  const command = { id: randomUUID(), type: 'project.memory.review', threadId: 'thread', payload: { operation: { action: 'expire', itemId: item.id, baseRevision: item.revision } } };
  const receipt = f.memory.review(f.access, command, 'local-user');
  expect(f.memory.review(f.access, command, 'local-user')).toEqual(receipt);
  expect(JSON.stringify(f.store.eventsAfter(0))).not.toContain('Unique private project decision');
  expect(JSON.stringify(receipt)).not.toContain('Unique private project decision');
  expect(f.memory.accepted(f.access)).toEqual([]);
});

it('connects host revisions to local recall and a reference index without reviving corrected or forgotten text', async () => {
  const f = await fixture(), item = f.accept();
  const consolidator = new MemoryConsolidator(f.store, { snapshot: access => ({ access, items: f.memory.accepted(access).map(row => row.item), watermark: f.memory.watermark(access), tombstones: f.memory.tombstones(access) }) });
  const initial = await consolidator.consolidate(f.access); expect(initial.status).toBe('UPDATED'); expect(initial.index?.refs).toEqual([{itemId: item.id, revision: item.revision}]);
  expect((await consolidator.consolidate(f.access)).status).toBe('UNCHANGED');
  f.act({ action: 'edit', itemId: item.id, baseRevision: item.revision, text: 'Use Postgres for project persistence.' });
  expect(f.store.get<any>('projectMemoryDerived', initial.index!.id).valid).toBe(false);
  const recall = () => lexicalRecall({ access: f.access, requestId: 'fixture-request', contextGeneration: 1, query: 'project persistence', candidates: f.memory.accepted(f.access), tombstones: f.memory.tombstones(f.access), sourceAvailable: ref => f.memory.sourceAvailable(f.access, ref) });
  expect(recall().injection).toContain('Postgres'); expect(recall().injection).not.toContain('Use SQLite');
  expect((await consolidator.consolidate(f.access)).index?.refs).toEqual([{itemId: item.id, revision: item.revision + 1}]);
  f.act({ action: 'forget', itemId: item.id, baseRevision: item.revision + 1 });
  expect(recall().items).toEqual([]); expect((await consolidator.consolidate(f.access)).index?.refs).toEqual([]);
});

it('opens the exact reference when identical source bytes came from distinct messages', async () => {
  const f = await fixture();
  f.store.internal('fixture-source', 'thread', () => f.store.put('message', 'second-source', 'thread', { ...f.store.get<any>('message', 'source'), id: 'second-source' }));
  const second = f.memory.captureMessage(f.access, 'second-source'), item = f.propose('Use the recorded decision.', [f.ref, second]);
  expect(second.digest).toBe(f.ref.digest);
  expect(() => f.memory.source(f.access, item.id, 1, second.digest)).toThrow();
  expect(f.memory.source(f.access, item.id, 1, second.digest, second).ref.sourceId).toBe('second-source');
});

it('allows disabling project memory after a selected source conversation becomes ineligible', async () => {
  const f = await fixture();
  f.store.internal('fixture-source-archived', null, () => f.store.put('archivedThread', 'thread', null, { id: 'thread' }));
  const access = await f.memory.access('project', 'other'), view = f.memory.read(access);
  expect(view.sourceThreadIds).toEqual(['thread']);
  expect(view.eligibleThreads.map(thread => thread.id)).not.toContain('thread');
  f.act({ action: 'configure', enabled: false, baseRevision: view.configRevision, sourceThreadIds: view.sourceThreadIds }, access);
  expect(f.memory.read(access).enabled).toBe(false);
  expect(f.memory.accepted(access)).toEqual([]);
});
