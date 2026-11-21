import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Service } from "../packages/core/service.ts";
import { AttentionRepository } from "../packages/core/attention.ts";
import { Store } from "../packages/storage/store.ts";
import { planDataId, PLANNING_PROVENANCE } from "../packages/contracts/planning.ts";
import { handleDesktopControl } from "../apps/server/desktop-controls.ts";
import type { RuntimeAdapter, Thread } from "../packages/contracts/index.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async()=>{for(const cleanup of cleanups.splice(0))await cleanup()});

function thread(id:string,extra:Partial<Thread>={}):Thread{
 return {id,title:"Task "+id,projectName:null,createdAt:"2026-11-21T00:00:00.000Z",updatedAt:"2026-11-21T00:00:00.000Z",status:"ready",epoch:0,runId:null,modelId:null,sessionPath:null,...extra};
}
function plan(threadId:string,steps:{id:string;status:string;state?:string}[]){
 return {id:planDataId(threadId),threadId,revision:1,provenance:PLANNING_PROVENANCE,createdAt:"2026-11-21T00:00:00.000Z",
  value:{version:1,title:"Plan",steps:steps.map(step=>({id:step.id,title:step.id,status:step.status,...(step.state?{state:step.state}:{}),requirements:[]})),agents:[]}};
}
async function setup(){
 const base=mkdtempSync(join(tmpdir(),"harness-taskbar-")),store=new Store(join(base,"state"));
 const runtime:RuntimeAdapter={configure:()=>{},models:async()=>[],start:async()=>{},followUp:async()=>{},cancel:async()=>{},compact:async()=>{},history:async()=>[],dispose:async()=>{}};
 const service=new Service(store,runtime);await service.recover();
 cleanups.push(async()=>{await service.dispose();store.close();rmSync(base,{recursive:true,force:true})});
 const put=(kind:string,id:string,owner:string|null,value:unknown)=>store.internal('fixture',owner,()=>store.put(kind,id,owner,value));
 return {service,store,put};
}

describe("service.taskbarStatus",()=>{
 it("reports none with enabled defaults on an idle workspace",async()=>{
  const {service}=await setup();
  const result=service.taskbarStatus();
  expect(result.taskbar).toEqual({enabled:true,mode:"none",progress:null,failed:false});
  expect(result.jumpList).toEqual({enabled:true,projects:[]});
 });
 it("reports indeterminate for a running thread without a plan",async()=>{
  const {service,put}=await setup();
  put("thread","t1","t1",thread("t1",{status:"working",runId:"run-1"}));
  expect(service.taskbarStatus().taskbar.mode).toBe("indeterminate");
 });
 it("reports determinate progress across active thread plan steps",async()=>{
  const {service,put}=await setup();
  put("thread","t1","t1",thread("t1",{status:"working",runId:"run-1"}));
  put("data",planDataId("t1"),"t1",plan("t1",[{id:"a",status:"completed"},{id:"b",status:"working"},{id:"c",status:"pending"},{id:"d",status:"pending"}]));
  put("thread","t2","t2",thread("t2",{status:"working",runId:"run-2"}));
  put("data",planDataId("t2"),"t2",plan("t2",[{id:"e",status:"completed"},{id:"f",status:"pending"},{id:"g",status:"pending"}]));
  const taskbar=service.taskbarStatus().taskbar;
  expect(taskbar.mode).toBe("normal");
  expect(taskbar.progress).toBeCloseTo(2/7);
 });
 it("counts accepted step state as completed and clamps progress",async()=>{
  const {service,put}=await setup();
  put("thread","t1","t1",thread("t1",{status:"working",runId:"run-1"}));
  put("data",planDataId("t1"),"t1",plan("t1",[{id:"a",status:"blocked",state:"accepted"}]));
  expect(service.taskbarStatus().taskbar.progress).toBeCloseTo(.98);
  const {service:service2,put:put2}=await setup();
  put2("thread","t1","t1",thread("t1",{status:"working",runId:"run-1"}));
  put2("data",planDataId("t1"),"t1",plan("t1",[{id:"a",status:"pending"},{id:"b",status:"pending"},{id:"c",status:"pending"},{id:"d",status:"pending"},{id:"e",status:"pending"}]));
  expect(service2.taskbarStatus().taskbar.progress).toBeCloseTo(.02);
 });
 it("reports paused when a thread awaits input",async()=>{
  const {service,put}=await setup();
  put("thread","t1","t1",thread("t1",{status:"awaiting_input",runId:"run-1"}));
  expect(service.taskbarStatus().taskbar.mode).toBe("paused");
 });
 it("reports error for an unread thread-failed item and clears when read",async()=>{
  const {service,store,put}=await setup();
  put("thread","t1","t1",thread("t1",{status:"failed",epoch:1}));
  put("runFailure","t1:f1","t1",{threadId:"t1",runId:"run-1",epoch:1,projectId:null,occurredAt:"2026-11-21T00:00:00.000Z"});
  let taskbar=service.taskbarStatus().taskbar;
  expect(taskbar.mode).toBe("error");expect(taskbar.failed).toBe(true);
  const repository=new AttentionRepository(store);
  const failed=repository.read().items.find(item=>item.kind==="thread-failed")!;
  repository.command({id:"read-1",eventId:failed.id,type:"read"});
  taskbar=service.taskbarStatus().taskbar;
  expect(taskbar.mode).toBe("none");expect(taskbar.failed).toBe(false);
 });
 it("error wins over paused and paused wins over running",async()=>{
  const {service,put}=await setup();
  put("thread","t1","t1",thread("t1",{status:"awaiting_input",runId:"run-1"}));
  put("thread","t2","t2",thread("t2",{status:"failed",epoch:1}));
  put("runFailure","t2:f1","t2",{threadId:"t2",runId:"run-2",epoch:1,projectId:null,occurredAt:"2026-11-21T00:00:00.000Z"});
  expect(service.taskbarStatus().taskbar.mode).toBe("error");
 });
 it("ignores archived and side threads",async()=>{
  const {service,put}=await setup();
  put("thread","t1","t1",thread("t1",{status:"working",runId:"run-1"}));
  put("archivedThread","t1","t1",true);
  put("thread","t2","t2",thread("t2",{status:"working",runId:"run-2",kind:"side",sideParentId:"p"}));
  expect(service.taskbarStatus().taskbar.mode).toBe("none");
 });
 it("honours the taskbarProgress preference",async()=>{
  const {service,put}=await setup();
  put("thread","t1","t1",thread("t1",{status:"working",runId:"run-1"}));
  put("settings","global",null,{preferences:{taskbarProgress:false}});
  expect(service.taskbarStatus().taskbar.enabled).toBe(false);
 });
 it("orders jump-list projects by latest thread activity then creation time, max five",async()=>{
  const {service,put}=await setup();
  const project=(id:string,createdAt:string)=>({id,name:"Project "+id,authority:{kind:"local"},createdAt});
  for(const id of ["p1","p2","p3","p4","p5","p6"])put("workspaceProject",id,null,project(id,"2026-11-01T00:00:0"+id.at(-1)+".000Z"));
  put("thread","ta","ta",thread("ta",{projectId:"p2",updatedAt:"2026-11-20T00:00:00.000Z"}));
  put("thread","tb","tb",thread("tb",{projectId:"p2",updatedAt:"2026-11-19T00:00:00.000Z"}));
  put("thread","tc","tc",thread("tc",{projectId:"p5",updatedAt:"2026-11-21T00:00:00.000Z"}));
  const projects=service.taskbarStatus().jumpList.projects;
  expect(projects.map(item=>item.id)).toEqual(["p5","p2","p6","p4","p3"]);
  expect(projects[0]!.name).toBe("Project p5");
 });
 it("honours the jumpListRecentProjects preference",async()=>{
  const {service,put}=await setup();
  put("workspaceProject","p1",null,{id:"p1",name:"Project p1",authority:{kind:"local"},createdAt:"2026-11-01T00:00:00.000Z"});
  put("settings","global",null,{preferences:{jumpListRecentProjects:false}});
  const jump=service.taskbarStatus().jumpList;
  expect(jump.enabled).toBe(false);expect(jump.projects.map(item=>item.id)).toEqual(["p1"]);
 });
});

describe("harness.taskbar.read control",()=>{
 const token="a".repeat(64);
 const base={stopAll:async()=>({stopped:0}),saveNativeLayout:async()=>{}};
 it("accepts only launch-token three-key requests and returns the host result",async()=>{
  const host={...base,taskbarRead:vi.fn(async()=>({taskbar:{enabled:true,mode:"normal" as const,progress:.5,failed:false},jumpList:{enabled:true,projects:[]}}))},send=vi.fn();
  expect(await handleDesktopControl({type:"harness.taskbar.read",token:"b".repeat(64),requestId:"one"},token,host,send)).toBe(false);
  expect(await handleDesktopControl({type:"harness.taskbar.read",token,requestId:"one",extra:true},token,host,send)).toBe(false);
  expect(await handleDesktopControl({type:"harness.taskbar.read",token,requestId:"bad id!"},token,host,send)).toBe(false);
  expect(host.taskbarRead).not.toHaveBeenCalled();
  expect(await handleDesktopControl({type:"harness.taskbar.read",token,requestId:"one"},token,host,send)).toBe(true);
  expect(send).toHaveBeenCalledWith({type:"harness.taskbar.read.result",token,requestId:"one",taskbar:{enabled:true,mode:"normal",progress:.5,failed:false},jumpList:{enabled:true,projects:[]}});
 });
 it("returns the unavailable error when the host throws",async()=>{
  const host={...base,taskbarRead:vi.fn(async()=>{throw Error("private");})},send=vi.fn();
  expect(await handleDesktopControl({type:"harness.taskbar.read",token,requestId:"two"},token,host,send)).toBe(true);
  expect(send).toHaveBeenCalledWith({type:"harness.taskbar.read.result",token,requestId:"two",error:"Taskbar status is unavailable."});
 });
});
