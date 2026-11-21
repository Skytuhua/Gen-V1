import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useMemo, useSyncExternalStore, type ComponentProps, type CSSProperties, type ReactNode } from 'react';
import { Activity, ArrowUp, Bot, Check, ChevronDown, ChevronRight, CircleHelp, CircleStop, Folder, Laptop, LoaderCircle, Menu, MessageSquare, PanelLeftOpen, PanelRight, PenLine, Plus, SlidersHorizontal, WifiOff, X } from 'lucide-react';
import type { InputRequest, ModelInfo, Operation, Snapshot, Thread,Message } from '../../../packages/contracts';
import { ApiError, bootstrap, command, getModels, getSnapshot, getThreadMessages, getToolEffectObservation, searchThreadMessages, subscribe, type ToolEffectObservation } from './api';
import {onAccountCatalogChanged,notifyAccountCatalogChanged,mergeAccountModels} from './account-api';
import type {AccountAuthTarget} from '../../../packages/contracts/authentication';
import {isConnectionProviderId} from '../../../packages/contracts/connections';
import { applyRuntimeEvent } from './snapshot-events';
import { journalCompareAndSwap, journalGeneration, journalRead, journalReadRecord, journalSubscribe, journalWrite } from './journal';
import {SavedDrafts} from './SavedDrafts';
import {SourceWorkbenchProvider, SourceMessage, WorkbenchComposer, useSourceWorkbench} from './SourceWorkbench';
import {prepareSourceOwnerHandoff} from './workbench-recovery';
import {useProjectContext} from './project-api';
import { Artifact } from './Artifact';
import { Markdown } from './Markdown';
import {CopyButton} from './CopyButton';
import { groupWorkActivity, WorkActivity } from './WorkActivity';
import { display, schemaDefaults, SchemaFields } from './registry';
import { useModalRegion } from './focus';
import { validateSchema } from './schema-validator';
import { matchingThreads, type HistoricalThreadMatches } from './thread-search';
import { hasPendingDocumentAssets } from './signature-assets';
import { getPreferences, mergePreferences } from '../../../packages/contracts/preferences';
import { ShellSidebar, threadStatus } from './ShellSidebar';
import { ProjectPicker } from './ProjectPicker';
import { projectColorKey } from './project-colors';
import { useShellLayout, matchesShortcut } from './shell-layout';
import {useSidebarCollapse} from './sidebar-collapse';
import {sameSplitWorkspaceView,createSplitWorkspaceLayout,applySplitWorkspaceCommand} from '../../../packages/core/split-workspace-layout';
import { ResizeHandle, WorkspacePanel } from './WorkspacePanel';
import { VerificationPanel } from './VerificationPanel';
import { ControlConsentPanel } from './ControlConsentPanel';
import { ToolProgramPanel } from './ToolProgramPanel';
import { WorkspaceProvider, type WorkspaceContextValue } from './workspace-context';
import './shell.css';
import './connections.css';
import { ContextInspector } from './ContextInspector';
import {useProjectMemoryPreparation} from './useProjectMemoryPreparation';
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
import {SurfaceBoundary} from './SurfaceBoundary';
import {ComposerSkeleton, ConversationSkeleton, SettingsSkeleton, WorkspaceSkeleton} from './ViewSkeletons';
import {ComposerAttachments} from './ComposerAttachments';
import {Modal} from '../../../packages/ui-shell/Modal';
import {SessionBranchLineage, SessionBranchMenu, useSessionBranchOverview} from './SessionBranchMenu';
import {toast,Toaster} from '../../../packages/ui-shell/Toast';
import {TooltipLayer} from '../../../packages/ui-shell/Tooltip';
import {reducedMotion} from './task-motion';
import {Select} from '../../../packages/ui-shell/Select';
import {PluginFrame,usePluginCatalog} from './PluginFrame';
import {recordedChangeSummary} from './composer-evidence';
import {useDesktop,useDesktopCloseGuard,useDesktopReady,useDetachedSurface,usePendingSurface,detachedSurface,pendingSurface} from './desktop-context';
import {DesktopBrowserDock} from './DesktopBrowser';
import {journalFlush} from './journal';
import {prepareEditorHandoff} from './editor-handoff';
import {SideChat,type SideChatHandle} from './SideChat';
import {ChatView} from '../../../packages/ui-shell/ChatView';
import {createConversationScroll,createHistoryAnchor} from './conversation-scroll';
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
import type {SplitDropEdge,SplitWorkspaceLayout} from '../../../packages/contracts/split-workspace.ts';
import {WorkspaceSplitLayout} from './WorkspaceSplitLayout';
import {getSplitWorkspace,sendSplitWorkspaceCommand,useSplitWorkspaceState} from './split-workspace-api';
import {readConversationPlacement,capturePlacementExpectation,expectationHolds,resolveMainPaneId,planVisible,conversationPlacementKey,type ConversationPlacementRecord,type PendingPlacementIntent,type MainBasis} from './conversation-placement';
import {clampChatRect,type ChatRect} from '../../../packages/ui-shell/chat-layout.ts';
import {useSplitWorkspaceProfiles,useSplitLayoutProfileActions} from './split-workspace-profiles';
import {threadPlacementCommand,threadReconciliationCommand} from './split-thread-placement';
import {toolPlacementCommand} from './split-tool-placement';
import {useAppearance} from './useAppearance';
import {EnvironmentSettings} from './EnvironmentSettings';
import {PlanStatus} from './PlanStatus';
import './workspace-integration.css';
import {AgentInbox} from './AgentInbox';
import {BackgroundWork} from './BackgroundWork';
import {ConversationFind} from './ConversationFind';
import {canLoadConversationHistory} from './conversation-find';
import {changeTerminalExcerpts,clearAcceptedExcerpts,editTerminalExcerpt,excerptDraftKey,readTerminalExcerpts,serializeTerminalExcerpts,type TerminalExcerpt} from './terminal-excerpts';
import type {TerminalExcerptComposer} from './TerminalBody';
import {WorkspaceSurfaceBody, type ReviewRequest} from './WorkspaceSurfaceBody';
import {ProjectContextSurface} from './ProjectContextSurface';
import {DesktopBrowserSlot,DesktopBrowserToolbar} from './DesktopBrowser';
import {ErrorState} from '../../../packages/ui-shell/Feedback';
import {OperationProjectTrust, OperationProjectTrustStatus, type ProjectTrustReadiness} from './OperationProjectTrust';
import { OperationExecutionReviewPanel } from './OperationExecutionReview';

type SettingsComponent = typeof import('./Settings').Settings;
let loadedSettings: SettingsComponent | undefined;

const readPlacementRaw=(workspaceId:string):string|null=>{try{return localStorage.getItem(conversationPlacementKey(workspaceId));}catch{return null;}};
const writePlacementRecord=(record:ConversationPlacementRecord)=>{try{localStorage.setItem(conversationPlacementKey(record.workspaceId),JSON.stringify(record));}catch{/* Placement remains usable when storage is unavailable. */}};
const mainBasisOf=(layout:SplitWorkspaceLayout,paneId:string):MainBasis=>({paneId,activeViewId:layout.panes[paneId]?.activeViewId??null,viewIds:[...(layout.panes[paneId]?.viewIds??[])],revision:layout.revision});
const DEFAULT_FLOAT_RECT:ChatRect={x:48,y:48,width:480,height:680};

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
  return <Modal open title="Settings" onClose={props.close} className="settings-dialog">{Settings ? <Settings {...props} /> : <>{error ? <ErrorState message={error} retryLabel="Reload to retry" busy={reloading} onRetry={() => void reload()}/> : <LoadingState pending hasContent={false} label="Opening settings…" skeleton={<SettingsSkeleton/>} className="view-loading-state"/>}</>}</Modal>;
}

const AssistantProse = memo(function AssistantProse({message,arrivals,active}:{message:Message;arrivals:Set<string>;active:boolean}){
  const initial=useRef(arrivals.has(message.id));useEffect(()=>{arrivals.delete(message.id);},[message.id,arrivals]);
  return <Markdown text={message.content} animate={active||initial.current} initialReveal={initial.current}/>;
}, (previous, next) => previous.message === next.message && previous.arrivals === next.arrivals && previous.active === next.active);
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
  return <section className="decision" aria-label={request.title}><header><span className="pending-dot" />{request.title}<span className="badge">Your input</span></header><Markdown text={request.prompt} /><form onSubmit={event => { event.preventDefault(); void respond(); }}><fieldset disabled={busy || !ready}>{objectSchema ? <SchemaFields schema={request.responseSchema} value={values} onChange={update} /> : <SchemaFields schema={{ type: 'object', properties: { response: { ...request.responseSchema, title: 'Response' } }, required: ['response'] }} value={{ response: text }} onChange={value => update(value.response)} />}</fieldset>{error && <p role="status" className="error-text">{error}</p>}<div className="decision-actions"><button type="button" className="quiet" disabled={busy || !ready} onClick={() => void respond(true)}>Withdraw</button><button className="primary" disabled={busy || !ready}>{busy ? 'Submitting…' : 'Continue'}<ArrowUp size={14} /></button></div></form></section>;
}
/** M02 action details drawer: ledger view of one invocation. Uncertain states
 * surface as Inspect outcome / View evidence — never a generic Retry — and the
 * coverage note stays visible while native calls are not host-observed. */
function ActionDetails({ threadId, invocationId, observationKey }: { threadId: string; invocationId: string; observationKey: string }) {
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: ToolEffectObservation; error?: true } | null>(null);
  const requestKey = JSON.stringify([threadId, invocationId, observationKey, attempt]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    getToolEffectObservation(threadId, invocationId)
      .then(data => { if (live) setResult({ key: requestKey, data }); })
      .catch(() => { if (live) setResult({ key: requestKey, error: true }); });
    return () => { live = false; };
  }, [threadId, invocationId, requestKey, open]);
  // A previous owner's result must disappear in the same render as its key
  // changes, before the old request's effect cleanup or the new read completes.
  const current = result?.key === requestKey ? result : null;
  const data = current?.data, effect = data?.effect;
  return <details className="action-details" onToggle={event => {
    const next = event.currentTarget.open;
    setOpen(next);
    if (next) setAttempt(value => value + 1);
  }}><summary>Action details</summary>
    {!current && <p role="status" className="muted">Loading execution evidence…</p>}
    {current?.error && <p role="status" className="error-text">Execution evidence could not be loaded.</p>}
    {data && (effect
      ? <pre>{JSON.stringify({ action: effect.publicRedactedSummary, tool: effect.toolId, targets: effect.targetPreconditions, owner: effect.owner, approval: data.approval ? { id: data.approval.approvalId, issuer: data.approval.issuer, expiresAt: data.approval.expiresAt, remainingUses: data.approval.remainingUses } : effect.approvalId, state: effect.state, receipt: effect.providerReceiptRef, freshness: data.freshness, transitions: effect.transitions, outcome: effect.outcome }, null, 2)}</pre>
      : <p className="muted">No execution-ledger record for this action yet.</p>)}
    {effect?.state === 'UNKNOWN_EXTERNAL_OUTCOME' && <p className="muted">Inspect outcome: view evidence before deciding; this effect has no generic retry.</p>}
    {(data?.coverage ?? []).map(note => <p key={note} className="muted coverage-note">{note}</p>)}
    <button type="button" className="quiet" disabled={!current} onClick={() => setAttempt(value => value + 1)}>Reload evidence</button>
  </details>;
}
function OperationExecutionPolicy({ kind }: { kind: string }) {
  if (kind !== 'repository.test' && kind !== 'integration.context7') return null;
  return <p className="muted" role="note" aria-label="Execution policy"><strong>Unrestricted host</strong>. Uses your local user privileges, including your account's file and network access. This operation has no isolated execution backend.</p>;
}
export function OperationDecision({ operation, refresh, owner }: { operation: Operation; refresh: () => Promise<void>; owner?: Thread }) {
  const observationKey = JSON.stringify([operation.status, operation.approved, owner?.id, owner?.runId ?? null, owner?.epoch, owner?.status, owner?.accountId ?? null, owner?.modelId ?? null, owner?.projectId ?? null, owner?.workspaceId ?? null]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [projectTrust, setProjectTrust] = useState<ProjectTrustReadiness>();
  const trustKey = JSON.stringify([operation.threadId, operation.id, operation.revision, observationKey, owner?.mode, owner?.kind, owner?.sideParentId ?? null]);
  const trustReady = operation.kind !== 'repository.test' || projectTrust?.key === trustKey && projectTrust.allowed;
  const caption = operation.description.replace(/\s+(?:and\s+)?(?:resource\s+)?version\s+[a-f0-9]{64}\b/gi, '').replace(/\bSHA-256\s+[a-f0-9]{64}\b/gi, 'its recorded SHA-256').replace(/\b[a-f0-9]{64}\b/gi, 'its recorded hash').replace(/\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/gi, 'the recorded operation');
  const approve = operation.status === 'prepared' && !operation.approved;
  const reconcile = operation.status === 'unknown';
  const execute = async (type: string) => { if (type === 'operation.approve' && !trustReady) return; setBusy(true); setError(''); try { await command(type, { operationId: operation.id, revision: operation.revision }, operation.threadId); await refresh(); } catch (error) { setError(messageOf(error)); } finally { setBusy(false); } };
  if (operation.status === 'succeeded' || operation.status === 'failed' || operation.status === 'cancelled') {
    const status = operation.status === 'succeeded' ? 'Succeeded' : operation.status === 'failed' ? 'Failed' : 'Cancelled';
    return <section className="decision operation-outcome" data-operation-id={operation.id} data-operation-status={operation.status} aria-label="Operation outcome"><details className="operation-receipt"><summary>
      {operation.status === 'succeeded' ? <Check size={15} aria-hidden="true" /> : operation.status === 'failed' ? <X size={15} aria-hidden="true" /> : <CircleStop size={15} aria-hidden="true" />}
      <span className="operation-outcome-status">{status}</span><span className="operation-outcome-caption">{caption}</span><ChevronDown size={14} className="operation-outcome-chevron" aria-hidden="true" />
    </summary><div className="operation-receipt-evidence"><p>{caption}</p><OperationExecutionPolicy kind={operation.kind}/><details><summary>Changes and preconditions</summary><pre>{JSON.stringify({ description: operation.description, kind: operation.kind, args: operation.args, resources: operation.resourceIds, preconditions: operation.preconditions }, null, 2)}</pre></details>{operation.result !== undefined && <details><summary>Executor result</summary><pre>{display(operation.result)}</pre></details>}{operation.error && <p className="error-text">{operation.error}</p>}<ActionDetails threadId={operation.threadId} invocationId={`operation:${operation.id}@${operation.revision}`} observationKey={observationKey} /><OperationExecutionReviewPanel operation={operation} owner={owner} lazy /></div></details></section>;
  }
  return <section className="decision" data-operation-id={operation.id} aria-label={approve ? 'Operation approval' : 'Operation outcome'}><header><span className="pending-dot" />{reconcile ? 'Inspect uncertain outcome' : approve ? 'Review operation' : 'Operation receipt'}<span className="badge">{approve ? 'Approval needed' : operation.status}</span></header><p>{caption}</p><OperationExecutionPolicy kind={operation.kind}/><details><summary>Changes and preconditions</summary><pre>{JSON.stringify({ description: operation.description, kind: operation.kind, args: operation.args, resources: operation.resourceIds, preconditions: operation.preconditions }, null, 2)}</pre></details>{operation.result !== undefined && <details><summary>Executor result</summary><pre>{display(operation.result)}</pre></details>}{operation.error && <p className="error-text">{operation.error}</p>}<ActionDetails threadId={operation.threadId} invocationId={`operation:${operation.id}@${operation.revision}`} observationKey={observationKey} />{approve && operation.kind === 'repository.test' && <OperationProjectTrust key={trustKey} operation={operation} owner={owner} ownerKey={trustKey} onReady={setProjectTrust}/>}{operation.kind === 'repository.test' && (operation.status === 'running' || operation.status === 'prepared' && operation.approved) && <OperationProjectTrustStatus key={trustKey} operation={operation} owner={owner} ownerKey={trustKey}/>}<OperationExecutionReviewPanel operation={operation} owner={owner} refreshToken={projectTrust}/>{reconcile && <p className="muted">Inspect the actual outcome before resuming. Reconciliation reads evidence without repeating this operation.</p>}{error && <p role="status" className="error-text">{error}</p>}{(approve || reconcile) && <div className="decision-actions">{approve && <button className="quiet" disabled={busy} onClick={() => void execute('operation.reject')}>Decline operation</button>}<button className={approve ? 'primary' : 'secondary'} disabled={busy || approve && !trustReady} onClick={() => void execute(reconcile ? 'operation.reconcile' : 'operation.approve')}>{busy ? 'Checking…' : reconcile ? 'Inspect outcome' : 'Approve operation'}{approve && <Check size={14} />}</button></div>}</section>;
}

function ResourcePicker({ threadId, close, refresh, opener }: { threadId: string; close: () => void; refresh: () => Promise<void>; opener: HTMLElement | null }) {
  useEffect(() => () => { requestAnimationFrame(() => { if (opener?.isConnected && document.activeElement === document.body) opener.focus({ preventScroll: true }); }); }, [opener]);
  const [path, setPath] = useState('');
  const [kind, setKind] = useState('project');
  const [writable, setWritable] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <Dialog title="Add a resource" close={close}><p className="muted">Choose a local file, project, or SQLite database for this thread. Access is scoped to the path you grant.</p><form onSubmit={event => { event.preventDefault(); setBusy(true); void command('resource.grant', { path, kind, writable }, threadId).then(async () => { await refresh(); close(); }).catch(error => setError(messageOf(error))).finally(() => setBusy(false)); }}><label className="field">Resource type<Select aria-label="Resource type" value={kind} onValueChange={setKind} options={[{value:"project",label:"Project folder"},{value:"file",label:"File"},{value:"database",label:"SQLite database"},{value:"export",label:"Export folder"}]}/></label><label className="field">Absolute local path<input autoFocus required value={path} onChange={event => setPath(event.target.value)} placeholder="C:\Users\you\Documents\project" /></label><label className="check-field"><input type="checkbox" checked={writable} onChange={event => setWritable(event.target.checked)} />Allow approved changes</label><p className="muted">Mutations still require approval for each prepared operation.</p>{error && <p role="alert" className="error-text">{error}</p>}<footer className="dialog-actions"><button type="button" className="quiet" onClick={close}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Granting…' : 'Add resource'}</button></footer></form></Dialog>;
}

type PrepareThread = (id: string) => Promise<unknown>;
type ComposerChangesAvailability=(threadId:string,available:boolean)=>void;
const emptyComposerState: ComposerState = {draft: '', ready: false, busy: false, stopping: false, error: '', retry: false};
function Composer({ modelPickerRequest, onModelPickerOpened, sharedComposers, onComposerChangesAvailability, thread, models, modelId, setModelId, snapshot, ensureThread, busy: externalBusy, runAction, refresh, setup, openResource, inspectChanges, reportError,onSide, predictionBlocked, selectProject, usageOpen=false, onShowUsage, onNewTask }: { usageOpen?:boolean; onShowUsage?:()=>void; modelPickerRequest?:number; onModelPickerOpened?:(request:number)=>void; sharedComposers?: SharedAgentComposers; onComposerChangesAvailability?:ComposerChangesAvailability; selectProject?:(id:string|undefined,opener?:HTMLElement|null,prepare?:PrepareThread)=>void; predictionBlocked: boolean; thread: Thread | undefined; models: ModelInfo[]; modelId: string; setModelId: (id: string) => void; snapshot: Snapshot; ensureThread: (prepare: PrepareThread) => Promise<string>; busy: boolean; runAction: (action: () => Promise<void>) => Promise<void>; refresh: () => Promise<void>; setup: () => void; openResource: (id: string, opener?: HTMLElement | null) => void; browseProject:(id:string)=>void;inspectChanges:()=>void; reportError: (error: string) => void;onSide:(content:string)=>Promise<void>; onNewTask?:(modelId:string)=>void }) {
  const key = thread?.id ?? 'new';
  const workbench = useSourceWorkbench();
  const draftProject=useProjectContext(thread?.projectId,thread?.id,thread?.workspaceId);
  // The journal is browser-profile/origin local; project context supplies the actual working copy.
  const savedDraftOwner=thread&&(!thread.projectId||!draftProject.loading&&!draftProject.error&&draftProject.context?.project.id===thread.projectId&&draftProject.context.threadId===thread.id&&(draftProject.context.workingCopy?.id??null)===(thread.workspaceId??null))?{profileId:window.location.origin,accountId:thread.accountId??null,threadId:thread.id,projectId:thread.projectId??null,workingCopyId:thread.projectId?draftProject.context?.workingCopy?.id??null:null}:undefined;
  const draftTarget = useRef(key);
  const [localDraft, setDraft] = useState('');
  const working = Boolean(thread?.runId) || thread?.status === 'working';
  const sharedTarget = useMemo<ConversationComposerTarget | undefined>(() => thread ? {kind: 'conversation', projectId:thread.projectId, workspaceId:thread.workspaceId, threadId: thread.id, modelId, working} : undefined, [thread?.id, thread?.projectId, thread?.workspaceId, modelId, working]);
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
  useLayoutEffect(()=>{
    if(!thread?.id||!onComposerChangesAvailability)return;
    onComposerChangesAvailability(thread.id,ready&&!busy);
    return()=>onComposerChangesAvailability(thread.id,false);
  },[thread?.id,ready,busy,onComposerChangesAvailability]);
  const [localError, setError] = useState('');
  const error = localError || (shared ? sharedState.error : '');
  const [localResumeRequired, setLocalResumeRequired] = useState(false);
  const resumeRequired = localResumeRequired || (shared ? Boolean(sharedState.resumeRequired) : false);
  const [localExcerpts,setLocalExcerpts]=useState<TerminalExcerpt[]>([]),[excerptsReady,setExcerptsReady]=useState(false);
  const excerpts=shared?sharedState.excerpts??[]:localExcerpts;
  useEffect(()=>{if(shared)return;let current=true;setExcerptsReady(false);const accept=(value:unknown)=>{try{setLocalExcerpts(readTerminalExcerpts(value));setExcerptsReady(true);}catch{setExcerptsReady(false);setError('Terminal excerpts could not be recovered. Keep this workspace open.');}};const unsubscribe=journalSubscribe(excerptDraftKey(key),accept);void journalReadRecord(excerptDraftKey(key)).then(record=>{if(current)accept(record?.value);}).catch(()=>{if(current)setError('Terminal excerpts could not be recovered. Keep this workspace open.');});return()=>{current=false;unsubscribe();};},[key,shared]);
  const updateExcerpt=(id:string,text?:string)=>sharedComposers&&sharedTarget?(text===undefined?sharedComposers.removeExcerpt(sharedTarget,id):sharedComposers.editExcerpt(sharedTarget,id,text)):changeTerminalExcerpts(key,current=>text===undefined?current.filter(e=>e.id!==id):current.map(e=>e.id===id?editTerminalExcerpt(e,text):e));
  const [contextOpen, setContextOpen] = useState(false);
  const memoryPrompt = useMemo(() => {try {return serializeTerminalExcerpts(draft, excerpts);} catch {return undefined;}}, [draft, excerpts]);
  const memoryOwner = thread?.projectId && !threadParent(thread) && !delegatedThread(thread) && draftProject.context?.threadId === thread.id && draftProject.context.project.id === thread.projectId && draftProject.context.project.authority.kind === 'local' ? {projectId: thread.projectId, threadId: thread.id, accountId: thread.accountId ?? null} : undefined;
  const preparedMemory = useProjectMemoryPreparation(memoryOwner && memoryPrompt !== undefined && modelId ? {owner: memoryOwner, prompt: memoryPrompt, modelId, thinkingLevel: thinkingLevel || null, ownerVersion: JSON.stringify([thread?.epoch, thread?.sessionPath, thread?.workspaceId, Object.entries(snapshot.settings.selectedAccounts ?? {}).sort(([left], [right]) => left.localeCompare(right))])} : undefined, contextOpen, busy || working || Boolean(shared && sharedState.retry));
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
  const fail = (cause: unknown) => { setError(messageOf(cause)); setLocalResumeRequired(cause instanceof ApiError && cause.code === 'RESUME_REQUIRED'); };
  const dismissError = () => { setError(''); setLocalResumeRequired(false); if (sharedComposers && sharedTarget) sharedComposers.clearError(sharedTarget); };
  const resume = () => {
    if (!thread || !modelId) return;
    dismissError();
    void journalRead<string>('thinking:'+thread.id).then(level=>command('run.resume',{modelId,thinkingLevel:level===undefined?(thread.thinkingLevel??null):(level||null)},thread.id)).then(()=>refresh()).catch(fail);
  };
  const send = async () => {
    if (busy || !skillsReady || !shared&&!excerptsReady || skillsBlocked || !draft.trim() && !excerpts.length && !retry) return;
    const sideCommand=!retry&&/^\/(?:btw|side)(?:\s|$)/i.exec(draft.trim());
    if(sideCommand){
      if(!thread){setError('Start a main conversation before asking a side question.');return;}
      const generation=journalGeneration(`draft:${key}`);setError('');
      try{await onSide(draft.trim().slice(sideCommand[0].length).trim());await journalCompareAndSwap(`draft:${key}`,generation,'');}catch(cause){fail(cause);}
      return;
    }
    if (working && workbench?.draft?.sendMode !== 'AFTER_CURRENT' || unavailable) return;
    await runAction(async () => {
      setError('');
      const submittedDraft = draft, submittedSkills = skills.slice(), submittedThinking = thinkingLatest.current || null;
      const submittedGeneration = journalGeneration(`draft:${key}`), submittedExcerptGeneration = journalGeneration(excerptDraftKey(key));
      try {
        const submittedExcerpts=readTerminalExcerpts(excerpts,thread?.projectId?{projectId:thread.projectId,threadId:thread.id}:undefined);
        const submittedPrompt = serializeTerminalExcerpts(submittedDraft, submittedExcerpts);
        const requestContextId = retry ? undefined : preparedMemory.requestContextId({prompt: submittedPrompt, modelId, thinkingLevel: submittedThinking});
        let migrated: Awaited<ReturnType<typeof migrateDraft>> | undefined;
        const id = await ensureThread(async id => { migrated = await migrateDraft(id, submittedDraft, true); });
        if (sharedComposers) {
          const target: ConversationComposerTarget = {kind: 'conversation', projectId:thread?.projectId, workspaceId:thread?.workspaceId, threadId: id, modelId, working};
          await sharedComposers.prepare(target); await sharedComposers.submit(target, {sourceContextVisible:Boolean(workbench?.draft&&workbench.owner?.threadId===id),thinkingLevel: submittedThinking, ...(requestContextId ? {requestContextId} : {}),submission:{content:submittedDraft,generation:id===key?submittedGeneration:migrated&&migrated.source?.generation===submittedGeneration?migrated.generation:undefined,skills:submittedSkills,excerpts:submittedExcerpts,excerptGeneration:submittedExcerptGeneration}});
          await refresh(); return;
        }
        if(workbench?.draft?.sourceRefs.length||workbench?.draft?.sendMode==='AFTER_CURRENT')throw Error('Source-aware sending is unavailable in this composer. The draft was retained.');
        await command('message.send', { content: submittedPrompt, modelId, thinkingLevel:submittedThinking, ...(requestContextId ? {requestContextId} : {}), ...(submittedSkills.length?{skills:submittedSkills.map(binding=>binding.ref)}:{}) }, id);
        await clearAcceptedSkills(skillDraftKey(id),submittedSkills);
        await clearAcceptedExcerpts(id,submittedExcerptGeneration);
        await journalCompareAndSwap(`draft:${key}`, submittedGeneration, '');
        if (id !== key && migrated && migrated.source?.generation === submittedGeneration) await journalCompareAndSwap(`draft:${id}`, migrated.generation, '');
        await refresh();
      } catch (error) { fail(error); if (key === 'new') reportError(messageOf(error)); }
    });
  };
  const upload = async (files: FileList | File[]) => {
    const selectedFiles = Array.from(files);
    await runAction(async () => {
      setError('');
      try {
        for (const item of selectedFiles) if (item.size > 20 * 1024 * 1024) throw new Error(`${item.name} is larger than the 20 MB attachment limit.`);
        const id = await ensureThread(id => migrateDraft(id, draft, true));
        for (const item of selectedFiles) {
          const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.onerror = () => reject(reader.error); reader.readAsDataURL(item); });
          await command('resource.upload', { name: item.name, mimeType: item.type || 'application/octet-stream', base64 }, id);
        }
        await refresh();
      } catch (error) { fail(error); if (key === 'new') reportError(messageOf(error)); }
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
    {thread && !working && ['stopped', 'interrupted', 'failed'].includes(thread.status) && <div className="resume-strip" role="status"><span>{thread.status === 'interrupted' ? 'This session was interrupted.' : thread.status === 'stopped' ? 'Agent stopped. Your work is saved.' : 'The agent could not finish this run.'}</span><button className="secondary" disabled={!modelId} title={!modelId ? 'Choose an available model before resuming.' : undefined} onClick={resume}>Resume<ChevronRight size={13} /></button></div>}
    {localSkills.error&&!shared&&<p role="alert" className="composer-error">{localSkills.error}</p>}
    {error && <div className="composer-error" role="alert"><span>{error}</span><span className="composer-error-actions">{resumeRequired&&thread&&<button className="quiet" disabled={!modelId} onClick={resume}>Resume thread</button>}<button className="icon-button" aria-label="Dismiss composer error" onClick={dismissError}><X size={14} /></button></span></div>}
    {working && draft.trim() && !(workbench?.enabled && workbench.draft?.sendMode === 'AFTER_CURRENT') && !/^\/(?:btw|side)(?:\s|$)/i.test(draft.trim()) && <p className="composer-hint">The agent is working — start the message with /btw to send a side question.</p>}
    <ComposerView className={dragging ? 'dragging' : ''} onSubmit={event => { event.preventDefault(); void send(); }} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); if (event.dataTransfer.files.length) void upload(event.dataTransfer.files); }}>
      <WorkbenchComposer title={thread?.title??'New conversation'} working={working} disabled={busy||!ready||retry}/>
      <ComposerAttachments resources={resources} excerpts={excerpts} disabled={busy||!ready||retry} onEditExcerpt={(id,text)=>updateExcerpt(id,text)} onRemoveExcerpt={id=>updateExcerpt(id)} timeFormat={getPreferences(snapshot.settings).timeFormat}/>
      <ComposerSkillBindings bindings={skills} retry={retry} onRemove={id=>{void (sharedComposers&&sharedTarget?sharedComposers.removeSkill(sharedTarget,id):localSkills.remove(id)).catch(cause=>fail(cause));}}/>
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
      <ComposerToolbar modelPickerRef={modelPicker} models={models} modelId={modelId} onModelChange={id=>{chooseThinking('');setModelId(id);}} modelScopeHint={thread?'New conversations only.':'Applies to new tasks.'} onModelNewTask={onNewTask} thinkingLevel={thinkingLevel} onThinkingChange={chooseThinking} projectLabel={thread?.projectName??project?.label} changeSummary={changes} onProject={async()=>{if(!selectProject){await addResource();return;}const opener=document.activeElement as HTMLElement|null;selectProject(thread?.id,opener,thread?undefined:id=>migrateDraft(id,draftLatest.current,true));}} onChanges={inspectChanges} onCreatePR={preparePR} onTranscript={text=>{const current=draftLatest.current;updateDraft(current+(current&&!/\s$/.test(current)?' ':'')+text);}} disabled={busy||!ready} working={working} separateActions
        leading={<>{savedDraftOwner?<SavedDrafts owner={savedDraftOwner} input={input} disabled={busy||!ready||retry||predictionBlocked}/>:<button type="button" className="quiet saved-drafts-trigger" disabled title={thread?'Saved drafts are waiting for the owning project context.':'Start a conversation to save named drafts.'}>Saved drafts</button>}<button type="button" className="icon-button attach-button" aria-label="Attach files" title="Attach files" disabled={busy} onClick={()=>file.current?.click()}><Plus size={18}/></button><input type="file" multiple ref={file} hidden onChange={event=>{if(event.target.files)void upload(event.target.files);event.target.value='';}}/></>}
        runtime={<>{thread?.accountId!=null&&<span className="composer-account" title="Account for this task">{snapshot.accounts?.find(account=>account.id===thread.accountId)?.label??'Account unavailable'}</span>}<span className="pill runtime-pill" title="Local workspace"><Laptop size={14}/>Local</span><button type="button" className="mode-toggle" aria-label="Task mode" aria-pressed={(thread?.mode??draftMode)==='plan'} title={(thread?.mode??draftMode)==='plan'?'Switch to Build':'Switch to Plan'} disabled={working||busy} onClick={()=>{void chooseMode((thread?.mode??draftMode)==='plan'?'build':'plan').catch(cause=>setError(messageOf(cause)));}}>{(thread?.mode??draftMode)==='plan'?<PenLine size={15}/>:<Bot size={15}/>}<span>{(thread?.mode??draftMode)==='plan'?'Plan':'Build'}</span></button>{preferences.showUsageFooter&&onShowUsage&&<button type="button" className="composer-tool composer-usage-launcher" aria-label={usageOpen?'Hide live usage':'Show live usage'} title={usageOpen?'Hide live usage':'Show live usage'} aria-pressed={usageOpen} onClick={onShowUsage}><Activity size={15}/></button>}</>}
        context={preferences.showComposerContext&&<span className="context-anchor"><button ref={contextAnchor} type="button" className="icon-button context-button" aria-label="Inspect context usage" aria-expanded={contextOpen} onClick={()=>setContextOpen(value=>!value)}><SlidersHorizontal size={15}/></button><ContextInspector open={contextOpen} anchor={contextAnchor} usage={thread?snapshot.usage[thread.id]:undefined} usageThreadId={thread?.id} thread={thread} close={()=>setContextOpen(false)} refresh={refresh} memoryRecall={preparedMemory.memoryRecall} memoryPreparation={memoryOwner ? {pending: preparedMemory.pending, error: preparedMemory.error, refresh: preparedMemory.refresh, disabled: busy || working} : undefined}/></span>}
        trailing={working?<>{workbench?.enabled&&workbench.draft?.sendMode==='AFTER_CURRENT'&&<button type="button" className="secondary" disabled={busy||!retry&&preparedMemory.blocked||!ready||skillsBlocked||!draft.trim()} onClick={()=>void send()}>Queue after current</button>}{/^\/(?:btw|side)(?:\s|$)/i.test(draft.trim())&&<button type="button" className="send-button" aria-label="Send side question" disabled={busy||!ready||skillsBlocked} onClick={()=>void send()}><ArrowUp size={17}/></button>}<button type="button" className="send-button stop-button" aria-label="Stop agent" disabled={shared && sharedState.stopping} onClick={()=>{void (sharedComposers && sharedTarget ? sharedComposers.stop(sharedTarget) : command('run.stop',{},thread!.id)).then(()=>refresh()).catch(error=>fail(error));}}><CircleStop size={20}/></button></>:<button className="send-button" aria-label={retry ? "Retry send" : "Send message"} disabled={busy||!retry&&preparedMemory.blocked||!skillsReady||skillsBlocked||unavailable||!draft.trim() && !excerpts.length && !retry||!ready||!shared&&!excerptsReady} title={unavailable?'Connect an available model in Settings to send.':'Send message (Enter)'}>{busy?<LoaderCircle size={17} className="spinning"/>:<ArrowUp size={19}/>}</button>}
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
function CanvasThread({sharedComposers,thread,snapshot,visible,blocked,refresh,setup,openResource,browseProject,inspectChanges,reportError,selectProject,liveMessages}:{sharedComposers?:SharedAgentComposers;thread:Thread;snapshot:Snapshot;visible:boolean;blocked:boolean;refresh:()=>Promise<void>;setup:()=>void;openResource:(id:string,opener?:HTMLElement|null)=>void;browseProject:(id:string)=>void;inspectChanges:()=>void;liveMessages:ReadonlySet<string>;selectProject?:(id:string|undefined,opener?:HTMLElement|null,prepare?:PrepareThread)=>void;reportError:(error:string)=>void}){
 const findScope=useRef<HTMLDivElement>(null),findTranscript=useRef<HTMLDivElement>(null);
 const [models,setModels]=useState<ModelInfo[]>([]),[modelId,setModelId]=useState(thread.modelId??''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[history,setHistory]=useState(60),detached=useDetachedSurface({kind:'thread',threadId:thread.id}),pending=usePendingSurface({kind:'thread',threadId:thread.id});const readOnly=delegatedThread(thread),held=Boolean(detached||pending||blocked),request=useRef(0);
 const owner=`${thread.id}:${thread.accountId??'legacy'}:${thread.modelId??''}`;
 useEffect(()=>{
  if(readOnly||!visible)return;let controller:AbortController|undefined;
  const load=async(force=false,target?:AccountAuthTarget)=>{const generation=++request.current;controller?.abort();const control=new AbortController();controller=control;if(!force)setModels([]);
   try{const value=await getModels(force,thread.id,control.signal,target);if(generation!==request.current||control.signal.aborted)return;setModels(current=>mergeAccountModels(current,value.models,target));setModelId(current=>target?current:value.models.some(model=>model.id===current)?current:thread.modelId??value.models[0]?.id??'');setError(value.error??'');}
   catch(cause){if(generation===request.current&&!control.signal.aborted){if(target)setModels(current=>mergeAccountModels(current,[],target));setError(messageOf(cause));}}
  };
  void load();const unsubscribe=onAccountCatalogChanged(async target=>{if((thread.accountId??null)===target.accountId&&thread.modelId?.split('/')[0]===target.providerId)await load(true,target);});
  return()=>{unsubscribe();request.current++;controller?.abort();};
 },[owner,readOnly,visible]);
 const messages=snapshot.messages.filter(message=>message.threadId===thread.id),working=Boolean(thread.runId)||thread.status==='working';
 const run=async(action:()=>Promise<void>)=>{setBusy(true);try{await action();}finally{setBusy(false);}};
 return <SourceWorkbenchProvider snapshot={snapshot} active={visible&&!held&&!readOnly&&!threadParent(thread)} owner={{threadId:thread.id,projectId:thread.projectId??null,workspaceId:thread.workspaceId??null}} ownerEpoch={`${thread.epoch}:${thread.accountId??''}:${visible}:${held}`}><div ref={findScope} className={`canvas-thread${readOnly?' canvas-thread-delegate':''}`}><div className="canvas-thread-status">{readOnly?'Delegated agent':threadParent(thread)?'Side conversation':'Main conversation'} · {threadStatus(thread)}{detached&&<button className="quiet" onClick={()=>void window.harnessDesktop?.focus(detached.id)}>Focus native window</button>}</div><ConversationFind ownerKey={thread.id} transcript={findTranscript} scope={findScope} active={visible} onLoadEarlier={messages.length>history?()=>setHistory(value=>value+60):undefined}/>{visible&&<div ref={findTranscript} className="canvas-thread-transcript" role="log" aria-label={`${thread.title} messages`}>{messages.length>history&&<button className="quiet" onClick={()=>setHistory(value=>value+60)}>Load earlier messages</button>}{messages.slice(-history).map(message=><div key={message.id} data-message-id={message.id} data-arrival={liveMessages.has(message.id)?'true':undefined} data-conversation-text className={`message message-${message.role}`}><span className="sr-only">{message.role}</span><CopyButton text={message.content} label="Copy message"/>{message.role==='assistant'?<SourceMessage id={message.id} threadId={message.threadId} text={message.content}><Markdown text={message.content}/></SourceMessage>:<Markdown text={message.content}/>}</div>)}{!messages.length&&<p className="muted">No messages yet.</p>}{error&&<p role="alert" className="error-text">{error}</p>}{thread.error&&<p role="alert" className="error-text">{thread.error}</p>}{!readOnly&&working&&<button className="quiet" disabled={busy} onClick={()=>void run(async()=>{await stopConversation(thread, sharedComposers);await refresh();}).catch(cause=>setError(messageOf(cause)))}>Stop</button>}{!readOnly&&['stopped','interrupted','failed'].includes(thread.status)&&<button className="secondary" disabled={busy||!modelId} onClick={()=>void run(async()=>{await command('run.resume',{modelId},thread.id);await refresh();}).catch(cause=>setError(messageOf(cause)))}>Resume</button>}</div>}{visible&&<><VerificationPanel threadId={thread.id}/><ToolProgramPanel threadId={thread.id} ownerKey={JSON.stringify([thread.id,thread.runId,thread.epoch,thread.accountId??null,thread.projectId??null,thread.workspaceId??null])}/></>}{visible&&<ControlConsentPanel threadId={thread.id}/>}{readOnly?<div className="canvas-thread-readonly">Read-only transcript.</div>:<div inert={held} style={{display:'contents'}}>{threadParent(thread)?<SideThreadComposer thread={thread} modelId={modelId} refresh={refresh}/>:<Composer sharedComposers={sharedComposers} selectProject={selectProject} key={thread.id} thread={thread} snapshot={snapshot} models={models} modelId={modelId} setModelId={setModelId} ensureThread={async prepare=>{await prepare(thread.id);return thread.id;}} busy={busy} runAction={run} refresh={refresh} setup={setup} openResource={openResource} browseProject={browseProject} inspectChanges={inspectChanges} reportError={reportError} predictionBlocked={held||!visible} onSide={async content=>{if(!content.trim())return;const receipt=await command('thread.create',{sideParentId:thread.id,title:content.slice(0,65)}),side=receipt.result as Thread,key=`side-draft:${thread.id}:${side.id}`,generation=await journalWrite(key,content);await refresh();await command('message.send',{content,modelId},side.id);await journalCompareAndSwap(key,generation,'');await refresh();}}/>}</div>}</div></SourceWorkbenchProvider>;

}
function stopConversation(thread: Thread, composers?: SharedAgentComposers) {
 return composers ? composers.stop({kind: 'conversation', threadId: thread.id, modelId: thread.modelId ?? null, working: Boolean(thread.runId) || thread.status === 'working'}) : command('run.stop', {}, thread.id);
}
export interface AppProps {onDirtyWidgetChange?:(id:string,threadId:string,dirty:boolean,discard?:()=>Promise<void>)=>void;onComposerChangesAvailability?:ComposerChangesAvailability;sharedComposers?:SharedAgentComposers;embeddedThreadId?:string;embeddedActive?:boolean;onRequestThread?:(id:string)=>void;liveUsage?:{open:boolean;toggle:()=>void};modelPickerRequest?:{id:number;threadId?:string};hostWorkspaceContext?:WorkspaceContextValue;onRequestWorkspaceTool?:(kind:WorkspaceContextValue['activeTab'],resourceId?:string,artifactId?:string)=>void}
export function App(props:AppProps={}) {
  const desktop=useDesktop();
  if(props.embeddedThreadId||desktop?.context.surface.kind==='thread'||desktop?.context.surface.kind==='navigation')return <ConversationWorkspace {...props}/>;
  return <WorkspaceHost conversation={host=><ConversationWorkspace {...props} host={host}/>}/>;
}
function ConversationWorkspace({onComposerChangesAvailability,sharedComposers,embeddedThreadId,embeddedActive=true,onRequestThread,liveUsage,modelPickerRequest:externalModelPicker,hostWorkspaceContext,onRequestWorkspaceTool,onDirtyWidgetChange,host}:AppProps&{host?:ConversationHost}={}) {
  const ownPluginCatalog=usePluginCatalog(!host&&!embeddedThreadId),pluginCatalog=host?.pluginCatalog??ownPluginCatalog,plugins=pluginCatalog.plugins,[selectedPluginId,setSelectedPluginId]=useState<string|null>(null),[openedPlugins,setOpenedPlugins]=useState<string[]>([]);
  useEffect(()=>{if(pluginCatalog.error)toast(pluginCatalog.error,{tone:'error'});},[pluginCatalog.error]);
  const [selectedPluginWorkspace,setSelectedPluginWorkspace]=useState<string|null>(null),[openedPluginWorkspaces,setOpenedPluginWorkspaces]=useState<{pluginId:string;workspaceId:string}[]>([]);
  const pluginWorkspaces=plugins.flatMap(plugin=>(plugin.workspaces??[]).map(contribution=>({pluginId:plugin.id,contribution})));
  const selectPluginWorkspace=async(pluginId:string,workspaceId:string)=>{await journalFlush();await prepareEditorHandoff();const key=pluginId+':'+workspaceId;setOpenedPluginWorkspaces(items=>items.some(item=>item.pluginId===pluginId&&item.workspaceId===workspaceId)?items:[...items,{pluginId,workspaceId}]);setSelectedPluginWorkspace(key);setSelectedPluginId(pluginId);};
  const selectPlugin=async(id:string)=>{await journalFlush();await prepareEditorHandoff();setSelectedPluginWorkspace(null);setOpenedPlugins(value=>value.includes(id)?value:[...value,id]);setSelectedPluginId(id);};
  const desktop=useDesktop(),desktopSurface=desktop?.context.surface,pinnedThreadId=embeddedThreadId??(desktopSurface?.kind==='thread'?desktopSurface.threadId:undefined),navigationOnly=desktopSurface?.kind==='navigation';
  useDesktopCloseGuard('composer-journal:'+String(embeddedThreadId??'shell'),()=>prepareSourceJournal());
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
  const [liveUsageOpen,setLiveUsageOpen]=useState(false);
  const [liveUsageViews,setLiveUsageViews]=useState<{workspaceId:string;viewIds:string[]}>({workspaceId:'',viewIds:[]});
  const updateLiveUsageViews=useCallback((workspaceId:string,viewIds:string[])=>setLiveUsageViews(current=>current.workspaceId===workspaceId&&current.viewIds.length===viewIds.length&&current.viewIds.every((id,index)=>id===viewIds[index])?current:{workspaceId,viewIds}),[]);
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
  const prepareSidebarToggle = useSidebarCollapse(sidebar, layout.sidebarCollapsed, preferences.panelAnimations && preferences.motionDuration > 0, mobile);
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
  // Keep the panel mounted through its exit animation after rightPanelOpen flips false.
  const [panelLeaving, setPanelLeaving] = useState(false), panelWasOpen = useRef(layout.rightPanelOpen);
  useEffect(() => {
    // Exit animations cannot finish when the motion policy or panel animations disable them.
    if (panelWasOpen.current && !layout.rightPanelOpen && preferences.panelAnimations && !reducedMotion()) setPanelLeaving(true);
    else if (panelLeaving && (!preferences.panelAnimations || reducedMotion())) setPanelLeaving(false);
    panelWasOpen.current = layout.rightPanelOpen;
  }, [layout.rightPanelOpen, preferences.panelAnimations, panelLeaving]);
  const workspaceContext = { activeArtifactId: layout.activeArtifactId, requestOpenArtifact: (id: string) => {setDocumentWindow(null);revealWorkspaceTool('artifact',undefined,id);}, closeArtifact: () => setLayout(value => ({ ...value, activeArtifactId: null })), rightPanelOpen: layout.rightPanelOpen, activeTab: layout.activeTab, setActiveTab: (activeTab: typeof layout.activeTab) => { if(activeTab==='usage'){openUsage();return;}setLayout(value => ({ ...value, activeTab, openTabs: value.openTabs.includes(activeTab) ? value.openTabs : [...value.openTabs, activeTab] })); }, openTabs: layout.openTabs, openTab: (tab: typeof layout.activeTab) => { if(tab==='usage'){openUsage();return;}setLayout(value => ({ ...value, rightPanelOpen: true, activeTab: tab, openTabs: value.openTabs.includes(tab) ? value.openTabs : [...value.openTabs, tab] })); }, closeTab: (tab: typeof layout.activeTab) => setLayout(value => { const openTabs = value.openTabs.filter(item => item !== tab); return { ...value, openTabs, activeTab: value.activeTab === tab ? (openTabs[openTabs.length - 1] ?? 'artifact') : value.activeTab }; }), documentWindow, requestOpenDocument:(id:string)=>{closePanel();setDocumentWindow({id,placement:'docked'});},closeDocument:(id:string)=>setDocumentWindow(value=>value?.id===id?null:value),placeDocument:(id:string,placement:'docked'|'floating')=>setDocumentWindow(value=>value?.id===id?{id,placement}:value) };
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null);
  const [resourcePicker, setResourcePicker] = useState<{threadId: string; opener: HTMLElement | null; session: number} | null>(null);
  const resourcePickerSession = useRef(0);
  const openResourcePicker = (threadId: string, opener: HTMLElement | null = document.activeElement as HTMLElement | null) =>
    setResourcePicker({threadId, opener, session: ++resourcePickerSession.current});
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
  const widgetDiscards = useRef(new Map<string, () => Promise<void>>());
  const [archiveThread, setArchiveThread] = useState<string | null>(null);
  const onDirtyWidget = useCallback((id: string, threadId: string, dirty: boolean, discard?: () => Promise<void>) => {
    onDirtyWidgetChange?.(id,threadId,dirty,discard);
    if (dirty && discard) widgetDiscards.current.set(id, discard); else widgetDiscards.current.delete(id);
    setDirtyWidgets(previous => { if (dirty && previous[id] === threadId || !dirty && !Object.hasOwn(previous, id)) return previous; const next = { ...previous }; if (dirty) next[id] = threadId; else delete next[id]; return next; });
  }, [onDirtyWidgetChange]);
  const [widgetDiscardError, setWidgetDiscardError] = useState('');
  const discardHiddenWidgets = async () => {
    setWidgetDiscardError('');
    let failed = 0;
    for (const artifactId of Object.keys(dirtyWidgets).filter(artifactId => dirtyWidgets[artifactId] !== thread?.id)) {
      const discard = widgetDiscards.current.get(artifactId);
      if (!discard) { failed++; continue; }
      try { await discard(); } catch { failed++; }
    }
    if (failed) setWidgetDiscardError(`The edits for ${failed} widget${failed > 1 ? 's' : ''} could not be discarded. Reopen the conversation and try again.`);
  };
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
      const messages=new Set(previous.messages.map(message=>message.id));for(const message of value.messages)if(!messages.has(message.id)&&message.threadId===(entryThread.current??value.activeThreadId))liveMessages.current.add(message.id);
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
  const localWorkspaceState=useWorkspaceState(loaded&&!host&&!navigationOnly&&(!pinnedThreadId||Boolean(embeddedThreadId))),workspaceState=host?.workspace??localWorkspaceState,workspaceEnvelope=workspaceState.envelope,activeCanvas=workspaceEnvelope?.state.canvases.find(canvas=>canvas.id===workspaceEnvelope.state.activeCanvasId),customDock=Boolean(activeCanvas?.preset==='custom'&&!retainedWorkspace&&!pinnedThreadId&&!navigationOnly),canvasActive=Boolean(activeCanvas&&!customDock&&(activeCanvas.preset!=='workspace'||retainedWorkspace)&&!pinnedThreadId&&!navigationOnly),canvasPanels=useMemo(()=>activeCanvas?(activeCanvas.preset==='all-agents'?liveThreadPanels(snapshot.threads,activeCanvas):activeCanvas.panels):[],[activeCanvas,snapshot.threads]);
  const splitEnabled=loaded&&!pinnedThreadId&&!navigationOnly&&(!activeCanvas||activeCanvas.preset==='workspace'),splitWorkspaceId='workspace';
  const splitProfiles=useSplitWorkspaceProfiles(splitEnabled,splitWorkspaceId);
  const [layoutChooserOpen,setLayoutChooserOpen]=useState(false);
  const splitState=useSplitWorkspaceState(splitEnabled,'workspace'),placedThread=useRef<string|null>(null),openedPlanRevision=useRef(new Set<string>());
  const convSplitState=splitState,layoutSplitState=splitState;
  // One resolved main selection: follow the canonical main pane; a released/archived main never revives activeThreadId (T02/R02).
  const mainPlacement=convSplitState.layout?readConversationPlacement(readPlacementRaw(convSplitState.layout.id),convSplitState.layout,snapshot.threads,{width:window.innerWidth,height:window.innerHeight},selectedId):null;
  const resolvedMainId=pinnedThreadId||!mainPlacement?(selectedId??undefined):(mainPlacement.mainSelection.kind==='thread'?mainPlacement.mainSelection.threadId:undefined);
  const modelThread = snapshot.threads.find(item => item.id === resolvedMainId);
  const modelThreadRef = useRef(modelThread); modelThreadRef.current = modelThread;
  const modelBinding = hasPinnedAccount(modelThread, snapshot) ? modelThread?.accountId ?? null : undefined;
  const selectedAccountsKey = JSON.stringify(Object.entries(snapshot.settings.selectedAccounts ?? {}).sort(([left], [right]) => left.localeCompare(right)));
  const modelOwner = `${modelThread?.id ?? 'new'}:${modelThread?.modelId ?? 'unset'}:${modelBinding === undefined ? 'unbound' : modelBinding ?? 'legacy'}`;
  const modelContext = modelBinding === undefined ? `${modelOwner}:${selectedAccountsKey}` : modelOwner;
  const modelContextRef = useRef(modelContext); modelContextRef.current = modelContext;
  const loadedModelOwner = useRef('');
  const modelRequest = useRef(0);
  const modelRead = useRef<AbortController|null>(null);
  const loadModels = useCallback(async (refresh = false,target?:AccountAuthTarget) => {
    const owner = modelThreadRef.current, ownerId = owner?.id, context = modelContextRef.current, request = ++modelRequest.current;
    modelRead.current?.abort();const controller=new AbortController();modelRead.current=controller;
    try {
      const result = await getModels(refresh, ownerId, controller.signal,target);
      if (request !== modelRequest.current || modelContextRef.current !== context) return;
      setModels(current=>mergeAccountModels(current,result.models,target)); setModelError(result.error ?? '');
      setModelId(previous => {
        if(target)return previous;
        if (previous && result.models.some(item => item.id === previous)) return previous;
        // Bound tasks never silently move to another account or model when its
        // pinned connection is unavailable. Setup and model changes are explicit.
        // A binding whose model has not propagated yet keeps the current
        // selection or the first advertised model instead of an empty one.
        if (hasPinnedAccount(owner, snapshotRef.current)) return owner?.modelId ?? (previous || result.models[0]?.id || '');
        const preferred = owner?.modelId ?? snapshotRef.current.settings.modelId;
        return result.models.some(item => item.id === preferred) ? preferred! : result.models[0]?.id ?? preferred ?? '';
      });
    } catch (error) { if (!controller.signal.aborted && request === modelRequest.current && modelContextRef.current === context) { setModels(current=>mergeAccountModels(current,[],target)); setModelError(messageOf(error)); } }
    finally { if(modelRead.current===controller)modelRead.current=null; }
  }, []);
  const acceptedModel = useRef<string | null | undefined>(undefined);
  useEffect(()=>onAccountCatalogChanged(async target=>{
    const current=modelThreadRef.current,state=snapshotRef.current;
    // The mounted plane conversation owns this catalog; the outer shell has no composer here.
    if(navigationOnly||!pinnedThreadId&&(canvasActive||splitEnabled&&current))return;
    if(hasPinnedAccount(current,state)){
      const provider=current?.modelId?.split('/')[0]??state.accounts?.find(account=>account.id===current?.accountId)?.providerId;
      if((current?.accountId??null)!==target.accountId||provider!==target.providerId)return;
    }else if((state.settings.selectedAccounts?.[target.providerId]??null)!==target.accountId)return;
    await loadModels(true,target);
  }),[loadModels,navigationOnly,pinnedThreadId,splitEnabled,canvasActive]);
  useEffect(()=>{if(!settingsOpen||!desktop)return;let active=true;void desktop.recoverSignIn().then(flow=>{
    if(!active||flow!==null)return;
    const current=modelThreadRef.current,provider=current?.modelId?.split('/')[0];
    return isConnectionProviderId(provider)?notifyAccountCatalogChanged({providerId:provider,accountId:current?.accountId??null},'reconciled'):loadModels(true);
  }).catch(()=>{});return()=>{active=false;};},[settingsOpen,desktop?.recoverSignIn,loadModels]);
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
  useEffect(() => { if (!loaded) return; return subscribe(snapshotRef.current.seq, event => {if(event.type.startsWith('workspace.')||event.type.startsWith('project.')||event.type.startsWith('split-workspace.'))window.dispatchEvent(new Event('harness:workspace-changed'));const patched=applyRuntimeEvent(snapshotRef.current,event);if(patched)apply(patched);else void refresh().catch(error => setError(messageOf(error))); }, setOnline, refresh); }, [loaded, refresh, apply]);
  useEffect(() => { const query = matchMedia('(prefers-color-scheme: dark)'); const change = () => setSystemDark(query.matches); query.addEventListener('change', change); return () => query.removeEventListener('change', change); }, []);
  const theme = snapshot.settings.theme === 'system' ? systemDark ? 'dark' : 'light' : snapshot.settings.theme;
  useLayoutEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useDesktopReady(loaded&&!embeddedThreadId);
  const candidateThread = snapshot.threads.find(item => item.id === resolvedMainId);
  const detachedThread=useDetachedSurface(candidateThread?{kind:'thread',threadId:candidateThread.id}:null);
  // The main workspace releases a detached conversation to its own pinned window
  // and returns to the empty container; pinned and embedded views stay locked to it.
  const mainDetached=Boolean(detachedThread)&&!pinnedThreadId;
  const thread=mainDetached?undefined:candidateThread;
  const {overview: sessionBranchOverview, reload: reloadSessionBranch} = useSessionBranchOverview(thread?.id);
  useLayoutEffect(() => {if (thread) host?.selectThread(thread.id); else if(!pinnedThreadId) host?.selectThread(undefined);}, [host, thread?.id, pinnedThreadId]);
  const customConversationLayout=useMemo(()=>{
    if(!customDock||!convSplitState.layout)return null;
    const threadView=Object.values(convSplitState.layout.views).find(view=>view.kind==='thread'&&view.binding.authority.kind==='local'&&view.binding.threadId===thread?.id);
    if(!threadView)return null;
    return applySplitWorkspaceCommand(createSplitWorkspaceLayout(convSplitState.layout.id),'view.open',{view:threadView});
  },[customDock,convSplitState.layout,thread?.id]);
  const savedLayoutActions=useSplitLayoutProfileActions({prepare:()=>prepareWorkspace(),save:layoutSplitState.saveProfile,send:layoutSplitState.send,refresh:splitProfiles.refresh},splitWorkspaceId);
  const [projectConnectOpen,setProjectConnectOpen]=useState(false),[projectName,setProjectName]=useState(''),[projectPath,setProjectPath]=useState(''),[projectConnectError,setProjectConnectError]=useState('');
  const [projectPicker,setProjectPicker]=useState<{threadId?:string;opener:HTMLElement|null;prepare?:PrepareThread}|null>(null),[projectPicking,setProjectPicking]=useState(false),[projectPickerError,setProjectPickerError]=useState('');
  const openProjectSelection=(threadId?:string,opener:HTMLElement|null=document.activeElement as HTMLElement|null,prepare?:PrepareThread)=>{setProjectPickerError('');setProjectPicker({threadId,opener,prepare});};
  const closeProjectSelection=()=>{const opener=projectPicker?.opener;setProjectPicker(null);requestAnimationFrame(()=>{if(opener?.isConnected)opener.focus({preventScroll:true});});};
  const projectConnectPicker=useRef<typeof projectPicker>(null);
  const projectConnectTarget=useRef<{threadId?:string;projectId?:string;opener:HTMLElement|null}|null>(null);
  const openProjectConnect=(binding:Pick<PanelBinding,'threadId'|'projectId'>)=>{projectConnectTarget.current={...binding,opener:document.activeElement as HTMLElement|null};setProjectConnectError('');setProjectConnectOpen(true);};
  const closeProjectConnect=()=>{const opener=projectConnectTarget.current?.opener;projectConnectTarget.current=null;setProjectConnectOpen(false);const resume=projectConnectPicker.current;projectConnectPicker.current=null;if(resume){setProjectPicker(resume);return;}requestAnimationFrame(()=>{if(opener?.isConnected)opener.focus({preventScroll:true});});};
  const selectedPlan=useMemo(()=>selectPlanRecord(snapshot,thread?.id),[snapshot.data,thread?.id]);
  const planOwner=useRef<{id?:string;run:string|null|undefined}>({id:undefined,run:undefined});
  useEffect(()=>{const before=planOwner.current;planOwner.current={id:thread?.id,run:thread?.runId};const appeared=planVisibility.observe(thread,selectedPlan);if(before.id!==thread?.id||thread?.runId&&before.run!==thread.runId)setPlanOpen(planVisibility.isOpen(thread?.id));if(appeared){setPlanFocusOnOpen(false);setPlanExpandRequest(value=>value+1);setPlanOpen(true);}},[thread?.id,thread?.runId,selectedPlan]);
  const dismissPlan=()=>{planVisibility.dismiss(thread);if(planFocusOnOpen)document.querySelector<HTMLButtonElement>('.thread-menu-wrap>button')?.focus({preventScroll:true});setPlanOpen(false);};
  const conversation = useRef<HTMLDivElement>(null),findScope=useRef<HTMLDivElement>(null);
  const readingPositions = useRef(new Map<string, { top: number; tail: boolean }>());
  const previousConversation = useRef('');
  const previousUpdate = useRef('');
  const [latestAvailable, setLatestAvailable] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [historyCounts, setHistoryCounts] = useState<Record<string, number>>({});
  const historyStarts = useRef(new Map<string, number>());
  const [historyAnchor] = useState(createHistoryAnchor);
  // Pages of older messages fetched on demand once the snapshot's per-thread
  // window is exhausted, keyed by thread id.
  const olderMessages = useRef(new Map<string, Message[]>());
  const lastWindowHeads = useRef(new Map<string, string | undefined>());
  const [olderPageTick, setOlderPageTick] = useState(0);
  const selectNow = (id: string | null) => { setSelectedPluginId(null);setSelectedPluginWorkspace(null); if(pinnedThreadId&&id&&id!==pinnedThreadId){if(embeddedThreadId&&onRequestThread)onRequestThread(id);else toast('Choose another conversation in the main workspace.');return;}if(id&&!pinnedThreadId&&desktop){const owner=desktop.windows.find(info=>info.id!==desktop.context.windowId&&info.surface.kind==='thread'&&info.surface.threadId===id);if(owner){void desktop.bridge.focus(owner.id).catch(cause=>setError(messageOf(cause)));setSidebarOpen(false);return;}}if(id&&splitEnabled&&convSplitState.layout){const current=convSplitState.layout,target=Object.values(current.panes).find(pane=>pane.viewIds.some(viewId=>current.views[viewId]?.kind==='thread'&&current.views[viewId]?.binding.threadId===id));void placeSplitThread(id,target?.id??current.focusedPaneId).catch(cause=>setError(messageOf(cause)));setSidebarOpen(false);return;}  setSelectedId(id); setSidebarOpen(false);  try { if (id) localStorage.setItem('harness:selected-thread', id); else localStorage.removeItem('harness:selected-thread'); } catch { /* Selection still works when storage is unavailable. */ } };
  // A thread select never detaches editors: retained views keep their bodies and leases mounted.
  // Flushing the source journal is enough; detach guards must not block or abort the switch.
  const select = (id:string|null) => {void prepareSourceJournal().then(()=>selectNow(id)).catch(cause=>setError(messageOf(cause)));};
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
    else if (matchesShortcut(event, preferences.keybindings.stop)) { const focused = snapshotRef.current.threads.find(item => item.id === placedThread.current); const owner = focused?.runId ? focused : modelThreadRef.current; if (owner?.runId) { event.preventDefault(); void stopConversation(owner, host?.composers ?? sharedComposers).then(() => refresh()).catch(error => setError(messageOf(error))); } }
    if (event.key === 'Escape') { setSidebarOpen(false);  }
  }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [preferences.keybindings.search, preferences.keybindings.newThread, preferences.keybindings.toggleSidebar, preferences.keybindings.toggleRightPanel, preferences.keybindings.openSettings, preferences.keybindings.stop, selectedId, mobile, refresh, host?.composers]);
  const conversationMotion=useRef<ReturnType<typeof createConversationScroll>|null>(null),conversationElement=useRef<HTMLElement|null>(null);
  useEffect(()=>()=>conversationMotion.current?.dispose(),[]);
  const messages = snapshot.messages.filter(item => item.threadId === thread?.id);
  const activeHistoryId=thread?.id??'new';
  const activeCachedHistory=olderMessages.current.get(activeHistoryId);
  const activeOlder=activeCachedHistory?.length?(()=>{
    const activeMessageIds=new Set(messages.map(message=>message.id));
    return activeCachedHistory.filter(message=>!activeMessageIds.has(message.id));
  })():[];
  const activeHistoryStart=historyStarts.current.get(activeHistoryId)??Math.max(0,activeOlder.length+messages.length-100);
  const activeHistoryControl=useRef<HTMLButtonElement>(null);
  const canLoadActiveHistory=Boolean(thread&&canLoadConversationHistory(activeHistoryStart,snapshot.messagesTruncated?.[activeHistoryId]??0,activeOlder.length));
  const requests = snapshot.requests.filter(item => item.threadId === thread?.id && item.status === 'pending');
  useLayoutEffect(() => {
    const element = conversation.current;
    if (!element || !loaded) return;
    if(conversationElement.current!==element||!conversationMotion.current){conversationMotion.current?.dispose();conversationMotion.current=createConversationScroll(element);conversationElement.current=element;}
    const id = thread?.id ?? 'new';
    const position = readingPositions.current.get(id) ?? { top: 0, tail: true };
    const changedThread = previousConversation.current !== id;
    const update = JSON.stringify([messages.length, messages.at(-1)?.id, messages.at(-1)?.content, requests.map(item => [item.id, item.revision]), thread?.status]);
    const anchor = historyAnchor.consume(id, element);
    conversationMotion.current.update(id,position,anchor);
    if (anchor && !changedThread) readingPositions.current.set(id, { ...position, top: element.scrollTop });
    if (!changedThread && previousUpdate.current !== update) { const live = conversationMotion.current?.position(); if (!(live ?? position).tail) { setAnnouncement('New conversation updates available.'); setLatestAvailable(true); } }
    if (changedThread) { setLatestAvailable(!position.tail); setAnnouncement(''); }
    previousConversation.current = id; previousUpdate.current = update;
  }, [thread?.id, snapshot, loaded, historyCounts, olderPageTick, canvasActive, historyAnchor]);
  const captureHistoryAnchor = (owner: string) => {
    const element = conversation.current;
    if (element?.getClientRects().length) historyAnchor.capture(owner, previousConversation.current, element);
  };
  const rememberPosition = () => {
    const position=conversationMotion.current?.remember();if(!position)return;
    readingPositions.current.set(thread?.id??'new',position);
    setLatestAvailable(!position.tail);
  };
  const archive = async (id: string, discard = false, confirmed = false) => {
    if (!discard && Object.values(dirtyWidgets).includes(id)) { setArchiveThread(id);  return; }
    if (!discard && !confirmed && preferences.archiveConfirmation) { setConfirmArchive(id);  return; }
    try { if(discard)for(const artifactId of Object.keys(dirtyWidgets).filter(key=>dirtyWidgets[key]===id)){const release=widgetDiscards.current.get(artifactId);if(!release)throw Error('Reopen the owning conversation before discarding its widget edits.');await release();} await command('thread.archive', {}, id); setDirtyWidgets(previous => Object.fromEntries(Object.entries(previous).filter(([, threadId]) => threadId !== id))); setArchiveThread(null); if (id === thread?.id) select(null); await refresh(); } catch (error) { setError(messageOf(error)); }
  };
  // Windowed threads' older messages are not in the snapshot; ask the server
  // which of them still match the query.
  const [deepMatches, setDeepMatches] = useState<HistoricalThreadMatches>();
  useEffect(() => {
    const query = search.trim(), ids = Object.keys(snapshot.messagesTruncated ?? {});
    if (!query || !ids.length) { setDeepMatches(undefined); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchThreadMessages(query, ids, controller.signal).then(page => {
        if (!controller.signal.aborted) setDeepMatches({query, ids: new Set(page.threadIds)});
      }).catch(() => {});
    }, 250);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [search, snapshot.messagesTruncated]);
  const matching = useMemo(() =>
    matchingThreads(snapshot.threads, snapshot.messages, search, preferences.projectOrder, deepMatches),
  [snapshot.threads, snapshot.messages, search, preferences.projectOrder, deepMatches]);
  const updateModel = (id: string) => { setModelId(id); void command('settings.update', { modelId: id }).then(() => refresh()).catch(error => setError(messageOf(error))); };
  const detachedPlan=useDetachedSurface(thread?{kind:'plan',threadId:thread.id}:null),detachedNavigation=useDetachedSurface({kind:'navigation'});
  const pendingThread=usePendingSurface(candidateThread?{kind:'thread',threadId:candidateThread.id}:null);
  const threadHeld=Boolean((detachedThread&&!mainDetached)||pendingThread||desktop?.closing);
  const [composerChanges,setComposerChanges]=useState(()=>new Set<string>());
  const reportComposerChanges=useCallback((id:string,available:boolean)=>{
    const reachable=available&&embeddedActive&&!threadHeld;
    setComposerChanges(current=>{if(current.has(id)===reachable)return current;const next=new Set(current);if(reachable)next.add(id);else next.delete(id);return next;});
    onComposerChangesAvailability?.(id,reachable);
  },[embeddedActive,threadHeld,onComposerChangesAvailability]);
  const composerChangesAvailable=Boolean(thread&&!threadParent(thread)&&!delegatedThread(thread)&&!pinnedThreadId&&!embeddedThreadId&&!threadHeld&&composerChanges.has(thread.id));
  const prepareSourceJournal=async()=>{
    if(thread)await prepareSourceOwnerHandoff({threadId:thread.id,projectId:thread.projectId??null,workspaceId:thread.workspaceId??null});
    await journalFlush();
  };
  const prepareWorkspace=async()=>{await prepareSourceJournal();await prepareEditorHandoff();};
  const updateCanvasPanel=async(panel:PanelPlacement,patch:Partial<PanelPlacement>)=>{if(!activeCanvas)throw Error('Choose a canvas first.');if(patch.visible===false||patch.placement==='native')await prepareWorkspace();if(!activeCanvas.panels.some(value=>value.id===panel.id))await workspaceState.send('workspace.panel.add',{canvasId:activeCanvas.id,panel:{id:panel.id,kind:panel.kind,binding:panel.binding},bounds:panel.bounds});await workspaceState.send('workspace.panel.update',{panelId:panel.id,patch});};
  const panelTitle=(panel:PanelPlacement)=>panel.kind==='thread'?snapshot.threads.find(item=>item.id===panel.binding.threadId)?.title??'Unavailable conversation':panel.kind==='artifact'?snapshot.artifacts.find(item=>item.id===panel.binding.artifactId)?.title??'Artifact':panelLabels[panel.kind];
  const excerptComposerFor=(binding:PanelBinding):TerminalExcerptComposer|undefined=>{
    const owner=snapshot.threads.find(item=>item.id===binding.threadId),composers=host?.composers??sharedComposers;
    const mounted=canvasActive?canvasPanels.some(panel=>panel.kind==='thread'&&panel.binding.threadId===owner?.id&&panel.visible&&!panel.collapsed):owner?.id===thread?.id;
    if(!composers||!mounted||!owner?.projectId||binding.authority.kind!=='local'||threadParent(owner)||delegatedThread(owner)||threadHeld||desktop&&desktop.ownership({kind:'thread',threadId:owner.id})===undefined)return;
    const target:ConversationComposerTarget={kind:'conversation',threadId:owner.id,projectId:owner.projectId,modelId:owner.modelId??null,working:Boolean(owner.runId)||owner.status==='working'};
    return {projectId:owner.projectId,threadId:owner.id,addExcerpt:async excerpt=>{await composers.prepare(target);await composers.addExcerpt(target,excerpt);}};
  };
  const openUsage=(ownerId=thread?.id)=>{setUsageThreadId(ownerId??null);setUsageOpen(true);};
  const usageOwner=snapshot.threads.find(item=>item.id===usageThreadId);
  const usageReport=runtimeUsageReport(usageOwner,usageThreadId?snapshot.usage[usageThreadId]:undefined);
  useEffect(()=>{
    if(!loaded||!workspaceEnvelope||pinnedThreadId||navigationOnly||layout.activeTab!=='usage'||splitEnabled&&!convSplitState.layout)return;
    if(layout.rightPanelOpen&&!splitEnabled&&!canvasActive&&!customDock&&!selectedPluginId){setUsageThreadId(thread?.id??null);setUsageOpen(true);}
    setLayout(value=>value.activeTab==='usage'?{...value,activeTab:'notes'}:value);
  },[loaded,workspaceEnvelope,pinnedThreadId,navigationOnly,layout.activeTab,layout.rightPanelOpen,canvasActive,customDock,splitEnabled,convSplitState.layout,selectedPluginId,thread?.id]);
  const [reviewRequest,setReviewRequest]=useState<ReviewRequest>();
  const pendingReviewId=useRef<number|undefined>(undefined);
  const handleReviewRequest=useCallback((id:number)=>{if(pendingReviewId.current===id)pendingReviewId.current=undefined;setReviewRequest(current=>current?.id===id?undefined:current);},[]);
  const addCanvasPanel=async(kind:WorkspacePanelKind,explicitBinding?:PanelBinding,onOpened?:(id:string)=>void)=>{
    if(customDock){await openSplitTool(kind,undefined,false,explicitBinding?.threadId,false,explicitBinding);return;}

    if(kind==='usage'&&(!explicitBinding||explicitBinding.authority.kind==='local')){openUsage(explicitBinding?.threadId??thread?.id);return;}
    if(!canvasActive&&workspaceMode==='chat'&&!explicitBinding&&['artifact','plan','files','diff','notes','output','usage','terminal','pull-request','linked-pull-requests'].includes(kind)){await prepareWorkspace();setLayout(value=>{const tab=kind as typeof value.activeTab;return {...value,rightPanelOpen:true,activeTab:tab,openTabs:value.openTabs.includes(tab)?value.openTabs:[...value.openTabs,tab]};});return;}
    if(!activeCanvas)throw Error('Choose a canvas first.');
    const binding:PanelBinding=explicitBinding?{...explicitBinding}:{authority:{kind:'local'},...(thread?{threadId:thread.id}:{}),...(thread&&threadProject(thread)!=='unassigned'?{projectId:threadProject(thread)}:{})};
    const owner=snapshot.threads.find(item=>item.id===binding.threadId);
    if(['thread','plan','agent','artifact','notes'].includes(kind)&&!owner)throw Error('Choose a conversation before adding this panel.');
    if(kind==='thread'&&!canvasActive&&owner?.id===thread?.id){toast('This conversation is already open.');return;}
    if(kind==='artifact'){const artifact=snapshot.artifacts.find(item=>item.threadId===owner?.id&&item.lifecycle==='active');if(!artifact)throw Error('This conversation has no active artifact.');binding.artifactId=artifact.id;}
    if(kind==='agent'){const agent=selectPlanRecord(snapshot,owner?.id)?.plan?.agents[0];if(!agent)throw Error('This conversation has no delegated agent yet.');binding.agentId=agent.id;}
    if(kind==='browser')binding.browserId='browser-'+crypto.randomUUID();
    // A new pane must receive its own host-persisted PTY reference, including when opened from an exited pane.
    if(kind==='terminal')delete binding.terminalId;
    const area=document.querySelector<HTMLElement>(canvasActive?'.workspace-canvas':'.shell-workarea');
    const size={width:area?.clientWidth??Math.max(320,viewportWidth-layout.sidebarWidth),height:Math.max(200,(area?.clientHeight??window.innerHeight)-(canvasActive?0:220))};
    const bounds=findCanvasPanelBounds(canvasPanels,activeCanvas.viewport,size,{width:kind==='thread'?520:480,height:Math.min(600,size.height-48)});
    const id='panel-'+crypto.randomUUID();
    await workspaceState.send('workspace.panel.add',{canvasId:activeCanvas.id,panel:{id,kind,binding},bounds});onOpened?.(id);
  };
  const resolvePanelBinding=(panel:PanelPlacement):PanelBinding=>{const binding=panel.binding;if(binding.authority.kind!=='local')return binding;if(binding.liveProject&&binding.projectId){const current=thread&&threadProject(thread)===binding.projectId?thread:snapshot.threads.filter(item=>threadProject(item)===binding.projectId&&!threadParent(item)).toSorted((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];return {...binding,threadId:current?.id};}return binding.threadId?binding:{...binding,...(thread?{threadId:thread.id}:{}),...(thread&&threadProject(thread)!=='unassigned'&&!binding.projectId?{projectId:threadProject(thread)}:{})};};
  const canvasBody=(panel:PanelPlacement,visible:boolean)=>{const binding=resolvePanelBinding(panel),owner=snapshot.threads.find(item=>item.id===binding.threadId),native=desktop&&panelNativeWindow({...panel,binding},desktop.windows.filter(value=>value.id!==desktop.context.windowId));if(native)return <div className="panel-note"><p>This view is open in another window.</p><button className="quiet" onClick={()=>void desktop?.bridge.focus(native.id).catch(cause=>setError(messageOf(cause)))}>Focus window</button></div>;if(binding.authority.kind==='plugin'){const authority=binding.authority,plugin=plugins.find(value=>value.id===authority.pluginId),surface=panelDesktopSurface({...panel,binding});return plugin&&surface.kind==='plugin'?<PluginFrame key={panel.id} plugin={plugin} theme={theme} surface={surface} active={visible}/>:<p className="panel-note" role="alert">The owning plug-in is unavailable. Saved panel data is retained.</p>;}if(panel.kind==='thread')return owner?<CanvasThread sharedComposers={host?.composers??sharedComposers} liveMessages={liveMessages.current} key={owner.id} thread={owner} snapshot={snapshot} visible={visible} blocked={Boolean(desktop?.closing)||settingsOpen||usageOpen||Boolean(resourcePicker)||rename} refresh={refresh} setup={()=>{setSettingsSection('providers');setSettingsOpen(true);}} openResource={(_id,opener)=>openResourcePicker(owner.id,opener)} browseProject={id=>{void addCanvasPanel('files',{...binding,resourceId:id,liveProject:false}).catch(cause=>setError(messageOf(cause)));}} inspectChanges={()=>{void addCanvasPanel('diff',{...binding,liveProject:false}).catch(cause=>setError(messageOf(cause)));}} reportError={setError} selectProject={openProjectSelection}/>:<p role="alert" className="panel-note">The owning conversation is unavailable.</p>;if(panel.kind==='agent')return binding.threadId&&binding.agentId?<DelegatedAgentTranscript key={binding.threadId+':'+binding.agentId} threadId={binding.threadId} agentId={binding.agentId} snapshot={snapshot}/>:<p role='alert'>The owning subagent is unavailable.</p>;if(panel.kind==='plan')return <PlanStatus snapshot={snapshot} threadId={binding.threadId}/>;if(panel.kind==='context')return <ProjectContextSurface key={owner?.id??panel.id} thread={owner} snapshot={snapshot} onSelectThread={select} onShowChanges={()=>{void addCanvasPanel('diff',{...binding,liveProject:false}).catch(cause=>setError(messageOf(cause)));}} onConnect={()=>openProjectConnect(binding)}/>;if(panel.kind==='browser'){const docked=desktop?.state.dockedBrowser;return docked&&docked.browserId===binding.browserId?<div style={{display:'flex',flexDirection:'column',height:'100%'}}><DesktopBrowserToolbar state={docked.state}/><DesktopBrowserSlot/></div>:<div className="panel-note"><p>No browser is currently docked in this workspace.</p></div>;}return <WorkspaceSurfaceBody reviewRequest={reviewRequest} onReviewHandled={handleReviewRequest} excerptComposer={excerptComposerFor(binding)} panelId={panel.id} kind={panel.kind} binding={binding} snapshot={snapshot} refresh={refresh} active={visible} preferences={preferences} onSelectThread={async id=>{await prepareWorkspace();select(id);}} onOpenTool={kind=>addCanvasPanel(kind,{...binding,liveProject:false})}/>;};
  const canvasBodyGuarded=(panel:PanelPlacement,visible:boolean)=><SurfaceBoundary resetKey={panel.id}>{canvasBody(panel,visible)}</SurfaceBoundary>;
  const renderWorkspaceCanvas=(embedded=false)=>activeCanvas&&workspaceEnvelope?<WorkspaceCanvas embedded={embedded} threads={snapshot.threads} canvas={activeCanvas} panels={embedded?canvasPanels.filter(panel=>!(panel.kind==='thread'&&panel.binding.authority.kind==='local'&&resolvePanelBinding(panel).threadId===thread?.id)):canvasPanels} projects={workspaceEnvelope.projects} disabledKinds={workspaceEnvelope.state.disabledKinds} title={panelTitle} updatePanel={updateCanvasPanel} updateViewport={async viewport=>{await workspaceState.send('workspace.canvas.viewport',{canvasId:activeCanvas.id,...viewport});}} setFilter={async filter=>{await workspaceState.send('workspace.canvas.filter',{canvasId:activeCanvas.id,filter});}} renderBody={canvasBodyGuarded}/>:null;
  const openSidebarTool=(kind:'usage'|'linked-pull-requests',review?:Omit<ReviewRequest,'panelId'>)=>{pendingReviewId.current=review?.id;setReviewRequest(undefined);if(navigationOnly){toast('Open this tool in the main workspace.');return;}if(kind==='usage'){openUsage();return;}setSelectedPluginId(null);const binding:PanelBinding|undefined=review?{authority:{kind:'local'},threadId:review.threadId,projectId:review.projectId}:undefined;const opened=(panelId:string)=>{if(review&&pendingReviewId.current===review.id)setReviewRequest({...review,panelId});};if(canvasActive)void addCanvasPanel(kind,binding,opened).catch(cause=>setError(messageOf(cause)));else if(splitEnabled&&splitState.layout)void openSplitTool(kind,undefined,true,review?.threadId??thread?.id,false,binding,opened).catch(cause=>setError(messageOf(cause)));else {setLayout(value=>({...value,rightPanelOpen:true,activeTab:kind,openTabs:value.openTabs.includes(kind)?value.openTabs:[...value.openTabs,kind]}));opened('sidebar');}};
  const handledDockTarget=useRef<unknown>(null);
  const splitSelectionReady=Boolean(convSplitState.layout);
  useEffect(()=>{
    const target=desktop?.state.focusSurface;if(!target){handledDockTarget.current=null;return;}
    if(!workspaceEnvelope||handledDockTarget.current===target)return;
    const returningSplitThread=target.kind==='thread'&&desktop?.context.surface.kind==='main'&&splitEnabled;
    // Wait for canonical placement before consuming the native return intent.
    if(returningSplitThread&&!splitSelectionReady)return;
    handledDockTarget.current=target;
    if(target.kind==='plugin'){setOpenedPlugins(value=>value.includes(target.pluginId)?value:[...value,target.pluginId]);setSelectedPluginId(target.pluginId);}
    if(returningSplitThread){
      if(resolvedMainId!==target.threadId)select(target.threadId);
    }else if('threadId'in target&&target.threadId&&!pinnedThreadId)setSelectedId(target.threadId);
    if(target.kind==='plan')setPlanOpen(true);
    if(target.kind==='workspace'&&!target.panelId&&(!target.tab||['launcher','artifact','plan','files','diff','notes','output','usage'].includes(target.tab)))setLayout(value=>{const tab=target.tab&&target.tab!=='launcher'?target.tab as typeof value.activeTab:'artifact';return {...value,rightPanelOpen:true,activeTab:tab,openTabs:value.openTabs.includes(tab)?value.openTabs:[...value.openTabs,tab]};});
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
  },[desktop?.state.focusSurface,workspaceEnvelope,splitEnabled,splitSelectionReady]);
  const placeSplitThread=async(threadId:string,paneId=convSplitState.layout?.focusedPaneId,edge:SplitDropEdge='center',outer=false)=>{
    const current=convSplitState.layout;if(!current||!paneId)throw Error('Wait for the workspace to load.');
    const next=threadPlacementCommand(current,snapshotRef.current.threads,threadId,paneId,edge,outer);
    await journalFlush();
    const placed=await convSplitState.send(next.type,next.payload);try{localStorage.setItem('harness:selected-thread',threadId);}catch{/* Current selection remains usable. */}placedThread.current=threadId;setSelectedId(threadId);publishMainSelection(placed);
  };
  useEffect(()=>{
    if(!splitEnabled||!convSplitState.layout||!thread||placedThread.current===thread.id)return;
    const current=convSplitState.layout,existing=Object.values(current.panes).find(pane=>pane.viewIds.some(id=>current.views[id]?.kind==='thread'&&current.views[id]?.binding.threadId===thread.id));
    if(existing&&!existing.collapsed&&existing.activeViewId&&current.views[existing.activeViewId]?.kind==='thread'&&current.views[existing.activeViewId]?.binding.threadId===thread.id){placedThread.current=focusedSplitThread(current)??thread.id;return;}
    placedThread.current=thread.id;
    void placeSplitThread(thread.id,existing?.id??current.focusedPaneId).catch(cause=>{placedThread.current=null;setError(messageOf(cause));});
  },[splitEnabled,convSplitState.layout,thread?.id]);
  const focusedSplitThread=(layout:SplitWorkspaceLayout)=>{
    const viewId=document.activeElement?.closest<HTMLElement>('[data-split-view]')?.dataset.splitView,view=viewId?layout.views[viewId]:undefined;
    return view?.kind==='thread'&&view.binding.authority.kind==='local'?view.binding.threadId:undefined;
  };
  const focusSplitOwner=(view:SurfaceRef)=>{if(view.binding.authority.kind!=='local'||!view.binding.threadId)return;placedThread.current=view.binding.threadId;setSelectedId(view.binding.threadId);};
  const convSendSplitCommand=async(type:string,payload:Record<string,unknown>)=>{
    if(type==='view.activate')await journalFlush();
    const before=convSplitState.layout,next=await convSplitState.send(type,payload),target=typeof payload.viewId==='string'?before?.views[payload.viewId]:next.panes[next.focusedPaneId]?.activeViewId?next.views[next.panes[next.focusedPaneId]!.activeViewId!]:undefined;
    if(target)focusSplitOwner(target);publishMainSelection(next);return next;
  };
  const placementBase=(layout:SplitWorkspaceLayout,mainPaneId:string):ConversationPlacementRecord=>mainPlacement??{version:1,workspaceId:layout.id,mainPaneId,mainSelection:{kind:'new'},floating:{},mainBasis:mainBasisOf(layout,mainPaneId)};
  // Placement commands all follow pending-intent → acknowledged send → commit-or-recover (T02/T03). commit runs only when the expectation holds.
  const runPlacementCommand=async(base:ConversationPlacementRecord,intent:PendingPlacementIntent,type:string,payload:Record<string,unknown>,commit:(next:SplitWorkspaceLayout)=>void)=>{
    writePlacementRecord({...base,pending:intent});
    try{
      await prepareWorkspace();
      const next=await convSplitState.send(type,{...payload,baseRevision:intent.baseRevision});
      if(expectationHolds(next,intent.expectation))commit(next);
      else writePlacementRecord({...base,pending:undefined,recovery:'layout-changed'});
    }catch(cause){const message=messageOf(cause);convSplitState.dismissError(message);setError(message);}
  };
  // Detach parks the conversation and floats it on the same plane; main becomes explicitly empty (T02/R02).
  const detachConversation=async(view:SurfaceRef,requestedRect?:ChatRect)=>{
    const current=convSplitState.layout;
    if(!current||view.kind!=='thread'||view.binding.authority.kind!=='local')return;
    const mainPaneId=resolveMainPaneId(current),viewport={width:window.innerWidth,height:window.innerHeight},rect=clampChatRect(requestedRect??DEFAULT_FLOAT_RECT,viewport);
    const base=placementBase(current,mainPaneId);
    const expectation=capturePlacementExpectation(current,{type:'view.park',payload:{viewId:view.id}},mainPaneId);
    const intent:PendingPlacementIntent={id:crypto.randomUUID(),kind:'detach',baseRevision:current.revision,targetViewId:view.id,desiredMainSelection:{kind:'empty'},desiredMainPaneId:mainPaneId,floatingAdd:{[view.id]:{view,rect}},floatingRemove:[],expectation};
    await runPlacementCommand(base,intent,'view.park',{viewId:view.id},next=>{
      writePlacementRecord({version:1,workspaceId:next.id,mainPaneId,mainSelection:{kind:'empty'},floating:{...base.floating,[view.id]:{view,rect}},mainBasis:mainBasisOf(next,mainPaneId)});
      const focusedThreadId=focusedSplitThread(next);
      placedThread.current=focusedThreadId??null;setSelectedId(focusedThreadId??null);try{localStorage.removeItem('harness:selected-thread');}catch{/* Selection remains usable. */}
    });
  };
  // Return replaces the main pane with the floating conversation, parking whatever occupied main (T02/R02).
  const returnConversation=async(view:SurfaceRef)=>{
    const current=convSplitState.layout;
    if(!current||view.kind!=='thread'||view.binding.authority.kind!=='local'||!view.binding.threadId)return;
    const threadId=view.binding.threadId,mainPaneId=resolveMainPaneId(current);
    const base=placementBase(current,mainPaneId);
    const expectation=capturePlacementExpectation(current,{type:'view.open',payload:{paneId:mainPaneId,view,placement:'replace'}},mainPaneId);
    const intent:PendingPlacementIntent={id:crypto.randomUUID(),kind:'return',baseRevision:current.revision,targetViewId:view.id,desiredMainSelection:{kind:'thread',threadId},desiredMainPaneId:mainPaneId,floatingAdd:{},floatingRemove:[view.id],expectation};
    await runPlacementCommand(base,intent,'view.open',{paneId:mainPaneId,view,placement:'replace'},next=>{
      const floating={...base.floating};delete floating[view.id];
      writePlacementRecord({version:1,workspaceId:next.id,mainPaneId,mainSelection:{kind:'thread',threadId},floating,mainBasis:mainBasisOf(next,mainPaneId)});
      const focusedThreadId=focusedSplitThread(next)??threadId;placedThread.current=focusedThreadId;setSelectedId(focusedThreadId);try{localStorage.setItem('harness:selected-thread',threadId);}catch{/* Selection remains usable. */}
    });
  };
  // Docking a float into a real pane split is an acknowledged command, never a local geometry change (T03/R03).
  const dockFloat=async(view:SurfaceRef,paneId:string,edge:SplitDropEdge,outer=false)=>{
    const current=convSplitState.layout;
    if(!current||view.binding.authority.kind!=='local'||!view.binding.threadId)return;
    const threadId=view.binding.threadId,base=mainPlacement;if(!base)return;
    const mainPaneId=resolveMainPaneId(current);
    const payload={paneId,newPaneId:'pane-'+crypto.randomUUID(),splitId:'split-'+crypto.randomUUID(),axis:edge==='left'||edge==='right'?'horizontal':'vertical',before:edge==='left'||edge==='top',view,...(outer?{outer:true}:{})};
    const expectation=capturePlacementExpectation(current,{type:'pane.split',payload},mainPaneId);
    const intent:PendingPlacementIntent={id:crypto.randomUUID(),kind:'dock',baseRevision:current.revision,targetViewId:view.id,desiredMainSelection:base.mainSelection,desiredMainPaneId:mainPaneId,floatingAdd:{},floatingRemove:[view.id],expectation};
    await runPlacementCommand(base,intent,'pane.split',payload,next=>{
      const floating={...base.floating};delete floating[view.id];
      const activeViewId=next.panes[mainPaneId]?.activeViewId,activeView=activeViewId?next.views[activeViewId]:undefined;
      const activeThreadId=activeView?.kind==='thread'&&activeView.binding.authority.kind==='local'?activeView.binding.threadId:undefined;
      writePlacementRecord({version:1,workspaceId:next.id,mainPaneId,mainSelection:activeThreadId?{kind:'thread',threadId:activeThreadId}:{kind:'empty'},floating,mainBasis:mainBasisOf(next,mainPaneId)});
      const focusedThreadId=focusedSplitThread(next)??threadId;placedThread.current=focusedThreadId;setSelectedId(focusedThreadId);try{localStorage.setItem('harness:selected-thread',threadId);}catch{/* Selection remains usable. */}
    });
  };
  // Local float geometry persists without a split command; the plane keeps the live rect (T02/R02).
  const moveFloat=(viewId:string,rect:ChatRect)=>{
    const base=mainPlacement;
    if(!base||!base.floating[viewId])return;
    writePlacementRecord({...base,floating:{...base.floating,[viewId]:{...base.floating[viewId],rect}}});
  };
  // Explicit main navigation publishes the main selection, clearing any explicit-empty override (T02/R02).
  const publishMainSelection=(layout:SplitWorkspaceLayout)=>{
    if(!mainPlacement)return;
    const mainPaneId=resolveMainPaneId(layout),activeViewId=layout.panes[mainPaneId]?.activeViewId,activeView=activeViewId?layout.views[activeViewId]:undefined;
    const activeThreadId=activeView?.kind==='thread'&&activeView.binding.authority.kind==='local'?activeView.binding.threadId:undefined;
    if(!activeThreadId)return;
    const sel=mainPlacement.mainSelection;
    if(sel.kind==='thread'&&sel.threadId===activeThreadId)return;
    writePlacementRecord({...mainPlacement,mainSelection:{kind:'thread',threadId:activeThreadId},mainBasis:mainBasisOf(layout,mainPaneId),pending:undefined});
  };
  const openSplitTool=async(kind:WorkspacePanelKind,paneId=layoutSplitState.layout?.focusedPaneId,beside=false,ownerThreadId?:string,preserveFocus=false,explicitBinding?:PanelBinding,onOpened?:(id:string)=>void)=>{
    if(explicitBinding&&explicitBinding.authority.kind!=='local')throw Error('Open this tool in its owning workspace.');
    if(kind==='usage'){const current=layoutSplitState.layout,viewId=paneId?current?.panes[paneId]?.activeViewId:undefined,binding=viewId?current?.views[viewId]?.binding:undefined;if(binding&&binding.authority.kind!=='local')throw Error('Open usage in its owning workspace.');openUsage(ownerThreadId??(binding?.authority.kind==='local'?binding.threadId:undefined)??thread?.id);return;}
    const current=layoutSplitState.layout;if(!current||!paneId)throw Error('Wait for the workspace to load.');
    if(kind==='thread'){toast('Drag an existing thread from the sidebar into this area.');return;}
    const activeId=current.panes[paneId]?.activeViewId,basis=activeId?current.views[activeId]?.binding:undefined,ownerId=explicitBinding?.threadId??ownerThreadId??(basis?.authority.kind==='local'?basis.threadId:thread?.id),owner=snapshotRef.current.threads.find(item=>item.id===ownerId);
    if(['plan','notes','artifact','agent'].includes(kind)&&!owner)throw Error('Choose a conversation for this view.');
    const binding:PanelBinding=explicitBinding?{...explicitBinding}:{authority:{kind:'local'},...(owner?{threadId:owner.id,...(owner.projectId?{projectId:owner.projectId}:{})}:{})};
    if(kind==='browser'){if(!desktop||desktop.context.surface.kind!=='main')throw Error('Open the browser from the desktop workspace.');let docked=desktop.state.dockedBrowser;if(!docked){await desktop.bridge.browser({type:'open'});const context=await desktop.bridge.getContext();if(context.windowId!==desktop.context.windowId||context.surface.kind!=='main')throw Error('The owning workspace changed.');docked=context.dockedBrowser;}if(!docked)throw Error('The browser could not open.');binding.browserId=docked.browserId;delete binding.threadId;delete binding.projectId;}
    if(kind==='terminal')binding.terminalId=crypto.randomUUID();
    if(kind==='artifact'&&!binding.artifactId){const artifact=snapshotRef.current.artifacts.find(item=>item.threadId===owner?.id&&item.lifecycle==='active');if(!artifact)throw Error('This conversation has no active artifact.');binding.artifactId=artifact.id;}
    const view:SurfaceRef={id:kind==='browser'?'browser:'+binding.browserId:kind+':'+(owner?.id??'workspace')+(kind==='terminal'?':'+binding.terminalId:''),kind,binding};
    await prepareWorkspace();
    const existing=Object.values(current.views).find(value=>sameSplitWorkspaceView(value,view));
    if(existing)view.id=existing.id;else if(binding.artifactId||binding.resourceId)view.id=kind+':'+crypto.randomUUID();
    const bounds=document.querySelector('.split-root-workarea')?.getBoundingClientRect(),next=toolPlacementCommand(current,view,paneId,beside,{width:bounds?.width??window.innerWidth,height:Math.max(0,bounds?.height??window.innerHeight)});
    await layoutSplitState.send(next.type,{...next.payload,...(preserveFocus?{preserveFocus:true}:{})});
    onOpened?.(view.id);
  };
  const revealWorkspaceTool=(kind:typeof layout.activeTab,resourceId?:string,artifactId?:string,ownerBinding?:PanelBinding)=>{
    if(onRequestWorkspaceTool){onRequestWorkspaceTool(kind,resourceId,artifactId);return;}
    if(ownerBinding&&(ownerBinding.authority.kind!=='local'||ownerBinding.threadId!==thread?.id)){const binding=ownerBinding??{authority:{kind:'local'} as const,...(thread?{threadId:thread.id,...(thread.projectId?{projectId:thread.projectId}:{})}:{})};void openSplitTool(kind,undefined,false,binding.threadId,false,{...binding,...(resourceId?{resourceId}:{}),...(artifactId?{artifactId}:{})}).catch(cause=>setError(messageOf(cause)));return;}
    if(resourceId)setFocusedResource(resourceId);
    setLayout(value=>({...value,rightPanelOpen:true,activeTab:kind,openTabs:value.openTabs.includes(kind)?value.openTabs:[...value.openTabs,kind],...(artifactId!==undefined?{activeArtifactId:artifactId||null}:{})}));
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
    if(!splitEnabled||!convSplitState.layout||!thread||!selectedPlan?.plan)return;
    const owningPane=Object.values(convSplitState.layout.panes).find(pane=>pane.activeViewId&&convSplitState.layout!.views[pane.activeViewId]?.kind==='thread'&&convSplitState.layout!.views[pane.activeViewId]?.binding.threadId===thread.id);if(!owningPane)return;
    const token=thread.id+':'+selectedPlan.revision;if(openedPlanRevision.current.has(token))return;
    openedPlanRevision.current.add(token);
    const current=convSplitState.layout,existing=Object.values(current.views).find(view=>view.kind==='plan'&&view.binding.threadId===thread.id);
    const location=existing?Object.values(current.panes).find(pane=>pane.viewIds.includes(existing.id)):undefined;
    const reveal=async()=>{if((document.querySelector('.split-root-workarea')?.getBoundingClientRect().width??window.innerWidth)<700)return;if(existing&&location){if(location.collapsed)await convSplitState.send('pane.collapse',{paneId:location.id,collapsed:false});else if(location.activeViewId!==existing.id)await convSplitState.send('view.activate',{paneId:location.id,viewId:existing.id,preserveFocus:true});}else await openSplitTool('plan',owningPane.id,true,thread.id,true);};
    void reveal().catch(cause=>{openedPlanRevision.current.delete(token);setError(messageOf(cause));});
  },[splitEnabled,convSplitState.layout,thread?.id,selectedPlan?.revision]);
  const openInbox=async(paneId=convSplitState.layout?.focusedPaneId)=>{if(!paneId)return;await prepareWorkspace();await convSplitState.send('view.open',{paneId,view:{id:'inbox:personal',kind:'workspace',binding:{authority:{kind:'local'},resourceId:'agent-inbox'}}});};
  const openBackgroundWork=async(paneId=convSplitState.layout?.focusedPaneId)=>{if(!paneId)return;await prepareWorkspace();await convSplitState.send('view.open',{paneId,view:{id:'background:personal',kind:'workspace',binding:{authority:{kind:'local'},resourceId:'background-work'}}});};
  useEffect(()=>{if(embeddedThreadId)return;return desktop?.bridge.onAttentionOpen?.(id=>select(id));},[desktop?.bridge,embeddedThreadId]);
  const renderSplitView=(view:SurfaceRef,active:boolean)=>{
    if(view.binding.authority.kind!=='local')return <p className="panel-note">This view belongs to another installed workspace.</p>;
    if(view.kind==='thread')return <div className="split-thread-owner" onFocusCapture={()=>focusSplitOwner(view)}>{view.binding.threadId?<App onDirtyWidgetChange={onDirtyWidget} onComposerChangesAvailability={reportComposerChanges} sharedComposers={host?.composers??sharedComposers} embeddedThreadId={view.binding.threadId} embeddedActive={active} modelPickerRequest={modelPickerRequest} onRequestThread={select} liveUsage={{open:liveUsageOpen,toggle:()=>{focusSplitOwner(view);setLiveUsageOpen(value=>!value);}}}/>:<p>The owning conversation is unavailable.</p>}</div>;
    if(view.kind==='workspace'&&view.binding.resourceId==='agent-inbox')return <AgentInbox active={active} onOpenThread={select} timeFormat={preferences.timeFormat}/>;
    if(view.kind==='workspace'&&view.binding.resourceId==='background-work')return <BackgroundWork active={active} onOpenThread={select} defaultModelId={snapshot.settings.modelId}/>;
    if(view.kind==='plan')return <PlanStatus snapshot={snapshot} threadId={view.binding.threadId}/>;
    const panel:PanelPlacement={...view,canvasId:activeCanvas?.id??'workspace-default',placement:'canvas',visible:true,collapsed:false,bounds:{x:0,y:0,width:480,height:380},order:0,alwaysOnTop:false};return canvasBodyGuarded(panel,active);
  };
  const renderConversationView=(view:SurfaceRef,active:boolean)=>view.kind==='thread'
    ?<div className="split-thread-owner" onFocusCapture={()=>focusSplitOwner(view)}>{view.binding.threadId?<App onDirtyWidgetChange={onDirtyWidget} onComposerChangesAvailability={reportComposerChanges} sharedComposers={host?.composers??sharedComposers} embeddedThreadId={view.binding.threadId} embeddedActive={active} modelPickerRequest={modelPickerRequest} hostWorkspaceContext={workspaceContext} onRequestWorkspaceTool={(kind,resourceId,artifactId)=>revealWorkspaceTool(kind,resourceId,artifactId,view.binding)} onRequestThread={select} liveUsage={{open:liveUsageOpen,toggle:()=>{focusSplitOwner(view);setLiveUsageOpen(value=>!value);}}}/>:<p>The owning conversation is unavailable.</p>}</div>
    :<SurfaceBoundary resetKey={view.id}>{renderSplitView(view,active)}</SurfaceBoundary>;
  const splitRoot=splitEnabled&&Boolean(thread||convSplitState.layout&&Object.keys(convSplitState.layout.views).length);
  const panelToggle=!embeddedThreadId?<button type="button" className={`icon-button workspace-panel-toggle ${layout.rightPanelOpen ? 'selected' : ''}`} aria-label={layout.rightPanelOpen ? 'Hide workspace panel' : 'Open workspace panel'} aria-pressed={layout.rightPanelOpen} title={layout.rightPanelOpen ? 'Close right panel' : 'Open right panel'} onClick={() => setLayout(value => value.rightPanelOpen ? { ...value, rightPanelOpen: false, rightPanelMaximized: false } : { ...value, rightPanelOpen: true })}><PanelRight size={17} /></button>:null;
  const rightWindowOpen=layout.rightPanelOpen||sideOpen||Boolean(documentWindow&&documentWindow.placement==='docked')||Boolean(desktop?.state.dockedBrowser);
  // Live Usage follows an eligible visible conversation focus; main placement remains its own navigation owner.
  const usagePlaneLayout=customDock?customConversationLayout:convSplitState.layout;
  const activeUsageViewIds=liveUsageViews.workspaceId===usagePlaneLayout?.id?liveUsageViews.viewIds:[];
  const usageCandidates=!splitEnabled||selectedPluginId||desktop?.closing?[]:Object.values(usagePlaneLayout?.views??{}).flatMap(view=>{
    if(view.kind!=='thread'||view.binding.authority.kind!=='local'||!activeUsageViewIds.includes(view.id))return[];
    const owner=snapshot.threads.find(item=>item.id===view.binding.threadId&&(item.projectId??null)===(view.binding.projectId??null));
    if(!owner||detachedSurface(desktop,{kind:'thread',threadId:owner.id})||pendingSurface(desktop,{kind:'thread',threadId:owner.id}))return[];
    return[owner];
  });
  const sharedUsageOwner=usageCandidates.find(owner=>owner.id===selectedId)??usageCandidates.find(owner=>owner.id===thread?.id);
  const fullPlanVisible=Boolean(thread&&convSplitState.layout&&planVisible(convSplitState.layout,thread.id));
  const contextSummaries=<SummaryDock><DockedSummary id="plan" title="Project overview" className="summary-overview" open={!detachedPlan&&!rightWindowOpen}
    defaultCollapsed focusOnOpen={false} expandRequest={planExpandRequest||undefined}><SurfaceBoundary resetKey={candidateThread?.id??'new'}><ProjectContextSurface composerChangesAvailable={composerChangesAvailable} key={candidateThread?.id??'new'} thread={candidateThread} snapshot={snapshot} fullPlanVisible={fullPlanVisible||Boolean(detachedPlan)} onOpenDetailedPlan={()=>void openSplitTool('plan',undefined,true,candidateThread?.id).catch(cause=>setError(messageOf(cause)))} onSelectThread={select} onShowChanges={()=>void openSplitTool('diff',undefined,true,candidateThread?.id).catch(cause=>setError(messageOf(cause)))} onConnect={()=>openProjectConnect({threadId:candidateThread?.id,projectId:candidateThread?.projectId})}/></SurfaceBoundary></DockedSummary><UsageFooter open={liveUsageOpen} threadId={sharedUsageOwner?.id} usage={sharedUsageOwner?snapshot.usage[sharedUsageOwner.id]:undefined} visible={Boolean(sharedUsageOwner)&&preferences.showUsageFooter&&!rightWindowOpen} onOpenUsage={openUsage}/></SummaryDock>;
  const [retryingMainLayout,setRetryingMainLayout]=useState(false);
  const retryMainLayout=()=>{
    if(retryingMainLayout)return;
    setRetryingMainLayout(true);
    void convSplitState.refresh().catch(()=>{}).finally(()=>setRetryingMainLayout(false));
  };
  const renderSplitRoot=()=>{const planeLayout=customDock?customConversationLayout:convSplitState.layout;return planeLayout?<div className="split-root-workarea"><SummaryLayout active={!rightWindowOpen&&(!detachedPlan||(preferences.showUsageFooter&&liveUsageOpen))} summaries={contextSummaries}><WorkspaceSplitLayout layout={planeLayout} onCommand={convSendSplitCommand} prepare={prepareWorkspace} renderView={renderConversationView} onActiveViewsChange={updateLiveUsageViews} floating={mainPlacement?Object.fromEntries(Object.entries(mainPlacement.floating).map(([id,entry])=>[id,entry.rect])):undefined} onReturnFloat={returnConversation} onDetachView={detachConversation} onMoveFloat={moveFloat} onDockFloat={dockFloat} emptyMainPaneId={!customDock&&mainPlacement?.mainSelection.kind==='empty'?resolveMainPaneId(planeLayout):undefined} title={view=>view.kind==='thread'?snapshot.threads.find(item=>item.id===view.binding.threadId)?.title??'Unavailable conversation':view.kind==='workspace'&&view.binding.resourceId==='agent-inbox'?'Agent inbox':view.kind==='workspace'&&view.binding.resourceId==='background-work'?'Background work':panelLabels[view.kind]} onDropThread={async(id,paneId,edge,outer)=>{setSelectedPluginId(null);setSelectedPluginWorkspace(null);await placeSplitThread(id,paneId,edge,outer).catch(cause=>setError(messageOf(cause)));}} editorOptions={['thread','browser','files','diff','notes','plan','terminal','linked-pull-requests','context','usage','inbox','background-work'].map(id=>({id,title:id==='inbox'?'Agent inbox':id==='background-work'?'Background work':panelLabels[id as WorkspacePanelKind]}))} onSelectEditor={(kind,paneId)=>kind==='inbox'?openInbox(paneId):kind==='background-work'?openBackgroundWork(paneId):openSplitTool(kind as WorkspacePanelKind,paneId)}/></SummaryLayout>{convSplitState.error&&!layoutChooserOpen&&<p className="split-layout-error" role="alert">{convSplitState.error}</p>}</div>:convSplitState.error?<div className="workspace-error"><span role="alert">{convSplitState.error}</span><button type="button" className="quiet" disabled={retryingMainLayout} onClick={retryMainLayout}>Retry workspace layout</button></div>:<LoadingState pending hasContent={false} label="Opening workspace layout..." skeleton={<WorkspaceSkeleton sidebar={false}/>} className="view-loading-state"/>;};
  const interfaceFont = preferences.interfaceFont === 'system' ? '-apple-system, BlinkMacSystemFont, "Inter Variable", "Segoe UI", system-ui, sans-serif' : preferences.interfaceFont === 'Inter' ? '"Inter Variable", sans-serif' : preferences.interfaceFont;
  const handledHostIntent=useRef<number|undefined>(undefined),[modelPickerRequest,setModelPickerRequest]=useState<{id:number;threadId?:string}>();
  const pickerRequest=externalModelPicker??modelPickerRequest;
  useEffect(()=>{
    if(!loaded||!host?.intent||handledHostIntent.current===host.intent.id)return;
    handledHostIntent.current=host.intent.id;
    if(host.intent.kind==='settings'){setSettingsSection('general');setSettingsOpen(true);}
    else if(host.intent.kind==='model')setModelPickerRequest({id:host.intent.id,threadId:host.initialThreadId??thread?.id});
    else if(host.intent.kind==='usage'){setUsageThreadId(thread?.id??null);setUsageOpen(true);}
    else if(host.intent.kind==='new-thread')void newThreadRef.current().catch(cause=>setError(messageOf(cause)));
    else if(host.intent.kind==='connect-project')setProjectConnectOpen(true);
    else if(host.intent.kind==='resources')void ensureThread(async()=>{}).then(id=>openResourcePicker(id)).catch(cause=>setError(messageOf(cause)));
    else if(host.intent.kind==='plugin-workspace'){if(host.intent.pluginId&&host.intent.workspaceId)void selectPluginWorkspace(host.intent.pluginId,host.intent.workspaceId).catch(cause=>setError(messageOf(cause)));}
    else {const review=host.intent.review?{id:host.intent.id,...host.intent.review}:undefined;openSidebarTool('linked-pull-requests',review);}
    host.consumeIntent(host.intent.id);
  },[loaded,host?.intent?.id]);
  const promptFont = preferences.promptFont === 'system' ? 'inherit' : preferences.promptFont;
  const metadataModel = thread ? models.find(item => item.id === (thread.modelId ?? modelId)) : undefined;
  const shellStyle = { '--sidebar-width': layout.sidebarWidth + 'px', '--right-panel-width': panelWidth + 'px', '--panel-motion': (preferences.panelAnimations ? preferences.motionDuration : 0) + 'ms', '--prompt-font': promptFont, '--code-font': preferences.codeFont, '--interface-font': interfaceFont, '--interface-font-size': preferences.fontSize + 'px' } as CSSProperties;
  if(loaded&&pinnedThreadId&&!thread)return <main className="desktop-surface"><p role="status">The owning conversation is no longer available. Dock this window to choose another task.</p></main>;
  return <WorkspaceProvider value={hostWorkspaceContext ?? workspaceContext}><div className={`app-shell ${embeddedThreadId?'embedded-thread-app':''} ${navigationOnly?'desktop-navigation-only':''} ${pinnedThreadId?'desktop-thread-only':''} ${!hostWorkspaceContext&&layout.rightPanelOpen ? 'has-right-panel' : ''} `} inert={desktop?.closing||Boolean(embeddedThreadId&&!embeddedActive)} style={shellStyle} data-document-docked={documentWindow?.placement==='docked'} data-sidebar-collapsed={layout.sidebarCollapsed} data-chat-width={preferences.chatWidth} data-contrast={preferences.contrast} data-word-wrap={preferences.wordWrap} data-panel-animations={preferences.panelAnimations} data-live-usage={preferences.showUsageFooter}>
    {sidebarOpen && <button ref={sidebarScrim} className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
    {!pinnedThreadId&&!detachedNavigation&&<ShellSidebar onPlaceThread={splitEnabled&&!customDock?item=>{setSelectedPluginId(null);setSelectedPluginWorkspace(null);void placeSplitThread(item.id).catch(cause=>setError(messageOf(cause)));}:undefined} detachThread={desktop&&desktopSurface?.kind==='main'?item=>{void desktop.detachSurface({kind:'thread',threadId:item.id}).catch(cause=>setError(messageOf(cause)));}:undefined} navigation={plugins.length>0&&<nav className="plugin-navigation" aria-label="Installed plug-ins">{plugins.map(plugin=><button key={plugin.id} aria-current={selectedPluginId===plugin.id?'page':undefined} onClick={()=>{void selectPlugin(plugin.id).then(()=>setSidebarOpen(false)).catch(cause=>setError(messageOf(cause)));}}>{plugin.name}</button>)}</nav>} elementRef={sidebar} searchRef={searchRef} mobile={mobile} open={sidebarOpen} layout={layout} preferences={preferences} matching={matching} hoverBlocked={Boolean(settingsOpen||usageOpen||projectPicker||projectConnectOpen||resourcePicker||rename)} onOpenThreadPR={host?.openReview?(target,scope)=>{void host.openReview!(target,scope).catch(cause=>setError(messageOf(cause)));}:undefined} selectedId={thread?.id} loaded={loaded} creating={composerBusy || threadCreating} search={search} setSearch={setSearch} close={() => setSidebarOpen(false)} toggleCollapsed={event => {if (navigationOnly) void desktop?.bridge.reattach(); else {prepareSidebarToggle(event); setLayout(value => ({ ...value, sidebarCollapsed: !value.sidebarCollapsed }));}}} setFolded={(key, folded) => setLayout(value => ({ ...value, folded: { ...value.folded, [key]: folded } }))} select={select} create={() => void newThreadRef.current().catch(error => setError(messageOf(error)))} settings={() => { setSettingsSection('general'); setSettingsOpen(true); }} onConnectProject={()=>openProjectConnect({})} onOpenPullRequests={()=>openSidebarTool('linked-pull-requests')} onOpenUsage={()=>openSidebarTool('usage')} rename={item => { void prepareSourceJournal().then(()=>{selectNow(item.id);setTitle(item.title);setRename(true);}).catch(cause=>setError(messageOf(cause))); }} archive={id => void archive(id)} presentation={async (item, patch) => { if (patch.pinned === false && preferences.unpinConfirmation && !window.confirm('Unpin this thread?')) return false; try { await command('thread.presentation', patch, item.id); void refresh().catch(error => setError(messageOf(error))); return true; } catch (error) { setError(messageOf(error)); return false; } }} ensureManualOrder={async () => { try { await command('settings.update', { preferences: { projectOrder: 'manual' } }); await refresh(); return true; } catch (error) { setError(messageOf(error)); return false; } }} />}
    {!navigationOnly&&!pinnedThreadId&&!detachedNavigation&&!mobile && !layout.sidebarCollapsed && <ResizeHandle label="Resize sidebar" value={layout.sidebarWidth} minimum={200} maximum={380} side="left" change={sidebarWidth => setLayout(value => ({ ...value, sidebarWidth }))} />}
    {!navigationOnly&&<div className="workspace-layout-workarea">{!pinnedThreadId&&!detachedNavigation&&(layout.sidebarCollapsed||mobile)&&<button type="button" className="icon-button sidebar-recovery" aria-label={mobile?"Open navigation":"Open sidebar"} aria-expanded={mobile?sidebarOpen:false} onClick={event=>{prepareSidebarToggle(event);setLayout(value=>({...value,sidebarCollapsed:false}));if(mobile)setSidebarOpen(true);requestAnimationFrame(()=>searchRef.current?.focus());}}>{mobile?<Menu size={18}/>:<PanelLeftOpen size={17}/>}</button>}{!pinnedThreadId&&<WorkspaceControls onChoosePreset={host?.choosePreset} pluginWorkspaces={pluginWorkspaces} selectedPluginWorkspace={selectedPluginWorkspace} onSelectPluginWorkspace={(pluginId,id)=>void selectPluginWorkspace(pluginId,id).catch(cause=>setError(messageOf(cause)))} pluginCatalogError={pluginCatalog.error||(pluginCatalog.failed?'Plug-ins could not be loaded.':'')} onRetryPluginCatalog={pluginCatalog.retry} extensions={pluginCatalog.extensions??[]} onSelectBuiltin={()=>{setSelectedPluginId(null);setSelectedPluginWorkspace(null);setWorkspaceMode('chat');}} panelToggle={panelToggle} workspaceMode={workspaceMode} onWorkspaceMode={setWorkspaceMode} retainedWorkspace={retainedWorkspace} retainedAvailable={activeCanvas?.preset==='workspace'&&activeCanvas.panels.length>0} onLayoutOpenChange={setLayoutChooserOpen} splitProfiles={splitProfiles.profiles} splitLayout={layoutSplitState.layout} splitProfilesLoading={splitProfiles.loading} splitProfilesError={splitProfiles.error} refreshSplitProfiles={splitProfiles.refresh} saveSplitProfile={savedLayoutActions.save} applySplitProfile={savedLayoutActions.apply} renameSplitProfile={savedLayoutActions.rename} removeSplitProfile={savedLayoutActions.remove} splitWorkspace={splitEnabled} activeBinding={thread?{authority:{kind:'local'},threadId:thread.id,...(thread.projectId?{projectId:thread.projectId}:{})}:undefined} envelope={workspaceEnvelope} error={workspaceState.error} onActionError={setError} send={workspaceState.send} prepare={prepareWorkspace} panels={canvasPanels} title={panelTitle} addPanel={customDock?kind=>openSplitTool(kind):addCanvasPanel} updatePanel={updateCanvasPanel}/>} {error && <div className="workspace-error" role="alert">{error}<button className="quiet" onClick={() => { setError(''); void bootstrap().then(() => refresh()).then(() => { setLoaded(true); return loadModels(); }).catch(error => setError(messageOf(error))); }}>Refresh</button><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={15} /></button></div>} <div className="personal-workarea" hidden={Boolean(selectedPluginId)}> {Object.values(dirtyWidgets).some(id => id !== thread?.id) && <div className="workspace-error retained-widget-notice"><span>Widget edits remain open in another conversation.</span><button className="quiet" onClick={() => void discardHiddenWidgets()}>Discard hidden widget edits</button></div>}{widgetDiscardError && <div className="workspace-error" role="status">{widgetDiscardError}<button className="icon-button" aria-label="Dismiss error" onClick={() => setWidgetDiscardError('')}><X size={15} /></button></div>}{canvasActive?renderWorkspaceCanvas():<div className="shell-workarea" ref={setPanelOwner} data-tool-layout={panelBounds.stacked?'stacked':'side'}>{splitRoot?renderSplitRoot():
    <SummaryLayout active={!embeddedThreadId&&!rightWindowOpen&&(!detachedPlan||(preferences.showUsageFooter&&liveUsageOpen))} summaries={!embeddedThreadId&&<SummaryDock><DockedSummary id="plan" title="Project overview" className="summary-overview" open={!detachedPlan&&!rightWindowOpen}
      defaultCollapsed focusOnOpen={planFocusOnOpen} expandRequest={planExpandRequest||undefined}><SurfaceBoundary resetKey={candidateThread?.id??'new'}><ProjectContextSurface composerChangesAvailable={composerChangesAvailable} key={candidateThread?.id??'new'} thread={candidateThread} snapshot={snapshot} planOpen={planOpen} fullPlanVisible={Boolean(detachedPlan)} onOpenDetailedPlan={()=>revealWorkspaceTool('plan')} onTogglePlan={()=>{if(planOpen)dismissPlan();else{planVisibility.show(candidateThread);setPlanFocusOnOpen(false);setPlanExpandRequest(value=>value+1);setPlanOpen(true);}}} onSelectThread={select} onShowChanges={()=>revealWorkspaceTool('diff')} onConnect={()=>openProjectConnect({threadId:candidateThread?.id,projectId:candidateThread?.projectId})}/></SurfaceBoundary></DockedSummary><UsageFooter open={liveUsageOpen} threadId={thread?.id} usage={thread?snapshot.usage[thread.id]:undefined} visible={preferences.showUsageFooter&&!rightWindowOpen} onOpenUsage={openUsage}/></SummaryDock>}>
    <SourceWorkbenchProvider snapshot={snapshot} active={!threadHeld&&embeddedActive} owner={thread?{threadId:thread.id,projectId:thread.projectId??null,workspaceId:thread.workspaceId??null}:undefined} ownerEpoch={`${thread?.epoch??0}:${thread?.accountId??''}:${embeddedActive}:${threadHeld}`}><div ref={findScope} style={{display:'contents'}}><ChatView enabled={!embeddedThreadId} header={<><div className="breadcrumb">{thread?.projectName && <><Folder size={13} /><span>{thread.projectName}</span><span className="breadcrumb-slash">/</span></>}<strong>{thread?.title ?? 'New conversation'}</strong></div>{preferences.showThreadDetails && thread && <p className="conversation-metadata">{[metadataModel?.name ?? thread.modelId, metadataModel?.provider, thread.projectName, threadStatus(thread)].filter(Boolean).join(' · ')}</p>}{thread&&<SessionBranchLineage thread={thread} overview={sessionBranchOverview} onOpenThread={select}/>}</>} actions={<><ConversationFind ownerKey={thread?.id??'new'} transcript={conversation} scope={findScope} active={loaded&&embeddedActive&&!threadHeld} onNavigate={()=>setLatestAvailable(false)} onLoadEarlier={canLoadActiveHistory?()=>activeHistoryControl.current?.click():undefined}/>{thread&&<SessionBranchMenu thread={thread} messages={snapshot.messages.filter(item=>item.threadId===thread.id)} overview={sessionBranchOverview} reloadOverview={reloadSessionBranch} onOpenThread={select} onChanged={()=>void refresh()}/>}{!online&&<span className="connection-state" title="Reconnecting"><WifiOff size={13}/>Reconnecting</span>}{pinnedThreadId&&!embeddedThreadId&&<button type="button" className={`icon-button workspace-panel-toggle ${layout.rightPanelOpen ? 'selected' : ''}`} aria-label={layout.rightPanelOpen ? 'Hide workspace panel' : 'Open workspace panel'} aria-pressed={layout.rightPanelOpen} title={layout.rightPanelOpen ? 'Close right panel' : 'Open right panel'} onClick={() => setLayout(value => value.rightPanelOpen ? { ...value, rightPanelOpen: false, rightPanelMaximized: false } : { ...value, rightPanelOpen: true })}><PanelRight size={17} /></button>}</>}>
      
      {detachedThread&&<div className="notice">Conversation open in another window.<button className="quiet" onClick={()=>void desktop?.bridge.focus(detachedThread.id)}>Focus chat</button></div>}<div className="conversation-frame"><ChatScrollIndicator scrollRef={conversation} controllerRef={conversationMotion} contentKey={thread?.id}/><div inert={threadHeld} ref={conversation} className="conversation-scroll" onScroll={rememberPosition} aria-label="Conversation" tabIndex={0}>{[thread, ...snapshot.threads.filter(item => item.id !== thread?.id && Object.values(dirtyWidgets).includes(item.id))].toSorted((a, b) => (a?.createdAt ?? '').localeCompare(b?.createdAt ?? '') || (a?.id ?? '').localeCompare(b?.id ?? '')).map(panelThread => {
        const thread = panelThread;
        const messages = snapshot.messages.filter(item => item.threadId === thread?.id);
        const artifacts = snapshot.artifacts.filter(item => item.threadId === thread?.id && item.lifecycle === 'active');
        const requests = snapshot.requests.filter(item => item.threadId === thread?.id && item.status === 'pending');
        const operations = snapshot.operations.filter(item => item.threadId === thread?.id);
        const historyId = thread?.id ?? 'new';
        const present = new Set(messages.map(message => message.id));
        const older = historyId===activeHistoryId?activeOlder:(olderMessages.current.get(historyId) ?? []).filter(message => !present.has(message.id));
        const allMessages = [...older, ...messages];
        const historyStart = historyStarts.current.get(historyId) ?? Math.max(0, allMessages.length - 100);
        historyStarts.current.set(historyId, historyStart);
        const artifactMessageIds = new Set(artifacts.map(artifact => artifact.messageId));
        const visibleMessageIds = new Set(allMessages.slice(historyStart).map(message => message.id));
        const canLoadHistory = canLoadConversationHistory(historyStart,snapshot.messagesTruncated?.[historyId]??0,older.length);
        // Group before paging to keep each run's full history and stable first-message key.
        const messageRows = groupWorkActivity(allMessages, artifactMessageIds).filter(({ message, updates }) => artifactMessageIds.has(message.id) || (updates ?? [message]).some(update => visibleMessageIds.has(update.id)));
        return <div key={thread?.id ?? 'new'} hidden={thread?.id !== (mainDetached?undefined:resolvedMainId)}><div className={`conversation ${!allMessages.length && !artifacts.length ? 'conversation-empty' : ''}`}>
        {!loaded && !error && <LoadingState pending hasContent={false} label="Opening workspace…" skeleton={<ConversationSkeleton/>}/>}
        {loaded && !allMessages.length && !artifacts.length && <div className="empty-state"><div className="empty-symbol"><MessageSquare size={25} strokeWidth={1.25} /></div><h1>{thread?.status==='working'?'Run in progress':'What are we working on?'}</h1><p>{thread?.status==='working'?'The transcript will appear here as the agent works.':'Start with a question, file, or project.'}</p>{!models.length && <button className="setup-inline" onClick={() => { setSettingsSection('providers'); setSettingsOpen(true); }}><CircleHelp size={15} /><span>Connect a model to get started</span><ChevronRight size={14} /></button>}</div>}
        {canLoadHistory && <button ref={historyId===activeHistoryId?activeHistoryControl:undefined} className="load-history quiet" onClick={() => { if (historyStart > 0) { captureHistoryAnchor(historyId); historyStarts.current.set(historyId, Math.max(0, historyStart - 100)); setHistoryCounts(previous => ({ ...previous, [historyId]: (previous[historyId] ?? 0) + 1 })); } else if (thread?.id) { const topId = allMessages[historyStart]?.id; const stored = olderMessages.current.get(historyId) ?? [], head = messages[0]?.id; const anchor = stored.length && lastWindowHeads.current.get(historyId) === head ? stored[0].id : head; lastWindowHeads.current.set(historyId, head); void getThreadMessages(thread.id, anchor).then(page => { const known = new Set(stored.map(item => item.id)), fresh = page.messages.filter(item => !known.has(item.id)); const merged = [...stored, ...fresh].sort((a, b) => a.createdAt.localeCompare(b.createdAt)); olderMessages.current.set(historyId, merged); while (olderMessages.current.size > 8) { const stale = [...olderMessages.current.keys()].find(key => key !== historyId); if (stale === undefined) break; olderMessages.current.delete(stale); lastWindowHeads.current.delete(stale); historyStarts.current.delete(stale); readingPositions.current.delete(stale); } const topIndex = merged.findIndex(item => item.id === topId); historyStarts.current.set(historyId, Math.max(0, (topIndex === -1 ? merged.length : topIndex) - 100)); captureHistoryAnchor(historyId); setOlderPageTick(value => value + 1); }).catch(cause => setError(messageOf(cause))); } }}>Load earlier messages</button>}
        {messageRows.map(({ message, updates }) => <div key={message.id} data-message-id={message.id} data-arrival={liveMessages.current.has(message.id)?'true':undefined} className={`message message-${message.role}`}><span className="sr-only">{message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Assistant' : 'Tool'}</span><div className="message-content">{updates ? <WorkActivity updates={updates} /> : message.role==='assistant'?<SourceMessage id={message.id} threadId={message.threadId} text={message.content}><AssistantProse message={message} arrivals={liveMessages.current} active={Boolean(thread?.runId&&thread.runId===message.runId)} /></SourceMessage>:<Markdown text={message.content} />}{!updates&&<CopyButton text={message.content} label="Copy message"/>}</div>{artifacts.filter(artifact => artifact.messageId === message.id).map(artifact => <Artifact key={artifact.id} artifact={artifact} snapshot={snapshot} theme={theme} refresh={refresh} onDirtyWidget={onDirtyWidget} suspended={threadHeld} active={thread?.id===resolvedMainId} animateEntry={liveEntries.current.has(artifact.id)} />)}</div>)}
        {artifacts.filter(artifact => !messages.some(message => message.id === artifact.messageId)).map(artifact => <Artifact key={artifact.id} artifact={artifact} snapshot={snapshot} theme={theme} refresh={refresh} onDirtyWidget={onDirtyWidget} suspended={threadHeld} active={thread?.id===resolvedMainId} animateEntry={liveEntries.current.has(artifact.id)} />)}
        {requests.map(request => <InputDecision key={request.presentation?`${request.id}:${JSON.stringify(request.responseSchema)}`:`${request.id}:${request.revision}`} request={request} snapshot={snapshot} refresh={refresh} />)}{operations.map(operation => <OperationDecision key={`${operation.id}:${operation.revision}`} operation={operation} refresh={refresh} owner={thread} />)}
        {loaded&&thread&&thread.id===(mainDetached?undefined:(snapshot.threads.find(item=>item.id===selectedId)??snapshot.threads.find(item=>item.id===snapshot.activeThreadId))?.id)&&<ToolProgramPanel threadId={thread.id} ownerKey={JSON.stringify([thread.id,thread.runId,thread.epoch,thread.accountId??null,thread.projectId??null,thread.workspaceId??null])}/>}
        {thread?.error && <p className="notice" role="status">{thread.error}</p>}
        {thread && (thread.runId || thread.status === 'working') && <div className="working-status" role="status"><LoaderCircle size={13} className="spinning" /><span>{({queued:'Queued for account…',starting:'Starting runtime…',generating:'Generating…',tool:'Running tool…',cleanup:'Cleaning up…',compacting:'Compacting context…'} as Record<string,string>)[snapshot.usage[thread.id]?.activity ?? ''] ?? 'Working…'}</span><button className="quiet" onClick={() => void stopConversation(thread, host?.composers ?? sharedComposers).then(() => refresh()).catch(error => setError(messageOf(error)))}>Stop</button></div>}
      </div></div>; })}</div></div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
      {latestAvailable && <button className="jump-latest secondary" onClick={() => { const position=conversationMotion.current?.jump();if(position)readingPositions.current.set(thread?.id??'new',position);setLatestAvailable(false);setAnnouncement(''); }}>Jump to latest<ArrowUp size={13} /></button>}
      <div style={{display:'contents'}} inert={threadHeld}>{thread&&delegatedThread(thread)?<div className="canvas-thread-readonly">Read-only. Continue in the parent conversation.</div>:loaded&&thread&&threadParent(thread)?<SideThreadComposer key={thread.id} thread={thread} modelId={modelId} refresh={refresh}/>:loaded ? <Composer usageOpen={liveUsage?.open??liveUsageOpen} onShowUsage={liveUsage?.toggle??(()=>setLiveUsageOpen(value=>!value))} onComposerChangesAvailability={reportComposerChanges} modelPickerRequest={pickerRequest?.threadId===thread?.id?pickerRequest?.id:undefined} onModelPickerOpened={id=>setModelPickerRequest(current=>current?.id===id?undefined:current)} sharedComposers={host?.composers??sharedComposers} selectProject={openProjectSelection} predictionBlocked={Boolean(embeddedThreadId&&!embeddedActive) || threadHeld || Boolean(projectPicker) || projectConnectOpen || settingsOpen || usageOpen || Boolean(resourcePicker) || rename || (mobile && sidebarOpen)} key={thread?.id ?? 'new'} thread={thread} models={models} modelId={modelId} setModelId={updateModel} snapshot={snapshot} ensureThread={ensureThread} onNewTask={id=>{void updateModel(id);void newThreadRef.current().catch(error=>setError(messageOf(error)));}} busy={composerBusy || threadCreating} runAction={runComposerAction} refresh={refresh} setup={() => { setSettingsSection('providers'); setSettingsOpen(true); }} openResource={openResourcePicker} browseProject={id=>revealWorkspaceTool('files',id)} inspectChanges={()=>revealWorkspaceTool('diff')} reportError={setError} onSide={async content=>{setSideOpen(true);if(!sideChat.current)throw new Error("The side conversation is still opening.");await sideChat.current.ask(content);}} /> : <div className="composer-dock"><LoadingState pending={!error} hasContent={false} label="Opening conversation…" skeleton={<ComposerSkeleton/>}/></div>}</div>
    </ChatView></div></SourceWorkbenchProvider>
    </SummaryLayout>}

    {!hostWorkspaceContext&&(layout.rightPanelOpen||panelLeaving||!embeddedThreadId&&Boolean(desktop?.state.dockedBrowser))&&<div className="workspace-tools">
    {(layout.rightPanelOpen||panelLeaving) && <WorkspacePanel reviewRequest={reviewRequest} onReviewHandled={handleReviewRequest} excerptComposer={excerptComposerFor({authority:{kind:'local'},threadId:thread?.id})} refresh={refresh} snapshot={snapshot} preferredResourceId={focusedResource} threadId={thread?.id} preferences={preferences} layout={layout} leaving={panelLeaving&&!layout.rightPanelOpen} onLeave={()=>setPanelLeaving(false)} setWidth={rightPanelWidth => setLayout(value => ({ ...value, rightPanelWidth }))} resizeBounds={panelBounds} />}
    {!embeddedThreadId&&<DesktopBrowserDock/>}
    </div>}
    {thread&&!thread.sideParentId&&<SideChat key={thread.id} ref={sideChat} parent={thread} snapshot={snapshot} modelId={modelId} open={sideOpen} onClose={()=>setSideOpen(false)} refresh={refresh}/>}
    </div>}</div>{openedPlugins.map(id=>{const plugin=plugins.find(value=>value.id===id);return plugin?<PluginFrame key={id} plugin={plugin} projectColors={preferences.projectColors} theme={theme} active={selectedPluginId===id&&!selectedPluginWorkspace}/>:null;})}{openedPluginWorkspaces.map(item=>{const plugin=plugins.find(value=>value.id===item.pluginId),contribution=plugin?.workspaces?.find(value=>value.id===item.workspaceId);return plugin&&contribution?<PluginFrame key={item.pluginId+':'+item.workspaceId} plugin={plugin} projectColors={preferences.projectColors} workspace={contribution} theme={theme} active={selectedPluginWorkspace===item.pluginId+':'+item.workspaceId}/>:null;})}</div>}
    {!embeddedThreadId&&<><Toaster/><TooltipLayer/></>}
    {confirmArchive && <Dialog title="Archive thread?" close={() => setConfirmArchive(null)}><p>The saved conversation will move to Archive in Settings. Restore it there whenever you need it.</p><footer className="dialog-actions"><button className="quiet" onClick={() => setConfirmArchive(null)}>Cancel</button><button className="primary" onClick={() => { const id = confirmArchive; setConfirmArchive(null); void archive(id, false, true); }}>Archive thread</button></footer></Dialog>}
    {archiveThread && <Dialog title="Uncheckpointed widget edits" close={() => setArchiveThread(null)}><p>Checkpoint your widget edits before archiving this thread, or explicitly discard them.</p>{error&&<p role="status" className="error-text">{error}</p>}<footer className="dialog-actions"><button className="secondary" onClick={() => { select(archiveThread); setArchiveThread(null); }}>Return to checkpoint</button><button className="quiet" onClick={() => void archive(archiveThread, true)}>Discard edits and archive</button></footer></Dialog>}
    {resourcePicker && <ResourcePicker key={resourcePicker.session} threadId={resourcePicker.threadId} opener={resourcePicker.opener}
      close={() => setResourcePicker(current => current === resourcePicker ? null : current)} refresh={refresh} />}
    {projectPicker&&<ProjectPicker open authority={{kind:'local'}} projects={workspaceEnvelope?.projects??[]} selectedProjectId={snapshot.threads.find(value=>value.id===projectPicker.threadId)?.projectId}
      recentProjectIds={[...new Set([...snapshot.threads].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).flatMap(value=>value.projectId?[value.projectId]:[]))]}
      colors={preferences.projectColors} busy={projectPicking} error={projectPickerError} onClose={closeProjectSelection} onSelect={pickProject} onColorChange={saveProjectColor}
      onAddProject={()=>{projectConnectPicker.current=projectPicker;setProjectPicker(null);openProjectConnect({});}}/>}
    {projectConnectOpen&&<Dialog title="Connect project" close={closeProjectConnect}><form onSubmit={event=>{event.preventDefault();const target=projectConnectTarget.current;setProjectConnectError('');void prepareWorkspace().then(()=>{if(target?.projectId&&snapshotRef.current.threads.find(item=>item.id===target.threadId)?.projectId!==target.projectId)throw Error('The owning project changed. Close this dialog and reopen it from that conversation.');return workspaceState.send('workspace.project.connect',{name:projectName,path:projectPath,...(target?.threadId?{threadId:target.threadId}:{})}).then(async()=>{if(target?.threadId)await reconcileSplitThreadProject(target.threadId);});}).then(async()=>{await refresh();if(projectConnectTarget.current===target)closeProjectConnect();}).catch(cause=>{if(projectConnectTarget.current===target)setProjectConnectError(messageOf(cause));});}}><label className="field">Project name<input required maxLength={100} value={projectName} onChange={event=>setProjectName(event.target.value)}/></label><label className="field">Local folder<input required value={projectPath} onChange={event=>setProjectPath(event.target.value)} placeholder="C:\Projects\My project"/></label>{projectConnectError&&<p role="alert" className="error-text">{projectConnectError}</p>}<footer className="dialog-actions"><button type="button" className="quiet" onClick={closeProjectConnect}>Cancel</button><button className="primary" disabled={!projectName.trim()||!projectPath.trim()}>Connect project</button></footer></form></Dialog>}
    <UsageDialog open={usageOpen} onClose={()=>setUsageOpen(false)} reports={usageReport?[usageReport]:[]} requests={usageThreadId?(snapshot.modelRequests?.[usageThreadId]??[]):[]} onRefresh={refresh}/>
    {settingsOpen && <SettingsWindow openBrowser={desktop?.context.surface.kind==='main'?openManualBrowser:undefined} environmentSettings={<EnvironmentSettings/>} initialSection={settingsSection} snapshot={snapshot} modelError={modelError} refresh={refresh} loadModels={loadModels} close={() => setSettingsOpen(false)} addResource={() => { setSettingsOpen(false); void ensureThread(async id => { if (thread) return; const pending = await journalReadRecord<string>('draft:new'); if (pending?.value) { await journalWrite(`draft:${id}`, pending.value); await journalCompareAndSwap('draft:new', pending.generation, ''); } }).then(id=>openResourcePicker(id)).catch(error => setError(messageOf(error))); }} />}
    {rename && thread && <Dialog title="Rename thread" close={() => setRename(false)}><form onSubmit={event => { event.preventDefault(); void command('thread.rename', { title: title.trim() }, thread.id).then(async () => { await refresh(); setRename(false); }).catch(error => setError(messageOf(error))); }}><label className="field">Thread name<input autoFocus required value={title} maxLength={180} onChange={event => setTitle(event.target.value)} /></label><footer className="dialog-actions"><button type="button" className="quiet" onClick={() => setRename(false)}>Cancel</button><button className="primary" disabled={!title.trim()}>Save name</button></footer></form></Dialog>}
  </div></WorkspaceProvider>;
}
