/*
 * Account picker selection and row composition adapted from T3 Code
 * apps/web/src/components/settings/ChatGptAccountPicker.tsx.
 * Copyright (c) 2026 T3 Tools Inc. MIT License.
 * Source and complete license: third-party/t3code/README.md.
 */
import { useRef, useState } from 'react';
import { ExternalLink, LogIn } from 'lucide-react';
import { SUBSCRIPTION_CONNECTIONS, isConnectionProviderId, type SubscriptionConnection } from '../../../packages/contracts/connections';
import type { ModelInfo, Snapshot } from '../../../packages/contracts';
import type { ConnectionAccount } from '../../../packages/contracts/accounts';
import { command } from './api';
import { useDesktop } from './desktop-context';
import './connections.css';
export function matchingSubscriptionConnections(query: string) {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return SUBSCRIPTION_CONNECTIONS.filter(item => tokens.every(token => `${item.label} ${item.description}`.toLowerCase().includes(token)));
}

const LEGACY = 'legacy-connection';
type AccountAction = (type: string, payload: Record<string, unknown>) => Promise<boolean>;
function AccountPicker({ connection, accounts, selectedAccountId, busy, run, login, desktop }: {
  connection: SubscriptionConnection; accounts: ConnectionAccount[]; selectedAccountId: string | null | undefined;
  busy: boolean; run: AccountAction; login: (providerId: string, accountId?: string) => Promise<void>; desktop: boolean;
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
  const selected = providerAccounts.find(account => account.id === selectedAccountId);
  const save = async () => {
    if (!label.trim() || busy) return;
    if (await run(editing?.id ? 'account.rename' : 'account.create', editing?.id ? { accountId: editing.id, label: label.trim() } : { providerId: connection.id, label: label.trim() })) { setEditing(null); setLabel(''); }
  };
  return <div className="connection-accounts">
    {providerAccounts.length > 0 && <><p className="connection-account-default">Default for new tasks: {selected?.enabled ? selected.label : 'Legacy connection'}</p>
    <fieldset disabled={busy} className="connection-account-options"><legend className="sr-only">{connection.label} account for new tasks</legend>
      <div className="connection-account-row"><label className="connection-account-choice"><input type="radio" name={`account-${connection.id}`} aria-label="Legacy connection" checked={selectedMethodId === LEGACY} onChange={() => setSelection(LEGACY)} /><span>Legacy connection</span></label></div>
      {providerAccounts.map(account => <div className={`connection-account-row${account.enabled ? '' : ' connection-account-inactive'}`} key={account.id} data-account-id={account.id}>
        <div className="connection-account-line"><label className="connection-account-choice"><input type="radio" name={`account-${connection.id}`} aria-label={account.label} disabled={!account.enabled} checked={selectedMethodId === account.id} onChange={() => setSelection(account.id)} /><span>{account.label}</span>{!account.enabled && <small>Removed</small>}</label>
          <div className="connection-account-actions"><button className="quiet" aria-label={`Rename ${account.label}`} onClick={() => { setEditing({ id: account.id }); setLabel(account.label); }}>Rename</button>{account.enabled ? <button className="quiet" aria-label={`Remove ${account.label}`} title="Disable for new tasks. Keep its private profile and existing task bindings." onClick={() => void run('account.remove', { accountId: account.id })}>Remove</button> : <button className="quiet" aria-label={`Restore ${account.label}`} onClick={() => void run('account.restore', { accountId: account.id })}>Restore</button>}</div></div>
        {account.enabled && <div className="connection-account-connect">{desktop ? <button className="secondary" aria-label={`Connect ${account.label}`} onClick={() => void login(connection.id, account.id)}><LogIn size={13} />Connect</button> : <code>pnpm agent:login --provider {connection.id} --account-id {account.id}</code>}</div>}
      </div>)}
    </fieldset></>}
    <div className="connection-account-toolbar">{providerAccounts.length > 0 && <button className="secondary" disabled={busy || selectedMethodId === (selectedAccountId ?? LEGACY)} onClick={() => void run('account.select', { providerId: connection.id, accountId: selectedMethodId === LEGACY ? null : selectedMethodId })}>Use account</button>}<button className="quiet" disabled={busy} onClick={() => { setEditing({}); setLabel(''); }}>Add account</button></div>
    {editing && <form className="connection-account-form" onSubmit={event => { event.preventDefault(); void save(); }}><label>Account label<input autoFocus aria-label="Account label" value={label} maxLength={80} disabled={busy} placeholder="e.g. Personal or Work" onChange={event => setLabel(event.target.value)} /></label><button className="secondary" disabled={busy || !label.trim()}>Save account</button><button type="button" className="quiet" disabled={busy} onClick={() => { setEditing(null); setLabel(''); }}>Cancel</button></form>}
    {providerAccounts.length > 0 && <p className="connection-account-help">Labels are local. Remove disables new selection and keeps the private profile. Existing tasks keep this account; restore it to select it again.</p>}
  </div>;
}

export function Connections({ models, snapshot, refresh, loadModels, query = '' }: { models: ModelInfo[]; snapshot: Snapshot; refresh: () => Promise<void>; loadModels: (refresh?: boolean) => Promise<void>; query?: string }) {
  const desktop = useDesktop();
  const [busy, setBusy] = useState(''), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const pending = useRef(false);
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
    try { await desktop.bridge.signIn(id, accountId); setNotice('Connection console opened. Complete setup, then refresh models.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The sign-in console could not open.'); }
    finally { pending.current = false; setBusy(''); }
  };
  return <section className="connection-list" aria-label="AI subscription connections"><header><h2>AI subscriptions</h2><p>Choose a local account for new tasks, connect it, then refresh models. Existing tasks keep their account. No automatic rotation or pay-as-you-go fallback. Provider Extra Usage settings still apply.</p></header>{notice && <p role="status">{notice}</p>}{error && <p role="alert" className="error-text">{error}</p>}{rows.map(connection => {
    const ready = connection.status === 'available', availableModels = models.filter(model => model.provider === connection.id);
    return <article key={connection.id} className="connection-row" data-provider={connection.id}><header><strong>{connection.label}</strong><span className={ready ? 'connection-ready' : 'connection-pending'}>{availableModels.length ? `${availableModels.length} models available` : ready ? 'Ready to connect' : 'Integration pending'}</span></header><p>{connection.description}</p>
      {ready && <AccountPicker connection={connection} accounts={snapshot.accounts ?? []} selectedAccountId={isConnectionProviderId(connection.id) ? snapshot.settings.selectedAccounts?.[connection.id] : null} busy={!!busy} run={run} login={login} desktop={!!desktop} />}
      <footer>{ready ? desktop ? <button className="secondary" disabled={!!busy} onClick={() => void login(connection.id)}><LogIn size={14} />{busy === `login:${connection.id}` ? 'Opening…' : `Connect ${connection.label}`}</button> : <code>pnpm agent:login --provider {connection.id}</code> : <button className="secondary" disabled>Unavailable</button>}<a href={connection.sources[0]} target="_blank" rel="noreferrer">Connection details<ExternalLink size={12} /></a></footer></article>;
  })}</section>;
}
