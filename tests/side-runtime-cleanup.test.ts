import {expect,it,vi} from 'vitest';
import {SideRuntime} from '../packages/core/side-runtime.ts';
import type {RuntimeAdapter,RuntimeCallbacks,StartRun} from '../packages/contracts/index.ts';

it.each([false,true])('reports failed native cleanup after side settlement: %s',async(settled)=>{
 let callbacks!:RuntimeCallbacks;const failure=new Error('Synthetic side cleanup is unconfirmed');
 const adapter:RuntimeAdapter={configure:value=>{callbacks=value;},models:async()=>[],start:async()=>{},followUp:async()=>{},cancel:async()=>{},compact:async()=>{},history:async()=>[],dispose:vi.fn(async()=>{throw failure;})};
 const side=new SideRuntime(()=>adapter,{onEvent:()=>{},onTool:async()=>({})});
 const input={threadId:'side-cleanup',runId:'run-cleanup',epoch:1,modelId:'fixture/side',accountId:null,thinkingLevel:null,prompt:'Synthetic read-only side conversation.',inputId:'input-cleanup',inputIds:['input-cleanup'],sessionPath:null,resources:[]} satisfies StartRun;
 await side.start(input);
 if(settled){callbacks.onEvent({...input,type:'settled'});await vi.waitFor(()=>expect(adapter.dispose).toHaveBeenCalledOnce());}
 await expect(side.dispose()).rejects.toMatchObject({errors:[failure]});expect(adapter.dispose).toHaveBeenCalledOnce();
 await expect(side.dispose()).rejects.toMatchObject({errors:[failure]});
});
it('waits for late adapter cleanup that becomes known while another side owner is closing',async()=>{
 let resolveFactory!:(adapter:RuntimeAdapter)=>void,releaseFirst!:()=>void,releaseLate!:()=>void;const firstGate=new Promise<void>(done=>{releaseFirst=done;}),lateGate=new Promise<void>(done=>{releaseLate=done;}),factoryGate=new Promise<RuntimeAdapter>(done=>{resolveFactory=done;});
 const adapter=(gate:Promise<void>):RuntimeAdapter=>({configure:()=>{},models:async()=>[],start:async()=>{},followUp:async()=>{},cancel:async()=>{},compact:async()=>{},history:async()=>[],dispose:vi.fn(async()=>gate)});
 const first=adapter(firstGate),late=adapter(lateGate);let calls=0;const side=new SideRuntime(()=>calls++?factoryGate:first,{onEvent:()=>{},onTool:async()=>({})});
 const input={threadId:'first',runId:'run',epoch:1,modelId:'fixture/side',accountId:null,thinkingLevel:null,prompt:'Synthetic side',inputId:'input',inputIds:['input'],sessionPath:null,resources:[]} satisfies StartRun;
 await side.start(input);const pending=side.start({...input,threadId:'late'}).catch(()=>{});await vi.waitFor(()=>expect(calls).toBe(2));
 let finished=false;const closing=side.dispose().then(()=>{finished=true;});await vi.waitFor(()=>expect(first.dispose).toHaveBeenCalledOnce());resolveFactory(late);await vi.waitFor(()=>expect(late.dispose).toHaveBeenCalledOnce());releaseFirst();
 try{await new Promise(done=>setTimeout(done,10));expect(finished).toBe(false);}finally{releaseLate();await closing;await pending;}
});
it.each([false,true])('waits for its sole unresolved factory and reports late cleanup failure: %s',async(fails)=>{
 let resolveFactory!:(adapter:RuntimeAdapter)=>void,releaseCleanup!:()=>void;
 const factory=new Promise<RuntimeAdapter>(done=>{resolveFactory=done;}),cleanup=new Promise<void>(done=>{releaseCleanup=done;}),failure=new Error('Synthetic late cleanup failure');
 const adapter:RuntimeAdapter={configure:()=>{},models:async()=>[],start:async()=>{},followUp:async()=>{},cancel:async()=>{},compact:async()=>{},history:async()=>[],dispose:vi.fn(async()=>{await cleanup;if(fails)throw failure;})};
 const create=vi.fn(()=>factory),side=new SideRuntime(create,{onEvent:()=>{},onTool:async()=>({})});
 const input={threadId:'sole-late',runId:'run',epoch:1,modelId:'fixture/side',accountId:null,thinkingLevel:null,prompt:'Synthetic side',inputId:'input',inputIds:['input'],sessionPath:null,resources:[]} satisfies StartRun;
 const starting=side.start(input).catch(error=>error);await vi.waitFor(()=>expect(create).toHaveBeenCalledOnce());
 let completed=false;const closing=side.dispose().then(()=>{completed=true;return null;},error=>{completed=true;return error;});
 try{await new Promise(done=>setTimeout(done,10));expect(completed).toBe(false);}finally{resolveFactory(adapter);await vi.waitFor(()=>expect(adapter.dispose).toHaveBeenCalledOnce());releaseCleanup();}
 const result=await closing;await starting;if(fails)expect(result).toMatchObject({errors:[failure]});else expect(result).toBeNull();
});
