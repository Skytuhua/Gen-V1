const { afterEach, expect, it, vi } = await import('vitest');
const { appendFile, mkdtemp, readFile, rm } = await import('node:fs/promises');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { Service } = await import('../packages/core/service.ts');
const { Store } = await import('../packages/storage/store.ts');
const domain = await import('../packages/capabilities/index.ts');

const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'operation-late-progress-'));
  const store = new Store(join(root, 'state'));
  const starts = [], entered = deferred(), release = deferred();
  let callbacks;
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
  cleanups.push(async () => {
    release.resolve();
    await service.dispose(); store.close();
    await rm(root, { recursive: true, force: true });
  });
  const command = (type, threadId, payload = {}) =>
    service.command({ id: crypto.randomUUID(), type, threadId, payload });
  const thread = (await command('thread.create')).result;
  await command('message.send', thread.id, { content: 'Run the approved action', modelId: 'test/model' });
  await service.deliverOutbox(thread.id);
  const run = starts[0], externalPath = join(root, 'external-effects.txt');
  const operation = {
    id: 'late-progress-action', threadId: thread.id, revision: 1, kind: 'fixture.external.write',
    description: 'Observe an already submitted effect', args: {}, resourceIds: [], preconditions: {},
    status: 'prepared', approved: false, createdAt: new Date().toISOString(),
  };
  store.internal('fixture.operation', thread.id, () => store.put('operation', operation.id, thread.id, operation));
  let callbackRan = false, callbackError;
  vi.spyOn(domain, 'executeDomainOperation').mockImplementation(async (op, context) => {
    // The external effect is already observed before cancellation. A buffered
    // process callback may still arrive afterward; it must not revive progress.
    await appendFile(externalPath, op.id + '\n');
    context.progress('Submitted before cancellation', { completed: 0, total: 1 });
    entered.resolve(context);
    await release.promise;
    callbackRan = true;
    try { context.progress('Late executor completion', { completed: 1, total: 1 }); }
    catch (error) { callbackError = error; throw error; }
    return { completed: op.id, externalEffects: 1 };
  });
  return {
    store, service, command, thread, run, operation, entered, release, starts,
    externalEffects: async () => (await readFile(externalPath, 'utf8')).split('\n').filter(Boolean),
    callbackState: () => ({ ran: callbackRan, error: callbackError }),
    get callbacks() { return callbacks; },
  };
}

it.each([
  { mode: 'stop', revoked: true },
  { mode: 'stop then archive', revoked: true },
  { mode: 'settle then archive', revoked: true },
  { mode: 'unchanged', revoked: false },
])('handles a late operation callback after $mode without losing the historical effect', async ({ mode, revoked }) => {
  const x = await fixture();
  await x.command('operation.approve', x.thread.id, { operationId: x.operation.id, revision: 1 });
  const context = await x.entered.promise;
  const waiting = x.service.dispatchOperation(x.operation.id).then(value => ({ value }), error => ({ error }));
  try {
    expect(await x.externalEffects()).toEqual([x.operation.id]);
    if (mode === 'settle then archive') {
      x.callbacks.onEvent({ ...x.run, type: 'input.processing', inputIds: x.run.inputIds });
      x.callbacks.onEvent({ ...x.run, type: 'assistant.message', content: 'Action submitted', inputIds: x.run.inputIds });
      x.callbacks.onEvent({ ...x.run, type: 'settled' });
      expect(context.signal.aborted).toBe(false);
      await x.command('thread.archive', x.thread.id);
      expect(context.signal.aborted).toBe(false);
    } else if (revoked) {
      await x.command('run.stop', x.thread.id);
      expect(context.signal.aborted).toBe(true);
      if (mode === 'stop then archive') await x.command('thread.archive', x.thread.id);
    }
    x.release.resolve();
    await waiting;
    expect(x.callbackState()).toEqual({ ran: true, error: undefined });
    const late = x.store.all('message', x.thread.id).filter(message => message.content === 'Late executor completion');
    expect(late).toHaveLength(revoked ? 0 : 1);
    // Historical success is supported by the counted effect. Revocation must
    // not erase it or relabel it as proof that the cancelled run made no change.
    expect(await x.externalEffects()).toEqual([x.operation.id]);
    expect(x.store.get('toolEffect', 'operation:' + x.operation.id + '@1')).toMatchObject({
      state: 'SUCCEEDED',
      owner: { threadId: x.thread.id, runId: x.run.runId, epoch: x.run.epoch },
      outcome: { value: { completed: x.operation.id, externalEffects: 1 } },
    });
    expect(x.store.all('approval', x.thread.id).find(value => value.operationId === x.operation.id).remainingUses).toBe(0);
    if (revoked) {
      expect(x.store.get('thread', x.thread.id)).toMatchObject(mode === 'settle then archive'
        ? { runId: null, epoch: x.run.epoch }
        : { runId: null, status: 'stopped', epoch: x.run.epoch + 1 });
      expect(x.starts).toHaveLength(1);
    }
    if (mode.includes('archive')) expect(x.store.get('archivedThread', x.thread.id)).toBe(true);
  } finally {
    x.release.resolve();
    await waiting;
  }
});
