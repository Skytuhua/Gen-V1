import {useCallback,useEffect,useRef,useState} from 'react';
import {authenticated,csrfToken,read} from './api.ts';
import type {ProjectContext} from '../../../packages/contracts/workspace.ts';

export function useProjectContext(projectId?:string,threadId?:string){
 const owner=projectId?JSON.stringify([projectId,threadId]):'';
 const [state,setState]=useState<{owner:string;context:ProjectContext|null;loading:boolean;error:string}>({owner:'',context:null,loading:false,error:''}),generation=useRef(0);
 const pending=useRef<AbortController|null>(null);
 const activeLoad=useRef<(()=>Promise<void>)|null>(null);
 const load=useCallback(async()=>{
  const captured=++generation.current;pending.current?.abort();pending.current=null;if(!projectId){setState({owner,context:null,loading:false,error:''});return;}
  const controller=new AbortController();pending.current=controller;
  setState(previous=>({owner,context:previous.owner===owner?previous.context:null,loading:true,error:''}));
  try{const next=await authenticated(()=>fetch(`/api/projects/${encodeURIComponent(projectId)}/context${threadId?'?threadId='+encodeURIComponent(threadId):''}`,{credentials:'same-origin',cache:'no-store',signal:controller.signal})).then(read<ProjectContext>);if(captured===generation.current)setState({owner,context:next,loading:false,error:''});}
  catch(reason){if(captured===generation.current&&!controller.signal.aborted)setState({owner,context:null,loading:false,error:reason instanceof Error?reason.message:'Project context could not be loaded.'});}
  finally{if(pending.current===controller)pending.current=null;}
 },[projectId,threadId,owner]);
 activeLoad.current=load;
 useEffect(()=>{activeLoad.current=load;void load();return()=>{activeLoad.current=null;generation.current++;pending.current?.abort();pending.current=null;};},[load]);
 const action=useCallback(async(type:string,payload:Record<string,unknown>={})=>{
  if(!projectId)return;
  await authenticated(()=>fetch(`/api/projects/${encodeURIComponent(projectId)}/actions`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','x-harness-csrf':csrfToken},body:JSON.stringify({id:crypto.randomUUID(),type,payload,...(threadId?{threadId}:{})})})).then(read);
  if(activeLoad.current===load)await load();
 },[projectId,threadId,load]);
 const current=state.owner===owner?state:{context:null,loading:Boolean(projectId),error:''};
 return{context:current.context,loading:current.loading,error:current.error,action};
}
