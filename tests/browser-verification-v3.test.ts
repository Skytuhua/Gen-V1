import {it,expect,afterEach} from 'vitest';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../packages/storage/store';
import {runBrowserChecklist,type BrowserDriver,type BrowserSession,type BrowserPage} from '../packages/core/browser-verification';
import {browserChecklistSchema,type BrowserChecklistV1,type BrowserStep} from '../packages/contracts/verification';
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

interface FakeDriver extends BrowserDriver {profileDir:string|undefined;launched:number;page:FakePage}
interface FakePage extends BrowserPage {visits:string[];clicks:string[];typed:[string,string][];screens:Buffer}
function fakeDriver(over:{url?:string;texts?:Record<string,string>;visible?:Record<string,boolean>;failures?:{console?:string[];network?:string[]};origins?:string[];shotBytes?:number}={}):FakeDriver{
 const state={url:over.url??'http://127.0.0.1:4100/',screens:Buffer.alloc(over.shotBytes??128,7),origins:over.origins??['http://127.0.0.1:4100']};
 const page:FakePage={
  url:()=>state.url,visits:[],clicks:[],typed:[],screens:state.screens,
  goto:async url=>{page.visits.push(url);state.url=url;},
  click:async s=>{page.clicks.push(s);},
  type:async(s,t)=>{page.typed.push([s,t]);},
  text:async s=>over.texts?.[s]??null,
  visible:async s=>over.visible?.[s]??false,
  screenshot:async()=>state.screens,
 };
 const session:BrowserSession={page,collectedFailures:()=>({console:over.failures?.console??[],network:over.failures?.network??[]}),observedOrigins:()=>state.origins,close:async()=>{}};
 const driver:FakeDriver={profileDir:undefined,launched:0,page,launch:async opts=>{driver.profileDir=opts.profileDir;driver.launched++;return session;}};
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
 expect(result.outcome).toBe('BLOCKED'); // item-2 has no observation at all
 expect(result.observations.find(obs=>obs.checklistItemId==='item-2')?.outcome).toBe('BLOCKED');
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
