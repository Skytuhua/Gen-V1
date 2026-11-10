import {useEffect,useMemo,useRef,useState} from 'react';
import {FloatingWindow,type FloatingWindowProps} from './FloatingWindow';
import {clampFloatingLayout,floatingLayoutKey,type FloatingLayout} from './floating-layout';
import {journalRead,journalWrite,registerEditorHandoff,retryJournalWrites} from './plugin-frame-client';

/** Recover before mounting: opaque frames cannot use the personal browser's
 * localStorage and must never overwrite an unrecovered floating preference. */
export function PluginFloatingWindow(props:FloatingWindowProps){
 const [recovery,setRecovery]=useState<{id:string;layout:Partial<FloatingLayout>|null}>(),[error,setError]=useState(''),[retryRecovery,setRetryRecovery]=useState(0),saved=useRef<Partial<FloatingLayout>|null>(null),pending=useRef(Promise.resolve()),recovered=useRef(false);
 const key=floatingLayoutKey(props.id);
 useEffect(()=>{let alive=true;recovered.current=false;setError('');void journalRead<Partial<FloatingLayout>>(key).then(layout=>{if(alive){saved.current=layout??null;recovered.current=true;setRecovery({id:props.id,layout});}}).catch(()=>{if(alive)setError('The saved window placement could not be recovered. Keep this view open and retry.');});return()=>{alive=false;recovered.current=false;};},[key,props.id,retryRecovery]);
 // Failed writes remain in the SDK's intent journal. Let its flush check the
 // current intent after an explicit retry, rather than retaining an old rejection.
 useEffect(()=>registerEditorHandoff('floating:'+props.id,async()=>{if(!recovered.current)throw Error('Window placement has not recovered.');await pending.current.catch(()=>{});}),[props.id]);
 const storage=useMemo<NonNullable<FloatingWindowProps['storage']>>(()=>({read:(_id,initial,area,minimum)=>clampFloatingLayout({...initial,...saved.current},area,minimum),write:(_id,layout)=>{saved.current=layout;const write=pending.current.catch(()=>{}).then(()=>journalWrite(key,layout));pending.current=write;void write.catch(()=>setError('Window placement could not be saved. Keep this view open.'));}}),[key]);
 if(error&&recovery?.id!==props.id)return <p role="alert">{error} <button type="button" onClick={()=>setRetryRecovery(value=>value+1)}>Retry recovery</button></p>;
 if(recovery?.id!==props.id)return <p role="status">Recovering window placement…</p>;
 return <>{error&&<p role="alert">{error} <button type="button" onClick={()=>{void retryJournalWrites().then(()=>setError(''),()=>setError('Window placement could not be saved. Keep this view open.'));}}>Retry saving</button></p>}<FloatingWindow {...props} storage={storage}/></>;
}
