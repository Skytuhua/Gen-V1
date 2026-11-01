import {test,expect,type Page} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {taskFixture,serveTaskFixture} from './task-interface-fixture';

const metrics={title:'Site performance',period:'Past seven days',metrics:[{id:'latency',label:'Response time',value:184,unit:'ms',comparison:{value:-12,label:'vs previous seven days',unit:'percent',favorable:true},series:[{label:'Mon',value:210},{label:'Tue',value:205},{label:'Wed',value:null},{label:'Thu',value:190},{label:'Fri',value:184}]},{id:'requests',label:'Requests',value:1280},{id:'missing',label:'Error budget',value:null}],source:'Supplied synthetic telemetry; no monitoring service is connected.'};
const choices={title:'Choose hosting',criteria:[{id:'price',label:'Monthly price',unit:'credits'},{id:'capacity',label:'Project slots'},{id:'region',label:'Region'}],options:[{id:'small',label:'Starter',summary:'For one active project.',values:{price:12,capacity:1,region:'EU'}},{id:'large',label:'Team',summary:'Room for the shared workspace.',values:{price:28,capacity:6,region:'EU'}},{id:'unknown',label:'Custom',values:{price:null,capacity:null,region:'EU'}}],source:'Synthetic supplied plan comparison; no purchase is performed.'};
async function open(page:Page,name:'Stats'|'Comparison',data:unknown){const snapshot=taskFixture({root:'view',elements:{view:{type:name,props:{dataBinding:'data',stateKey:'selected',...(name==='Comparison'?{actionId:'ask',actionLabel:'Review selected plan'}:{})}}}},{data});return {snapshot,host:await serveTaskFixture(page,snapshot)};}

test('stats select a sourced metric, retain explicit unknowns and preserve selection through updates and reload',async({page})=>{
 const {host}=await open(page,'Stats',metrics);await page.goto('/');
 const value=page.getByRole('region',{name:'Selected statistic',exact:true});await expect(value).toContainText('184');await expect(value).toContainText('-12%');
 await page.getByRole('tab',{name:'Error budget',exact:true}).click();await expect(value).toContainText('Unavailable');await expect(value.locator('.everyday-stat-value')).not.toContainText('0');
 await page.getByRole('tab',{name:'Requests',exact:true}).click();await expect.poll(()=>host.snapshot.userStates[0].values.selected).toBe('requests');
 host.setInput('data',{...metrics,metrics:metrics.metrics.map(item=>item.id==='requests'?{...item,value:1295}:item)});await host.publish();await expect(value).toContainText('1,295');
 await page.reload();await expect(page.getByRole('tab',{name:'Requests',exact:true})).toHaveAttribute('aria-selected','true');await expect(value).toContainText('1,295');
});
test('statistical trends leave gaps for missing evidence and provide the exact values for inspection',async({page})=>{
 await open(page,'Stats',metrics);await page.goto('/');await expect(page.getByRole('img',{name:'Response time trend',exact:true})).toBeVisible();
 const path=await page.locator('.everyday-trend-line').getAttribute('d');expect(path?.match(/M/g)?.length).toBe(2);expect(path).not.toMatch(/NaN|Infinity/);
 await page.getByText('View source values',{exact:true}).click();const table=page.getByRole('table',{name:'Response time source values',exact:true});await expect(table).toContainText('Wed');await expect(table).toContainText('Unavailable');
});
test('comparison keeps all options visible, filters only equal criteria and submits only a selected identity',async({page})=>{
 const {host}=await open(page,'Comparison',choices);await page.goto('/');
 const table=page.getByRole('table',{name:'Compare options',exact:true});await expect(table).toContainText('Starter');await expect(table).toContainText('Team');await expect(table).toContainText('Unavailable');
 await page.getByRole('button',{name:'Select Team',exact:true}).click();await page.getByRole('checkbox',{name:'Differences only',exact:true}).check();await expect(table.getByRole('rowheader',{name:'Region',exact:true})).toHaveCount(0);await expect(table.getByRole('rowheader',{name:/Monthly price/})).toBeVisible();
 await expect.poll(()=>host.snapshot.userStates[0].values.selected).toMatchObject({selectedId:'large',differencesOnly:true});await page.reload();await expect(page.getByRole('button',{name:'Select Team',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.getByRole('checkbox',{name:'Differences only',exact:true})).toBeChecked();
 await page.getByRole('button',{name:'Review selected plan',exact:true}).click();await expect.poll(()=>host.commands.filter(command=>command.type==='action.submit').length).toBe(1);expect(host.commands.find(command=>command.type==='action.submit')?.payload.payload).toEqual({optionId:'large',label:'Team'});
});

test('comparison retains complete decision facts at desktop and narrow widths',async({page})=>{
 const fact='Only if product accepts pending acknowledgement: durable handoff, idempotency, deduplication, status reconciliation and bounded Retry-After-aware retries.';
 await open(page,'Comparison',{...choices,options:choices.options.map(option=>({...option,values:{...option.values,region:fact}}))});
 await page.goto('/');
 const cell=page.getByRole('table',{name:'Compare options',exact:true}).getByRole('cell',{name:fact,exact:true}).first();
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await expect(cell).toBeVisible();
  const reading=await cell.evaluate(node=>({whiteSpace:getComputedStyle(node).whiteSpace,clipped:node.scrollHeight>node.clientHeight+1||node.scrollWidth>node.clientWidth+1}));
  expect(reading.whiteSpace).toBe('normal');expect(reading.clipped).toBe(false);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 }
});

async function credentials(page:Page,{outerForm=false,ambiguous=false}:{outerForm?:boolean;ambiguous?:boolean}={}){
 const elements:Record<string,{type:string;props:Record<string,unknown>;children?:string[]}>= {credential:{type:'CredentialEntry',props:{slotKey:'apiToken',label:'Project API token',service:'Example project API'}}};if(outerForm)elements.form={type:'Form',props:{actionId:'ask'},children:['credential']};
 const snapshot=taskFixture({root:outerForm?'form':'credential',elements});const host=await serveTaskFixture(page,snapshot);let meta={present:false,version:0,expiresAt:null as number|null};const writes:{method:string;body:Record<string,unknown>}[]=[];
 await page.route('**/api/artifacts/task-surface/credentials/apiToken*',async route=>{const method=route.request().method();if(method==='GET')return route.fulfill({json:meta});const body=route.request().postDataJSON();writes.push({method,body});if(method==='PUT'){meta={present:true,version:meta.version+1,expiresAt:Date.now()+3600000};if(ambiguous){ambiguous=false;return route.abort('failed');}}else meta={present:false,version:meta.version+1,expiresAt:null};return route.fulfill({json:meta});});
 await page.goto('/');return {host,writes,snapshot};
}
test('private credential entry clears its field and never sends a secret through commands or the draft journal',async({page})=>{
 const {host,writes}=await credentials(page,{outerForm:true});const token=page.getByLabel('Project API token',{exact:true});await expect(token).toBeEnabled();await token.fill('SYNTHETIC-ONLY-private-sentinel');await token.press('Enter');
 await expect(page.getByText('Saved for this host session',{exact:true})).toBeVisible();await expect(token).toHaveValue('');expect(writes).toHaveLength(1);expect(writes[0]).toMatchObject({method:'PUT',body:{artifactRevision:1,threadId:'task-thread',version:0,token:'SYNTHETIC-ONLY-private-sentinel'}});expect(host.commands.filter(command=>command.type==='action.submit')).toHaveLength(0);expect(JSON.stringify(host.commands)).not.toContain('private-sentinel');
 const stored=await page.evaluate(async()=>{const records=await new Promise<unknown[]>((resolve,reject)=>{const opening=indexedDB.open('generative-harness-journal',1);opening.onsuccess=()=>{const db=opening.result,request=db.transaction('entries').objectStore('entries').getAll();request.onsuccess=()=>{resolve(request.result);db.close();};request.onerror=()=>reject(request.error);};opening.onerror=()=>reject(opening.error);});return JSON.stringify({records,local:Object.fromEntries(Object.entries(localStorage))});});expect(stored).not.toContain('private-sentinel');
 await page.getByRole('button',{name:'Remove token',exact:true}).click();await expect(page.getByText('No token saved',{exact:true})).toBeVisible();expect(writes[1].method).toBe('DELETE');
});
test('ambiguous credential writes are not replayed and metadata distinguishes saved state from an uncertain acknowledgment',async({page})=>{
 const {writes}=await credentials(page,{ambiguous:true});await page.getByLabel('Project API token',{exact:true}).fill('SYNTHETIC-ONLY-ambiguous');await page.getByRole('button',{name:'Save token',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText(/confirm|interrupted|saved/i);await expect(page.getByText('Saved for this host session',{exact:true})).toBeVisible();expect(writes.filter(write=>write.method==='PUT')).toHaveLength(1);await expect(page.getByLabel('Project API token',{exact:true})).toHaveValue('');
});

test('credential status refresh recovers from an unavailable request without retaining its old error',async({page})=>{
 const {snapshot}=await credentials(page);let fail=true;
 await page.route('**/api/artifacts/task-surface/credentials/apiToken*',route=>fail?route.fulfill({status:503,json:{error:{code:'UNAVAILABLE',message:'Synthetic outage'}}}):route.fulfill({json:{present:false,version:0,expiresAt:null}}));
 await page.reload();await expect(page.getByRole('alert')).toContainText('unavailable');await expect(page.locator('.credential-status')).toContainText('Status unavailable');fail=false;
 await page.getByRole('button',{name:'Refresh status',exact:true}).click();await expect(page.getByLabel('Project API token',{exact:true})).toBeEnabled();await expect(page.getByRole('alert')).toHaveCount(0);expect(snapshot.artifacts[0].revision).toBe(1);
});
test('inactive retained artifact clears private input without unmounting it',async({page})=>{
 await credentials(page);
 const entry=await (await page.request.get('/src/main.tsx')).text(),context=await (await page.request.get('/src/secure-artifact-context.tsx')).text(),react=context.match(/from ["']([^"']+\/react\.js\?[^"']*)["']/)?.[1],dom=entry.match(/from ["']([^"']+\/react-dom_client\.js\?[^"']*)["']/)?.[1];expect(react).toBeTruthy();expect(dom).toBeTruthy();
 await page.route('**/__everyday-active',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module">
 import React from ${JSON.stringify(react)};import ReactDOM from ${JSON.stringify(dom)};
 import {SecureArtifactProvider} from '/src/secure-artifact-context.tsx';import {CredentialEntry} from '/src/CredentialEntry.tsx';
 function Fixture(){const [active,setActive]=React.useState(true);return React.createElement(React.Fragment,null,React.createElement('button',{onClick:()=>setActive(value=>!value)},'Switch thread'),React.createElement(SecureArtifactProvider,{value:{artifactId:'task-surface',threadId:'task-thread',revision:1,active}},React.createElement(CredentialEntry,{slotKey:'apiToken',label:'Project API token',service:'Example project API'})));}
 ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Fixture));</script></body></html>`}));
 await page.goto('/__everyday-active');const input=page.getByLabel('Project API token',{exact:true});await expect(input).toBeEnabled();await input.fill('SYNTHETIC-ONLY-unsent');const original=await input.elementHandle();
 await page.getByRole('button',{name:'Switch thread',exact:true}).click();await expect(input).toHaveValue('');await expect(input).toBeDisabled();expect(await input.evaluate((current,prior)=>current===prior,original)).toBe(true);
 await page.getByRole('button',{name:'Switch thread',exact:true}).click();await expect(input).toBeEnabled();await expect(input).toHaveValue('');
});

test('a late credential acknowledgment cannot replace the newer slot version after an artifact update',async({page})=>{
 const {host,snapshot,writes}=await credentials(page);let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});let version=0;
 await page.route('**/api/artifacts/task-surface/credentials/apiToken*',async route=>{
  const method=route.request().method();if(method==='GET')return route.fulfill({json:{present:version>0,version,expiresAt:version?Date.now()+3600000:null}});
  const body=route.request().postDataJSON();writes.push({method,body});const own=++version;if(method==='PUT'&&own===1)await held;return route.fulfill({json:{present:method==='PUT',version:own,expiresAt:method==='PUT'?Date.now()+3600000:null}});
 });
 const input=page.getByLabel('Project API token',{exact:true});await expect(input).toBeEnabled();await input.fill('SYNTHETIC-ONLY-first');await page.getByRole('button',{name:'Save token',exact:true}).click();await expect.poll(()=>writes.length).toBe(1);
 snapshot.artifacts[0].revision++;await host.publish();await expect(page.getByText('Saved for this host session',{exact:true})).toBeVisible();await expect(input).toBeEnabled();await input.fill('SYNTHETIC-ONLY-second');await page.getByRole('button',{name:'Replace token',exact:true}).click();await expect.poll(()=>writes.length).toBe(2);await expect(input).toBeEnabled();release();
 await page.getByRole('button',{name:'Remove token',exact:true}).click();await expect.poll(()=>writes.length).toBe(3);expect(writes.map(write=>write.body.version)).toEqual([0,1,2]);await expect(page.getByText('No token saved',{exact:true})).toBeVisible();
});
for(const name of ['Stats','Comparison'] as const)test(`${name} supports narrow keyboard selection and rejects oversized sources`,async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});const {host}=await open(page,name,name==='Stats'?metrics:choices);await page.goto('/');
 if(name==='Stats'){await page.getByRole('tab',{name:'Response time',exact:true}).focus();await page.keyboard.press('ArrowRight');await expect(page.getByRole('tab',{name:'Requests',exact:true})).toBeFocused();}else{await page.getByRole('button',{name:'Select Team',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('button',{name:'Select Team',exact:true})).toHaveAttribute('aria-pressed','true');}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);host.setInput('data',name==='Stats'?{metrics:new Array(13)}:{options:new Array(7),criteria:[]});await host.publish();await expect(page.locator('.everyday-unavailable')).toBeVisible();await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();
});

if(process.env.HARNESS_EVERYDAY_CAPTURE)test('captures the everyday interfaces in both themes and a narrow layout',async({browser})=>{
 const folder='.harness-everyday-captures';await mkdir(folder,{recursive:true});await writeFile(folder+'/README.md','Synthetic intercepted protocol fixtures for trusted catalog UI review. No model, real API credentials or external monitoring service was used. Credential screenshots show an empty private input.\n');
 for(const name of ['Stats','Comparison','CredentialEntry'] as const)for(const variant of ['light','dark','narrow'] as const){
  const page=await browser.newPage({viewport:variant==='narrow'?{width:390,height:844}:{width:1440,height:1000},colorScheme:variant==='dark'?'dark':'light'});
  try{if(name==='CredentialEntry')await credentials(page);else{await open(page,name,name==='Stats'?metrics:choices);await page.goto('/');}await expect(page.locator(name==='Stats'?'.everyday-stats':name==='Comparison'?'.everyday-comparison':'.credential-entry')).toBeVisible();if(name==='CredentialEntry')await expect(page.getByLabel('Project API token',{exact:true})).toBeEnabled();await expect(page.getByText('Unsaved changes',{exact:true})).toHaveCount(0);await page.screenshot({path:`${folder}/${name}-${variant}.png`});}finally{await page.close();}
 }
});
