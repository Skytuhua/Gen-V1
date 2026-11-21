import {afterEach,expect,it,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import * as childProcess from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as processTree from '../packages/runtime-pi/process-tree.ts';
import {createPiRuntime} from '../packages/runtime-pi/index.ts';
import {createOfficialRuntime} from '../packages/runtime-official/index.ts';
import type {StartRun} from '../packages/contracts/index.ts';

vi.mock('node:child_process',async original=>({...await original<typeof import('node:child_process')>()}));
vi.mock('../packages/runtime-pi/process-tree.ts',async original=>({...await original<typeof import('../packages/runtime-pi/process-tree.ts')>()}));
const roots:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();await Promise.all(roots.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
const requirement={apiVersion:2,required:true} as const;
const ctx={threadId:'thread',runId:'run',epoch:1};
const input:StartRun={...ctx,modelId:'openai/model',accountId:null,sessionPath:null,prompt:'request',resources:[],inputId:'input',memoryCheckpoint:requirement};
const ack=(request:{requestId:string})=>({apiVersion:2 as const,requestId:request.requestId,checkpointId:'checkpoint',digest:'a'.repeat(64),persisted:true as const});

async function fixture(callback:(request:import('../packages/contracts/memory-checkpoint.ts').MemoryCheckpointRequestV1)=>Promise<import('../packages/contracts/memory-checkpoint.ts').MemoryCheckpointAckV1>){
 const root=await mkdtemp(join(tmpdir(),'checkpoint-worker-'));roots.push(root);const sent:{type?:string;requestId?:unknown;value?:unknown}[]=[];
 const child=Object.assign(new EventEmitter(),{connected:true,exitCode:null as number|null,signalCode:null,send:vi.fn((value:{type?:string;requestId?:unknown},done:(error:Error|null)=>void)=>{sent.push(value);queueMicrotask(()=>{if(value.type==='command')child.emit('message',{type:'response',requestId:value.requestId,value:null});done(null);});return true;})});
 vi.spyOn(childProcess,'spawn').mockReturnValue(child as never);
 vi.spyOn(processTree,'terminateProcessTree').mockImplementation(async()=>{child.connected=false;child.exitCode=0;child.emit('exit',0,null);});
 const runtime=createPiRuntime({dataDir:root});runtime.configure({onEvent:()=>{},onTool:async()=>{},onMemoryCheckpoint:callback});await runtime.start(input);
 const path=join(root,'session.jsonl');child.emit('message',{type:'event',ctx,event:{...ctx,type:'session',sessionPath:path}});
 const request={apiVersion:2 as const,requestId:'checkpoint-attempt',adapterId:'pi' as const,ctx,sessionPath:path,modelId:input.modelId,accountId:null,reason:'manual' as const};
 return{runtime,child,sent,request};
}

it('retains checkpoint cleanup through unexpected worker exit and rejects a late persistence receipt',async()=>{
 let release!:(value:import('../packages/contracts/memory-checkpoint.ts').MemoryCheckpointAckV1)=>void;const pending=new Promise<import('../packages/contracts/memory-checkpoint.ts').MemoryCheckpointAckV1>(done=>{release=done;}),callback=vi.fn(()=>pending),f=await fixture(callback);
 try{
  f.child.emit('message',{type:'memory.checkpoint',request:f.request});await vi.waitFor(()=>expect(callback).toHaveBeenCalledOnce());
  f.child.connected=false;f.child.exitCode=1;f.child.emit('exit',1,null);let closed=false;const disposing=f.runtime.dispose().then(()=>{closed=true;});
  await new Promise(done=>setTimeout(done,10));expect(closed).toBe(false);release(ack(f.request));await disposing;
  expect(f.sent.some(value=>value.type==='memory.checkpoint.result'&&value.value)).toBe(false);
 }finally{release(ack(f.request));await f.runtime.dispose();}
});

it.each([{modelId:'foreign/model'},{accountId:'foreign'},{sessionPath:'/foreign/session'},{ctx:{...ctx,epoch:2}}])('rejects cross-owner private IPC before host persistence: %j',async patch=>{
 const callback=vi.fn(async request=>ack(request)),f=await fixture(callback);
 try{f.child.emit('message',{type:'memory.checkpoint',request:{...f.request,...patch}});await vi.waitFor(()=>expect(f.sent).toContainEqual(expect.objectContaining({type:'memory.checkpoint.result',error:expect.any(String)})));expect(callback).not.toHaveBeenCalled();}finally{await f.runtime.dispose();}
});

it('rejects required checkpoints in a directly constructed unsupported external adapter before spawning',async()=>{
 const root=await mkdtemp(join(tmpdir(),'checkpoint-official-'));roots.push(root);const spawn=vi.spyOn(childProcess,'spawn'),runtime=createOfficialRuntime({dataDir:root});runtime.configure({onEvent:()=>{},onTool:async()=>{}});
 try{await expect(runtime.start({...input,modelId:'claude-code/model'})).rejects.toMatchObject({code:'MEMORY_CHECKPOINT_UNSUPPORTED'});await expect(runtime.compact(ctx,join(root,'session'),'claude-code/model',null,requirement)).rejects.toMatchObject({code:'MEMORY_CHECKPOINT_UNSUPPORTED'});expect(spawn).not.toHaveBeenCalled();}finally{await runtime.dispose();}
});
