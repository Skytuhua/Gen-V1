const { afterEach, describe, expect, it } = await import('vitest');
const { appendFile, mkdtemp, readFile, rm } = await import('node:fs/promises');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { Service } = await import('../packages/core/service.ts');
const { Store } = await import('../packages/storage/store.ts');

const cleanups = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'm03-host-operations-'));
  const store = new Store(join(root, 'state'));
  cleanups.push(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  const output = join(root, 'owned-effects.txt'), observations = [], starts = [];
  let callbacks, hostContext;
  const runtime = {
    configure: value => { callbacks = value; },
    models: async () => [{ id: 'test/model', provider: 'test', name: 'Test' }],
    start: async input => { starts.push(input); }, followUp: async () => {},
    cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {},
  };
  const execute = async (operation, context) => {
    observations.push({
      state: store.get('toolEffect', 'operation:' + operation.id + '@1')?.state,
      uses: store.all('approval').find(value => value.operationId === operation.id)?.remainingUses,
      owner: context.owner, aborted: context.signal.aborted, authenticatedApprovals: context.authenticatedApprovals,
    });
    await appendFile(output, operation.id + '\n');
    return { completed: operation.id };
  };
  const executors = options.executors ?? { 'integration.fixture': execute };
  const service = new Service(store, runtime, {
    toolEffectFlags: options.toolEffectFlags ?? { 'audit.effectsV1': true, 'security.authorityV1': true },
    hostOperationExecutors: executors,
    additionalTool: async (call, _ctx, host) => {
      hostContext = host;
      if (call.args.action !== 'prepare') return { inventory: 'public', preparationAvailable: Boolean(host) };
      if (!host) return { preparationUnavailable: true };
      return { operation: host.prepareOperation(call.args.kind ?? 'integration.fixture',
        { refId: 'context7.synthetic', destination: 'CONTEXT7_API_KEY' }, [], {}, 'Approve the owned integration fixture') };
    },
  });
  cleanups.push(() => service.dispose());
  const command = (type, threadId, payload = {}) => service.command({ id: crypto.randomUUID(), type, threadId, payload });
  const thread = (await command('thread.create')).result;
  await command('message.send', thread.id, { content: 'Prepare an integration action', modelId: 'test/model' });
  await service.deliverOutbox(thread.id);
  const run = starts[0], ctx = { threadId: thread.id, runId: run.runId, epoch: run.epoch };
  const prepare = args => service.tool({ name: 'integration_list', args: { action: 'prepare', ...args } }, ctx);
  const manual = () => {
    const operation = { id: crypto.randomUUID(), threadId: thread.id, revision: 1, kind: 'integration.fixture',
      args: { refId: 'context7.synthetic' }, resourceIds: [], preconditions: {},
      description: 'Approve the owned integration fixture', status: 'prepared', approved: false,
      createdAt: new Date().toISOString() };
    store.internal('fixture.operation', thread.id, () => store.put('operation', operation.id, thread.id, operation));
    return operation;
  };
  const effects = async () => {
    try { return (await readFile(output, 'utf8')).trim().split('\n').filter(Boolean); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  };
  const settle = () => {
    callbacks.onEvent({ ...run, type: 'input.processing', inputIds: run.inputIds });
    callbacks.onEvent({ ...run, type: 'assistant.message', content: 'Prepared', inputIds: run.inputIds });
    callbacks.onEvent({ ...run, type: 'settled' });
  };
  return { store, service, thread, run, ctx, command, prepare, manual, effects, observations, executors, settle,
    get hostContext() { return hostContext; } };
}

describe('host integration operation preparation and dispatch', () => {
  it('prepares an ordinary pending operation without dispatching', async () => {
    const x = await fixture(), result = await x.prepare();
    expect(result.operation).toMatchObject({ kind: 'integration.fixture', status: 'prepared', approved: false,
      args: { refId: 'context7.synthetic', destination: 'CONTEXT7_API_KEY' } });
    expect(x.store.all('operation', x.thread.id)).toHaveLength(1);
    expect(x.store.all('approval', x.thread.id)).toHaveLength(0);
    expect(await x.effects()).toEqual([]);
  });

  it('dispatches once after the real approval and durable effect admission', async () => {
    const x = await fixture(), operation = x.manual();
    await x.command('operation.approve', x.thread.id, { operationId: operation.id, revision: 1 });
    await x.service.dispatchOperation(operation.id).catch(() => {});
    await x.service.dispatchOperation(operation.id);
    expect(await x.effects()).toEqual([operation.id]);
    expect(x.observations).toEqual([{ state: 'DISPATCHED', uses: 0, aborted: false, authenticatedApprovals: true,
      owner: { threadId: x.thread.id, runId: x.run.runId, epoch: x.run.epoch,
        accountBinding: null, projectId: null, workspaceId: null } }]);
    expect(x.store.get('operation', operation.id).status).toBe('succeeded');
    expect(x.store.get('toolEffect', 'operation:' + operation.id + '@1').state).toBe('SUCCEEDED');
  });

  it('does not enter the host executor without user approval', async () => {
    const x = await fixture(), operation = x.manual();
    await expect(x.service.dispatchOperation(operation.id)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    expect(await x.effects()).toEqual([]);
    expect(x.observations).toEqual([]);
  });

  it('reports the default-off authority policy without activating it', async () => {
    const x = await fixture({ toolEffectFlags: {} });
    await x.service.tool({ name: 'integration_list', args: {} }, x.ctx);
    expect(x.hostContext?.authenticatedApprovals).toBe(false);
    expect(x.store.all('approval')).toEqual([]);
    expect(await x.effects()).toEqual([]);
  });

  it('prepares only kinds registered by this host', async () => {
    const x = await fixture();
    await expect(x.prepare({ kind: 'integration.unregistered' })).rejects.toMatchObject({ code: 'HOST_OPERATION_UNAVAILABLE' });
    expect(x.store.all('operation', x.thread.id)).toHaveLength(0);
    expect(await x.effects()).toEqual([]);
  });

  it('keeps constructor registration stable while an action waits for approval', async () => {
    const x = await fixture(), operation = x.manual();
    x.executors['integration.fixture'] = async () => ({ substituted: true });
    await x.command('operation.approve', x.thread.id, { operationId: operation.id, revision: 1 });
    await x.service.dispatchOperation(operation.id).catch(() => {});
    expect(await x.effects()).toEqual([operation.id]);
  });

  it('refuses a retained preparation callback after its run settles', async () => {
    const x = await fixture();
    await x.service.tool({ name: 'integration_list', args: {} }, x.ctx);
    expect(x.hostContext).toBeDefined();
    x.settle();
    expect(() => x.hostContext.prepareOperation('integration.fixture', {}, [], {}, 'stale'))
      .toThrowError(/current|run|stale/i);
    expect(x.store.all('operation', x.thread.id)).toHaveLength(0);
  });

  it('retains the original-owner check before a custom executor is entered', async () => {
    const x = await fixture(), operation = x.manual();
    let changed = false;
    const unsubscribe = x.store.subscribe(event => {
      if (changed || event.type !== 'toolEffect.admitted') return;
      if (!x.store.get('toolEffect', 'operation:' + operation.id + '@1')) return;
      changed = true; x.settle();
    });
    try {
      await x.command('operation.approve', x.thread.id, { operationId: operation.id, revision: 1 });
      await x.service.dispatchOperation(operation.id).catch(() => {});
      expect(changed).toBe(true);
      expect(await x.effects()).toEqual([]);
      expect(x.observations).toEqual([]);
      expect(x.store.get('toolEffect', 'operation:' + operation.id + '@1')).toMatchObject({
        state: 'FAILED', owner: { runId: x.run.runId }, outcome: { error: expect.stringMatching(/before dispatch/) },
      });
    } finally { unsubscribe(); }
  });

  it('does not let a preparation callback bypass plan mode', async () => {
    const x = await fixture();
    x.store.internal('fixture.plan', x.thread.id, () => {
      const current = x.store.get('thread', x.thread.id);
      x.store.put('thread', current.id, current.id, { ...current, mode: 'plan' });
    });
    await expect(x.prepare()).rejects.toThrowError(/plan|build/i);
    expect(x.store.all('operation', x.thread.id)).toHaveLength(0);
  });

  it('rejects host registrations that could replace core capability executors', async () => {
    await expect(fixture({ executors: { 'file.replace': async () => ({ replaced: true }) } }).then(() => ({ constructed: true })))
      .rejects.toMatchObject({ code: 'INVALID_HOST_OPERATION' });
  });
});
