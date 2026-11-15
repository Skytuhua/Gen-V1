import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {Clock3} from 'lucide-react';
import type {UiPreferences} from '../../../packages/contracts/preferences';
import {isComposing} from '../../../packages/ui-shell/list-navigation';
import {displayFilePath} from './files/FilesView';
import {RecordedDiffs} from './WorkspacePanelBodies';
import {checkpointOwnerKey,checkpointReviewPaths,disabledCheckpointAdapter,readCheckpointDetail,readCheckpointList,readCheckpointReview,readRestorePlan,readRestoreResult,type CheckpointOwner,type CheckpointRestorePlan,type CheckpointReview,type FileCheckpoint,type FileCheckpointAdapter} from './file-checkpoint-api';
import './file-checkpoints.css';
import {ErrorState} from '../../../packages/ui-shell/Feedback';

const sources=['Current','Recorded','History'] as const;
type Source=typeof sources[number];
export interface FileCheckpointsProps {
  owner?:CheckpointOwner;preferences:UiPreferences;current:ReactNode;recorded:ReactNode;
  adapter?:FileCheckpointAdapter;initialSource?:Source;
}
export function FileCheckpoints({owner,preferences,current,recorded,adapter=disabledCheckpointAdapter,initialSource='Current'}:FileCheckpointsProps){
  const [source,setSource]=useState<Source>(initialSource),id=useId();
  return <div className="file-checkpoints">
    <div className="file-checkpoints-toolbar"><strong><Clock3 size={15} aria-hidden="true"/>Changes</strong>
      <div role="tablist" aria-label="Changes source">{sources.map((name,index)=><button key={name} type="button" role="tab" id={`${id}-${name}`} aria-controls={`${id}-body`} aria-selected={source===name} tabIndex={source===name?0:-1} onClick={()=>setSource(name)} onKeyDown={event=>{
        if(isComposing(event))return;
        const next=event.key==='ArrowRight'?(index+1)%sources.length:event.key==='ArrowLeft'?(index+sources.length-1)%sources.length:event.key==='Home'?0:event.key==='End'?sources.length-1:null;
        if(next===null)return;event.preventDefault();setSource(sources[next]);event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
      }}>{name}</button>)}</div>
    </div>
    <div role="tabpanel" id={`${id}-body`} aria-labelledby={`${id}-${source}`} tabIndex={0}>
      <div hidden={source!=='Current'}>{current}</div><div hidden={source!=='Recorded'}>{recorded}</div>
      {source==='History'&&(owner?<CheckpointHistory key={checkpointOwnerKey(owner)} owner={owner} adapter={adapter} preferences={preferences}/>:<p className="file-checkpoints-note">File checkpoints are unavailable. No checkpoint service is connected.</p>)}
    </div>
  </div>;
}
const errorMessage=(cause:unknown)=>cause instanceof Error?cause.message:'Checkpoints could not load. Try again.';
const provenance=(checkpoint:FileCheckpoint)=>checkpoint.provenance.kind==='restore_backup'?'Saved before a restore':'Saved before a file edit';
const restoreOutcome=(state:string)=>state==='APPLIED'?'All selected files were restored.':state==='CONFLICT'?'Some files were not restored.':state==='PARTIAL_RECOVERY_REQUIRED'?'Restore partially applied — some files may need manual recovery.':`Restore finished (${state}).`;
const statusNote=(status:string)=>status==='ready'?'No text comparison available':status==='missing'?'Missing from the current working copy':status==='binary'?'Binary file — no text diff':status==='too_large'?'File too large to compare':status==='unreadable'?'Could not be read':'No comparison available';
function CheckpointHistory({owner,adapter,preferences}:{owner:CheckpointOwner;preferences:UiPreferences}&{adapter:FileCheckpointAdapter}){
  const [items,setItems]=useState<FileCheckpoint[]>([]),[nextCursor,setNextCursor]=useState<string>(),[error,setError]=useState(''),[loading,setLoading]=useState(true),[attempt,setAttempt]=useState(0),[cursor,setCursor]=useState<string>(),[checkpoint,setCheckpoint]=useState<FileCheckpoint>();
  const opener=useRef<HTMLButtonElement|null>(null);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');if(!cursor)setItems([]);
    void adapter.list(owner,{cursor,signal:controller.signal}).then(value=>{
      if(controller.signal.aborted)return;
      const page=readCheckpointList(value,owner);
      setItems(previous=>cursor?[...previous,...page.items]:page.items);setNextCursor(page.nextCursor??undefined);
    }).catch(cause=>{if(!controller.signal.aborted)setError(errorMessage(cause));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[owner,adapter,attempt,cursor]);
  return <div className="file-checkpoints-history">
    <div hidden={Boolean(checkpoint)}>
      <div className="file-checkpoints-heading"><h3>File checkpoints</h3>{adapter.available&&<button type="button" disabled={loading} onClick={()=>{setCursor(undefined);setAttempt(value=>value+1);}}>Refresh</button>}</div>
      <p className="file-checkpoints-caption">Saved copies of your files. Review the changes, then choose what to restore.</p>
      {loading&&items.length===0&&<p role="status">Loading checkpoints…</p>}
      {loading&&items.length>0&&<p role="status">Loading more checkpoints…</p>}
      {error&&<ErrorState message={error} onRetry={adapter.available?()=>setAttempt(value=>value+1):undefined}/>}
      {!loading&&!error&&items.length===0&&!nextCursor&&<p className="file-checkpoints-note">No file checkpoints available.</p>}
      <ul className="file-checkpoints-list">{items.map(item=><li key={item.id}>
        <Clock3 size={15} aria-hidden="true"/><div><strong>{item.label}</strong>
          <p><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short',hour12:preferences.timeFormat==='system'?undefined:preferences.timeFormat==='12h'})}</time> · {item.fileCount} {item.fileCount===1?'file':'files'}</p>
          <p title={`Operation ${item.provenance.operationId}`}>{provenance(item)}</p>
        </div><button type="button" aria-label={`Review ${item.label}`} onClick={event=>{opener.current=event.currentTarget;setCheckpoint(item);}}>Review</button>
      </li>)}</ul>
      {nextCursor&&<button type="button" disabled={loading} onClick={()=>setCursor(nextCursor)}>Next checkpoints</button>}
    </div>
    {checkpoint&&<CheckpointFiles key={checkpoint.id+':'+checkpoint.revision} owner={owner} adapter={adapter} checkpoint={checkpoint} preferences={preferences} onBack={()=>{setCheckpoint(undefined);queueMicrotask(()=>opener.current?.focus());}}/>}
  </div>;
}
function CheckpointFiles({owner,adapter,checkpoint,preferences,onBack}:{owner:CheckpointOwner;preferences:UiPreferences}&{adapter:FileCheckpointAdapter;checkpoint:FileCheckpoint;onBack:()=>void}){
  const [reviews,setReviews]=useState<CheckpointReview[]>(),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const [selected,setSelected]=useState<Set<string>>(new Set()),[confirming,setConfirming]=useState(false),[plan,setPlan]=useState<CheckpointRestorePlan>(),[approvalId,setApprovalId]=useState(''),[applying,setApplying]=useState(false),[done,setDone]=useState<{state:string;restored:string[];conflicts:string[]}>(),[restoreError,setRestoreError]=useState('');
  const back=useRef<HTMLButtonElement>(null),reason=useId();
  const restorable=adapter.restore.enabled&&adapter.restore.plan&&adapter.restore.apply;
  const readyPaths=useRef<Set<string>>(new Set());
  useEffect(()=>{back.current?.focus();},[]);
  useEffect(()=>{
    const controller=new AbortController();setReviews(undefined);setError('');
    void (async()=>{
      const value=await adapter.detail(owner,checkpoint,{signal:controller.signal});
      if(controller.signal.aborted)return;
      const batches=checkpointReviewPaths(readCheckpointDetail(value,owner,checkpoint)),results:CheckpointReview[]=[];
      for(const [index,paths] of batches.entries()){
        try{
          const result=await adapter.review(owner,checkpoint,{paths,signal:controller.signal});
          if(controller.signal.aborted)return;
          const review=readCheckpointReview(result,owner,checkpoint,paths);
          if(results.some(value=>value.reviewId===review.reviewId))throw Error('Duplicate review identity for different file subsets.');
          results.push(review);
        }catch(cause){throw Error(`Review part ${index+1} of ${batches.length} is incomplete. ${errorMessage(cause)}`);}
      }
      readyPaths.current=new Set(results.flatMap(review=>review.files.filter(file=>file.status==='ready').map(file=>file.path)));
      if(!controller.signal.aborted)setReviews(results);
    })().catch(cause=>{if(!controller.signal.aborted)setError(errorMessage(cause));});
    return()=>controller.abort();
  },[owner,adapter,checkpoint,attempt]);
  const stage=async()=>{
    if(!restorable||!selected.size)return;
    setRestoreError('');setApplying(true);
    const approval=crypto.randomUUID();
    try{
      const payload=await adapter.restore.plan!(owner,checkpoint,[...selected],approval);
      const staged=readRestorePlan(payload);
      setApprovalId(approval);setPlan(staged);setConfirming(true);
    }catch(cause){setRestoreError(errorMessage(cause));}finally{setApplying(false);}
  };
  const apply=async()=>{
    if(!restorable||!plan||!approvalId)return;
    setRestoreError('');setApplying(true);
    try{
      const payload=await adapter.restore.apply!(owner,checkpoint,plan.planId,approvalId),result=readRestoreResult(payload);
      setDone({state:result.state,restored:result.restored,conflicts:result.conflicts});setConfirming(false);
    }catch(cause){setRestoreError(errorMessage(cause));setConfirming(false);}finally{setApplying(false);}
  };
  if(done)return <section aria-label="Checkpoint restore result">
    <button type="button" onClick={onBack}>Back to History</button><h3>Restore {done.state==='APPLIED'?'complete':'result'}</h3>
    <p className="file-checkpoints-note">{restoreOutcome(done.state)}</p>
    {done.restored.length>0&&<ul className="file-checkpoints-list">{done.restored.map(path=><li key={path}><strong>{displayFilePath(path)}</strong><p>Restored.</p></li>)}</ul>}
    {done.conflicts.length>0&&<ul className="file-checkpoints-list">{done.conflicts.map(path=><li key={path}><strong>{displayFilePath(path)}</strong><p>Not restored — the file changed after this review.</p></li>)}</ul>}
  </section>;
  return <section aria-label="Checkpoint review">
    <button ref={back} type="button" onClick={onBack}>Back to History</button><h3>{checkpoint.label}</h3>
    {error?<ErrorState message={error} retryLabel="Retry review" onRetry={()=>setAttempt(value=>value+1)}/>:!reviews?<p role="status">Loading checkpoint review…</p>:<>
      <p className="file-checkpoints-note" title={`Revision ${checkpoint.revision}`}>{provenance(checkpoint)} · {checkpoint.provenance.operationId} · revision {checkpoint.revision.slice(0,10)}</p>
      {reviews.map((review,index)=><section key={review.reviewId} aria-label={`Review part ${index+1} of ${reviews.length}`}>
      <p className="file-checkpoints-note">{reviews.length>1?`Part ${index+1} of ${reviews.length} · ${review.reviewId} · `:''}{review.files.length} {review.files.length===1?'file':'files'}</p>
      {review.files.filter(file=>file.diff===null).map(file=><p className="file-checkpoints-note" key={file.path}>{displayFilePath(file.path)} · {statusNote(file.status)}</p>)}
      {review.files.filter(file=>file.diffTruncated).map(file=><p className="file-checkpoints-note" key={file.path}>{displayFilePath(file.path)} · Diff truncated. Only part of this comparison is shown.</p>)}
      {review.files.some(file=>file.diff!==null)&&<RecordedDiffs diffs={review.files.flatMap(file=>file.diff===null?[]:[{id:file.path,title:displayFilePath(file.path),unified:file.diff||'No changes reported.',provenance:checkpoint.label}])} preferences={preferences}/>}
      </section>)}
      {restorable&&<fieldset disabled={applying}>
        <legend className="file-checkpoints-note">Files to restore</legend>
        {reviews.map(review=>review.files.filter(file=>file.status==='ready'||(file.status==='missing'&&file.targetHash!==null)).map(file=><label key={review.reviewId+file.path} className="file-checkpoints-select">
          <input type="checkbox" checked={selected.has(file.path)} onChange={event=>setSelected(previous=>{const next=new Set(previous);if(event.target.checked)next.add(file.path);else next.delete(file.path);return next;})}/> {displayFilePath(file.path)}
        </label>))}
      </fieldset>}
      {restoreError&&<ErrorState message={restoreError} onRetry={restorable?stage:undefined}/>}
      {confirming&&plan?<section aria-label="Confirm file restore">
        <p className="file-checkpoints-caption">Restore {plan.selectedPaths.length} {plan.selectedPaths.length===1?'file':'files'} from this checkpoint? Current versions are backed up first; files changed since this review are skipped, not overwritten.</p>
        <ul className="file-checkpoints-list">{plan.selectedPaths.map(path=><li key={path}><strong>{displayFilePath(path)}</strong></li>)}</ul>
        <button type="button" disabled={applying} onClick={apply}>Confirm restore</button>
        <button type="button" disabled={applying} onClick={()=>{setConfirming(false);setPlan(undefined);setApprovalId('');}}>Cancel</button>
      </section>:<button type="button" disabled={!restorable||!selected.size||applying} onClick={stage} aria-describedby={restorable?undefined:reason}>Restore selected files</button>}
      {!restorable&&<p id={reason} className="file-checkpoints-note">{adapter.restore.reason}</p>}
    </>}
  </section>;
}
