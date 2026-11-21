import {Service,type ServiceOptions} from '../../packages/core/service.ts';
import { networkProxyFetch } from '../../packages/core/network-proxy-transport.ts';
import {accountResolver} from '../../packages/core/accounts.ts';
import type {Store} from '../../packages/storage/store.ts';
import type {Message,RuntimeAdapter} from '../../packages/contracts/index.ts';
import {createHermesRuntime} from '../../packages/runtime-hermes/index.ts';
import {HermesSourceLibrary} from '../../packages/runtime-hermes/library.ts';
import {hermesSettings} from '../../packages/runtime-hermes/settings.ts';
import {createRuntime} from '../../packages/runtime/index.ts';
import {assertMemoryExtractionModel} from '../../packages/runtime/model-only.ts';
import {hermesRequestScheduler} from '../../packages/runtime/request-scheduler.ts';
import {hermesModelCapacity} from '../../packages/runtime/model-capacity.ts';
import {evaluateExecution} from '../../packages/core/execution-policy.ts';
import {GitHubAuth} from '../../packages/workspace/github-auth.ts';
import {createIntegrationHost} from './integration-host.ts';
import {ProjectTools} from '../../packages/workspace/tools.ts';
import {TerminalHost} from '../../packages/workspace/terminal.ts';
import {registerWorkspaceHost} from './workspace-host.ts';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

/** Production composition. Injected Service runtimes remain available to embedders/tests. */
export function createHermesService(store:Store,native:RuntimeAdapter,effectOptions:Pick<ServiceOptions,'toolEffectFlags'|'toolEffectAuthenticator'>={}):Service{
 let service:Service|undefined;
 const projects=new ProjectTools(store);projects.workspace.migrateProjects();
 let integrations:ReturnType<typeof createIntegrationHost>|undefined;
 const accounts=accountResolver(store),runtime=createHermesRuntime({approvedWriteHooks:true,dataDir:store.dataDir,accounts,nativeCatalog:native,
  settings:input=>integrations?integrations.settingsFor(input):hermesSettings(store,input),onSourceEvent:event=>service?.sourceEvent(event),
  initialHistory:async input=>{
   const current=new Set((input.inputIds??[input.inputId]).map(id=>store.get<{messageId?:string}>('outbox',id)?.messageId).filter(Boolean));
   return store.all<Message>('message',input.threadId).filter(message=>message.role!=='activity'&&message.content&&!current.has(message.id)&&message.runId!==input.runId).map(message=>({role:message.role,content:message.content}));
  },
 });
 const library=new HermesSourceLibrary({store,source:{request:(method,params)=>runtime.sourceRequest(method,params)}});
 const packagedPython=fileURLToPath(new URL('../../hermes-python/python.exe',import.meta.url));
 integrations=createIntegrationHost({store,workspace:projects.workspace,runtime,nodeExecutable:process.execPath,...(existsSync(packagedPython)?{pythonExecutable:packagedPython}:{}),resolveProjectRoot:async(scope,thread,project)=>(await projects.binding(project.id,thread?.id??scope.threadId)).path});
 const backgroundAuth=new GitHubAuth(store.dataDir,networkProxyFetch);
 service=new Service(store,runtime,{...effectOptions,approvedWriteHooks:true,background:{gate:hermesModelCapacity,
  // M03: the policy decides; without an operator-approved profile, trust and
  // installed backend the command stays HOLD_EXECUTION_PROFILE. No fallback.
  executionGate:async({profileId,spec})=>{
   const profile=store.get<unknown>('executionProfile',profileId);
   if(!profile)return{allowed:false,reason:'HOLD_EXECUTION_PROFILE'};
   const decision=await evaluateExecution({profile,request:{kind:'executable',executable:spec.executable,argv:spec.argv,cwd:spec.cwd},env:process.env,backends:[]});
   return decision.status==='ALLOW'?{allowed:true}:{allowed:false,reason:decision.status==='BLOCKED'?decision.code:'HOLD_EXECUTION_PROFILE'};
  },
  intakeAuth:{token:()=>backgroundAuth.token()}},memoryExtractionAdmission:async(job,signal)=>{assertMemoryExtractionModel(job.modelId);const permit=await hermesRequestScheduler.acquire(job.modelId.split('/')[0],job.access.accountId,signal,{requestClass:'background'});return permit.release;},memoryExtractionRuntimeFactory:job=>{assertMemoryExtractionModel(job.modelId);return createRuntime({dataDir:store.dataDir,accounts,modelOnly:true,purpose:'memory-extraction'});},source:{runtime,library},planningRuntimeFactory:()=>runtime.createTaskRuntime(),prepareWorkspace:thread=>projects.prepareWorkspace(thread),additionalTool:(call,ctx,host)=>integrations!.additionalTool(call,ctx,host),hostOperationExecutors:integrations.operationExecutors,sideRuntimeFactory:()=>createRuntime({dataDir:store.dataDir,accounts}),predictionRuntimeFactory:()=>createRuntime({dataDir:store.dataDir,accounts,modelOnly:true,purpose:'prediction'})});
 const terminals=new TerminalHost(projects);registerWorkspaceHost(service,{projects,terminals,integrations:integrations.manager,secretReferences:()=>integrations!.secretReferences(),context7Key:async key=>{await integrations!.configurePrivate({context7ApiKey:key});}});
 const dispose=service.dispose.bind(service);let closing:Promise<void>|undefined;
 service.dispose=()=>closing??=(async()=>{const results=await Promise.allSettled([dispose(),integrations!.close(),terminals.dispose(),projects.dispose()]);const failures=results.flatMap(result=>result.status==='rejected'?[result.reason]:[]);if(failures.length)throw new AggregateError(failures,'Workspace shutdown could not be confirmed.');})();
 return service;
}
