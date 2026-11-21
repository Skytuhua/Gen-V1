import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {Check,Eye,EyeOff,KeyRound,LoaderCircle,Trash2} from 'lucide-react';
import {EVERYDAY_SCHEMAS,type CredentialEntryProps} from '../../../packages/ui-catalog/everyday';
import {ApiError,getCredentialSlot,saveCredentialSlot,removeCredentialSlot,type CredentialMetadata} from './api';
import {useSecureArtifact} from './secure-artifact-context';
import {animateTask} from './task-motion';
import {readMotionPolicy} from './motion-policy';
import './credential-entry.css';

type CredentialPending='checking'|'saving'|'removing';
const pendingLabel:Record<CredentialPending,string>={checking:'Checking private token…',saving:'Saving token…',removing:'Removing token…'};
function SavedStatus({ack}:{ack:number}){
  const ref=useRef<HTMLSpanElement>(null);
  useLayoutEffect(()=>{
    if(!ack)return;
    const node=ref.current;if(!node)return;
    animateTask(node,[{opacity:.8},{opacity:1}],120);
    const icon=node.parentElement?.querySelector<SVGGeometryElement>('svg polyline,svg path');
    if(icon&&readMotionPolicy()==='full'){icon.setAttribute('pathLength','1');icon.style.strokeDasharray='1';icon.animate([{strokeDashoffset:'1'},{strokeDashoffset:'0'}],{duration:90,easing:'cubic-bezier(.16,1,.3,1)'});}
  },[ack]);
  return <><Check size={13} aria-hidden="true"/><span ref={ref}>Saved for this host session</span></>;
}
export function CredentialEntry(props:CredentialEntryProps){
  const declaration=EVERYDAY_SCHEMAS.CredentialEntry.parse(props),scope=useSecureArtifact(),id=useId(),field=useRef<HTMLInputElement>(null);
  const [metadata,setMetadata]=useState<CredentialMetadata|null>(null),[pending,setPending]=useState<CredentialPending|null>(null),[error,setError]=useState(''),[hasInput,setHasInput]=useState(false),[revealed,setRevealed]=useState(false),[ack,setAck]=useState(0);
  const sequence=useRef(0),current=useRef(scope);
  const identity=JSON.stringify([scope?.artifactId,scope?.threadId,declaration.slotKey,declaration.service,declaration.label,declaration.purpose]);
  const active=useRef(identity);
  useLayoutEffect(()=>{if(active.current!==identity||current.current?.active!==scope?.active||current.current?.revision!==scope?.revision){sequence.current++;setError('');setAck(0);}current.current=scope;active.current=identity;});
  useLayoutEffect(()=>{const input=field.current;if(input)input.value='';setHasInput(false);setRevealed(false);return()=>{if(input)input.value='';};},[identity,scope?.active]);
  const statusRef=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    const mark=statusRef.current?.querySelector<HTMLElement>('.credential-empty-dot');
    if(!mark)return;
    queueMicrotask(()=>{if(!mark.isConnected||readMotionPolicy()!=='full'||!mark.closest('[data-entry-phase="entering"]'))return;animateTask(mark,[{opacity:.65},{opacity:1}],100);});
  },[]);
  const refresh=async()=>{
    if(!scope||scope.active===false)return;const generation=++sequence.current;setPending('checking');
    try{const next=await getCredentialSlot(scope,declaration.slotKey);if(sequence.current===generation){setMetadata(next);setError('');}}
    catch{if(sequence.current===generation){setMetadata(null);setError('This private token request is unavailable. Refresh the task and try again.');}}
    finally{if(sequence.current===generation)setPending(null);}
  };
  useEffect(()=>{setMetadata(null);setPending(null);setAck(0);void refresh();return()=>{sequence.current++;};},[identity,scope?.revision,scope?.active]);
  useEffect(()=>{const visible=()=>{if(document.visibilityState==='visible')void refresh();};document.addEventListener('visibilitychange',visible);return()=>document.removeEventListener('visibilitychange',visible);},[identity,scope?.revision,scope?.active]);
  useEffect(()=>{if(!metadata?.expiresAt)return;const timer=setTimeout(()=>void refresh(),Math.max(0,Math.min(2147483647,metadata.expiresAt-Date.now()+30)));return()=>clearTimeout(timer);},[metadata?.expiresAt,identity,scope?.revision,scope?.active]);
  const mutate=async(remove=false)=>{
    if(!scope||scope.active===false||pending||!metadata)return;
    const token=remove?'':field.current?.value??'';
    if(!remove&&(!token.trim()||new TextEncoder().encode(token).length>8192)){setError('Enter a token no larger than 8 KiB.');return;}
    // Password bytes remain only in this invocation and its single dedicated
    // request. The input and any reveal state are cleared before the write is
    // sent; no state store, journal, command or agent action sees the value.
    if(field.current)field.current.value='';setHasInput(false);setRevealed(false);setError('');setPending(remove?'removing':'saving');
    const generation=++sequence.current,owned=identity;
    const matches=()=>active.current===owned&&current.current?.active!==false&&current.current?.revision===scope.revision&&sequence.current===generation;
    try{const next=remove?await removeCredentialSlot(scope,declaration.slotKey,metadata.version):await saveCredentialSlot(scope,declaration.slotKey,token,metadata.version);if(matches()){setMetadata(next);if(!remove&&next.present)setAck(next.version);}}
    catch(cause){
      if(!matches())return;
      try{const next=await getCredentialSlot(scope,declaration.slotKey);if(matches()){setMetadata(next);setError(cause instanceof ApiError&&['CREDENTIAL_CHANGED','STALE_REVISION'].includes(cause.code)?'This request changed. Its current status has been refreshed; try again.':`The acknowledgment was interrupted. ${next.present?'A token is currently saved for this host session; replace it if needed.':'No token is currently saved. Try again.'}`);}}
      catch{if(matches()){setMetadata(null);setError('The change could not be confirmed. Reconnect and refresh its status before trying again.');}}
    }finally{if(matches())setPending(null);}
  };
  if(!scope)return <section className="credential-entry"><p role="status">Open this private credential request in its owning task.</p></section>;
  const busy=pending!==null;
  return <section className="credential-entry" aria-label={`${declaration.service} credential`}>
    <header className="credential-heading"><span className="credential-key"><KeyRound size={16}/></span><div><strong>{declaration.service}</strong>{declaration.purpose&&<p>{declaration.purpose}</p>}</div><div ref={statusRef} className="credential-status" role="status">{pending?<><LoaderCircle size={12} className="spinning" aria-hidden="true"/><span>{pendingLabel[pending]}</span></>:!metadata?<span>Status unavailable</span>:metadata.present?<SavedStatus ack={ack===metadata.version?ack:0}/>:<><span className="credential-empty-dot" aria-hidden="true"/><span>No token saved</span></>}</div></header>
    <label className="credential-label" htmlFor={id}>{declaration.label}</label>
    <div className="credential-input"><input ref={field} id={id} type={revealed?'text':'password'} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={8192} disabled={scope.active===false||busy||!metadata} placeholder={metadata?.present?'Enter a replacement token':'Paste your token'} onInput={event=>setHasInput(Boolean(event.currentTarget.value))} onKeyDown={event=>{if(event.key==='Enter'){if(event.nativeEvent.isComposing||event.nativeEvent.keyCode===229)return;event.preventDefault();event.stopPropagation();void mutate();}}}/><button type="button" className="icon-button" aria-label={revealed?'Hide token':'Show token'} disabled={scope.active===false||busy} onClick={()=>setRevealed(value=>!value)}>{revealed?<EyeOff size={14}/>:<Eye size={14}/>}</button></div>
    <div className="credential-actions"><button type="button" className="primary" disabled={busy||!metadata||!hasInput} onClick={()=>void mutate()}>{metadata?.present?'Replace token':'Save token'}</button>{metadata?.present&&<button type="button" className="quiet" disabled={busy} onClick={()=>void mutate(true)}><Trash2 size={12}/>Remove token</button>}{!metadata&&!busy&&<button type="button" className="quiet" onClick={()=>void refresh()}>Refresh status</button>}</div>
    {error&&<p className="credential-error error-text" role="status">{error}</p>}
    <p className="credential-lifetime">Cleared after one hour or when this host restarts. No external connection is made.</p>
  </section>;
}
