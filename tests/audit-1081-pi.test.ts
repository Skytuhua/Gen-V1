import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import * as childProcess from 'node:child_process';
import * as processTree from '../packages/runtime-pi/process-tree.ts';
import {safeError} from '../packages/runtime-pi/sdk.ts';
import {createPiRuntime} from '../packages/runtime-pi/index.ts';
import type {RunContext,StartRun} from '../packages/contracts/index.ts';

vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>() }));

const cleanup:(()=>Promise<void>)[]=[];afterEach(async()=>{vi.restoreAllMocks();for(const close of cleanup.splice(0).reverse())await close();});
const ctx:RunContext={threadId:'task-a',runId:'run-a',epoch:3};
const input:StartRun={...ctx,prompt:'Please inspect the granted file.',modelId:'openai/gpt-5.4',sessionPath:null,inputId:'input-001',resources:[]};

// Issue #1081 defect (b): a tool failure whose message is empty must still
// produce a non-empty diagnostic in the reply.
it('never returns an empty diagnostic from safeError',()=>{
 expect(safeError(new Error(''))).toBe('Pi runtime failed');
 expect(safeError(new Error('   '))).toBe('Pi runtime failed');
 expect(safeError(new Error('real failure'))).toBe('real failure');
 expect(safeError('plain')).toBe('Pi runtime failed');
});

// Issue #1081 (c): audit — a throwing lifecycle observer must not veto worker
// exit cleanup: pending requests reject, the worker exits its barrier and
// dispose completes.
it('completes worker exit cleanup when an event observer throws',async()=>{
 const workers=(()=>{
  const children:(EventEmitter&{send:ReturnType<typeof vi.fn>})[]=[];
  const spawnWorker=vi.spyOn(childProcess,'spawn').mockImplementation(()=>{
   const child=Object.assign(new EventEmitter(),{connected:true,exitCode:null,signalCode:null,send:vi.fn((message:{requestId?:string},callback:(error:Error|null)=>void)=>{queueMicrotask(()=>{child.emit('message',{type:'response',requestId:message.requestId,value:null});callback(null);});return true;})});
   children.push(child);return child as never;});
  vi.spyOn(processTree,'terminateProcessTree').mockImplementation(async child=>{Object.assign(child,{connected:false,exitCode:0});(child as EventEmitter).emit('exit',0,null);});
  return{children,spawnWorker};
 })();
 const dir=await mkdtemp(join(tmpdir(),'harness-pi-observer-'));cleanup.push(()=>rm(dir,{recursive:true,force:true,maxRetries:5}));
 const runtime=createPiRuntime({dataDir:dir});
 const events:string[]=[];
 runtime.configure({onEvent:event=>{events.push(event.type);throw new Error('observer exploded');},onTool:async()=>({content:'ok'})});
 await runtime.start(input);
 const child=workers.children[0]!;
 Object.assign(child,{connected:false,exitCode:9});
 // If observer throws escaped, this emit would throw synchronously into the test.
 child.emit('exit',9,null);
 expect(events).toContain('settled');
 await expect(runtime.followUp(input)).rejects.toMatchObject({code:'PI_STALE_RUN'});
 await runtime.dispose();
});
