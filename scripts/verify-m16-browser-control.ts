import {chromium,expect,type Browser} from '@playwright/test';
import {spawn,type ChildProcess} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {lstat,mkdir,readFile,readdir,realpath,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {isAbsolute,join,win32} from 'node:path';
import {promisify} from 'node:util';
import {terminateProcessTree} from '../packages/runtime-pi/process-tree.ts';
import {verificationPorts,assertWrapperArguments} from './portable-verification.ts';
import {assertInstalledCleanExit,installedVerificationEnvironment,observeInstalledStartup,observeOwnedProcess,packageContentManifest,waitForInstalledMainPage} from './verify-installed-desktop.ts';

/** M16 C3/C4 installed browser-tab proof — LOCAL-ONLY owned verification.
 * Usage: pnpm exec tsx scripts/verify-m16-browser-control.ts <absolute payload directory containing "Gen V1.exe"> <absolute NEW owned evidence directory> [absolute build-manifest.json]
 *
 * The payload directory is normally a packaged `win-unpacked` (or the install
 * target afterwards); the release `build-manifest.json` is required so the
 * receipt binds the installer identity and payload digest — a bare executable
 * path is not accepted as provenance.
 *
 * Reuses the installed launch specification from verify-installed-desktop.ts:
 * owned ephemeral ports, a freshly created disposable data profile, a
 * per-launch verification nonce, CDP owner revalidation against the exact
 * executable, and clean-exit proof. The consent/capture/Stop slice rides the
 * production command surface (POST /api/commands → service.command) from
 * inside the verified-owned renderer — the same transaction path the
 * ControlConsentPanel uses. Flags stay off everywhere except this owned
 * child environment. */
const CONTROL_FLAG_ENV='HARNESS_FLAG_CONTROL_CONSENTED_BROWSER_V1';
const CANDIDATE_TIMEOUT_MS=30000;
const TERMINATE_BOUND_MS=15000;
const APP_FILE='Gen V1.exe';
const SETUP_PATTERN=/^Gen-V1-Setup-([0-9]+\.[0-9]+\.[0-9]+)-win-x64\.exe$/;
type JsonRecord=Record<string,unknown>;

function sameWindowsPath(left:string,right:string){return win32.normalize(left).replace(/[\\/]+$/,'').toLowerCase()===win32.normalize(right).replace(/[\\/]+$/,'').toLowerCase();}
async function hashFile(path:string){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
async function bounded(promise:Promise<unknown>,ms:number,label:string){let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([promise,new Promise<never>((_a,reject)=>{timer=setTimeout(()=>reject(Error(label+' exceeded '+ms+' ms.')),ms);})]);}finally{clearTimeout(timer);}}
async function waitForOwnedExit(child:ChildProcess,timeoutMs=15000){
 if(child.exitCode!==null||child.signalCode!==null)return;
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{await Promise.race([new Promise<void>(done=>child.once('close',()=>done())),new Promise<never>((_done,reject)=>{timer=setTimeout(()=>reject(Error('Installed application did not exit after closing its last window.')),timeoutMs);})]);}finally{clearTimeout(timer);}
}
/** The data profile must be newly created by this run — a preexisting path is
 * not a disposable profile and could already contain state or receipts. */
async function createOwnedDirectory(directory:string){
 if(!isAbsolute(directory))throw Error('Evidence directory must be an absolute path.');
 const parent=win32.dirname(directory),parentStat=await lstat(parent,{bigint:true}).catch(()=>null);
 if(!parentStat?.isDirectory()||parentStat.isSymbolicLink()||await realpath(parent)!==parent)throw Error('Evidence directory parent is not an ordinary canonical directory.');
 await mkdir(directory); // exclusive create — throws EEXIST on any preexisting entry
 const created=await lstat(directory,{bigint:true});
 if(!created.isDirectory()||created.isSymbolicLink()||await realpath(directory)!==directory)throw Error('Created evidence directory is not an ordinary canonical directory.');
}
async function sourceSha(){const run=promisify(execFile);try{const {stdout}=await run('git',['rev-parse','HEAD'],{cwd:process.cwd(),timeout:15000});const value=stdout.trim();return /^[0-9a-f]{40}$/.test(value)?value:null;}catch{return null;}}
type ManifestFile={file:string;bytes:number;sha256:string};
async function readBuildManifest(path:string){
 const sha256=await hashFile(path);
 const parsed=JSON.parse(await readFile(path,'utf8')) as {files?:unknown};
 if(!parsed||!Array.isArray(parsed.files)||parsed.files.length===0||parsed.files.length>200000)throw Error('Build manifest has no usable file list.');
 for(const file of parsed.files){const entry=file as Partial<ManifestFile>;if(typeof entry.file!=='string'||typeof entry.bytes!=='number'||typeof entry.sha256!=='string'||!/^[0-9a-f]{64}$/.test(entry.sha256))throw Error('Build manifest entry is malformed.');}
 return {files:parsed.files as ManifestFile[],sha256};
}
function readArguments(args:string[]){
 const [payload,directory,manifestArg]=args;
 if(!payload||!directory||args.length>3||!isAbsolute(payload)||!isAbsolute(directory)||manifestArg!==undefined&&!isAbsolute(manifestArg))throw Error('Usage: verify-m16-browser-control <absolute payload dir containing "Gen V1.exe"> <absolute NEW owned evidence dir> [absolute build-manifest.json]');
 return {payload,directory,manifestArg};
}

/** Installer + payload provenance: exact source SHA (invocation worktree /
 * dispatch env), package version from the real Setup filename, installer and
 * executable hashes, and the whole-payload content digest. */
async function bindPayload(payload:string,manifestArg:string|undefined,receipt:JsonRecord){
 const exe=win32.join(payload,APP_FILE);
 const exeInfo=await lstat(exe,{bigint:true}).catch(()=>null);
 if(!exeInfo?.isFile()||exeInfo.isSymbolicLink())throw Error('The payload does not contain an ordinary '+APP_FILE+'.');
 const payloadRoot=await realpath(payload);
 if(!sameWindowsPath(win32.dirname(exe),payloadRoot))throw Error('The payload directory is redirected.');
 const manifestPath=manifestArg??join(payloadRoot,'..','build-manifest.json');
 const manifest=await readBuildManifest(manifestPath).catch(()=>{throw Error('A release build-manifest.json is required to bind the installer identity.');});
 const releaseDir=win32.dirname(await realpath(manifestPath));
 const children=await readdir(releaseDir);
 const setupName=children.find(name=>SETUP_PATTERN.test(name));
 if(!setupName)throw Error('No Gen-V1-Setup-<version>-win-x64.exe installer beside the manifest.');
 const packageVersion=SETUP_PATTERN.exec(setupName)![1]!;
 const setupPath=join(releaseDir,setupName),setupSha256=await hashFile(setupPath),setupBytes=Number((await lstat(setupPath)).size);
 const declared=manifest.files.find(entry=>entry.file.replaceAll('\\','/').endsWith('/'+setupName)||entry.file===setupName);
 if(!declared)throw Error('The build manifest does not declare the installer artifact.');
 if(declared.sha256!==setupSha256||declared.bytes!==setupBytes)throw Error('The installer differs from its build-manifest declaration.');
 const content=await packageContentManifest(payloadRoot);
 const exeSha256=await hashFile(exe),exeRelative=win32.basename(exe);
 const exeEntry=content.files.find(entry=>entry.path===exeRelative);
 if(!exeEntry||exeEntry.sha256!==exeSha256||exeEntry.bytes!==Number(exeInfo.size))throw Error('The executable is not part of the manifest-counted payload.');
 const invocationSha=await sourceSha(),dispatchSha=(process.env.GITHUB_SHA??process.env.HARNESS_SOURCE_SHA)??null;
 if(dispatchSha!==null&&!/^[0-9a-f]{40}$/.test(dispatchSha))throw Error('Dispatch source SHA is malformed.');
 if(invocationSha&&dispatchSha&&invocationSha!==dispatchSha)throw Error('Invocation worktree SHA differs from the dispatch SHA.');
 receipt.provenance={sourceSha:dispatchSha??invocationSha,sourceShaSource:dispatchSha?'dispatch-env':'invocation-worktree',packageVersion,installer:{file:setupName,bytes:setupBytes,sha256:setupSha256},manifestSha256:manifest.sha256,payload:{files:content.files.length,bytes:content.bytes,sha256:content.sha256},executable:{file:exeRelative,bytes:Number(exeInfo.size),sha256:exeSha256}};
 return {exe,packageVersion};
}

/** Every page action is issued only while ownership still holds: the debug
 * browser was proven against the exact executable and the owned child is live
 * and serving the owned-origin page. */
function ownerGuard(verified:()=>boolean,child:ChildProcess,page:{url():string},origin:string){
 if(!verified())throw Error('Refusing page action before the installed owner is verified.');
 if(child.exitCode!==null||child.signalCode!==null)throw Error('The owned installed process is no longer live.');
 try{if(new URL(page.url()).origin!==origin)throw Error('mismatch');}catch{throw Error('The page is no longer the owned origin.');}
}

async function main(){
 const {payload,directory,manifestArg}=readArguments(process.argv.slice(2));
 const started=Date.now();
 const receipt:JsonRecord={kind:'m16-installed-browser-control-proof',startedAt:new Date().toISOString(),phases:[] as JsonRecord[]};
 const phases=receipt.phases as JsonRecord[],mark=(phase:string,fields:JsonRecord={})=>{phases.push({phase,elapsedMs:Date.now()-started,...fields});};
 const {exe}=await bindPayload(payload,manifestArg,receipt);
 await createOwnedDirectory(directory);
 receipt.launch={dataDirectory:win32.basename(directory)};
 const ports=await verificationPorts(),nonce=randomUUID(),origin='http://127.0.0.1:'+ports[0],debugOrigin='http://127.0.0.1:'+ports[2];
 const [hostPort,widgetPort,debugPort]=ports;
 (receipt.launch as JsonRecord).nonce=nonce;(receipt.launch as JsonRecord).ports={host:hostPort,widget:widgetPort,debug:debugPort};
 const child=spawn(exe,['--remote-debugging-port='+debugPort,'--remote-debugging-address=127.0.0.1','--enable-automation','--harness-verification='+nonce],{cwd:win32.dirname(exe),env:{...installedVerificationEnvironment(directory,ports),[CONTROL_FLAG_ENV]:'true'},windowsHide:false,stdio:['ignore','pipe','pipe']});
 const processObservation=observeOwnedProcess(child,'verification',240000);
 const startup=observeInstalledStartup(child,1);
 let browser:Browser|undefined,verifiedOwner=false,launchError:Error|undefined;
 child.once('error',error=>{launchError=error;});
 try{
  await expect.poll(async()=>{if(launchError)throw launchError;if(child.exitCode!==null||child.signalCode!==null)throw Error('Installed application exited before readiness.');try{return (await fetch(debugOrigin+'/json/version',{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}},{timeout:45000,intervals:[100,250,500]}).toBe(true);
  mark('debug-port-ready',{pid:child.pid??null});
  browser=await chromium.connectOverCDP(debugOrigin);
  const verifyBrowserOwner=async()=>{verifiedOwner=false;const session=await browser!.newBrowserCDPSession();try{const {arguments:args}=await session.send('Browser.getBrowserCommandLine');assertWrapperArguments(args,nonce);if(!sameWindowsPath(args[0]??'',exe))throw Error('Debug browser is not the exact installed executable.');verifiedOwner=true;}finally{await session.detach();}};
  await verifyBrowserOwner();
  mark('owner-verified',{nonce});
  const readiness={iterations:[] as JsonRecord[]};
  const page=await waitForInstalledMainPage({child,origin,pages:()=>browser!.contexts().flatMap(context=>context.pages()),verifyOwner:verifyBrowserOwner,launchError:()=>launchError,observe:value=>{if(value.phase==='ready'||value.phase==='failed')readiness.iterations.push({status:value.phase,elapsedMs:value.elapsedMs,pages:value.pages,failure:value.failure});}});
  receipt.readiness=readiness.iterations;
  const guard=()=>ownerGuard(()=>verifiedOwner,child,page,origin);
  guard();
  const message=page.getByRole('textbox',{name:'Message',exact:true});
  await expect(message).toBeEnabled({timeout:30000});
  mark('harness-ready',{pid:child.pid??null});
  // Authenticate: exchange the per-boot launch secret exactly once.
  const csrfToken=await page.evaluate(async()=>{
   const token=new URLSearchParams(location.hash.slice(1)).get('launch');
   if(!token)throw Error('The installed page carries no launch secret.');
   const reply=await fetch('/api/bootstrap',{credentials:'same-origin',headers:{'x-harness-launch':token}});
   if(!reply.ok)throw Error('Bootstrap refused the launch token: '+reply.status);
   const body=await reply.json() as {csrfToken?:string};
   if(typeof body.csrfToken!=='string'||!body.csrfToken)throw Error('Bootstrap returned no CSRF token.');
   return body.csrfToken;
  });
  const call=async(path:string,init?:{method?:string;body?:unknown})=>{guard();return page.evaluate(async({path,init,csrf})=>{
   const reply=await fetch(path,{method:init?.method??'GET',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','x-harness-csrf':csrf},...(init?.body!==undefined?{body:JSON.stringify(init.body)}:{})});
   const body=await reply.json().catch(()=>null);
   return {status:reply.status,body};
  },{path,init,csrf:csrfToken});};
  const command=async(type:string,payload_:JsonRecord,threadId?:string)=>{
   const reply=await call('/api/commands',{method:'POST',body:{id:crypto.randomUUID(),type,payload:payload_,...(threadId?{threadId}:{})}});
   if(reply.status!==200)throw Error('Command '+type+' failed: '+JSON.stringify(reply.body).slice(0,400));
   return (reply.body as {result:unknown}).result;
  };
  const targets=async(threadId:string)=>((await call('/api/threads/'+encodeURIComponent(threadId)+'/control-targets?mode=CONSENTED_EXISTING_TAB')).body as {candidates?:{target:JsonRecord;title:string|null}[]}).candidates??[];
  // 1. Owned thread + owned browser surface.
  const thread=await command('thread.create',{title:'M16 installed browser control proof'}) as {id:string};
  mark('thread-created',{threadId:thread.id});
  const baseline=new Set((await targets(thread.id)).map(row=>String((row.target as {creationIdentity:string}).creationIdentity)));
  guard();
  await page.evaluate(async()=>{const desktop=(window as {harnessDesktop?:{browser(command:{type:string}):Promise<unknown>}}).harnessDesktop;if(!desktop)throw Error('Desktop bridge unavailable.');await desktop.browser({type:'open'});});
  // The docked browser only carries nonzero bounds once the renderer relays
  // layout; poll until exactly one new proven identity appears.
  let candidates:{target:JsonRecord;title:string|null}[]=[];
  await expect.poll(async()=>{candidates=(await targets(thread.id)).filter(row=>!baseline.has(String((row.target as {creationIdentity:string}).creationIdentity)));return candidates.length;},{timeout:CANDIDATE_TIMEOUT_MS,intervals:[250,500,1000]}).toBe(1);
  const selected=candidates[0]!;
  mark('browser-opened',{creationIdentity:(selected.target as {creationIdentity:string}).creationIdentity,title:selected.title});
  // 2. Explicit fixture consent — Observe only; Interact stays unrequested.
  const consentReply=await command('control.request',{mode:'CONSENTED_EXISTING_TAB',observe:true,operations:[]},thread.id) as {consent:{consentId:string;state:string};control:{state:string}};
  if(consentReply.consent.state!=='PENDING')throw Error('Consent request did not open pending: '+JSON.stringify(consentReply.consent).slice(0,300));
  mark('consent-requested',{consentId:consentReply.consent.consentId});
  const grantReply=await command('control.grant',{consentId:consentReply.consent.consentId,target:selected.target},thread.id) as {grant:{grantId:string;capturePermission:boolean;permittedOperations:string[];expiresAtMs:number;target:JsonRecord};control:{state:string}};
  if(grantReply.grant.capturePermission!==true||grantReply.grant.permittedOperations.length!==0||grantReply.control.state!=='active')throw Error('Grant did not bind Observe-only: '+JSON.stringify(grantReply).slice(0,400));
  mark('consent-granted',{grantId:grantReply.grant.grantId,capturePermission:grantReply.grant.capturePermission,permittedOperations:grantReply.grant.permittedOperations,expiresAtMs:grantReply.grant.expiresAtMs,target:grantReply.grant.target});
  // 3. Bounded selected-target capture — then validate the actual artifact
  // bytes under the owned host data root against the recorded digest.
  const captureReply=await call('/api/threads/'+encodeURIComponent(thread.id)+'/control-capture',{method:'POST',body:{}});
  if(captureReply.status!==200)throw Error('Capture failed: '+JSON.stringify(captureReply.body).slice(0,400));
  const capture=(captureReply.body as {capture:{artifactRef:string;sha256:string;artifactId:string;frameDimensions:{width:number;height:number};captureScope:{kind:string}}}).capture;
  if(!/^control-captures\/[A-Za-z0-9_-]+\/capture-[A-Za-z0-9-]+\.png$/.test(capture.artifactRef)||!/^[0-9a-f]{64}$/.test(capture.sha256)||capture.frameDimensions.width<=0||capture.frameDimensions.height<=0||capture.captureScope.kind!=='TAB')throw Error('Capture record is not a bounded tab artifact: '+JSON.stringify(capture).slice(0,400));
  const artifactPath=join(directory,'host',...capture.artifactRef.split('/'));
  const artifact=await readFile(artifactPath),artifactSha256=createHash('sha256').update(artifact).digest('hex');
  if(artifactSha256!==capture.sha256||artifact.byteLength===0||artifact.readUInt32BE(0)!==0x89504e47)throw Error('Capture artifact bytes do not match the recorded digest.');
  mark('capture-bound',{artifactRef:capture.artifactRef,sha256:capture.sha256,bytes:artifact.byteLength,width:capture.frameDimensions.width,height:capture.frameDimensions.height});
  // 4. Independent permissions: an unconsented input action must deny — a
  // consent-scope denial, distinct from in-flight input cancellation.
  const interactReply=await call('/api/threads/'+encodeURIComponent(thread.id)+'/control-action',{method:'POST',body:{action:'CLICK',parameters:{x:1,y:1}}});
  const interactCode=(interactReply.body as {error?:{code?:string}})?.error?.code;
  if(interactReply.status===200||interactCode!=='CAPABILITY_DENIED')throw Error('Unconsented interact was not denied: '+JSON.stringify(interactReply).slice(0,400));
  mark('interact-denied',{code:interactCode,scope:'consent-scope-denial'});
  // 5. Independent Stop: revoke, then capture must refuse.
  await command('control.stop',{},thread.id);
  const postStop=await call('/api/threads/'+encodeURIComponent(thread.id)+'/control-capture',{method:'POST',body:{}});
  const postStopCode=(postStop.body as {error?:{code?:string}})?.error?.code;
  if(postStop.status===200||postStopCode!=='CAPABILITY_DENIED')throw Error('Capture after Stop was not denied: '+JSON.stringify(postStop).slice(0,400));
  mark('stop-revoked',{captureAfterStopCode:postStopCode});
  // 6. Owned clean exit — close only while ownership still holds.
  guard();
  await page.evaluate(()=>window.close()).catch(error=>{if(!page.isClosed())throw error;});
  await waitForOwnedExit(child);
  assertInstalledCleanExit(child);
  await expect.poll(async()=>{try{return (await fetch(origin+'/health',{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}},{timeout:15000}).toBe(false);
  mark('clean-exit',{exitCode:child.exitCode,signalCode:child.signalCode});
  receipt.status='PASS';
 }finally{
  // The owned child is released first, bounded — receipt writing can never
  // strand the spawned process.
  if(child.exitCode===null&&child.signalCode===null)try{await bounded(terminateProcessTree(child),TERMINATE_BOUND_MS,'Owned process termination');}catch{receipt.terminationFailed=true;}
  await browser?.close().catch(()=>{});
  receipt.startupDiagnostics=startup.read();
  receipt.process=processObservation;
  receipt.ownerVerified=verifiedOwner;
  receipt.finishedAt=new Date().toISOString();
  receipt.status??='FAIL';
  // Exclusive receipt create — a preexisting verification.json fails loudly.
  await writeFile(join(directory,'verification.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600,flag:'wx'});
 }
}
void main().catch(error=>{console.error(String(error instanceof Error?error.message:error));process.exitCode=1;});
