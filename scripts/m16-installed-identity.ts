import {execFileSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,mkdtemp,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join,resolve,win32} from 'node:path';
import {pathToFileURL} from 'node:url';
import {packageContentManifest,verifyInstalledDesktop,type InstalledVerifierBuildBinding,type InstalledVerifierIntegrationContext} from './verify-installed-desktop.ts';
import {terminateProcessTree} from '../packages/runtime-pi/process-tree.ts';

const M16_APP_FILE='Gen V1.exe';
const M16_CONTROL_ADDON_PATH='resources/host/packages/core/windows-control-bridge.node';
const M16_MODULE_LOAD_TIMEOUT_MS=30000;
const M16_MODULE_LOAD_OUTPUT_BYTES=64*1024;
const M16_NAPI_MIN=8;
const M16_IDENTITY_SCOPE='One existing hosted installed-memory job reuses its packaged installer and default-off verification pass. The callback identifies the exact installed executable and control addon, then performs one bounded no-action module-load smoke in an isolated child of the installed Electron runtime. No control flag, live driver, browser, consent, capture, Stop, inference or credential action.';

export const M16_CONTROL_ADDON_EXPORTS=['pickWindow','listWindows','windowIdentity','captureWindow','dropBinding'] as const;
export const M16_BROWSER_SCENARIO_REVIEW={
 source:'scripts/m16-installed-control-scenario.ts',
 status:'NOT_WIRED',
 coverage:['consent-request-and-grant','bounded-selected-tab-capture','unconsented-interact-denied','post-stop-capture-denied'],
 prerequisites:['control-flag-activation','live-driver-registration','owned-interactive-browser-tab','app-host-consent','owned-profile-artifact-root','independent-stop'],
 reason:'The existing owned scenario already covers consent, bounded capture, unconsented interaction denial and post-Stop denial. Wiring it would cross the flag activation, live registration, native capture and independent Stop boundary, so this verification-only adaptation records the review and leaves the scenario NOT_RUN.'
} as const;

export interface M16RunReference{sourceSha:string;buildReference:string;runId:string;runAttempt:string}
export interface M16BuildManifestIdentity{sha256:string;electronVersion:string;setupEntryMatched:true}
export interface M16ModuleLoadRuntime{executable:string;electron:string;node:string;modules:string;napi:string;platform:'win32';arch:'x64'}
export interface M16ModuleLoadReceipt{
 status:'PASS';
 runtime:M16ModuleLoadRuntime;
 expectedExports:string[];
 exports:Record<string,string>;
 nativeCalls:false;
 durationMs:number;
}
interface M16ModuleLoadChildOutput{status?:unknown;versions?:unknown;exports?:unknown;missing?:unknown;error?:unknown}

function sha256Bytes(value:Buffer|string){return createHash('sha256').update(value).digest('hex');}
function isRecord(value:unknown):value is Record<string,unknown>{return typeof value==='object'&&value!==null&&!Array.isArray(value);}
function isSha256(value:unknown):value is string{return typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);}
function isSourceSha(value:unknown):value is string{return typeof value==='string'&&/^[0-9a-f]{40}$/.test(value);}
function packageRelativeParts(value:string){const parts=value.split('/');if(!parts.length||parts.some(part=>part===''||part==='.'||part==='..'||part.includes('\\')||part.includes('\0')))throw Error('The verified control addon path is not package-relative.');return parts;}

export function m16RunReference(env:NodeJS.ProcessEnv=process.env):M16RunReference{
 const sourceSha=env.GITHUB_SHA;
 if(!isSourceSha(sourceSha))throw Error('M16 hosted identity verification requires a 40-hex checked-out GITHUB_SHA.');
 const server=(env.GITHUB_SERVER_URL??'').replace(/\/+$/,'');
 const repository=env.GITHUB_REPOSITORY??'';
 const runId=env.GITHUB_RUN_ID??'';
 const runAttempt=env.GITHUB_RUN_ATTEMPT??'1';
 if(!/^https:\/\/[^/\s]+(?:\/[^/\s]+)*$/.test(server))throw Error('M16 hosted identity verification requires GITHUB_SERVER_URL.');
 if(!/^[^/\s]+\/[^/\s]+$/.test(repository))throw Error('M16 hosted identity verification requires GITHUB_REPOSITORY.');
 if(!/^[0-9]+$/.test(runId))throw Error('M16 hosted identity verification requires GITHUB_RUN_ID.');
 if(!/^[0-9]+$/.test(runAttempt))throw Error('M16 hosted identity verification requires GITHUB_RUN_ATTEMPT.');
 return{sourceSha,buildReference:`${server}/${repository}/actions/runs/${runId}/attempts/${runAttempt}`,runId,runAttempt};
}

export function assertM16CheckedOutSource(expected:string,head:string){
 if(!isSourceSha(expected)||!isSourceSha(head))throw Error('M16 source identity must be a 40-hex checkout SHA.');
 if(expected!==head)throw Error('The checked-out source does not match GITHUB_SHA; provenance is refused.');
}

export function m16BuildManifestIdentity(bytes:Buffer,setup:{name:string;bytes:number;sha256:string}):M16BuildManifestIdentity{
 if(!setup||typeof setup.name!=='string'||setup.name===''||!Number.isSafeInteger(setup.bytes)||setup.bytes<0||!isSha256(setup.sha256))throw Error('M16 setup identity is malformed.');
 let value:unknown;try{value=JSON.parse(bytes.toString('utf8'));}catch{throw Error('The same-job build manifest is not valid JSON.');}
 if(!isRecord(value)||typeof value.electronVersion!=='string'||!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(value.electronVersion))throw Error('The same-job build manifest has no valid Electron runtime identity.');
 if(!Array.isArray(value.files)||value.files.length===0||value.files.length>200000)throw Error('The same-job build manifest has no bounded file inventory.');
 const matches=value.files.filter(entry=>isRecord(entry)&&typeof entry.file==='string'&&basename(entry.file.replaceAll('\\','/'))===setup.name);
 if(matches.length!==1)throw Error('The same-job build manifest does not name exactly one setup executable.');
 const entry=matches[0];
 if(!isRecord(entry)||entry.bytes!==setup.bytes||!isSha256(entry.sha256)||entry.sha256!==setup.sha256)throw Error('The same-job build manifest setup identity does not match the invoked installer.');
 return{sha256:sha256Bytes(bytes),electronVersion:value.electronVersion,setupEntryMatched:true};
}

export function m16BuildReference(reference:string,manifestSha256:string){
 if(typeof reference!=='string'||reference.trim()===''||!isSha256(manifestSha256))throw Error('M16 build reference is malformed.');
 return`${reference}#build-manifest-sha256=${manifestSha256}`;
}

export function m16ModuleLoadEnvironment(base:NodeJS.ProcessEnv=process.env):NodeJS.ProcessEnv{
 const env:NodeJS.ProcessEnv={};
 for(const key of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','TEMP','TMP','USERPROFILE','HOME','LOCALAPPDATA','APPDATA'])if(base[key]!==undefined)env[key]=base[key];
 env.ELECTRON_RUN_AS_NODE='1';
 env.ELECTRON_NO_ATTACH_CONSOLE='1';
 return env;
}

const M16_MODULE_LOAD_SCRIPT=`'use strict';
const expected=${JSON.stringify(M16_CONTROL_ADDON_EXPORTS)};
const finish=(value,code)=>process.stdout.write(JSON.stringify(value)+'\\n',()=>process.exit(code));
let addon;
try{addon=require(process.argv[2]);}catch(error){finish({status:'LOAD_FAILED',error:typeof error?.code==='string'?error.code:'load-error'},2);}
if(addon){
 const exports=Object.fromEntries(expected.map(name=>[name,typeof addon[name]]));
 const missing=expected.filter(name=>exports[name]!=='function');
 finish({status:missing.length?'EXPORTS_MISSING':'LOADED',versions:{electron:process.versions.electron??null,node:process.versions.node??null,modules:process.versions.modules??null,napi:process.versions.napi??null,platform:process.platform,arch:process.arch},exports,missing},missing.length?3:0);
}
`;
export function parseM16ModuleLoadOutput(stdout:string,expectedElectronVersion:string):M16ModuleLoadReceipt{
 if(typeof stdout!=='string'||typeof expectedElectronVersion!=='string'||expectedElectronVersion==='')throw Error('M16 module-load output is malformed.');
 const lines=stdout.trim().split(/\r?\n/).filter(Boolean);
 let value:M16ModuleLoadChildOutput|undefined;
 for(let index=lines.length-1;index>=0;index--){
  try{
   const candidate=JSON.parse(lines[index]!) as unknown;
   if(isRecord(candidate)&&typeof candidate.status==='string'){value=candidate as M16ModuleLoadChildOutput;break;}
  }catch{}
 }
 if(!value)throw Error('M16 module-load child produced no bounded JSON receipt.');
 if(value.status!=='LOADED'){
  const missing=Array.isArray(value.missing)?value.missing.filter((name):name is string=>typeof name==='string'&&/^[A-Za-z][A-Za-z0-9]*$/.test(name)):[];
  const detail=value.status==='EXPORTS_MISSING'&&missing.length?' missing='+missing.join(','):typeof value.error==='string'&&/^[A-Za-z0-9_.-]+$/.test(value.error)?' code='+value.error:'';
  throw Error('M16 direct module load failed with status '+String(value.status)+detail+'.');
 }
 if(!isRecord(value.versions)||!isRecord(value.exports))throw Error('M16 module-load receipt has no runtime or export identity.');
 const versions=value.versions,exportKinds=value.exports;
 if(versions.electron!==expectedElectronVersion)throw Error('M16 direct module load did not use the packaged Electron runtime.');
 const electron=versions.electron,node=versions.node,modules=versions.modules,napi=versions.napi,platform=versions.platform,arch=versions.arch;
 if(typeof electron!=='string'||typeof node!=='string'||typeof modules!=='string'||typeof napi!=='string'||!Number.isInteger(Number(napi))||Number(napi)<M16_NAPI_MIN)throw Error('M16 direct module load did not expose the required Node-API runtime.');
 if(platform!=='win32'||arch!=='x64')throw Error('M16 direct module load did not use the packaged Windows x64 runtime.');
 const exports:Record<string,string>={};
 for(const name of M16_CONTROL_ADDON_EXPORTS){const kind=exportKinds[name];if(typeof kind!=='string'||kind!=='function')throw Error('M16 installed control addon is missing expected export '+name+'.');exports[name]=kind;}
 return{status:'PASS',runtime:{executable:M16_APP_FILE,electron,node,modules,napi,platform,arch},expectedExports:[...M16_CONTROL_ADDON_EXPORTS],exports,nativeCalls:false,durationMs:0};
}

export function assertM16ModuleLoadReceipt(value:unknown,expectedElectronVersion:string){
 if(!isRecord(value)||value.status!=='PASS'||value.nativeCalls!==false||!isRecord(value.runtime)||!isRecord(value.exports))throw Error('M16 module-load receipt is malformed or not a pass.');
 const runtime=value.runtime;
 if(runtime.executable!==M16_APP_FILE||runtime.electron!==expectedElectronVersion||runtime.platform!=='win32'||runtime.arch!=='x64')throw Error('M16 module-load receipt runtime does not match the packaged installer.');
 if(typeof runtime.node!=='string'||typeof runtime.modules!=='string'||typeof runtime.napi!=='string'||!Number.isInteger(Number(runtime.napi))||Number(runtime.napi)<M16_NAPI_MIN)throw Error('M16 module-load receipt lacks the required Node-API runtime.');
 if(!Array.isArray(value.expectedExports))throw Error('M16 module-load receipt lacks expected exports.');
 for(const name of M16_CONTROL_ADDON_EXPORTS){if(!value.expectedExports.includes(name)||value.exports[name]!=='function')throw Error('M16 module-load receipt lacks expected export '+name+'.');}
}

async function m16FileIdentity(path:string){const info=await lstat(path,{bigint:true});if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1n)throw Error('The observed installed identity is not a single ordinary file.');return{bytes:Number(info.size),sha256:await hashFile(path)};}
async function hashFile(path:string){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}

export async function readM16Owner(directory:string,installerSha256:string){
 let value:unknown;try{value=JSON.parse(await readFile(join(directory,'owner.json'),'utf8'));}catch{throw Error('M16 installed identity verification has no readable owner receipt.');}
 if(!isRecord(value)||value.setupSha256!==installerSha256||typeof value.installDirectory!=='string'||value.installDirectory.includes('\0')||!win32.isAbsolute(value.installDirectory)||win32.normalize(value.installDirectory)!==value.installDirectory)throw Error('M16 installed owner receipt does not match the invoked installer.');
 return value.installDirectory;
}

async function runM16ModuleLoad(input:{executablePath:string;addonPath:string;expectedElectronVersion:string;directory:string}):Promise<M16ModuleLoadReceipt>{
 const work=await mkdtemp(join(input.directory,'m16-module-load-'));
 const script=join(work,'load.cjs');
 try{
  await writeFile(script,M16_MODULE_LOAD_SCRIPT,{flag:'wx'});
  const started=Date.now();
  const stdout=await new Promise<string>((accept,reject)=>{
   const child=spawn(input.executablePath,[script,input.addonPath],{cwd:work,env:m16ModuleLoadEnvironment(),windowsHide:true,stdio:['ignore','pipe','pipe']});
   let output='',stderrBytes=0,bytes=0,settled=false,timer:ReturnType<typeof setTimeout>|undefined;
   const fail=(error:Error)=>{if(settled)return;settled=true;if(timer)clearTimeout(timer);void terminateProcessTree(child).then(()=>reject(error),()=>reject(error));};
   timer=setTimeout(()=>fail(Error('M16 direct module load exceeded its time bound.')),M16_MODULE_LOAD_TIMEOUT_MS);
   child.once('error',()=>fail(Error('M16 direct module-load child could not start.')));
   child.stdout?.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>M16_MODULE_LOAD_OUTPUT_BYTES){fail(Error('M16 direct module-load child exceeded its output bound.'));return;}output+=String(chunk);});
   child.stderr?.on('data',(chunk:Buffer)=>{stderrBytes+=chunk.length;if(stderrBytes>M16_MODULE_LOAD_OUTPUT_BYTES)fail(Error('M16 direct module-load child exceeded its stderr bound.'));});
   child.once('close',(code,signal)=>{if(settled)return;settled=true;clearTimeout(timer);if(code!==0){try{parseM16ModuleLoadOutput(output,input.expectedElectronVersion);}catch(error){reject(error);return;}reject(Error('M16 direct module-load child exited '+String(code)+' (signal '+String(signal)+').'));return;}accept(output);});
  });
  return{...parseM16ModuleLoadOutput(stdout,input.expectedElectronVersion),durationMs:Date.now()-started};
 }finally{await rm(work,{recursive:true,force:true,maxRetries:5}).catch(()=>{});}
}

function verifierIntegrationReceipt(value:unknown,iteration:number){
 if(!isRecord(value)||value.kind!=='installed-verifier-integration'||value.iteration!==iteration||!isRecord(value.receipt))throw Error('M16 verifier callback receipt '+iteration+' is missing or malformed.');
 return value.receipt;
}

export function assertM16IdentityVerificationReceipt(receipt:Record<string,unknown>,expectedElectronVersion:string){
 if(receipt.passed!==true)throw Error('M16 installed identity verification did not pass.');
 if(!isRecord(receipt.installedIntegration)||receipt.installedIntegration.status!=='bound')throw Error('M16 installed identity verification did not resolve a bound source provenance.');
 if(!Array.isArray(receipt.launches)||receipt.launches.length!==2)throw Error('M16 installed identity verification did not complete exactly two default-off launches.');
 for(const launch of receipt.launches){if(!isRecord(launch)||launch.passed!==true||launch.verifiedOwner!==true)throw Error('M16 installed identity launch did not pass owned verification.');}
 if(!Array.isArray(receipt.integrations)||receipt.integrations.length!==2)throw Error('M16 installed identity verification did not complete both callbacks.');
 const first=verifierIntegrationReceipt(receipt.integrations[0],1),second=verifierIntegrationReceipt(receipt.integrations[1],2);
 if(first.status!=='PASS'||first.kind!=='m16-installed-identity'||!isSourceSha(first.sourceSha))throw Error('M16 installed identity callback receipt is not a pass.');
 if(!isRecord(first.fileIdentity)||!isRecord(first.fileIdentity.executable)||!isRecord(first.fileIdentity.addon)||first.fileIdentity.executable.name!==M16_APP_FILE||!isSha256(first.fileIdentity.executable.sha256)||first.fileIdentity.addon.packageRelativePath!==M16_CONTROL_ADDON_PATH||!isSha256(first.fileIdentity.addon.sha256))throw Error('M16 installed identity callback did not record the exact executable and addon identity.');
 assertM16ModuleLoadReceipt(first.directModuleLoad,expectedElectronVersion);
 if(!isRecord(second.directModuleLoad)||second.directModuleLoad.status!=='NOT_RUN')throw Error('M16 installed identity callback reran or omitted the bounded single module-load receipt.');
 if(!isRecord(first.applicationProductionRegistration)||first.applicationProductionRegistration.status!=='NOT_OBSERVED')throw Error('M16 application production-side registration was not kept distinct and unproved.');
 if(!isRecord(first.runtimeRegistration)||first.runtimeRegistration.status!=='UNPROVED')throw Error('M16 runtime registration must remain unproved.');
 if(!isRecord(first.browserScenarioReview)||first.browserScenarioReview.status!=='NOT_WIRED')throw Error('M16 browser scenario review must remain unwired.');
 if(!isRecord(receipt.cleanup)||receipt.cleanup.status!=='uninstalled-owned-installation')throw Error('M16 installed identity verification did not clean up its owned installation.');
 return{callbacks:2,launches:2};
}

export async function runM16InstalledIdentityVerification(input:{setup:string;unpacked:string}){
 if(process.platform!=='win32'||process.arch!=='x64')throw Error('M16 installed identity verification requires Windows x64.');
 if(!isAbsolute(input.setup)||!isAbsolute(input.unpacked))throw Error('Pass absolute installer and expected unpacked-directory paths.');
 const setup=await realpath(input.setup),unpacked=await realpath(input.unpacked),run=m16RunReference();
 let head:string;try{head=execFileSync('git',['rev-parse','HEAD'],{cwd:process.cwd(),encoding:'utf8'}).trim();}catch{throw Error('M16 installed identity verification could not read the checked-out source identity.');}
 assertM16CheckedOutSource(run.sourceSha,head);
 const setupIdentity=await m16FileIdentity(setup),expected=await packageContentManifest(unpacked);
 const expectedExecutable=expected.files.find(file=>file.path===M16_APP_FILE),expectedAddon=expected.files.find(file=>file.path===M16_CONTROL_ADDON_PATH);
 if(!expectedExecutable||!expectedAddon)throw Error('The packaged payload does not contain the exact installed executable and control addon.');
 let manifestBytes:Buffer;try{manifestBytes=await readFile(join(dirname(setup),'build-manifest.json'));}catch{throw Error('M16 hosted verification requires the same-job build-manifest.json beside the installer.');}
 const manifest=m16BuildManifestIdentity(manifestBytes,{name:basename(setup),bytes:setupIdentity.bytes,sha256:setupIdentity.sha256});
 const binding:InstalledVerifierBuildBinding={reference:m16BuildReference(run.buildReference,manifest.sha256),sourceSha:run.sourceSha,installerSha256:setupIdentity.sha256,payloadSha256:expected.sha256};
 let moduleLoad:M16ModuleLoadReceipt|undefined,moduleLoadIdentity:{executableSha256:string;addonSha256:string}|undefined;
 const callback=async(context:InstalledVerifierIntegrationContext)=>{
  if(context.provenance.sourceSha!==run.sourceSha||context.provenance.installerSha256!==setupIdentity.sha256||context.provenance.payloadSha256!==expected.sha256||context.provenance.executableSha256!==expectedExecutable.sha256||context.buildReference!==binding.reference)throw Error('M16 verifier callback provenance does not match the same-job installer, payload and checkout.');
  const controlAddon=context.controlAddon;
  if(!controlAddon||controlAddon.packageRelativePath!==M16_CONTROL_ADDON_PATH||controlAddon.sha256!==expectedAddon.sha256)throw Error('M16 verifier callback did not expose the packaged control addon identity.');
  const installDirectory=await readM16Owner(context.directory,setupIdentity.sha256);
  const executablePath=win32.join(installDirectory,M16_APP_FILE),addonPath=win32.join(installDirectory,...packageRelativeParts(controlAddon.packageRelativePath));
  const executableIdentity=await m16FileIdentity(executablePath),addonIdentity=await m16FileIdentity(addonPath);
  if(executableIdentity.sha256!==expectedExecutable.sha256||executableIdentity.bytes!==expectedExecutable.bytes||context.provenance.executableSha256!==executableIdentity.sha256)throw Error('The installed executable identity differs from the verified payload.');
  if(addonIdentity.sha256!==expectedAddon.sha256||addonIdentity.bytes!==expectedAddon.bytes||controlAddon.sha256!==addonIdentity.sha256)throw Error('The installed control addon identity differs from the verified payload.');
  if(moduleLoadIdentity&&(moduleLoadIdentity.executableSha256!==executableIdentity.sha256||moduleLoadIdentity.addonSha256!==addonIdentity.sha256))throw Error('The installed runtime identity changed during identity verification.');
  const directModuleLoad=context.iteration===1?(moduleLoad??await runM16ModuleLoad({executablePath,addonPath,expectedElectronVersion:manifest.electronVersion,directory:context.directory})):undefined;
  if(directModuleLoad){moduleLoad=directModuleLoad;moduleLoadIdentity??={executableSha256:executableIdentity.sha256,addonSha256:addonIdentity.sha256};}
  return{
   kind:'m16-installed-identity',
   status:'PASS',
   sourceSha:context.provenance.sourceSha,
   buildReference:context.buildReference,
   packageVersion:context.provenance.packageVersion,
   iteration:context.iteration,
   fileIdentity:{executable:{name:M16_APP_FILE,bytes:executableIdentity.bytes,sha256:executableIdentity.sha256},addon:{packageRelativePath:controlAddon.packageRelativePath,bytes:addonIdentity.bytes,sha256:addonIdentity.sha256}},
   directModuleLoad:directModuleLoad??{status:'NOT_RUN',dependency:'The single bounded module-load smoke runs only in the first verified installed launch for this exact executable and addon identity.'},
   applicationProductionRegistration:{status:'NOT_OBSERVED',reason:'The production control flag and live driver registration were not activated in this verification-only pass.'},
   runtimeRegistration:{status:'UNPROVED',dependency:'Application-level control-bridge registration and a live driver were not exercised; direct module load is not runtime registration.'},
   browserScenarioReview:M16_BROWSER_SCENARIO_REVIEW,
   actions:{browserOpened:false,flagActivated:false,driverRegistered:false,nativeCapture:false,stop:false}
  };
 };
 const result=await verifyInstalledDesktop(setup,unpacked,{onVerifiedInstalledPage:callback,installedBuildBinding:binding});
 assertM16IdentityVerificationReceipt(result.receipt,manifest.electronVersion);
 const first=verifierIntegrationReceipt((result.receipt.integrations as unknown[])[0],1);
 const summary={
  version:1,
  createdAt:new Date().toISOString(),
  passed:true,
  scope:M16_IDENTITY_SCOPE,
  sourceSha:run.sourceSha,
  buildReference:binding.reference,
  buildManifest:{file:'build-manifest.json',sha256:manifest.sha256,electronVersion:manifest.electronVersion,setupEntryMatched:true},
  installer:{bytes:setupIdentity.bytes,sha256:setupIdentity.sha256},
  payload:{files:expected.files.length,bytes:expected.bytes,sha256:expected.sha256},
  expectedRuntime:{electronVersion:manifest.electronVersion,napiMin:M16_NAPI_MIN,exports:[...M16_CONTROL_ADDON_EXPORTS]},
  callbacks:2,
  launches:(result.receipt.launches as Record<string,unknown>[]).map(launch=>({iteration:launch.iteration,mode:launch.mode,memoryMode:launch.memoryMode,verifiedOwner:launch.verifiedOwner,passed:launch.passed})),
  identity:first.fileIdentity,
  directModuleLoad:first.directModuleLoad,
  applicationProductionRegistration:first.applicationProductionRegistration,
  runtimeRegistration:first.runtimeRegistration,
  browserScenarioReview:first.browserScenarioReview,
  cleanup:{status:'uninstalled-owned-installation'}
 };
 await writeFile(join(result.directory,'m16-identity-receipt.json'),JSON.stringify(summary,null,2),{flag:'wx'});
 console.log(JSON.stringify({directory:result.directory,passed:true,receipt:'m16-identity-receipt.json'}));
 return{directory:result.directory,receipt:result.receipt};
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const [setup,unpacked,...rest]=process.argv.slice(2);
 if(!setup||!unpacked||rest.length)throw Error('Usage: m16-installed-identity <absolute-setup> <absolute-unpacked>');
 await runM16InstalledIdentityVerification({setup,unpacked});
}
