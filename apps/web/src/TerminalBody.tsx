import {useEffect,useRef,useState} from 'react';
import {ApiError,authenticated,csrfToken,read} from './api.ts';
import './terminal-read.css';

interface TerminalRead{id:string;projectId:string;threadId?:string;output:string;start:number;cursor:number;exited:boolean;exitCode:number|null}
type Phase='starting'|'running'|'read-interrupted'|'ended'|'unconfirmed';
const message=(error:unknown)=>error instanceof Error?error.message:'The project tool could not complete this request.';
const post=<T,>(url:string,body:unknown,isCurrent:()=>boolean)=>authenticated(()=>{
 if(!isCurrent())throw new ApiError('CAPABILITY_DENIED','The owning workspace changed.');
 return fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','x-harness-csrf':csrfToken},body:JSON.stringify(body)});
}).then(read<T>);

export function TerminalBody({projectId,threadId,terminalId,active,openAnother,isCurrent}:{projectId:string;threadId?:string;terminalId?:string;active:boolean;openAnother?:()=>void|Promise<void>;isCurrent?:()=>boolean}){
 const element=useRef<HTMLDivElement>(null);
 const [phase,setPhase]=useState<Phase>('starting'),[error,setError]=useState(''),[acknowledged,setAcknowledged]=useState(false),[retrying,setRetrying]=useState(false),[stopping,setStopping]=useState(false),[generation,setGeneration]=useState(0);
 const key=`gen-terminal:${projectId}:${threadId??'project'}:${terminalId??'default'}`;
 const latest=useRef({projectId,threadId,terminalId,active,generation,isCurrent});
 latest.current={projectId,threadId,terminalId,active,generation,isCurrent};
 const pendingId=useRef<{key:string;id:string}|null>(null);
 const actions=useRef<{current:()=>boolean;retry:()=>void;stop:()=>Promise<void>}|null>(null);

 useEffect(()=>{
  if(!active||!element.current)return;
  let disposed=false,confirmedId:string|undefined,cursor=0,ended=false,interrupted=false,reading=false,stopPending=false,readSequence=0;
  let timer:ReturnType<typeof setTimeout>|undefined,observer:ResizeObserver|undefined,instance:import('@xterm/xterm').Terminal|undefined;
  const controller=new AbortController();
  const ownerCurrent=()=>!disposed&&latest.current.active&&latest.current.projectId===projectId&&latest.current.threadId===threadId&&latest.current.terminalId===terminalId&&latest.current.generation===generation&&latest.current.isCurrent===isCurrent&&(!isCurrent||isCurrent());
  const matches=(value:TerminalRead,id:string)=>{
   if(value.id!==id||value.projectId!==projectId||value.threadId!==threadId)throw new Error('The terminal response does not match the owning session.');
  };
  const fail=(error:unknown)=>{if(ownerCurrent())setError(message(error));};
  const command=(body:Record<string,unknown>)=>post<TerminalRead>(`/api/terminals/${encodeURIComponent(confirmedId!)}/commands`,{projectId,...(threadId?{threadId}:{}),...body},()=>ownerCurrent()&&!!confirmedId);
  const append=(value:TerminalRead)=>{
   if(value.start>cursor)instance!.writeln('\r\n[Earlier output expired from the bounded host buffer]\r\n');
   // Stop returns the whole host buffer; only append output beyond our cursor.
   instance!.write(value.output.slice(Math.max(0,cursor-value.start)));
   cursor=value.cursor;ended=value.exited;setPhase(ended?'ended':'running');
  };
  const poll=async()=>{
   if(!ownerCurrent()||!confirmedId||ended||reading||stopPending)return;
   reading=true;const sequence=++readSequence;
   try{
    const params=new URLSearchParams({projectId,cursor:String(cursor),...(threadId?{threadId}:{})});
    const next=await authenticated(()=>{
     if(!ownerCurrent()||sequence!==readSequence)throw new ApiError('CAPABILITY_DENIED','The owning workspace changed.');
     return fetch(`/api/terminals/${encodeURIComponent(confirmedId!)}?`+params,{credentials:'same-origin',cache:'no-store',signal:controller.signal});
    }).then(read<TerminalRead>);
    if(!ownerCurrent()||sequence!==readSequence)return;
    matches(next,confirmedId);append(next);interrupted=false;setError('');
    if(!ended)timer=setTimeout(()=>void poll(),500);
   }catch(error){
    if(!ownerCurrent()||sequence!==readSequence)return;
    ended=error instanceof ApiError&&error.code==='TERMINAL_ENDED';interrupted=!ended;
    setPhase(ended?'ended':'read-interrupted');setError(message(error));
   }finally{
    reading=false;if(ownerCurrent()&&sequence===readSequence)setRetrying(false);
   }
  };
  const ownedActions={current:ownerCurrent,retry:()=>{
   if(!ownerCurrent()||!interrupted||reading||stopPending||ended)return;
   setRetrying(true);void poll();
  },stop:async()=>{
   if(!ownerCurrent()||!confirmedId||ended||stopPending)return;
   stopPending=true;setStopping(true);
   try{
    const next=await command({type:'stop'});
    if(!ownerCurrent())return;
    matches(next,confirmedId);
    if(!next.exited)throw new Error('Terminal termination was not confirmed.');
    readSequence++;clearTimeout(timer);controller.abort();append(next);interrupted=false;setRetrying(false);setError('');
   }catch(error){fail(error);if(ownerCurrent()&&!ended&&!interrupted&&!reading)timer=setTimeout(()=>void poll(),500);}
   finally{stopPending=false;if(ownerCurrent())setStopping(false);}
  }};
  actions.current=ownedActions;
  setPhase('starting');setError('');setAcknowledged(false);setRetrying(false);setStopping(false);
  void(async()=>{
   const [{Terminal},{FitAddon}]=await Promise.all([import('@xterm/xterm'),import('@xterm/addon-fit'),import('@xterm/xterm/css/xterm.css')]);
   if(!ownerCurrent())return;
   instance=new Terminal({convertEol:false,fontSize:13,scrollback:2000,theme:{background:'#101010',foreground:'#dedede'}});
   const fit=new FitAddon();instance.loadAddon(fit);instance.open(element.current!);fit.fit();
   let saved:string|null=null,pending:string|null=null;try{saved=localStorage.getItem(key);pending=localStorage.getItem(key+':pending');}catch{}
   const requestedId=terminalId??saved??pending??(pendingId.current?.key===key?pendingId.current.id:crypto.randomUUID());
   pendingId.current={key,id:requestedId};
   // The host deduplicates caller IDs; retain an unconfirmed attempt on remount.
   if(!terminalId&&!saved)try{localStorage.setItem(key+':pending',requestedId);}catch{throw new Error('Could not retain the terminal start ID. Open a terminal from the workspace.');}
   const first=await post<TerminalRead>('/api/terminals',{projectId,...(threadId?{threadId}:{}),terminalId:requestedId,cols:instance.cols,rows:instance.rows},ownerCurrent);
   if(!ownerCurrent())return;
   matches(first,requestedId);confirmedId=first.id;setAcknowledged(true);
   try{localStorage.setItem(key,first.id);localStorage.removeItem(key+':pending');}catch{}
   append(first);
   instance.onData(data=>{if(ownerCurrent()&&!ended&&!stopPending)void command({type:'input',data}).catch(fail);});
   observer=new ResizeObserver(()=>{
    if(!ownerCurrent()||!instance||ended||stopPending)return;
    fit.fit();void command({type:'resize',cols:instance.cols,rows:instance.rows}).catch(fail);
   });
   observer.observe(element.current!);
   if(!ended)timer=setTimeout(()=>void poll(),250);
  })().catch(error=>{if(ownerCurrent()){setPhase(error instanceof ApiError&&error.code==='TERMINAL_ENDED'?'ended':'unconfirmed');setError(message(error));}});
  return()=>{disposed=true;readSequence++;clearTimeout(timer);controller.abort();observer?.disconnect();instance?.dispose();if(actions.current===ownedActions)actions.current=null;};
 },[projectId,threadId,terminalId,active,generation,key,isCurrent]);

 const restart=async()=>{
  const owner=actions.current;if(!owner?.current())return;
  if(terminalId){if(openAnother)try{await openAnother();}catch(error){if(owner.current())setError(message(error));}return;}
  pendingId.current=null;try{localStorage.removeItem(key);localStorage.removeItem(key+':pending');}catch{}
  setGeneration(value=>value+1);
 };
 const canStop=active&&acknowledged&&phase!=='ended'&&!stopping&&!!actions.current?.current();
 const label=stopping?'Stopping':({starting:'Starting',running:'Running','read-interrupted':'Read interrupted',ended:'Ended',unconfirmed:'Start unconfirmed'} as const)[phase];
 return <div className="live-terminal terminal-read"><div className="panel-toolbar"><strong>Terminal</strong><span role="status">{label}</span><button disabled={!canStop} onClick={()=>void actions.current?.stop()}>Stop</button>{phase==='read-interrupted'&&<button disabled={!active||retrying||stopping||!actions.current?.current()} aria-busy={retrying} onClick={()=>actions.current?.retry()}>Retry</button>}{(phase==='ended'||(error&&acknowledged))&&(!terminalId||openAnother?<button disabled={!active||stopping||!actions.current?.current()} onClick={()=>void restart()}>New terminal</button>:<span>Open a new terminal from the workspace.</span>)}</div>{error&&<p className="error-text" role="alert">{error}</p>}<div className="xterm-host" ref={element}/></div>;
}
