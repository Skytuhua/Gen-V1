const { afterEach, expect, it, vi } = await import('vitest');
const { appendFile, mkdtemp, readFile, rm } = await import('node:fs/promises');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { Service } = await import('../packages/core/service.ts');
const { Store } = await import('../packages/storage/store.ts');
const { HarnessError } = await import('../packages/contracts/index.ts');
const domain = await import('../packages/capabilities/index.ts');
const { testEffectAuthenticator } = await import('./fixtures/effect-authenticator.ts');

const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'operation-approval-review-'));
  const store = new Store(join(root, 'state'));
  const runtime = {
    configure: () => {},
    models: async () => [{ id: 'test/model', provider: 'test', name: 'Test' }],
    start: async () => {}, followUp: async () => {}, cancel: async () => {},
    compact: async () => {}, history: async () => [], dispose: async () => {},
  };
  // Authenticated mode requires the host signer: issuing an approval signs the
  // exact action commitment, so a host without one must refuse to issue it.
  const authenticator = testEffectAuthenticator();
  const service = new Service(store, runtime, {
    toolEffectFlags: { 'audit.effectsV1': true, 'security.authorityV1': true }, toolEffectAuthenticator: authenticator,
  });
  cleanups.push(async () => { await service.dispose(); store.close(); await rm(root, { recursive: true, force: true }); });
  const command = (type, threadId, payload = {}) =>
    service.command({ id: crypto.randomUUID(), type, threadId, payload });
  const first = (await command('thread.create')).result;
  const second = (await command('thread.create')).result;
  const operation = (id, thread) => {
    const value = {
      id, threadId: thread.id, revision: 1, kind: 'fixture.external.write',
      description: 'Review one exact action', args: {}, resourceIds: [], preconditions: {},
      status: 'prepared', approved: false, createdAt: new Date().toISOString(),
    };
    store.internal('fixture.operation', thread.id, () => store.put('operation', id, thread.id, value));
    return value;
  };
  const externalPath = join(root, 'external-effects.txt');
  const effects = async () => {
    try { return (await readFile(externalPath, 'utf8')).split('\n').filter(Boolean); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  };
  return { store, service, command, first, second, operation, effects, externalPath };
}

it.each([
  { expired: true, name: 'returns an expired approval to review and dispatches only after a new approval' },
  { expired: false, name: 'keeps an unchanged live approval and dispatches it exactly once' },
])('$name', async ({ expired }) => {
  const x = await fixture(), entered = deferred(), release = deferred();
  const blocker = x.operation('blocking-action', x.first);
  const queued = x.operation('reviewed-action', x.second);
  // Time and the external executor are controlled; actual Service commands,
  // approvals, Store transactions, operation queue and UI snapshot stay real.
  vi.spyOn(domain, 'executeDomainOperation').mockImplementation(async (op, context) => {
    if (context.signal.aborted) throw new HarnessError('CANCELLED', 'Cancelled before external dispatch');
    if (op.id === blocker.id) { entered.resolve(); await release.promise; }
    await appendFile(x.externalPath, op.id + '\n');
    return { completed: op.id };
  });
  await x.command('operation.approve', blocker.threadId, { operationId: blocker.id, revision: 1 });
  await entered.promise;
  let waiting;
  try {
    await x.command('operation.approve', queued.threadId, { operationId: queued.id, revision: 1 });
    const oldApproval = x.store.all('approval', queued.threadId).find(value => value.operationId === queued.id);
    waiting = x.service.dispatchOperation(queued.id).then(value => ({ value }), error => ({ error }));
    if (expired) {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(Date.parse(oldApproval.expiresAt) + 1));
    }
    release.resolve();
    const outcome = await waiting;
    if (expired) {
      expect(outcome).toMatchObject({ error: { code: 'APPROVAL_REQUIRED' } });
      expect(await x.effects()).toEqual([blocker.id]);
      expect(x.store.get('toolEffect', 'operation:' + queued.id + '@1')).toBeNull();
      expect(x.store.get('approval', oldApproval.approvalId)).toEqual(oldApproval);
      // OperationDecision exposes its existing approval controls from these
      // canonical fields. An expired approved=true record strands the review.
      expect(x.store.snapshot().operations.find(value => value.id === queued.id))
        .toMatchObject({ status: 'prepared', approved: false });
      await x.command('operation.approve', queued.threadId, { operationId: queued.id, revision: 1 });
      await x.service.dispatchOperation(queued.id);
      const currentApproval = x.store.all('approval', queued.threadId).filter(value => value.operationId === queued.id).at(-1);
      expect(currentApproval.approvalId).not.toBe(oldApproval.approvalId);
      expect(currentApproval.remainingUses).toBe(0);
      expect(Date.parse(currentApproval.expiresAt)).toBeGreaterThan(Date.now());
      expect(x.store.get('approval', oldApproval.approvalId)).toEqual(oldApproval);
    } else {
      expect(outcome).toMatchObject({ value: { status: 'succeeded' } });
      expect(x.store.get('approval', oldApproval.approvalId).remainingUses).toBe(0);
    }
    expect(await x.effects()).toEqual([blocker.id, queued.id]);
    expect(x.store.get('toolEffect', 'operation:' + queued.id + '@1')).toMatchObject({ state: 'SUCCEEDED' });
  } finally {
    release.resolve();
    await waiting;
  }
});
