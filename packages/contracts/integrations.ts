import {z} from 'zod';
import type {RuntimeUsage} from './index.ts';

export const INTEGRATION_IDS=['humanizer','emil','impeccable','graphify','promptfoo','biome','superpowers','spec-kit','context7','ponytail'] as const;
export type IntegrationId=typeof INTEGRATION_IDS[number];
export const integrationIdSchema=z.enum(INTEGRATION_IDS);
export const ponytailModeSchema=z.enum(['off','lite','full','ultra']);
export type PonytailMode=z.infer<typeof ponytailModeSchema>;
export const integrationPreferenceSchema=z.strictObject({enabled:z.boolean(),mode:ponytailModeSchema.optional()});
export type IntegrationPreference=z.infer<typeof integrationPreferenceSchema>;
export const integrationPreferencesSchema=z.partialRecord(integrationIdSchema,integrationPreferenceSchema);
export type IntegrationPreferences=z.infer<typeof integrationPreferencesSchema>;
export const DEFAULT_INTEGRATIONS:IntegrationPreferences=Object.fromEntries(INTEGRATION_IDS.map(id=>[id,{enabled:true,...(id==='ponytail'?{mode:'full' as const}:{})}]));
export interface IntegrationStatus {id:IntegrationId;name:string;version:string;installed:boolean;enabled:boolean;state:'ready'|'disabled'|'missing'|'starting'|'running'|'stopping'|'error'|'needs-configuration';capabilities:{skills:string[];mcp:boolean;hooks:string[];commands:string[]};error?:string;configured?:boolean;mode?:PonytailMode}
export interface IntegrationScope {authority:{kind:'local'}|{kind:'company';companyId:string};projectId?:string;threadId?:string;modelId?:string;accountId?:string|null}
export interface NativeCompletion {output:string;usage?:Partial<RuntimeUsage>}
export type HostComplete=(scope:IntegrationScope,prompt:string,signal?:AbortSignal)=>Promise<NativeCompletion>;
