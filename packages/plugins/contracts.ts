import {z} from 'zod';
import {pluginSkillsMetadataSchema} from '../contracts/skill-catalog.ts';

export const pluginIdSchema=z.string().min(1).max(80).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/).refine(value=>!['data','host','frontend','constructor','prototype'].includes(value));
const identity=z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/).refine(value=>!['__proto__','constructor','prototype'].includes(value));
export const pluginVersionSchema=z.string().max(100).regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
const contributionId=z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/).refine(value=>!['__proto__','constructor','prototype'].includes(value));
export const pluginWorkspaceContributionSchema=z.strictObject({id:contributionId,title:z.string().trim().min(1).max(100),icon:contributionId.optional(),entryView:contributionId,defaultLayout:contributionId.optional()});
export type PluginWorkspaceContribution=z.infer<typeof pluginWorkspaceContributionSchema>;
export const pluginWorkspacesSchema=z.array(pluginWorkspaceContributionSchema).max(16).refine(values=>new Set(values.map(value=>value.id)).size===values.length,'Workspace IDs must be unique.');
export const pluginPathSchema=z.string().min(1).max(240).refine(value=>value.split('/').every(part=>/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(part)&&!/[. ]$/.test(part)&&! /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)),'Use a bounded relative package path without traversal or links.');
export const pluginManifestSchema=z.strictObject({
 id:pluginIdSchema,name:z.string().trim().min(1).max(100),version:pluginVersionSchema,apiVersion:z.literal(1),compatibleGenVersions:z.string().trim().min(1).max(200),
 frontendEntry:pluginPathSchema.refine(value=>value.startsWith('frontend/')&&value.endsWith('.html'),'The frontend entry must be HTML under frontend/.'),
 hostEntry:pluginPathSchema.refine(value=>value.startsWith('host/')&&value.endsWith('.mjs'),'The host entry must be ESM under host/.'),
 workspaces:pluginWorkspacesSchema.optional(),
 skills:pluginSkillsMetadataSchema.optional(),
});
export type PluginManifest=z.infer<typeof pluginManifestSchema>;
export const pluginSurfaceSchema=z.strictObject({kind:z.literal('plugin'),pluginId:pluginIdSchema,scopeId:identity,surfaceId:identity,resourceId:identity.optional()});
export type PluginSurface=z.infer<typeof pluginSurfaceSchema>;
export type Capability={available:true}|{available:false;reason:string};
export interface ConversationRef {pluginId:string;scopeId:string;conversationId:string}
export interface ConversationMessage {id:string;role:'user'|'assistant'|'system';content:string}
export interface ConversationView {ref:ConversationRef;title:string;messages:ConversationMessage[];capabilities:{send:Capability;submitArtifactAction:Capability;cancel:Capability}}
export interface MessageInput {content:string;requestId:string}
export interface ArtifactActionInput {artifactId:string;actionId:string;revision:number;payload:unknown;requestId:string}
export interface ConversationAdapter {
 load(ref:ConversationRef,signal:AbortSignal):Promise<ConversationView>;
 send(ref:ConversationRef,input:MessageInput,signal:AbortSignal):Promise<unknown>;
 submitArtifactAction(ref:ConversationRef,input:ArtifactActionInput,signal:AbortSignal):Promise<unknown>;
 cancel(ref:ConversationRef,signal:AbortSignal):Promise<unknown>;
}
export interface PluginHostContext {dataDir:string;genVersion:string}
export interface PluginHostInstance {
 operations:Record<string,(input:unknown,signal:AbortSignal)=>Promise<unknown>>;
 validateSurface?:(surface:PluginSurface)=>Promise<boolean>;
 isBusy?:()=>Promise<boolean>;
 close:()=>Promise<void>;
}
/** hostEntry exports default {activate(context): Promise<PluginHostInstance>}.
 * The trusted package receives only its own persistent directory and Gen version.
 * It is trusted Node code, not an in-process security sandbox. */
export interface PluginHostModule {activate(context:PluginHostContext):Promise<PluginHostInstance>}
export interface PluginCompatibility {compatible:boolean;blockers:{pluginId:string;reason:string}[]}
