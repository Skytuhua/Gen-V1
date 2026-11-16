import {spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile} from 'node:fs/promises';
import {dirname, join, relative, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {seedInstalledMemoryProfile} from '../../scripts/installed-memory-retention.ts';
import {runtimeSourceAllowed} from '../../scripts/desktop-assets.ts';
import {acquireProfileLease, type ProfileLease} from '../../apps/server/profile-lease.ts';
import {Store} from '../../packages/storage/store.ts';
import {secureDirectory} from '../../packages/runtime-official/manifest.ts';
import {terminateProcessTree} from '../../packages/runtime-pi/process-tree.ts';

const BASIS='de8700651e6eb97c5a60bf849802b51086244857';
const NODE_SHA='1c331340fa6cac5e4294725959070a143fa0507195a78ad77eed7943f719aac9';
const SOURCE_PINS:Record<string,string>={"packages/core/file-access.ts":"26d9f0d085923047881f96c64d8fdfa3928ab101ea27c4774eeb18ca68ac1f65","packages/core/windows-path-guard.ps1":"31e4f87108c34d2db51e7999bb9b0b64a127c30711d4e7e921dbbc4ae00c6acb","packages/runtime-hermes/home.ts":"f0e725e5a1771760cbf5adbf393c56d723027e4f24ae7fe5d3595c43c5c415a7","packages/runtime-hermes/client.ts":"8e87d57fc6836ba41bf4b3ce5ea8a7c4955134709f651a4402ac88e80d4c1fbb","packages/runtime-official/manifest.ts":"955af9901a71b36aef154e488545e4e647cfe5b883f81817a4944b55574cbc08","packages/storage/store.ts":"3b98fd273214e77cf741ecdc0b1c1a8b6b03f57921b35be14283a7a8271ad9ae","apps/server/profile-lease.ts":"53d0f31ee28855c1cab2713d48847b075f28090ff1aa14f136e56eeb9fa46b87","scripts/installed-memory-retention.ts":"1fbcd0fec46b094c0e7a82c585ea7b9ad31045ae57d975ced6f0eac3a4c230eb","scripts/public-source-files.json":"80e515a7806772aafc84cac6f1b59a91930a1d2b6ffcd20c6aee6766e3ec3401"};
const workspace=resolve('.'),lane=process.argv[2],started=Date.now();
const events:Record<string,unknown>[]=[];
const observe=(stage:string,extra:Record<string,unknown>={})=>{if(events.length<32)events.push({stage,elapsedMs:Date.now()-started,...extra});};
const fail=(kind:string)=>Object.assign(Error('The isolated guard probe failed.'),{probeKind:kind});
function fixedError(value:unknown){
 const item=value&&typeof value==='object'?value as Record<string,unknown>:{};
 const allowed=['CAPABILITY_DENIED','RESOURCE_LIMIT','CANCELLED','PROFILE_IN_USE','PROFILE_LEASE_INVALID','ENOENT','EACCES','EPERM','EINVAL','EPIPE'];
 const code=typeof item.code==='string'&&allowed.includes(item.code)?item.code:null;
 const details=item.details&&typeof item.details==='object'?item.details as Record<string,unknown>:{};
 const nativeCode=typeof details.nativeCode==='string'&&/^-?\d{1,12}$/.test(details.nativeCode)?Number(details.nativeCode):null;
 const kinds=['source-pin','node-pin','platform','lane','ordinary-path','protocol-deadline','protocol-output','protocol-exit','protocol-spawn','protocol-write','guard-close','receipt-bound'];
 return {category:value instanceof Error?'error':'unknown',code,nativeCode,kind:typeof item.probeKind==='string'&&kinds.includes(item.probeKind)?item.probeKind:null};
}
const report:Record<string,unknown>={schemaVersion:1,basisCommit:BASIS,lane,scope:'isolated guard startup; no installed UI, Python worker, model action, or provider request is invoked',networkProviderCalls:null,events,operationStatus:'not-run',captureCompleted:false};
let profileLease:ProfileLease|undefined,store:Store|undefined;
const cleanup={storeClosed:false,profileLeaseClosed:false,ownedGuardClosed:null as boolean|null};

async function stageRuntime(host:string){
 async function visit(directory:string){for(const entry of await readdir(directory,{withFileTypes:true})){
  const input=join(directory,entry.name),part=relative(workspace,input).replaceAll('\\','/');
  if(entry.isSymbolicLink())throw fail('ordinary-path');
  if(entry.isDirectory()){if(!entry.name.startsWith('.')&&!['node_modules','tests','fixtures'].includes(entry.name))await visit(input);}
  else if(runtimeSourceAllowed(part)){const output=join(host,part);await mkdir(dirname(output),{recursive:true});await copyFile(input,output);}
 }}
 await mkdir(host,{recursive:true});await visit(join(workspace,'packages'));await copyFile(join(workspace,'package.json'),join(host,'package.json'));
 for(const [part,wanted] of Object.entries(SOURCE_PINS)){
  const bytes=await readFile(join(workspace,part));if(createHash('sha256').update(bytes).digest('hex')!==wanted)throw fail('source-pin');
  if(part.startsWith('packages/')){const staged=await readFile(join(host,part));if(!staged.equals(bytes))throw fail('source-pin');}
 }
}
async function protocol(home:string,host:string,assertHermesTree:(home:string)=>Promise<void>){
 const parent=dirname(home),executable=join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 const guardStarted=Date.now(),deadline=guardStarted+60_000;
 const child=spawn(executable,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(host,'packages/core/windows-path-guard.ps1')],{stdio:['pipe','pipe','pipe'],windowsHide:true});
 const streams={stdout:{bytes:0,hashedBytes:0,hash:createHash('sha256'),buffer:'',dropping:false},stderr:{bytes:0,hashedBytes:0,hash:createHash('sha256'),buffer:'',dropping:false}};
 const result:Record<string,unknown>={observationOnly:true,observationDeadlineMs:60_000,productionRpcDeadlineMs:15_000,clock:'since-owned-guard-spawn-request',pid:child.pid??null,firstStdoutMs:null,firstStderrMs:null,firstReplyMs:null,nativeCode:null,exit:null,close:null,terminationRequested:false};
 report.protocol=result;
 let pending:{id:string;phase:string;startedAt:number;resolve:()=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}|undefined;
 let closed=false,spawnFailure:Error|undefined;
 const rejectPending=(error:Error)=>{const current=pending;pending=undefined;if(current){clearTimeout(current.timer);current.reject(error);}};
 const elapsed=()=>Date.now()-guardStarted;
 const closing=new Promise<void>(done=>child.once('close',(code,signal)=>{closed=true;result.close={elapsedMs:elapsed(),code,signal};rejectPending(fail('protocol-exit'));done();}));
 child.once('spawn',()=>observe('guard-spawned',{pid:child.pid??null,guardElapsedMs:elapsed()}));
 child.once('error',()=>{spawnFailure=fail('protocol-spawn');rejectPending(spawnFailure);});
 child.once('exit',(code,signal)=>{result.exit={elapsedMs:elapsed(),code,signal};rejectPending(fail('protocol-exit'));});
 child.stdin.on('error',()=>rejectPending(fail('protocol-write')));
 for(const name of ['stdout','stderr'] as const){
  const stream=streams[name];child[name].on('error',()=>rejectPending(fail('protocol-output')));
  child[name].on('data',(chunk:Buffer)=>{
   if(result[name==='stdout'?'firstStdoutMs':'firstStderrMs']===null)result[name==='stdout'?'firstStdoutMs':'firstStderrMs']=elapsed();
   stream.bytes+=chunk.length;const bytes=chunk.subarray(0,Math.max(0,262144-stream.hashedBytes));stream.hashedBytes+=bytes.length;stream.hash.update(bytes);
   for(const character of bytes.toString('utf8')){
    if(character==='\n'){
     if(!stream.dropping){const line=stream.buffer.trim();
      if(name==='stderr'){const match=/^GUARD_NATIVE_ERROR:(-?\d{1,12})$/.exec(line);if(match)result.nativeCode=Number(match[1]);}
      else if(line){const current=pending;if(!current||line!==current.id){rejectPending(fail('protocol-output'));}else{pending=undefined;clearTimeout(current.timer);result.firstReplyMs??=elapsed();const rpcElapsedMs=Date.now()-current.startedAt;observe('guard-response',{phase:current.phase,guardElapsedMs:elapsed(),rpcElapsedMs,afterProductionDeadline:rpcElapsedMs>15_000});current.resolve();}}
     }stream.buffer='';stream.dropping=false;
    }else if(!stream.dropping){if(stream.buffer.length>=2048){stream.buffer='';stream.dropping=true;if(name==='stdout')rejectPending(fail('protocol-output'));}else stream.buffer+=character;}
   }
  });
 }
 const rpc=(phase:string,request:Record<string,unknown>&{id:string})=>new Promise<void>((done,reject)=>{
  if(spawnFailure||closed||child.exitCode!==null||child.signalCode!==null){reject(spawnFailure??fail('protocol-exit'));return;}
  const remaining=deadline-Date.now();if(remaining<=0){reject(fail('protocol-deadline'));return;}
  pending={id:request.id,phase,startedAt:Date.now(),resolve:done,reject,timer:setTimeout(()=>rejectPending(fail('protocol-deadline')),remaining)};
  observe('guard-request',{phase,guardElapsedMs:elapsed()});child.stdin.write(JSON.stringify(request)+'\n');
 });
 try{
  const outer=randomUUID();await rpc('outer-acquire',{command:'acquire',id:outer,paths:[{path:parent,leaf:false,allowChildWrites:true,childWriteRoot:parent}]});
  try{await mkdir(home,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  await assertHermesTree(home);const roots=[home];
  for(const name of ['skills','sessions','workspace','.curator_backups']){const path=join(home,name);try{await mkdir(path,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}roots.push(path);}
  const nested=randomUUID();await rpc('nested-acquire',{command:'acquire',id:nested,paths:roots.map(path=>({path,leaf:false,allowChildWrites:true,childWriteRoot:parent}))});
  await assertHermesTree(home);observe('guard-action-entered',{guardElapsedMs:elapsed()});
  await rpc('nested-release',{command:'release',id:nested});
 }finally{
  child.stdin.end();let timer:ReturnType<typeof setTimeout>|undefined;
  await Promise.race([closing,new Promise<void>(done=>{timer=setTimeout(done,2000);})]);clearTimeout(timer);
  if(!closed){result.terminationRequested=true;await terminateProcessTree(child);await closing;}
  cleanup.ownedGuardClosed=closed;
  result.streams=Object.fromEntries(Object.entries(streams).map(([name,s])=>[name,{bytes:s.bytes,hashedBytes:s.hashedBytes,sha256:s.hash.digest('hex'),truncated:s.bytes>s.hashedBytes,hashScope:'prefix',hashLimitBytes:262144}]));
 }
 if(!closed||child.exitCode!==0||child.signalCode!==null)throw fail('guard-close');
}

try{
 if(process.platform!=='win32'||process.arch!=='x64')throw fail('platform');
 if(lane!=='production'&&lane!=='protocol')throw fail('lane');
 const node=await readFile(process.execPath);if(process.versions.node!=='24.22.2'||createHash('sha256').update(node).digest('hex')!==NODE_SHA)throw fail('node-pin');
 report.node={version:process.versions.node,sha256:NODE_SHA};report.sourcePins=SOURCE_PINS;
 const host=join(workspace,'.harness-guard-startup-package','resources','host');await stageRuntime(host);
 const parent=join(workspace,'.harness-desktop-installed');await mkdir(parent,{recursive:true});
 const owned=join(parent,'run-'+Date.now()+'-'+randomUUID());await mkdir(owned);
 const seed=await seedInstalledMemoryProfile(owned);profileLease=acquireProfileLease(seed.profile.path);store=new Store(profileLease.dataDir);
 const home=await secureDirectory(seed.profile.path,join(seed.profile.path,'hermes'));
 const homeInfo=await lstat(home);if(!homeInfo.isDirectory()||homeInfo.isSymbolicLink()||await realpath(home)!==home)throw fail('ordinary-path');
 report.profile={seededByProductionFixture:true,profileLeaseHeld:true,storeOpen:true,homeExistsBeforeGuard:true,shape:'owned/host/hermes',profilePathCharacters:seed.profile.path.length,homePathCharacters:home.length,accountCount:store.all('account').length,activeRunCount:store.all<{runId?:unknown}>('thread').filter(x=>x.runId!=null).length};
 const allowed=['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','LANG','LC_ALL','TERM','TEMP','TMP','USERPROFILE','HOME','LOCALAPPDATA','APPDATA'];
 for(const name of Object.keys(process.env))if(!allowed.includes(name))delete process.env[name];
 process.env.HARNESS_PACKAGED='1';process.env.HARNESS_DATA_DIR=seed.profile.path;process.env.HARNESS_DESKTOP_TEST_DATA_DIR=owned;
 process.chdir(host);
 const {withHermesHome,assertHermesTree}=await import(pathToFileURL(join(host,'packages/runtime-hermes/home.ts')).href) as typeof import('../../packages/runtime-hermes/home.ts');
 observe('profile-ready');report.operationStatus='running';
 if(lane==='production'){
  report.production={unchangedHelper:true,ordinaryRpcDeadlineMs:15_000};const begin=Date.now();
  try{await withHermesHome(home,async()=>{observe('guard-action-entered',{guardElapsedMs:Date.now()-begin});});cleanup.ownedGuardClosed=true;}
  finally{report.production={...report.production as object,elapsedMs:Date.now()-begin};}
 }else await protocol(home,host,assertHermesTree);
 report.operationStatus='passed';
}catch(error){report.operationStatus='failed';report.failure=fixedError(error);observe('probe-failed');process.exitCode=1;}
finally{
 try{store?.close();cleanup.storeClosed=!!store;}catch{cleanup.storeClosed=false;process.exitCode=1;report.operationStatus='failed';}
 try{profileLease?.close();cleanup.profileLeaseClosed=!!profileLease;}catch{cleanup.profileLeaseClosed=false;process.exitCode=1;report.operationStatus='failed';}
 report.cleanup=cleanup;report.elapsedMs=Date.now()-started;report.captureCompleted=true;
 const output=JSON.stringify(report);if(Buffer.byteLength(output)>16384)throw fail('receipt-bound');
 const directory=join(workspace,'guard-startup-results');await mkdir(directory,{recursive:true});
 await writeFile(join(directory,'receipt-'+(lane==='production'?'production':'protocol')+'.json'),output+'\n',{flag:'wx'});
 console.log('M05_GUARD_PROBE_JSON '+output);
}
