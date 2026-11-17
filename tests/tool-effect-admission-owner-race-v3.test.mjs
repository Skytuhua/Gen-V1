const { afterEach, expect, it, vi } = await import('vitest');
const { appendFile, mkdtemp, readFile, rm } = await import('node:fs/promises');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { Service } = await import('../packages/core/service.ts');
const { Store } = await import('../packages/storage/store.ts');
const { HarnessError } = await import('../packages/contracts/index.ts');
const domain = await import('../packages/capabilities/index.ts');

const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'operation-admitted-owner-'));
  const store = new Store(join(root, 'state'));
  let callbacks;
  const starts = [];
  const runtime = {
    configure: value => { callbacks = value; },
    models: async () => [{ id: 'test/model', provider: 'test', name: 'Test' }],
    start: async input => { starts.push(input); },
    followUp: async () => {}, cancel: async () => {}, compact: async () => {},
    history: async () => [], dispose: async () => {},
  };
  const service = new Service(store, runtime, {
    toolEffectFlags: { 'audit.effectsV1': true, 'security.authorityV1': true },
  });
  cleanups.push(async () => { await service.dispose(); store.close(); await rm(root, { recursive: true, force: true }); });
  const command = (type, threadId, payload = {}) =>
    service.command({ id: crypto.randomUUID(), type, threadId, payload });
  const thread = (await command('thread.create')).result;
  await command('message.send', thread.id, { content: 'Prepare one approved action', modelId: 'test/model' });
  await service.deliverOutbox(thread.id);
  const run = starts[0];
  const operation = {
    id: 'admitted-action', threadId: thread.id, revision: 1, kind: 'fixture.external.write',
    description: 'Count the external effect', args: {}, resourceIds: [], preconditions: {},
    status: 'prepared', approved: false, createdAt: new Date().toISOString(),
  };
  store.internal('fixture.operation', thread.id, () => store.put('operation', operation.id, thread.id, operation));
  const externalPath = join(root, 'external-effects.txt');
  // Only the external executor is controlled. It honors cancellation and
  // performs a real file append, so authority denial must prevent the effect.
  vi.spyOn(domain, 'executeDomainOperation').mockImplementation(async (op, context) => {
    if (context.signal.aborted) throw new HarnessError('CANCELLED', 'Executor was cancelled before its effect');
    await appendFile(externalPath, op.id + '\n');
    return { completed: op.id };
  });
  const externalEffects = async () => {
    try { return (await readFile(externalPath, 'utf8')).split('\n').filter(Boolean); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  };
  return { service, store, command, thread, run, operation, externalEffects, get callbacks() { return callbacks; } };
}

it('refuses external dispatch when the approving run settles after admission commits', async () => {
  const x = await fixture();
  const invocationId = 'operation:' + x.operation.id + '@1';
  let changed = false, admittedOwner, ownerAfterSettlement;
  const unsubscribe = x.store.subscribe(event => {
    if (changed || event.type !== 'toolEffect.admitted') return;
    const admitted = x.store.get('toolEffect', invocationId);
    if (!admitted) return;
    changed = true;
    admittedOwner = admitted.owner;
    // Real runtime lifecycle events run after the admission commit but before
    // the dispatcher resumes from its asynchronous executor-module import.
    x.callbacks.onEvent({ ...x.run, type: 'input.processing', inputIds: x.run.inputIds });
    x.callbacks.onEvent({ ...x.run, type: 'assistant.message', content: 'Action prepared', inputIds: x.run.inputIds });
    x.callbacks.onEvent({ ...x.run, type: 'settled' });
    ownerAfterSettlement = x.store.get('thread', x.thread.id);
  });
  try {
    await x.command('operation.approve', x.thread.id, { operationId: x.operation.id, revision: 1 });
    // A duplicate enters behind the original and waits for its recorded outcome.
    await x.service.dispatchOperation(x.operation.id).catch(() => undefined);
    expect(changed).toBe(true);
    expect(admittedOwner).toMatchObject({ threadId: x.thread.id, runId: x.run.runId, epoch: x.run.epoch });
    expect(ownerAfterSettlement).toMatchObject({ runId: null, epoch: x.run.epoch });
    expect(await x.externalEffects()).toEqual([]);
    const effect = x.store.get('toolEffect', invocationId);
    expect(effect.owner).toEqual(admittedOwner);
    expect(effect.state).not.toBe('SUCCEEDED');
    expect(x.store.all('approval', x.thread.id).find(value => value.operationId === x.operation.id).remainingUses).toBe(0);
  } finally { unsubscribe(); }
});

it('dispatches an unchanged admitted owner once and retains the original receipt', async () => {
  const x = await fixture();
  await x.command('operation.approve', x.thread.id, { operationId: x.operation.id, revision: 1 });
  await x.service.dispatchOperation(x.operation.id);
  await x.service.dispatchOperation(x.operation.id);
  expect(await x.externalEffects()).toEqual([x.operation.id]);
  expect(x.store.get('toolEffect', 'operation:' + x.operation.id + '@1')).toMatchObject({
    state: 'SUCCEEDED', owner: { threadId: x.thread.id, runId: x.run.runId, epoch: x.run.epoch },
  });
  expect(x.store.all('approval', x.thread.id).find(value => value.operationId === x.operation.id).remainingUses).toBe(0);
});
