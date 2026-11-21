import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Service } from "../packages/core/service.ts";
import { Store } from "../packages/storage/store.ts";
import type { RuntimeAdapter, RuntimeCallbacks, RunContext, StartRun, Thread, TurnTimingV1 } from "../packages/contracts/index.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async()=>{for(const cleanup of cleanups.splice(0))await cleanup()});

async function setup() {
 const base=mkdtempSync(join(tmpdir(),"harness-turn-")); const store=new Store(join(base,"state"));
 let callbacks:RuntimeCallbacks; let run:StartRun;
 const runtime:RuntimeAdapter={configure:c=>{callbacks=c},models:async()=>[{id:"test/model",provider:"test",name:"Test model"}],start:async r=>{run=r},followUp:async()=>{},cancel:async()=>{},compact:async()=>{},history:async()=>[],dispose:async()=>{}};
 const service=new Service(store,runtime); await service.recover();
 cleanups.push(async()=>{await service.dispose();store.close();rmSync(base,{recursive:true,force:true})});
 const send=(type:string,payload:Record<string,unknown>={},threadId?:string,id=crypto.randomUUID())=>service.command({id,type,payload,threadId});
 const first=await send("thread.create",{title:"A"}); const threadId=(first.result as Thread).id;
 const event=(type:string,extra:Record<string,unknown>={},forThread=threadId)=>callbacks.onEvent({threadId:forThread,runId:run.runId,epoch:run.epoch,type,...extra} as Parameters<RuntimeCallbacks['onEvent']>[0]);
 const settle=async(inputIds=run.inputIds,extra:Record<string,unknown>={})=>{
  event('input.processing',{inputIds});
  event('assistant.message',{messageId:crypto.randomUUID(),content:'Done.',inputIds});
  event('settled',extra);
 };
 const timing=()=>store.all<TurnTimingV1>('turnTiming',threadId);
 return {service,store,send,threadId,run:()=>run,event,settle,timing};
}

describe("turn timing records",()=>{
 it('records one completed record for a run that settles resolved',async()=>{
  const x=await setup();
  await x.send('message.send',{content:'Go',modelId:'test/model'},x.threadId);
  await x.settle();
  expect(x.timing()).toHaveLength(1);
  expect(x.timing()[0]).toMatchObject({runId:x.run().runId,outcome:'completed'});
  expect(x.timing()[0]!.endedAt!>=x.timing()[0]!.startedAt).toBe(true);
 });
 it('records stopped for run.stop and for an aborted settle',async()=>{
  const x=await setup();
  await x.send('message.send',{content:'Go',modelId:'test/model'},x.threadId);
  await x.send('run.stop',{},x.threadId);
  expect(x.timing()).toHaveLength(1);expect(x.timing()[0]!.outcome).toBe('stopped');
  const second=await x.send('thread.create',{title:'B'}); const threadId=(second.result as Thread).id;
  await x.send('message.send',{content:'Go',modelId:'test/model'},threadId);
  x.event('input.processing',{inputIds:x.run().inputIds},threadId);
  x.event('settled',{aborted:true},threadId);
  const b=x.store.all<TurnTimingV1>('turnTiming',threadId);
  expect(b).toHaveLength(1);expect(b[0]!.outcome).toBe('stopped');
 });
 it('records interrupted for a settle that leaves inputs unresolved',async()=>{
  const x=await setup();
  await x.send('message.send',{content:'Go',modelId:'test/model'},x.threadId);
  x.event('input.processing',{inputIds:x.run().inputIds});
  x.event('settled');
  expect(x.timing()[0]!.outcome).toBe('interrupted');
 });
 it('records failed for a runtime failure and interrupted on host recovery',async()=>{
  const x=await setup();
  await x.send('message.send',{content:'Go',modelId:'test/model'},x.threadId);
  (x.service as unknown as {runtimeFailure(ctx:RunContext,error:unknown):void}).runtimeFailure({threadId:x.threadId,runId:x.run().runId,epoch:x.run().epoch},new Error('boom'));
  expect(x.timing()[0]!.outcome).toBe('failed');
  const second=await x.send('thread.create',{title:'B'}); const threadId=(second.result as Thread).id;
  await x.send('message.send',{content:'Go',modelId:'test/model'},threadId);
  await x.service.recover();
  const b=x.store.all<TurnTimingV1>('turnTiming',threadId);
  expect(b).toHaveLength(1);expect(b[0]!.outcome).toBe('interrupted');
 });
 it('keeps the first end when a second end path fires',async()=>{
  const x=await setup();
  await x.send('message.send',{content:'Go',modelId:'test/model'},x.threadId);
  await x.settle();
  const ended=x.timing()[0]!.endedAt;
  (x.service as unknown as {endTurn(r:string,t:string,o:string):void}).endTurn(x.run().runId,x.threadId,'failed');
  expect(x.timing()[0]!.endedAt).toBe(ended);expect(x.timing()[0]!.outcome).toBe('completed');
 });
 it('keeps one record when a follow-up joins the running run',async()=>{
  const x=await setup();
  await x.send('message.send',{content:'Go',modelId:'test/model'},x.threadId);
  const started=x.timing()[0]!.startedAt;
  await x.send('message.send',{content:'More',modelId:'test/model'},x.threadId);
  expect(x.timing()).toHaveLength(1);expect(x.timing()[0]!.startedAt).toBe(started);
 });
 it('creates no record for a compaction run',async()=>{
  const x=await setup();
  x.store.internal('fixture.compaction-intent',x.threadId,()=>{x.store.put('runtimeIntent','compact-run',x.threadId,{kind:'compaction',previousStatus:'ready'});});
  (x.service as unknown as {startTurn(r:string,t:string):void}).startTurn('compact-run',x.threadId);
  expect(x.store.all<TurnTimingV1>('turnTiming',x.threadId)).toEqual([]);
 });
 it('keeps at most 200 records per thread',async()=>{
  const x=await setup();
  for(let index=0;index<201;index++){
   await x.send('message.send',{content:'Go',modelId:'test/model'},x.threadId);
   await x.settle();
  }
  expect(x.timing()).toHaveLength(200);
 },60_000);
 it('excludes archived threads from the snapshot',async()=>{
  const x=await setup();
  await x.send('message.send',{content:'Go',modelId:'test/model'},x.threadId);
  await x.settle();
  await x.send('thread.archive',{archived:true},x.threadId);
  const snapshot=x.store.snapshot();
  expect(snapshot.turnTimings).toEqual([]);
 });
});
