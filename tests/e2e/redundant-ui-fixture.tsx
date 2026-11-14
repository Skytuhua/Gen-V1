import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ProjectContextSurface} from '../../apps/web/src/ProjectContextSurface';
import {WorkspaceSurfaceBody} from '../../apps/web/src/WorkspaceSurfaceBody';
import {RecordedDiffPanel} from '../../apps/web/src/WorkspacePanelBodies';
import {ComposerTaskActions} from '../../apps/web/src/ComposerToolbar';
import {UsageFooter} from '../../apps/web/src/UsageFooter';
import {UsageDialog} from '../../apps/web/src/UsageDialog';
import {runtimeUsageReport} from '../../apps/web/src/usage-presentation';
import {DockedSummary} from '../../packages/ui-shell/SummaryDock';
import {EMPTY_USAGE} from '../../packages/contracts';
import {DEFAULT_PREFERENCES} from '../../packages/contracts/preferences';
import type {ProjectContext,WorkspacePanelKind} from '../../packages/contracts/workspace';
import {taskFixture} from './task-interface-fixture';
import '@fontsource-variable/inter';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/shell.css';
import './redundant-ui-fixture.css';

const query=new URLSearchParams(location.search),mode=query.get('mode')??'main',state=query.get('state');
const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Synthetic example'}}}});
const thread={...snapshot.threads[0],id:'thread-a',title:'Audit the workspace',projectId:'project-one',modelId:'fixture/model'};
snapshot.threads=[thread,{...thread,id:'thread-b',title:'Another owner'}];snapshot.activeThreadId='thread-b';snapshot.artifacts=[];
snapshot.usage={'thread-a':{...EMPTY_USAGE,inputTokens:18321,outputTokens:791,cost:0.012345,sessionPercent:23.456,weeklyPercent:67.89,contextTokens:18000,contextWindow:100000},'thread-b':{...EMPTY_USAGE,inputTokens:999,cost:8}};
snapshot.memory=[{id:'note',threadId:'thread-a',key:'decision',content:'Keep the owning thread notes.',revision:1,author:'user',updatedAt:'2026-11-10T00:00:00Z'}];
snapshot.data=[{id:'recorded',threadId:'thread-a',revision:1,createdAt:'2026-11-10T00:00:00Z',provenance:'Synthetic recorded executor comparison',value:{title:'Recorded comparison',before:'old recorded value',after:'new recorded value'}}];
const context:ProjectContext={project:{id:'project-one',name:'Gen V1',rootPath:'C:/Synthetic/Gen-V1',authority:{kind:'local'},createdAt:'2026-11-10T00:00:00Z'},threadId:'thread-a',workingCopy:{id:'copy-a',path:'C:/Synthetic/copy-a'},machineName:'Fixture machine',editor:{available:false,label:'Editor'},branch:'work/layout',head:'abc123',revision:'work-r1',changes:{files:1,added:4,removed:2},lineage:[],scripts:[],capabilities:{git:true,terminal:false,pullRequests:false}};
// Synthetic responses stay inside this fixture; production hooks and renderers run unchanged.
window.fetch=async(input,options)=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.origin);
 window.dispatchEvent(new CustomEvent('redundant-request',{detail:{path:url.pathname,threadId:url.searchParams.get('threadId'),method:options?.method??'GET'}}));
 if(url.pathname==='/api/bootstrap')return Response.json({csrfToken:'synthetic-only'});
 if(url.pathname==='/api/projects/project-one/context'){
  if(state==='loading')await new Promise<void>(resolve=>window.addEventListener('redundant-release',()=>resolve(),{once:true}));
  if(state==='error')return Response.json({error:{code:'SYNTHETIC_ERROR',message:'Project context could not load. Try again.'}},{status:503});
  return Response.json(state==='empty'?{...context,project:{...context.project,rootPath:''},capabilities:{git:false,terminal:false,pullRequests:false}}:context);
 }
 if(url.pathname==='/api/projects/project-one/git')return Response.json({projectId:'project-one',threadId:'thread-a',workingCopyId:'copy-a',head:'abc123',revision:'work-r1',branch:'work/layout',gitWrite:false,files:[{path:'src/layout.ts',index:' ',worktree:'M',added:4,removed:2,staged:false}],diff:'--- a/src/layout.ts\n+++ b/src/layout.ts\n-old live value\n+new live value',stagedDiff:''});
 throw Error('Unexpected fixture request: '+url.pathname);
};
function Fixture(){
 const [tool,setTool]=useState<WorkspacePanelKind>('usage'),[usageThreadId,setUsageThreadId]=useState<string>();
 const equivalent=mode==='main'||mode==='custom-proven',policy={composerChangesAvailable:equivalent};
 const ownerless=mode==='ownerless',noUsageRoute=mode==='detached';
 const report=runtimeUsageReport(snapshot.threads.find(item=>item.id===usageThreadId),usageThreadId?snapshot.usage[usageThreadId]:undefined);
 return <main className="wo5-redundant-fixture">
  <header><strong>Gen V1</strong><span>Workspace</span></header>
  <div className="wo5-redundant-workarea"><section className="wo5-redundant-conversation" aria-label="Conversation">
   <strong>{thread.title}</strong><p className="panel-note">Synthetic example · bound to thread-a; active snapshot thread-b</p>
   <nav aria-label="Workspace tools"><button onClick={()=>setTool('notes')}>Notes</button><button onClick={()=>setTool('usage')}>Usage panel</button><button onClick={()=>setTool('diff')}>Current changes</button><button onClick={()=>setTool('output')}>Recorded changes</button></nav>
   <section className="wo5-redundant-tool" aria-label="Tool destination">
    {tool==='output'?<RecordedDiffPanel snapshot={snapshot} threadId="thread-a" preferences={{...DEFAULT_PREFERENCES,diffDefaultExpanded:true}}/>:<WorkspaceSurfaceBody kind={tool} binding={{authority:{kind:'local'},threadId:'thread-a',projectId:'project-one'}} snapshot={snapshot} refresh={async()=>{}}/>}
   </section>
   <div className="wo5-redundant-composer"><textarea aria-label="Prompt" defaultValue="Keep my composer draft"/>{equivalent&&<ComposerTaskActions changeSummary={{added:4,removed:2}} onChanges={()=>setTool('diff')} onCreatePR={()=>{}}/>}</div>
  </section><aside className="wo5-redundant-summaries" aria-label="Conversation summaries">
   <DockedSummary id="wo5-project" title="Project overview" defaultCollapsed={false}><ProjectContextSurface {...policy} thread={thread} snapshot={snapshot} onShowChanges={()=>setTool('diff')}/></DockedSummary>
   <UsageFooter usage={snapshot.usage['thread-a']} visible threadId={ownerless?undefined:'thread-a'} onOpenUsage={noUsageRoute?undefined:id=>setUsageThreadId(id??'thread-b')}/>
  </aside></div>
  <UsageDialog open={Boolean(usageThreadId)} onClose={()=>setUsageThreadId(undefined)} reports={report?[report]:[]} loading={state==='usage-loading'} error={state==='usage-error'?'Usage refresh failed. Try again.':undefined}/>
 </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
