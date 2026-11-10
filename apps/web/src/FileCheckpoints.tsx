import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {Clock3} from 'lucide-react';
import type {UiPreferences} from '../../../packages/contracts/preferences';
import {isComposing} from '../../../packages/ui-shell/list-navigation';
import {checkpointOwnerKey,checkpointReviewPaths,disabledCheckpointAdapter,readCheckpointDetail,readCheckpointList,readCheckpointReview,type CheckpointList,type CheckpointOwner,type CheckpointReview,type FileCheckpoint,type FileCheckpointAdapter} from './file-checkpoint-api';
import './file-checkpoints.css';

const sources=['Current','Recorded','History'] as const;
type Source=typeof sources[number];
export interface FileCheckpointsProps {
  owner:CheckpointOwner;preferences:UiPreferences;current:ReactNode;recorded:ReactNode;
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
      {source==='History'&&<CheckpointHistory key={checkpointOwnerKey(owner)} owner={owner} adapter={adapter} preferences={preferences}/>}
    </div>
  </div>;
}
const errorMessage=(cause:unknown)=>cause instanceof Error?cause.message:'Checkpoints could not load. Try again.';
const provenance=(checkpoint:FileCheckpoint)=>`${checkpoint.provenance.kind==='restore_backup'?'Before restoring files':'Before a guarded file edit'} · ${checkpoint.provenance.operationId}`;
function CheckpointHistory({owner,adapter,preferences}:Pick<FileCheckpointsProps,'owner'|'preferences'>&{adapter:FileCheckpointAdapter}){
  const [list,setList]=useState<CheckpointList>(),[error,setError]=useState(''),[loading,setLoading]=useState(true),[attempt,setAttempt]=useState(0),[cursor,setCursor]=useState<string>(),[checkpoint,setCheckpoint]=useState<FileCheckpoint>();
  const opener=useRef<HTMLButtonElement|null>(null);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');setList(undefined);
    void adapter.list(owner,{cursor,signal:controller.signal}).then(value=>{
      if(!controller.signal.aborted)setList(readCheckpointList(value,owner));
    }).catch(cause=>{if(!controller.signal.aborted)setError(errorMessage(cause));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[owner,adapter,attempt,cursor]);
  return <div className="file-checkpoints-history">
    <div hidden={Boolean(checkpoint)}>
      <div className="file-checkpoints-heading"><h3>File checkpoints</h3>{adapter.available&&<button type="button" disabled={loading} onClick={()=>{setCursor(undefined);setAttempt(value=>value+1);}}>Refresh</button>}</div>
      <p className="file-checkpoints-note">Review a version before restoring</p>
      {loading&&<p role="status">Loading checkpoints…</p>}
      {error&&<div role="alert"><p>{error}</p>{adapter.available&&<button type="button" onClick={()=>setAttempt(value=>value+1)}>Retry</button>}</div>}
      {!loading&&!error&&list?.items.length===0&&<p className="file-checkpoints-note">No file checkpoints available.</p>}
      <ul className="file-checkpoints-list">{list?.items.map(item=><li key={item.id}>
        <Clock3 size={15} aria-hidden="true"/><div><strong>{item.label}</strong>
          <p><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short',hour12:preferences.timeFormat==='system'?undefined:preferences.timeFormat==='12h'})}</time> · {item.fileCount} {item.fileCount===1?'file':'files'}</p>
          <p>{provenance(item)}</p>
        </div><button type="button" aria-label={`Review ${item.label}`} onClick={event=>{opener.current=event.currentTarget;setCheckpoint(item);}}>Review</button>
      </li>)}</ul>
      {list?.nextCursor&&<button type="button" disabled={loading} onClick={()=>setCursor(list.nextCursor!)}>Next checkpoints</button>}
      <p className="file-checkpoints-caption">Review the diff and conflicts before restoring selected files.</p>
    </div>
    {checkpoint&&<CheckpointFiles key={checkpoint.id+':'+checkpoint.revision} owner={owner} adapter={adapter} checkpoint={checkpoint} preferences={preferences} onBack={()=>{setCheckpoint(undefined);queueMicrotask(()=>opener.current?.focus());}}/>}
  </div>;
}
function CheckpointFiles({owner,adapter,checkpoint,preferences,onBack}:Pick<FileCheckpointsProps,'owner'|'preferences'>&{adapter:FileCheckpointAdapter;checkpoint:FileCheckpoint;onBack:()=>void}){
  const [review,setReview]=useState<CheckpointReview>(),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const back=useRef<HTMLButtonElement>(null),reason=useId();
  useEffect(()=>{back.current?.focus();},[]);
  useEffect(()=>{
    const controller=new AbortController();setReview(undefined);setError('');
    void (async()=>{
      const value=await adapter.detail(owner,checkpoint,{signal:controller.signal});
      if(controller.signal.aborted)return;
      const paths=checkpointReviewPaths(readCheckpointDetail(value,owner,checkpoint));
      const result=await adapter.review(owner,checkpoint,{paths,signal:controller.signal});
      if(!controller.signal.aborted)setReview(readCheckpointReview(result,owner,checkpoint,paths));
    })().catch(cause=>{if(!controller.signal.aborted)setError(errorMessage(cause));});
    return()=>controller.abort();
  },[owner,adapter,checkpoint,attempt]);
  return <section aria-label="Checkpoint review">
    <button ref={back} type="button" onClick={onBack}>Back to History</button><h3>{checkpoint.label}</h3>
    {error?<div role="alert"><p>{error}</p><button type="button" onClick={()=>setAttempt(value=>value+1)}>Retry review</button></div>:!review?<p role="status">Loading checkpoint review…</p>:<>
      <p className="file-checkpoints-note">{provenance(checkpoint)} · Revision {review.checkpointRevision}</p>
      {/* Same unified presentation as RecordedDiffPanel; run D owns shared extraction. */}
      <div className={`workspace-diffs diff-colors-${preferences.diffColors}`}>{review.files.map(file=><details className="workspace-diff" key={file.path} open={preferences.diffDefaultExpanded}>
        <summary>{file.path}</summary>
        {file.diffTruncated&&<p className="file-checkpoints-note">Diff truncated. Only part of this comparison is shown.</p>}
        {file.diff===null?<p className="file-checkpoints-note">{file.status==='ready'?'No text comparison available':file.status}</p>:<pre className="unified-diff">{file.diff||'No changes reported.'}</pre>}
      </details>)}</div>
      <button type="button" disabled aria-describedby={reason}>Restore selected files</button><p id={reason} className="file-checkpoints-note">{adapter.restore.reason}</p>
    </>}
  </section>;
}
