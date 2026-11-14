import {z} from 'zod';
import {parseDesktopLayout,type DesktopLayout} from '../desktop-contract/index.ts';
import {integrationPreferencesSchema} from './integrations.ts';
import {pluginIdSchema,pluginSurfaceSchema} from '../plugins/contracts.ts';

export const workspaceIdSchema=z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9:_.-]*$/);
const title=z.string().trim().min(1).max(100);
export const WORKSPACE_PRESETS=['workspace','all-agents','code-review','research','custom'] as const;
export const WORKSPACE_PANEL_KINDS=['thread','agent','artifact','context','plan','usage','notes','navigation','workspace','browser','terminal','files','diff','output','pull-request','linked-pull-requests'] as const;
export type WorkspacePreset=typeof WORKSPACE_PRESETS[number];
export type WorkspacePanelKind=typeof WORKSPACE_PANEL_KINDS[number];
export const workspacePresetSchema=z.enum(WORKSPACE_PRESETS);
export const workspacePanelKindSchema=z.enum(WORKSPACE_PANEL_KINDS);
export const workspaceAuthoritySchema=z.discriminatedUnion('kind',[z.strictObject({kind:z.literal('local')}),z.strictObject({kind:z.literal('plugin'),pluginId:pluginIdSchema,scopeId:pluginSurfaceSchema.shape.scopeId})]);
export type WorkspaceAuthority=z.infer<typeof workspaceAuthoritySchema>;
export const panelBindingSchema=z.strictObject({authority:workspaceAuthoritySchema,projectId:workspaceIdSchema.optional(),threadId:workspaceIdSchema.optional(),agentId:workspaceIdSchema.optional(),artifactId:workspaceIdSchema.optional(),resourceId:workspaceIdSchema.optional(),terminalId:workspaceIdSchema.optional(),browserId:workspaceIdSchema.optional(),liveProject:z.boolean().optional()});
export type PanelBinding=z.infer<typeof panelBindingSchema>;
const surfaceFields={id:workspaceIdSchema,kind:workspacePanelKindSchema,binding:panelBindingSchema};
function validateBinding(value:{kind:WorkspacePanelKind;binding:PanelBinding},context:z.RefinementCtx){
 const pluginEntity=value.binding.authority.kind==='plugin';
 if(pluginEntity&&value.kind==='plan'&&!value.binding.resourceId)context.addIssue({code:'custom',path:['binding','resourceId'],message:'A scoped plug-in plan reference is required'});
 if(!pluginEntity&&['thread','agent','artifact','plan','notes'].includes(value.kind)&&!value.binding.threadId)context.addIssue({code:'custom',path:['binding','threadId'],message:'A thread binding is required'});
 if(value.kind==='agent'&&!value.binding.agentId)context.addIssue({code:'custom',path:['binding','agentId'],message:'An agent binding is required'});
 if(value.kind==='artifact'&&!value.binding.artifactId)context.addIssue({code:'custom',path:['binding','artifactId'],message:'An artifact binding is required'});
 if(value.kind==='browser'&&!value.binding.browserId)context.addIssue({code:'custom',path:['binding','browserId'],message:'A browser binding is required'});
}
export const surfaceRefSchema=z.strictObject(surfaceFields).superRefine(validateBinding);
export type SurfaceRef=z.infer<typeof surfaceRefSchema>;
const coordinate=z.number().finite().min(-1_000_000).max(1_000_000);
export const panelBoundsSchema=z.strictObject({x:coordinate,y:coordinate,width:z.number().finite().min(120).max(8192),height:z.number().finite().min(80).max(8192)});
export type PanelBounds=z.infer<typeof panelBoundsSchema>;
export const panelPlacementSchema=z.strictObject({...surfaceFields,canvasId:workspaceIdSchema,placement:z.enum(['canvas','native']),visible:z.boolean(),collapsed:z.boolean(),bounds:panelBoundsSchema,order:z.number().int().min(0).max(100_000),alwaysOnTop:z.boolean(),displayId:z.string().max(200).optional()}).superRefine(validateBinding);
export type PanelPlacement=z.infer<typeof panelPlacementSchema>;
export type WorkspacePanelInstance=PanelPlacement;
export const canvasLayoutSchema=z.strictObject({version:z.literal(1),id:workspaceIdSchema,name:title,preset:workspacePresetSchema,viewport:z.strictObject({x:coordinate,y:coordinate,zoom:z.number().finite().min(.4).max(2)}),panels:z.array(panelPlacementSchema).max(1000),filter:z.enum(['active','all']),projectIds:z.array(workspaceIdSchema).max(200)}).superRefine((canvas,context)=>{
 const ids=new Set<string>();for(const panel of canvas.panels){if(ids.has(panel.id)||panel.canvasId!==canvas.id)context.addIssue({code:'custom',message:'Canvas panels need unique IDs and the correct canvas binding'});ids.add(panel.id);}
});
export type CanvasLayout=z.infer<typeof canvasLayoutSchema>;
export type WorkspaceCanvas=CanvasLayout;
export const nativeLayoutSchema=z.unknown().transform((value,context):DesktopLayout=>{try{return parseDesktopLayout(value);}catch{context.addIssue({code:'custom',message:'Invalid native window layout'});return z.NEVER;}});
const layoutFields={canvases:z.array(canvasLayoutSchema).min(1).max(50),activeCanvasId:workspaceIdSchema,disabledKinds:z.array(workspacePanelKindSchema).max(WORKSPACE_PANEL_KINDS.length),integrations:integrationPreferencesSchema,nativeLayout:nativeLayoutSchema.optional()};
function validateLayout(value:{canvases:CanvasLayout[];activeCanvasId:string;disabledKinds:WorkspacePanelKind[]},context:z.RefinementCtx){
 const ids=value.canvases.map(canvas=>canvas.id),panels=value.canvases.flatMap(canvas=>canvas.panels.map(panel=>panel.id));
 if(new Set(ids).size!==ids.length||!ids.includes(value.activeCanvasId)||new Set(panels).size!==panels.length||new Set(value.disabledKinds).size!==value.disabledKinds.length)context.addIssue({code:'custom',message:'Layout references must be unique and resolve to an active canvas'});
}
export const workspaceProfileSchema=z.strictObject({version:z.literal(1),id:workspaceIdSchema,name:title,...layoutFields,createdAt:z.string().datetime(),updatedAt:z.string().datetime()}).superRefine(validateLayout);
export type WorkspaceProfile=z.infer<typeof workspaceProfileSchema>;
export const workspaceStateSchema=z.strictObject({version:z.literal(1),revision:z.number().int().nonnegative(),...layoutFields,profiles:z.array(workspaceProfileSchema).max(50)}).superRefine(validateLayout);
export type WorkspaceState=z.infer<typeof workspaceStateSchema>;
export const projectSummarySchema=z.strictObject({id:workspaceIdSchema,name:title,authority:workspaceAuthoritySchema,rootPath:z.string().min(1).max(32768).optional(),repository:z.string().max(1000).optional(),createdAt:z.string().datetime()});
export type ProjectSummary=z.infer<typeof projectSummarySchema>;
export const workspaceEnvelopeSchema=z.object({state:workspaceStateSchema,projects:z.array(projectSummarySchema)});
export interface WorkspaceEnvelope {state:WorkspaceState;projects:ProjectSummary[]}
export interface ProjectContext {project:ProjectSummary;workingCopy?:{id:string;path:string};threadRevision?:string;threadId?:string;machineName:string;editor:{available:boolean;label:string};branch:string|null;head:string|null;revision?:string;changes:{added:number|null;removed:number|null;files:number|null};lineage:{id:string;title:string;status:string;parentThreadId?:string;kind?:string}[];scripts:{id:string;name:string;command:string}[];capabilities:{git:boolean;gitWrite?:boolean;untrackedIncluded?:boolean;terminal:boolean;pullRequests:boolean};error?:string}
export interface WorkspaceCommand {id:string;type:string;payload:Record<string,unknown>}
