import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {Check,Eye,EyeOff,KeyRound,LoaderCircle,Trash2} from 'lucide-react';
import {EVERYDAY_SCHEMAS,type CredentialEntryProps} from '../../../packages/ui-catalog/everyday';
import {ApiError,getCredentialSlot,saveCredentialSlot,removeCredentialSlot,type CredentialMetadata} from './api';
import {useSecureArtifact} from './secure-artifact-context';
import './credential-entry.css';

export function CredentialEntry(props:CredentialEntryProps){
  const declaration=EVERYDAY_SCHEMAS.CredentialEntry.parse(props),scope=useSecureArtifact(),id=useId(),field=useRef<HTMLInputElement>(null);
  const [metadata,setMetadata]=useState<CredentialMetadata|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[hasInput,setHasInput]=useState(false),[revealed,setRevealed]=useState(false);
  const sequence=useRef(0),current=useRef(scope);current.current=scope;
  const identity=JSON.stringify([scope?.artifactId,scope?.threadId,declaration.slotKey,declaration.service,declaration.label,declaration.purpose]);
  const active=useRef(identity);active.current=identity;
  useLayoutEffect(()=>{const input=field.current;if(input)input.value='';setHasInput(false);setRevealed(false);setError('');return()=>{if(input)input.value='';sequence.current++;};},[identity,scope?.active]);
  const refresh=async()=>{
    if(!scope||scope.active===false)return;const generation=++sequence.current;setBusy(true);
    try{const next=await getCredentialSlot(scope,declaration.slotKey);if(sequence.current===generation){setMetadata(next);setError('');}}
    catch{if(sequence.current===generation){setMetadata(null);setError('This private token request is unavailable. Refresh the task and try again.');}}
    finally{if(sequence.current===generation)setBusy(false);}
  };
  useEffect(()=>{setMetadata(null);setBusy(false);void refresh();return()=>{sequence.current++;};},[identity,scope?.revision,scope?.active]);
  useEffect(()=>{const visible=()=>{if(document.visibilityState==='visible')void refresh();};document.addEventListener('visibilitychange',visible);return()=>document.removeEventListener('visibilitychange',visible);},[identity,scope?.revision,scope?.active]);
  useEffect(()=>{if(!metadata?.expiresAt)return;const timer=setTimeout(()=>void refresh(),Math.max(0,Math.min(2147483647,metadata.expiresAt-Date.now()+30)));return()=>clearTimeout(timer);},[metadata?.expiresAt,identity,scope?.revision,scope?.active]);
  const mutate=async(remove=false)=>{
    if(!scope||scope.active===false||busy||!metadata)return;
    const token=remove?'':field.current?.value??'';
    if(!remove&&(!token.trim()||new TextEncoder().encode(token).length>8192)){setError('Enter a token no larger than 8 KiB.');return;}
    // Password bytes remain only in this invocation and its single dedicated
    // request. No state store, journal, command or agent action sees the value.
    if(field.current)field.current.value='';setHasInput(false);setRevealed(false);setError('');setBusy(true);
    const generation=++sequence.current,owned=identity;
    const matches=()=>active.current===owned&&current.current?.active!==false&&current.current?.revision===scope.revision&&sequence.current===generation;
    try{const next=remove?await removeCredentialSlot(scope,declaration.slotKey,metadata.version):await saveCredentialSlot(scope,declaration.slotKey,token,metadata.version);if(matches())setMetadata(next);}
    catch(cause){
      if(!matches())return;
      try{const next=await getCredentialSlot(scope,declaration.slotKey);if(matches()){setMetadata(next);setError(cause instanceof ApiError&&['CREDENTIAL_CHANGED','STALE_REVISION'].includes(cause.code)?'This request changed. Its current status has been refreshed; try again.':`The acknowledgment was interrupted. ${next.present?'A token is currently saved for this host session; replace it if needed.':'No token is currently saved. Try again.'}`);}}
      catch{if(matches())setError('The change could not be confirmed. Reconnect and refresh its status before trying again.');}
    }finally{if(matches())setBusy(false);}
  };
  if(!scope)return <section className="credential-entry"><p role="status">Open this private credential request in its owning task.</p></section>;
  return <section className="credential-entry" aria-label={`${declaration.service} credential`}>
    <header className="credential-heading"><span className="credential-key"><KeyRound size={17}/></span><div><strong>{declaration.service}</strong>{declaration.purpose&&<p>{declaration.purpose}</p>}</div></header>
    <div className="credential-status" role="status">{busy?<><LoaderCircle size={12} className="spinning"/><span>Checking private token…</span></>:!metadata?<span>Status unavailable</span>:metadata.present?<><Check size={13}/><span>Saved for this host session</span></>:<><span className="credential-empty-dot"/><span>No token saved</span></>}</div>
    <label className="credential-label" htmlFor={id}>{declaration.label}</label>
    <div className="credential-input"><input ref={field} id={id} type={revealed?'text':'password'} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={8192} disabled={scope.active===false||busy||!metadata} placeholder={metadata?.present?'Enter a replacement token':'Paste your token'} onInput={event=>setHasInput(Boolean(event.currentTarget.value))} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();event.stopPropagation();void mutate();}}}/><button type="button" className="icon-button" aria-label={revealed?'Hide token':'Show token'} disabled={scope.active===false||busy} onClick={()=>setRevealed(value=>!value)}>{revealed?<EyeOff size={14}/>:<Eye size={14}/>}</button></div>
    <div className="credential-actions"><button type="button" className="primary" disabled={busy||!metadata||!hasInput} onClick={()=>void mutate()}>{metadata?.present?'Replace token':'Save token'}</button>{metadata?.present&&<button type="button" className="quiet" disabled={busy} onClick={()=>void mutate(true)}><Trash2 size={12}/>Remove token</button>}{!metadata&&!busy&&<button type="button" className="quiet" onClick={()=>void refresh()}>Refresh status</button>}</div>
    {error&&<p className="credential-error error-text" role="alert">{error}</p>}
    <p className="credential-lifetime">Cleared after one hour or when this host restarts. No external connection is made.</p>
  </section>;
}
