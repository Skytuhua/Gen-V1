// Test-only fixture: FileCheckpoints with a stub adapter whose restore seam
// works. ?mode=working (default) plans and applies cleanly; ?mode=conflict
// returns a CONFLICT apply result naming notes.txt; ?mode=disabled uses the
// real disabledCheckpointAdapter restore seam (enabled:false + reason note).
// Adapter calls are mirrored to window.__restoreCalls for order assertions.
import {createRoot} from 'react-dom/client';
import {FileCheckpoints} from '../../apps/web/src/FileCheckpoints';
import {disabledCheckpointAdapter,type CheckpointOwner,type FileCheckpoint,type FileCheckpointAdapter} from '../../apps/web/src/file-checkpoint-api';
import {RecordedDiffPanel} from '../../apps/web/src/WorkspacePanelBodies';
import {DEFAULT_PREFERENCES} from '../../packages/contracts/preferences';
declare global { interface Window { __restoreCalls: { kind: string; [key: string]: unknown }[] } }
import {taskFixture} from './task-interface-fixture';
import '@fontsource-variable/inter';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/shell.css';
import '../../apps/web/src/workspace-tools.css';
import './file-checkpoints-fixture.css';

const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Synthetic example'}}}});
snapshot.artifacts=[];
const mode=new URLSearchParams(location.search).get('mode')??'working';
const hash='a'.repeat(64),otherHash='b'.repeat(64);
const checkpoint:FileCheckpoint={id:'chk-fixture',label:'Before a guarded file edit',createdAt:'2026-11-10T18:42:00Z',provenance:{kind:'guarded_write',operationId:'op-fixture'},revision:hash,fileCount:2,expiresAt:null};
const paths=['notes.txt','docs/info.md'];
const calls:{kind:string;[key:string]:unknown}[]=[];window.__restoreCalls=calls;
// The server returns the whole StoredRestorePlan for plan and apply; the
// fixture mirrors that full shape so the client's strict reader is exercised.
const storedPlan=(plan:{id:string;owner:CheckpointOwner;checkpointId:string;selected:string[];approvalId:string;state:string;conflicts?:string[]})=>({version:1,id:plan.id,checkpointId:plan.checkpointId,scope:plan.owner,currentRevision:hash,selectedPaths:[...plan.selected],beforeDigests:plan.selected.map(path=>({path,digest:otherHash})),targetDigests:plan.selected.map(path=>({path,digest:hash})),preRestoreCheckpointId:'chk-pre-1',approvalId:plan.approvalId,state:plan.state,conflicts:plan.conflicts??[],createdAt:'2026-11-10T18:50:00Z'});
const adapter:FileCheckpointAdapter={available:true,
 list:async(owner)=>({owner,items:[checkpoint],nextCursor:null}),
 detail:async(owner,cp)=>({owner,checkpoint:cp,files:paths.map(path=>({path,targetHash:hash,bytes:24,restorable:true,reason:null}))}),
 review:async(owner,cp,options)=>({owner,reviewId:'rev-fixture',checkpointRevision:cp.revision,expiresAt:'2099-01-01T00:00:00Z',files:options.paths.map(path=>({path,currentHash:otherHash,targetHash:hash,diff:'--- a/'+path+'\n+++ b/'+path+'\n@@ -1 +1 @@\n-edited\n+checkpoint-original',diffTruncated:false,status:'ready'}))}),
 restore:mode==='disabled'?disabledCheckpointAdapter.restore:{
  enabled:true,reason:'',
  plan:async(owner,cp,selected,approvalId)=>{calls.push({kind:'plan',paths:[...selected],approvalId});return storedPlan({id:'rst-fixture-1',owner,checkpointId:cp.id,selected,approvalId,state:'PREVIEW'});},
  apply:async(owner,cp,planId,approvalId)=>{calls.push({kind:'apply',planId,approvalId});const planned=[...((calls.find(c=>c.kind==='plan')?.paths as string[])??[])];return storedPlan({id:planId,owner,checkpointId:cp.id,selected:planned,approvalId,state:mode==='conflict'?'CONFLICT':mode==='partial'?'PARTIAL_RECOVERY_REQUIRED':'APPLIED',conflicts:mode==='conflict'?['notes.txt']:[]});},
 },
};
function Fixture(){
 const owner:CheckpointOwner={projectId:'project-one',threadId:'task-thread',workingCopyId:'work-one',binding:hash};
 return <main className="wo5-checkpoints-fixture"><header><strong>Gen V1</strong><span>Workspace</span></header>
  <div className="wo5-checkpoints-workarea"><section className="wo5-checkpoints-conversation" aria-label="Conversation"><strong>Audit the workspace</strong></section>
  <section className="wo5-checkpoints-tool" aria-label="Changes">
   <FileCheckpoints owner={owner} preferences={{...DEFAULT_PREFERENCES,diffDefaultExpanded:true}} initialSource="History" adapter={adapter}
    current={<div className="panel-empty"><strong>Live working-copy changes</strong></div>}
    recorded={<RecordedDiffPanel snapshot={snapshot} threadId="task-thread" preferences={DEFAULT_PREFERENCES}/>}/>
  </section></div></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
