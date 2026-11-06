import {useEffect,useRef,useState} from 'react';
import {z} from 'zod';
import {authenticated,csrfToken,read} from './api.ts';
import './github-sign-in.css';

const deviceUrl='https://github.com/login/device';
const flowSchema=z.object({id:z.string().uuid(),userCode:z.string().min(1).max(40),url:z.literal(deviceUrl),expiresAt:z.number().finite(),interval:z.number().int().min(1000).max(60000)});
const cancelSchema=z.discriminatedUnion('status',[z.object({status:z.literal('cancelled')}),z.object({status:z.literal('authenticated'),login:z.string().regex(/^[A-Za-z0-9-]{1,100}$/)})]);
type Flow=z.infer<typeof flowSchema>;
const errorMessage=(error:unknown)=>error instanceof z.ZodError?'GitHub returned an invalid sign-in response. Start a new sign-in.':error instanceof Error?error.message:'GitHub sign-in failed. Try again.';
const auth=<T,>(action:string,payload:unknown={})=>authenticated(()=>fetch('/api/github/auth/'+action,{method:'POST',credentials:'same-origin',cache:'no-store',keepalive:action==='cancel',headers:{'Content-Type':'application/json','x-harness-csrf':csrfToken},body:JSON.stringify(payload)})).then(read<T>);

/** Device codes are transient. Profile credentials stay exclusively on the host. */
export function GitHubSignIn({active=true,onAuthenticated}:{active?:boolean;onAuthenticated?:()=>void|Promise<void>}){
 const[flow,setFlow]=useState<Flow|null>(null),[starting,setStarting]=useState(false),[cancelling,setCancelling]=useState(false),[cancelId,setCancelId]=useState<string|null>(null),[status,setStatus]=useState(''),[error,setError]=useState(''),[copied,setCopied]=useState(false);
 const epoch=useRef(0),owned=useRef<string|null>(null),mounted=useRef(false),pendingStart=useRef<number|null>(null),onSuccess=useRef(onAuthenticated);onSuccess.current=onAuthenticated;
 const current=(generation:number)=>mounted.current&&epoch.current===generation;
 const cancel=async(id:string,label:string,generation:number)=>{
  if(current(generation)){setCancelling(true);setError('');}
  try{
   const result=cancelSchema.parse(await auth('cancel',{flowId:id}));
   if(current(generation)){
    owned.current=null;setCancelId(null);setStatus(result.status==='authenticated'?'Sign-in completed as '+result.login+' before cancellation.':label);
    if(result.status==='authenticated')void Promise.resolve().then(()=>onSuccess.current?.()).catch(reason=>{if(current(generation))setError(errorMessage(reason));});
   }return true;
  }
  catch(reason){if(current(generation)){owned.current=id;setCancelId(id);setError(errorMessage(reason));setStatus('Sign-in stopped locally. Retry cancellation.');}return false;}
  finally{if(current(generation))setCancelling(false);}
 };
 useEffect(()=>{
  mounted.current=active;setFlow(null);setStarting(false);setCancelling(false);setCopied(false);pendingStart.current=null;
  if(!active)return;
  setCancelId(owned.current);setStatus(owned.current?'Cancellation not confirmed.':'');if(!owned.current)setError('');
  return()=>{
   mounted.current=false;epoch.current++;const id=owned.current;
   if(id)void auth('cancel',{flowId:id}).then(value=>{
    const result=cancelSchema.parse(value);if(owned.current!==id)return;owned.current=null;
    if(mounted.current){setCancelId(null);setCancelling(false);setError('');setStatus(result.status==='authenticated'?'Sign-in completed as '+result.login+' before cancellation.':'Sign-in cancelled');
     if(result.status==='authenticated')void Promise.resolve().then(()=>onSuccess.current?.()).catch(reason=>{if(mounted.current)setError(errorMessage(reason));});}
   }).catch(reason=>{if(owned.current===id&&mounted.current){setCancelId(id);setCancelling(false);setError(errorMessage(reason));setStatus('Cancellation not confirmed.');}});
  };
 },[active]);
 const stop=(label='Sign-in cancelled')=>{
  const generation=++epoch.current,id=owned.current;pendingStart.current=null;setStarting(false);setFlow(null);setCopied(false);
  if(id)void cancel(id,label,generation);else setStatus(label);
 };
 const start=async()=>{
  const generation=++epoch.current;pendingStart.current=generation;setStarting(true);setFlow(null);setError('');setStatus('Starting GitHub sign-in…');setCopied(false);
  try{
   const previous=owned.current;
   if(previous){if(!await cancel(previous,'',generation)||!current(generation))return;}
   const next=flowSchema.parse(await auth('start'));
   if(!current(generation)){
    const stoppedAt=epoch.current;
    try{await auth('cancel',{flowId:next.id});}catch(reason){if(mounted.current&&epoch.current===stoppedAt&&pendingStart.current===null&&!owned.current){owned.current=next.id;setCancelId(next.id);setError(errorMessage(reason));setStatus('Retry cancellation.');}}
    return;
   }
   owned.current=next.id;setCancelId(null);setFlow(next);setStatus('Waiting for GitHub authorization…');
  }catch(reason){if(current(generation)){setError(errorMessage(reason));setStatus('');}}
  finally{if(pendingStart.current===generation)pendingStart.current=null;if(current(generation))setStarting(false);}
 };
 useEffect(()=>{
  if(!active||!flow)return;const generation=epoch.current;let timer:ReturnType<typeof setTimeout>|undefined,stopped=false;
  const deadline=setTimeout(()=>{if(!stopped&&current(generation))stop('Sign-in expired. Start a new sign-in.');},Math.max(0,flow.expiresAt-Date.now()));
  const poll=async()=>{
   if(stopped||!current(generation))return;
   if(Date.now()>=flow.expiresAt){stop('Sign-in expired. Start a new sign-in.');return;}
   try{
    const result=z.discriminatedUnion('status',[z.object({status:z.literal('pending')}),z.object({status:z.literal('authenticated'),login:z.string().regex(/^[A-Za-z0-9-]{1,100}$/)})]).parse(await auth('poll',{flowId:flow.id}));
    if(stopped||!current(generation))return;
    if(result.status==='authenticated'){if(Date.now()>=flow.expiresAt){stop('Sign-in expired. Start a new sign-in.');return;}epoch.current++;owned.current=null;setFlow(null);setStatus('Signed in as '+result.login);await onSuccess.current?.();}
    else schedule();
   }catch(reason){if(!stopped&&current(generation)){setError(errorMessage(reason));setStatus('Sign-in could not be confirmed. Start a new sign-in or cancel.');}}
  };
  const schedule=()=>{timer=setTimeout(()=>void poll(),Math.max(0,Math.min(flow.interval,flow.expiresAt-Date.now())));};schedule();
  return()=>{stopped=true;clearTimeout(timer);clearTimeout(deadline);};
 },[flow,active]);
 const copy=async()=>{if(!flow)return;const generation=epoch.current;try{await navigator.clipboard.writeText(flow.userCode);if(current(generation))setCopied(true);}catch{if(current(generation))setError('Copy failed. Select and copy the code below.');}};
 return <section className="github-sign-in" aria-label="GitHub sign-in">
  <div className="github-sign-in-actions"><button disabled={!active||starting||cancelling||!!cancelId} onClick={()=>void start()}>{flow?'Start new sign-in':'Sign in to GitHub'}</button>{(flow||starting)&&<button onClick={()=>stop()}>Cancel sign-in</button>}{cancelId&&<button disabled={cancelling} onClick={()=>void cancel(cancelId,'Sign-in cancelled',epoch.current)}>Retry cancellation</button>}</div>
  {status&&<p role="status">{copied?'Copied code. ':''}{cancelling?'Cancelling sign-in…':status}</p>}
  {error&&<p className="error-text" role="alert">{error}</p>}
  {flow&&<><p>Enter this code on GitHub to sign in to this Gen V1 profile.</p><div className="github-device-code"><code>{flow.userCode}</code><button onClick={()=>void copy()}>Copy code</button></div>
   {/* The native policy requires this exact initiating app URL; its fixed opener sends no referrer. */}
   <a href={deviceUrl} target="_blank" rel="noopener" referrerPolicy="unsafe-url">{deviceUrl}</a><p className="github-sign-in-expiry">Expires at {new Date(flow.expiresAt).toLocaleTimeString()}.</p></>}
 </section>;
}
