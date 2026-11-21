import {useEffect,useRef,useState} from 'react';
import {Globe} from 'lucide-react';
import {ApiError,getNetworkProxy,removeNetworkProxy,saveNetworkProxy} from './api';
import {settingsOperation} from './settings-operations';
import type {NetworkProxyPublicState} from '../../../packages/contracts/network-proxy';

/** #1531 T05 — profile-wide Network proxy card: load/save/remove via the authenticated routes. */
export function NetworkProxySettings(){
 const [state,setState]=useState<NetworkProxyPublicState|null>(null),[loading,setLoading]=useState(true);
 const [editing,setEditing]=useState(false),[url,setUrl]=useState(''),[bypass,setBypass]=useState(''),[credentials,setCredentials]=useState('');
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[problem,setProblem]=useState(''),[confirming,setConfirming]=useState(false);
 const urlField=useRef<HTMLInputElement>(null),mounted=useRef(true);
 useEffect(()=>()=>{mounted.current=false;},[]);
 const load=async()=>{const result=await getNetworkProxy();if(mounted.current)setState(result);return result;};
 useEffect(()=>{setLoading(true);load().catch(()=>{if(mounted.current)setProblem('The proxy settings could not be loaded. Check the connection and retry.');}).finally(()=>{if(mounted.current)setLoading(false);});},[]);
 const enter=()=>{setEditing(true);setUrl('');setCredentials('');setBypass((state?.bypass??[]).join(', '));setProblem('');setNotice('');requestAnimationFrame(()=>urlField.current?.focus());};
 const cancel=()=>{setEditing(false);setUrl('');setCredentials('');setBypass('');setProblem('');setConfirming(false);};
 const validation=()=>{
  if(!url.trim()&&!bypass.trim()&&!credentials)return 'Enter a proxy URL or cancel.';
  try{const target=new URL(url.trim());if(!['http:','https:'].includes(target.protocol))return 'Use an HTTP or HTTPS proxy URL.';if(target.username||target.password)return 'Enter credentials in the credentials field, not the URL.';}catch{return 'Enter a complete proxy URL, such as https://proxy.example:8443.';}
  if(bypass.split(',').some(entry=>entry.trim().length>200)||bypass.split(',').filter(entry=>entry.trim()).length>64)return 'Bypass entries are limited to 64 entries of 200 characters.';
  return '';
 };
 const save=async()=>{
  if(!state||busy)return;const failure=validation();if(failure){setProblem(failure);urlField.current?.focus();return;}
  setBusy(true);setProblem('');setNotice('');
  try{
   const endpoint=credentials?(()=>{const target=new URL(url.trim());target.username=encodeURIComponent(credentials.split(':')[0]);target.password=encodeURIComponent(credentials.slice(credentials.indexOf(':')+1));return target.href;})():(url.trim()||null);
   const result=await settingsOperation(()=>saveNetworkProxy({baseRevision:state.revision,url:endpoint,bypass:bypass.split(',').map(entry=>entry.trim()).filter(Boolean),...(credentials?{}:{clearCredentials:true})}));
   if(!mounted.current)return;setState(result);setEditing(false);setUrl('');setCredentials('');setBypass('');setNotice(result.url?'Proxy saved.':'Proxy cleared.');
  }catch(cause){
   if(!mounted.current)return;
   if(cause instanceof ApiError&&cause.code==='NETWORK_PROXY_CHANGED'){setCredentials('');await load().catch(()=>{});setProblem('The proxy settings changed elsewhere. Review the latest values, then retry your draft.');}
   else if(cause instanceof ApiError&&cause.code==='NETWORK_PROXY_UNAVAILABLE')setProblem('Protected storage is unavailable on this host, so the proxy could not be saved.');
   else setProblem(cause instanceof Error?cause.message:'The proxy settings could not be saved.');
  }finally{if(mounted.current)setBusy(false);}
 };
 const remove=async()=>{
  if(!state||busy)return;setBusy(true);setProblem('');setNotice('');
  try{const result=await settingsOperation(()=>removeNetworkProxy({baseRevision:state.revision}));if(!mounted.current)return;setState(result);setConfirming(false);cancel();setNotice('Proxy removed.');}
  catch(cause){if(!mounted.current)return;if(cause instanceof ApiError&&cause.code==='NETWORK_PROXY_CHANGED'){await load().catch(()=>{});}setProblem(cause instanceof Error?cause.message:'The proxy could not be removed.');}
  finally{if(mounted.current)setBusy(false);}
 };
 return <section className="settings-card network-proxy-card" aria-labelledby="network-proxy-heading">
  <h2 id="network-proxy-heading"><Globe size={16} aria-hidden="true"/> Network proxy</h2>
  <p className="settings-card-intro">One proxy for this profile's Browser, sign-in and provider traffic.</p>
  <p className="network-proxy-status" role="status">{notice||(loading?'Loading…':state?.url?'Configured':'Not configured')}</p>
  {problem&&<p className="error-text" role="alert">{problem}</p>}
  {state&&!loading&&<>
   {editing?<form autoComplete="off" onSubmit={event=>{event.preventDefault();void save();}}>
    <label className="field">Proxy URL<input ref={urlField} required type="password" autoComplete="off" spellCheck={false} maxLength={4096} value={url} disabled={busy} placeholder="https://proxy.example:8443" onChange={event=>setUrl(event.target.value)}/><small>Credentials are stored separately; keep them out of the URL.</small></label>
    <label className="field">Bypass list<input spellCheck={false} maxLength={4096} value={bypass} disabled={busy} placeholder=".example.org, build.example.net:443" onChange={event=>setBypass(event.target.value)}/><small>Hosts and suffixes that connect directly. The Browser only reaches public HTTP/HTTPS pages.</small></label>
    <label className="field">Credentials<input aria-label="Proxy credentials" type="password" autoComplete="new-password" spellCheck={false} maxLength={512} value={credentials} disabled={busy} placeholder="user:password (optional)" onChange={event=>setCredentials(event.target.value)}/><small>{state.secretStorageAvailable?'Stored in protected storage; sent only to the proxy hop.':'Protected storage is unavailable — credentials cannot be saved on this host.'}</small></label>
    <div className="settings-inline-controls"><button className="primary" disabled={busy||!!validation()}>{busy?'Saving…':'Save proxy'}</button><button type="button" className="secondary" disabled={busy} onClick={cancel}>Cancel</button></div>
   </form>:<>
    <div className="settings-card-row"><div><strong>{state.url??'No proxy configured'}</strong><p>{state.url?(state.hasCredentials?'Authenticated endpoint':'Endpoint')+(state.bypass.length?` · ${state.bypass.length} bypass ${state.bypass.length===1?'entry':'entries'}`:''):'Traffic connects directly.'}</p></div>
     <button type="button" className="secondary" disabled={busy} onClick={enter}>{state.url?'Change proxy URL':'Configure proxy'}</button></div>
    <p className="muted">Local connections always bypass the proxy{state.mandatoryBypass.length?` (${state.mandatoryBypass.join(', ')})`:''}.</p>
    {state.url&&(confirming?<div className="settings-inline-controls"><button className="secondary" disabled={busy} onClick={()=>void remove()}>Confirm removal</button><button type="button" className="secondary" disabled={busy} onClick={()=>setConfirming(false)}>Keep proxy</button></div>:<button type="button" className="secondary" disabled={busy} onClick={()=>setConfirming(true)}>Remove proxy</button>)}
   </>}
  </>}
 </section>;
}
