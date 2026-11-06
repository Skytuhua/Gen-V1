import {z} from 'zod';

const identity=z.string().min(1).max(240);
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const skillCatalogScopeSchema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('personal')}),
 z.strictObject({kind:z.literal('provider'),providerId:identity,scopeId:identity}),
]);
export type SkillCatalogScope=z.infer<typeof skillCatalogScopeSchema>;
export const skillReferenceSchema=z.strictObject({version:z.literal(1),scope:skillCatalogScopeSchema,sourceId:identity,skillId:z.string().min(1).max(305),locator:hash,revision:hash,digest:hash,sourceBinding:hash});
/** Data identity only. This reference conveys no read, tool, account or execution authority. */
export type SkillReference=z.infer<typeof skillReferenceSchema>;
export type SkillAvailability={status:'available'}|{status:'unavailable';reason:'disabled'|'disconnected'|'unsupported'|'denied'|'changed'|'limit'|'invalid'|'missing'};
export type SkillSourceKind='harness'|'bundled'|'personal'|'project'|'app';
export interface SkillCatalogSource {id:string;kind:SkillSourceKind;label:string;availability:SkillAvailability}
export interface SkillCatalogEntry {id:string;sourceId:string;name:string;description:string;files:number;availability:SkillAvailability;ref:SkillReference|null}
export interface SkillCatalogPage {scope:SkillCatalogScope;sources:SkillCatalogSource[];skills:SkillCatalogEntry[];inventoryRevision:string;nextCursor:string|null}
export const skillCatalogQuerySchema=z.strictObject({query:z.string().max(200).optional(),limit:z.number().int().min(1).max(100).optional(),cursor:z.string().min(1).max(2048).optional(),threadId:identity.optional(),projectId:identity.optional()});
export type SkillCatalogQuery=z.infer<typeof skillCatalogQuerySchema>;

// A package can opt in to Personal metadata only. Private catalogs require their own scoped provider.
const packagePath=z.string().min(1).max(240).refine(value=>value.split('/').every(part=>/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(part)&&!/[. ]$/.test(part)&&! /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)));
export const pluginSkillMetadataSchema=z.strictObject({id:identity.regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/),scope:z.literal('personal'),entry:packagePath.refine(path=>path.endsWith('/SKILL.md')),files:z.array(packagePath).min(1).max(512)}).superRefine((value,ctx)=>{
 if(!value.files.includes(value.entry)||new Set(value.files.map(path=>path.toLowerCase())).size!==value.files.length||value.files.some(path=>!path.startsWith(value.entry.slice(0,-8))))ctx.addIssue({code:'custom',message:'Declare the complete unique skill package under its entry directory.'});
});
export const pluginSkillsMetadataSchema=z.array(pluginSkillMetadataSchema).max(128).refine(values=>new Set(values.map(value=>value.id)).size===values.length);
