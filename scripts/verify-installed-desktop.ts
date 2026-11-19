import {chromium,expect,type Browser,type Page} from '@playwright/test';
import {spawn,type ChildProcess} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {mkdir,readFile,writeFile,readdir,lstat,realpath,copyFile,unlink,rmdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,join,relative,isAbsolute,dirname,win32} from 'node:path';
import {pathToFileURL} from 'node:url';
import {terminateProcessTree} from '../packages/runtime-pi/process-tree.ts';
import {SUBSCRIPTION_CONNECTIONS} from '../packages/contracts/connections.ts';
import {verificationPorts,assertWrapperArguments} from './portable-verification.ts';
import {verifyPackagedProviders} from './verify-packaged-providers.ts';
import type {InstalledMemorySeed,InstalledMemoryObservation,InstalledMemoryMode} from './installed-memory-retention.ts';
import {createStartupOutputCapture,startupErrorDiagnostic} from '../apps/desktop/backend-policy.ts';

const APP_ID='local.generativeharness.desktop';
const APP_FILE='Gen V1.exe',UNINSTALL_FILE='Uninstall Gen V1.exe';
type RegistryEntry={hive:'HKCU'|'HKLM';view:32|64;kind:'install'|'uninstall';values:Record<string,string|undefined>};
export type InstallPreflight={entries:RegistryEntry[];runningAppPids:number[];shortcuts:{path:string;present:boolean}[];updaterCache:{path:string;present:boolean}};
type ContentManifest={files:{path:string;bytes:number;sha256:string}[];bytes:number;sha256:string};
type FileIdentity={dev:string;ino:string;sha256:string};
type OwnedCache={path:string;dev:string;ino:string;file:FileIdentity}|null;
type MemoryRetention={seed:InstalledMemorySeed;observations:InstalledMemoryObservation[];mode:InstalledMemoryMode};
type InstalledVerificationOwner={setup:string;setupSha256:string;installDirectory:string;guid:string};

/** Each separately launched memory phase owns a new evidence directory. */
export async function prepareInstalledMemoryPhaseDirectory(ownedDirectory:string,owner:InstalledVerificationOwner):Promise<string>{
 const parent=await lstat(ownedDirectory,{bigint:true});
 if(!isAbsolute(ownedDirectory)||!parent.isDirectory()||parent.isSymbolicLink()||await realpath(ownedDirectory)!==ownedDirectory)throw Error('Installed memory evidence parent must be ordinary and canonical.');
 const directory=join(ownedDirectory,'enabled-memory');await mkdir(directory);
 // The native Save helper pins this existing ordinary receipt while it holds
 // the root lease. Each phase must supply its own file, never a hard link.
 await writeFile(join(directory,'owner.json'),JSON.stringify(owner,null,2),{flag:'wx',mode:0o600});
 return directory;
}
const PREFLIGHT_TIMEOUT_MS=60000;
const PREFLIGHT_PHASES=['script-start','registry-complete','shortcuts-complete','cache-complete','processes-complete','result-complete'] as const;
type PreflightProgress={phase:typeof PREFLIGHT_PHASES[number];scriptElapsedMs:number};
type PreflightStage='before-install'|'pre-install-recheck'|'after-install'|'before-uninstall'|'after-uninstall-poll'|'after-uninstall';
type PreflightObservation={stage:PreflightStage;startedAt:string;timeoutMs:number;elapsedMs:number;status:'running'|'completed'|'failed';subphases:(PreflightProgress&{observedElapsedMs:number})[]};
type OwnedPhase='verification'|'installation-preflight'|'installer'|'uninstaller';
type ProcessEnd={elapsedMs:number;code:number|null;signal:NodeJS.Signals|null};
type InstalledPathProgress={elapsedMs:number;durationMs:number;status:'completed'|'bounded'|'cancelled'|'failed';root:'absent'|'ordinary'|'refused';sampledFiles:number;absent:number;sizeMatched:number;sizeMismatched:number;refused:number;uninstaller:'absent'|'regular'|'refused'};
type OwnedProcessObservation={phase:OwnedPhase;startedAt:string;timeoutMs:number;elapsedMs:number;status:'running'|'completed'|'failed';pid:number|null;spawnElapsedMs:number|null;exit:ProcessEnd|null;close:ProcessEnd|null;stdoutBytes:number;stderrBytes:number;failure:null|'spawn-error'|'deadline'|'output-bound'|'nonzero-exit'|'incomplete-exit';terminationRequested:boolean;pathProgress:InstalledPathProgress[]};

function newOwnedProcessObservation(phase:OwnedPhase,timeoutMs:number,started:number):OwnedProcessObservation{
 return {phase,startedAt:new Date(started).toISOString(),timeoutMs,elapsedMs:0,status:'running',pid:null,spawnElapsedMs:null,exit:null,close:null,stdoutBytes:0,stderrBytes:0,failure:null,terminationRequested:false,pathProgress:[]};
}
/** Exit and pipe closure are separate evidence. Child text is deliberately absent. */
export function observeOwnedProcess(child:ChildProcess,phase:OwnedPhase,timeoutMs:number,clock:()=>number=Date.now,observation=newOwnedProcessObservation(phase,timeoutMs,clock())){
 const elapsed=()=>Math.max(0,clock()-Date.parse(observation.startedAt));
 child.once('spawn',()=>{observation.pid=child.pid??null;observation.spawnElapsedMs=elapsed();});
 child.once('error',()=>{if(observation.status!=='running')return;observation.status='failed';observation.failure='spawn-error';});
 child.stdout?.on('data',(chunk:Buffer)=>{observation.stdoutBytes+=chunk.length;});
 child.stderr?.on('data',(chunk:Buffer)=>{observation.stderrBytes+=chunk.length;});
 child.once('exit',(code,signal)=>{observation.exit={elapsedMs:elapsed(),code,signal};});
 child.once('close',(code,signal)=>{
  observation.close={elapsedMs:elapsed(),code,signal};observation.elapsedMs=elapsed();
  if(observation.status!=='running')return;
  const clean=observation.exit?.code===0&&observation.exit.signal===null&&code===0&&signal===null;
  observation.status=clean?'completed':'failed';if(!clean)observation.failure=observation.exit?'nonzero-exit':'incomplete-exit';
 });
 return observation;
}

/** Metadata-only samples of at most sixteen authenticated manifest paths and the fixed uninstaller. */
export async function createInstalledPathProgressSampler(directory:string,files:readonly {path:string;bytes:number}[]){
 if(!isAbsolute(directory)||files.length>150000||files.some(file=>!Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>4*1024**3||file.path.split('/').length>64||file.path.split('/').some(part=>!part||part==='.'||part==='..')||/[\\:\x00-\x1f]/.test(file.path)))throw Error('Invalid installed progress manifest path.');
 const parent=dirname(directory),parentStat=await lstat(parent,{bigint:true});
 if(!parentStat.isDirectory()||parentStat.isSymbolicLink()||await realpath(parent)!==parent)throw Error('Installed progress parent is not an ordinary canonical directory.');
 const sorted=[...files].sort((left,right)=>left.path<right.path?-1:left.path>right.path?1:0),count=Math.min(16,sorted.length);
 const selected=Array.from({length:count},(_,index)=>sorted[count===1?0:Math.floor(index*(sorted.length-1)/(count-1))]!);
 let rootIdentity:{dev:bigint;ino:bigint}|undefined;
 return async(elapsedMs:number,active:()=>boolean=()=>true):Promise<InstalledPathProgress>=>{
  const started=Date.now();let expired=false,checks=0;
  const value:InstalledPathProgress={elapsedMs,durationMs:0,status:'completed',root:'absent',sampledFiles:count,absent:count,sizeMatched:0,sizeMismatched:0,refused:0,uninstaller:'absent'};
  const guard=()=>{if(expired||!active()||++checks>1200)throw Error('Progress sample stopped.');};
  const info=async(path:string)=>{guard();try{const stat=await lstat(path,{bigint:true});guard();return stat;}catch(error){guard();if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}};
  const refuse=()=>{value.root='refused';value.absent=0;value.sizeMatched=0;value.sizeMismatched=0;value.refused=count;value.uninstaller='refused';};
  const root=async()=>{
   const currentParent=await info(parent);
   if(!currentParent?.isDirectory()||currentParent.isSymbolicLink()||currentParent.dev!==parentStat.dev||currentParent.ino!==parentStat.ino)return 'refused' as const;
   const current=await info(directory);if(!current)return rootIdentity?'refused' as const:'absent' as const;
   if(!current.isDirectory()||current.isSymbolicLink()||rootIdentity&&(current.dev!==rootIdentity.dev||current.ino!==rootIdentity.ino))return 'refused' as const;
   rootIdentity??={dev:current.dev,ino:current.ino};return 'ordinary' as const;
  };
  const fileStatus=async(path:string)=>{
   const parts=path.split('/');let current=directory;
   for(const part of parts.slice(0,-1)){current=join(current,part);const stat=await info(current);if(!stat)return {kind:'absent' as const};if(!stat.isDirectory()||stat.isSymbolicLink())return {kind:'refused' as const};}
   const stat=await info(join(current,parts.at(-1)!));
   return !stat?{kind:'absent' as const}:stat.isSymbolicLink()||!stat.isFile()?{kind:'refused' as const}:{kind:'regular' as const,bytes:Number(stat.size)};
  };
  let timer:ReturnType<typeof setTimeout>|undefined;
  const work=(async()=>{
   try{
    value.root=await root();if(value.root==='absent')return;if(value.root==='refused'){refuse();return;}
    value.absent=0;
    for(const file of selected){const status=await fileStatus(file.path);if(status.kind==='absent')value.absent++;else if(status.kind==='refused')value.refused++;else if(status.bytes===file.bytes)value.sizeMatched++;else value.sizeMismatched++;}
    value.uninstaller=(await fileStatus(UNINSTALL_FILE)).kind;
    if(await root()!=='ordinary')refuse();
   }catch{value.status=expired?'bounded':!active()?'cancelled':'failed';}
  })();
  try{await Promise.race([work,new Promise<void>(accept=>{timer=setTimeout(()=>{expired=true;value.status='bounded';accept();},5000);})]);}
  finally{if(timer)clearTimeout(timer);expired=true;}
  return {...value,durationMs:Date.now()-started};
 };
}

/** Diagnostic markers contain fixed names and bounded numbers, never probe output. */
export function parseInstallPreflightProgress(stderr:string):PreflightProgress[]{
 const result:PreflightProgress[]=[];let previous=-1,elapsed=0;
 for(const line of stderr.slice(-16000).split(/\r?\n/)){
  const match=/^HARNESS_INSTALL_PREFLIGHT_PHASE=([a-z-]+):([0-9]{1,6})$/.exec(line);if(!match)continue;
  const index=PREFLIGHT_PHASES.indexOf(match[1] as PreflightProgress['phase']),value=Number(match[2]);
  if(index<=previous||value<elapsed||value>PREFLIGHT_TIMEOUT_MS)continue;
  result.push({phase:PREFLIGHT_PHASES[index]!,scriptElapsedMs:value});previous=index;elapsed=value;
 }
 return result;
}

export function readInstalledVerificationArguments(args:string[]){
 const [setup,unpacked,...options]=args,memoryRetention=options.includes('--project-memory-retention'),memoryEnabled=options.includes('--project-memory-enabled');
 if(!setup||!unpacked||new Set(options).size!==options.length||options.some(option=>!['--project-memory-retention','--project-memory-enabled'].includes(option))||memoryEnabled&&!memoryRetention)throw Error('Usage: verify-installed-desktop <absolute Setup.exe> <absolute win-unpacked> [--project-memory-retention [--project-memory-enabled]]');
 return {setup,unpacked,memoryRetention,memoryEnabled};
}

export function nsisApplicationGuid(appId:string){
 const namespace=Buffer.from('50e065bc313411e69bab38c9862bdaf3','hex');
 const bytes=createHash('sha1').update(namespace).update(appId,'utf8').digest().subarray(0,16);
 bytes[6]=(bytes[6]!&15)|80;bytes[8]=(bytes[8]!&63)|128;
 const hex=bytes.toString('hex');return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
}
export function assertClearInstallPreflight(value:InstallPreflight){
 if(value.entries.length)throw Error('An existing Harness installation registry key is present; verification will not upgrade or remove it.');
 if(value.runningAppPids.length)throw Error('A Harness native application is already running; verification will not close it.');
 if(value.shortcuts.some(shortcut=>shortcut.present))throw Error('An existing Harness shortcut is present; verification will not replace it.');
 if(value.updaterCache.present)throw Error('An existing Harness installer cache is present; verification will not overwrite it.');
}
export function assertInstalledCleanExit(state:{exitCode:number|null;signalCode:string|null}){
 if(state.exitCode!==0||state.signalCode!==null)throw Error('Installed application did not exit cleanly.');
}
export function assertWindowsDestinationFits(directory:string,paths:readonly string[]){
 let longest=directory.length;for(const path of paths)longest=Math.max(longest,win32.join(directory,path).length);
 if(longest>=260)throw Error('Installation destination exceeds the conservative Windows 260-character path budget.');
 return longest;
}
export function installedCommandArguments(kind:'install'|'uninstall',directory:string){
 if(!/^[A-Za-z]:\\/.test(directory)||/["\r\n\0]/.test(directory))throw Error('The owned install directory must be an ordinary absolute Windows path.');
 // NSIS parses these final directory switches from the raw command-line tail.
 return kind==='install'?['/S','/D='+directory]:['/S','/KEEP_APP_DATA','/currentuser','_?='+directory];
}
function sameWindowsPath(left:string,right:string){return win32.normalize(left).replace(/[\\/]+$/,'').toLowerCase()===win32.normalize(right).replace(/[\\/]+$/,'').toLowerCase();}
export function parseOwnedUninstaller(command:string,directory:string){
 const match=/^"([^"\r\n\0]+)"(?:\s+(\/currentuser))?\s*$/.exec(command);
 const expected=win32.join(directory,UNINSTALL_FILE);
 if(!match||!sameWindowsPath(match[1]!,expected))throw Error('Registry uninstall command does not identify the exact owned uninstaller.');
 return expected;
}
export function assertOwnedInstallEntries(entries:readonly RegistryEntry[],directory:string,version:string){
 let installation=false,uninstaller:string|undefined;
 for(const entry of entries){
  if(entry.hive!=='HKCU')throw Error('Installation unexpectedly changed machine-wide registry state; cleanup is withheld.');
  if(entry.kind==='install'){
   if(!entry.values.InstallLocation||!sameWindowsPath(entry.values.InstallLocation,directory))throw Error('Registry installation location is not the owned directory.');
   installation=true;
  }else{
   if(entry.values.DisplayVersion!==version)throw Error('Registry installed version differs from the expected package.');
   const path=parseOwnedUninstaller(entry.values.UninstallString??'',directory);
   if(uninstaller&&!sameWindowsPath(uninstaller,path))throw Error('Registry uninstaller identities disagree.');
   uninstaller=path;
  }
 }
 if(!installation||!uninstaller)throw Error('Owned install and uninstall entries are both required before cleanup.');
 return uninstaller;
}
async function hashFile(path:string){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
export async function packageContentManifest(directory:string,options:{installed?:boolean}={}):Promise<ContentManifest>{
 const root=await realpath(directory),files:ContentManifest['files']=[];let bytes=0,entries=0;
 async function walk(path:string,depth:number){
  if(depth>64)throw Error('Installed payload exceeds its depth bound.');
  for(const entry of await readdir(path,{withFileTypes:true})){
   if(++entries>150000)throw Error('Installed payload exceeds its entry bound.');
   const child=join(path,entry.name),part=relative(root,child).replaceAll('\\','/'),info=await lstat(child);
   if(info.isSymbolicLink())throw Error('Installed payload contains a redirected entry.');
   if(info.isDirectory()){await walk(child,depth+1);continue;}
   if(!info.isFile())throw Error('Installed payload contains a non-file entry.');
   if(options.installed&&[UNINSTALL_FILE,'uninstallerIcon.ico'].includes(part))continue;
   bytes+=info.size;if(bytes>4*1024**3)throw Error('Installed payload exceeds its byte bound.');
   files.push({path:part,bytes:info.size,sha256:await hashFile(child)});
  }
 }
 await walk(root,0);files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 return {files,bytes,sha256:createHash('sha256').update(JSON.stringify(files)).digest('hex')};
}
export function assertMatchingContents(expected:ContentManifest,actual:ContentManifest){
 if(expected.files.length!==actual.files.length||expected.bytes!==actual.bytes||expected.sha256!==actual.sha256)throw Error('Installed and expected unpacked payload contents differ.');
}

/** Programmatic opt-in integration seam (M16 C3/C4 callable scenario, etc.).
 * The callback fires inside launchInstalled only after readiness and the
 * existing exact ownership verification of the launched installed page, before
 * the existing close/cleanup path — never instead of them. */
export interface InstalledVerifierProvenance{
 sourceSha:string;           // checkout identity asserted by the caller-supplied build binding
 packageVersion:string;      // version parsed from the verified unpacked payload
 installerSha256:string;     // digest of the actually invoked installer
 executableSha256:string;    // digest of the exact launched installed executable
 payloadSha256:string;       // verified matching-content digest (install ≡ unpacked)
}
/** Authenticated source↔artifact binding supplied by the trusted programmatic
 * caller from independent package-build evidence (e.g. the CI run that built
 * and hashed the release). `reference` names that build/run evidence. The
 * verifier never authenticates the source itself — it only checks that both
 * digests match the artifacts it already verified locally. An adjacent build
 * record that merely names the installer digest is a consistency check, not a
 * source binding, and never produces 'bound' on its own. */
export interface InstalledVerifierBuildBinding{
 reference:string;         // authenticated build/run reference supplied by the caller
 sourceSha:string;         // asserted 40-hex checkout identity
 installerSha256:string;   // must equal the actually invoked installer digest
 payloadSha256:string;     // must equal the verified matching-content digest
}
export interface InstalledVerifierIntegrationContext{
 page:Page;
 directory:string;           // owned disposable data profile (HARNESS_DESKTOP_TEST_DATA_DIR)
 origin:string;              // owned loopback host origin
 iteration:number;
 provenance:InstalledVerifierProvenance;
 buildReference:string;      // caller's authenticated build/run evidence, checked for consistency only
 controlAddon:{packageRelativePath:string;sha256:string}|null;
}
export type InstalledVerifierIntegrationCallback=(context:InstalledVerifierIntegrationContext)=>Promise<Record<string,unknown>>;
export interface InstalledVerifierIntegrationOffer{callback:InstalledVerifierIntegrationCallback;provenance:InstalledVerifierProvenance;buildReference:string;controlAddon:{packageRelativePath:string;sha256:string}|null}
const INSTALLED_CONTROL_ADDON_PATH='resources/host/packages/core/windows-control-bridge.node';
/** The control addon's digest comes from the verified expected payload manifest. */
export function installedControlAddon(expected:ContentManifest){
 const entry=expected.files.find(file=>file.path===INSTALLED_CONTROL_ADDON_PATH);
 return entry?{packageRelativePath:entry.path,sha256:entry.sha256}:null;
}
/** Resolves provenance from locally verified values plus the caller's explicit
 * build binding. The source SHA is accepted only when the supplied binding —
 * with its authenticated build/run reference — names both the invoked
 * installer digest and the verified matching-content payload digest exactly.
 * With no binding the result stays unbound and the callback is skipped;
 * incomplete or mismatched bindings are refused outright. Nothing is filled
 * from a filename, an adjacent record, or the checkout HEAD. */
export async function resolveInstalledVerifierProvenance(input:{setupSha256:string;executable:string;expected:ContentManifest;packageVersion:string;buildBinding?:InstalledVerifierBuildBinding}):Promise<{status:'bound';provenance:InstalledVerifierProvenance;buildReference:string;missing:[]}|{status:'unbound';provenance:null;missing:string[]}>{
 const binding=input.buildBinding;
 if(!binding)return{status:'unbound',provenance:null,missing:['caller-supplied build binding: absent — no authenticated source identity binds the source SHA to the invoked installer and verified payload digests']};
 if(typeof binding.reference!=='string'||binding.reference.trim()==='')throw Error('The caller-supplied build binding has no authenticated build/run reference; provenance is refused.');
 if(typeof binding.sourceSha!=='string'||!/^[0-9a-f]{40}$/.test(binding.sourceSha))throw Error('The build binding sourceSha is malformed; provenance is refused.');
 if(binding.installerSha256!==input.setupSha256)throw Error('The build binding installerSha256 does not match the invoked installer digest; provenance is refused.');
 if(binding.payloadSha256!==input.expected.sha256)throw Error('The build binding payloadSha256 does not match the verified matching-content payload digest; provenance is refused.');
 return{status:'bound',provenance:{sourceSha:binding.sourceSha,packageVersion:input.packageVersion,installerSha256:input.setupSha256,executableSha256:await hashFile(input.executable),payloadSha256:input.expected.sha256},buildReference:binding.reference,missing:[]};
}
/** Invokes the opt-in integration callback with the verified-owned page and
 * resolves receipt merge. Caller supplies only already-verified values; the
 * callback's errors propagate so the launch fails closed while lifecycle
 * cleanup stays with this verifier. */
export async function invokeInstalledVerifierIntegration(input:{offer:InstalledVerifierIntegrationOffer;page:Page;directory:string;origin:string;iteration:number;receipt:Record<string,unknown>}){
 const context:InstalledVerifierIntegrationContext={page:input.page,directory:input.directory,origin:input.origin,iteration:input.iteration,provenance:input.offer.provenance,buildReference:input.offer.buildReference,controlAddon:input.offer.controlAddon};
 const value=await input.offer.callback(context);
 ((input.receipt.integrations??=[]) as unknown[]).push({iteration:input.iteration,kind:'installed-verifier-integration',receipt:value});
}
function baseEnvironment():NodeJS.ProcessEnv{
 const env:NodeJS.ProcessEnv={};
 for(const key of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','LANG','LC_ALL','TERM','TEMP','TMP','USERPROFILE','HOME','LOCALAPPDATA','APPDATA'])if(process.env[key]!==undefined)env[key]=process.env[key];
 return env;
}
/** Explicit installed phases cannot inherit ambient harness feature activation. */
export function installedVerificationEnvironment(directory:string,ports:readonly[number,number,number],memoryMode?:InstalledMemoryMode):NodeJS.ProcessEnv{
 return {...baseEnvironment(),HARNESS_DESKTOP_TEST_DATA_DIR:directory,HARNESS_DESKTOP_PORT:String(ports[0]),HARNESS_DESKTOP_WIDGET_PORT:String(ports[1]),...(memoryMode==='enabled'?{HARNESS_FLAG_MEMORY_PROJECT_V1:'true'}:{})};
}
async function runOwned(file:string,args:string[],options:{cwd:string;env:NodeJS.ProcessEnv;timeoutMs:number;rawTail?:boolean;phase?:OwnedPhase;onStderr?:(stderr:string)=>void;onObservation?:(value:OwnedProcessObservation)=>void;sampleProgress?:(elapsedMs:number,active:()=>boolean)=>Promise<InstalledPathProgress>}){
 const started=Date.now(),phase=options.phase??'verification',observation=newOwnedProcessObservation(phase,options.timeoutMs,started);options.onObservation?.(observation);
 const child=spawn(file,args,{cwd:options.cwd,env:options.env,windowsHide:true,windowsVerbatimArguments:options.rawTail,stdio:['ignore','pipe','pipe']});
 observeOwnedProcess(child,phase,options.timeoutMs,Date.now,observation);
 const pending=new Set<Promise<void>>(),active=()=>observation.status==='running'&&observation.exit===null;
 const progressTimers=options.sampleProgress?[30000,120000,300000,540000,900000,1140000].filter(delay=>delay<options.timeoutMs).map(delay=>setTimeout(()=>{
  if(!active()||pending.size)return;
  const task=options.sampleProgress!(Date.now()-started,active).then(value=>{observation.pathProgress.push(value);},()=>{observation.pathProgress.push({elapsedMs:Date.now()-started,durationMs:0,status:'failed',root:'refused',sampledFiles:0,absent:0,sizeMatched:0,sizeMismatched:0,refused:0,uninstaller:'refused'});});
  pending.add(task);void task.finally(()=>pending.delete(task));
 },delay)):[];
 try{const output=await new Promise<{exitCode:number;stdout:string;stderr:string}>((accept,reject)=>{
  let stdout='',stderr='',bytes=0,failed=false;
  const fail=(error:Error,reason:OwnedProcessObservation['failure'])=>{if(failed)return;failed=true;observation.status='failed';observation.failure=reason;observation.terminationRequested=true;clearTimeout(timer);void terminateProcessTree(child).then(()=>reject(error),reject);};
  const timer=setTimeout(()=>fail(Error('Owned '+phase+' process exceeded its '+options.timeoutMs+' ms deadline.'),'deadline'),options.timeoutMs);
  child.once('error',()=>fail(Error('Owned '+phase+' process could not start.'),'spawn-error'));
  for(const stream of [child.stdout,child.stderr])stream.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>256*1024){fail(Error('Owned '+phase+' process exceeded its output bound.'),'output-bound');return;}if(stream===child.stdout)stdout+=String(chunk);else{stderr=(stderr+String(chunk)).slice(-16000);options.onStderr?.(stderr);}});
  child.once('close',code=>{clearTimeout(timer);if(failed)return;failed=true;observation.status==='completed'&&code===0?accept({exitCode:code,stdout,stderr}):reject(Error('Owned '+phase+' process exited '+code+'.'));});
 });
 return {...output,elapsedMs:Date.now()-started};
 }finally{for(const timer of progressTimers)clearTimeout(timer);await Promise.allSettled(pending);observation.elapsedMs=Date.now()-started;}
}
const REGISTRY_PROBE=String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$probeClock=[Diagnostics.Stopwatch]::StartNew()
function Report-Phase([string]$name){[Console]::Error.WriteLine('HARNESS_INSTALL_PREFLIGHT_PHASE='+$name+':'+$probeClock.ElapsedMilliseconds)}
Report-Phase 'script-start'
$guid=$env:HARNESS_VERIFY_NSIS_GUID
if($guid -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'){throw 'Invalid fixed installer identity'}
$entries=@()
foreach($hiveName in @('HKCU','HKLM')){
 $hive=if($hiveName -eq 'HKCU'){[Microsoft.Win32.RegistryHive]::CurrentUser}else{[Microsoft.Win32.RegistryHive]::LocalMachine}
 foreach($viewNumber in @(64,32)){
  $view=if($viewNumber -eq 64){[Microsoft.Win32.RegistryView]::Registry64}else{[Microsoft.Win32.RegistryView]::Registry32}
  $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$view)
  try{
   foreach($kind in @('install','uninstall')){
    $path=if($kind -eq 'install'){'Software\'+$guid}else{'Software\Microsoft\Windows\CurrentVersion\Uninstall\'+$guid}
    $key=$base.OpenSubKey($path,$false)
    if($null -ne $key){
     try{$values=@{};foreach($name in @('InstallLocation','UninstallString','DisplayVersion')){$value=$key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames);if($null -ne $value){$values[$name]=[string]$value}}
      $entries+=@{hive=$hiveName;view=$viewNumber;kind=$kind;values=$values}
     }finally{$key.Dispose()}
    }
   }
  }finally{$base.Dispose()}
 }
}
Report-Phase 'registry-complete'
function Exists-Literally([string]$path){try{$null=[System.IO.File]::GetAttributes($path);return $true}catch{$errorType=$_.Exception.GetBaseException();if($errorType -is [System.IO.FileNotFoundException] -or $errorType -is [System.IO.DirectoryNotFoundException]){return $false};throw}}
$shortcuts=@();foreach($folderName in @('DesktopDirectory','CommonDesktopDirectory','Programs','CommonPrograms')){$folder=[Environment]::GetFolderPath([Enum]::Parse([Environment+SpecialFolder],$folderName));if([string]::IsNullOrWhiteSpace($folder)){throw 'Windows shortcut folder is unavailable'};foreach($name in @('Gen V1.lnk','Generative Harness.lnk')){$path=[IO.Path]::Combine($folder,$name);$shortcuts+=@{path=$path;present=(Exists-Literally $path)}}}
Report-Phase 'shortcuts-complete'
$cache=[IO.Path]::Combine([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData),'generative-harness-desktop-updater')
$cachePresent=Exists-Literally $cache
Report-Phase 'cache-complete'
$pids=@(foreach($name in @('Gen V1','Generative Harness')){[Diagnostics.Process]::GetProcessesByName($name)|ForEach-Object{$_.Id; $_.Dispose()}})
Report-Phase 'processes-complete'
$result=@{entries=@($entries);runningAppPids=@($pids);shortcuts=@($shortcuts);updaterCache=@{path=$cache;present=$cachePresent}}|ConvertTo-Json -Depth 6 -Compress
Report-Phase 'result-complete'
Write-Output $result
`;
async function installPreflight(directory:string,stage:PreflightStage,observations:PreflightObservation[]):Promise<InstallPreflight>{
 const systemRoot=process.env.SystemRoot??process.env.SYSTEMROOT;
 if(!systemRoot||!win32.isAbsolute(systemRoot))throw Error('Windows system directory is unavailable.');
 if(observations.length>=256)throw Error('Installation preflight observations exceeded their bound.');
 const started=Date.now(),observation:PreflightObservation={stage,startedAt:new Date(started).toISOString(),timeoutMs:PREFLIGHT_TIMEOUT_MS,elapsedMs:0,status:'running',subphases:[]};observations.push(observation);
 try{
  // The first Windows PowerShell probe exceeded the old 15-second budget in CI.
  // Keep the read-only probe bounded and record phases instead of assuming why.
  const output=await runOwned(join(systemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(REGISTRY_PROBE,'utf16le').toString('base64')],{cwd:directory,env:{...baseEnvironment(),HARNESS_VERIFY_NSIS_GUID:nsisApplicationGuid(APP_ID)},timeoutMs:PREFLIGHT_TIMEOUT_MS,phase:'installation-preflight',onStderr:stderr=>{
   const complete=stderr.slice(0,stderr.lastIndexOf('\n')+1);
   for(const progress of parseInstallPreflightProgress(complete))if(!observation.subphases.some(row=>row.phase===progress.phase))observation.subphases.push({...progress,observedElapsedMs:Date.now()-started});
  }});
  let result:InstallPreflight;try{result=JSON.parse(output.stdout.trim()) as InstallPreflight;}catch{throw Error('Windows installation preflight returned invalid JSON.');}
  if(!result||!Array.isArray(result.entries)||result.entries.length>8||!Array.isArray(result.runningAppPids)||!Array.isArray(result.shortcuts)||typeof result.updaterCache?.path!=='string'||typeof result.updaterCache.present!=='boolean')throw Error('Windows installation preflight returned an invalid shape.');
  observation.status='completed';return result;
 }catch(error){observation.status='failed';throw error;}finally{observation.elapsedMs=Date.now()-started;}
}
async function identity(path:string):Promise<FileIdentity>{const stat=await lstat(path,{bigint:true});if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1n)throw Error('Owned executable is not a single ordinary file.');return {dev:String(stat.dev),ino:String(stat.ino),sha256:await hashFile(path)};}
function sameIdentity(left:FileIdentity,right:FileIdentity){return left.dev===right.dev&&left.ino===right.ino&&left.sha256===right.sha256;}
async function captureOwnedCache(path:string,setupSha256:string):Promise<OwnedCache>{
 let info;try{info=await lstat(path,{bigint:true});}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
 if(!info.isDirectory()||info.isSymbolicLink()||!sameWindowsPath(await realpath(path),path))throw Error('Installer cache is redirected; cleanup is withheld.');
 const children=await readdir(path);if(children.length!==1||children[0]!=='installer.exe')throw Error('Installer cache contains unexpected files; cleanup is withheld.');
 const file=await identity(join(path,'installer.exe'));if(file.sha256!==setupSha256)throw Error('Cached installer differs from the invoked setup; cleanup is withheld.');
 return {path,dev:String(info.dev),ino:String(info.ino),file};
}
async function cleanOwnedCache(cache:OwnedCache){
 if(!cache)return {status:'not-created'};
 const info=await lstat(cache.path,{bigint:true});if(!info.isDirectory()||info.isSymbolicLink()||String(info.dev)!==cache.dev||String(info.ino)!==cache.ino)throw Error('Installer cache directory identity changed; it is retained.');
 if((await readdir(cache.path)).join('\0')!=='installer.exe'||!sameIdentity(await identity(join(cache.path,'installer.exe')),cache.file))throw Error('Installer cache content changed; it is retained.');
 await unlink(join(cache.path,'installer.exe'));await rmdir(cache.path);return {status:'removed-owned-exact-file',sha256:cache.file.sha256};
}
async function waitForOwnedExit(child:ChildProcess,timeoutMs=15000){
 if(child.exitCode!==null||child.signalCode!==null)return;
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{await Promise.race([new Promise<void>(done=>child.once('close',()=>done())),new Promise<never>((_done,reject)=>{timer=setTimeout(()=>reject(Error('Installed application did not exit after closing its last window.')),timeoutMs);})]);}finally{clearTimeout(timer);}
}
// Existing production startup permits 60s for the backend and 20s for its native surface.
// Match that combined publication envelope; production and interactive assertion budgets stay unchanged.
const INSTALLED_MAIN_PAGE_TIMEOUT_MS=80000;
type InstalledPageFailure='deadline'|'launch-error'|'process-exit'|'owner-rejected'|'page-query';
type InstalledPageCounts={total:number;ownedOrigin:number;file:number;blank:number;other:number;closed:number};
export type InstalledPageReadinessObservation={phase:'waiting'|'candidate'|'ready'|'failed';elapsedMs:number;process:{alive:boolean;exitCode:number|null;signalCode:NodeJS.Signals|null};pages:InstalledPageCounts;failure?:InstalledPageFailure};
type InstalledPageCandidate={url:()=>string;isClosed:()=>boolean};

/** Wait only for a current page from the live, revalidated installed process. */
export async function waitForInstalledMainPage<T extends InstalledPageCandidate>(options:{
 child:Pick<ChildProcess,'exitCode'|'signalCode'>;origin:string;pages:()=>T[];verifyOwner:()=>Promise<void>;launchError:()=>Error|undefined;observe:(value:InstalledPageReadinessObservation)=>void;
}):Promise<T>{
 const expected=new URL(options.origin);
 if(expected.origin!==options.origin||expected.protocol!=='http:'||expected.hostname!=='127.0.0.1')throw Error('Installed readiness requires the exact local host origin.');
 const started=Date.now();let settled=false,failure:InstalledPageFailure|undefined,nextCheckpoint=0,candidateObserved=false;
 let pollTimer:ReturnType<typeof setTimeout>|undefined,deadlineTimer:ReturnType<typeof setTimeout>|undefined,livenessTimer:ReturnType<typeof setInterval>|undefined;
 let counts:InstalledPageCounts={total:0,ownedOrigin:0,file:0,blank:0,other:0,closed:0};
 const messages:Record<InstalledPageFailure,string>={deadline:'The installed main page exceeded its readiness deadline.','launch-error':'The installed application failed during main-page readiness.','process-exit':'The installed application exited before its main page was ready.','owner-rejected':'Installed application ownership could not be revalidated.','page-query':'The installed application pages could not be inspected.'};
 const refuse=(reason:InstalledPageFailure)=>{failure??=reason;return Error(messages[failure]);};
 const alive=()=>options.child.exitCode===null&&options.child.signalCode===null;
 const stopped=():InstalledPageFailure|undefined=>options.launchError()?'launch-error':alive()?undefined:'process-exit';
 const emit=(phase:InstalledPageReadinessObservation['phase'])=>{
  if(settled)return;
  options.observe({phase,elapsedMs:Math.max(0,Date.now()-started),process:{alive:alive(),exitCode:options.child.exitCode,signalCode:options.child.signalCode},pages:{...counts},...(phase==='failed'?{failure}: {})});
 };
 const classify=(page:T):Exclude<keyof InstalledPageCounts,'total'>=>{
  if(page.isClosed())return 'closed';
  const raw=page.url();let url:URL;try{url=new URL(raw);}catch{return 'other';}
  if(url.origin===options.origin&&!url.username&&!url.password)return 'ownedOrigin';
  return url.protocol==='file:'?'file':raw==='about:blank'?'blank':'other';
 };
 const current=()=>{
  try{
   const pages=options.pages();counts={total:pages.length,ownedOrigin:0,file:0,blank:0,other:0,closed:0};
   for(const page of pages)counts[classify(page)]++;
   return pages;
  }catch{throw refuse('page-query');}
 };
 const active=()=>{
  if(settled)throw Error('Installed readiness has already settled.');
  const reason=stopped();if(reason)throw refuse(reason);
  if(Date.now()-started>=INSTALLED_MAIN_PAGE_TIMEOUT_MS)throw refuse('deadline');
 };
 const deadline=new Promise<never>((_resolve,reject)=>{deadlineTimer=setTimeout(()=>reject(refuse('deadline')),INSTALLED_MAIN_PAGE_TIMEOUT_MS);});
 const liveness=new Promise<never>((_resolve,reject)=>{livenessTimer=setInterval(()=>{if(settled)return;const reason=stopped();if(reason)reject(refuse(reason));},250);});
 const discover=async():Promise<T>=>{
  while(!settled){
   active();const pages=current(),elapsed=Date.now()-started;
   if(elapsed>=nextCheckpoint){emit('waiting');nextCheckpoint=elapsed+15000;}
   const candidate=pages.find(page=>classify(page)==='ownedOrigin');
   if(candidate){
    if(!candidateObserved){emit('candidate');candidateObserved=true;}
    try{await options.verifyOwner();}catch{throw refuse('owner-rejected');}
    active();const latest=current();
    if(latest.includes(candidate)&&classify(candidate)==='ownedOrigin'){emit('ready');return candidate;}
   }
   await new Promise<void>(resolve=>{pollTimer=setTimeout(resolve,250);});
  }
  throw refuse('deadline');
 };
 try{return await Promise.race([discover(),deadline,liveness]);}
 catch{failure??='page-query';emit('failed');throw refuse(failure);}
 finally{settled=true;clearTimeout(pollTimer);clearTimeout(deadlineTimer);clearInterval(livenessTimer);}
}
/** Optional evidence only: no output contents, startup decision, timer or child action. */
export function observeInstalledStartup(child:ChildProcess,iteration:number,clock:()=>number=Date.now){
 const unavailable={iteration,pid:child.pid??null,available:false,reason:'capture-unavailable'} as const;
 try{
  type ObservedEnd=Omit<ProcessEnd,'elapsedMs'>&{elapsedMs:number|null};
  const started=clock(),capture=createStartupOutputCapture(clock);let exit:ObservedEnd|null=null,close:ObservedEnd|null=null,spawnError:ReturnType<typeof startupErrorDiagnostic>|null=null;
  const elapsed=()=>{try{return Math.max(0,clock()-started);}catch{return null;}};
  child.stdout?.on('data',(chunk:Buffer)=>capture.write('stdout',chunk));child.stderr?.on('data',(chunk:Buffer)=>capture.write('stderr',chunk));
  child.stdout?.on('error',()=>{});child.stderr?.on('error',()=>{});
  child.once('error',error=>{spawnError??=startupErrorDiagnostic(error);});
  child.once('exit',(code,signal)=>{exit={elapsedMs:elapsed(),code,signal};});child.once('close',(code,signal)=>{close={elapsedMs:elapsed(),code,signal};});
  return {read:()=>{try{return {iteration,pid:child.pid??null,available:true,clock:'since-launch-observer-attached',...capture.read(),spawnError,exit,close};}catch{return unavailable;}}};
 }catch{
  for(const stream of [child.stdout,child.stderr])try{stream?.on('error',()=>{});stream?.on('data',()=>{});stream?.resume();}catch{}
  return {read:()=>unavailable};
 }
}
export async function assertInstalledConnectionReady(providerId:string,read:()=>Promise<string>,timeout=60000){
 try{await expect.poll(read,{timeout}).toBe('enabled');}
 catch(cause){const detail=cause instanceof Error?cause.message:'Readiness check failed.';throw Error(`Installed subscription ${providerId}: ${detail}`,{cause});}
}

async function launchInstalled(executable:string,directory:string,iteration:number,receipt:Record<string,unknown>,ports:readonly[number,number,number],memory?:MemoryRetention,integration?:InstalledVerifierIntegrationOffer){
 if(memory)await (await import('./installed-memory-retention.ts')).assertInstalledMemoryProfile(memory.seed);
 const [hostPort,widgetPort,debugPort]=ports,nonce=randomUUID(),origin='http://127.0.0.1:'+hostPort,debugOrigin='http://127.0.0.1:'+debugPort;
 const child=spawn(executable,['--remote-debugging-port='+debugPort,'--remote-debugging-address=127.0.0.1','--enable-automation','--harness-verification='+nonce],{cwd:win32.dirname(executable),env:installedVerificationEnvironment(directory,ports,memory?.mode),windowsHide:false,stdio:['ignore','pipe','pipe']});
 let startupCapture:ReturnType<typeof observeInstalledStartup>|undefined;const startupDiagnostic:Record<string,unknown>={};
 const refreshStartup=()=>{try{if(startupCapture)Object.assign(startupDiagnostic,startupCapture.read());}catch{}};
 let browser:Browser|undefined,verifiedOwner=false,launchError:Error|undefined;const started=Date.now();child.once('error',error=>{launchError=error;});
 try{
  startupCapture=observeInstalledStartup(child,iteration);refreshStartup();startupDiagnostic.memoryMode=memory?.mode??null;child.once('close',refreshStartup);
  ((receipt.launchDiagnostics??=[]) as unknown[]).push(startupDiagnostic);
  await expect.poll(async()=>{if(launchError)throw launchError;if(child.exitCode!==null||child.signalCode!==null)throw Error('Installed application exited before readiness.');try{return (await fetch(debugOrigin+'/json/version',{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}},{timeout:45000,intervals:[100,250,500]}).toBe(true);
  browser=await chromium.connectOverCDP(debugOrigin);
  const verifyBrowserOwner=async()=>{verifiedOwner=false;const session=await browser!.newBrowserCDPSession();try{const {arguments:args}=await session.send('Browser.getBrowserCommandLine');assertWrapperArguments(args,nonce);if(!sameWindowsPath(args[0]??'',executable))throw Error('Debug browser is not the exact installed executable.');verifiedOwner=true;}finally{await session.detach();}};
  await verifyBrowserOwner();
  const readiness:{iteration:number;memoryMode:InstalledMemoryMode|null;pid:number|null;timeoutMs:number;status:'waiting'|'ready'|'failed';observations:InstalledPageReadinessObservation[]}={iteration,memoryMode:memory?.mode??null,pid:child.pid??null,timeoutMs:INSTALLED_MAIN_PAGE_TIMEOUT_MS,status:'waiting',observations:[]};
  ((receipt.launchReadiness??=[]) as unknown[]).push(readiness);
  const page=await waitForInstalledMainPage({child,origin,pages:()=>browser!.contexts().flatMap(context=>context.pages()),verifyOwner:verifyBrowserOwner,launchError:()=>launchError,observe:value=>{readiness.observations.push(value);if(value.phase==='ready'||value.phase==='failed')readiness.status=value.phase;}});
  const message=page.getByRole('textbox',{name:'Message',exact:true});await expect(message).toBeEnabled({timeout:30000});const readyMs=Date.now()-started;
  expect(await page.evaluate(async()=>({surface:(await window.harnessDesktop!.getContext()).surface.kind,node:typeof (window as unknown as {process?:unknown}).process}))).toEqual({surface:'main',node:'undefined'});
  if(iteration===1){
   if(!memory){
   await message.fill('Keep this installed-app draft.');
   await expect.poll(()=>page.evaluate(()=>new Promise<unknown>((accept,reject)=>{const opened=indexedDB.open('generative-harness-journal',1);opened.onerror=()=>reject(opened.error);opened.onsuccess=()=>{const db=opened.result,read=db.transaction('entries').objectStore('entries').get('draft:new');read.onsuccess=()=>{accept(read.result?.value);db.close();};read.onerror=()=>{reject(read.error);db.close();};};}))).toBe('Keep this installed-app draft.');
   }
   await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Models & Accounts',exact:true}).click();
   const providers=page.getByRole('navigation',{name:'Subscription providers',exact:true});
   for(const connection of SUBSCRIPTION_CONNECTIONS.filter(item=>item.status==='available')){await providers.getByRole('button',{name:connection.label,exact:true}).click();const row=page.locator(`.connection-row[data-provider="${connection.id}"]`),button=row.getByRole('button',{name:`Connect ${connection.label}`,exact:true});await assertInstalledConnectionReady(connection.id,async()=>(await button.isEnabled())?'enabled':`disabled:${await row.locator('.connection-account-auth').getAttribute('data-state')??'missing'}`);}
   await page.screenshot({path:join(directory,'installed-settings.png')});await providers.getByRole('button',{name:'Gemini',exact:true}).click();await page.locator('.connection-row[data-provider="gemini-cli"]').scrollIntoViewIfNeeded();await page.screenshot({path:join(directory,'installed-official-connections.png')});
   await page.getByRole('dialog',{name:'Settings',exact:true}).getByRole('button',{name:'Close dialog',exact:true}).click();await page.screenshot({path:join(directory,'installed-main.png')});
  }else if(!memory)await expect(message).toHaveValue('Keep this installed-app draft.');
  if(memory){if(!child.pid)throw Error('The owned installed process has no PID.');await (await import('./installed-memory-retention.ts')).verifyInstalledMemoryUI(page,memory.seed,iteration,memory.observations,{pid:child.pid,executable,isAlive:()=>child.exitCode===null&&child.signalCode===null},memory.mode);}
  expect((await fetch(origin+'/health',{signal:AbortSignal.timeout(1000)})).ok).toBe(true);
  if(integration)await invokeInstalledVerifierIntegration({offer:integration,page,directory,origin,iteration,receipt});
  await page.evaluate(()=>window.close()).catch(error=>{if(!page.isClosed())throw error;});await waitForOwnedExit(child);assertInstalledCleanExit(child);
  await expect.poll(async()=>{try{return (await fetch(origin+'/health',{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}},{timeout:15000}).toBe(false);
  if(memory)memory.observations.push(await (await import('./installed-memory-retention.ts')).observeInstalledMemoryStorage(memory.seed,iteration,memory.mode));
  const result={iteration,mode:'personal',memoryMode:memory?.mode??null,pid:child.pid,readyMs,verifiedOwner,ports:{hostPort,widgetPort,debugPort},exitCode:child.exitCode,executable,passed:true};
  (receipt.launches as unknown[]).push(result);return result;
 }finally{
  if(verifiedOwner)await browser?.close().catch(()=>{});
  if(child.exitCode===null&&child.signalCode===null)await terminateProcessTree(child);
  refreshStartup();
 }
}

export async function verifyInstalledDesktop(setupPath:string,expectedUnpackedPath:string,options:{memoryRetention?:boolean;memoryEnabled?:boolean;onVerifiedInstalledPage?:InstalledVerifierIntegrationCallback;installedBuildBinding?:InstalledVerifierBuildBinding}={}){
 if(options.memoryEnabled&&!options.memoryRetention)throw Error('Enabled memory verification requires the separate default-off retention phase.');
 if(process.platform!=='win32'||process.arch!=='x64')throw Error('This verification requires Windows x64.');
 if(!isAbsolute(setupPath)||!isAbsolute(expectedUnpackedPath))throw Error('Pass absolute installer and expected unpacked-directory paths.');
 const setup=await realpath(setupPath),expectedUnpacked=await realpath(expectedUnpackedPath),setupIdentity=await identity(setup);
 const directory=resolve('.harness-desktop-installed','run-'+Date.now()+'-'+randomUUID());await mkdir(directory,{recursive:true});
 const ownedDirectory=await realpath(directory),workspace=await realpath(resolve('.')),part=relative(workspace,ownedDirectory);
 if(part==='..'||part.startsWith('..\\')||isAbsolute(part))throw Error('Verification output was redirected outside the workspace.');
 // A nested evidence UUID path exceeds the conservative Windows path budget for Gemini assets.
 // Keep the exclusive application sibling short; evidence remains in its own directory.
 const installDirectory=join(workspace,'.harness-app-'+randomUUID().replaceAll('-','').slice(0,12)),version=(JSON.parse(await readFile(join(expectedUnpacked,'resources/host/package.json'),'utf8')) as {version:string}).version;
 const receipt:Record<string,unknown>={createdAt:new Date().toISOString(),setup,setupSha256:setupIdentity.sha256,expectedUnpacked,installDirectory,nsisGuid:nsisApplicationGuid(APP_ID),version,scope:'Owned temporary per-user installation, exact payload/provider custody, two personal installed executable launches per requested phase with local recovery, and identity-bound uninstall. No sign-in, credentials, inference or user-profile adoption.',inference:false,auth:false,memoryRetentionRequested:options.memoryRetention===true,memoryEnabledRequested:options.memoryEnabled===true,launches:[],passed:false};
 const preflightObservations:PreflightObservation[]=[];receipt.preflightObservations=preflightObservations;
 const preflight=(stage:PreflightStage)=>installPreflight(ownedDirectory,stage,preflightObservations);
 let installedUninstaller:{path:string;identity:FileIdentity}|undefined,ownedCache:OwnedCache|undefined,installationInvoked=false,mainError:unknown;
 try{
  const before=await preflight('before-install');assertClearInstallPreflight(before);receipt.preflight=before;
  try{await lstat(installDirectory);throw Error('Exclusive install destination already exists.');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const expected=await packageContentManifest(expectedUnpacked);receipt.expectedPayload={files:expected.files.length,bytes:expected.bytes,sha256:expected.sha256,maxInstalledPathLength:assertWindowsDestinationFits(installDirectory,expected.files.map(file=>file.path))};
  // Repeat the read-only preflight immediately before installation; never upgrade an existing user installation.
  assertClearInstallPreflight(await preflight('pre-install-recheck'));
  if(!sameIdentity(await identity(setup),setupIdentity))throw Error('Installer changed since verification began.');
  const owner:InstalledVerificationOwner={setup,setupSha256:setupIdentity.sha256,installDirectory,guid:nsisApplicationGuid(APP_ID)};
  await writeFile(join(ownedDirectory,'owner.json'),JSON.stringify(owner,null,2),{flag:'wx'});
  const sampleProgress=await createInstalledPathProgressSampler(installDirectory,expected.files).catch(()=>undefined);receipt.installerProgressSetup=sampleProgress?'ready':'unavailable';
  installationInvoked=true;receipt.installCommand=await runOwned(setup,installedCommandArguments('install',installDirectory),{cwd:ownedDirectory,env:baseEnvironment(),timeoutMs:1200000,rawTail:true,phase:'installer',sampleProgress,onObservation:value=>{receipt.installerObservation=value;}});
  if(!sameWindowsPath(await realpath(installDirectory),installDirectory))throw Error('Installer did not create the exact ordinary owned directory.');
  const after=await preflight('after-install'),uninstaller=assertOwnedInstallEntries(after.entries,installDirectory,version);
  installedUninstaller={path:uninstaller,identity:await identity(uninstaller)};receipt.installedRegistry=after.entries;
  if(after.runningAppPids.length)throw Error('Installer unexpectedly started the native application.');
  ownedCache=await captureOwnedCache(after.updaterCache.path,setupIdentity.sha256);
  const actual=await packageContentManifest(installDirectory,{installed:true});assertMatchingContents(expected,actual);receipt.payloadCustody={matches:true,files:actual.files.length,bytes:actual.bytes,sha256:actual.sha256};
  const providers=await verifyPackagedProviders(installDirectory);receipt.providerVerification={passed:providers.receipt.passed,receipt:join(providers.directory,'verification.json')};
  // Native journals are origin-scoped: restart must use the same application ports.
  // A new nonce still proves ownership of each launched process independently.
  let memory:MemoryRetention|undefined;
  if(options.memoryRetention){
   const seed=await (await import('./installed-memory-retention.ts')).seedInstalledMemoryProfile(ownedDirectory);
   memory={seed,observations:[],mode:'default-off'};
   receipt.memoryRetention={version:1,scope:'Seeded disposable retained records reviewed through the exact installed application with production memory flags off. No enabled recall, automatic extraction, native checkpoint or live-provider evaluation.',seed,hostDefaultOff:true,seedEnablement:'Constructor-local fixture creation only; project disabled before installed launch.',providerNetworkCalls:null,observations:memory.observations};
  }
  const executable=join(installDirectory,APP_FILE),ports=await verificationPorts();
  let integrationOffer:InstalledVerifierIntegrationOffer|undefined;
  if(options.onVerifiedInstalledPage){
   const resolution=await resolveInstalledVerifierProvenance({setupSha256:setupIdentity.sha256,executable,expected,packageVersion:version,buildBinding:options.installedBuildBinding}),controlAddon=installedControlAddon(expected);
   if(resolution.status==='bound')integrationOffer={callback:options.onVerifiedInstalledPage,provenance:resolution.provenance,buildReference:resolution.buildReference,controlAddon};
   receipt.installedIntegration=resolution.status==='bound'?{status:'bound',buildReference:resolution.buildReference,controlAddon}:{status:'unbound',missing:resolution.missing,controlAddon};
  }
  await launchInstalled(executable,ownedDirectory,1,receipt,ports,memory,integrationOffer);await launchInstalled(executable,ownedDirectory,2,receipt,ports,memory,integrationOffer);
  if(options.memoryEnabled){
   // Keep the default-off receipt and profile intact. The enabled phase owns
   // a separate, new profile and uses the production host environment path.
   const enabledDirectory=await prepareInstalledMemoryPhaseDirectory(ownedDirectory,owner);
   const seed=await (await import('./installed-memory-retention.ts')).seedInstalledMemoryProfile(enabledDirectory),enabled:MemoryRetention={seed,observations:[],mode:'enabled'};
   receipt.memoryEnabled={version:1,scope:'Seeded disposable retained records in a separate installed profile with explicit production host activation and UI source opt-in. Proves review, pinned sources, deterministic consolidation, redacted native export, Forget and restart. No foreground recall/exclusion/send, automatic extraction, native checkpoint, live-provider evaluation or elapsed-retention purge proof.',seed,activation:{HARNESS_FLAG_MEMORY_PROJECT_V1:'true'},sourceConsent:'Disabled before launch; enabled only through the project-memory UI.',providerNetworkCalls:null,observations:enabled.observations};
   await launchInstalled(executable,enabledDirectory,1,receipt,ports,enabled);await launchInstalled(executable,enabledDirectory,2,receipt,ports,enabled);
  }
 }catch(error){mainError=error;receipt.error=error instanceof Error?error.message:'Installed verification failed.';}
 finally{
  if(installedUninstaller){
   try{
    const current=await preflight('before-uninstall');if(current.runningAppPids.length)throw Error('A Harness application remains running; uninstall is withheld.');
    const path=assertOwnedInstallEntries(current.entries,installDirectory,version);if(!sameWindowsPath(path,installedUninstaller.path)||!sameIdentity(await identity(path),installedUninstaller.identity))throw Error('Owned uninstaller identity changed; uninstall is withheld.');
    const cleanupExecutable=join(ownedDirectory,'owned-uninstaller.exe');await copyFile(path,cleanupExecutable);if((await identity(cleanupExecutable)).sha256!==installedUninstaller.identity.sha256)throw Error('Uninstaller copy differs; cleanup is withheld.');
    const result=await runOwned(cleanupExecutable,installedCommandArguments('uninstall',installDirectory),{cwd:ownedDirectory,env:baseEnvironment(),timeoutMs:180000,rawTail:true,phase:'uninstaller'});
    await expect.poll(async()=>{const state=await preflight('after-uninstall-poll');let exists=true;try{await lstat(installDirectory);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')exists=false;else throw error;}return !state.entries.length&&!exists;},{timeout:120000,intervals:[250,500,1000]}).toBe(true);
    const cache=ownedCache===undefined?{status:'not-confirmed-owned-retained'}:await cleanOwnedCache(ownedCache);
    assertClearInstallPreflight(await preflight('after-uninstall'));
    receipt.cleanup={status:'uninstalled-owned-installation',command:result,cache,shortcuts:'absent',installationKeys:'absent',nativeProcesses:'absent'};
   }catch(error){receipt.cleanup={status:'preserved-for-inspection',error:error instanceof Error?error.message:'Owned cleanup failed.'};mainError??=error;}
  }else receipt.cleanup={status:installationInvoked?'preserved-unconfirmed-installation':'not-installed'};
  receipt.passed=!mainError&&installedUninstaller!==undefined&&(receipt.cleanup as {status:string}).status==='uninstalled-owned-installation';
  await writeFile(join(ownedDirectory,'verification.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify({directory:ownedDirectory,passed:receipt.passed}));
 }
 if(mainError)throw mainError;return {directory:ownedDirectory,receipt};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const {setup,unpacked,memoryRetention,memoryEnabled}=readInstalledVerificationArguments(process.argv.slice(2));
 await verifyInstalledDesktop(setup,unpacked,{memoryRetention,memoryEnabled});
}
