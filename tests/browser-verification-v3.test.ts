import {it,expect,afterEach,vi} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync,lstatSync} from 'node:fs';
import {crc32,deflateSync} from 'node:zlib';
import {VerificationArtifactStore,attestVerificationArtifacts} from '../packages/core/verification-artifacts';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../packages/storage/store';
import {runBrowserChecklist,type BrowserDriver,type BrowserSession,type BrowserPage} from '../packages/core/browser-verification';
import {browserChecklistSchema,type BrowserChecklistV1,type BrowserStep} from '../packages/contracts/verification';
import {computeAssessment} from '../packages/core/verification-gate';
import {sourceDigestSync} from '../packages/core/project-verification';
import type {ToolOwner} from '../packages/contracts/tool-effects';
import {hostFlagEnabled} from '../packages/core/host-flags';
import {HarnessError} from '../packages/contracts/index';
const codeAsync=async(p:Promise<unknown>):Promise<string>=>{try{await p;}catch(e){return (e as HarnessError).code;}return 'NO_THROW';};


const stores:Store[]=[];
function stateStore(){const store=new Store(join(tempDir('verify-state-'),'state'));stores.push(store);const stamp=new Date().toISOString();store.internal('test.owner','t1',()=>store.put('thread','t1','t1',{id:'t1',title:'Verification',projectName:null,createdAt:stamp,updatedAt:stamp,status:'working',epoch:1,runId:'r1',modelId:null,sessionPath:null}));return store;}
const dirs:string[]=[];
function tempDir(prefix:string){const dir=mkdtempSync(join(tmpdir(),prefix));dirs.push(dir);return dir;}
afterEach(()=>{vi.useRealTimers();for(const store of stores.splice(0))store.close();for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
const FLAGS_ON={HARNESS_FLAG_VERIFICATION_WORKFLOW_V1:'1'};
const owner:ToolOwner={threadId:'t1',runId:'r1',epoch:1,projectId:null,workspaceId:null,accountBinding:null};

interface FakeDriver extends BrowserDriver {profileDir:string|undefined;launched:number;page:FakePage;allow:((origin:string)=>boolean)|undefined}
interface FakePage extends BrowserPage {visits:string[];clicks:string[];typed:[string,string][];screens:Buffer}
// `requests` models subresource/popup traffic the page attempts after goto:
// a compliant driver consults allowOrigin before each request; denied traffic
// is blocked at the boundary and never reaches observedOrigins.
function fakeDriver(over:{url?:string;texts?:Record<string,string>;visible?:Record<string,boolean>;failures?:{console?:string[];network?:string[]};origins?:string[];shotBytes?:number;requests?:string[];cancelOnText?:boolean}={}):FakeDriver{
 const chunk=(name:string,data:Buffer)=>{const bytes=Buffer.alloc(data.length+12);bytes.writeUInt32BE(data.length);bytes.write(name,4);data.copy(bytes,8);bytes.writeUInt32BE(crc32(bytes.subarray(4,-4)),bytes.length-4);return bytes;};
 const header=Buffer.alloc(13);header.writeUInt32BE(1280);header.writeUInt32BE(800,4);header[8]=8;header[9]=6;
 const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc((1280*4+1)*800))),chunk('IEND',Buffer.alloc(0))]);
 const state={url:over.url??'http://127.0.0.1:4100/',screens:over.shotBytes?Buffer.alloc(over.shotBytes,7):png,origins:over.origins??['http://127.0.0.1:4100'],blocked:[] as string[]};
 const driver:FakeDriver={profileDir:undefined,launched:0,page:undefined as unknown as FakePage,allow:undefined,launch:async opts=>{driver.profileDir=opts.profileDir;driver.launched++;driver.allow=opts.allowOrigin;return session;}};
 const page:FakePage={
  url:()=>state.url,visits:[],clicks:[],typed:[],screens:state.screens,
  goto:async url=>{
   if(driver.allow&&driver.allow(new URL(url).origin)===false)throw new Error('navigation denied by host policy');
   page.visits.push(url);state.url=url;
   for(const origin of over.requests??[]){
    if(driver.allow&&driver.allow(origin)===false){state.blocked.push(origin);continue;}
    if(!state.origins.includes(origin))state.origins.push(origin);
   }
  },
  click:async s=>{page.clicks.push(s);},
  type:async(s,t)=>{page.typed.push([s,t]);},
  text:async s=>{if(over.cancelOnText)throw new HarnessError('CANCELLED_RUN','run cancelled');return over.texts?.[s]??null;},
  visible:async s=>over.visible?.[s]??false,
  screenshot:async()=>state.screens,
 };
 const session:BrowserSession={page,collectedFailures:()=>({console:over.failures?.console??[],network:over.failures?.network??[]}),observedOrigins:()=>state.origins,close:async()=>{}};
 driver.page=page;
 return driver;
}
function checklist(steps:BrowserStep[],over:Record<string,unknown>={}):BrowserChecklistV1{
 return browserChecklistSchema.parse({version:1,checklistId:'cl-1',approvedOrigins:['http://127.0.0.1:4100'],viewport:{width:1280,height:800},steps,items:['item-1','item-2'],...over});
}
const digests={codeDigest:'a'.repeat(64),dependencyDigest:'b'.repeat(64),recipeDigest:'c'.repeat(64),environmentId:'win32/test'};
const run=(store:Store,steps:BrowserStep[],driver:BrowserDriver,over:Record<string,unknown>={})=>runBrowserChecklist(store,{owner,checklist:checklist(steps),profileDir:join(tempDir('verify-profile-'),'profile'),driver,digests,...over}as Parameters<typeof runBrowserChecklist>[1],FLAGS_ON);

it('the browser workflow stays disabled until the host flag enables it',async()=>{
 const store=stateStore();
 expect(await codeAsync(runBrowserChecklist(store,{owner,checklist:checklist([{kind:'NAVIGATE',url:'http://127.0.0.1:4100/'}]),profileDir:tempDir('verify-profile-'),driver:fakeDriver(),digests},{}))).toBe('CAPABILITY_DENIED');
 expect(hostFlagEnabled('verification.workflowV1',{})).toBe(false);
});

it('a passing checklist navigates, asserts and captures bound visual observations',async()=>{
 const store=stateStore();
 const driver=fakeDriver({texts:{'h1':'Welcome home'},visible:{'nav':true}});
 const result=await run(store,[
  {kind:'NAVIGATE',url:'http://127.0.0.1:4100/'},
  {kind:'ASSERT_TEXT',selector:'h1',text:'Welcome home',checklistItemId:'item-1'},
  {kind:'ASSERT_VISIBLE',selector:'nav',checklistItemId:'item-1'},
  {kind:'ASSERT_VISIBLE',selector:'nav',checklistItemId:'item-2'},
  {kind:'SCREENSHOT',checklistItemId:'item-2',required:true},
 ],driver);
 expect(result.outcome).toBe('PASS');
 const textObs=result.observations.find(obs=>obs.assertion.includes('Welcome home'))!;
 expect(textObs.outcome).toBe('PASS');expect(textObs.origin).toBe('http://127.0.0.1:4100/');expect(textObs.viewport).toEqual({width:1280,height:800});
 const shot=result.observations.find(obs=>obs.screenshotDigest)!;
 expect(shot.screenshotDigest).toMatch(/^[a-f0-9]{64}$/);
 expect(shot.artifactRefs.length).toBe(1);expect(shot.artifactRefs[0]).toMatch(/^verification-artifact:/);
 expect(new VerificationArtifactStore(store).read(shot.artifactRefs[0],owner,shot.executionId).bytes.equals(driver.page.screens)).toBe(true);
 // The driver ran a fresh profile in its separately owned private scope, never an inherited one.
 expect(driver.profileDir).toContain('profile');
});

it('navigation or traffic outside the approved origins fails closed',async()=>{
 const store=stateStore();
 const denied=await run(store,[{kind:'NAVIGATE',url:'https://attacker.example/'}],fakeDriver());
 expect(denied.outcome).toBe('FAIL');expect(denied.deniedOrigins).toContain('https://attacker.example/');
 const obs=denied.observations.find(o=>o.checklistItemId==='__origin__')!;expect(obs.outcome).toBe('FAIL');
 // Popup/resource traffic to a foreign origin is also denied even when steps pass.
 const sneaky=fakeDriver({texts:{'h1':'Welcome home'},origins:['http://127.0.0.1:4100','https://cdn.evil.example']});
 const traffic=await run(store,[
  {kind:'NAVIGATE',url:'http://127.0.0.1:4100/'},
  {kind:'ASSERT_TEXT',selector:'h1',text:'Welcome home',checklistItemId:'item-1'},
  {kind:'SCREENSHOT',checklistItemId:'item-2',required:true},
 ],sneaky);
 expect(traffic.outcome).toBe('FAIL');expect(traffic.deniedOrigins).toContain('https://cdn.evil.example');
});

it.each(['/dashboard-disabled','/dashboard?admin=1','/dashboard#unexpected'])('ASSERT_URL rejects a different URL sharing the expected prefix: %s',async path=>{
 const result=await run(stateStore(),[
  {kind:'ASSERT_URL',url:'http://127.0.0.1:4100/dashboard',checklistItemId:'item-1'},
  {kind:'ASSERT_VISIBLE',selector:'nav',checklistItemId:'item-2'},
 ],fakeDriver({url:`http://127.0.0.1:4100${path}`,visible:{nav:true}}));
 expect(result.outcome).toBe('FAIL');
 expect(result.observations.find(obs=>obs.checklistItemId==='item-1')?.outcome).toBe('FAIL');
});

it('ASSERT_URL accepts the same normalized URL',async()=>{
 const result=await run(stateStore(),[
  {kind:'ASSERT_URL',url:'http://127.0.0.1:4100',checklistItemId:'item-1'},
  {kind:'ASSERT_VISIBLE',selector:'nav',checklistItemId:'item-2'},
 ],fakeDriver({url:'http://127.0.0.1:4100/',visible:{nav:true}}));
 expect(result.outcome).toBe('PASS');
});

it('a failed assertion stops the run and unobserved items are blocked, never green',async()=>{
 const store=stateStore();
 const driver=fakeDriver({texts:{'h1':'Other text'},visible:{}});
 const result=await run(store,[
  {kind:'NAVIGATE',url:'http://127.0.0.1:4100/'},
  {kind:'ASSERT_TEXT',selector:'h1',text:'Welcome home',checklistItemId:'item-1'},
  {kind:'SCREENSHOT',checklistItemId:'item-2',required:true},
 ],driver);
 expect(result.outcome).toBe('FAIL');
 const failed=result.observations.find(obs=>obs.checklistItemId==='item-1')!;
 expect(failed.outcome).toBe('FAIL');expect(failed.observed).toContain('Other text');
 // item-2's required screenshot never ran: the item is BLOCKED, not silently PASS.
 const missing=result.observations.find(obs=>obs.checklistItemId==='item-2')!;
 expect(missing.outcome).toBe('BLOCKED');expect(missing.screenshotDigest).toBeNull();
});

it('a schema-valid record or image alone never produces PASS',async()=>{
 const store=stateStore();
 // A checklist that only screenshots without asserting behavior cannot verify a behavior item.
 const result=await run(store,[
  {kind:'NAVIGATE',url:'http://127.0.0.1:4100/'},
  {kind:'SCREENSHOT',checklistItemId:'item-1',required:true},
 ],fakeDriver());
 expect(result.outcome).toBe('BLOCKED');
 // The screenshot did run and captured evidence, yet item-1 stays BLOCKED:
 // a capture alone is not a verification.
 expect(result.observations.find(obs=>obs.checklistItemId==='item-1'&&obs.assertion.includes('executed assertion'))?.outcome).toBe('BLOCKED');
 expect(result.observations.find(obs=>obs.checklistItemId==='item-2')?.outcome).toBe('BLOCKED');
 // A caller cannot turn the capture into success by binding its check ID
 // while omitting the runner's blocked behavioral evidence.
 const captured=result.observations.find(obs=>obs.screenshotDigest)!;
 const assessment=computeAssessment({
  threadId:'t1',sourceCut:{headSha:null,codeDigest:digests.codeDigest,dependencyDigest:digests.dependencyDigest,environmentId:digests.environmentId},
  requirements:[{id:'page-works',checkRefs:[captured.checkId]}],observations:result.observations,
  unresolvedEffects:[],verifierIdentity:'test',provenance:'test',
 });
 expect(assessment.label).toBe('BLOCKED');
});

it('an asserted item still needs its required screenshot',async()=>{
 const store=stateStore();
 // item-2 is asserted, then its required screenshot fails at capture —
 // the assertion does not rescue the missing visual evidence.
 const driver=fakeDriver({texts:{'h1':'Welcome home'},shotBytes:70*1024*1024});
 const result=await run(store,[
  {kind:'NAVIGATE',url:'http://127.0.0.1:4100/'},
  {kind:'ASSERT_TEXT',selector:'h1',text:'Welcome home',checklistItemId:'item-1'},
  {kind:'ASSERT_TEXT',selector:'h1',text:'Welcome home',checklistItemId:'item-2'},
  {kind:'SCREENSHOT',checklistItemId:'item-2',required:true},
 ],driver);
 expect(result.outcome).toBe('BLOCKED');
 expect(result.observations.find(obs=>obs.checklistItemId==='item-2'&&obs.assertion.includes('needs a screenshot'))?.outcome).toBe('BLOCKED');
});

it('screenshot evidence cannot verify before host artifact custody exists',async()=>{
 const store=stateStore();
 const result=await run(store,[
  {kind:'ASSERT_TEXT',selector:'h1',text:'Welcome home',checklistItemId:'item-1'},
  {kind:'ASSERT_TEXT',selector:'h1',text:'Welcome home',checklistItemId:'item-2'},
  {kind:'SCREENSHOT',checklistItemId:'item-2',required:true},
 ],fakeDriver({texts:{h1:'Welcome home'}}));
 expect(result.outcome).toBe('PASS');
 const assess=(checkId:string)=>computeAssessment({
  threadId:'t1',sourceCut:{headSha:null,codeDigest:digests.codeDigest,dependencyDigest:digests.dependencyDigest,environmentId:digests.environmentId},
  requirements:[{id:'page-works',checkRefs:[checkId]}],observations:result.observations,
  unresolvedEffects:[],verifierIdentity:'test',provenance:'test',
 });
 const capture=result.observations.find(obs=>obs.screenshotDigest)!;
 const behavior=result.observations.find(obs=>obs.checklistItemId==='item-2'&&!obs.screenshotDigest)!;
 expect(assess(behavior.checkId).label).toBe('BLOCKED');
 expect(assess(capture.checkId).label).toBe('BLOCKED');
 expect(assess(behavior.checkId).requirements[0].missing).toContain('screenshot custody is unavailable for page-works ('+behavior.checkId+')');
 expect(result.observations.every(obs=>obs.outcome==='PASS')).toBe(true);
});

it('executed browser assertions without screenshots remain verifiable',async()=>{
 const result=await run(stateStore(),[
  {kind:'ASSERT_TEXT',selector:'h1',text:'Welcome home',checklistItemId:'item-1'},
  {kind:'ASSERT_TEXT',selector:'h1',text:'Welcome home',checklistItemId:'item-2'},
 ],fakeDriver({texts:{h1:'Welcome home'}}));
 const assessment=computeAssessment({
  threadId:'t1',sourceCut:{headSha:null,codeDigest:digests.codeDigest,dependencyDigest:digests.dependencyDigest,environmentId:digests.environmentId},
  requirements:[{id:'page-works',checkRefs:[result.observations[0].checkId]}],observations:result.observations,
  unresolvedEffects:[],verifierIdentity:'test',provenance:'test',
 });
 expect(assessment.label).toBe('VERIFIED');
});

it.each(['deleted','replaced'] as const)('a %s required screenshot cannot verify through the gate, task_finish or panel',async mutation=>{
 const {Service}=await import('../packages/core/service');
 const {verificationPanelModel}=await import('../packages/core/verification-read-models');
 const store=stateStore(),root=tempDir('verify-source-'),stamp=new Date().toISOString(),boundOwner={...owner,projectId:'p1'};
 writeFileSync(join(root,'app.ts'),'export const ready=true;\n');
 const identity=lstatSync(root,{bigint:true});
 const current={...digests,codeDigest:sourceDigestSync(root,['app.ts']),dependencyDigest:sourceDigestSync(root,[])};
 store.internal('test.project','t1',()=>{
  store.put('thread','t1','t1',{id:'t1',title:'Verification',projectName:'Project',projectId:'p1',workspaceId:null,accountId:null,kind:'main',mode:'build',status:'working',createdAt:stamp,updatedAt:stamp,modelId:'test/model',sessionPath:null,runId:'r1',epoch:1});
  store.put('workspaceProject','p1',null,{id:'p1',name:'Project',rootPath:root,authority:{kind:'local'},createdAt:stamp});
  store.put('workspaceProjectRoot','p1',null,{path:root,identity:{dev:String(identity.dev),ino:String(identity.ino)}});
 });
 const result=await run(store,[
  {kind:'ASSERT_TEXT',selector:'h1',text:'Welcome home',checklistItemId:'item-1'},
  {kind:'ASSERT_TEXT',selector:'h1',text:'Welcome home',checklistItemId:'item-2'},
  {kind:'SCREENSHOT',checklistItemId:'item-2',required:true},
 ],fakeDriver({texts:{h1:'Welcome home'}}),{owner:boundOwner,digests:current});
 const captured=result.observations.find(obs=>obs.screenshotDigest)!,behavior=result.observations.find(obs=>obs.checklistItemId==='item-2'&&!obs.screenshotDigest)!;
 const recorded=store.all('visualObservation','t1');
 expect(result.outcome).toBe('PASS');
 const requirements=[{id:'page-works',checkRefs:[behavior.checkId]}];
 const currentAssessment=()=>computeAssessment({threadId:'t1',sourceCut:{headSha:null,codeDigest:current.codeDigest,dependencyDigest:current.dependencyDigest,environmentId:current.environmentId},requirements,observations:result.observations,artifactAttestations:attestVerificationArtifacts(store,result.observations,requirements),unresolvedEffects:[],verifierIdentity:'test',provenance:'synthetic browser core test'});
 expect(currentAssessment().label).toBe('VERIFIED');
 const artifactPath=join(store.dataDir,'artifacts','verification-v1',captured.artifactRefs[0].slice('verification-artifact:'.length)+'.bin');
 if(mutation==='deleted')rmSync(artifactPath);
 else writeFileSync(artifactPath,'replacement bytes');
 store.internal('test.declaration','t1',()=>store.put('verificationDeclaration','t1','t1',{version:1,rootPath:root,sourceFiles:['app.ts'],dependencyFiles:[],environmentId:current.environmentId,requirements}));
 const assessment=currentAssessment();
 const runtime={configure:()=>{},models:async()=>[],start:async()=>{},followUp:async()=>{},cancel:async()=>{},compact:async()=>{},history:async()=>[],dispose:async()=>{}};
 const service=new Service(store,runtime as never,{}),saved=process.env.HARNESS_FLAG_VERIFICATION_WORKFLOW_V1;
 process.env.HARNESS_FLAG_VERIFICATION_WORKFLOW_V1='1';
 try{await service.tool({name:'task_finish',args:{commandId:'finish-'+mutation,outcome:'done'}},{threadId:'t1',runId:'r1',epoch:1});}
 finally{await service.dispose();if(saved===undefined)delete process.env.HARNESS_FLAG_VERIFICATION_WORKFLOW_V1;else process.env.HARNESS_FLAG_VERIFICATION_WORKFLOW_V1=saved;}
 expect(assessment.label).toBe('BLOCKED');
 expect(store.all<{label:string}>('assessment','t1').at(-1)?.label).toBe('BLOCKED');
 const panel=verificationPanelModel(store,'t1');expect(panel.label).toBe('BLOCKED');
 expect(panel.rows.every(row=>row.outcome==='PASS')).toBe(true);
 expect(store.all('visualObservation','t1')).toEqual(recorded);
});

it('the origin policy blocks unapproved traffic at request time',async()=>{
 const store=stateStore();
 // A compliant driver consults allowOrigin before each request; a tracker
 // subresource is blocked at the boundary — never in observedOrigins — and
 // the blocked attempt is recorded as evidence.
 const driver=fakeDriver({texts:{'h1':'Welcome home'},requests:['https://tracker.example']});
 const result=await run(store,[
  {kind:'NAVIGATE',url:'http://127.0.0.1:4100/'},
  {kind:'ASSERT_TEXT',selector:'h1',text:'Welcome home',checklistItemId:'item-1'},
  {kind:'ASSERT_TEXT',selector:'h1',text:'Welcome home',checklistItemId:'item-2'},
 ],driver);
 expect(result.outcome).toBe('PASS');
 expect(result.deniedOrigins).toContain('https://tracker.example');
 expect(driver.page.visits).toEqual(['http://127.0.0.1:4100/']);
 expect(result.observations.find(obs=>obs.checklistItemId==='__boundary__')?.outcome).toBe('PASS');
});

it('a cancelled run leaves terminal evidence and audit markers never verify a requirement',async()=>{
 const store=stateStore();
 // Denied tracker traffic happens, then the first assertion is cancelled:
 // the run records the boundary denial and the cancellation, but neither is
 // item evidence a requirement can bind through the execution id.
 const driver=fakeDriver({requests:['https://tracker.example'],cancelOnText:true});
 const result=await run(store,[
  {kind:'NAVIGATE',url:'http://127.0.0.1:4100/'},
  {kind:'ASSERT_TEXT',selector:'h1',text:'Welcome home',checklistItemId:'item-1'},
 ],driver);
 expect(result.outcome).toBe('CANCELLED');
 expect(result.observations.find(obs=>obs.checklistItemId==='__cancelled__')?.outcome).toBe('CANCELLED');
 const executionId=result.observations[0].executionId;
 const assessment=computeAssessment({
  threadId:'t1',sourceCut:{headSha:null,codeDigest:digests.codeDigest,dependencyDigest:digests.dependencyDigest,environmentId:digests.environmentId},
  requirements:[{id:'page-works',checkRefs:[executionId]}],observations:result.observations,
  unresolvedEffects:[],verifierIdentity:'test',provenance:'test',
 });
 // Cancelled execution-level evidence stays effective — never VERIFIED.
 expect(assessment.requirements[0].assessment).toBe('FAILED');
 expect(assessment.label).toBe('FAILED');
});

it('a failing COLLECT_ERRORS fails an execution-bound requirement even when assertions pass',async()=>{
 const store=stateStore();
 const driver=fakeDriver({texts:{'h1':'Welcome home'},failures:{network:['GET /api 500']}});
 const result=await run(store,[
  {kind:'NAVIGATE',url:'http://127.0.0.1:4100/'},
  {kind:'ASSERT_TEXT',selector:'h1',text:'Welcome home',checklistItemId:'item-1'},
  {kind:'ASSERT_TEXT',selector:'h1',text:'Welcome home',checklistItemId:'item-2'},
  {kind:'COLLECT_ERRORS'},
 ],driver);
 expect(result.outcome).toBe('FAIL');
 const executionId=result.observations[0].executionId;
 const assessment=computeAssessment({
  threadId:'t1',sourceCut:{headSha:null,codeDigest:digests.codeDigest,dependencyDigest:digests.dependencyDigest,environmentId:digests.environmentId},
  requirements:[{id:'page-works',checkRefs:[executionId]}],observations:result.observations,
  unresolvedEffects:[],verifierIdentity:'test',provenance:'test',
 });
 expect(assessment.requirements[0].assessment).toBe('FAILED');
 expect(assessment.label).toBe('FAILED');
});

it('the __ namespace is reserved for run-level audit markers at checklist admission',()=>{
 expect(()=>browserChecklistSchema.parse({
  version:1,checklistId:'cl-x',approvedOrigins:['http://127.0.0.1:4100'],viewport:{width:1280,height:800},
  steps:[{kind:'NAVIGATE',url:'http://127.0.0.1:4100/'}],items:['__login'],
 })).toThrow();
});

it('bounded console and network failure collection fails the run',async()=>{
 const store=stateStore();
 const driver=fakeDriver({texts:{'h1':'Welcome home'},failures:{console:['TypeError: x is null'],network:['GET /api 500']}});
 const result=await run(store,[
  {kind:'NAVIGATE',url:'http://127.0.0.1:4100/'},
  {kind:'ASSERT_TEXT',selector:'h1',text:'Welcome home',checklistItemId:'item-1'},
  {kind:'SCREENSHOT',checklistItemId:'item-2',required:true},
  {kind:'COLLECT_ERRORS'},
 ],driver);
 expect(result.outcome).toBe('FAIL');
 expect(result.observations.find(obs=>obs.checklistItemId==='__errors__')?.outcome).toBe('FAIL');
});

it('driver failures record BLOCKED, not a fabricated outcome',async()=>{
 const store=stateStore();
 const driver:BrowserDriver={launch:async()=>({page:{url:()=>'http://127.0.0.1:4100/',goto:async()=>{throw new Error('renderer crashed');},click:async()=>{},type:async()=>{},text:async()=>null,visible:async()=>false,screenshot:async()=>Buffer.alloc(1)},collectedFailures:()=>({console:[],network:[]}),observedOrigins:()=>['http://127.0.0.1:4100'],close:async()=>{}})};
 const result=await run(store,[{kind:'NAVIGATE',url:'http://127.0.0.1:4100/'}],driver);
 expect(result.outcome).toBe('BLOCKED');
 expect(result.observations.find(obs=>obs.checklistItemId==='__driver__')?.observed).toMatch(/renderer crashed/);
});

it('owned browser cleanup failure is retained and prevents successful verification',async()=>{
 const store=stateStore();
 const base=fakeDriver({texts:{h1:'Welcome home'}});
 const driver:BrowserDriver={launch:async options=>({...await base.launch(options),close:async()=>{throw new Error('owned browser still running');}})};
 const result=await run(store,[
  {kind:'ASSERT_TEXT',selector:'h1',text:'Welcome home',checklistItemId:'item-1'},
  {kind:'ASSERT_TEXT',selector:'h1',text:'Welcome home',checklistItemId:'item-2'},
 ],driver);
 expect(result.outcome).toBe('FAIL');
 const cleanup=result.observations.find(obs=>obs.checklistItemId==='__cleanup__')!;
 expect(cleanup.outcome).toBe('FAIL');
 expect(cleanup.observed).toContain('owned browser still running');
 expect(store.get('visualObservation',cleanup.checkId)).toEqual(cleanup);
 const assertion=result.observations.find(obs=>obs.checklistItemId==='item-1')!;
 const assessment=computeAssessment({
  threadId:'t1',sourceCut:{headSha:null,codeDigest:digests.codeDigest,dependencyDigest:digests.dependencyDigest,environmentId:digests.environmentId},
  requirements:[{id:'page-works',checkRefs:[assertion.checkId]}],observations:result.observations,
  unresolvedEffects:[],verifierIdentity:'test',provenance:'test',
 });
 expect(assessment.label).toBe('FAILED');
});

it('completed browser steps release their deadline timers',async()=>{
 vi.useFakeTimers();
 const result=await run(stateStore(),[
  {kind:'NAVIGATE',url:'http://127.0.0.1:4100/'},
  {kind:'ASSERT_TEXT',selector:'h1',text:'Welcome home',checklistItemId:'item-1'},
  {kind:'ASSERT_VISIBLE',selector:'nav',checklistItemId:'item-2'},
 ],fakeDriver({texts:{h1:'Welcome home'},visible:{nav:true}}));
 expect(result.outcome).toBe('PASS');
 expect(vi.getTimerCount()).toBe(0);
});

it('a browser step still fails when its deadline expires',async()=>{
 vi.useFakeTimers();let entered!:()=>void;
 const started=new Promise<void>(resolve=>{entered=resolve;}),driver=fakeDriver();
 driver.page.text=()=>{entered();return new Promise(()=>{});};
 const pending=run(stateStore(),[{kind:'ASSERT_TEXT',selector:'h1',text:'Ready',checklistItemId:'item-1'}],driver);
 await started;await vi.advanceTimersByTimeAsync(15_000);
 const result=await pending;
 expect(result.outcome).toBe('FAIL');
 expect(result.observations.find(obs=>obs.checklistItemId==='__step__')?.outcome).toBe('FAIL');
 expect(vi.getTimerCount()).toBe(0);
});

it('audits bounded console and network failures even when the checklist omits COLLECT_ERRORS',async()=>{
 const store=stateStore(),driver=fakeDriver({texts:{h1:'Ready'},failures:{console:Array.from({length:120},()=> 'x'.repeat(900)),network:['GET /broken 500']}});
 const result=await run(store,[{kind:'ASSERT_TEXT',selector:'h1',text:'Ready',checklistItemId:'item-1'},{kind:'ASSERT_TEXT',selector:'h1',text:'Ready',checklistItemId:'item-2'}],driver);
 expect(result.outcome).toBe('FAIL');expect(result.collected.console).toHaveLength(100);expect(result.collected.console[0]).toHaveLength(500);
 const errors=result.observations.find(value=>value.checklistItemId==='__errors__')!;
 expect(errors.outcome).toBe('FAIL');expect(errors.artifactRefs).toHaveLength(1);
 expect(new VerificationArtifactStore(store).read(errors.artifactRefs[0],owner,errors.executionId).metadata.kind).toBe('LOG');
});

it('an already cancelled browser request launches no session',async()=>{
 const controller=new AbortController(),driver=fakeDriver();controller.abort();
 const result=await run(stateStore(),[{kind:'ASSERT_URL',url:'http://127.0.0.1:4100/',checklistItemId:'item-1'}],driver,{signal:controller.signal});
 expect(driver.launched).toBe(0);expect(result.outcome).toBe('CANCELLED');
 expect(result.observations.some(value=>value.checklistItemId==='__cancelled__')).toBe(true);
});

it('cancellation interrupts a pending assertion and closes the owned browser',async()=>{
 const controller=new AbortController(),base=fakeDriver();let entered!:()=>void;
 const started=new Promise<void>(resolve=>{entered=resolve;}),close=vi.fn(async()=>{});
 base.page.text=()=>{entered();return new Promise(()=>{});};
 const driver:BrowserDriver={launch:async options=>({...await base.launch(options),close})};
 const pending=run(stateStore(),[{kind:'ASSERT_TEXT',selector:'h1',text:'Ready',checklistItemId:'item-1'}],driver,{signal:controller.signal});
 await started;controller.abort();const result=await pending;
 expect(result.outcome).toBe('CANCELLED');expect(close).toHaveBeenCalledTimes(1);
 expect(result.observations.some(value=>value.outcome==='PASS')).toBe(false);
});

it('a changed run owner cannot record a late successful assertion',async()=>{
 const store=stateStore(),driver=fakeDriver({texts:{h1:'Ready'}});
 driver.page.text=async()=>{store.internal('test.owner.changed','t1',()=>{const thread=store.get<Record<string,unknown>>('thread','t1')!;store.put('thread','t1','t1',{...thread,runId:'other-run',epoch:2});});return 'Ready';};
 const result=await run(store,[{kind:'ASSERT_TEXT',selector:'h1',text:'Ready',checklistItemId:'item-1'}],driver);
 expect(result.outcome).toBe('CANCELLED');expect(result.observations.some(value=>value.outcome==='PASS')).toBe(false);
});

it('a launch failure records blocked execution evidence',async()=>{
 const result=await run(stateStore(),[{kind:'NAVIGATE',url:'http://127.0.0.1:4100/'}],{launch:async()=>{throw new Error('browser unavailable');}});
 expect(result.outcome).toBe('BLOCKED');expect(result.observations.find(value=>value.checklistItemId==='__driver__')?.observed).toContain('browser unavailable');
});

it('the overall deadline bounds launch and closes a session that arrives too late',async()=>{
 vi.useFakeTimers();let resolveLaunch!:(session:BrowserSession)=>void;
 const base=fakeDriver(),close=vi.fn(async()=>{}),driver:BrowserDriver={launch:()=>new Promise(resolve=>{resolveLaunch=resolve;})};
 const pending=run(stateStore(),[{kind:'NAVIGATE',url:'http://127.0.0.1:4100/'}],driver);
 await vi.advanceTimersByTimeAsync(300_000);const result=await pending;
 expect(result.outcome).toBe('FAIL');expect(result.observations.find(value=>value.checklistItemId==='__deadline__')?.outcome).toBe('FAIL');
 resolveLaunch({...await base.launch({profileDir:'fixture',viewport:{width:1280,height:800},approvedOrigins:[],allowOrigin:()=>true}),close});
 await vi.advanceTimersByTimeAsync(0);expect(close).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
});

it('the overall deadline also caps the last in-flight browser step',async()=>{
 vi.useFakeTimers();let clock=0,entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;}),driver=fakeDriver();
 driver.page.goto=async()=>{clock=299_990;};driver.page.text=()=>{entered();return new Promise(()=>{});};
 const pending=run(stateStore(),[{kind:'NAVIGATE',url:'http://127.0.0.1:4100/'},{kind:'ASSERT_TEXT',selector:'h1',text:'Ready',checklistItemId:'item-1'}],driver,{nowMs:()=>clock});
 await started;await vi.advanceTimersByTimeAsync(10);const result=await pending;
 expect(result.outcome).toBe('FAIL');expect(result.observations.find(value=>value.checklistItemId==='__deadline__')?.outcome).toBe('FAIL');expect(vi.getTimerCount()).toBe(0);
});

it('a hanging close is bounded and retained as failed cleanup',async()=>{
 vi.useFakeTimers();let entered!:()=>void;const closing=new Promise<void>(resolve=>{entered=resolve;}),base=fakeDriver({texts:{h1:'Ready'}});
 const driver:BrowserDriver={launch:async options=>({...await base.launch(options),close:()=>{entered();return new Promise(()=>{});}})};
 const pending=run(stateStore(),[{kind:'ASSERT_TEXT',selector:'h1',text:'Ready',checklistItemId:'item-1'},{kind:'ASSERT_TEXT',selector:'h1',text:'Ready',checklistItemId:'item-2'}],driver);
 await closing;await vi.advanceTimersByTimeAsync(15_000);const result=await pending;
 expect(result.outcome).toBe('FAIL');expect(result.observations.find(value=>value.checklistItemId==='__cleanup__')?.outcome).toBe('FAIL');expect(vi.getTimerCount()).toBe(0);
});

it('returns its captured error audit without querying a closed browser',async()=>{
 let closed=false;const base=fakeDriver({texts:{h1:'Ready'}});
 const driver:BrowserDriver={launch:async options=>({...await base.launch(options),collectedFailures:()=>{if(closed)throw Error('closed');return{console:[],network:[]};},close:async()=>{closed=true;}})};
 const result=await run(stateStore(),[{kind:'ASSERT_TEXT',selector:'h1',text:'Ready',checklistItemId:'item-1'},{kind:'ASSERT_TEXT',selector:'h1',text:'Ready',checklistItemId:'item-2'}],driver);
 expect(result.outcome).toBe('PASS');expect(result.collected).toEqual({console:[],network:[]});expect(closed).toBe(true);
});

it('does not return success when its owner changes during browser cleanup',async()=>{
 const store=stateStore(),base=fakeDriver({texts:{h1:'Ready'}});
 const driver:BrowserDriver={launch:async options=>({...await base.launch(options),close:async()=>{store.internal('test.cleanup.owner','t1',()=>{const thread=store.get<Record<string,unknown>>('thread','t1')!;store.put('thread','t1','t1',{...thread,runId:'after-cleanup',epoch:2});});}})};
 const result=await run(store,[{kind:'ASSERT_TEXT',selector:'h1',text:'Ready',checklistItemId:'item-1'},{kind:'ASSERT_TEXT',selector:'h1',text:'Ready',checklistItemId:'item-2'}],driver);
 expect(result.outcome).toBe('CANCELLED');expect(result.observations.find(value=>value.checklistItemId==='__cancelled__')?.outcome).toBe('CANCELLED');
});

it('rejects an unbounded viewport before creating a browser',async()=>{
 const driver=fakeDriver();
 await expect(run(stateStore(),[{kind:'ASSERT_VISIBLE',selector:'nav',checklistItemId:'item-1'}],driver,{checklist:checklist([{kind:'ASSERT_VISIBLE',selector:'nav',checklistItemId:'item-1'}],{viewport:{width:8192,height:8192}})})).rejects.toMatchObject({code:'RESOURCE_LIMIT'});
 expect(driver.launched).toBe(0);
});

it('a malformed visibility response cannot become a passing assertion',async()=>{
 const driver=fakeDriver();driver.page.visible=async()=> 'false' as unknown as boolean;
 const result=await run(stateStore(),[{kind:'ASSERT_VISIBLE',selector:'nav',checklistItemId:'item-1'},{kind:'ASSERT_VISIBLE',selector:'nav',checklistItemId:'item-2'}],driver);
 expect(result.outcome).toBe('BLOCKED');expect(result.observations.some(value=>value.outcome==='PASS')).toBe(false);
});

it('an array text response cannot satisfy a string assertion',async()=>{
 const driver=fakeDriver();driver.page.text=async()=> ['Ready'] as unknown as string;
 const result=await run(stateStore(),[{kind:'ASSERT_TEXT',selector:'h1',text:'Ready',checklistItemId:'item-1'},{kind:'ASSERT_TEXT',selector:'h1',text:'Ready',checklistItemId:'item-2'}],driver);
 expect(result.outcome).toBe('BLOCKED');expect(result.observations.some(value=>value.outcome==='PASS')).toBe(false);
});

it('revokes the request-time origin callback before cleanup and after return',async()=>{
 const base=fakeDriver({texts:{h1:'Ready'}});let permittedDuringClose:boolean|undefined;
 const driver:BrowserDriver={launch:async options=>({...await base.launch(options),close:async()=>{permittedDuringClose=options.allowOrigin('http://127.0.0.1:4100');}})};
 const result=await run(stateStore(),[{kind:'ASSERT_TEXT',selector:'h1',text:'Ready',checklistItemId:'item-1'},{kind:'ASSERT_TEXT',selector:'h1',text:'Ready',checklistItemId:'item-2'}],driver);
 expect(result.outcome).toBe('PASS');expect(permittedDuringClose).toBe(false);expect(base.allow?.('http://127.0.0.1:4100')).toBe(false);
});

it('ASSERT_URL rejects a nonstring URL even when its later origin read is valid',async()=>{
 const driver=fakeDriver({texts:{h1:'Ready'}});let reads=0;
 driver.page.url=()=> ++reads===1?['http://127.0.0.1:4100/'] as unknown as string:'http://127.0.0.1:4100/';
 const result=await run(stateStore(),[{kind:'ASSERT_URL',url:'http://127.0.0.1:4100/',checklistItemId:'item-1'},{kind:'ASSERT_TEXT',selector:'h1',text:'Ready',checklistItemId:'item-2'}],driver);
 expect(result.outcome).toBe('BLOCKED');expect(result.observations.some(value=>value.outcome==='PASS')).toBe(false);
});

it('rejects nonstring origin evidence instead of coercing an array to an allowed origin',async()=>{
 const driver=fakeDriver({texts:{h1:'Ready'},origins:[['http://127.0.0.1:4100']] as unknown as string[]});
 const result=await run(stateStore(),[{kind:'ASSERT_TEXT',selector:'h1',text:'Ready',checklistItemId:'item-1'},{kind:'ASSERT_TEXT',selector:'h1',text:'Ready',checklistItemId:'item-2'}],driver);
 expect(result.outcome).toBe('BLOCKED');expect(result.observations.some(value=>value.checklistItemId==='__driver__'&&value.outcome==='BLOCKED')).toBe(true);
});

it('does not record a successful assertion at an unapproved actual page origin',async()=>{
 const driver=fakeDriver({url:'https://foreign.example/',texts:{h1:'Ready'},origins:['http://127.0.0.1:4100']});
 const result=await run(stateStore(),[{kind:'ASSERT_TEXT',selector:'h1',text:'Ready',checklistItemId:'item-1'},{kind:'ASSERT_TEXT',selector:'h1',text:'Ready',checklistItemId:'item-2'}],driver);
 expect(result.outcome).toBe('BLOCKED');expect(result.observations.some(value=>value.outcome==='PASS')).toBe(false);
});
