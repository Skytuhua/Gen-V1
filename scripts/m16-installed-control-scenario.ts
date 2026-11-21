import {lstat,readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';

/** M16 C3/C4 installed browser-tab proof — scenario module.
 *
 * This module is NOT a launcher: the established installed-desktop verifier
 * (verify-installed-desktop.ts) owns install, provenance, launch, owner
 * verification, disposable profile creation and owned cleanup. It calls
 * runInstalledBrowserControlScenario on the already-verified installed page
 * inside the already-created disposable profile and merges the returned
 * receipt into its own verification.json.
 *
 * Provenance is consumed, never self-derived: the caller supplies the verified
 * matching-content/registry evidence (payload digest), the exact checkout/CI
 * build identity, the invoked installer digest and the launched executable
 * digest. A filename or invocation cwd is never accepted as proof.
 *
 * The consent/capture/Stop slice rides the production command surface
 * (POST /api/commands → service.command) from inside the verified-owned
 * renderer — the same transaction path the ControlConsentPanel uses. Every
 * renderer call is bounded. */
const CALL_BOUND_MS=30000;
const CANDIDATE_TIMEOUT_MS=30000;
const ARTIFACT_BOUND_BYTES=8*1024*1024;
type JsonRecord=Record<string,unknown>;

/** Renderer surface the scenario needs — the installed verifier's Playwright
 * Page satisfies this; tests inject a scripted fake. */
export interface ScenarioPage{url():string;evaluate(fn:(arg?:any)=>any,arg?:any):Promise<any>;}

/** Verified provenance supplied by the trusted installed lifecycle. */
export interface InstalledControlProvenance{
 sourceSha:string;          // exact checkout or CI build identity (40-hex)
 packageVersion:string;     // package version proven by the install lifecycle
 installerSha256:string;    // digest of the invoked installer
 executableSha256:string;   // digest of the actually launched executable
 payloadSha256:string;      // verified matching-content digest (install ≡ unpacked)
}

export interface InstalledControlScenarioInput{
 page:ScenarioPage;          // verified owned-origin page inside the disposable profile
 directory:string;           // owned disposable data profile (HARNESS_DESKTOP_TEST_DATA_DIR)
 origin:string;              // owned loopback host origin
 provenance:InstalledControlProvenance;
}

export function assertInstalledControlProvenance(value:InstalledControlProvenance){
 const sha=(field:string,v:unknown)=>{if(typeof v!=='string'||!/^[0-9a-f]{64}$/.test(v))throw Error('Installed-control provenance '+field+' is absent or not a SHA-256 digest.');};
 sha('installerSha256',value.installerSha256);sha('executableSha256',value.executableSha256);sha('payloadSha256',value.payloadSha256);
 if(typeof value.sourceSha!=='string'||!/^[0-9a-f]{40}$/.test(value.sourceSha))throw Error('Installed-control provenance sourceSha is absent or not a checkout SHA.');
 if(typeof value.packageVersion!=='string'||!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(value.packageVersion))throw Error('Installed-control provenance packageVersion is absent or malformed.');
}

async function bounded<T>(promise:Promise<T>,ms:number,label:string){let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([promise,new Promise<never>((_a,reject)=>{timer=setTimeout(()=>reject(Error(label+' exceeded '+ms+' ms.')),ms);})]);}finally{clearTimeout(timer);}}

function assertArtifactPng(bytes:Buffer,capture:{sha256:string;frameDimensions:{width:number;height:number}}){
 if(bytes.byteLength===0||bytes.byteLength>ARTIFACT_BOUND_BYTES)throw Error('Capture artifact size is outside the bounded window.');
 if(bytes.byteLength<33||bytes.readUInt32BE(0)!==0x89504e47||bytes.readUInt32BE(4)!==0x0d0a1a0a)throw Error('Capture artifact is not a PNG file.');
 if(createHash('sha256').update(bytes).digest('hex')!==capture.sha256)throw Error('Capture artifact digest differs from the stored record.');
 if(bytes.readUInt32BE(16)!==capture.frameDimensions.width||bytes.readUInt32BE(20)!==capture.frameDimensions.height)throw Error('Capture artifact dimensions differ from the stored record.');
}

/** Runs the M16 browser-tab consent/capture/Stop assertions on an already
 * verified installed page and returns a bounded receipt. The caller owns the
 * process lifecycle; this function never launches or closes anything. */
export async function runInstalledBrowserControlScenario(input:InstalledControlScenarioInput):Promise<JsonRecord>{
 const {page,directory,origin,provenance}=input;
 assertInstalledControlProvenance(provenance);
 const dirStat=await lstat(directory,{bigint:true}).catch(()=>null);
 if(!dirStat?.isDirectory()||dirStat.isSymbolicLink())throw Error('The disposable profile directory is absent or not ordinary.');
 let ownedOrigin:string;try{ownedOrigin=new URL(origin).origin;}catch{throw Error('The owned origin is malformed.');}
 const guard=()=>{try{if(new URL(page.url()).origin!==ownedOrigin)throw Error('mismatch');}catch{throw Error('The page is no longer the owned origin.');}};
 guard();
 const started=Date.now();
 const receipt:JsonRecord={kind:'m16-installed-browser-control-scenario',startedAt:new Date().toISOString(),provenance,phases:[] as JsonRecord[]};
 const phases=receipt.phases as JsonRecord[],mark=(phase:string,fields:JsonRecord={})=>{phases.push({phase,elapsedMs:Date.now()-started,...fields});};
 // Authenticate: exchange the per-boot launch secret exactly once.
 const csrfToken=await bounded(page.evaluate(async()=>{
  const token=new URLSearchParams(location.hash.slice(1)).get('launch');
  if(!token)throw Error('The installed page carries no launch secret.');
  const reply=await fetch('/api/bootstrap',{credentials:'same-origin',headers:{'x-harness-launch':token}});
  if(!reply.ok)throw Error('Bootstrap refused the launch token: '+reply.status);
  const body=await reply.json() as {csrfToken?:string};
  if(typeof body.csrfToken!=='string'||!body.csrfToken)throw Error('Bootstrap returned no CSRF token.');
  return body.csrfToken;
 }),CALL_BOUND_MS,'Bootstrap');
 mark('session-bound');
 const call=async(path:string,init?:{method?:string;body?:unknown})=>{guard();return bounded(page.evaluate(async({path,init,csrf})=>{
  const reply=await fetch(path,{method:init?.method??'GET',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','x-harness-csrf':csrf},...(init?.body!==undefined?{body:JSON.stringify(init.body)}:{})});
  const body=await reply.json().catch(()=>null);
  return {status:reply.status,body};
 },{path,init,csrf:csrfToken}),CALL_BOUND_MS,'Renderer call '+path);};
 const command=async(type:string,payload:JsonRecord,threadId?:string)=>{
  const reply=await call('/api/commands',{method:'POST',body:{id:randomUUID(),type,payload,...(threadId?{threadId}:{})}});
  if(reply.status!==200)throw Error('Command '+type+' failed: '+JSON.stringify(reply.body).slice(0,400));
  return (reply.body as {result:unknown}).result;
 };
 const targets=async(threadId:string)=>((await call('/api/threads/'+encodeURIComponent(threadId)+'/control-targets?mode=CONSENTED_EXISTING_TAB')).body as {candidates?:{target:JsonRecord;title:string|null}[]}).candidates??[];
 // 1. Owned thread + owned browser surface.
 const thread=await command('thread.create',{title:'M16 installed browser control proof'}) as {id:string};
 mark('thread-created',{threadId:thread.id});
 const baseline=new Set((await targets(thread.id)).map(row=>String((row.target as {creationIdentity:string}).creationIdentity)));
 guard();
 await bounded(page.evaluate(async()=>{const desktop=(window as {harnessDesktop?:{browser(command:{type:string}):Promise<unknown>}}).harnessDesktop;if(!desktop)throw Error('Desktop bridge unavailable.');await desktop.browser({type:'open'});}),CALL_BOUND_MS,'Browser open');
 // The docked browser only carries nonzero bounds once the renderer relays
 // layout; poll until exactly one new proven identity appears.
 let selected:{target:JsonRecord;title:string|null}|undefined;
 await bounded((async()=>{const deadline=Date.now()+CANDIDATE_TIMEOUT_MS;while(Date.now()<deadline){const rows=(await targets(thread.id)).filter(row=>!baseline.has(String((row.target as {creationIdentity:string}).creationIdentity)));if(rows.length===1){selected=rows[0];return;}if(rows.length>1)throw Error('Ambiguous new browser candidates.');await new Promise(done=>setTimeout(done,500));}throw Error('No new browser candidate appeared.');})(),CANDIDATE_TIMEOUT_MS+5000,'Candidate enumeration');
 mark('browser-opened',{creationIdentity:(selected!.target as {creationIdentity:string}).creationIdentity,title:selected!.title});
 // 2. Explicit fixture consent — Observe only; Interact stays unrequested.
 const consentReply=await command('control.request',{mode:'CONSENTED_EXISTING_TAB',observe:true,operations:[]},thread.id) as {consent:{consentId:string;state:string};control:{state:string}};
 if(consentReply.consent.state!=='PENDING')throw Error('Consent request did not open pending: '+JSON.stringify(consentReply.consent).slice(0,300));
 mark('consent-requested',{consentId:consentReply.consent.consentId});
 const grantReply=await command('control.grant',{consentId:consentReply.consent.consentId,target:selected!.target},thread.id) as {grant:{grantId:string;capturePermission:boolean;permittedOperations:string[];expiresAtMs:number;target:JsonRecord};control:{state:string}};
 if(grantReply.grant.capturePermission!==true||grantReply.grant.permittedOperations.length!==0||grantReply.control.state!=='active')throw Error('Grant did not bind Observe-only: '+JSON.stringify(grantReply).slice(0,400));
 // The recorded grant target identity must be the selected fixture identity —
 // authoritative, never recomputed from a title or index.
 if(JSON.stringify(grantReply.grant.target)!==JSON.stringify(selected!.target))throw Error('Recorded grant target differs from the selected fixture identity.');
 mark('consent-granted',{grantId:grantReply.grant.grantId,capturePermission:grantReply.grant.capturePermission,permittedOperations:grantReply.grant.permittedOperations,expiresAtMs:grantReply.grant.expiresAtMs,target:grantReply.grant.target});
 // 3. Bounded selected-target capture — then validate the actual artifact
 // bytes under the owned host data root against the stored record.
 const captureReply=await call('/api/threads/'+encodeURIComponent(thread.id)+'/control-capture',{method:'POST',body:{}});
 if(captureReply.status!==200)throw Error('Capture failed: '+JSON.stringify(captureReply.body).slice(0,400));
 const capture=(captureReply.body as {capture:{artifactRef:string;sha256:string;artifactId:string;frameDimensions:{width:number;height:number};captureScope:{kind:string}}}).capture;
 if(!/^control-captures\/[A-Za-z0-9_-]+\/capture-[A-Za-z0-9-]+\.png$/.test(capture.artifactRef)||!/^[0-9a-f]{64}$/.test(capture.sha256)||capture.frameDimensions.width<=0||capture.frameDimensions.height<=0||capture.captureScope.kind!=='TAB')throw Error('Capture record is not a bounded tab artifact: '+JSON.stringify(capture).slice(0,400));
 const artifactPath=join(directory,'host',...capture.artifactRef.split('/'));
 const artifact=await readFile(artifactPath).catch(()=>{throw Error('Capture artifact is absent under the owned host root.');});
 assertArtifactPng(artifact,capture);
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
 receipt.status='PASS';
 receipt.finishedAt=new Date().toISOString();
 return receipt;
}
