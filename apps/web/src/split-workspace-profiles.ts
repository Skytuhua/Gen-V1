import {useCallback,useEffect,useRef,useState} from 'react';
import {z} from 'zod';
import {splitWorkspaceIdSchema} from '../../../packages/contracts/split-workspace.ts';
import {authenticated,read} from './api';

const profilesSchema=z.array(z.strictObject({id:splitWorkspaceIdSchema,name:z.string().min(1).max(100),updatedAt:z.string().datetime()})).max(50);
export type SplitWorkspaceProfileSummary=z.infer<typeof profilesSchema>[number];
export const getSplitWorkspaceProfiles=(workspaceId='workspace')=>authenticated(()=>fetch('/api/split-workspace/profiles?'+new URLSearchParams({workspaceId}),{credentials:'same-origin',cache:'no-store'})).then(read<unknown>).then(value=>profilesSchema.parse(value));

/** Lists only saved-layout metadata; apply/save use the revision-checked split command path. */
export function useSplitWorkspaceProfiles(enabled=true,workspaceId='workspace'){
 const[profiles,setProfiles]=useState<SplitWorkspaceProfileSummary[]>([]),[error,setError]=useState('');
 const generation=useRef(0),alive=useRef(false);
 const refresh=useCallback(async()=>{const expected=generation.current,value=await getSplitWorkspaceProfiles(workspaceId);if(alive.current&&expected===generation.current){setProfiles(value);setError('');}return value;},[workspaceId]);
 useEffect(()=>{generation.current++;alive.current=enabled;setProfiles([]);setError('');if(!enabled)return;const update=()=>{void refresh().catch(cause=>{if(alive.current)setError(cause instanceof Error?cause.message:'Saved layouts could not load.');});};update();window.addEventListener('focus',update);window.addEventListener('harness:workspace-changed',update);return()=>{alive.current=false;generation.current++;window.removeEventListener('focus',update);window.removeEventListener('harness:workspace-changed',update);};},[enabled,refresh]);
 return{profiles,error,refresh};
}
