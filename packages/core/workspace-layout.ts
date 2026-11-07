import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {HarnessError,type HostCommand,type Thread} from '../contracts/index.ts';
import {threadNavigationRevision} from '../contracts/shell-read-models.ts';
import {DEFAULT_INTEGRATIONS,integrationIdSchema,integrationPreferenceSchema} from '../contracts/integrations.ts';
import {canvasLayoutSchema,nativeLayoutSchema,panelBindingSchema,panelBoundsSchema,panelPlacementSchema,surfaceRefSchema,workspaceIdSchema,workspacePanelKindSchema,workspacePresetSchema,workspaceStateSchema,type CanvasLayout,type PanelBinding,type PanelPlacement,type ProjectSummary,type WorkspaceEnvelope,type WorkspaceState} from '../contracts/workspace.ts';
import {Store} from '../storage/store.ts';

const name=z.string().trim().min(1).max(100),revision=z.number().int().nonnegative();
const expectedReviewOwner=z.strictObject({projectId:workspaceIdSchema,workingCopyId:workspaceIdSchema,revision:z.string().min(1).max(2048)});
const now=()=>new Date().toISOString();
const missing=(kind:string)=>new HarnessError('NOT_FOUND',`The ${kind} is no longer available.`);
export function createWorkspaceCanvas(preset:CanvasLayout['preset'],label:string,id:string=randomUUID(),binding?:PanelBinding):CanvasLayout{
 if(preset==='research'&&(!binding||binding.authority.kind!=='local'||!binding.threadId))throw new HarnessError('THREAD_REQUIRED','Choose a conversation before opening Research.');
 const kinds:PanelPlacement['kind'][]=preset==='code-review'?['files','diff','terminal','linked-pull-requests']:preset==='research'?['thread','files','notes']:[];
 const review=[{x:24,y:24,width:360,height:300},{x:408,y:24,width:592,height:300},{x:24,y:348,width:592,height:300},{x:640,y:348,width:360,height:300}];
 const research=[{x:24,y:24,width:600,height:624},{x:648,y:24,width:352,height:300},{x:648,y:348,width:352,height:300}];
 const panels=kinds.map((kind,index):PanelPlacement=>({id:randomUUID(),kind,binding:binding?structuredClone(binding):{authority:{kind:'local'}},canvasId:id,placement:'canvas',visible:true,collapsed:false,bounds:(preset==='research'?research:review)[index],order:index,alwaysOnTop:false}));
 return{version:1,id,name:label,preset,viewport:{x:0,y:0,zoom:1},panels,filter:'active',projectIds:binding?.projectId?[binding.projectId]:[]};
}

function initial():WorkspaceState{const canvas=createWorkspaceCanvas('workspace','Workspace','workspace-default');return{version:1,revision:0,activeCanvasId:canvas.id,canvases:[canvas],profiles:[],disabledKinds:[],integrations:structuredClone(DEFAULT_INTEGRATIONS)};}
function terminalReferences(state:WorkspaceState){
 for(const canvas of [...state.canvases,...state.profiles.flatMap(profile=>profile.canvases)])for(const panel of canvas.panels)if(panel.kind==='terminal'&&!panel.binding.terminalId)panel.binding.terminalId='terminal-'+createHash('sha256').update(panel.id).digest('hex').slice(0,32);
 return state;
}

/** Layout transactions never change task ownership, accounts, credentials or company state. */
export class WorkspaceRepository{
 constructor(readonly store:Store){}
 read():WorkspaceEnvelope{return{state:terminalReferences(workspaceStateSchema.parse(this.store.get('workspaceState','personal')??initial())),projects:this.store.all<ProjectSummary>('workspaceProject')};}
 command(command:HostCommand){
  if(!command.type.startsWith('workspace.'))throw new HarnessError('INVALID_INPUT','Choose a workspace command.');
  return this.store.command(command,()=>{
   const state=this.read().state,p=command.payload;
   if(p.baseRevision!==undefined&&revision.parse(p.baseRevision)!==state.revision)throw new HarnessError('WORKSPACE_CHANGED','The workspace revision changed. Refresh before applying this layout.');
   const type=command.type.slice(10);
   const canvas=(id:unknown)=>{const value=state.canvases.find(item=>item.id===workspaceIdSchema.parse(id));if(!value)throw missing('canvas');return value;};
   const profile=(id:unknown)=>{const value=state.profiles.find(item=>item.id===workspaceIdSchema.parse(id));if(!value)throw missing('profile');return value;};
   const panel=(id:unknown)=>{const value=state.canvases.flatMap(item=>item.panels).find(item=>item.id===workspaceIdSchema.parse(id));if(!value)throw missing('panel');return value;};
   const bindReview=(target:CanvasLayout,threadId:unknown,expected?:unknown)=>{
    const owner=this.store.get<Thread>('thread',workspaceIdSchema.parse(threadId));
    if(!owner?.projectId||owner.kind==='side'||owner.kind==='delegate'||owner.sideParentId)throw new HarnessError('THREAD_REQUIRED','Choose a main project conversation for Code Review.');
    if(expected!==undefined){
     const claimed=expectedReviewOwner.parse(expected);
     if(owner.projectId!==claimed.projectId||owner.workspaceId!==claimed.workingCopyId||threadNavigationRevision(owner)!==claimed.revision)throw new HarnessError('REVISION_CHANGED','The working copy changed. Reopen the current thread details.');
    }
    const binding:PanelBinding={authority:{kind:'local'},threadId:owner.id,projectId:owner.projectId};
    const threads=target.panels.filter(item=>item.kind==='thread');
    const existing=threads.find(item=>item.id==='review-owner-'+target.id)??(threads.length===1?threads[0]:undefined);
    if(existing)existing.binding=binding;
    else target.panels.push(panelPlacementSchema.parse({id:'review-owner-'+target.id,kind:'thread',binding,canvasId:target.id,placement:'canvas',visible:true,collapsed:false,bounds:{x:24,y:24,width:540,height:380},order:target.panels.length,alwaysOnTop:false}));
    target.projectIds=[owner.projectId];
   };
   if(type==='canvas.create'){
    const data=z.strictObject({name,preset:workspacePresetSchema,projectIds:z.array(workspaceIdSchema).max(200).optional(),threadId:workspaceIdSchema.optional(),expected:expectedReviewOwner.optional(),baseRevision:revision.optional()}).parse(p);
    if(data.expected&&(data.preset!=='code-review'||!data.threadId))throw new HarnessError('INVALID_INPUT','An exact review owner requires a Code Review conversation.');
    const ownerId=data.threadId??(data.preset==='research'?this.store.snapshot().activeThreadId:undefined),owner=ownerId?this.store.get<Thread>('thread',ownerId):undefined;if(data.threadId&&!owner)throw missing('conversation');const next=createWorkspaceCanvas(data.preset,data.name,undefined,owner?{authority:{kind:'local'},threadId:owner.id,...(owner.projectId?{projectId:owner.projectId}:{})}:undefined);next.projectIds=data.projectIds??next.projectIds;if(data.preset==='code-review'&&data.threadId)bindReview(next,data.threadId,data.expected);state.canvases.push(next);state.activeCanvasId=next.id;
   }else if(type==='canvas.select'){
    const target=canvas(p.canvasId);if(p.expected!==undefined&&p.threadId===undefined)throw new HarnessError('INVALID_INPUT','An exact review owner needs a thread.');if(p.threadId!==undefined){if(target.preset!=='code-review')throw new HarnessError('INVALID_INPUT','Thread binding is available only in Code Review.');bindReview(target,p.threadId,p.expected);}state.activeCanvasId=target.id;
   }
   else if(type==='canvas.rename')canvas(p.canvasId).name=name.parse(p.name);
   else if(type==='canvas.delete'){
    const target=canvas(p.canvasId);if(state.canvases.length===1)throw new HarnessError('LAST_CANVAS','Keep at least one canvas.');state.canvases=state.canvases.filter(item=>item!==target);if(state.activeCanvasId===target.id)state.activeCanvasId=state.canvases[0]!.id;
   }else if(type==='canvas.viewport')canvas(p.canvasId).viewport=canvasLayoutSchema.shape.viewport.parse({x:p.x,y:p.y,zoom:p.zoom});
   else if(type==='canvas.filter')canvas(p.canvasId).filter=z.enum(['active','all']).parse(p.filter);
   else if(type==='panel.add'){
    const target=canvas(p.canvasId),ref=surfaceRefSchema.parse(p.panel);
    if(state.canvases.some(item=>item.panels.some(value=>value.id===ref.id)))throw new HarnessError('PANEL_EXISTS','This panel is already in a canvas.');
    target.panels.push(panelPlacementSchema.parse({...ref,canvasId:target.id,placement:'canvas',visible:true,collapsed:false,bounds:p.bounds??{x:24,y:24,width:540,height:380},order:target.panels.length,alwaysOnTop:false}));
   }else if(type==='panel.update'){
    const target=panel(p.panelId),patch=z.strictObject({binding:panelBindingSchema.optional(),visible:z.boolean().optional(),collapsed:z.boolean().optional(),bounds:panelBoundsSchema.optional(),order:z.number().int().min(0).max(100000).optional(),alwaysOnTop:z.boolean().optional(),placement:z.enum(['canvas','native']).optional(),displayId:z.string().max(200).optional()}).parse(p.patch);Object.assign(target,patch);
   }else if(type==='panel.remove'){const target=panel(p.panelId);for(const item of state.canvases)item.panels=item.panels.filter(value=>value!==target);}
   else if(type==='kind.enabled'){const kind=workspacePanelKindSchema.parse(p.kind),enabled=z.boolean().parse(p.enabled);state.disabledKinds=state.disabledKinds.filter(value=>value!==kind);if(!enabled)state.disabledKinds.push(kind);}
   else if(type==='integrations.update'){
    const id=integrationIdSchema.parse(p.id),current=state.integrations[id]??{enabled:true};state.integrations[id]=integrationPreferenceSchema.parse({...current,...(p.enabled===undefined?{}:{enabled:p.enabled}),...(p.mode===undefined?{}:{mode:p.mode})});
   }else if(type==='native.update')state.nativeLayout=nativeLayoutSchema.parse(p.layout);
   else if(type==='profile.save'){
    const existing=p.profileId===undefined?undefined:profile(p.profileId),stamp=now();
    const saved={version:1 as const,id:existing?.id??randomUUID(),name:name.parse(p.name),canvases:structuredClone(state.canvases),activeCanvasId:state.activeCanvasId,disabledKinds:[...state.disabledKinds],integrations:structuredClone(state.integrations),...(p.nativeLayout===undefined?(state.nativeLayout?{nativeLayout:structuredClone(state.nativeLayout)}:{}):{nativeLayout:nativeLayoutSchema.parse(p.nativeLayout)}),createdAt:existing?.createdAt??stamp,updatedAt:stamp};
    state.profiles=state.profiles.filter(value=>value.id!==saved.id);state.profiles.push(saved);
   }else if(type==='profile.apply'){
    if(p.baseRevision===undefined)throw new HarnessError('WORKSPACE_CHANGED','Apply a profile against an exact workspace revision.');const saved=profile(p.profileId);state.canvases=structuredClone(saved.canvases);state.activeCanvasId=saved.activeCanvasId;state.disabledKinds=[...saved.disabledKinds];state.integrations=structuredClone(saved.integrations);state.nativeLayout=saved.nativeLayout?structuredClone(saved.nativeLayout):undefined;
   }else if(type==='profile.restore'){
    if(p.baseRevision===undefined)throw new HarnessError('WORKSPACE_CHANGED','Restore against an exact workspace revision.');const restored=workspaceStateSchema.parse(p.state);Object.assign(state,restored,{revision:state.revision});
   }else if(type==='profile.rename')profile(p.profileId).name=name.parse(p.name);
   else if(type==='profile.duplicate'){const saved=profile(p.profileId),stamp=now();state.profiles.push({...structuredClone(saved),id:randomUUID(),name:name.parse(p.name),createdAt:stamp,updatedAt:stamp});}
   else if(type==='profile.delete'){const saved=profile(p.profileId);state.profiles=state.profiles.filter(value=>value!==saved);}
   else if(type==='project.rename'){const id=workspaceIdSchema.parse(p.projectId),value=this.store.get<ProjectSummary>('workspaceProject',id);if(!value||value.authority.kind!=='local')throw missing('project');this.store.put('workspaceProject',id,null,{...value,name:name.parse(p.name)});}
   else throw new HarnessError('INVALID_INPUT','Unknown workspace command.');
   const next=terminalReferences(workspaceStateSchema.parse({...state,revision:state.revision+1}));this.store.put('workspaceState','personal',null,next);return{state:next,projects:this.store.all<ProjectSummary>('workspaceProject')};
  });
 }
 /** Attach legacy labels to stable local IDs without guessing filesystem roots. */
 migrateProjects(){
  const threads=this.store.all<Thread>('thread');if(!threads.some(thread=>!thread.projectId&&thread.projectName))return;
  this.store.internal('workspace.projects.migrated',null,()=>{
   const projects=this.store.all<ProjectSummary>('workspaceProject');
   for(const thread of threads){if(thread.projectId||!thread.projectName)continue;let project=projects.find(item=>item.authority.kind==='local'&&item.name===thread.projectName);
    if(!project){project={id:randomUUID(),name:thread.projectName,authority:{kind:'local'},createdAt:now()};projects.push(project);this.store.put('workspaceProject',project.id,null,project);}
    this.store.put('thread',thread.id,thread.id,{...thread,projectId:project.id});
   }
  });
 }
}
