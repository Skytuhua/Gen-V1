import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {HarnessError,type HostCommand,type Thread} from '../contracts/index.ts';
import {SPLIT_WORKSPACE_LIMITS,splitWorkspaceIdSchema,splitWorkspaceLayoutSchema,type SplitWorkspaceLayout} from '../contracts/split-workspace.ts';
import {panelBindingSchema,surfaceRefSchema,type SurfaceRef} from '../contracts/workspace.ts';
import {Store,digest} from '../storage/store.ts';
import {applySplitWorkspaceCommand,createSplitWorkspaceLayout} from './split-workspace-layout.ts';

interface History {undo:SplitWorkspaceLayout[];redo:SplitWorkspaceLayout[];lastWorking?:SplitWorkspaceLayout}
const historySchema=z.strictObject({undo:z.array(splitWorkspaceLayoutSchema).max(SPLIT_WORKSPACE_LIMITS.history),redo:z.array(splitWorkspaceLayoutSchema).max(SPLIT_WORKSPACE_LIMITS.history),lastWorking:splitWorkspaceLayoutSchema.optional()});
const profileNameSchema=z.string().trim().min(1).max(100).refine(value=>!/[\u0000-\u001f\u007f]/.test(value),'Use a single readable layout name.');
const profileSchema=z.strictObject({version:z.literal(1),id:splitWorkspaceIdSchema,workspaceId:splitWorkspaceIdSchema,name:profileNameSchema,createdAt:z.string().datetime(),updatedAt:z.string().datetime(),layout:splitWorkspaceLayoutSchema}).refine(profile=>profile.layout.id===profile.workspaceId,'The saved layout must belong to its workspace.');
export interface SplitWorkspaceProfileSummary {id:string;name:string;updatedAt:string}
/** Personal layout repository. Plug-in surfaces use their own verified host and journal. */
export class SplitWorkspaceRepository {
 constructor(readonly store:Store){}
 read(workspaceId='workspace'):SplitWorkspaceLayout{
  const id=splitWorkspaceIdSchema.parse(workspaceId),state=splitWorkspaceLayoutSchema.parse(this.store.get('splitWorkspaceLayout',id)??createSplitWorkspaceLayout(id)),history=this.history(id);
  return{...state,undoDepth:history.undo.length,redoDepth:history.redo.length};
 }
 readProfiles(workspaceId='workspace'):SplitWorkspaceProfileSummary[]{
  const id=splitWorkspaceIdSchema.parse(workspaceId);
  return this.store.all<unknown>('splitWorkspaceProfile').filter((value):value is {workspaceId:string}=>Boolean(value&&typeof value==='object'&&(value as {workspaceId?:unknown}).workspaceId===id)).map(value=>profileSchema.parse(value)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id)).map(({id,name,updatedAt})=>({id,name,updatedAt}));
 }
 private profile(profileId:unknown,workspaceId:string){
  const id=splitWorkspaceIdSchema.parse(profileId),raw=this.store.get<{workspaceId?:unknown}>('splitWorkspaceProfile',id);
  if(!raw||raw.workspaceId!==workspaceId)throw new HarnessError('NOT_FOUND','The saved layout is no longer available in this workspace.');
  return profileSchema.parse(raw);
 }
 private history(id:string):History{return historySchema.parse(this.store.get('splitWorkspaceHistory',id)??{undo:[],redo:[]});}
 private authorize(view:SurfaceRef){
  if(view.binding.authority.kind!=='local')throw new HarnessError('FORBIDDEN','Plug-in layout authority belongs to its verified private host.');
  if(view.binding.liveProject)throw new HarnessError('FORBIDDEN','Split views require an explicit frozen owner binding.');
  if(view.binding.threadId){const thread=this.store.get<Thread>('thread',view.binding.threadId);if(!thread)throw new HarnessError('NOT_FOUND','The owning conversation is unavailable.');if(view.binding.projectId!==undefined&&thread.projectId!==view.binding.projectId)throw new HarnessError('WORKSPACE_CHANGED','The conversation project binding changed.');}
  if(view.kind==='artifact'){const artifact=this.store.get<{threadId:string}>('artifact',view.binding.artifactId!);if(!artifact||artifact.threadId!==view.binding.threadId)throw new HarnessError('FORBIDDEN','The artifact does not belong to the bound conversation.');}
 }
 command(command:HostCommand){
  if(!command.type.startsWith('split-workspace.'))throw new HarnessError('INVALID_INPUT','Choose a split workspace operation.');
  return this.store.command(command,()=>{
   const workspaceId=splitWorkspaceIdSchema.parse(command.payload.workspaceId),revision=z.number().int().nonnegative().parse(command.payload.baseRevision),state=this.read(workspaceId),history=this.history(workspaceId),type=command.type.slice('split-workspace.'.length);
   if(revision!==state.revision)throw new HarnessError('WORKSPACE_CHANGED','The layout revision changed. Refresh before applying this operation.');
   const added=command.payload.view===undefined?[]:[surfaceRefSchema.parse(command.payload.view)];if(type==='layout.seed')added.push(...z.array(surfaceRefSchema).max(100).parse(command.payload.views));for(const view of added)this.authorize(view);
   let next:SplitWorkspaceLayout;const presentationOnly=type==='pane.focus'||type==='view.activate'||type==='profile.save'||type==='profile.remove'||type==='thread.reconcile';
   if(type==='thread.reconcile'){
    const input=z.strictObject({workspaceId:splitWorkspaceIdSchema,baseRevision:z.number().int().nonnegative(),viewId:splitWorkspaceIdSchema,expectedBinding:panelBindingSchema,projectId:splitWorkspaceIdSchema.nullable()}).parse(command.payload),target=state.views[input.viewId];
    if(!target||target.kind!=='thread'||target.binding.authority.kind!=='local'||!target.binding.threadId)throw new HarnessError('FORBIDDEN','Only an existing local conversation view can be reconciled.');
    if(digest(target.binding)!==digest(input.expectedBinding))throw new HarnessError('WORKSPACE_CHANGED','The captured conversation owner binding changed.');
    const threadId=target.binding.threadId,thread=this.store.get<Thread>('thread',threadId);if(!thread)throw new HarnessError('NOT_FOUND','The owning conversation is unavailable.');
    const projectId=thread.projectId??null;if(projectId!==input.projectId)throw new HarnessError('WORKSPACE_CHANGED','The canonical conversation project changed. Refresh before reconciling its view.');
    const reconcile=(source:SplitWorkspaceLayout)=>{const result=structuredClone(source);for(const view of Object.values(result.views)){if(view.kind!=='thread'||view.binding.authority.kind!=='local'||view.binding.threadId!==threadId)continue;if(projectId===null)delete view.binding.projectId;else view.binding.projectId=projectId;}return splitWorkspaceLayoutSchema.parse(result);};
    next={...reconcile(state),revision:state.revision+1};this.authorize(next.views[input.viewId]!);history.undo=history.undo.map(reconcile);history.redo=history.redo.map(reconcile);if(history.lastWorking)history.lastWorking=reconcile(history.lastWorking);
    for(const raw of this.store.all<unknown>('splitWorkspaceProfile')){if(!raw||typeof raw!=='object'||(raw as {workspaceId?:unknown}).workspaceId!==workspaceId)continue;const saved=profileSchema.parse(raw),layout=reconcile(saved.layout);if(digest(layout)!==digest(saved.layout))this.store.put('splitWorkspaceProfile',saved.id,null,profileSchema.parse({...saved,layout,updatedAt:new Date().toISOString()}));}
   }else if(type==='profile.save'){
    const name=profileNameSchema.parse(command.payload.name),existing=command.payload.profileId===undefined?undefined:this.profile(command.payload.profileId,workspaceId);
    if(!existing&&this.readProfiles(workspaceId).length>=50)throw new HarnessError('LAYOUT_LIMIT','Keep at most fifty saved layouts per workspace.');
    for(const view of Object.values(state.views))this.authorize(view);
    const stamp=new Date().toISOString(),id=existing?.id??randomUUID(),profile=profileSchema.parse({version:1,id,workspaceId,name,createdAt:existing?.createdAt??stamp,updatedAt:stamp,layout:{...structuredClone(state),revision:0,undoDepth:0,redoDepth:0}});
    this.store.put('splitWorkspaceProfile',id,null,profile);next={...state,revision:state.revision+1};
   }else if(type==='profile.apply'){
    const saved=this.profile(command.payload.profileId,workspaceId);for(const view of Object.values(saved.layout.views))this.authorize(view);
    history.undo.push(state);history.redo=[];next={...structuredClone(saved.layout),revision:state.revision+1};
   }else if(type==='profile.remove'){
    const saved=this.profile(command.payload.profileId,workspaceId);this.store.remove('splitWorkspaceProfile',saved.id);next={...state,revision:state.revision+1};
   }else if(type==='history.undo'||type==='history.redo'){
    const source=type==='history.undo'?history.undo:history.redo,target=type==='history.undo'?history.redo:history.undo,previous=source.pop();if(!previous)throw new HarnessError('NOT_FOUND','There is no layout change to restore.');target.push(state);next={...previous,revision:state.revision+1};
   }else if(type==='layout.restore'){
    const previous=history.lastWorking;if(!previous)throw new HarnessError('NOT_FOUND','No previous working layout is available.');history.undo.push(state);history.redo=[];next={...previous,revision:state.revision+1};
   }else{
    next=applySplitWorkspaceCommand(state,command.type,command.payload);if(!presentationOnly){history.undo.push(state);history.redo=[];}
   }
   if(!presentationOnly)history.lastWorking=state;history.undo=history.undo.slice(-SPLIT_WORKSPACE_LIMITS.history);history.redo=history.redo.slice(-SPLIT_WORKSPACE_LIMITS.history);
   next=splitWorkspaceLayoutSchema.parse({...next,undoDepth:history.undo.length,redoDepth:history.redo.length});
   if(Object.values(next.views).some(view=>view.binding.authority.kind!=='local'))throw new HarnessError('FORBIDDEN','Personal split layouts cannot own a plug-in surface.');
   this.store.put('splitWorkspaceLayout',workspaceId,null,next);this.store.put('splitWorkspaceHistory',workspaceId,null,historySchema.parse(history));return next;
  });
 }
}
