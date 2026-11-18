import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/storage/store.ts';
import { Service } from '../packages/core/service.ts';
import { createEffectAuthenticator } from '../packages/core/host-effect-authenticator.ts';
import { createHermesService } from '../apps/server/hermes-service.ts';

const cleanups = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const flags = { 'audit.effectsV1': true, 'security.authorityV1': true };
const markerKind = 'effectAuthorityProfile', markerId = 'global';
const keyId = '00000000-0000-4000-8000-000000000011';
const otherId = '00000000-0000-4000-8000-000000000012';
const runtime = () => ({ configure() {}, models: async () => [], start: async () => {}, followUp: async () => {},
  cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} });
async function state() {
  const root = await mkdtemp(join(tmpdir(), 'protected-effect-host-'));
  let store = new Store(root);
  cleanups.push(async () => { store.close(); await rm(root, { recursive: true, force: true, maxRetries: 5 }); });
  const thread = { id: 'owner', title: 'Retained owner', projectName: null, createdAt: '', updatedAt: '', status: 'ready',
    epoch: 1, runId: null, modelId: 'test/model', sessionPath: null, accountId: null, projectId: null, workspaceId: null };
  const operation = { id: 'retained-action', threadId: thread.id, revision: 1, kind: 'fixture.write', args: { refId: 'opaque' },
    resourceIds: [], preconditions: {}, description: 'Retained approval preview', status: 'prepared', approved: false, createdAt: '' };
  store.internal('fixture', thread.id, () => { store.put('thread', thread.id, thread.id, thread); store.put('operation', operation.id, thread.id, operation); });
  return { root, thread, operation, get store() { return store; },
    reopen() { store.close(); store = new Store(root); },
    marker: () => store.get(markerKind, markerId),
    saveMarker: value => store.internal('fixture.marker', null, () => store.put(markerKind, markerId, null, value)),
  };
}
function keep(service) { cleanups.push(() => service.dispose().catch(() => {})); return service; }
function verifyGrant(authenticator, grant) {
  const { hostAuthenticator, ...fields } = grant;
  expect(hostAuthenticator).toMatchObject({ version: 1, keyId: authenticator.keyId });
  expect(authenticator.verify('grant', fields, hostAuthenticator.tag)).toBe(true);
}
async function blocked(service, x) {
  expect(x.store.snapshot().operations).toContainEqual(x.operation);
  await expect(service.command({ id: crypto.randomUUID(), type: 'operation.approve', threadId: x.thread.id,
    payload: { operationId: x.operation.id, revision: 1 } })).rejects.toMatchObject({ code: 'EFFECT_KEY_UNAVAILABLE' });
  expect(x.store.get('operation', x.operation.id)).toEqual(x.operation);
  expect(x.store.all('approval')).toEqual([]);
  expect(x.store.all('toolEffect')).toEqual([]);
}
async function compose(x, options, overrides) {
  const { createProtectedHermesService } = await import('../apps/server/effect-service.ts');
  return keep(await createProtectedHermesService(x.store, runtime(), options, overrides));
}
// These injected custody factories test product lifecycle decisions with real
// crypto, Store and Service. They do not substitute for native custody proof.
function custodyFixture(x) {
  const keys = new Map(), handles = [], order = [];
  const handle = id => {
    const authenticator = createEffectAuthenticator(keys.get(id) ?? Buffer.alloc(32, 11), id);
    const close = vi.fn(async () => { order.push('key.closed'); authenticator.revoke(); });
    const custody = { authenticator, close }; handles.push(custody); return custody;
  };
  const factories = {
    createService: vi.fn((store, native, options) => new Service(store, native, options)),
    initializeKey: vi.fn(async (_root, options) => {
      expect(x.marker()).toEqual({ version: 1, keyId: options.keyId, state: 'initializing' });
      keys.set(options.keyId, Buffer.alloc(32, 11)); return handle(options.keyId);
    }),
    openKey: vi.fn(async (_root, options) => {
      if (!keys.has(options.expectedKeyId)) throw Error('Owned unavailable-key fixture');
      return handle(options.expectedKeyId);
    }),
  };
  return { factories, keys, handles, order, handle };
}

it('passes explicit keyed authority into the production Hermes composition', async () => {
  const x = await state(), auth = createEffectAuthenticator(Buffer.alloc(32, 11), keyId);
  cleanups.push(async () => auth.revoke());
  const service = keep(createHermesService(x.store, runtime(), { toolEffectFlags: flags, toolEffectAuthenticator: auth }));
  verifyGrant(auth, service.effects.issueApproval(x.operation, x.thread));
});

it('preserves the default-off production composition', async () => {
  const x = await state(), service = keep(createHermesService(x.store, runtime()));
  expect(service.effects.issueApproval(x.operation, x.thread).hostAuthenticator).toBeUndefined();
  expect(x.marker()).toBeNull();
});

it('does no key access or provisioning in a never-enabled profile with both flags off', async () => {
  const x = await state(), f = custodyFixture(x);
  const service = await compose(x, {}, f.factories);
  expect(f.factories.initializeKey).not.toHaveBeenCalled(); expect(f.factories.openKey).not.toHaveBeenCalled();
  expect(x.marker()).toBeNull();
  expect(service.effects.issueApproval(x.operation, x.thread).hostAuthenticator).toBeUndefined();
});

it('retains a protected profile marker with flags off without opening keys or allowing legacy approval', async () => {
  const x = await state(), f = custodyFixture(x), marker = { unsupported: 'retained metadata' }; x.saveMarker(marker);
  const service = await compose(x, {}, f.factories);
  expect(f.factories.initializeKey).not.toHaveBeenCalled(); expect(f.factories.openKey).not.toHaveBeenCalled(); expect(x.marker()).toEqual(marker);
  expect(x.store.snapshot().operations).toContainEqual(x.operation);
  await expect(service.command({ id: crypto.randomUUID(), type: 'operation.approve', threadId: x.thread.id,
    payload: { operationId: x.operation.id, revision: 1 } })).rejects.toMatchObject({ code: 'EFFECT_ADMISSIONS_DISABLED' });
});

it('durably reserves the exact key identity before exclusive first initialization', async () => {
  const x = await state(), f = custodyFixture(x), service = await compose(x, { toolEffectFlags: flags }, f.factories);
  expect(f.factories.initializeKey).toHaveBeenCalledOnce(); expect(f.factories.openKey).not.toHaveBeenCalled();
  expect(x.marker()).toEqual({ version: 1, keyId: f.handles[0].authenticator.keyId, state: 'ready' });
  verifyGrant(f.handles[0].authenticator, service.effects.issueApproval(x.operation, x.thread));
  expect(JSON.stringify(x.store.snapshot())).not.toContain('effectAuthorityProfile');
});

it('opens the same protected identity after actual Store restart without initializing again', async () => {
  const x = await state(), f = custodyFixture(x), first = await compose(x, { toolEffectFlags: flags }, f.factories);
  const grant = first.effects.issueApproval(x.operation, x.thread), marker = x.marker();
  x.store.internal('fixture.grant', x.thread.id, () => x.store.put('approval', grant.approvalId, x.thread.id, grant));
  await first.dispose(); x.reopen();
  const second = await compose(x, { toolEffectFlags: flags }, f.factories);
  expect(f.factories.initializeKey).toHaveBeenCalledOnce(); expect(f.factories.openKey).toHaveBeenCalledWith(x.root, { expectedKeyId: marker.keyId });
  expect(x.marker()).toEqual(marker); expect(second.effects.approvalFor(x.operation.id)).toEqual(grant);
  expect(() => second.effects.verifyOperationApproval(x.operation, x.thread)).not.toThrow();
  verifyGrant(f.handles[1].authenticator, grant);
});

it('recovers a matching completed key behind a pending provisioning marker', async () => {
  const x = await state(), f = custodyFixture(x); f.keys.set(keyId, Buffer.alloc(32, 11));
  x.saveMarker({ version: 1, keyId, state: 'initializing' });
  const service = await compose(x, { toolEffectFlags: flags }, f.factories);
  expect(f.factories.initializeKey).not.toHaveBeenCalled(); expect(x.marker()).toEqual({ version: 1, keyId, state: 'ready' });
  verifyGrant(f.handles[0].authenticator, service.effects.issueApproval(x.operation, x.thread));
});

it.each(['initializing', 'ready'])('never regenerates an unavailable key with a %s marker and retains readable history', async phase => {
  const x = await state(), f = custodyFixture(x), marker = { version: 1, keyId, state: phase }; x.saveMarker(marker);
  const service = await compose(x, { toolEffectFlags: flags }, f.factories);
  expect(f.factories.initializeKey).not.toHaveBeenCalled(); expect(f.factories.openKey).toHaveBeenCalledOnce();
  expect(x.marker()).toEqual(marker); await blocked(service, x);
});
it.each([null, { version: 2, keyId, state: 'ready' }, { version: 1, keyId: 'invalid', state: 'ready' },
  { version: 1, keyId, state: 'unknown' }, { version: 1, keyId, state: 'ready', fallback: true }])
  ('rejects malformed existing marker %# without initializing or replacing it', async marker => {
    const x = await state(), f = custodyFixture(x); x.saveMarker(marker);
    const service = await compose(x, { toolEffectFlags: flags }, f.factories);
    expect(f.factories.initializeKey).not.toHaveBeenCalled(); expect(f.factories.openKey).not.toHaveBeenCalled();
    expect(x.marker()).toEqual(marker); await blocked(service, x);
  });

it('keeps an invalid JSON marker distinct from an absent marker', async () => {
  const x = await state(), f = custodyFixture(x);
  x.store.db.prepare('INSERT INTO entities(kind,id,thread_id,body) VALUES(?,?,NULL,?)').run(markerKind, markerId, 'invalid-json');
  const service = await compose(x, { toolEffectFlags: flags }, f.factories);
  expect(f.factories.initializeKey).not.toHaveBeenCalled(); expect(f.factories.openKey).not.toHaveBeenCalled();
  await blocked(service, x);
});

it('keeps failed initialization pending and only attempts exact reopen on later startup', async () => {
  const x = await state(), f = custodyFixture(x);
  f.factories.initializeKey.mockRejectedValueOnce(Error('Owned interrupted initialization'));
  const first = await compose(x, { toolEffectFlags: flags }, f.factories), marker = x.marker();
  expect(marker.state).toBe('initializing'); await blocked(first, x); await first.dispose();
  const second = await compose(x, { toolEffectFlags: flags }, f.factories);
  expect(f.factories.initializeKey).toHaveBeenCalledOnce(); expect(f.factories.openKey).toHaveBeenCalledWith(x.root, { expectedKeyId: marker.keyId });
  expect(x.marker()).toEqual(marker); await blocked(second, x);
});

it('closes mismatched returned custody and does not complete its pending marker', async () => {
  const x = await state(), f = custodyFixture(x); f.factories.initializeKey.mockImplementationOnce(async () => f.handle(otherId));
  const service = await compose(x, { toolEffectFlags: flags }, f.factories);
  expect(f.handles[0].close).toHaveBeenCalledOnce(); expect(x.marker().state).toBe('initializing');
  expect(() => f.handles[0].authenticator.commit('grant', {})).toThrowError(/unavailable/); await blocked(service, x);
});

it('does not publish custody if the reserved marker changes during acquisition', async () => {
  const x = await state(), f = custodyFixture(x);
  f.factories.initializeKey.mockImplementationOnce(async (_root, options) => {
    x.saveMarker({ version: 1, keyId: otherId, state: 'initializing' }); return f.handle(options.keyId);
  });
  const service = await compose(x, { toolEffectFlags: flags }, f.factories);
  expect(x.marker()).toEqual({ version: 1, keyId: otherId, state: 'initializing' });
  expect(f.handles[0].close).toHaveBeenCalledOnce(); await blocked(service, x);
});

it('holds signing authority until Service drain finishes and closes it exactly once', async () => {
  const x = await state(), f = custodyFixture(x); let release;
  const draining = new Promise(done => { release = done; });
  f.factories.createService.mockImplementationOnce((store, native, options) => {
    const service = new Service(store, native, options), dispose = service.dispose.bind(service);
    service.dispose = async () => { f.order.push('service.draining'); await draining; await dispose(); f.order.push('service.drained'); };
    return service;
  });
  const service = await compose(x, { toolEffectFlags: flags }, f.factories);
  try {
    const closing = service.dispose(); expect(service.dispose()).toBe(closing);
    expect(f.order).toEqual(['service.draining']); expect(() => f.handles[0].authenticator.commit('grant', {})).not.toThrow();
    release(); await closing;
    expect(f.order).toEqual(['service.draining', 'service.drained', 'key.closed']); expect(f.handles[0].close).toHaveBeenCalledOnce();
    expect(() => f.handles[0].authenticator.commit('grant', {})).toThrowError(/unavailable/);
  } finally { release(); }
});

it('closes acquired custody if product Service composition throws', async () => {
  const x = await state(), f = custodyFixture(x); f.factories.createService.mockImplementationOnce(() => { throw Error('Owned composition failure'); });
  await expect(compose(x, { toolEffectFlags: flags }, f.factories)).rejects.toThrow('Owned composition failure');
  expect(f.handles[0].close).toHaveBeenCalledOnce(); expect(() => f.handles[0].authenticator.commit('grant', {})).toThrowError(/unavailable/);
});

it('retains both Service drain and custody cleanup failures', async () => {
  const x = await state(), f = custodyFixture(x), serviceFailure = Error('Owned Service drain failure'), keyFailure = Error('Owned custody cleanup failure');
  f.factories.createService.mockImplementationOnce((store, native, options) => {
    const service = new Service(store, native, options), dispose = service.dispose.bind(service);
    service.dispose = async () => { await dispose(); throw serviceFailure; }; return service;
  });
  const service = await compose(x, { toolEffectFlags: flags }, f.factories);
  f.handles[0].close.mockImplementationOnce(async () => { f.handles[0].authenticator.revoke(); throw keyFailure; });
  await expect(service.dispose()).rejects.toMatchObject({ errors: [serviceFailure, keyFailure] });
  expect(f.handles[0].close).toHaveBeenCalledOnce();
});

it.runIf(process.platform === 'win32')('wires actual product DPAPI custody through restart and refuses a lost key', async () => {
  const x = await state(), first = await compose(x, { toolEffectFlags: flags });
  const grant = first.effects.issueApproval(x.operation, x.thread), marker = x.marker();
  expect(grant.hostAuthenticator.keyId).toBe(marker.keyId); expect(marker.state).toBe('ready');
  x.store.internal('fixture.grant', x.thread.id, () => x.store.put('approval', grant.approvalId, x.thread.id, grant));
  await first.dispose(); x.reopen();
  const second = await compose(x, { toolEffectFlags: flags });
  expect(() => second.effects.verifyOperationApproval(x.operation, x.thread)).not.toThrow(); await second.dispose();
  await unlink(join(x.root, 'effect-authority', 'key.json'));
  const unavailable = await compose(x, { toolEffectFlags: flags });
  expect(unavailable.effects.approvalFor(x.operation.id)).toEqual(grant); expect(x.store.snapshot().operations).toContainEqual(x.operation);
  expect(() => unavailable.effects.issueApproval(x.operation, x.thread)).toThrowError(/unavailable/);
  expect(x.marker()).toEqual(marker); await expect(readFile(join(x.root, 'effect-authority', 'key.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});
