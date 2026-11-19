import { expect, it } from 'vitest';
import { mkdir, mkdtemp, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createContextResults } from '../packages/core/context-results';
import { openContextResultCustody } from '../packages/core/context-result-custody';
import { resolveGrant } from '../packages/core/security';
import type { ResourceGrant, RuntimeAdapter } from '../packages/contracts';
import { Service } from '../packages/core/service';
import { Store } from '../packages/storage/store';
import { __setCapabilityFlagForTests } from '../packages/core/capability-flags';
import { testEffectAuthenticator } from './fixtures/effect-authenticator.ts';

function configureHostCapabilityFlags(overrides: Readonly<Partial<Record<'context.compilerV1' | 'tools.deferredV1', boolean>>>) {
  for (const key of ['context.compilerV1', 'tools.deferredV1'] as const) __setCapabilityFlagForTests(key, overrides[key]);
  return () => { for (const key of ['context.compilerV1', 'tools.deferredV1'] as const) __setCapabilityFlagForTests(key, undefined); };
}

it('retains an authorized exact range across reopen and reaps expired artifacts', async () => {
  const load = import.meta.glob('../packages/core/context-result-custody.ts')['../packages/core/context-result-custody.ts'];
  if (!load) throw new Error('M04 durable result custody is not implemented');
  const { openContextResultCustody } = await load() as { openContextResultCustody: (root: string) => Promise<Parameters<typeof createContextResults>[0]['storage']> };
  const root = await mkdtemp(join(tmpdir(), 'm04-custody-'));
  let now = 0, allowed = true;
  const owner = { threadId: 'thread', workspaceId: 'workspace', accountId: 'account' };
  const spill = (vault: ReturnType<typeof createContextResults>, expiresAtMs: number) =>
    vault.spill({ owner, invocationId: 'fixture-invocation', bytes: Buffer.from('café example'), mediaType: 'text/plain', expiresAtMs });
  try {
    const connect = async () => createContextResults({ storage: await openContextResultCustody(root), now: () => now, isAuthorized: () => allowed });
    const first = await connect(), issued = await spill(first, 100);
    expect(issued.handle).toBeTruthy();
    const reopened = await connect(), request = { owner, handle: issued.handle!, offset: 0, length: 5 };
    const range = await reopened.read(request);
    expect(range).toMatchObject({ status: 'OK', totalBytes: 13, omittedBytes: 8 });
    if (range.status !== 'OK') throw Error('range missing after reopen');
    expect(Buffer.from(range.bytes).toString()).toBe('café');
    allowed = false;
    expect(await reopened.read(request)).toEqual({ status: 'UNAVAILABLE' });
    allowed = true; now = 100;
    expect(await reopened.read(request)).toEqual({ status: 'UNAVAILABLE' });
    expect((await spill(reopened, 200)).handle).toBeTruthy();
    expect(await readdir(join(root, 'context-results'))).toHaveLength(1);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

it('rejects retained result bytes through a broader project grant while permitting ordinary files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'm04-result-private-')), profile = join(root, 'profile');
  await mkdir(profile); await writeFile(join(root, 'ordinary.txt'), 'permitted project content');
  const grant: ResourceGrant = { id: 'project', threadId: 'thread', kind: 'project', path: root, label: 'Project', writable: false, createdAt: '2026-11-17T00:00:00Z' };
  const vault = createContextResults({ storage: await openContextResultCustody(profile), now: () => 0, isAuthorized: () => true });
  try {
    const result = await vault.spill({ owner: { threadId: 'thread', workspaceId: 'workspace', accountId: null }, invocationId: 'invocation', bytes: Buffer.from('retained private result'), mediaType: 'text/plain', expiresAtMs: 100 });
    expect(result.handle).toBeTruthy();
    await expect(resolveGrant(grant, `profile/context-results/${result.handle}.result`, false, profile)).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
    await expect(resolveGrant(grant, 'ordinary.txt', false, profile)).resolves.toBe(join(root, 'ordinary.txt'));
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 5 }); }
});

it('keeps verification artifact custody protected through the same broader project grant', async () => {
  const root = await mkdtemp(join(tmpdir(), 'm06-artifact-private-')), profile = join(root, 'profile');
  const artifact = join(profile, 'artifacts', 'verification-v1', 'receipt.log');
  await mkdir(join(profile, 'artifacts', 'verification-v1'), { recursive: true }); await writeFile(artifact, 'retained execution log');
  const grant: ResourceGrant = { id: 'project', threadId: 'thread', kind: 'project', path: root, label: 'Project', writable: false, createdAt: '2026-11-17T00:00:00Z' };
  try { await expect(resolveGrant(grant, 'profile/artifacts/verification-v1/receipt.log', false, profile)).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' }); }
  finally { await rm(root, { recursive: true, force: true, maxRetries: 5 }); }
});

it.skipIf(process.platform !== 'win32')('uses the native Windows grant guard for retained domain output and revocation', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'm04-native-result-'))), project = join(root, 'project');
  await mkdir(project); await writeFile(join(project, 'source.txt'), 'BEGIN\n' + 'native retained source\n'.repeat(2000) + 'END');
  const release = configureHostCapabilityFlags({ 'context.compilerV1': true, 'tools.deferredV1': true }), store = new Store(join(root, 'profile'));
  const runtime: RuntimeAdapter = { configure() {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
  const service = new Service(store, runtime, { toolEffectFlags: { 'audit.effectsV1': true, 'security.authorityV1': true }, toolEffectAuthenticator: testEffectAuthenticator() });
  const ctx = { threadId: 'thread', runId: 'run', epoch: 1 }, info = await stat(project, { bigint: true });
  const grant: ResourceGrant = { id: 'source', threadId: ctx.threadId, kind: 'project', path: project, label: 'Native source', writable: false, createdAt: '', identity: { dev: String(info.dev), ino: String(info.ino) } };
  try {
    store.internal('fixture', ctx.threadId, () => {
      store.put('thread', ctx.threadId, ctx.threadId, { id: ctx.threadId, title: 'Native fixture', status: 'working', modelId: 'test/model', accountId: null, ...ctx });
      store.put('resource', grant.id, ctx.threadId, grant);
    });
    const result = await service.tool({ name: 'repository_read', args: { resourceId: grant.id, path: 'source.txt' } }, ctx) as { status: string; handle: string; totalBytes: number };
    expect(result.status).toBe('AVAILABLE'); expect(result.totalBytes).toBeGreaterThan(16384);
    const range = { name: 'context_result_read', args: { handle: result.handle, offset: 0, length: result.totalBytes } };
    expect(await service.tool(range, ctx)).toMatchObject({ status: 'OK', text: expect.stringContaining('native retained source') });
    store.internal('fixture.revoke', ctx.threadId, () => store.remove('resource', grant.id));
    expect(await service.tool(range, ctx)).toEqual({ status: 'UNAVAILABLE' });
  } finally { try { await service.dispose(); store.close(); await rm(root, { recursive: true, force: true, maxRetries: 5 }); } finally { release(); } }
});
