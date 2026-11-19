import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/storage/store.ts';
import { Service } from '../packages/core/service.ts';
import { initializeEffectKey, openEffectKey } from '../packages/core/host-effect-authenticator.ts';
import { createProtectedHermesService } from '../apps/server/effect-service.ts';
import { approvedContext7 } from './fixtures/approved-context7.mjs';

// Real unsupported-platform denials are separate from the Windows-positive
// files so a Windows acceptance run can require every selected assertion.
// This file remains part of the full suite and must also run on Linux.
const cleanups = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function directory() {
  const root = await mkdtemp(join(tmpdir(), 'unsupported-native-custody-'));
  cleanups.push(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  return root;
}
const keyFile = root => join(root, 'effect-authority', 'key.json');
const codec = {
  protect: async value => Buffer.from('test-protected:' + value).toString('base64'),
  unprotect: async value => {
    const text = Buffer.from(value, 'base64').toString();
    if (!text.startsWith('test-protected:')) throw Error('invalid test ciphertext');
    return text.slice('test-protected:'.length);
  },
};

describe.skipIf(process.platform === 'win32')('unsupported native custody', () => {
  it('fails closed without a supported native custody boundary', async () => {
    const root = await directory();
    await expect(initializeEffectKey(root, { codec })).rejects.toMatchObject({ code: 'EFFECT_KEY_UNAVAILABLE' });
    await expect(openEffectKey(root, { codec })).rejects.toMatchObject({ code: 'EFFECT_KEY_UNAVAILABLE' });
    await expect(readFile(keyFile(root))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps enabled historical reads available when real platform custody is unavailable', async () => {
    const root = await directory(), store = new Store(root);
    cleanups.push(async () => store.close());
    const thread = { id: 'owner', title: 'Retained owner', projectName: null, createdAt: '', updatedAt: '', status: 'ready',
      epoch: 1, runId: null, modelId: 'test/model', sessionPath: null, accountId: null, projectId: null, workspaceId: null };
    const operation = { id: 'retained-action', threadId: thread.id, revision: 1, kind: 'fixture.write', args: { refId: 'opaque' },
      resourceIds: [], preconditions: {}, description: 'Retained approval preview', status: 'prepared', approved: false, createdAt: '' };
    store.internal('fixture', thread.id, () => { store.put('thread', thread.id, thread.id, thread); store.put('operation', operation.id, thread.id, operation); });
    const runtime = { configure() {}, models: async () => [], start: async () => {}, followUp: async () => {},
      cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
    const service = await createProtectedHermesService(store, runtime,
      { toolEffectFlags: { 'audit.effectsV1': true, 'security.authorityV1': true } },
      { createService: (state, native, options) => new Service(state, native, options) });
    cleanups.push(() => service.dispose().catch(() => {}));
    expect(store.get('effectAuthorityProfile', 'global').state).toBe('initializing');
    expect(store.snapshot().operations).toContainEqual(operation);
    await expect(service.command({ id: crypto.randomUUID(), type: 'operation.approve', threadId: thread.id,
      payload: { operationId: operation.id, revision: 1 } })).rejects.toMatchObject({ code: 'EFFECT_KEY_UNAVAILABLE' });
    expect(store.get('operation', operation.id)).toEqual(operation);
    expect(store.all('approval')).toEqual([]);
    expect(store.all('toolEffect')).toEqual([]);
    await expect(readFile(keyFile(root))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('denies actual unsupported native file custody before an approved credential-bearing child', async () => {
    const x = await approvedContext7(), operation = await x.prepare();
    const result = await x.execute(operation);
    expect(result).toMatchObject({ status: 'failed', error: expect.stringMatching(/safely|guard|unsupported|custody/i) });
    expect(await x.starts()).toEqual([]);
    expect(x.store.all('approval').find(value => value.operationId === operation.id)?.remainingUses).toBe(0);
  });
});
