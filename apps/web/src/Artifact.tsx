import {SecureArtifactProvider} from './secure-artifact-context';
import {ArtifactInline} from './task-context';
import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { StateProvider } from '@json-render/react';
import {ArtifactPresentation} from './ArtifactPresentation';
import { Archive, Check, CircleDot, LoaderCircle, TriangleAlert, Code2, Maximize2, Minimize2, Pin, RotateCcw, X, PanelRightOpen } from 'lucide-react';
import { validateSchema } from './schema-validator';
import type { ArtifactRecord, Snapshot, UserStateRecord } from '../../../packages/contracts';
import { command } from './api';
import { useArtifactState } from './artifact-state';
import { createArtifactInputResolver } from './artifact-inputs';
import { ArtifactActions, ArtifactTitle } from './registry';
import { Widget, type WidgetHandle } from './Widget';
import { useModalRegion } from './focus';
import { useWorkspace } from './workspace-context';
import { DocumentAssetProvider, hasPendingDocumentAssets } from './signature-assets';
import { DocumentEvidenceProvider, type DocumentHandoffState } from './document-evidence';
import { useArtifactEntrance } from './task-motion';
import { PendingStatus } from './LoadingState';
import {useDesktop,useDesktopCloseGuard,useDetachedSurface,usePendingSurface} from './desktop-context';
import {journalFlush} from './journal';

class ArtifactBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { /* Failure is isolated to this artifact. */ }
  componentDidUpdate(previous: { resetKey: string }) { if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: '' }); }
  render() { return this.state.error ? <div className="notice" role="alert">This artifact could not be displayed. Your conversation and saved state are retained.<details><summary>Error details</summary>{this.state.error}</details><button className="secondary" onClick={() => this.setState({ error: '' })}><RotateCcw size={14} />Retry rendering</button></div> : this.props.children; }
}
export function Artifact({ artifact: incoming, snapshot, theme, refresh, onDirtyWidget, animateEntry = false,active=true,suspended=false,embedded=false }: { artifact: ArtifactRecord; snapshot: Snapshot; theme: 'light' | 'dark'; refresh: (snapshot?: Snapshot) => Promise<void>; onDirtyWidget?: (id: string, threadId: string, dirty: boolean) => void; animateEntry?: boolean;active?:boolean;suspended?:boolean;embedded?:boolean }) {
  const workspace = useWorkspace();
  const desktop=useDesktop(),surface={kind:'artifact' as const,threadId:incoming.threadId,artifactId:incoming.id};
  const detached=useDetachedSurface(surface),pendingDesktop=usePendingSurface(surface),editorHeld=Boolean(detached||pendingDesktop||suspended||desktop?.closing);
  const inWorkspace = !embedded && workspace.rightPanelOpen && workspace.activeTab === 'artifact' && workspace.activeArtifactId === incoming.id;
  const heldArtifact = useRef(incoming);
  const stateDirty = useRef<{ current: boolean } | null>(null);
  const [widgetDirty, setWidgetDirty] = useState(false);
  const holding = widgetDirty || stateDirty.current?.current;
  if (!holding) heldArtifact.current = incoming;
  const artifact = holding ? heldArtifact.current : incoming;
  const [handoffs, setHandoffs] = useState<Record<string, DocumentHandoffState>>({});
  const handoffChanged = useCallback((id: string, phase: DocumentHandoffState) => setHandoffs(previous => previous[id] === phase ? previous : { ...previous, [id]: phase }), []);
  const documentEvidence = useMemo(() => ({ threadId: artifact.threadId, operations: snapshot.operations.filter(op => op.threadId === artifact.threadId), resources: snapshot.resources.filter(resource => resource.threadId === artifact.threadId), onHandoffState: handoffChanged }), [artifact.threadId, snapshot.operations, snapshot.resources, handoffChanged]);
  const exportIds = Object.values(artifact.spec?.elements ?? {}).filter(node => node.type === 'DocumentPreview' && typeof node.props.exportOperationId === 'string').map(node => node.props.exportOperationId as string);
  const documentHandoff = exportIds.length ? exportIds.some(id => !handoffs[id] || handoffs[id] === 'pending') ? 'pending' : exportIds.some(id => handoffs[id] === 'error') ? 'error' : 'ready' : undefined;
  const blockedRevision = holding && incoming.revision !== artifact.revision ? incoming.revision : null;
  const [noticeRevision, setNoticeRevision] = useState<number | null>(null);
  useEffect(() => {
    setNoticeRevision(null);
    if (blockedRevision === null) return;
    const timer = setTimeout(() => setNoticeRevision(blockedRevision), 750);
    return () => clearTimeout(timer);
  }, [blockedRevision]);
  const record = snapshot.userStates.find(item => item.id === artifact.stateId);
  const [resolveInputs] = useState(createArtifactInputResolver);
  const inputs = resolveInputs(artifact, snapshot);
  const state = useArtifactState(artifact, record, inputs, value => { void refresh(value); },!editorHeld);
  stateDirty.current = state.dirty;
  const [error, setError] = useState('');
  const [sourceOpen, setSourceOpen] = useState(false);
  const [archiveGuard, setArchiveGuard] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const widget = useRef<WidgetHandle>(null);
  const section = useRef<HTMLElement>(null);
  const entranceBody = useRef<HTMLDivElement>(null);
  const ready = artifact.kind === 'widget' || state.loaded;
  useArtifactEntrance(section, animateEntry && ready, entranceBody);
  const expandButton = useRef<HTMLElement | null>(null);
  const pendingApproval = useRef<string | null>(null);
  const [widgetRecord, setWidgetRecord] = useState<UserStateRecord | undefined>(record);
  const standaloneEditor=embedded||desktop?.context.surface.kind==='artifact'||desktop?.context.surface.kind==='workspace'&&desktop.context.surface.tab==='artifact';
  const expanded = incoming.placement === 'expanded'&&!editorHeld&&!standaloneEditor;
  const inline = !expanded && !inWorkspace && !standaloneEditor;
  const act = async (type: string, payload: Record<string, unknown>) => {
    if (type === 'artifact.expand' && payload.expanded) expandButton.current = section.current?.querySelector<HTMLElement>('[aria-label="Expand artifact"]') ?? null;
    if (type === 'artifact.archive' && widgetDirty) { setArchiveGuard(true); return; }
    try { setError(''); await command(type, { artifactId: artifact.id, ...payload }, artifact.threadId); await refresh(); } catch (error) { setError(error instanceof Error ? error.message : 'Action failed'); }
  };
  useModalRegion(section, expanded, () => { void act('artifact.expand', { expanded: false }); }, '[aria-label="Collapse artifact"]');
  useLayoutEffect(() => {
    if (expanded) return;
    const operationId = pendingApproval.current;
    const decision = operationId ? document.querySelector<HTMLElement>(`[data-operation-id="${CSS.escape(operationId)}"]`) : null;
    if (decision) {
      pendingApproval.current = null; expandButton.current = null;
      queueMicrotask(() => { if (decision.isConnected) { decision.scrollIntoView({ block: 'center', behavior: 'smooth' }); decision.querySelector<HTMLButtonElement>('button.primary')?.focus(); } });
    } else if (expandButton.current) {
      const button = expandButton.current; expandButton.current = null;
      queueMicrotask(() => { if (button.isConnected) button.focus(); });
    }
  }, [expanded, snapshot.seq]);
  const submit = async (actionId: string, payload: unknown = {}, clientId: string = state.clientId) => {
    if (hasPendingDocumentAssets(artifact.threadId, artifact.stateId)) throw new Error('Wait for the signature mark to finish saving before submitting.');
    const definition = artifact.actions[actionId];
    if (!definition) throw new Error('This action is no longer available.');
    if (definition.schema && !validateSchema(definition.schema, payload)) throw new Error('The action values do not match its schema.');
    if (artifact.kind === 'widget' && widgetDirty) throw new Error('Checkpoint your widget edits before submitting this action.');
    const send = (baseStateRevision: number, submittedState: unknown) => command('action.submit', { artifactId: artifact.id, revision: artifact.revision, actionId, payload, clientId, baseStateRevision, submittedState, dataRevisions: Object.fromEntries(Object.values(artifact.bindings).map(binding => [binding.mode === 'snapshot' ? binding.ref.id : binding.id, binding.mode === 'snapshot' ? binding.ref.revision : snapshot.data.filter(row => row.id === binding.id).reduce((value, row) => Math.max(value, row.revision), 0)])) }, artifact.threadId);
    const receipt = artifact.kind === 'structured' ? await state.submit(send) as Awaited<ReturnType<typeof send>> : await send(effectiveRecord?.revision ?? 0, effectiveRecord?.values ?? {});
    const result = receipt.result as { approvalRequired?: boolean; operation?: { id: string } } | null;
    if (result?.approvalRequired && result.operation?.id) pendingApproval.current = result.operation.id;
    if (result?.approvalRequired && expanded) await command('artifact.expand', { artifactId: artifact.id, expanded: false }, artifact.threadId);
    await refresh();
  };
  const dirtyChanged = (value: boolean) => { setWidgetDirty(value); onDirtyWidget?.(artifact.id, artifact.threadId, value); };
  const discardAndArchive = async () => {
    if (archiving) return;
    setArchiving(true); setError('');
    try {
      if (!widget.current) throw new Error('Keep this artifact open until its edit lease can be released.');
      await widget.current.releaseLease();
      await command('artifact.archive', { artifactId: artifact.id }, artifact.threadId);
      dirtyChanged(false); setArchiveGuard(false); await refresh();
    } catch (error) { setError(error instanceof Error ? error.message : 'Archive failed'); } finally { setArchiving(false); }
  };
  const effectiveRecord = widgetRecord && widgetRecord.revision > (record?.revision ?? -1) ? widgetRecord : record;
  const prepareDetach=async()=>{
    if(hasPendingDocumentAssets(artifact.threadId,artifact.stateId))throw new Error('Wait for the signature mark to finish saving before moving this artifact.');
    if(artifact.kind==='widget'){if(widgetDirty)throw new Error('Checkpoint widget edits before moving this artifact.');await widget.current?.releaseLease();}else await state.release();
    await journalFlush();
  };
  useDesktopCloseGuard(`artifact:${artifact.id}`,async()=>{if(detached)return;try{await prepareDetach();}catch(cause){setError(cause instanceof Error?cause.message:'Save the artifact before closing.');throw cause;}});
  // One inert content tree reserves the layout; restoration status shares its cell.
  const saveState = state.status === 'Saved' ? 'saved' : state.status.startsWith('Saving') ? 'saving' : state.status === 'Unsaved changes' || state.status.startsWith('Recovered draft') ? 'pending' : 'attention';
  return <ArtifactInline value={inline}><section ref={section} className={`artifact artifact-width-${artifact.presentation?.width ?? 'standard'} artifact-frame-${artifact.presentation?.frame ?? 'card'} ${expanded ? 'artifact-expanded' : ''} ${inWorkspace ? 'artifact-in-workspace' : ''} ${incoming.lifecycle === 'archived' ? 'artifact-archived' : ''}`} aria-label={artifact.title} role={expanded ? 'dialog' : undefined} aria-modal={expanded || undefined} data-artifact-id={artifact.id} data-artifact-inline={inline} data-artifact-pending={!ready || undefined} data-document-handoff={documentHandoff}>
    <header className="artifact-header"><span className="artifact-title"><strong>{artifact.title}</strong></span><div className="artifact-tools">
      
      {artifact.kind === 'structured' ? <button disabled={editorHeld || !ready} className={`save-state ${state.status === 'Saved' ? 'is-saved' : ''}`} data-save-state={saveState} title={state.status === 'Saved' ? 'Saved state · save now' : state.status} onClick={() => void state.flush().catch(error => setError(error.message))}>{saveState === 'saved' ? <Check size={12} aria-hidden="true"/> : saveState === 'saving' ? <LoaderCircle size={12} aria-hidden="true"/> : saveState === 'pending' ? <CircleDot size={12} aria-hidden="true"/> : <TriangleAlert size={12} aria-hidden="true"/>}<span>{state.status}</span></button> : <span className={`artifact-state ${widgetDirty ? 'is-dirty' : ''}`}>{widgetDirty ? 'Uncheckpointed edits' : 'Checkpointed state'}</span>}
      <div className="artifact-secondary-tools" inert={editorHeld || !ready}><button className="icon-button" aria-label="View artifact source" aria-expanded={sourceOpen} title="View source" onClick={() => setSourceOpen(value => !value)}><Code2 size={14} /></button><button className={`icon-button ${incoming.pinned ? 'selected' : ''}`} aria-label={incoming.pinned ? 'Unpin artifact' : 'Pin artifact'} aria-pressed={incoming.pinned} title={incoming.pinned ? 'Unpin artifact' : 'Pin artifact'} onClick={() => void act('artifact.pin', { pinned: !incoming.pinned })}><Pin size={13} /></button><button className="icon-button" aria-label="Archive artifact" title="Archive artifact" onClick={() => void act('artifact.archive', {})}><Archive size={13} /></button></div>
      {!embedded&&<><button disabled={editorHeld || !ready && !expanded} className="icon-button" aria-label={expanded ? 'Collapse artifact' : 'Expand artifact'} title={expanded ? 'Collapse artifact' : 'Expand artifact'} onClick={() => void act('artifact.expand', { expanded: !expanded })}>{expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
      <button disabled={editorHeld || !ready} className="icon-button" aria-label={inWorkspace ? 'Return artifact to conversation' : 'Open artifact in workspace'} title={inWorkspace ? 'Return to conversation' : 'Open in workspace'} onClick={() => inWorkspace ? workspace.closeArtifact() : workspace.requestOpenArtifact(artifact.id)}>{inWorkspace ? <X size={14} /> : <PanelRightOpen size={14} />}</button></>}
    </div></header>
    {error && <div role="alert" className="notice">{error}<button className="icon-button" aria-label="Dismiss artifact error" onClick={() => setError('')}><X size={14} /></button></div>}
    {archiveGuard && <div className="notice" role="alert"><div>Checkpoint your widget edits before archiving, or explicitly discard them.<div className="decision-actions"><button className="secondary" onClick={() => { setArchiveGuard(false); section.current?.querySelector<HTMLElement>('.widget-container button, .widget-container iframe')?.focus(); }}>Return to checkpoint</button><button className="quiet" disabled={archiving} onClick={() => void discardAndArchive()}>Discard edits and archive</button></div></div></div>}
    {blockedRevision !== null && noticeRevision === blockedRevision && <p className="notice">An updated interface is ready. Save your edits to load it; this version remains open.</p>}
    {detached&&<p className="notice">Editing in a detached window.</p>}<div ref={entranceBody} className="artifact-body" inert={editorHeld} aria-busy={!ready || undefined}><div className="artifact-content" inert={!ready} aria-hidden={!ready || undefined}><ArtifactTitle value={artifact.title}><ArtifactBoundary resetKey={`${artifact.id}:${artifact.revision}`}><ArtifactActions value={submit}>{artifact.kind === 'widget' ? <Widget ref={widget} onEscape={() => { if (expanded) void act('artifact.expand', { expanded: false }); }} artifact={artifact} inputs={inputs} values={effectiveRecord?.values ?? {}} stateRevision={effectiveRecord?.revision ?? 0} theme={theme} onAction={submit} onDirty={dirtyChanged} onAccepted={(values, revision) => { setWidgetRecord({ id: artifact.stateId, threadId: artifact.threadId, revision, schemaVersion: artifact.widget?.stateSchemaVersion ?? 1, values }); void refresh(); }} /> : <StateProvider store={state.store}><DocumentAssetProvider threadId={artifact.threadId} stateId={artifact.stateId} active={ready}><DocumentEvidenceProvider value={documentEvidence}><SecureArtifactProvider value={{artifactId:artifact.id,threadId:artifact.threadId,revision:artifact.revision,active:active&&ready,editable:!editorHeld&&ready,saveStatus:state.status}}><ArtifactPresentation spec={artifact.spec}/></SecureArtifactProvider></DocumentEvidenceProvider></DocumentAssetProvider></StateProvider>}</ArtifactActions></ArtifactBoundary></ArtifactTitle></div>{!ready && <div className="artifact-restoring"><PendingStatus pending label={`Restoring ${artifact.title}…`} /></div>}</div>
    {sourceOpen && <div className="artifact-source"><div>Immutable source · revision {artifact.revision}<button className="icon-button" aria-label="Close source" onClick={() => setSourceOpen(false)}><X size={14} /></button></div>{artifact.purpose && <p>{artifact.purpose}</p>}<pre>{artifact.widget?.html ?? JSON.stringify(artifact.spec, null, 2)}</pre></div>}
  </section></ArtifactInline>;
}
