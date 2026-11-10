import { useCallback, useEffect, useLayoutEffect, useRef, useState, useMemo, useSyncExternalStore, type ComponentProps, type CSSProperties, type ReactNode } from 'react';
import { ArrowUp, Bot, Check, ChevronDown, ChevronRight, CircleHelp, CircleStop, Folder, Laptop, LoaderCircle, Menu, MessageSquare, PanelLeftOpen, PanelRight, PenLine, Plus, SlidersHorizontal, WifiOff, X } from 'lucide-react';
import type { InputRequest, ModelInfo, Operation, Snapshot, Thread,Message } from '../../../packages/contracts';
import { ApiError, bootstrap, command, getModels, getSnapshot, subscribe } from './api';
import { journalCompareAndSwap, journalGeneration, journalRead, journalReadRecord, journalSubscribe, journalWrite } from './journal';
import { Artifact } from './Artifact';
import { Markdown } from './Markdown';
import { groupWorkActivity, WorkActivity } from './WorkActivity';
import { display, schemaDefaults, SchemaFields } from './registry';
import { useModalRegion } from './focus';
import { validateSchema } from './schema-validator';
import { matchingThreads } from './thread-search';
import { hasPendingDocumentAssets } from './signature-assets';
import { getPreferences, mergePreferences } from '../../../packages/contracts/preferences';
import { ShellSidebar, threadStatus } from './ShellSidebar';
import { ProjectPicker } from './ProjectPicker';
import { projectColorKey } from './project-colors';
import { useShellLayout, matchesShortcut } from './shell-layout';
import {sameSplitWorkspaceView} from '../../../packages/core/split-workspace-layout';
import { ResizeHandle, WorkspacePanel } from './WorkspacePanel';
import { WorkspaceProvider } from './workspace-context';
import './shell.css';
import './connections.css';
import { ContextInspector } from './ContextInspector';
import {PlanningQuestion} from './PlanningQuestion';
import {UsageFooter} from './UsageFooter';
import {UsageDialog} from './UsageDialog';
import {runtimeUsageReport} from './usage-presentation';
import {DockedSummary,SummaryDock,SummaryLayout} from '../../../packages/ui-shell/SummaryDock';
import {workspacePanelBounds} from './panel-geometry';
import {createPlanVisibility,selectPlanRecord} from './plan-visibility';
import {ComposerToolbar,ComposerTaskActions} from './ComposerToolbar';
import {ComposerView} from './ComposerView';
import {LoadingState} from './LoadingState';
import {ComposerSkeleton, ConversationSkeleton, SettingsSkeleton, WorkspaceSkeleton} from './ViewSkeletons';
import {ComposerAttachments} from './ComposerAttachments';
import {Modal} from '../../../packages/ui-shell/Modal';
import {Select} from '../../../packages/ui-shell/Select';
import {PluginFrame,usePluginCatalog} from './PluginFrame';
import {recordedChangeSummary} from './composer-evidence';
import {useDesktop,useDesktopCloseGuard,useDesktopReady,useDetachedSurface,usePendingSurface} from './desktop-context';
import {DesktopBrowserDock} from './DesktopBrowser';
import {journalFlush} from './journal';
import {prepareEditorHandoff} from './editor-handoff';
import {SideChat,type SideChatHandle} from './SideChat';
import {createConversationScroll} from './conversation-scroll';
import {ChatScrollIndicator} from './ChatScrollIndicator';
import {useComposerPrediction} from './useComposerPrediction';
import {WorkspaceCanvas} from './WorkspaceCanvas';
import {DelegatedAgentTranscript} from './DelegatedAgentTranscript';
import {WorkspaceControls,panelLabels} from './WorkspaceControls';
import {WorkspaceHost,type ConversationHost} from './WorkspaceHost';
import type {SharedAgentComposers, ComposerState, ConversationComposerTarget} from './agents-workspace/composer';
import {ComposerCommands,ComposerSkillBindings,type ComposerCommandsHandle} from './ComposerCommands';
import type {ModelPickerHandle} from './ModelPicker';
import {useComposerSkills,skillDraftKey,readSkillBindings,clearAcceptedSkills} from './composer-skill-drafts';
import {useWorkspaceState} from './workspace-api';
import {liveThreadPanels,delegatedThread,threadParent,threadProject,findCanvasPanelBounds} from './workspace-canvas-layout';
import {panelDesktopSurface,panelsForDesktopSurface,panelNativeWindow} from './workspace-native';
import type {PanelBinding,PanelPlacement,WorkspacePanelKind,SurfaceRef} from '../../../packages/contracts/workspace.ts';
import type {SplitDropEdge} from '../../../packages/contracts/split-workspace.ts';
import {WorkspaceSplitLayout} from './WorkspaceSplitLayout';
import {getSplitWorkspace,sendSplitWorkspaceCommand,useSplitWorkspaceState} from './split-workspace-api';
import {useSplitWorkspaceProfiles,useSplitLayoutProfileActions} from './split-workspace-profiles';
import {threadPlacementCommand,threadReconciliationCommand} from './split-thread-placement';
import {toolPlacementCommand} from './split-tool-placement';
import {useAppearance} from './useAppearance';
import {EnvironmentSettings} from './EnvironmentSettings';
import {PlanStatus} from './PlanStatus';
import './workspace-integration.css';
import {AgentInbox} from './AgentInbox';
import {WorkspaceSurfaceBody} from './WorkspaceSurfaceBody';
import {ProjectContextSurface} from './ProjectContextSurface';
import {DesktopBrowserSlot,DesktopBrowserToolbar} from './DesktopBrowser';

type SettingsComponent = typeof import('./Settings').Settings;
let loadedSettings: SettingsComponent | undefined;

const emptySnapshot: Snapshot = { seq: 0, threads: [], messages: [], artifacts: [], userStates: [], data: [], requests: [], operations: [], resources: [], usage: {}, settings: { theme: 'dark', modelId: null }, activeThreadId: null };
const hasPinnedAccount = (thread: Thread | undefined, snapshot: Snapshot) => Boolean(thread && (thread.accountId !== undefined || thread.modelId || thread.sessionPath || thread.runId || thread.epoch > 0 || snapshot.messages.some(message => message.threadId === thread.id)));
const messageOf = (error: unknown) => error instanceof Error ? error.message : 'The request could not be completed.';

function Dialog({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  return <Modal open title={title} onClose={close} className="dialog">{children}</Modal>;
}

function SettingsWindow(props: ComponentProps<SettingsComponent>) {
  const desktop = useDesktop();
  const opener = useRef(document.activeElement as HTMLElement | null);
  const [Settings, setSettings] = useState(() => loadedSettings);
  const [error, setError] = useState(''), [reloading, setReloading] = useState(false);
  useEffect(() => () => { if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    if (Settings) return;
    let active = true;
    void import('./Settings').then(module => { loadedSettings = module.Settings; if (active) setSettings(() => module.Settings); }).catch(() => { if (active) setError('Settings could not load. Try again or close this window.'); });
    return () => { active = false; };
  }, [Settings]);
  const reload = async () => {
    setReloading(true);
    try {
      if (props.snapshot.threads.some(thread => hasPendingDocumentAssets(thread.id))) { setError('Wait for the signature mark to finish saving, or clear it before reloading.'); return; }
      await desktop?.prepareHandoff(); await journalFlush(); window.location.reload();
    } catch (cause) { setError(`Drafts could not be saved. ${messageOf(cause)} Keep this window open and retry.`); }
    finally { setReloading(false); }
  };
  return <Modal open title="Settings" onClose={props.close} className="settings-dialog">{Settings ? <Settings {...props} /> : <>{error ? <><p role="alert">{error}</p><button className="primary" disabled={reloading} onClick={() => void reload()}>Reload to retry</button></> : <LoadingState pending hasContent={false} label="Opening settings…" skeleton={<SettingsSkeleton/>} className="view-loading-state"/>}</>}</Modal>;
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
      if (!withdraw && !validateSchema(request.responseSchema, response, false)) throw new Error('The response does not match the requested schema. Check the required fields and values.');
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

function ResourcePicker({ threadId, close, refresh, opener }: { threadId: string; close: () => void; refresh: () => Promise<void>; opener: HTMLElement | null }) {
  useEffect(() => () => { requestAnimationFrame(() => { if (opener?.isConnected) opener.focus({ preventScroll: true }); }); }, [opener]);
  const [path, setPath] = useState('');
  const [kind, setKind] = useState('project');
  const [writable, setWritable] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <Dialog title="Add a resource" close={close}><p className="muted">Choose a local file, project, or SQLite database for this thread. Access is scoped to the path you grant.</p><form onSubmit={event => { event.preventDefault(); setBusy(true); void command('resource.grant', { path, kind, writable }, threadId).then(async () => { await refresh(); close(); }).catch(error => setError(messageOf(error))).finally(() => setBusy(false)); }}><label className="field">Resource type<Select aria-label="Resource type" value={kind} onValueChange={setKind} options={[{value:"project",label:"Project folder"},{value:"file",label:"File"},{value:"database",label:"SQLite database"},{value:"export",label:"Export folder"}]}/></label><label className="field">Absolute local path<input autoFocus required value={path} onChange={event => setPath(event.target.value)} placeholder="C:\Users\you\Documents\project" /></label><label className="check-field"><input type="checkbox" checked={writable} onChange={event => setWritable(event.target.checked)} />Allow approved changes</label><p className="muted">Mutations still require approval for each prepared operation.</p>{error && <p role="alert" className="error-text">{error}</p>}<footer className="dialog-actions"><button type="button" className="quiet" onClick={close}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Granting…' : 'Add resource'}</button></footer></form></Dialog>;
}

type PrepareThread = (id: string) => Promise<unknown>;
const emptyComposerState: ComposerState = {draft: '', ready: false, busy: false, stopping: false, error: '', retry: false};
function Composer({ modelPickerRequest, onModelPickerOpened, sharedComposers, thread, models, modelId, setModelId, snapshot, ensureThread, busy: externalBusy, runAction, refresh, setup, openResource, inspectChanges, reportError,onSide, predictionBlocked, selectProject }: { modelPickerRequest?:number; onModelPickerOpened?:(request:number)=>void; sharedComposers?: SharedAgentComposers; selectProject?:(id:string|undefined,opener?:HTMLElement|null,prepare?:PrepareThread)=>void; predictionBlocked: boolean; thread: Thread | undefined; models: ModelInfo[]; modelId: string; setModelId: (id: string) => void; snapshot: Snapshot; ensureThread: (prepare: PrepareThread) => Promise<string>; busy: boolean; runAction: (action: () => Promise<void>) => Promise<void>; refresh: () => Promise<void>; setup: () => void; openResource: (id: string, opener?: HTMLElement | null) => void; browseProject:(id:string)=>void;inspectChanges:()=>void; reportError: (error: string) => void;onSide:(content:string)=>Promise<void> }) {
  const key = thread?.id ?? 'new';
  const draftTarget = useRef(key);
  const [localDraft, setDraft] = useState('');
  const working = Boolean(thread?.runId) || thread?.status === 'working';
  const sharedTarget = useMemo<ConversationComposerTarget | undefined>(() => thread ? {kind: 'conversation', threadId: thread.id, modelId, working} : undefined, [thread?.id, modelId, working]);
  const sharedState = useSyncExternalStore(useCallback(listener => sharedComposers && sharedTarget ? sharedComposers.subscribe(sharedTarget, listener) : () => {}, [sharedComposers, sharedTarget]), useCallback(() => sharedComposers && sharedTarget ? sharedComposers.getSnapshot(sharedTarget) : emptyComposerState, [sharedComposers, sharedTarget]));
  const shared = Boolean(sharedComposers && sharedTarget), draft = shared ? sharedState.draft : localDraft;
  const busy = externalBusy || shared && (sharedState.busy || sharedState.stopping);
  useEffect(() => {if (sharedComposers && sharedTarget) void sharedComposers.prepare(sharedTarget);}, [sharedComposers, sharedTarget]);
  const draftLatest=useRef(draft);draftLatest.current=draft;
  const [thinkingLevel,setThinkingLevel]=useState(thread?.thinkingLevel??'');const thinkingEdited=useRef(false),thinkingLatest=useRef(thinkingLevel);thinkingLatest.current=thinkingLevel;
  useEffect(()=>{let active=true;void journalRead<string>('thinking:'+key).then(value=>{if(active&&!thinkingEdited.current)setThinkingLevel(value??thread?.thinkingLevel??'');}).catch(()=>{});return()=>{active=false;};},[key]);
  const chooseThinking=(value:string)=>{thinkingEdited.current=true;setThinkingLevel(value);void journalWrite('thinking:'+draftTarget.current,value).catch(()=>{});};
  const [localReady, setReady] = useState(false);
  const ready = shared ? sharedState.ready : localReady;
  const [localError, setError] = useState('');
  const error = localError || (shared ? sharedState.error : '');
  const [contextOpen, setContextOpen] = useState(false);
  const contextAnchor = useRef<HTMLButtonElement>(null);
  const preferences = getPreferences(snapshot.settings);

  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null), commands = useRef<ComposerCommandsHandle>(null), modelPicker = useRef<ModelPickerHandle>(null), openedModelRequest = useRef<number | undefined>(undefined);
  const [skillOwner,setSkillOwner]=useState(key);
  const localSkills = useComposerSkills(skillOwner, !shared), skills = shared ? sharedState.skills ?? [] : localSkills.skills;
  const skillsReady = shared || localSkills.ready;
  const retry = shared && sharedState.retry, skillsBlocked = skills.length > 0 && !retry;
  const [draftMode,setDraftMode]=useState<'plan'|'build'>('build');
  useEffect(()=>{if(thread)return;let active=true;void journalRead<string>('mode:'+key).then(value=>{if(active)setDraftMode(value==='plan'?'plan':'build');}).catch(()=>{});return()=>{active=false;};},[key,thread?.id]);
  useEffect(()=>{if(modelPickerRequest===undefined||openedModelRequest.current===modelPickerRequest||!models.length||working||busy)return;openedModelRequest.current=modelPickerRequest;modelPicker.current?.open();onModelPickerOpened?.(modelPickerRequest);},[modelPickerRequest,models,working,busy,onModelPickerOpened]);
  const file = useRef<HTMLInputElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const resources = snapshot.resources.filter(item => item.threadId === thread?.id);
  const unavailable = !models.length || !models.some(model => model.id === modelId);
  const project=resources.find(resource=>resource.kind==='project');const changes=useMemo(()=>recordedChangeSummary(snapshot.data,thread?.id),[snapshot.data,thread?.id]);
  useEffect(()=>{const model=models.find(model=>model.id===modelId);if(model&&thinkingLevel&&!model.thinkingLevels?.includes(thinkingLevel))chooseThinking('');},[models,modelId,thinkingLevel]);
  useEffect(() => { if (shared) return; let current = true; void journalRead<string>(`draft:${key}`).then(value => { if (current) { setDraft(value ?? ''); setReady(true); } }).catch(() => { if (current) { setReady(true); setError('Draft recovery is unavailable. Keep this tab open until your message is sent.'); } }); return () => { current = false; }; }, [key, shared]);
  useEffect(() => shared ? undefined : journalSubscribe(`draft:${key}`, value => { if (draftTarget.current === key) { prediction.dismiss(); setDraft(typeof value === 'string' ? value : ''); } }), [key, shared]);
  const prediction = useComposerPrediction({ thread, snapshot, modelId, enabled: preferences.composerPredictions, ready, blocked: predictionBlocked || busy || unavailable || contextOpen, draft, generation: journalGeneration(`draft:${key}`), input });
  useLayoutEffect(() => {
    const textarea = input.current;
    if (!textarea) return;
    const resize = () => {
      textarea.style.height = 'auto';
      const limit = Number.parseFloat(getComputedStyle(textarea).maxHeight) || 220;
      const previewHeight = ghost.current?.scrollHeight ?? 0;
      // A whole-message preview must be fully visible before it can be accepted.
      if (previewHeight > limit) { if (ghost.current) ghost.current.hidden = true; prediction.dismiss(); }
      textarea.style.height = `${Math.min(limit, Math.max(textarea.scrollHeight, previewHeight > limit ? 0 : previewHeight))}px`;
    };
    resize(); const observer = new ResizeObserver(resize); observer.observe(textarea.parentElement!); if (ghost.current) observer.observe(ghost.current);
    return () => observer.disconnect();
  }, [draft, prediction.candidate, preferences.fontSize, preferences.promptFont]);
  const updateDraft = (value: string) => { prediction.dismiss(); draftLatest.current = value; setDraft(value); if (sharedComposers && sharedTarget) {void sharedComposers.edit(sharedTarget, value); return;} void journalWrite(`draft:${draftTarget.current}`, value).catch(() => setError('Draft could not be stored locally. Keep this tab open.')); };
  const acceptPrediction = () => {
    // Recheck synchronously if zoom, font loading or resize beats the observer.
    if (ghost.current && input.current && (ghost.current.hidden || ghost.current.scrollHeight > input.current.clientHeight)) { prediction.dismiss(); return false; }
    const value = prediction.take(); if (value === null) return false; updateDraft(value); requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(value.length, value.length); }); return true;
  };
  const migrateDraft = async (id: string, fallback = draft, retireSource = false) => {
    const source = id !== key ? await journalReadRecord<string>(`draft:${key}`) : undefined;
    // New keystrokes follow the copied draft while snapshot/selection is pending.
    draftTarget.current = id;setSkillOwner(id);
    if(id!==key){
      await journalWrite('thinking:'+id,thinkingLatest.current);
      const selected=await journalReadRecord(skillDraftKey(key));
      await journalWrite(skillDraftKey(id),readSkillBindings(selected?.value));
      if(retireSource&&selected)await journalCompareAndSwap(skillDraftKey(key),selected.generation,[]);
      if(!thread&&draftMode==='plan')await command('thread.mode',{mode:'plan'},id);
    }
    const generation = id !== key ? await journalWrite(`draft:${id}`, source?.value ?? fallback) : journalGeneration(`draft:${key}`);
    if (id !== key && retireSource && source) await journalCompareAndSwap(`draft:${key}`, source.generation, '');
    return { source, generation };
  };
  const send = async () => {
    if (busy || !skillsReady || skillsBlocked || !draft.trim() && !retry) return;
    const sideCommand=!retry&&/^\/(?:btw|side)(?:\s|$)/i.exec(draft.trim());
    if(sideCommand){
      if(!thread){setError('Start a main conversation before asking a side question.');return;}
      const generation=journalGeneration(`draft:${key}`);setError('');
      try{await onSide(draft.trim().slice(sideCommand[0].length).trim());await journalCompareAndSwap(`draft:${key}`,generation,'');}catch(cause){setError(messageOf(cause));}
      return;
    }
    if (working || unavailable) return;
    await runAction(async () => {
      setError('');
      const submittedDraft = draft, submittedSkills = skills.slice();
      const submittedGeneration = journalGeneration(`draft:${key}`);
      try {
        let migrated: Awaited<ReturnType<typeof migrateDraft>> | undefined;
        const id = await ensureThread(async id => { migrated = await migrateDraft(id, submittedDraft, true); });
        if (sharedComposers) {
          const target: ConversationComposerTarget = {kind: 'conversation', threadId: id, modelId, working: false};
          await sharedComposers.prepare(target); await sharedComposers.submit(target, {thinkingLevel: thinkingLatest.current || null,submission:{content:submittedDraft,generation:id===key?submittedGeneration:migrated&&migrated.source?.generation===submittedGeneration?migrated.generation:undefined,skills:submittedSkills}});
          await refresh(); return;
        }
        await command('message.send', { content: submittedDraft.trim(), modelId, thinkingLevel:thinkingLevel||null, ...(submittedSkills.length?{skills:submittedSkills.map(binding=>binding.ref)}:{}) }, id);
        await clearAcceptedSkills(skillDraftKey(id),submittedSkills);
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
  const addResource = () => {
    const opener = document.activeElement as HTMLElement | null;
    return runAction(async () => {
      try { const id = await ensureThread(id => migrateDraft(id, draft, true)); openResource(id, opener); }
      catch (error) { reportError(messageOf(error)); }
    });
  };
  const chooseMode=async(mode:'plan'|'build')=>{
    if(working||busy)throw Error('Wait for the active run to finish to change mode.');
    if(!thread){await journalWrite('mode:'+key,mode);setDraftMode(mode);return;}
    await command('thread.mode',{mode},thread.id);await refresh();
  };
  const preparePR=()=>{const intent='Create a pull request for the current changes.';const current=draftLatest.current;updateDraft(current.startsWith(intent)?current:intent+(current.trim()?'\n\n'+current:''));input.current?.focus();};
  return <div className="composer-dock">
    {localSkills.error&&!shared&&<p role="alert" className="composer-error">{localSkills.error}</p>}
    {error && <div className="composer-error" role="alert">{error}<button className="icon-button" aria-label="Dismiss composer error" onClick={() => setError('')}><X size={14} /></button></div>}
    <ComposerView className={dragging ? 'dragging' : ''} onSubmit={event => { event.preventDefault(); void send(); }} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); if (event.dataTransfer.files.length) void upload(event.dataTransfer.files); }}>
      <ComposerAttachments resources={resources}/>
      <ComposerSkillBindings bindings={skills} retry={retry} onRemove={id=>{void (sharedComposers&&sharedTarget?sharedComposers.removeSkill(sharedTarget,id):localSkills.remove(id)).catch(cause=>setError(messageOf(cause)));}}/>
      <ComposerCommands ref={commands} input={input} draft={draft} threadId={thread?.id} projectId={thread?.projectId} disabled={!ready||!skillsReady||busy||predictionBlocked} onDraft={updateDraft} onModel={()=>modelPicker.current?.open()} onMode={chooseMode}/>
      <div className="composer-entry-row">
      <div className="composer-input">
        <textarea ref={input} aria-label="Message" placeholder={prediction.candidate ? '' : dragging ? 'Drop files to attach' : 'Ask anything…'} value={draft} disabled={!ready} onChange={event => updateDraft(event.target.value)} onPaste={prediction.dismiss} onCompositionStart={prediction.dismiss} onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          const submitKey = event.key === 'Enter' && !event.shiftKey && (preferences.sendShortcut === 'enter' || event.ctrlKey || event.metaKey);
          if (submitKey && /^\/(?:btw|side)$/i.test(draft.trim())) { event.preventDefault(); void send(); return; }
          if(commands.current?.keyDown(event))return;
          if (prediction.candidate && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); prediction.dismiss(); return; }
          if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && acceptPrediction()) { event.preventDefault(); return; }
          if (submitKey) { event.preventDefault(); void send(); }
        }} rows={1} />
        {prediction.candidate && <div ref={ghost} className="composer-prediction-text" aria-hidden="true">{prediction.candidate}</div>}
      </div>
      <ComposerTaskActions changeSummary={changes} onChanges={inspectChanges} onCreatePR={preparePR} disabled={busy||!ready} working={working}/>
      </div>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{prediction.candidate ? `Suggested message: ${prediction.candidate} Tab to accept. Escape to dismiss.` : ''}</span>
      <ComposerToolbar modelPickerRef={modelPicker} models={models} modelId={modelId} onModelChange={id=>{chooseThinking('');setModelId(id);}} thinkingLevel={thinkingLevel} onThinkingChange={chooseThinking} projectLabel={thread?.projectName??project?.label} changeSummary={changes} onProject={async()=>{if(!selectProject){await addResource();return;}const opener=document.activeElement as HTMLElement|null;selectProject(thread?.id,opener,thread?undefined:id=>migrateDraft(id,draftLatest.current,true));}} onChanges={inspectChanges} onCreatePR={preparePR} onTranscript={text=>{const current=draftLatest.current;updateDraft(current+(current&&!/\s$/.test(current)?' ':'')+text);}} disabled={busy||!ready} working={working} separateActions
        leading={<><button type="button" className="icon-button attach-button" aria-label="Attach files" title="Attach files" disabled={busy} onClick={()=>file.current?.click()}><Plus size={18}/></button><input type="file" multiple ref={file} hidden onChange={event=>{if(event.target.files)void upload(event.target.files);event.target.value='';}}/></>}
        runtime={<>{thread?.accountId!=null&&<span className="composer-account" title="Account for this task">{snapshot.accounts?.find(account=>account.id===thread.accountId)?.label??'Account unavailable'}</span>}<span className="pill runtime-pill" title="Local workspace"><Laptop size={14}/>Local</span><button type="button" className="mode-toggle" aria-label="Task mode" aria-pressed={(thread?.mode??draftMode)==='plan'} title={(thread?.mode??draftMode)==='plan'?'Switch to Build':'Switch to Plan'} disabled={working||busy} onClick={()=>{void chooseMode((thread?.mode??draftMode)==='plan'?'build':'plan').catch(cause=>setError(messageOf(cause)));}}>{(thread?.mode??draftMode)==='plan'?<PenLine size={15}/>:<Bot size={15}/>}<span>{(thread?.mode??draftMode)==='plan'?'Plan':'Build'}</span></button></>}
        context={preferences.showComposerContext&&<span className="context-anchor"><button ref={contextAnchor} type="button" className="icon-button context-button" aria-label="Inspect context usage" aria-expanded={contextOpen} onClick={()=>setContextOpen(value=>!value)}><SlidersHorizontal size={15}/></button>{contextOpen&&<ContextInspector anchor={contextAnchor} usage={thread?snapshot.usage[thread.id]:undefined} thread={thread} close={()=>setContextOpen(false)} refresh={refresh}/>}</span>}
        trailing={working?<>{/^\/(?:btw|side)(?:\s|$)/i.test(draft.trim())&&<button type="button" className="send-button" aria-label="Send side question" disabled={busy||!ready||skillsBlocked} onClick={()=>void send()}><ArrowUp size={17}/></button>}<button type="button" className="send-button stop-button" aria-label="Stop agent" disabled={shared && sharedState.stopping} onClick={()=>{void (sharedComposers && sharedTarget ? sharedComposers.stop(sharedTarget) : command('run.stop',{},thread!.id)).then(()=>refresh()).catch(error=>setError(messageOf(error)));}}><CircleStop size={20}/></button></>:<button className="send-button" aria-label={retry ? "Retry send" : "Send message"} disabled={busy||!skillsReady||skillsBlocked||unavailable||!draft.trim() && !retry||!ready} title={unavailable?'Connect an available model in Settings to send.':'Send message (Enter)'}>{busy?<LoaderCircle size={17} className="spinning"/>:<ArrowUp size={19}/>}</button>}
      />
    </ComposerView>
    <div className="composer-caption">{prediction.candidate ? <span className="composer-prediction-controls"><span className="composer-prediction-keyboard" aria-hidden="true">Tab to accept · Esc to dismiss</span><button type="button" className="composer-prediction-use" onPointerDown={event => event.preventDefault()} onClick={acceptPrediction}>Use suggestion</button></span> : unavailable ? <button onClick={setup}>Connect a model to start<ChevronRight size={12} /></button> : null}</div>
  </div>;
}

function SideThreadComposer({thread,modelId,refresh}:{thread:Thread;modelId:string;refresh:()=>Promise<void>}){
 const key=`side-draft:${thread.sideParentId??threadParent(thread)}:${thread.id}`,[draft,setDraft]=useState(''),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true;void journalRead<string>(key).then(value=>{if(active){setDraft(value??'');setReady(true);}}).catch(()=>{if(active)setError('Draft recovery failed. Keep this panel open.');});return()=>{active=false;};},[key]);
 useEffect(()=>journalSubscribe(key,value=>setDraft(typeof value==='string'?value:'')),[key]);
 const working=Boolean(thread.runId)||thread.status==='working';
 return <form className="canvas-side-composer" onSubmit={event=>{event.preventDefault();if(!ready||busy||working||!modelId||!draft.trim())return;const generation=journalGeneration(key),content=draft.trim();setBusy(true);setError('');void command('message.send',{content,modelId},thread.id).then(()=>journalCompareAndSwap(key,generation,'')).then(refresh).catch(cause=>setError(messageOf(cause))).finally(()=>setBusy(false));}}><label className="sr-only" htmlFor={`side-message-${thread.id}`}>Message to {thread.title}</label><textarea id={`side-message-${thread.id}`} aria-label={`Message to ${thread.title}`} placeholder="Ask a side question…" disabled={!ready} value={draft} onChange={event=>{const value=event.target.value;setDraft(value);void journalWrite(key,value).catch(()=>setError('Draft could not be stored. Keep this panel open.'));}}/><div><small>Side conversation · independent draft</small><button className="secondary" disabled={busy||!ready||working||!modelId||!draft.trim()}>Send</button></div>{error&&<p role="alert" className="error-text">{error}</p>}</form>;
}
function CanvasThread({thread,snapshot,visible,blocked,refresh,setup,openResource,browseProject,inspectChanges,reportError,selectProject}:{thread:Thread;snapshot:Snapshot;visible:boolean;blocked:boolean;refresh:()=>Promise<void>;setup:()=>void;openResource:(id:string,opener?:HTMLElement|null)=>void;browseProject:(id:string)=>void;inspectChanges:()=>void;selectProject?:(id:string|undefined,opener?:HTMLElement|null,prepare?:PrepareThread)=>void;reportError:(error:string)=>void}){
 const [models,setModels]=useState<ModelInfo[]>([]),[modelId,setModelId]=useState(thread.modelId??''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[history,setHistory]=useState(60),detached=useDetachedSurface({kind:'thread',threadId:thread.id}),pending=usePendingSurface({kind:'thread',threadId:thread.id});const readOnly=delegatedThread(thread),held=Boolean(detached||pending||blocked),request=useRef(0);
 const owner=`${thread.id}:${thread.accountId??'legacy'}:${thread.modelId??''}`;
 useEffect(()=>{if(readOnly||!visible)return;const generation=++request.current,controller=new AbortController();setModels([]);void getModels(false,thread.id,controller.signal).then(value=>{if(generation!==request.current)return;setModels(value.models);setModelId(current=>value.models.some(model=>model.id===current)?current:thread.modelId??value.models[0]?.id??'');setError(value.error??'');}).catch(cause=>{if(generation===request.current&&!controller.signal.aborted)setError(messageOf(cause));});return()=>{request.current++;controller.abort();};},[owner,readOnly,visible]);
 const messages=snapshot.messages.filter(message=>message.threadId===thread.id),working=Boolean(thread.runId)||thread.status==='working';
 const run=async(action:()=>Promise<void>)=>{setBusy(true);try{await action();}finally{setBusy(false);}};
 return <div className={`canvas-thread${readOnly?' canvas-thread-delegate':''}`}><div className="canvas-thread-status">{readOnly?'Delegated agent':threadParent(thread)?'Side conversation':'Main conversation'} · {threadStatus(thread)}{detached&&<button className="quiet" onClick={()=>void window.harnessDesktop?.focus(detached.id)}>Focus native window</button>}</div>{visible&&<div className="canvas-thread-transcript" role="log" aria-label={`${thread.title} messages`}>{messages.length>history&&<button className="quiet" onClick={()=>setHistory(value=>value+60)}>Load earlier messages</button>}{messages.slice(-history).map(message=><div key={message.id} className={`message message-${message.role}`}><span className="sr-only">{message.role}</span><Markdown text={message.content}/></div>)}{!messages.length&&<p className="muted">No messages yet.</p>}{error&&<p role="alert" className="error-text">{error}</p>}{thread.error&&<p role="alert" className="error-text">{thread.error}</p>}{!readOnly&&working&&<button className="quiet" disabled={busy} onClick={()=>void run(async()=>{await command('run.stop',{},thread.id);await refresh();}).catch(cause=>setError(messageOf(cause)))}>Stop</button>}{!readOnly&&['stopped','interrupted','failed'].includes(thread.status)&&<button className="secondary" disabled={busy||!modelId} onClick={()=>void run(async()=>{await command('run.resume',{modelId},thread.id);await refresh();}).catch(cause=>setError(messageOf(cause)))}>Resume</button>}</div>}{readOnly?<div className="canvas-thread-readonly">Read-only delegated transcript · assignment and progress remain with the parent.</div>:<div inert={held} style={{display:'contents'}}>{threadParent(thread)?<SideThreadComposer thread={thread} modelId={modelId} refresh={refresh}/>:<Composer selectProject={selectProject} key={thread.id} thread={thread} snapshot={snapshot} models={models} modelId={modelId} setModelId={setModelId} ensureThread={async prepare=>{await prepare(thread.id);return thread.id;}} busy={busy} runAction={run} refresh={refresh} setup={setup} openResource={openResource} browseProject={browseProject} inspectChanges={inspectChanges} reportError={reportError} predictionBlocked={held||!visible} onSide={async content=>{if(!content.trim())return;const receipt=await command('thread.create',{sideParentId:thread.id,title:content.slice(0,65)}),side=receipt.result as Thread,key=`side-draft:${thread.id}:${side.id}`,generation=await journalWrite(key,content);await refresh();await command('message.send',{content,modelId},side.id);await journalCompareAndSwap(key,generation,'');await refresh();}}/>}</div>}</div>;
}
function stopConversation(thread: Thread, composers?: SharedAgentComposers) {
 return composers ? composers.stop({kind: 'conversation', threadId: thread.id, modelId: thread.modelId ?? null, working: Boolean(thread.runId) || thread.status === 'working'}) : command('run.stop', {}, thread.id);
}
export interface AppProps {embeddedThreadId?:string;embeddedActive?:boolean;onRequestThread?:(id:string)=>void}
export function App(props:AppProps={}) {
  const desktop=useDesktop();
  if(props.embeddedThreadId||desktop?.context.surface.kind==='thread'||desktop?.context.surface.kind==='navigation')return <ConversationWorkspace {...props}/>;
  return <WorkspaceHost conversation={host=><ConversationWorkspace {...props} host={host}/>}/>;
}
function ConversationWorkspace({embeddedThreadId,embeddedActive=true,onRequestThread,host}:AppProps&{host?:ConversationHost}={}) {
  const pluginCatalog=usePluginCatalog(!embeddedThreadId),plugins=pluginCatalog.plugins,[selectedPluginId,setSelectedPluginId]=useState<string|null>(null),[openedPlugins,setOpenedPlugins]=useState<string[]>([]);
  const [selectedPluginWorkspace,setSelectedPluginWorkspace]=useState<string|null>(null),[openedPluginWorkspaces,setOpenedPluginWorkspaces]=useState<{pluginId:string;workspaceId:string}[]>([]);
  const pluginWorkspaces=plugins.flatMap(plugin=>(plugin.workspaces??[]).map(contribution=>({pluginId:plugin.id,contribution})));
  const selectPluginWorkspace=async(pluginId:string,workspaceId:string)=>{await journalFlush();await prepareEditorHandoff();const key=pluginId+':'+workspaceId;setOpenedPluginWorkspaces(items=>items.some(item=>item.pluginId===pluginId&&item.workspaceId===workspaceId)?items:[...items,{pluginId,workspaceId}]);setSelectedPluginWorkspace(key);setSelectedPluginId(pluginId);};
  const selectPlugin=async(id:string)=>{await journalFlush();await prepareEditorHandoff();setSelectedPluginWorkspace(null);setOpenedPlugins(value=>value.includes(id)?value:[...value,id]);setSelectedPluginId(id);};
  const desktop=useDesktop(),desktopSurface=desktop?.context.surface,pinnedThreadId=embeddedThreadId??(desktopSurface?.kind==='thread'?desktopSurface.threadId:undefined),navigationOnly=desktopSurface?.kind==='navigation';
  useDesktopCloseGuard('composer-journal:'+String(embeddedThreadId??'shell'),()=>journalFlush());
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const snapshotRef = useRef(snapshot); snapshotRef.current = snapshot;
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(true);
  const [error, setError] = useState('');
  const [sideOpen,setSideOpen]=useState(false),sideChat=useRef<SideChatHandle>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelError, setModelError] = useState('');
  const [modelId, setModelId] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(() => { try { return pinnedThreadId??host?.initialThreadId??localStorage.getItem('harness:selected-thread'); } catch { return null; } });
  const liveMessages=useRef(new Set<string>());
  const liveEntries = useRef(new Set<string>()), entryThread = useRef(selectedId);
  if (entryThread.current !== selectedId) { liveEntries.current.clear();liveMessages.current.clear(); entryThread.current = selectedId; }
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const sidebarScrim = useRef<HTMLButtonElement>(null);
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 700px)').matches);
  useEffect(() => { const query = matchMedia('(max-width: 700px)'); const change = () => setMobile(query.matches); query.addEventListener('change', change); return () => query.removeEventListener('change', change); }, []);
  useModalRegion(sidebar, mobile && sidebarOpen, () => setSidebarOpen(false), 'input', sidebarScrim);
  const [focusedResource,setFocusedResource]=useState<string|undefined>(undefined);
  const [usageOpen,setUsageOpen]=useState(false),[usageThreadId,setUsageThreadId]=useState<string|null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState('general');
  const [layout, setLayout] = useShellLayout();
  const [workspaceMode,setWorkspaceModeState]=useState<'chat'|'split'|'retained-canvas'>(()=>{try{const saved=localStorage.getItem('harness:workspace-mode:v3')??localStorage.getItem('harness:workspace-mode:v2');return saved==='split'||saved==='retained-canvas'?saved:'chat';}catch{return 'chat';}});
  const retainedWorkspace=workspaceMode==='retained-canvas';
  const setWorkspaceMode=(mode:'chat'|'split'|'retained-canvas')=>{setWorkspaceModeState(mode);try{localStorage.setItem('harness:workspace-mode:v3',mode);}catch{/* The source layouts remain saved on the host. */}};
  const [documentWindow,setDocumentWindow]=useState<import('./workspace-context').OpenDocumentWindow|null>(null);
  useEffect(()=>setDocumentWindow(null),[selectedId]);
  const [planOpen,setPlanOpen]=useState(false),[planFocusOnOpen,setPlanFocusOnOpen]=useState(false),[planExpandRequest,setPlanExpandRequest]=useState(0);
  const [planVisibility]=useState(()=>createPlanVisibility());
  const preferences = getPreferences(snapshot.settings);
  useAppearance(preferences);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  useEffect(() => { const resize = () => setViewportWidth(window.innerWidth); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  const [panelOwner, setPanelOwner] = useState<HTMLDivElement|null>(null), [panelOwnerWidth, setPanelOwnerWidth] = useState(0);
  useLayoutEffect(() => {
    if (!panelOwner) return;
    const measure = () => setPanelOwnerWidth(panelOwner.clientWidth);
    measure(); const observer = new ResizeObserver(measure); observer.observe(panelOwner);
    return () => observer.disconnect();
  }, [panelOwner]);
  const panelBounds = workspacePanelBounds(panelOwnerWidth, layout.rightPanelWidth), panelWidth = panelBounds.width;
  const closePanel = () => setLayout(value => ({ ...value, rightPanelOpen: false, rightPanelMaximized: false }));
  const workspaceContext = { activeArtifactId: layout.activeArtifactId, requestOpenArtifact: (id: string) => {setDocumentWindow(null);revealWorkspaceTool('artifact',undefined,id);}, closeArtifact: () => setLayout(value => ({ ...value, activeArtifactId: null })), rightPanelOpen: layout.rightPanelOpen, activeTab: layout.activeTab, setActiveTab: (activeTab: typeof layout.activeTab) => setLayout(value => ({ ...value, activeTab })), documentWindow, requestOpenDocument:(id:string)=>{closePanel();setDocumentWindow({id,placement:'docked'});},closeDocument:(id:string)=>setDocumentWindow(value=>value?.id===id?null:value),placeDocument:(id:string,placement:'docked'|'floating')=>setDocumentWindow(value=>value?.id===id?{id,placement}:value) };
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [resourcePicker, setResourcePicker] = useState<string | null>(null);
  const resourcePickerOpener = useRef<HTMLElement | null>(null);
  const openResourcePicker = (id: string, opener: HTMLElement | null = document.activeElement as HTMLElement | null) => { resourcePickerOpener.current = opener; setResourcePicker(id); };
  const [composerBusy, setComposerBusy] = useState(false);
  const composerPending = useRef(false);
  const [threadCreating, setThreadCreating] = useState(false);
  const creationPending = useRef<Promise<string> | null>(null);
  const reconcileSplitThreadProject=async(threadId:string)=>{
    const workspaceId=splitWorkspaceId,canonical=await getSnapshot(),current=await getSplitWorkspace(workspaceId),operation=threadReconciliationCommand(current,canonical.threads,threadId);
    if(operation)await sendSplitWorkspaceCommand(operation.type,operation.payload);
    window.dispatchEvent(new Event('harness:workspace-changed'));
  };
  const pickProject=async(project:NonNullable<typeof workspaceEnvelope>['projects'][number]|null)=>{
    if(projectPicking||!projectPicker)return;
    if(project&&(project.authority.kind!=='local'||!project.rootPath))throw Error('Choose a connected personal project.');
    const selection=projectPicker;
    const target=selection.threadId?snapshotRef.current.threads.find(value=>value.id===selection.threadId):undefined;
    if(selection.threadId&&!target)throw Error('This conversation is no longer available.');
    setProjectPicking(true);setProjectPickerError('');
    try{
      await prepareEditorHandoff();await journalFlush();
      if(!target){await createThread(selection.prepare,project?.id);}
      else if(target.projectId===project?.id){if(project)await reconcileSplitThreadProject(target.id);}
      else if(!project||target.runId||target.sessionPath||target.workspaceId){await createThread(undefined,project?.id);}
      else{await workspaceState.send('workspace.project.connect',{name:project.name,path:project.rootPath,threadId:target.id});await reconcileSplitThreadProject(target.id);await refresh();}
      closeProjectSelection();
    }finally{setProjectPicking(false);}
  };
  const saveProjectColor=async(project:NonNullable<typeof workspaceEnvelope>['projects'][number],color:string|null)=>{
    if(project.authority.kind!=='local')throw Error('Choose a connected personal project.');
    const current=getPreferences((await getSnapshot()).settings),colors={...current.projectColors},key=projectColorKey(project.authority,project.id);
    if(color===null)delete colors[key];else colors[key]=color;
    const next=mergePreferences(current,{projectColors:colors});
    await command('settings.update',{preferences:{projectColors:next.projectColors}});await refresh();
  };
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
  const modelThread = snapshot.threads.find(item => item.id === selectedId) ?? (pinnedThreadId ? undefined : snapshot.threads.find(item => item.id === snapshot.activeThreadId));
  const modelThreadRef = useRef(modelThread); modelThreadRef.current = modelThread;
  const modelBinding = hasPinnedAccount(modelThread, snapshot) ? modelThread?.accountId ?? null : undefined;
  const selectedAccountsKey = JSON.stringify(Object.entries(snapshot.settings.selectedAccounts ?? {}).sort(([left], [right]) => left.localeCompare(right)));
  const modelOwner = `${modelThread?.id ?? 'new'}:${modelBinding === undefined ? 'unbound' : modelBinding ?? 'legacy'}`;
  const modelContext = modelBinding === undefined ? `${modelOwner}:${selectedAccountsKey}` : modelOwner;
  const modelContextRef = useRef(modelContext); modelContextRef.current = modelContext;
  const loadedModelOwner = useRef('');
  const modelRequest = useRef(0);
  const modelRead = useRef<AbortController|null>(null);
  const loadModels = useCallback(async (refresh = false) => {
    const owner = modelThreadRef.current, ownerId = owner?.id, context = modelContextRef.current, request = ++modelRequest.current;
    modelRead.current?.abort();const controller=new AbortController();modelRead.current=controller;
    try {
      const result = await getModels(refresh, ownerId, controller.signal);
      if (request !== modelRequest.current || modelContextRef.current !== context) return;
      setModels(result.models); setModelError(result.error ?? '');
      setModelId(previous => {
        if (previous && result.models.some(item => item.id === previous)) return previous;
        // Bound tasks never silently move to another account or model when its
        // pinned connection is unavailable. Setup and model changes are explicit.
        if (hasPinnedAccount(owner, snapshotRef.current)) return owner?.modelId ?? previous;
        const preferred = owner?.modelId ?? snapshotRef.current.settings.modelId;
        return result.models.some(item => item.id === preferred) ? preferred! : result.models[0]?.id ?? preferred ?? '';
      });
    } catch (error) { if (!controller.signal.aborted && request === modelRequest.current && modelContextRef.current === context) { setModels([]); setModelError(messageOf(error)); } }
    finally { if(modelRead.current===controller)modelRead.current=null; }
  }, []);
  const acceptedModel = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const saved = snapshot.settings.modelId;
    if (!loaded || hasPinnedAccount(modelThreadRef.current, snapshotRef.current) || acceptedModel.current === saved || saved && !models.some(model => model.id === saved)) return;
    acceptedModel.current = saved;
    if (saved) setModelId(saved);
  }, [loaded, models, snapshot.settings.modelId]);
  useEffect(() => { let active = true; void bootstrap().then(async () => { await refresh(); if (active) { setLoaded(true); setError(''); } }).catch(error => { if (active) setError(messageOf(error)); }); return () => { active = false; }; }, [refresh]);
  useLayoutEffect(() => {
    if (!loaded) return;
    setModels([]); setModelError('');
    if (loadedModelOwner.current !== modelOwner) setModelId(modelThreadRef.current?.modelId ?? snapshotRef.current.settings.modelId ?? '');
    loadedModelOwner.current = modelOwner;
    void loadModels();
    return () => { modelRequest.current++;modelRead.current?.abort();modelRead.current=null; };
  }, [loaded, modelOwner, modelContext, loadModels]);
  useEffect(() => { if (!loaded) return; return subscribe(snapshotRef.current.seq, event => {if(event.type.startsWith('workspace.')||event.type.startsWith('project.')||event.type.startsWith('split-workspace.'))window.dispatchEvent(new Event('harness:workspace-changed'));void refresh().catch(error => setError(messageOf(error))); }, setOnline, refresh); }, [loaded, refresh]);
  useEffect(() => { const query = matchMedia('(prefers-color-scheme: dark)'); const change = () => setSystemDark(query.matches); query.addEventListener('change', change); return () => query.removeEventListener('change', change); }, []);
  const theme = snapshot.settings.theme === 'system' ? systemDark ? 'dark' : 'light' : snapshot.settings.theme;
  useLayoutEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useDesktopReady(loaded&&!embeddedThreadId);
  const thread = snapshot.threads.find(item => item.id === selectedId) ?? (pinnedThreadId?undefined:snapshot.threads.find(item => item.id === snapshot.activeThreadId));
  useLayoutEffect(() => {if (thread) host?.selectThread(thread.id);}, [host, thread?.id]);
  const localWorkspaceState=useWorkspaceState(loaded&&!host&&!navigationOnly&&(!pinnedThreadId||Boolean(embeddedThreadId))),workspaceState=host?.workspace??localWorkspaceState,workspaceEnvelope=workspaceState.envelope,activeCanvas=workspaceEnvelope?.state.canvases.find(canvas=>canvas.id===workspaceEnvelope.state.activeCanvasId),customDock=Boolean(activeCanvas?.preset==='custom'&&!retainedWorkspace&&!pinnedThreadId&&!navigationOnly),canvasActive=Boolean(activeCanvas&&!customDock&&(activeCanvas.preset!=='workspace'||retainedWorkspace)&&!pinnedThreadId&&!navigationOnly),canvasPanels=useMemo(()=>activeCanvas?(activeCanvas.preset==='all-agents'?liveThreadPanels(snapshot.threads,activeCanvas):activeCanvas.panels):[],[activeCanvas,snapshot.threads]);
  const splitEnabled=loaded&&!pinnedThreadId&&!navigationOnly&&(customDock||workspaceMode==='split'&&(!activeCanvas||activeCanvas.preset==='workspace')),splitWorkspaceId=customDock?activeCanvas!.id:'workspace';
  const splitProfiles=useSplitWorkspaceProfiles(splitEnabled,splitWorkspaceId);
  const [layoutChooserOpen,setLayoutChooserOpen]=useState(false);
  const splitState=useSplitWorkspaceState(splitEnabled,splitWorkspaceId),placedThread=useRef<string|null>(null),openedPlanRevision=useRef(new Set<string>());
  const savedLayoutActions=useSplitLayoutProfileActions({prepare:()=>prepareWorkspace(),save:splitState.saveProfile,send:splitState.send,refresh:splitProfiles.refresh},splitWorkspaceId);
  const [projectConnectOpen,setProjectConnectOpen]=useState(false),[projectName,setProjectName]=useState(''),[projectPath,setProjectPath]=useState('');
  const [projectPicker,setProjectPicker]=useState<{threadId?:string;opener:HTMLElement|null;prepare?:PrepareThread}|null>(null),[projectPicking,setProjectPicking]=useState(false),[projectPickerError,setProjectPickerError]=useState('');
  const openProjectSelection=(threadId?:string,opener:HTMLElement|null=document.activeElement as HTMLElement|null,prepare?:PrepareThread)=>{setProjectPickerError('');setProjectPicker({threadId,opener,prepare});};
  const closeProjectSelection=()=>{const opener=projectPicker?.opener;setProjectPicker(null);requestAnimationFrame(()=>{if(opener?.isConnected)opener.focus({preventScroll:true});});};
  const projectConnectPicker=useRef<typeof projectPicker>(null);
  const projectConnectTarget=useRef<{threadId?:string;projectId?:string;opener:HTMLElement|null}|null>(null);
  const openProjectConnect=(binding:Pick<PanelBinding,'threadId'|'projectId'>)=>{projectConnectTarget.current={...binding,opener:document.activeElement as HTMLElement|null};setProjectConnectOpen(true);};
  const closeProjectConnect=()=>{setProjectConnectOpen(false);const resume=projectConnectPicker.current;projectConnectPicker.current=null;if(resume){setProjectPicker(resume);return;}const opener=projectConnectTarget.current?.opener;requestAnimationFrame(()=>{if(opener?.isConnected)opener.focus({preventScroll:true});});};
  const selectedPlan=useMemo(()=>selectPlanRecord(snapshot,thread?.id),[snapshot.data,thread?.id]);
  const planOwner=useRef<{id?:string;run:string|null|undefined}>({id:undefined,run:undefined});
  useEffect(()=>{const before=planOwner.current;planOwner.current={id:thread?.id,run:thread?.runId};const appeared=planVisibility.observe(thread,selectedPlan);if(before.id!==thread?.id||thread?.runId&&before.run!==thread.runId)setPlanOpen(planVisibility.isOpen(thread?.id));if(appeared){setPlanFocusOnOpen(false);setPlanExpandRequest(value=>value+1);setPlanOpen(true);}},[thread?.id,thread?.runId,selectedPlan]);
  const dismissPlan=()=>{planVisibility.dismiss(thread);if(planFocusOnOpen)document.querySelector<HTMLButtonElement>('.thread-menu-wrap>button')?.focus({preventScroll:true});setPlanOpen(false);};
  const conversation = useRef<HTMLDivElement>(null);
  const readingPositions = useRef(new Map<string, { top: number; tail: boolean }>());
  const previousConversation = useRef('');
  const previousUpdate = useRef('');
  const [latestAvailable, setLatestAvailable] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [historyCounts, setHistoryCounts] = useState<Record<string, number>>({});
  const historyStarts = useRef(new Map<string, number>());
  const historyAnchor = useRef<{ height: number; top: number } | null>(null);
  const select = (id: string | null) => { setSelectedPluginId(null);setSelectedPluginWorkspace(null); if(pinnedThreadId&&id&&id!==pinnedThreadId){if(embeddedThreadId&&onRequestThread)onRequestThread(id);else setNotice('Choose another conversation in the main workspace.');return;}if(id&&splitEnabled&&!customDock&&splitState.layout){const current=splitState.layout,target=Object.values(current.panes).find(pane=>pane.viewIds.some(viewId=>current.views[viewId]?.kind==='thread'&&current.views[viewId]?.binding.threadId===id));void placeSplitThread(id,target?.id??current.focusedPaneId).catch(cause=>setError(messageOf(cause)));setSidebarOpen(false);return;}  setSelectedId(id); setSidebarOpen(false);  try { if (id) localStorage.setItem('harness:selected-thread', id); else localStorage.removeItem('harness:selected-thread'); } catch { /* Selection still works when storage is unavailable. */ } };
  const createThread = (prepare?: PrepareThread, projectId?: string): Promise<string> => {
    if (creationPending.current) return creationPending.current;
    setThreadCreating(true);
    const before = new Set(snapshotRef.current.threads.map(item => item.id));
    creationPending.current = (async () => {
      const receipt = await command('thread.create', projectId?{projectId}:{});
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
  const newThreadRef = useRef<() => Promise<void>>(async()=>{}); newThreadRef.current = async()=>{if(composerPending.current||creationPending.current)return;await prepareWorkspace();openProjectSelection();};
  useEffect(() => { if(embeddedThreadId)return;const key = (event: KeyboardEvent) => {
    if (event.defaultPrevented || document.querySelector('dialog[open]')) return;
    if (matchesShortcut(event, preferences.keybindings.search)) { event.preventDefault(); setSidebarOpen(true); setLayout(value => ({ ...value, sidebarCollapsed: false })); requestAnimationFrame(() => searchRef.current?.focus()); }
    else if (matchesShortcut(event, preferences.keybindings.newThread)) { event.preventDefault(); if (!composerPending.current) void newThreadRef.current().catch(error => setError(messageOf(error))); }
    else if (matchesShortcut(event, preferences.keybindings.toggleSidebar)) { event.preventDefault(); if (mobile) setSidebarOpen(value => !value); else setLayout(value => ({ ...value, sidebarCollapsed: !value.sidebarCollapsed })); }
    else if (matchesShortcut(event, preferences.keybindings.toggleRightPanel)) { event.preventDefault(); setLayout(value => ({ ...value, rightPanelOpen: !value.rightPanelOpen })); }
    else if (matchesShortcut(event, preferences.keybindings.openSettings)) { event.preventDefault(); setSettingsSection('general'); setSettingsOpen(true); }
    else if (matchesShortcut(event, preferences.keybindings.stop) && (snapshotRef.current.threads.find(item => item.id === (selectedId ?? snapshotRef.current.activeThreadId))?.runId)) { event.preventDefault(); void stopConversation(snapshotRef.current.threads.find(item => item.id === (selectedId ?? snapshotRef.current.activeThreadId))!, host?.composers).then(() => refresh()).catch(error => setError(messageOf(error))); }
    if (event.key === 'Escape') { setSidebarOpen(false);  }
  }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [preferences.keybindings.search, preferences.keybindings.newThread, preferences.keybindings.toggleSidebar, preferences.keybindings.toggleRightPanel, preferences.keybindings.openSettings, preferences.keybindings.stop, selectedId, mobile, refresh, host?.composers]);
  const conversationMotion=useRef<ReturnType<typeof createConversationScroll>|null>(null),conversationElement=useRef<HTMLElement|null>(null);
  useEffect(()=>()=>conversationMotion.current?.dispose(),[]);
  const messages = snapshot.messages.filter(item => item.threadId === thread?.id);
  const requests = snapshot.requests.filter(item => item.threadId === thread?.id && item.status === 'pending');
  useLayoutEffect(() => {
    const element = conversation.current;
    if (!element || !loaded) return;
    if(conversationElement.current!==element||!conversationMotion.current){conversationMotion.current?.dispose();conversationMotion.current=createConversationScroll(element);conversationElement.current=element;}
    const id = thread?.id ?? 'new';
    const position = readingPositions.current.get(id) ?? { top: 0, tail: true };
    const changedThread = previousConversation.current !== id;
    const update = JSON.stringify([messages.length, messages.at(-1)?.id, messages.at(-1)?.content, requests.map(item => [item.id, item.revision]), thread?.status]);
    conversationMotion.current.update(id,position,historyAnchor.current??undefined);
    historyAnchor.current=null;
    if (!changedThread && previousUpdate.current !== update) { setAnnouncement('New conversation updates available.'); if (!position.tail) setLatestAvailable(true); }
    if (changedThread) { setLatestAvailable(!position.tail); setAnnouncement(''); }
    previousConversation.current = id; previousUpdate.current = update;
  }, [thread?.id, snapshot, loaded, historyCounts,canvasActive]);
  const rememberPosition = () => {
    const position=conversationMotion.current?.remember();if(!position)return;
    readingPositions.current.set(thread?.id??'new',position);
    setLatestAvailable(!position.tail);
  };
  const archive = async (id: string, discard = false, confirmed = false) => {
    if (!discard && Object.values(dirtyWidgets).includes(id)) { setArchiveThread(id);  return; }
    if (!discard && !confirmed && preferences.archiveConfirmation) { setConfirmArchive(id);  return; }
    try { await command('thread.archive', {}, id); setDirtyWidgets(previous => Object.fromEntries(Object.entries(previous).filter(([, threadId]) => threadId !== id))); setArchiveThread(null); select(null); await refresh(); } catch (error) { setError(messageOf(error)); }
  };
  const matching = useMemo(() => matchingThreads(snapshot.threads, snapshot.messages, search, preferences.projectOrder), [snapshot.threads, snapshot.messages, search, preferences.projectOrder]);
  const updateModel = (id: string) => { setModelId(id); void command('settings.update', { modelId: id }).then(() => refresh()).catch(error => setError(messageOf(error))); };
  const detachedPlan=useDetachedSurface(thread?{kind:'plan',threadId:thread.id}:null),detachedThread=useDetachedSurface(thread?{kind:'thread',threadId:thread.id}:null),detachedNavigation=useDetachedSurface({kind:'navigation'});
  const pendingThread=usePendingSurface(thread?{kind:'thread',threadId:thread.id}:null);
  const threadHeld=Boolean(detachedThread||pendingThread||desktop?.closing);
  const prepareWorkspace=async()=>{await journalFlush();await prepareEditorHandoff();};
  const updateCanvasPanel=async(panel:PanelPlacement,patch:Partial<PanelPlacement>)=>{if(!activeCanvas)throw Error('Choose a canvas first.');if(patch.visible===false||patch.placement==='native')await prepareWorkspace();if(!activeCanvas.panels.some(value=>value.id===panel.id))await workspaceState.send('workspace.panel.add',{canvasId:activeCanvas.id,panel:{id:panel.id,kind:panel.kind,binding:panel.binding},bounds:panel.bounds});await workspaceState.send('workspace.panel.update',{panelId:panel.id,patch});};
  const panelTitle=(panel:PanelPlacement)=>panel.kind==='thread'?snapshot.threads.find(item=>item.id===panel.binding.threadId)?.title??'Unavailable conversation':panel.kind==='artifact'?snapshot.artifacts.find(item=>item.id===panel.binding.artifactId)?.title??'Artifact':panelLabels[panel.kind];
  const openUsage=(ownerId=thread?.id)=>{setUsageThreadId(ownerId??null);setUsageOpen(true);};
  const usageOwner=snapshot.threads.find(item=>item.id===usageThreadId);
  const usageReport=runtimeUsageReport(usageOwner,usageThreadId?snapshot.usage[usageThreadId]:undefined);
  useEffect(()=>{
    if(!loaded||!workspaceEnvelope||pinnedThreadId||navigationOnly||layout.activeTab!=='usage')return;
    if(layout.rightPanelOpen&&!canvasActive&&!splitEnabled&&!selectedPluginId){setUsageThreadId(thread?.id??null);setUsageOpen(true);}
    setLayout(value=>value.activeTab==='usage'?{...value,activeTab:'notes'}:value);
  },[loaded,workspaceEnvelope,pinnedThreadId,navigationOnly,layout.activeTab,layout.rightPanelOpen,canvasActive,splitEnabled,selectedPluginId,thread?.id]);
  const addCanvasPanel=async(kind:WorkspacePanelKind,explicitBinding?:PanelBinding)=>{
    if(customDock){await openSplitTool(kind,undefined,false,explicitBinding?.threadId,false,explicitBinding);return;}
    if(kind==='usage'&&(!explicitBinding||explicitBinding.authority.kind==='local')){openUsage(explicitBinding?.threadId??thread?.id);return;}
    if(!canvasActive&&workspaceMode==='chat'&&!explicitBinding&&['artifact','plan','files','diff','notes','output','usage','terminal','pull-request','linked-pull-requests'].includes(kind)){await prepareWorkspace();setLayout(value=>({...value,rightPanelOpen:true,activeTab:kind as typeof value.activeTab}));return;}
    if(!activeCanvas)throw Error('Choose a canvas first.');
    const binding:PanelBinding=explicitBinding?{...explicitBinding}:{authority:{kind:'local'},...(thread?{threadId:thread.id}:{}),...(thread&&threadProject(thread)!=='unassigned'?{projectId:threadProject(thread)}:{})};
    const owner=snapshot.threads.find(item=>item.id===binding.threadId);
    if(['thread','plan','agent','artifact','notes'].includes(kind)&&!owner)throw Error('Choose a conversation before adding this panel.');
    if(kind==='thread'&&!canvasActive&&owner?.id===thread?.id){setNotice('This conversation is already open.');return;}
    if(kind==='artifact'){const artifact=snapshot.artifacts.find(item=>item.threadId===owner?.id&&item.lifecycle==='active');if(!artifact)throw Error('This conversation has no active artifact.');binding.artifactId=artifact.id;}
    if(kind==='agent'){const agent=selectPlanRecord(snapshot,owner?.id)?.plan?.agents[0];if(!agent)throw Error('This conversation has no delegated agent yet.');binding.agentId=agent.id;}
    if(kind==='browser')binding.browserId='browser-'+crypto.randomUUID();
    // A new pane must receive its own host-persisted PTY reference, including when opened from an exited pane.
    if(kind==='terminal')delete binding.terminalId;
    const area=document.querySelector<HTMLElement>(canvasActive?'.workspace-canvas':'.shell-workarea');
    const size={width:area?.clientWidth??Math.max(320,viewportWidth-layout.sidebarWidth),height:Math.max(200,(area?.clientHeight??window.innerHeight)-(canvasActive?0:220))};
    const bounds=findCanvasPanelBounds(canvasPanels,activeCanvas.viewport,size,{width:kind==='thread'?520:480,height:Math.min(600,size.height-48)});
    await workspaceState.send('workspace.panel.add',{canvasId:activeCanvas.id,panel:{id:'panel-'+crypto.randomUUID(),kind,binding},bounds});
  };
  const resolvePanelBinding=(panel:PanelPlacement):PanelBinding=>{const binding=panel.binding;if(binding.authority.kind!=='local')return binding;if(binding.liveProject&&binding.projectId){const current=thread&&threadProject(thread)===binding.projectId?thread:snapshot.threads.filter(item=>threadProject(item)===binding.projectId&&!threadParent(item)).toSorted((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];return {...binding,threadId:current?.id};}return binding.threadId?binding:{...binding,...(thread?{threadId:thread.id}:{}),...(thread&&threadProject(thread)!=='unassigned'&&!binding.projectId?{projectId:threadProject(thread)}:{})};};
  const canvasBody=(panel:PanelPlacement,visible:boolean)=>{const binding=resolvePanelBinding(panel),owner=snapshot.threads.find(item=>item.id===binding.threadId),native=desktop&&panelNativeWindow({...panel,binding},desktop.windows.filter(value=>value.id!==desktop.context.windowId));if(native)return <div className="panel-note"><p>This view is open in another window.</p><button className="quiet" onClick={()=>void desktop?.bridge.focus(native.id).catch(cause=>setError(messageOf(cause)))}>Focus window</button></div>;if(binding.authority.kind==='plugin'){const authority=binding.authority,plugin=plugins.find(value=>value.id===authority.pluginId),surface=panelDesktopSurface({...panel,binding});return plugin&&surface.kind==='plugin'?<PluginFrame key={panel.id} plugin={plugin} theme={theme} surface={surface} active={visible}/>:<p className="panel-note" role="alert">The owning plug-in is unavailable. Saved panel data is retained.</p>;}if(panel.kind==='thread')return owner?<CanvasThread key={owner.id} thread={owner} snapshot={snapshot} visible={visible} blocked={Boolean(desktop?.closing)||settingsOpen||usageOpen||Boolean(resourcePicker)||rename} refresh={refresh} setup={()=>{setSettingsSection('providers');setSettingsOpen(true);}} openResource={(_id,opener)=>openResourcePicker(owner.id,opener)} browseProject={id=>{void addCanvasPanel('files',{...binding,resourceId:id,liveProject:false}).catch(cause=>setError(messageOf(cause)));}} inspectChanges={()=>{void addCanvasPanel('diff',{...binding,liveProject:false}).catch(cause=>setError(messageOf(cause)));}} reportError={setError} selectProject={openProjectSelection}/>:<p role="alert" className="panel-note">The owning conversation is unavailable.</p>;if(panel.kind==='agent')return binding.threadId&&binding.agentId?<DelegatedAgentTranscript key={binding.threadId+':'+binding.agentId} threadId={binding.threadId} agentId={binding.agentId} snapshot={snapshot}/>:<p role='alert'>The owning subagent is unavailable.</p>;if(panel.kind==='plan')return <PlanStatus snapshot={snapshot} threadId={binding.threadId}/>;if(panel.kind==='context')return <ProjectContextSurface key={owner?.id??panel.id} thread={owner} snapshot={snapshot} onSelectThread={select} onShowChanges={()=>{void addCanvasPanel('diff',{...binding,liveProject:false}).catch(cause=>setError(messageOf(cause)));}} onConnect={()=>openProjectConnect(binding)}/>;if(panel.kind==='browser'){const docked=desktop?.state.dockedBrowser;return docked&&docked.browserId===binding.browserId?<div style={{display:'flex',flexDirection:'column',height:'100%'}}><DesktopBrowserToolbar state={docked.state}/><DesktopBrowserSlot/></div>:<div className="panel-note"><p>No browser is currently docked in this workspace.</p></div>;}return <WorkspaceSurfaceBody panelId={panel.id} kind={panel.kind} binding={binding} snapshot={snapshot} refresh={refresh} active={visible} preferences={preferences} onSelectThread={async id=>{await prepareWorkspace();select(id);}} onOpenTool={kind=>addCanvasPanel(kind,{...binding,liveProject:false})}/>;};
  const renderWorkspaceCanvas=(embedded=false)=>activeCanvas&&workspaceEnvelope?<WorkspaceCanvas embedded={embedded} threads={snapshot.threads} canvas={activeCanvas} panels={embedded?canvasPanels.filter(panel=>!(panel.kind==='thread'&&panel.binding.authority.kind==='local'&&resolvePanelBinding(panel).threadId===thread?.id)):canvasPanels} projects={workspaceEnvelope.projects} disabledKinds={workspaceEnvelope.state.disabledKinds} title={panelTitle} updatePanel={updateCanvasPanel} updateViewport={async viewport=>{await workspaceState.send('workspace.canvas.viewport',{canvasId:activeCanvas.id,...viewport});}} setFilter={async filter=>{await workspaceState.send('workspace.canvas.filter',{canvasId:activeCanvas.id,filter});}} renderBody={canvasBody}/>:null;
  const openSidebarTool=(kind:'usage'|'linked-pull-requests')=>{if(navigationOnly){setNotice('Open this tool in the main workspace.');return;}if(kind==='usage'){openUsage();return;}setSelectedPluginId(null);if(canvasActive)void addCanvasPanel(kind).catch(cause=>setError(messageOf(cause)));else if(splitEnabled&&splitState.layout)void openSplitTool(kind,undefined,true,thread?.id).catch(cause=>setError(messageOf(cause)));else setLayout(value=>({...value,rightPanelOpen:true,activeTab:kind}));};
  const handledDockTarget=useRef<unknown>(null);
  useEffect(()=>{
    const target=desktop?.state.focusSurface;if(!target){handledDockTarget.current=null;return;}
    if(!workspaceEnvelope||handledDockTarget.current===target)return;handledDockTarget.current=target;
    if(target.kind==='plugin'){setOpenedPlugins(value=>value.includes(target.pluginId)?value:[...value,target.pluginId]);setSelectedPluginId(target.pluginId);}
    if('threadId'in target&&target.threadId&&!pinnedThreadId)setSelectedId(target.threadId);
    if(target.kind==='plan')setPlanOpen(true);
    if(target.kind==='workspace'&&!target.panelId&&(!target.tab||['launcher','artifact','plan','files','diff','notes','output','usage'].includes(target.tab)))setLayout(value=>({...value,rightPanelOpen:true,activeTab:target.tab&&target.tab!=='launcher'?target.tab as typeof value.activeTab:'artifact'}));
    void(async()=>{
      let latest=await workspaceState.refresh();
      const panels=panelsForDesktopSurface(latest.state.canvases.flatMap(canvas=>canvas.panels).filter(panel=>panel.placement==='native'),target);
      if(!panels.length)return;
      for(let attempt=0;;attempt++)try{
        for(const panel of panels){
          const current=panelsForDesktopSurface(latest.state.canvases.flatMap(canvas=>canvas.panels),target).find(value=>value.id===panel.id);
          if(!current||current.canvasId!==panel.canvasId||current.kind!==panel.kind||JSON.stringify(current.binding)!==JSON.stringify(panel.binding))throw Error('The owning panel changed during docking. Restore it from the current workspace.');
          latest=await workspaceState.send('workspace.panel.update',{baseRevision:latest.state.revision,panelId:panel.id,patch:{placement:'canvas',visible:true}});
        }
        latest=await workspaceState.send('workspace.canvas.select',{baseRevision:latest.state.revision,canvasId:panels[0].canvasId});return;
      }catch(cause){
        // Native placement saves can advance the revision during this idempotent handoff.
        if(!(cause instanceof ApiError)||cause.code!=='WORKSPACE_CHANGED'||attempt>=2)throw cause;
        latest=await workspaceState.refresh();
      }
    })().catch(cause=>{if(handledDockTarget.current===target)handledDockTarget.current=null;setError(messageOf(cause));});
  },[desktop?.state.focusSurface,workspaceEnvelope]);
  const placeSplitThread=async(threadId:string,paneId=splitState.layout?.focusedPaneId,edge:SplitDropEdge='center',outer=false)=>{
    const current=splitState.layout;if(!current||!paneId)throw Error('Wait for the workspace to load.');
    await prepareWorkspace();const next=threadPlacementCommand(current,snapshotRef.current.threads,threadId,paneId,edge,outer);
    await splitState.send(next.type,next.payload);try{localStorage.setItem('harness:selected-thread',threadId);}catch{/* Current selection remains usable. */}placedThread.current=threadId;setSelectedId(threadId);setSelectedPluginId(null);setSelectedPluginWorkspace(null);
  };
  useEffect(()=>{
    if(!splitEnabled||customDock||!splitState.layout||!thread||placedThread.current===thread.id)return;
    const current=splitState.layout,existing=Object.values(current.panes).find(pane=>pane.viewIds.some(id=>current.views[id]?.kind==='thread'&&current.views[id]?.binding.threadId===thread.id));
    if(existing&&!existing.collapsed&&existing.activeViewId&&current.views[existing.activeViewId]?.kind==='thread'&&current.views[existing.activeViewId]?.binding.threadId===thread.id){placedThread.current=thread.id;return;}
    placedThread.current=thread.id;
    void placeSplitThread(thread.id,existing?.id??current.focusedPaneId).catch(cause=>{placedThread.current=null;setError(messageOf(cause));});
  },[splitEnabled,customDock,splitState.layout,thread?.id]);
  const focusSplitOwner=(view:SurfaceRef)=>{if(view.binding.authority.kind!=='local'||!view.binding.threadId)return;placedThread.current=view.binding.threadId;setSelectedId(view.binding.threadId);};
  const sendSplitCommand=async(type:string,payload:Record<string,unknown>)=>{
    const before=splitState.layout,next=await splitState.send(type,payload),target=typeof payload.viewId==='string'?before?.views[payload.viewId]:next.panes[next.focusedPaneId]?.activeViewId?next.views[next.panes[next.focusedPaneId]!.activeViewId!]:undefined;
    if(target&&!customDock)focusSplitOwner(target);return next;
  };
  const openSplitTool=async(kind:WorkspacePanelKind,paneId=splitState.layout?.focusedPaneId,beside=false,ownerThreadId?:string,preserveFocus=false,explicitBinding?:PanelBinding)=>{
    if(explicitBinding&&explicitBinding.authority.kind!=='local')throw Error('Open this tool in its owning workspace.');
    if(kind==='usage'){const current=splitState.layout,viewId=paneId?current?.panes[paneId]?.activeViewId:undefined,binding=viewId?current?.views[viewId]?.binding:undefined;if(binding&&binding.authority.kind!=='local')throw Error('Open usage in its owning workspace.');openUsage(ownerThreadId??(!customDock&&binding?.authority.kind==='local'?binding.threadId:undefined)??thread?.id);return;}
    const current=splitState.layout;if(!current||!paneId)throw Error('Wait for the workspace to load.');
    if(kind==='thread'){setNotice('Drag an existing thread from the sidebar into this area.');return;}
    const activeId=current.panes[paneId]?.activeViewId,basis=activeId?current.views[activeId]?.binding:undefined,ownerId=explicitBinding?.threadId??ownerThreadId??(!customDock&&basis?.authority.kind==='local'?basis.threadId:thread?.id),owner=snapshotRef.current.threads.find(item=>item.id===ownerId);
    if(['plan','notes','artifact','agent'].includes(kind)&&!owner)throw Error('Choose a conversation for this view.');
    const binding:PanelBinding=explicitBinding?{...explicitBinding}:{authority:{kind:'local'},...(owner?{threadId:owner.id,...(owner.projectId?{projectId:owner.projectId}:{})}:{})};
    if(kind==='browser'){if(!desktop||desktop.context.surface.kind!=='main')throw Error('Open the browser from the desktop workspace.');let docked=desktop.state.dockedBrowser;if(!docked){await desktop.bridge.browser({type:'open'});const context=await desktop.bridge.getContext();if(context.windowId!==desktop.context.windowId||context.surface.kind!=='main')throw Error('The owning workspace changed.');docked=context.dockedBrowser;}if(!docked)throw Error('The browser could not open.');binding.browserId=docked.browserId;delete binding.threadId;delete binding.projectId;}
    if(kind==='terminal')binding.terminalId=crypto.randomUUID();
    if(customDock&&kind!=='browser'&&!owner)throw Error('Choose a conversation for this tool.');
    if(kind==='artifact'&&!binding.artifactId){const artifact=snapshotRef.current.artifacts.find(item=>item.threadId===owner?.id&&item.lifecycle==='active');if(!artifact)throw Error('This conversation has no active artifact.');binding.artifactId=artifact.id;}
    const view:SurfaceRef={id:kind==='browser'?'browser:'+binding.browserId:kind+':'+(owner?.id??'workspace')+(kind==='terminal'?':'+binding.terminalId:''),kind,binding};
    await prepareWorkspace();
    const existing=Object.values(current.views).find(value=>sameSplitWorkspaceView(value,view));
    if(existing)view.id=existing.id;else if(binding.artifactId||binding.resourceId)view.id=kind+':'+crypto.randomUUID();
    const bounds=document.querySelector(customDock?'.custom-tools-dock':'.split-root-workarea')?.getBoundingClientRect(),next=toolPlacementCommand(current,view,paneId,beside,{width:bounds?.width??window.innerWidth,height:Math.max(0,bounds?.height??window.innerHeight)});
    await splitState.send(next.type,{...next.payload,...(preserveFocus?{preserveFocus:true}:{})});
    if(customDock)setLayout(value=>({...value,rightPanelOpen:true}));
  };
  const revealWorkspaceTool=(kind:typeof layout.activeTab,resourceId?:string,artifactId?:string)=>{
    if(customDock){void openSplitTool(kind,undefined,false,thread?.id,false,{authority:{kind:'local'},...(thread?{threadId:thread.id,...(thread.projectId?{projectId:thread.projectId}:{})}:{}),...(resourceId?{resourceId}:{}),...(artifactId?{artifactId}:{})}).catch(cause=>setError(messageOf(cause)));return;}
    if(resourceId)setFocusedResource(resourceId);
    setLayout(value=>({...value,rightPanelOpen:true,activeTab:kind,...(artifactId!==undefined?{activeArtifactId:artifactId||null}:{})}));
  };
  const openManualBrowser=async(url:string)=>{
    if(!desktop||desktop.context.surface.kind!=='main')throw Error('Open the browser from the desktop workspace.');
    const owner=desktop.context.windowId;
    await prepareWorkspace();
    const checkOwner=async()=>{const current=await desktop.bridge.getContext();if(current.windowId!==owner||current.surface.kind!=='main')throw Error('The owning workspace changed.');};
    await checkOwner();
    if(splitEnabled&&splitState.layout)await openSplitTool('browser');else await desktop.bridge.browser({type:'open'});
    await checkOwner();
    if(url)await desktop.bridge.browser({type:'navigate',url});
  };
  useEffect(()=>{
    if(!splitEnabled||!splitState.layout||!thread||!selectedPlan?.plan)return;
    const owningPane=Object.values(splitState.layout.panes).find(pane=>pane.activeViewId&&splitState.layout!.views[pane.activeViewId]?.kind==='thread'&&splitState.layout!.views[pane.activeViewId]?.binding.threadId===thread.id);if(!owningPane)return;
    const token=thread.id+':'+selectedPlan.revision;if(openedPlanRevision.current.has(token))return;
    openedPlanRevision.current.add(token);
    const current=splitState.layout,existing=Object.values(current.views).find(view=>view.kind==='plan'&&view.binding.threadId===thread.id);
    const location=existing?Object.values(current.panes).find(pane=>pane.viewIds.includes(existing.id)):undefined;
    const reveal=async()=>{if((document.querySelector('.split-root-workarea')?.getBoundingClientRect().width??window.innerWidth)<700)return;if(existing&&location){if(location.collapsed)await splitState.send('pane.collapse',{paneId:location.id,collapsed:false});else if(location.activeViewId!==existing.id)await splitState.send('view.activate',{paneId:location.id,viewId:existing.id,preserveFocus:true});}else await openSplitTool('plan',owningPane.id,true,thread.id,true);};
    void reveal().catch(cause=>{openedPlanRevision.current.delete(token);setError(messageOf(cause));});
  },[splitEnabled,splitState.layout,thread?.id,selectedPlan?.revision]);
  const openInbox=async(paneId=splitState.layout?.focusedPaneId)=>{if(!paneId)return;await prepareWorkspace();await splitState.send('view.open',{paneId,view:{id:'inbox:personal',kind:'workspace',binding:{authority:{kind:'local'},resourceId:'agent-inbox'}}});};
  useEffect(()=>{if(embeddedThreadId)return;return desktop?.bridge.onAttentionOpen?.(id=>select(id));},[desktop?.bridge,embeddedThreadId]);
  const renderSplitView=(view:SurfaceRef,active:boolean)=>{
    if(view.binding.authority.kind!=='local')return <p className="panel-note">This view belongs to another installed workspace.</p>;
    if(customDock&&view.kind!=='browser'&&!view.binding.threadId)return <p className="panel-note">Restore this tool from its owning conversation.</p>;
    if(customDock&&view.kind==='thread')return <div className="panel-note"><button onClick={()=>select(view.binding.threadId??null)}>Open conversation</button></div>;
    if(view.kind==='thread')return <div className="split-thread-owner" onFocusCapture={()=>focusSplitOwner(view)}>{view.binding.threadId?<App embeddedThreadId={view.binding.threadId} embeddedActive={active} onRequestThread={select}/>:<p>The owning conversation is unavailable.</p>}</div>;
    if(view.kind==='workspace'&&view.binding.resourceId==='agent-inbox')return <AgentInbox active={active} onOpenThread={select}/>;
    if(view.kind==='plan')return <PlanStatus snapshot={snapshot} threadId={view.binding.threadId}/>;
    const panel:PanelPlacement={...view,canvasId:activeCanvas?.id??'workspace-default',placement:'canvas',visible:true,collapsed:false,bounds:{x:0,y:0,width:480,height:380},order:0,alwaysOnTop:false};return canvasBody(panel,active);
  };
  const splitRoot=splitEnabled&&!customDock&&Boolean(thread||splitState.layout&&Object.keys(splitState.layout.views).length);
  const contextSummaries=<SummaryDock><DockedSummary id="plan" title="Project overview" className="summary-overview" open={!detachedPlan}
    defaultCollapsed focusOnOpen={false} expandRequest={planExpandRequest||undefined}><ProjectContextSurface key={thread?.id??'new'} thread={thread} snapshot={snapshot} onOpenDetailedPlan={()=>void openSplitTool('plan',undefined,true,thread?.id).catch(cause=>setError(messageOf(cause)))} onSelectThread={select} onShowChanges={()=>void openSplitTool('diff',undefined,true,thread?.id).catch(cause=>setError(messageOf(cause)))} onConnect={()=>openProjectConnect({threadId:thread?.id,projectId:thread?.projectId})}/></DockedSummary><UsageFooter threadId={thread?.id} usage={thread?snapshot.usage[thread.id]:undefined} visible={preferences.showUsageFooter} onOpenUsage={()=>openUsage()}/></SummaryDock>;
  const renderSplitRoot=()=>splitState.layout?<div className="split-root-workarea"><SummaryLayout active={!detachedPlan||preferences.showUsageFooter} summaries={contextSummaries}><WorkspaceSplitLayout layout={splitState.layout} onCommand={sendSplitCommand} prepare={prepareWorkspace} renderView={renderSplitView} title={view=>view.kind==='thread'?snapshot.threads.find(item=>item.id===view.binding.threadId)?.title??'Unavailable conversation':view.kind==='workspace'&&view.binding.resourceId==='agent-inbox'?'Agent inbox':panelLabels[view.kind]} onDropThread={placeSplitThread} editorOptions={['thread','browser','files','diff','notes','plan','terminal','linked-pull-requests','context','usage','inbox'].map(id=>({id,title:id==='inbox'?'Agent inbox':panelLabels[id as WorkspacePanelKind]}))} onSelectEditor={(kind,paneId)=>kind==='inbox'?openInbox(paneId):openSplitTool(kind as WorkspacePanelKind,paneId)}/></SummaryLayout>{splitState.error&&!layoutChooserOpen&&<p className="split-layout-error" role="alert">{splitState.error}</p>}</div>:<LoadingState pending hasContent={false} label="Opening workspace layout..." skeleton={<WorkspaceSkeleton sidebar={false}/>} className="view-loading-state"/>;
  const interfaceFont = preferences.interfaceFont === 'system' ? '-apple-system, BlinkMacSystemFont, "Inter Variable", "Segoe UI", system-ui, sans-serif' : preferences.interfaceFont === 'Inter' ? '"Inter Variable", sans-serif' : preferences.interfaceFont;
  const handledHostIntent=useRef<number|undefined>(undefined),[modelPickerRequest,setModelPickerRequest]=useState<{id:number;threadId?:string}>();
  useEffect(()=>{
    if(!loaded||!host?.intent||handledHostIntent.current===host.intent.id)return;
    handledHostIntent.current=host.intent.id;
    if(host.intent.kind==='settings'){setSettingsSection('general');setSettingsOpen(true);}
    else if(host.intent.kind==='model')setModelPickerRequest({id:host.intent.id,threadId:host.initialThreadId??thread?.id});
    else if(host.intent.kind==='usage'){setUsageThreadId(thread?.id??null);setUsageOpen(true);}
    else if(host.intent.kind==='new-thread')void newThreadRef.current().catch(cause=>setError(messageOf(cause)));
    else if(host.intent.kind==='connect-project')setProjectConnectOpen(true);
    else if(host.intent.kind==='resources')void ensureThread(async()=>{}).then(id=>openResourcePicker(id)).catch(cause=>setError(messageOf(cause)));
    else openSidebarTool('linked-pull-requests');
    host.consumeIntent(host.intent.id);
  },[loaded,host?.intent?.id]);
  const promptFont = preferences.promptFont === 'system' ? 'inherit' : preferences.promptFont;
  const rightWindowOpen=layout.rightPanelOpen||sideOpen||Boolean(documentWindow&&documentWindow.placement==='docked')||Boolean(desktop?.state.dockedBrowser);
  const shellStyle = { '--sidebar-width': layout.sidebarWidth + 'px', '--right-panel-width': panelWidth + 'px', '--panel-motion': (preferences.panelAnimations ? preferences.motionDuration : 0) + 'ms', '--prompt-font': promptFont, '--code-font': preferences.codeFont, '--interface-font': interfaceFont, '--interface-font-size': preferences.fontSize + 'px' } as CSSProperties;
  if(loaded&&pinnedThreadId&&!thread)return <main className="desktop-surface"><p role="alert">The owning conversation is no longer available. Dock this window to choose another task.</p></main>;
  return <WorkspaceProvider value={workspaceContext}><div className={`app-shell ${embeddedThreadId?'embedded-thread-app':''} ${navigationOnly?'desktop-navigation-only':''} ${pinnedThreadId?'desktop-thread-only':''} ${layout.rightPanelOpen ? 'has-right-panel' : ''} `} inert={desktop?.closing||Boolean(embeddedThreadId&&!embeddedActive)} style={shellStyle} data-document-docked={documentWindow?.placement==='docked'} data-sidebar-collapsed={layout.sidebarCollapsed} data-chat-width={preferences.chatWidth} data-contrast={preferences.contrast} data-word-wrap={preferences.wordWrap} data-panel-animations={preferences.panelAnimations} data-live-usage={preferences.showUsageFooter}>
    {sidebarOpen && <button ref={sidebarScrim} className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
    {!pinnedThreadId&&!detachedNavigation&&<ShellSidebar onPlaceThread={splitEnabled&&!customDock?item=>void placeSplitThread(item.id).catch(cause=>setError(messageOf(cause))):undefined} navigation={plugins.length>0&&<nav className="plugin-navigation" aria-label="Installed plug-ins">{plugins.map(plugin=><button key={plugin.id} aria-current={selectedPluginId===plugin.id?'page':undefined} onClick={()=>{void selectPlugin(plugin.id).then(()=>setSidebarOpen(false)).catch(cause=>setError(messageOf(cause)));}}>{plugin.name}</button>)}</nav>} elementRef={sidebar} searchRef={searchRef} mobile={mobile} open={sidebarOpen} layout={layout} preferences={preferences} matching={matching} hoverBlocked={Boolean(settingsOpen||usageOpen||projectPicker||projectConnectOpen||resourcePicker||rename)} onOpenThreadPR={host?.openReview?(target,scope)=>{void host.openReview!(target,scope).catch(cause=>setError(messageOf(cause)));}:undefined} selectedId={thread?.id} loaded={loaded} creating={composerBusy || threadCreating} search={search} setSearch={setSearch} close={() => setSidebarOpen(false)} toggleCollapsed={() => navigationOnly?void desktop?.bridge.reattach():setLayout(value => ({ ...value, sidebarCollapsed: !value.sidebarCollapsed }))} setFolded={(key, folded) => setLayout(value => ({ ...value, folded: { ...value.folded, [key]: folded } }))} select={select} create={() => void newThreadRef.current().catch(error => setError(messageOf(error)))} settings={() => { setSettingsSection('general'); setSettingsOpen(true); }} onOpenPullRequests={()=>openSidebarTool('linked-pull-requests')} onOpenUsage={()=>openSidebarTool('usage')} rename={item => { select(item.id); setTitle(item.title); setRename(true); }} archive={id => void archive(id)} presentation={(item, patch) => { if (patch.pinned === false && preferences.unpinConfirmation && !window.confirm('Unpin this thread?')) return; void command('thread.presentation', patch, item.id).then(() => refresh()).catch(error => setError(messageOf(error))); }} />}
    {!navigationOnly&&!pinnedThreadId&&!detachedNavigation&&!mobile && !layout.sidebarCollapsed && <ResizeHandle label="Resize sidebar" value={layout.sidebarWidth} minimum={200} maximum={380} side="left" change={sidebarWidth => setLayout(value => ({ ...value, sidebarWidth }))} />}
    {!navigationOnly&&<div className="workspace-layout-workarea">{!pinnedThreadId&&!detachedNavigation&&(layout.sidebarCollapsed||mobile)&&<button type="button" className="icon-button sidebar-recovery" aria-label={mobile?"Open navigation":"Open sidebar"} aria-expanded={mobile?sidebarOpen:false} onClick={()=>{setLayout(value=>({...value,sidebarCollapsed:false}));if(mobile)setSidebarOpen(true);requestAnimationFrame(()=>searchRef.current?.focus());}}>{mobile?<Menu size={18}/>:<PanelLeftOpen size={17}/>}</button>}{!pinnedThreadId&&<WorkspaceControls onChoosePreset={host?.choosePreset} pluginWorkspaces={pluginWorkspaces} selectedPluginWorkspace={selectedPluginWorkspace} onSelectPluginWorkspace={(pluginId,id)=>void selectPluginWorkspace(pluginId,id).catch(cause=>setError(messageOf(cause)))} onSelectBuiltin={()=>{setSelectedPluginId(null);setSelectedPluginWorkspace(null);setWorkspaceMode('chat');}} workspaceMode={workspaceMode} onWorkspaceMode={setWorkspaceMode} retainedWorkspace={retainedWorkspace} retainedAvailable={activeCanvas?.preset==='workspace'&&activeCanvas.panels.length>0} onLayoutOpenChange={setLayoutChooserOpen} splitProfiles={splitProfiles.profiles} splitLayout={splitState.layout} splitProfilesLoading={splitProfiles.loading} splitProfilesError={splitProfiles.error} refreshSplitProfiles={splitProfiles.refresh} saveSplitProfile={savedLayoutActions.save} applySplitProfile={savedLayoutActions.apply} renameSplitProfile={savedLayoutActions.rename} removeSplitProfile={savedLayoutActions.remove} splitWorkspace={splitEnabled} activeBinding={thread?{authority:{kind:'local'},threadId:thread.id,...(thread.projectId?{projectId:thread.projectId}:{})}:undefined} envelope={workspaceEnvelope} error={workspaceState.error} onActionError={setError} send={workspaceState.send} prepare={prepareWorkspace} panels={canvasPanels} title={panelTitle} addPanel={customDock?kind=>openSplitTool(kind):addCanvasPanel} updatePanel={updateCanvasPanel}/>} {error && <div className="workspace-error" role="alert">{error}<button className="quiet" onClick={() => { setError(''); void bootstrap().then(() => refresh()).then(() => { setLoaded(true); return loadModels(); }).catch(error => setError(messageOf(error))); }}>Refresh</button><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={15} /></button></div>} <div className="personal-workarea" hidden={Boolean(selectedPluginId)}> {canvasActive?renderWorkspaceCanvas():splitRoot?renderSplitRoot():<div className="shell-workarea" ref={setPanelOwner} data-tool-layout={panelBounds.stacked?'stacked':'side'}>
    <SummaryLayout active={!embeddedThreadId&&!rightWindowOpen&&(!detachedPlan||preferences.showUsageFooter)} summaries={!embeddedThreadId&&<SummaryDock><DockedSummary id="plan" title="Project overview" className="summary-overview" open={!detachedPlan&&!rightWindowOpen}
      defaultCollapsed focusOnOpen={planFocusOnOpen} expandRequest={planExpandRequest||undefined}><ProjectContextSurface key={thread?.id??'new'} thread={thread} snapshot={snapshot} planOpen={planOpen} onOpenDetailedPlan={()=>revealWorkspaceTool('plan')} onTogglePlan={()=>{if(planOpen)dismissPlan();else{planVisibility.show(thread);setPlanFocusOnOpen(false);setPlanExpandRequest(value=>value+1);setPlanOpen(true);}}} onSelectThread={select} onShowChanges={()=>revealWorkspaceTool('diff')} onConnect={()=>openProjectConnect({threadId:thread?.id,projectId:thread?.projectId})}/></DockedSummary><UsageFooter threadId={thread?.id} usage={thread?snapshot.usage[thread.id]:undefined} visible={preferences.showUsageFooter&&!rightWindowOpen} onOpenUsage={()=>openUsage()}/></SummaryDock>}>
    <main className="workspace"><header className="workspace-header"><div className="breadcrumb">{thread?.projectName && <><Folder size={13} /><span>{thread.projectName}</span><span className="breadcrumb-slash">/</span></>}<strong>{thread?.title ?? 'New conversation'}</strong></div><div className="header-actions">{!online&&<span className="connection-state" title="Reconnecting to host events"><WifiOff size={13}/>Reconnecting</span>}{!embeddedThreadId&&<button type="button" className={`icon-button workspace-panel-toggle ${layout.rightPanelOpen ? 'selected' : ''}`} aria-label={layout.rightPanelOpen ? 'Hide workspace panel' : 'Open workspace panel'} aria-pressed={layout.rightPanelOpen} title={layout.rightPanelOpen ? 'Close right panel' : 'Open right panel'} onClick={() => setLayout(value => value.rightPanelOpen ? { ...value, rightPanelOpen: false, rightPanelMaximized: false } : { ...value, rightPanelOpen: true })}><PanelRight size={17} /></button>}</div></header>
      
      {Object.values(dirtyWidgets).some(id => id !== thread?.id) && <div className="workspace-error retained-widget-notice"><span>Widget edits are kept open in another thread.</span><button className="quiet" onClick={() => setDirtyWidgets(previous => Object.fromEntries(Object.entries(previous).filter(([, id]) => id === thread?.id)))}>Discard hidden widget edits</button></div>}
      {detachedThread&&<div className="notice">This conversation is open in another window.<button className="quiet" onClick={()=>void desktop?.bridge.focus(detachedThread.id)}>Focus chat</button></div>}<div className="conversation-frame"><ChatScrollIndicator scrollRef={conversation} controllerRef={conversationMotion} contentKey={thread?.id}/><div inert={threadHeld} ref={conversation} className="conversation-scroll" onScroll={rememberPosition} aria-label="Conversation" tabIndex={0}>{[thread, ...snapshot.threads.filter(item => item.id !== thread?.id && Object.values(dirtyWidgets).includes(item.id))].toSorted((a, b) => (a?.createdAt ?? '').localeCompare(b?.createdAt ?? '') || (a?.id ?? '').localeCompare(b?.id ?? '')).map(panelThread => {
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
        {!loaded && !error && <LoadingState pending hasContent={false} label="Opening your workspace…" skeleton={<ConversationSkeleton/>}/>}
        {loaded && !messages.length && !artifacts.length && <div className="empty-state"><div className="empty-symbol"><MessageSquare size={25} strokeWidth={1.25} /></div><h1>What are we working on?</h1><p>Start with a question, a file, or a project.<br />Your conversation becomes the workspace.</p>{!models.length && <button className="setup-inline" onClick={() => { setSettingsSection('providers'); setSettingsOpen(true); }}><CircleHelp size={15} /><span>Connect a model to get started</span><ChevronRight size={14} /></button>}</div>}
        {historyStart > 0 && <button className="load-history quiet" onClick={() => { if (conversation.current) historyAnchor.current = { height: conversation.current.scrollHeight, top: conversation.current.scrollTop }; historyStarts.current.set(historyId, Math.max(0, historyStart - 100)); setHistoryCounts(previous => ({ ...previous, [historyId]: (previous[historyId] ?? 0) + 1 })); }}>Load earlier messages</button>}
        {messageRows.map(({ message, updates }) => <div key={message.id} className={`message message-${message.role}`}><div className="message-content">{updates ? <WorkActivity updates={updates} /> : message.role==='assistant'?<AssistantProse message={message} arrivals={liveMessages.current} active={Boolean(thread?.runId&&thread.runId===message.runId)} />:<Markdown text={message.content} />}</div>{artifacts.filter(artifact => artifact.messageId === message.id).map(artifact => <Artifact key={artifact.id} artifact={artifact} snapshot={snapshot} theme={theme} refresh={refresh} onDirtyWidget={onDirtyWidget} suspended={threadHeld} active={thread?.id===(snapshot.threads.find(item=>item.id===selectedId)??snapshot.threads.find(item=>item.id===snapshot.activeThreadId))?.id} animateEntry={liveEntries.current.has(artifact.id)} />)}</div>)}
        {artifacts.filter(artifact => !messages.some(message => message.id === artifact.messageId)).map(artifact => <Artifact key={artifact.id} artifact={artifact} snapshot={snapshot} theme={theme} refresh={refresh} onDirtyWidget={onDirtyWidget} suspended={threadHeld} active={thread?.id===(snapshot.threads.find(item=>item.id===selectedId)??snapshot.threads.find(item=>item.id===snapshot.activeThreadId))?.id} animateEntry={liveEntries.current.has(artifact.id)} />)}
        {requests.map(request => <InputDecision key={request.presentation?`${request.id}:${JSON.stringify(request.responseSchema)}`:`${request.id}:${request.revision}`} request={request} snapshot={snapshot} refresh={refresh} />)}{operations.map(operation => <OperationDecision key={`${operation.id}:${operation.revision}`} operation={operation} refresh={refresh} />)}
        {thread?.error && <p className="notice" role="alert">{thread.error}</p>}
        {thread && ['stopped', 'interrupted', 'failed'].includes(thread.status) && <div className="resume-row"><span>{thread.status === 'interrupted' ? 'This session was interrupted.' : thread.status === 'stopped' ? 'Agent stopped. Your work is saved.' : 'The agent could not finish this run.'}</span><button className="secondary" disabled={!modelId} title={!modelId ? 'Choose an available model before resuming.' : undefined} onClick={() => void journalRead<string>('thinking:'+thread.id).then(level=>command('run.resume', {modelId,thinkingLevel:level===undefined?(thread.thinkingLevel??null):(level||null)}, thread.id)).then(() => refresh()).catch(error => setError(messageOf(error)))}>Resume<ChevronRight size={13} /></button></div>}
        {thread && (thread.runId || thread.status === 'working') && <div className="working-status" role="status"><LoaderCircle size={13} className="spinning" /><span>{snapshot.usage[thread.id]?.activity === 'compacting' ? 'Compacting context…' : 'Working…'}</span><button className="quiet" onClick={() => void stopConversation(thread, host?.composers).then(() => refresh()).catch(error => setError(messageOf(error)))}>Stop</button></div>}
      </div></div>; })}</div></div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
      {latestAvailable && <button className="jump-latest secondary" onClick={() => { const position=conversationMotion.current?.jump();if(position)readingPositions.current.set(thread?.id??'new',position);setLatestAvailable(false); }}>Jump to latest<ArrowUp size={13} /></button>}
      <div style={{display:'contents'}} inert={threadHeld}>{thread&&delegatedThread(thread)?<div className="canvas-thread-readonly">Read-only delegated transcript - continue in its parent conversation.</div>:loaded&&thread&&threadParent(thread)?<SideThreadComposer key={thread.id} thread={thread} modelId={modelId} refresh={refresh}/>:loaded ? <Composer modelPickerRequest={modelPickerRequest?.threadId===thread?.id?modelPickerRequest?.id:undefined} onModelPickerOpened={id=>setModelPickerRequest(current=>current?.id===id?undefined:current)} sharedComposers={host?.composers} selectProject={openProjectSelection} predictionBlocked={Boolean(embeddedThreadId&&!embeddedActive) || threadHeld || Boolean(projectPicker) || projectConnectOpen || settingsOpen || usageOpen || Boolean(resourcePicker) || rename || (mobile && sidebarOpen)} key={thread?.id ?? 'new'} thread={thread} models={models} modelId={modelId} setModelId={updateModel} snapshot={snapshot} ensureThread={ensureThread} busy={composerBusy || threadCreating} runAction={runComposerAction} refresh={refresh} setup={() => { setSettingsSection('providers'); setSettingsOpen(true); }} openResource={openResourcePicker} browseProject={id=>revealWorkspaceTool('files',id)} inspectChanges={()=>revealWorkspaceTool('diff')} reportError={setError} onSide={async content=>{setSideOpen(true);if(!sideChat.current)throw new Error("The side conversation is still opening.");await sideChat.current.ask(content);}} /> : <div className="composer-dock"><LoadingState pending={!error} hasContent={false} label="Opening conversation…" skeleton={<ComposerSkeleton/>}/></div>}</div>
    </main>
    </SummaryLayout>

    {(customDock||layout.rightPanelOpen||!embeddedThreadId&&Boolean(desktop?.state.dockedBrowser))&&<div className="workspace-tools" hidden={customDock&&!layout.rightPanelOpen}>
    {(customDock||layout.rightPanelOpen) && (customDock?<aside className="custom-tools-dock" aria-label="Custom tools">
      {!panelBounds.stacked&&<ResizeHandle label="Resize workspace panel" value={panelWidth} minimum={panelBounds.minimum} maximum={panelBounds.maximum} side="right" change={rightPanelWidth=>setLayout(value=>({...value,rightPanelWidth}))}/>}
      {splitState.layout?<WorkspaceSplitLayout toolDock layout={splitState.layout} onCommand={sendSplitCommand} prepare={prepareWorkspace} renderView={renderSplitView} title={view=>panelLabels[view.kind]} editorOptions={['files','terminal','browser','diff','plan','notes','artifact','output','pull-request','linked-pull-requests'].map(id=>({id,title:panelLabels[id as WorkspacePanelKind]}))} onSelectEditor={(kind,paneId)=>openSplitTool(kind as WorkspacePanelKind,paneId)}/>:<p role="status" className="panel-note">Opening tools?</p>}
      {splitState.error&&<p className="split-layout-error" role="alert">{splitState.error}<button onClick={()=>void splitState.refresh().catch(cause=>setError(messageOf(cause)))}>Retry</button></p>}
    </aside>:<WorkspacePanel refresh={refresh} snapshot={snapshot} preferredResourceId={focusedResource} threadId={thread?.id} preferences={preferences} layout={layout} close={closePanel} setWidth={rightPanelWidth => setLayout(value => ({ ...value, rightPanelWidth }))} resizeBounds={panelBounds} />)}
    {!embeddedThreadId&&!customDock&&<DesktopBrowserDock/>}
    </div>}
    {thread&&!thread.sideParentId&&<SideChat key={thread.id} ref={sideChat} parent={thread} snapshot={snapshot} modelId={modelId} open={sideOpen} onClose={()=>setSideOpen(false)} refresh={refresh}/>}
    </div>}</div>{openedPlugins.map(id=>{const plugin=plugins.find(value=>value.id===id);return plugin?<PluginFrame key={id} plugin={plugin} projectColors={preferences.projectColors} theme={theme} active={selectedPluginId===id&&!selectedPluginWorkspace}/>:null;})}{openedPluginWorkspaces.map(item=>{const plugin=plugins.find(value=>value.id===item.pluginId),contribution=plugin?.workspaces?.find(value=>value.id===item.workspaceId);return plugin&&contribution?<PluginFrame key={item.pluginId+':'+item.workspaceId} plugin={plugin} projectColors={preferences.projectColors} workspace={contribution} theme={theme} active={selectedPluginWorkspace===item.pluginId+':'+item.workspaceId}/>:null;})}</div>}
    {pluginCatalog.error&&<div className="shell-notice" role="alert">{pluginCatalog.error}</div>}
    {notice && <div className="shell-notice" role="status"><span>{notice}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={14} /></button></div>}
    {confirmArchive && <Dialog title="Archive thread?" close={() => setConfirmArchive(null)}><p>The saved conversation will move to Archive in Settings. Restore it there whenever you need it.</p><footer className="dialog-actions"><button className="quiet" onClick={() => setConfirmArchive(null)}>Cancel</button><button className="primary" onClick={() => { const id = confirmArchive; setConfirmArchive(null); void archive(id, false, true); }}>Archive thread</button></footer></Dialog>}
    {archiveThread && <Dialog title="Uncheckpointed widget edits" close={() => setArchiveThread(null)}><p>Checkpoint your widget edits before archiving this thread, or explicitly discard them.</p><footer className="dialog-actions"><button className="secondary" onClick={() => { select(archiveThread); setArchiveThread(null); }}>Return to checkpoint</button><button className="quiet" onClick={() => void archive(archiveThread, true)}>Discard edits and archive</button></footer></Dialog>}
    {resourcePicker && <ResourcePicker threadId={resourcePicker} opener={resourcePickerOpener.current} close={() => setResourcePicker(null)} refresh={refresh} />}
    {projectPicker&&<ProjectPicker open authority={{kind:'local'}} projects={workspaceEnvelope?.projects??[]} selectedProjectId={snapshot.threads.find(value=>value.id===projectPicker.threadId)?.projectId}
      recentProjectIds={[...new Set([...snapshot.threads].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).flatMap(value=>value.projectId?[value.projectId]:[]))]}
      colors={preferences.projectColors} busy={projectPicking} error={projectPickerError} onClose={closeProjectSelection} onSelect={pickProject} onColorChange={saveProjectColor}
      onAddProject={()=>{projectConnectPicker.current=projectPicker;setProjectPicker(null);openProjectConnect({});}}/>}
    {projectConnectOpen&&<Dialog title="Connect project" close={closeProjectConnect}><form onSubmit={event=>{event.preventDefault();const target=projectConnectTarget.current;void prepareWorkspace().then(()=>{if(target?.projectId&&snapshotRef.current.threads.find(item=>item.id===target.threadId)?.projectId!==target.projectId)throw Error('The owning project changed. Close this dialog and reopen it from that conversation.');return workspaceState.send('workspace.project.connect',{name:projectName,path:projectPath,...(target?.threadId?{threadId:target.threadId}:{})}).then(async()=>{if(target?.threadId)await reconcileSplitThreadProject(target.threadId);});}).then(async()=>{await refresh();closeProjectConnect();}).catch(cause=>setError(messageOf(cause)));}}><label className="field">Project name<input required maxLength={100} value={projectName} onChange={event=>setProjectName(event.target.value)}/></label><label className="field">Local folder<input required value={projectPath} onChange={event=>setProjectPath(event.target.value)} placeholder="C:\Projects\My project"/></label><footer className="dialog-actions"><button type="button" className="quiet" onClick={closeProjectConnect}>Cancel</button><button className="primary" disabled={!projectName.trim()||!projectPath.trim()}>Connect project</button></footer></form></Dialog>}
    <UsageDialog open={usageOpen} onClose={()=>setUsageOpen(false)} reports={usageReport?[usageReport]:[]} onRefresh={refresh}/>
    {settingsOpen && <SettingsWindow openBrowser={desktop?.context.surface.kind==='main'?openManualBrowser:undefined} environmentSettings={<EnvironmentSettings/>} initialSection={settingsSection} snapshot={snapshot} modelError={modelError} refresh={refresh} loadModels={loadModels} close={() => setSettingsOpen(false)} addResource={() => { setSettingsOpen(false); void ensureThread(async () => {}).then(id=>openResourcePicker(id)).catch(error => setError(messageOf(error))); }} />}
    {rename && thread && <Dialog title="Rename thread" close={() => setRename(false)}><form onSubmit={event => { event.preventDefault(); void command('thread.rename', { title: title.trim() }, thread.id).then(async () => { await refresh(); setRename(false); }).catch(error => setError(messageOf(error))); }}><label className="field">Thread name<input autoFocus required value={title} maxLength={180} onChange={event => setTitle(event.target.value)} /></label><footer className="dialog-actions"><button type="button" className="quiet" onClick={() => setRename(false)}>Cancel</button><button className="primary" disabled={!title.trim()}>Save name</button></footer></form></Dialog>}
  </div></WorkspaceProvider>;
}
