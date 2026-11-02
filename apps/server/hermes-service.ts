import {Service} from '../../packages/core/service.ts';
import {accountResolver} from '../../packages/core/accounts.ts';
import type {Store} from '../../packages/storage/store.ts';
import type {Message,RuntimeAdapter} from '../../packages/contracts/index.ts';
import {createHermesRuntime} from '../../packages/runtime-hermes/index.ts';
import {HermesSourceLibrary} from '../../packages/runtime-hermes/library.ts';
import {hermesSettings} from '../../packages/runtime-hermes/settings.ts';
import {createRuntime} from '../../packages/runtime/index.ts';

/** Production composition. Injected Service runtimes remain available to embedders/tests. */
export function createHermesService(store:Store,native:RuntimeAdapter):Service{
 let service:Service|undefined;
 const accounts=accountResolver(store),runtime=createHermesRuntime({dataDir:store.dataDir,accounts,nativeCatalog:native,
  settings:input=>hermesSettings(store,input),onSourceEvent:event=>service?.sourceEvent(event),
  initialHistory:async input=>{
   const current=new Set((input.inputIds??[input.inputId]).map(id=>store.get<{messageId?:string}>('outbox',id)?.messageId).filter(Boolean));
   return store.all<Message>('message',input.threadId).filter(message=>message.role!=='activity'&&message.content&&!current.has(message.id)&&message.runId!==input.runId).map(message=>({role:message.role,content:message.content}));
  },
 });
 const library=new HermesSourceLibrary({store,source:{request:(method,params)=>runtime.sourceRequest(method,params)}});
 service=new Service(store,runtime,{source:{runtime,library},sideRuntimeFactory:()=>createRuntime({dataDir:store.dataDir,accounts}),predictionRuntimeFactory:()=>createRuntime({dataDir:store.dataDir,accounts,modelOnly:true,purpose:'prediction'})});
 return service;
}
