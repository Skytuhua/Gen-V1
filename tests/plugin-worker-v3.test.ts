import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {describe,expect,it} from 'vitest';
import {
 WORKER_FRAME_MAX_BYTES,WORKER_MAX_INFLIGHT_REQUESTS,WORKER_PROTOCOL_VERSION,
 pluginLeaseV1Schema,pluginManifestV2Schema,workerFrameV1Schema,type WorkerFrameV1,
} from '../packages/contracts/plugin-worker.ts';
import {
 IsolatedWorkerSession,WorkerFrameDecoder,createSpawnWorkerLauncher,encodeWorkerFrame,
 type WorkerExit,type WorkerTransport,
} from '../packages/plugins/isolated-host.ts';

const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const frame=(over:Partial<WorkerFrameV1>={}):WorkerFrameV1=>({protocolVersion:WORKER_PROTOCOL_VERSION,requestId:1,generation:1,kind:'RESPONSE',payload:{ok:true,value:null},...over});
const manifest=(over:Record<string,unknown>={})=>({manifestVersion:2,pluginId:'sample-ext',version:'1.0.0',packageDigest:hash('package'),protocolVersion:1,declaredCapabilities:['tools.invoke','data.read','data.write'],toolSchemas:[{name:'echo',parameters:{type:'object'}}],dataNamespace:'sample-ext',executionProfileRef:'WORKSPACE_EXECUTE_NO_NETWORK',...over});

class FakeTransport implements WorkerTransport{
 sent:WorkerFrameV1[]=[];terminated=false;confirmTerminate=true;operations=['echo'];
 private frameHandler?:((frame:WorkerFrameV1)=>void);private exitHandler?:((exit:WorkerExit)=>void);private exitInfo?:WorkerExit;
 autoReady=true;
 send(frame:WorkerFrameV1){
  this.sent.push(frame);
  if(this.autoReady&&frame.kind==='HELLO'){const hello=frame.payload as {nonce:string;pluginId:string;packageDigest:string};queueMicrotask(()=>this.emit({protocolVersion:WORKER_PROTOCOL_VERSION,requestId:0,generation:frame.generation,kind:'READY',payload:{nonce:hello.nonce,pluginId:hello.pluginId,version:'1.0.0',packageDigest:hello.packageDigest,operations:this.operations}}));}
 }
 onFrame(handler:(frame:WorkerFrameV1)=>void){this.frameHandler=handler;}
 onExit(handler:(exit:WorkerExit)=>void){this.exitHandler=handler;if(this.exitInfo)handler(this.exitInfo);}
 async terminate(){this.terminated=true;if(this.confirmTerminate)this.exit({code:0,signal:'SIGKILL'});return this.confirmTerminate;}
 emit(frame:WorkerFrameV1){this.frameHandler?.(frame);}
 exit(info:WorkerExit){this.exitInfo=info;this.exitHandler?.(info);}
}

const connect=async(transport:FakeTransport,generation=1)=>IsolatedWorkerSession.connect(transport,{pluginId:'sample-ext',packageDigest:hash('package'),dataNamespace:'sample-ext',generation},200);

describe('M13 isolated extension contracts',()=>{
 it('M13-C01 validates PluginManifestV2 strictly and rejects undeclared capability shapes',()=>{
  expect(pluginManifestV2Schema.parse(manifest())).toMatchObject({pluginId:'sample-ext',protocolVersion:1});
  for(const bad of [
   {...manifest(),manifestVersion:1},{...manifest(),pluginId:'../escape'},{...manifest(),packageDigest:'not-hex'},
   {...manifest(),protocolVersion:2},{...manifest(),declaredCapabilities:['tools.invoke','tools.invoke']},
   {...manifest(),declaredCapabilities:['store.write']},{...manifest(),declaredCapabilities:['shell.exec']},
   {...manifest(),declaredCapabilities:['credential.read']},{...manifest(),declaredCapabilities:['host.command']},
   {...manifest(),toolSchemas:[{name:'a',parameters:{}},{name:'a',parameters:{}}]},
   {...manifest(),extra:'field'},
  ])expect(pluginManifestV2Schema.safeParse(bad).success).toBe(false);
 });
 it('M13-C02 validates PluginLeaseV1 states and bounded calls',()=>{
  const base={pluginId:'sample-ext',version:'1.0.0',generation:1,ownerScopes:['thread:1'],activeCalls:[],registrations:[{kind:'tool',id:'echo'}],state:'ACTIVE'};
  expect(pluginLeaseV1Schema.parse(base)).toMatchObject({state:'ACTIVE'});
  for(const state of ['STARTING','ACTIVE','DRAINING','STOPPED','FAILED','UNKNOWN'])expect(pluginLeaseV1Schema.safeParse({...base,state}).success).toBe(true);
  for(const bad of [
   {...base,state:'BLOCKED'},{...base,state:'HOLD_BACKEND_SELECTION'},{...base,generation:0},
   {...base,activeCalls:Array.from({length:33},(_,i)=>({requestId:i,operation:'echo',startedAt:new Date().toISOString()}))},
   {...base,extra:'field'},
  ])expect(pluginLeaseV1Schema.safeParse(bad).success).toBe(false);
 });
 it('M13-C03 validates WorkerFrameV1 kinds and rejects extras',()=>{
  for(const kind of ['HELLO','READY','REQUEST','RESPONSE','CANCEL','SHUTDOWN','BYE','ERROR'])expect(workerFrameV1Schema.safeParse(frame({kind:kind as WorkerFrameV1['kind']})).success).toBe(true);
  for(const bad of [frame({kind:'EXEC' as never}),frame({protocolVersion:2 as never}),frame({requestId:-1}),frame({requestId:0x100000000}),{...frame(),store:true},{...frame(),command:'ls'}])expect(workerFrameV1Schema.safeParse(bad).success).toBe(false);
 });
});

describe('WorkerFrameV1 codec',()=>{
 it('round-trips frames across arbitrary chunk boundaries',()=>{
  const decoder=new WorkerFrameDecoder(),a=frame({requestId:7,kind:'REQUEST',payload:{operation:'echo',input:{x:1}}}),b=frame({requestId:8});
  const wire=Buffer.concat([encodeWorkerFrame(a),encodeWorkerFrame(b)]);
  const out:WorkerFrameV1[]=[];
  for(let i=0;i<wire.length;i+=3)out.push(...decoder.push(wire.subarray(i,i+3)));
  expect(out).toEqual([a,b]);
 });
 it('rejects an announced length over 1 MiB before the payload arrives',()=>{
  const decoder=new WorkerFrameDecoder();
  const header=Buffer.alloc(4);header.writeUInt32LE(WORKER_FRAME_MAX_BYTES+1,0);
  expect(()=>decoder.push(header)).toThrowError(expect.objectContaining({code:'FRAME_TOO_LARGE'}));
 });
 it('accepts exactly 1 MiB then schema-checks it',()=>{
  const decoder=new WorkerFrameDecoder(),payload='x'.repeat(WORKER_FRAME_MAX_BYTES-220);
  const outgoing=frame({requestId:9,payload});
  const wire=encodeWorkerFrame(outgoing);
  expect(wire.length-4).toBeLessThanOrEqual(WORKER_FRAME_MAX_BYTES);
  expect(decoder.push(wire)).toEqual([outgoing]);
  // A maximal-length body that parses but fails the frame schema is still
  // checked end-to-end before dispatch.
  const other=new WorkerFrameDecoder(),announced=Buffer.alloc(4);announced.writeUInt32LE(WORKER_FRAME_MAX_BYTES,0);
  const crafted=Buffer.concat([announced,Buffer.from('[]'),Buffer.alloc(WORKER_FRAME_MAX_BYTES-2,0x20)]);
  expect(()=>other.push(crafted)).toThrowError(expect.objectContaining({code:'PROTOCOL_VIOLATION'}));
 });
 it('rejects invalid UTF-8 and malformed JSON bodies',()=>{
  const bad=Buffer.alloc(4);bad.writeUInt32LE(2,0);
  const decoder=new WorkerFrameDecoder();
  expect(()=>decoder.push(Buffer.concat([bad,Buffer.from([0xff,0xfe])]))).toThrowError(expect.objectContaining({code:'PROTOCOL_VIOLATION'}));
  const badJson=Buffer.alloc(4);badJson.writeUInt32LE(3,0);
  expect(()=>decoder.push(Buffer.concat([badJson,Buffer.from('{!}')]))).toThrowError(expect.objectContaining({code:'PROTOCOL_VIOLATION'}));
 });
 it('rejects frames the encoder cannot bound',()=>{
  expect(()=>encodeWorkerFrame(frame({payload:'x'.repeat(WORKER_FRAME_MAX_BYTES)}))).toThrowError(expect.objectContaining({code:'FRAME_TOO_LARGE'}));
 });
});

describe('IsolatedWorkerSession handshake',()=>{
 it('completes HELLO/READY with a per-launch nonce and returns worker identity',async()=>{
  const transport=new FakeTransport();
  const {session,ready}=await connect(transport);
  expect(ready.pluginId).toBe('sample-ext');
  const hello=transport.sent[0]!;
  expect(hello.kind).toBe('HELLO');
  expect((hello.payload as {nonce:string}).nonce).toMatch(/^[a-f0-9]{32}$/);
  expect(session.isOpen).toBe(true);
  await session.shutdown(50);
 });
 it('rejects a wrong nonce, digest or plugin identity and a handshake timeout',async()=>{
  const hello=(t:FakeTransport)=>t.sent[0]!.payload as {nonce:string;pluginId:string;packageDigest:string};
  const badNonce=new FakeTransport();badNonce.autoReady=false;
  const p1=connect(badNonce);await Promise.resolve();
  badNonce.emit(frame({requestId:0,kind:'READY',payload:{nonce:'0'.repeat(32),pluginId:'sample-ext',version:'1.0.0',packageDigest:hash('package'),operations:['echo']}}));
  await expect(p1).rejects.toThrowError(expect.objectContaining({code:'PROTOCOL_VIOLATION'}));
  const badDigest=new FakeTransport();badDigest.autoReady=false;
  const p2=connect(badDigest);await Promise.resolve();
  const h=hello(badDigest);
  badDigest.emit(frame({requestId:0,kind:'READY',payload:{nonce:h.nonce,pluginId:'sample-ext',version:'1.0.0',packageDigest:hash('other'),operations:['echo']}}));
  await expect(p2).rejects.toThrowError(expect.objectContaining({code:'PROTOCOL_VIOLATION'}));
  const silent=new FakeTransport();silent.autoReady=false;
  await expect(connect(silent)).rejects.toThrowError(expect.objectContaining({code:'HANDSHAKE_FAILED'}));
  expect(silent.terminated).toBe(true);
 });
 it('rejects a non-READY frame during the handshake',async()=>{
  const transport=new FakeTransport();transport.autoReady=false;
  const pending=connect(transport);await Promise.resolve();
  transport.emit(frame({requestId:0,kind:'REQUEST',payload:{operation:'x',input:null}}));
  await expect(pending).rejects.toThrowError(expect.objectContaining({code:'PROTOCOL_VIOLATION'}));
 });
});

describe('IsolatedWorkerSession requests',()=>{
 it('dispatches bounded JSON and resolves the response',async()=>{
  const transport=new FakeTransport(),{session}=await connect(transport);
  const pending=session.request('echo',{hello:'world'});
  const sent=transport.sent.at(-1)!;
  expect(sent.kind).toBe('REQUEST');
  transport.emit(frame({requestId:sent.requestId,kind:'RESPONSE',payload:{ok:true,value:{echoed:true}}}));
  await expect(pending).resolves.toEqual({echoed:true});
  await session.shutdown(50);
 });
 it('enforces the 32 in-flight bound with PLUGIN_BUSY and admits again after settle',async()=>{
  const transport=new FakeTransport(),{session}=await connect(transport);
  const calls=[];for(let i=0;i<WORKER_MAX_INFLIGHT_REQUESTS;i++)calls.push(session.request('echo',null));
  await expect(session.request('echo',null)).rejects.toThrowError(expect.objectContaining({code:'PLUGIN_BUSY'}));
  const sent=()=>transport.sent.filter(frame=>frame.kind==='REQUEST');
  expect(sent()).toHaveLength(WORKER_MAX_INFLIGHT_REQUESTS);
  transport.emit(frame({requestId:sent()[0]!.requestId,kind:'RESPONSE',payload:{ok:true,value:null}}));
  await calls[0];
  const again=session.request('echo',null);
  expect(sent()).toHaveLength(WORKER_MAX_INFLIGHT_REQUESTS+1);
  transport.emit(frame({requestId:sent().at(-1)!.requestId,kind:'RESPONSE',payload:{ok:true,value:1}}));
  await expect(again).resolves.toBe(1);
  for(const request of sent())transport.emit(frame({requestId:request.requestId,kind:'RESPONSE',payload:{ok:true,value:null}}));
  await Promise.allSettled(calls);
  await session.shutdown(50);
 });
 it('treats a reply with an unknown request id as a protocol violation',async()=>{
  const transport=new FakeTransport(),{session}=await connect(transport);
  let closed:string|undefined;session.onClosed=reason=>{closed=reason;};
  transport.emit(frame({requestId:77,kind:'RESPONSE',payload:{ok:true,value:null}}));
  expect(session.isOpen).toBe(false);
  expect(closed).toBe('violation');
 });
 it('drops stale-generation replies without dispatch',async()=>{
  const transport=new FakeTransport(),{session}=await connect(transport,1);
  const pending=session.request('echo',null);
  transport.emit(frame({requestId:transport.sent.at(-1)!.requestId,generation:99,kind:'RESPONSE',payload:{ok:true,value:'stale'}}));
  expect(session.staleReplies).toBe(1);
  transport.emit(frame({requestId:transport.sent.at(-1)!.requestId,kind:'RESPONSE',payload:{ok:true,value:'fresh'}}));
  await expect(pending).resolves.toBe('fresh');
  await session.shutdown(50);
 });
 it('rejects oversized dispatch input before sending',async()=>{
  const transport=new FakeTransport(),{session}=await connect(transport);
  await expect(session.request('echo',{big:'x'.repeat(300_000)})).rejects.toThrowError(expect.objectContaining({code:'INVALID_INPUT'}));
  await session.shutdown(50);
 });
 it('fails pending calls when the worker exits',async()=>{
  const transport=new FakeTransport(),{session}=await connect(transport);
  const pending=session.request('echo',null);
  transport.exit({code:1,signal:null});
  await expect(pending).rejects.toThrowError(expect.objectContaining({code:'WORKER_EXITED'}));
 });
});

describe('real worker process over private pipes',()=>{
 const workerEntry=fileURLToPath(new URL('../packages/plugins/worker-entry.ts',import.meta.url));
 const loader=pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
 async function fixture(){
  const directory=await mkdtemp(join(tmpdir(),'gen-isolated-')),source=join(directory,'pkg'),data=join(directory,'data');
  await mkdir(join(source,'frontend'),{recursive:true});await mkdir(join(source,'host'));await mkdir(data);
  const manifestJson={id:'sample-ext',name:'Sample extension',version:'1.0.0',apiVersion:1,compatibleGenVersions:'>=0.6.0 <0.7.0',frontendEntry:'frontend/index.html',hostEntry:'host/main.mjs'};
  const isolated={manifestVersion:2,pluginId:'sample-ext',version:'1.0.0',declaredCapabilities:['tools.invoke','data.read','data.write'],toolSchemas:[{name:'echo',parameters:{type:'object'}},{name:'contextKeys',parameters:{type:'object'}}],dataNamespace:'sample-ext',executionProfileRef:'WORKSPACE_EXECUTE_NO_NETWORK'};
  const host=`export default {async activate(context){return {operations:{echo:async(input)=>({echo:input}),contextKeys:async()=>Object.keys(context).sort()},close:async()=>{}};}};`;
  const files:Record<string,string>={'plugin.json':JSON.stringify(manifestJson),'isolated.json':JSON.stringify(isolated),'frontend/index.html':'<p>Sample</p>','host/main.mjs':host};
  for(const [path,bytes]of Object.entries(files))await writeFile(join(source,path),bytes);
  const inventory={version:1,files:Object.entries(files).map(([path,bytes])=>({path,bytes:Buffer.byteLength(bytes),sha256:hash(bytes)}))};const raw=JSON.stringify(inventory);await writeFile(join(source,'plugin-files.json'),raw);
  return {source,data,digest:hash(raw),isolated};
 }
 it('launches the real worker entry, handshakes and serves a bounded request',async()=>{
  const f=await fixture(),launcher=createSpawnWorkerLauncher({entryPath:workerEntry,genVersion:'0.6.5',importLoader:loader});
  const transport=await launcher.launch({packageDir:f.source,dataDir:f.data,generation:3,env:{PATH:process.env.PATH??'',HOME:process.env.HOME??''}});
  const {session,ready}=await IsolatedWorkerSession.connect(transport,{pluginId:'sample-ext',packageDigest:f.digest,dataNamespace:'sample-ext',generation:3},15_000);
  expect(ready.operations.sort()).toEqual(['contextKeys','echo']);
  const pending=session.request('echo',{hello:'isolated'});
  await expect(pending).resolves.toEqual({echo:{hello:'isolated'}});
  // M13-S01: the activated host context carries only its data dir and version.
  await expect(session.request('contextKeys',null)).resolves.toEqual(['dataDir','genVersion']);
  await expect(session.shutdown(10_000)).resolves.toBe('stopped');
 },30_000);
});
