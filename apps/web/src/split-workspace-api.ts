import {useCallback,useEffect,useRef,useState} from 'react';
import type {CommandReceipt} from '../../../packages/contracts/index.ts';
import {splitWorkspaceLayoutSchema,splitProfileSaveResultSchema,type SplitWorkspaceLayout} from '../../../packages/contracts/split-workspace.ts';
import {ApiError,authenticated,csrfToken,read} from './api';

export const getSplitWorkspace=(workspaceId='workspace')=>authenticated(()=>fetch('/api/split-workspace?'+new URLSearchParams({workspaceId}),{credentials:'same-origin',cache:'no-store'})).then(read<unknown>).then(value=>splitWorkspaceLayoutSchema.parse(value));

/** Explicit captured host command for callers outside the active layout hook. */
export async function sendSplitWorkspaceCommand(type:string,payload:Record<string,unknown>){
 const command={id:crypto.randomUUID(),type:type.startsWith('split-workspace.')?type:'split-workspace.'+type,payload};
 const receipt=await authenticated(()=>fetch('/api/split-workspace/commands',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','x-harness-csrf':csrfToken},body:JSON.stringify(command)})).then(read<CommandReceipt>);
 return splitWorkspaceLayoutSchema.parse(receipt.result);
}

/** Semantic operations keep their captured revision and are never silently retargeted. */
export function useSplitWorkspaceState(enabled=true,workspaceId='workspace'){
 const[layout,setLayout]=useState<SplitWorkspaceLayout|null>(null),[error,setError]=useState('');
 const current=useRef<SplitWorkspaceLayout|null>(null),alive=useRef(true),generation=useRef(0),queue=useRef<Promise<unknown>>(Promise.resolve()),owner=useRef(workspaceId);owner.current=workspaceId;
 const accept=useCallback((value:SplitWorkspaceLayout)=>{if(alive.current&&owner.current===workspaceId&&value.id===workspaceId&&(!current.current||value.revision>=current.current.revision)){current.current=value;setLayout(value);setError('');}},[workspaceId]);
 const refresh=useCallback(async()=>{const expected=generation.current,value=await getSplitWorkspace(workspaceId);if(expected===generation.current)accept(value);return value;},[workspaceId,accept]);
 useEffect(()=>{alive.current=true;generation.current++;current.current=null;setLayout(null);if(!enabled)return;void refresh().catch(cause=>{if(alive.current)setError(cause instanceof Error?cause.message:'The split workspace could not load.');});const change=()=>{void refresh().catch(()=>{});};window.addEventListener('focus',change);window.addEventListener('harness:workspace-changed',change);return()=>{alive.current=false;generation.current++;window.removeEventListener('focus',change);window.removeEventListener('harness:workspace-changed',change);};},[enabled,refresh]);
 const sendResult=useCallback((type:string,payload:Record<string,unknown>={}):Promise<{layout:SplitWorkspaceLayout;profile?:{id:string;updatedAt:string}}>=>{
  const basis=current.current,expected=generation.current;if(!basis||basis.id!==workspaceId||owner.current!==workspaceId)return Promise.reject(Error('Wait for the workspace to load.'));
  const command={id:crypto.randomUUID(),type:type.startsWith('split-workspace.')?type:'split-workspace.'+type,payload:{...payload,workspaceId,baseRevision:payload.baseRevision??basis.revision}};
  const action=queue.current.catch(()=>{}).then(async()=>{
   try{const body=JSON.stringify(command),response=await authenticated(()=>{if(!alive.current||owner.current!==workspaceId||expected!==generation.current)throw Error('The workspace changed. Reopen its layout.');return fetch('/api/split-workspace/commands',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','x-harness-csrf':csrfToken},body});}),receipt=await read<CommandReceipt>(response),saved=splitProfileSaveResultSchema.safeParse(receipt.result),value=saved.success?saved.data.layout:splitWorkspaceLayoutSchema.parse(receipt.result);if(expected===generation.current)accept(value);return{layout:value,...(saved.success?{profile:saved.data.profile}:{})};}
   catch(cause){if(cause instanceof ApiError&&cause.code==='WORKSPACE_CHANGED'&&expected===generation.current)await refresh().catch(()=>{});if(alive.current&&expected===generation.current)setError(cause instanceof Error?cause.message:'The layout could not be saved.');throw cause;}
  });queue.current=action;return action;
 },[workspaceId,accept,refresh]);
 const send=useCallback((type:string,payload:Record<string,unknown>={})=>sendResult(type,payload).then(result=>result.layout),[sendResult]);
 const saveProfile=useCallback(async(name:string,profileId?:string)=>{
  const result=await sendResult('profile.save',{name,...(profileId?{profileId}:{}),resultVersion:2});
  if(!result.profile)throw Error('The host did not report the saved layout identity. Refresh layouts.');
  return{...result.profile,layout:result.layout};
 },[sendResult]);
 return{layout,error,refresh,send,saveProfile};
}
