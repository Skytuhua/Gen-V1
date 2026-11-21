import { useEffect, useId, useRef, useState } from 'react';
import { BarChart3, RefreshCw } from 'lucide-react';
import { Modal } from '../../../packages/ui-shell/Modal';
import { Select } from '../../../packages/ui-shell/Select';
import { isComposing } from '../../../packages/ui-shell/list-navigation';
import { usageCost, usageCount, usagePercent, usageReset, type UsageProviderReport } from './usage-presentation';
import type { ModelRequestObservationV1 } from '../../../packages/contracts/model-request';
import './usage-dialog.css';
import {ErrorState} from '../../../packages/ui-shell/Feedback';

export interface UsageDialogProps {
  open: boolean; onClose: () => void; reports?: readonly UsageProviderReport[];
  requests?: readonly ModelRequestObservationV1[];
  loading?: boolean; error?: string; onRefresh?: () => Promise<void>;
}
const tabs = ['Cost', 'Tokens', 'Limits', 'Requests'] as const;
const elapsed = (value: number | null) => value === null ? 'Not reported' : `${value < 10 ? Math.round(value * 10) / 10 : Math.round(value)} ms`;
// `queued` is the epoch-ms admission point, not an elapsed offset like the
// other stages — render it as a time, not a duration.
const stageValue = (stage: typeof REQUEST_STAGES[number][0], value: number | null) =>
  stage === 'queued' ? (value === null ? 'Not reported' : new Date(value).toLocaleTimeString()) : elapsed(value);
const REQUEST_STAGES = [
  ['queued', 'Queued'],
  ['acquired', 'Capacity'],
  ['runtimeReady', 'Runtime'],
  ['requestSent', 'Sent'],
  ['firstProviderDelta', 'First bytes'],
  ['firstPublicDelta', 'First output'],
  ['settled', 'Settled'],
  ['teardownConfirmed', 'Cleanup'],
] as const;
const REQUEST_METRICS = [
  ['inputTokens', 'Input'],
  ['outputTokens', 'Output'],
  ['cacheReadTokens', 'Cache read'],
  ['cacheWriteTokens', 'Cache write'],
] as const;
export function UsageDialog({ open, onClose, reports = [], requests = [], loading = false, error, onRefresh }: UsageDialogProps) {
  const [tab, setTab] = useState<typeof tabs[number]>('Cost'), [scope, setScope] = useState(''), [provider, setProvider] = useState('');
  const [refreshing, setRefreshing] = useState(false), [refreshError, setRefreshError] = useState('');
  const pending = useRef(false), generation = useRef(0), id = useId();
  useEffect(() => { generation.current++; return () => { generation.current++; }; }, [open]);
  useEffect(() => { if (!open) { pending.current = false; setRefreshing(false); setRefreshError(''); } }, [open]);
  const scopes = [...new Map(reports.map(report => [report.scopeId, report.scopeLabel])).entries()];
  const reportProviders = new Map(reports.map(report => [report.providerId, report.providerLabel]));
  const isRequests = tab === 'Requests';
  const providers = [...(isRequests
    ? new Map(requests.map(({binding}) => [binding.providerId, reportProviders.get(binding.providerId) ?? binding.providerId]))
    : reportProviders).entries()];
  // A removed scope/provider cannot leave an invisible stale filter behind.
  const selectedScope = scopes.some(([value]) => value === scope) ? scope : '';
  const selectedProvider = providers.some(([value]) => value === provider) ? provider : '';
  const visible = reports.filter(report => (!selectedScope || report.scopeId === selectedScope) && (!selectedProvider || report.providerId === selectedProvider));
  // Requests are measured per binding, not per provider report — filter them by
  // the provider picker only, newest first, and render them as their own list.
  const visibleRequests = requests
    .filter(request => !selectedProvider || request.binding.providerId === selectedProvider)
    .sort((a, b) => b.timings.queued - a.timings.queued);
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
        {!isRequests && <Select aria-label="Usage scope" value={selectedScope} onValueChange={setScope} options={[{ value: '', label: 'All scopes' }, ...scopes.map(([value, label]) => ({ value, label }))]} />}
        <Select aria-label="Usage provider" value={selectedProvider} onValueChange={setProvider} options={[{ value: '', label: 'All providers' }, ...providers.map(([value, label]) => ({ value, label }))]} />
        {onRefresh && <button type="button" className="usage-refresh" disabled={loading || refreshing} onClick={() => void refresh()} aria-label="Refresh usage"><RefreshCw size={15} aria-hidden="true" /><span>{refreshing ? 'Refreshing…' : 'Refresh'}</span></button>}
      </div>
      {(error || refreshError) && <ErrorState className="usage-dialog-error" message={error || refreshError}/>}
      {(loading || refreshing) && <p className="usage-dialog-status" role="status">{reports.length ? 'Refreshing usage…' : 'Loading usage…'}</p>}
    </div>
    <div className="usage-provider-list" role="tabpanel" id={`${id}-rows`} aria-labelledby={`${id}-${tab}`} aria-busy={loading || refreshing} tabIndex={0}>
      {isRequests ? (visibleRequests.length ? visibleRequests.map(request => <ModelRequestDetails key={request.requestId} request={request}/>) : <p className="usage-dialog-empty">No measured model requests match this view yet.</p>) : <>
      {!visible.length && !loading && (reports.length
        ? <p className="usage-dialog-empty">No reported usage matches these filters.</p>
        : <div className="usage-dialog-empty-state">
          <BarChart3 size={34} aria-hidden="true" />
          <p>No usage recorded yet.</p>
          <span className="usage-dialog-empty-hint">Usage appears after the first model request.</span>
        </div>)}
      {!visible.length && loading && <div className="usage-dialog-skeleton" aria-hidden="true"><span /><span /><span /></div>}
      {visible.map(report => <section className="usage-provider-row" key={report.id} aria-label={`${report.providerLabel} · ${report.scopeLabel}`}>
        <header><strong>{report.providerLabel}</strong><span>{report.scopeLabel}</span></header>
        {report.error && <ErrorState className="usage-dialog-error" message={report.error}/>}
        {tab === 'Cost' && <dl><dt>Reported cost</dt><dd>{usageCost(report.cost)}</dd></dl>}
        {tab === 'Tokens' && <dl><dt>Input tokens</dt><dd>{usageCount(report.inputTokens)}</dd><dt>Output tokens</dt><dd>{usageCount(report.outputTokens)}</dd><dt>Cache read tokens</dt><dd>{usageCount(report.cacheReadTokens)}</dd><dt>Cache write tokens</dt><dd>{usageCount(report.cacheWriteTokens)}</dd></dl>}
        {tab === 'Limits' && (report.limits?.length ? report.limits : [{ id: 'unknown', label: 'Provider limit' }]).map(limit => <div key={limit.id} className="usage-limit"><dl><dt>{limit.label}</dt><dd>{usagePercent(limit.usedPercent)}</dd><dt>Reset</dt><dd>{usageReset(limit.reset)}</dd></dl></div>)}
      </section>)}
      </>}
    </div>
  </Modal>;
}

/** The same measured request fields are used in the usage view and candidate history. */
export function ModelRequestDetails({request}: {request: ModelRequestObservationV1}) {
  return <section className="usage-request" aria-label={'Model request ' + request.owner.sequence}>
        <header>
          <strong>{request.binding.modelId}</strong>
          <span className="usage-request-meta">{request.binding.providerId}</span>
          <span className={`usage-request-outcome usage-request-outcome-${request.outcome}`}>{request.outcome}</span>
          <span className="usage-request-meta">{request.owner.phase}</span>
        </header>
        <ol className="usage-request-stages">
          {REQUEST_STAGES.map(([stage, label]) => <li key={stage} data-missing={request.timings[stage] === null ? true : undefined}>
            <span className="usage-request-chip-label">{label}</span>
            <span className="usage-request-chip-value">{request.timings[stage] === null ? '—' : stageValue(stage, request.timings[stage])}</span>
          </li>)}
        </ol>
        <ul className="usage-request-metrics">
          {REQUEST_METRICS.map(([field, label]) => <li key={field}>
            <span className="usage-request-chip-label">{label}</span>
            <span className="usage-request-chip-value">{request.usage[field] === null ? '—' : usageCount(request.usage[field])}</span>
          </li>)}
          <li>
            <span className="usage-request-chip-label">Cost</span>
            <span className="usage-request-chip-value">{request.usage.cost === null ? '—' : usageCost({ amount: request.usage.cost })}</span>
          </li>
        </ul>
        {request.error && <p className="usage-dialog-error">{request.error}</p>}
      </section>;
}
