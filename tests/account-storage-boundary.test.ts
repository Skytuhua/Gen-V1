import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, realpath, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../packages/storage/store.ts';
import { Service } from '../packages/core/service.ts';
import { resolveGrant } from '../packages/core/security.ts';
import { accountProfileRoot } from '../packages/runtime/account-profile.ts';
import type { RuntimeAdapter, ResourceGrant, Thread } from '../packages/contracts/index.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
it('denies named account credentials at grant admission and use while retaining ordinary task files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harness-private-account-')), store = new Store(root);
  const runtime: RuntimeAdapter = { configure() {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
  const service = new Service(store, runtime);
  cleanups.push(async () => { await service.dispose(); store.close(); if (await realpath(root) !== resolve(root) || !resolve(root).startsWith(await realpath(tmpdir()) + sep) || (await lstat(root)).isSymbolicLink()) throw Error('Unsafe account fixture cleanup'); await rm(root, { recursive: true, force: true }); });
  const thread = (await service.command({ id: randomUUID(), type: 'thread.create', payload: {} })).result as Thread;
  const profile = accountProfileRoot(root, { id: randomUUID(), providerId: 'openai', label: 'Synthetic', enabled: true, createdAt: '', updatedAt: '' });
  const privatePath = join(profile, 'pi', 'auth.json'), publicPath = join(root, 'resources', 'source.txt');
  await mkdir(join(profile, 'pi'), { recursive: true }); await writeFile(privatePath, '{"synthetic":true}');
  await mkdir(join(root, 'resources')); await writeFile(publicPath, 'Source fixture');
  await expect(service.command({ id: randomUUID(), type: 'resource.grant', threadId: thread.id, payload: { kind: 'file', path: privatePath, writable: false } })).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
  const stale: ResourceGrant = { id: 'synthetic-stale', threadId: thread.id, kind: 'file', path: privatePath, label: 'auth.json', writable: false, createdAt: '' };
  await expect(resolveGrant(stale, undefined, false, root)).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
  const allowed = (await service.command({ id: randomUUID(), type: 'resource.grant', threadId: thread.id, payload: { kind: 'file', path: publicPath, writable: false } })).result as ResourceGrant;
  await expect(resolveGrant(allowed, undefined, false, root)).resolves.toBe(publicPath);
});
