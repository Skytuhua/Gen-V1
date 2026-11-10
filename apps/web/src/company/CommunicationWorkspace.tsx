import {useEffect, useRef, useState} from 'react';
import {ArrowLeft, ChevronRight, Inbox, MessageSquare, RefreshCw, ShieldCheck} from 'lucide-react';
import {journalRead, journalWrite} from '../journal';
import type {CommunicationMessage, CommunicationReadModel} from './communication-model';
import {TaskWorkflow} from './TaskWorkflow';
import './communication.css';

type View = 'project' | 'task' | 'inbox';
type Selection = {view: View; taskId: string; employeeId: string; messageId: string; plain: boolean};
const initial: Selection = {view: 'project', taskId: '', employeeId: '', messageId: '', plain: false};
const stamp = (value: number | null) => value === null ? 'Unavailable' : new Date(value).toLocaleString();

/** read is supplied by a trusted host composition after its scoped read boundary is available. */
export function CommunicationWorkspace({read, onRecovered}: {read?: (signal: AbortSignal) => Promise<CommunicationReadModel>; onRecovered?: () => void}) {
  const [mode, setMode] = useState<'company' | 'fixture'>(() => new URLSearchParams(location.search).get('fixture') === 'communications' ? 'fixture' : 'company');
  const [modeReady, setModeReady] = useState(!window.harnessDesktop), [workflowReady, setWorkflowReady] = useState(false), [loaded, setLoaded] = useState(false), [draftSettled, setDraftSettled] = useState(false);
  const [model, setModel] = useState<CommunicationReadModel>();
  const [selection, setSelection] = useState<Selection>(initial);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [failure, setFailure] = useState('');
  const [online, setOnline] = useState(navigator.onLine), [draft, setDraft] = useState(''), [draftReady, setDraftReady] = useState(false), [saved, setSaved] = useState('Recovering draft…');
  const draftVersion = useRef(0), readVersion = useRef(0), abort = useRef<AbortController | undefined>(undefined);
  const selectionKey = `company:communications:${mode}:selection:v1`;
  const selectedTask = model?.tasks.find(task => task.id === selection.taskId) ?? model?.tasks[0];
  const employeeId = model?.inboxes.some(box => box.employeeId === selection.employeeId) ? selection.employeeId : model?.inboxes[0]?.employeeId ?? '';
  const draftKey = model && selectedTask ? `company:${model.companyId}:${model.projectId}:communications:${mode}:${selectedTask.id}:draft:v1` : null;

  useEffect(() => {
    if (!window.harnessDesktop) return;
    let alive = true;
    void journalRead<'company' | 'fixture'>('company:communications:source:v1').then(value => {if (alive && (value === 'fixture' || value === 'company')) setMode(value);})
      .catch(() => {if (alive) setFailure('Source selection could not be recovered. Company data remains selected.');})
      .finally(() => {if (alive) setModeReady(true);});
    return () => {alive = false;};
  }, []);

  useEffect(() => {
    let alive = true; setReady(false);
    void journalRead<Partial<Selection>>(selectionKey).then(value => {
      if (!alive) return;
      setSelection({view: ['project', 'task', 'inbox'].includes(value?.view ?? '') ? value!.view! : 'project',
        taskId: typeof value?.taskId === 'string' ? value.taskId : '', employeeId: typeof value?.employeeId === 'string' ? value.employeeId : '',
        messageId: typeof value?.messageId === 'string' ? value.messageId : '', plain: value?.plain === true});
    }).catch(() => {if (alive) setFailure('View recovery unavailable. Your draft has not been overwritten.');}).finally(() => {if (alive) setReady(true);});
    return () => {alive = false;};
  }, [selectionKey]);
  useEffect(() => {
    let alive = true; const version = ++draftVersion.current; setDraftReady(false); setDraftSettled(false); setDraft('');
    if (!draftKey) {setDraftSettled(true); return;}
    setSaved('Recovering draft…');
    void journalRead<string>(draftKey).then(value => {if (alive && version === draftVersion.current) {setDraft(typeof value === 'string' ? value : ''); setDraftReady(true); setSaved('Saved on this device · not sent');}})
      .catch(() => {if (alive) setSaved('Draft recovery unavailable · reload to retry');}).finally(() => {if (alive) setDraftSettled(true);});
    return () => {alive = false;};
  }, [draftKey]);
  useEffect(() => {
    const connect = () => setOnline(true), disconnect = () => {setOnline(false); abort.current?.abort(); setBusy(false);};
    window.addEventListener('online', connect); window.addEventListener('offline', disconnect);
    return () => {window.removeEventListener('online', connect); window.removeEventListener('offline', disconnect); abort.current?.abort();};
  }, []);
  async function refresh() {
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    const version = ++readVersion.current; setBusy(true); setFailure('');
    try {
      if (mode === 'company' && !read) throw new Error('Authorized communication reads are not connected to this owner host. No sample records have been substituted.');
      const next = mode === 'fixture' ? await (await import('./communication-fixture')).createCommunicationFixture() : await read!(controller.signal);
      if (mode === 'company' && next.source !== 'authorized_host') throw new Error('READ_UNAVAILABLE');
      if (!controller.signal.aborted && version === readVersion.current) setModel(next);
    } catch (cause) {
      if (!controller.signal.aborted && version === readVersion.current) {
        const denied = cause && typeof cause === 'object' && ('status' in cause && [401, 403].includes(cause.status as number) || 'code' in cause && ['AUTHENTICATION_REQUIRED', 'SCOPE_DENIED', 'COMPANY_AUTH', 'COMPANY_FORBIDDEN', 'AUTH_REQUIRED'].includes(cause.code as string));
        if (denied) setModel(undefined);
        setFailure(denied ? 'Current communication access was denied. Protected records have been cleared; local drafts remain saved.' : mode === 'company' && !read ? 'Authorized communication reads are not connected to this owner host. No sample records have been substituted.' : 'Communication read unavailable. Refresh to retry; no command was sent.');
      }
    } finally {if (version === readVersion.current) {setBusy(false); setLoaded(true);}}
  }
  useEffect(() => {if (!modeReady) return; setLoaded(false); setModel(undefined); void refresh(); return () => {abort.current?.abort(); readVersion.current++;};}, [mode, modeReady, read]);
  useEffect(() => {if (modeReady && ready && loaded && draftSettled && (mode === 'fixture' || workflowReady)) onRecovered?.();}, [modeReady, ready, loaded, draftSettled, mode, workflowReady, onRecovered]);
  function choose(patch: Partial<Selection>) {
    const next = {...selection, ...patch}; setSelection(next);
    void journalWrite(selectionKey, next).catch(() => setFailure('View selection could not be saved locally.'));
  }
  function selectMode(next: 'company' | 'fixture') {
    abort.current?.abort(); readVersion.current++; setModel(undefined); setMode(next);
    const url = new URL(location.href);
    if (next === 'fixture') url.searchParams.set('fixture', 'communications'); else url.searchParams.delete('fixture');
    if (window.harnessDesktop) void journalWrite('company:communications:source:v1', next).catch(() => setFailure('Source selection could not be saved on this device.'));
    else history.replaceState(history.state, '', url);
  }
  function edit(value: string) {
    if (!draftKey || !draftReady) return;
    const version = ++draftVersion.current; setDraft(value); setSaved('Saving locally…');
    void journalWrite(draftKey, value).then(() => {if (version === draftVersion.current) setSaved('Saved on this device · not sent');})
      .catch(() => {if (version === draftVersion.current) setSaved('Save failed · keep this window open');});
  }
  const byId = new Map(model?.messages.map(message => [message.id, message]));
  const inbox = model?.inboxes.find(box => box.employeeId === employeeId);
  const visibleIds = selection.view === 'task' ? selectedTask?.messageIds ?? [] : selection.view === 'inbox' ? inbox?.messageIds ?? [] : model?.timeline ?? [];
  function messageCard(message: CommunicationMessage) {
    return <article className="communication-message" key={message.id} data-message-id={message.id} aria-label={`Message ${message.id}`}>
      <div className="communication-message-heading"><strong>{message.summary}</strong><span>{message.sender} → {message.recipient}</span></div>
      <p className="communication-body">{message.body}</p>
      <div className="communication-delivery"><span>Accepted by service</span><span>{message.receivedAt === null ? 'Received: unavailable' : 'Received by supervisor'}</span><span>Consumed: unavailable</span></div>
      <small className="company-id">Message <code>{message.id}</code></small>
      <div className="communication-links"><button onClick={() => choose({view: 'task', taskId: message.taskId, messageId: message.id})}>Open task thread<ChevronRight size={13}/></button><button onClick={() => choose({view: 'inbox', employeeId: message.recipient, messageId: message.id})}>Addressed inbox<Inbox size={13}/></button></div>
      <details open={selection.messageId === message.id} onToggle={event => {if (event.currentTarget.open && selection.messageId !== message.id) choose({messageId: message.id}); else if (!event.currentTarget.open && selection.messageId === message.id) choose({messageId: ''});}}>
        <summary>Delivery and evidence</summary>
        <dl className="company-values"><div><dt>Accepted</dt><dd>{stamp(message.acceptedAt)}</dd></div><div><dt>Received assertion</dt><dd>{stamp(message.receivedAt)}</dd></div><div><dt>Consumed by model</dt><dd>Unavailable · opening this view does not consume a message</dd></div><div><dt>Delivery</dt><dd>{message.deliveryId}</dd></div><div><dt>Received receipt</dt><dd>{message.receivedReceiptId ?? 'Unavailable'}</dd></div></dl>
        <p className="company-footnote">Received is a supervisor assertion. No model turn, admission, start, result or verification is established.</p>
        <pre>{JSON.stringify({message: message.messageRef, conversation: message.conversationRef, delivery: message.deliveryRef}, null, 2)}</pre>
      </details>
    </article>;
  }
  return <section className="communication-workspace" aria-label="Communication workspace" aria-busy={busy}>
    {modeReady && mode === 'company' && <TaskWorkflow onRecovered={() => setWorkflowReady(true)}/>}
    <div className="communication-source"><label>Data source<select aria-label="Communication data source" value={mode} onChange={event => selectMode(event.target.value as 'company' | 'fixture')}><option value="company">Company data</option><option value="fixture">Stage 1 synthetic fixture</option></select></label><button className="company-refresh" disabled={busy || !online} onClick={() => void refresh()}><RefreshCw size={14}/>Refresh communication view</button></div>
    <div className="communication-notice" role="status"><ShieldCheck size={15}/><div><strong>{mode === 'fixture' ? 'Synthetic fixture · no live employees' : 'Read-only company communication'}</strong>{mode !== 'fixture' && <p>{model?.proofLabel ?? 'No communication records loaded.'}</p>}<p>{online ? 'Presentation connected · no background polling' : 'Disconnected · showing the last loaded view'} · no dispatch or publication.</p></div></div>
    {failure && <div role="alert" className="company-alert"><p>{failure}{model ? ' The previous read remains visible and may be stale.' : ''}</p></div>}
    {!model ? <div className="company-empty"><h3>{busy ? 'Reading communication records' : 'Communication data unavailable'}</h3><p>Use the explicitly labeled Stage 1 fixture to inspect project rooms, task threads and addressed inboxes. The live owner gateway, employee inbox read composition and decision controls remain blocked.</p><button className="company-refresh" disabled={busy} onClick={() => selectMode('fixture')}>Open Stage 1 fixture</button></div> : <>
      <nav className="communication-tabs" aria-label="Communication surfaces">
        <button aria-current={selection.view === 'project' ? 'page' : undefined} disabled={!ready} onClick={() => choose({view: 'project'})}>Project room</button>
        <button aria-current={selection.view === 'task' ? 'page' : undefined} disabled={!ready} onClick={() => choose({view: 'task'})}>Task thread</button>
        <button aria-current={selection.view === 'inbox' ? 'page' : undefined} disabled={!ready} onClick={() => choose({view: 'inbox'})}>Addressed inbox</button>
        <button aria-pressed={selection.plain} disabled={!ready} onClick={() => choose({plain: !selection.plain})}>{selection.plain ? 'Show composed view' : 'Plain text fallback'}</button>
      </nav>
      <div className="communication-context"><span>{model.projectName} · {model.projectId}</span><span>{selection.view === 'project' ? 'Project room' : selection.view === 'task' ? selectedTask?.id : `Inbox addressed to ${employeeId}`}</span></div>
      {selection.view === 'task' && <p className="company-footnote">Task and work-order versions are unavailable in this read. Discussion does not establish task completion.</p>}
      {selection.view === 'project' && <section className="company-section"><h3>Linked task threads</h3>{model.tasks.map(task => <button className="company-record-button" key={task.id} onClick={() => choose({view: 'task', taskId: task.id})}><MessageSquare size={15}/>{task.title}<ChevronRight size={14}/></button>)}</section>}
      {selection.view === 'inbox' && <label className="communication-inbox-select">Addressed employee<select aria-label="Addressed employee" value={employeeId} onChange={event => choose({employeeId: event.target.value})}>{model.inboxes.map(box => <option key={box.employeeId} value={box.employeeId}>{box.employeeId}</option>)}</select><small>Information notes only. Assigned work, questions, reviews and effective priority are unavailable in this read. Viewing an inbox does not acknowledge delivery.</small></label>}
      <div className="communication-layout"><div>
        <h3>{selection.view === 'project' ? 'Project activity' : selection.view === 'task' ? selectedTask?.title ?? 'Task thread unavailable' : `Inbox · ${employeeId}`}</h3>
        {selection.plain ? <pre className="communication-plain" aria-label="Plain communication records">{visibleIds.map(id => {const item = byId.get(id)!; return `Message ${id}\nTask ${item.taskId}\n${item.sender} → ${item.recipient}\n${item.summary}\n${item.body}\nAccepted: ${stamp(item.acceptedAt)}\nReceived by supervisor: ${stamp(item.receivedAt)}\nConsumed: unavailable\n`;}).join('\n')}</pre> : visibleIds.map(id => byId.get(id) ? messageCard(byId.get(id)!) : null)}
        {!visibleIds.length && <p className="company-empty">No messages in this loaded view. This is not a complete company history.</p>}
        {selection.view === 'task' && <section className="company-notes"><label htmlFor="communication-draft">Task reply draft</label><textarea id="communication-draft" rows={4} value={draft} disabled={!draftReady} maxLength={16000} placeholder="Keep an unsent question or review note…" onChange={event => edit(event.target.value)}/><p role="status">{saved}</p><button disabled title="Sending is unavailable in Stage 1">Send unavailable</button><p>Local draft only. Refresh and reconnect never submit it.</p></section>}
      </div><aside className="communication-inspector" aria-label="Decisions and blockers">
        <section className="company-section"><h3>Current blockers</h3><ul>{model.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul></section>
        <section className="company-section"><h3>Owner decision inbox</h3>{model.decision ? <><strong>{model.decision.title}</strong><p>{model.decision.detail}</p><dl className="company-values"><div><dt>Accepted decision</dt><dd>Unavailable</dd></div><div><dt>Decider / evidence</dt><dd>Unavailable</dd></div></dl></> : <p>No decision records supplied by this read.</p>}<button disabled>Approve unavailable</button></section>
        <section className="company-section"><h3>Evidence and actions</h3><p>No task acceptance, artifact review or GitHub link is established by this discussion.</p><p>Live owner authentication, send, consumed ACK, dispatch and publication remain unavailable.</p></section>
      </aside></div>
      {selection.view !== 'project' && <button className="company-back" onClick={() => choose({view: 'project'})}><ArrowLeft size={14}/>Back to project room</button>}
    </>}
  </section>;
}
