import { useEffect, useId, useRef, useState } from 'react';
import { BarChart3, RefreshCw } from 'lucide-react';
import { Modal } from '../../../packages/ui-shell/Modal';
import { Select } from '../../../packages/ui-shell/Select';
import { isComposing } from '../../../packages/ui-shell/list-navigation';
import { usageCost, usageCount, usagePercent, usageReset, type UsageProviderReport } from './usage-presentation';
import './usage-dialog.css';

export interface UsageDialogProps {
  open: boolean; onClose: () => void; reports?: readonly UsageProviderReport[];
  loading?: boolean; error?: string; onRefresh?: () => Promise<void>;
}
const tabs = ['Cost', 'Tokens', 'Limits'] as const;
export function UsageDialog({ open, onClose, reports = [], loading = false, error, onRefresh }: UsageDialogProps) {
  const [tab, setTab] = useState<typeof tabs[number]>('Cost'), [scope, setScope] = useState(''), [provider, setProvider] = useState('');
  const [refreshing, setRefreshing] = useState(false), [refreshError, setRefreshError] = useState('');
  const pending = useRef(false), generation = useRef(0), id = useId();
  useEffect(() => { generation.current++; return () => { generation.current++; }; }, [open]);
  useEffect(() => { if (!open) { pending.current = false; setRefreshing(false); setRefreshError(''); } }, [open]);
  const scopes = [...new Map(reports.map(report => [report.scopeId, report.scopeLabel])).entries()];
  const providers = [...new Map(reports.map(report => [report.providerId, report.providerLabel])).entries()];
  // A removed scope/provider cannot leave an invisible stale filter behind.
  const selectedScope = scopes.some(([value]) => value === scope) ? scope : '';
  const selectedProvider = providers.some(([value]) => value === provider) ? provider : '';
  const visible = reports.filter(report => (!selectedScope || report.scopeId === selectedScope) && (!selectedProvider || report.providerId === selectedProvider));
  const refresh = async () => {
    if (!onRefresh || pending.current) return;
    pending.current = true; setRefreshing(true); setRefreshError(''); const owner = generation.current;
    try { await onRefresh(); }
    catch (cause) { if (generation.current === owner) setRefreshError(cause instanceof Error ? cause.message : 'Usage could not be refreshed. Try again.'); }
    finally { if (generation.current === owner) { pending.current = false; setRefreshing(false); } }
  };
  return <Modal open={open} title="Usage" onClose={onClose} className="usage-dialog">
    <div className="usage-dialog-controls">
      <div role="tablist" aria-label="Usage metric">{tabs.map((name, index) => <button key={name} type="button" role="tab"
        id={`${id}-${name}`} aria-selected={tab === name} aria-controls={`${id}-rows`} tabIndex={tab === name ? 0 : -1}
        onClick={() => setTab(name)} onKeyDown={event => {
          if (isComposing(event)) return;
          const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
          if (next === null) return; event.preventDefault(); setTab(tabs[next]);
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
        }}>{name}</button>)}</div>
      <div className="usage-dialog-filters">
        <Select aria-label="Usage scope" value={selectedScope} onValueChange={setScope} options={[{ value: '', label: 'All scopes' }, ...scopes.map(([value, label]) => ({ value, label }))]} />
        <Select aria-label="Usage provider" value={selectedProvider} onValueChange={setProvider} options={[{ value: '', label: 'All providers' }, ...providers.map(([value, label]) => ({ value, label }))]} />
        {onRefresh && <button type="button" className="usage-refresh" disabled={loading || refreshing} onClick={() => void refresh()} aria-label="Refresh usage"><RefreshCw size={15} aria-hidden="true" /><span>{refreshing ? 'Refreshing…' : 'Refresh'}</span></button>}
      </div>
      {(error || refreshError) && <p className="usage-dialog-error" role="alert">{error || refreshError}</p>}
      {(loading || refreshing) && <p className="usage-dialog-status" role="status">{reports.length ? 'Refreshing usage…' : 'Loading usage…'}</p>}
    </div>
    <div className="usage-provider-list" role="tabpanel" id={`${id}-rows`} aria-labelledby={`${id}-${tab}`} aria-busy={loading || refreshing} tabIndex={0}>
      {!visible.length && !loading && (reports.length
        ? <p className="usage-dialog-empty">No reported usage matches these filters.</p>
        : <div className="usage-dialog-empty-state">
          <BarChart3 size={20} aria-hidden="true" />
          <strong>No usage reported yet</strong>
          <p>Cost, tokens and limits appear here once a connected account reports usage. Run a conversation, then refresh.</p>
          {onRefresh && <button type="button" className="usage-refresh" disabled={refreshing} onClick={() => void refresh()}><RefreshCw size={15} aria-hidden="true" /><span>{refreshing ? 'Refreshing…' : 'Refresh'}</span></button>}
        </div>)}
      {!visible.length && loading && <div className="usage-dialog-skeleton" aria-hidden="true"><span /><span /><span /></div>}
      {visible.map(report => <section className="usage-provider-row" key={report.id} aria-label={`${report.providerLabel} · ${report.scopeLabel}`}>
        <header><strong>{report.providerLabel}</strong><span>{report.scopeLabel}</span></header>
        {report.error && <p className="usage-dialog-error" role="alert">{report.error}</p>}
        {tab === 'Cost' && <dl><dt>Reported cost</dt><dd>{usageCost(report.cost)}</dd></dl>}
        {tab === 'Tokens' && <dl><dt>Input tokens</dt><dd>{usageCount(report.inputTokens)}</dd><dt>Output tokens</dt><dd>{usageCount(report.outputTokens)}</dd></dl>}
        {tab === 'Limits' && (report.limits?.length ? report.limits : [{ id: 'unknown', label: 'Provider limit' }]).map(limit => <div key={limit.id} className="usage-limit"><dl><dt>{limit.label}</dt><dd>{usagePercent(limit.usedPercent)}</dd><dt>Reset</dt><dd>{usageReset(limit.reset)}</dd></dl></div>)}
      </section>)}
    </div>
  </Modal>;
}
