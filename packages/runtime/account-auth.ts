import { HarnessError } from '../contracts/index.ts';
import { isConnectionProviderId, isOfficialRuntimeProviderId } from '../contracts/connections.ts';
import { isAccountId } from '../contracts/accounts.ts';
import { unavailableIdentity, type AccountAuthStatus, type AccountAuthTarget } from '../contracts/authentication.ts';
import { accountResolver, beginAccountLogin, endAccountLogin, holdAccountLogin, holdAccountUse } from '../core/accounts.ts';
import type { Store } from '../storage/store.ts';
import { withAccountProfile } from './account-profile.ts';
import { createLiteralCredentialStore } from '../runtime-pi/credentials.ts';
import { taskPaths } from '../runtime-pi/session.ts';
import { loadSdk } from '../runtime-pi/sdk.ts';
import { cursorAccountStatus, cursorLocalSignout } from '../runtime-official/cursor.ts';
import { claudeAccountStatus } from '../runtime-official/claude-account.ts';

export function parseAccountAuthTarget(value: unknown): AccountAuthTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HarnessError('INVALID_INPUT', 'Choose a provider and explicit account target.');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== 2 || !Object.hasOwn(row, 'providerId') || !Object.hasOwn(row, 'accountId') || !isConnectionProviderId(row.providerId) || (row.accountId !== null && !isAccountId(row.accountId))) throw new HarnessError('INVALID_INPUT', 'Choose a provider and explicit account target.');
  return { providerId: row.providerId, accountId: row.accountId };
}
function resolveTarget(store: Store, target: AccountAuthTarget) {
  parseAccountAuthTarget(target);
  const account = target.accountId === null ? null : accountResolver(store).get(target.accountId);
  if (target.accountId !== null && !account) throw new HarnessError('ACCOUNT_NOT_FOUND', 'Choose a saved subscription account.');
  if (account && account.providerId !== target.providerId) throw new HarnessError('ACCOUNT_PROVIDER_MISMATCH', 'This account belongs to another provider.');
  return account;
}
type Probe = (root: string, target: AccountAuthTarget) => Promise<Pick<AccountAuthStatus, 'state' | 'identity' | 'message'>>;
const probe: Probe = async (root, { providerId }) => {
  if (providerId === 'cursor-sdk') {
    const identity = await cursorAccountStatus(root);
    return { state: identity ? 'authenticated' : 'signed-out', identity: identity ?? unavailableIdentity(), message: identity ? 'Cursor authenticated this user. Paid allowance is unavailable.' : 'Sign in through the private Cursor browser flow.' };
  }
  if (providerId === 'claude-code') {
    const identity = await claudeAccountStatus(root);
    return { state: 'authenticated', identity, message: 'Claude supplied authenticated account metadata. Immutable subject identity and safe reconnect staging are unavailable; use a new local account to change users.' };
  }
  if (providerId === 'gemini-cli') return { state: 'unknown', identity: unavailableIdentity(), message: 'The pinned Gemini ACP interface does not expose account identity or a reliable sign-in status. Use its native console.' };
  const credentials = await createLiteralCredentialStore(taskPaths(root, 'login').authPath);
  const configured = (await credentials.list()).some(row => row.providerId === providerId);
  return { state: configured ? 'configured' : 'signed-out', identity: unavailableIdentity(), message: configured ? 'A local credential is configured. This SDK does not expose authenticated account identity; credential presence does not prove sign-in or entitlement.' : 'No supported local credential is configured. Sign in through the connection console.' };
};
const localSignout = (providerId: AccountAuthTarget['providerId']) => !isOfficialRuntimeProviderId(providerId) || providerId === 'cursor-sdk';
const unconfirmed = (error: unknown) => ['PI_CANCEL_UNCONFIRMED', 'RUNTIME_TEARDOWN_FAILED'].includes(String((error as { code?: unknown })?.code));

export async function readAccountAuth(store: Store, target: AccountAuthTarget, inspect: Probe = probe): Promise<AccountAuthStatus> {
  const account = resolveTarget(store, target), identity = unavailableIdentity();
  const base = { ...target, localSignout: localSignout(target.providerId), lastCheckedAt: new Date().toISOString() };
  if (store.all<{providerId:string;accountId:string|null;shutdownUnconfirmed?:boolean}>('accountUse').some(use => use.providerId === target.providerId && use.accountId === target.accountId && use.shutdownUnconfirmed)) return { ...base, state: 'blocked', identity, message: 'Native account cleanup is unconfirmed. This account remains blocked.' };
  const login = store.get<{shutdownUnconfirmed?: boolean}>('accountLogin', JSON.stringify([target.providerId, target.accountId]));
  if (login) return { ...base, state: login.shutdownUnconfirmed ? 'blocked' : 'signing-in', identity, message: login.shutdownUnconfirmed ? 'Native shutdown is unconfirmed. This account remains blocked.' : 'A sign-in console owns this account. An expired or closed console does not establish native cleanup.' };
  const resolver = accountResolver(store), lease = resolver.claimUse!(target.providerId, target.accountId); let release = true;
  try { return { ...base, ...await withAccountProfile(store.dataDir, account, root => inspect(root, target)), lastCheckedAt: new Date().toISOString() }; }
  catch (error) {
    if (unconfirmed(error)) { release = false; holdAccountUse(store, lease); }
    return { ...base, state: (error as {code?: unknown})?.code === 'ACCOUNT_IDENTITY_MISMATCH' || !release ? 'blocked' : 'unavailable', identity, message: (error as {code?: unknown})?.code === 'ACCOUNT_IDENTITY_MISMATCH' ? 'The authenticated account differs from this private profile. Add a new local account for another user.' : !release ? 'Native account check cleanup is unconfirmed. This account remains blocked.' : 'The native account check could not confirm readiness. Complete native sign-in or retry the check.' };
  } finally { if (release) resolver.releaseUse!(lease); }
}
export async function signOutAccount(store: Store, target: AccountAuthTarget, remove = async (root: string, selected: AccountAuthTarget) => {
  if (selected.providerId === 'cursor-sdk') { await cursorLocalSignout(root); return; }
  const sdk = await loadSdk(), authPath = taskPaths(root, 'login').authPath, credentials = await createLiteralCredentialStore(authPath);
  const runtime = await sdk.ModelRuntime.create({ authPath, credentials, modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  await runtime.logout(selected.providerId);
}): Promise<AccountAuthStatus> {
  const account = resolveTarget(store, target);
  if (!localSignout(target.providerId)) throw new HarnessError('ACCOUNT_SIGNOUT_UNSUPPORTED', 'This native provider does not expose a supported local sign-out operation. Use its official account controls.');
  const lease = beginAccountLogin(store, target.providerId, target.accountId);
  try { await withAccountProfile(store.dataDir, account, root => remove(root, target)); }
  catch (error) { if (unconfirmed(error)) holdAccountLogin(store, lease); throw new HarnessError(unconfirmed(error) ? 'RUNTIME_TEARDOWN_FAILED' : 'ACCOUNT_SIGNOUT_FAILED', unconfirmed(error) ? 'Local sign-out shutdown could not be confirmed. This account remains blocked.' : 'The provider could not complete local sign-out. Retry after native work has stopped.'); }
  finally { endAccountLogin(store, lease); }
  return { ...target, state: 'signed-out', identity: unavailableIdentity(), localSignout: true, lastCheckedAt: new Date().toISOString(), message: 'Local credentials removed. Remote sessions and provider grants were not revoked.' };
}
