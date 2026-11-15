import { afterEach, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { memoryFixture } from './project-memory-fixture.ts';
import { checkpointBeforeCompaction } from '../packages/core/memory-consolidation.ts';
import { lexicalRecall } from '../packages/core/memory-retrieval.ts';

const fixtures: Awaited<ReturnType<typeof memoryFixture>>[] = [];
async function fixture() {
  const f = await memoryFixture(); fixtures.push(f);
  f.store.internal('fixture-settled-run', 'thread', () => {
    f.store.put('outbox', 'input', 'thread', {id: 'input', threadId: 'thread', messageId: 'source', content: 'Use SQLite for project persistence.', status: 'handled', runId: 'settled-run'});
    f.store.put('message', 'answer', 'thread', {id: 'answer', threadId: 'thread', role: 'assistant', content: 'The persistence decision is SQLite.', runId: 'settled-run', createdAt: new Date().toISOString()});
    f.store.put('message', 'unrelated', 'thread', {id: 'unrelated', threadId: 'thread', role: 'assistant', content: 'Unrelated previous discussion.', runId: 'old-run', createdAt: new Date().toISOString()});
  });
  return f;
}
afterEach(() => { for (const f of fixtures.splice(0)) { f.store.close(); rmSync(f.root, {recursive: true, force: true}); } });
const source = {threadId: 'thread', runId: 'settled-run', epoch: 1};

it('builds a bounded exact settled-run cut, strips private grant metadata, and publishes only proposals once', async () => {
  const f = await fixture(), cut = f.memory.extractionCut(f.access, source);
  expect(cut.sources.map(value => value.ref.sourceId).sort()).toEqual(['answer', 'source']);
  expect(JSON.stringify(cut)).not.toContain('Unrelated previous discussion');
  expect(Buffer.byteLength(JSON.stringify(cut))).toBeLessThanOrEqual(65536);
  const candidates = [{kind: 'DECISION', text: 'Persist project state in SQLite.', sourceRefs: [cut.sources[0].ref]}];
  const result = f.memory.publishExtraction(cut, candidates, 'test-model');
  expect(result.items).toHaveLength(1);
  expect(result.items[0].state).toBe('PROPOSED');
  expect(f.memory.accepted(f.access)).toEqual([]);
  expect(f.memory.publishExtraction(cut, candidates, 'test-model').items).toHaveLength(0);
  expect(f.memory.read(f.access).items).toHaveLength(1);
  expect(JSON.stringify(f.store.eventsAfter(0))).not.toContain('Persist project state in SQLite.');
});

it('rejects publication when its source changes, a new input waits, or the original task restarts', async () => {
  const f = await fixture(), cut = f.memory.extractionCut(f.access, source);
  const candidates = [{kind: 'FACT', text: 'Uses SQLite.', sourceRefs: [cut.sources[0].ref]}];
  f.store.internal('fixture-new-input', 'thread', () => f.store.put('outbox', 'next', 'thread', {id: 'next', threadId: 'thread', content: 'New task', status: 'persisted', runId: null}));
  expect(() => f.memory.publishExtraction(cut, candidates, 'test-model')).toThrow();
  f.store.internal('fixture-remove-input', 'thread', () => f.store.remove('outbox', 'next'));
  f.store.internal('fixture-edit-source', 'thread', () => f.store.put('message', 'answer', 'thread', {...f.store.get<any>('message', 'answer'), content: 'Correction: use PostgreSQL.'}));
  expect(() => f.memory.publishExtraction(cut, candidates, 'test-model')).toThrow();
  f.store.internal('fixture-new-run', 'thread', () => f.store.put('thread', 'thread', 'thread', {...f.store.get<any>('thread', 'thread'), epoch: 2, runId: 'new-run', status: 'working'}));
  expect(() => f.memory.extractionCut(f.access, source)).toThrow();
  expect(f.memory.read(await f.memory.access('project', 'thread')).items).toHaveLength(0);
});

it('excludes secret-bearing messages and cannot publish fabricated, executable or preference candidates', async () => {
  const f = await fixture();
  f.store.internal('fixture-secret', 'thread', () => f.store.put('message', 'secret', 'thread', {id: 'secret', threadId: 'thread', role: 'assistant', content: 'client_secret=do-not-publish-this-credential', runId: 'settled-run', createdAt: new Date().toISOString()}));
  const cut = f.memory.extractionCut(f.access, source);
  expect(cut.sources.some(value => value.ref.sourceId === 'secret')).toBe(false);
  const candidate = {kind: 'FACT', text: 'Uses SQLite.', sourceRefs: [cut.sources[0].ref]};
  expect(() => f.memory.publishExtraction(cut, [{...candidate, sourceRefs: [{...cut.sources[0].ref, digest: 'f'.repeat(64)}]}], 'test-model')).toThrow();
  expect(() => f.memory.publishExtraction(cut, [{...candidate, action: 'delete_files'}], 'test-model')).toThrow();
  expect(() => f.memory.publishExtraction(cut, [{...candidate, kind: 'PREFERENCE'}], 'test-model')).toThrow();
});

it('registers durable compaction checkpoints for immediate Forget invalidation and eventual purge', async () => {
  const f = await fixture(), item = f.accept();
  const outcome = await checkpointBeforeCompaction({access: f.access, snapshot: access => f.memory.consolidationSnapshot(access), capability: {adapterId: 'pi', apiVersion: 2, hostOwned: true}, required: true, persist: checkpoint => f.memory.persistCheckpoint(f.access, checkpoint), compact: () => 'compacted'});
  expect(outcome.result).toBe('compacted');
  const id = outcome.checkpoint!.id;
  expect(f.store.get<any>('projectMemoryDerived', id)).toMatchObject({valid: true, refs: [{itemId: item.id, revision: item.revision}]});
  expect(f.memory.forgetPreview(f.access, item.id, item.revision).affectedDerivedArtifacts).toContain(id);
  f.act({action: 'forget', itemId: item.id, baseRevision: item.revision});
  expect(f.store.get<any>('projectMemoryDerived', id).valid).toBe(false);
  f.memory.purge(Date.now() + 8 * 86400000);
  expect(f.store.get('projectMemoryDerived', id)).toBeNull();
});

it('records use only for exact dispatched revisions, without extending expiry or restoring forgotten memory', async () => {
  const f = await fixture(), item = f.accept();
  const result = lexicalRecall({access: f.access, requestId: 'real-request', contextGeneration: 1, query: 'SQLite persistence', candidates: f.memory.accepted(f.access), tombstones: [], sourceAvailable: ref => f.memory.sourceAvailable(f.access, ref)});
  f.memory.markUsed(f.access, result.recall);
  expect(f.memory.read(f.access).items[0].lastUsedAt).toBeTruthy();
  f.act({action: 'edit', itemId: item.id, baseRevision: item.revision, text: 'Use PostgreSQL instead.'});
  f.memory.markUsed(f.access, result.recall);
  expect(f.store.get<any>('projectMemoryUsage', item.id).revision).toBe(item.revision);
  f.act({action: 'forget', itemId: item.id, baseRevision: item.revision + 1});
  f.memory.markUsed(f.access, result.recall);
  expect(f.memory.accepted(f.access)).toEqual([]);
});

it('requires a distinct authenticated project-only confirmation for reusable preferences and retains concurrent corrections', async () => {
  const f = await fixture(), item = f.propose('Prefer concise comments for this task.');
  expect(() => f.act({action: 'confirm-preference', itemId: item.id, baseRevision: item.revision, text: 'Prefer concise project comments.'} as any)).toThrow();
  f.act({action: 'confirm-preference', itemId: item.id, baseRevision: item.revision, text: 'Prefer concise project comments.', confirmation: 'PROJECT_ONLY'});
  const accepted = f.memory.accepted(f.access)[0].item;
  expect(accepted).toMatchObject({kind: 'PREFERENCE', scope: 'PROJECT', state: 'ACCEPTED', assertedBy: {kind: 'USER', id: 'local-user'}});
  expect(accepted.reviewDecision?.note).toContain('project only');
  f.act({action: 'edit', itemId: item.id, baseRevision: item.revision, text: 'Document every public API.'});
  expect(f.memory.read(f.access).items[0].item.state).toBe('CONFLICT');
  expect(f.memory.accepted(f.access)).toEqual([]);
});

it('reports complete project-scoped auxiliary spend while preserving unknown charges and orphan occupancy', async () => {
  const f = await fixture();
  const record = {profileId: f.access.profileId, projectIdentity: f.access.projectIdentity, accountId: f.access.accountId};
  f.store.internal('fixture-spend', null, () => {
    f.store.put('projectMemoryAuxiliaryUsage', 'known', null, {...record, phase: 'EXTRACTION', settled: true, usage: {modelCalls: 1, inputTokens: 20, outputTokens: 10, cost: 0.03}});
    f.store.put('projectMemoryAuxiliaryUsage', 'orphan', null, {...record, phase: 'EXTRACTION', settled: false, usage: {modelCalls: 1, inputTokens: null, outputTokens: null, cost: null}});
    f.store.put('projectMemoryAuxiliaryUsage', 'local-index', null, {...record, phase: 'CONSOLIDATION', settled: true, usage: {modelCalls: 0, inputTokens: null, outputTokens: null, cost: null}});
    f.store.put('projectMemoryAuxiliaryUsage', 'other-account', null, {...record, accountId: 'other', phase: 'EXTRACTION', settled: true, usage: {modelCalls: 1, inputTokens: 1000, outputTokens: 1000, cost: 100}});
  });
  expect(f.memory.usage(f.access)).toMatchObject({extraction: {modelCalls: 2, cost: null, pending: 1}, consolidation: {modelCalls: 0, cost: 0, pending: 0}, retrieval: {requests: 0, injectedBytes: 0, latencyMs: 0}});
});
