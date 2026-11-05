import {HarnessError,type RuntimeAdapter,type RuntimeCallbacks} from '../contracts/index.ts';
import {createRuntime} from '../runtime/index.ts';
import type {HermesEngine,HermesEngineOptions,HermesRuntime,HermesRuntimeDependencies,HermesRuntimeOptions} from './index.ts';

/** The canonical worker keeps legacy source sessions and one serialized original skill library. */
export function createHermesTaskPool(options:HermesRuntimeOptions,dependencies:HermesRuntimeDependencies,createEngine:(options:HermesEngineOptions,dependencies:HermesRuntimeDependencies)=>HermesEngine):HermesRuntime{
 const nativeFactory=dependencies.createNativeRuntime??createRuntime;
 const catalog=options.nativeCatalog??nativeFactory({dataDir:options.dataDir,accounts:options.accounts,modelOnly:true});
 const borrowed:RuntimeAdapter={configure(){},models:query=>catalog.models(query),start:async()=>{throw new HarnessError('HERMES_INTERNAL','The catalog cannot execute tasks.');},followUp:async()=>{},cancel:async()=>{},compact:async()=>{},history:(path,account)=>catalog.history(path,account),dispose:async()=>{}};
 const canonical=createEngine({...options,nativeCatalog:borrowed},dependencies),engines=new Set<HermesEngine>([canonical]),main=new Map<string,HermesEngine>();
 let callbacks:RuntimeCallbacks|undefined,primaryThread:string|undefined,disposed=false,disposing:Promise<void>|undefined;
 const check=()=>{if(disposed)throw new HarnessError('HERMES_DISPOSED','The Hermes runtime has closed.');};
 const secondary=(readOnly=false)=>{const engine=createEngine({...options,nativeCatalog:borrowed,readOnly,sharedLibrary:(params,authority)=>canonical.sourceTool(params,authority),onSourceEvent:event=>{if(event.event==='settled'&&event.ctx)void canonical.sourceTool({releaseOwner:true,ctx:event.ctx}).catch(()=>{});options.onSourceEvent?.(event);}},dependencies);engines.add(engine);return engine;};
 const task=(threadId:string)=>{check();let engine=main.get(threadId);if(engine)return engine;if([...main.values()].filter(value=>value.sourceBusy).length>=3)throw new HarnessError('HERMES_SOURCE_BUSY','Three personal main agents already own source workers.');if(primaryThread===undefined){primaryThread=threadId;engine=canonical;}else{
   const idle=main.size>=3?[...main].find(([,value])=>!value.sourceBusy&&!value.reviewBusy):undefined;
   if(idle){main.delete(idle[0]);engine=idle[1];}else engine=secondary();
  }if(callbacks)engine.configure(callbacks);main.set(threadId,engine);return engine;};
 return{
  configure(value){check();callbacks=value;for(const engine of main.values())engine.configure(value);canonical.configure(value);},
  models(query){check();return catalog.models(query);},
  get sourceBusy(){return [...engines].some(engine=>engine.sourceBusy);},get reviewBusy(){return [...engines].some(engine=>engine.reviewBusy);},
  async start(input){return task(input.threadId).start(input);},async followUp(input){check();const engine=main.get(input.threadId);if(!engine)throw new HarnessError('HERMES_STALE_RUN','This thread has no source owner.');return engine.followUp(input);},
  cancel(ctx){return main.get(ctx.threadId)?.cancel(ctx)??Promise.resolve();},
  async compact(ctx,path,modelId,accountId){check();const engine=main.get(ctx.threadId);if(!engine)throw new HarnessError('HERMES_SESSION_INVALID','Compaction requires the retained source task.');return engine.compact(ctx,path,modelId,accountId);},
  history(path,account){check();return canonical.history(path,account);},
  sourceRequest(method,params){check();return canonical.sourceRequest(method,params);},sourceTool(params,authority){check();return canonical.sourceTool(params,authority);},
  async cancelBackground(){await Promise.all([...engines].map(engine=>engine.cancelBackground()));},
  async refreshIntegrations(disabledIds){check();await Promise.all([...engines].map(engine=>engine.refreshIntegrations(disabledIds)));},
  createTaskRuntime(){check();const engine=secondary(true),dispose=engine.dispose.bind(engine);engine.dispose=async()=>{await dispose();engines.delete(engine);};return engine;},
  dispose(){return disposing??=(async()=>{disposed=true;const outcomes=await Promise.allSettled([...engines].map(engine=>engine.dispose()).concat([catalog.dispose()]));const failures=outcomes.flatMap(result=>result.status==='rejected'?[result.reason]:[]);if(failures.length)throw new AggregateError(failures,'Hermes task pool cleanup could not be confirmed.');})();},
 };
}
