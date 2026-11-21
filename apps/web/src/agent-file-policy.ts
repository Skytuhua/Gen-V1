import {compileFilePolicy,filePolicyDenies} from '../../../packages/core/file-policy.ts';
import {AGENT_FILE_POLICY_DEFAULTS} from '../../../packages/contracts/agent-file-policy.ts';

/** Resolved rules for one selection scope. `project` is additive over global;
 * a missing project record contributes no rules. `revision` joins both scope
 * revisions so callers can invalidate staged candidates after a save. */
export interface AgentFilePolicySnapshot { global:readonly string[]; project:readonly string[]; revision:string }
export type AgentFilePolicyDenier = (rootRelativePath:string)=>boolean;

export function agentFilePolicyDenier(snapshot:{global:readonly string[];project?:readonly string[]|null}):AgentFilePolicyDenier {
	const matchers=[compileFilePolicy([...snapshot.global]),compileFilePolicy([...(snapshot.project??[])])];
	return rootRelativePath=>filePolicyDenies(matchers,rootRelativePath);
}

/** Mention/candidate entries are always grant-relative paths, never a grant or
 * authority by themselves. */
export function filterAgentFileCandidates<T>(candidates:readonly T[],deny:AgentFilePolicyDenier,pathOf:(candidate:T)=>string):T[] {
	return candidates.filter(candidate=>!deny(pathOf(candidate)));
}

/** Admission re-checks the CURRENT policy at stage/send time; a candidate that
 * was allowed when suggested can be denied after a rules save. */
export function admitAgentFileCandidate(rootRelativePath:string,deny:AgentFilePolicyDenier):boolean {
	return !deny(rootRelativePath);
}

/** Reads both scopes through the authenticated host routes. `request` performs
 * the credentialed GET /api/agent-file-policy?scope=<scope> call. */
export async function fetchAgentFilePolicy(projectId:string|null,request:(scope:string)=>Promise<{revision:number;rules:string[]}>):Promise<AgentFilePolicySnapshot> {
	const global=await request('global');
	const project=projectId?await request(`project:${projectId}`):{revision:0,rules:[]};
	return {global:global.rules,project:project.rules,revision:`${global.revision}/${project.revision}`};
}

/** Offline fallback when the host route is unreachable: shipped defaults only. */
export function agentFilePolicyDefaults():AgentFilePolicySnapshot {
	return {global:[...AGENT_FILE_POLICY_DEFAULTS],project:[],revision:'0/0'};
}
