import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {AlertTriangle,CheckCircle2,ChevronLeft,ChevronRight,Clock3,Info,RotateCw} from 'lucide-react';
import type {UiPreferences} from '../../../packages/contracts/preferences';
import {isComposing} from '../../../packages/ui-shell/list-navigation';
import {displayFilePath} from './files/FilesView';
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
    <div className="file-checkpoints-toolbar"><strong>Changes</strong>
      <div role="tablist" aria-label="Changes source">{sources.map((name,index)=><button key={name} type="button" role="tab" id={`${id}-${name}`} aria-controls={`${id}-body`} aria-selected={source===name} tabIndex={source===name?0:-1} onClick={()=>setSource(name)} onKeyDown={event=>{
        if(isComposing(event))return;
        const next=event.key==='ArrowRight'?(index+1)%sources.length:event.key==='ArrowLeft'?(index+sources.length-1)%sources.length:event.key==='Home'?0:event.key==='End'?sources.length-1:null;
        if(next===null)return;event.preventDefault();setSource(sources[next]);event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
      }}>{name}</button>)}</div>
    </div>
    <div role="tabpanel" id={`${id}-body`} aria-labelledby={`${id}-${source}`} tabIndex={0}>
      <div hidden={source!=='Current'}>{current}</div><div hidden={source!=='Recorded'}>{recorded}</div>
      {source==='History'&&(owner?<CheckpointHistory key={checkpointOwnerKey(owner)} owner={owner} adapter={adapter} preferences={preferences}/>:<p className="file-checkpoints-note">Checkpoint history unavailable.</p>)}
    </div>
  </div>;
}
const errorMessage=(cause:unknown)=>cause instanceof Error?cause.message:'Checkpoints could not load. Try again.';
const plural=(count:number,word:string)=>`${count} ${word}${count===1?'':'s'}`;
const formatTime=(value:string,preferences:UiPreferences)=>new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short',hour12:preferences.timeFormat==='system'?undefined:preferences.timeFormat==='12h'});
const provenance=(checkpoint:FileCheckpoint)=>checkpoint.provenance.kind==='restore_backup'?'Saved before a restore':'Saved before an edit';
const statusNote=(status:string)=>status==='missing'?'Not in your files now':status==='binary'?'Binary file, no preview':status==='too_large'?'Too large to preview':status==='unreadable'?'Could not be read':'No preview available';
const diffLineKind=(line:string)=>line.startsWith('@@')?'hunk':line.startsWith('+')?'add':line.startsWith('-')?'remove':'context';
function CheckpointDiff({diff}:{diff:string}){
  const all=diff.split('\n'),firstHunk=all.findIndex(line=>line.startsWith('@@'));
  const headerEnd=firstHunk===-1?Math.min(2,all.length):firstHunk;
  const lines=all.filter((line,index)=>index>=headerEnd||!(line.startsWith('--- ')||line.startsWith('+++ ')));
  if(!lines.some(line=>line.trim()))return <pre className="unified-diff"><span data-kind="context">No differences.</span></pre>;
  return <pre className="unified-diff">{lines.map((line,index)=><span key={index} data-kind={diffLineKind(line)}>{line||' '}{'\n'}</span>)}</pre>;
}
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
      <div className="file-checkpoints-heading"><h3>File checkpoints</h3>{adapter.available&&<button type="button" className="file-checkpoints-quiet" disabled={loading} onClick={()=>{setCursor(undefined);setAttempt(value=>value+1);}}><RotateCw size={13} aria-hidden="true"/>Refresh</button>}</div>
      <p className="file-checkpoints-caption">Copies of your files saved before each change. Open one to compare it with your files and bring back what you need.</p>
      {loading&&items.length===0&&<p role="status" className="file-checkpoints-note">Loading checkpoints…</p>}
      {loading&&items.length>0&&<p role="status" className="file-checkpoints-note">Loading more checkpoints…</p>}
      {error&&<ErrorState message={error} onRetry={adapter.available?()=>setAttempt(value=>value+1):undefined}/>}
      {!loading&&!error&&items.length===0&&!nextCursor&&<p className="file-checkpoints-empty"><span>No file checkpoints available.</span> One is saved automatically before files are edited.</p>}
      {items.length>0&&<ul className="file-checkpoints-list file-checkpoints-entries">{items.map(item=><li key={item.id}>
        <button type="button" className="file-checkpoints-entry" aria-label={`Review ${item.label}`} title={`Operation ${item.provenance.operationId}`} onClick={event=>{opener.current=event.currentTarget;setCheckpoint(item);}}>
          <Clock3 size={14} aria-hidden="true"/>
          <span><strong>{item.label}</strong><small><time dateTime={item.createdAt}>{formatTime(item.createdAt,preferences)}</time> · {plural(item.fileCount,'file')}{item.provenance.kind==='restore_backup'?' · Saved before a restore':''}</small></span>
          <span className="file-checkpoints-entry-action" aria-hidden="true">Review<ChevronRight size={13}/></span>
        </button>
      </li>)}</ul>}
      {nextCursor&&<button type="button" className="file-checkpoints-quiet file-checkpoints-more" disabled={loading} onClick={()=>setCursor(nextCursor)}>Show older checkpoints</button>}
    </div>
    {checkpoint&&<CheckpointFiles key={checkpoint.id+':'+checkpoint.revision} owner={owner} adapter={adapter} checkpoint={checkpoint} preferences={preferences} onBack={()=>{setCheckpoint(undefined);queueMicrotask(()=>opener.current?.focus());}}/>}
  </div>;
}
type RestoreDone={state:string;restored:string[];conflicts:string[]};
function RestoreResult({done,onBack,onReviewAgain}:{done:RestoreDone;onBack:()=>void;onReviewAgain:()=>void}){
  const back=useRef<HTMLButtonElement>(null);
  useEffect(()=>{back.current?.focus();},[]);
  const applied=done.state==='APPLIED',conflict=done.state==='CONFLICT',partial=done.state==='PARTIAL_RECOVERY_REQUIRED';
  const title=applied?`Restored ${plural(done.restored.length,'file')}`:conflict?'Nothing was restored':partial?'Restore didn’t finish':'Restore stopped';
  const note=applied?'Your previous versions were saved as a new checkpoint in History, so you can undo this.':conflict?'Some files changed after you opened this review, so no files were changed. Review again to see the latest differences.':partial?'We could not confirm which files were restored. Check the files and recovery checkpoint before retrying.':'No files were changed. Review again to try once more.';
  return <section aria-label="Checkpoint restore result" className="file-checkpoints-result" data-state={applied?'success':'warning'}>
    <button ref={back} type="button" className="file-checkpoints-back" onClick={onBack}><ChevronLeft size={14} aria-hidden="true"/>Back to History</button>
    <div className="file-checkpoints-result-head">{applied?<CheckCircle2 size={18} aria-hidden="true"/>:<AlertTriangle size={18} aria-hidden="true"/>}<h3>{title}</h3></div>
    <p className="file-checkpoints-caption">{note}</p>
    {(done.restored.length>0||done.conflicts.length>0)&&<ul className="file-checkpoints-list file-checkpoints-outcomes">
      {done.restored.map(path=><li key={'r'+path} data-outcome="restored"><CheckCircle2 size={14} aria-hidden="true"/><span>{displayFilePath(path)}</span><small>Restored</small></li>)}
      {done.conflicts.map(path=><li key={'c'+path} data-outcome="skipped"><AlertTriangle size={14} aria-hidden="true"/><span>{displayFilePath(path)}</span><small>Changed since review</small></li>)}
    </ul>}
    {!applied&&<div className="file-checkpoints-actions"><button type="button" className="file-checkpoints-primary" onClick={onReviewAgain}>Review again</button></div>}
  </section>;
}
function CheckpointFiles({owner,adapter,checkpoint,preferences,onBack}:{owner:CheckpointOwner;preferences:UiPreferences}&{adapter:FileCheckpointAdapter;checkpoint:FileCheckpoint;onBack:()=>void}){
  const [reviews,setReviews]=useState<CheckpointReview[]>(),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const [selected,setSelected]=useState<Set<string>>(new Set()),[confirming,setConfirming]=useState(false),[plan,setPlan]=useState<CheckpointRestorePlan>(),[approvalId,setApprovalId]=useState(''),[applying,setApplying]=useState(false),[done,setDone]=useState<RestoreDone>(),[restoreError,setRestoreError]=useState('');
  const back=useRef<HTMLButtonElement>(null),confirmButton=useRef<HTMLButtonElement>(null);
  const restorable=Boolean(adapter.restore.enabled&&adapter.restore.plan&&adapter.restore.apply);
  useEffect(()=>{if(!done)back.current?.focus();},[done]);
  useEffect(()=>{if(confirming)confirmButton.current?.focus();},[confirming]);
  useEffect(()=>{
    const controller=new AbortController();setReviews(undefined);setError('');setSelected(new Set());
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
      if(!controller.signal.aborted)setReviews(results);
    })().catch(cause=>{if(!controller.signal.aborted)setError(errorMessage(cause));});
    return()=>controller.abort();
  },[owner,adapter,checkpoint,attempt]);
  const selectable=(file:CheckpointReview['files'][number])=>file.status==='ready'||(file.status==='missing'&&file.targetHash!==null);
  const selectablePaths=reviews?reviews.flatMap(review=>review.files.filter(selectable).map(file=>file.path)):[];
  const allSelected=selectablePaths.length>0&&selectablePaths.every(path=>selected.has(path));
  const toggle=(path:string,checked:boolean)=>setSelected(previous=>{const next=new Set(previous);if(checked)next.add(path);else next.delete(path);return next;});
  const cancel=()=>{setConfirming(false);setPlan(undefined);setApprovalId('');};
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
  if(done)return <RestoreResult done={done} onBack={onBack} onReviewAgain={()=>{setDone(undefined);cancel();setAttempt(value=>value+1);}}/>;
  const count=selected.size,locked=applying||confirming;
  return <section aria-label="Checkpoint review" className="file-checkpoints-review">
    <button ref={back} type="button" className="file-checkpoints-back" onClick={onBack}><ChevronLeft size={14} aria-hidden="true"/>Back to History</button>
    <h3>{checkpoint.label}</h3>
    <p className="file-checkpoints-meta" title={`Operation ${checkpoint.provenance.operationId} · Revision ${checkpoint.revision}`}>{provenance(checkpoint)} · <time dateTime={checkpoint.createdAt}>{formatTime(checkpoint.createdAt,preferences)}</time> · {plural(checkpoint.fileCount,'file')}</p>
    {error?<ErrorState message={error} retryLabel="Retry review" onRetry={()=>setAttempt(value=>value+1)}/>:!reviews?<p role="status" className="file-checkpoints-note">Loading checkpoint review…</p>:<>
      {!restorable&&<p className="file-checkpoints-callout"><Info size={14} aria-hidden="true"/><span>{adapter.restore.reason} You can still compare the files.</span></p>}
      <div className="file-checkpoints-legend"><span data-kind="remove">Your files now</span><span data-kind="add">In this checkpoint</span></div>
      {restorable&&selectablePaths.length>1&&<label className="file-checkpoints-select-all"><input type="checkbox" checked={allSelected} disabled={locked} onChange={event=>setSelected(event.target.checked?new Set(selectablePaths):new Set())}/>Select all</label>}
      {reviews.map((review,index)=><section key={review.reviewId} aria-label={`Review part ${index+1} of ${reviews.length}`} data-review-id={review.reviewId} className="file-checkpoints-part">
        {reviews.length>1&&<p className="file-checkpoints-note">Part {index+1} of {reviews.length} · {plural(review.files.length,'file')}</p>}
        {review.files.map(file=>{const canSelect=restorable&&selectable(file);return <div key={file.path} className="file-checkpoints-file" data-selected={selected.has(file.path)||undefined}>
          {canSelect&&<input type="checkbox" className="file-checkpoints-file-check" aria-label={`Restore ${displayFilePath(file.path)}`} checked={selected.has(file.path)} disabled={locked} onChange={event=>toggle(file.path,event.target.checked)}/>}
          {file.diff===null?<div className="file-checkpoints-file-plain"><strong>{displayFilePath(file.path)}</strong><small>{statusNote(file.status)}</small></div>:<details className="workspace-diff" open={preferences.diffDefaultExpanded}><summary>{displayFilePath(file.path)}</summary>
            {file.diffTruncated&&<p className="file-checkpoints-note">Diff truncated. Only part of this comparison is shown.</p>}
            <CheckpointDiff diff={file.diff}/>
          </details>}
        </div>;})}
      </section>)}
      {restoreError&&<ErrorState message={restoreError} onRetry={restorable?stage:undefined}/>}
      {restorable&&(confirming&&plan?<section aria-label="Confirm file restore" className="file-checkpoints-confirm">
        <strong>Restore {plural(plan.selectedPaths.length,'file')}?</strong>
        <p className="file-checkpoints-caption">{plan.selectedPaths.length===1?'This file goes':'These files go'} back to how {plan.selectedPaths.length===1?'it was':'they were'} in this checkpoint. Your current versions are saved as a new checkpoint first, so you can undo this.</p>
        <ul className="file-checkpoints-confirm-paths">{plan.selectedPaths.map(path=><li key={path}><code>{path}</code></li>)}</ul>
        <div className="file-checkpoints-actions">
          <button ref={confirmButton} type="button" className="file-checkpoints-primary" disabled={applying} onClick={apply}>{applying?'Restoring…':`Restore ${plural(plan.selectedPaths.length,'file')}`}</button>
          <button type="button" disabled={applying} onClick={cancel}>Cancel</button>
        </div>
      </section>:<div className="file-checkpoints-footer">
        <button type="button" className="file-checkpoints-primary" disabled={!count||applying} onClick={stage}>{count?`Restore ${plural(count,'file')}…`:'Restore selected files'}</button>
        <small className="file-checkpoints-note">{count?'You’ll confirm before anything changes.':'Select the files you want back.'}</small>
      </div>)}
    </>}
  </section>;
}
