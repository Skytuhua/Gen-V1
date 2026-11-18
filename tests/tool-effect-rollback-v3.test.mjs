import { afterEach, expect, it, vi } from 'vitest';
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Service } from '../packages/core/service.ts';
import { Store } from '../packages/storage/store.ts';
import { HarnessError } from '../packages/contracts/index.ts';
import { createEffectAuthenticator } from '../packages/core/host-effect-authenticator.ts';
import * as domain from '../packages/capabilities/index.ts';

const enabled = { 'audit.effectsV1': true, 'security.authorityV1': true };
const cleanups = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); vi.restoreAllMocks(); });
async function fixture(flags = enabled) {
  const root = await mkdtemp(join(tmpdir(), 'effect-rollback-')), output = join(root, 'effects.txt');
  const auth = createEffectAuthenticator(Buffer.alloc(32, 17), '00000000-0000-4000-8000-000000000017');
  let store = new Store(join(root, 'state')), service, release;
  const runtime = () => ({ configure() {}, models: async () => [{ id: 'test/model', provider: 'test', name: 'Test' }],
    start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} });
  const create = flags => new Service(store, runtime(), { toolEffectFlags: flags, toolEffectAuthenticator: auth });
  service = create(flags);
  const stop = async () => { const closing = service.dispose(); release?.(); release = undefined; await closing; };
  cleanups.push(async () => { await stop(); auth.revoke(); store.close(); await rm(root, { recursive: true, force: true }); });
  const command = (type, threadId, payload = {}) => service.command({ id: crypto.randomUUID(), type, threadId, payload });
  const thread = (await command('thread.create')).result;
  await command('message.send', thread.id, { content: 'Prepare owned effects', modelId: 'test/model' });
  await service.deliverOutbox(thread.id);
  // Only the external executor is controlled. Preparation, approval, queue,
  // durable admission, shutdown, Store reopen and recovery remain real.
  vi.spyOn(domain, 'executeDomainOperation').mockImplementation(async (operation, context) => {
    if (context.signal.aborted) throw new HarnessError('CANCELLED_RUN', 'Owned fixture stopped');
    await appendFile(output, operation.id + '\n'); return { completed: operation.id };
  });
  const prepare = label => {
    const owner = store.get('thread', thread.id), ctx = { threadId: thread.id, runId: owner.runId, epoch: owner.epoch };
    return service.context(thread.id, undefined, undefined, ctx).prepareOperation('fixture.external.write', { label }, [], {}, label);
  };
  return { auth, thread, command, prepare, get service() { return service; }, get store() { return store; },
    approve: operation => command('operation.approve', thread.id, { operationId: operation.id, revision: operation.revision }),
    hold: () => { service.operationQueue = new Promise(done => { release = done; }); },
    restart: async flags => { await stop(); store.close(); store = new Store(join(root, 'state')); service = create(flags); },
    effects: async () => { try { return (await readFile(output, 'utf8')).trim().split('\n').filter(Boolean); }
      catch (error) { if (error.code === 'ENOENT') return []; throw error; } },
  };
}
async function history() {
  const x = await fixture(), completed = x.prepare('Completed before rollback');
  await x.approve(completed); await x.service.dispatchOperation(completed.id);
  const consumed = x.store.all('approval').find(value => value.operationId === completed.id);
  expect(consumed.remainingUses).toBe(0); expect(await x.effects()).toEqual([completed.id]);
  const pending = x.prepare('Approved but never dispatched'); x.hold(); await x.approve(pending);
  const unspent = x.store.all('approval').find(value => value.operationId === pending.id);
  expect(unspent.remainingUses).toBe(1); expect(x.store.get('toolEffect', 'operation:' + pending.id + '@1')).toBeNull();
  return { x, completed, consumed, pending, unspent };
}

it.each([['both flags off', {}], ['authority off with audit retained', { 'audit.effectsV1': true }]])
  ('does not replay a protected pending write after restart with %s', async (_label, flags) => {
    const { x, completed, consumed, pending, unspent } = await history();
    const original = x.store.get('toolEffect', 'operation:' + completed.id + '@1');
    await x.restart(flags); await x.service.recover();
    expect(x.store.snapshot().operations.find(value => value.id === pending.id)).toMatchObject({ approved: true, status: 'prepared' });
    await x.command('run.resume', x.thread.id, { modelId: 'test/model' }).catch(() => {});
    const refusal = await x.service.dispatchOperation(pending.id).then(value => ({ value }), error => ({ error }));
    expect(await x.effects()).toEqual([completed.id]);
    expect(refusal.error).toMatchObject({ code: 'EFFECT_ADMISSIONS_DISABLED' });
    expect(x.store.get('approval', consumed.approvalId)).toEqual(consumed);
    expect(x.store.get('approval', unspent.approvalId)).toEqual(unspent);
    expect(x.store.get('toolEffect', 'operation:' + completed.id + '@1')).toEqual(original);
    expect(x.store.get('toolEffect', 'operation:' + pending.id + '@1')).toBeNull();
  });

it('refuses a fresh approval command in a rolled-back protected profile', async () => {
  const { x, completed, pending, unspent } = await history(); await x.restart({}); x.hold();
  await expect(x.approve(pending)).rejects.toMatchObject({ code: 'EFFECT_ADMISSIONS_DISABLED' });
  expect(await x.effects()).toEqual([completed.id]); expect(x.store.get('approval', unspent.approvalId)).toEqual(unspent);
});

it('refuses new tool admissions after a protected Service is reopened with flags off', async () => {
  const x = await fixture(); await x.restart({});
  const current = x.store.get('thread', x.thread.id), ctx = { threadId: current.id, runId: current.runId, epoch: current.epoch };
  // The retained run still matches before recovery. Rollback cannot depend on
  // recovery happening first to prevent this real host tool from mutating data.
  await expect(x.service.tool({ name: 'task_memory', args: { action: 'save', key: 'forbidden', baseRevision: 0, content: 'Must remain absent' } }, ctx))
    .rejects.toMatchObject({ code: 'EFFECT_ADMISSIONS_DISABLED' });
  expect(x.store.all('taskMemory')).toEqual([]);
});

it('records an outstanding submitted effect as uncertain during flags-off recovery', async () => {
  const { x, completed, consumed, pending } = await history();
  const current = x.store.get('thread', x.thread.id), prepared = x.store.get('operation', pending.id);
  x.service.effects.admitOperationDispatch(prepared, current, () => x.store.put('operation', pending.id, pending.threadId, { ...prepared, status: 'running' }));
  const spent = x.store.all('approval').find(value => value.operationId === pending.id);
  expect(spent.remainingUses).toBe(0); await x.restart({}); await x.service.recover();
  expect(await x.effects()).toEqual([completed.id]);
  expect(x.store.get('toolEffect', 'operation:' + pending.id + '@1').state).toBe('UNKNOWN_EXTERNAL_OUTCOME');
  expect(x.store.get('operation', pending.id).status).toBe('unknown');
  expect(x.store.get('approval', consumed.approvalId)).toEqual(consumed); expect(x.store.get('approval', spent.approvalId)).toEqual(spent);
});

it('keeps genuine never-enabled legacy profiles able to dispatch their existing operations', async () => {
  const x = await fixture({}), operation = x.prepare('Legacy control');
  await x.approve(operation); await x.service.dispatchOperation(operation.id);
  expect(await x.effects()).toEqual([operation.id]); expect(x.store.all('approval')).toEqual([]); expect(x.store.all('toolEffect')).toEqual([]);
});

it('can resume protected admission with a fresh signed review after the required flags return', async () => {
  const { x, completed, consumed, pending } = await history();
  await x.restart({}); await x.service.recover(); await x.restart(enabled); await x.service.recover();
  await x.command('run.resume', x.thread.id, { modelId: 'test/model' });
  await expect(x.service.dispatchOperation(pending.id)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
  await x.approve(pending); await x.service.dispatchOperation(pending.id);
  expect(await x.effects()).toEqual([completed.id, pending.id]); expect(x.store.get('approval', consumed.approvalId)).toEqual(consumed);
});

it('recognizes protected history written before the durable rollback policy existed', async () => {
  const { x, completed, pending } = await history();
  x.store.internal('fixture.old-profile', null, () => x.store.remove('toolEffectAdmissionPolicy', 'global'));
  await x.restart({});
  await expect(x.service.dispatchOperation(pending.id)).rejects.toMatchObject({ code: 'EFFECT_ADMISSIONS_DISABLED' });
  expect(await x.effects()).toEqual([completed.id]);
});

it.each([null, { version: 2, mode: 'AUTHENTICATED' }])('does not overwrite or accept malformed retained admission policy %#', async policy => {
  const x = await fixture();
  x.store.internal('fixture.invalid-policy', null, () => x.store.put('toolEffectAdmissionPolicy', 'global', null, policy));
  await x.restart(enabled);
  expect(() => x.prepare('Must not prepare')).toThrowError(/admissions.*disabled/i);
  expect(x.store.get('toolEffectAdmissionPolicy', 'global')).toEqual(policy);
});

it('retains authenticated admission when the authority flag still supplies the complete ledger path', async () => {
  const { x, completed, pending } = await history();
  await x.restart({ 'security.authorityV1': true }); await x.service.recover();
  await x.command('run.resume', x.thread.id, { modelId: 'test/model' });
  await x.approve(pending); await x.service.dispatchOperation(pending.id);
  expect(await x.effects()).toEqual([completed.id, pending.id]);
});
