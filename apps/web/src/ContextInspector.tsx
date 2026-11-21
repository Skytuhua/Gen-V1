import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { CompactionProjectionV1, ContextRequestObservationV1, HostRequestProjectionV1, Thread } from '../../../packages/contracts';
import type { ContextInferenceBudgetV1 } from '../../../packages/contracts/request-context';
import { Popover } from '../../../packages/ui-shell/Popover';
import { authenticated, command, read } from './api';
import { ContextMeter, contextNumber, contextSegments, contextTokenCount, type ContextUsage } from './ContextMeter';
import { unavailableCompaction } from './runtime-presentation';
import './context-inspector.css';
import {useSourceWorkbench} from './SourceWorkbench';
import {ErrorState} from '../../../packages/ui-shell/Feedback';
import {memoryItemV1Schema, memoryRecallV1Schema, type MemoryItemV1, type MemoryRecallV1, type MemoryRevisionRef} from '../../../packages/contracts/project-memory';
import {MODEL_REQUEST_OBSERVATION_LIMIT, modelRequestObservationV1Schema, type ModelRequestObservationV1} from '../../../packages/contracts/model-request';
import {ModelRequestDetails} from './UsageDialog';

/** Only the owner of a real host-prepared request may supply this adapter. */
interface MemoryRequestExclusionAdapter {
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
interface AcceptedCompactionReceipt {
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
  /** Key used by the caller to select this row from the current host snapshot. */
  usageThreadId?: string;
  open?: boolean;
  close: () => void; refresh: () => Promise<void>; onError?: (message: string) => void;
  anchor?: RefObject<HTMLElement | null>; compaction?: ContextCompactionReport; memoryRecall?: ContextMemoryRecall;
  memoryPreparation?: {pending: boolean; error: string; refresh: () => void; disabled?: boolean};
}
export function ContextInspector(props: ContextInspectorProps) {
  const fallback = useRef<HTMLElement | null>(null);
  // The composer keeps this boundary mounted while the popover is closed.
  // This invalidates cached candidate IDs; current host snapshots own the proof.
  const candidateOwners = useRef(new Map<string, string>());
  const owner = JSON.stringify([props.thread?.id, props.thread?.sessionPath, props.thread?.projectId ?? null, props.thread?.workspaceId ?? null, props.thread?.modelId, props.thread?.accountId ?? null]);
  let compactionHistory = currentCompactionHistory(props.thread, props.usage, props.usageThreadId);
  if (compactionHistory?.candidates.some(entry => candidateOwners.current.has(entry.metadata.candidateId) && candidateOwners.current.get(entry.metadata.candidateId) !== owner)) compactionHistory = undefined;
  for (const entry of compactionHistory?.candidates ?? []) candidateOwners.current.set(entry.metadata.candidateId, owner);
  if (props.open === false) return null;
  const identity = JSON.stringify([owner, props.thread?.epoch, props.memoryRecall?.requestId, props.memoryRecall?.contextGeneration]);
  return <><span hidden ref={node => { fallback.current = node?.parentElement?.querySelector('button') ?? null; }} />
    <ContextSession key={identity} {...props} compactionHistory={compactionHistory} anchor={props.anchor ?? fallback} />
  </>;
}
function currentCompactionHistory(thread: Thread | undefined, usage: ContextUsage | undefined, usageThreadId: string | undefined): CompactionProjectionV1 | undefined {
  if (!thread?.modelId || !usage?.compaction?.candidates.length) return;
  const witnesses = [usageThreadId, usage.lastRequest?.threadId, usage.hostProjection?.threadId].filter(value => value !== undefined);
  if (!witnesses.length || witnesses.some(value => value !== thread.id)) return;
  const workspaceId = thread.workspaceId ?? (thread.projectId ? 'project:' + thread.projectId : 'thread:' + thread.id);
  if (usage.compaction.candidates.some(({metadata: {binding}}) => binding.workspaceId !== workspaceId || binding.modelId !== thread.modelId || binding.accountId !== (thread.accountId ?? null))) return;
  return usage.compaction;
}
function ContextSession({ usage, thread, close, refresh, onError, anchor, compaction, compactionHistory, memoryRecall, memoryPreparation }: ContextInspectorProps & { anchor: RefObject<HTMLElement | null>; compactionHistory?: CompactionProjectionV1 }) {
  const workbench=useSourceWorkbench();
  const [error, setError] = useState(''), [submitting, setSubmitting] = useState(false), [requested, setRequested] = useState(false);
  const [animateReceipt, setAnimateReceipt] = useState(false);
  const panel = useRef<HTMLDivElement>(null), action = useRef<HTMLButtonElement>(null), restoreActionFocus = useRef(false);
  const active = useRef(true), locked = useRef(false);
  const [innerNode, setInnerNode] = useState<HTMLDivElement | null>(null);
  const [requestedHeight, setRequestedHeight] = useState(200);
  useLayoutEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  // Natural-flow inner content is measured in CSS pixels after the portal mounts;
  // the popover still owns available-space clamping of this requested size.
  useLayoutEffect(() => {
    const shell = panel.current;
    if (!shell || !innerNode) return;
    const body = innerNode.parentElement;
    const measure = () => {
      const style = getComputedStyle(shell);
      const gap = parseFloat(style.rowGap) || 0;
      let total = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      let visible = 0;
      for (const child of Array.from(shell.children) as HTMLElement[]) {
        if (child === body) { total += innerNode.offsetHeight; visible++; continue; }
        if (getComputedStyle(child).display === 'none') continue;
        total += child.getBoundingClientRect().height; visible++;
      }
      const height = Math.ceil(total + gap * Math.max(0, visible - 1));
      setRequestedHeight(previous => previous === height ? previous : height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(innerNode);
    for (const child of Array.from(shell.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [innerNode]);
  const measured = contextSegments(usage), unavailable = unavailableCompaction(thread);
  const request = usage?.lastRequest;
  const lastRequest = request?.threadId === thread?.id && request?.epoch === thread?.epoch &&
    (!thread?.runId || request?.runId === thread.runId) && request?.visibility === 'OPAQUE_NATIVE_CONTEXT' ? request : undefined;
  const projection = usage?.hostProjection;
  const hostSources = projection?.threadId === thread?.id && projection?.epoch === thread?.epoch &&
    (!thread?.runId || projection?.runId === thread.runId) ? projection : undefined;
  const budgetObservation = usage?.inferenceBudget;
  const budget = budgetObservation?.threadId === thread?.id && budgetObservation?.epoch === thread?.epoch &&
    (!thread?.runId || budgetObservation?.runId === thread.runId) ? budgetObservation?.budget : undefined;
  const reported = ownedCompaction(thread, compaction), accepted = acceptedCompaction(thread, compaction, usage);
  const lastReceipt = useRef(accepted?.receipt.id);
  const playingReceipt = Boolean(accepted && (animateReceipt || lastReceipt.current !== accepted.receipt.id));
  useEffect(() => {
    if (!accepted) { setAnimateReceipt(false); return; }
    if (lastReceipt.current === accepted.receipt.id) return;
    lastReceipt.current = accepted.receipt.id; setAnimateReceipt(true);
    const timer = setTimeout(() => setAnimateReceipt(false), 160); return () => clearTimeout(timer);
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
  return <Popover anchor={anchor} contentRef={panel} initialFocus={panel} open width={328} height={requestedHeight}
    role="dialog" aria-label="Context inspector" tabIndex={-1} className="context-inspector" onDismiss={close}>
    {workbench?.enabled&&<nav aria-label="Context views"><button type="button" onClick={()=>{close();workbench.show('request');}}>Last request</button><button type="button" onClick={()=>{close();workbench.show('sources');}}>Sources</button><button type="button" onClick={()=>{close();workbench.show('tools');}}>Tools</button><span aria-current="page">Compaction</span></nav>}
    <header><strong>Context <span>{measured ? `${Math.round(measured.ratio)}%` : 'Not reported'}</span></strong>
      {measured && <span className="context-inspector-total">{contextNumber(measured.used)} of {contextNumber(measured.total)} tokens</span>}</header>
    <div className="context-inspector-body"><div className="context-inspector-inner" ref={setInnerNode}><ContextMeter usage={usage} busy={compacting} accepted={playingReceipt} />
      {(lastRequest || compactionHistory) && <RequestEvidence request={lastRequest} sources={hostSources} compaction={compactionHistory} thread={thread} />}
      {budget && <InferenceBudget value={budget}/>}
      {failure && <ErrorState className="context-inspector-error" message={failure}/>}
      {memoryPreparation?.pending && <p role="status">Preparing project memory…</p>}
      {memoryPreparation?.error && <ErrorState message={memoryPreparation.error}/>}
      {memoryPreparation && (recalled || memoryPreparation.error) && <button type="button" disabled={memoryPreparation.pending || memoryPreparation.disabled} onClick={memoryPreparation.refresh}>Refresh prepared context</button>}
      {recalled && <MemoryRecallDetails value={recalled}/>}
    </div></div>
    <footer><span role="status" aria-live="polite" className={playingReceipt ? 'context-receipt-pulse' : undefined}>{activity}</span>
      <button ref={action} type="button" disabled={!thread?.sessionPath || Boolean(thread.runId) || compacting || Boolean(unavailable)}
        title={unavailable?.reason ?? (!thread?.sessionPath ? 'Start a session before compacting context.' : undefined)} aria-description={unavailable?.reason}
        onClick={() => void compact()}>{compacting ? 'Compacting…' : failure ? 'Retry compaction' : 'Compact now'}</button></footer>
  </Popover>;
}

const requestViews = ['Last request', 'Sources', 'Tools', 'Compaction'] as const;

function InferenceBudget({ value }: { value: ContextInferenceBudgetV1 }) {
  const previous = value.previousRequest, reported = (count: number | null) => count === null ? 'not reported' : contextNumber(count);
  return <section aria-label="Next inference budget">
    <p className="context-categories-note">Request {value.sequence}: {contextNumber(value.promptBytes)} prompt bytes of a {contextNumber(value.maxPromptBytes)} byte limit.</p>
    <p className="context-categories-note">{value.byteAdmission === 'BLOCKED' ? 'Request blocked by the host byte limit. No provider call was started.' : 'Prompt byte limit satisfied.'}</p>
    {previous && <>
      <p className="context-categories-note">Previous request: {reported(previous.inputTokens)} provider-reported input tokens; {reported(previous.cacheReadTokens)} cache-read tokens. Their accounting convention was not normalized.</p>
      <p className="context-categories-note">Reported context: {reported(previous.reportedContextTokens)} tokens. Its measurement type was not reported; it was not substituted for input usage.</p>
    </>}
    <p className="context-categories-note">{value.sourceContinuity === 'VERIFIED' ? `Since the previous request: ${contextNumber(value.newSourceBytes!)} native source bytes, including ${contextNumber(value.newToolResultBytes!)} tool-result bytes across ${value.newToolResults} ${value.newToolResults === 1 ? 'result' : 'results'}.` : 'Source continuity is unavailable. Newly unreported tool bytes were not inferred.'}</p>
    <p className="context-categories-note">Token budget unavailable. Normalized input usage, a compatible tokenizer and the actual output reserve were not reported. No automatic compaction decision was made from unknown token counts.</p>
  </section>;
}

function RequestEvidence({ request, sources, compaction, thread }: { request?: ContextRequestObservationV1; sources?: HostRequestProjectionV1; compaction?: CompactionProjectionV1; thread?: Thread }) {
  const id = useId();
  const [selected, select] = useState(request ? 0 : 3);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  return <section aria-label={request ? 'Last request' : 'Compaction history'} className="context-request-evidence">
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
      {index === 0 && (request ? <><p className="context-categories-note">{contextNumber(request.promptBytes)} observed prompt bytes.</p>
        <p className="context-categories-note">Native context is opaque. Provider tokens and roles were not inferred.</p></> : <p className="context-categories-note">Current request observation unavailable.</p>)}
      {index === 1 && !request && <p className="context-categories-note">Current source observation unavailable.</p>}
      {index === 1 && request && <>
        <p className="context-categories-note">{request.knownInputs} known {request.knownInputs === 1 ? 'input' : 'inputs'} at the broker.{!request.nativeSources && ' Native sources and revisions were not reported.'}</p>
        {request.nativeSources && <section aria-label="Original Hermes source metadata">
          <p className="context-categories-note">Source generation {request.nativeSources.generation} · {request.nativeSources.sourceCount} source records · {contextNumber(request.nativeSources.sourceBytes)} serialized source bytes.</p>
          <p className="context-categories-note">{request.nativeSources.reusedSources} compiled records reused · {request.nativeSources.compiledSources} new records compiled. The native worker fingerprinted {request.nativeSources.inspectedSources} records to verify the cut.</p>
          <p className="context-categories-note">These are original Hermes source records before ACP flattening. Provider context remains opaque; tokens were not inferred.</p>
          <ul>{request.nativeSources.sources.map(source => <li key={source.sourceId}>{source.category.toLowerCase()} · {source.sourceId} · revision {source.sourceRevision} · {contextNumber(source.utf8Bytes)} bytes · SHA-256 <span style={{ overflowWrap: 'anywhere' }}>{source.sha256}</span></li>)}</ul>
          {Boolean(request.nativeSources.omittedSources) && <p className="context-categories-note">{request.nativeSources.omittedSources} source records omitted from this bounded view.</p>}
        </section>}
        {request.nativeSourcesUnavailable && <p className="context-categories-note">Native source capture unavailable: {request.nativeSourcesUnavailable.toLowerCase().replaceAll('_', ' ')}.</p>}
        {sources?.projectInstructions && <section aria-label="Approved project instructions">
          <p className="context-categories-note">{sources.projectInstructions.precedence}</p>
          <ul>{sources.projectInstructions.entries.map(entry => <li key={entry.resourceId + ':' + entry.filename}>
            {entry.filename} · resource {entry.resourceId} · scope {entry.scope} · precedence {entry.precedence} · {contextNumber(entry.utf8Bytes)} bytes
            <span style={{ overflowWrap: 'anywhere' }}> · SHA-256 {entry.digest}</span>
          </li>)}</ul>
          {sources.projectInstructions.overlaps.map(overlap => <p key={overlap.scope} className="context-categories-note">Overlapping instruction sources in {overlap.scope}: {overlap.filenames.join(', ')}. Applied in the declared order; semantic contradictions were not inferred.</p>)}
          {sources.projectInstructions.duplicates.map(duplicate => <p key={duplicate.path} className="context-categories-note">{duplicate.path}: same physical file as {duplicate.retainedPath}; loaded once.</p>)}
          {sources.projectInstructions.exclusions.map(exclusion => <p key={exclusion.resourceId + ':' + exclusion.filename} className="context-categories-note">{exclusion.filename} · resource {exclusion.resourceId} · excluded: {exclusion.reason.toLowerCase().replaceAll('_', ' ')}</p>)}
          {Boolean(sources.projectInstructions.omittedRoots) && <p className="context-categories-note">{sources.projectInstructions.omittedRoots} roots outside the instruction discovery limit.</p>}
        </section>}
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
      {index === 2 && <p className="context-categories-note">{request?.toolSnapshot ? `${request.toolSnapshot.count} host tool schemas · ${contextNumber(request.toolSnapshot.schemaBytes)} serialized bytes.` : 'Schema counts were not reported by this adapter.'}</p>}
      {index === 3 && <>
        {request?.relevance && <section aria-label="Read-only relevance observation">
          <p className="context-categories-note">{request.relevance.candidateIds.length} old host read {request.relevance.candidateIds.length === 1 ? 'result' : 'results'} for review · {contextNumber(request.relevance.estimatedSavingsBytes)} bytes potential savings (estimate).</p>
          <p className="context-categories-note">Nothing was removed. Native context is opaque; these results require semantic review before compaction.</p>
          <p className="context-categories-note">{request.relevance.protectedResults} protected · {request.relevance.omittedResults} outside the observation window · {contextNumber(request.relevance.inspectionBudgetBytes)} byte inspection cap.</p>
          {Boolean(request.relevance.candidateIds.length) && <details><summary>Candidate result observations</summary><ul>{request.relevance.candidateIds.map(candidate => <li key={candidate}>{candidate}</li>)}</ul></details>}
        </section>}
        {!compaction?.candidates.length && <p className="context-categories-note">No loss-aware compaction receipt. An observation is not a history change.</p>}
        {Boolean(compaction?.candidates.length) && <ul aria-label="Compaction candidates">
          {compaction?.candidates.map(entry => <CompactionCandidateDetails key={entry.metadata.candidateId} entry={entry} thread={thread}/>)}
        </ul>}
        {Boolean(compaction?.candidates.length) && <>
          <p className="context-categories-note">Omitted native categories: unavailable.</p>
          <p className="context-categories-note">Recorded admitted candidates: {compaction?.accounting.attempts} · {compaction?.accounting.discarded} discarded · {compaction?.accounting.failed} failed. Historical completeness and provider-call counts are unavailable.</p>
          <p className="context-categories-note">Auxiliary byte accounting: {contextTokenCount(compaction?.accounting.costBytes) && compaction.accounting.costBytes > 0 ? contextNumber(compaction.accounting.costBytes) + ' bytes' : 'unavailable'}. Complete auxiliary model cost: unavailable. Retained request costs can be loaded for each candidate.</p>
        </>}
      </>}
    </div>)}
  </section>;
}
function CompactionCandidateDetails({entry, thread}: {entry: CompactionProjectionV1['candidates'][number]; thread?: Thread}) {
  const [shown, setShown] = useState(32);
  const remaining = Math.max(0, entry.retainedConstraints.length - shown);
  const measured = (bytes: number | null) => contextTokenCount(bytes) ? contextNumber(bytes) + ' bytes' : 'unavailable';
  return <li data-compaction-candidate={entry.metadata.candidateId}>
    candidate {entry.metadata.candidateId.slice(0, 8)} · {entry.status.toLowerCase()}{entry.verdict ? ` · ${entry.verdict.toLowerCase().replaceAll('_', ' ')}` : ''}
    {' · '}{entry.retainedConstraints.length} retained constraints · {entry.toolPairs} tool {entry.toolPairs === 1 ? 'pair' : 'pairs'}
    {entry.verdict === null && (entry.status === 'READY' || entry.status === 'PREPARING') && <p className="context-categories-note">Native outcome unconfirmed. No applied receipt was recorded.</p>}
    <p className="context-categories-note">Estimated reduction: {contextTokenCount(entry.estimatedByteReduction) ? contextNumber(entry.estimatedByteReduction) + ' bytes (estimate)' : 'unavailable'}.</p>
    <p className="context-categories-note">Measured source: {measured(entry.measuredBeforeBytes)}; measured result: {measured(entry.measuredAfterBytes)}.</p>
    {Boolean(entry.retainedConstraints.length) && <details>
      <summary>Retained constraint references</summary>
      <p className="context-categories-note">Protection plan references. An applied receipt confirms that history changed.</p>
      <ul aria-label="Retained constraint references">{entry.retainedConstraints.slice(0, shown).map((reference, index) => <li key={index} style={{overflowWrap: 'anywhere'}}>{reference}</li>)}</ul>
      {remaining > 0 && <><p className="context-categories-note">Showing {shown} of {entry.retainedConstraints.length} references.</p>
        <button type="button" onClick={() => setShown(value => value + Math.min(32, remaining))}>Show {Math.min(32, remaining)} more references</button></>}
    </details>}
    {thread && <CompactionModelRequests key={JSON.stringify([entry.metadata, entry.status, entry.verdict])} thread={thread} entry={entry}/>}
  </li>;
}
function CompactionModelRequests({thread, entry}: {thread: Thread; entry: CompactionProjectionV1['candidates'][number]}) {
  const owner = JSON.stringify([thread.id, thread.projectId ?? null, thread.workspaceId ?? null, thread.sessionPath, thread.modelId, thread.accountId ?? null, thread.epoch, entry.metadata]);
  const currentOwner = useRef(owner); currentOwner.current = owner;
  const pending = useRef<AbortController | null>(null), active = useRef(true);
  const [state, setState] = useState<{owner: string; requests?: ModelRequestObservationV1[]; older: boolean; loading: boolean; error: string}>({owner, older: false, loading: false, error: ''});
  useLayoutEffect(() => {active.current = true; return () => {active.current = false; pending.current?.abort(); pending.current = null;};}, []);
  const visible = state.owner === owner ? state : {owner, requests: undefined, older: false, loading: false, error: ''};
  const load = async (older = false) => {
    if (pending.current || !active.current) return;
    const before = older ? visible.requests?.at(-1)?.requestId : undefined;
    if (older && !before) return;
    const retained = before ? visible.requests ?? [] : [], control = new AbortController(), capturedOwner = owner;
    pending.current = control;
    const current = () => active.current && !control.signal.aborted && pending.current === control && currentOwner.current === capturedOwner;
    setState({owner, requests: before ? retained : undefined, older: false, loading: true, error: ''});
    try {
      const url = `/api/threads/${encodeURIComponent(thread.id)}/compaction/${encodeURIComponent(entry.metadata.candidateId)}/model-requests` +
        (before ? '?beforeRequestId=' + encodeURIComponent(before) : '');
      const response = await authenticated(() => fetch(url, {method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: control.signal}));
      const value = await read<unknown>(response);
      if (!current()) return;
      const parsed = modelRequestObservationV1Schema.array().max(MODEL_REQUEST_OBSERVATION_LIMIT).safeParse(value);
      const invalid = () => new Error('Compaction measurement response could not be verified.');
      if (!parsed.success) throw invalid();
      const seen = new Set(retained.map(request => request.requestId)), binding = entry.metadata.binding;
      let epoch = retained[0]?.owner.epoch;
      for (const request of parsed.data) {
        epoch ??= request.owner.epoch;
        if (seen.has(request.requestId) || request.owner.threadId !== thread.id || request.owner.runId !== 'compaction:' + entry.metadata.candidateId ||
          request.owner.epoch !== epoch || !Number.isSafeInteger(thread.epoch) || request.owner.epoch > thread.epoch ||
          request.binding.modelId !== binding.modelId || request.binding.accountId !== binding.accountId || request.binding.providerId !== binding.modelId.split('/')[0]) throw invalid();
        seen.add(request.requestId);
      }
      setState({owner, requests: [...retained, ...parsed.data], older: parsed.data.length === MODEL_REQUEST_OBSERVATION_LIMIT, loading: false, error: ''});
    } catch (cause) {
      if (current()) setState({owner, older: false, loading: false, error: cause instanceof Error ? cause.message : 'Compaction model costs are unavailable.'});
    } finally {if (pending.current === control) pending.current = null;}
  };
  return <section aria-label="Compaction model costs">
    <button type="button" className="usage-refresh" disabled={visible.loading} onClick={() => void load()}>{visible.requests ? 'Refresh model request costs' : 'Load model request costs'}</button>
    {visible.loading && <p role="status" className="context-categories-note">Loading model request costs…</p>}
    {visible.error && <ErrorState message={visible.error}/>}
    <p className="context-categories-note">Retained request observations may omit unreported or interrupted requests. Complete spend is unavailable.</p>
    {visible.requests && <>
      {!visible.requests.length && <p className="context-categories-note">No retained model request measurements are available.</p>}
      {visible.requests.map(request => <ModelRequestDetails key={request.requestId} request={request}/>)}
      {visible.older && <button type="button" className="usage-refresh" disabled={visible.loading} onClick={() => void load(true)}>Load older model requests</button>}
    </>}
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
