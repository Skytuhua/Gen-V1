import { useCallback, useEffect, useRef, useState } from 'react';
import { GitBranch, History, Import } from 'lucide-react';
import { ActionMenu, type ActionMenuItem } from '../../../packages/ui-shell/ActionMenu';
import { Modal } from '../../../packages/ui-shell/Modal';
import { ApiError } from './api';
import { Markdown } from './Markdown';
import {
  cancelImport, commitImport, forkConversation, getCaptureMessages, getImportedMessages,
  getSessionBranchOverview, inspectPoint, stageImport, startQuotedTask,
  type BranchCommandResult, type CapturePage, type ImportedPage, type SessionBranchOverview, type StageOutcome,
} from './session-branch-api';
import type { Message, Thread } from '../../../packages/contracts/index';
import './session-branch.css';

const messageOf = (error: unknown) => error instanceof ApiError ? error.message : error instanceof Error ? error.message : String(error);

export function useSessionBranchOverview(threadId: string | undefined, tick = 0) {
  const [overview, setOverview] = useState<SessionBranchOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const reload = useCallback(() => {
    const version = ++generation.current;
    if (!threadId) { setOverview(null); return; }
    getSessionBranchOverview(threadId).then(value => { if (generation.current === version) { setOverview(value); setError(null); } })
      .catch(cause => { if (generation.current === version) { setOverview(null); setError(messageOf(cause)); } });
  }, [threadId]);
  useEffect(() => { reload(); }, [reload, tick]);
  return { overview, error, reload };
}

const ROLE_LABEL: Record<string, string> = { user: 'You', assistant: 'Assistant', system: 'Historical system text', tool: 'Historical tool output', activity: 'Activity' };

function HistoricalMessage({ role, text, note }: { role: string; text: string; note?: string }) {
  return <article className="session-branch-message">
    <span className="scoped-conversation-role">{ROLE_LABEL[role] ?? 'Historical'}</span>
    <div className="scoped-conversation-text"><Markdown text={text} /></div>
    {note && <p className="muted">{note}</p>}
  </article>;
}

/** Read-only frozen capture view. No replay, restore or approval actions. */
export function CaptureViewer({ captureId, onClose }: { captureId: string; onClose: () => void }) {
  const [page, setPage] = useState<CapturePage | null>(null), [error, setError] = useState<string | null>(null), [older, setOlder] = useState<readonly CapturePage['messages'][number][]>([]);
  useEffect(() => { getCaptureMessages(captureId).then(setPage).catch(cause => setError(messageOf(cause))); }, [captureId]);
  const loadOlder = () => { if (page?.nextCursor) void getCaptureMessages(captureId, page.nextCursor).then(next => { setOlder(value => [...next.messages, ...value]); setPage({ ...next, messages: page.messages, nextCursor: next.nextCursor }); }).catch(cause => setError(messageOf(cause))); };
  const newestExceedsBudget = !!page && !older.length && !page.messages.length && page.truncated > 0;
  return <Modal open title="Inspect point — fixed history cut" onClose={onClose} className="dialog session-branch-dialog">
    {error && <p role="alert" className="error-text">{error}</p>}
    {page && <>
      <p className="muted">Captured from <strong>{page.sourceThreadId.slice(0, 8)}</strong> at event {page.sourceCut.sequence} · {page.sourceCut.messageCount} message(s){page.coverage === 'TRUNCATED' ? newestExceedsBudget ? ` · ${page.truncated} message(s) not captured` : ` · ${page.truncated} earlier message(s) not captured` : ''}.</p>
      <p className="muted">This is a frozen view — new activity never changes it, and historical tool effects cannot be replayed. It is a host transcript copy, not a native engine checkpoint. File restore is a separate approved action.</p>
      {page.incompleteSource.includes('TRUNCATED_HISTORY') && <p className="notice" role="status">{newestExceedsBudget ? 'Incomplete coverage: the newest message exceeded the Inspect content budget.' : 'Incomplete coverage: the oldest messages were outside the capture bound.'}</p>}
      {page.incompleteSource.includes('ATTACHMENTS_NOT_CAPTURED') && <p className="muted">Archived or missing attachment content is not part of this view.</p>}
      <div className="session-branch-transcript">
        {page.nextCursor && <button type="button" className="ui-action-trigger" onClick={loadOlder}>Load earlier captured messages</button>}
        {[...older, ...page.messages].map(message => <HistoricalMessage key={message.id} role={message.role} text={message.content} />)}
        {!older.length && !page.messages.length && <p>No messages were captured.</p>}
      </div>
    </>}
    <footer className="dialog-actions"><button className="primary" onClick={onClose}>Done</button></footer>
  </Modal>;
}

/** Read-only imported archive view with a persistent archive badge. */
function ImportedViewer({ conversationId, onClose }: { conversationId: string; onClose: () => void }) {
  const [page, setPage] = useState<ImportedPage | null>(null), [error, setError] = useState<string | null>(null), [older, setOlder] = useState<readonly ImportedPage['messages'][number][]>([]);
  useEffect(() => { getImportedMessages(conversationId).then(setPage).catch(cause => setError(messageOf(cause))); }, [conversationId]);
  const loadOlder = () => { if (page?.nextCursor) void getImportedMessages(conversationId, page.nextCursor).then(next => { setOlder(value => [...next.messages, ...value]); setPage({ ...next, messages: page.messages, nextCursor: next.nextCursor }); }).catch(cause => setError(messageOf(cause))); };
  return <Modal open title="Imported archive" onClose={onClose} className="dialog session-branch-dialog">
    {error && <p role="alert" className="error-text">{error}</p>}
    {page && <>
      <p><span className="session-branch-badge">Imported archive</span></p>
      <p className="muted">Source: <strong>{page.sourceProduct}</strong> exported {page.exportedAt} · {page.messages.length} loaded message(s){page.attachmentOmissions ? ` · ${page.attachmentOmissions} attachment reference(s) omitted` : ''}.</p>
      <p className="muted">Historical content only — system and tool text is untrusted history, never live instructions, approvals or credentials.</p>
      {page.importWarnings.map((warning, index) => <p key={index} className="notice" role="status">{warning}</p>)}
      <div className="session-branch-transcript">
        {page.nextCursor && <button type="button" className="ui-action-trigger" onClick={loadOlder}>Load earlier imported messages</button>}
        {[...older, ...page.messages].map(message => <HistoricalMessage key={message.id} role={message.role} text={message.text} />)}
      </div>
    </>}
    <footer className="dialog-actions"><button className="primary" onClick={onClose}>Done</button></footer>
  </Modal>;
}

function QuotePicker({ thread, messages, onDone, onClose }: { thread: Thread; messages: readonly Message[]; onDone: (threadId: string) => void; onClose: () => void }) {
  const quotable = messages.filter(message => message.role !== 'activity').slice(-40);
  const [selected, setSelected] = useState<Set<string>>(new Set()), [title, setTitle] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const toggle = (id: string) => setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else if (next.size < 8) next.add(id); return next; });
  const submit = () => {
    setBusy(true); setError(null);
    void startQuotedTask(thread.id, { quoteMessageIds: [...selected], title: title.trim() || undefined })
      .then(result => { if (result.thread) onDone(result.thread.id); })
      .catch(cause => { setError(messageOf(cause)); setBusy(false); });
  };
  return <Modal open title="Start a new task with quoted context" onClose={onClose} className="dialog session-branch-dialog">
    <p className="muted">This creates a <strong>new task</strong> that quotes the selected history. It is not a replay or an exact continuation — the source conversation stays unchanged, files don't change, and the new task gets fresh authorization.</p>
    <div className="session-branch-transcript">
      {quotable.map(message => <label key={message.id} className="session-branch-quote">
        <input type="checkbox" checked={selected.has(message.id)} onChange={() => toggle(message.id)} />
        <span><strong>{ROLE_LABEL[message.role] ?? message.role}</strong> {message.content.slice(0, 160)}{message.content.length > 160 ? '…' : ''}</span>
      </label>)}
      {!quotable.length && <p>No quotable messages are loaded.</p>}
    </div>
    <label className="field">New task title<input value={title} maxLength={140} onChange={event => setTitle(event.target.value)} placeholder="New task (quoted context)" /></label>
    {error && <p role="alert" className="error-text">{error}</p>}
    <footer className="dialog-actions">
      <button type="button" className="quiet" onClick={onClose}>Cancel</button>
      <button className="primary" disabled={busy || !selected.size} onClick={submit}>{busy ? 'Creating…' : 'Create new task'}</button>
    </footer>
  </Modal>;
}

function ImportPreview({ thread, staged, onDone, onClose }: { thread: Thread; staged: StageOutcome; onDone: () => void; onClose: () => void }) {
  const { preview, deduplicated } = staged;
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [committed, setCommitted] = useState<string | null>(null);
  const cancel = () => {
    if (staged.staged) { setBusy(true); void cancelImport(thread.id, staged.staged.importId).catch(cause => setError(messageOf(cause))).finally(() => { setBusy(false); onClose(); }); }
    else onClose();
  };
  const commit = () => {
    if (!staged.staged) return;
    setBusy(true); setError(null);
    void commitImport(thread.id, staged.staged.importId)
      .then(result => setCommitted(`Imported ${result.receipt.conversations} conversation(s), ${result.receipt.messageCount} message(s).`))
      .catch(cause => { setError(messageOf(cause)); setBusy(false); });
  };
  return <Modal open title="Import history archive" onClose={cancel} className="dialog session-branch-dialog">
    {committed ? <>
      <p role="status">{committed}</p>
      <p className="muted">The archive is read-only history under this conversation. It grants no authority and changes no files.</p>
      <footer className="dialog-actions"><button className="primary" onClick={() => { onDone(); onClose(); }}>Done</button></footer>
    </> : <>
      {deduplicated ? <>
        <p role="status">This exact archive was already imported here — the existing receipt is reused, nothing is duplicated.</p>
        <p className="muted">Imported {deduplicated.conversations} conversation(s), {deduplicated.messageCount} message(s) at {deduplicated.committedAt}.</p>
        <footer className="dialog-actions"><button className="primary" onClick={() => { onDone(); onClose(); }}>Done</button></footer>
      </> : <>
        <p className="muted">Format: <strong>{preview.format} JSON</strong> · Source: <strong>{preview.source.sourceProduct}</strong> exported {preview.source.exportedAt}</p>
        <p className="muted">{preview.counts.conversations} conversation(s), {preview.counts.messages} message(s), {preview.counts.attachmentRefs} inert attachment reference(s) (omitted — nothing is fetched). Destination: this conversation{preview.destination.projectId ? ` (project ${preview.destination.projectId})` : ''}.</p>
        {preview.warnings.map((warning, index) => <p key={index} className="notice" role="status">{warning}</p>)}
        {preview.secretFields.map((field, index) => <p key={index} className="error-text">Secret-bearing field reported: {field.path}</p>)}
        {preview.accessLinks.map((link, index) => <p key={index} className="notice" role="status">Access-bearing link reported ({link.kind}{link.host ? `, ${link.host}` : ''}) at {link.path} — not opened.</p>)}
        <p className="muted">{preview.heuristicNote}</p>
        <p className="muted">Importing never executes imported text, creates approvals, populates project memory or changes files.</p>
        {error && <p role="alert" className="error-text">{error}</p>}
        <footer className="dialog-actions">
          <button type="button" className="quiet" disabled={busy} onClick={cancel}>Cancel import</button>
          <button className="primary" disabled={busy || preview.blocked || !staged.staged} onClick={commit}>{preview.blocked ? 'Import blocked' : busy ? 'Importing…' : 'Import archive'}</button>
        </footer>
        {preview.blocked && <p role="alert" className="error-text">Publication is blocked: the archive declares fields classified as secret-bearing.</p>}
      </>}
    </>}
  </Modal>;
}

export interface SessionBranchMenuProps {
  thread: Thread;
  messages: readonly Message[];
  onOpenThread: (threadId: string) => void;
  onChanged?: () => void;
  overview: SessionBranchOverview | null;
  reloadOverview: () => void;
}

/** Distinct history actions: Inspect point, Fork (only with a proven
 * capability), Start new task with quoted context, and ArchiveV1 import. */
export function SessionBranchMenu({ thread, messages, onOpenThread, onChanged, overview, reloadOverview }: SessionBranchMenuProps) {
  const [open, setOpen] = useState(false), [error, setError] = useState<string | null>(null);
  const [captureId, setCaptureId] = useState<string | null>(null), [importId, setImportId] = useState<string | null>(null);
  const [quoteOpen, setQuoteOpen] = useState(false), [staged, setStaged] = useState<StageOutcome | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const branchEnabled = overview?.enabled?.branch === true, importEnabled = overview?.enabled?.import === true;
  const forkSupported = overview?.capabilities?.nativeFork === 'SUPPORTED';
  const run = (work: Promise<BranchCommandResult>) => {
    setError(null);
    void work.then(result => {
      if (result.capture) setCaptureId(result.capture.captureId);
      if (result.thread) onOpenThread(result.thread.id);
      reloadOverview(); onChanged?.();
    }).catch(cause => setError(messageOf(cause)));
  };
  const pickFile = (file: File) => {
    setError(null);
    void file.text().then(text => stageImport(thread.id, text)).then(setStaged)
      .catch(cause => setError(messageOf(cause)));
  };
  const items: ActionMenuItem[] = [
    {
      id: 'inspect', label: 'Inspect point', title: 'Copy a fixed view of this history. Files don\'t change.',
      icon: <History size={14} />, disabled: !branchEnabled,
      onSelect: () => run(inspectPoint(thread.id)),
    },
    {
      id: 'quote', label: 'Start new task with quoted context', title: 'A new task quoting selected messages — not a replay. Files don\'t change.',
      icon: <GitBranch size={14} />, disabled: !branchEnabled || !messages.some(message => message.role !== 'activity'),
      onSelect: () => setQuoteOpen(true),
    },
    {
      id: 'fork', label: forkSupported ? 'Fork conversation' : `Fork conversation — unavailable (${(overview?.capabilities?.nativeFork ?? 'UNPROVEN').toLowerCase()})`,
      title: forkSupported ? 'Create a native continuation at this point. Files don\'t change.' : 'No tested native fork API exists for this engine. Quote or inspect instead.',
      icon: <GitBranch size={14} />, disabled: !branchEnabled || !forkSupported,
      onSelect: () => run(forkConversation(thread.id)),
    },
    {
      id: 'import', label: 'Import ArchiveV1 JSON…', title: 'Stage and preview an inert ArchiveV1 history import. Files don\'t change.',
      icon: <Import size={14} />, disabled: !importEnabled,
      onSelect: () => fileInput.current?.click(),
    },
    ...(overview?.captures?.length ? [{
      id: 'capture', label: `Open latest inspect point (${overview.captures.length})`, title: 'Read the most recent fixed history cut.',
      icon: <History size={14} />,
      onSelect: () => setCaptureId(overview.captures[overview.captures.length - 1]!.captureId),
    }] : []),
    ...(overview?.imports?.length ? [{
      id: 'archive', label: `Open imported archive (${overview.imports.length})`, title: 'Read imported history — inert and read-only.',
      icon: <Import size={14} />,
      onSelect: () => setImportId(overview.imports[overview.imports.length - 1]!.conversationId),
    }] : []),
  ];
  return <>
    <ActionMenu label="History" icon={<History size={13} />} open={open} onOpenChange={setOpen} items={items} disabled={!overview} />
    <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) pickFile(file); }} />
    {error && <span className="error-text" role="alert">{error}</span>}
    {captureId && <CaptureViewer captureId={captureId} onClose={() => setCaptureId(null)} />}
    {importId && <ImportedViewer conversationId={importId} onClose={() => setImportId(null)} />}
    {quoteOpen && <QuotePicker thread={thread} messages={messages} onClose={() => setQuoteOpen(false)} onDone={id => { setQuoteOpen(false); onOpenThread(id); }} />}
    {staged && <ImportPreview thread={thread} staged={staged} onClose={() => setStaged(null)} onDone={() => { reloadOverview(); onChanged?.(); }} />}
  </>;
}

/** U02 branch header: names the parent conversation and the captured cut. */
export function SessionBranchLineage({ thread, onOpenThread, overview }: { thread: Thread; onOpenThread?: (threadId: string) => void; overview: SessionBranchOverview | null }) {
  const branch = overview?.branch;
  if (!branch || branch.childThreadId !== thread.id) return null;
  return <p className="session-branch-lineage muted">
    New task branched from <button type="button" className="quiet" onClick={() => onOpenThread?.(branch.parentThreadId)}>{branch.parentThreadId.slice(0, 8)}</button>
    {' '}at cut event {branch.sourceCut.sequence} ({branch.sourceCut.messageCount} message(s)). Tool effects in that history are historical and cannot be replayed.
  </p>;
}
