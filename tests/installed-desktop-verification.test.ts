import {describe,it,expect,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,realpath,rename,symlink,rm,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {PassThrough} from 'node:stream';
import type {ChildProcess} from 'node:child_process';
import {nsisApplicationGuid,assertClearInstallPreflight,assertOwnedInstallEntries,installedCommandArguments,packageContentManifest,assertMatchingContents,parseOwnedUninstaller,assertInstalledCleanExit,assertWindowsDestinationFits,type InstallPreflight} from '../scripts/verify-installed-desktop.ts';
import * as installedVerification from '../scripts/verify-installed-desktop.ts';
import {Store} from '../packages/storage/store.ts';
import {ProjectMemory} from '../packages/core/project-memory.ts';
import {registeredCapabilityFlags} from '../packages/core/capability-flags.ts';
import {MemoryConsolidator} from '../packages/core/memory-consolidation.ts';
import type {MemoryAction} from '../packages/contracts/project-memory.ts';

const directory='C:\\verification\\exclusive\\installed';
const clear=():InstallPreflight=>({entries:[],runningAppPids:[],shortcuts:[],updaterCache:{path:'C:\\fixture\\generative-harness-desktop-updater',present:false}});
describe('installed subscription readiness',()=>{
 it('names the provider whose Connect button stayed blocked without accepting the blocked state',async()=>{
  const guard=installedVerification.assertInstalledConnectionReady;
  expect(typeof guard).toBe('function');
  await expect(guard('cursor-sdk',async()=> 'disabled:blocked',20)).rejects
    .toThrow(/installed subscription cursor-sdk[\s\S]*disabled:blocked/i);
  await expect(guard('gemini-cli',async()=> 'enabled',20)).resolves.toBeUndefined();
 });
});

describe('installed desktop verification custody',()=>{
 it('creates a separate ordinary ownership receipt for the enabled phase before its native Save lease',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'installed-memory-phase-owner-')));
  const owner={setup:join(root,'setup.exe'),setupSha256:'a'.repeat(64),installDirectory:join(root,'installed'),guid:'owned-installation'};
  try{
   await writeFile(join(root,'owner.json'),JSON.stringify(owner),{flag:'wx'});
   const directory=await installedVerification.prepareInstalledMemoryPhaseDirectory(root,owner),receipt=join(directory,'owner.json');
   const info=await lstat(receipt,{bigint:true});
   expect(info.isFile()&&!info.isSymbolicLink()).toBe(true);expect(info.nlink).toBe(1n);
   expect(JSON.parse(await readFile(receipt,'utf8'))).toEqual(owner);
   const {prepareInstalledNativeSave}=await import('../scripts/installed-native-save.ts');
   expect((await prepareInstalledNativeSave(directory)).directory.path).toBe(directory);
   await expect(installedVerification.prepareInstalledMemoryPhaseDirectory(root,owner)).rejects.toMatchObject({code:'EEXIST'});
   expect(JSON.parse(await readFile(receipt,'utf8'))).toEqual(owner);
   expect(JSON.parse(await readFile(join(root,'owner.json'),'utf8'))).toEqual(owner);
  }finally{await rm(root,{recursive:true,force:true});}
 });
 it('records installer exit separately from close and never copies child text into lifecycle evidence',()=>{
  const observe=(installedVerification as unknown as {observeOwnedProcess:(child:ChildProcess,phase:'installer',timeoutMs:number,clock:()=>number)=>{status:string;pid:number|null;spawnElapsedMs:number|null;exit:{elapsedMs:number;code:number|null;signal:string|null}|null;close:{elapsedMs:number;code:number|null;signal:string|null}|null;stdoutBytes:number;stderrBytes:number}}).observeOwnedProcess;
  expect(typeof observe).toBe('function');
  const fake=Object.assign(new EventEmitter(),{pid:123,stdout:new PassThrough(),stderr:new PassThrough()});
  let now=100;const value=observe(fake as unknown as ChildProcess,'installer',600000,()=>now);
  now=105;fake.emit('spawn');
  fake.stdout.write('PRIVATE_SOURCE_BODY');fake.stderr.write('provider-secret=never-record');
  now=110;fake.emit('exit',0,null);
  expect(value).toMatchObject({status:'running',pid:123,spawnElapsedMs:5,exit:{elapsedMs:10,code:0,signal:null},close:null,stdoutBytes:19,stderrBytes:28});
  now=200;fake.emit('close',0,null);
  expect(value).toMatchObject({status:'completed',close:{elapsedMs:100,code:0,signal:null}});
  expect(JSON.stringify(value)).not.toMatch(/PRIVATE_SOURCE_BODY|provider-secret|never-record/);
  for(const state of [{exit:false,code:0,signal:null},{exit:true,code:7,signal:null},{exit:true,code:null,signal:'SIGTERM'}]){
   const child=Object.assign(new EventEmitter(),{pid:124,stdout:new PassThrough(),stderr:new PassThrough()});
   const failed=observe(child as unknown as ChildProcess,'installer',600000,()=>now);
   child.emit('spawn');if(state.exit)child.emit('exit',state.code,state.signal);child.emit('close',state.code,state.signal);
   expect(failed.status).toBe('failed');
  }
 });
 it('preserves the first installer failure through later termination error, exit and close events',()=>{
  for(const reason of ['deadline','output-bound'] as const){
   const child=Object.assign(new EventEmitter(),{pid:123,stdout:new PassThrough(),stderr:new PassThrough()});
   let now=100;const value=installedVerification.observeOwnedProcess(child as unknown as ChildProcess,'installer',600000,()=>now);
   child.emit('spawn');value.status='failed';value.failure=reason;value.terminationRequested=true;
   now=110;child.emit('error',Error('PRIVATE_TERMINATION_ERROR'));
   now=120;child.emit('exit',null,'SIGTERM');now=130;child.emit('close',null,'SIGTERM');
   expect(value).toMatchObject({status:'failed',failure:reason,terminationRequested:true,exit:{elapsedMs:20,code:null,signal:'SIGTERM'},close:{elapsedMs:30,code:null,signal:'SIGTERM'}});
   expect(JSON.stringify(value)).not.toContain('PRIVATE_TERMINATION_ERROR');
  }
 });
 it('samples a fixed bounded set of expected files without retaining source paths or adopting a replaced destination',async()=>{
  const create=(installedVerification as unknown as {createInstalledPathProgressSampler:(directory:string,files:{path:string;bytes:number}[])=>Promise<(elapsedMs:number)=>Promise<Record<string,unknown>>>}).createInstalledPathProgressSampler;
  expect(typeof create).toBe('function');
  const fixture=await realpath(await mkdtemp(join(tmpdir(),'installed-progress-'))),destination=join(fixture,'owned');
  try{
   const files=Array.from({length:40},(_,index)=>({path:'PRIVATE_SOURCE_PATH_'+String(index).padStart(2,'0')+'.bin',bytes:10}));
   const sample=await create(destination,files);
   expect(await sample(0)).toMatchObject({root:'absent',sampledFiles:16,absent:16,sizeMatched:0,sizeMismatched:0,refused:0,uninstaller:'absent'});
   await mkdir(destination);await writeFile(join(destination,files[0]!.path),'0123456789');await writeFile(join(destination,files.at(-1)!.path),'bad');await writeFile(join(destination,'Uninstall Gen V1.exe'),'stub');
   const progress=await sample(30000);
   expect(progress).toMatchObject({root:'ordinary',sampledFiles:16,absent:14,sizeMatched:1,sizeMismatched:1,refused:0,uninstaller:'regular'});
   expect(JSON.stringify(progress)).not.toMatch(/PRIVATE_SOURCE_PATH|installed-progress|stub/);
   await rename(destination,join(fixture,'original'));await mkdir(destination);
   expect(await sample(120000)).toMatchObject({root:'refused',sampledFiles:16,refused:16,uninstaller:'refused'});
  }finally{await rm(fixture,{recursive:true,force:true});}
 });
 it('refuses unsafe sample paths and redirected parents without following them',async()=>{
  const create=(installedVerification as unknown as {createInstalledPathProgressSampler:(directory:string,files:{path:string;bytes:number}[])=>Promise<(elapsedMs:number)=>Promise<Record<string,unknown>>>}).createInstalledPathProgressSampler;
  expect(typeof create).toBe('function');
  const fixture=await realpath(await mkdtemp(join(tmpdir(),'installed-progress-redirect-'))),destination=join(fixture,'owned');
  try{
   await mkdir(destination);await mkdir(join(fixture,'outside'));await writeFile(join(fixture,'outside','PRIVATE_BODY.txt'),'x');
   for(const path of ['../outside','/absolute','C:\\outside','a//b','a/../b'])await expect(create(destination,[{path,bytes:1}])).rejects.toThrow(/path|manifest/i);
   await symlink(join(fixture,'outside'),join(destination,'redirect'),'junction');
   const sample=await create(destination,[{path:'redirect/PRIVATE_BODY.txt',bytes:1}]);
   const progress=await sample(30000);
   expect(progress).toMatchObject({root:'ordinary',sampledFiles:1,refused:1,sizeMatched:0,uninstaller:'absent'});
   expect(JSON.stringify(progress)).not.toMatch(/PRIVATE_BODY|outside|redirect/);
  }finally{await rm(fixture,{recursive:true,force:true});}
 });
 it('retains only bounded fixed preflight milestones without copying child output or commands',()=>{
  const parse=(installedVerification as unknown as {parseInstallPreflightProgress:(stderr:string)=>{phase:string;scriptElapsedMs:number}[]}).parseInstallPreflightProgress;
  expect(typeof parse).toBe('function');
  const input=[
   'PRIVATE_COMMAND_SENTINEL provider-secret=do-not-record',
   'HARNESS_INSTALL_PREFLIGHT_PHASE=script-start:0',
   'HARNESS_INSTALL_PREFLIGHT_PHASE=registry-complete:12',
   'HARNESS_INSTALL_PREFLIGHT_PHASE=PRIVATE_COMMAND_SENTINEL:13',
   'HARNESS_INSTALL_PREFLIGHT_PHASE=registry-complete:14',
   'HARNESS_INSTALL_PREFLIGHT_PHASE=shortcuts-complete:11',
   'HARNESS_INSTALL_PREFLIGHT_PHASE=shortcuts-complete:20',
   'HARNESS_INSTALL_PREFLIGHT_PHASE=cache-complete:25',
   'HARNESS_INSTALL_PREFLIGHT_PHASE=processes-complete:31',
   'HARNESS_INSTALL_PREFLIGHT_PHASE=result-complete:33',
   'HARNESS_INSTALL_PREFLIGHT_PHASE=script-start:34',
  ].join('\r\n');
  expect(parse(input)).toEqual([
   {phase:'script-start',scriptElapsedMs:0},{phase:'registry-complete',scriptElapsedMs:12},
   {phase:'shortcuts-complete',scriptElapsedMs:20},{phase:'cache-complete',scriptElapsedMs:25},
   {phase:'processes-complete',scriptElapsedMs:31},{phase:'result-complete',scriptElapsedMs:33},
  ]);
  expect(JSON.stringify(parse(input))).not.toMatch(/PRIVATE_COMMAND_SENTINEL|provider-secret|do-not-record/);
 });
 it('refuses malformed or unbounded preflight timings and bounds retained output',()=>{
  const parse=(installedVerification as unknown as {parseInstallPreflightProgress:(stderr:string)=>{phase:string;scriptElapsedMs:number}[]}).parseInstallPreflightProgress;
  expect(typeof parse).toBe('function');
  for(const value of ['-1','NaN','Infinity','60001','1.5','1 trailing-output'])expect(parse('HARNESS_INSTALL_PREFLIGHT_PHASE=script-start:'+value)).toEqual([]);
  expect(parse('HARNESS_INSTALL_PREFLIGHT_PHASE=script-start:0\n'+'UNTRUSTED_OUTPUT\n'.repeat(2000))).toEqual([]);
 });
 it('rejects a destination that exceeds the conservative Windows path budget',()=>{
  const file='resources\\host\\node_modules\\'+'x'.repeat(139);
  expect(()=>assertWindowsDestinationFits('C:\\Users\\user\\AppData\\Local\\Programs\\generative-harness-desktop',[file])).not.toThrow();
  expect(()=>assertWindowsDestinationFits('C:\\'+ 'x'.repeat(130),[file])).toThrow(/path|260/i);
 });
 it('requires an observed clean process exit before accepting an installed launch',()=>{
  expect(()=>assertInstalledCleanExit({exitCode:0,signalCode:null})).not.toThrow();
  for(const state of [{exitCode:1,signalCode:null},{exitCode:null,signalCode:'SIGTERM'},{exitCode:null,signalCode:null}])expect(()=>assertInstalledCleanExit(state)).toThrow(/exit/i);
 });
 it('derives the same fixed NSIS identity as the pinned builder',()=>{
  expect(nsisApplicationGuid('local.generativeharness.desktop')).toBe('f973205b-ac9b-56c0-baad-730abd2ca4b3');
 });
 it('refuses existing registry state, native processes, shortcuts and updater caches',()=>{
  expect(()=>assertClearInstallPreflight(clear())).not.toThrow();
  for(const value of [
   {...clear(),entries:[{hive:'HKCU',view:64,kind:'install',values:{InstallLocation:directory}}]},
   {...clear(),runningAppPids:[123]},
   {...clear(),shortcuts:[{path:'C:\\fixture\\Gen V1.lnk',present:true}]},
   {...clear(),updaterCache:{path:'C:\\fixture\\cache',present:true}}
  ] as InstallPreflight[])expect(()=>assertClearInstallPreflight(value)).toThrow(/existing|running/i);
 });
 it('keeps NSIS directory-tail arguments literal and rejects command-line syntax in paths',()=>{
  expect(installedCommandArguments('install',directory)).toEqual(['/S','/D='+directory]);
  expect(installedCommandArguments('uninstall',directory)).toEqual(['/S','/KEEP_APP_DATA','/currentuser','_?='+directory]);
  for(const path of ['relative/path','C:\\a"b','C:\\a\nb','C:\\a\0b'])expect(()=>installedCommandArguments('install',path)).toThrow();
 });
 it('accepts only a quoted exact owned uninstaller and known per-user flag',()=>{
  expect(parseOwnedUninstaller('"'+directory+'\\Uninstall Gen V1.exe" /currentuser',directory)).toBe(directory+'\\Uninstall Gen V1.exe');
  for(const command of [
   '"C:\\other\\Uninstall Gen V1.exe" /currentuser',
   '"'+directory+'\\Uninstall Gen V1.exe" /allusers',
   '"'+directory+'\\Uninstall Gen V1.exe" /delete-app-data',
   directory+'\\Uninstall Gen V1.exe /currentuser',
   '"'+directory+'\\other.exe"'
  ])expect(()=>parseOwnedUninstaller(command,directory)).toThrow(/owned|uninstall/i);
 });
 it('requires matching per-user installation and uninstall entries before cleanup',()=>{
  const entries=[{hive:'HKCU',view:64,kind:'install',values:{InstallLocation:directory}},{hive:'HKCU',view:64,kind:'uninstall',values:{UninstallString:'"'+directory+'\\Uninstall Gen V1.exe" /currentuser',DisplayVersion:'0.4.0'}}] as const;
  expect(assertOwnedInstallEntries([...entries],directory,'0.4.0')).toBe(directory+'\\Uninstall Gen V1.exe');
  expect(()=>assertOwnedInstallEntries([entries[0]],directory,'0.4.0')).toThrow();
  expect(()=>assertOwnedInstallEntries([...entries,{...entries[0],hive:'HKLM'}],directory,'0.4.0')).toThrow();
  expect(()=>assertOwnedInstallEntries([...entries],directory,'0.5.0')).toThrow();
 });
 it('compares all installed payload files while allowing only the fixed added uninstaller',async()=>{
  const fixture=await mkdtemp(join(tmpdir(),'harness-installed-manifest-'));
  try{
   const source=join(fixture,'source'),installed=join(fixture,'installed');
   for(const path of [source,installed]){await mkdir(path);await mkdir(join(path,'resources'));await writeFile(join(path,'Gen V1.exe'),'app');await writeFile(join(path,'resources','chunk.js'),'lazy');}
   await writeFile(join(installed,'Uninstall Gen V1.exe'),'uninstaller');
   const expected=await packageContentManifest(source);
   const actual=await packageContentManifest(installed,{installed:true});assertMatchingContents(expected,actual);
   await writeFile(join(installed,'resources','chunk.js'),'changed');
   const changed=await packageContentManifest(installed,{installed:true});expect(()=>assertMatchingContents(expected,changed)).toThrow(/differ/i);
   await writeFile(join(installed,'resources','chunk.js'),'lazy');await writeFile(join(installed,'unexpected.exe'),'extra');
   const extra=await packageContentManifest(installed,{installed:true});expect(()=>assertMatchingContents(expected,extra)).toThrow(/differ/i);
  }finally{await rm(fixture,{recursive:true,force:true});}
 });
});

describe('installed project memory retention fixture',()=>{
 it('requires an explicit retention option and rejects unknown or duplicated options',()=>{
  expect(installedVerification.readInstalledVerificationArguments(['setup','unpacked'])).toEqual({setup:'setup',unpacked:'unpacked',memoryRetention:false,memoryEnabled:false});
  expect(installedVerification.readInstalledVerificationArguments(['setup','unpacked','--project-memory-retention'])).toEqual({setup:'setup',unpacked:'unpacked',memoryRetention:true,memoryEnabled:false});
  expect(installedVerification.readInstalledVerificationArguments(['setup','unpacked','--project-memory-retention','--project-memory-enabled'])).toEqual({setup:'setup',unpacked:'unpacked',memoryRetention:true,memoryEnabled:true});
  for(const args of [[],['setup'],['setup','unpacked','--enable-memory'],['setup','unpacked','--project-memory-enabled'],['setup','unpacked','--project-memory-retention','--project-memory-retention'],['setup','unpacked','--project-memory-retention','--project-memory-enabled','--project-memory-enabled']])expect(()=>installedVerification.readInstalledVerificationArguments(args)).toThrow(/usage|pass|option/i);
 });
 it('activates only project memory for explicit enabled launches and never inherits ambient feature flags',()=>{
  vi.stubEnv('HARNESS_FLAG_MEMORY_PROJECT_V1','true');vi.stubEnv('HARNESS_FLAG_MEMORY_EXTERNAL_RECALL_EXPERIMENT_V1','true');vi.stubEnv('HARNESS_FLAG_CONTEXT_COMPILER_V1','true');
  try{
   const enabled=installedVerification.installedVerificationEnvironment('disposable',[4317,4318,4319],'enabled');
   expect(enabled.HARNESS_FLAG_MEMORY_PROJECT_V1).toBe('true');
   for(const env of [enabled,installedVerification.installedVerificationEnvironment('disposable',[4317,4318,4319],'default-off'),installedVerification.installedVerificationEnvironment('disposable',[4317,4318,4319])]){
    expect(env.HARNESS_DESKTOP_TEST_DATA_DIR).toBe('disposable');expect(env.HARNESS_DESKTOP_PORT).toBe('4317');expect(env.HARNESS_DESKTOP_WIDGET_PORT).toBe('4318');
    expect(env.HARNESS_FLAG_MEMORY_EXTERNAL_RECALL_EXPERIMENT_V1).toBeUndefined();expect(env.HARNESS_FLAG_CONTEXT_COMPILER_V1).toBeUndefined();
   }
   expect(installedVerification.installedVerificationEnvironment('disposable',[4317,4318,4319],'default-off').HARNESS_FLAG_MEMORY_PROJECT_V1).toBeUndefined();
   expect(installedVerification.installedVerificationEnvironment('disposable',[4317,4318,4319]).HARNESS_FLAG_MEMORY_PROJECT_V1).toBeUndefined();
  }finally{vi.unstubAllEnvs();}
 });
 it('audits an enabled profile after exit with deterministic consolidation while rejecting model auxiliary work',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'installed-memory-enabled-'))),flags=registeredCapabilityFlags();
  try{
   const {seedInstalledMemoryProfile,observeInstalledMemoryStorage,INSTALLED_MEMORY_CASE}=await import('../scripts/installed-memory-retention.ts');
   const seed=await seedInstalledMemoryProfile(root),store=new Store(seed.profile.path);
   try{
    const memory=new ProjectMemory(store,{enabled:()=>true}),access=await memory.access(seed.projectId,seed.threadId);
    const consolidator=new MemoryConsolidator(store,{snapshot:value=>memory.consolidationSnapshot(value)});
    const review=async(operation:MemoryAction)=>{
     memory.review(access,{id:crypto.randomUUID(),type:'project.memory.review',threadId:seed.threadId,payload:{operation}},'installed-audit-test');
     await consolidator.consolidate(access);
    };
    await review({action:'configure',baseRevision:2,enabled:true,sourceThreadIds:[seed.threadId]});
    await review({action:'edit',itemId:seed.items.edit.id,baseRevision:2,text:INSTALLED_MEMORY_CASE.editedText});
    await review({action:'accept',itemId:seed.items.accept.id,baseRevision:1});
    await review({action:'reject',itemId:seed.items.reject.id,baseRevision:1});
    await review({action:'forget',itemId:seed.items.forget.id,baseRevision:2});
   }finally{store.close();}
   const observation=await observeInstalledMemoryStorage(seed,1,'enabled');
   expect(observation).toMatchObject({installedHostMode:'enabled',available:false,enabled:true,accountCount:0,activeRunCount:0,auxiliaryUsage:{consolidation:{modelCalls:0,cost:0,pending:0}}});
   expect(observation.recordCounts.projectMemoryAuxiliaryUsage).toBeGreaterThan(0);
   expect(registeredCapabilityFlags()).toEqual(flags);
   const changed=new Store(seed.profile.path);
   try{const row=changed.all<{id:string;usage:Record<string,unknown>}>('projectMemoryAuxiliaryUsage')[0]!;changed.internal('installed.test.charge',null,()=>{changed.put('projectMemoryAuxiliaryUsage',row.id,null,{...row,usage:{...row.usage,modelCalls:1,cost:null}});return {};});}
   finally{changed.close();}
   await expect(observeInstalledMemoryStorage(seed,1,'enabled')).rejects.toThrow();
  }finally{await rm(root,{recursive:true,force:true});}
 });
 it('seeds source-linked records in place and reopens them with the production default-off policy and no model owner',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'installed-memory-retention-'))),flags=registeredCapabilityFlags();
  try{
   const {seedInstalledMemoryProfile,INSTALLED_MEMORY_CASE}=await import('../scripts/installed-memory-retention.ts');
   const seed=await seedInstalledMemoryProfile(root);
   expect(seed.profile.path).toBe(await realpath(join(root,'host')));
   const store=new Store(seed.profile.path);
   try{
    const memory=new ProjectMemory(store),access=await memory.access(seed.projectId,seed.threadId),view=memory.read(access);
    expect(view).toMatchObject({available:false,enabled:false,sourceThreadIds:[seed.threadId]});
    expect(access).toMatchObject({profileId:seed.profileId,projectIdentity:seed.projectIdentity,accountId:null});
    expect(store.get('thread',seed.threadId)).toMatchObject({modelId:null,accountId:null,runId:null,status:'completed'});
    expect(view.items).toHaveLength(4);
    expect(view.items.find(row=>row.item.id===seed.items.edit.id)?.item).toMatchObject({state:'ACCEPTED',revision:2,text:INSTALLED_MEMORY_CASE.initialText});
    expect(view.items.find(row=>row.item.id===seed.items.reject.id)?.item.state).toBe('PROPOSED');
    expect(view.items.find(row=>row.item.id===seed.items.accept.id)?.item.state).toBe('PROPOSED');
    expect(memory.source(access,seed.items.edit.id,2,seed.items.edit.source.digest,seed.items.edit.source).content).toBe(INSTALLED_MEMORY_CASE.sourceText);
    expect(store.get<{content:string}>('message',seed.items.edit.source.sourceId)?.content).toBe(INSTALLED_MEMORY_CASE.changedSourceText);
    expect(memory.accepted(access)).toEqual([]);
    expect(memory.export(access).items.find(item=>item.id===seed.items.forget.id)?.text).toBe('[redacted]');
    expect(store.snapshot().accounts??[]).toEqual([]);
    expect(store.snapshot().usage).toEqual({});
    for(const kind of ['outbox','modelRequest','projectMemoryAuxiliaryUsage','projectMemoryRequestUsage','projectMemoryExtraction'])expect(store.all(kind)).toEqual([]);
   }finally{store.close();}
   expect(registeredCapabilityFlags()).toEqual(flags);
  }finally{await rm(root,{recursive:true,force:true});}
 });
 it('refuses an existing host profile without changing its contents',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'installed-memory-existing-')));
  try{
   const {seedInstalledMemoryProfile}=await import('../scripts/installed-memory-retention.ts');
   await mkdir(join(root,'host'));await writeFile(join(root,'host','existing.txt'),'Keep this profile');
   await expect(seedInstalledMemoryProfile(root)).rejects.toThrow(/exist|exclusive|profile/i);
   expect(await readFile(join(root,'host','existing.txt'),'utf8')).toBe('Keep this profile');
  }finally{await rm(root,{recursive:true,force:true});}
 });
 it('refuses a redirected evidence root before creating a backend profile',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'installed-memory-redirect-')));
  try{
   const {seedInstalledMemoryProfile}=await import('../scripts/installed-memory-retention.ts');
   await mkdir(join(root,'target'));await symlink(join(root,'target'),join(root,'alias'),'junction');
   await expect(seedInstalledMemoryProfile(join(root,'alias'))).rejects.toThrow(/redirect|canonical|ordinary/i);
   await expect(readFile(join(root,'target','host','harness.sqlite'))).rejects.toMatchObject({code:'ENOENT'});
  }finally{await rm(root,{recursive:true,force:true});}
 });
 it('rejects a replaced backend directory before an installed launch can adopt it',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'installed-memory-replaced-')));
  try{
   const {seedInstalledMemoryProfile,assertInstalledMemoryProfile}=await import('../scripts/installed-memory-retention.ts');
   const seed=await seedInstalledMemoryProfile(root);
   await assertInstalledMemoryProfile(seed);
   await rename(seed.profile.path,join(root,'original-host'));await mkdir(seed.profile.path);
   await expect(assertInstalledMemoryProfile(seed)).rejects.toThrow(/identity changed/i);
  }finally{await rm(root,{recursive:true,force:true});}
 });
});

describe('installed main-page readiness',()=>{
 const origin='http://127.0.0.1:4317';
 const page=(currentUrl:string,closed=false)=>({currentUrl,closed,url(){return this.currentUrl;},isClosed(){return this.closed;}});
 type Candidate=ReturnType<typeof page>;
 async function withClock(run:()=>Promise<void>){vi.useFakeTimers();vi.setSystemTime(0);try{await run();}finally{vi.useRealTimers();}}
 function fixture(pages:()=>Candidate[]){
  const child={exitCode:null as number|null,signalCode:null as NodeJS.Signals|null};
  const events:installedVerification.InstalledPageReadinessObservation[]=[];
  const options={child,origin,pages,verifyOwner:async()=>{},launchError:():Error|undefined=>undefined,observe:(event:installedVerification.InstalledPageReadinessObservation)=>events.push(event)};
  return {child,events,options};
 }
 function result<T>(pending:Promise<T>){
  let done=false;const settled=pending.then(value=>{done=true;return {ok:true as const,value};},error=>{done=true;return {ok:false as const,error};});
  return {settled,get done(){return done;}};
 }
 it('waits for a correctly owned main page beyond the old 30-second cutoff',()=>withClock(async()=>{
  const expected=page(origin+'/?desktopWindow=owned#launch=PRIVATE_FRAGMENT'),state=fixture(()=>Date.now()>=35000?[expected]:[]);
  const pending=result(installedVerification.waitForInstalledMainPage(state.options));
  await vi.advanceTimersByTimeAsync(35000);
  const actual=await pending.settled;
  expect(actual.ok?undefined:actual.error).toBeUndefined();if(actual.ok)expect(actual.value).toBe(expected);
  expect(state.events.at(-1)).toMatchObject({phase:'ready',elapsedMs:35000,pages:{ownedOrigin:1}});
  expect(JSON.stringify(state.events)).not.toContain('PRIVATE_FRAGMENT');
 }));
 it('requires the exact owned origin and an open current page',()=>withClock(async()=>{
  const closed=page(origin+'/',true),lookalike=page('http://127.0.0.1:43170/'),credentials=page('http://user:PRIVATE_PASSWORD@127.0.0.1:4317/'),expected=page(origin+'/?desktopWindow=current');
  const state=fixture(()=>[closed,lookalike,credentials,expected]);
  const pending=result(installedVerification.waitForInstalledMainPage(state.options));
  await vi.advanceTimersByTimeAsync(0);
  const actual=await pending.settled;
  expect(actual.ok).toBe(true);if(actual.ok)expect(actual.value).toBe(expected);
  expect(JSON.stringify(state.events)).not.toContain('PRIVATE_PASSWORD');
 }));
 it('bounds missing-page waiting and records only bounded metadata',()=>withClock(async()=>{
  const state=fixture(()=>[page('file:///C:/PRIVATE_PATH/startup.html'),page('about:blank'),page('https://unowned.example/?PRIVATE_QUERY#PRIVATE_FRAGMENT')]);
  const pending=result(installedVerification.waitForInstalledMainPage(state.options));
  await vi.advanceTimersByTimeAsync(81000);
  const actual=await pending.settled;
  expect(actual.ok).toBe(false);if(!actual.ok)expect(actual.error.message).toMatch(/deadline/i);
  expect(state.events.at(-1)).toMatchObject({phase:'failed',failure:'deadline',pages:{total:3,file:1,blank:1,other:1,ownedOrigin:0}});
  expect(state.events.length).toBeLessThanOrEqual(8);
  expect(JSON.stringify(state.events)).not.toMatch(/PRIVATE_|unowned\.example|file:\/|https:\/|launch=/);
 }));
 it('rejects child exit, termination or launch failure during a pending owner recheck',()=>withClock(async()=>{
  for(const failure of ['exit','signal','launch-error'] as const){
   vi.setSystemTime(0);const expected=page(origin+'/'),state=fixture(()=>[expected]);
   let release!:()=>void,launchError:Error|undefined;
   state.options.verifyOwner=()=>new Promise<void>(resolve=>{release=resolve;});
   state.options.launchError=()=>launchError;
   const pending=result(installedVerification.waitForInstalledMainPage(state.options));
   setTimeout(()=>{if(failure==='exit')state.child.exitCode=7;else if(failure==='signal')state.child.signalCode='SIGTERM';else launchError=Error('PRIVATE_STARTUP_BODY');},1000);
   await vi.advanceTimersByTimeAsync(1500);
   expect(pending.done).toBe(true);
   const actual=await pending.settled;
   expect(actual.ok).toBe(false);
   expect(state.events.at(-1)).toMatchObject({phase:'failed',failure:failure==='launch-error'?'launch-error':'process-exit'});
   expect(state.events.at(-1)!.elapsedMs).toBeLessThanOrEqual(1500);
   expect(JSON.stringify(state.events)).not.toContain('PRIVATE_STARTUP_BODY');
   const before=JSON.stringify(state.events);release();await vi.advanceTimersByTimeAsync(0);expect(JSON.stringify(state.events)).toBe(before);
  }
 }));
 it('fails immediately when exact executable or nonce ownership cannot be revalidated',()=>withClock(async()=>{
  const state=fixture(()=>[page(origin+'/')]);
  state.options.verifyOwner=async()=>{throw Error('PRIVATE_PROTOCOL_REPLY');};
  const pending=result(installedVerification.waitForInstalledMainPage(state.options));
  await vi.advanceTimersByTimeAsync(0);
  const actual=await pending.settled;
  expect(actual.ok).toBe(false);if(!actual.ok){expect(actual.error.message).toMatch(/ownership/i);expect(actual.error.message).not.toContain('PRIVATE_PROTOCOL_REPLY');}
  expect(state.events.at(-1)).toMatchObject({phase:'failed',failure:'owner-rejected',elapsedMs:0});
 }));
 it('does not admit a candidate that navigates during its ownership recheck',()=>withClock(async()=>{
  const first=page(origin+'/?desktopWindow=first'),replacement=page(origin+'/?desktopWindow=replacement');
  const state=fixture(()=>Date.now()<2000?[first]:[replacement]);let checks=0;
  state.options.verifyOwner=async()=>{if(++checks===1){await new Promise<void>(resolve=>setTimeout(resolve,1000));first.currentUrl='https://unowned.example/';}};
  const pending=result(installedVerification.waitForInstalledMainPage(state.options));
  await vi.advanceTimersByTimeAsync(1500);expect(pending.done).toBe(false);
  await vi.advanceTimersByTimeAsync(500);
  const actual=await pending.settled;
  expect(actual.ok).toBe(true);if(actual.ok)expect(actual.value).toBe(replacement);
  expect(state.events.at(-1)).toMatchObject({phase:'ready',pages:{ownedOrigin:1}});
 }));
 it('applies the same deadline to an unresolved owner recheck and ignores late completion',()=>withClock(async()=>{
  const state=fixture(()=>[page(origin+'/')]);let release!:()=>void;
  state.options.verifyOwner=()=>new Promise<void>(resolve=>{release=resolve;});
  const pending=result(installedVerification.waitForInstalledMainPage(state.options));
  await vi.advanceTimersByTimeAsync(81000);
  const actual=await pending.settled;
  expect(actual.ok).toBe(false);if(!actual.ok)expect(actual.error.message).toMatch(/deadline/i);
  expect(state.events.at(-1)).toMatchObject({phase:'failed',failure:'deadline'});
  const before=JSON.stringify(state.events);release();await vi.advanceTimersByTimeAsync(0);expect(JSON.stringify(state.events)).toBe(before);
 }));
});


describe('bounded installed startup output custody',()=>{
 const fixture=()=>{
  const observe=(installedVerification as unknown as {observeInstalledStartup:(child:ChildProcess,iteration:number,clock:()=>number)=>{read:()=>any}}).observeInstalledStartup;expect(typeof observe).toBe('function');
  const child=Object.assign(new EventEmitter(),{pid:17,stdout:new PassThrough(),stderr:new PassThrough()});let now=100;
  return {child,capture:observe(child as unknown as ChildProcess,1,()=>now),advance:(value:number)=>{now+=value;}};
 };
 const marker=(value:unknown)=>Buffer.from('HARNESS_STARTUP_V1 '+JSON.stringify(value)+'\n');
 it('keeps draining when optional diagnostic construction fails',()=>{
  const child=Object.assign(new EventEmitter(),{pid:17,stdout:new PassThrough(),stderr:new PassThrough()});let capture:ReturnType<typeof installedVerification.observeInstalledStartup>|undefined;
  expect(()=>{capture=installedVerification.observeInstalledStartup(child as unknown as ChildProcess,1,()=>{throw Error('PRIVATE_CLOCK_FAILURE');});}).not.toThrow();
  child.stdout.write('PRIVATE_STDOUT');child.stderr.write('PRIVATE_STDERR');
  expect(child.stdout.readableLength).toBe(0);expect(child.stderr.readableLength).toBe(0);expect(capture!.read()).toMatchObject({available:false,reason:'capture-unavailable'});expect(JSON.stringify(capture!.read())).not.toContain('PRIVATE');
 });
 it('cannot throw from process lifecycle listeners when the optional clock later fails',()=>{
  const child=Object.assign(new EventEmitter(),{pid:17,stdout:new PassThrough(),stderr:new PassThrough()});let calls=0;
  const capture=installedVerification.observeInstalledStartup(child as unknown as ChildProcess,1,()=>{if(++calls>2)throw Error('PRIVATE_CLOCK_FAILURE');return 0;});
  expect(()=>{child.emit('exit',1,null);child.emit('close',1,null);}).not.toThrow();
  expect(capture.read()).toMatchObject({exit:{elapsedMs:null,code:1,signal:null},close:{elapsedMs:null,code:1,signal:null}});expect(JSON.stringify(capture.read())).not.toContain('PRIVATE');
 });
 it('reassembles only strict chunked markers while retaining separate output digest and byte counts',()=>{
  const state=fixture(),event={stage:'backend-error',elapsedMs:15,error:{category:'error',code:'EADDRINUSE'}},line=marker(event);
  state.child.stderr.write(Buffer.from('PRIVATE_SOURCE_TOKEN\n'));state.advance(20);
  state.child.stderr.write(line.subarray(0,7));state.child.stderr.write(line.subarray(7));
  const value=state.capture.read(),bytes=Buffer.concat([Buffer.from('PRIVATE_SOURCE_TOKEN\n'),line]);
  expect(value.events).toEqual([{...event,stream:'stderr',observedElapsedMs:20}]);
  expect(value.streams.stderr).toEqual({bytes:bytes.length,hashedBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),truncated:false});
  expect(JSON.stringify(value)).not.toContain('PRIVATE_SOURCE_TOKEN');expect(value.firstFailure).toEqual(value.events[0]);
 });
 it('drops malformed, private and extra fields and accepts the next complete line',()=>{
  const state=fixture(),good={stage:'main-ready',elapsedMs:1,error:null};
  for(const value of [{...good,private:'PRIVATE_TOKEN'},{...good,stage:'PRIVATE_TOKEN'},{...good,error:{category:'error',code:'PRIVATE_TOKEN'}},{...good,error:{category:'error',code:null,stack:'PRIVATE_TOKEN'}},{...good,elapsedMs:-1}])state.child.stderr.write(marker(value));
  state.child.stderr.write('HARNESS_STARTUP_V1 {PRIVATE_MALFORMED}\n');state.child.stderr.write(Buffer.alloc(3000,65));state.child.stderr.write('\n');state.child.stderr.write(marker(good));
  const value=state.capture.read();expect(value.events).toEqual([{...good,stream:'stderr',observedElapsedMs:0}]);expect(value.rejectedLines).toBe(6);expect(value.overlongLines).toBe(1);expect(JSON.stringify(value)).not.toContain('PRIVATE');
 });
 it('bounds parsing, retained events and hash bytes while continuing to drain later output',()=>{
  const state=fixture(),line=marker({stage:'main-opening',elapsedMs:1,error:null});for(let index=0;index<50;index++)state.child.stdout.write(line);
  const failure=marker({stage:'startup-failed',elapsedMs:2,error:{category:'error',code:null}});state.child.stdout.write(failure);
  const bulk=Buffer.alloc(400000,80);state.child.stdout.write(bulk);state.child.stdout.write(Buffer.alloc(400000,81));
  const value=state.capture.read();expect(value.events).toHaveLength(32);expect(value.firstFailure).toMatchObject({stage:'startup-failed'});
  expect(value.streams.stdout).toMatchObject({bytes:50*line.length+failure.length+800000,hashedBytes:262144,truncated:true});
  expect(value.streams.stdout.sha256).toBe(createHash('sha256').update(Buffer.concat([...Array.from({length:50},()=>line),failure,bulk]).subarray(0,262144)).digest('hex'));
  expect(state.child.stdout.readableLength).toBe(0);expect(JSON.stringify(value).length).toBeLessThan(9000);
 });
 it('retains a renderer loss before the final generic failure',()=>{
  const state=fixture();state.child.stderr.write(marker({stage:'main-renderer-gone',elapsedMs:1,error:null}));state.child.stderr.write(marker({stage:'startup-failed',elapsedMs:2,error:{category:'error',code:null}}));expect(state.capture.read().firstFailure).toMatchObject({stage:'main-renderer-gone'});
 });
 it('retains the first startup failure while separately observing later process exit and close',()=>{
  const state=fixture();state.child.stderr.write(marker({stage:'backend-error',elapsedMs:5,error:{category:'error',code:'ENOENT'}}));state.advance(10);
  state.child.emit('error',Object.assign(Error('PRIVATE_LATE_ERROR'),{code:'EACCES'}));state.child.emit('exit',1,null);state.advance(3);state.child.emit('close',1,null);
  const value=state.capture.read();expect(value.firstFailure).toMatchObject({stage:'backend-error',error:{category:'error',code:'ENOENT'}});
  expect(value.exit).toEqual({elapsedMs:10,code:1,signal:null});expect(value.close).toEqual({elapsedMs:13,code:1,signal:null});expect(JSON.stringify(value)).not.toContain('PRIVATE_LATE_ERROR');
 });
});

describe('installed verifier integration seam',()=>{
 const manifestFile={files:[{path:'resources/host/packages/core/windows-control-bridge.node',bytes:1,sha256:'a'.repeat(64)},{path:'resources/host/package.json',bytes:2,sha256:'b'.repeat(64)}],bytes:3,sha256:'c'.repeat(64)};
 const provenanceInput=async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'installed-seam-')));
  const executable=join(root,'Gen V1.exe');
  await writeFile(executable,Buffer.from('synthetic-exe'));
  const setupSha256=createHash('sha256').update('synthetic-setup').digest('hex');
  return{root,cleanup:()=>rm(root,{recursive:true,force:true}),input:{setupSha256,executable,expected:manifestFile,packageVersion:'0.6.5'}};
 };
 const buildBinding=(installerSha256:string,overrides:Record<string,unknown>={})=>({reference:'ci-run/44418295418',sourceSha:'4110b56a3fc0b7cc81be0af7712bb90933f13428',installerSha256,payloadSha256:'c'.repeat(64),...overrides});
 it('binds provenance only through a caller-supplied build binding matching both verified digests',async()=>{
  const {input,cleanup}=await provenanceInput();
  try{
   const resolution=await installedVerification.resolveInstalledVerifierProvenance({...input,buildBinding:buildBinding(input.setupSha256)});
   expect(resolution.status).toBe('bound');
   if(resolution.status!=='bound')throw Error('unreachable');
   expect(resolution.provenance).toEqual({sourceSha:'4110b56a3fc0b7cc81be0af7712bb90933f13428',packageVersion:'0.6.5',installerSha256:input.setupSha256,executableSha256:createHash('sha256').update('synthetic-exe').digest('hex'),payloadSha256:'c'.repeat(64)});
   expect(resolution.buildReference).toBe('ci-run/44418295418');
  }finally{await cleanup();}
 });
 it('stays unbound without a caller-supplied binding — an adjacent record naming the installer and a sourceSha is consistency evidence only',async()=>{
  const {root,input,cleanup}=await provenanceInput();
  try{
   await writeFile(join(root,'build-manifest.json'),JSON.stringify({files:[{file:'desktop-release-0.6.5/Gen-V1-Setup-0.6.5-win-x64.exe',bytes:14,sha256:input.setupSha256}],sourceSha:'4110b56a3fc0b7cc81be0af7712bb90933f13428'}));
   const resolution=await installedVerification.resolveInstalledVerifierProvenance(input);
   expect(resolution.status).toBe('unbound');
   expect(resolution.missing).toEqual([expect.stringContaining('caller-supplied build binding')]);
  }finally{await cleanup();}
 });
 it('refuses incomplete or mismatched bindings outright',async()=>{
  const {input,cleanup}=await provenanceInput();
  try{
   await expect(installedVerification.resolveInstalledVerifierProvenance({...input,buildBinding:buildBinding('d'.repeat(64))})).rejects.toThrow(/installerSha256 does not match/);
   await expect(installedVerification.resolveInstalledVerifierProvenance({...input,buildBinding:buildBinding(input.setupSha256,{payloadSha256:'e'.repeat(64)})})).rejects.toThrow(/payloadSha256 does not match/);
   await expect(installedVerification.resolveInstalledVerifierProvenance({...input,buildBinding:buildBinding(input.setupSha256,{sourceSha:'1234'})})).rejects.toThrow(/sourceSha is malformed/);
   await expect(installedVerification.resolveInstalledVerifierProvenance({...input,buildBinding:buildBinding(input.setupSha256,{reference:''})})).rejects.toThrow(/build\/run reference/);
   await expect(installedVerification.resolveInstalledVerifierProvenance({...input,buildBinding:{installerSha256:input.setupSha256,payloadSha256:'c'.repeat(64)} as never})).rejects.toThrow(/build\/run reference/);
  }finally{await cleanup();}
 });
 it('locates the installed control addon digest at its verified package-relative path only when the manifest lists it',()=>{
  expect(installedVerification.installedControlAddon(manifestFile)).toEqual({packageRelativePath:'resources/host/packages/core/windows-control-bridge.node',sha256:'a'.repeat(64)});
  expect(installedVerification.installedControlAddon({...manifestFile,files:manifestFile.files.slice(1)})).toBeNull();
 });
 it('invokes the opt-in callback with the verified-owned page, provenance and addon, and merges its receipt',async()=>{
  const receipt:Record<string,unknown>={},seen:unknown[]=[];
  const provenance={sourceSha:'4'.repeat(40),packageVersion:'0.6.5',installerSha256:'5'.repeat(64),executableSha256:'6'.repeat(64),payloadSha256:'7'.repeat(64)};
  const controlAddon={packageRelativePath:'resources/host/packages/core/windows-control-bridge.node',sha256:'8'.repeat(64)};
  const page={url:()=>'http://127.0.0.1:4100/'} as unknown as Parameters<typeof installedVerification.invokeInstalledVerifierIntegration>[0]['page'];
  await installedVerification.invokeInstalledVerifierIntegration({offer:{callback:async context=>{seen.push(context);return{kind:'synthetic',ok:true};},provenance,buildReference:'ci-run/44418295418',controlAddon},page,directory:'C:\\owned-profile',origin:'http://127.0.0.1:4100',iteration:2,receipt});
  expect(seen).toEqual([{page,directory:'C:\\owned-profile',origin:'http://127.0.0.1:4100',iteration:2,provenance,buildReference:'ci-run/44418295418',controlAddon}]);
  expect(receipt.integrations).toEqual([{iteration:2,kind:'installed-verifier-integration',receipt:{kind:'synthetic',ok:true}}]);
 });
 it('lets callback refusals propagate so the launch fails closed before cleanup',async()=>{
  const provenance={sourceSha:'4'.repeat(40),packageVersion:'0.6.5',installerSha256:'5'.repeat(64),executableSha256:'6'.repeat(64),payloadSha256:'7'.repeat(64)};
  const page={url:()=>'http://127.0.0.1:4100/'} as unknown as Parameters<typeof installedVerification.invokeInstalledVerifierIntegration>[0]['page'];
  await expect(installedVerification.invokeInstalledVerifierIntegration({offer:{callback:async()=>{throw Error('refused-input');},provenance,buildReference:'ci-run/44418295418',controlAddon:null},page,directory:'d',origin:'o',iteration:1,receipt:{}})).rejects.toThrow('refused-input');
 });
});
