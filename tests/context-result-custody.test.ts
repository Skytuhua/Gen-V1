import { expect, it } from 'vitest';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createContextResults } from '../packages/core/context-results';
import { openContextResultCustody } from '../packages/core/context-result-custody';
import { resolveGrant } from '../packages/core/security';
import type { ResourceGrant } from '../packages/contracts';

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
