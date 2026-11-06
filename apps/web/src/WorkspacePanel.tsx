import {useEffect,useRef,useState} from 'react';
import {Maximize2,Minimize2,X} from 'lucide-react';
import type {Snapshot} from '../../../packages/contracts';
import type {UiPreferences} from '../../../packages/contracts/preferences';
import {useWorkspace,type WorkspaceTab} from './workspace-context';
import type {ShellLayout} from './shell-layout';
import {WorkspaceLauncher} from './WorkspacePanelBodies';
import {WorkspaceSurfaceBody} from './WorkspaceSurfaceBody';
export {UsageSummary,snapshotDiffs} from './WorkspacePanelBodies';

export function ResizeHandle({ label, value, minimum, maximum, change, side }: { label: string; value: number; minimum: number; maximum: number; change: (width: number) => void; side: 'left' | 'right' }) {
  const cleanup = useRef<() => void>(() => {});
  useEffect(() => () => cleanup.current(), []);
  const clamp = (number: number) => Math.max(minimum, Math.min(maximum, number));
  return <div role="separator" tabIndex={0} aria-label={label} aria-orientation="vertical" aria-valuenow={Math.round(value)} aria-valuemin={minimum} aria-valuemax={maximum} className={`panel-resizer panel-resizer-${side}`} onDoubleClick={() => change(side === 'left' ? 248 : 520)} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); change(clamp(value + (event.key === 'ArrowRight' ? 20 : -20) * (side === 'left' ? 1 : -1))); } }} onPointerDown={event => {
    event.preventDefault(); cleanup.current(); const start = event.clientX;
    const move = (next: PointerEvent) => change(clamp(value + (next.clientX - start) * (side === 'left' ? 1 : -1)));
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); document.documentElement.classList.remove('resizing-panel'); };
    cleanup.current = stop; document.documentElement.classList.add('resizing-panel'); window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop, { once: true }); window.addEventListener('pointercancel', stop, { once: true });
  }} />;
}
export function WorkspacePanel({ snapshot, threadId, preferences, layout, setWidth, toggleMaximized, close, preferredResourceId, standalone=false,refresh=async()=>{} }: { refresh?:()=>Promise<void>; standalone?:boolean; preferredResourceId?:string; snapshot: Snapshot; threadId?: string; preferences: UiPreferences; layout: ShellLayout; setWidth: (width: number) => void; toggleMaximized?: () => void; close: () => void }) {
  const workspace = useWorkspace();
  const [handoffError,setHandoffError]=useState('');
  useEffect(()=>setHandoffError(''),[threadId,workspace.activeTab]);
  const artifacts = snapshot.artifacts.filter(item => item.threadId === threadId && item.lifecycle === 'active');
  const activeArtifact = artifacts.find(item => item.id === workspace.activeArtifactId);
  const tabs: [WorkspaceTab, string][] = [['artifact', 'Artifact'], ['plan', 'Plan'], ['diff', 'Diff'], ['files', 'Files'], ['terminal', 'Terminal'], ['pull-request', 'Pull request'], ['linked-pull-requests', 'Linked pull requests'], ['notes', 'Notes'], ['output', 'Output'], ['usage', 'Usage']];
  return <aside className={`workspace-right ${layout.rightPanelMaximized ? 'workspace-right-maximized' : ''}`} aria-label="Workspace panel">
    {!standalone && !layout.rightPanelMaximized && <ResizeHandle label="Resize workspace panel" value={layout.rightPanelWidth} minimum={360} maximum={960} side="right" change={setWidth} />}
    <header className="workspace-right-header"><div role="tablist" aria-label="Workspace views">{tabs.map(([id, label]) => <button role="tab" key={id} id={`workspace-tab-${id}`} aria-selected={workspace.activeTab === id} aria-controls={`workspace-view-${id}`} onClick={() => workspace.setActiveTab(id)}>{label}</button>)}</div>{!standalone && toggleMaximized && <button className="icon-button" aria-label={layout.rightPanelMaximized ? 'Restore workspace panel' : 'Maximize workspace panel'} onClick={toggleMaximized}>{layout.rightPanelMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>}<button className="icon-button" aria-label="Close workspace panel" onClick={close}><X size={15} /></button></header>
    {handoffError&&<p role="alert" className="error-text">{handoffError}</p>}
    <div className="workspace-panel-content" role="tabpanel" id={`workspace-view-${workspace.activeTab}`} aria-labelledby={`workspace-tab-${workspace.activeTab}`}>
      {workspace.activeTab === 'artifact' && <><div className="panel-toolbar"><label><span className="sr-only">Workspace artifact</span><select aria-label="Workspace artifact" value={activeArtifact?.id ?? ''} onChange={event => workspace.requestOpenArtifact(event.target.value)}><option value="">Choose an artifact</option>{artifacts.map(artifact => <option value={artifact.id} key={artifact.id}>{artifact.title}</option>)}</select></label></div>{!activeArtifact && <WorkspaceLauncher />}</>}
      {workspace.activeTab !== 'artifact' && <WorkspaceSurfaceBody kind={workspace.activeTab} binding={{authority:{kind:'local'},...(threadId?{threadId}:{}),...(preferredResourceId?{resourceId:preferredResourceId}:{})}} snapshot={snapshot} refresh={refresh} preferences={preferences}/>}
    </div>
  </aside>;
}
