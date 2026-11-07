import {useEffect, useRef, useState, type ReactNode} from 'react';
import type {CodeReviewComparison, ComparisonIdentity, ComparisonPatch, ComparisonRead} from '../../../../packages/contracts/code-review';
import type {GitStatus} from '../../../../packages/workspace/tools';
import {Select} from '../../../../packages/ui-shell/Select';
import {ActionMenu} from '../../../../packages/ui-shell/ActionMenu';
import {isComposing} from '../../../../packages/ui-shell/list-navigation';
import {ApiError} from '../api';
import {journalCompareAndSwap, journalFlush, journalRead, journalReadRecord, journalSubscribe, journalWrite} from '../journal';
import {acknowledgeAttempt, canUseDraft, comparisonKey, isHeldDraft, validAttempt, newDraft, ownerKey, rebindDraft, sameOwner, selectionKey, type ActionIdentity, type ReviewActionContext, type ReviewAttempt, type ReviewCommand, type ReviewDraft, type ReviewOwner, type ReviewSelection} from './model';
import {codeReviewClient, reviewError} from './client';
import './code-review-workspace.css';

export type {ReviewActionContext} from './model';
export type ReviewDispatchContext = ReviewActionContext & {attemptId: string};
export type ReviewActionResult = {state: 'confirmed' | 'stale' | 'uncertain' | 'revoked'};
export type ReviewOutcomeResult = {state: 'confirmed' | 'not-applied' | 'uncertain' | 'revoked'};
export interface ReviewWrites {
  owner: ReviewOwner;
  git: Pick<GitStatus, 'head' | 'revision' | 'branch' | 'gitWrite' | 'files'>;
  review?: {repo: string; item: {number: number; headRefOid: string}; head: string; revision: string; canReview: boolean};
  onStage?: (context: ReviewDispatchContext, payload: {paths: string[]; revision: string; expectedHead: string}) => Promise<ReviewActionResult>;
  onUnstage?: ReviewWrites['onStage'];
  onCommit?: (context: ReviewDispatchContext, payload: {message: string; revision: string; expectedHead: string}) => Promise<ReviewActionResult>;
  /** Open the parent's canonical creation/link UI; that owner still verifies and performs the write. */
  onCreatePullRequest?: (context: ReviewActionContext) => void;
  onLinkPullRequest?: (selection: ReviewSelection) => void;
  onReview?: (context: ReviewDispatchContext, payload: {number: number; event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'; body: string; head: string; revision: string}) => Promise<ReviewActionResult>;
  onInspectOutcome?: (attempt: ReviewAttempt) => Promise<ReviewOutcomeResult>;
}
export interface CodeReviewWorkspaceProps {
  selection: ReviewSelection;
  owners: readonly {owner: ReviewOwner; label: string}[];
  pullRequests: readonly {repo: string; number: number; title: string}[];
  onNavigate: (selection: ReviewSelection) => void;
  writes?: ReviewWrites;
  chat?: ReactNode;
  terminal?: ReactNode;
}
export function CodeReviewWorkspace(props: CodeReviewWorkspaceProps) {
  const {selection, owners, pullRequests, onNavigate, chat, terminal} = props;
  const [chatOpen, setChatOpen] = useState(false), [terminalOpen, setTerminalOpen] = useState(false);
  const targetValue = selection.target.kind === 'local' ? selection.target.scope : `pr:${selection.target.repo}:${selection.target.number}`;
  return <section className="cr-workspace" aria-label="Code review workspace">
    <header className="cr-toolbar">
      <Select aria-label="Project and working copy" value={ownerKey(selection.owner)} options={owners.map(item => ({value: ownerKey(item.owner), label: item.label}))}
        onValueChange={value => {const next = owners.find(item => ownerKey(item.owner) === value); if (next) onNavigate({owner: next.owner, target: {kind: 'local', scope: 'worktree'}});}} />
      <Select aria-label="Comparison" value={targetValue} options={[{value: 'worktree', label: 'Working copy'}, {value: 'staged', label: 'Staged changes'}, ...pullRequests.map(item => ({value: `pr:${item.repo}:${item.number}`, label: `#${item.number} ${item.title}`}))]}
        onValueChange={value => {const pr = pullRequests.find(item => value === `pr:${item.repo}:${item.number}`); onNavigate({...selection, target: pr ? {kind: 'pull-request', repo: pr.repo, number: pr.number} : {kind: 'local', scope: value === 'staged' ? 'staged' : 'worktree'}});}} />
      <span className="cr-toolbar-spacer" />
      {Boolean(terminal) && <button type="button" aria-pressed={terminalOpen} onClick={() => setTerminalOpen(value => !value)}>Terminal</button>}
      {Boolean(chat) && <button type="button" aria-pressed={chatOpen} onClick={() => setChatOpen(value => !value)}>Agent chat</button>}
    </header>
    <div className="cr-body">
      <ComparisonBody key={selectionKey(selection)} {...props} />
      {Boolean(terminal) && <section className="cr-slot cr-terminal" aria-label="Terminal" hidden={!terminalOpen}>{terminal}</section>}
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

function ComparisonBody({selection, writes}: CodeReviewWorkspaceProps) {
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
  const held = busy || refreshing || !draft.ready || !!draft.error || ['pending', 'uncertain', 'revoked'].includes(draft.value?.outcome ?? '');
  const selected = comparison?.files.find(file => file.path === path);
  const compatible = !!identity && !!draft.value && canUseDraft(draft.value, identity, action);
  const canReview = !!comparison && reviewable(selection, comparison, writes);
  const ownerBound = !!writes && sameOwner(selection.owner, writes.owner) && selection.owner.authority.kind === 'local';
  const rows = comparison?.files.filter(file => `${file.path} ${file.oldPath ?? ''}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase())) ?? [];
  const load = () => setRefresh(value => value + 1);
  async function perform(command: ReviewCommand, callback: (context: ReviewDispatchContext) => Promise<ReviewActionResult>, reviewWrite = false) {
    if (!comparison || !action || !canWrite || held || inFlight.current || !draft.value || (reviewWrite && (!compatible || !canReview))) return;
    inFlight.current = true; setBusy(true); setNotice(''); let started = false, admitted = false;
    const captured = comparison, expectedAction = action, context: ReviewDispatchContext = structuredClone({selection, comparison: captured.identity, action: expectedAction, attemptId: crypto.randomUUID()});
    const attempt: ReviewAttempt = structuredClone({...context, ...command});
    try {
      const fresh = await codeReviewClient.comparison(selection);
      const currentWrites = latestWrites.current;
      if (!mounted.current) return;
      if ((fresh.state !== 'ready' && fresh.state !== 'empty') || comparisonKey(fresh.value.identity) !== comparisonKey(captured.identity)
        || !writable(selection, fresh.value, currentWrites) || (reviewWrite && !reviewable(selection, fresh.value, currentWrites)) || JSON.stringify(actionIdentity(currentWrites)) !== JSON.stringify(expectedAction)) {
        setNotice('Comparison or permission changed. Refresh before acting.'); load(); return;
      }
      // Persist the uncertain boundary before a canonical callback can start a write.
      await draft.admit(attempt); admitted = true;
      if (!mounted.current || !writable(selection, captured, latestWrites.current) || (reviewWrite && !reviewable(selection, captured, latestWrites.current)) || JSON.stringify(actionIdentity(latestWrites.current)) !== JSON.stringify(expectedAction)) {
        await draft.outcome(attempt.attemptId, 'stale'); return;
      }
      started = true;
      const result = await callback(structuredClone(context));
      if (!result || !['confirmed', 'stale', 'uncertain', 'revoked'].includes(result.state)) throw Error('Canonical action outcome is unconfirmed.');
      const applied = await draft.outcome(attempt.attemptId, result.state);
      if (applied && mounted.current) {setNotice(result.state === 'confirmed' ? (reviewWrite ? 'Review submitted.' : 'Action confirmed.') : ''); if (result.state === 'confirmed' && !reviewWrite) load();}
    } catch {
      if (admitted) await draft.outcome(attempt.attemptId, started ? 'uncertain' : 'stale').catch(() => {});
      if (mounted.current && !started) setNotice('Comparison could not be verified. Refresh before acting.');
    } finally {inFlight.current = false; if (mounted.current) setBusy(false);}
  }
  const error = read.state === 'error' ? reviewError(new ApiError(read.error.code, '')) : '';
  const local = identity?.kind === 'local';
  const stage = () => {if (!writes || !selected || !action) return; const callback = identity?.kind === 'local' && identity.scope === 'staged' ? writes.onUnstage : writes.onStage;
    const payload = {paths: [selected.path], revision: action.revision, expectedHead: action.head};
    if (callback) void perform({operation: identity?.kind === 'local' && identity.scope === 'staged' ? 'unstage' : 'stage', payload}, context => callback(context, structuredClone(payload)));};
  async function inspectOutcome() {
    const attempt = draft.value?.attempt;
    if (!ownerBound || !writes?.onInspectOutcome || !attempt || draft.value?.outcome !== 'uncertain' || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const result = await writes.onInspectOutcome(structuredClone(attempt));
      if (result && ['confirmed', 'not-applied', 'uncertain', 'revoked'].includes(result.state)) {
        const applied = await draft.outcome(attempt.attemptId, result.state === 'not-applied' ? 'stale' : result.state);
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
        {draft.value && identity && !compatible && !['pending', 'uncertain', 'revoked', 'confirmed'].includes(draft.value.outcome) && <div className="cr-draft-state"><p>Draft belongs to an earlier comparison or working-copy revision.</p><button type="button" disabled={held} onClick={() => void draft.rebind(identity, action).catch(() => {})}>Use current comparison</button></div>}
        {draft.value?.outcome === 'uncertain' && <p role="alert">Outcome uncertain. Inspect the canonical action before trying again.</p>}
        {draft.value && isHeldDraft(draft.value) && !draft.value.attempt && <p role="alert">Saved action lacks an exact attempt record. Writes remain held; verify the action with its canonical owner.</p>}
        {draft.value?.outcome === 'revoked' && <p role="alert">Action access revoked. Your draft is preserved.</p>}
        {draft.value?.outcome === 'confirmed' && <p role="status">{local ? 'Action confirmed.' : 'Review submitted.'}</p>}
        {draft.value?.outcome === 'uncertain' && draft.value.attempt && ownerBound && writes?.onInspectOutcome && <button type="button" disabled={busy} onClick={() => void inspectOutcome()}>Inspect action outcome</button>}
        {identity?.kind === 'pull-request' && <>
          <Select aria-label="Review decision" value={draft.value?.event ?? 'COMMENT'} disabled={!draft.ready || busy}
            options={[{value: 'COMMENT', label: 'Comment'}, {value: 'APPROVE', label: 'Approve'}, {value: 'REQUEST_CHANGES', label: 'Request changes'}]}
            onValueChange={value => {if (draft.value) void draft.edit({event: value as ReviewDraft['event']}).catch(() => {});}} />
          <button type="button" className="cr-submit" disabled={!writes?.onReview || !canReview || !compatible || held || comparison?.filesTruncated || !draft.value || (draft.value.event !== 'APPROVE' && !draft.value.body.trim())}
            onClick={() => {if (!writes?.onReview || !draft.value || !action || identity.kind !== 'pull-request') return; const payload = {number: identity.number, event: draft.value.event, body: draft.value.body, head: action.head, revision: action.revision}; void perform({operation: 'review', payload}, context => writes.onReview!(context, structuredClone(payload)), true);}}>Submit review</button>
          {!canReview && <p className="cr-meta">Review submission requires a writable working copy at this PR’s exact head.</p>}
        </>}
      </section>
      {local && writes?.onCommit && <form className="cr-commit" onSubmit={event => {event.preventDefault(); const text = draft.value?.commitMessage ?? ''; if (writes.onCommit && text.trim() && action) {const payload = {message: text, revision: action.revision, expectedHead: action.head}; void perform({operation: 'commit', payload}, context => writes.onCommit!(context, structuredClone(payload)));}}}>
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

function validDraft(value: unknown, selection: ReviewSelection): value is ReviewDraft {
  const draft = value as ReviewDraft | null;
  try {return !!draft && draft.version === 1 && typeof draft.body === 'string' && draft.body.length <= 64000 && typeof draft.commitMessage === 'string' && draft.commitMessage.length <= 4000 && ['COMMENT', 'APPROVE', 'REQUEST_CHANGES'].includes(draft.event)
    && (draft.attempt === undefined || validAttempt(draft.attempt, selection))
    && ['idle', 'pending', 'confirmed', 'stale', 'uncertain', 'revoked'].includes(draft.outcome) && !!comparisonKey(draft.basis) && (draft.action === null || ['head', 'revision', 'branch'].every(key => typeof draft.action?.[key as keyof ActionIdentity] === 'string'));} catch {return false;}
}
function useDraft(selection: ReviewSelection, identity: ComparisonIdentity | undefined, action: ActionIdentity | null) {
  const key = 'code-review:v1:' + selectionKey(selection), latest = useRef<ReviewDraft | null>(null), live = useRef(true);
  const [value, setValue] = useState<ReviewDraft | null>(null), [ready, setReady] = useState(false), [error, setError] = useState(''), [recovery, setRecovery] = useState(0);
  useEffect(() => {
    live.current = true; let current = true;
    const accept = (raw: unknown) => {
      if (!current || raw === undefined) return;
      if (!validDraft(raw, selection)) {setError('Saved draft could not be read. Keep this view open and retry.'); setReady(false); return;}
      latest.current = raw; setValue(raw);
    };
    const unsubscribe = journalSubscribe(key, accept);
    void journalRead(key).then(async raw => {
      if (!current) return;
      if (raw !== undefined && !validDraft(raw, selection)) {accept(raw); return;}
      const recovered = raw && validDraft(raw, selection) ? raw : null;
      if (recovered?.outcome === 'pending') await update(current => current.outcome === 'pending' && current.attempt?.attemptId === recovered.attempt?.attemptId ? {...current, outcome: 'uncertain'} : null);
      else if (recovered) accept(recovered);
      if (current) {setReady(true); setError('');}
    }).catch(() => {if (current) setError('Draft recovery failed. Retry before submitting.');});
    return () => {current = false; live.current = false; unsubscribe();};
  }, [key, recovery]);
  useEffect(() => {if (ready && identity && !latest.current) {const next = newDraft(identity, action); latest.current = next; setValue(next); void journalWrite(key, next).catch(() => {if (live.current) setError('Draft could not be saved. Keep this view open and retry.');});}}, [ready, identity && comparisonKey(identity)]);
  // Read value and generation together. Editable changes and acknowledgments merge
  // only after checking ownership; CAS alone does not identify a write attempt.
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
    // Keep keystrokes synchronous and use the subscribed value, never a render's
    // stale attempt/outcome. Concurrent CAS acknowledgments must re-read this edit.
    try {await journalWrite(key, {...current, ...patch, outcome: current.outcome === 'confirmed' && ('body' in patch || 'event' in patch) ? 'idle' : current.outcome});}
    catch (cause) {if (live.current) setError('Draft could not be saved. Keep this view open and retry.'); throw cause;}
  }
  async function admit(attempt: ReviewAttempt) {
    if (!validAttempt(attempt, selection)) throw Error('Action identity is invalid.');
    if (!await update(current => isHeldDraft(current) ? null : {...current, attempt: structuredClone(attempt), outcome: 'pending'})) throw Error('Another action is unresolved.');
    await journalFlush();
  }
  const outcome = (attemptId: string, next: ReviewDraft['outcome']) => update(current => acknowledgeAttempt(current, attemptId, next));
  const rebind = (basis: ComparisonIdentity, action: ActionIdentity | null) => update(current => rebindDraft(current, basis, action));
  return {value, ready, error, edit, rebind, admit, outcome, retry: () => {setError(''); setReady(false); setRecovery(current => current + 1);}};
}
