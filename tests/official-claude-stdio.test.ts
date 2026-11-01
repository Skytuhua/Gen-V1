import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {createOfficialRuntime} from '../packages/runtime-official/index.ts';
import type {RuntimeEvent} from '../packages/contracts/index.ts';
import {openClaude} from '../packages/runtime-official/claude.ts';
import {openManifest} from '../packages/runtime-official/manifest.ts';
import type {DriverContext} from '../packages/runtime-official/internal.ts';

vi.mock('node:child_process',async importOriginal=>({...await importOriginal<typeof import('node:child_process')>(),spawn:vi.fn()}));
import {spawn} from 'node:child_process';
const directories:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const path of directories.splice(0))await rm(path,{recursive:true,force:true});});

it.each(['stdin','stdout','stderr','process'] as const)('contains a native Claude %s error during discovery without losing the host',async stream=>{
 const directory=await mkdtemp(join(tmpdir(),'official-stdio-'));directories.push(directory);
 const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),exitCode:null,signalCode:null,pid:undefined});
 vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
 let opened=false,closed=false,rejectAccount!:(error:Error)=>void,wake!:()=>void;
 const messages=new Promise<void>(done=>{wake=done;});
 const query=vi.fn(({options}:any)=>{
  options.spawnClaudeCodeProcess({command:'synthetic-native',args:[],cwd:directory,env:{}});opened=true;
  return {
   async *[Symbol.asyncIterator](){await messages;},
   accountInfo:()=>new Promise((_,reject)=>{rejectAccount=reject;}),supportedModels:async()=>[],
   interrupt:async()=>{},close(){closed=true;rejectAccount?.(Error('Synthetic native query closed'));wake();},
  } as any;
 });
 const runtime=createOfficialRuntime({dataDir:directory},{claudeSdk:{query}}),events:RuntimeEvent[]=[];
 runtime.configure({onEvent:event=>events.push(event),onTool:async()=>null});
 const discovery=runtime.models();
 try{
  await vi.waitFor(()=>expect(opened).toBe(true));
  expect(()=>(stream==='process'?child:child[stream]).emit('error',Object.assign(Error('Synthetic disconnected pipe'),{code:'ENOTCONN'}))).not.toThrow();
  await expect(discovery).resolves.toEqual([]);
  expect(closed).toBe(true);
  expect(events.some(event=>event.type==='input.processing')).toBe(false);
 }finally{await runtime.dispose();await discovery.catch(()=>{});}
});

it('preserves safe failure and settlement when the error notification observer throws',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'official-stdio-observer-'));directories.push(directory);
 const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough()});vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
 let opened=false,rejectAccount!:(error:Error)=>void,wake!:()=>void;
 const messages=new Promise<void>(done=>{wake=done;});
 const event=vi.fn((type:string)=>{if(type==='error')throw Error('Synthetic observer failure');});
 const context:DriverContext={dataDir:directory,taskDir:directory,manifest:await openManifest(directory,'claude-code','thread',null),mcp:{names:[],url:'http://127.0.0.1/synthetic',headers:{}} as unknown as DriverContext['mcp'],current:()=>true,event,observed:async()=>[],inputIds:()=>[],own(){},ready(){}};
 const opening=openClaude(context,{query:({options}:any)=>{options.spawnClaudeCodeProcess!({command:'synthetic-native',args:[],cwd:directory,env:{}});opened=true;return {async *[Symbol.asyncIterator](){await messages;},accountInfo:()=>new Promise((_,reject)=>{rejectAccount=reject;}),supportedModels:async()=>[],interrupt:async()=>{},close(){rejectAccount?.(Error('Synthetic closed'));wake();}} as any;}});
 try{
  await vi.waitFor(()=>expect(opened).toBe(true));
  expect(()=>child.stdout.emit('error',Error('Synthetic native error with private diagnostic'))).not.toThrow();
  await expect(opening).rejects.toMatchObject({code:'OFFICIAL_PROCESS_IO_FAILED',message:'The native Claude connection closed unexpectedly. Reconnect the provider and refresh models.'});
  expect(event.mock.calls.some(([type])=>type==='settled')).toBe(true);
 }finally{await opening.catch(()=>{});}
});
