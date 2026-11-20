import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {chromium,expect,type Browser,type Page} from '@playwright/test';
import {serveTaskFixture,taskFixture} from '../tests/e2e/task-interface-fixture.ts';
import {createWorkspaceCanvas} from '../packages/core/workspace-layout.ts';
import {planDataId,PLANNING_PROVENANCE,type PlanRecord} from '../packages/contracts/planning.ts';
import {terminateProcessTree} from '../packages/runtime-pi/process-tree.ts';
import {verificationPorts} from './portable-verification.ts';
import type {Snapshot} from '../packages/contracts/index.ts';
import type {SkillDetail,SkillSummary} from '../packages/contracts/skills.ts';

// Recaptures the still images in docs/public/media and refreshes provenance.json.
// Videos, posters and the animated preview are left as recorded.
const media=resolve('docs/public/media'),root=resolve('.'),now='2026-11-19T12:00:00.000Z',created='2026-11-04T00:00:00.000Z';
const models=[{id:'openai/sol',provider:'openai',name:'GPT-6.1 Sol',thinkingLevels:['low','medium','high']},{id:'openai/terra',provider:'openai',name:'GPT-6.1 Terra'},{id:'claude-code/sonnet',provider:'claude-code',name:'Claude Sonnet'},{id:'claude-code/opus',provider:'claude-code',name:'Claude Opus'},{id:'gemini-cli/pro',provider:'gemini-cli',name:'Gemini Pro'}];
const trace={revision:'capture-1',title:'Checkout latency',source:'Sample capture · checkout-trace.json',spans:[
 {id:'checkout',name:'POST /checkout',service:'checkout-api',startMs:0,durationMs:620,status:'error'},
 {id:'first',parentId:'checkout',name:'First payment attempt',startMs:45,durationMs:120,status:'error',detail:'HTTP 429 · Retry-After: 2 s'},
 {id:'delay',parentId:'checkout',name:'Retry delay',startMs:165,durationMs:200,status:'ok'},
 {id:'second',parentId:'checkout',name:'Second payment attempt',startMs:365,durationMs:180,status:'error'},
]};
const alternatives={title:'Choose the next step',source:'Sample scenarios · estimates, not executed changes',criteria:[{id:'response',label:'Response'},{id:'retry',label:'Retry policy'}],options:[
 {id:'single',label:'Single attempt',summary:'Immediate containment',values:{response:'About 40 ms estimated',retry:'Report failure; retry outside this request'}},
 {id:'async',label:'Async continuation',summary:'Design option',values:{response:'Pending acknowledgement',retry:'Durable handoff; respect Retry-After'}},
]};
const projects=[{id:'checkout',name:'Checkout sample',authority:{kind:'local'},rootPath:'D:/SampleProjects/checkout',createdAt:created},{id:'release',name:'Release sample',authority:{kind:'local'},rootPath:'D:/SampleProjects/release',createdAt:created}];
const skill:SkillSummary={name:'verify-release',description:'Check a build before sharing it.',category:'development',revision:3,state:'active',enabled:true,protected:true,origin:'agent',managed:false,author:'agent',createdAt:now,updatedAt:now,lastUsedAt:now,useCount:4,patchCount:2};
const detail:SkillDetail={skill,content:'# Verify a release\n\n1. Identify the exact source and build.\n2. Run focused checks for the changed behavior.\n3. Check startup and saved-state recovery.\n4. Keep sample UI separate from live results.\n5. Record any remaining limits.',files:['references/checklist.md'],versions:[{revision:3,at:now,actor:{kind:'agent'},action:'patch'},{revision:2,at:now,actor:{kind:'agent'},action:'patch'},{revision:1,at:now,actor:{kind:'agent'},action:'create'}],nextVersionOffset:null};
const plan:PlanRecord={version:1,title:'Checkout retry investigation',steps:[
 {id:'inspect',title:'Inspect the supplied trace',status:'completed',requirements:[],agentIds:[]},
 {id:'compare',title:'Compare the next steps',status:'working',requirements:[{id:'review',label:'Review the two design options',completed:false}],agentIds:[]},
 {id:'verify',title:'Verify the chosen change',status:'pending',requirements:[],agentIds:[]},
],agents:[]};
function snapshot(theme:'dark'|'light',withPlan:boolean):Snapshot{
 const value=taskFixture({root:'investigation',elements:{investigation:{type:'Stack',props:{gap:'md'},children:['trace','options']},trace:{type:'TraceWaterfall',props:{dataBinding:'trace',stateKey:'traceView'}},options:{type:'Comparison',props:{dataBinding:'alternatives',stateKey:'choice'}}}},{trace,alternatives},{choice:{selectedId:'single',differencesOnly:false}});
 value.settings={theme,modelId:models[0].id,preferences:{fontSize:14,learningEnabled:true,learningApproval:true,learningInterval:10,panelAnimations:true}};
 const base={...value.threads[0],modelId:models[0].id,sessionPath:null,createdAt:created,updatedAt:created};
 value.threads=[{...base,title:'Investigate payment retries',projectId:'checkout',projectName:'Checkout sample'},{...base,id:'release-thread',title:'Prepare a release checklist',projectId:'release',projectName:'Release sample'},{...base,id:'migration-thread',title:'Review a migration plan',projectId:'release',projectName:'Release sample'}];
 value.messages=[{id:'question',threadId:'task-thread',role:'user',content:'Check the checkout retry timing and compare two ways to meet the 1.2 s budget.',runId:null,createdAt:created},{id:'reply',threadId:'task-thread',role:'assistant',content:'**Sample UI.** This supplied trace finishes in **620 ms**, but its second payment attempt begins **1.8 s too early**. Compare a single attempt with an asynchronous continuation before choosing a change.',runId:null,createdAt:created}];
 Object.assign(value.artifacts[0],{title:'Checkout retry investigation',purpose:'Inspect one supplied sample and compare the next steps.',actions:{}});
 if(withPlan)value.data.push({id:planDataId('task-thread'),threadId:'task-thread',revision:1,provenance:PLANNING_PROVENANCE,value:structuredClone(plan),createdAt:created});
 Object.assign(value,{skills:[skill,{...skill,name:'trace-retry-budget',description:'Compare retry timing with a request deadline.',revision:1,protected:false,useCount:2,patchCount:0}],skillProposals:[],learning:{supported:true,status:'idle',lastReview:null}});
 return value;
}
async function open(page:Page,theme:'dark'|'light',withPlan=false){
 // tsx adds a Node-only __name helper to the fixture's browser init script.
 await page.addInitScript({content:"window.__name=(target)=>target;localStorage.setItem('harness:selected-thread','task-thread');"});
 const value=snapshot(theme,withPlan);await serveTaskFixture(page,value);
 // Later routes take precedence over the shared task fixture.
 await page.route(url=>url.pathname==='/api/models',route=>route.fulfill({json:{models}}));
 await page.route('**/api/plugins',route=>route.fulfill({json:{plugins:[]}}));
 await page.route('**/api/threads/*/messages?*',route=>{const id=decodeURIComponent(new URL(route.request().url()).pathname.split('/')[3]);return route.fulfill({json:{messages:value.messages.filter(message=>message.threadId===id),truncated:0}});});
 await page.route('**/api/integrations',route=>route.fulfill({json:{integrations:[]}}));
 await page.route('**/api/skills/**',route=>route.fulfill({json:decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop()??'')==='verify-release'?detail:{...detail,skill:{...skill,name:'trace-retry-budget'}}}));
 await page.route('**/api/workspace',route=>route.fulfill({json:{projects,state:{version:1,revision:0,activeCanvasId:'main',canvases:[createWorkspaceCanvas('workspace','Workspace','main')],profiles:[],disabledKinds:[],integrations:{}}}}));
 await page.route('**/api/projects/*/context?*',route=>{const id=new URL(route.request().url()).pathname.split('/')[3];return route.fulfill({json:{project:projects.find(p=>p.id===id)??projects[0],threadId:'task-thread',machineName:'Sample machine',editor:{available:false,label:'Editor'},branch:null,head:null,changes:{added:null,removed:null,files:null},lineage:[],scripts:[],capabilities:{git:false,terminal:false,pullRequests:false}}});});
 await page.goto('/');
 await expect(page).toHaveTitle('Gen V1');await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();
 await expect(page.locator('[data-artifact-id="task-surface"]')).toBeVisible();await expect(page.getByText('Checkout latency',{exact:true})).toBeVisible();await page.evaluate(()=>document.fonts.ready);
}
const expandOverview=async(page:Page)=>{await page.getByRole('button',{name:'Expand Project overview',exact:true}).click();await page.waitForTimeout(400);};
const [port]=await verificationPorts(),origin=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,[join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,windowsHide:true,stdio:'ignore',detached:process.platform!=='win32'});let browser:Browser|undefined;
try{
 await expect.poll(async()=>{if(server.exitCode!==null)throw Error('The capture server exited.');try{return(await fetch(origin,{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}},{timeout:30000}).toBe(true);
 browser=await chromium.launch({headless:true});
 const run=async(file:string,viewport:{width:number;height:number},theme:'dark'|'light',act:(page:Page)=>Promise<void>,withPlan=false)=>{
  const context=await browser!.newContext({viewport,deviceScaleFactor:1,reducedMotion:'reduce',baseURL:origin,locale:'en-US',timezoneId:'America/Los_Angeles'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const page=await context.newPage(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await open(page,theme,withPlan);await act(page);await page.waitForTimeout(300);
  await page.screenshot({path:join(media,file),animations:'disabled'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);await context.close();
 };
 const desktop={width:1440,height:1200};
 await run('workspace-dark.png',desktop,'dark',async()=>{});
 await run('workspace-light.png',desktop,'light',async()=>{});
 await run('models.png',desktop,'dark',async page=>{await page.getByRole('combobox',{name:'Model',exact:true}).click();await expect(page.getByRole('listbox',{name:'Available models',exact:true})).toBeVisible();});
 await run('projects.png',desktop,'dark',async page=>{await page.locator('.composer').getByRole('button',{name:'Select project'}).click();await expect(page.getByRole('dialog',{name:'Select project'})).toBeVisible();});
 await run('plan-context.png',desktop,'dark',async page=>{await expandOverview(page);await expect(page.getByRole('region',{name:'Project overview window',exact:true}).getByText('Checkout retry investigation',{exact:true})).toBeVisible();},true);
 await run('skills.png',desktop,'dark',async page=>{await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Skills & Integrations',exact:true}).click();await page.getByRole('button',{name:'Inspect verify-release',exact:true}).click();await expect(page.getByRole('textbox',{name:'Instructions for verify-release',exact:true})).toHaveValue(detail.content);await page.getByRole('heading',{name:'Saved skills',exact:true}).evaluate(element=>element.scrollIntoView({block:'start'}));});
 await run('narrow.png',{width:390,height:844},'dark',async()=>{});
}finally{
 try{await browser?.close();}finally{await terminateProcessTree(server);}
}
const provenancePath=join(media,'provenance.json'),manifest=await readFile(provenancePath,'utf8'),provenance=JSON.parse(manifest),eol=manifest.includes('\r\n')?'\r\n':'\n';
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
provenance.screenshots={source:{repository:provenance.source.repository,commit,version:JSON.parse(await readFile('package.json','utf8')).version+' source'},capturedAtUtc:new Date().toISOString(),files:['workspace-dark.png','workspace-light.png','models.png','skills.png','plan-context.png','projects.png','narrow.png'],method:'scripts/capture-public-media.ts: unmodified public DesktopEntry/App served by the root Vite config with the tests/e2e task-interface fixture and authored API responses. External requests blocked. Desktop 1440 x 1200, narrow 390 x 844, en-US, America/Los_Angeles, reduced motion.'};
provenance.method.reference=[...new Set(['scripts/capture-public-media.ts',...provenance.method.reference.filter((path:string)=>path!=='scripts/capture-repository-screenshots.ts')])];
provenance.method.screenshots='Unedited application captures; desktop 1440 x 1200, narrow 390 x 844. The narrow view shows the project overview collapsed. See screenshots for their source commit.';
for(const entry of provenance.files){
 const bytes=await readFile(join(media,entry.file));entry.bytes=bytes.length;entry.sha256=createHash('sha256').update(bytes).digest('hex');
 if(entry.file.endsWith('.png')){entry.width=bytes.readUInt32BE(16);entry.height=bytes.readUInt32BE(20);}
}
await writeFile(provenancePath,(JSON.stringify(provenance,null,2)+'\n').replace(/("durationSeconds": \d+)$/gm,'$1.0').replaceAll('\n',eol));
console.log(JSON.stringify({commit,files:provenance.screenshots.files}));
