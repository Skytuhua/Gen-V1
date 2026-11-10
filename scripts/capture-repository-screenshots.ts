import {spawn} from 'node:child_process';
import {mkdir,stat,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {chromium,expect,type Browser,type Page} from '@playwright/test';
import {taskFixture} from '../tests/e2e/task-interface-fixture.ts';
import {terminateProcessTree} from '../packages/runtime-pi/process-tree.ts';
import {verificationPorts} from './portable-verification.ts';
import type {Snapshot} from '../packages/contracts/index.ts';
import type {SkillDetail,SkillSummary} from '../packages/contracts/skills.ts';

const output=resolve('docs/screenshots'),root=resolve('.'),now=new Date().toISOString();
const models=[{id:'openai/sol',provider:'openai',name:'GPT-6.1 Sol',thinkingLevels:['low','medium','high']},{id:'openai/terra',provider:'openai',name:'GPT-6.1 Terra'},{id:'claude-code/sonnet',provider:'claude-code',name:'Claude Sonnet'},{id:'claude-code/opus',provider:'claude-code',name:'Claude Opus'},{id:'gemini-cli/pro',provider:'gemini-cli',name:'Gemini Pro'}];
const trace={revision:'capture-1',title:'Checkout latency',source:'Sample capture · checkout-trace.json',spans:[
 {id:'checkout',name:'POST /checkout',service:'checkout-api',startMs:0,durationMs:620,status:'error'},
 {id:'first',parentId:'checkout',name:'First payment attempt',startMs:45,durationMs:120,status:'error',detail:'HTTP 429 · Retry-After: 2 s'},
 {id:'delay',parentId:'checkout',name:'Retry delay',startMs:165,durationMs:200,status:'ok'},
 {id:'second',parentId:'checkout',name:'Second payment attempt',startMs:365,durationMs:180,status:'error'},
]};
const alternatives={title:'Choose the next step',source:'Sample scenarios · estimates, not executed changes',criteria:[{id:'response',label:'Response'},{id:'retry',label:'Retry policy'}],options:[
 {id:'single',label:'Single attempt',summary:'Immediate containment',values:{response:'≈240 ms estimated',retry:'Report failure; retry outside this request'}},
 {id:'async',label:'Async continuation',summary:'Design option',values:{response:'Pending acknowledgement',retry:'Durable handoff; respect Retry-After'}},
]};
const skill:SkillSummary={name:'verify-release',description:'Verify the exact build before shipping.',category:'development',revision:3,state:'active',enabled:true,protected:true,origin:'agent',managed:false,author:'agent',createdAt:now,updatedAt:now,lastUsedAt:now,useCount:4,patchCount:2};
const detail:SkillDetail={skill,content:'# Verify a release\n\n1. Read the release manifest and identify the exact build.\n2. Run focused checks for the changed behavior.\n3. Confirm the packaged application starts and recovers state.\n4. Keep fixture evidence separate from live-provider acceptance.\n5. Record checks, hashes and any remaining limits.',files:['references/checklist.md'],versions:[{revision:3,at:now,actor:{kind:'agent'},action:'patch'},{revision:2,at:now,actor:{kind:'agent'},action:'patch'},{revision:1,at:now,actor:{kind:'agent'},action:'create'}],nextVersionOffset:null};
function snapshot(theme:'dark'|'light'):Snapshot{
 const value=taskFixture({root:'investigation',elements:{investigation:{type:'Stack',props:{gap:'md'},children:['trace','options']},trace:{type:'TraceWaterfall',props:{dataBinding:'trace',stateKey:'traceView'}},options:{type:'Comparison',props:{dataBinding:'alternatives',stateKey:'choice'}}}},{trace,alternatives},{choice:{selectedId:'single',differencesOnly:false}});
 value.settings={theme,modelId:models[0].id,preferences:{fontSize:14,learningEnabled:true,learningApproval:true,learningInterval:10,panelAnimations:true,composerPredictions:true}};
 value.threads[0]={...value.threads[0],title:'Investigate payment retries',projectName:'Checkout',modelId:models[0].id,sessionPath:null,createdAt:now,updatedAt:now};
 value.threads.push({...value.threads[0],id:'release-thread',title:'Prepare the release checklist',projectName:'Gen V1'},{...value.threads[0],id:'migration-thread',title:'Review the migration plan',projectName:'Gen V1'});
 value.messages=[{id:'question',threadId:'task-thread',role:'user',content:'Check the checkout retry timing and compare two ways to meet the 1.2 s budget.',runId:null,createdAt:now},{id:'reply',threadId:'task-thread',role:'assistant',content:'The sample trace finishes in **620 ms**, but the payment retry begins **1.8 s too early**. Start with a single attempt; use an asynchronous continuation only when a pending response meets the requirement.',runId:null,createdAt:now}];
 Object.assign(value.artifacts[0],{title:'Checkout retry investigation',purpose:'Inspect one supplied sample and compare the next steps.',actions:{}});
 value.skills=[skill,{...skill,name:'trace-retry-budget',description:'Check retry timing against the request deadline.',revision:1,protected:false,useCount:2,patchCount:0}];value.skillProposals=[];value.learning={supported:true,status:'idle',lastReview:null};return value;
}
async function setup(page:Page,theme:'dark'|'light'){
 // A source string avoids tsx's Node-only class-name helper in the browser init script.
 await page.addInitScript({content:`localStorage.setItem('harness:selected-thread','task-thread');
  class SampleEvents{onerror=null;onmessage=null;closed=false;set onopen(handler){if(handler)queueMicrotask(()=>{if(!this.closed)handler();});}addEventListener(){}close(){this.closed=true;}}
  Object.defineProperty(window,'EventSource',{value:SampleEvents});`});
 const data=snapshot(theme);
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/bootstrap')return route.fulfill({json:{csrfToken:'sample-csrf',widgetOrigin:'http://localhost:4318'}});
  if(path==='/api/models')return route.fulfill({json:{models}});
  if(path==='/api/snapshot')return route.fulfill({json:data});
  if(path.startsWith('/api/skills/'))return route.fulfill({json:detail});
  if(path==='/api/commands'){const command=route.request().postDataJSON();data.seq++;return route.fulfill({json:{commandId:command.id,seq:data.seq,result:{}}});}
  return route.fulfill({status:404});
 });
 return data;
}
await mkdir(output,{recursive:true});const[port]=await verificationPorts(),origin=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,[join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,windowsHide:true,stdio:'ignore',detached:process.platform!=='win32'});let browser:Browser|undefined;
const captures:{file:string;width:number;height:number;bytes:number}[]=[];
try{
 await expect.poll(async()=>{if(server.exitCode!==null)throw Error('The screenshot server exited.');try{return(await fetch(origin,{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}},{timeout:20000}).toBe(true);
 browser=await chromium.launch({headless:true});
 for(const theme of ['dark','light'] as const){
  const context=await browser.newContext({viewport:{width:1440,height:1080},deviceScaleFactor:1,reducedMotion:'reduce'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const page=await context.newPage(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await setup(page,theme);await page.goto(origin);
  await expect(page).toHaveTitle('Gen V1');await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();await expect(page.getByRole('combobox',{name:'Model',exact:true})).toContainText('GPT-6.1 Sol');
  await expect(page.locator('[data-artifact-id="task-surface"]')).toBeVisible();await expect(page.getByText('Checkout latency',{exact:true})).toBeVisible();await expect(page.getByText('Reconnecting',{exact:true})).toHaveCount(0);await page.evaluate(()=>document.fonts.ready);
  await page.locator('.conversation-scroll').evaluate(element=>{element.scrollTop=0;});
  const capture=async(file:string)=>{await page.screenshot({path:join(output,file),animations:'disabled'});captures.push({file,width:1440,height:1080,bytes:(await stat(join(output,file))).size});};
  await capture(theme==='dark'?'workspace.png':'workspace-light.png');
  if(theme==='dark'){
   await page.getByRole('combobox',{name:'Model',exact:true}).click();await expect(page.getByRole('listbox',{name:'Available models',exact:true})).toBeVisible();await capture('models.png');await page.getByRole('searchbox',{name:'Search models',exact:true}).press('Escape');
   await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Skills & learning',exact:true}).click();await page.getByRole('button',{name:'Inspect verify-release',exact:true}).click();await expect(page.getByRole('textbox',{name:'Instructions for verify-release',exact:true})).toHaveValue(detail.content);await page.getByRole('heading',{name:'Saved skills',exact:true}).evaluate(element=>element.scrollIntoView({block:'start'}));await capture('learning.png');
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);await context.close();
 }
 if(captures.reduce((total,item)=>total+item.bytes,0)>2*1024*1024)throw Error('Repository screenshots exceed the 2 MiB budget.');
 await writeFile(join(output,'README.md'),'# Product screenshots\n\nThese are unedited captures of the actual Gen V1 interface rendered in Chromium at 1440 × 1080. All conversations, trace spans, model choices and skills are clean **sample data**. They demonstrate the interface, not live provider authentication, inference quality, account entitlement or production measurements. No personal account, conversation or local profile was used.\n\n- `workspace.png`: dark conversation with a trace investigation and comparison.\n- `models.png`: searchable model picker with an illustrative model catalog.\n- `learning.png`: Skills & learning procedure editor, supporting files and revision history.\n- `workspace-light.png`: the same sample investigation in light mode.\n\nRegenerate with `pnpm exec tsx scripts/capture-repository-screenshots.ts` after installing Chromium with `pnpm exec playwright install chromium`. The script starts and stops its own local development server and makes no model requests.\n');
 console.log(JSON.stringify({scope:'Actual UI with synthetic sample data; no live accounts or inference.',captures}));
}finally{await browser?.close();await terminateProcessTree(server);}
