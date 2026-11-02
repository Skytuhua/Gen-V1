import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../packages/storage/store.ts";
import { Service } from "../packages/core/service.ts";
import type { RuntimeAdapter, RuntimeCallbacks, StartRun, Thread, ArtifactRecord } from "../packages/contracts/index.ts";
import { widgetDefinition } from "../packages/core/widgets.ts";
import {Value} from '@sinclair/typebox/value';
import type {TSchema} from '@sinclair/typebox';
import {UI_TOOLS} from '../packages/runtime-pi/tool-definitions.ts';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const fn of cleanup.splice(0).reverse()) await fn(); });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "harness-review-")), store = new Store(join(dir, "state"));
  let callbacks!: RuntimeCallbacks;
  const starts: StartRun[] = [], follows: StartRun[] = [];
  const runtime: RuntimeAdapter = { configure: c => { callbacks = c; }, models: async () => [{ id: "test/model", name: "Test", provider: "test" }], start: async i => { starts.push(i); }, followUp: async i => { follows.push(i); }, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
  const service = new Service(store, runtime); await service.recover();
  cleanup.push(async () => { await service.dispose(); store.close(); rmSync(dir, { recursive: true, force: true }); });
  const send = (type: string, payload: Record<string, unknown> = {}, threadId = thread.id, id = crypto.randomUUID()) => service.command({ id, type, payload, threadId });
  const thread = (await service.command({ id: crypto.randomUUID(), type: "thread.create", payload: {} })).result as Thread;
  const run = async () => { await send("message.send", { content: "Inspect", modelId: "test/model" }); return starts[0]; };
  const emit = (input: StartRun, type: string, extra: Record<string, unknown> = {}) => callbacks.onEvent({ threadId: input.threadId, runId: input.runId, epoch: input.epoch, type, ...extra });
  const present = async (input: StartRun, extra: Record<string, unknown> = {}) => {
    const p = await service.tool({ name: "ui_present", args: { spec: { root: "x", elements: { x: { type: "Text", props: { text: "Inspect" } } } }, ...extra } }, input) as { artifactId: string };
    return store.get<ArtifactRecord>("artifact", p.artifactId)!;
  };
  return { dir, store, runtime, service, send, thread, starts, follows, run, emit, present };
}

it("retains an undelivered follow-up when an earlier response settles", async () => {
  const x = await setup(), input = await x.run(), pending = deferred();
  x.emit(input, "input.processing", { inputIds: input.inputIds });
  x.emit(input, "assistant.message", { messageId: "first", content: "First response", inputIds: input.inputIds });
  x.runtime.followUp = async i => { x.follows.push(i); await pending.promise; };
  await x.send("message.send", { content: "Not accepted yet", modelId: "test/model" });
  x.emit(input, "settled", { aborted: false }); pending.resolve();
  const outbox = x.store.all<{ id: string; status: string; enteredRuntime?: boolean }>("outbox");
  expect(outbox.find(i => i.id === input.inputId)?.status).toBe("handled");
  expect(outbox.find(i => i.id === x.follows[0].inputId)).toMatchObject({ status: "processing", enteredRuntime: false });
  expect(x.store.get<Thread>("thread",x.thread.id)?.status).toBe("interrupted");
});

it("cancels the original context when runtime failure clears its run identity",async()=>{
 const x=await setup(),input=await x.run();const cancel=vi.spyOn(x.runtime,"cancel");
 x.emit(input,"error",{message:"Follow-up rejected"});
 expect(x.store.get<Thread>("thread",x.thread.id)?.status).toBe("interrupted");
 expect(cancel).toHaveBeenCalledWith({threadId:input.threadId,runId:input.runId,epoch:input.epoch});
});

it("parks input arriving after a completion claim and requires a fresh claim for it",async()=>{
 const x=await setup(),input=await x.run();x.emit(input,"input.processing",{inputIds:input.inputIds});
 await x.service.tool({name:"task_finish",args:{summary:"First input done"}},input);
 await x.send("message.send",{content:"New work",modelId:"test/model"});
 expect(x.follows).toHaveLength(0);
 x.emit(input,"settled",{aborted:false});expect(x.starts).toHaveLength(2);
 const next=x.starts[1];x.emit(next,"input.processing",{inputIds:next.inputIds});x.emit(next,"assistant.message",{content:"Partial work",inputIds:next.inputIds});x.emit(next,"settled",{aborted:false});
 expect(x.store.get<Thread>("thread",x.thread.id)?.status).toBe("ready");
});

it("stores immutable submitted values and displayed data with accepted actions", async () => {
  const x = await setup(), input = await x.run(), data = x.service.publishData(x.thread.id, { amount: 5 }, "source:test");
  const artifact = await x.present(input, { actions: { choose: { kind: "agent", prompt: "Choose" } }, bindings: { source: { mode: "snapshot", ref: { id: data.id, revision: 1 } } } });
  const id = crypto.randomUUID();
  await x.send("action.submit", { artifactId: artifact.id, revision: 1, actionId: "choose", payload: { choice: "A" }, submittedState: { amount: 10 }, baseStateRevision: 0, dataRevisions: { [data.id]: 1 } }, x.thread.id, id);
  await x.send("state.save", { stateId: artifact.stateId, baseRevision: 1, clientId: "later", clientSequence: 1, values: { amount: 20 } });
  expect(x.store.get("acceptedAction", id)).toMatchObject({ artifactId: artifact.id, artifactRevision: 1, actionId: "choose", submittedState: { amount: 10 }, dataRevisions: { [data.id]: 1 } });
  expect(x.follows[0].prompt).toContain('"amount":10');
});

it("requires the edit owner before accepting replacement submitted state",async()=>{
 const x=await setup(),input=await x.run(),artifact=await x.present(input,{actions:{choose:{kind:"agent"}}});
 await x.send("edit.begin",{stateId:artifact.stateId,clientId:"owner"});
 const submit={artifactId:artifact.id,revision:1,actionId:"choose",payload:{},submittedState:{note:"accepted"},baseStateRevision:0};
 await expect(x.send("action.submit",{...submit,clientId:"other"})).rejects.toMatchObject({code:"USER_EDIT_CONFLICT"});
 await expect(x.send("action.submit",{...submit,clientId:"owner"})).resolves.toMatchObject({result:{inputId:expect.any(String)}});
});

it("reopens a completed task when an agent action is accepted", async () => {
  const x = await setup(), input = await x.run(), artifact = await x.present(input, { actions: { next: { kind: "agent" } } });
  x.emit(input, "input.processing", { inputIds: input.inputIds });
  await x.service.tool({ name: "task_finish", args: { summary: "Done" } }, input);
  x.emit(input, "settled", { aborted: false });
  expect(x.store.get<Thread>("thread", x.thread.id)?.status).toBe("completed");
  await x.send("action.submit", { artifactId: artifact.id, revision: 1, actionId: "next", payload: {} });
  expect(x.starts).toHaveLength(2);
});

it("enforces client lease ownership on widget checkpoints", async () => {
  const x = await setup(), input = await x.run();
  const restored = await x.present(input);
  const a = { artifactId: restored.id, stateId: restored.stateId };
  // Restore an existing record to test checkpoint ownership while new app
  // execution is held behind its independent browser-isolation gate.
  x.store.internal("fixture.widget-restored",x.thread.id,()=>x.store.put("artifact",restored.id,x.thread.id,{...restored,kind:"widget",widget:widgetDefinition({html:"<p>Novel</p>",inputSchema:{},eventSchema:{},stateSchema:{type:"object"}})}));
  await x.send("edit.begin", { stateId: a.stateId, clientId: "owner" });
  await expect(x.send("widget.checkpoint", { artifactId: a.artifactId, revision: 1, stateSchemaVersion: 1, baseStateRevision: 0, values: { draft: "overwrite" }, clientId: "other" })).rejects.toMatchObject({ code: "USER_EDIT_CONFLICT" });
  await expect(x.send("widget.checkpoint", { artifactId: a.artifactId, revision: 1, stateSchemaVersion: 1, baseStateRevision: 0, values: { draft: "saved" }, clientId: "owner" })).resolves.toMatchObject({ result: { values: { draft: "saved" } } });
});

it("does not overwrite a Stop that races with model discovery during resume", async () => {
  const x = await setup(); await x.run(); await x.send("run.stop");
  const pending = deferred(), original = x.runtime.models;
  x.runtime.models = async () => { await pending.promise; return original(); };
  const resume = x.send("run.resume"); await x.send("run.stop"); pending.resolve();
  await expect(resume).rejects.toMatchObject({ code: "CANCELLED_RUN" });
  expect(x.store.get<Thread>("thread", x.thread.id)?.status).toBe("stopped");
});

it("keeps completed task state when a separate compaction run settles",async()=>{
 const x=await setup(),input=await x.run();
 x.emit(input,"session",{sessionPath:"fixture-session.jsonl"});
 x.emit(input,"input.processing",{inputIds:input.inputIds});
 await x.service.tool({name:"task_finish",args:{summary:"Done"}},input);x.emit(input,"settled",{aborted:false});
 await x.send("run.compact");
 const compact=x.store.get<Thread>("thread",x.thread.id)!;
 x.emit({...input,runId:compact.runId!,epoch:compact.epoch},"settled",{aborted:false});
 expect(x.store.get<Thread>("thread",x.thread.id)?.status).toBe("completed");
});

it("queues input during compaction for a fresh task run after maintenance settles",async()=>{
 const x=await setup(),input=await x.run();x.emit(input,"session",{sessionPath:"fixture-session.jsonl"});x.emit(input,"input.processing",{inputIds:input.inputIds});
 await x.service.tool({name:"task_finish",args:{summary:"Done"}},input);x.emit(input,"settled",{aborted:false});
 await x.send("run.compact");const compact=x.store.get<Thread>("thread",x.thread.id)!;
 const result=await x.send("message.send",{content:"Queued after maintenance",modelId:"test/model"});
 expect(x.store.get("outbox",(result.result as {inputId:string}).inputId)).toMatchObject({status:"persisted",runId:null});
 expect(x.follows).toHaveLength(0);
 x.emit({...input,runId:compact.runId!,epoch:compact.epoch},"settled",{aborted:false});
 expect(x.starts).toHaveLength(2);expect(x.starts[1].runId).not.toBe(compact.runId);
 expect(x.store.get<Thread>("thread",x.thread.id)?.status).toBe("working");
});

it("never grants a stopped async domain tool the authority of a resumed run", async () => {
  const x = await setup(), input = await x.run(), pending = deferred();
  const domain = await import("../packages/capabilities/index.ts");
  vi.spyOn(domain, "handleDomainTool").mockImplementation(async (_name, _args, ctx) => { await pending.promise; return ctx.publishData({ unauthorized: true }, "late"); });
  const tool = x.service.tool({ name: "text_import", args: {} }, input);
  await Promise.resolve(); await x.send("run.stop"); await x.send("run.resume"); pending.resolve();
  await expect(tool).rejects.toMatchObject({ code: "CANCELLED_RUN" });
  expect(x.store.all("data")).toHaveLength(0);
});

it("drops late process progress after Stop without throwing from an event callback",async()=>{
 const x=await setup(),input=await x.run(),pending=deferred();let context:Parameters<typeof import('../packages/capabilities/index.ts').handleDomainTool>[2]|undefined;
 const domain=await import('../packages/capabilities/index.ts');
 vi.spyOn(domain,"handleDomainTool").mockImplementation(async(_name,_args,ctx)=>{context=ctx;await pending.promise;return null;});
 const tool=x.service.tool({name:"repository_status",args:{}},input);
 await expect.poll(()=>!!context).toBe(true);await x.send("run.stop");
 try{expect(()=>context!.progress("Late process exit")).not.toThrow();expect(x.store.all<{content:string}>("message").some(m=>m.content==="Late process exit")).toBe(false);}finally{pending.resolve();await tool;}
});

it("rejects a grant retargeted through a directory junction", async () => {
  const x = await setup(), granted = join(x.dir, "granted"), outside = join(x.dir, "outside");
  mkdirSync(granted); mkdirSync(outside); writeFileSync(join(outside, "private.txt"), "private");
  const grant = (await x.send("resource.grant", { path: granted, kind: "project" })).result as { id: string };
  renameSync(granted, granted + "-old"); symlinkSync(outside, granted, "junction");
  await expect(x.service.resolveResource(x.thread.id, grant.id, "private.txt")).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
});

it("protects physical credentials when storage was selected through a junction", async () => {
  const x = await setup(), physical = join(x.dir, "physical"), alias = join(x.dir, "alias");
  mkdirSync(physical); symlinkSync(physical, alias, "junction");
  const store = new Store(alias), service = new Service(store, x.runtime);
  cleanup.push(async () => { await service.dispose(); store.close(); });
  mkdirSync(join(physical, "pi")); writeFileSync(join(physical, "pi", "auth.json"), "protected");
  const thread = (await service.command({ id: crypto.randomUUID(), type: "thread.create", payload: {} })).result as Thread;
  await expect(service.command({ id: crypto.randomUUID(), type: "resource.grant", threadId: thread.id, payload: { path: join(physical, "pi", "auth.json"), kind: "file" } })).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
});

async function decisionActionFixture(){
 const x=await setup(),input=await x.run();
 const responseSchema={type:'object',properties:{approve:{type:'boolean'}},required:['approve'],additionalProperties:false};
 const request=await x.service.tool({name:'ui_request_input',args:{title:'Read-only analysis?',prompt:'Review the supplied information',responseSchema}},input) as {requestId:string};
 const artifact=await x.present(input,{title:'Read-only review',spec:{root:'decision',elements:{decision:{type:'Button',props:{label:'Use read-only analysis',actionId:'decide'}}}},actions:{decide:{kind:'request',requestId:request.requestId}}});
 const change=()=>x.service.tool({name:'ui_request_input',args:{requestId:request.requestId,baseRevision:1,title:'Allow changes?',prompt:'Review a different scope',responseSchema}},input);
 return {...x,input,request,artifact,change};
}
it('rejects an artifact decision after the underlying request changes without consuming or saving it',async()=>{
 const x=await decisionActionFixture();await x.change();const count=x.store.all('acceptedAction').length;
 await expect(x.send('action.submit',{artifactId:x.artifact.id,revision:x.artifact.revision,actionId:'decide',payload:{approve:true},baseStateRevision:0,submittedState:{note:'stale'}})).rejects.toMatchObject({code:'STALE_REQUEST'});
 expect(x.store.get('request',x.request.requestId)).toMatchObject({revision:2,status:'pending'});expect(x.store.all('acceptedAction')).toHaveLength(count);expect(x.store.get('userState',x.artifact.stateId)).toMatchObject({revision:0,values:{}});
});
it('does not refresh a decision binding during an unrelated artifact update',async()=>{
 const x=await decisionActionFixture();await x.change();
 await x.service.tool({name:'ui_present',args:{artifactId:x.artifact.id,baseRevision:1,title:'Review context',spec:x.artifact.spec}},x.input);
 await expect(x.send('action.submit',{artifactId:x.artifact.id,revision:2,actionId:'decide',payload:{approve:true}})).rejects.toMatchObject({code:'STALE_REQUEST'});
});
it('pins an explicitly republished request action to the current decision and preserves its accepted revision',async()=>{
 const x=await decisionActionFixture();await x.change();
 await x.service.tool({name:'ui_present',args:{artifactId:x.artifact.id,baseRevision:1,title:'Review changes',spec:x.artifact.spec,actions:{decide:{kind:'request',requestId:x.request.requestId}}}},x.input);
 let artifact=x.store.get<ArtifactRecord>('artifact',x.artifact.id)!;expect(artifact.actions.decide).toMatchObject({requestRevision:2});
 const inspection=await x.service.tool({name:'ui_inspect',args:{artifactId:artifact.id}},x.input) as {artifact:ArtifactRecord};
 const inspected=inspection.artifact;
 const roundTrip={artifactId:artifact.id,baseRevision:artifact.revision,spec:inspected.spec,actions:inspected.actions};
 expect(Value.Check(UI_TOOLS.find(tool=>tool.name==='ui_present')!.parameters as TSchema,roundTrip)).toBe(true);
 await x.service.tool({name:'ui_present',args:roundTrip},x.input);artifact=x.store.get<ArtifactRecord>('artifact',artifact.id)!;
 await x.send('action.submit',{artifactId:artifact.id,revision:artifact.revision,actionId:'decide',payload:{approve:true}});
 expect(x.store.get('request',x.request.requestId)).toMatchObject({revision:3,status:'accepted',response:{approve:true}});
 expect(x.store.all<{content:string}>('outbox').some(item=>item.content.includes('"requestRevision":2'))).toBe(true);
});
it('rejects explicitly stale decision bindings and historical actions without a revision',async()=>{
 const x=await decisionActionFixture();await x.change();
 await expect(x.service.tool({name:'ui_present',args:{artifactId:x.artifact.id,baseRevision:1,spec:x.artifact.spec,actions:{decide:{kind:'request',requestId:x.request.requestId,requestRevision:1}}}},x.input)).rejects.toMatchObject({code:'STALE_REQUEST'});
 const artifact=x.store.get<ArtifactRecord>('artifact',x.artifact.id)!;delete artifact.actions.decide.requestRevision;
 x.store.internal('fixture.legacy-action',x.thread.id,()=>x.store.put('artifact',artifact.id,x.thread.id,artifact));
 await expect(x.send('action.submit',{artifactId:artifact.id,revision:artifact.revision,actionId:'decide',payload:{approve:true}})).rejects.toMatchObject({code:'STALE_REQUEST'});
 expect(x.store.get('request',x.request.requestId)).toMatchObject({revision:2,status:'pending'});
});
