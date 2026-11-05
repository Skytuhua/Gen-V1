import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Service } from "../packages/core/service.ts";
import { Store } from "../packages/storage/store.ts";
import type { RuntimeAdapter, RuntimeCallbacks, RunContext, StartRun, ArtifactRecord, Thread } from "../packages/contracts/index.ts";
const cleanups: (() => Promise<void>)[] = [];
afterEach(async()=>{for(const cleanup of cleanups.splice(0))await cleanup()});
async function setup() {
 const base=mkdtempSync(join(tmpdir(),"harness-service-")); const store=new Store(join(base,"state"));
 let callbacks:RuntimeCallbacks; let run:StartRun;
 const runtime:RuntimeAdapter={configure:c=>{callbacks=c},models:async()=>[{id:"test/model",provider:"test",name:"Test model"}],start:async r=>{run=r},followUp:async()=>{},cancel:async()=>{},compact:async()=>{},history:async()=>[],dispose:async()=>{}};
 const service=new Service(store,runtime); await service.recover();
 cleanups.push(async()=>{await service.dispose();store.close();rmSync(base,{recursive:true,force:true})});
 const send=(type:string,payload:Record<string,unknown>={},threadId?:string,id=crypto.randomUUID())=>service.command({id,type,payload,threadId});
 const first=await send("thread.create",{title:"A"}); const threadId=(first.result as Thread).id;
 return {service,store,base,send,threadId,events:()=>callbacks!,run:()=>run!,ctx:()=>({threadId,runId:run.runId,epoch:run.epoch}) as RunContext};
}
const spec={root:"main",elements:{main:{type:"Text",props:{text:"Evidence"}}}};
describe("thread and UI integrity",()=>{
 it('rejects an async decision schema before publishing a pending request',async()=>{
  const x=await setup();await x.send('message.send',{content:'Ask',modelId:'test/model'},x.threadId);
  await expect(x.service.tool({name:'ui_request_input',args:{title:'Choose',prompt:'Choose a value',responseSchema:{$async:true,type:'string',const:'allow'}}},x.ctx())).rejects.toMatchObject({code:'INVALID_SCHEMA'});
  expect(x.store.all('request',x.threadId)).toEqual([]);
 });
 it('retains a recovered async request without accepting its invalid response',async()=>{
  const x=await setup();await x.send('message.send',{content:'Ask',modelId:'test/model'},x.threadId);
  const request=await x.service.tool({name:'ui_request_input',args:{title:'Choose',prompt:'Choose a value',responseSchema:{type:'string',const:'allow'}}},x.ctx()) as {requestId:string;revision:number};
  x.store.internal('fixture.legacy-schema',x.threadId,()=>{const saved=x.store.get<Record<string,unknown>>('request',request.requestId)!;x.store.put('request',request.requestId,x.threadId,{...saved,responseSchema:{$async:true,type:'string',const:'allow'}});});
  await expect(x.send('request.respond',{requestId:request.requestId,revision:request.revision,response:'deny'},x.threadId)).rejects.toMatchObject({code:'INVALID_SCHEMA'});
  expect(x.store.get('request',request.requestId)).toMatchObject({status:'pending',revision:request.revision});
 });
 it('updates settings without materializing unrelated workspace content',async()=>{
  const x=await setup(),snapshot=vi.spyOn(x.store,'snapshot').mockImplementation(()=>{throw new Error('Unrelated workspace must not be read');});
  try {
   await x.send('settings.update',{theme:'light',modelId:'test/model',preferences:{chatWidth:'comfortable'}});
   expect(x.store.get('settings','global')).toMatchObject({theme:'light',modelId:'test/model',preferences:{chatWidth:'comfortable'}});
   await expect(x.send('settings.update',{preferences:{unsupported:true}})).rejects.toMatchObject({code:'INVALID_INPUT'});
   expect(snapshot).not.toHaveBeenCalled();
  } finally {snapshot.mockRestore();}
 });
 it("stores retry receipts only for UI tool calls with an explicit reusable command ID",async()=>{
  const x=await setup();await x.send("message.send",{content:"Inspect",modelId:"test/model"},x.threadId);
  const count=()=>Number((x.store.db.prepare("SELECT count(*) AS n FROM receipts").get() as {n:number}).n),before=count();
  await x.service.tool({name:"ui_present",args:{title:"Fresh surface",spec}},x.ctx());expect(count()).toBe(before);
  const call={name:"ui_present",args:{commandId:"repeatable-ui",title:"Retryable surface",spec}};
  const first=await x.service.tool(call,x.ctx());expect(await x.service.tool(call,x.ctx())).toEqual(first);expect(count()).toBe(before+1);
  await expect(x.service.tool({...call,args:{...call.args,title:"Changed"}},x.ctx())).rejects.toMatchObject({code:"DUPLICATE_COMMAND"});
 });
 it("admits three main threads and rejects a fourth without acknowledging its draft",async()=>{
  const x=await setup();await x.send("message.send",{content:"Inspect",modelId:"test/model"},x.threadId);
  const ids:string[]=[];for(const title of ['B','C','D'])ids.push(((await x.send('thread.create',{title})).result as Thread).id);
  for(const id of ids.slice(0,2))await x.send('message.send',{content:'Other',modelId:'test/model'},id);
  const id=ids[2];
  await expect(x.send("message.send",{content:"Other",modelId:"test/model"},id)).rejects.toMatchObject({code:"RUN_BUSY"});
  expect(x.store.all("message",id)).toHaveLength(0);
 });

 it('rejects user sends and run mutations against read-only delegate threads',async()=>{
  const x=await setup(),parent=x.store.get<Thread>('thread',x.threadId)!;x.store.internal('fixture.delegate',parent.id,()=>x.store.put('thread','delegate','delegate',{...parent,id:'delegate',kind:'delegate',parentThreadId:parent.id,jobId:'job'}));
  for(const type of ['message.send','run.resume','run.stop','run.compact','resource.grant','thread.mode'])await expect(x.send(type,{content:'forged',modelId:'test/model'},'delegate')).rejects.toMatchObject({code:'DELEGATE_READ_ONLY'});
  expect(x.store.all('outbox','delegate')).toEqual([]);
 });
 it("rejects late presentation after Stop while leaving committed UI intact",async()=>{
  const x=await setup();await x.send("message.send",{content:"Inspect",modelId:"test/model"},x.threadId);
  await x.service.tool({name:"ui_present",args:{commandId:"present",title:"Evidence",spec}},x.ctx());
  await x.send("run.stop",{},x.threadId);
  await expect(x.service.tool({name:"ui_present",args:{commandId:"late",title:"Late",spec}},x.ctx())).rejects.toMatchObject({code:"CANCELLED_RUN"});
  expect(x.store.all<ArtifactRecord>("artifact",x.threadId)[0].title).toBe("Evidence");
 });
 it("keeps pending decisions reachable after an artifact is archived and blocks mutations",async()=>{
  const x=await setup();await x.send("message.send",{content:"Inspect",modelId:"test/model"},x.threadId);
  const presented=await x.service.tool({name:"ui_present",args:{commandId:"present",title:"Evidence",spec}},x.ctx()) as {artifactId:string};
  await x.service.tool({name:"ui_request_input",args:{commandId:"ask",artifactId:presented.artifactId,title:"Choose",prompt:"Which?",responseSchema:{type:"object",properties:{choice:{type:"string"}},required:["choice"]}}},x.ctx());
  await x.send("artifact.archive",{artifactId:presented.artifactId},x.threadId);
  expect(x.store.snapshot().requests[0].status).toBe("pending");
  expect(x.service.hasGate(x.threadId)).toBe(true);
 });
 it("rejects incompatible updates under edit protection and preserves values",async()=>{
  const x=await setup();await x.send("message.send",{content:"Inspect",modelId:"test/model"},x.threadId);
  const p=await x.service.tool({name:"ui_present",args:{commandId:"present",title:"Evidence",spec}},x.ctx()) as {artifactId:string};
  const artifact=x.store.get<ArtifactRecord>("artifact",p.artifactId)!;
  await x.send("edit.begin",{stateId:artifact.stateId,fields:["note"],clientId:"client"},x.threadId);
  await expect(x.service.tool({name:"ui_present",args:{commandId:"replace",artifactId:artifact.id,baseRevision:1,title:"Changed",spec:{root:"x",elements:{x:{type:"Text",props:{text:"Changed"}}}}}},x.ctx())).rejects.toMatchObject({code:"USER_EDIT_CONFLICT"});
  const saved=await x.send("state.save",{stateId:artifact.stateId,baseRevision:0,values:{note:"Keep this"},clientId:"client",clientSequence:1},x.threadId);
  expect(saved.result).toMatchObject({values:{note:"Keep this"}});
 });
 it("rejects cross-thread bindings and invalid specs without a new revision",async()=>{
  const x=await setup();await x.send("message.send",{content:"Inspect",modelId:"test/model"},x.threadId);
  await expect(x.service.tool({name:"ui_present",args:{commandId:"bad",spec:{root:"no",elements:{}}}},x.ctx())).rejects.toMatchObject({code:"INVALID_SPEC"});
  expect(x.store.all("artifact")).toHaveLength(0);
 });
 it("rejects missing value-relative binding paths while retaining the last usable artifact",async()=>{
  const x=await setup();await x.send("message.send",{content:"Inspect",modelId:"test/model"},x.threadId);
  const data=x.service.publishData(x.threadId,{title:"Relationship",value:{nodes:[],edges:[]},sources:[]},"source:test");
  const first=await x.service.tool({name:"ui_present",args:{spec,bindings:{graph:{mode:"snapshot",ref:{id:data.id,revision:1,pointer:"/value"}}}}},x.ctx()) as {artifactId:string};
  await expect(x.service.tool({name:"ui_present",args:{artifactId:first.artifactId,baseRevision:1,spec,bindings:{graph:{mode:"snapshot",ref:{id:data.id,revision:1,pointer:"/value/value"}}}}},x.ctx())).rejects.toMatchObject({code:"INVALID_DATA_REF",message:expect.stringContaining("relative to data.value")});
  expect(x.store.get<ArtifactRecord>("artifact",first.artifactId)?.revision).toBe(1);
 });
 it("preserves an admitted presentation and rejects a foreign document without replacing it",async()=>{
  const x=await setup();await x.send("message.send",{content:"Inspect",modelId:"test/model"},x.threadId);
  const first=await x.service.tool({name:"ui_present",args:{title:"Source",spec,presentation:{width:"compact",frame:"canvas"}}},x.ctx()) as {artifactId:string};
  expect(x.store.get<ArtifactRecord>("artifact",first.artifactId)).toMatchObject({presentation:{width:"compact",frame:"canvas"}});
  x.store.internal("fixture",null,()=>{x.store.put("resource","foreign","another-thread",{id:"foreign",threadId:"another-thread",path:"C:\\foreign.pdf",kind:"file",label:"Foreign",writable:false,createdAt:new Date().toISOString()});return null;});
  await expect(x.service.tool({name:"ui_present",args:{artifactId:first.artifactId,baseRevision:1,spec:{root:"doc",elements:{doc:{type:"Document",props:{resourceId:"foreign"}}}}}},x.ctx())).rejects.toMatchObject({code:"CAPABILITY_DENIED"});
  expect(x.store.get<ArtifactRecord>("artifact",first.artifactId)?.revision).toBe(1);
  await expect(x.service.tool({name:"ui_present",args:{artifactId:first.artifactId,baseRevision:1,spec,presentation:{width:"fullscreen",frame:"card"}}},x.ctx())).rejects.toMatchObject({code:"INVALID_SPEC"});
  await x.service.tool({name:"ui_present",args:{artifactId:first.artifactId,baseRevision:1,spec}},x.ctx());
  expect(x.store.get<ArtifactRecord>("artifact",first.artifactId)).toMatchObject({revision:2,presentation:{width:"compact",frame:"canvas"}});
 });
 it("supports selected files without a project and denies its own storage",async()=>{
  const x=await setup();const file=join(x.base,"source.txt");writeFileSync(file,"Source");
  const grant=await x.send("resource.grant",{path:file,kind:"file"},x.threadId) as {result:{id:string}};
  expect(await x.service.resolveResource(x.threadId,grant.result.id)).toBe(file);
  await expect(x.send("resource.grant",{path:join(x.base,"state","harness.sqlite"),kind:"database"},x.threadId)).rejects.toMatchObject({code:"CAPABILITY_DENIED"});
 });
 it("restores interrupted tasks without model calls or auto resume",async()=>{
  const x=await setup();await x.send("message.send",{content:"Inspect",modelId:"test/model"},x.threadId);
  await x.service.recover();
  expect(x.store.get<Thread>("thread",x.threadId)?.status).toBe("interrupted");
  expect(x.store.snapshot().activeThreadId).toBeNull();
 });
 it("records a completed effect arriving after Stop without reviving its run",async()=>{
  const x=await setup(), filename=join(x.base,"source.txt");writeFileSync(filename,"before");
  const hash=createHash("sha256").update("before").digest("hex");
  const grant=await x.send("resource.grant",{path:filename,kind:"file",writable:true},x.threadId) as {result:{id:string}};
  await x.send("message.send",{content:"Prepare",modelId:"test/model"},x.threadId);
  const op=await x.service.tool({name:"file_replace_prepare",args:{resourceId:grant.result.id,expectedSha256:hash,content:"after"}},x.ctx()) as {id:string;revision:number};
  let terminal!:(status:string)=>void;const completed=new Promise<string>(resolve=>{terminal=resolve});
  const unsubscribe=x.store.subscribe(event=>{if(event.type==="data.published"&&x.store.all<{provenance:string}>("data").some(d=>d.provenance.includes("operation:"+op.id)))void x.send("run.stop",{},x.threadId);if(event.type==='operation.succeeded'||event.type==='operation.failed'){const status=x.store.get<{status:string}>('operation',op.id)?.status;if(status&&status!=='running'&&status!=='prepared')terminal(status);}});
  await x.send("operation.approve",{operationId:op.id,revision:op.revision},x.threadId);
  // Wait for the committed result, not a one-second polling budget for a cold
  // Windows helper. The test asserts Stop/receipt ordering rather than latency.
  expect(await completed).toBe('succeeded');unsubscribe();
  expect(readFileSync(filename,"utf8")).toBe("after");expect(x.store.get<Thread>("thread",x.threadId)?.status).toBe("stopped");
  expect(await x.service.resolveResource(x.threadId,grant.result.id)).toBe(filename);
 });
 it("a generated operation button leads to native approval and cannot approve by its label",async()=>{
  const x=await setup(), filename=join(x.base,"source.txt");writeFileSync(filename,"before");
  const grant=await x.send("resource.grant",{path:filename,kind:"file",writable:true},x.threadId) as {result:{id:string}};
  await x.send("message.send",{content:"Prepare",modelId:"test/model"},x.threadId);
  const op=await x.service.tool({name:"file_replace_prepare",args:{resourceId:grant.result.id,expectedSha256:createHash("sha256").update("before").digest("hex"),content:"after"}},x.ctx()) as {id:string};
  const shown=await x.service.tool({name:"ui_present",args:{commandId:"button",spec:{root:"b",elements:{b:{type:"Button",props:{label:"Continue",actionId:"continue"}}}},actions:{continue:{kind:"operation",operationId:op.id}}}},x.ctx()) as {artifactId:string;revision:number};
  const receipt=await x.send("action.submit",{artifactId:shown.artifactId,revision:shown.revision,actionId:"continue",payload:{}},x.threadId);
  expect(receipt.result).toMatchObject({approvalRequired:true});expect(x.store.get<{approved:boolean}>("operation",op.id)?.approved).toBe(false);expect(readFileSync(filename,"utf8")).toBe("before");
 });
 it("accepts a decision atomically once and parks the response after Stop",async()=>{
  const x=await setup();await x.send("message.send",{content:"Ask",modelId:"test/model"},x.threadId);
  const request=await x.service.tool({name:"ui_request_input",args:{commandId:"ask",title:"Choice",prompt:"Choose",responseSchema:{type:"object",required:["choice"],properties:{choice:{type:"string"}}}}},x.ctx()) as {requestId:string;revision:number};
  await x.send("run.stop",{},x.threadId);
  await x.send("request.respond",{requestId:request.requestId,revision:request.revision,response:{choice:"A"}},x.threadId);
  await expect(x.send("request.respond",{requestId:request.requestId,revision:request.revision,response:{choice:"A"}},x.threadId)).rejects.toMatchObject({code:"STALE_REQUEST"});
  expect(x.store.get<Thread>("thread",x.threadId)?.status).toBe("stopped");expect(x.store.all<{status:string}>("outbox",x.threadId).filter(i=>i.status==="persisted")).toHaveLength(1);
 });
 it("patches stable specs and retains pinned data versions while live data advances",async()=>{
  const x=await setup();await x.send("message.send",{content:"Inspect",modelId:"test/model"},x.threadId);
  const data=x.service.publishData(x.threadId,{text:"Old"},"source:test");
  const p=await x.service.tool({name:"ui_present",args:{commandId:"first",title:"Evidence",spec,bindings:{evidence:{mode:"snapshot",ref:{id:data.id,revision:1}}}}},x.ctx()) as {artifactId:string};
  await x.service.tool({name:"ui_present",args:{commandId:"patch",artifactId:p.artifactId,baseRevision:1,patches:[{op:"replace",path:"/elements/main/props/text",value:"Updated"}]}},x.ctx());
  expect(x.store.get<ArtifactRecord>('artifact',p.artifactId)?.title).toBe('Evidence');
  x.store.internal("data.changed",x.threadId,()=>x.store.put("data",data.id,x.threadId,{...data,revision:2,value:{text:"New"}}));
  expect(x.store.snapshot().data.filter(d=>d.id===data.id).map(d=>d.revision).sort()).toEqual([1,2]);
  expect(x.store.get<ArtifactRecord>("artifact",p.artifactId)?.spec?.elements.main.props.text).toBe("Updated");
 });
});
