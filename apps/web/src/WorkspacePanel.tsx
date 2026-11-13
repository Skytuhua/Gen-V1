import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import {Select} from '../../../packages/ui-shell/Select';
import type {Snapshot} from '../../../packages/contracts';
import type {UiPreferences} from '../../../packages/contracts/preferences';
import {useWorkspace,type WorkspaceTab} from './workspace-context';
import type {ShellLayout} from './shell-layout';
import {WorkspaceLauncher} from './WorkspacePanelBodies';
import type {TerminalExcerptComposer} from './TerminalBody';
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
export function WorkspacePanel({ snapshot, threadId, preferences, layout, setWidth, resizeBounds, close, preferredResourceId, standalone=false,refresh=async()=>{},excerptComposer }: { excerptComposer?:TerminalExcerptComposer; refresh?:()=>Promise<void>; standalone?:boolean; preferredResourceId?:string; snapshot: Snapshot; threadId?: string; preferences: UiPreferences; layout: ShellLayout; setWidth: (width: number) => void; resizeBounds?: ReturnType<typeof workspacePanelBounds>; close: () => void }) {
  const workspace = useWorkspace();
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const body = content.current, owner = body?.closest<HTMLElement>('.shell-workarea[data-tool-layout]');
    if (!body || !owner || standalone) return;
    const toolbar = body.querySelector<HTMLElement>('.panel-toolbar');
    const keys = ['left','top','width','height'] as const;
    let frame = 0, last = '';
    const measure = () => {
      const rect = body.getBoundingClientRect(), bounds = owner.getBoundingClientRect();
      const left = Math.max(0, rect.left, bounds.left) + 12, top = Math.max(0, rect.top, toolbar?.getBoundingClientRect().bottom ?? 0, bounds.top) + 12;
      const right = Math.min(innerWidth, rect.right, bounds.right) - 12, bottom = Math.min(innerHeight, rect.bottom, bounds.bottom) - 12;
      const values = [left, top, Math.max(0, right - left), Math.max(0, bottom - top)], key = JSON.stringify(values);
      if (key !== last) {
        last = key;
        keys.forEach((name,index) => owner.style.setProperty(`--artifact-dock-${name}`,`${values[index]}px`));
        owner.dataset.artifactDockReady = String(values[2] > 0 && values[3] > 0);
      }
      // Entrance transforms move the visual slot without notifying ResizeObserver.
      if (body.parentElement?.getAnimations().some(animation => animation.playState === 'running')) schedule();
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(); }); };
    measure(); const observer = new ResizeObserver(schedule);
    observer.observe(body); observer.observe(owner); if (toolbar) observer.observe(toolbar); if (body.parentElement) observer.observe(body.parentElement);
    const motionEvents = ['animationstart','animationend','animationcancel','transitionrun','transitionend','transitioncancel'];
    motionEvents.forEach(name => body.parentElement?.addEventListener(name,schedule));
    window.addEventListener('resize',schedule); window.addEventListener('scroll',schedule,true); document.fonts?.addEventListener('loadingdone',schedule);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); motionEvents.forEach(name => body.parentElement?.removeEventListener(name,schedule)); window.removeEventListener('resize',schedule); window.removeEventListener('scroll',schedule,true); document.fonts?.removeEventListener('loadingdone',schedule); delete owner.dataset.artifactDockReady; keys.forEach(name => owner.style.removeProperty(`--artifact-dock-${name}`)); };
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
      {workspace.activeTab === 'artifact' && <><div className="panel-toolbar"><Select aria-label="Workspace artifact" value={activeArtifact?.id ?? ''} onValueChange={workspace.requestOpenArtifact} options={[{value:'',label:'Choose an artifact'},...artifacts.map(artifact=>({value:artifact.id,label:artifact.title}))]}/></div>{!activeArtifact && <WorkspaceLauncher />}</>}
      {workspace.activeTab !== 'artifact' && <WorkspaceSurfaceBody excerptComposer={excerptComposer} kind={workspace.activeTab} binding={{authority:{kind:'local'},...(threadId?{threadId}:{}),...(preferredResourceId?{resourceId:preferredResourceId}:{})}} snapshot={snapshot} refresh={refresh} preferences={preferences}/>}
    </div>
  </aside>;
}
