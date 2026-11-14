import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {DesktopContext,DesktopSurface} from '../../../packages/desktop-contract';
import {parseDesktopSurface} from '../../../packages/desktop-contract';
import type {Snapshot} from '../../../packages/contracts';
import {getPreferences} from '../../../packages/contracts/preferences';

import {App,OperationDecision} from './App';
import {Artifact} from './Artifact';
import {bootstrap,getSnapshot,subscribe} from './api';
import {DelegatedAgentTranscript} from './DelegatedAgentTranscript';
import {ProjectContextSurface} from './ProjectContextSurface';
import {WorkspaceSurfaceBody} from './WorkspaceSurfaceBody';
import {useWorkspaceState} from './workspace-api';

import type {WorkspaceTab} from './workspace-context';
import {UsageSummary,WorkspacePanel} from './WorkspacePanel';
import {WorkspaceProvider} from './workspace-context';
import {readShellLayout} from './shell-layout';
import {DesktopProvider,DesktopWindowActions,useDesktop,useDesktopReady} from './desktop-context';
import {DesktopBrowserSurface} from './DesktopBrowser';
import './desktop.css';
import {PluginFrame,usePluginCatalog} from './PluginFrame';
import {Toaster} from '../../../packages/ui-shell/Toast';
import {TooltipLayer} from '../../../packages/ui-shell/Tooltip';

export function PluginDesktopView(){
 const desktop=useDesktop()!,surface=desktop.context.surface,catalog=usePluginCatalog(),[error,setError]=useState('');
 const plugin=surface.kind==='plugin'?catalog.plugins.find(item=>item.id===surface.pluginId):undefined;
 const ready=useCallback(()=>{void desktop.bridge.ready().catch(()=>setError('The plug-in window authority could not be confirmed. Return to the main workspace.'));},[desktop.bridge]);
 const theme=catalog.theme==='light'||catalog.theme==='dark'?catalog.theme:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
 useLayoutEffect(()=>{document.documentElement.dataset.theme=theme;},[theme]);
 return <main className="desktop-surface" inert={desktop.closing}><header className="desktop-surface-header"><strong>{plugin?.name??'Plug-in view'}</strong><DesktopWindowActions/></header>{error&&<p role="status">{error}</p>}{plugin&&surface.kind==='plugin'?<PluginFrame plugin={plugin} theme={theme} surface={surface} onReady={ready}/>:catalog.failed||catalog.loaded?<div><p role="alert">{catalog.failed?'Plug-ins could not be loaded.':catalog.error||'The owning plug-in is unavailable.'}</p><button type="button" className="quiet" onClick={catalog.retry}>Retry loading plug-ins</button></div>:<p role="status">Opening the owning plug-in…</p>}</main>;
}

function Surface(){const desktop=useDesktop()!,surface=desktop.context.surface;const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[error,setError]=useState(''),[systemDark,setSystemDark]=useState(()=>matchMedia('(prefers-color-scheme: dark)').matches),[layout,setLayout]=useState(()=>({...readShellLayout(),rightPanelOpen:true,rightPanelMaximized:false,activeTab:surface.kind==='workspace'&&surface.tab&&['files','diff','output','usage','artifact','terminal','pull-request','linked-pull-requests'].includes(surface.tab)?surface.tab as WorkspaceTab:'artifact' as WorkspaceTab,activeArtifactId:surface.kind==='workspace'?surface.artifactId??null:null}));const current=useRef(snapshot);current.current=snapshot;const workspace=useWorkspaceState(Boolean(snapshot)&&surface.kind==='workspace'&&Boolean(surface.panelId));
 const refresh=useCallback(async(value?:Snapshot)=>{const next=value??await getSnapshot();if(!current.current||next.seq>=current.current.seq){current.current=next;setSnapshot(next);}},[]);
 useEffect(()=>{let active=true;void bootstrap().then(()=>refresh()).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'The workspace could not open.');});return()=>{active=false;};},[refresh]);
 useEffect(()=>{if(!snapshot)return;return subscribe(snapshot.seq,()=>{void refresh().catch(cause=>setError(cause.message));},()=>{},()=>refresh());},[Boolean(snapshot),refresh]);
 useEffect(()=>{const query=matchMedia('(prefers-color-scheme: dark)');const changed=()=>setSystemDark(query.matches);query.addEventListener('change',changed);return()=>query.removeEventListener('change',changed);},[]);
 const theme=snapshot?.settings.theme==='system'?(systemDark?'dark':'light'):snapshot?.settings.theme??'light';useLayoutEffect(()=>{document.documentElement.dataset.theme=theme;},[theme]);
 useDesktopReady(Boolean(snapshot));
 if(!snapshot)return <main className="desktop-surface"><p role={error?'alert':'status'}>{error||'Opening workspace…'}</p></main>;
 if(surface.kind==='browser')return <DesktopBrowserSurface/>;
 const threadId='threadId'in surface?surface.threadId:undefined,thread=threadId?snapshot.threads.find(item=>item.id===threadId):undefined;
 let content;
 if(threadId&&!thread)content=<p role="status">The owning conversation is no longer available. Dock this window to choose another task.</p>;
 else if(surface.kind==='plan')content=<ProjectContextSurface thread={thread} snapshot={snapshot} defaultPlanOpen/>;
 else if(surface.kind==='usage')content=<UsageSummary usage={threadId?snapshot.usage[threadId]:undefined}/>;
 else if(surface.kind==='artifact'){const artifact=snapshot.artifacts.find(item=>item.id===surface.artifactId&&item.threadId===threadId);content=artifact?<Artifact artifact={artifact} snapshot={snapshot} refresh={refresh} theme={theme}/>:<p role="status">The artifact is no longer available in this conversation.</p>;}
 else if(surface.kind==='agent')content=<DelegatedAgentTranscript key={surface.threadId+':'+surface.agentId} threadId={surface.threadId} agentId={surface.agentId} snapshot={snapshot}/>;
 else if(surface.kind==='workspace'&&(surface.panelId||surface.tab&&['context','notes','terminal','pull-request','linked-pull-requests'].includes(surface.tab))){const panel=workspace.envelope?.state.canvases.flatMap(canvas=>canvas.panels).find(value=>value.id===surface.panelId);content=surface.panelId&&!workspace.envelope?<p role={workspace.error?'alert':'status'}>{workspace.error||'Opening the owning panel...'}</p>:surface.panelId&&!panel?<p role="status">The owning panel is unavailable. Dock this window to return to the workspace.</p>:panel?.binding.authority.kind==='plugin'?<p role="status">This panel belongs to its plug-in workspace.</p>:panel?.kind==='context'||panel?.kind==='plan'||surface.tab==='context'?<ProjectContextSurface thread={thread} snapshot={snapshot} defaultPlanOpen/>:<WorkspaceSurfaceBody panelId={panel?.id??surface.panelId} kind={panel?.kind??(surface.tab==='notes'?'notes':surface.tab==='terminal'?'terminal':surface.tab==='linked-pull-requests'?'linked-pull-requests':'pull-request')} binding={panel?{...panel.binding,...(threadId?{threadId}:{})}:{authority:{kind:'local'},...(threadId?{threadId}:{})}} snapshot={snapshot} refresh={()=>refresh()}/>;}
 else if(surface.kind==='workspace')content=<><WorkspacePanel standalone refresh={refresh} snapshot={snapshot} threadId={threadId} preferences={getPreferences(snapshot.settings)} layout={layout} setWidth={width=>setLayout(value=>({...value,rightPanelWidth:width}))} close={()=>{setError('');void desktop.bridge.reattach().catch(cause=>{desktop.resumeEditing();setError(cause instanceof Error?cause.message:'The workspace could not dock. Try again.');});}}/>{surface.tab==='artifact'&&surface.artifactId===layout.activeArtifactId&&layout.activeTab==='artifact'&&layout.activeArtifactId&&snapshot.artifacts.filter(item=>item.id===layout.activeArtifactId&&item.threadId===threadId).map(artifact=><Artifact key={artifact.id} artifact={artifact} snapshot={snapshot} refresh={refresh} theme={theme}/>)}</>;
 const workspaceContext={activeArtifactId:layout.activeArtifactId,requestOpenArtifact:(id:string)=>{if(surface.kind==='workspace'&&surface.tab==='artifact'&&surface.artifactId===id){setLayout(value=>({...value,activeArtifactId:id,activeTab:'artifact'}));return;}if(id&&threadId)setError('Open this artifact from the main workspace. Your current editor is kept open.');},closeArtifact:()=>setLayout(value=>({...value,activeArtifactId:null})),rightPanelOpen:true,activeTab:layout.activeTab,setActiveTab:(tab:typeof layout.activeTab)=>setLayout(value=>({...value,activeTab:tab}))};
 return <WorkspaceProvider value={workspaceContext}><main inert={desktop.closing} className={`desktop-surface desktop-surface-${surface.kind}`}><header className="desktop-surface-header"><strong>{thread?.title??'Workspace'}</strong><DesktopWindowActions/></header>{desktop.state.backendError&&<p role="status" className="error-text">{desktop.state.backendError}</p>}{error&&<p role="status" className="error-text">{error}</p>}<div className="desktop-surface-body">{content}{['artifact','workspace'].includes(surface.kind)&&snapshot.operations.filter(operation=>operation.threadId===threadId&&(operation.status==='prepared'&&!operation.approved||operation.status==='unknown')).map(operation=><OperationDecision key={`${operation.id}:${operation.revision}`} operation={operation} refresh={()=>refresh()}/>)}</div></main></WorkspaceProvider>;
}
export function DesktopEntry(){const bridge=window.harnessDesktop,[context,setContext]=useState<DesktopContext|null>(null),[error,setError]=useState('');useEffect(()=>{if(!bridge)return;let alive=true;void bridge.getContext().then(value=>{const surface=parseDesktopSurface(value.surface);if(alive)setContext({...value,surface});}).catch(cause=>{if(alive)setError(cause instanceof Error?cause.message:'The desktop window could not open.');});return()=>{alive=false;};},[bridge]);if(!bridge)return <App/>;if(!context)return <main className="desktop-surface"><p role={error?'alert':'status'}>{error||'Opening desktop window…'}</p></main>;const surface:DesktopSurface=context.surface;return <DesktopProvider bridge={bridge} context={context}>{surface.kind==='plugin'?<><PluginDesktopView/><Toaster/><TooltipLayer/></>:['main','thread','navigation'].includes(surface.kind)?<App/>:<><Surface/><Toaster/><TooltipLayer/></>}</DesktopProvider>;}
