import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { CompactionProjectionV1, ContextRequestObservationV1, HostRequestProjectionV1, Thread } from '../../../packages/contracts';
import { Popover } from '../../../packages/ui-shell/Popover';
import { command } from './api';
import { ContextMeter, contextNumber, contextSegments, contextTokenCount, type ContextUsage } from './ContextMeter';
import { unavailableCompaction } from './runtime-presentation';
import './context-inspector.css';
import {useSourceWorkbench} from './SourceWorkbench';
import {ErrorState} from '../../../packages/ui-shell/Feedback';
import {memoryItemV1Schema, memoryRecallV1Schema, type MemoryItemV1, type MemoryRecallV1, type MemoryRevisionRef} from '../../../packages/contracts/project-memory';

/** Only the owner of a real host-prepared request may supply this adapter. */
export interface MemoryRequestExclusionAdapter {
  requestId: string; contextGeneration: number; phase: 'PREPARING' | 'CAPTURED';
  disabled?: boolean;
  exclude: (revision: MemoryRevisionRef) => Promise<void>;
}
export interface ContextMemoryRecall {
  threadId: string; projectId: string; accountId: string | null; projectIdentity: string;
  requestId: string; contextGeneration: number; recall: MemoryRecallV1; items: MemoryItemV1[]; injectedBytes: number;
  exclusionAdapter?: MemoryRequestExclusionAdapter;
}
export function ownedMemoryRecall(thread: Thread | undefined, value: ContextMemoryRecall | undefined): ContextMemoryRecall | undefined {
  if (!thread || !value || value.threadId !== thread.id || value.projectId !== thread.projectId || value.accountId !== (thread.accountId ?? null)) return;
  const parsed = memoryRecallV1Schema.safeParse(value.recall);
  if (!parsed.success || parsed.data.projectIdentity !== value.projectIdentity || parsed.data.requestId !== value.requestId || parsed.data.contextGeneration !== value.contextGeneration || !Number.isSafeInteger(value.injectedBytes) || value.injectedBytes < 0 || value.injectedBytes > parsed.data.budgetBytes || value.items.length !== parsed.data.selectedRevisions.length) return;
  const ids = new Set<string>();
  for (const selected of parsed.data.selectedRevisions) {
    if (ids.has(selected.itemId)) return; ids.add(selected.itemId);
    const item = value.items.find(item => item.id === selected.itemId && item.revision === selected.revision);
    if (!item || !memoryItemV1Schema.safeParse(item).success || item.state !== 'ACCEPTED' || item.projectIdentity !== value.projectIdentity) return;
  }
  return value;
}

/** Only a host-accepted compaction event for this exact run/session may produce this receipt. */
export interface AcceptedCompactionReceipt {
  id: string; threadId: string; sessionPath: string; runId: string; epoch: number;
  beforeTokens?: number; afterTokens?: number; contextWindow?: number;
}
export interface ContextCompactionReport {
  threadId: string; sessionPath: string; runId: string; epoch: number;
  status: 'pending' | 'accepted' | 'failed' | 'cancelled';
  receipt?: AcceptedCompactionReceipt; error?: string;
}
export function ownedCompaction(thread: Thread | undefined, report: ContextCompactionReport | undefined) {
  return thread?.sessionPath && report && report.threadId === thread.id && report.sessionPath === thread.sessionPath &&
    Boolean(report.runId) && report.epoch === thread.epoch && (!thread.runId || thread.runId === report.runId) &&
    (!(report.status === 'pending' || report.status === 'accepted') || !['stopped', 'interrupted', 'failed'].includes(thread.status)) ? report : undefined;
}
export function acceptedCompaction(thread: Thread | undefined, report: ContextCompactionReport | undefined, usage?: ContextUsage) {
  const owned = ownedCompaction(thread, report), receipt = owned?.status === 'accepted' ? owned.receipt : undefined;
  if (!receipt?.id || receipt.threadId !== owned!.threadId || receipt.sessionPath !== owned!.sessionPath || receipt.runId !== owned!.runId || receipt.epoch !== owned!.epoch) return;
  const measured = contextSegments(usage);
  const freed = measured && contextTokenCount(receipt.beforeTokens) && contextTokenCount(receipt.afterTokens) &&
    contextTokenCount(receipt.contextWindow) && receipt.beforeTokens <= receipt.contextWindow && receipt.afterTokens <= receipt.beforeTokens &&
    receipt.contextWindow === measured.total && receipt.afterTokens === measured.used ? receipt.beforeTokens - receipt.afterTokens : undefined;
  return { receipt, freed };
}
export interface ContextInspectorProps {
  usage: ContextUsage | undefined; thread: Thread | undefined;
  close: () => void; refresh: () => Promise<void>; onError?: (message: string) => void;
  anchor?: RefObject<HTMLElement | null>; compaction?: ContextCompactionReport; memoryRecall?: ContextMemoryRecall;
  memoryPreparation?: {pending: boolean; error: string; refresh: () => void; disabled?: boolean};
}
export function ContextInspector(props: ContextInspectorProps) {
  const fallback = useRef<HTMLElement | null>(null);
  const identity = JSON.stringify([props.thread?.id, props.thread?.sessionPath, props.thread?.epoch, props.thread?.projectId, props.thread?.accountId, props.memoryRecall?.requestId, props.memoryRecall?.contextGeneration]);
  return <><span hidden ref={node => { fallback.current = node?.parentElement?.querySelector('button') ?? null; }} />
    <ContextSession key={identity} {...props} anchor={props.anchor ?? fallback} />
  </>;
}
function ContextSession({ usage, thread, close, refresh, onError, anchor, compaction, memoryRecall, memoryPreparation }: ContextInspectorProps & { anchor: RefObject<HTMLElement | null> }) {
  const workbench=useSourceWorkbench();
  const [error, setError] = useState(''), [submitting, setSubmitting] = useState(false), [requested, setRequested] = useState(false);
  const [animateReceipt, setAnimateReceipt] = useState(false);
  const panel = useRef<HTMLDivElement>(null), action = useRef<HTMLButtonElement>(null), restoreActionFocus = useRef(false);
  const active = useRef(true), locked = useRef(false);
  useLayoutEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const measured = contextSegments(usage), unavailable = unavailableCompaction(thread);
  const request = usage?.lastRequest;
  const lastRequest = request?.threadId === thread?.id && request?.epoch === thread?.epoch &&
    (!thread?.runId || request?.runId === thread.runId) && request?.visibility === 'OPAQUE_NATIVE_CONTEXT' ? request : undefined;
  const projection = usage?.hostProjection;
  const hostSources = projection?.threadId === thread?.id && projection?.epoch === thread?.epoch &&
    (!thread?.runId || projection?.runId === thread.runId) ? projection : undefined;
  const reported = ownedCompaction(thread, compaction), accepted = acceptedCompaction(thread, compaction, usage);
  const lastReceipt = useRef(accepted?.receipt.id);
  const playingReceipt = Boolean(accepted && (animateReceipt || lastReceipt.current !== accepted.receipt.id));
  useEffect(() => {
    if (!accepted) { setAnimateReceipt(false); return; }
    if (lastReceipt.current === accepted.receipt.id) return;
    lastReceipt.current = accepted.receipt.id; setAnimateReceipt(true);
    const timer = setTimeout(() => setAnimateReceipt(false), 600); return () => clearTimeout(timer);
  }, [accepted?.receipt.id]);
  const compacting = submitting || reported?.status === 'pending' || usage?.activity === 'compacting';
  useLayoutEffect(() => {
    if (!restoreActionFocus.current || compacting || action.current?.disabled) return;
    if (panel.current?.ownerDocument.activeElement === panel.current?.ownerDocument.body) action.current?.focus();
    restoreActionFocus.current = false;
  }, [compacting, thread?.runId]);
  // Disabling the focused action (a run starting) drops focus to body; keep it inside so Escape still dismisses.
  useLayoutEffect(() => {
    const document = panel.current?.ownerDocument;
    if (document && action.current?.disabled && document.activeElement === document.body) panel.current?.focus();
  }, [compacting, thread?.runId]);
  const compact = async () => {
    if (!thread?.sessionPath || thread.runId || locked.current || compacting || unavailable) return;
    restoreActionFocus.current = action.current?.ownerDocument.activeElement === action.current;
    locked.current = true; setSubmitting(true); setError(''); setRequested(false);
    try {
      await command('run.compact', {}, thread.id);
      if (!active.current) return;
      setRequested(true); await refresh();
    } catch (cause) {
      if (!active.current) return;
      const message = cause instanceof Error ? cause.message : 'Context could not be compacted. Try again.';
      setError(message); onError?.(message);
    } finally { if (active.current) { locked.current = false; setSubmitting(false); } }
  };
  const activity = compacting ? 'Compacting context…' : reported?.status === 'failed' ? 'Compaction failed' : reported?.status === 'cancelled' ? 'Compaction stopped' :
    accepted ? accepted.freed === undefined ? 'Context compacted' : `Freed ${contextNumber(accepted.freed)} tokens` :
    requested ? 'Result not reported' : usage?.activity === 'running' ? 'Agent working' : usage?.activity === 'retrying' ? 'Retrying' : unavailable?.status ?? 'Context';
  const failure = error || (reported?.status === 'failed' ? reported.error || 'Context could not be compacted. Try again.' : '');
  const recalled = ownedMemoryRecall(thread, memoryRecall);
  return <Popover anchor={anchor} contentRef={panel} initialFocus={panel} open width={328} height={(measured?.categories.length ? 282 : 200) + (failure ? 48 : 0) + (lastRequest ? 84 : 0) + (recalled ? 180 : 0) + (workbench?.enabled?48:0)}
    role="dialog" aria-label="Context inspector" tabIndex={-1} className="context-inspector" onDismiss={close}>
    {workbench?.enabled&&<nav aria-label="Context views"><button type="button" onClick={()=>{close();workbench.show('request');}}>Last request</button><button type="button" onClick={()=>{close();workbench.show('sources');}}>Sources</button><button type="button" onClick={()=>{close();workbench.show('tools');}}>Tools</button><span aria-current="page">Compaction</span></nav>}
    <header><strong>Context <span>{measured ? `${Math.round(measured.ratio)}%` : 'Not reported'}</span></strong>
      {measured && <span className="context-inspector-total">{contextNumber(measured.used)} of {contextNumber(measured.total)} tokens</span>}</header>
    <div className="context-inspector-body"><ContextMeter usage={usage} busy={compacting} accepted={playingReceipt} />
      {lastRequest && <RequestEvidence request={lastRequest} sources={hostSources} compaction={usage?.compaction} />}
      {failure && <ErrorState className="context-inspector-error" message={failure}/>}
      {memoryPreparation?.pending && <p role="status">Preparing project memory…</p>}
      {memoryPreparation?.error && <ErrorState message={memoryPreparation.error}/>}
      {memoryPreparation && (recalled || memoryPreparation.error) && <button type="button" disabled={memoryPreparation.pending || memoryPreparation.disabled} onClick={memoryPreparation.refresh}>Refresh prepared context</button>}
      {recalled && <MemoryRecallDetails value={recalled}/>}
    </div>
    <footer><span role="status" aria-live="polite" className={playingReceipt ? 'context-receipt-pulse' : undefined}>{activity}</span>
      <button ref={action} type="button" disabled={!thread?.sessionPath || Boolean(thread.runId) || compacting || Boolean(unavailable)}
        title={unavailable?.reason ?? (!thread?.sessionPath ? 'Start a session before compacting context.' : undefined)} aria-description={unavailable?.reason}
        onClick={() => void compact()}>{compacting ? 'Compacting…' : failure ? 'Retry compaction' : 'Compact now'}</button></footer>
  </Popover>;
}

const requestViews = ['Last request', 'Sources', 'Tools', 'Compaction'] as const;

function RequestEvidence({ request, sources, compaction }: { request: ContextRequestObservationV1; sources?: HostRequestProjectionV1; compaction?: CompactionProjectionV1 }) {
  const id = useId();
  const [selected, select] = useState(0);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  return <section aria-label="Last request" className="context-request-evidence">
    <div role="tablist" aria-label="Request evidence" className="context-request-tabs">
      {requestViews.map((label, index) => <button key={label} type="button" role="tab"
        ref={node => { buttons.current[index] = node; }}
        id={id + '-tab-' + index} aria-controls={id + '-panel-' + index}
        aria-selected={selected === index} tabIndex={selected === index ? 0 : -1}
        onClick={() => select(index)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          const next = event.key === 'ArrowRight' ? (index + 1) % requestViews.length :
            event.key === 'ArrowLeft' ? (index + requestViews.length - 1) % requestViews.length :
            event.key === 'Home' ? 0 : event.key === 'End' ? requestViews.length - 1 : null;
          if (next !== null) { event.preventDefault(); select(next); buttons.current[next]?.focus(); }
        }}>{label}</button>)}
    </div>
    {requestViews.map((label, index) => <div key={label} role="tabpanel" hidden={selected !== index}
      id={id + '-panel-' + index} aria-labelledby={id + '-tab-' + index} tabIndex={selected === index ? 0 : -1}>
      {index === 0 && <><p className="context-categories-note">{contextNumber(request.promptBytes)} observed prompt bytes.</p>
        <p className="context-categories-note">Native context is opaque. Provider tokens and roles were not inferred.</p></>}
      {index === 1 && <>
        <p className="context-categories-note">{request.knownInputs} known {request.knownInputs === 1 ? 'input' : 'inputs'} at the broker. Native sources and revisions were not reported.</p>
        {Boolean(sources?.sources.length) && <ul aria-label="Observed app submission fragments">
          {sources?.sources.map((source, sourceIndex) => <li key={source.category + ':' + sourceIndex}>
            {source.category.toLowerCase()} · revision {source.revision} · {contextNumber(source.utf8Bytes)} bytes
            {source.inclusionReason && <> · {source.inclusionReason}</>}
            {source.exclusionReason && <> · excluded: {source.exclusionReason}</>}
            {source.tokens === null ? ' · tokens not measured' : <> · {contextNumber(source.tokens)} tokens</>} · {source.measurement.toLowerCase().replace('_', ' ')}
          </li>)}
          {Boolean(sources?.omittedSources) && <li>{sources?.omittedSources} additional fragments omitted from this view.</li>}
        </ul>}
      </>}
      {index === 2 && <p className="context-categories-note">{request.toolSnapshot ? `${request.toolSnapshot.count} host tool schemas · ${contextNumber(request.toolSnapshot.schemaBytes)} serialized bytes.` : 'Schema counts were not reported by this adapter.'}</p>}
      {index === 3 && <>
        {!compaction?.candidates.length && <p className="context-categories-note">No loss-aware compaction receipt. An observation is not a history change.</p>}
        {Boolean(compaction?.candidates.length) && <ul aria-label="Compaction candidates">
          {compaction?.candidates.map(entry => <li key={entry.metadata.candidateId}>
            candidate {entry.metadata.candidateId.slice(0, 8)} · {entry.status.toLowerCase()}{entry.verdict ? ` · ${entry.verdict.toLowerCase().replace('_', ' ')}` : ''}
            {' · '}{entry.retainedConstraints.length ? `${entry.retainedConstraints.length} retained constraints` : 'no retained constraints'} · {entry.toolPairs} tool {entry.toolPairs === 1 ? 'pair' : 'pairs'}
            {' · '}est. reduction {entry.estimatedByteReduction === null ? 'not estimated' : `${contextNumber(entry.estimatedByteReduction)} bytes (estimate)`}
            {entry.measuredBeforeBytes !== null && ` · measured ${contextNumber(entry.measuredBeforeBytes)} → ${entry.measuredAfterBytes === null ? 'unavailable' : contextNumber(entry.measuredAfterBytes)} bytes`}
          </li>)}
        </ul>}
        {Boolean(compaction?.candidates.length) && <p className="context-categories-note">
          {compaction?.accounting.attempts} {compaction?.accounting.attempts === 1 ? 'attempt' : 'attempts'} · {compaction?.accounting.discarded} discarded · {compaction?.accounting.failed} failed · cost {compaction?.accounting.costBytes ? contextNumber(compaction.accounting.costBytes) + ' bytes' : 'not measured'}
        </p>}
      </>}
    </div>)}
  </section>;
}
function MemoryRecallDetails({value}: {value: ContextMemoryRecall}) {
  const [pending, setPending] = useState<string>(), [requested, setRequested] = useState<string[]>([]), [error, setError] = useState('');
  const active = useRef(false), locked = useRef(false);
  useLayoutEffect(() => {active.current = true; return () => {active.current = false;};}, []);
  const adapter = value.exclusionAdapter;
  const canExclude = adapter?.phase === 'PREPARING' && !adapter.disabled && adapter.requestId === value.requestId && adapter.contextGeneration === value.contextGeneration;
  async function exclude(item: MemoryItemV1) {
    if (!canExclude || !adapter || locked.current) return;
    locked.current = true; setPending(item.id); setError('');
    try {await adapter.exclude({itemId: item.id, revision: item.revision}); if (active.current) setRequested(values => [...values, item.id]);}
    catch (cause) {if (active.current) setError(cause instanceof Error ? cause.message : 'This request could not be updated.');}
    finally {if (active.current) {locked.current = false; setPending(undefined);}}
  }
  return <section className="context-memory-recall" aria-label="Recalled project memory"><h3>Why recalled</h3>{adapter && <p>{adapter.phase === 'CAPTURED' ? 'Captured for the last sent request.' : 'Prepared for the current draft.'}</p>}<p>{value.recall.status} · {value.injectedBytes} of {value.recall.budgetBytes} memory bytes</p><p>Request {value.requestId} · generation {value.contextGeneration}</p>
    {!value.items.length && <p>No memory was selected for this request.</p>}
    {value.items.map(item => {const score = value.recall.scores.find(score => score.itemId === item.id && score.revision === item.revision); return <article key={`${item.id}:${item.revision}`}><p>{item.text}</p><p>Project scope{score ? ` · ${score.projectOverlap} project matches · ${score.symbolOverlap} symbol matches` : ''}{score?.matchedTerms.length ? ` · ${score.matchedTerms.join(', ')}` : ''}</p>{item.sourceRefs.map((source, index) => <p key={`${source.digest}:${index}`}>Source: {source.sourceKind.toLowerCase()} {source.sourceId} · revision {source.sourceRevision} · {source.observedStatus.toLowerCase()}</p>)}<button type="button" disabled={!canExclude || Boolean(pending) || requested.includes(item.id)} onClick={() => void exclude(item)}>Exclude from this request</button>{requested.includes(item.id) && <p role="status">Exclusion requested for this prepared request.</p>}</article>;})}
    {!canExclude && <p>{adapter?.phase === 'CAPTURED' ? 'This request is already captured. Its prompt cannot be changed.' : adapter?.disabled ? 'Request exclusion is unavailable while context is pending or the request is being sent.' : 'Request exclusion is unavailable until request preparation is connected.'}</p>}
    <p>Excludes from this request only.</p>{error && <ErrorState message={error}/>}
  </section>;
}
