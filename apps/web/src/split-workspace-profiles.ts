import {useCallback,useEffect,useRef,useState} from 'react';
import {z} from 'zod';
import {splitWorkspaceIdSchema} from '../../../packages/contracts/split-workspace.ts';
import {authenticated,read} from './api';
import {createSplitLayoutProfileActions} from './layout-profile';

const profilesSchema=z.array(z.strictObject({id:splitWorkspaceIdSchema,name:z.string().min(1).max(100),updatedAt:z.string().datetime()})).max(50);
export type SplitWorkspaceProfileSummary=z.infer<typeof profilesSchema>[number];
export const getSplitWorkspaceProfiles=(workspaceId='workspace')=>authenticated(()=>fetch('/api/split-workspace/profiles?'+new URLSearchParams({workspaceId}),{credentials:'same-origin',cache:'no-store'})).then(read<unknown>).then(value=>profilesSchema.parse(value));

/** Lists only saved-layout metadata; apply/save use the revision-checked split command path. */
export function useSplitWorkspaceProfiles(enabled=true,workspaceId='workspace'){
 const[profiles,setProfiles]=useState<SplitWorkspaceProfileSummary[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(enabled);
 const generation=useRef(0),request=useRef(0),alive=useRef(false),owner=useRef(workspaceId);owner.current=workspaceId;
 const refresh=useCallback(async()=>{
  const expected=generation.current,readId=++request.current;
  const active=()=>alive.current&&owner.current===workspaceId&&expected===generation.current&&readId===request.current;
  if(alive.current&&owner.current===workspaceId)setLoading(true);
  try{const value=await getSplitWorkspaceProfiles(workspaceId);if(active()){setProfiles(value);setError('');}return value;}
  catch(cause){if(active())setError(cause instanceof Error?cause.message:'Saved layouts could not load.');throw cause;}
  finally{if(active())setLoading(false);}
 },[workspaceId]);
 useEffect(()=>{generation.current++;alive.current=enabled;setProfiles([]);setError('');setLoading(enabled);if(!enabled)return;const update=()=>{void refresh().catch(()=>{});};update();window.addEventListener('focus',update);window.addEventListener('harness:workspace-changed',update);return()=>{alive.current=false;generation.current++;window.removeEventListener('focus',update);window.removeEventListener('harness:workspace-changed',update);};},[enabled,refresh]);
 return{profiles,error,loading,refresh};
}

/** Stable operation state survives metadata rerenders, including a committed save awaiting its exact ID. */
export function useSplitLayoutProfileActions(port:Parameters<typeof createSplitLayoutProfileActions>[0],scopeKey='workspace'){
 const scopes=useRef(new Map<string,{port:{current:typeof port};actions:ReturnType<typeof createSplitLayoutProfileActions>}>());
 let scope=scopes.current.get(scopeKey);
 if(!scope){const latest={current:port};scope={port:latest,actions:createSplitLayoutProfileActions({prepare:()=>latest.current.prepare(),save:(name,id)=>latest.current.save(name,id),send:(type,payload)=>latest.current.send(type,payload),refresh:()=>latest.current.refresh()})};scopes.current.set(scopeKey,scope);}
 scope.port.current=port;
 return scope.actions;
}
