/*
 * Account picker selection and row composition adapted from T3 Code
 * apps/web/src/components/settings/ChatGptAccountPicker.tsx.
 * Copyright (c) 2026 T3 Tools Inc. MIT License.
 * Source and complete license: third-party/t3code/README.md.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, LogIn } from 'lucide-react';
import { SUBSCRIPTION_CONNECTIONS, isConnectionProviderId, type SubscriptionConnection } from '../../../packages/contracts/connections';
import type { ModelInfo, Snapshot } from '../../../packages/contracts';
import type { AccountAuthStatus, AccountAuthTarget, AccountLoginFlow } from '../../../packages/contracts/authentication';
import { getAccountAuth, signOutAccount, cancelAccountPredictions } from './account-api';
import type { DesktopBridge } from '../../../packages/desktop-contract';
import type { ConnectionAccount } from '../../../packages/contracts/accounts';
import { command } from './api';
import { useDesktop } from './desktop-context';
import './connections.css';
export function matchingSubscriptionConnections(query: string) {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return SUBSCRIPTION_CONNECTIONS.filter(item => tokens.every(token => `${item.label} ${item.description}`.toLowerCase().includes(token)));
}

const targetKey = (providerId: string, accountId?: string | null) => JSON.stringify([providerId, accountId ?? null]);
function AccountReadiness({ target, flow, bridge, onFlow, login }: { target: AccountAuthTarget; flow?: AccountLoginFlow; bridge?: DesktopBridge; onFlow: (flow: AccountLoginFlow) => void; login: () => void }) {
  const [auth, setAuth] = useState<AccountAuthStatus | null>(null), [checking, setChecking] = useState(false), [error, setError] = useState('');
  const generation = useRef(0), pending = useRef(false);
  const check = async () => {
    const version = ++generation.current; setChecking(true); setError('');
    try { const next = await getAccountAuth(target); if (version === generation.current) setAuth(next); }
    catch { if (version === generation.current) setError('Connection status is unavailable. Retry the check.'); }
    finally { if (version === generation.current) setChecking(false); }
  };
  useEffect(() => { void check(); return () => { generation.current++; }; }, [target.providerId, target.accountId, flow?.state]);
  const active = flow && ['opening', 'waiting', 'cancelling'].includes(flow.state);
  const signout = async () => {
    if (pending.current) return; pending.current = true; ++generation.current; setChecking(true); setError('');
    try { setAuth(await signOutAccount(target)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Local sign-out failed. Retry after native work stops.'); }
    finally { pending.current = false; setChecking(false); }
  };
  return <div className="connection-account-auth" aria-busy={checking || !!active}>
    <p aria-live="polite">{auth ? `${auth.state === 'configured' ? 'Credential configured' : auth.state.replaceAll('-', ' ')}. ${auth.message}` : 'Connection status not checked. Identity unavailable.'}</p>
    {auth?.identity.availability !== 'unavailable' && auth?.identity && <p>{auth.identity.availability === 'verified' ? `Verified provider user ${auth.identity.subject}` : 'Authenticated account metadata (immutable identity unavailable)'}{auth.identity.email ? ` | ${auth.identity.email}` : ''}{auth.identity.organization ? ` | ${auth.identity.organization}` : ''}{auth.identity.subscription ? ` | ${auth.identity.subscription}` : ''}</p>}
    {auth?.identity.availability === 'unavailable' && <small>Authenticated identity unavailable.</small>}
    {auth?.lastCheckedAt && <small>Last checked {new Date(auth.lastCheckedAt).toLocaleTimeString()}</small>}
    {flow && <p aria-live="polite">{flow.message}</p>}
    {error && <p className="error-text" role="alert">{error}</p>}
    <div className="connection-account-actions"><button className="quiet" disabled={checking || !!active} onClick={() => void check()}>Check connection</button>
    {active && bridge?.cancelSignIn && <button className="quiet" disabled={flow.state === 'cancelling'} onClick={() => { void bridge.cancelSignIn!(flow.id).then(onFlow).catch(() => setError('Native shutdown could not be confirmed. Check connection status.')); }}>Cancel sign-in</button>}
    {flow && ['failed', 'cancelled'].includes(flow.state) && bridge && <button className="quiet" disabled={checking || auth?.state === 'blocked' || auth?.state === 'signing-in'} onClick={login}>Retry sign-in</button>}
    {auth?.localSignout && <button className="quiet" disabled={checking || !!active || auth.state === 'blocked' || auth.state === 'signing-in' || auth.state === 'signed-out'} onClick={() => void signout()}>Sign out locally</button>}</div>
  </div>;
}

const LEGACY = 'legacy-connection';
type AccountAction = (type: string, payload: Record<string, unknown>) => Promise<boolean>;
function AccountPicker({ connection, accounts, selectedAccountId, busy, run, login, desktop, readiness }: {
  connection: SubscriptionConnection; accounts: ConnectionAccount[]; selectedAccountId: string | null | undefined;
  busy: string; run: AccountAction; login: (providerId: string, accountId?: string) => Promise<void>; desktop: boolean; readiness: (accountId: string) => React.ReactNode;
}) {
  const profiles = accounts.filter(account => account.providerId === connection.id && account.enabled);
  const providerAccounts = accounts.filter(account => account.providerId === connection.id);
  const [selection, setSelection] = useState<string | null>(null);
  // T3 retains an explicit choice when its profile still exists, then resolves
  // the saved default. Legacy connection is an explicit null account.
  const selectedMethodId = selection === LEGACY ? selection
    : profiles.find(profile => profile.id === (selection ?? selectedAccountId))?.id
      ?? (selectedAccountId == null ? LEGACY : profiles[0]?.id ?? LEGACY);
  const [editing, setEditing] = useState<{ id?: string } | null>(null);
  const [label, setLabel] = useState('');
  const [savingDefault, setSavingDefault] = useState(false);
  const selected = providerAccounts.find(account => account.id === selectedAccountId);
  const defaultMethodId = selected?.enabled ? selected.id : LEGACY;
  const choiceLabel = profiles.find(account => account.id === selectedMethodId)?.label ?? 'Legacy connection';
  const changed = selectedMethodId !== defaultMethodId;
  const useAccount = async () => {
    if (busy || !changed) return;
    setSavingDefault(true);
    try { await run('account.select', { providerId: connection.id, accountId: selectedMethodId === LEGACY ? null : selectedMethodId }); }
    finally { setSavingDefault(false); }
  };
  const save = async () => {
    if (!label.trim() || busy) return;
    if (await run(editing?.id ? 'account.rename' : 'account.create', editing?.id ? { accountId: editing.id, label: label.trim() } : { providerId: connection.id, label: label.trim() })) { setEditing(null); setLabel(''); }
  };
  return <div className="connection-accounts" aria-busy={!!busy}>
    {providerAccounts.length > 0 && <><p className="connection-account-default">Default for new tasks: {selected?.enabled ? selected.label : 'Legacy connection'}</p>
    <fieldset disabled={!!busy} className="connection-account-options"><legend className="sr-only">{connection.label} account for new tasks</legend>
      <div className="connection-account-row" data-chosen={selectedMethodId === LEGACY}><label className="connection-account-choice"><input type="radio" name={`account-${connection.id}`} aria-label="Legacy connection" checked={selectedMethodId === LEGACY} onChange={() => setSelection(LEGACY)} /><span>Legacy connection</span>{defaultMethodId === LEGACY && <small className="connection-account-badge"><Check size={11} aria-hidden="true" />Default</small>}</label></div>
      {providerAccounts.map(account => <div className={`connection-account-row${account.enabled ? '' : ' connection-account-inactive'}`} key={account.id} data-account-id={account.id} data-chosen={selectedMethodId === account.id}>
        <div className="connection-account-line"><label className="connection-account-choice"><input type="radio" name={`account-${connection.id}`} aria-label={account.label} disabled={!account.enabled} checked={selectedMethodId === account.id} onChange={() => setSelection(account.id)} /><span>{account.label}</span>{account.enabled && defaultMethodId === account.id && <small className="connection-account-badge"><Check size={11} aria-hidden="true" />Default</small>}{!account.enabled && <small>Removed</small>}</label>
          <div className="connection-account-actions"><button className="quiet" aria-label={`Rename ${account.label}`} onClick={() => { setEditing({ id: account.id }); setLabel(account.label); }}>Rename</button>{account.enabled ? <button className="quiet" aria-label={`Remove ${account.label}`} title="Disable for new tasks. Keep its private profile and existing task bindings." onClick={() => void run('account.remove', { accountId: account.id })}>Remove</button> : <button className="quiet" aria-label={`Restore ${account.label}`} onClick={() => void run('account.restore', { accountId: account.id })}>Restore</button>}</div></div>
        {account.enabled && <div className="connection-account-connect">{desktop ? <button className="secondary" aria-label={`Connect ${account.label}`} onClick={() => void login(connection.id, account.id)}><LogIn size={13} />{busy === `login:${account.id}` ? 'Opening…' : 'Connect'}</button> : <code>pnpm agent:login --provider {connection.id} --account-id {account.id}</code>}</div>}{account.enabled && readiness(account.id)}
      </div>)}
    </fieldset></>}
    <div className="connection-account-toolbar">{providerAccounts.length > 0 && <button className="secondary" disabled={!!busy || !changed} onClick={() => void useAccount()}>{savingDefault ? 'Saving default…' : 'Use account'}</button>}<button className="quiet" disabled={!!busy} onClick={() => { setEditing({}); setLabel(''); }}>Add account</button></div>
    {providerAccounts.length > 0 && <p role="status" className={changed ? 'connection-account-selection' : 'sr-only'}>{savingDefault ? `Saving ${choiceLabel} as the default for new tasks…` : changed ? `${choiceLabel} is selected. Use account to make it the default for new tasks.` : `${choiceLabel} is the default for new tasks.`}</p>}
    {editing && <form className="connection-account-form" onSubmit={event => { event.preventDefault(); void save(); }}><label>Account label<input autoFocus aria-label="Account label" value={label} maxLength={80} disabled={!!busy} placeholder="e.g. Personal or Work" onChange={event => setLabel(event.target.value)} /></label><button className="secondary" disabled={!!busy || !label.trim()}>Save account</button><button type="button" className="quiet" disabled={!!busy} onClick={() => { setEditing(null); setLabel(''); }}>Cancel</button></form>}
    {providerAccounts.length > 0 && <p className="connection-account-help">Labels are local. Remove disables new selection and keeps the private profile. Existing tasks keep this account; restore it to select it again.</p>}
  </div>;
}

export function Connections({ snapshot, refresh, loadModels, query = '' }: { models: ModelInfo[]; snapshot: Snapshot; refresh: () => Promise<void>; loadModels: (refresh?: boolean) => Promise<void>; query?: string }) {
  const desktop = useDesktop();
  const [busy, setBusy] = useState(''), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const pending = useRef(false);
  const [flows, setFlows] = useState<Record<string, AccountLoginFlow>>({});
  const onFlow = (flow: AccountLoginFlow, replace = false) => setFlows(current => { const key = targetKey(flow.providerId, flow.accountId), previous = current[key]; return previous && previous.id !== flow.id && !replace ? current : { ...current, [key]: flow }; });
  useEffect(() => {
    if (!desktop?.bridge.signInStatus) return;
    const active = Object.values(flows).filter(flow => ['opening', 'waiting', 'cancelling'].includes(flow.state));
    if (!active.length) return;
    let disposed = false;
    const timer = setInterval(() => { for (const flow of active) void desktop.bridge.signInStatus!(flow.id).then(next => { if (!disposed && next?.id === flow.id) onFlow(next); }).catch(() => {}); }, 750);
    return () => { disposed = true; clearInterval(timer); };
  }, [desktop, flows]);
  const rows = matchingSubscriptionConnections(query);
  const run: AccountAction = async (type, payload) => {
    if (pending.current) return false;
    pending.current = true; setBusy(type); setError(''); setNotice('');
    try { await command(type, payload); await refresh(); if (type === 'account.select') await loadModels(true); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The account could not be updated. Try again.'); return false; }
    finally { pending.current = false; setBusy(''); }
  };
  const login = async (id: string, accountId?: string) => {
    if (!desktop || pending.current || !isConnectionProviderId(id)) return;
    pending.current = true; setBusy(`login:${accountId ?? id}`); setError(''); setNotice('');
    try { await cancelAccountPredictions(); const flow = await desktop.bridge.signIn(id, accountId); if (flow) onFlow(flow, true); setNotice(flow?.message ?? 'Connection console opened. Complete setup in that console, then check connection status.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The sign-in console could not open.'); }
    finally { pending.current = false; setBusy(''); }
  };
  const readiness = (providerId: string, accountId: string | null) => isConnectionProviderId(providerId) ? <AccountReadiness target={{ providerId, accountId }} flow={flows[targetKey(providerId, accountId)]} bridge={desktop?.bridge} onFlow={onFlow} login={() => void login(providerId, accountId ?? undefined)} /> : null;
  return <section className="connection-list" aria-label="AI subscription connections"><header><h2>AI subscriptions</h2><p>Choose a local account for new tasks, connect it, then refresh models. Existing tasks keep their account. No automatic rotation or pay-as-you-go fallback. Provider Extra Usage settings still apply.</p></header>{notice && <p role="status">{notice}</p>}{error && <p role="alert" className="error-text">{error}</p>}{rows.map(connection => {
    const ready = connection.status === 'available';
    return <article key={connection.id} className="connection-row" data-provider={connection.id}><header><strong>{connection.label}</strong><span className={ready ? 'connection-ready' : 'connection-pending'}>{ready ? 'Ready to connect' : 'Integration pending'}</span></header><p>{connection.description}</p>
      {ready && <AccountPicker connection={connection} accounts={snapshot.accounts ?? []} selectedAccountId={isConnectionProviderId(connection.id) ? snapshot.settings.selectedAccounts?.[connection.id] : null} busy={busy} run={run} login={login} desktop={!!desktop} readiness={accountId => readiness(connection.id, accountId)} />}
      {ready && readiness(connection.id, null)}<footer>{ready ? desktop ? <button className="secondary" disabled={!!busy} onClick={() => void login(connection.id)}><LogIn size={14} />{busy === `login:${connection.id}` ? 'Opening…' : `Connect ${connection.label}`}</button> : <code>pnpm agent:login --provider {connection.id}</code> : <button className="secondary" disabled>Unavailable</button>}<a href={connection.sources[0]} target="_blank" rel="noreferrer">Connection details<ExternalLink size={12} /></a></footer></article>;
  })}</section>;
}
