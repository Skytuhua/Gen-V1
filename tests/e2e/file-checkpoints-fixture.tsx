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
const checkpoints:FileCheckpoint[]=[{id:'layout',label:'Before updating workspace layout',createdAt:'2026-11-10T18:42:00Z',provenance:'Before a guarded file edit',revision:'checkpoint-1',paths:['src/workspace-layout.ts','src/workspace-layout.test.ts'],fileCount:2},{id:'guide',label:'Before editing the project guide',createdAt:'2026-11-09T23:18:00Z',provenance:'Before a guarded file edit',revision:'checkpoint-2',paths:['docs/project-guide.md'],fileCount:1}];
if(state==='stress')for(const checkpoint of checkpoints){checkpoint.label+=' extraordinarily-long-project-and-file-name-with-unbroken-content-abcdefghijklmnopqrstuvwxyz0123456789';checkpoint.paths=checkpoint.paths.map(path=>'very/long/nested/folder/abcdefghijklmnopqrstuvwxyz0123456789/'+path);}
let attempts=0;
const wait=()=>new Promise<void>(resolve=>{window.addEventListener('checkpoint-release',()=>resolve(),{once:true});});
const adapter:FileCheckpointAdapter={available:true,restore:disabledCheckpointAdapter.restore,
 list:async(owner)=>{
  attempts++;if(state==='loading'||state==='race'&&owner.threadId==='task-thread')await wait();
  if(state==='error'&&attempts===1)throw Error('Checkpoint history could not be read. Try again.');
  if(state==='denied')throw Error('Access to checkpoint history was denied.');
  return {owner,items:state==='empty'||state==='race'&&owner.threadId!=='task-thread'?[]:checkpoints,nextCursor:null,retention:{}};
 },
 review:async(owner,checkpoint,options)=>{
  window.dispatchEvent(new CustomEvent('checkpoint-request',{detail:{owner,checkpointId:checkpoint.id,paths:options.paths}}));
  if(state==='review-loading')await wait();
  if(state==='conflict')throw Error('The working copy changed. Return to History and review again.');
  return {owner:state==='foreign'?{...owner,workingCopyId:'foreign'}:owner,checkpointId:checkpoint.id,reviewId:'review-'+checkpoint.id,checkpointRevision:checkpoint.revision,workingCopyRevision:'work-2',expiresAt:state==='expired'?'2000-01-01T00:00:00Z':'2099-11-10T23:00:00Z',files:checkpoint.paths.map((path,index)=>({path,oldPath:state==='rename'?'src/old-name.ts':undefined,currentHash:'current',targetHash:'target',diff:state==='binary'||state==='missing'?null:{before:index?'expect(panelWidth).toBe(360);':'const panelWidth = 360;',after:index?'expect(panelWidth).toBe(420);':'const panelWidth = 420;'},status:state==='binary'?'binary':state==='missing'?'missing':'available',restoreSupported:true}))};
 },
};

function Fixture(){
 const [threadId,setThreadId]=useState('task-thread');
 const [owner]=useState<CheckpointOwner>({projectId:'project-one',threadId:'task-thread',workingCopyId:'work-one'});
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
