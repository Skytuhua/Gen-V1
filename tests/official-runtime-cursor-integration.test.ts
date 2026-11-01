import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import type { StartRun } from '../packages/contracts/index.ts';
import { SUBSCRIPTION_CONNECTIONS } from '../packages/contracts/connections.ts';
import { createOfficialRuntime } from '../packages/runtime-official/index.ts';
import { officialRuntimeHome } from '../packages/runtime-official/environment.ts';
import { openManifest, readManifest, saveManifest } from '../packages/runtime-official/manifest.ts';

const fake=vi.hoisted(()=>({active:0,peak:0,nativeHold:undefined as Promise<void>|undefined,cursorHold:undefined as Promise<void>|undefined,cursorError:undefined as Error|undefined,spawnCursor:false,openCursor:vi.fn(),discoverCursor:vi.fn(),cursorHistory:vi.fn(),mcp:vi.fn(),submit:vi.fn(),terminate:vi.fn()}));
vi.mock('../packages/runtime-official/mcp.ts',()=>({createHostMcp:fake.mcp}));
vi.mock('../packages/runtime-pi/process-tree.ts',()=>({terminateProcessTree:fake.terminate}));
vi.mock('../packages/runtime-official/claude.ts',()=>({openClaude:async(ctx:any)=>native(ctx,'claude-code')}));
vi.mock('../packages/runtime-official/gemini.ts',()=>({openGemini:async(ctx:any)=>native(ctx,'gemini-cli'),geminiHistory:vi.fn(async()=>{throw Error('Cursor history was routed to Gemini');})}));
vi.mock('../packages/runtime-official/cursor.ts',()=>({openCursor:fake.openCursor,discoverCursor:fake.discoverCursor,cursorHistory:fake.cursorHistory}));

async function native(ctx:any,provider:string){
 fake.active++;fake.peak=Math.max(fake.peak,fake.active);
 const driver={models:[{id:provider+'/model',provider,name:provider}],submit:fake.submit,compact:vi.fn(),close:vi.fn(async()=>{fake.active--;})};
 ctx.ready(driver);await fake.nativeHold;return driver;
}
const row=()=>SUBSCRIPTION_CONNECTIONS.find(value=>value.id==='cursor-sdk')!;
const initialCursorStatus=row().status;
const input=(extra:Partial<StartRun>={}):StartRun=>({threadId:'cursor-thread',runId:'run',epoch:1,modelId:'cursor-sdk/model',sessionPath:null,inputId:'input',prompt:'private task',resources:[],...extra});
const data=()=>mkdtemp(join(tmpdir(),'official-cursor-integration-'));
async function marker(dataDir:string){const home=officialRuntimeHome(dataDir,'cursor-sdk');await mkdir(home,{recursive:true});await writeFile(join(home,'sdk-browser-login.json'),'{}');}
const callbacks={onEvent:vi.fn(),onTool:vi.fn(async()=>null)};

beforeEach(()=>{
 vi.clearAllMocks();fake.active=0;fake.peak=0;fake.nativeHold=undefined;fake.cursorHold=undefined;fake.cursorError=undefined;fake.spawnCursor=false;
 fake.mcp.mockResolvedValue({url:'http://fixture.invalid',token:'fixture',close:vi.fn(async()=>{})});
 fake.openCursor.mockImplementation(async(ctx:any)=>{if(fake.cursorError)throw fake.cursorError;return native(ctx,'cursor-sdk');});
 fake.discoverCursor.mockImplementation(async(_dataDir:string,spawn:any)=>{fake.active++;fake.peak=Math.max(fake.peak,fake.active);if(fake.spawnCursor)spawn('fixture-worker');try{await fake.cursorHold;return [{id:'cursor-sdk/model',provider:'cursor-sdk',name:'Cursor model'}];}finally{fake.active--;}});
 fake.cursorHistory.mockResolvedValue([]);fake.terminate.mockImplementation(async(child:ChildProcess)=>{child.emit('exit',0,null);});
});
afterEach(()=>{if(row())row().status=initialCursorStatus;});

it('rejects pending Cursor work before task context, native startup or input delivery',async()=>{
 row().status='runtime-pending';
 const runtime=createOfficialRuntime({dataDir:await data()});runtime.configure(callbacks);
 try{await expect(runtime.start(input())).rejects.toMatchObject({code:'OFFICIAL_PROVIDER_UNAVAILABLE'});expect(fake.openCursor).not.toHaveBeenCalled();expect(fake.mcp).not.toHaveBeenCalled();expect(fake.submit).not.toHaveBeenCalled();}
 finally{await runtime.dispose();}
});

it('does not probe a pending Cursor connection even if private login state exists',async()=>{
 row().status='runtime-pending';
 const dataDir=await data();await marker(dataDir);const runtime=createOfficialRuntime({dataDir});runtime.configure(callbacks);
 try{expect((await runtime.models()).map(model=>model.provider)).toEqual(['claude-code','gemini-cli']);expect(fake.discoverCursor).not.toHaveBeenCalled();}
 finally{await runtime.dispose();}
});

it('skips an admitted but absent private Cursor login without spawning a discovery worker',async()=>{
 row().status='available';const spawn=vi.fn(),runtime=createOfficialRuntime({dataDir:await data()},{spawn:spawn as any});runtime.configure(callbacks);
 try{await runtime.models();expect(fake.discoverCursor).not.toHaveBeenCalled();expect(spawn).not.toHaveBeenCalled();}
 finally{await runtime.dispose();}
});

it('coalesces and caches isolated discovery with at most two native probes and no Cursor task or MCP context',async()=>{
 row().status='available';const dataDir=await data();await marker(dataDir);const runtime=createOfficialRuntime({dataDir});runtime.configure(callbacks);
 let release!:()=>void;fake.nativeHold=new Promise<void>(done=>{release=done;});
 try{
  const first=runtime.models(),second=runtime.models();await vi.waitFor(()=>expect(fake.active).toBe(2));expect(fake.discoverCursor).not.toHaveBeenCalled();release();
  const [a,b]=await Promise.all([first,second]);expect(a).toEqual(b);expect(a.map(model=>model.provider)).toEqual(['claude-code','gemini-cli','cursor-sdk']);expect(fake.peak).toBeLessThanOrEqual(2);
  expect(fake.discoverCursor).toHaveBeenCalledOnce();expect(fake.mcp).toHaveBeenCalledTimes(2);expect(await readdir(join(dataDir,'official','cursor-sdk'))).toEqual(['home']);
  a[2].name='modified';expect((await runtime.models())[2].name).toBe('Cursor model');expect(fake.discoverCursor).toHaveBeenCalledOnce();
  await runtime.models({refresh:true});expect(fake.discoverCursor).toHaveBeenCalledTimes(2);expect(fake.peak).toBeLessThanOrEqual(2);
 }finally{release();await runtime.dispose();}
});

it('owns discovery children before awaiting SDK results and waits for their cancellation on dispose',async()=>{
 row().status='available';const dataDir=await data();await marker(dataDir);fake.spawnCursor=true;
 const child=new EventEmitter() as ChildProcess,spawn=vi.fn(()=>child);let release!:()=>void;fake.cursorHold=new Promise<void>(done=>{release=done;});
 fake.terminate.mockImplementation(async(value:ChildProcess)=>{expect(value).toBe(child);value.emit('exit',0,null);release();});
 const runtime=createOfficialRuntime({dataDir},{spawn:spawn as any});runtime.configure(callbacks);
 const discovery=runtime.models().catch(error=>error);await vi.waitFor(()=>expect(spawn).toHaveBeenCalledOnce());await runtime.dispose();
 expect(fake.terminate).toHaveBeenCalledWith(child);expect(await discovery).toMatchObject({code:'OFFICIAL_DISPOSED'});expect(fake.active).toBe(0);
});

it('dispatches only Cursor private history and acknowledges matching manifest receipts',async()=>{
 const dataDir=await data(),state=await openManifest(dataDir,'cursor-sdk','cursor-thread',null);state.value.sessionId='native-session';state.value.inputs.uuid={inputIds:['input'],runId:'run',epoch:1,observed:false};await saveManifest(state);
 fake.cursorHistory.mockResolvedValue([{uuid:'uuid',inputIds:['wrong']},{uuid:'unknown',inputIds:['input']}]);
 const runtime=createOfficialRuntime({dataDir});runtime.configure(callbacks);
 try{expect(await runtime.history(state.path)).toEqual([]);fake.cursorHistory.mockResolvedValue([{uuid:'uuid',inputIds:['input']}]);expect(await runtime.history(state.path)).toEqual(['input']);expect(fake.cursorHistory).toHaveBeenCalledWith(dataDir,expect.objectContaining({path:state.path}),expect.any(Function));expect(fake.mcp).not.toHaveBeenCalled();expect(fake.openCursor).not.toHaveBeenCalled();}
 finally{await runtime.dispose();}
});

it('fails fresh auth and model preflight before serializing task input despite cached discovery',async()=>{
 row().status='available';const dataDir=await data();await marker(dataDir);const runtime=createOfficialRuntime({dataDir});runtime.configure(callbacks);
 try{await runtime.models();let epoch=0;for(const code of ['OFFICIAL_SUBSCRIPTION_REQUIRED','OFFICIAL_MODEL_UNAVAILABLE']){fake.cursorError=Object.assign(Error('Fresh preflight failed'),{code});await expect(runtime.start(input({epoch:++epoch,runId:'fresh-'+epoch}))).rejects.toMatchObject({code});expect(fake.submit).not.toHaveBeenCalled();}
  const state=await openManifest(dataDir,'cursor-sdk','cursor-thread',null);expect((await readManifest(dataDir,state.path)).value.inputs).toEqual({});
 }finally{await runtime.dispose();}
});

it('rejects a changed Cursor model on active authority and rejects unsupported compaction before native setup',async()=>{
 row().status='available';const dataDir=await data(),runtime=createOfficialRuntime({dataDir});runtime.configure(callbacks);
 try{await expect(runtime.compact(input(),join(dataDir,'official','cursor-sdk','tasks','thread','session.json'),'cursor-sdk/model')).rejects.toMatchObject({code:'OFFICIAL_COMPACTION_UNSUPPORTED'});expect(fake.mcp).not.toHaveBeenCalled();expect(fake.openCursor).not.toHaveBeenCalled();
  await runtime.start(input());expect(fake.submit).toHaveBeenCalledOnce();await expect(runtime.followUp(input({modelId:'cursor-sdk/other',inputId:'other'}))).rejects.toMatchObject({code:'OFFICIAL_MODEL_MISMATCH'});expect(fake.submit).toHaveBeenCalledOnce();
 }finally{await runtime.dispose();}
});
