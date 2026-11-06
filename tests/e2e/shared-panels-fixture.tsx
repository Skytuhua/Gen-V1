import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {WorkspacePanel} from '../../apps/web/src/WorkspacePanel';
import {GitHubSignIn} from '../../apps/web/src/GitHubSignIn';
import {WorkspaceLauncher} from '../../apps/web/src/WorkspacePanelBodies';
import {WorkspaceSurfaceBody} from '../../apps/web/src/WorkspaceSurfaceBody';
import {WorkspaceProvider,type WorkspaceTab} from '../../apps/web/src/workspace-context';
import {readShellLayout} from '../../apps/web/src/shell-layout';
import {useDesktopCloseGuard} from '../../apps/web/src/desktop-context';
import {prepareEditorHandoff} from '../../apps/web/src/editor-handoff';
import {DEFAULT_PREFERENCES} from '../../packages/contracts/preferences';
import {taskFixture} from './task-interface-fixture';
import '../../apps/web/src/styles.css';

const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Fixture'}}}});
snapshot.artifacts=[];
if(new URLSearchParams(location.search).has('project'))snapshot.threads.find(thread=>thread.id==='task-thread')!.projectId='project-one';
const w=window as unknown as {__saved?:string[];__refuseSave?:boolean;__opened?:string[]};
function WebEditor({name}:{name:string}){
 const [draft,setDraft]=useState('');
 useDesktopCloseGuard('artifact:duplicate',async()=>{if(w.__refuseSave&&name==='first')throw Error('Save refused');w.__saved??=[];w.__saved.push(name+':'+draft);});
 return <label>{name}<input aria-label={name+' editor'} value={draft} onChange={event=>setDraft(event.target.value)}/></label>;
}
function Fixture(){
 const [authActive,setAuthActive]=useState(true);
 const [layout,setLayout]=useState(()=>({...readShellLayout(),rightPanelOpen:true})),[error,setError]=useState(''),[editors,setEditors]=useState(true),[refreshes,setRefreshes]=useState(0);
 const [panels,setPanels]=useState(true),mode=new URLSearchParams(location.search).get('pr-panels');
 if(new URLSearchParams(location.search).has('auth-retained'))return <><button onClick={()=>setAuthActive(value=>!value)}>Toggle sign-in active</button><div hidden={!authActive}><GitHubSignIn active={authActive}/></div></>;
 const prepare=async()=>{setError('');try{await prepareEditorHandoff();setEditors(false);}catch(cause){setError((cause as Error).message);}};
 if(mode)return <><button onClick={()=>setPanels(value=>!value)}>{panels?'Hide PR bodies':'Show PR bodies'}</button><button onClick={()=>void prepare()}>Prepare PR handoff</button>{error&&<p role="alert">{error}</p>}{!editors&&<output>PR handoff ready</output>}{panels&&['first','second'].map(id=><section key={id} aria-label={id+' PR panel'}><WorkspaceSurfaceBody panelId={'pr-'+id} kind={mode==='linked'?'linked-pull-requests':mode==='diff'?'diff':'pull-request'} binding={{authority:{kind:'local'},projectId:'project-one',threadId:'task-thread'}} snapshot={snapshot} refresh={async()=>{}}/></section>)}</>;
 return <WorkspaceProvider value={{activeArtifactId:null,requestOpenArtifact:()=>{},closeArtifact:()=>{},rightPanelOpen:true,activeTab:layout.activeTab,setActiveTab:(tab:WorkspaceTab)=>setLayout(value=>({...value,activeTab:tab}))}}>
  {editors&&<><WebEditor name="first"/><WebEditor name="second"/></>}<button onClick={()=>void prepare()}>Prepare layout change</button>{error&&<p role="alert">{error}</p>}
  <section aria-label="Canvas launcher"><WorkspaceLauncher onOpenTool={kind=>{w.__opened??=[];w.__opened.push(kind);}}/></section>
  <output aria-label="Refresh count">{refreshes}</output>
  <WorkspacePanel snapshot={snapshot} threadId="task-thread" preferences={DEFAULT_PREFERENCES} layout={layout} close={()=>{}} setWidth={()=>{}} refresh={async()=>{setRefreshes(value=>value+1);}}/>
 </WorkspaceProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
