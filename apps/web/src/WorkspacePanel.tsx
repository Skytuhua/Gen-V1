import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import type {Snapshot} from '../../../packages/contracts';
import type {UiPreferences} from '../../../packages/contracts/preferences';
import {useWorkspace,type WorkspaceTab} from './workspace-context';
import type {ShellLayout} from './shell-layout';
import {WorkspaceLauncher} from './WorkspacePanelBodies';
import {WorkspaceSurfaceBody} from './WorkspaceSurfaceBody';
import type {workspacePanelBounds} from './panel-geometry';
export {UsageSummary,snapshotDiffs} from './WorkspacePanelBodies';

export function ResizeHandle({ label, value, minimum, maximum, change, side }: { label: string; value: number; minimum: number; maximum: number; change: (width: number) => void; side: 'left' | 'right' }) {
  const cleanup = useRef<() => void>(() => {});
  useEffect(() => () => cleanup.current(), []);
  const clamp = (number: number) => Math.max(minimum, Math.min(maximum, number));
  return <div role="separator" tabIndex={0} aria-label={label} aria-orientation="vertical" aria-valuenow={Math.round(value)} aria-valuemin={minimum} aria-valuemax={maximum} className={`panel-resizer panel-resizer-${side}`} onDoubleClick={() => change(clamp(side === 'left' ? 248 : 520))} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); change(clamp(value + (event.key === 'ArrowRight' ? 20 : -20) * (side === 'left' ? 1 : -1))); } }} onPointerDown={event => {
    event.preventDefault(); cleanup.current(); const start = event.clientX;
    const move = (next: PointerEvent) => change(clamp(value + (next.clientX - start) * (side === 'left' ? 1 : -1)));
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); document.documentElement.classList.remove('resizing-panel'); };
    cleanup.current = stop; document.documentElement.classList.add('resizing-panel'); window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop, { once: true }); window.addEventListener('pointercancel', stop, { once: true });
  }} />;
}
export function WorkspacePanel({ snapshot, threadId, preferences, layout, setWidth, resizeBounds, close, preferredResourceId, standalone=false,refresh=async()=>{} }: { refresh?:()=>Promise<void>; standalone?:boolean; preferredResourceId?:string; snapshot: Snapshot; threadId?: string; preferences: UiPreferences; layout: ShellLayout; setWidth: (width: number) => void; resizeBounds?: ReturnType<typeof workspacePanelBounds>; close: () => void }) {
  const workspace = useWorkspace();
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const body = content.current, owner = body?.closest<HTMLElement>('.shell-workarea[data-tool-layout]');
    if (!body || !owner || standalone) return;
    const keys = ['left','top','width','height'] as const;
    const measure = () => {
      const rect = body.getBoundingClientRect();
      const values = [rect.left + 12, rect.top + 12, Math.max(0, rect.width - 24), Math.max(0, rect.height - 24)];
      keys.forEach((key,index) => owner.style.setProperty(`--artifact-dock-${key}`,`${values[index]}px`));
      owner.dataset.artifactDockReady = String(rect.width > 0 && rect.height > 0);
    };
    measure(); const observer = new ResizeObserver(measure);
    observer.observe(body); observer.observe(owner); if (body.parentElement) observer.observe(body.parentElement);
    window.addEventListener('resize',measure); document.fonts?.addEventListener('loadingdone',measure);
    return () => { observer.disconnect(); window.removeEventListener('resize',measure); document.fonts?.removeEventListener('loadingdone',measure); delete owner.dataset.artifactDockReady; keys.forEach(key => owner.style.removeProperty(`--artifact-dock-${key}`)); };
  },[standalone,workspace.activeTab,workspace.activeArtifactId]);
  const [handoffError,setHandoffError]=useState('');
  useEffect(()=>setHandoffError(''),[threadId,workspace.activeTab]);
  const artifacts = snapshot.artifacts.filter(item => item.threadId === threadId && item.lifecycle === 'active');
  const activeArtifact = artifacts.find(item => item.id === workspace.activeArtifactId);
  const tabs: [WorkspaceTab, string][] = [['artifact', 'Artifact'], ['plan', 'Plan'], ['diff', 'Diff'], ['files', 'Files'], ['terminal', 'Terminal'], ['pull-request', 'Pull request'], ['linked-pull-requests', 'Linked pull requests'], ['notes', 'Notes'], ['output', 'Output'], ['usage', 'Usage']];
  return <aside className="workspace-right" aria-label="Workspace panel">
    {!standalone && !resizeBounds?.stacked && <ResizeHandle label="Resize workspace panel" value={resizeBounds?.width ?? layout.rightPanelWidth} minimum={resizeBounds?.minimum ?? 280} maximum={resizeBounds?.maximum ?? 720} side="right" change={setWidth} />}
    <header className="workspace-right-header"><div role="tablist" aria-label="Workspace views">{tabs.map(([id, label]) => <button role="tab" key={id} id={`workspace-tab-${id}`} aria-selected={workspace.activeTab === id} aria-controls={`workspace-view-${id}`} onClick={() => workspace.setActiveTab(id)}>{label}</button>)}</div><button className="icon-button" aria-label="Close workspace panel" onClick={close}><X size={15} /></button></header>
    {handoffError&&<p role="alert" className="error-text">{handoffError}</p>}
    <div ref={content} className="workspace-panel-content" role="tabpanel" id={`workspace-view-${workspace.activeTab}`} aria-labelledby={`workspace-tab-${workspace.activeTab}`}>
      {workspace.activeTab === 'artifact' && <><div className="panel-toolbar"><label><span className="sr-only">Workspace artifact</span><select aria-label="Workspace artifact" value={activeArtifact?.id ?? ''} onChange={event => workspace.requestOpenArtifact(event.target.value)}><option value="">Choose an artifact</option>{artifacts.map(artifact => <option value={artifact.id} key={artifact.id}>{artifact.title}</option>)}</select></label></div>{!activeArtifact && <WorkspaceLauncher />}</>}
      {workspace.activeTab !== 'artifact' && <WorkspaceSurfaceBody kind={workspace.activeTab} binding={{authority:{kind:'local'},...(threadId?{threadId}:{}),...(preferredResourceId?{resourceId:preferredResourceId}:{})}} snapshot={snapshot} refresh={refresh} preferences={preferences}/>}
    </div>
  </aside>;
}
