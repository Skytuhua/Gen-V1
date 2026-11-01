import { useState } from 'react';
import { ExternalLink, LogIn } from 'lucide-react';
import { SUBSCRIPTION_CONNECTIONS, isConnectionProviderId } from '../../../packages/contracts/connections';
import type { ModelInfo } from '../../../packages/contracts';
import { useDesktop } from './desktop-context';
import './connections.css';
export function matchingSubscriptionConnections(query: string) {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return SUBSCRIPTION_CONNECTIONS.filter(item => tokens.every(token => `${item.label} ${item.description}`.toLowerCase().includes(token)));
}

export function Connections({ models, query = '' }: { models: ModelInfo[]; query?: string }) {
  const desktop = useDesktop(); const [busy, setBusy] = useState(''), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const rows = matchingSubscriptionConnections(query);
  const login = async (id: string) => {
    if (!desktop || busy || !isConnectionProviderId(id)) return;
    setBusy(id); setError(''); setNotice('');
    try { await desktop.bridge.signIn(id); setNotice('Connection console opened. Complete setup, then refresh models.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The sign-in console could not open.'); }
    finally { setBusy(''); }
  };
  return <section className="connection-list" aria-label="AI subscription connections"><header><h2>AI subscriptions</h2><p>Connect your subscription, then refresh models. No automatic pay-as-you-go fallback. Provider Extra Usage settings still apply.</p></header>{notice && <p role="status">{notice}</p>}{error && <p role="alert" className="error-text">{error}</p>}{rows.map(connection => {
    const ready = connection.status === 'available', availableModels = models.filter(model => model.provider === connection.id);
    return <article key={connection.id} className="connection-row" data-provider={connection.id}><header><strong>{connection.label}</strong><span className={ready ? 'connection-ready' : 'connection-pending'}>{availableModels.length ? `${availableModels.length} models available` : ready ? 'Ready to connect' : 'Integration pending'}</span></header><p>{connection.description}</p><footer>{ready ? desktop ? <button className="secondary" disabled={!!busy} onClick={() => void login(connection.id)}><LogIn size={14} />{busy === connection.id ? 'Opening…' : `Connect ${connection.label}`}</button> : <code>pnpm agent:login --provider {connection.id}</code> : <button className="secondary" disabled>Unavailable</button>}<a href={connection.sources[0]} target="_blank" rel="noreferrer">Connection details<ExternalLink size={12} /></a></footer></article>;
  })}</section>;
}
