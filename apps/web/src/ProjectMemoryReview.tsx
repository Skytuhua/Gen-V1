import {useCallback, useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {Modal} from '../../../packages/ui-shell/Modal';
import {isComposing} from '../../../packages/ui-shell/list-navigation';
import {ErrorState} from '../../../packages/ui-shell/Feedback';
import {PROJECT_MEMORY_LIMITS, type MemoryAction, type MemoryForgetPreview, type MemoryItemV1, type MemoryScope, type MemorySourceDetail, type MemorySourceRefV1, type ProjectMemoryView} from '../../../packages/contracts/project-memory';
import {downloadProjectMemory, getMemoryForgetPreview, getMemorySource, getProjectMemory, memoryOwnerKey, mutateProjectMemory, type MemoryOwner} from './project-memory-api';
import type {DesktopMemoryExportResult} from '../../../packages/desktop-contract/index';
import './project-memory.css';

const tabs = ['Accepted', 'Proposals', 'Conflicts', 'Deleted history'] as const;
type Tab = typeof tabs[number];
type Row = ProjectMemoryView['items'][number];
const label = (value: string) => value[0] + value.slice(1).toLowerCase().replaceAll('_', ' ');
const rejectedProposal = (item: MemoryItemV1) => item.state === 'EXPIRED' && item.reviewDecision?.action === 'REJECT';
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Project memory could not be updated.';
const date = (value: string | null) => value ? new Date(value).toLocaleString() : 'Never';
function age(value: string) {
  const hours = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 3_600_000));
  return hours < 1 ? 'Less than an hour' : hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

export interface ProjectMemoryReviewProps {owner: MemoryOwner; close: () => void; readOnly?: boolean}
/** This review never persists memory text or correction drafts in renderer storage. */
export function ProjectMemoryReview({owner, close, readOnly = false}: ProjectMemoryReviewProps) {
  return <ReviewSession key={memoryOwnerKey(owner)} owner={owner} close={close} readOnly={readOnly}/>;
}
function ReviewSession({owner, close, readOnly = false}: ProjectMemoryReviewProps) {
  const [view, setView] = useState<ProjectMemoryView>(), [tab, setTab] = useState<Tab>('Accepted');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [exportResult, setExportResult] = useState<DesktopMemoryExportResult>();
  const [sourceThreads, setSourceThreads] = useState<string[]>([]), [source, setSource] = useState<MemorySourceDetail>();
  const [editor, setEditor] = useState<MemoryItemV1>(), [forget, setForget] = useState<{item: MemoryItemV1; preview: MemoryForgetPreview}>();
  const [detailPending, setDetailPending] = useState(false);
  const active = useRef(false), locked = useRef(false), generation = useRef(0), detailGeneration = useRef(0);
  const scope = useRef<MemoryScope | undefined>(undefined), pendingRead = useRef<AbortController | undefined>(undefined), pendingDetail = useRef<AbortController | undefined>(undefined);
  const configDirty = useRef(false), retry = useRef<{signature: string; commandId: string} | undefined>(undefined);
  const ownerKey = memoryOwnerKey(owner), id = useId();
  useLayoutEffect(() => {active.current = true; return () => {active.current = false; generation.current++; detailGeneration.current++; pendingRead.current?.abort(); pendingDetail.current?.abort();};}, []);
  const load = useCallback(async (refreshBinding = false) => {
    const version = ++generation.current; pendingRead.current?.abort(); const controller = new AbortController(); pendingRead.current = controller;
    setLoading(true); setError('');
    try {
      const next = await getProjectMemory(owner, controller.signal, scope.current, {refreshBinding});
      if (!active.current || version !== generation.current) return;
      scope.current = next.scope; setView(next);
      setEditor(previous => previous && next.tombstones.some(value => value.itemId === previous.id) ? undefined : previous);
      if (!configDirty.current) setSourceThreads(next.sourceThreadIds);
    } catch (cause) {if (active.current && version === generation.current && !controller.signal.aborted) {setView(undefined); setSource(undefined); setForget(undefined); setError(message(cause));}}
    finally {if (active.current && version === generation.current) setLoading(false);}
  }, [ownerKey]);
  useEffect(() => {void load();}, [load]);
  // Detail surfaces mount below the row list; bring them into view when they open.
  const scrollDetail = useCallback((node: HTMLElement | null) => { if (node) { node.scrollIntoView({block: 'nearest'}); node.focus(); } }, []);
  function clearDetails() {detailGeneration.current++; pendingDetail.current?.abort(); setSource(undefined); setForget(undefined); setDetailPending(false);}
  function selectTab(next: Tab) {setTab(next); clearDetails();}
  async function act(operation: MemoryAction) {
    if (readOnly || !view || locked.current || loading) return false;
    locked.current = true; setBusy(true); setError(''); setNotice(''); setExportResult(undefined);
    const capturedScope = view.scope, isCurrent = () => active.current && scope.current === capturedScope;
    const signature = JSON.stringify([capturedScope, operation]);
    const commandId = retry.current?.signature === signature ? retry.current.commandId : crypto.randomUUID();
    retry.current = {signature, commandId};
    try {
      const receipt = await mutateProjectMemory(capturedScope, operation, commandId, isCurrent);
      if (!isCurrent()) return false;
      retry.current = undefined; clearDetails(); setEditor(undefined);
      if (operation.action === 'configure') configDirty.current = false;
      if (receipt.result.state === 'CONFLICT') {setTab('Conflicts'); setNotice('Both revisions were retained. Resolve the conflict before this memory can be recalled.');}
      else setNotice(operation.action === 'forget' ? 'Forgotten. Retrieval exclusion is immediate; physical purge is tracked in Deleted history.' : operation.action === 'reject' ? 'Rejected. This proposal is excluded from recall.' : 'Project memory updated.');
      await load(); return true;
    } catch (cause) {if (active.current) setError(message(cause)); return false;}
    finally {if (active.current) {locked.current = false; setBusy(false);}}
  }
  async function detail(item: MemoryItemV1, ref?: MemorySourceRefV1) {
    if (!view || busy || loading || readOnly && !ref) return;
    clearDetails(); const version = ++detailGeneration.current, controller = new AbortController(); pendingDetail.current = controller;
    setDetailPending(true); setError('');
    try {
      if (ref) {const result = await getMemorySource(view.scope, item, ref, controller.signal); if (active.current && version === detailGeneration.current) setSource(result);}
      else {const preview = await getMemoryForgetPreview(view.scope, item, controller.signal); if (active.current && version === detailGeneration.current) setForget({item, preview});}
    } catch (cause) {if (active.current && version === detailGeneration.current && !controller.signal.aborted) setError(message(cause));}
    finally {if (active.current && version === detailGeneration.current) setDetailPending(false);}
  }
  async function exportData() {
    if (!view || locked.current || loading) return;
    locked.current = true; setBusy(true); setError(''); setNotice(''); setExportResult(undefined);
    const captured = view.scope, isCurrent = () => active.current && scope.current === captured;
    try {
      const result = await downloadProjectMemory(captured, isCurrent); if (!isCurrent()) return;
      setExportResult(result.admitted ? result : undefined);
      setNotice(result.status === 'saved' ? 'Redacted export downloaded.' : result.status === 'cancelled' ? 'Export cancelled.' : 'Redacted export download started.');
    } catch (cause) {if (active.current) setError(message(cause));}
    finally {if (active.current) {locked.current = false; setBusy(false);}}
  }
  const blocked = busy || loading, mutationBlocked = blocked || readOnly, rows = view?.items.filter(({item}) => tab === 'Accepted' ? item.state === 'ACCEPTED' || item.state === 'EXPIRED' && !rejectedProposal(item) : tab === 'Proposals' ? item.state === 'PROPOSED' || rejectedProposal(item) : tab === 'Conflicts' ? item.state === 'CONFLICT' : false) ?? [];
  return <Modal open title="Project memory" onClose={close} className="project-memory-review">
    <div className="project-memory-body">
      {readOnly && <p className="project-memory-caption">Read-only review. Manage memory from the project overview.</p>}
      {error && <ErrorState message={error}/>}
      {notice && <p role="status" className="project-memory-notice" data-memory-export-status={exportResult?.status} data-memory-export-admitted={exportResult?.admitted ? 'true' : undefined} data-memory-export-filename={exportResult?.filename} data-memory-export-bytes={exportResult?.bytes} data-memory-export-sha256={exportResult?.sha256}>{notice}</p>}
      {loading && <p role="status">{view ? 'Refreshing project memory…' : 'Loading project memory…'}</p>}
      {!view && !loading && <button type="button" onClick={() => void load(true)}>Retry loading</button>}
      {view && <>
        <header className="project-memory-heading"><div><h3>{view.projectName}</h3></div><div className="project-memory-actions"><button type="button" disabled={blocked} onClick={() => {clearDetails(); void load(true);}}>Refresh</button><button type="button" disabled={blocked} onClick={() => void exportData()}>Export redacted JSON</button></div></header>
        <section className="project-memory-consent" aria-label="Project memory settings">
          <p><strong>{view.enabled ? 'Enabled for this project' : 'Not enabled for this project'}</strong></p>
          {view.disabledReason && <p>{view.disabledReason}</p>}
          <details open={!view.enabled}><summary>Source conversations ({view.sourceThreadIds.length})</summary>
            <p>Only the conversations selected here may supply memory. Sharing with other projects and user-wide preferences is unavailable.</p>
            <fieldset disabled={mutationBlocked || !view.available}><legend>Choose source conversations</legend>{view.eligibleThreads.map(thread => <label key={thread.id}><input type="checkbox" checked={sourceThreads.includes(thread.id)} onChange={event => {configDirty.current = true; setSourceThreads(previous => event.target.checked ? [...previous, thread.id] : previous.filter(value => value !== thread.id));}}/>{thread.title}</label>)}</fieldset>
            {!view.eligibleThreads.length && <p>No authorized source conversations are available.</p>}
            <button type="button" disabled={mutationBlocked || !view.available || !sourceThreads.length} onClick={() => void act({action: 'configure', baseRevision: view.configRevision, enabled: true, sourceThreadIds: sourceThreads})}>{view.enabled ? 'Save source scope' : 'Enable for this project'}</button>
          </details>
          {view.enabled && <button type="button" className="quiet" disabled={mutationBlocked} onClick={() => void act({action: 'configure', baseRevision: view.configRevision, enabled: false, sourceThreadIds: view.sourceThreadIds})}>Disable for this project</button>}
        </section>
        <div className="project-memory-tabs" role="tablist" aria-label="Project memory states">{tabs.map((value, index) => <button key={value} type="button" role="tab" id={`${id}-${index}`} aria-controls={`${id}-rows`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onClick={() => selectTab(value)} onKeyDown={event => {
          if (isComposing(event)) return;
          const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
          if (next === null) return; event.preventDefault(); selectTab(tabs[next]); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
        }}>{value}</button>)}</div>
        <div role="tabpanel" id={`${id}-rows`} aria-labelledby={`${id}-${tabs.indexOf(tab)}`} aria-busy={blocked}>
          {tab === 'Accepted' && <p className="project-memory-caption">Expired records remain visible here and are excluded from recall.</p>}
          {tab === 'Proposals' && <p className="project-memory-caption">Rejected proposals remain visible here and are excluded from recall.</p>}
          {rows.map(row => <MemoryRow key={`${row.item.id}:${row.item.revision}`} row={row} projectName={view.projectName} disabled={blocked} readOnly={readOnly} onAction={act} onEdit={item => {if (!readOnly) {clearDetails(); setEditor(item);}}} onSource={(item, ref) => void detail(item, ref)} onForget={item => void detail(item)}/>)}
          {tab !== 'Deleted history' && !rows.length && <p className="project-memory-empty">No {tab.toLowerCase()} memories.</p>}
          {tab === 'Deleted history' && (view.tombstones.length ? view.tombstones.map(tombstone => <article className="project-memory-row" key={tombstone.itemId}><header><strong>{tombstone.itemId}</strong><span>Deletion revision {tombstone.deletionRevision}</span></header><p>Excluded from retrieval on <time dateTime={tombstone.deletedAt}>{date(tombstone.deletedAt)}</time>.</p><p>{tombstone.purgeStatus === 'COMPLETE' ? 'Physical purge complete' : 'Physical purge pending'}</p><details><summary>Invalidated summaries and indexes ({tombstone.affectedDerivedArtifacts.length})</summary><ul>{tombstone.affectedDerivedArtifacts.map(value => <li key={value}>{value}</li>)}</ul></details></article>) : <p className="project-memory-empty">No deleted memories.</p>)}
        </div>
        {editor && <div ref={scrollDetail}><MemoryEditor key={`${editor.id}:${editor.revision}`} item={editor} disabled={mutationBlocked} onCancel={() => setEditor(undefined)} onSave={act}/></div>}
        {detailPending && <p role="status">Loading the pinned revision…</p>}
        {source && <section ref={scrollDetail} tabIndex={-1} className="project-memory-detail" aria-label="Supporting source"><header><h3>{source.label}</h3><button type="button" onClick={clearDetails}>Close source</button></header><p>{label(source.ref.sourceKind)} {source.ref.sourceId} · revision {source.ref.sourceRevision} · {label(source.ref.observedStatus)}</p><p>Thread {source.ref.ownerThreadId} · captured sequence {source.ref.capturedSeq}</p><p className="project-memory-digest">Digest {source.ref.digest}</p><pre>{source.content}</pre></section>}
        {forget && <section ref={scrollDetail} tabIndex={-1} className="project-memory-detail" aria-label="Forget preview"><h3>Forget this revision?</h3><p>{forget.item.text}</p><p>This immediately excludes the item from retrieval and invalidates the following summaries and indexes:</p>{forget.preview.affectedDerivedArtifacts.length ? <ul>{forget.preview.affectedDerivedArtifacts.map(value => <li key={value}>{value}</li>)}</ul> : <p>No derived summaries or indexes reference this revision.</p>}<p>Physical purge is pending until the permitted local artifacts are removed. Retention ends {date(forget.preview.localPurgeAfter)}.</p><p>Deletion from external providers is not supported.</p><div className="project-memory-actions"><button type="button" disabled={blocked} onClick={clearDetails}>Cancel</button><button type="button" className="project-memory-danger" disabled={blocked} onClick={() => void act({action: 'forget', itemId: forget.item.id, baseRevision: forget.preview.revision})}>Confirm forget</button></div></section>}
      </>}
    </div>
  </Modal>;
}

function MemoryRow({row, projectName, disabled, readOnly, onAction, onEdit, onSource, onForget}: {row: Row; projectName: string; disabled: boolean; readOnly: boolean; onAction: (operation: MemoryAction) => Promise<boolean>; onEdit: (item: MemoryItemV1) => void; onSource: (item: MemoryItemV1, ref: MemorySourceRefV1) => void; onForget: (item: MemoryItemV1) => void}) {
  const {item} = row, mutationBlocked = disabled || readOnly;
  return <article className="project-memory-row" aria-label={`Memory ${item.id}`}>
    <header><strong>{label(item.kind)}</strong><span>{rejectedProposal(item) ? 'Rejected' : label(item.state)} · revision {item.revision}</span></header>
    <p className="project-memory-text">{item.text}</p>
    <dl className="project-memory-metadata"><dt>Project</dt><dd>{projectName}</dd><dt>Age</dt><dd><time dateTime={item.observedAt} title={date(item.observedAt)}>{age(item.observedAt)}</time></dd><dt>Expiry</dt><dd>{item.expiresAt ? <time dateTime={item.expiresAt}>{date(item.expiresAt)}</time> : 'None'}</dd><dt>Last used</dt><dd>{row.lastUsedAt ? <time dateTime={row.lastUsedAt}>{date(row.lastUsedAt)}</time> : 'Never'}</dd><dt>Asserted by</dt><dd>{label(item.assertedBy.kind)} · {item.sensitivity === 'SENSITIVE' ? 'Sensitive' : 'Normal sensitivity'}</dd><dt>Source</dt><dd>{item.sourceRefs.map((ref, index) => <span className="project-memory-source" key={`${ref.digest}:${index}`}><span>{label(ref.sourceKind)} · {label(ref.observedStatus)}</span><button type="button" disabled={disabled} aria-label={`View source ${item.id} ${index + 1}`} onClick={() => onSource(item, ref)}>View pinned source</button></span>)}</dd></dl>
    {item.state === 'CONFLICT' ? <><ConflictReview row={row} disabled={disabled} readOnly={readOnly} onAction={onAction} onSource={onSource}/><button type="button" className="project-memory-danger" disabled={mutationBlocked} aria-label={`Forget ${item.id}`} onClick={() => onForget(item)}>Forget</button></> : <div className="project-memory-actions">
      {item.state === 'PROPOSED' && <button type="button" disabled={mutationBlocked} aria-label={`Accept ${item.id}`} onClick={() => void onAction({action: 'accept', itemId: item.id, baseRevision: item.revision})}>Accept</button>}
      <button type="button" disabled={mutationBlocked} aria-label={`Edit ${item.id}`} onClick={() => onEdit(item)}>{item.state === 'PROPOSED' ? 'Edit and accept' : 'Edit'}</button>
      {item.state === 'PROPOSED' && <button type="button" disabled={mutationBlocked} aria-label={`Reject ${item.id}`} onClick={() => void onAction({action: 'reject', itemId: item.id, baseRevision: item.revision})}>Reject</button>}
      {item.state === 'ACCEPTED' && <button type="button" disabled={mutationBlocked} aria-label={`Expire ${item.id}`} onClick={() => void onAction({action: 'expire', itemId: item.id, baseRevision: item.revision})}>Expire</button>}
      <button type="button" className="project-memory-danger" disabled={mutationBlocked} aria-label={`Forget ${item.id}`} onClick={() => onForget(item)}>Forget</button>
    </div>}
  </article>;
}
function MemoryEditor({item, disabled, onCancel, onSave}: {item: MemoryItemV1; disabled: boolean; onCancel: () => void; onSave: (operation: MemoryAction) => Promise<boolean>}) {
  const [text, setText] = useState(item.text), [expiry, setExpiry] = useState(item.expiresAt?.slice(0, 16) ?? '');
  const [preference, setPreference] = useState(false);
  const bytes = new TextEncoder().encode(text).length;
  const expiryDate = expiry ? new Date(expiry + 'Z') : null, validExpiry = !expiryDate || Number.isFinite(expiryDate.getTime()) && expiryDate.getUTCFullYear() <= 9999;
  return <form className="project-memory-detail" aria-label="Edit memory" onSubmit={event => {event.preventDefault(); if (disabled || !validExpiry || !text.trim() || bytes > PROJECT_MEMORY_LIMITS.textBytes) return; const revision = {itemId: item.id, baseRevision: item.revision, text, expiresAt: expiryDate?.toISOString() ?? null}; void onSave(preference ? {action: 'confirm-preference', confirmation: 'PROJECT_ONLY', ...revision} : {action: 'edit', ...revision});}}>
    <h3>{item.state === 'PROPOSED' ? 'Edit and accept' : 'Correct memory'} · revision {item.revision}</h3>
    <label>Memory text<textarea autoFocus rows={5} value={text} maxLength={2048} disabled={disabled} required onChange={event => setText(event.target.value)}/></label><p className={bytes > PROJECT_MEMORY_LIMITS.textBytes ? 'error-text' : 'project-memory-caption'}>{bytes} of 2048 UTF-8 bytes</p>
    <label>Expiry (UTC)<input type="datetime-local" max="9999-12-31T23:59" value={expiry} disabled={disabled} onChange={event => setExpiry(event.target.value)}/></label>{!validExpiry && <p role="alert">Choose a valid expiry date.</p>}
    {item.kind !== 'PREFERENCE' && <label><input type="checkbox" checked={preference} disabled={disabled} onChange={event => setPreference(event.target.checked)}/>Confirm this as a reusable preference for this project only</label>}
    <div className="project-memory-actions"><button type="button" disabled={disabled} onClick={onCancel}>Cancel edit</button><button type="submit" disabled={disabled || !validExpiry || !text.trim() || bytes > PROJECT_MEMORY_LIMITS.textBytes}>{item.state === 'PROPOSED' ? 'Accept edited memory' : 'Save correction'}</button></div>
  </form>;
}
function ConflictReview({row, disabled, readOnly, onAction, onSource}: {row: Row; disabled: boolean; readOnly: boolean; onAction: (operation: MemoryAction) => Promise<boolean>; onSource: (item: MemoryItemV1, ref: MemorySourceRefV1) => void}) {
  const [selected, setSelected] = useState<number[]>([]), [note, setNote] = useState('');
  const versions = [...new Map([row.item, ...row.conflictRevisions].map(item => [item.revision, item])).values()].sort((a, b) => a.revision - b.revision);
  return <form className="project-memory-conflict" onSubmit={event => {event.preventDefault(); if (disabled || readOnly || !selected.length || selected.length > 2 || !note.trim()) return; void onAction({action: 'resolve', itemId: row.item.id, baseRevision: row.item.revision, survivingRevisions: selected, note: note.trim()});}}>
    <p>Select one surviving revision, or preserve two. A resolution note is required. Conflicts are excluded from recall.</p><p className="project-memory-caption">Resolving requires every pinned source to still be available — if a source is gone, only Forget applies.</p>
    <fieldset disabled={disabled}><legend>Surviving revisions</legend>{versions.map(item => <div key={item.revision}><label><input type="checkbox" checked={selected.includes(item.revision)} disabled={readOnly || !selected.includes(item.revision) && selected.length >= 2} onChange={event => setSelected(values => event.target.checked ? [...values, item.revision].sort((a, b) => a - b) : values.filter(value => value !== item.revision))}/>Keep revision {item.revision}</label><p className="project-memory-text">{item.text}</p>{item.sourceRefs.map((ref, index) => <button key={`${ref.digest}:${index}`} type="button" onClick={() => onSource(item, ref)}>View source for revision {item.revision}</button>)}</div>)}</fieldset>
    <label>Resolution note<textarea rows={2} required maxLength={1000} disabled={disabled || readOnly} value={note} onChange={event => setNote(event.target.value)}/></label><button type="submit" disabled={disabled || readOnly || !selected.length || !note.trim()}>Resolve conflict</button>
  </form>;
}
