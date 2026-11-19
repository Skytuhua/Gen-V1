import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {
 WORKER_FRAME_MAX_BYTES,WORKER_MAX_INFLIGHT_REQUESTS,WORKER_PROTOCOL_VERSION,
 pluginManifestV2Schema,type WorkerFrameV1,
} from '../packages/contracts/plugin-worker.ts';
import {
 IsolatedExtensionHost,IsolatedWorkerSession,WorkerFrameDecoder,encodeWorkerFrame,
 type WorkerExit,type WorkerTransport,
} from '../packages/plugins/isolated-host.ts';
import type {ExecutionBackend} from '../packages/core/execution-policy.ts';

// M13 v6 decision cases. Each test maps to exactly one required decision
// identifier; none is a placeholder pass.

const hash=(value:string)=>(createHash('sha256').update(value).digest('hex'));
const frame=(over:Partial<WorkerFrameV1>={}):WorkerFrameV1=>({protocolVersion:WORKER_PROTOCOL_VERSION,requestId:1,generation:1,kind:'RESPONSE',payload:{ok:true,value:null},...over});
const manifest=(over:Record<string,unknown>={})=>pluginManifestV2Schema.parse({manifestVersion:2,pluginId:'sample-ext',version:'1.0.0',packageDigest:hash('package'),protocolVersion:1,declaredCapabilities:['tools.invoke'],toolSchemas:[{name:'echo',parameters:{type:'object'}}],dataNamespace:'sample-ext',executionProfileRef:'WORKSPACE_EXECUTE_NO_NETWORK',...over});
const backend:ExecutionBackend={backendId:'test-backend',platform:process.platform,installed:true,approved:true,proof:{platformProofRef:'proof-1',platform:process.platform,status:'PASS',recordedAt:new Date().toISOString()},launch:async()=>({id:'x',terminate:async()=>{}})};

class FakeTransport implements WorkerTransport{
 sent:WorkerFrameV1[]=[];terminated=false;confirmTerminate=true;autoSettle=true;
 private frameHandler?:((frame:WorkerFrameV1)=>void);private exitHandler?:((exit:WorkerExit)=>void);private exitInfo?:WorkerExit;
 send(frame:WorkerFrameV1){
  this.sent.push(frame);
  if(frame.kind==='HELLO'){const hello=frame.payload as {nonce:string;pluginId:string;packageDigest:string};queueMicrotask(()=>this.emit({protocolVersion:WORKER_PROTOCOL_VERSION,requestId:0,generation:frame.generation,kind:'READY',payload:{nonce:hello.nonce,pluginId:hello.pluginId,version:'1.0.0',packageDigest:hello.packageDigest,operations:['echo']}}));}
  if(frame.kind==='REQUEST'&&this.autoSettle)queueMicrotask(()=>this.emit({protocolVersion:WORKER_PROTOCOL_VERSION,requestId:frame.requestId,generation:frame.generation,kind:'RESPONSE',payload:{ok:true,value:null}}));
 }
 onFrame(handler:(frame:WorkerFrameV1)=>void){this.frameHandler=handler;}
 onExit(handler:(exit:WorkerExit)=>void){this.exitHandler=handler;if(this.exitInfo)handler(this.exitInfo);}
 async terminate(){this.terminated=true;if(this.confirmTerminate)this.exit({code:0,signal:'SIGKILL'});return this.confirmTerminate;}
 emit(frame:WorkerFrameV1){this.frameHandler?.(frame);}
 exit(info:WorkerExit){this.exitInfo??=info;this.exitHandler?.(this.exitInfo);}
}

const connect=async(transport:FakeTransport,generation=1)=>IsolatedWorkerSession.connect(transport,{pluginId:'sample-ext',packageDigest:hash('package'),dataNamespace:'sample-ext',generation},300);
const fixture=(transports:FakeTransport[])=>new IsolatedExtensionHost({enabled:()=>true,approvedBackendId:()=>'test-backend',backends:()=>[backend],drainSettleMs:40,shutdownGraceMs:40,handshakeDeadlineMs:300,launcher:{async launch(){const transport=new FakeTransport();transports.push(transport);return transport;}}});

it('M13-D01 framing bounds: 1 MiB is schema-checked; 1 MiB+1 announced is rejected before allocation',()=>{
 const decoder=new WorkerFrameDecoder();
 // Exactly 1 MiB: the frame is fully read and schema-checked.
 const payload='x'.repeat(WORKER_FRAME_MAX_BYTES-220);
 const outgoing=frame({requestId:9,payload});
 const wire=encodeWorkerFrame(outgoing);
 expect(wire.length-4).toBeLessThanOrEqual(WORKER_FRAME_MAX_BYTES);
 expect(decoder.push(wire)).toEqual([outgoing]);
 // 1 MiB+1 announced length is rejected before the payload is allocated,
 // even though only the 4-byte header has arrived.
 const oversized=new WorkerFrameDecoder(),header=Buffer.alloc(4);header.writeUInt32LE(WORKER_FRAME_MAX_BYTES+1,0);
 expect(()=>oversized.push(header)).toThrowError(expect.objectContaining({code:'FRAME_TOO_LARGE'}));
 // A maximal body that parses but fails the frame schema is still checked.
 const shaped=new WorkerFrameDecoder(),announced=Buffer.alloc(4);announced.writeUInt32LE(WORKER_FRAME_MAX_BYTES,0);
 expect(()=>shaped.push(Buffer.concat([announced,Buffer.from('[]'),Buffer.alloc(WORKER_FRAME_MAX_BYTES-2,0x20)]))).toThrowError(expect.objectContaining({code:'PROTOCOL_VIOLATION'}));
});

it('M13-D02 inflight cap: 32 outstanding; the 33rd is BUSY without dispatch; one settlement re-admits',async()=>{
 const transport=new FakeTransport();transport.autoSettle=false;
 const {session}=await connect(transport);
 const calls=[];for(let i=0;i<WORKER_MAX_INFLIGHT_REQUESTS;i++)calls.push(session.request('echo',null));
 const sent=()=>transport.sent.filter(sent=>sent.kind==='REQUEST');
 expect(sent()).toHaveLength(WORKER_MAX_INFLIGHT_REQUESTS);
 // Request 33 gets BUSY and is never dispatched to the worker.
 await expect(session.request('echo',null)).rejects.toThrowError(expect.objectContaining({code:'PLUGIN_BUSY'}));
 expect(sent()).toHaveLength(WORKER_MAX_INFLIGHT_REQUESTS);
 // Settle one: a new request may enter.
 transport.emit(frame({requestId:sent()[0]!.requestId,kind:'RESPONSE',payload:{ok:true,value:null}}));
 await calls[0];
 const admitted=session.request('echo',null);
 expect(sent()).toHaveLength(WORKER_MAX_INFLIGHT_REQUESTS+1);
 for(const request of sent())transport.emit(frame({requestId:request.requestId,kind:'RESPONSE',payload:{ok:true,value:null}}));
 await Promise.allSettled([...calls,admitted]);
 await session.shutdown(60);
});

it('M13-D03 stale reply: an old-generation response after update causes no host mutation or UI publication',async()=>{
 const transports:FakeTransport[]=[];
 const host=fixture(transports);
 host.register(manifest(),{packageDir:'/pkg/a',dataDir:'/data/a'});
 await host.activate('sample-ext');
 const staleTransport=transports[0]!;
 await host.update('sample-ext',{manifest:manifest({version:'2.0.0'}),packageDir:'/pkg/b',dataDir:'/data/b'});
 const liveTransport=transports[1]!;liveTransport.autoSettle=false;
 const pending=host.dispatch('sample-ext','echo','work');
 const before=host.catalog();
 // Late generation-1 replies on the retired transport cannot resolve the
 // generation-2 call or publish registrations.
 staleTransport.emit(frame({requestId:1,generation:1,payload:{ok:true,value:'stale'}}));
 staleTransport.emit(frame({requestId:0,generation:1,kind:'READY',payload:{nonce:'0'.repeat(32),pluginId:'sample-ext',version:'1.0.0',packageDigest:hash('package'),operations:['echo']}}));
 const settled=await Promise.race([pending.then(()=>'resolved'),new Promise<string>(resolve=>setTimeout(()=>resolve('outstanding'),60))]);
 expect(settled).toBe('outstanding');
 expect(host.catalog()).toEqual(before);
 liveTransport.emit(frame({requestId:1,generation:2,payload:{ok:true,value:'fresh'}}));
 await expect(pending).resolves.toBe('fresh');
 await host.close();
});

it('M13-D04 drain failure: unconfirmed process termination yields UNKNOWN and no new writable worker starts',async()=>{
 const transports:FakeTransport[]=[];
 const host=new IsolatedExtensionHost({enabled:()=>true,approvedBackendId:()=>'test-backend',backends:()=>[backend],drainSettleMs:40,shutdownGraceMs:40,handshakeDeadlineMs:300,launcher:{async launch(){const transport=new FakeTransport();transport.autoSettle=false;transports.push(transport);return transport;}}});
 host.register(manifest(),{packageDir:'/pkg/a',dataDir:'/data/a'});
 await host.activate('sample-ext');
 // Termination of the old process tree can never be confirmed.
 transports[0]!.confirmTerminate=false;
 const result=await host.update('sample-ext',{manifest:manifest({version:'2.0.0'}),packageDir:'/pkg/b',dataDir:'/data/b'});
 expect(result).toEqual({status:'UNKNOWN',reason:'The previous generation could not be confirmed stopped; no new writable generation was started.'});
 expect(host.record('sample-ext')?.lease?.state).toBe('UNKNOWN');
 // No new writable worker may start while the old drain is unconfirmed.
 await expect(host.activate('sample-ext')).rejects.toThrowError(expect.objectContaining({code:'INVALID_STATE'}));
 expect(transports).toHaveLength(1);
});

it('M13-D05 real confinement is not satisfiable without a proven installed backend',async()=>{
 // This host has no installed approved backend with a current PASS proof:
 // the real-confinement cases (protected DB/credential reads, out-of-root
 // writes, network access) must run under the actual selected backend and
 // cannot be claimed here. The lane fails closed and reports its hold.
 const host=new IsolatedExtensionHost({enabled:()=>true,approvedBackendId:()=>undefined,backends:()=>[],drainSettleMs:40,shutdownGraceMs:40,handshakeDeadlineMs:300,launcher:{async launch(){throw Error('The launcher must never run.');}}});
 host.register(manifest(),{packageDir:'/pkg/a',dataDir:'/data/a'});
 await expect(host.activate('sample-ext')).rejects.toThrowError(expect.objectContaining({code:'HOLD_BACKEND_SELECTION'}));
 expect(host.record('sample-ext')?.blocked).toBe('HOLD_BACKEND_SELECTION');
});
