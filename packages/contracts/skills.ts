export type SkillState='active'|'stale'|'archived';
export interface SkillActor {kind:'user'|'agent'|'curator';threadId?:string;runId?:string;evidence?:string[]}
export interface SkillSummary {
 name:string;description:string;category:string;revision:number;state:SkillState;enabled:boolean;protected:boolean;
 origin:'user'|'agent';managed:boolean;author:SkillActor['kind'];sourceThreadId?:string;sourceRunId?:string;
 createdAt:string;updatedAt:string;lastUsedAt:string|null;useCount:number;patchCount:number;
 migrationError?:string;
}
export interface SkillVersionSummary {revision:number;at:string;actor:SkillActor;action:string}
export interface SkillDetail {skill:SkillSummary;content:string;document?:string;files:string[];versions:SkillVersionSummary[];nextVersionOffset:number|null}
export interface SkillOperation {
 action:'create'|'patch'|'write_file'|'remove_file'|'delete'|'restore'|'rollback';name:string;baseRevision:number;
 description?:string;category?:string;content?:string;oldText?:string;newText?:string;path?:string;revision?:number;
}
export interface SkillPolicy {requireApproval?:boolean;readVersions?:ReadonlyMap<string,number>;now?:string}
export interface SkillChangeResult {status:'applied'|'pending'|'rejected';changes:SkillSummary[];proposalId?:string;appliedOperations?:number}
export interface SkillProposalSummary {id:string;createdAt:string;status:'pending'|'approved'|'rejected';actor:SkillActor;targets:string[]}
export interface SkillProposal extends SkillProposalSummary {operations:SkillOperation[];decidedAt?:string}
export interface SkillPage {skills:SkillSummary[];nextOffset:number|null;catalogId:string}
