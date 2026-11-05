import {useCallback,useEffect,useRef,useState} from 'react';
import {authenticated,csrfToken,read} from './api.ts';
import type {ProjectContext} from '../../../packages/contracts/workspace.ts';

export function useProjectContext(projectId?:string,threadId?:string){
 const [context,setContext]=useState<ProjectContext|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),generation=useRef(0);
 const pending=useRef<AbortController|null>(null);
 const activeLoad=useRef<(()=>Promise<void>)|null>(null);
 const load=useCallback(async()=>{
  const captured=++generation.current;pending.current?.abort();pending.current=null;if(!projectId){setContext(null);setLoading(false);return;}
  const controller=new AbortController();pending.current=controller;
  setLoading(true);setError('');
  try{const next=await authenticated(()=>fetch(`/api/projects/${encodeURIComponent(projectId)}/context${threadId?'?threadId='+encodeURIComponent(threadId):''}`,{credentials:'same-origin',cache:'no-store',signal:controller.signal})).then(read<ProjectContext>);if(captured===generation.current)setContext(next);}
  catch(reason){if(captured===generation.current&&!controller.signal.aborted){setContext(null);setError(reason instanceof Error?reason.message:'Project context could not be loaded.');}}
  finally{if(pending.current===controller)pending.current=null;if(captured===generation.current)setLoading(false);}
 },[projectId,threadId]);
 activeLoad.current=load;
 useEffect(()=>{activeLoad.current=load;void load();return()=>{activeLoad.current=null;generation.current++;pending.current?.abort();pending.current=null;};},[load]);
 const action=useCallback(async(type:string,payload:Record<string,unknown>={})=>{
  if(!projectId)return;
  await authenticated(()=>fetch(`/api/projects/${encodeURIComponent(projectId)}/actions`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','x-harness-csrf':csrfToken},body:JSON.stringify({id:crypto.randomUUID(),type,payload,...(threadId?{threadId}:{})})})).then(read);
  if(activeLoad.current===load)await load();
 },[projectId,threadId,load]);
 return{context,loading,error,action};
}
