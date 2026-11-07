import {useEffect, useRef, useState, type ReactNode} from 'react';
import type {CodeReviewComparison, ComparisonIdentity, ComparisonPatch, ComparisonRead} from '../../../../packages/contracts/code-review';
import type {GitStatus} from '../../../../packages/workspace/tools';
import {Select} from '../../../../packages/ui-shell/Select';
import {ActionMenu} from '../../../../packages/ui-shell/ActionMenu';
import {isComposing} from '../../../../packages/ui-shell/list-navigation';
import {ApiError} from '../api';
import {journalCompareAndSwap, journalFlush, journalRead, journalReadRecord, journalSubscribe, journalWrite} from '../journal';
import {acknowledgeOperation, canUseDraft, comparisonKey, newDraft, ownerKey, rebindDraft, sameOwner, selectionKey, type ActionIdentity, type ReviewDraft, type ReviewOwner, type ReviewSelection, type ReviewOperation} from './model';
import {codeReviewClient, reviewError} from './client';
import './code-review-workspace.css';

export type ReviewActionContext = Omit<ReviewOperation, 'payload'>;
export type ReviewActionResult = {state: 'confirmed' | 'stale' | 'uncertain' | 'revoked'};
export type ReviewOutcomeResult = {state: 'confirmed' | 'not-applied' | 'uncertain' | 'revoked'};
export interface ReviewWrites {
  owner: ReviewOwner;
  git: Pick<GitStatus, 'head' | 'revision' | 'branch' | 'gitWrite' | 'files'>;
  review?: {repo: string; item: {number: number; headRefOid: string}; head: string; revision: string; canReview: boolean};
  onStage?: (context: ReviewActionContext, payload: {paths: string[]; revision: string; expectedHead: string}) => Promise<ReviewActionResult>;
  onUnstage?: ReviewWrites['onStage'];
  onCommit?: (context: ReviewActionContext, payload: {message: string; revision: string; expectedHead: string}) => Promise<ReviewActionResult>;
  /** Open the parent's canonical creation/link UI; that owner still verifies and performs the write. */
  onCreatePullRequest?: (context: Omit<ReviewActionContext,'operation'|'operationId'>) => void;
  onLinkPullRequest?: (selection: ReviewSelection) => void;
  onReview?: (context: ReviewActionContext, payload: {number: number; event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'; body: string; head: string; revision: string}) => Promise<ReviewActionResult>;
  onInspectOutcome?: (context: ReviewOperation) => Promise<ReviewOutcomeResult>;
}
export interface CodeReviewWorkspaceProps {
  selection: ReviewSelection;
  owners: readonly {owner: ReviewOwner; label: string}[];
  pullRequests: readonly {repo: string; number: number; title: string}[];
  onNavigate: (selection: ReviewSelection) => void;
  onRefresh?: () => void;
  ownerControls?: ReactNode;
  writes?: ReviewWrites;
  chat?: ReactNode;
  terminal?: ReactNode | ((active: boolean) => ReactNode);
}
export function CodeReviewWorkspace(props: CodeReviewWorkspaceProps) {
  const {selection, owners, pullRequests, onNavigate, chat, terminal} = props;
  const [chatOpen, setChatOpen] = useState(false), [terminalOpen, setTerminalOpen] = useState(false);
  const targetValue = selection.target.kind === 'local' ? selection.target.scope : `pr:${selection.target.repo}:${selection.target.number}`;
  return <section className="cr-workspace" aria-label="Code review workspace">
    <header className="cr-toolbar">
      <Select aria-label="Project and working copy" value={ownerKey(selection.owner)} options={owners.map(item => ({value: ownerKey(item.owner), label: item.label}))}
        onValueChange={value => {const next = owners.find(item => ownerKey(item.owner) === value); if (next) onNavigate({owner: next.owner, target: {kind: 'local', scope: 'worktree'}});}} />
      {props.ownerControls}
      <Select aria-label="Comparison" value={targetValue} options={[{value: 'worktree', label: 'Working copy'}, {value: 'staged', label: 'Staged changes'}, ...pullRequests.map(item => ({value: `pr:${item.repo}:${item.number}`, label: `#${item.number} ${item.title}`}))]}
        onValueChange={value => {const pr = pullRequests.find(item => value === `pr:${item.repo}:${item.number}`); onNavigate({...selection, target: pr ? {kind: 'pull-request', repo: pr.repo, number: pr.number} : {kind: 'local', scope: value === 'staged' ? 'staged' : 'worktree'}});}} />
      <span className="cr-toolbar-spacer" />
      {Boolean(terminal) && <button type="button" aria-pressed={terminalOpen} onClick={() => setTerminalOpen(value => !value)}>Terminal</button>}
      {Boolean(chat) && <button type="button" aria-pressed={chatOpen} onClick={() => setChatOpen(value => !value)}>Agent chat</button>}
    </header>
    <div className="cr-body">
      <ComparisonBody key={selectionKey(selection)} {...props} />
      {Boolean(terminal) && <section className="cr-slot cr-terminal" aria-label="Terminal" hidden={!terminalOpen}>{typeof terminal === 'function' ? terminal(terminalOpen) : terminal}</section>}
      {Boolean(chat) && <section className="cr-slot cr-chat" aria-label="Agent chat" hidden={!chatOpen}>{chat}</section>}
    </div>
  </section>;
}

function matchesTarget(selection: ReviewSelection, value: CodeReviewComparison) {
  const target = selection.target, identity = value.identity;
  return target.kind === 'local' ? identity.kind === 'local' && identity.scope === target.scope
    : identity.kind === 'pull-request' && identity.number === target.number && identity.repo === target.repo;
}
function actionIdentity(writes?: ReviewWrites): ActionIdentity | null {
  return writes ? {head: writes.git.head, revision: writes.git.revision, branch: writes.git.branch} : null;
}
function writable(selection: ReviewSelection, comparison: CodeReviewComparison, writes?: ReviewWrites) {
  return selection.owner.authority.kind === 'local' && !!writes && sameOwner(selection.owner, writes.owner) && writes.git.gitWrite === true
    && (comparison.identity.kind === 'local'
      ? comparison.access.mode === 'managed' && comparison.identity.headOid === writes.git.head && comparison.identity.branch === writes.git.branch
      : comparison.identity.headOid === writes.git.head);
}
function reviewable(selection: ReviewSelection, comparison: CodeReviewComparison, writes?: ReviewWrites) {
  const identity = comparison.identity, review = writes?.review;
  return writable(selection, comparison, writes) && identity.kind === 'pull-request' && !!review && review.canReview && review.repo === identity.repo && review.item.number === identity.number
    && review.item.headRefOid === identity.headOid && review.head === identity.headOid && review.revision === writes?.git.revision;
}

function ComparisonBody({selection, writes, onRefresh}: CodeReviewWorkspaceProps) {
  const [read, setRead] = useState<ComparisonRead>({state: 'loading'}), [refreshing, setRefreshing] = useState(false), [refresh, setRefresh] = useState(0);
  const [path, setPath] = useState(''), [filter, setFilter] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [menuOpen, setMenuOpen] = useState(false);
  const mounted = useRef(true), inFlight = useRef(false), latestWrites = useRef(writes); latestWrites.current = writes;
  const comparison = read.state === 'ready' || read.state === 'empty' ? read.value : null;
  const draft = useDraft(selection, comparison?.identity, actionIdentity(writes));
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  useEffect(() => {
    const controller = new AbortController(); setRefreshing(true);
    void codeReviewClient.comparison(selection, controller.signal).then(next => {
      if (controller.signal.aborted) return;
      if ((next.state === 'ready' || next.state === 'empty') && !matchesTarget(selection, next.value)) throw new ApiError('COMPARISON_IDENTITY_CHANGED', 'Comparison owner changed.');
      setRead(next);
      if (next.state === 'ready' || next.state === 'empty') setPath(current => next.value.files.some(file => file.path === current) ? current : next.value.files[0]?.path ?? '');
    }).catch(cause => {if (!controller.signal.aborted) setRead({state: 'error', error: {code: cause instanceof ApiError ? cause.code : '', message: ''}});})
      .finally(() => {if (!controller.signal.aborted) setRefreshing(false);});
    return () => controller.abort();
  }, [refresh, selectionKey(selection)]);
  const identity = comparison?.identity, action = actionIdentity(writes);
  const canWrite = !!comparison && writable(selection, comparison, writes);
  const held = busy || refreshing || !draft.ready || !!draft.error || (['pending', 'uncertain', 'revoked'].includes(draft.value?.outcome ?? '') || !!draft.value?.operation && draft.value.outcome === 'stale');
  const selected = comparison?.files.find(file => file.path === path);
  const compatible = !!identity && !!draft.value && canUseDraft(draft.value, identity, action);
  const canReview = !!comparison && reviewable(selection, comparison, writes);
  const ownerBound = !!writes && sameOwner(selection.owner, writes.owner) && selection.owner.authority.kind === 'local';
  const rows = comparison?.files.filter(file => `${file.path} ${file.oldPath ?? ''}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase())) ?? [];
  const load = () => {onRefresh?.(); setRefresh(value => value + 1);};
  async function perform(operation: ReviewOperation['operation'], payload: ReviewOperation['payload'], callback: (context: ReviewActionContext) => Promise<ReviewActionResult>, reviewWrite = false) {
    if (!comparison || !action || !canWrite || held || inFlight.current || !draft.value || (reviewWrite && (!compatible || !canReview))) return;
    inFlight.current = true; setBusy(true); setNotice(''); let started = false, admitted = false;
    const captured = comparison, expectedAction = action, context: ReviewActionContext = structuredClone({selection, comparison: captured.identity, action: expectedAction, operationId: crypto.randomUUID(), operation});
    try {
      const fresh = await codeReviewClient.comparison(selection);
      const currentWrites = latestWrites.current;
      if (!mounted.current) return;
      if ((fresh.state !== 'ready' && fresh.state !== 'empty') || comparisonKey(fresh.value.identity) !== comparisonKey(captured.identity)
        || !writable(selection, fresh.value, currentWrites) || (reviewWrite && !reviewable(selection, fresh.value, currentWrites)) || JSON.stringify(actionIdentity(currentWrites)) !== JSON.stringify(expectedAction)) {
        setNotice('Comparison or permission changed. Refresh before acting.'); load(); return;
      }
      // Persist the uncertain boundary before a canonical callback can start a write.
      await draft.begin({...context,payload}); admitted = true;
      if (!mounted.current || !writable(selection, captured, latestWrites.current) || (reviewWrite && !reviewable(selection, captured, latestWrites.current)) || JSON.stringify(actionIdentity(latestWrites.current)) !== JSON.stringify(expectedAction)) {
        await draft.outcome('stale',context.operationId); return;
      }
      started = true;
      const result = await callback(structuredClone(context));
      if (!result || !['confirmed', 'stale', 'uncertain', 'revoked'].includes(result.state)) throw Error('Canonical action outcome is unconfirmed.');
      const applied = await draft.outcome(result.state,context.operationId);
      if (applied && mounted.current) {setNotice(result.state === 'confirmed' ? (reviewWrite ? 'Review submitted.' : 'Action confirmed.') : ''); if (result.state === 'confirmed' && !reviewWrite) load();}
    } catch {
      if (admitted) await draft.outcome(started ? 'uncertain' : 'stale',context.operationId).catch(() => {});
      if (mounted.current && !started) setNotice('Comparison could not be verified. Refresh before acting.');
    } finally {inFlight.current = false; if (mounted.current) setBusy(false);}
  }
  const error = read.state === 'error' ? reviewError(new ApiError(read.error.code, '')) : '';
  const local = identity?.kind === 'local';
  const stage = () => {if (!writes || !selected || !action) return; const callback = identity?.kind === 'local' && identity.scope === 'staged' ? writes.onUnstage : writes.onStage;
    if (callback) {const payload={paths:[selected.path],revision:action.revision,expectedHead:action.head};void perform(identity?.kind==='local'&&identity.scope==='staged'?'unstage':'stage',payload,context=>callback(context,structuredClone(payload)));}};
  async function inspectOutcome() {
    if (!ownerBound || !writes?.onInspectOutcome || !draft.value?.operation || !['uncertain', 'revoked'].includes(draft.value.outcome) || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const operation=draft.value.operation;
      const result = await writes.onInspectOutcome(structuredClone(operation));
      if (result && ['confirmed', 'not-applied', 'uncertain', 'revoked'].includes(result.state)) {
        const applied = await draft.outcome(result.state === 'not-applied' ? 'stale' : result.state,operation.operationId);
        if (applied && mounted.current) load();
      }
    } catch { /* Retain the uncertain boundary until the canonical owner can resolve it. */ }
    finally {inFlight.current = false; if (mounted.current) setBusy(false);}
  }
  return <div className="cr-main">
    <nav className="cr-files" aria-label="Changed files">
      <div className="cr-section-heading"><h2>Changed files{comparison ? ` (${comparison.files.length}${comparison.filesTruncated ? '+' : ''})` : ''}</h2><button type="button" aria-label="Refresh comparison" disabled={refreshing || busy} onClick={load}>Refresh</button></div>
      <div className="cr-file-select"><Select aria-label="Changed file" value={path} disabled={!comparison || comparison.files.length === 0} options={comparison?.files.map(file => ({value: file.path, label: file.path})) ?? []} onValueChange={setPath} /></div>
      <label className="cr-filter">Filter files<input value={filter} onChange={event => setFilter(event.target.value)} type="search" /></label>
      {read.state === 'loading' && <p role="status" className="cr-loading">Loading comparison…</p>}
      {refreshing && comparison && <p role="status">Refreshing comparison…</p>}
      {error && <p role="alert">{error}</p>}
      {comparison?.access.mode === 'legacy' && <p className="cr-meta">Original working copy · tracked changes only</p>}
      {comparison?.filesTruncated && <p role="status">File list is incomplete. More files exist beyond the read limit.</p>}
      {comparison && comparison.files.length === 0 && <p>No changes in this comparison.</p>}
      {comparison && comparison.files.length > 0 && rows.length === 0 && <p>No files match this filter.</p>}
      <div className="cr-file-list" onKeyDown={event => {
        if (isComposing(event) || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        const buttons = Array.from(event.currentTarget.querySelectorAll('button')), current = buttons.indexOf(event.target as HTMLButtonElement);
        if (current < 0) return; event.preventDefault();
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, current + (event.key === 'ArrowUp' ? -1 : 1)))]?.focus();
      }}>{rows.map(file => <button key={file.path} type="button" className="cr-file" aria-current={path === file.path ? 'page' : undefined} onClick={() => setPath(file.path)}>
        <span className="cr-file-path">{file.path}</span><span className="cr-meta">{file.oldPath ? `Renamed from ${file.oldPath}` : file.untracked ? 'Untracked' : file.status} {file.additions !== null ? `+${file.additions}` : ''} {file.deletions !== null ? `−${file.deletions}` : ''}</span>
      </button>)}</div>
    </nav>
    <section className="cr-diff" aria-label="Selected file diff">
      <div className="cr-section-heading"><h2>{selected?.path ?? 'Select a changed file'}</h2>
        {local && selected && (identity.scope === 'staged' ? writes?.onUnstage : writes?.onStage) && <button type="button" disabled={!canWrite || held} onClick={stage}>{identity.scope === 'staged' ? 'Unstage file' : 'Stage file'}</button>}
      </div>
      {identity && <Identity identity={identity} />}
      {comparison && selected ? <Patch key={comparisonKey(comparison.identity) + path} selection={selection} comparison={comparison} path={path}
        onInvalid={() => setRead({state: 'error', error: {code: 'COMPARISON_IDENTITY_CHANGED', message: ''}})} /> : <p className="cr-meta">{error ? 'Refresh to read this comparison.' : 'The selected file’s diff appears here.'}</p>}
    </section>
    <aside className="cr-context" aria-label="Review context">
      <section aria-label="Checks"><h2>Checks</h2>{comparison && !comparison.checks.length ? <p className="cr-meta">No checks reported for this comparison.</p> : <ul className="cr-checks">{comparison?.checks.map((check, index) => <li key={`${check.name}:${index}`}><span>{check.name}</span><span className="cr-check-state" data-state={check.status}>{check.status}</span></li>)}</ul>}</section>
      <section className="cr-draft" aria-label="Review draft">
        <label htmlFor={`cr-draft-${selection.owner.projectId}`}>Review draft</label>
        <textarea id={`cr-draft-${selection.owner.projectId}`} value={draft.value?.body ?? ''} disabled={!draft.ready || !draft.value} maxLength={64000} rows={7}
          onChange={event => {if (draft.value) void draft.edit({body: event.target.value}).catch(() => {});}} />
        {!draft.ready && <p role="status">Recovering review draft…</p>}
        {draft.error && <p role="alert">{draft.error} <button type="button" onClick={draft.retry}>Retry draft recovery</button></p>}
        {draft.value && identity && !compatible && !['pending', 'uncertain', 'revoked', 'confirmed'].includes(draft.value.outcome) && <div className="cr-draft-state"><p>Draft belongs to an earlier comparison or working-copy revision.</p><button type="button" disabled={busy || refreshing || !draft.ready || !!draft.error} onClick={() => void draft.rebind(identity, action).catch(() => {})}>Use current comparison</button></div>}
        {draft.value?.outcome === 'uncertain' && <p role="alert">Outcome uncertain. Inspect the canonical action before trying again.</p>}
        {draft.value && ['pending', 'uncertain', 'revoked'].includes(draft.value.outcome) && !draft.value.operation && <p role="alert">Saved action lacks an exact attempt record. Writes remain held; verify the action with its canonical owner.</p>}
        {draft.value?.outcome === 'revoked' && <p role="alert">Action access revoked. Your draft is preserved.</p>}
        {draft.value?.outcome === 'confirmed' && <p role="status">{local ? 'Action confirmed.' : 'Review submitted.'}</p>}
        {Boolean(draft.value?.operation && ['uncertain','revoked'].includes(draft.value.outcome)) && ownerBound && writes?.onInspectOutcome && <button type="button" disabled={busy} onClick={() => void inspectOutcome()}>Inspect action outcome</button>}
        {identity?.kind === 'pull-request' && <>
          <Select aria-label="Review decision" value={draft.value?.event ?? 'COMMENT'} disabled={!draft.ready || busy}
            options={[{value: 'COMMENT', label: 'Comment'}, {value: 'APPROVE', label: 'Approve'}, {value: 'REQUEST_CHANGES', label: 'Request changes'}]}
            onValueChange={value => {if (draft.value) void draft.edit({event: value as ReviewDraft['event']}).catch(() => {});}} />
          <button type="button" className="cr-submit" disabled={!writes?.onReview || !canReview || !compatible || held || comparison?.filesTruncated || !draft.value || (draft.value.event !== 'APPROVE' && !draft.value.body.trim())}
            onClick={() => {if (!writes?.onReview || !draft.value || identity.kind !== 'pull-request') return; const captured = {...draft.value}; if(!action)return;const payload={number:identity.number,event:captured.event,body:captured.body,head:action.head,revision:action.revision};void perform('review-pr',payload,context=>writes.onReview!(context,structuredClone(payload)),true);}}>Submit review</button>
          {!canReview && <p className="cr-meta">Review submission requires a writable working copy at this PR’s exact head.</p>}
        </>}
      </section>
      {local && writes?.onCommit && <form className="cr-commit" onSubmit={event => {event.preventDefault(); const text = draft.value?.commitMessage ?? ''; if (writes.onCommit && text.trim() && action) {const payload={message:text,revision:action.revision,expectedHead:action.head};void perform('commit',payload,context=>writes.onCommit!(context,structuredClone(payload)));}}}>
        <label>Commit message<textarea rows={2} maxLength={4000} disabled={!draft.ready || !draft.value} value={draft.value?.commitMessage ?? ''} onChange={event => {if (draft.value) void draft.edit({commitMessage: event.target.value}).catch(() => {});}} /></label>
        <button type="submit" disabled={!canWrite || held || !draft.value?.commitMessage.trim() || !writes.git.files.some(file => file.staged)}>Commit staged changes</button>
      </form>}
      {writes && (writes.onCreatePullRequest || writes.onLinkPullRequest) && <ActionMenu label="Pull request" open={menuOpen} onOpenChange={setMenuOpen} items={[
        ...(writes.onCreatePullRequest ? [{id: 'create', label: 'Create draft PR', disabled: !canWrite || held || writes.git.files.length !== 0, onSelect: () => {if (identity && action && canWrite && writes.git.files.length === 0) writes.onCreatePullRequest?.({selection, comparison: identity, action});}}] : []),
        ...(writes.onLinkPullRequest ? [{id: 'link', label: 'Link existing PR', disabled: !ownerBound || held, onSelect: () => {if (ownerBound) writes.onLinkPullRequest?.(selection);}}] : []),
      ]} />}
      {!canWrite && local && <p className="cr-meta">Git writes require a writable managed working copy.</p>}
      {busy && <p role="status">Verifying and applying action…</p>}
      {notice && <p role="status">{notice}</p>}
    </aside>
  </div>;
}

function Identity({identity}: {identity: ComparisonIdentity}) {
  return <details className="cr-identity"><summary>{identity.kind === 'local' ? `${identity.branch || 'Detached HEAD'} · ${identity.scope === 'staged' ? 'HEAD → index' : 'Index → working copy'}` : `${identity.baseRef} → ${identity.headRef} · merge-base comparison`}</summary>
    <dl>{identity.kind === 'local' ? <><dt>HEAD</dt><dd><code>{identity.headOid}</code></dd><dt>Read revision</dt><dd><code>{identity.revision}</code></dd><dt>Base ({identity.base.kind})</dt><dd><code>{identity.base.revision}</code></dd><dt>Head ({identity.head.kind})</dt><dd><code>{identity.head.revision}</code></dd></>
      : <><dt>Repository / PR</dt><dd>{identity.repo} #{identity.number}</dd><dt>Base</dt><dd><code>{identity.baseOid}</code></dd><dt>Head</dt><dd><code>{identity.headOid}</code></dd><dt>Merge base</dt><dd><code>{identity.mergeBaseOid}</code></dd></>}</dl>
  </details>;
}
function Patch({selection, comparison, path, onInvalid}: {selection: ReviewSelection; comparison: CodeReviewComparison; path: string; onInvalid: () => void}) {
  const [value, setValue] = useState<ComparisonPatch>(), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setError('');
    void codeReviewClient.file(selection, comparison.identity, path, controller.signal).then(next => {
      if (controller.signal.aborted) return;
      if (comparisonKey(next.identity) !== comparisonKey(comparison.identity) || next.file.path !== path) {onInvalid(); return;}
      setValue(next);
    }).catch(cause => {if (!controller.signal.aborted) {setValue(undefined); setError(reviewError(cause));}});
    return () => controller.abort();
  }, [retry]);
  if (error) return <p role="alert">{error} <button type="button" onClick={() => setRetry(current => current + 1)}>Retry file</button></p>;
  if (!value) return <p role="status" className="cr-loading">Loading file diff…</p>;
  if (value.state === 'text' && value.text !== null) return <pre className="cr-patch" tabIndex={0} aria-label="Unified diff">{value.text.split('\n').map((line, index) => <span className="cr-line" data-kind={line.startsWith('@@') ? 'hunk' : line.startsWith('+') && !line.startsWith('+++') ? 'add' : line.startsWith('-') && !line.startsWith('---') ? 'delete' : 'context'} key={index}>{line}{'\n'}</span>)}</pre>;
  return <div className="cr-patch-state"><p>{({binary: 'Binary file · no text diff.', truncated: 'Patch exceeds the display limit. No partial patch is shown.', unavailable: 'Patch unavailable.', untracked: 'Untracked file · no indexed diff.', empty: 'No textual changes in this comparison.', text: 'Patch unavailable.'})[value.state]}</p>{value.reason && <p className="cr-meta">{({ 'patch-omitted': 'The provider omitted this patch.', 'unsupported-path': 'This path is unsupported.', conflict: 'Resolve the file conflict before reviewing a text diff.', 'resource-limit': 'The read exceeded its resource limit.', 'unsupported-file': 'This file type is unsupported.'})[value.reason]}</p>}</div>;
}

function validOperation(operation: ReviewOperation, selection?: ReviewSelection): boolean {
  try {
    if(!operation || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(operation.operationId) || !['stage','unstage','commit','review-pr'].includes(operation.operation))return false;
    if(operation.selection.owner.authority.kind!=='local'||typeof operation.selection.owner.projectId!=='string'||!operation.selection.owner.projectId||(selection&&selectionKey(operation.selection)!==selectionKey(selection)))return false;
    if(!['head','revision','branch'].every(key=>typeof operation.action?.[key as keyof ActionIdentity]==='string')||!comparisonKey(operation.comparison))return false;
    const target=operation.selection.target,identity=operation.comparison,payload=operation.payload;
    if(target.kind==='local' ? identity.kind!=='local'||target.scope!==identity.scope : identity.kind!=='pull-request'||target.repo!==identity.repo||target.number!==identity.number)return false;
    if(payload.revision!==operation.action.revision)return false;
    if(operation.operation==='review-pr')return identity.kind==='pull-request'&&'number' in payload&&payload.number===identity.number&&payload.head===operation.action.head&&['COMMENT','APPROVE','REQUEST_CHANGES'].includes(payload.event)&&typeof payload.body==='string'&&payload.body.length<=64000;
    if(identity.kind!=='local'||!('expectedHead' in payload)||payload.expectedHead!==operation.action.head)return false;
    return operation.operation==='commit' ? 'message' in payload&&typeof payload.message==='string'&&payload.message.length<=4000 : 'paths' in payload&&Array.isArray(payload.paths)&&payload.paths.length>0&&payload.paths.length<=1000&&payload.paths.every(path=>typeof path==='string'&&path.length>0&&path.length<=4096&&!path.includes('\0'));
  }catch{return false;}
}
function validDraft(value: unknown, selection?: ReviewSelection): value is ReviewDraft {
  const draft = value as ReviewDraft | null;
  try {return !!draft && draft.version === 1 && typeof draft.body === 'string' && draft.body.length <= 64000 && typeof draft.commitMessage === 'string' && draft.commitMessage.length <= 4000 && ['COMMENT', 'APPROVE', 'REQUEST_CHANGES'].includes(draft.event)
    && ['idle', 'pending', 'confirmed', 'stale', 'uncertain', 'revoked'].includes(draft.outcome) && (draft.operation === undefined || validOperation(draft.operation,selection)) && !!comparisonKey(draft.basis) && (draft.action === null || ['head', 'revision', 'branch'].every(key => typeof draft.action?.[key as keyof ActionIdentity] === 'string'));} catch {return false;}
}
function useDraft(selection: ReviewSelection, identity: ComparisonIdentity | undefined, action: ActionIdentity | null) {
  const key = 'code-review:v1:' + selectionKey(selection), latest = useRef<ReviewDraft | null>(null), live = useRef(true);
  const [value, setValue] = useState<ReviewDraft | null>(null), [ready, setReady] = useState(false), [error, setError] = useState(''), [recovery, setRecovery] = useState(0);
  useEffect(() => {
    live.current = true; let current = true;
    const accept = (raw: unknown) => {
      if (!current || raw === undefined) return;
      if (!validDraft(raw,selection)) {setError('Saved draft could not be read. Keep this view open and retry.'); setReady(false); return;}
      latest.current = raw; setValue(raw);
    };
    const unsubscribe = journalSubscribe(key, accept);
    void journalRead(key).then(async raw => {
      if (!current) return;
      if (raw !== undefined && !validDraft(raw,selection)) {accept(raw); return;}
      const recovered = raw && validDraft(raw,selection) ? raw : null;
      if (recovered?.outcome === 'pending') await update(current => current.outcome === 'pending' && current.operation?.operationId === recovered.operation?.operationId ? {...current, outcome: 'uncertain'} : null);
      else if (recovered) accept(recovered);
      if (current) {setReady(true); setError('');}
    }).catch(() => {if (current) setError('Draft recovery failed. Retry before submitting.');});
    return () => {current = false; live.current = false; unsubscribe();};
  }, [key, recovery]);
  useEffect(() => {if (ready && identity && !latest.current) {const next = newDraft(identity, action); latest.current = next; setValue(next); void journalWrite(key, next).catch(() => {if (live.current) setError('Draft could not be saved. Keep this view open and retry.');});}}, [ready, identity && comparisonKey(identity)]);
  // Read the value and its generation together. A generation protects the CAS;
  // operation ownership and unresolved state protect detached acknowledgments.
  async function update(change: (current: ReviewDraft) => ReviewDraft | null) {
    for (let tries = 0; tries < 5; tries++) {
      const record = await journalReadRecord<ReviewDraft>(key);
      if (!record || !validDraft(record.value, selection)) throw Error('Saved draft could not be read.');
      const next = change(record.value);
      if (!next) return false;
      await journalFlush();
      if (await journalCompareAndSwap(key, record.generation, next)) return true;
    }
    throw Error('Draft changed while recording the action outcome.');
  }
  async function edit(patch: Partial<Pick<ReviewDraft, 'body' | 'event' | 'commitMessage'>>) {
    const current = latest.current;
    if (!current) return;
    // Keep typing synchronous; never copy an operation/outcome from an old render.
    try {await journalWrite(key, {...current, ...patch, outcome: current.outcome === 'confirmed' && ('body' in patch || 'event' in patch) ? 'idle' : current.outcome});}
    catch (cause) {if (live.current) setError('Draft could not be saved. Keep this view open and retry.'); throw cause;}
  }
  async function begin(operation: ReviewOperation) {
    if (!validOperation(operation, selection)) throw Error('Action identity is invalid.');
    const admitted = await update(current => ['pending', 'uncertain', 'revoked'].includes(current.outcome) || current.operation && current.outcome === 'stale'
      ? null : {...current, operation: structuredClone(operation), outcome: 'pending'});
    if (!admitted) throw Error('Another action is unresolved.');
    await journalFlush();
  }
  const outcome = (next: Exclude<ReviewDraft['outcome'], 'idle' | 'pending'>, operationId: string) => update(current => acknowledgeOperation(current, operationId, next));
  const rebind = (basis: ComparisonIdentity, action: ActionIdentity | null) => update(current => rebindDraft(current, basis, action));
  return {value, ready, error, edit, rebind, begin, outcome, retry: () => {setError(''); setReady(false); setRecovery(current => current + 1);}};
}
