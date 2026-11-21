import {settingsOperation} from './settings-operations';
/*
 * Account picker selection and row composition adapted from T3 Code
 * apps/web/src/components/settings/ChatGptAccountPicker.tsx.
 * Copyright (c) 2026 T3 Tools Inc. MIT License.
 * Source and complete license: third-party/t3code/README.md.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, LogIn } from 'lucide-react';
import { SUBSCRIPTION_CONNECTIONS, isConnectionProviderId, type SubscriptionConnection } from '../../../packages/contracts/connections';
import type { Snapshot } from '../../../packages/contracts';
import type { AccountAuthStatus, AccountAuthTarget, AccountLoginFlow } from '../../../packages/contracts/authentication';
import { getAccountAuth, signOutAccount, cancelAccountPredictions, type AccountAuthChanged } from './account-api';
import {accountTargetKey} from './account-login-monitor';
import type { ConnectionAccount } from '../../../packages/contracts/accounts';
import { command } from './api';
import { useDesktop } from './desktop-context';
import './connections.css';
const AUTH_LABELS: Record<string, string> = {error: 'Status unavailable', checking: 'Checking connection…', cancelling: 'Stopping sign-in', configured: 'Saved, not verified', authenticated: 'Signed in', rejected: 'Not accepted', 'signed-out': 'Not signed in', blocked: 'Connection blocked', 'signing-in': 'Sign-in in progress', unavailable: 'Unavailable', unknown: 'Status unknown'};
function AccountReadiness({ target, flow, desktop, login, label, busy, onAuthChanged }: { target: AccountAuthTarget; flow?: AccountLoginFlow; desktop: ReturnType<typeof useDesktop>; login: () => void; label:string; busy:boolean; onAuthChanged:AccountAuthChanged }) {
  const [auth, setAuth] = useState<AccountAuthStatus | null>(null), [checking, setChecking] = useState(()=>!flow||!['opening','waiting','cancelling','blocked'].includes(flow.state)), [error, setError] = useState('');
  const generation = useRef(0), pending = useRef(false), read = useRef<AbortController|null>(null);
  const check = useCallback(async () => {
    const version = ++generation.current; setChecking(true); setError('');
    read.current?.abort();const controller=new AbortController();read.current=controller;
    try { const next = await getAccountAuth(target,controller.signal); if (!controller.signal.aborted&&version === generation.current) setAuth(next); }
    catch { if (!controller.signal.aborted&&version === generation.current) setError('Connection status is unavailable. Retry the check.'); }
    finally { if (!controller.signal.aborted&&version === generation.current) setChecking(false); }
  },[target.providerId,target.accountId]);
  const active = flow && ['opening', 'waiting', 'cancelling'].includes(flow.state);
  useEffect(() => {
    if(active||flow?.state==='blocked'){setChecking(false);setError('');}
    else void check();
    return () => { generation.current++;read.current?.abort(); };
  }, [check, flow?.state,flow?.id]);
  const signout = async () => {
    if (pending.current) return; pending.current = true;const version=++generation.current;read.current?.abort();setChecking(true); setError('');
    try { const next=await signOutAccount(target);if(version===generation.current)setAuth(next);await onAuthChanged(target,'signed-out'); }
    catch (cause) { if(version===generation.current)setError(cause instanceof Error ? cause.message : 'Local sign-out failed. Retry after native work stops.'); }
    finally { pending.current = false;if(version===generation.current)setChecking(false); }
  };
  const identityBound=target.providerId==='claude-code'&&(auth?.state==='authenticated'||auth?.state==='blocked');
  const blocked=auth?.state==='blocked'||flow?.state==='blocked'||auth?.state==='signing-in';
  const connectionState=error?'error':checking?'checking':auth?.state==='blocked'||flow?.state==='blocked'?'blocked':flow?.state==='cancelling'?'cancelling':active||auth?.state==='signing-in'?'signing-in':auth?.state??'unknown';
  const identity=auth?.identity.availability==='unavailable'?'':[auth?.identity.email??auth?.identity.subject,auth?.identity.organization,auth?.identity.subscription].filter(Boolean).join(' · ');
  return <div className="connection-account-auth" aria-busy={checking || !!active} data-state={connectionState}>
    <p className="connection-auth-summary" role="status"><strong>{AUTH_LABELS[connectionState] ?? connectionState.replaceAll('-', ' ')}</strong></p>
    {auth&&['blocked','rejected','unavailable'].includes(auth.state)&&<p role="status">{auth.message}</p>}
    {identity&&<p>{identity}</p>}
    {flow && <p className="connection-flow-message" data-flow-state={flow.state} aria-live="polite">{flow.message}</p>}
    {error && <p className="error-text" role="status">{error}</p>}
    <div className="connection-account-actions">{desktop?<button className="secondary connection-account-primary" disabled={busy||checking||!!active||blocked||identityBound} onClick={login}><LogIn size={14}/>{flow&&['failed','cancelled'].includes(flow.state)?'Retry sign-in':`Connect ${label}`}</button>:null}<button className={desktop ? 'quiet' : 'secondary connection-account-primary'} disabled={checking || !!active || flow?.state==='blocked'} onClick={() => void check()}>Check connection</button>
    {active && desktop?.bridge.cancelSignIn && <button className="quiet" disabled={flow.state === 'cancelling'} onClick={() => {const version=generation.current;void desktop.cancelSignIn(flow.id).catch(() => {if(version===generation.current)setError('Native shutdown could not be confirmed. Check connection status.');}); }}>Cancel sign-in</button>}
    {auth?.localSignout && <button className="quiet" disabled={checking || !!active || blocked || auth.state === 'signed-out'} onClick={() => void signout()}>Sign out locally</button>}</div>
    {!desktop && <details className="connection-terminal"><summary>Connect from a terminal</summary><p>Run this on the computer hosting Gen V1, then check the connection.</p><code>pnpm agent:login --provider {target.providerId}{target.accountId?` --account-id ${target.accountId}`:''}</code></details>}
  </div>;
}

const LEGACY = 'legacy-connection';
type AccountAction = (type: string, payload: Record<string, unknown>) => Promise<boolean>;
function AccountPicker({ connection, accounts, selectedAccountId, selectedMethodId, select, busy, run }: {
  connection: SubscriptionConnection; accounts: ConnectionAccount[]; selectedAccountId: string | null | undefined;
  selectedMethodId:string;select:(id:string)=>void;busy: string; run: AccountAction;
}) {
  const providerAccounts = accounts.filter(account => account.providerId === connection.id);
  const [editing, setEditing] = useState<{ id?: string } | null>(null);
  const [label, setLabel] = useState('');
  const [savingDefault, setSavingDefault] = useState(false);
  const selected = providerAccounts.find(account => account.id === selectedAccountId);
  const defaultMethodId = selected?.enabled ? selected.id : LEGACY;
  const choiceLabel = providerAccounts.find(account => account.id === selectedMethodId)?.label ?? 'Legacy connection';
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
    {providerAccounts.length > 0 && <><p className="connection-account-default"><span>Default for new tasks:</span>{' '}<strong>{selected?.enabled ? selected.label : 'Legacy connection'}</strong></p>
    <fieldset disabled={!!busy} className="connection-account-options"><legend className="sr-only">{connection.label} account for new tasks</legend>
      <div className="connection-account-row" data-chosen={selectedMethodId === LEGACY}><label className="connection-account-choice"><input type="radio" name={`account-${connection.id}`} aria-label="Legacy connection" checked={selectedMethodId === LEGACY} onChange={() => select(LEGACY)} /><span>Legacy connection</span>{defaultMethodId === LEGACY && <small className="connection-account-badge"><Check size={11} aria-hidden="true" />Default</small>}</label></div>
      {providerAccounts.map(account => <div className={`connection-account-row${account.enabled ? '' : ' connection-account-inactive'}`} key={account.id} data-account-id={account.id} data-chosen={selectedMethodId === account.id}>
        <div className="connection-account-line"><label className="connection-account-choice"><input type="radio" name={`account-${connection.id}`} aria-label={account.label} disabled={!account.enabled} checked={selectedMethodId === account.id} onChange={() => select(account.id)} /><span>{account.label}</span>{account.enabled && defaultMethodId === account.id && <small className="connection-account-badge"><Check size={11} aria-hidden="true" />Default</small>}{!account.enabled && <small>Removed</small>}</label>
          <div className="connection-account-actions"><button className="quiet" aria-label={`Rename ${account.label}`} onClick={() => { setEditing({ id: account.id }); setLabel(account.label); }}>Rename</button>{account.enabled ? <button className="quiet" aria-label={`Remove ${account.label}`} title="Disable for new tasks. Keep its private profile and existing task bindings." onClick={() => void run('account.remove', { accountId: account.id })}>Remove</button> : <button className="quiet" aria-label={`Restore ${account.label}`} onClick={() => void run('account.restore', { accountId: account.id })}>Restore</button>}</div></div>
      </div>)}
    </fieldset></>}
    <div className="connection-account-toolbar">{providerAccounts.length > 0 && <button className="secondary" disabled={!!busy || !changed} onClick={() => void useAccount()}>{savingDefault ? 'Saving default…' : 'Use account'}</button>}<button className="quiet" disabled={!!busy} onClick={() => { setEditing({}); setLabel(''); }}>Add account</button></div>
    {providerAccounts.length > 0 && <p role="status" className="sr-only">{savingDefault ? `Saving ${choiceLabel} as the default for new tasks…` : changed ? `${choiceLabel} is selected. Use account to make it the default for new tasks.` : `${choiceLabel} is the default for new tasks.`}</p>}
    {editing && <form className="connection-account-form" onSubmit={event => { event.preventDefault(); void save(); }}><label>Account label<input autoFocus aria-label="Account label" value={label} maxLength={80} disabled={!!busy} placeholder="e.g. Personal or Work" onChange={event => setLabel(event.target.value)} /></label><button className="secondary" disabled={!!busy || !label.trim()}>Save account</button><button type="button" className="quiet" disabled={!!busy} onClick={() => { setEditing(null); setLabel(''); }}>Cancel</button></form>}
  </div>;
}

export function Connections({ snapshot, refresh, loadModels, onAuthChanged, providerId, onProviderChange }: { snapshot: Pick<Snapshot, 'settings' | 'accounts'>; refresh: () => Promise<void>; loadModels: (refresh?: boolean) => Promise<void>; onAuthChanged:AccountAuthChanged; providerId:string; onProviderChange:(id:string)=>void }) {
  const desktop = useDesktop();
  const [busy, setBusy] = useState(''), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const pending = useRef(false);
  const [choices,setChoices]=useState<Record<string,string>>({});
  const rows = SUBSCRIPTION_CONNECTIONS;
  const connection=rows.find(row=>row.id===providerId)??rows[0];
  const preferred=connection?(choices[connection.id]??snapshot.settings.selectedAccounts?.[connection.id as AccountAuthTarget['providerId']]??LEGACY):LEGACY;
  const selectedAccount=preferred===LEGACY?undefined:snapshot.accounts?.find(account=>account.providerId===connection?.id&&account.id===preferred&&account.enabled);
  const selectedMethodId=selectedAccount?.id??LEGACY,accountId=selectedAccount?.id??null;
  const selectedKey=connection?accountTargetKey(connection.id,accountId):'',latestTarget=useRef(selectedKey);latestTarget.current=selectedKey;
  const ownedFlow=Object.values(desktop?.flows??{}).find(flow=>['opening','waiting','cancelling','blocked'].includes(flow.state));
  const otherFlow=ownedFlow&&accountTargetKey(ownedFlow.providerId,ownedFlow.accountId)!==selectedKey;
  const run: AccountAction = async (type, payload) => {
    if (pending.current) return false;
    pending.current = true; setBusy(type); setError(''); setNotice('');
    try { await settingsOperation(async () => {await command(type, payload); await refresh(); if (type === 'account.select') await loadModels(true);}); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The account could not be updated. Try again.'); return false; }
    finally { pending.current = false; setBusy(''); }
  };
  const login = async (id: string, accountId?: string) => {
    if (!desktop || pending.current || !isConnectionProviderId(id)) return;
    pending.current = true; setBusy(`login:${accountId ?? id}`); setError(''); setNotice('');
    const key=accountTargetKey(id,accountId);
    try { await cancelAccountPredictions(); const flow = await desktop.signIn(id, accountId); if(latestTarget.current===key)setNotice(flow ? '' : 'Connection console opened. Complete setup in that console, then check connection status.'); }
    catch (cause) { if(latestTarget.current===key)setError(cause instanceof Error ? cause.message : 'The sign-in console could not open.'); }
    finally { pending.current = false; setBusy(''); }
  };
  return <section className="connection-list" aria-label="AI subscription connections">
    <nav className="connection-providers" aria-label="Subscription providers">{rows.map(row=><button type="button" key={row.id} aria-pressed={row.id===connection?.id} onClick={()=>{onProviderChange(row.id);setError('');setNotice('');}}>{row.label}</button>)}</nav>
    {otherFlow&&<p role="status">A sign-in still owns {SUBSCRIPTION_CONNECTIONS.find(row=>row.id===ownedFlow.providerId)?.label}. <button className="quiet" onClick={()=>{onProviderChange(ownedFlow.providerId);setChoices(current=>({...current,[ownedFlow.providerId]:ownedFlow.accountId??LEGACY}));setError('');setNotice('');}}>View sign-in</button></p>}
    {notice && <p role="status">{notice}</p>}{error && <p role="status" className="error-text">{error}</p>}
    {connection&&<article className="connection-row" data-provider={connection.id} data-setting-id={`provider-${connection.id}`}><header><strong>{connection.label}</strong></header>
      {isConnectionProviderId(connection.id)?<>
        <AccountReadiness key={accountTargetKey(connection.id,accountId)} target={{providerId:connection.id,accountId}} label={selectedAccount?.label??connection.label} busy={!!busy||!!otherFlow} flow={desktop?.flows[accountTargetKey(connection.id,accountId)]} desktop={desktop} login={()=>void login(connection.id,accountId??undefined)} onAuthChanged={onAuthChanged}/>
        <AccountPicker key={connection.id} connection={connection} accounts={snapshot.accounts??[]} selectedAccountId={snapshot.settings.selectedAccounts?.[connection.id]} selectedMethodId={selectedMethodId} select={id=>{setChoices(current=>({...current,[connection.id]:id}));setNotice('');setError('');}} busy={busy} run={run}/>
      </>:<p>Unavailable. {connection.status==='runtime-pending'?'Runtime integration is pending.':'This connection has not been verified for the harness.'}</p>}
      <details><summary>Runtime and setup details</summary><p>{connection.description}</p><p className="connection-policy">No automatic account switching or API billing fallback. Provider Extra Usage settings still apply.</p><a href={connection.sources[0]} target="_blank" rel="noreferrer">Connection details<ExternalLink size={12}/></a></details>
    </article>}
  </section>;
}
