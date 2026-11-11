import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {Clock3} from 'lucide-react';
import type {UiPreferences} from '../../../packages/contracts/preferences';
import {isComposing} from '../../../packages/ui-shell/list-navigation';
import {RecordedDiffs} from './WorkspacePanelBodies';
import {checkpointOwnerKey,disabledCheckpointAdapter,readCheckpointList,readCheckpointReview,type CheckpointList,type CheckpointOwner,type CheckpointReview,type FileCheckpoint,type FileCheckpointAdapter} from './file-checkpoint-api';
import './file-checkpoints.css';

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
function CheckpointHistory({owner,adapter,preferences}:{owner:CheckpointOwner;preferences:UiPreferences;adapter:FileCheckpointAdapter}){
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
          <p>{item.paths.map(path=><span className="file-checkpoints-path" key={path}>{path}</span>)}{item.fileCount>item.paths.length&&<span>{item.fileCount-item.paths.length} more files</span>}</p>
          <p>{item.provenance}</p>
        </div><button type="button" aria-label={`Review ${item.label}`} onClick={event=>{opener.current=event.currentTarget;setCheckpoint(item);}}>Review</button>
      </li>)}</ul>
      {list?.nextCursor&&<button type="button" disabled={loading} onClick={()=>setCursor(list.nextCursor!)}>Next checkpoints</button>}
      {list?.retention.expiresAt&&<p className="file-checkpoints-note">History retained until <time dateTime={list.retention.expiresAt}>{new Date(list.retention.expiresAt).toLocaleString()}</time>.</p>}
      <p className="file-checkpoints-caption">Review the diff and conflicts before restoring selected files.</p>
    </div>
    {checkpoint&&<CheckpointFiles key={checkpoint.id+':'+checkpoint.revision} owner={owner} adapter={adapter} checkpoint={checkpoint} preferences={preferences} onBack={()=>{setCheckpoint(undefined);queueMicrotask(()=>opener.current?.focus());}}/>}
  </div>;
}
function CheckpointFiles({owner,adapter,checkpoint,preferences,onBack}:{owner:CheckpointOwner;preferences:UiPreferences;adapter:FileCheckpointAdapter;checkpoint:FileCheckpoint;onBack:()=>void}){
  const [review,setReview]=useState<CheckpointReview>(),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const back=useRef<HTMLButtonElement>(null),reason=useId();
  useEffect(()=>{back.current?.focus();},[]);
  useEffect(()=>{
    const controller=new AbortController();setReview(undefined);setError('');
    void adapter.review(owner,checkpoint,{paths:checkpoint.paths,signal:controller.signal}).then(value=>{
      if(!controller.signal.aborted)setReview(readCheckpointReview(value,owner,checkpoint));
    }).catch(cause=>{if(!controller.signal.aborted)setError(errorMessage(cause));});
    return()=>controller.abort();
  },[owner,adapter,checkpoint,attempt]);
  const diffs=review?.files.flatMap(file=>file.diff?[{id:file.path,title:file.path,...file.diff,provenance:`Checkpoint ${checkpoint.id} · ${checkpoint.provenance}${file.oldPath?' · Renamed from '+file.oldPath:''}`}]:[])??[];
  return <section aria-label="Checkpoint review">
    <button ref={back} type="button" onClick={onBack}>Back to History</button><h3>{checkpoint.label}</h3>
    {error?<div role="alert"><p>{error}</p><button type="button" onClick={()=>setAttempt(value=>value+1)}>Retry review</button></div>:!review?<p role="status">Loading checkpoint review…</p>:<>
      <p className="file-checkpoints-note">{checkpoint.provenance} · Revision {review.checkpointRevision}</p>
      {review.files.filter(file=>file.diff===null).map(file=><p className="file-checkpoints-note" key={file.path}>{file.oldPath?file.oldPath+' → ':''}{file.path} · {file.status==='available'?'No text comparison available':file.status}</p>)}
      {review.files.length===0?<p>No files available for review.</p>:diffs.length>0&&<RecordedDiffs diffs={diffs} preferences={preferences}/>}
      <button type="button" disabled aria-describedby={reason}>Restore selected files</button><p id={reason} className="file-checkpoints-note">{adapter.restore.reason}</p>
    </>}
  </section>;
}
