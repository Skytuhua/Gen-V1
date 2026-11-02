import {HarnessError,type StartRun,type Thread,type Snapshot} from '../contracts/index.ts';
import type {Store} from '../storage/store.ts';
import type {SkillSummary} from '../contracts/skills.ts';
import {getPreferences} from '../contracts/preferences.ts';
import {createHostTools,hostSystemPrompt,loadDomainTools} from '../runtime-pi/tool-definitions.ts';
import type {HermesSettings} from './index.ts';

/** Capture the app's role and controls; original Hermes owns cadence and tool schemas. */
export async function hermesSettings(store:Store,input?:StartRun):Promise<HermesSettings>{
 const preferences=getPreferences(store.get<Snapshot['settings']>('settings','global')??{}),thread=input?store.get<Thread>('thread',input.threadId):null;
 const skills=store.all<SkillSummary>('skill'),disabled=skills.filter(skill=>!skill.enabled||skill.state==='archived'||skill.migrationError).map(skill=>skill.name),protectedNames=skills.filter(skill=>skill.protected).map(skill=>skill.name);
 const readOnly=thread?.mode==='plan'||Boolean(thread?.sideParentId);
 const tools=createHostTools(await loadDomainTools(),async()=>{throw new HarnessError('CAPABILITY_DENIED','Tool metadata cannot execute a capability.');}).filter(tool=>!['skills_list','skill_view','skill_manage'].includes(tool.name));
 return {
  config:{skills:{creation_nudge_interval:preferences.learningEnabled&&!readOnly?preferences.learningInterval:0,write_approval:preferences.learningApproval,disabled},memory:{memory_enabled:false,user_profile_enabled:false}},
  skillPolicy:{enabled:true,allowWrites:!readOnly,disabledNames:disabled,protectedNames},
  systemPrompt:hostSystemPrompt(input?.memory),
  hostTools:tools.map(({name,description,parameters})=>({name:name==='session_search'?'harness_session_search':name,description,parameters:parameters as Record<string,unknown>})),
 };
}
