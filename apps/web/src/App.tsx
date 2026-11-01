import { useCallback, useEffect, useLayoutEffect, useRef, useState, useMemo, type CSSProperties, type ReactNode } from 'react';
import { Archive, ArrowUp, Check, ChevronDown, ChevronRight, CircleHelp, CircleStop, File, Folder, FolderPlus, Laptop, LoaderCircle, Menu, MessageSquare, Mic, MoreHorizontal, PanelLeftClose, PenLine, Plus, Search, Settings2, SlidersHorizontal, SquarePen, WifiOff, X } from 'lucide-react';
import type { InputRequest, ModelInfo, Operation, Snapshot, Thread,Message } from '../../../packages/contracts';
import { bootstrap, command, getModels, getSnapshot, subscribe } from './api';
import { journalCompareAndSwap, journalGeneration, journalRead, journalReadRecord, journalSubscribe, journalWrite } from './journal';
import { Artifact } from './Artifact';
import { Markdown } from './Markdown';
import { groupWorkActivity, WorkActivity } from './WorkActivity';
import { display, schemaDefaults, SchemaFields } from './registry';
import { useModalRegion } from './focus';
import Ajv from 'ajv';
import { getPreferences, type UiPreferences } from '../../../packages/contracts/preferences';
import { Settings } from './Settings';
import { ShellSidebar, threadStatus } from './ShellSidebar';
import { useShellLayout, matchesShortcut } from './shell-layout';
import { ResizeHandle, WorkspacePanel } from './WorkspacePanel';
import { WorkspaceProvider } from './workspace-context';
import './shell.css';
import { ContextInspector } from './ContextInspector';
import {PlanningQuestion} from './PlanningQuestion';
import {UsageFooter} from './UsageFooter';
import {FloatingWindow} from './FloatingWindow';
import {FloatingRail} from './FloatingRail';
import {PlanStatus} from './PlanStatus';
import {createPlanVisibility,selectPlanRecord} from './plan-visibility';
import {ComposerToolbar,ComposerTaskActions} from './ComposerToolbar';
import {recordedChangeSummary} from './composer-evidence';
import {useDesktop,useDesktopCloseGuard,useDesktopReady,useDetachedSurface,usePendingSurface,DesktopWindowActions,DetachButton} from './desktop-context';
import {DesktopBrowserDock} from './DesktopBrowser';
import {journalFlush} from './journal';
import {SideChat,type SideChatHandle} from './SideChat';
import {createConversationScroll} from './conversation-scroll';

const emptySnapshot: Snapshot = { seq: 0, threads: [], messages: [], artifacts: [], userStates: [], data: [], requests: [], operations: [], resources: [], usage: {}, settings: { theme: 'dark', modelId: null }, activeThreadId: null };
const messageOf = (error: unknown) => error instanceof Error ? error.message : 'The request could not be completed.';
const decisionAjv = new Ajv({ strict: false, validateFormats: false });

function Dialog({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="dialog" aria-label={title} onCancel={close} onClick={event => { if (event.target === event.currentTarget) close(); }}><header><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={close}><X size={17} /></button></header>{children}</dialog>;
}

function AssistantProse({message,arrivals,active}:{message:Message;arrivals:Set<string>;active:boolean}){
  const initial=useRef(arrivals.has(message.id));useEffect(()=>{arrivals.delete(message.id);},[message.id,arrivals]);
  return <Markdown text={message.content} animate={active||initial.current} initialReveal={initial.current}/>;
}
function InputDecision({ request, refresh, snapshot }: { request: InputRequest; refresh: () => Promise<void>; snapshot:Snapshot }) {
  const defaults = schemaDefaults(request.responseSchema);
  const [values, setValues] = useState<Record<string, unknown>>(() => defaults && typeof defaults === 'object' ? defaults as Record<string, unknown> : {});
  const [text, setText] = useState<unknown>(() => defaults ?? '');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const objectSchema = request.responseSchema.type === 'object' || request.responseSchema.properties;
  const key = request.presentation?`request:${request.id}:planning`:`request:${request.id}:${request.revision}`;
  useEffect(() => {
    let active = true;
    void journalRead<{ schema: string; response: unknown } | null>(key).then(saved => {
      if (!active) return;
      if (saved?.schema === JSON.stringify(request.responseSchema)) { if (objectSchema) setValues(saved.response as Record<string, unknown>); else setText(saved.response); }
      setReady(true);
    }).catch(() => { if (active) { setReady(true); setError('Draft recovery is unavailable. Keep this decision open.'); } });
    return () => { active = false; };
  }, [key]);
  const update = (response: unknown) => {
    if (objectSchema) setValues(response as Record<string, unknown>); else setText(response);
    void journalWrite(key, { schema: JSON.stringify(request.responseSchema), response }).catch(() => setError('The decision draft could not be stored. Keep this decision open.'));
  };
  const respond = async (withdraw = false) => {
    setBusy(true); setError('');
    const version = journalGeneration(key);
    try {
      const response = objectSchema ? values : text;
      if (!withdraw && !decisionAjv.validate(request.responseSchema, response)) throw new Error('The response does not match the requested schema. Check the required fields and values.');
      await command(withdraw ? 'request.withdraw' : 'request.respond', { requestId: request.id, revision: request.revision, ...(!withdraw ? { response } : {}) }, request.threadId); await journalCompareAndSwap(key, version, null); await refresh();
    } catch (error) { setError(messageOf(error)); } finally { setBusy(false); }
  };
  const detail=async(kind:'explain'|'examples'|'more-options',optionId?:string)=>{setError('');try{await command('request.detail',{requestId:request.id,revision:request.revision,kind,...(optionId?{optionId}:{})},request.threadId);await refresh();}catch(cause){setError(messageOf(cause));throw cause;}};
  if(request.presentation)return <div className="decision"><PlanningQuestion id={request.id} revision={request.revision} title={request.title} prompt={request.prompt} {...request.presentation} value={typeof text==='string'?text:''} onChange={update} resources={snapshot.resources.filter(item=>item.threadId===request.threadId)} onExplain={(optionId,kind)=>detail(kind,optionId)} onMoreOptions={()=>detail('more-options')} onSubmit={()=>respond()} busy={busy||!ready} error={error||request.detailRequests?.find(detail=>detail.status==="failed")?.error} pending={request.detailRequests?.find(item=>item.status==='pending')} /><button className="quiet" disabled={busy||!ready} onClick={()=>void respond(true)}>Withdraw</button></div>;
  return <section className="decision" aria-label={request.title}><header><span className="pending-dot" />{request.title}<span className="badge">Your input</span></header><Markdown text={request.prompt} /><form onSubmit={event => { event.preventDefault(); void respond(); }}><fieldset disabled={busy || !ready}>{objectSchema ? <SchemaFields schema={request.responseSchema} value={values} onChange={update} /> : <SchemaFields schema={{ type: 'object', properties: { response: { ...request.responseSchema, title: 'Response' } }, required: ['response'] }} value={{ response: text }} onChange={value => update(value.response)} />}</fieldset>{error && <p role="alert" className="error-text">{error}</p>}<div className="decision-actions"><button type="button" className="quiet" disabled={busy || !ready} onClick={() => void respond(true)}>Withdraw</button><button className="primary" disabled={busy || !ready}>{busy ? 'Submitting…' : 'Continue'}<ArrowUp size={14} /></button></div></form></section>;
}
export function OperationDecision({ operation, refresh }: { operation: Operation; refresh: () => Promise<void> }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const caption = operation.description.replace(/\s+(?:and\s+)?(?:resource\s+)?version\s+[a-f0-9]{64}\b/gi, '').replace(/\b[a-f0-9]{64}\b/gi, '[recorded version]').replace(/\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/gi, '[recorded operation]');
  const approve = operation.status === 'prepared' && !operation.approved;
  const reconcile = operation.status === 'unknown';
  const execute = async (type: string) => { setBusy(true); setError(''); try { await command(type, { operationId: operation.id, revision: operation.revision }, operation.threadId); await refresh(); } catch (error) { setError(messageOf(error)); } finally { setBusy(false); } };
  if (operation.status === 'succeeded' || operation.status === 'failed' || operation.status === 'cancelled') {
    const status = operation.status === 'succeeded' ? 'Succeeded' : operation.status === 'failed' ? 'Failed' : 'Cancelled';
    return <section className="decision operation-outcome" data-operation-id={operation.id} data-operation-status={operation.status} aria-label="Operation outcome"><details className="operation-receipt"><summary>
      {operation.status === 'succeeded' ? <Check size={15} aria-hidden="true" /> : operation.status === 'failed' ? <X size={15} aria-hidden="true" /> : <CircleStop size={15} aria-hidden="true" />}
      <span className="operation-outcome-status">{status}</span><span className="operation-outcome-caption">{caption}</span><ChevronDown size={14} className="operation-outcome-chevron" aria-hidden="true" />
    </summary><div className="operation-receipt-evidence"><p>{caption}</p><details><summary>Changes and preconditions</summary><pre>{JSON.stringify({ description: operation.description, kind: operation.kind, args: operation.args, resources: operation.resourceIds, preconditions: operation.preconditions }, null, 2)}</pre></details>{operation.result !== undefined && <details><summary>Executor result</summary><pre>{display(operation.result)}</pre></details>}{operation.error && <p className="error-text">{operation.error}</p>}</div></details></section>;
  }
  return <section className="decision" data-operation-id={operation.id} aria-label={approve ? 'Operation approval' : 'Operation outcome'}><header><span className="pending-dot" />{reconcile ? 'Inspect uncertain outcome' : approve ? 'Review operation' : 'Operation receipt'}<span className="badge">{approve ? 'Approval needed' : operation.status}</span></header><p>{caption}</p><details><summary>Changes and preconditions</summary><pre>{JSON.stringify({ description: operation.description, kind: operation.kind, args: operation.args, resources: operation.resourceIds, preconditions: operation.preconditions }, null, 2)}</pre></details>{operation.result !== undefined && <details><summary>Executor result</summary><pre>{display(operation.result)}</pre></details>}{operation.error && <p className="error-text">{operation.error}</p>}{reconcile && <p className="muted">Inspect the actual outcome before resuming. Reconciliation reads evidence without repeating this operation.</p>}{error && <p role="alert" className="error-text">{error}</p>}{(approve || reconcile) && <div className="decision-actions">{approve && <button className="quiet" disabled={busy} onClick={() => void execute('operation.reject')}>Decline operation</button>}<button className={approve ? 'primary' : 'secondary'} disabled={busy} onClick={() => void execute(reconcile ? 'operation.reconcile' : 'operation.approve')}>{busy ? 'Checking…' : reconcile ? 'Reconcile outcome' : 'Approve operation'}{approve && <Check size={14} />}</button></div>}</section>;
}

function ResourcePicker({ threadId, close, refresh }: { threadId: string; close: () => void; refresh: () => Promise<void> }) {
  const [path, setPath] = useState('');
  const [kind, setKind] = useState('project');
  const [writable, setWritable] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <Dialog title="Add a resource" close={close}><p className="muted">Choose a local file, project, or SQLite database for this thread. Access is scoped to the path you grant.</p><form onSubmit={event => { event.preventDefault(); setBusy(true); void command('resource.grant', { path, kind, writable }, threadId).then(async () => { await refresh(); close(); }).catch(error => setError(messageOf(error))).finally(() => setBusy(false)); }}><label className="field">Resource type<select value={kind} onChange={event => setKind(event.target.value)}><option value="project">Project folder</option><option value="file">File</option><option value="database">SQLite database</option><option value="export">Export folder</option></select></label><label className="field">Absolute local path<input autoFocus required value={path} onChange={event => setPath(event.target.value)} placeholder="C:\Users\you\Documents\project" /></label><label className="check-field"><input type="checkbox" checked={writable} onChange={event => setWritable(event.target.checked)} />Allow approved changes</label><p className="muted">Mutations still require approval for each prepared operation.</p>{error && <p role="alert" className="error-text">{error}</p>}<footer className="dialog-actions"><button type="button" className="quiet" onClick={close}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Granting…' : 'Add resource'}</button></footer></form></Dialog>;
}

type PrepareThread = (id: string) => Promise<unknown>;
function Composer({ thread, models, modelId, setModelId, modelError, snapshot, ensureThread, busy, runAction, refresh, setup, openResource, browseProject, inspectChanges, reportError,onSide }: { thread: Thread | undefined; models: ModelInfo[]; modelId: string; setModelId: (id: string) => void; modelError: string; snapshot: Snapshot; ensureThread: (prepare: PrepareThread) => Promise<string>; busy: boolean; runAction: (action: () => Promise<void>) => Promise<void>; refresh: () => Promise<void>; setup: () => void; openResource: (id: string) => void; browseProject:(id:string)=>void;inspectChanges:()=>void; reportError: (error: string) => void;onSide:(content:string)=>Promise<void> }) {
  const key = thread?.id ?? 'new';
  const draftTarget = useRef(key);
  const [draft, setDraft] = useState('');
  const draftLatest=useRef(draft);draftLatest.current=draft;
  const [thinkingLevel,setThinkingLevel]=useState(thread?.thinkingLevel??'');const thinkingEdited=useRef(false),thinkingLatest=useRef(thinkingLevel);thinkingLatest.current=thinkingLevel;
  useEffect(()=>{let active=true;void journalRead<string>('thinking:'+key).then(value=>{if(active&&!thinkingEdited.current)setThinkingLevel(value??thread?.thinkingLevel??'');}).catch(()=>{});return()=>{active=false;};},[key]);
  const chooseThinking=(value:string)=>{thinkingEdited.current=true;setThinkingLevel(value);void journalWrite('thinking:'+draftTarget.current,value).catch(()=>{});};
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [contextOpen, setContextOpen] = useState(false);
  const contextAnchor = useRef<HTMLSpanElement>(null);
  const preferences = getPreferences(snapshot.settings);
  useEffect(() => { if (!contextOpen) return; const dismiss = (event: PointerEvent) => { if (!contextAnchor.current?.contains(event.target as Node)) setContextOpen(false); }; const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setContextOpen(false); contextAnchor.current?.querySelector('button')?.focus(); } }; document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', key); return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', key); }; }, [contextOpen]);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const working = Boolean(thread?.runId) || thread?.status === 'working';
  const resources = snapshot.resources.filter(item => item.threadId === thread?.id);
  const unavailable = !models.length || !models.some(model => model.id === modelId);
  const project=resources.find(resource=>resource.kind==='project');const changes=useMemo(()=>recordedChangeSummary(snapshot.data,thread?.id),[snapshot.data,thread?.id]);
  useEffect(()=>{const model=models.find(model=>model.id===modelId);if(model&&thinkingLevel&&!model.thinkingLevels?.includes(thinkingLevel))chooseThinking('');},[models,modelId,thinkingLevel]);
  useEffect(() => { let current = true; void journalRead<string>(`draft:${key}`).then(value => { if (current) { setDraft(value ?? ''); setReady(true); } }).catch(() => { if (current) { setReady(true); setError('Draft recovery is unavailable. Keep this tab open until your message is sent.'); } }); return () => { current = false; }; }, [key]);
  useEffect(() => journalSubscribe(`draft:${key}`, value => { if (draftTarget.current === key) setDraft(typeof value === 'string' ? value : ''); }), [key]);
  useEffect(() => { if (input.current) { input.current.style.height = 'auto'; input.current.style.height = `${Math.min(220, input.current.scrollHeight)}px`; } }, [draft]);
  const updateDraft = (value: string) => { setDraft(value); void journalWrite(`draft:${draftTarget.current}`, value).catch(() => setError('Draft could not be stored locally. Keep this tab open.')); };
  const migrateDraft = async (id: string, fallback = draft, retireSource = false) => {
    const source = id !== key ? await journalReadRecord<string>(`draft:${key}`) : undefined;
    // New keystrokes follow the copied draft while snapshot/selection is pending.
    draftTarget.current = id;
    if(id!==key)await journalWrite('thinking:'+id,thinkingLatest.current);
    const generation = id !== key ? await journalWrite(`draft:${id}`, source?.value ?? fallback) : journalGeneration(`draft:${key}`);
    if (id !== key && retireSource && source) await journalCompareAndSwap(`draft:${key}`, source.generation, '');
    return { source, generation };
  };
  const send = async () => {
    if (busy || !draft.trim()) return;
    const sideCommand=/^\/(?:btw|side)(?:\s|$)/i.exec(draft.trim());
    if(sideCommand){
      if(!thread){setError('Start a main conversation before asking a side question.');return;}
      const generation=journalGeneration(`draft:${key}`);setError('');
      try{await onSide(draft.trim().slice(sideCommand[0].length).trim());await journalCompareAndSwap(`draft:${key}`,generation,'');}catch(cause){setError(messageOf(cause));}
      return;
    }
    if (working || unavailable) return;
    await runAction(async () => {
      setError('');
      const submittedDraft = draft;
      const submittedGeneration = journalGeneration(`draft:${key}`);
      try {
        let migrated: Awaited<ReturnType<typeof migrateDraft>> | undefined;
        const id = await ensureThread(async id => { migrated = await migrateDraft(id, submittedDraft, true); });
        await command('message.send', { content: submittedDraft.trim(), modelId, thinkingLevel:thinkingLevel||null }, id);
        await journalCompareAndSwap(`draft:${key}`, submittedGeneration, '');
        if (id !== key && migrated && migrated.source?.generation === submittedGeneration) await journalCompareAndSwap(`draft:${id}`, migrated.generation, '');
        await refresh();
      } catch (error) { setError(messageOf(error)); if (key === 'new') reportError(messageOf(error)); }
    });
  };
  const upload = async (files: FileList | File[]) => {
    const selectedFiles = Array.from(files);
    await runAction(async () => {
      setError('');
      try {
        const id = await ensureThread(id => migrateDraft(id, draft, true));
        for (const item of selectedFiles) {
          if (item.size > 20 * 1024 * 1024) throw new Error(`${item.name} is larger than the 20 MB attachment limit.`);
          const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.onerror = () => reject(reader.error); reader.readAsDataURL(item); });
          await command('resource.upload', { name: item.name, mimeType: item.type || 'application/octet-stream', base64 }, id);
        }
        await refresh();
      } catch (error) { setError(messageOf(error)); if (key === 'new') reportError(messageOf(error)); }
    });
  };
  const addResource = () => runAction(async () => {
    try { const id = await ensureThread(id => migrateDraft(id, draft, true)); openResource(id); }
    catch (error) { reportError(messageOf(error)); }
  });
  const preparePR=()=>{const intent='Create a pull request for the current changes.';const current=draftLatest.current;updateDraft(current.startsWith(intent)?current:intent+(current.trim()?'\n\n'+current:''));input.current?.focus();};
  return <div className="composer-dock">
    {error && <div className="composer-error" role="alert">{error}<button className="icon-button" aria-label="Dismiss composer error" onClick={() => setError('')}><X size={14} /></button></div>}
    <form className={`composer ${dragging ? 'dragging' : ''}`} onSubmit={event => { event.preventDefault(); void send(); }} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); if (event.dataTransfer.files.length) void upload(event.dataTransfer.files); }}>
      <div className="composer-header-utilities">{resources.some(resource=>resource.kind!=='project') && <div className="resource-strip">{resources.filter(resource=>resource.kind!=='project').map(resource => <span key={resource.id} className="resource-chip" title={`${resource.path} · ${resource.writable ? 'Approved writes allowed' : 'Read only'}`}>{resource.kind === 'project' ? <Folder size={12} /> : <File size={12} />}{resource.label}</span>)}</div>}<ComposerTaskActions changeSummary={changes} onChanges={inspectChanges} onCreatePR={preparePR} disabled={busy||!ready} working={working}/></div>
      <textarea ref={input} aria-label="Message" placeholder={dragging ? 'Drop files to attach' : 'Ask anything, or bring something to work on…'} value={draft} disabled={!ready} onChange={event => updateDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && (preferences.sendShortcut === 'enter' || event.ctrlKey || event.metaKey)) { event.preventDefault(); void send(); } }} rows={1} />
      <ComposerToolbar models={models} modelId={modelId} onModelChange={id=>{chooseThinking('');setModelId(id);}} thinkingLevel={thinkingLevel} onThinkingChange={chooseThinking} projectLabel={project?.label} changeSummary={changes} onProject={()=>project?browseProject(project.id):addResource()} onChanges={inspectChanges} onCreatePR={preparePR} onTranscript={text=>{const current=draftLatest.current;updateDraft(current+(current&&!/\s$/.test(current)?' ':'')+text);}} disabled={busy||!ready} working={working} separateActions
        leading={<><button type="button" className="icon-button attach-button" aria-label="Attach files" title="Attach files" disabled={busy} onClick={()=>file.current?.click()}><Plus size={18}/></button><input type="file" multiple ref={file} hidden onChange={event=>{if(event.target.files)void upload(event.target.files);event.target.value='';}}/></>}
        runtime={<><span className="pill runtime-pill" title="Local Pi runtime"><Laptop size={14}/>Local</span><label className="mode-picker"><span className="sr-only">Task mode</span><select aria-label="Task mode" disabled={working||busy} value={thread?.mode??'build'} onChange={event=>{const mode=event.target.value;void runAction(async()=>{try{const id=await ensureThread(id=>migrateDraft(id,draft,true));await command('thread.mode',{mode},id);await refresh();}catch(cause){setError(messageOf(cause));}});}}><option value="build">Build</option><option value="plan">Plan</option></select></label></>}
        context={preferences.showComposerContext&&<span ref={contextAnchor} className="context-anchor"><button type="button" className="icon-button context-button" aria-label="Inspect context usage" aria-expanded={contextOpen} onClick={()=>setContextOpen(value=>!value)}><SlidersHorizontal size={15}/></button>{contextOpen&&<ContextInspector usage={thread?snapshot.usage[thread.id]:undefined} thread={thread} close={()=>setContextOpen(false)} refresh={refresh}/>}</span>}
        trailing={working?<>{/^\/(?:btw|side)(?:\s|$)/i.test(draft.trim())&&<button type="button" className="send-button" aria-label="Send side question" disabled={busy||!ready} onClick={()=>void send()}><ArrowUp size={17}/></button>}<button type="button" className="send-button stop-button" aria-label="Stop agent" onClick={()=>{void command('run.stop',{},thread!.id).then(()=>refresh()).catch(error=>setError(messageOf(error)));}}><CircleStop size={20}/></button></>:<button className="send-button" aria-label="Send message" disabled={busy||unavailable||!draft.trim()||!ready} title={unavailable?'Connect an available model in Settings to send.':'Send message (Enter)'}>{busy?<LoaderCircle size={17} className="spinning"/>:<ArrowUp size={19}/>}</button>}
      />
    </form>
    <div className="composer-caption">{unavailable ? <button onClick={setup}>Connect a model to start<ChevronRight size={12} /></button> : <span>Enter to send · Shift + Enter for a new line</span>}<span>Local workspace</span></div>
  </div>;
}

export function App() {
  const desktop=useDesktop(),desktopSurface=desktop?.context.surface,pinnedThreadId=desktopSurface?.kind==='thread'?desktopSurface.threadId:undefined,navigationOnly=desktopSurface?.kind==='navigation';
  const [detachingThread,setDetachingThread]=useState(false);
  useDesktopCloseGuard('composer-journal',()=>journalFlush());
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const snapshotRef = useRef(snapshot); snapshotRef.current = snapshot;
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(true);
  const [error, setError] = useState('');
  const [sideOpen,setSideOpen]=useState(false),sideChat=useRef<SideChatHandle>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelError, setModelError] = useState('');
  const [modelId, setModelId] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(() => { try { return pinnedThreadId??localStorage.getItem('harness:selected-thread'); } catch { return null; } });
  const liveMessages=useRef(new Set<string>());
  const liveEntries = useRef(new Set<string>()), entryThread = useRef(selectedId);
  if (entryThread.current !== selectedId) { liveEntries.current.clear();liveMessages.current.clear(); entryThread.current = selectedId; }
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 700px)').matches);
  useEffect(() => { const query = matchMedia('(max-width: 700px)'); const change = () => setMobile(query.matches); query.addEventListener('change', change); return () => query.removeEventListener('change', change); }, []);
  useModalRegion(sidebar, mobile && sidebarOpen, () => setSidebarOpen(false), 'input');
  const [focusedResource,setFocusedResource]=useState<string|undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState('general');
  const [layout, setLayout] = useShellLayout();
  const [documentWindow,setDocumentWindow]=useState<import('./workspace-context').OpenDocumentWindow|null>(null);
  useEffect(()=>setDocumentWindow(null),[selectedId]);
  const [planOpen,setPlanOpen]=useState(false),[planFocusOnOpen,setPlanFocusOnOpen]=useState(false),[planExpandRequest,setPlanExpandRequest]=useState(0);
  const [planVisibility]=useState(()=>createPlanVisibility());
  const preferences = getPreferences(snapshot.settings);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  useEffect(() => { const resize = () => setViewportWidth(window.innerWidth); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  const panelOverlay = viewportWidth - (layout.sidebarCollapsed || mobile ? 0 : layout.sidebarWidth) - layout.rightPanelWidth < 760;
  const panelWidth = layout.rightPanelMaximized ? Math.min(viewportWidth - 24, 1440) : Math.min(layout.rightPanelWidth, viewportWidth - 24);
  const closePanel = () => setLayout(value => ({ ...value, rightPanelOpen: false, rightPanelMaximized: false }));
  const workspaceContext = { activeArtifactId: layout.activeArtifactId, requestOpenArtifact: (id: string) => {setDocumentWindow(null);setLayout(value => ({ ...value, activeArtifactId: id || null, rightPanelOpen: true, activeTab: 'artifact' }));}, closeArtifact: () => setLayout(value => ({ ...value, activeArtifactId: null })), rightPanelOpen: layout.rightPanelOpen, activeTab: layout.activeTab, setActiveTab: (activeTab: typeof layout.activeTab) => setLayout(value => ({ ...value, activeTab })), documentWindow, requestOpenDocument:(id:string)=>{closePanel();setDocumentWindow({id,placement:'docked'});},closeDocument:(id:string)=>setDocumentWindow(value=>value?.id===id?null:value),placeDocument:(id:string,placement:'docked'|'floating')=>setDocumentWindow(value=>value?.id===id?{id,placement}:value) };
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const previousStatuses = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const before = previousStatuses.current;
    previousStatuses.current = new Map(snapshot.threads.map(item => [item.id, item.status]));
    if (!before) return;
    for (const item of snapshot.threads) {
      if (!before.has(item.id) || before.get(item.id) === item.status || !['completed', 'awaiting_input', 'failed'].includes(item.status)) continue;
      const message = item.title + ': ' + threadStatus(item);
      if (preferences.inAppNotifications && item.id !== selectedId) setNotice(message);
      if ((preferences.threadNotifications === 'notifications' || preferences.threadNotifications === 'both') && 'Notification' in window && Notification.permission === 'granted') new Notification('Generative Harness', { body: message });
      if (preferences.threadNotifications === 'sound' || preferences.threadNotifications === 'both') { try { const audio = new AudioContext(); const oscillator = audio.createOscillator(); const gain = audio.createGain(); oscillator.connect(gain); gain.connect(audio.destination); gain.gain.setValueAtTime(.025, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .16); oscillator.frequency.value = 660; oscillator.start(); oscillator.stop(audio.currentTime + .16); oscillator.onended = () => { void audio.close(); }; } catch { /* Sound may be blocked until this browser receives a user gesture. */ } }
    }
  }, [snapshot.threads, preferences.inAppNotifications, preferences.threadNotifications, selectedId]);
  const [resourcePicker, setResourcePicker] = useState<string | null>(null);
  const [composerBusy, setComposerBusy] = useState(false);
  const composerPending = useRef(false);
  const [threadCreating, setThreadCreating] = useState(false);
  const creationPending = useRef<Promise<string> | null>(null);
  const runComposerAction = async (action: () => Promise<void>) => {
    if (composerPending.current || creationPending.current) return;
    composerPending.current = true; setComposerBusy(true);
    try { await action(); } finally { composerPending.current = false; setComposerBusy(false); }
  };
  const [dirtyWidgets, setDirtyWidgets] = useState<Record<string, string>>({});
  const [archiveThread, setArchiveThread] = useState<string | null>(null);
  const onDirtyWidget = useCallback((id: string, threadId: string, dirty: boolean) => setDirtyWidgets(previous => { if (dirty && previous[id] === threadId || !dirty && !Object.hasOwn(previous, id)) return previous; const next = { ...previous }; if (dirty) next[id] = threadId; else delete next[id]; return next; }), []);
  useEffect(() => {
    if (!Object.keys(dirtyWidgets).length) return;
    const retain = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', retain); return () => window.removeEventListener('beforeunload', retain);
  }, [dirtyWidgets]);
  const [threadMenu, setThreadMenu] = useState(false);
  const [rename, setRename] = useState(false);
  const [title, setTitle] = useState('');
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const refreshPending = useRef<Promise<void> | null>(null);
  const refreshAgain = useRef(false);
  const apply = useCallback((value: Snapshot) => { if (value.seq >= snapshotRef.current.seq) {
    const previous = snapshotRef.current;
    if (previous.seq > 0) {
      const known = new Set(previous.artifacts.map(artifact => artifact.id));
      const messages=new Set(previous.messages.map(message=>message.id));for(const message of value.messages)if(message.role==='assistant'&&!messages.has(message.id)&&message.threadId===(entryThread.current??value.activeThreadId))liveMessages.current.add(message.id);
      for (const artifact of value.artifacts) if (!known.has(artifact.id) && artifact.threadId === (entryThread.current ?? value.activeThreadId)) liveEntries.current.add(artifact.id);
    }
    snapshotRef.current = value; setSnapshot(value);
  } }, []);
  const refresh = useCallback(async (value?: Snapshot): Promise<void> => {
    if (value) { apply(value); return; }
    if (refreshPending.current) { refreshAgain.current = true; return refreshPending.current; }
    refreshPending.current = (async () => { do { refreshAgain.current = false; apply(await getSnapshot()); } while (refreshAgain.current); })();
    try { await refreshPending.current; } finally { refreshPending.current = null; }
  }, [apply]);
  const loadModels = useCallback(async (refresh = false) => { try { const result = await getModels(refresh); setModels(result.models); setModelError(result.error ?? ''); setModelId(previous => previous && result.models.some(item => item.id === previous) ? previous : snapshotRef.current.settings.modelId ?? result.models[0]?.id ?? ''); } catch (error) { setModelError(messageOf(error)); } }, []);
  const acceptedModel = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const saved = snapshot.settings.modelId;
    if (!loaded || acceptedModel.current === saved || saved && !models.some(model => model.id === saved)) return;
    acceptedModel.current = saved;
    if (saved) setModelId(saved);
  }, [loaded, models, snapshot.settings.modelId]);
  useEffect(() => { let active = true; void bootstrap().then(async () => { await refresh(); if (active) { setLoaded(true); setError(''); } await loadModels(); }).catch(error => { if (active) setError(messageOf(error)); }); return () => { active = false; }; }, [refresh, loadModels]);
  useEffect(() => { if (!loaded) return; return subscribe(snapshotRef.current.seq, () => { void refresh().catch(error => setError(messageOf(error))); }, setOnline, refresh); }, [loaded, refresh]);
  useEffect(() => { const query = matchMedia('(prefers-color-scheme: dark)'); const change = () => setSystemDark(query.matches); query.addEventListener('change', change); return () => query.removeEventListener('change', change); }, []);
  const theme = snapshot.settings.theme === 'system' ? systemDark ? 'dark' : 'light' : snapshot.settings.theme;
  useLayoutEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useDesktopReady(loaded);
  const thread = snapshot.threads.find(item => item.id === selectedId) ?? (pinnedThreadId?undefined:snapshot.threads.find(item => item.id === snapshot.activeThreadId));
  const selectedPlan=useMemo(()=>selectPlanRecord(snapshot,thread?.id),[snapshot.data,thread?.id]);
  const planOwner=useRef<{id?:string;run:string|null|undefined}>({id:undefined,run:undefined});
  useEffect(()=>{const before=planOwner.current;planOwner.current={id:thread?.id,run:thread?.runId};const appeared=planVisibility.observe(thread,selectedPlan);if(before.id!==thread?.id||thread?.runId&&before.run!==thread.runId)setPlanOpen(planVisibility.isOpen(thread?.id));if(appeared){setPlanFocusOnOpen(false);setPlanExpandRequest(value=>value+1);setPlanOpen(true);}},[thread?.id,thread?.runId,selectedPlan]);
  const dismissPlan=()=>{planVisibility.dismiss(thread);if(planFocusOnOpen)document.querySelector<HTMLButtonElement>('.thread-menu-wrap>button')?.focus({preventScroll:true});setPlanOpen(false);};
  const showPlan=()=>{planVisibility.show(thread);setPlanFocusOnOpen(true);setPlanExpandRequest(value=>value+1);setPlanOpen(true);setThreadMenu(false);requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>('[data-floating-id="plan"] .floating-window-move')?.focus({preventScroll:true}));};
  const conversation = useRef<HTMLDivElement>(null);
  const readingPositions = useRef(new Map<string, { top: number; tail: boolean }>());
  const previousConversation = useRef('');
  const previousUpdate = useRef('');
  const [latestAvailable, setLatestAvailable] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [historyCounts, setHistoryCounts] = useState<Record<string, number>>({});
  const historyStarts = useRef(new Map<string, number>());
  const historyAnchor = useRef<{ height: number; top: number } | null>(null);
  const select = (id: string | null) => { if(desktop&&id&&(navigationOnly||pinnedThreadId&&id!==pinnedThreadId)){void desktop.detachSurface({kind:'thread',threadId:id}).catch(cause=>setError(messageOf(cause)));return;}  setSelectedId(id); setSidebarOpen(false); setThreadMenu(false); try { if (id) localStorage.setItem('harness:selected-thread', id); else localStorage.removeItem('harness:selected-thread'); } catch { /* Selection still works when storage is unavailable. */ } };
  const createThread = (prepare?: PrepareThread): Promise<string> => {
    if (creationPending.current) return creationPending.current;
    setThreadCreating(true);
    const before = new Set(snapshotRef.current.threads.map(item => item.id));
    creationPending.current = (async () => {
      const receipt = await command('thread.create', {});
      const result = receipt.result as { id?: string; threadId?: string; thread?: { id?: string } } | null;
      const id = result?.id ?? result?.threadId ?? result?.thread?.id ?? (await getSnapshot()).threads.find(item => !before.has(item.id))?.id;
      if (!id) throw new Error('The new thread was not returned by the host.');
      // Migrate before publishing the thread: its keyed composer must recover the
      // newest draft, and pending actions remain guarded across that remount.
      await prepare?.(id);
      await refresh();
      select(id); return id;
    })().finally(() => { creationPending.current = null; setThreadCreating(false); });
    return creationPending.current;
  };
  const ensureThread = async (prepare: PrepareThread) => {
    if (!thread) return createThread(prepare);
    await prepare(thread.id); return thread.id;
  };
  const newThreadRef = useRef(createThread); newThreadRef.current = createThread;
  useEffect(() => { const key = (event: KeyboardEvent) => {
    if (event.defaultPrevented || document.querySelector('dialog[open]')) return;
    if (matchesShortcut(event, preferences.keybindings.search)) { event.preventDefault(); setSidebarOpen(true); setLayout(value => ({ ...value, sidebarCollapsed: false })); requestAnimationFrame(() => searchRef.current?.focus()); }
    else if (matchesShortcut(event, preferences.keybindings.newThread)) { event.preventDefault(); if (!composerPending.current) void newThreadRef.current().catch(error => setError(messageOf(error))); }
    else if (matchesShortcut(event, preferences.keybindings.toggleSidebar)) { event.preventDefault(); if (mobile) setSidebarOpen(value => !value); else setLayout(value => ({ ...value, sidebarCollapsed: !value.sidebarCollapsed })); }
    else if (matchesShortcut(event, preferences.keybindings.toggleRightPanel)) { event.preventDefault(); setLayout(value => ({ ...value, rightPanelOpen: !value.rightPanelOpen })); }
    else if (matchesShortcut(event, preferences.keybindings.openSettings)) { event.preventDefault(); setSettingsSection('general'); setSettingsOpen(true); }
    else if (matchesShortcut(event, preferences.keybindings.stop) && (snapshotRef.current.threads.find(item => item.id === (selectedId ?? snapshotRef.current.activeThreadId))?.runId)) { event.preventDefault(); void command('run.stop', {}, (selectedId ?? snapshotRef.current.activeThreadId)!).then(() => refresh()).catch(error => setError(messageOf(error))); }
    if (event.key === 'Escape') { setSidebarOpen(false); setThreadMenu(false); }
  }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [preferences.keybindings.search, preferences.keybindings.newThread, preferences.keybindings.toggleSidebar, preferences.keybindings.toggleRightPanel, preferences.keybindings.openSettings, preferences.keybindings.stop, selectedId, mobile, refresh]);
  const conversationMotion=useRef<ReturnType<typeof createConversationScroll>|null>(null);
  useEffect(()=>()=>conversationMotion.current?.dispose(),[]);
  const messages = snapshot.messages.filter(item => item.threadId === thread?.id);
  const artifacts = snapshot.artifacts.filter(item => item.threadId === thread?.id && item.lifecycle === 'active');
  const requests = snapshot.requests.filter(item => item.threadId === thread?.id && item.status === 'pending');
  const operations = snapshot.operations.filter(item => item.threadId === thread?.id);
  useLayoutEffect(() => {
    const element = conversation.current;
    if (!element || !loaded) return;
    conversationMotion.current??=createConversationScroll(element);
    const id = thread?.id ?? 'new';
    const position = readingPositions.current.get(id) ?? { top: 0, tail: true };
    const changedThread = previousConversation.current !== id;
    const update = JSON.stringify([messages.length, messages.at(-1)?.id, messages.at(-1)?.content, requests.map(item => [item.id, item.revision]), thread?.status]);
    conversationMotion.current.update(id,position,historyAnchor.current??undefined);
    historyAnchor.current=null;
    if (!changedThread && previousUpdate.current !== update) { setAnnouncement('New conversation updates available.'); if (!position.tail) setLatestAvailable(true); }
    if (changedThread) { setLatestAvailable(!position.tail); setAnnouncement(''); }
    previousConversation.current = id; previousUpdate.current = update;
  }, [thread?.id, snapshot, loaded, historyCounts]);
  const rememberPosition = () => {
    const position=conversationMotion.current?.remember();if(!position)return;
    readingPositions.current.set(thread?.id??'new',position);
    setLatestAvailable(!position.tail);
  };
  const archive = async (id: string, discard = false, confirmed = false) => {
    if (!discard && Object.values(dirtyWidgets).includes(id)) { setArchiveThread(id); setThreadMenu(false); return; }
    if (!discard && !confirmed && preferences.archiveConfirmation) { setConfirmArchive(id); setThreadMenu(false); return; }
    try { await command('thread.archive', {}, id); setDirtyWidgets(previous => Object.fromEntries(Object.entries(previous).filter(([, threadId]) => threadId !== id))); setArchiveThread(null); select(null); await refresh(); } catch (error) { setError(messageOf(error)); }
  };
  const matching = snapshot.threads.filter(item => !item.sideParentId&&`${item.title} ${item.projectName ?? ''} ${snapshot.messages.filter(message => message.threadId === item.id).map(message => message.content).join(' ')}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).toSorted((a, b) => preferences.projectOrder === 'manual' ? (a.presentation?.order ?? 0) - (b.presentation?.order ?? 0) || b.updatedAt.localeCompare(a.updatedAt) : b.updatedAt.localeCompare(a.updatedAt));
  const projects = [...new Set(matching.map(item => item.projectName ?? 'Conversations'))];
  const updateModel = (id: string) => { setModelId(id); void command('settings.update', { modelId: id }).then(() => refresh()).catch(error => setError(messageOf(error))); };
  const changeTheme = (value: 'light' | 'dark' | 'system') => { void command('settings.update', { theme: value }).then(() => refresh()).catch(error => setError(messageOf(error))); };
  const detachedPlan=useDetachedSurface(thread?{kind:'plan',threadId:thread.id}:null),detachedThread=useDetachedSurface(thread?{kind:'thread',threadId:thread.id}:null),detachedNavigation=useDetachedSurface({kind:'navigation'});
  const pendingThread=usePendingSurface(thread?{kind:'thread',threadId:thread.id}:null);
  const threadHeld=Boolean(detachedThread||detachingThread||pendingThread||desktop?.closing);
  useEffect(()=>{const target=desktop?.state.focusSurface;if(!target)return;if('threadId'in target&&target.threadId&&!pinnedThreadId)setSelectedId(target.threadId);if(target.kind==='plan')setPlanOpen(true);if(target.kind==='workspace')setLayout(value=>({...value,rightPanelOpen:true,activeTab:target.tab==='launcher'?'artifact':target.tab??'artifact'}));},[desktop?.state.focusSurface]);
  const interfaceFont = preferences.interfaceFont === 'system' ? '-apple-system, BlinkMacSystemFont, "Inter Variable", "Segoe UI", system-ui, sans-serif' : preferences.interfaceFont === 'Inter' ? '"Inter Variable", sans-serif' : preferences.interfaceFont;
  const promptFont = preferences.promptFont === 'system' ? 'inherit' : preferences.promptFont;
  const shellStyle = { '--sidebar-width': layout.sidebarWidth + 'px', '--right-panel-width': panelWidth + 'px', '--panel-motion': (preferences.panelAnimations ? preferences.motionDuration : 0) + 'ms', '--prompt-font': promptFont, '--code-font': preferences.codeFont, '--interface-font': interfaceFont, '--interface-font-size': preferences.fontSize + 'px' } as CSSProperties;
  if(loaded&&pinnedThreadId&&!thread)return <main className="desktop-surface"><DesktopWindowActions/><p role="alert">The owning conversation is no longer available. Dock this window to choose another task.</p></main>;
  return <WorkspaceProvider value={workspaceContext}><div className={`app-shell ${navigationOnly?'desktop-navigation-only':''} ${pinnedThreadId?'desktop-thread-only':''} ${layout.rightPanelOpen ? 'has-right-panel' : ''} ${panelOverlay ? 'right-panel-overlay' : ''}`} inert={desktop?.closing} style={shellStyle} data-document-docked={documentWindow?.placement==='docked'} data-sidebar-collapsed={layout.sidebarCollapsed} data-chat-width={preferences.chatWidth} data-contrast={preferences.contrast} data-word-wrap={preferences.wordWrap} data-panel-animations={preferences.panelAnimations} data-live-usage={preferences.showUsageFooter}>
    {sidebarOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
    {!pinnedThreadId&&!detachedNavigation&&<ShellSidebar elementRef={sidebar} searchRef={searchRef} mobile={mobile} open={sidebarOpen} layout={layout} preferences={preferences} matching={matching} selectedId={thread?.id} loaded={loaded} creating={composerBusy || threadCreating} search={search} setSearch={setSearch} close={() => setSidebarOpen(false)} toggleCollapsed={() => navigationOnly?void desktop?.bridge.reattach():setLayout(value => ({ ...value, sidebarCollapsed: !value.sidebarCollapsed }))} setFolded={(key, folded) => setLayout(value => ({ ...value, folded: { ...value.folded, [key]: folded } }))} select={select} create={() => void createThread().catch(error => setError(messageOf(error)))} settings={() => { setSettingsSection('general'); setSettingsOpen(true); }} rename={item => { select(item.id); setTitle(item.title); setRename(true); }} archive={id => void archive(id)} detachNavigation={desktop?()=>{void desktop.detachSurface({kind:'navigation'}).catch(cause=>setError(messageOf(cause)));}:undefined} detachThread={desktop?item=>{void desktop.detachSurface({kind:'thread',threadId:item.id}).catch(cause=>setError(messageOf(cause)));}:undefined} presentation={(item, patch) => { if (patch.pinned === false && preferences.unpinConfirmation && !window.confirm('Unpin this thread?')) return; void command('thread.presentation', patch, item.id).then(() => refresh()).catch(error => setError(messageOf(error))); }} />}
    {!navigationOnly&&!pinnedThreadId&&!detachedNavigation&&!mobile && !layout.sidebarCollapsed && <ResizeHandle label="Resize sidebar" value={layout.sidebarWidth} minimum={200} maximum={380} side="left" change={sidebarWidth => setLayout(value => ({ ...value, sidebarWidth }))} />}
    {!navigationOnly&&<div className="shell-workarea">
    <main className="workspace"><header className="workspace-header"><button className="icon-button desktop-sidebar-toggle" aria-label="Toggle sidebar" aria-expanded={!layout.sidebarCollapsed} onClick={() => setLayout(value => ({ ...value, sidebarCollapsed: !value.sidebarCollapsed }))}><PanelLeftClose size={17} /></button><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}><Menu size={18} /></button><div className="breadcrumb">{thread?.projectName && <><Folder size={13} /><span>{thread.projectName}</span><span className="breadcrumb-slash">/</span></>}<strong>{thread?.title ?? 'New conversation'}</strong></div><div className="header-actions"><DesktopWindowActions/>{desktop&&thread&&<DetachButton surface={{kind:'thread',threadId:thread.id}} label="chat" before={async()=>{setDetachingThread(true);try{await desktop.prepareHandoff();}catch(cause){setDetachingThread(false);throw cause;}}} after={()=>setDetachingThread(false)} onError={cause=>{setDetachingThread(false);setError(cause.message);}}/>}{thread&&!thread.sideParentId&&<button className="icon-button" aria-label="Open side conversation" title="Side question (/btw)" aria-expanded={sideOpen} onClick={()=>setSideOpen(value=>!value)}><MessageSquare size={16}/></button>}{preferences.showThreadDetails && thread && <span className="header-thread-status">{threadStatus(thread)}</span>}<button className="icon-button" aria-label={layout.rightPanelOpen ? 'Hide workspace panel' : 'Open workspace panel'} onClick={() => setLayout(value => ({ ...value, rightPanelOpen: !value.rightPanelOpen }))}><SlidersHorizontal size={16} /></button>{!online && <span className="connection-state" title="Reconnecting to host events"><WifiOff size={13} />Reconnecting</span>}{thread && <div className="thread-menu-wrap"><button className="icon-button" aria-label="Thread options" aria-expanded={threadMenu} onClick={() => setThreadMenu(value => !value)}><MoreHorizontal size={18} /></button>{threadMenu && <div className="thread-menu"><button onClick={showPlan}><ChevronRight size={14} />Show plan</button><button onClick={() => { setTitle(thread.title); setRename(true); setThreadMenu(false); }}><PenLine size={14} />Rename thread</button><button onClick={() => { void archive(thread.id); setThreadMenu(false); }}><Archive size={14} />Archive thread</button></div>}</div>}</div></header>
      {error && <div className="workspace-error" role="alert">{error}<button className="quiet" onClick={() => { setError(''); void bootstrap().then(() => refresh()).then(() => { setLoaded(true); return loadModels(); }).catch(error => setError(messageOf(error))); }}>Retry</button><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={15} /></button></div>}
      {Object.values(dirtyWidgets).some(id => id !== thread?.id) && <div className="workspace-error retained-widget-notice"><span>Widget edits are kept open in another thread.</span><button className="quiet" onClick={() => setDirtyWidgets(previous => Object.fromEntries(Object.entries(previous).filter(([, id]) => id === thread?.id)))}>Discard hidden widget edits</button></div>}
      {detachedThread&&<div className="notice">This conversation is open in another window.<button className="quiet" onClick={()=>void desktop?.bridge.focus(detachedThread.id)}>Focus chat</button></div>}<div inert={threadHeld} ref={conversation} className="conversation-scroll" onScroll={rememberPosition} aria-label="Conversation" tabIndex={0}>{[thread, ...snapshot.threads.filter(item => item.id !== thread?.id && Object.values(dirtyWidgets).includes(item.id))].toSorted((a, b) => (a?.createdAt ?? '').localeCompare(b?.createdAt ?? '') || (a?.id ?? '').localeCompare(b?.id ?? '')).map(panelThread => {
        const thread = panelThread;
        const messages = snapshot.messages.filter(item => item.threadId === thread?.id);
        const artifacts = snapshot.artifacts.filter(item => item.threadId === thread?.id && item.lifecycle === 'active');
        const requests = snapshot.requests.filter(item => item.threadId === thread?.id && item.status === 'pending');
        const operations = snapshot.operations.filter(item => item.threadId === thread?.id);
        const historyId = thread?.id ?? 'new';
        const historyStart = historyStarts.current.get(historyId) ?? Math.max(0, messages.length - 100);
        historyStarts.current.set(historyId, historyStart);
        const artifactMessageIds = new Set(artifacts.map(artifact => artifact.messageId));
        const visibleMessageIds = new Set(messages.slice(historyStart).map(message => message.id));
        // Group before paging to keep each run's full history and stable first-message key.
        const messageRows = groupWorkActivity(messages, artifactMessageIds).filter(({ message, updates }) => artifactMessageIds.has(message.id) || (updates ?? [message]).some(update => visibleMessageIds.has(update.id)));
        return <div key={thread?.id ?? 'new'} hidden={thread?.id !== (snapshot.threads.find(item => item.id === selectedId) ?? snapshot.threads.find(item => item.id === snapshot.activeThreadId))?.id}><div className={`conversation ${!messages.length && !artifacts.length ? 'conversation-empty' : ''}`}>
        {!loaded && !error && <div className="loading-state" role="status"><LoaderCircle size={18} className="spinning" />Opening your workspace…</div>}
        {loaded && !messages.length && !artifacts.length && <div className="empty-state"><div className="empty-symbol"><MessageSquare size={25} strokeWidth={1.25} /></div><h1>What are we working on?</h1><p>Start with a question, a file, or a project.<br />Your conversation becomes the workspace.</p>{!models.length && <button className="setup-inline" onClick={() => { setSettingsSection('providers'); setSettingsOpen(true); }}><CircleHelp size={15} /><span>Connect a model to get started</span><ChevronRight size={14} /></button>}</div>}
        {historyStart > 0 && <button className="load-history quiet" onClick={() => { if (conversation.current) historyAnchor.current = { height: conversation.current.scrollHeight, top: conversation.current.scrollTop }; historyStarts.current.set(historyId, Math.max(0, historyStart - 100)); setHistoryCounts(previous => ({ ...previous, [historyId]: (previous[historyId] ?? 0) + 1 })); }}>Load earlier messages</button>}
        {messageRows.map(({ message, updates }) => <div key={message.id} className={`message message-${message.role}`}><div className="message-content">{updates ? <WorkActivity updates={updates} /> : message.role==='assistant'?<AssistantProse message={message} arrivals={liveMessages.current} active={Boolean(thread?.runId&&thread.runId===message.runId)} />:<Markdown text={message.content} />}</div>{artifacts.filter(artifact => artifact.messageId === message.id).map(artifact => <Artifact key={artifact.id} artifact={artifact} snapshot={snapshot} theme={theme} refresh={refresh} onDirtyWidget={onDirtyWidget} suspended={threadHeld} active={thread?.id===(snapshot.threads.find(item=>item.id===selectedId)??snapshot.threads.find(item=>item.id===snapshot.activeThreadId))?.id} animateEntry={liveEntries.current.has(artifact.id)} />)}</div>)}
        {artifacts.filter(artifact => !messages.some(message => message.id === artifact.messageId)).map(artifact => <Artifact key={artifact.id} artifact={artifact} snapshot={snapshot} theme={theme} refresh={refresh} onDirtyWidget={onDirtyWidget} suspended={threadHeld} active={thread?.id===(snapshot.threads.find(item=>item.id===selectedId)??snapshot.threads.find(item=>item.id===snapshot.activeThreadId))?.id} animateEntry={liveEntries.current.has(artifact.id)} />)}
        {requests.map(request => <InputDecision key={request.presentation?`${request.id}:${JSON.stringify(request.responseSchema)}`:`${request.id}:${request.revision}`} request={request} snapshot={snapshot} refresh={refresh} />)}{operations.map(operation => <OperationDecision key={`${operation.id}:${operation.revision}`} operation={operation} refresh={refresh} />)}
        {thread?.error && <p className="notice" role="alert">{thread.error}</p>}
        {thread && ['stopped', 'interrupted', 'failed'].includes(thread.status) && <div className="resume-row"><span>{thread.status === 'interrupted' ? 'This session was interrupted.' : thread.status === 'stopped' ? 'Agent stopped. Your work is saved.' : 'The agent could not finish this run.'}</span><button className="secondary" disabled={!modelId} title={!modelId ? 'Choose an available model before resuming.' : undefined} onClick={() => void journalRead<string>('thinking:'+thread.id).then(level=>command('run.resume', {modelId,thinkingLevel:level===undefined?(thread.thinkingLevel??null):(level||null)}, thread.id)).then(() => refresh()).catch(error => setError(messageOf(error)))}>Resume<ChevronRight size={13} /></button></div>}
        {thread && (thread.runId || thread.status === 'working') && <div className="working-status" role="status"><LoaderCircle size={13} className="spinning" /><span>{snapshot.usage[thread.id]?.activity === 'compacting' ? 'Compacting context…' : 'Working…'}</span><button className="quiet" onClick={() => void command('run.stop', {}, thread.id).then(() => refresh()).catch(error => setError(messageOf(error)))}>Stop</button></div>}
      </div></div>; })}</div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
      {latestAvailable && <button className="jump-latest secondary" onClick={() => { const position=conversationMotion.current?.jump();if(position)readingPositions.current.set(thread?.id??'new',position);setLatestAvailable(false); }}>Jump to latest<ArrowUp size={13} /></button>}
      <div style={{display:'contents'}} inert={threadHeld}>{loaded ? <Composer key={thread?.id ?? 'new'} thread={thread} models={models} modelId={modelId} setModelId={updateModel} modelError={modelError} snapshot={snapshot} ensureThread={ensureThread} busy={composerBusy || threadCreating} runAction={runComposerAction} refresh={refresh} setup={() => { setSettingsSection('providers'); setSettingsOpen(true); }} openResource={setResourcePicker} browseProject={id=>{setFocusedResource(id);setLayout(value=>({...value,rightPanelOpen:true,activeTab:'files'}));}} inspectChanges={()=>setLayout(value=>({...value,rightPanelOpen:true,activeTab:'diff'}))} reportError={setError} onSide={async content=>{setSideOpen(true);if(!sideChat.current)throw new Error("The side conversation is still opening.");await sideChat.current.ask(content);}} /> : <div className="composer-dock" role="status"><span className="muted">Opening conversation…</span></div>}</div>
    </main>

    <FloatingRail plan={<FloatingWindow id="plan" title="Task plan" open={planOpen&&!detachedPlan} onDetach={desktop&&thread?()=>{void desktop.detachSurface({kind:'plan',threadId:thread.id}).catch(cause=>setError(messageOf(cause)));}:undefined} onClose={dismissPlan} anchor="top-right" defaultSize={{width:376,height:180}} minSize={{width:280,height:80}} sizing="content" focusOnOpen={planFocusOnOpen} expandRequest={planExpandRequest} resetPosition><PlanStatus key={thread?.id??'new'} snapshot={snapshot} threadId={thread?.id} /></FloatingWindow>} usage={<UsageFooter threadId={thread?.id} usage={thread?snapshot.usage[thread.id]:undefined} visible={preferences.showUsageFooter} />} />
    {layout.rightPanelOpen && <WorkspacePanel snapshot={snapshot} preferredResourceId={focusedResource} threadId={thread?.id} preferences={preferences} layout={layout} close={closePanel} setWidth={rightPanelWidth => setLayout(value => ({ ...value, rightPanelWidth }))} toggleMaximized={() => setLayout(value => ({ ...value, rightPanelMaximized: !value.rightPanelMaximized }))} />}
    {thread&&!thread.sideParentId&&<SideChat key={thread.id} ref={sideChat} parent={thread} snapshot={snapshot} modelId={modelId} open={sideOpen} onClose={()=>setSideOpen(false)} refresh={refresh}/>}
    <DesktopBrowserDock/>
    </div>}
    {notice && <div className="shell-notice" role="status"><span>{notice}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={14} /></button></div>}
    {confirmArchive && <Dialog title="Archive thread?" close={() => setConfirmArchive(null)}><p>The saved conversation will move to Archive in Settings. Restore it there whenever you need it.</p><footer className="dialog-actions"><button className="quiet" onClick={() => setConfirmArchive(null)}>Cancel</button><button className="primary" onClick={() => { const id = confirmArchive; setConfirmArchive(null); void archive(id, false, true); }}>Archive thread</button></footer></Dialog>}
    {archiveThread && <Dialog title="Uncheckpointed widget edits" close={() => setArchiveThread(null)}><p>Checkpoint your widget edits before archiving this thread, or explicitly discard them.</p><footer className="dialog-actions"><button className="secondary" onClick={() => { select(archiveThread); setArchiveThread(null); }}>Return to checkpoint</button><button className="quiet" onClick={() => void archive(archiveThread, true)}>Discard edits and archive</button></footer></Dialog>}
    {resourcePicker && <ResourcePicker threadId={resourcePicker} close={() => setResourcePicker(null)} refresh={refresh} />}
    {settingsOpen && <Settings initialSection={settingsSection} snapshot={snapshot} models={models} modelError={modelError} refresh={refresh} loadModels={loadModels} close={() => setSettingsOpen(false)} addResource={() => { setSettingsOpen(false); void ensureThread(async () => {}).then(setResourcePicker).catch(error => setError(messageOf(error))); }} />}
    {rename && thread && <Dialog title="Rename thread" close={() => setRename(false)}><form onSubmit={event => { event.preventDefault(); void command('thread.rename', { title: title.trim() }, thread.id).then(async () => { await refresh(); setRename(false); }).catch(error => setError(messageOf(error))); }}><label className="field">Thread name<input autoFocus required value={title} maxLength={180} onChange={event => setTitle(event.target.value)} /></label><footer className="dialog-actions"><button type="button" className="quiet" onClick={() => setRename(false)}>Cancel</button><button className="primary" disabled={!title.trim()}>Save name</button></footer></form></Dialog>}
  </div></WorkspaceProvider>;
}
