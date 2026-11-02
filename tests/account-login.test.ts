import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, realpath, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../packages/storage/store.ts';
import { changeAccount, accountResolver } from '../packages/core/accounts.ts';
import { withAccountLogin } from '../packages/runtime-login/account-login.ts';
import { accountProfileRoot } from '../packages/runtime/account-profile.ts';
import type { ConnectionAccount } from '../packages/contracts/accounts.ts';
import { HarnessError } from '../packages/contracts/index.ts';

const fixtures: { root: string; store: Store }[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const { root, store } of fixtures.splice(0)) {
    store.close();
    if (await realpath(root) !== resolve(root) || !resolve(root).startsWith(await realpath(tmpdir()) + sep) || (await lstat(root)).isSymbolicLink()) throw Error('Unsafe login fixture cleanup');
    await rm(root, { recursive: true, force: true });
  }
});
it('does not admit a successor sign-in when an expired lease still has a live owner', async () => {
  const { root, store, account } = await fixture(); let release!: () => void, started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const first = withAccountLogin({ dataDir: root, provider: 'openai', accountId: account.id }, async () => { started(); await held; });
  try {
    await ready; vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60 * 1000);
    await expect(withAccountLogin({ dataDir: root, provider: 'openai', accountId: account.id }, async () => {})).rejects.toMatchObject({ code: 'ACCOUNT_SIGNING_IN' });
  } finally { vi.restoreAllMocks(); release(); await first; }
  expect(store.all('accountLogin')).toEqual([]);
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'harness-account-login-')), store = new Store(root); fixtures.push({ root, store });
  const command = (type: string, payload: Record<string, unknown>) => store.command({ id: randomUUID(), type, payload }, () => changeAccount(store, { id: randomUUID(), type, payload })).result;
  const account = command('account.create', { providerId: 'openai', label: 'Personal' }) as ConnectionAccount;
  return { root, store, account, command };
}
it('reserves the exact named profile for sign-in and releases it after a failed native login', async () => {
  const { root, store, account } = await fixture(); let calls = 0;
  await expect(withAccountLogin({ dataDir: root, provider: 'openai', accountId: account.id }, async path => {
    calls++; expect(path).toBe(accountProfileRoot(root, account));
    expect(accountResolver(store).isSigningIn!('openai', account.id)).toBe(true);
    throw Error('Synthetic native cancellation');
  })).rejects.toThrow('Synthetic native cancellation');
  expect(calls).toBe(1); expect(accountResolver(store).isSigningIn!('openai', account.id)).toBe(false);
});
it('retains a durable account hold when native login shutdown is unconfirmed', async () => {
  const { root, store, account } = await fixture();
  const failure = new HarnessError('PI_CANCEL_UNCONFIRMED', 'Synthetic shutdown could not be confirmed');
  await expect(withAccountLogin({ dataDir: root, provider: 'openai', accountId: account.id }, async () => { throw failure; })).rejects.toBe(failure);
  const lease = store.all<{id: string; ownerPid: number}>('accountLogin')[0];
  expect(lease).toBeDefined();
  // A restart and the normal lease deadline must not imply native shutdown.
  store.internal('fixture.dead-owner', null, () => store.put('accountLogin', lease.id, null, { ...lease, ownerPid: 2147483647 }));
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 24 * 60 * 60 * 1000);
  const reopened = new Store(root);
  try {
    expect(accountResolver(reopened).isSigningIn!('openai', account.id)).toBe(true);
    expect(() => accountResolver(reopened).claimUse!('openai', account.id)).toThrowError(expect.objectContaining({code: 'ACCOUNT_SIGNING_IN'}));
    await expect(withAccountLogin({ dataDir: root, provider: 'openai', accountId: account.id }, async () => {})).rejects.toMatchObject({code: 'ACCOUNT_SIGNING_IN'});
    expect(accountResolver(reopened).isSigningIn!('openai', null)).toBe(false);
  } finally { reopened.close(); }
});
it('keeps omitted sign-in on the legacy profile even after a named account is selected', async () => {
  const { root, store, account, command } = await fixture(); command('account.select', { providerId: 'openai', accountId: account.id });
  await withAccountLogin({ dataDir: root, provider: 'openai' }, async path => {
    expect(path).toBe(root); expect(accountResolver(store).isSigningIn!('openai', null)).toBe(true);
    expect(accountResolver(store).isSigningIn!('openai', account.id)).toBe(false);
  });
  expect(store.all('accountLogin')).toEqual([]);
});
it('rejects an unknown, removed or different-provider account before invoking native sign-in', async () => {
  const { root, store, account, command } = await fixture(); let calls = 0; const run = async () => { calls++; };
  await expect(withAccountLogin({ dataDir: root, provider: 'claude-code', accountId: account.id }, run)).rejects.toMatchObject({ code: 'ACCOUNT_PROVIDER_MISMATCH' });
  await expect(withAccountLogin({ dataDir: root, provider: 'openai', accountId: randomUUID() }, run)).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
  command('account.remove', { accountId: account.id });
  await expect(withAccountLogin({ dataDir: root, provider: 'openai', accountId: account.id }, run)).rejects.toMatchObject({ code: 'ACCOUNT_DISABLED' });
  expect(calls).toBe(0); expect(store.all('accountLogin')).toEqual([]);
});
it('blocks credential mutation while an existing task owns that account', async () => {
  const { root, store, account } = await fixture(); let called = false;
  store.internal('fixture.active', null, () => store.put('thread', 'active', 'active', { id: 'active', accountId: account.id, modelId: 'openai/example', runId: 'owned-run' }));
  await expect(withAccountLogin({ dataDir: root, provider: 'openai', accountId: account.id }, async () => { called = true; })).rejects.toMatchObject({ code: 'ACCOUNT_BUSY' });
  expect(called).toBe(false); expect(store.all('accountLogin')).toEqual([]);
});
