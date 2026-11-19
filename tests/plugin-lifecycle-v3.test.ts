import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';
import {pluginManifestV2Schema,WORKER_PROTOCOL_VERSION,type WorkerFrameV1} from '../packages/contracts/plugin-worker.ts';
import {IsolatedExtensionHost,type WorkerExit,type WorkerTransport} from '../packages/plugins/isolated-host.ts';
import {admitIsolatedPackage,evaluateMigrationPlan,updatePreview} from '../packages/plugins/lifecycle.ts';
import type {ExecutionBackend} from '../packages/core/execution-policy.ts';

const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const manifest=(over:Record<string,unknown>={})=>pluginManifestV2Schema.parse({manifestVersion:2,pluginId:'sample-ext',version:'1.0.0',packageDigest:hash('package'),protocolVersion:1,declaredCapabilities:['tools.invoke','data.read','data.write'],toolSchemas:[{name:'echo',parameters:{type:'object'}},{name:'secretProbe',parameters:{type:'object'}}],dataNamespace:'sample-ext',executionProfileRef:'WORKSPACE_EXECUTE_NO_NETWORK',...over});
const plan=(over:Record<string,unknown>={})=>({planId:'migration-1',inputVersion:'1.0.0',outputVersion:'2.0.0',backupDigest:hash('backup'),executableSha256:hash('migrator'),approvedAt:new Date().toISOString(),validationReceipt:'receipt-1',...over});

const backend=(over:Partial<ExecutionBackend>={}):ExecutionBackend=>({backendId:'test-backend',platform:process.platform,installed:true,approved:true,proof:{platformProofRef:'proof-1',platform:process.platform,status:'PASS',recordedAt:new Date().toISOString()},launch:async()=>({id:'x',terminate:async()=>{}}),...over});

class FakeTransport implements WorkerTransport{
 sent:WorkerFrameV1[]=[];terminated=false;confirmTerminate=true;operations=['echo','secretProbe'];settleRequests=true;
 private frameHandler?:((frame:WorkerFrameV1)=>void);private exitHandler?:((exit:WorkerExit)=>void);private exitInfo?:WorkerExit;
 send(frame:WorkerFrameV1){
  this.sent.push(frame);
  if(frame.kind==='HELLO'){const hello=frame.payload as {nonce:string;pluginId:string;packageDigest:string};queueMicrotask(()=>this.emit({protocolVersion:WORKER_PROTOCOL_VERSION,requestId:0,generation:frame.generation,kind:'READY',payload:{nonce:hello.nonce,pluginId:hello.pluginId,version:'1.0.0',packageDigest:hello.packageDigest,operations:this.operations}}));}
  if(frame.kind==='REQUEST'&&this.settleRequests)queueMicrotask(()=>this.emit({protocolVersion:WORKER_PROTOCOL_VERSION,requestId:frame.requestId,generation:frame.generation,kind:'RESPONSE',payload:{ok:true,value:(frame.payload as {input:unknown}).input??null}}));
 }
 onFrame(handler:(frame:WorkerFrameV1)=>void){this.frameHandler=handler;}
 onExit(handler:(exit:WorkerExit)=>void){this.exitHandler=handler;if(this.exitInfo)handler(this.exitInfo);}
 async terminate(){this.terminated=true;if(this.confirmTerminate)this.exit({code:0,signal:'SIGKILL'});return this.confirmTerminate;}
 emit(frame:WorkerFrameV1){this.frameHandler?.(frame);}
 exit(info:WorkerExit){this.exitInfo??=info;this.exitHandler?.(this.exitInfo);}
}

const fixture=(over:{enabled?:boolean;backendId?:string|null;backends?:ExecutionBackend[];transport?:FakeTransport}={})=>{
 const transports:FakeTransport[]=[];
 const host=new IsolatedExtensionHost({
  enabled:()=>over.enabled??true,
  approvedBackendId:()=>over.backendId===undefined?'test-backend':over.backendId,
  backends:()=>over.backends??[backend()],
  launcher:{async launch(){const transport=over.transport??new FakeTransport();transports.push(transport);return transport;}},
  drainSettleMs:40,shutdownGraceMs:40,handshakeDeadlineMs:200,
 });
 const manifestV2=manifest();
 host.register(manifestV2,{packageDir:'/pkg/sample-ext',dataDir:'/data/sample-ext'},['test-scope']);
 return {host,transports,manifest:manifestV2};
};

describe('M13 isolated package admission',()=>{
 async function fixturePackage(options:{isolated?:Record<string,unknown>|null;extraFiles?:Record<string,string>}={}){
  const directory=await mkdtemp(join(tmpdir(),'gen-admit-')),source=join(directory,'pkg');
  await mkdir(join(source,'frontend'),{recursive:true});await mkdir(join(source,'host'));
  const manifestJson={id:'sample-ext',name:'Sample',version:'1.0.0',apiVersion:1,compatibleGenVersions:'>=0.6.0 <0.7.0',frontendEntry:'frontend/index.html',hostEntry:'host/main.mjs'};
  const files:Record<string,string>={'plugin.json':JSON.stringify(manifestJson),'frontend/index.html':'<p>x</p>','host/main.mjs':'export default {async activate(){return {operations:{},close:async()=>{}};}};',...options.extraFiles};
  if(options.isolated)files['isolated.json']=JSON.stringify(options.isolated);
  for(const [path,bytes]of Object.entries(files))await writeFile(join(source,path),bytes);
  const inventory={version:1,files:Object.entries(files).map(([path,bytes])=>({path,bytes:Buffer.byteLength(bytes),sha256:hash(bytes)}))};const raw=JSON.stringify(inventory);await writeFile(join(source,'plugin-files.json'),raw);
  return {source,digest:hash(raw)};
 }
 const isolatedDecl={manifestVersion:2,pluginId:'sample-ext',version:'1.0.0',declaredCapabilities:['tools.invoke'],toolSchemas:[{name:'echo',parameters:{}}],dataNamespace:'sample-ext',executionProfileRef:'WORKSPACE_EXECUTE_NO_NETWORK'};
 it('admits a pinned installed package carrying isolated.json and binds the verified digest',async()=>{
  const f=await fixturePackage({isolated:isolatedDecl});
  const admitted=await admitIsolatedPackage(f.source,f.digest);
  expect(admitted?.manifest.packageDigest).toBe(f.digest);
  expect(admitted?.manifest.protocolVersion).toBe(1);
  expect(admitted?.manifest.pluginId).toBe('sample-ext');
 });
 it('returns null for trusted-only packages and rejects identity mismatches',async()=>{
  const plain=await fixturePackage();
  expect(await admitIsolatedPackage(plain.source,plain.digest)).toBeNull();
  const mismatched=await fixturePackage({isolated:{...isolatedDecl,pluginId:'other-ext'}});
  await expect(admitIsolatedPackage(mismatched.source,mismatched.digest)).rejects.toThrowError(expect.objectContaining({code:'INVALID_INPUT'}));
  const tampered=await fixturePackage({isolated:isolatedDecl});
  await expect(admitIsolatedPackage(tampered.source,hash('other'))).rejects.toThrow();
 });
});

describe('M13 activation gate',()=>{
 it('stays disabled while plugins.isolatedV1 is off',async()=>{
  const {host}=fixture({enabled:false});
  await expect(host.activate('sample-ext')).rejects.toThrowError(expect.objectContaining({code:'ACTIVATION_DISABLED'}));
 });
 it('holds with zero or ambiguous approved backend identities and never launches',async()=>{
  const none=fixture({backends:[],backendId:'test-backend'});
  await expect(none.host.activate('sample-ext')).rejects.toThrowError(expect.objectContaining({code:'HOLD_BACKEND_SELECTION'}));
  expect(none.transports).toHaveLength(0);
  const ambiguous=fixture({backends:[backend(),backend()]});
  await expect(ambiguous.host.activate('sample-ext')).rejects.toThrowError(expect.objectContaining({code:'HOLD_BACKEND_SELECTION'}));
  const missing=fixture({backendId:null});
  await expect(missing.host.activate('sample-ext')).rejects.toThrowError(expect.objectContaining({code:'HOLD_BACKEND_SELECTION'}));
  const unapproved=fixture({backends:[backend({approved:false})]});
  await expect(unapproved.host.activate('sample-ext')).rejects.toThrowError(expect.objectContaining({code:'HOLD_BACKEND_SELECTION'}));
 });
 it('holds without a current-platform PASS proof',async()=>{
  const unproven=fixture({backends:[backend({proof:{platformProofRef:'p',platform:process.platform,status:'BLOCKED',recordedAt:new Date().toISOString()}})]});
  await expect(unproven.host.activate('sample-ext')).rejects.toThrowError(expect.objectContaining({code:'HOLD_PLATFORM_PROOF'}));
  const foreignPlatform=process.platform==='win32'?'linux':'win32';
  const foreign=fixture({backends:[backend({proof:{platformProofRef:'p',platform:foreignPlatform,status:'PASS',recordedAt:new Date().toISOString()}})]});
  await expect(foreign.host.activate('sample-ext')).rejects.toThrowError(expect.objectContaining({code:'HOLD_PLATFORM_PROOF'}));
 });
 it('reports HOLD_BACKEND_LAUNCH_BINDING and never reaches the test transport when production wiring has no backend-bound launcher',async()=>{
  let launches=0;let boundCalls=0;
  const host=new IsolatedExtensionHost({
   enabled:()=>true,
   approvedBackendId:()=>'test-backend',
   backends:()=>[backend()],
   launcher:{async launch(){launches++;throw new Error('the development/test transport must never be reached');}},
   productionLauncher:(selected)=>{boundCalls++;expect(selected.backendId).toBe('test-backend');return undefined;},
   drainSettleMs:40,shutdownGraceMs:40,handshakeDeadlineMs:200,
  });
  host.register(manifest(),{packageDir:'/pkg/sample-ext',dataDir:'/data/sample-ext'},['test-scope']);
  await expect(host.activate('sample-ext')).rejects.toThrowError(expect.objectContaining({code:'HOLD_BACKEND_LAUNCH_BINDING'}));
  expect(boundCalls).toBe(1);
  expect(launches).toBe(0);
 });
});

describe('M13 leased lifecycle',()=>{
 it('activates STARTING->ACTIVE, registers declared tools and serves dispatch',async()=>{
  const {host,transports}=fixture();
  const lease=await host.activate('sample-ext');
  expect(lease.state).toBe('ACTIVE');expect(lease.generation).toBe(1);
  expect(lease.registrations).toEqual(expect.arrayContaining([{kind:'tool',id:'echo'},{kind:'tool',id:'secretProbe'}]));
  await expect(host.dispatch('sample-ext','echo',{x:1})).resolves.toEqual({x:1});
  await expect(host.dispatch('sample-ext','missing',null)).rejects.toThrowError(expect.objectContaining({code:'UNAVAILABLE'}));
  expect(transports).toHaveLength(1);
  await host.close();
 });
 it('rejects a worker claiming undeclared operations',async()=>{
  const transport=new FakeTransport();transport.operations=['echo','rmrf'];
  const {host}=fixture({transport});
  await expect(host.activate('sample-ext')).rejects.toThrowError(expect.objectContaining({code:'PROTOCOL_VIOLATION'}));
  expect(host.record('sample-ext')?.lease?.state).toBe('FAILED');
 });
 it('disable drains, confirms teardown and reports STOPPED with retained data',async()=>{
  const {host,transports}=fixture();
  await host.activate('sample-ext');
  await expect(host.disable('sample-ext')).resolves.toBe('STOPPED');
  const record=host.record('sample-ext')!;
  expect(record.retainedData).toBe(true);
  expect(transports[0]!.terminated).toBe(true);
 });
 it('unconfirmed termination reports UNKNOWN and never starts a replacement',async()=>{
  const transport=new FakeTransport();transport.confirmTerminate=false;transport.settleRequests=false;
  const {host}=fixture({transport});
  await host.activate('sample-ext');
  await expect(host.disable('sample-ext')).resolves.toBe('UNKNOWN');
  await expect(host.activate('sample-ext')).rejects.toThrowError(expect.objectContaining({code:'INVALID_STATE'}));
 });
 it('update drains the old generation before publishing the new one',async()=>{
  const {host,transports}=fixture();
  await host.activate('sample-ext');
  const next=manifest({version:'2.0.0',packageDigest:hash('package-2')});
  const result=await host.update('sample-ext',{manifest:next,packageDir:'/pkg/sample-ext-2',dataDir:'/data/sample-ext'});
  expect(result.status).toBe('UPDATED');
  if(result.status==='UPDATED'){expect(result.lease.generation).toBe(2);expect(result.lease.state).toBe('ACTIVE');}
  expect(transports).toHaveLength(2);
  expect(transports[0]!.terminated).toBe(true);
  await host.close();
 });
 it('blocks a migration-needing update without a complete approved plan',async()=>{
  const {host,transports,manifest:current}=fixture();
  await host.activate('sample-ext');
  const next=manifest({version:'2.0.0'});
  expect(await host.update('sample-ext',{manifest:next,packageDir:'/p',dataDir:'/d',requiresMigration:true})).toEqual({status:'MIGRATION_PLAN_REQUIRED'});
  expect(evaluateMigrationPlan(current,next,undefined).status).toBe('MIGRATION_PLAN_REQUIRED');
  expect(evaluateMigrationPlan(current,next,{...plan(),inputVersion:'9.9.9'}).status).toBe('MIGRATION_PLAN_REQUIRED');
  expect(evaluateMigrationPlan(current,next,plan()).status).toBe('READY');
  // The old lease stayed writable: nothing drained for a blocked update.
  expect(host.record('sample-ext')?.lease?.state).toBe('ACTIVE');
  const preview=updatePreview(current,next,true);
  expect(preview.blocked).toBe('MIGRATION_PLAN_REQUIRED');
  // A complete, matching contract is still blocked: no verified migration
  // execution/validation path exists, so nothing may proceed or drain.
  expect(updatePreview(current,next,true,plan()).blocked).toBe('MIGRATION_PLAN_REQUIRED');
  expect(await host.update('sample-ext',{manifest:next,packageDir:'/p',dataDir:'/d',requiresMigration:true,migrationPlan:plan()})).toEqual({status:'MIGRATION_PLAN_REQUIRED'});
  expect(host.record('sample-ext')?.lease?.state).toBe('ACTIVE');
  expect(host.record('sample-ext')?.manifest.version).toBe('1.0.0');
  expect(transports).toHaveLength(1);
  await host.close();
 });
 it('leaves the previous package and namespace intact when the new generation fails',async()=>{
  const {host}=fixture();
  await host.activate('sample-ext');
  // Second launch never answers the handshake.
  const failLauncher={count:0};
  const failing=new IsolatedExtensionHost({enabled:()=>true,approvedBackendId:()=>'test-backend',backends:()=>[backend()],drainSettleMs:20,shutdownGraceMs:20,handshakeDeadlineMs:80,launcher:{async launch(){failLauncher.count++;return failLauncher.count===1?new FakeTransport():Object.assign(new FakeTransport(),{send(){throw new Error('gone')}});}}});
  failing.register(manifest(),{packageDir:'/pkg/a',dataDir:'/data/a'});
  await failing.activate('sample-ext');
  const result=await failing.update('sample-ext',{manifest:manifest({version:'2.0.0'}),packageDir:'/pkg/b',dataDir:'/data/b'});
  expect(result.status).toBe('UNKNOWN');
  expect(failing.record('sample-ext')?.manifest.version).toBe('1.0.0');
  await host.close();await failing.close();
 });
 it('drops late old-generation replies after update without publication',async()=>{
  const {host,transports}=fixture();
  await host.activate('sample-ext');
  const staleTransport=transports[0]!;
  await host.update('sample-ext',{manifest:manifest({version:'2.0.0'}),packageDir:'/p2',dataDir:'/d'});
  const liveTransport=transports[1]!;
  liveTransport.settleRequests=false;
  const pending=host.dispatch('sample-ext','echo','new-gen-work');
  // A generation-1 reply on the retired transport cannot resolve a
  // generation-2 call or publish anything into the active lease.
  staleTransport.emit({protocolVersion:WORKER_PROTOCOL_VERSION,requestId:1,generation:1,kind:'RESPONSE',payload:{ok:true,value:'stale'}});
  const settled=await Promise.race([pending.then(()=>'resolved'),new Promise<string>(resolve=>setTimeout(()=>resolve('outstanding'),60))]);
  expect(settled).toBe('outstanding');
  liveTransport.emit({protocolVersion:WORKER_PROTOCOL_VERSION,requestId:1,generation:2,kind:'RESPONSE',payload:{ok:true,value:'fresh'}});
  await expect(pending).resolves.toBe('fresh');
  expect(host.record('sample-ext')!.lease).toMatchObject({generation:2,state:'ACTIVE'});
  await host.close();
 });
 it('revokes new calls while a busy plug-in unloads and confirms cleanup',async()=>{
  const transport=new FakeTransport();transport.settleRequests=false;
  const {host}=fixture({transport});
  await host.activate('sample-ext');
  const pending=host.dispatch('sample-ext','echo',null).catch(cause=>cause);
  const disabling=host.disable('sample-ext');
  await expect(host.dispatch('sample-ext','echo',null)).rejects.toThrowError(expect.objectContaining({code:'UNAVAILABLE'}));
  await expect(disabling).resolves.toBe('STOPPED');
  expect(transport.terminated).toBe(true);
  await pending;
 });
 it('catalog merges trusted and isolated rows with state, digest and block reason',async()=>{
  const {host}=fixture({backendId:null});
  await host.activate('sample-ext').catch(()=>{});
  const trusted=[{id:'trusted-ext',name:'Trusted',version:'1.0.0',apiVersion:1 as const,compatibleGenVersions:'>=0.6.0',frontendEntry:'frontend/index.html',hostEntry:'host/main.mjs'}];
  const rows=host.catalog(trusted);
  expect(rows).toEqual(expect.arrayContaining([
   expect.objectContaining({pluginId:'trusted-ext',hostKind:'trusted',state:'ACTIVE'}),
   expect.objectContaining({pluginId:'sample-ext',hostKind:'isolated',state:'STOPPED',updateBlocked:'HOLD_BACKEND_SELECTION',retainedData:true,packageDigest:hash('package')}),
  ]));
 });
 it('contributes no rows, trusted included, while the isolated flag is off',async()=>{
  const {host}=fixture({enabled:false});
  await host.activate('sample-ext').catch(()=>{});
  const trusted=[{id:'trusted-ext',name:'Trusted',version:'1.0.0',apiVersion:1 as const,compatibleGenVersions:'>=0.6.0',frontendEntry:'frontend/index.html',hostEntry:'host/main.mjs'}];
  expect(host.catalog(trusted)).toEqual([]);
 });
});
