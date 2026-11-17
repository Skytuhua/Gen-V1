import { expect, it } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createContextResults } from '../packages/core/context-results';

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
