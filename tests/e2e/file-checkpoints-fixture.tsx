import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {FileCheckpoints} from '../../apps/web/src/FileCheckpoints';
import {disabledCheckpointAdapter,type CheckpointOwner,type FileCheckpoint,type FileCheckpointAdapter} from '../../apps/web/src/file-checkpoint-api';
import {RecordedDiffPanel} from '../../apps/web/src/WorkspacePanelBodies';
import {ComposerTaskActions} from '../../apps/web/src/ComposerToolbar';
import {DEFAULT_PREFERENCES} from '../../packages/contracts/preferences';
import {taskFixture} from './task-interface-fixture';
import '@fontsource-variable/inter';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/shell.css';
import '../../apps/web/src/workspace-tools.css';
import './file-checkpoints-fixture.css';

const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Synthetic example'}}}});
snapshot.artifacts=[];
snapshot.data=[{id:'recorded',threadId:'task-thread',revision:1,createdAt:'2026-11-10T18:42:00Z',provenance:'Synthetic recorded executor comparison',value:{title:'src/workspace-layout.ts',before:'const panelWidth = 360;',after:'const panelWidth = 420;'}}];
const query=new URLSearchParams(location.search),state=query.get('state');
const hash='a'.repeat(64),otherHash='b'.repeat(64);
const checkpoints:FileCheckpoint[]=[{id:'layout',label:'Before updating workspace layout',createdAt:'2026-11-10T18:42:00Z',provenance:{kind:'guarded_write',operationId:'layout-edit'},revision:hash,fileCount:(state==='full-100'||state?.startsWith('long-'))?100:2,expiresAt:null},{id:'guide',label:'Before editing the project guide',createdAt:'2026-11-09T23:18:00Z',provenance:{kind:'guarded_write',operationId:'guide-edit'},revision:otherHash,fileCount:1,expiresAt:null}];
const pathsById:Record<string,string[]>={layout:state?.startsWith('long-')?Array.from({length:100},(_,i)=>`src/${i}/${'a'.repeat(200)}/${'b'.repeat(200)}/file.ts`):state==='full-100'?Array.from({length:100},(_,i)=>`src/file-${i}.ts`):state==='leading-space'?[' src/a','src/a']:['src/workspace-layout.ts','src/workspace-layout.test.ts'],guide:['docs/project-guide.md']};
if(state==='stress')for(const checkpoint of checkpoints){checkpoint.label+=' extraordinarily-long-project-and-file-name-with-unbroken-content-abcdefghijklmnopqrstuvwxyz0123456789';pathsById[checkpoint.id]=pathsById[checkpoint.id].map(path=>'very/long/nested/folder/abcdefghijklmnopqrstuvwxyz0123456789/'+path);}
let attempts=0,reviews=0;
const wait=()=>new Promise<void>(resolve=>{window.addEventListener('checkpoint-release',()=>resolve(),{once:true});});
const call=(kind:string,owner:CheckpointOwner,checkpoint?:FileCheckpoint,paths?:string[])=>window.dispatchEvent(new CustomEvent('checkpoint-call',{detail:{kind,owner,checkpointId:checkpoint?.id,paths}}));
const adapter:FileCheckpointAdapter={available:true,restore:disabledCheckpointAdapter.restore,
 list:async(owner)=>{
  call('list',owner);attempts++;if(state==='loading'||state==='race'&&owner.threadId==='task-thread')await wait();
  if(state==='error'&&attempts===1)throw Error('Checkpoint history could not be read. Try again.');
  if(state==='denied')throw Error('Access to checkpoint history was denied.');
  return {owner,items:state==='empty'||state==='race'&&owner.threadId!=='task-thread'?[]:checkpoints,nextCursor:null};
 },
 detail:async(owner,checkpoint)=>{
  call('detail',owner,checkpoint);
  if(state==='detail-loading')await wait();
  const files=pathsById[checkpoint.id].map(path=>({path,targetHash:hash,bytes:24,restorable:!['binary','rename'].includes(state??''),reason:state==='binary'?'binary':state==='rename'?'unsupported':null}));
  return {owner,checkpoint,files:state==='partial-detail'?files.slice(0,1):files};
 },
 review:async(owner,checkpoint,options)=>{
  call('review',owner,checkpoint,options.paths);reviews++;
  if(state==='review-loading')await wait();
  if(state==='long-fail'&&reviews===2)throw Error('Second subset unavailable.');
  if(state==='conflict')throw Error('The working copy changed. Return to History and review again.');
  const files=options.paths.map(path=>({path,currentHash:otherHash,targetHash:hash,diff:['binary','missing','rename'].includes(state??'')?null:'--- a/'+path+'\n+++ b/'+path+'\n@@ -1 +1 @@\n-const panelWidth = 360;\n+const panelWidth = 420;',diffTruncated:state==='truncated',status:state==='binary'?'binary':state==='missing'?'missing':state==='rename'?'unsupported':'ready'}));
  return {owner:state==='foreign'?{...owner,binding:otherHash}:owner,reviewId:'review-'+checkpoint.id+'-'+(state==='long-duplicate'?1:reviews),checkpointRevision:checkpoint.revision,expiresAt:state==='expired'?'2000-01-01T00:00:00Z':'2099-11-10T23:00:00Z',files:state==='long-partial'&&reviews===2?files.slice(0,-1):state==='partial-review'?files.slice(0,1):state==='empty-review'?[]:files};
 },
};

function Fixture(){
 const [threadId,setThreadId]=useState('task-thread');
 const [owner]=useState<CheckpointOwner>({projectId:'project-one',threadId:'task-thread',workingCopyId:state==='root'?null:'work-one',binding:hash});
 const currentOwner=threadId===owner.threadId?owner:{...owner,threadId};
 return <main className="wo5-checkpoints-fixture">
  <header><strong>Gen V1</strong><span>Workspace</span>{state==='race'&&<button onClick={()=>setThreadId('other-thread')}>Switch owner</button>}</header>
  <div className="wo5-checkpoints-workarea"><section className="wo5-checkpoints-conversation" aria-label="Conversation">
   <strong>Audit the workspace</strong><p className="panel-note">Example content</p><p>Review the workspace, sidebar and composer. This is synthetic audit content.</p>
   <div className="wo5-checkpoints-composer"><textarea aria-label="Prompt" placeholder="Ask anything…"/><ComposerTaskActions onChanges={()=>{}} onCreatePR={()=>{}}/></div>
  </section><section className="wo5-checkpoints-tool" aria-label="Changes">
   <FileCheckpoints owner={currentOwner} preferences={{...DEFAULT_PREFERENCES,diffDefaultExpanded:true}} initialSource="History" adapter={state==='unavailable'?undefined:adapter}
    current={<div className="panel-empty"><strong>Live working-copy changes</strong><p>Synthetic current Git source · work-one</p></div>}
    recorded={<RecordedDiffPanel snapshot={snapshot} threadId="task-thread" preferences={DEFAULT_PREFERENCES}/>}/>
  </section></div>
 </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
