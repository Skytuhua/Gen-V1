import {afterEach, expect, it, vi} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store, compactionOwnerKey, type CompactionAttemptRecord} from '../packages/storage/store.ts';
import {Service} from '../packages/core/service.ts';
import {buildServer} from '../apps/server/server.ts';
import type {RuntimeAdapter, Thread} from '../packages/contracts/index.ts';
import type {ModelRequestObservationV1} from '../packages/contracts/model-request.ts';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {for (const cleanup of cleanups.splice(0).reverse()) await cleanup();});
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'compaction-usage-read-'));
  let store = new Store(directory);
  const runtime: RuntimeAdapter = {configure: () => {}, models: async () => [], start: vi.fn(), followUp: vi.fn(), cancel: vi.fn(), compact: vi.fn(), history: async () => [], dispose: async () => {}};
  let service = new Service(store, runtime), app = await buildServer(service, {port: 4317, dev: false});
  const thread: Thread = {id: 'owner', title: 'Owned history', status: 'ready', modelId: 'test/model', thinkingLevel: null, accountId: null,
    projectId: 'project', projectName: 'Project', workspaceId: 'workspace', epoch: 7, runId: null, sessionPath: '/private/owned-session', error: null, createdAt: '2026-11-18T00:00:00Z', updatedAt: '2026-11-18T00:00:00Z'};
  const bind = {generation: 18, modelId: 'test/model', accountId: null, workspaceId: 'workspace', instructionDigest: 'a'.repeat(64), toolRegistryDigest: 'b'.repeat(64), sourceCut: 'c'.repeat(64)};
  const ctx = {threadId: thread.id, runId: 'compaction:candidate', epoch: 6};
  const attempt: CompactionAttemptRecord = {id: 'candidate', threadId: thread.id, ownerKey: compactionOwnerKey(thread, bind.modelId, bind.accountId),
    metadata: {version: 1, candidateId: 'candidate', binding: bind, summaryRef: null, sourceInterval: null, usageObservationRef: null},
    candidate: {binding: bind, status: 'FAILED', retained: [], toolPairs: []}, verdict: 'FAILED'};
  store.command({id: 'admitted-compaction', type: 'run.compact', threadId: thread.id, payload: {}}, () => {
    store.put('thread', thread.id, thread.id, thread); store.put('compactionAttempt', attempt.id, thread.id, attempt);
    return {...ctx, accountId: bind.accountId};
  });
  const observation = (sequence: number, cost: number | null = 0.02): ModelRequestObservationV1 => ({version: 1, requestId: `model-${sequence}`,
    owner: {...ctx, sequence, inputIds: [], phase: 'foreground'}, binding: {providerId: 'test', modelId: bind.modelId, accountId: bind.accountId},
    timings: {queued: 1000, acquired: 1, runtimeReady: 2, requestSent: 3, firstProviderDelta: 4, firstPublicDelta: null, settled: 5, teardownConfirmed: 6},
    usage: {inputTokens: 10, outputTokens: 2, cacheReadTokens: null, cacheWriteTokens: null, cost}, usageConvention: 'provider-reported', measurementSource: 'fixture-broker', outcome: 'failed'});
  const write = (value: ModelRequestObservationV1, patch: Record<string, unknown> = {}) => {
    const id = `compactionModelRequest:${value.requestId}`;
    store.internal('fixture.model-observed', thread.id, () => store.put('compactionModelRequest', id, thread.id, {id, candidateId: attempt.id, ownerKey: attempt.ownerKey, ctx, value, ...patch}));
  };
  const authenticate = async () => {
    const boot = await app.inject({url: '/api/bootstrap', headers: {host: '127.0.0.1:4317'}});
    return {host: '127.0.0.1:4317', cookie: String(boot.headers['set-cookie']).split(';')[0]};
  };
  let headers = await authenticate();
  const url = '/api/threads/owner/compaction/candidate/model-requests';
  cleanups.push(async () => {await app.close(); await service.dispose(); store.close(); rmSync(directory, {recursive: true, force: true, maxRetries: 5});});
  return {get store() {return store;}, runtime, thread, ctx, attempt, observation, write, url,
    get: (suffix = '') => app.inject({url: url + suffix, headers}),
    raw: (path: string, requestHeaders = headers) => app.inject({url: path, headers: requestHeaders}),
    async restart() {await app.close(); await service.dispose(); store.close(); store = new Store(directory); service = new Service(store, runtime); app = await buildServer(service, {port: 4317, dev: false}); headers = await authenticate();},
  };
}

it('returns actual failed, cancelled, unknown and zero measurements after restart without manufacturing a total', async () => {
  const f = await fixture(), zero = f.observation(1, 0), unknown = {...f.observation(2, null), outcome: 'cancelled' as const}, failed = f.observation(3);
  for (const value of [zero, unknown, failed]) f.write(value);
  await f.restart(); const sequence = f.store.sequence, response = await f.get();
  expect(response.statusCode).toBe(200); expect(response.headers['cache-control']).toBe('no-store');
  expect(response.json()).toEqual([failed, unknown, zero]);
  expect(f.store.sequence).toBe(sequence); expect(f.runtime.start).not.toHaveBeenCalled(); expect(f.runtime.compact).not.toHaveBeenCalled();
  expect(f.store.all('modelRequest')).toEqual([]); expect(f.attempt.metadata.usageObservationRef).toBeNull();
});

it('pages older retained observations after bounded ordinary M11 records have gone', async () => {
  const f = await fixture(); for (let i = 1; i <= 66; i++) f.write(f.observation(i));
  const first = await f.get(); expect(first.statusCode).toBe(200); expect(first.json()).toHaveLength(64);
  expect(first.json()[0].requestId).toBe('model-66'); expect(first.json().at(-1).requestId).toBe('model-3');
  f.write({...f.observation(3), timings: {...f.observation(3).timings, firstPublicDelta: 7}});
  const older = await f.get('?beforeRequestId=model-3'); expect(older.statusCode).toBe(200);
  expect(older.json()).toEqual([f.observation(2), f.observation(1)]);
  expect((await f.get('?beforeRequestId=model-1')).json()).toEqual([]);
});

it('keeps an empty measured history unknown and does not mint a zero-cost observation', async () => {
  const f = await fixture(); const response = await f.get(); expect(response.statusCode).toBe(200); expect(response.json()).toEqual([]);
});

it.each([{accountId: 'other'}, {modelId: 'test/other'}, {sessionPath: '/private/other'}, {workspaceId: 'other'}, {projectId: 'other'}])('denies an old candidate after durable owner change %j', async patch => {
  const f = await fixture(); f.write(f.observation(1));
  f.store.internal('fixture.owner-changed', f.thread.id, () => f.store.put('thread', f.thread.id, f.thread.id, {...f.thread, ...patch}));
  expect((await f.get()).statusCode).toBe(404);
});

it('denies archived, missing and cross-thread reads and unauthenticated requests', async () => {
  const f = await fixture(); f.write(f.observation(1));
  expect((await f.raw(f.url, {host: '127.0.0.1:4317', cookie: ''})).statusCode).toBe(401);
  expect((await f.raw(f.url.replace('/owner/', '/foreign/'))).statusCode).toBe(404);
  expect((await f.raw(f.url.replace('/candidate/', '/missing/'))).statusCode).toBe(404);
  f.store.internal('fixture.archived', f.thread.id, () => f.store.put('archivedThread', f.thread.id, f.thread.id, true));
  expect((await f.get()).statusCode).toBe(404);
});

it.each(['', 'model-unknown', 'model-foreign'])('rejects a missing or foreign cursor %j without restarting pagination', async cursor => {
  const f = await fixture(); f.write(f.observation(1)); f.write({...f.observation(2), requestId: 'model-foreign'}, {candidateId: 'other'});
  expect((await f.get('?beforeRequestId=' + cursor)).statusCode).toBe(400);
});

it('rejects repeated cursor query fields', async () => {
  const f = await fixture(); expect((await f.get('?beforeRequestId=a&beforeRequestId=b')).statusCode).toBe(400);
});

it.each(['missing event', 'missing receipt', 'missing receipt result', 'different epoch', 'different account', 'duplicate admission'])('requires the durable maintenance admission witness: %s', async change => {
  const f = await fixture(); f.write(f.observation(1));
  if (change === 'missing event') f.store.db.prepare("DELETE FROM events WHERE type='run.compact'").run();
  else if (change === 'missing receipt') f.store.db.prepare("DELETE FROM receipts WHERE id='admitted-compaction'").run();
  else if (change === 'missing receipt result') f.store.db.prepare("UPDATE receipts SET body=json_remove(body,'$.result') WHERE id='admitted-compaction'").run();
  else if (change === 'duplicate admission') f.store.command({id: 'second-admission', type: 'run.compact', threadId: f.thread.id, payload: {}}, () => ({...f.ctx, accountId: null}));
  else f.store.db.prepare("UPDATE events SET payload=json_set(payload,?,?) WHERE type='run.compact'").run(change === 'different epoch' ? '$.result.epoch' : '$.result.accountId', change === 'different epoch' ? 5 : 'foreign');
  const response = await f.get(); expect(response.statusCode).toBe(400); expect(response.json().error.code).toBe('COMPACTION_USAGE_UNAVAILABLE');
});

it.each(['row identity', 'nested thread', 'nested run', 'nested epoch', 'provider', 'model', 'account', 'invalid cost', 'private ctx'])('refuses malformed or cross-owned stored observations: %s', async change => {
  const f = await fixture(), value = f.observation(1); let patch: Record<string, unknown> = {};
  if (change === 'row identity') patch = {id: 'other'};
  else if (change === 'private ctx') patch = {ctx: {...f.ctx, epoch: f.ctx.epoch + 1}};
  else if (change === 'nested thread') value.owner.threadId = 'other';
  else if (change === 'nested run') value.owner.runId = 'compaction:other';
  else if (change === 'nested epoch') value.owner.epoch++;
  else if (change === 'provider') value.binding.providerId = 'other';
  else if (change === 'model') value.binding.modelId = 'test/other';
  else if (change === 'account') value.binding.accountId = 'other';
  else value.usage.cost = -1;
  f.write(value, patch); const response = await f.get();
  expect(response.statusCode).toBe(400); expect(response.json().error.code).toBe('COMPACTION_USAGE_UNAVAILABLE');
});
