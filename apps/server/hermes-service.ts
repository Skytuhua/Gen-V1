import {Service} from '../../packages/core/service.ts';
import {accountResolver} from '../../packages/core/accounts.ts';
import type {Store} from '../../packages/storage/store.ts';
import type {Message,RuntimeAdapter} from '../../packages/contracts/index.ts';
import {createHermesRuntime} from '../../packages/runtime-hermes/index.ts';
import {HermesSourceLibrary} from '../../packages/runtime-hermes/library.ts';
import {hermesSettings} from '../../packages/runtime-hermes/settings.ts';
import {createRuntime} from '../../packages/runtime/index.ts';
import {createIntegrationHost} from './integration-host.ts';
import {ProjectTools} from '../../packages/workspace/tools.ts';
import {TerminalHost} from '../../packages/workspace/terminal.ts';
import {registerWorkspaceHost} from './workspace-host.ts';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

/** Production composition. Injected Service runtimes remain available to embedders/tests. */
export function createHermesService(store:Store,native:RuntimeAdapter):Service{
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
 service=new Service(store,runtime,{approvedWriteHooks:true,source:{runtime,library},planningRuntimeFactory:()=>runtime.createTaskRuntime(),prepareWorkspace:thread=>projects.prepareWorkspace(thread),additionalTool:(call,ctx)=>integrations!.additionalTool(call,ctx),sideRuntimeFactory:()=>createRuntime({dataDir:store.dataDir,accounts}),predictionRuntimeFactory:()=>createRuntime({dataDir:store.dataDir,accounts,modelOnly:true,purpose:'prediction'})});
 const terminals=new TerminalHost(projects);registerWorkspaceHost(service,{projects,terminals,integrations:integrations.manager,context7Key:async key=>{await integrations!.configurePrivate({context7ApiKey:key});}});
 const dispose=service.dispose.bind(service);let closing:Promise<void>|undefined;
 service.dispose=()=>closing??=(async()=>{const results=await Promise.allSettled([dispose(),integrations!.close(),terminals.dispose(),projects.dispose()]);const failures=results.flatMap(result=>result.status==='rejected'?[result.reason]:[]);if(failures.length)throw new AggregateError(failures,'Workspace shutdown could not be confirmed.');})();
 return service;
}
