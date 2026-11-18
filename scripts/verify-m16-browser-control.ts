import {chromium,expect,type Browser} from '@playwright/test';
import {spawn,type ChildProcess} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {lstat,mkdir,readFile,realpath,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {isAbsolute,join,win32} from 'node:path';
import {terminateProcessTree} from '../packages/runtime-pi/process-tree.ts';
import {verificationPorts,assertWrapperArguments} from './portable-verification.ts';
import {assertInstalledCleanExit,installedVerificationEnvironment,observeInstalledStartup,observeOwnedProcess,waitForInstalledMainPage} from './verify-installed-desktop.ts';

/** M16 C3/C4 installed browser-tab proof — LOCAL-ONLY owned verification.
 * Usage: pnpm exec tsx scripts/verify-m16-browser-control.ts <absolute "Gen V1.exe"> <absolute owned evidence directory>
 *
 * Reuses the installed launch specification from verify-installed-desktop.ts:
 * owned ephemeral ports, owned data directory, per-launch verification nonce,
 * CDP owner revalidation against the exact executable, and clean-exit proof.
 * The consent/capture/Stop slice rides the production command surface
 * (POST /api/commands → service.command) from inside the renderer — the same
 * transaction path the ControlConsentPanel uses, with a real pending-consent
 * lifecycle. Flags stay off everywhere except this owned process environment. */
const CONTROL_FLAG_ENV='HARNESS_FLAG_CONTROL_CONSENTED_BROWSER_V1';
const CANDIDATE_TIMEOUT_MS=30000;
type JsonRecord=Record<string,unknown>;

function sameWindowsPath(left:string,right:string){return win32.normalize(left).replace(/[\\/]+$/,'').toLowerCase()===win32.normalize(right).replace(/[\\/]+$/,'').toLowerCase();}
async function hashFile(path:string){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
async function waitForOwnedExit(child:ChildProcess,timeoutMs=15000){
 if(child.exitCode!==null||child.signalCode!==null)return;
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{await Promise.race([new Promise<void>(done=>child.once('close',()=>done())),new Promise<never>((_done,reject)=>{timer=setTimeout(()=>reject(Error('Installed application did not exit after closing its last window.')),timeoutMs);})]);}finally{clearTimeout(timer);}
}
async function ownedDirectory(directory:string){
 if(!isAbsolute(directory))throw Error('Evidence directory must be an absolute owned path.');
 try{const parent=await lstat(directory,{bigint:true});if(!parent.isDirectory()||parent.isSymbolicLink()||await realpath(directory)!==directory)throw Error();}
 catch{await mkdir(directory,{recursive:true});const created=await lstat(directory,{bigint:true});if(!created.isDirectory()||created.isSymbolicLink()||await realpath(directory)!==directory)throw Error('Evidence directory is not an ordinary canonical directory.');}
}
function readArguments(args:string[]){
 const [exe,directory]=args;
 if(!exe||args.length!==2||!win32.isAbsolute(exe)&&!isAbsolute(exe))throw Error('Usage: verify-m16-browser-control <absolute "Gen V1.exe"> <absolute owned evidence directory>');
 return {exe,directory:directory!};
}
async function expectedVersion():Promise<{version:string|null;manifestSha256:string|null}>{
 try{const manifest=join(process.cwd(),'package.json');const parsed=JSON.parse(await readFile(manifest,'utf8')) as {version?:unknown};return {version:typeof parsed.version==='string'?parsed.version:null,manifestSha256:null};}
 catch{return {version:null,manifestSha256:null};}
}

/** Every renderer call below is the same authenticated fetch the app issues —
 * the per-boot launch secret is read from the page URL fragment, exchanged
 * once for the session cookie, and the CSRF token heads every command. */
async function main(){
 const {exe,directory}=readArguments(process.argv.slice(2));
 const exeInfo=await lstat(exe,{bigint:true});
 if(!exeInfo.isFile()||exeInfo.isSymbolicLink())throw Error('The named executable is not an ordinary file.');
 await ownedDirectory(directory);
 const ports=await verificationPorts(),nonce=randomUUID(),origin='http://127.0.0.1:'+ports[0],debugOrigin='http://127.0.0.1:'+ports[2];
 const [hostPort,widgetPort,debugPort]=ports;
 const started=Date.now();
 const receipt:JsonRecord={kind:'m16-installed-browser-control-proof',startedAt:new Date().toISOString(),executable:{path:win32.basename(exe),sha256:await hashFile(exe),bytes:Number(exeInfo.size),expectedVersion:(await expectedVersion()).version},launch:{nonce,ports:{host:hostPort,widget:widgetPort,debug:debugPort},dataDirectory:win32.basename(directory)},phases:[] as JsonRecord[]};
 const phases=receipt.phases as JsonRecord[],mark=(phase:string,fields:JsonRecord={})=>{phases.push({phase,elapsedMs:Date.now()-started,...fields});};
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
  const call=async(path:string,init?:{method?:string;body?:unknown})=>page.evaluate(async({path,init,csrf})=>{
   const reply=await fetch(path,{method:init?.method??'GET',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','x-harness-csrf':csrf},...(init?.body!==undefined?{body:JSON.stringify(init.body)}:{})});
   const body=await reply.json().catch(()=>null);
   return {status:reply.status,body};
  },{path,init,csrf:csrfToken});
  const command=async(type:string,payload:JsonRecord,threadId?:string)=>{
   const reply=await call('/api/commands',{method:'POST',body:{id:crypto.randomUUID(),type,payload,...(threadId?{threadId}:{})}});
   if(reply.status!==200)throw Error('Command '+type+' failed: '+JSON.stringify(reply.body).slice(0,400));
   return (reply.body as {result:unknown}).result;
  };
  const targets=async(threadId:string)=>((await call('/api/threads/'+encodeURIComponent(threadId)+'/control-targets?mode=CONSENTED_EXISTING_TAB')).body as {candidates?:{target:{creationIdentity:string};title:string|null}[]}).candidates??[];
  // 1. Owned thread + owned browser surface.
  const thread=await command('thread.create',{title:'M16 installed browser control proof'}) as {id:string};
  mark('thread-created',{threadId:thread.id});
  const baseline=new Set((await targets(thread.id)).map(row=>String(row.target.creationIdentity)));
  await page.evaluate(async()=>{const desktop=(window as {harnessDesktop?:{browser(command:{type:string}):Promise<unknown>}}).harnessDesktop;if(!desktop)throw Error('Desktop bridge unavailable.');await desktop.browser({type:'open'});});
  // The docked browser only carries nonzero bounds once the renderer relays
  // layout; poll until exactly one new proven identity appears.
  let candidates:{target:{creationIdentity:string};title:string|null}[]=[];
  await expect.poll(async()=>{candidates=(await targets(thread.id)).filter(row=>!baseline.has(String(row.target.creationIdentity)));return candidates.length;},{timeout:CANDIDATE_TIMEOUT_MS,intervals:[250,500,1000]}).toBe(1);
  const selected=candidates[0]!;
  mark('browser-opened',{creationIdentity:selected.target.creationIdentity,title:selected.title});
  // 2. Explicit fixture consent — Observe only; Interact stays unrequested.
  const consentReply=await command('control.request',{mode:'CONSENTED_EXISTING_TAB',observe:true,operations:[]},thread.id) as {consent:{consentId:string;state:string};control:{state:string}};
  if(consentReply.consent.state!=='PENDING')throw Error('Consent request did not open pending: '+JSON.stringify(consentReply.consent).slice(0,300));
  mark('consent-requested',{consentId:consentReply.consent.consentId});
  const grantReply=await command('control.grant',{consentId:consentReply.consent.consentId,target:selected.target},thread.id) as {grant:{grantId:string;capturePermission:boolean;permittedOperations:string[];expiresAtMs:number};control:{state:string}};
  if(grantReply.grant.capturePermission!==true||grantReply.grant.permittedOperations.length!==0||grantReply.control.state!=='active')throw Error('Grant did not bind Observe-only: '+JSON.stringify(grantReply).slice(0,400));
  mark('consent-granted',{grantId:grantReply.grant.grantId,capturePermission:grantReply.grant.capturePermission,permittedOperations:grantReply.grant.permittedOperations,expiresAtMs:grantReply.grant.expiresAtMs});
  // 3. Bounded selected-target capture.
  const captureReply=await call('/api/threads/'+encodeURIComponent(thread.id)+'/control-capture',{method:'POST',body:{}});
  if(captureReply.status!==200)throw Error('Capture failed: '+JSON.stringify(captureReply.body).slice(0,400));
  const capture=(captureReply.body as {capture:{artifactRef:string;sha256:string;artifactId:string;frameDimensions:{width:number;height:number};captureScope:{kind:string}}}).capture;
  if(!/^control-captures\//.test(capture.artifactRef)||!/^[0-9a-f]{64}$/.test(capture.sha256)||capture.frameDimensions.width<=0||capture.frameDimensions.height<=0||capture.captureScope.kind!=='TAB')throw Error('Capture record is not a bounded tab artifact: '+JSON.stringify(capture).slice(0,400));
  mark('capture-bound',{artifactRef:capture.artifactRef,sha256:capture.sha256,width:capture.frameDimensions.width,height:capture.frameDimensions.height});
  // 4. Independent permissions: an unconsented input action must deny.
  const interactReply=await call('/api/threads/'+encodeURIComponent(thread.id)+'/control-action',{method:'POST',body:{action:'CLICK',parameters:{x:1,y:1}}});
  const interactCode=(interactReply.body as {error?:{code?:string}})?.error?.code;
  if(interactReply.status===200||interactCode!=='CAPABILITY_DENIED')throw Error('Unconsented interact was not denied: '+JSON.stringify(interactReply).slice(0,400));
  mark('interact-denied',{code:interactCode});
  // 5. Independent Stop: revoke, then capture must refuse.
  await command('control.stop',{},thread.id);
  const postStop=await call('/api/threads/'+encodeURIComponent(thread.id)+'/control-capture',{method:'POST',body:{}});
  const postStopCode=(postStop.body as {error?:{code?:string}})?.error?.code;
  if(postStop.status===200||postStopCode!=='CAPABILITY_DENIED')throw Error('Capture after Stop was not denied: '+JSON.stringify(postStop).slice(0,400));
  mark('stop-revoked',{captureAfterStopCode:postStopCode});
  // 6. Owned clean exit.
  await page.evaluate(()=>window.close()).catch(error=>{if(!page.isClosed())throw error;});
  await waitForOwnedExit(child);
  assertInstalledCleanExit(child);
  await expect.poll(async()=>{try{return (await fetch(origin+'/health',{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}},{timeout:15000}).toBe(false);
  mark('clean-exit',{exitCode:child.exitCode,signalCode:child.signalCode});
  receipt.status='PASS';
 }finally{
  receipt.startupDiagnostics=startup.read();
  receipt.process=processObservation;
  receipt.ownerVerified=verifiedOwner;
  receipt.finishedAt=new Date().toISOString();
  receipt.status??='FAIL';
  await writeFile(join(directory,'verification.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
  await browser?.close().catch(()=>{});
  if(child.exitCode===null&&child.signalCode===null)await terminateProcessTree(child);
 }
}
void main().catch(error=>{console.error(String(error instanceof Error?error.message:error));process.exitCode=1;});
