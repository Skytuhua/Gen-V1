import {it,expect,afterEach} from 'vitest';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../packages/storage/store';
import {runBrowserChecklist,type BrowserDriver,type BrowserSession,type BrowserPage} from '../packages/core/browser-verification';
import {browserChecklistSchema,type BrowserChecklistV1,type BrowserStep} from '../packages/contracts/verification';
import {computeAssessment} from '../packages/core/verification-gate';
import type {ToolOwner} from '../packages/contracts/tool-effects';
import {hostFlagEnabled} from '../packages/core/host-flags';
import {HarnessError} from '../packages/contracts/index';
const codeAsync=async(p:Promise<unknown>):Promise<string>=>{try{await p;}catch(e){return (e as HarnessError).code;}return 'NO_THROW';};


const stores:Store[]=[];
function stateStore(){const store=new Store(join(tempDir('verify-state-'),'state'));stores.push(store);return store;}
const dirs:string[]=[];
function tempDir(prefix:string){const dir=mkdtempSync(join(tmpdir(),prefix));dirs.push(dir);return dir;}
afterEach(()=>{for(const store of stores.splice(0))store.close();for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
const FLAGS_ON={HARNESS_FLAG_VERIFICATION_WORKFLOW_V1:'1'};
const owner:ToolOwner={threadId:'t1',runId:'r1',epoch:1,projectId:null,workspaceId:null,accountBinding:null};

interface FakeDriver extends BrowserDriver {profileDir:string|undefined;launched:number;page:FakePage;allow:((origin:string)=>boolean)|undefined}
interface FakePage extends BrowserPage {visits:string[];clicks:string[];typed:[string,string][];screens:Buffer}
// `requests` models subresource/popup traffic the page attempts after goto:
// a compliant driver consults allowOrigin before each request; denied traffic
// is blocked at the boundary and never reaches observedOrigins.
function fakeDriver(over:{url?:string;texts?:Record<string,string>;visible?:Record<string,boolean>;failures?:{console?:string[];network?:string[]};origins?:string[];shotBytes?:number;requests?:string[];cancelOnText?:boolean}={}):FakeDriver{
 const state={url:over.url??'http://127.0.0.1:4100/',screens:Buffer.alloc(over.shotBytes??128,7),origins:over.origins??['http://127.0.0.1:4100'],blocked:[] as string[]};
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
const run=(store:Store,steps:BrowserStep[],driver:BrowserDriver,over:Record<string,unknown>={})=>runBrowserChecklist(store,{owner,checklist:checklist(steps),artifactDir:join(tempDir('verify-artifacts-'),'out'),driver,digests,...over}as Parameters<typeof runBrowserChecklist>[1],FLAGS_ON);

it('the browser workflow stays disabled until the host flag enables it',async()=>{
 const store=stateStore();
 expect(await codeAsync(runBrowserChecklist(store,{owner,checklist:checklist([{kind:'NAVIGATE',url:'http://127.0.0.1:4100/'}]),artifactDir:tempDir('verify-artifacts-'),driver:fakeDriver(),digests},{}))).toBe('CAPABILITY_DENIED');
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
 expect(shot.artifactRefs.length).toBe(1);expect(existsSync(shot.artifactRefs[0])).toBe(true);
 // The driver ran a fresh profile under the verification artifact dir, never an inherited one.
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
 expect(assessment.requirements[0].assessment).toBe('UNVERIFIED');
 expect(assessment.label).not.toBe('VERIFIED');
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
