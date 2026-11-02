import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {DesktopContext,DesktopSurface} from '../../../packages/desktop-contract';
import {parseDesktopSurface} from '../../../packages/desktop-contract';
import type {Snapshot} from '../../../packages/contracts';
import {getPreferences} from '../../../packages/contracts/preferences';
import {PlanRecordSchema,planDataId,PLANNING_PROVENANCE} from '../../../packages/contracts/planning';
import {App,OperationDecision} from './App';
import {Artifact} from './Artifact';
import {bootstrap,getSnapshot,subscribe} from './api';
import {PlanStatus} from './PlanStatus';
import {UsageSummary,WorkspacePanel} from './WorkspacePanel';
import {WorkspaceProvider} from './workspace-context';
import {readShellLayout} from './shell-layout';
import {DesktopProvider,DesktopWindowActions,useDesktop,useDesktopReady} from './desktop-context';
import {DesktopBrowserSurface} from './DesktopBrowser';
import './desktop.css';

function Surface(){const desktop=useDesktop()!,surface=desktop.context.surface;const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[error,setError]=useState(''),[systemDark,setSystemDark]=useState(()=>matchMedia('(prefers-color-scheme: dark)').matches),[layout,setLayout]=useState(()=>({...readShellLayout(),rightPanelOpen:true,rightPanelMaximized:false,activeTab:surface.kind==='workspace'&&surface.tab&&surface.tab!=='launcher'?surface.tab:'artifact' as const,activeArtifactId:surface.kind==='workspace'?surface.artifactId??null:null}));const current=useRef(snapshot);current.current=snapshot;
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
 if(threadId&&!thread)content=<p role="alert">The owning conversation is no longer available. Dock this window to choose another task.</p>;
 else if(surface.kind==='plan')content=<PlanStatus snapshot={snapshot} threadId={threadId}/>;
 else if(surface.kind==='usage')content=<UsageSummary usage={threadId?snapshot.usage[threadId]:undefined}/>;
 else if(surface.kind==='artifact'){const artifact=snapshot.artifacts.find(item=>item.id===surface.artifactId&&item.threadId===threadId);content=artifact?<Artifact artifact={artifact} snapshot={snapshot} refresh={refresh} theme={theme}/>:<p role="alert">The artifact is no longer available in this conversation.</p>;}
 else if(surface.kind==='agent'){const record=snapshot.data.find(item=>item.id===planDataId(surface.threadId)&&item.threadId===surface.threadId&&item.provenance===PLANNING_PROVENANCE),parsed=PlanRecordSchema.safeParse(record?.value),agent=parsed.success?parsed.data.agents.find(item=>item.id===surface.agentId):undefined;content=agent&&parsed.success&&record?<PlanStatus threadId={threadId} snapshot={{...snapshot,data:snapshot.data.map(item=>item===record?{...record,value:{...parsed.data,title:agent.name,steps:[],agents:[agent]}}:item)}}/>:<p role="alert">This subagent record is no longer available.</p>;}
 else if(surface.kind==='workspace')content=<><WorkspacePanel standalone snapshot={snapshot} threadId={threadId} preferences={getPreferences(snapshot.settings)} layout={layout} setWidth={width=>setLayout(value=>({...value,rightPanelWidth:width}))} close={()=>{setError('');void desktop.bridge.reattach().catch(cause=>{desktop.resumeEditing();setError(cause instanceof Error?cause.message:'The workspace could not dock. Try again.');});}}/>{surface.tab==='artifact'&&surface.artifactId===layout.activeArtifactId&&layout.activeTab==='artifact'&&layout.activeArtifactId&&snapshot.artifacts.filter(item=>item.id===layout.activeArtifactId&&item.threadId===threadId).map(artifact=><Artifact key={artifact.id} artifact={artifact} snapshot={snapshot} refresh={refresh} theme={theme}/>)}</>;
 const workspace={activeArtifactId:layout.activeArtifactId,requestOpenArtifact:(id:string)=>{if(surface.kind==='workspace'&&surface.tab==='artifact'&&surface.artifactId===id){setLayout(value=>({...value,activeArtifactId:id,activeTab:'artifact'}));return;}if(id&&threadId)void desktop.detachSurface({kind:'artifact',threadId,artifactId:id}).catch(cause=>setError(cause instanceof Error?cause.message:'The artifact could not open.'));},closeArtifact:()=>setLayout(value=>({...value,activeArtifactId:null})),rightPanelOpen:true,activeTab:layout.activeTab,setActiveTab:(tab:typeof layout.activeTab)=>setLayout(value=>({...value,activeTab:tab}))};
 return <WorkspaceProvider value={workspace}><main inert={desktop.closing} className={`desktop-surface desktop-surface-${surface.kind}`}><header className="desktop-surface-header"><strong>{thread?.title??'Workspace'}</strong><DesktopWindowActions/></header>{desktop.state.backendError&&<p role="alert" className="error-text">{desktop.state.backendError}</p>}{error&&<p role="alert" className="error-text">{error}</p>}<div className="desktop-surface-body">{content}{['artifact','workspace'].includes(surface.kind)&&snapshot.operations.filter(operation=>operation.threadId===threadId&&(operation.status==='prepared'&&!operation.approved||operation.status==='unknown')).map(operation=><OperationDecision key={`${operation.id}:${operation.revision}`} operation={operation} refresh={()=>refresh()}/>)}</div></main></WorkspaceProvider>;
}
export function DesktopEntry(){const bridge=window.harnessDesktop,[context,setContext]=useState<DesktopContext|null>(null),[error,setError]=useState('');useEffect(()=>{if(!bridge)return;let alive=true;void bridge.getContext().then(value=>{parseDesktopSurface(value.surface);if(alive)setContext(value);}).catch(cause=>{if(alive)setError(cause instanceof Error?cause.message:'The desktop window could not open.');});return()=>{alive=false;};},[bridge]);if(!bridge)return <App/>;if(!context)return <main className="desktop-surface"><p role={error?'alert':'status'}>{error||'Opening desktop window…'}</p></main>;const surface:DesktopSurface=context.surface;return <DesktopProvider bridge={bridge} context={context}>{['main','thread','navigation'].includes(surface.kind)?<App/>:<Surface/>}</DesktopProvider>;}
