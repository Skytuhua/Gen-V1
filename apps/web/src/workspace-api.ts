import {useCallback,useEffect,useRef,useState} from 'react';
import type {CommandReceipt} from '../../../packages/contracts/index.ts';
import type {WorkspaceEnvelope} from '../../../packages/contracts/workspace.ts';
import {ApiError,authenticated,csrfToken,read} from './api';

export const getWorkspace=()=>authenticated(()=>fetch('/api/workspace',{credentials:'same-origin',cache:'no-store'})).then(read<WorkspaceEnvelope>);
const layoutContent=(value:WorkspaceEnvelope)=>JSON.stringify([value.projects,{...value.state,revision:0,nativeLayout:undefined}]);
export function useWorkspaceState(enabled=true,{listenNative=true}:{listenNative?:boolean}={}){
 const [envelope,setEnvelope]=useState<WorkspaceEnvelope|null>(null),[error,setError]=useState('');const current=useRef(envelope),queue=useRef<Promise<unknown>>(Promise.resolve()),alive=useRef(true);current.current=envelope;
 const accept=useCallback((value:WorkspaceEnvelope)=>{if(alive.current&&(!current.current||value.state.revision>=current.current.state.revision)){current.current=value;setEnvelope(value);setError('');}},[]);
 const refresh=useCallback(async()=>{const value=await getWorkspace();accept(value);return value;},[accept]);
 useEffect(()=>{alive.current=true;if(!enabled)return;void refresh().catch(cause=>{if(alive.current)setError(cause instanceof Error?cause.message:'Workspace layouts could not load.');});let timer:ReturnType<typeof setTimeout>|undefined;const changed=()=>{clearTimeout(timer);timer=setTimeout(()=>void refresh().catch(()=>{}),250);};window.addEventListener('harness:workspace-changed',changed);window.addEventListener('focus',changed);const remove=listenNative?window.harnessDesktop?.onWorkspaceChanged?.(changed):undefined;return()=>{alive.current=false;clearTimeout(timer);window.removeEventListener('harness:workspace-changed',changed);window.removeEventListener('focus',changed);remove?.();};},[enabled,listenNative,refresh]);
 const send=useCallback((type:string,payload:Record<string,unknown>={},isCurrent?:()=>boolean):Promise<WorkspaceEnvelope>=>{
  const action=queue.current.catch(()=>{}).then(async()=>{
   const check=()=>{if(isCurrent&&!isCurrent())throw Error('The workspace owner changed. Retry from the current view.');};check();
   let basis=current.current;
   for(let attempt=0;;attempt++){
    const body=JSON.stringify({id:crypto.randomUUID(),type,payload:{...payload,...(payload.baseRevision===undefined&&basis?{baseRevision:basis.state.revision}:{})}});
    try{
     const response=await authenticated(()=>{check();return fetch('/api/workspace/commands',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','x-harness-csrf':csrfToken},body});});
     const receipt=await read<CommandReceipt>(response),value=receipt.result as WorkspaceEnvelope;
     if(!value?.state||!Array.isArray(value.projects))throw Error('The host did not return a workspace layout. Refresh and retry.');
     accept(value);return value;
    }catch(cause){
     if(!(cause instanceof ApiError)||cause.code!=='WORKSPACE_CHANGED'||(!type.startsWith('workspace.panel.')&&!type.startsWith('workspace.canvas.'))||payload.baseRevision!==undefined||!basis||attempt>=2)throw cause;
     check();const latest=await refresh();check();
     // Native geometry shares the revision; preferences, references and profiles must still conflict.
     if(layoutContent(basis)!==layoutContent(latest))throw cause;
     basis=latest;
    }
   }
  });queue.current=action;return action;
 },[accept,refresh]);
 return {envelope,error,refresh,send};
}
