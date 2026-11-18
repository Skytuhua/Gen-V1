import { expect, it } from 'vitest';
import { approvedContext7 } from './fixtures/approved-context7.mjs';

// No native lease substitution in this file. The signer is an explicit test
// provider, so this does not establish DPAPI custody or an OS sandbox profile.
it.skipIf(process.platform === 'win32')('denies actual unsupported native file custody before an approved credential-bearing child', async () => {
  const x = await approvedContext7(), operation = await x.prepare();
  const result = await x.execute(operation);
  expect(result).toMatchObject({ status: 'failed', error: expect.stringMatching(/safely|guard|unsupported|custody/i) });
  expect(await x.starts()).toEqual([]);
  expect(x.store.all('approval').find(value => value.operationId === operation.id)?.remainingUses).toBe(0);
});

it.runIf(process.platform === 'win32')('holds actual Windows native custody through one approved owned MCP action and teardown', async () => {
  const x = await approvedContext7(), operation = await x.prepare();
  expect((await x.execute(operation)).status).toBe('succeeded');
  expect(await x.starts()).toEqual([{ credential: true, credentialMatched: true }]);
  const pid = (await x.calls())[0].pid;
  expect(() => process.kill(pid, 0)).toThrow();
}, 60000);
