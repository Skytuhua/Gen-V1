import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authenticated, command, read } from './api.ts';
import { journalWrite, journalRead } from './journal.ts';
import { parseUnifiedDiff, type ParsedFile, type ParsedDiffLine } from './review-diff.ts';
import { REVIEW_COMMENT_LIMITS, type ReviewComment, type ReviewCommentAnchor } from '../../../packages/contracts/review-comments.ts';

interface ReviewCommentsResponse { enabled: boolean; comments: ReviewComment[] }
const fetchComments = (threadId: string, signal?: AbortSignal) =>
  authenticated(() => fetch(`/api/threads/${encodeURIComponent(threadId)}/review-comments`, { credentials: 'same-origin', cache: 'no-store', signal })).then(read<ReviewCommentsResponse>);
const message = (error: unknown) => error instanceof Error ? error.message : 'The review comment could not be saved.';
const excerptFor = (lines: string[]) => { const text = lines.join('\n'); return { excerpt: text.slice(0, REVIEW_COMMENT_LIMITS.excerptBytes), excerptTruncated: text.length > REVIEW_COMMENT_LIMITS.excerptBytes }; };

export function ReviewDiff({ threadId, modelId, scope, diff, head, revision, active, onEnabled }: { threadId: string; modelId: string | null; scope: 'worktree' | 'staged'; diff: string; head: string; revision: string; active: boolean; onEnabled?: (enabled: boolean) => void }) {
  const files = useMemo(() => parseUnifiedDiff(diff), [diff]);
  const [comments, setComments] = useState<ReviewComment[] | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const [selection, setSelection] = useState<{ path: string; side: 'new' | 'old'; start: number; end: number } | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const generation = useRef(0), commentsRef = useRef<ReviewComment[] | null>(null), opener = useRef<HTMLElement | null>(null);
  const load = useCallback(async () => {
    if (!active) return;
    const captured = ++generation.current;
    try {
      const value = await fetchComments(threadId);
      if (captured !== generation.current) return;
      const prior = commentsRef.current;
      if (prior) {
        const lines = value.comments.filter(c => { const before = prior.find(p => p.id === c.id); return before && before.status !== c.status; })
          .map(c => `${c.anchor.path}:${c.anchor.startLine} is now ${c.status}`);
        const removed = prior.filter(p => !value.comments.some(c => c.id === p.id)).length;
        if (removed) lines.push(`${removed} review comment${removed === 1 ? '' : 's'} removed`);
        if (lines.length) setAnnouncement(lines.join('. ') + '.');
      }
      commentsRef.current = value.comments;
      setEnabled(value.enabled); setComments(value.comments); setError(''); onEnabled?.(value.enabled);
    }
    catch (cause) { if (captured === generation.current) setError(message(cause)); }
  }, [threadId]);
  useEffect(() => { setComments(null); setEnabled(false); void load(); }, [load]);
  useEffect(() => { const refetch = () => void load(); window.addEventListener('harness:review-comment-changed', refetch); return () => window.removeEventListener('harness:review-comment-changed', refetch); }, [load]);

  const journalKey = `review-comment-draft:${threadId}:${selection?.path}:${selection?.side}:${selection?.start}`;
  useEffect(() => { if (!selection) return; let live = true; setDraft(''); void journalRead(journalKey).then(value => { if (live && typeof value === 'string') setDraft(value); }).catch(() => undefined); return () => { live = false; }; }, [journalKey, selection]);

  const scopeComments = (comments ?? []).filter(c => c.anchor.scope === scope);
  const live = scopeComments.filter(c => c.anchor.revision === revision && (showResolved || c.status !== 'resolved'));
  const outdated = scopeComments.filter(c => c.anchor.revision !== revision);
  const drafts = scopeComments.filter(c => c.status === 'draft');

  const select = (path: string, side: 'new' | 'old', line: number, extend: boolean) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelection(current => extend && current && current.path === path && current.side === side
      ? { ...current, end: Math.max(line, current.start), start: Math.min(line, current.start) }
      : { path, side, start: line, end: line });
  };
  const closeComposer = () => {
    setSelection(null);
    const target = opener.current; opener.current = null;
    if (target?.isConnected) target.focus();
  };
  const create = async () => {
    if (!selection || !draft.trim()) return;
    const file = files.find(f => (selection.side === 'new' ? f.path : f.oldPath ?? f.path) === selection.path);
    const rows = file ? file.hunks.flatMap(h => h.lines) : [];
    const texts = rows.filter(r => r.kind !== 'meta' && (selection.side === 'new' ? r.newLine : r.oldLine) !== null && (selection.side === 'new' ? r.newLine! : r.oldLine!) >= selection.start && (selection.side === 'new' ? r.newLine! : r.oldLine!) <= selection.end).map(r => r.text);
    const hunkHeader = file?.hunks.find(h => h.lines.some(r => (selection.side === 'new' ? r.newLine : r.oldLine) === selection.start))?.header ?? '';
    const anchor: ReviewCommentAnchor = { path: selection.path, side: selection.side, startLine: selection.start, endLine: selection.end, scope, head, revision, hunkHeader, ...excerptFor(texts) };
    await command('review.comment.create', { id: crypto.randomUUID(), anchor, body: draft.trim() }, threadId).then(load);
    await journalWrite(journalKey, '').catch(() => undefined);
    setAnnouncement('Review comment saved.');
    closeComposer(); setDraft('');
  };
  const act = async (type: string, c: ReviewComment, extra: Record<string, unknown> = {}) =>
    command(type, { id: c.id, expectedRev: c.rev, ...extra }, threadId).then(load).catch(cause => setError(message(cause)));
  const send = async () => {
    if (!drafts.length || !modelId || sending) return;
    setSending(true);
    try { await command('message.send', { content: 'Please address my review comments.', modelId, reviewCommentIds: drafts.map(c => c.id).slice(0, REVIEW_COMMENT_LIMITS.perSend) }, threadId); await load(); }
    catch (cause) { setError(message(cause)); }
    finally { setSending(false); }
  };
  if (!enabled) return null;
  return <div className="review-diff" data-review-diff>
    <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
    {error && <p role="alert" className="error-text">{error}</p>}
    <div className="review-diff-toolbar">
      <label><input type="checkbox" checked={showResolved} onChange={e => setShowResolved(e.target.checked)} />Show resolved</label>
      <span className="muted">{comments === null ? 'Loading comments…' : `${scopeComments.length} comment${scopeComments.length === 1 ? '' : 's'}`}</span>
    </div>
    {files.map(file => <section key={file.path || file.oldPath} className="review-diff-file" aria-label={file.path}>
      <header className="review-diff-file-name">{file.oldPath && file.oldPath !== file.path ? `${file.oldPath} → ` : ''}{file.path || file.oldPath}</header>
      {file.binary && <p className="panel-note">Binary file</p>}
      {file.hunks.map(hunk => <div key={hunk.header} role="group" aria-label={hunk.header}>
        <div className="review-diff-hunk">{hunk.header}</div>
        {hunk.lines.map((row, index) => <DiffRow key={index} file={file} row={row} comments={live} selection={selection} select={select} renderComposer={selection && composerAt(file, row, selection) ? { selection, draft, setDraft, create, cancel: closeComposer, journalKey } : null} act={act} />)}
      </div>)}
    </section>)}
    {outdated.length > 0 && <details className="review-diff-outdated"><summary>{outdated.length} outdated comment{outdated.length === 1 ? '' : 's'} from an earlier revision</summary>
      <ul>{outdated.map(c => <li key={c.id}><CommentCard comment={c} act={act} /></li>)}</ul></details>}
    {drafts.length > 0 && <div className="review-diff-send-bar">
      <span>{drafts.length} review comment{drafts.length === 1 ? '' : 's'} ready</span>
      <button className="secondary" disabled={!modelId || sending || drafts.length > REVIEW_COMMENT_LIMITS.perSend} onClick={() => void send()}>{sending ? 'Sending…' : `Send ${Math.min(drafts.length, REVIEW_COMMENT_LIMITS.perSend)} comments`}</button>
      {drafts.length > REVIEW_COMMENT_LIMITS.perSend && <small className="error-text">At most {REVIEW_COMMENT_LIMITS.perSend} comments per send.</small>}
    </div>}
  </div>;
}

function composerAt(file: ParsedFile, row: ParsedDiffLine, selection: { path: string; side: 'new' | 'old'; start: number; end: number }): boolean {
  const path = file.path || file.oldPath || '';
  if (selection.path !== path) return false;
  const line = selection.side === 'new' ? row.newLine : row.oldLine;
  return line === selection.end;
}

function DiffRow({ file, row, comments, selection, select, renderComposer, act }: { file: ParsedFile; row: ParsedDiffLine; comments: ReviewComment[]; selection: { path: string; side: 'new' | 'old'; start: number; end: number } | null; select: (path: string, side: 'new' | 'old', line: number, extend: boolean) => void; renderComposer: { selection: { path: string; side: 'new' | 'old'; start: number; end: number }; draft: string; setDraft: (v: string) => void; create: () => Promise<void>; cancel: () => void; journalKey: string } | null; act: (type: string, c: ReviewComment, extra?: Record<string, unknown>) => Promise<void> }) {
  if (row.kind === 'meta') return <div className="review-diff-meta">{row.text}</div>;
  const path = file.path || file.oldPath || '';
  const anchored = comments.filter(c => c.anchor.path === path && ((c.anchor.side === 'new' && c.anchor.endLine === row.newLine) || (c.anchor.side === 'old' && c.anchor.endLine === row.oldLine)));
  return <>
    <div className={`review-diff-row review-diff-${row.kind}`}>
      {(['old', 'new'] as const).map(side => {
        const line = side === 'new' ? row.newLine : row.oldLine;
        const commentable = line !== null && (row.kind === 'context' || (side === 'new' ? row.kind === 'add' : row.kind === 'del'));
        const selected = commentable && selection && selection.path === path && selection.side === side && line! >= selection.start && line! <= selection.end;
        return <button key={side} type="button" className={`review-diff-gutter${selected ? ' review-diff-selected' : ''}`} disabled={!commentable}
          aria-label={commentable ? `Comment on ${path} ${side} line ${line}` : undefined}
          aria-pressed={selected ?? undefined}
          onClick={event => { if (commentable) select(path, side, line!, event.shiftKey); }}
          onKeyDown={event => { if (commentable && event.key === 'Enter') select(path, side, line!, event.shiftKey); }}>
          {line ?? ''}
        </button>;
      })}
      <code className="review-diff-code">{row.text}</code>
    </div>
    {anchored.map(c => <CommentCard key={c.id} comment={c} act={act} />)}
    {renderComposer && <div className="review-diff-composer" role="form" aria-label={`Comment on ${renderComposer.selection.path} lines ${renderComposer.selection.start}-${renderComposer.selection.end}`}>
      <textarea aria-label="Review comment" maxLength={REVIEW_COMMENT_LIMITS.bodyChars} value={renderComposer.draft} autoFocus
        onChange={event => { renderComposer.setDraft(event.target.value); void journalWrite(renderComposer.journalKey, event.target.value).catch(() => undefined); }}
        onKeyDown={event => { if (event.key === 'Escape') renderComposer.cancel(); if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void renderComposer.create(); }} />
      <div><button className="secondary" disabled={!renderComposer.draft.trim()} onClick={() => void renderComposer.create()}>Comment</button>
      <button className="quiet" onClick={renderComposer.cancel}>Cancel</button>
      <small className="muted">{renderComposer.selection.path}:{renderComposer.selection.start === renderComposer.selection.end ? renderComposer.selection.start : `${renderComposer.selection.start}-${renderComposer.selection.end}`} · Ctrl+Enter to submit</small></div>
    </div>}
  </>;
}

function CommentCard({ comment, act }: { comment: ReviewComment; act: (type: string, c: ReviewComment, extra?: Record<string, unknown>) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(comment.body);
  const editable = ['draft', 'replied', 'unaddressed'].includes(comment.status);
  return <article className={`review-comment review-comment-${comment.status}`} data-comment-id={comment.id}>
    <header><small>{comment.anchor.path}:{comment.anchor.startLine}{comment.anchor.endLine !== comment.anchor.startLine ? `-${comment.anchor.endLine}` : ''} · {comment.status}{comment.resolvedBy ? ` by ${comment.resolvedBy}` : ''}</small></header>
    {editing
      ? <><textarea aria-label="Edit comment" maxLength={REVIEW_COMMENT_LIMITS.bodyChars} value={body} onChange={e => setBody(e.target.value)} />
        <div><button className="secondary" disabled={!body.trim()} onClick={() => void act('review.comment.edit', comment, { body: body.trim() }).then(() => setEditing(false))}>Save</button>
        <button className="quiet" onClick={() => { setEditing(false); setBody(comment.body); }}>Cancel</button></div></>
      : <p>{comment.body}</p>}
    {comment.agentNote && <p className="review-comment-note"><small>Agent: {comment.agentNote}</small></p>}
    <div className="review-comment-actions">
      {editable && !editing && <button className="quiet" onClick={() => setEditing(true)}>Edit</button>}
      {comment.status === 'draft' && <button className="quiet" onClick={() => void act('review.comment.delete', comment)}>Delete</button>}
      {comment.status !== 'draft' && comment.status !== 'resolved' && <button className="quiet" onClick={() => void act('review.comment.resolve', comment)}>Resolve</button>}
      {['resolved', 'replied', 'unaddressed'].includes(comment.status) && <button className="quiet" onClick={() => void act('review.comment.reopen', comment)}>Reopen</button>}
    </div>
  </article>;
}
