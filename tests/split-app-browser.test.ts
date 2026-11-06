import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {spawn,type ChildProcess} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {chromium,type Browser} from '@playwright/test';
import type {HostCommand} from '../packages/contracts/index.ts';
import type {PluginManifest} from '../packages/plugins/contracts.ts';
import {panelBindingSchema,type SurfaceRef,type WorkspaceEnvelope} from '../packages/contracts/workspace.ts';
import {splitWorkspaceLayoutSchema,type SplitWorkspaceLayout} from '../packages/contracts/split-workspace.ts';
import {createSplitWorkspaceLayout,applySplitWorkspaceCommand} from '../packages/core/split-workspace-layout.ts';
import {planDataId,PLANNING_PROVENANCE} from '../packages/contracts/planning.ts';
import {taskFixture,serveTaskFixture} from './e2e/task-interface-fixture.ts';

const enabled=process.env.GEN_SPLIT_APP_BROWSER==='1';
const root=fileURLToPath(new URL('../',import.meta.url));
const origin='http://127.0.0.1:5598';
const fixtureModule='/@fs/'+encodeURI(fileURLToPath(new URL('./e2e/split-app-fixture.tsx',import.meta.url)).replaceAll('\\','/'));
const stamp='2026-11-04T12:00:00.000Z';
const canonicalPlan=()=>({id:planDataId('thread-a'),threadId:'thread-a',revision:7,provenance:PLANNING_PROVENANCE,createdAt:stamp,value:{version:1,title:'Inspect then verify',steps:[{id:'inspect',title:'Inspect the source',status:'completed',requirements:[{id:'source',label:'Read the actual source',completed:true}]},{id:'verify',title:'Verify the result',status:'working',requirements:[{id:'retention',label:'Retain the original draft',completed:false}]}],agents:[]}});

describe.runIf(enabled)('actual App split workspace',()=>{
 let server:ChildProcess|undefined,browser:Browser|undefined,serverLog='';
 beforeAll(async()=>{
  server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5598','--strictPort'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  server.stdout?.on('data',chunk=>{serverLog+=String(chunk);});server.stderr?.on('data',chunk=>{serverLog+=String(chunk);});
  let ready=false;for(let i=0;i<100;i++){if(server.exitCode!==null)throw Error('Owned Vite exited: '+serverLog);try{const response=await fetch(origin,{signal:AbortSignal.timeout(500)});if(response.ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  if(!ready)throw Error('Owned Vite did not start: '+serverLog);
  browser=await chromium.launch({headless:true,channel:process.env.GEN_TEST_BROWSER_CHANNEL??'chrome'});
 },20000);
 afterAll(async()=>{try{await browser?.close();}finally{if(server&&server.exitCode===null){server.kill();await new Promise<void>(resolve=>{const timer=setTimeout(resolve,2000);server!.once('exit',()=>{clearTimeout(timer);resolve();});});}}});

 async function fixture({plan=false,plugins=[],retainedCanvas=false,retainedPlan=false,unstarted=false,width=1600,height=1000,deferPluginFlush=false,mode='split'}:{plan?:boolean;plugins?:PluginManifest[];retainedCanvas?:boolean;retainedPlan?:boolean;unstarted?:boolean;width?:number;height?:number;deferPluginFlush?:boolean;mode?:'split'|'chat'}={}){
  const page=await browser!.newPage({viewport:{width,height}});page.setDefaultTimeout(7000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript((initialMode)=>{if(window.parent===window){if(!localStorage.getItem('harness:selected-thread'))localStorage.setItem('harness:selected-thread','thread-a');if(initialMode==='split')localStorage.setItem('harness:workspace-mode:v3','split');}},mode);
  const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Synthetic artifact retained in the original renderer'}}}});
  const main={...snapshot.threads[0]!,id:'thread-a',title:'First investigation',projectId:'project-a',projectName:'First project',modelId:'test/model-a'};
  snapshot.threads=[main,{...main,id:'thread-b',title:'Second investigation',projectId:'project-b',projectName:'Second project',modelId:'test/model-b'},{...main,id:'agent-a',title:'Inspect source',kind:'delegate',parentThreadId:'thread-a',status:'working'},{...main,id:'side-a',title:'Related discussion',kind:'side',sideParentId:'thread-a'}];
  if(unstarted)snapshot.threads[0]!.sessionPath=null;
  snapshot.activeThreadId='thread-a';snapshot.settings.theme='dark';snapshot.settings.modelId='test/model-a';snapshot.messages=[{...snapshot.messages[0]!,id:'message-a',threadId:'thread-a',content:'First transcript only'},{...snapshot.messages[0]!,id:'message-b',threadId:'thread-b',content:'Second transcript only'}];
  snapshot.artifacts[0]={...snapshot.artifacts[0]!,threadId:'thread-a',messageId:'message-a'};snapshot.userStates[0]={...snapshot.userStates[0]!,threadId:'thread-a'};
  snapshot.data=[];if(plan)snapshot.data.push(canonicalPlan());
  const host=await serveTaskFixture(page,snapshot);
  let layout=createSplitWorkspaceLayout();layout=applySplitWorkspaceCommand(layout,'view.open',{view:{id:'thread:thread-a',kind:'thread',binding:{authority:{kind:'local'},threadId:'thread-a',projectId:'project-a'}}});
  layout=applySplitWorkspaceCommand(layout,'pane.split',{paneId:'pane-main',newPaneId:'right',splitId:'columns',axis:'horizontal',view:{id:'thread:thread-b',kind:'thread',binding:{authority:{kind:'local'},threadId:'thread-b',projectId:'project-b'}}});
  const envelope:WorkspaceEnvelope={projects:['a','b'].map(key=>({id:'project-'+key,name:key==='a'?'First project':'Second project',authority:{kind:'local'},rootPath:'C:/synthetic/'+key,createdAt:stamp})),state:{version:1,revision:0,activeCanvasId:'workspace-default',canvases:[{version:1,id:'workspace-default',name:'Workspace',preset:'workspace',viewport:{x:0,y:0,zoom:1},panels:[],filter:'active',projectIds:[]}],profiles:[],disabledKinds:[],integrations:{}}};
  if(retainedCanvas)envelope.state.canvases[0]!.panels.push({id:'retained-usage',canvasId:'workspace-default',kind:'usage',binding:{authority:{kind:'local'},threadId:'thread-a',projectId:'project-a'},placement:'canvas',visible:true,collapsed:false,bounds:{x:56,y:72,width:352,height:320},order:9,alwaysOnTop:false});
  if(retainedPlan)envelope.state.canvases[0]!.panels.push({id:'retained-plan',canvasId:'workspace-default',kind:'plan',binding:{authority:{kind:'local'},threadId:'thread-a',projectId:'project-a'},placement:'canvas',visible:true,collapsed:false,bounds:{x:56,y:72,width:480,height:560},order:10,alwaysOnTop:false});
  if(retainedCanvas||retainedPlan)envelope.state.profiles.push({version:1,id:'retained-desk',name:'Retained desk',createdAt:stamp,updatedAt:stamp,canvases:structuredClone(envelope.state.canvases),activeCanvasId:envelope.state.activeCanvasId,disabledKinds:[],integrations:{}});
  const splitCommands:HostCommand[]=[],workspaceCommands:HostCommand[]=[],receipts=new Map<string,unknown>();
  const profiles=new Map<string,{id:string;name:string;updatedAt:string;layout:SplitWorkspaceLayout}>();
  const authorize=(view:SurfaceRef)=>{if(view.binding.authority.kind!=='local'||view.binding.liveProject)throw Error('Only explicit local view bindings belong to this workspace.');if(view.binding.threadId){const owner=snapshot.threads.find(thread=>thread.id===view.binding.threadId);if(!owner)throw Error('The owning conversation is unavailable.');if(view.binding.projectId!==undefined&&view.binding.projectId!==owner.projectId)throw Error('The conversation project binding changed.');}};
  await page.route('**/api/models?*',route=>route.fulfill({json:{models:[{id:'test/model-a',provider:'test',name:'Model A'},{id:'test/model-b',provider:'test',name:'Model B'}]}}));
  await page.route('**/api/workspace',route=>route.fulfill({json:envelope}));
  await page.route('**/api/workspace/commands',async route=>{const command=route.request().postDataJSON() as HostCommand;workspaceCommands.push(command);if(command.type==='workspace.profile.apply'){const saved=envelope.state.profiles.find(profile=>profile.id===command.payload.profileId)!;envelope.state.canvases=structuredClone(saved.canvases);envelope.state.activeCanvasId=saved.activeCanvasId;}if(command.type==='workspace.canvas.select')envelope.state.activeCanvasId=String(command.payload.canvasId);if(command.type==='workspace.project.connect'){const target=snapshot.threads.find(thread=>thread.id===command.payload.threadId),project=envelope.projects.find(item=>item.rootPath===command.payload.path&&item.name===command.payload.name);if(!target||!project)return route.fulfill({status:404,json:{error:{code:'NOT_FOUND',message:'The canonical project or conversation is unavailable.'}}});if(target.runId||target.sessionPath||target.workspaceId)return route.fulfill({status:409,json:{error:{code:'PROJECT_BUSY',message:'This started conversation keeps its existing project.'}}});target.projectId=project.id;target.projectName=project.name;}envelope.state.revision++;await route.fulfill({json:{commandId:command.id,eventSeq:snapshot.seq,result:envelope}});if(command.type==='workspace.project.connect')await host.publish();});
  await page.route('**/api/commands',async route=>{const command=route.request().postDataJSON() as HostCommand;if(command.type!=='thread.create')return route.fallback();host.commands.push(command);const created={id:'new-thread-'+(snapshot.threads.filter(thread=>thread.id.startsWith('new-thread-')).length+1),title:'New conversation',projectName:null,createdAt:stamp,updatedAt:stamp,status:'ready' as const,epoch:0,runId:null,sessionPath:null,modelId:null,accountId:null};snapshot.threads.push(created);snapshot.seq++;await route.fulfill({json:{commandId:command.id,eventSeq:snapshot.seq,result:created}});await host.publish();});
  await page.route('**/api/split-workspace?*',route=>route.fulfill({json:layout}));
  await page.route('**/api/split-workspace/profiles?*',route=>route.fulfill({json:[...profiles.values()].map(({id,name,updatedAt})=>({id,name,updatedAt}))}));
  await page.route('**/api/split-workspace/commands',route=>{
   const command=route.request().postDataJSON() as HostCommand;splitCommands.push(command);const replay=receipts.get(command.id);if(replay)return route.fulfill({json:replay});
   try{
    const type=command.type.replace(/^split-workspace\./,'');
    if(type==='thread.reconcile'){
     if(Object.keys(command.payload).sort().join(',')!=='baseRevision,expectedBinding,projectId,viewId,workspaceId'||command.payload.workspaceId!==layout.id||command.payload.baseRevision!==layout.revision)throw Error('The captured workspace identity or revision changed.');
     const expected=panelBindingSchema.parse(command.payload.expectedBinding),target=layout.views[String(command.payload.viewId)];
     if(!target||target.kind!=='thread'||target.binding.authority.kind!=='local'||!target.binding.threadId)throw Error('Only an existing local conversation view can be reconciled.');
     if(!isDeepStrictEqual(target.binding,expected))throw Error('The captured conversation owner binding changed.');
     const owner=snapshot.threads.find(thread=>thread.id===target.binding.threadId);if(!owner||(owner.projectId??null)!==command.payload.projectId)throw Error('The canonical conversation project changed.');
     const reconcile=(source:SplitWorkspaceLayout)=>{const next=structuredClone(source);for(const view of Object.values(next.views)){if(view.kind!=='thread'||view.binding.authority.kind!=='local'||view.binding.threadId!==owner.id)continue;if(owner.projectId==null)delete view.binding.projectId;else view.binding.projectId=owner.projectId;}return splitWorkspaceLayoutSchema.parse(next);};
     const next={...reconcile(layout),revision:layout.revision+1},saved=[...profiles.values()].map(profile=>({profile,layout:reconcile(profile.layout)}));authorize(next.views[target.id]!);layout=next;for(const entry of saved)entry.profile.layout=entry.layout;
    }else if(type.startsWith('profile.')){
     if(command.payload.baseRevision!==layout.revision)throw Error('The layout revision changed.');
     const profileId=String(command.payload.profileId??'layout-'+(profiles.size+1)),saved=profiles.get(profileId);
     if(type==='profile.save'){for(const view of Object.values(layout.views))authorize(view);profiles.set(profileId,{id:profileId,name:String(command.payload.name).trim(),updatedAt:stamp,layout:structuredClone(layout)});layout={...layout,revision:layout.revision+1};}
     else if(type==='profile.apply'&&saved){for(const view of Object.values(saved.layout.views))authorize(view);layout={...structuredClone(saved.layout),revision:layout.revision+1};}
     else if(type==='profile.remove'&&saved){profiles.delete(profileId);layout={...layout,revision:layout.revision+1};}
     else throw Error('The saved layout is no longer available.');
    }else{if(command.payload.view)authorize(command.payload.view as SurfaceRef);layout=applySplitWorkspaceCommand(layout,command.type,command.payload);}
    const receipt={commandId:command.id,eventSeq:++snapshot.seq,result:layout};receipts.set(command.id,receipt);return route.fulfill({json:receipt});
   }catch(cause){return route.fulfill({status:409,json:{error:{code:'WORKSPACE_CHANGED',message:cause instanceof Error?cause.message:'Layout changed'}}});}
  });
  await page.route('**/api/projects/*/context?*',route=>{const projectId=new URL(route.request().url()).pathname.split('/')[3]!,project=envelope.projects.find(value=>value.id===projectId)!;return route.fulfill({json:{project,machineName:'Synthetic host',editor:{available:false,label:'Editor'},branch:'feature/fixture',head:null,changes:{added:4,removed:1,files:2},lineage:[],scripts:[],capabilities:{git:true,terminal:false,pullRequests:false}}});});
  await page.route('**/api/plugins',route=>route.fulfill({json:{plugins}}));
  await page.route('**/api/attention',route=>route.fulfill({json:{items:[],unread:0,sequence:snapshot.seq}}));
  await page.route('**/plugins/*/frame?*',route=>{const url=new URL(route.request().url()),session=url.searchParams.get('session'),pluginId=url.pathname.split('/')[2];return route.fulfill({contentType:'text/html',body:`<html><body>Scoped workspace fixture<script>
   const channel=new MessageChannel();window.fixtureConnected=false;window.fixtureFlushPending=[];let hold=${JSON.stringify(deferPluginFlush&&url.searchParams.has('workspace'))};
   const acknowledge=value=>channel.port1.postMessage({type:'gen.plugin.flushed',session:${JSON.stringify(session)},id:value.id,ok:true});window.releaseFixtureFlush=()=>{hold=false;window.fixtureFlushPending.splice(0).forEach(acknowledge);};
   channel.port1.onmessage=e=>{if(e.data.type==='gen.plugin.connected'){window.fixtureConnected=true;channel.port1.postMessage({type:'gen.plugin.ready',pluginId:${JSON.stringify(pluginId)},session:${JSON.stringify(session)}});}if(e.data.type==='gen.plugin.flush'){if(hold)window.fixtureFlushPending.push(e.data);else acknowledge(e.data);}};channel.port1.start();parent.postMessage({type:'gen.plugin.connect',pluginId:${JSON.stringify(pluginId)},session:${JSON.stringify(session)}},'*',[channel.port2]);
  </script></body></html>`});});
  await page.route('**/split-app-check',route=>route.fulfill({contentType:'text/html',body:`<html><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${fixtureModule}');</script></body></html>`}));
  await page.goto(origin+'/split-app-check');
  if(mode==='split'){
   if(width<700)await page.getByRole('combobox',{name:'Active workspace area',exact:true}).selectOption('pane-main');
   await page.locator('[data-split-view="thread:thread-a"]').getByRole('textbox',{name:'Message',exact:true}).waitFor({state:'visible'});
  }else await page.locator('.shell-workarea').getByRole('textbox',{name:'Message',exact:true}).waitFor({state:'visible'});
  return{...host,page,errors,splitCommands,workspaceCommands,envelope,profiles,get layout(){return layout;},async issue(type:string,payload:Record<string,unknown>){layout=applySplitWorkspaceCommand(layout,type,payload);await page.evaluate(()=>window.dispatchEvent(new Event('harness:workspace-changed')));}};
 }

 it('keeps full thread renderers, drafts and exact send owners through tab movement, parking and reload',async()=>{
  const host=await fixture(),{page}=host;try{
   const first=page.locator('[data-split-view="thread:thread-a"]'),second=page.locator('[data-split-view="thread:thread-b"]'),a=first.getByRole('textbox',{name:'Message',exact:true}),b=second.getByRole('textbox',{name:'Message',exact:true});
   await b.waitFor({state:'visible'});expect(await first.getByRole('combobox',{name:'Model',exact:true}).textContent()).toContain('Model A');expect(await second.getByRole('combobox',{name:'Model',exact:true}).textContent()).toContain('Model B');expect(await first.textContent()).toContain('First transcript only');expect(await second.textContent()).toContain('Second transcript only');expect(await first.textContent()).not.toContain('Second transcript only');
   await a.fill('First independent draft');await b.fill('Second independent draft');await page.evaluate(()=>{(window as any).savedDraft=document.querySelector('[data-split-view="thread:thread-b"] textarea');});
   const dataTransfer=await page.evaluateHandle(()=>new DataTransfer());await page.locator('[data-split-pane="right"] [role="tab"]').dispatchEvent('dragstart',{dataTransfer});
   const rect=await page.locator('[data-split-pane="pane-main"] .split-pane-slot').boundingBox();if(!rect)throw Error('Missing target pane');await page.locator('.split-workspace').dispatchEvent('drop',{dataTransfer,clientX:rect.x+rect.width/2,clientY:rect.y+rect.height/2});
   await b.waitFor({state:'visible'});expect(await b.inputValue()).toBe('Second independent draft');expect(await page.evaluate(()=>(window as any).savedDraft===document.querySelector('[data-split-view="thread:thread-b"] textarea'))).toBe(true);
   await page.locator('[data-split-pane="pane-main"] .split-area-menu summary').click();await page.getByRole('button',{name:'Park current view',exact:true}).click();await a.waitFor({state:'visible'});expect(await a.inputValue()).toBe('First independent draft');
   if((await page.locator('[data-split-pane="pane-main"] .split-area-menu').getAttribute('open'))===null)await page.locator('[data-split-pane="pane-main"] .split-area-menu summary').click();await page.getByRole('combobox',{name:'Recover parked view'}).selectOption('thread:thread-b');await b.waitFor({state:'visible'});expect(await b.inputValue()).toBe('Second independent draft');
   await page.route('**/api/commands',async route=>{const command=route.request().postDataJSON() as HostCommand;if(command.type==='message.send'){host.commands.push(command);return route.fulfill({status:409,json:{error:{code:'RUN_BUSY',message:'Synthetic send rejected'}}});}await route.fallback();});
   await second.getByRole('button',{name:'Send message',exact:true}).click();await page.getByRole('alert').filter({hasText:'Synthetic send rejected'}).waitFor();expect(host.commands.find(command=>command.type==='message.send')?.threadId).toBe('thread-b');
   await page.reload();const restoredA=first.locator('textarea[aria-label="Message"]'),restoredB=second.locator('textarea[aria-label="Message"]');await restoredA.waitFor({state:'attached'});await restoredB.waitFor({state:'attached'});expect(await restoredA.inputValue()).toBe('First independent draft');expect(await restoredB.inputValue()).toBe('Second independent draft');expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);

 it('places a sidebar thread into a spatial edge target without duplicating its composer',async()=>{
  const host=await fixture(),{page}=host;try{
   const second=page.locator('[data-split-view="thread:thread-b"]'),draft=second.getByRole('textbox',{name:'Message',exact:true});await draft.waitFor({state:'visible'});await draft.fill('Keep sidebar placement draft');
   const transfer=await page.evaluateHandle(()=>new DataTransfer());await page.locator('.sidebar .thread-item').filter({hasText:'Second investigation'}).dispatchEvent('dragstart',{dataTransfer:transfer});
   const box=await page.locator('[data-split-pane="pane-main"] .split-pane-slot').boundingBox();if(!box)throw Error('Missing target');
   const target={clientX:box.x+box.width/2,clientY:box.y+box.height-8};await page.locator('.split-workspace').dispatchEvent('dragover',{dataTransfer:transfer,...target});await page.getByText('Below',{exact:true}).waitFor({state:'visible'});await page.locator('.split-workspace').dispatchEvent('drop',{dataTransfer:transfer,...target});
   await page.waitForFunction(()=>document.querySelectorAll('[data-split-pane]').length===3);expect(Object.values(host.layout.views).filter(view=>view.kind==='thread'&&view.binding.threadId==='thread-b')).toHaveLength(1);expect(await second.locator('textarea[aria-label="Message"]').inputValue()).toBe('Keep sidebar placement draft');expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);

 it('uses one canonical plan in the overview and detailed pane with actual companion sections',async()=>{
  const host=await fixture({plan:true}),{page}=host;try{
   const overview=page.getByRole('region',{name:'Project overview window',exact:true});await overview.waitFor({state:'visible'});
   if(await overview.getByRole('button',{name:'Expand Project overview',exact:true}).isVisible())await overview.getByRole('button',{name:'Expand Project overview',exact:true}).click();
   const summary=overview.getByRole('region',{name:'Plan summary',exact:true});await summary.waitFor({state:'visible'});expect(await summary.getAttribute('data-plan-revision')).toBe('7');expect(await summary.textContent()).toContain('Inspect then verify');expect(await summary.textContent()).toContain('1 of 2 tasks complete');
   await overview.locator('summary').filter({hasText:'Agents and history'}).click();expect(await overview.textContent()).toContain('Inspect source');await overview.locator('summary').filter({hasText:'Side conversations'}).click();expect(await overview.textContent()).toContain('Related discussion');await overview.locator('summary').filter({hasText:'Automations'}).click();expect(await overview.textContent()).toContain('No automation service is connected.');
   await summary.getByRole('button',{name:'Open full plan',exact:false}).click();const detailed=page.locator('[data-split-view="plan:thread-a"]').getByRole('region',{name:'Task plan',exact:true});await detailed.waitFor({state:'visible'});expect(await detailed.textContent()).toContain('Inspect then verify');expect(await detailed.textContent()).toContain('Verify the result');const planPane=Object.values(host.layout.panes).find(pane=>pane.viewIds.includes('plan:thread-a'))!,planBounds=await page.locator('[data-split-pane="'+planPane.id+'"]').boundingBox();expect(planBounds!.width).toBeGreaterThanOrEqual(240);expect(planBounds!.height).toBeGreaterThanOrEqual(180);expect(Object.values(host.layout.views).filter(view=>view.kind==='plan')).toHaveLength(1);expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);

 it('starts a new chat in the chosen project while preserving a started pane and its pinned account',async()=>{
  const host=await fixture(),{page}=host;try{
   const original=host.snapshot.threads.find(thread=>thread.id==='thread-a')!;original.accountId='account-a';await host.publish();const before=structuredClone(original);
   const first=page.locator('[data-split-view="thread:thread-a"]'),draft=first.getByRole('textbox',{name:'Message',exact:true});await draft.fill('Keep the started conversation draft');
   await first.getByRole('button',{name:'Select project',exact:true}).click();const picker=page.getByRole('dialog',{name:'Select project',exact:true});await picker.waitFor({state:'visible'});expect(await picker.textContent()).toContain('Choose a project for a new chat. This chat keeps its current project.');
   await picker.getByRole('button',{name:'New chat in Second project',exact:true}).click();const newView=page.locator('[data-split-view="thread:new-thread-1"]');await newView.getByRole('textbox',{name:'Message',exact:true}).waitFor({state:'visible'});
   expect(host.snapshot.threads.find(thread=>thread.id==='thread-a')).toEqual(before);expect(host.snapshot.threads.find(thread=>thread.id==='new-thread-1')?.projectId).toBe('project-b');
   expect(host.workspaceCommands.filter(command=>command.type==='workspace.project.connect').map(command=>command.payload.threadId)).toEqual(['new-thread-1']);expect(host.commands.some(command=>command.type==='message.send')).toBe(false);
   expect(await first.locator('textarea[aria-label="Message"]').inputValue()).toBe('Keep the started conversation draft');expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);

 it('reconciles an explicitly connected unstarted chat without remounting its composer or changing other saved view owners',async()=>{
  const host=await fixture({unstarted:true}),{page}=host;try{
   const first=page.locator('[data-split-view="thread:thread-a"]'),draft=first.getByRole('textbox',{name:'Message',exact:true});await draft.fill('Keep the same unstarted draft');await page.evaluate(()=>{(window as any).beforeProjectComposer=document.querySelector('[data-split-view="thread:thread-a"] textarea');});
   await host.issue('view.open',{paneId:'pane-main',view:{id:'files:project-a',kind:'files',binding:{authority:{kind:'local'},projectId:'project-a'}}});await host.issue('view.park',{viewId:'files:project-a'});await draft.waitFor({state:'visible'});
   const original=structuredClone(host.snapshot.threads.find(thread=>thread.id==='thread-a')!),captured=structuredClone(host.layout.views['thread:thread-a']!.binding),others=structuredClone(Object.fromEntries(Object.entries(host.layout.views).filter(([id])=>id!=='thread:thread-a')));
   await page.getByRole('button',{name:'Layouts',exact:true}).click();await page.getByRole('button',{name:'Save current layout\u2026',exact:true}).click();await page.getByRole('textbox',{name:'Layout name',exact:true}).fill('Before project change');await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('dialog',{name:'Save current layout',exact:true}).waitFor({state:'detached'});await page.getByRole('button',{name:'Apply Before project change',exact:true}).waitFor({state:'visible'});const profileId=[...host.profiles.keys()][0]!;await page.getByRole('button',{name:'Layouts',exact:true}).click();
   await first.getByRole('button',{name:'Select project',exact:true}).click();const picker=page.getByRole('dialog',{name:'Select project',exact:true});await picker.getByRole('button',{name:'Select Second project',exact:true}).click();await picker.waitFor({state:'hidden'});
   expect(host.snapshot.threads.find(thread=>thread.id==='thread-a')).toEqual({...original,projectId:'project-b',projectName:'Second project'});expect(host.layout.views['thread:thread-a']!.binding).toEqual({...captured,projectId:'project-b'});expect(host.profiles.get(profileId)!.layout.views['thread:thread-a']!.binding.projectId).toBe('project-b');expect(Object.fromEntries(Object.entries(host.layout.views).filter(([id])=>id!=='thread:thread-a'))).toEqual(others);expect(Object.fromEntries(Object.entries(host.profiles.get(profileId)!.layout.views).filter(([id])=>id!=='thread:thread-a'))).toEqual(others);
   const reconciliation=host.splitCommands.find(command=>command.type==='split-workspace.thread.reconcile');expect(reconciliation?.payload.expectedBinding).toEqual(captured);expect(reconciliation?.payload.projectId).toBe('project-b');expect(host.workspaceCommands.filter(command=>command.type==='workspace.project.connect').map(command=>command.payload.threadId)).toEqual(['thread-a']);expect(host.commands.some(command=>command.type==='thread.create'||command.type==='message.send')).toBe(false);expect(await draft.inputValue()).toBe('Keep the same unstarted draft');expect(await page.evaluate(()=>(window as any).beforeProjectComposer===document.querySelector('[data-split-view="thread:thread-a"] textarea'))).toBe(true);expect(await first.getByRole('combobox',{name:'Model',exact:true}).textContent()).toContain('Model A');
   const transfer=await page.evaluateHandle(()=>new DataTransfer());await page.locator('.sidebar .thread-item').filter({hasText:'First investigation'}).dispatchEvent('dragstart',{dataTransfer:transfer});const box=await page.locator('[data-split-pane="right"] .split-pane-slot').boundingBox();if(!box)throw Error('Missing re-placement target');await page.locator('.split-workspace').dispatchEvent('drop',{dataTransfer:transfer,clientX:box.x+box.width/2,clientY:box.y+box.height/2});await page.waitForFunction(()=>document.querySelector('[data-split-view="thread:thread-a"]')?.getAttribute('data-pane-id')==='right');
   await page.getByRole('button',{name:'Layouts',exact:true}).click();await page.getByRole('button',{name:'Actions for Before project change',exact:true}).click();await page.getByRole('menuitem',{name:'Update',exact:true}).click();await expect.poll(()=>host.profiles.get(profileId)!.layout.panes.right!.activeViewId).toBe('thread:thread-a');expect(host.profiles.get(profileId)!.layout.views['thread:thread-a']!.binding.projectId).toBe('project-b');expect(Object.fromEntries(Object.entries(host.layout.views).filter(([id])=>id!=='thread:thread-a'))).toEqual(others);expect(await draft.inputValue()).toBe('Keep the same unstarted draft');expect(await page.evaluate(()=>(window as any).beforeProjectComposer===document.querySelector('[data-split-view="thread:thread-a"] textarea'))).toBe(true);expect(await page.locator('.workspace-error').count()).toBe(0);expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);

 it('renders the canonical detailed plan requirements in an explicitly recovered canvas panel',async()=>{
  const host=await fixture({plan:true,retainedPlan:true}),{page}=host;try{
   const retained=structuredClone(host.envelope);await page.getByRole('button',{name:'Layouts',exact:true}).click();await page.getByRole('button',{name:'Recover Retained desk',exact:true}).click();const panel=page.locator('[data-panel-id="retained-plan"]'),detail=panel.getByRole('region',{name:'Task plan',exact:true});await detail.waitFor({state:'visible'});
   expect(await detail.getByRole('heading',{name:'Inspect then verify',exact:true}).isVisible()).toBe(true);expect(await detail.getByText('Retain the original draft',{exact:true}).isVisible()).toBe(true);await detail.getByRole('button',{name:'Inspect the source Complete',exact:false}).click();expect(await detail.getByText('Read the actual source',{exact:true}).isVisible()).toBe(true);expect(await panel.getByRole('region',{name:'Plan summary',exact:true}).count()).toBe(0);expect({...host.envelope,state:{...host.envelope.state,revision:retained.state.revision}}).toEqual(retained);expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);

 it('keeps a narrow focused composer visible on plan publication until the user opens the full plan',async()=>{
  const host=await fixture({width:680}),{page}=host;try{
   const draft=page.locator('[data-split-view="thread:thread-a"]').getByRole('textbox',{name:'Message',exact:true});await draft.fill('Keep narrow plan publication focus');const focused=host.layout.focusedPaneId,areaCount=Object.keys(host.layout.panes).length;expect((await page.locator('.split-root-workarea').boundingBox())!.width).toBeLessThan(700);host.snapshot.data.push(canonicalPlan());await host.publish();
   const overview=page.getByRole('region',{name:'Project overview window',exact:true}),summary=overview.getByRole('region',{name:'Plan summary',exact:true});await summary.waitFor({state:'visible'});expect(await summary.getAttribute('data-plan-revision')).toBe('7');expect(await summary.textContent()).toContain('Inspect then verify');expect(await draft.isVisible()).toBe(true);expect(await draft.evaluate(node=>node===document.activeElement)).toBe(true);expect(await draft.inputValue()).toBe('Keep narrow plan publication focus');expect(host.layout.focusedPaneId).toBe(focused);expect(Object.keys(host.layout.panes)).toHaveLength(areaCount);expect(Object.values(host.layout.views).some(view=>view.kind==='plan')).toBe(false);
   await summary.getByRole('button',{name:'Open full plan',exact:false}).click();const detail=page.locator('[data-split-view="plan:thread-a"]').getByRole('region',{name:'Task plan',exact:true});await detail.waitFor({state:'visible'});expect(await detail.getByText('Retain the original draft',{exact:true}).isVisible()).toBe(true);expect(await page.locator('[data-split-view="thread:thread-a"] textarea[aria-label="Message"]').inputValue()).toBe('Keep narrow plan publication focus');expect(Object.values(host.layout.views).filter(view=>view.kind==='plan')).toHaveLength(1);expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);

 it('reopens the same parked and minimized detailed plan on fresh validated revisions without taking composer focus',async()=>{
  const host=await fixture({plan:true}),{page}=host;try{
   const draft=page.locator('[data-split-view="thread:thread-a"]').getByRole('textbox',{name:'Message',exact:true}),detail=page.locator('[data-split-view="plan:thread-a"]').getByRole('region',{name:'Task plan',exact:true});await detail.waitFor({state:'visible'});
   const originalAreaCount=Object.keys(host.layout.panes).length;await host.issue('view.park',{viewId:'plan:thread-a'});await detail.waitFor({state:'hidden'});await draft.fill('Retain focus during plan refresh');
   const record=host.snapshot.data.find(item=>item.id===planDataId('thread-a'))!;record.revision=8;record.value={...(record.value as object),title:'Updated verification plan'};await host.publish();
   await page.locator('[aria-label="Plan summary"][data-plan-revision="8"]').waitFor({state:'visible'});await detail.waitFor({state:'visible'});expect(await detail.textContent()).toContain('Updated verification plan');expect(await draft.evaluate(node=>node===document.activeElement)).toBe(true);
   expect(Object.values(host.layout.views).filter(view=>view.kind==='plan')).toHaveLength(1);const pane=Object.values(host.layout.panes).find(item=>item.viewIds.includes('plan:thread-a'))!;
   await host.issue('pane.collapse',{paneId:pane.id,collapsed:true});await detail.waitFor({state:'hidden'});await draft.focus();record.revision=9;record.value={...(record.value as object),title:'Final verification plan'};await host.publish();
   await page.locator('[aria-label="Plan summary"][data-plan-revision="9"]').waitFor({state:'visible'});await detail.waitFor({state:'visible'});expect(await detail.textContent()).toContain('Final verification plan');expect(await draft.evaluate(node=>node===document.activeElement)).toBe(true);expect(Object.values(host.layout.views).filter(view=>view.kind==='plan')).toHaveLength(1);expect(await draft.inputValue()).toBe('Retain focus during plan refresh');expect(Object.keys(host.layout.panes)).toHaveLength(originalAreaCount);expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);

 it('saves and applies split layouts while preserving drafts and the retained v1 canvas through explicit recovery',async()=>{
  const host=await fixture({retainedCanvas:true}),{page}=host;try{
   const a=page.locator('[data-split-view="thread:thread-a"] textarea[aria-label="Message"]'),b=page.locator('[data-split-view="thread:thread-b"] textarea[aria-label="Message"]');
   await a.fill('First layout draft');await b.fill('Second layout draft');const retained=structuredClone(host.envelope);
   await host.issue('view.move',{viewId:'thread:thread-b',paneId:'pane-main'});await host.issue('pane.collapse',{paneId:'right',collapsed:true});await b.waitFor({state:'visible'});
   const saved=structuredClone(host.layout),presentation=(value:SplitWorkspaceLayout)=>({...value,revision:0,undoDepth:0,redoDepth:0});
   await page.getByRole('button',{name:'Layouts',exact:true}).click();await page.getByRole('button',{name:'Save current layout\u2026',exact:true}).click();await page.getByRole('textbox',{name:'Layout name',exact:true}).fill('Review layout');await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('dialog',{name:'Save current layout',exact:true}).waitFor({state:'detached'});
   await page.getByRole('button',{name:'Apply Review layout',exact:true}).waitFor({state:'visible'});expect(host.profiles.size).toBe(1);const profile=[...host.profiles.values()][0]!;expect(presentation(profile.layout)).toEqual(presentation(saved));
   await host.issue('view.move',{viewId:'thread:thread-b',paneId:'right'});await b.waitFor({state:'visible'});expect(host.layout.focusedPaneId).toBe('right');expect(host.layout.panes.right!.collapsed).toBe(false);
   await page.getByRole('button',{name:'Apply Review layout',exact:true}).click();await page.locator('[data-split-pane="right"].is-collapsed').waitFor({state:'visible'});await b.waitFor({state:'visible'});
   expect(presentation(host.layout)).toEqual(presentation(saved));expect(await page.locator('[data-split-pane="pane-main"]').getAttribute('class')).toContain('is-focused');expect(await page.locator('[data-split-pane="pane-main"] [role="tab"][aria-selected="true"]').textContent()).toBe('Second investigation');expect(await a.inputValue()).toBe('First layout draft');expect(await b.inputValue()).toBe('Second layout draft');
   await page.getByRole('button',{name:'Layouts',exact:true}).click();await page.getByRole('button',{name:'Recover Retained desk',exact:true}).click();const legacy=page.locator('[data-panel-id="retained-usage"]');await legacy.waitFor({state:'visible'});
   expect(await legacy.evaluate(node=>{const element=node as HTMLElement;return{left:element.style.left,top:element.style.top,width:element.style.width,height:element.style.height};})).toEqual({left:'56px',top:'72px',width:'352px',height:'320px'});expect({...host.envelope,state:{...host.envelope.state,revision:retained.state.revision}}).toEqual(retained);
   await page.evaluate(()=>localStorage.setItem('harness:workspace-mode:v3','split'));await page.reload();await page.getByRole('button',{name:'Layouts',exact:true}).click();await page.getByRole('button',{name:'Apply Review layout',exact:true}).click();await b.waitFor({state:'visible'});await page.locator('[data-split-pane="right"].is-collapsed').waitFor({state:'visible'});
   expect(presentation(host.layout)).toEqual(presentation(saved));expect(await a.inputValue()).toBe('First layout draft');expect(await b.inputValue()).toBe('Second layout draft');expect({...host.envelope,state:{...host.envelope.state,revision:retained.state.revision}}).toEqual(retained);expect(host.workspaceCommands.map(command=>command.type)).toEqual(['workspace.profile.apply']);expect(host.splitCommands.filter(command=>command.type==='split-workspace.profile.save')).toHaveLength(1);expect(host.splitCommands.filter(command=>command.type==='split-workspace.profile.apply')).toHaveLength(2);expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);

 it('shows installed generic workspaces without replacing the personal workspace bar',async()=>{
  const absent=await fixture();try{expect(await absent.page.getByRole('button',{name:'Company',exact:true}).count()).toBe(0);expect(await absent.page.getByRole('button',{name:'Studio',exact:true}).count()).toBe(0);}finally{await absent.page.close();}
  const plugin:PluginManifest={id:'sample-visuals',name:'Sample visuals',version:'1.0.0',apiVersion:1,compatibleGenVersions:'>=0.6.5 <0.7.0',frontendEntry:'frontend/index.html',hostEntry:'host/index.mjs',workspaces:[{id:'studio',title:'Studio',entryView:'map',defaultLayout:'studio'}]};
  const present=await fixture({plugins:[plugin],deferPluginFlush:true});try{
   const studio=present.page.getByRole('button',{name:'Studio',exact:true});expect(await studio.count()).toBe(1);await studio.click();const frame=present.page.getByTitle('Studio',{exact:true});await frame.waitFor({state:'visible'});expect(await frame.getAttribute('sandbox')).toBe('allow-scripts');expect(await frame.getAttribute('src')).toContain('&workspace=studio&view=map');
   const scoped=await (await frame.elementHandle())!.contentFrame();if(!scoped)throw Error('The Studio iframe is unavailable.');await scoped.waitForFunction(()=>(window as any).fixtureConnected===true);await present.page.getByRole('navigation',{name:'Installed plug-ins',exact:true}).getByRole('button',{name:'Sample visuals',exact:true}).click();await scoped.waitForFunction(()=>(window as any).fixtureFlushPending.length>0);expect(await frame.isVisible()).toBe(true);expect(await studio.getAttribute('aria-pressed')).toBe('true');expect(await present.page.getByTitle('Sample visuals',{exact:true}).count()).toBe(0);await scoped.evaluate(()=>(window as any).releaseFixtureFlush());
   const conversationFrame=present.page.getByTitle('Sample visuals',{exact:true});await conversationFrame.waitFor({state:'visible'});expect(await frame.isVisible()).toBe(false);
   const conversation=await (await conversationFrame.elementHandle())!.contentFrame();if(!conversation)throw Error('The plug-in conversation iframe is unavailable.');await conversation.waitForFunction(()=>(window as any).fixtureConnected===true);
   const workspace=present.page.getByRole('button',{name:'Workspace',exact:true});expect(await workspace.isVisible()).toBe(true);await workspace.click();await present.page.locator('.shell-workarea').getByRole('textbox',{name:'Message',exact:true}).waitFor({state:'visible'});expect(await present.page.locator('.split-workspace').count()).toBe(0);expect(present.errors).toEqual([]);
   }finally{await present.page.close();}
 },30000);

 it('defaults to single-chat view with a top-right workspace panel toggle, hides right popups while open, and removes the split history bar',async()=>{
  const host=await fixture({mode:'chat',plan:true}),{page}=host;try{
   expect(await page.locator('.split-workspace').count()).toBe(0);
   const message=page.locator('.shell-workarea').getByRole('textbox',{name:'Message',exact:true});await message.waitFor({state:'visible'});
   const actionsBox=await page.locator('.composer .composer-secondary-actions').boundingBox(),inputBox=await message.boundingBox();
   expect(actionsBox).not.toBeNull();expect(inputBox).not.toBeNull();expect(Math.abs(actionsBox!.y-inputBox!.y)).toBeLessThanOrEqual(6);expect(inputBox!.x+inputBox!.width).toBeLessThanOrEqual(actionsBox!.x);
   const overview=page.getByRole('region',{name:'Project overview window',exact:true});await overview.waitFor({state:'visible'});
   await page.locator('.sidebar-thread-row').first().getByRole('button',{name:/Options for/}).click();
   expect(await page.getByRole('button',{name:'Place in workspace',exact:false}).count()).toBe(0);
   await page.keyboard.press('Escape');
   await page.getByRole('button',{name:'Panels',exact:true}).click();
   expect(await page.getByRole('menuitem',{name:'Add Conversation panel',exact:true}).count()).toBe(0);
   await page.getByRole('menuitem',{name:'Add Usage panel',exact:true}).click();
   await page.getByRole('complementary',{name:'Workspace panel',exact:true}).waitFor({state:'visible'});
   await page.getByRole('button',{name:'Hide workspace panel',exact:true}).click();
   await page.keyboard.press('Escape');
   await page.getByRole('button',{name:'Open workspace panel',exact:true}).click();
   const panel=page.getByRole('complementary',{name:'Workspace panel',exact:true});await panel.waitFor({state:'visible'});
   await overview.waitFor({state:'hidden'});
   expect(await panel.getByRole('tab',{name:'Plan',exact:true}).isVisible()).toBe(true);expect(await panel.getByRole('tab',{name:'Notes',exact:true}).isVisible()).toBe(true);
   await page.getByRole('button',{name:'Hide workspace panel',exact:true}).click();await panel.waitFor({state:'hidden'});await overview.waitFor({state:'visible'});
   if(await overview.getByRole('button',{name:'Expand Project overview',exact:true}).isVisible())await overview.getByRole('button',{name:'Expand Project overview',exact:true}).click();
   await overview.getByRole('region',{name:'Plan summary',exact:true}).getByRole('button',{name:'Open full plan',exact:false}).click();
   await panel.waitFor({state:'visible'});await overview.waitFor({state:'hidden'});await panel.getByRole('region',{name:'Task plan',exact:true}).waitFor({state:'visible'});
   expect(await panel.locator('.plan-overall-fill').evaluate(node=>(node as HTMLElement).style.width)).toBe('50%');
   await page.getByRole('button',{name:'Close workspace panel',exact:true}).click();await panel.waitFor({state:'hidden'});await overview.waitFor({state:'visible'});
   await page.evaluate(()=>localStorage.setItem('harness:workspace-mode:v3','split'));await page.reload();
   await page.locator('[data-split-view="thread:thread-a"]').getByRole('textbox',{name:'Message',exact:true}).waitFor({state:'visible'});
   expect(await page.getByRole('button',{name:'Undo layout',exact:true}).count()).toBe(0);expect(await page.getByRole('button',{name:'Redo',exact:true}).count()).toBe(0);expect(await page.getByRole('button',{name:'Restore last layout',exact:true}).count()).toBe(0);expect(await page.locator('.split-workspace-hint').count()).toBe(0);
   expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);
 it('a browser dock shares the tool width budget and preserves chat space',async()=>{
  const{page}=await fixture({width:1440,height:900,mode:'chat'});
  try{
   await page.getByRole('button',{name:'Open workspace panel',exact:true}).click();
   await page.evaluate(()=>{const slot=document.createElement('section');slot.className='desktop-browser-dock';slot.setAttribute('aria-label','Synthetic browser geometry');slot.textContent='Browser slot geometry';(document.querySelector('.workspace-tools')??document.querySelector('.shell-workarea'))!.appendChild(slot);});
   const boxes=await page.evaluate(()=>{const box=(selector:string)=>{const a=document.querySelector(selector)!.getBoundingClientRect();return{x:a.x,y:a.y,right:a.right,bottom:a.bottom,width:a.width};};return{chat:box('.summary-layout>.workspace'),panel:box('.workspace-right'),browser:box('.desktop-browser-dock'),owner:box('.shell-workarea')};});
   expect(boxes.chat.width).toBeGreaterThanOrEqual(420);expect(boxes.chat.right).toBeLessThanOrEqual(boxes.panel.x);
   expect(boxes.browser.right).toBeLessThanOrEqual(boxes.owner.right+1);expect(boxes.browser.y).toBeGreaterThanOrEqual(boxes.panel.bottom);
  }finally{await page.close();}
 },20000);
 it('selected artifacts stay inside the stacked tool content without replacing their renderer',async()=>{
  const{page}=await fixture({width:900,height:700,mode:'chat'});
  try{
   const artifact=page.locator('.artifact').first(),original=await artifact.elementHandle();
   await artifact.getByRole('button',{name:'Open artifact in workspace',exact:true}).click();
   await page.locator('.artifact-in-workspace').waitFor({state:'visible'});
   const bounds=await page.evaluate(()=>{const box=(selector:string)=>{const a=document.querySelector(selector)!.getBoundingClientRect();return{x:a.x,y:a.y,right:a.right,bottom:a.bottom};};return{artifact:box('.artifact-in-workspace'),content:box('.workspace-panel-content')};});
   expect(bounds.artifact.y).toBeGreaterThanOrEqual(bounds.content.y);expect(bounds.artifact.bottom).toBeLessThanOrEqual(bounds.content.bottom);
   expect(bounds.artifact.x).toBeGreaterThanOrEqual(bounds.content.x);expect(bounds.artifact.right).toBeLessThanOrEqual(bounds.content.right);
   expect(await artifact.evaluate((node,old)=>node===old,original)).toBe(true);
  }finally{await page.close();}
 },20000);
 for(const size of [{width:1920,height:1080},{width:1440,height:900},{width:1024,height:768}])it(`panel bounds retain chat and title bar at drag extremes ${size.width}x${size.height}`,async()=>{
  const{page}=await fixture({...size,mode:'chat'});
  try{
   await page.getByRole('button',{name:'Open workspace panel',exact:true}).click();
   const separator=page.getByRole('separator',{name:'Resize workspace panel',exact:true});
   for(const end of [1,size.width-1]){
    const handle=(await separator.boundingBox())!;await page.mouse.move(handle.x+handle.width/2,handle.y+30);await page.mouse.down();await page.mouse.move(end,handle.y+30,{steps:5});await page.mouse.up();
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    const boxes=await page.evaluate(()=>{const box=(selector:string)=>{const a=document.querySelector(selector)!.getBoundingClientRect();return{x:a.x,y:a.y,right:a.right,bottom:a.bottom,width:a.width,height:a.height};};return{chat:box('.summary-layout>.workspace'),panel:box('.workspace-right'),owner:box('.shell-workarea'),title:box('.workspace-switcher'),overflow:document.documentElement.scrollWidth-innerWidth};});
    expect(boxes.chat.width).toBeGreaterThanOrEqual(420);expect(boxes.panel.width).toBeLessThanOrEqual(Math.min(720,boxes.owner.width-426)+1);
    expect(boxes.chat.right).toBeLessThanOrEqual(boxes.panel.x);expect(boxes.panel.y).toBeGreaterThanOrEqual(boxes.title.bottom);
    expect(boxes.panel.right).toBeLessThanOrEqual(boxes.owner.right+1);expect(boxes.overflow).toBeLessThanOrEqual(1);
   }
   expect(await page.getByRole('button',{name:'Maximize workspace panel',exact:true}).count()).toBe(0);
  }finally{await page.close();}
 },30000);
 it('panel bounds stack tools below chat in a narrow workarea',async()=>{
  const{page}=await fixture({width:900,height:700,mode:'chat'});
  try{
   await page.getByRole('button',{name:'Open workspace panel',exact:true}).click();
   const boxes=await page.evaluate(()=>{const box=(selector:string)=>{const a=document.querySelector(selector)!.getBoundingClientRect();return{x:a.x,y:a.y,right:a.right,bottom:a.bottom,width:a.width,height:a.height};};return{chat:box('.summary-layout>.workspace'),panel:box('.workspace-right'),owner:box('.shell-workarea'),title:box('.workspace-switcher')};});
   expect(boxes.panel.y).toBeGreaterThanOrEqual(boxes.chat.bottom);expect(boxes.panel.bottom).toBeLessThanOrEqual(boxes.owner.bottom+1);
   expect(boxes.panel.height).toBeLessThanOrEqual(boxes.owner.height*.45+1);expect(boxes.chat.height).toBeGreaterThanOrEqual(240);
   expect(boxes.panel.y).toBeGreaterThanOrEqual(boxes.title.bottom);
  }finally{await page.close();}
 },20000);
});
