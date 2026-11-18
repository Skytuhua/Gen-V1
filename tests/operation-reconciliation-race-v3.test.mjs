import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Service } from '../packages/core/service.ts';
import { Store } from '../packages/storage/store.ts';
import * as domain from '../packages/capabilities/index.ts';

const cleanups = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); vi.restoreAllMocks(); });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'reconcile-race-')), store = new Store(join(root, 'state'));
  const runtime = { configure() {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
  const service = new Service(store, runtime), entered = deferred(), release = deferred();
  cleanups.push(async () => { release.resolve(); await service.dispose(); store.close(); await rm(root, { recursive: true, force: true }); });
  const command = (type, threadId, payload = {}) => service.command({ id: crypto.randomUUID(), type, threadId, payload });
  const thread = (await command('thread.create')).result;
  const operation = { id: 'uncertain-action', threadId: thread.id, revision: 1, kind: 'fixture.external.write', args: { target: 'original' }, resourceIds: [], preconditions: {}, description: 'Inspect a retained uncertain effect', status: 'unknown', approved: true, createdAt: new Date().toISOString() };
  store.internal('fixture.uncertain-operation', thread.id, () => store.put('operation', operation.id, thread.id, operation));
  const evidence = join(root, 'observation.json');
  const first = { status: 'unknown', basis: 'unresolved', result: { observation: 'older' }, message: 'Older evidence is inconclusive' };
  await writeFile(evidence, JSON.stringify(first));
  let reads = 0;
  // Control only the read-only evidence producer, after its actual file read.
  // This exercises the real host commit race, not a native path-guard verdict.
  vi.spyOn(domain, 'reconcileDomainOperation').mockImplementation(async (_operation, context) => {
    const observed = JSON.parse(await readFile(evidence, 'utf8'));
    if (++reads === 1) { entered.resolve(context); await release.promise; }
    return observed;
  });
  const execute = vi.spyOn(domain, 'executeDomainOperation');
  const inspect = () => command('operation.reconcile', thread.id, { operationId: operation.id });
  const pending = inspect().then(value => ({ value }), error => ({ error }));
  const context = await Promise.race([entered.promise, pending.then(() => { throw Error('Inspection completed before the controlled observation barrier'); })]);
  return { store, service, thread, operation, command, evidence, first, release, pending, context, execute, inspect };
}

async function refuseStale(x) {
  const operation = x.store.get('operation', x.operation.id), data = x.store.get('data', x.operation.id), sequence = x.store.sequence;
  x.release.resolve();
  const result = await x.pending;
  expect(x.store.get('operation', x.operation.id)).toEqual(operation);
  expect(x.store.get('data', x.operation.id)).toEqual(data);
  expect(x.store.sequence).toBe(sequence);
  expect(result.error).toMatchObject({ code: 'STALE_OPERATION' });
  expect(x.execute).not.toHaveBeenCalled();
}

it.each(['succeeded', 'unknown'])('does not overwrite a newer %s reconciliation with an older observation', async status => {
  const x = await fixture();
  const latest = { status, basis: status === 'succeeded' ? 'recorded-result' : 'unresolved', result: { observation: 'newer' }, message: 'Newer read-only evidence' };
  await writeFile(x.evidence, JSON.stringify(latest));
  expect((await x.inspect()).result).toEqual(latest);
  expect(x.store.get('operation', x.operation.id)).toMatchObject({ status, result: latest.result });
  await refuseStale(x);
});

it('does not attach an old observation to a revised action', async () => {
  const x = await fixture();
  x.store.internal('fixture.action-revised', x.thread.id, () => x.store.put('operation', x.operation.id, x.thread.id, { ...x.operation, revision: 2, args: { target: 'replacement' } }));
  await refuseStale(x);
});

it.each(['runId', 'accountId', 'projectId', 'workspaceId'])('refuses publication after the current %s changes', async field => {
  const x = await fixture();
  x.store.internal('fixture.owner-changed', x.thread.id, () => {
    const current = x.store.get('thread', x.thread.id);
    x.store.put('thread', current.id, current.id, { ...current, [field]: 'different-owner' });
  });
  expect(x.context.signal.aborted).toBe(false);
  await refuseStale(x);
});

it.each(['run.stop', 'thread.archive'])('refuses current publication after %s while preserving history', async type => {
  const x = await fixture();
  await x.command(type, x.thread.id);
  expect(x.context.signal.aborted).toBe(false);
  if (type === 'run.stop') expect(x.store.get('thread', x.thread.id).epoch).toBeGreaterThan(x.thread.epoch);
  else expect(x.store.get('archivedThread', x.thread.id)).toBe(true);
  await refuseStale(x);
});

it('refuses publication after the Service closes with an observation pending', async () => {
  const x = await fixture();
  await x.service.dispose();
  await refuseStale(x);
});

it.each(['unchanged', 'unrelated thread', 'renamed thread'])('records the observation when authority remains current: %s', async control => {
  const x = await fixture();
  if (control === 'unrelated thread') await x.command('thread.create');
  if (control === 'renamed thread') await x.command('thread.rename', x.thread.id, { title: 'New display title' });
  x.release.resolve();
  const result = await x.pending;
  expect(result.error).toBeUndefined();
  expect(result.value.result).toEqual(x.first);
  expect(x.store.get('operation', x.operation.id)).toMatchObject({ status: 'unknown', result: x.first.result });
  expect(x.store.get('data', x.operation.id).value.result).toEqual(x.first.result);
  expect(x.execute).not.toHaveBeenCalled();
});
