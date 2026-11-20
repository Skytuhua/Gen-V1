import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {spawn,type ChildProcess} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {chromium,expect as pw,type Browser} from '@playwright/test';
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
  server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--config','tests/e2e/vite.config.ts','--host','127.0.0.1','--port','5598','--strictPort'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  server.stdout?.on('data',chunk=>{serverLog+=String(chunk);});server.stderr?.on('data',chunk=>{serverLog+=String(chunk);});
  let ready=false;for(let i=0;i<300;i++){if(server.exitCode!==null)throw Error('Owned Vite exited: '+serverLog);try{const response=await fetch(origin,{signal:AbortSignal.timeout(500)});if(response.ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  if(!ready)throw Error('Owned Vite did not start: '+serverLog);
  browser=await chromium.launch({headless:true,channel:process.env.GEN_TEST_BROWSER_CHANNEL??'chrome'});
  // Compile the app graph once here: the first fixture would otherwise carry the
  // cold Vite transform inside its own readiness wait on a loaded runner.
  const warm=await browser.newPage();try{await warm.goto(origin,{timeout:30000,waitUntil:'load'});}finally{await warm.close();}
 },60000);
 afterAll(async()=>{try{await browser?.close();}finally{if(server&&server.exitCode===null){server.kill();await new Promise<void>(resolve=>{const timer=setTimeout(resolve,2000);server!.once('exit',()=>{clearTimeout(timer);resolve();});});}}});

 async function fixture({plan=false,plugins=[],retainedCanvas=false,retainedPlan=false,unstarted=false,width=1600,height=1000,deferPluginFlush=false,mode='split',singleThread=false,mainTabs=false}:{plan?:boolean;plugins?:PluginManifest[];retainedCanvas?:boolean;retainedPlan?:boolean;unstarted?:boolean;width?:number;height?:number;deferPluginFlush?:boolean;mode?:'split'|'chat'|'default';singleThread?:boolean;mainTabs?:boolean}={}){
  const page=await browser!.newPage({viewport:{width,height}});page.setDefaultTimeout(7000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript((initialMode)=>{if(window.parent===window){localStorage.setItem('harness:selected-thread','thread-a');if(initialMode==='split')localStorage.setItem('harness:workspace-mode:v3','split');}},mode);
  const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Synthetic artifact retained in the original renderer'}}}});
  const main={...snapshot.threads[0]!,id:'thread-a',title:'First investigation',projectId:'project-a',projectName:'First project',modelId:'test/model-a'};
  snapshot.threads=[main,{...main,id:'thread-b',title:'Second investigation',projectId:'project-b',projectName:'Second project',modelId:'test/model-b'},{...main,id:'agent-a',title:'Inspect source',kind:'delegate',parentThreadId:'thread-a',status:'working'},{...main,id:'side-a',title:'Related discussion',kind:'side',sideParentId:'thread-a'}];
  if(unstarted)snapshot.threads[0]!.sessionPath=null;
  snapshot.activeThreadId='thread-a';snapshot.settings.theme='dark';snapshot.settings.modelId='test/model-a';snapshot.messages=[{...snapshot.messages[0]!,id:'message-a',threadId:'thread-a',content:'First transcript only'},{...snapshot.messages[0]!,id:'message-b',threadId:'thread-b',content:'Second transcript only'}];
  snapshot.artifacts[0]={...snapshot.artifacts[0]!,threadId:'thread-a',messageId:'message-a'};snapshot.userStates[0]={...snapshot.userStates[0]!,threadId:'thread-a'};
  snapshot.data=[];if(plan)snapshot.data.push(canonicalPlan());
  const host=await serveTaskFixture(page,snapshot);
  let layout=createSplitWorkspaceLayout();
  if(mainTabs){layout=applySplitWorkspaceCommand(layout,'view.open',{view:{id:'thread:thread-a',kind:'thread',binding:{authority:{kind:'local'},threadId:'thread-a',projectId:'project-a'}}});layout=applySplitWorkspaceCommand(layout,'view.open',{paneId:'pane-main',view:{id:'thread:thread-b',kind:'thread',binding:{authority:{kind:'local'},threadId:'thread-b',projectId:'project-b'}}});layout=applySplitWorkspaceCommand(layout,'view.activate',{paneId:'pane-main',viewId:'thread:thread-a'});}
  else{layout=applySplitWorkspaceCommand(layout,'view.open',{view:{id:'thread:thread-a',kind:'thread',binding:{authority:{kind:'local'},threadId:'thread-a',projectId:'project-a'}}});
  if(!singleThread)layout=applySplitWorkspaceCommand(layout,'pane.split',{paneId:'pane-main',newPaneId:'right',splitId:'columns',axis:'horizontal',view:{id:'thread:thread-b',kind:'thread',binding:{authority:{kind:'local'},threadId:'thread-b',projectId:'project-b'}}});}
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
  await page.route('**/api/commands',async route=>{const command=route.request().postDataJSON() as HostCommand;
   if(command.type==='thread.archive'){host.commands.push(command);const id=String(command.threadId??'');snapshot.threads=snapshot.threads.filter(thread=>thread.id!==id);snapshot.activeThreadId=snapshot.threads.find(thread=>thread.kind!=='delegate'&&thread.kind!=='side')?.id??null;const viewId='thread:'+id;delete layout.views[viewId];for(const pane of Object.values(layout.panes)){pane.viewIds=pane.viewIds.filter(value=>value!==viewId);if(pane.activeViewId===viewId)pane.activeViewId=pane.viewIds.at(-1);}layout.parkedViewIds=layout.parkedViewIds.filter(value=>value!==viewId);layout={...layout,revision:layout.revision+1};snapshot.seq++;await route.fulfill({json:{commandId:command.id,eventSeq:snapshot.seq,result:{}}});await host.publish();await page.evaluate(()=>window.dispatchEvent(new Event('harness:workspace-changed')));return;}
   if(command.type!=='thread.create')return route.fallback();host.commands.push(command);const created={id:'new-thread-'+(snapshot.threads.filter(thread=>thread.id.startsWith('new-thread-')).length+1),title:'New conversation',projectName:null,createdAt:stamp,updatedAt:stamp,status:'ready' as const,epoch:0,runId:null,sessionPath:null,modelId:null,accountId:null,...(typeof command.payload.projectId==='string'?{projectId:command.payload.projectId,projectName:envelope.projects.find(project=>project.id===command.payload.projectId)?.name??null}:{})};snapshot.threads.push(created);snapshot.seq++;await route.fulfill({json:{commandId:command.id,eventSeq:snapshot.seq,result:created}});await host.publish();});
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
     else if(type==='profile.rename'&&saved){saved.name=String(command.payload.name).trim();layout={...layout,revision:layout.revision+1};}
     else if(type==='profile.apply'&&saved){for(const view of Object.values(saved.layout.views))authorize(view);layout={...structuredClone(saved.layout),revision:layout.revision+1};}
     else if(type==='profile.remove'&&saved){profiles.delete(profileId);layout={...layout,revision:layout.revision+1};}
     else throw Error('The saved layout is no longer available.');
    }else{if(command.payload.view)authorize(command.payload.view as SurfaceRef);layout=applySplitWorkspaceCommand(layout,command.type,command.payload);}
    const saved=command.type==='split-workspace.profile.save'&&command.payload.resultVersion===2?[...profiles.values()].find(profile=>profile.id===String(command.payload.profileId??'layout-'+profiles.size)):undefined;
    const receipt={commandId:command.id,eventSeq:++snapshot.seq,result:saved?{version:2,layout,profile:{id:saved.id,updatedAt:saved.updatedAt}}:layout};receipts.set(command.id,receipt);return route.fulfill({json:receipt});
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
  // Cold Vite module loading has its own startup budget; interactions retain
  // the seven-second timeout and each test's existing overall bound.
  const served=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/snapshot'&&response.status()===200,{timeout:40000});
  await page.goto(origin+'/split-app-check',{timeout:20000});
  await served;
  if(mode==='split'){
   if(width<700){await page.getByRole('combobox',{name:'Active workspace area',exact:true}).click();await page.getByRole('option',{name:'First investigation',exact:true}).click();}
   await page.locator('[data-split-view="thread:thread-a"]').getByRole('textbox',{name:'Message',exact:true}).waitFor({state:'visible',timeout:20000});
  }else if(mode==='default'){
   await page.locator('[data-split-view="thread:thread-a"] textarea[aria-label="Message"], .shell-workarea textarea[aria-label="Message"]').first().waitFor({state:'visible',timeout:20000});
  }else await page.locator('.shell-workarea').getByRole('textbox',{name:'Message',exact:true}).first().waitFor({state:'visible',timeout:20000});
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
   await page.locator('[data-split-pane="pane-main"]').getByLabel('Area actions',{exact:true}).click();await page.getByRole('menuitem',{name:'Park current view',exact:true}).click();await a.waitFor({state:'visible'});expect(await a.inputValue()).toBe('First independent draft');
   await page.locator('[data-split-pane="pane-main"]').getByLabel('Area actions',{exact:true}).click();await page.getByRole('menuitem',{name:'Recover: Second investigation',exact:true}).click();await b.waitFor({state:'visible'});expect(await b.inputValue()).toBe('Second independent draft');
   await page.route('**/api/commands',async route=>{const command=route.request().postDataJSON() as HostCommand;if(command.type==='message.send'){host.commands.push(command);return route.fulfill({status:409,json:{error:{code:'RUN_BUSY',message:'Synthetic send rejected'}}});}await route.fallback();});
   await second.getByRole('button',{name:'Send message',exact:true}).click();await page.getByRole('alert').filter({hasText:'Synthetic send rejected'}).waitFor();expect(host.commands.find(command=>command.type==='message.send')?.threadId).toBe('thread-b');
   await page.reload();const restoredA=first.locator('textarea[aria-label="Message"]'),restoredB=second.locator('textarea[aria-label="Message"]');await restoredA.waitFor({state:'attached'});await restoredB.waitFor({state:'attached'});expect(await restoredA.inputValue()).toBe('First independent draft');expect(await restoredB.inputValue()).toBe('Second independent draft');expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);

 it('archiving the selected conversation leaves an explicit empty main that never revives activeThreadId, even after reload (T02/R02)',async()=>{
  const host=await fixture({mode:'default',singleThread:true}),{page}=host;try{
   await page.locator('[data-split-view="thread:thread-a"]').getByRole('textbox',{name:'Message',exact:true}).waitFor({state:'visible'});
   await page.getByRole('button',{name:'Options for First investigation',exact:true}).click();
   await page.getByRole('menuitem',{name:'Archive thread',exact:true}).click();
   await page.getByRole('button',{name:'Archive thread',exact:true}).click();
   await page.waitForFunction(()=>!document.querySelector('[data-split-view="thread:thread-a"]'));
   // The host dropped thread-a and pointed activeThreadId at thread-b; give any revival time to land.
   await page.waitForTimeout(750);
   expect(await page.locator('[data-split-view="thread:thread-b"]').count()).toBe(0);
   expect(await page.getByText('Second transcript only').count()).toBe(0);
   await page.reload();
   await page.locator('.shell-workarea, .split-workspace').first().waitFor({state:'visible'});
   await page.waitForTimeout(750);
   expect(await page.locator('[data-split-view="thread:thread-b"]').count()).toBe(0);
   expect(await page.getByText('Second transcript only').count()).toBe(0);
   expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);

 it('detaches a conversation to an independent float with an empty main, and returns it with placement recovery (T02/R02)',async()=>{
  const host=await fixture({mode:'default',singleThread:true}),{page}=host;try{
   const aView=page.locator('[data-split-view="thread:thread-a"]'),bView=page.locator('[data-split-view="thread:thread-b"]');
   const a=aView.getByRole('textbox',{name:'Message',exact:true});
   await a.waitFor({state:'visible'});await a.fill('Float draft A');
   await page.evaluate(()=>{(window as any).floatTextarea=document.querySelector('[data-split-view="thread:thread-a"] textarea');});
   await page.locator('[data-split-pane="pane-main"]').getByLabel('Area actions',{exact:true}).click();
   await page.getByRole('menuitem',{name:'Detach conversation',exact:true}).click();
   await page.waitForFunction(()=>!!document.querySelector('[data-split-view="thread:thread-a"][data-floating="true"]'));
   expect(await a.inputValue()).toBe('Float draft A');
   expect(await page.evaluate(()=>(window as any).floatTextarea===document.querySelector('[data-split-view="thread:thread-a"] textarea'))).toBe(true);
   expect(await page.locator('[data-split-pane="pane-main"] [role="tab"]').count()).toBe(0);
   const floatSurface=page.locator('[data-split-view="thread:thread-a"]');
   const detachBox=(await floatSurface.boundingBox())!;
   const shrinkBox=(await floatSurface.locator('.split-float-resize').boundingBox())!;
   await page.mouse.move(shrinkBox.x+shrinkBox.width/2,shrinkBox.y+shrinkBox.height/2);await page.mouse.down();
   await page.mouse.move(shrinkBox.x+shrinkBox.width/2-220,shrinkBox.y+shrinkBox.height/2-140,{steps:6});await page.mouse.up();
   const startBox=(await floatSurface.boundingBox())!;
   expect(detachBox.width-startBox.width).toBeGreaterThan(100);expect(detachBox.height-startBox.height).toBeGreaterThan(60);
   const gripBox=(await floatSurface.locator('.split-float-grip').boundingBox())!;
   await page.mouse.move(gripBox.x+gripBox.width/2,gripBox.y+gripBox.height/2);await page.mouse.down();
   await page.mouse.move(gripBox.x+gripBox.width/2+90,gripBox.y+gripBox.height/2+50,{steps:6});await page.mouse.up();
   const movedBox=(await floatSurface.boundingBox())!;
   expect(movedBox.x-startBox.x).toBeGreaterThan(60);expect(movedBox.y-startBox.y).toBeGreaterThan(30);
   const resizeBox=(await floatSurface.locator('.split-float-resize').boundingBox())!;
   await page.mouse.move(resizeBox.x+resizeBox.width/2,resizeBox.y+resizeBox.height/2);await page.mouse.down();
   await page.mouse.move(resizeBox.x+resizeBox.width/2+70,resizeBox.y+resizeBox.height/2+60,{steps:6});await page.mouse.up();
   const resizedBox=(await floatSurface.boundingBox())!;
   expect(resizedBox.width-movedBox.width).toBeGreaterThan(40);expect(resizedBox.height-movedBox.height).toBeGreaterThan(30);
   await page.reload();
   await page.waitForFunction(()=>!!document.querySelector('[data-split-view="thread:thread-a"][data-floating="true"]'));
   const restoredBox=(await floatSurface.boundingBox())!;
   expect(Math.abs(restoredBox.x-resizedBox.x)).toBeLessThan(3);expect(Math.abs(restoredBox.width-resizedBox.width)).toBeLessThan(3);
   await page.evaluate(()=>{(window as any).floatTextarea=document.querySelector('[data-split-view="thread:thread-a"] textarea');});
   await page.getByRole('button',{name:/^Second investigation/}).dispatchEvent('click');
   await bView.getByRole('textbox',{name:'Message',exact:true}).waitFor({state:'visible'});
   await page.waitForFunction(()=>!!document.querySelector('[data-split-view="thread:thread-a"][data-floating="true"]'));
   expect(await page.locator('[data-split-pane="pane-main"]').getByRole('tab',{name:/Second investigation/}).count()).toBe(1);
   await bView.getByRole('textbox',{name:'Message',exact:true}).fill('Main draft B');
   await aView.getByRole('button',{name:'Send message',exact:true}).click();
   await bView.getByRole('button',{name:'Send message',exact:true}).dispatchEvent('click');
   await page.waitForFunction(()=>{const ta=document.querySelector<HTMLTextAreaElement>('[data-split-view="thread:thread-a"] textarea');const tb=document.querySelector<HTMLTextAreaElement>('[data-split-view="thread:thread-b"] textarea');return !!ta&&!!tb&&ta.value===''&&tb.value==='';});
   const sends=host.commands.filter(command=>command.type==='message.send');
   expect(sends.map(command=>command.threadId).sort()).toEqual(['thread-a','thread-b']);
   const grip=page.locator('[data-split-view="thread:thread-a"] .split-float-grip');
   await grip.focus();await page.keyboard.press('Enter');
   await page.getByRole('menuitem',{name:'Return to main',exact:true}).waitFor({state:'visible'});
   await page.keyboard.press('Escape');
   await page.waitForFunction(()=>!document.querySelector('.split-float-menu'));
   await grip.click();
   await page.getByRole('menuitem',{name:'Return to main',exact:true}).click();
   await page.waitForFunction(()=>!document.querySelector('[data-split-view="thread:thread-a"][data-floating="true"]'));
   await a.waitFor({state:'visible'});expect(await a.inputValue()).toBe('');
   expect(await page.evaluate(()=>(window as any).floatTextarea===document.querySelector('[data-split-view="thread:thread-a"] textarea'))).toBe(true);
   await page.reload();
   await page.locator('[data-split-view="thread:thread-a"]').getByRole('textbox',{name:'Message',exact:true}).waitFor({state:'visible'});
   expect(await page.locator('[data-split-view="thread:thread-a"][data-floating="true"]').count()).toBe(0);
   expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);

 for(const delta of [0,2]) it(`docked grip preserves placement until a drag and opens its menu for ${delta}px click jitter`,async()=>{
  const host=await fixture(),{page}=host;try{
   const surface=page.locator('[data-split-view="thread:thread-a"]'),draft=surface.getByRole('textbox',{name:'Message',exact:true}),key='harness:conversation-placement:v1:'+host.layout.id;
   await draft.fill('Keep this placement menu draft');
   const grip=page.locator('[data-split-pane="pane-main"]').getByRole('button',{name:/Move or detach/}),box=(await grip.boundingBox())!,x=box.x+box.width/2,y=box.y+box.height/2;
   await page.mouse.move(x,y);await page.mouse.down();
   expect(await page.evaluate(key=>{const value=JSON.parse(localStorage.getItem(key)??'null');return {pending:value?.pending??null,floating:Object.keys(value?.floating??{})};},key)).toEqual({pending:null,floating:[]});
   await page.mouse.move(x+delta,y);await page.mouse.up();
   await pw(page.getByRole('menuitem',{name:'Detach conversation',exact:true})).toBeVisible();
   expect(host.splitCommands.filter(command=>command.type==='split-workspace.view.park')).toHaveLength(0);
   await page.keyboard.press('Escape');await pw(grip).toBeFocused();await page.keyboard.press('Enter');
   await pw(page.getByRole('menuitem',{name:'Detach conversation',exact:true})).toBeVisible();await page.keyboard.press('Escape');
   expect(await surface.getAttribute('data-floating')).toBeNull();expect(await draft.inputValue()).toBe('Keep this placement menu draft');expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);

 for(const interruption of ['pointercancel','capture-loss','Escape','blur'] as const) it(`docked drag ${interruption} cancels its preview without a placement write`,async()=>{
  const host=await fixture(),{page}=host;try{
   const surface=page.locator('[data-split-view="thread:thread-a"]'),draft=surface.getByRole('textbox',{name:'Message',exact:true}),key='harness:conversation-placement:v1:'+host.layout.id;
   await draft.fill('Keep the cancelled docked draft');await draft.evaluate(node=>(node as HTMLTextAreaElement).setSelectionRange(5,9));
   await page.evaluate(()=>{(window as any).cancelledDockInput=document.querySelector('[data-split-view="thread:thread-a"] textarea');window.addEventListener('pointerdown',event=>{(window as any).cancelledDockPointer=event.pointerId;},{once:true,capture:true});});
   const grip=page.locator('[data-split-pane="pane-main"]').getByRole('button',{name:/Move or detach/}),held=(await grip.elementHandle())!,box=(await grip.boundingBox())!,x=box.x+box.width/2,y=box.y+box.height/2,before=(await surface.boundingBox())!;
   await page.mouse.move(x,y);await page.mouse.down();
   const pointerId=await page.evaluate(()=>(window as any).cancelledDockPointer as number);
   expect(await held.evaluate((node,id)=>node.hasPointerCapture(id),pointerId)).toBe(true);
   await page.mouse.move(x+60,y+30);await pw(surface).toHaveAttribute('data-floating','true');
   expect(host.splitCommands.filter(command=>command.type==='split-workspace.view.park')).toHaveLength(0);
   if(interruption==='pointercancel')await held.dispatchEvent('pointercancel',{pointerId,isPrimary:true});
   else if(interruption==='capture-loss')await held.evaluate((node,id)=>node.releasePointerCapture(id),pointerId);
   else if(interruption==='Escape')await page.keyboard.press('Escape');else await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
   await pw(surface).not.toHaveAttribute('data-floating','true');await page.mouse.up();await page.mouse.move(x+100,y+80);
   const after=(await surface.boundingBox())!;expect(after.x).toBeCloseTo(before.x,1);expect(after.width).toBeCloseTo(before.width,1);
   expect(host.splitCommands.filter(command=>command.type==='split-workspace.view.park'||command.type==='split-workspace.pane.split')).toHaveLength(0);
   expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'null')?.pending??null,key)).toBeNull();
   expect(await draft.inputValue()).toBe('Keep the cancelled docked draft');expect(await draft.evaluate(node=>[(node as HTMLTextAreaElement).selectionStart,(node as HTMLTextAreaElement).selectionEnd])).toEqual([5,9]);
   expect(await page.evaluate(()=>(window as any).cancelledDockInput===document.querySelector('[data-split-view="thread:thread-a"] textarea'))).toBe(true);await grip.focus();await page.keyboard.press('Enter');await pw(page.getByRole('menuitem',{name:'Detach conversation',exact:true})).toBeVisible();await page.keyboard.press('Escape');expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);

 it('docked drag admits its final rectangle once at release and retains it through a held matching acknowledgement',async()=>{
  const host=await fixture(),{page}=host;let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});let received!:()=>void;const requested=new Promise<void>(resolve=>{received=resolve;});let attempts=0;
  try{
   await page.route('**/api/split-workspace/commands',async route=>{const command=route.request().postDataJSON();if(command.type==='split-workspace.view.park'){attempts++;received();await held;}await route.fallback();});
   const surface=page.locator('[data-split-view="thread:thread-a"]'),draft=surface.getByRole('textbox',{name:'Message',exact:true}),key='harness:conversation-placement:v1:'+host.layout.id;
   await draft.fill('Keep the acknowledged docked draft');await page.evaluate(()=>(window as any).ackDockInput=document.querySelector('[data-split-view="thread:thread-a"] textarea'));
   const pane=(await page.locator('[data-split-pane="pane-main"]').boundingBox())!,grip=(await page.locator('[data-split-pane="pane-main"]').getByRole('button',{name:/Move or detach/}).boundingBox())!;
   await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();await page.mouse.move(pane.x+pane.width/2,pane.y+pane.height/2);
   expect(attempts).toBe(0);await page.mouse.up();await requested;
   const final=await surface.evaluate(node=>{const el=node as HTMLElement;return {x:parseFloat(el.style.left),y:parseFloat(el.style.top),width:parseFloat(el.style.width),height:parseFloat(el.style.height)};});
   expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'null')?.pending?.floatingAdd['thread:thread-a']?.rect,key)).toEqual(final);
   expect(await draft.inputValue()).toBe('Keep the acknowledged docked draft');release();
   await pw.poll(()=>page.evaluate(key=>{const value=JSON.parse(localStorage.getItem(key)??'null');return value?.pending?null:value?.floating?.['thread:thread-a']?.rect;},key)).toEqual(final);
   expect(attempts).toBe(1);expect(host.splitCommands.filter(command=>command.type==='split-workspace.view.park')).toHaveLength(1);
   expect(await page.evaluate(()=>(window as any).ackDockInput===document.querySelector('[data-split-view="thread:thread-a"] textarea'))).toBe(true);
   await page.reload();await pw(surface).toHaveAttribute('data-floating','true');await pw(draft).toBeEnabled();expect(await draft.inputValue()).toBe('Keep the acknowledged docked draft');
   expect(await surface.evaluate(node=>{const el=node as HTMLElement;return {x:parseFloat(el.style.left),y:parseFloat(el.style.top),width:parseFloat(el.style.width),height:parseFloat(el.style.height)};})).toEqual(final);expect(host.errors).toEqual([]);
  }finally{release();await page.close();}
 },30000);

 for(const focus of ['thread-a','thread-b'] as const) it(`docked drag acknowledgement retains focused Stop owner ${focus}`,async()=>{
  const host=await fixture(),{page}=host;let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});let received!:()=>void;const requested=new Promise<void>(resolve=>{received=resolve;});
  try{
   for(const item of host.snapshot.threads.filter(item=>item.id==='thread-a'||item.id==='thread-b')){item.status='working';item.runId='run-'+item.id;}await host.publish();
   await page.route('**/api/split-workspace/commands',async route=>{if(route.request().postDataJSON().type==='split-workspace.view.park'){received();await held;}await route.fallback();});
   const surface=page.locator('[data-split-view="thread:thread-a"]'),draft=surface.getByRole('textbox',{name:'Message',exact:true}),key='harness:conversation-placement:v1:'+host.layout.id;
   await draft.fill('Keep focused drag draft');const pane=(await page.locator('[data-split-pane="pane-main"]').boundingBox())!,grip=(await page.locator('[data-split-pane="pane-main"]').getByRole('button',{name:/Move or detach/}).boundingBox())!;
   await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();await page.mouse.move(pane.x+pane.width/2,pane.y+pane.height/2);await page.mouse.up();await requested;
   const focused=page.locator(`[data-split-view="thread:${focus}"]`).getByRole('textbox',{name:'Message',exact:true});if(focus==='thread-b')await focused.focus();release();
   await pw.poll(()=>page.evaluate(key=>{const value=JSON.parse(localStorage.getItem(key)??'null');return !value?.pending&&Boolean(value?.floating?.['thread:thread-a']);},key)).toBe(true);
   await pw(focused).toBeFocused();await page.keyboard.press('Escape');
   await pw.poll(()=>host.commands.filter(command=>command.type==='run.stop').map(command=>command.threadId)).toEqual([focus]);expect(await draft.inputValue()).toBe('Keep focused drag draft');expect(host.errors).toEqual([]);
  }finally{release();await page.close();}
 },30000);

 it('docked drag preflight failure retains the current view and draft without sending placement',async()=>{
  const host=await fixture(),{page}=host;try{
   const surface=page.locator('[data-split-view="thread:thread-a"]'),draft=surface.getByRole('textbox',{name:'Message',exact:true});await draft.fill('Keep rejected preflight draft');
   await page.evaluate('import("/src/editor-handoff.ts").then(handoff=>{handoff.registerEditorHandoff("docked-preflight-test",async()=>{throw Error("Docked preflight was rejected.");});})');
   const pane=(await page.locator('[data-split-pane="pane-main"]').boundingBox())!,grip=(await page.locator('[data-split-pane="pane-main"]').getByRole('button',{name:/Move or detach/}).boundingBox())!;
   await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();await page.mouse.move(pane.x+pane.width/2,pane.y+pane.height/2);await page.mouse.up();
   await pw(page.getByRole('alert').filter({hasText:'Docked preflight was rejected.'})).toHaveCount(1);await pw(surface).not.toHaveAttribute('data-floating','true');
   expect(host.splitCommands.filter(command=>command.type==='split-workspace.view.park'||command.type==='split-workspace.pane.split')).toHaveLength(0);expect(await draft.inputValue()).toBe('Keep rejected preflight draft');expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);

 it('a non-primary docked pointer cannot begin or admit placement',async()=>{
  const host=await fixture(),{page}=host;try{
   const draft=page.locator('[data-split-view="thread:thread-a"]').getByRole('textbox',{name:'Message',exact:true});await draft.fill('Keep the primary pointer owner');
   const grip=page.locator('[data-split-pane="pane-main"]').getByRole('button',{name:/Move or detach/});
   await grip.dispatchEvent('pointerdown',{pointerId:77,button:0,buttons:1,isPrimary:false});await grip.dispatchEvent('pointerup',{pointerId:77,button:0,isPrimary:false});
   expect(await page.evaluate(key=>{const value=JSON.parse(localStorage.getItem(key)??'null');return {pending:value?.pending??null,floating:Object.keys(value?.floating??{})};},'harness:conversation-placement:v1:'+host.layout.id)).toEqual({pending:null,floating:[]});expect(await page.locator('[data-split-view="thread:thread-a"]').getAttribute('data-floating')).toBeNull();expect(host.splitCommands.filter(command=>command.type==='split-workspace.view.park')).toHaveLength(0);expect(await draft.inputValue()).toBe('Keep the primary pointer owner');expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);

 for(const finalDock of [false,true]) it(`floating drop uses the owning release target instead of its last hint (${finalDock})`,async()=>{
  const host=await fixture(),{page}=host;try{
   const surface=page.locator('[data-split-view="thread:thread-a"]'),draft=surface.getByRole('textbox',{name:'Message',exact:true});await draft.fill('Keep the terminal drop draft');
   await page.locator('[data-split-pane="pane-main"]').getByLabel('Area actions',{exact:true}).click();await page.getByRole('menuitem',{name:'Detach conversation',exact:true}).click();await pw(surface).toHaveAttribute('data-floating','true');
   await page.evaluate(()=>{(window as any).terminalDropInput=document.querySelector('[data-split-view="thread:thread-a"] textarea');window.addEventListener('pointerdown',event=>{(window as any).terminalDropPointer=event.pointerId;},{once:true,capture:true});});
   const left=(await page.locator('[data-split-pane="pane-main"]').boundingBox())!,right=(await page.locator('[data-split-pane="right"]').boundingBox())!,edge={x:left.x+6,y:left.y+left.height/2},center={x:right.x+right.width/2,y:right.y+right.height/2},grip=surface.locator('.split-float-grip'),box=(await grip.boundingBox())!;
   await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();const last=finalDock?center:edge,terminal=finalDock?edge:center;await page.mouse.move(last.x,last.y);
   await pw(page.locator('.split-drop-preview')).toHaveCount(finalDock?0:1);
   await grip.dispatchEvent('pointerup',{pointerId:await page.evaluate(()=>(window as any).terminalDropPointer as number),button:0,clientX:terminal.x,clientY:terminal.y});await page.mouse.up();
   if(finalDock){await pw.poll(()=>host.splitCommands.filter(command=>command.type==='split-workspace.pane.split').length).toBe(1);await pw(surface).not.toHaveAttribute('data-floating','true');}
   else{await pw(surface).toHaveAttribute('data-floating','true');expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'null')?.pending??null,'harness:conversation-placement:v1:'+host.layout.id)).toBeNull();expect(host.splitCommands.filter(command=>command.type==='split-workspace.pane.split')).toHaveLength(0);}
   expect(await draft.inputValue()).toBe('Keep the terminal drop draft');expect(await page.evaluate(()=>(window as any).terminalDropInput===document.querySelector('[data-split-view="thread:thread-a"] textarea'))).toBe(true);expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);

 it('accepted docked placement with a lost response reconciles without another write',async()=>{
  const host=await fixture(),{page}=host;let attempts=0;let accepted!:()=>void;const written=new Promise<void>(resolve=>{accepted=resolve;});
  try{
   await page.route('**/api/split-workspace/commands',async route=>{const command=route.request().postDataJSON();if(command.type!=='split-workspace.view.park')return route.fallback();attempts++;await host.issue('view.park',{viewId:'thread:thread-a'});await route.abort('failed');accepted();});
   const surface=page.locator('[data-split-view="thread:thread-a"]'),draft=surface.getByRole('textbox',{name:'Message',exact:true});await draft.fill('Keep the uncertain placement draft');
   const pane=(await page.locator('[data-split-pane="pane-main"]').boundingBox())!,grip=(await page.locator('[data-split-pane="pane-main"]').getByRole('button',{name:/Move or detach/}).boundingBox())!;
   await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();await page.mouse.move(pane.x+pane.width/2,pane.y+pane.height/2);expect(attempts).toBe(0);await page.mouse.up();await written;
   expect(host.layout.parkedViewIds).toContain('thread:thread-a');await page.reload();await pw(surface).toHaveAttribute('data-floating','true');await pw(draft).toBeEnabled();expect(await draft.inputValue()).toBe('Keep the uncertain placement draft');expect(attempts).toBe(1);expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);

 for(const action of ['return','dock'] as const) it('placement ACK retains newer focused Stop owner after '+action,async()=>{
  const host=await fixture(),{page}=host;let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});let received!:()=>void;const requested=new Promise<void>(resolve=>{received=resolve;});
  try{
   const surface=page.locator('[data-split-view="thread:thread-a"]');await page.locator('[data-split-pane="pane-main"]').getByLabel('Area actions',{exact:true}).click();await page.getByRole('menuitem',{name:'Detach conversation',exact:true}).click();await pw(surface).toHaveAttribute('data-floating','true');
   for(const item of host.snapshot.threads.filter(item=>item.id==='thread-a'||item.id==='thread-b')){item.status='working';item.runId='run-'+item.id;}await host.publish();
   await page.route('**/api/split-workspace/commands',async route=>{if(route.request().postDataJSON().type===(action==='return'?'split-workspace.view.open':'split-workspace.pane.split')){received();await held;}await route.fallback();});
   if(action==='return'){await surface.locator('.split-float-grip').click();await page.getByRole('menuitem',{name:'Return to main',exact:true}).click();}
   else{const pane=(await page.locator('[data-split-pane="pane-main"]').boundingBox())!,grip=(await surface.locator('.split-float-grip').boundingBox())!;await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();await page.mouse.move(pane.x+6,pane.y+pane.height/2);await page.mouse.up();}
   await requested;const draft=page.locator('[data-split-view="thread:thread-b"]').getByRole('textbox',{name:'Message',exact:true});await draft.fill('Keep the newer focused owner');release();
   await pw.poll(()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'null')?.pending??null,'harness:conversation-placement:v1:'+host.layout.id)).toBeNull();await pw(draft).toBeFocused();await page.keyboard.press('Escape');
   await pw.poll(()=>host.commands.filter(command=>command.type==='run.stop').map(command=>command.threadId)).toEqual(['thread-b']);expect(await draft.inputValue()).toBe('Keep the newer focused owner');expect(host.errors).toEqual([]);
  }finally{release();await page.close();}
 },30000);

 it('docked edge release commits one real split without an intermediate park',async()=>{
  const host=await fixture(),{page}=host;try{
   const surface=page.locator('[data-split-view="thread:thread-a"]'),draft=surface.getByRole('textbox',{name:'Message',exact:true});await draft.fill('Keep direct docking draft');await page.evaluate(()=>(window as any).directDockInput=document.querySelector('[data-split-view="thread:thread-a"] textarea'));
   const pane=(await page.locator('[data-split-pane="pane-main"]').boundingBox())!,grip=(await page.locator('[data-split-pane="pane-main"]').getByRole('button',{name:/Move or detach/}).boundingBox())!;
   await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();await page.mouse.move(pane.x+6,pane.y+pane.height/2);await pw(page.locator('.split-drop-preview')).toHaveCount(1);expect(host.splitCommands.filter(command=>command.type==='split-workspace.view.park'||command.type==='split-workspace.pane.split')).toHaveLength(0);
   await page.mouse.up();await pw.poll(()=>host.splitCommands.filter(command=>command.type==='split-workspace.pane.split').length).toBe(1);await pw(surface).not.toHaveAttribute('data-floating','true');
   expect(host.splitCommands.filter(command=>command.type==='split-workspace.view.park')).toHaveLength(0);expect(Object.keys(host.layout.panes)).toHaveLength(3);expect(await draft.inputValue()).toBe('Keep direct docking draft');expect(await page.evaluate(()=>(window as any).directDockInput===document.querySelector('[data-split-view="thread:thread-a"] textarea'))).toBe(true);expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);

 for(const action of ['detach','return','dock'] as const) it('placement preflight retains its captured revision for '+action,async()=>{
  const host=await fixture(),{page}=host;try{
   const surface=page.locator('[data-split-view="thread:thread-a"]'),draft=surface.getByRole('textbox',{name:'Message',exact:true});await draft.fill('Keep stale preflight draft');
   if(action!=='detach'){await page.locator('[data-split-pane="pane-main"]').getByLabel('Area actions',{exact:true}).click();await page.getByRole('menuitem',{name:'Detach conversation',exact:true}).click();await pw(surface).toHaveAttribute('data-floating','true');}
   await page.evaluate('import("/src/editor-handoff.ts").then(handoff=>{handoff.registerEditorHandoff("held-placement-revision",()=>new Promise(resolve=>{window.placementPreflightHeld=true;window.releasePlacementPreflight=resolve;}));})');
   const revision=host.layout.revision,type=action==='detach'?'split-workspace.view.park':action==='return'?'split-workspace.view.open':'split-workspace.pane.split';
   if(action==='detach'){await page.locator('[data-split-pane="pane-main"]').getByLabel('Area actions',{exact:true}).click();await page.getByRole('menuitem',{name:'Detach conversation',exact:true}).click();}
   else if(action==='return'){await surface.locator('.split-float-grip').click();await page.getByRole('menuitem',{name:'Return to main',exact:true}).click();}
   else{const pane=(await page.locator('[data-split-pane="pane-main"]').boundingBox())!,grip=(await surface.locator('.split-float-grip').boundingBox())!;await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();await page.mouse.move(pane.x+6,pane.y+pane.height/2);await page.mouse.up();}
   await page.waitForFunction(()=>(window as any).placementPreflightHeld===true);await host.issue('view.move',{viewId:'thread:thread-a',paneId:'right'});
   await pw(page.locator('[data-split-pane="right"]').getByRole('tab',{name:'First investigation',exact:true})).toHaveCount(1);const concurrent=structuredClone(host.layout);
   await page.evaluate(()=>(window as any).releasePlacementPreflight());
   await pw.poll(()=>host.splitCommands.filter(command=>command.type===type).at(-1)?.payload.baseRevision).toBe(revision);
   await pw(page.getByRole('alert').filter({hasText:'The layout revision changed.'})).toHaveCount(1);await page.getByRole('alert').filter({hasText:'The layout revision changed.'}).getByRole('button',{name:/^Dismiss /}).click();await pw(page.getByRole('alert').filter({hasText:'The layout revision changed.'})).toHaveCount(0);
   expect(host.layout).toEqual(concurrent);expect(host.layout.panes.right.viewIds).toContain('thread:thread-a');expect(host.layout.parkedViewIds).not.toContain('thread:thread-a');await pw(draft).toHaveValue('Keep stale preflight draft');expect(host.errors).toEqual([]);
  }finally{await page.evaluate(()=>(window as any).releasePlacementPreflight?.()).catch(()=>{});await page.close();}
 },30000);



 for(const terminal of ['click','jitter','move-cancel','resize-cancel','resize-click'] as const)it('shrunken float preserves raw placement after '+terminal,async()=>{
  const host=await fixture(),{page}=host;try{
   const surface=page.locator('[data-split-view="thread:thread-a"]'),draft=surface.getByRole('textbox',{name:'Message',exact:true}),key='harness:conversation-placement:v1:'+host.layout.id;await draft.fill('Preserve the raw floating placement');
   await page.locator('[data-split-pane="pane-main"]').getByLabel('Area actions',{exact:true}).click();await page.getByRole('menuitem',{name:'Detach conversation',exact:true}).click();await pw(surface).toHaveAttribute('data-floating','true');await pw.poll(()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'null')?.pending??null,key)).toBeNull();
   const grip=surface.locator('.split-float-grip');await grip.focus();for(let i=0;i<20;i++)await page.keyboard.press('Shift+ArrowRight');const original=(await surface.boundingBox())!;expect(original.x).toBeGreaterThan(400);const saved=await page.evaluate(key=>localStorage.getItem(key),key);expect(saved).not.toBeNull();
   await page.setViewportSize({width:900,height:700});await pw.poll(async()=>(await surface.boundingBox())!.x).toBeLessThan(original.x-100);const projected=(await surface.boundingBox())!,root=(await page.locator('.split-root-workarea .split-workspace').boundingBox())!;expect(root.y).toBeGreaterThan(projected.y-root.y);
   const handle=terminal.startsWith('resize')?surface.locator('.split-float-resize'):grip,box=(await handle.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
   if(terminal==='jitter')await page.mouse.move(box.x+box.width/2+2,box.y+box.height/2);else if(terminal.endsWith('cancel'))await page.mouse.move(box.x+box.width/2+20,box.y+box.height/2+20);
   if(terminal.endsWith('cancel'))await page.keyboard.press('Escape');await page.mouse.up();await page.keyboard.press('Escape');
   expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe(saved);await pw.poll(()=>surface.boundingBox()).toEqual(projected);
   await page.setViewportSize({width:1600,height:1000});await pw.poll(()=>surface.boundingBox()).toEqual(original);await pw(draft).toHaveValue('Preserve the raw floating placement');expect(host.commands.filter(command=>command.type==='message.send')).toHaveLength(0);expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);
 for(const held of [false,true]) it('viewport shrink retains a visible moved float while '+(held?'held':'idle'),async()=>{
  const host=await fixture(),{page}=host;try{
   const surface=page.locator('[data-split-view="thread:thread-a"]'),draft=surface.getByRole('textbox',{name:'Message',exact:true});await draft.fill('Keep the resized viewport draft');
   await page.locator('[data-split-pane="pane-main"]').getByLabel('Area actions',{exact:true}).click();await page.getByRole('menuitem',{name:'Detach conversation',exact:true}).click();await pw(surface).toHaveAttribute('data-floating','true');
   const grip=surface.locator('.split-float-grip');await grip.focus();for(let i=0;i<20;i++)await page.keyboard.press('Shift+ArrowRight');
   await page.evaluate(()=>(window as any).viewportFloatInput=document.querySelector('[data-split-view="thread:thread-a"] textarea'));const before=(await surface.boundingBox())!;
   expect(before.x).toBeGreaterThan(400);const commands=host.splitCommands.length;
   if(held){const box=(await grip.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+12,box.y+box.height/2+12);}
   await page.setViewportSize({width:900,height:900});await pw.poll(async()=>{const view=(await surface.boundingBox())!,root=(await page.locator('.split-root-workarea .split-workspace').boundingBox())!;return view.x+view.width-(root.x+root.width);}).toBeLessThanOrEqual(-18);
   if(held)await page.mouse.up();await page.setViewportSize({width:1600,height:1000});await pw.poll(async()=>(await surface.boundingBox())!.x).toBeCloseTo(before.x,1);
   expect(host.splitCommands).toHaveLength(commands);await pw(draft).toHaveValue('Keep the resized viewport draft');expect(await page.evaluate(()=>(window as any).viewportFloatInput===document.querySelector('[data-split-view="thread:thread-a"] textarea'))).toBe(true);expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);
 it('viewport reflow cancels a held docked preview without a placement write',async()=>{
  const host=await fixture(),{page}=host;try{
   const surface=page.locator('[data-split-view="thread:thread-a"]'),draft=surface.getByRole('textbox',{name:'Message',exact:true});await draft.fill('Keep the reflowed drag draft');await page.evaluate(()=>(window as any).reflowDockInput=document.querySelector('[data-split-view="thread:thread-a"] textarea'));
   const pane=(await page.locator('[data-split-pane="pane-main"]').boundingBox())!,grip=(await page.locator('[data-split-pane="pane-main"]').getByRole('button',{name:/Move or detach/}).boundingBox())!;
   await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();await page.mouse.move(pane.x+pane.width/2,pane.y+pane.height/2);await pw(surface).toHaveAttribute('data-floating','true');await page.setViewportSize({width:1400,height:900});await pw(surface).not.toHaveAttribute('data-floating','true');await page.mouse.up();
   expect(host.splitCommands.filter(command=>command.type==='split-workspace.view.park'||command.type==='split-workspace.pane.split')).toHaveLength(0);await pw(draft).toHaveValue('Keep the reflowed drag draft');expect(await page.evaluate(()=>(window as any).reflowDockInput===document.querySelector('[data-split-view="thread:thread-a"] textarea'))).toBe(true);expect((await surface.boundingBox())!.width).toBeLessThan(pane.width-50);expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);

 for(const terminal of ['pointerup','pointercancel'] as const) it(`docked drag keeps its owning pointer after a foreign ${terminal}`,async()=>{
  const host=await fixture(),{page}=host;try{
   const surface=page.locator('[data-split-view="thread:thread-a"]'),draft=surface.getByRole('textbox',{name:'Message',exact:true});
   await draft.fill('Keep this docked drag draft');
   await page.evaluate(()=>{(window as any).dockedDragInput=document.querySelector('[data-split-view="thread:thread-a"] textarea');window.addEventListener('pointerdown',event=>{(window as any).dockedPointer=event.pointerId;},{once:true,capture:true});});
   const grip=page.locator('[data-split-pane="pane-main"]').getByRole('button',{name:/Move or detach/}),box=(await grip.boundingBox())!,x=box.x+box.width/2,y=box.y+box.height/2,target=(await page.locator('[data-split-pane="right"]').boundingBox())!,targetX=target.x+target.width*.4,targetY=target.y+target.height/2;
   await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(targetX-20,targetY);
   await pw(surface).toHaveAttribute('data-floating','true');
   await page.mouse.move(targetX,targetY);const before=(await surface.boundingBox())!;
   await page.evaluate(type=>window.dispatchEvent(new PointerEvent(type,{pointerId:(window as any).dockedPointer+100,isPrimary:false,bubbles:true})),terminal);
   await page.mouse.move(targetX+40,targetY);
   await pw.poll(async()=>(await surface.boundingBox())!.x).toBeGreaterThan(before.x+20);
   await page.mouse.up();
   await pw.poll(()=>host.splitCommands.filter(command=>command.type==='split-workspace.view.park').length).toBe(1);
   await pw.poll(()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'null')?.pending??null,'harness:conversation-placement:v1:'+host.layout.id)).toBeNull();
   const completed=(await surface.boundingBox())!;
   await page.mouse.move(targetX+80,targetY);expect((await surface.boundingBox())!.x).toBeCloseTo(completed.x,1);
   expect(await draft.inputValue()).toBe('Keep this docked drag draft');
   expect(await page.evaluate(()=>(window as any).dockedDragInput===document.querySelector('[data-split-view="thread:thread-a"] textarea'))).toBe(true);
   expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);

 it('detaching from a multi-tab main overrides the previous tab with an explicit empty main, and navigation clears it (T02/R02)',async()=>{
  const host=await fixture({mode:'default',mainTabs:true}),{page}=host;try{
   const aView=page.locator('[data-split-view="thread:thread-a"]'),bView=page.locator('[data-split-view="thread:thread-b"]');
   await aView.getByRole('textbox',{name:'Message',exact:true}).waitFor({state:'visible'});
   expect(await page.locator('[data-split-pane="pane-main"] [role="tab"]').count()).toBe(2);
   await page.locator('[data-split-pane="pane-main"]').getByRole('button',{name:/Move or detach/}).click();await page.getByRole('menuitem',{name:'Detach conversation',exact:true}).click();
   await page.waitForFunction(()=>!!document.querySelector('[data-split-view="thread:thread-a"][data-floating="true"]'));
   await page.waitForFunction(()=>!!document.querySelector('[data-split-pane="pane-main"] .split-empty'));
   expect(await bView.isVisible()).toBe(false);
   expect(await page.locator('[data-split-pane="pane-main"]').getByRole('tab',{name:/Second investigation/}).count()).toBe(1);
   await page.locator('[data-split-pane="pane-main"]').getByRole('tab',{name:/Second investigation/}).dispatchEvent('click');
   await bView.getByRole('textbox',{name:'Message',exact:true}).waitFor({state:'visible'});
   expect(await page.locator('[data-split-pane="pane-main"] .split-empty').count()).toBe(0);
   expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);

 it('keyboard Stop targets the focused float owner exactly once and leaves the main run untouched (AUD-06)',async()=>{
  const host=await fixture({mode:'default',singleThread:true}),{page}=host;try{
   for(const [id,runId] of [['thread-a','run-a'],['thread-b','run-b']] as const){const thread=host.snapshot.threads.find(item=>item.id===id)!;thread.status='working';thread.runId=runId;}
   await host.publish();
   const aView=page.locator('[data-split-view="thread:thread-a"]'),bView=page.locator('[data-split-view="thread:thread-b"]');
   await aView.locator('.working-status').waitFor({state:'visible'});
   await page.locator('[data-split-pane="pane-main"]').getByRole('button',{name:/Move or detach/}).click();await page.getByRole('menuitem',{name:'Detach conversation',exact:true}).click();
   await page.waitForFunction(()=>!!document.querySelector('[data-split-view="thread:thread-a"][data-floating="true"]'));
   await page.getByRole('button',{name:/^Second investigation/}).dispatchEvent('click');
   await bView.locator('.working-status').waitFor({state:'visible'});
   await aView.getByRole('textbox',{name:'Message',exact:true}).focus();
   await page.keyboard.press('Escape');
   await expect.poll(()=>host.commands.filter(command=>command.type==='run.stop').length).toBe(1);
   expect(host.commands.filter(command=>command.type==='run.stop').map(command=>command.threadId)).toEqual(['thread-a']);
   expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);

 it('Thread details preference controls a compact conversation metadata line in main and float (T07/R10)',async()=>{
  const host=await fixture({mode:'default',singleThread:true}),{page}=host;try{
   const metadata=page.locator('[data-split-view="thread:thread-a"] .conversation-metadata');
   await metadata.waitFor({state:'visible'});
   await pw(metadata).toContainText('Model A');
   await pw(metadata).toContainText('First project');
   await pw(metadata).toContainText('Ready');
   const toggle=async()=>{
    await page.getByRole('button',{name:'Settings',exact:true}).dispatchEvent('click');
    const dialog=page.getByRole('dialog',{name:'Settings',exact:true});
    await dialog.getByRole('button',{name:'Chat & Composer',exact:true}).click();
    await dialog.getByRole('switch',{name:'Thread details',exact:true}).click();
    await page.keyboard.press('Escape');
    await pw(dialog).toHaveCount(0);
   };
   await toggle();
   await pw(metadata).toHaveCount(0);
   await page.reload();
   await page.locator('[data-split-view="thread:thread-a"] textarea[aria-label="Message"]').waitFor({state:'visible'});
   await pw(page.locator('[data-split-view="thread:thread-a"] .conversation-metadata')).toHaveCount(0);
   await page.locator('[data-split-pane="pane-main"]').getByRole('button',{name:/Move or detach/}).click();await page.getByRole('menuitem',{name:'Detach conversation',exact:true}).click();
   await page.waitForFunction(()=>!!document.querySelector('[data-split-view="thread:thread-a"][data-floating="true"]'));
   await pw(page.locator('[data-split-view="thread:thread-a"] .conversation-metadata')).toHaveCount(0);
   await toggle();
   const floatMetadata=page.locator('[data-split-view="thread:thread-a"] .conversation-metadata');
   await floatMetadata.waitFor({state:'visible'});
   await pw(floatMetadata).toContainText('Model A');
   expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);

 it('docks a float into a real directional pane split at a main edge (T03/R03 #3/#4)',async()=>{
  const host=await fixture({mode:'split'}),{page}=host;try{
   await page.locator('[data-split-pane="pane-main"]').getByRole('button',{name:/Move or detach/}).click();await page.getByRole('menuitem',{name:'Detach conversation',exact:true}).click();
   await page.waitForFunction(()=>!!document.querySelector('[data-split-view="thread:thread-a"][data-floating="true"]'));
   const gripBox=(await page.locator('[data-split-view="thread:thread-a"] .split-float-grip').boundingBox())!;
   const rightSlot=(await page.locator('[data-split-pane="right"] .split-pane-slot').boundingBox())!;
   await page.mouse.move(gripBox.x+gripBox.width/2,gripBox.y+gripBox.height/2);await page.mouse.down();
   await page.mouse.move(rightSlot.x+8,rightSlot.y+rightSlot.height/2,{steps:8});await page.mouse.up();
   await page.waitForFunction(()=>!document.querySelector('[data-split-view="thread:thread-a"][data-floating="true"]'));
   expect(await page.locator('[data-split-pane]').count()).toBeGreaterThanOrEqual(3);
   expect(await page.locator('[data-split-view="thread:thread-a"]').isVisible()).toBe(true);
   expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);

 it('divider resize reflows real pane widths without scaling content (T03/R04 #4)',async()=>{
  const host=await fixture({mode:'split'}),{page}=host;try{
   const main=page.locator('[data-split-pane="pane-main"]'),divider=page.getByRole('separator',{name:'Resize columns'});
   await divider.waitFor({state:'visible'});
   const before=(await main.boundingBox())!;
   const box=(await divider.boundingBox())!;
   await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
   await page.mouse.move(box.x+box.width/2-120,box.y+box.height/2,{steps:6});await page.mouse.up();
   await page.waitForFunction(width=>{const node=document.querySelector('[data-split-pane="pane-main"]');return !!node&&Math.abs(node.getBoundingClientRect().width-width)>40;},before.width);
   const after=(await main.boundingBox())!;
   expect(Math.abs(after.width-before.width)).toBeGreaterThan(40);
   const scale=await page.locator('[data-split-view="thread:thread-a"]').evaluate(node=>{const m=new DOMMatrixReadOnly(getComputedStyle(node).transform);return m.a;});
   expect(scale).toBe(1);
   expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);

 it('embedded transcript Stop routes through the shared composer owner, not raw run.stop (AUD-05)',async()=>{
  const page=await browser!.newPage({viewport:{width:1200,height:800}});page.setDefaultTimeout(7000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  try{
   const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Synthetic working transcript'}}}});
   const base=snapshot.threads[0]!;
   snapshot.threads=[{...base,id:'thread-a',title:'Working conversation',status:'working',runId:'run-a',modelId:'test/model',projectId:'project-a',projectName:'First project'}];
   snapshot.activeThreadId='thread-a';
   snapshot.messages=[{...snapshot.messages[0]!,id:'message-a',threadId:'thread-a',content:'Working transcript'}];
   snapshot.artifacts=[];snapshot.userStates=[];snapshot.data=[];
   const host=await serveTaskFixture(page,snapshot);
   await page.route('**/api/models?*',route=>route.fulfill({json:{models:[{id:'test/model',provider:'test',name:'Model'}]}}));
   const stopModule='/@fs/'+encodeURI(fileURLToPath(new URL('./e2e/split-stop-owner-fixture.tsx',import.meta.url)).replaceAll('\\','/'));
   await page.route('**/split-stop-check',route=>route.fulfill({contentType:'text/html',body:`<html><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${stopModule}');</script></body></html>`}));
   await page.goto(origin+'/split-stop-check');
   await page.waitForLoadState('networkidle').catch(()=>{});
   const stopButton=page.locator('.working-status').getByRole('button',{name:'Stop',exact:true});
   await stopButton.waitFor({state:'visible'});
   await stopButton.dispatchEvent('click');
   await page.waitForFunction(()=>((window as unknown as {__stopOwnerCalls?:unknown[]}).__stopOwnerCalls??[]).length>0,null,{timeout:4000}).catch(()=>{});
   const calls=await page.evaluate(()=>(window as unknown as {__stopOwnerCalls?:unknown[]}).__stopOwnerCalls??[]);
   expect(calls).toHaveLength(1);
   expect(calls[0]).toMatchObject({kind:'conversation',threadId:'thread-a'});
   expect(host.commands.some(command=>command.type==='run.stop')).toBe(false);
   expect(errors).toEqual([]);
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
   await overview.locator('summary').filter({hasText:'Agents and history'}).click();expect(await overview.textContent()).toContain('Inspect source');await overview.locator('summary').filter({hasText:'Side conversations'}).click();expect(await overview.textContent()).toContain('Related discussion');expect(await overview.locator('summary').filter({hasText:'Automations'}).count()).toBe(0);
   const detailed=page.locator('[data-split-view="plan:thread-a"]').getByRole('region',{name:/^Task plan(?::|$)/});await detailed.waitFor({state:'visible'});expect(await summary.getByRole('button',{name:'Open full plan',exact:false}).count()).toBe(0);expect(await detailed.getAttribute('aria-label')).toBe('Task plan: Inspect then verify');expect(await detailed.textContent()).toContain('Verify the result');const planPane=Object.values(host.layout.panes).find(pane=>pane.viewIds.includes('plan:thread-a'))!,planBounds=await page.locator('[data-split-pane="'+planPane.id+'"]').boundingBox();expect(planBounds!.width).toBeGreaterThanOrEqual(240);expect(planBounds!.height).toBeGreaterThanOrEqual(180);expect(Object.values(host.layout.views).filter(view=>view.kind==='plan')).toHaveLength(1);expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);

 it('starts a new chat in the chosen project while preserving a started pane and its pinned account',async()=>{
  const host=await fixture(),{page}=host;try{
   const original=host.snapshot.threads.find(thread=>thread.id==='thread-a')!;original.accountId='account-a';await host.publish();const before=structuredClone(original);
   const first=page.locator('[data-split-view="thread:thread-a"]'),draft=first.getByRole('textbox',{name:'Message',exact:true});await draft.fill('Keep the started conversation draft');
   await first.getByRole('button',{name:'Select project',exact:true}).click();const picker=page.getByRole('dialog',{name:'Select project',exact:true});await picker.waitFor({state:'visible'});expect(await picker.getByRole('option',{name:'Second project',exact:true}).count()).toBe(1);
   await picker.getByRole('option',{name:'Second project',exact:true}).click();const newView=page.locator('[data-split-view="thread:new-thread-1"]');await newView.getByRole('textbox',{name:'Message',exact:true}).waitFor({state:'visible'});
   expect(host.snapshot.threads.find(thread=>thread.id==='thread-a')).toEqual(before);expect(host.snapshot.threads.find(thread=>thread.id==='new-thread-1')?.projectId).toBe('project-b');
   expect(host.commands.find(command=>command.type==='thread.create')?.payload.projectId).toBe('project-b');expect(host.workspaceCommands.filter(command=>command.type==='workspace.project.connect')).toEqual([]);expect(host.commands.some(command=>command.type==='message.send')).toBe(false);
   expect(await first.locator('textarea[aria-label="Message"]').inputValue()).toBe('Keep the started conversation draft');expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);

 it('reconciles an explicitly connected unstarted chat without remounting its composer or changing other saved view owners',async()=>{
  const host=await fixture({unstarted:true}),{page}=host;try{
   const first=page.locator('[data-split-view="thread:thread-a"]'),draft=first.getByRole('textbox',{name:'Message',exact:true});await draft.fill('Keep the same unstarted draft');await page.evaluate(()=>{(window as any).beforeProjectComposer=document.querySelector('[data-split-view="thread:thread-a"] textarea');});
   await host.issue('view.open',{paneId:'pane-main',view:{id:'files:project-a',kind:'files',binding:{authority:{kind:'local'},projectId:'project-a'}}});await host.issue('view.park',{viewId:'files:project-a'});await draft.waitFor({state:'visible'});
   const original=structuredClone(host.snapshot.threads.find(thread=>thread.id==='thread-a')!),captured=structuredClone(host.layout.views['thread:thread-a']!.binding),others=structuredClone(Object.fromEntries(Object.entries(host.layout.views).filter(([id])=>id!=='thread:thread-a')));
   await page.getByRole('button',{name:'Layouts',exact:true}).click();await page.getByRole('button',{name:'Save current layout\u2026',exact:true}).click();await page.getByRole('textbox',{name:'Layout name',exact:true}).fill('Before project change');await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('dialog',{name:'Save current layout',exact:true}).waitFor({state:'detached'});await page.getByRole('button',{name:'Apply Before project change',exact:true}).waitFor({state:'visible'});const profileId=[...host.profiles.keys()][0]!;await page.getByRole('button',{name:'Layouts',exact:true}).click();
   await first.getByRole('button',{name:'Select project',exact:true}).click();const picker=page.getByRole('dialog',{name:'Select project',exact:true});await picker.getByRole('option',{name:'Second project',exact:true}).click();await picker.waitFor({state:'hidden'});
   expect(host.snapshot.threads.find(thread=>thread.id==='thread-a')).toEqual({...original,projectId:'project-b',projectName:'Second project'});expect(host.layout.views['thread:thread-a']!.binding).toEqual({...captured,projectId:'project-b'});expect(host.profiles.get(profileId)!.layout.views['thread:thread-a']!.binding.projectId).toBe('project-b');expect(Object.fromEntries(Object.entries(host.layout.views).filter(([id])=>id!=='thread:thread-a'))).toEqual(others);expect(Object.fromEntries(Object.entries(host.profiles.get(profileId)!.layout.views).filter(([id])=>id!=='thread:thread-a'))).toEqual(others);
   const reconciliation=host.splitCommands.find(command=>command.type==='split-workspace.thread.reconcile');expect(reconciliation?.payload.expectedBinding).toEqual(captured);expect(reconciliation?.payload.projectId).toBe('project-b');expect(host.workspaceCommands.filter(command=>command.type==='workspace.project.connect').map(command=>command.payload.threadId)).toEqual(['thread-a']);expect(host.commands.some(command=>command.type==='thread.create'||command.type==='message.send')).toBe(false);expect(await draft.inputValue()).toBe('Keep the same unstarted draft');expect(await page.evaluate(()=>(window as any).beforeProjectComposer===document.querySelector('[data-split-view="thread:thread-a"] textarea'))).toBe(true);expect(await first.getByRole('combobox',{name:'Model',exact:true}).textContent()).toContain('Model A');
   const transfer=await page.evaluateHandle(()=>new DataTransfer());await page.locator('.sidebar .thread-item').filter({hasText:'First investigation'}).dispatchEvent('dragstart',{dataTransfer:transfer});const box=await page.locator('[data-split-pane="right"] .split-pane-slot').boundingBox();if(!box)throw Error('Missing re-placement target');await page.locator('.split-workspace').dispatchEvent('drop',{dataTransfer:transfer,clientX:box.x+box.width/2,clientY:box.y+box.height/2});await page.waitForFunction(()=>document.querySelector('[data-split-view="thread:thread-a"]')?.getAttribute('data-pane-id')==='right');
   await page.getByRole('button',{name:'Layouts',exact:true}).click();await page.getByRole('button',{name:'Actions for Before project change',exact:true}).click();await page.getByRole('menuitem',{name:'Update',exact:true}).click();await expect.poll(()=>host.profiles.get(profileId)!.layout.panes.right!.activeViewId).toBe('thread:thread-a');expect(host.profiles.get(profileId)!.layout.views['thread:thread-a']!.binding.projectId).toBe('project-b');expect(Object.fromEntries(Object.entries(host.layout.views).filter(([id])=>id!=='thread:thread-a'))).toEqual(others);expect(await draft.inputValue()).toBe('Keep the same unstarted draft');expect(await page.evaluate(()=>(window as any).beforeProjectComposer===document.querySelector('[data-split-view="thread:thread-a"] textarea'))).toBe(true);expect(await page.locator('.workspace-error').count()).toBe(0);expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);

 it('renders the canonical detailed plan requirements in an explicitly recovered canvas panel',async()=>{
  const host=await fixture({plan:true,retainedPlan:true}),{page}=host;try{
   const retained=structuredClone(host.envelope);await page.getByRole('button',{name:'Layouts',exact:true}).click();await page.getByRole('button',{name:'Recover Retained desk',exact:true}).click();const panel=page.locator('[data-panel-id="retained-plan"]'),detail=panel.getByRole('region',{name:/^Task plan(?::|$)/});await detail.waitFor({state:'visible'});await detail.locator('[data-step-id="inspect"] > .plan-step-summary').click();
   expect(await detail.getAttribute('aria-label')).toBe('Task plan: Inspect then verify');expect(await detail.getByText('Retain the original draft',{exact:true}).isVisible()).toBe(true);expect(await detail.locator('[data-step-id="inspect"] > .plan-step-summary').getAttribute('aria-expanded')).toBe('true');expect(await detail.getByText('Read the actual source',{exact:true}).isVisible()).toBe(true);expect(await panel.getByRole('region',{name:'Plan summary',exact:true}).count()).toBe(0);expect({...host.envelope,state:{...host.envelope.state,revision:retained.state.revision}}).toEqual(retained);expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);

 it('keeps a narrow focused composer visible on plan publication until the user opens the full plan',async()=>{
  const host=await fixture({width:680}),{page}=host;try{
   const draft=page.locator('[data-split-view="thread:thread-a"]').getByRole('textbox',{name:'Message',exact:true});await draft.fill('Keep narrow plan publication focus');const focused=host.layout.focusedPaneId,areaCount=Object.keys(host.layout.panes).length;expect((await page.locator('.split-root-workarea').boundingBox())!.width).toBeLessThan(700);host.snapshot.data.push(canonicalPlan());await host.publish();
   const overview=page.getByRole('region',{name:'Project overview window',exact:true}),summary=overview.getByRole('region',{name:'Plan summary',exact:true});await summary.waitFor({state:'visible'});expect(await summary.getAttribute('data-plan-revision')).toBe('7');expect(await summary.textContent()).toContain('Inspect then verify');expect(await draft.isVisible()).toBe(true);expect(await draft.evaluate(node=>node===document.activeElement)).toBe(true);expect(await draft.inputValue()).toBe('Keep narrow plan publication focus');expect(host.layout.focusedPaneId).toBe(focused);expect(Object.keys(host.layout.panes)).toHaveLength(areaCount);expect(Object.values(host.layout.views).some(view=>view.kind==='plan')).toBe(false);
   await summary.getByRole('button',{name:'Open full plan',exact:false}).click();const detail=page.locator('[data-split-view="plan:thread-a"]').getByRole('region',{name:/^Task plan(?::|$)/});await detail.waitFor({state:'visible'});expect(await detail.getByText('Retain the original draft',{exact:true}).isVisible()).toBe(true);expect(await page.locator('[data-split-view="thread:thread-a"] textarea[aria-label="Message"]').inputValue()).toBe('Keep narrow plan publication focus');expect(Object.values(host.layout.views).filter(view=>view.kind==='plan')).toHaveLength(1);expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);

 it('reopens the same parked and minimized detailed plan on fresh validated revisions without taking composer focus',async()=>{
  const host=await fixture({plan:true}),{page}=host;try{
   const draft=page.locator('[data-split-view="thread:thread-a"]').getByRole('textbox',{name:'Message',exact:true}),detail=page.locator('[data-split-view="plan:thread-a"]').getByRole('region',{name:/^Task plan(?::|$)/});await detail.waitFor({state:'visible'});
   const originalAreaCount=Object.keys(host.layout.panes).length;await host.issue('view.park',{viewId:'plan:thread-a'});await detail.waitFor({state:'hidden'});
   const expandOverview=page.getByRole('button',{name:'Expand Project overview',exact:true});if(await expandOverview.isVisible())await expandOverview.click();
   await draft.fill('Retain focus during plan refresh');
   const record=host.snapshot.data.find(item=>item.id===planDataId('thread-a'))!;record.revision=8;record.value={...(record.value as object),title:'Updated verification plan'};await host.publish();
   // The overview may stay collapsed; its revision still records the publication.
   await page.locator('[aria-label="Plan summary"][data-plan-revision="8"]').waitFor({state:'attached'});await detail.waitFor({state:'visible'});expect(await detail.getAttribute('aria-label')).toBe('Task plan: Updated verification plan');expect(await draft.evaluate(node=>node===document.activeElement)).toBe(true);
   expect(Object.values(host.layout.views).filter(view=>view.kind==='plan')).toHaveLength(1);const pane=Object.values(host.layout.panes).find(item=>item.viewIds.includes('plan:thread-a'))!;
   await host.issue('pane.collapse',{paneId:pane.id,collapsed:true});await detail.waitFor({state:'hidden'});await draft.focus();record.revision=9;record.value={...(record.value as object),title:'Final verification plan'};await host.publish();
   await page.locator('[aria-label="Plan summary"][data-plan-revision="9"]').waitFor({state:'attached'});await detail.waitFor({state:'visible'});expect(await detail.getAttribute('aria-label')).toBe('Task plan: Final verification plan');expect(await draft.evaluate(node=>node===document.activeElement)).toBe(true);expect(Object.values(host.layout.views).filter(view=>view.kind==='plan')).toHaveLength(1);expect(await draft.inputValue()).toBe('Retain focus during plan refresh');expect(Object.keys(host.layout.panes)).toHaveLength(originalAreaCount);expect(host.errors).toEqual([]);
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

 it('uses the exact host save receipt and preserves geometry during name-only Rename',async()=>{
  const host=await fixture();const {page}=host;
  try{
   // Another client creates a layout after this window loaded its empty inventory.
   host.profiles.set('unseen',{id:'unseen',name:'Desk',updatedAt:stamp,layout:structuredClone(host.layout)});
   await page.getByRole('button',{name:'Layouts',exact:true}).click();await page.getByRole('button',{name:'Save current layout…',exact:true}).click();
   await page.getByRole('textbox',{name:'Layout name',exact:true}).fill('Desk');await page.getByRole('button',{name:'Save',exact:true}).click();
   await page.getByRole('dialog',{name:'Save current layout',exact:true}).waitFor({state:'hidden'});
   const row=page.locator('.saved-layout-row[data-layout-key="split:layout-2"]');await row.getByText('Current',{exact:true}).waitFor({state:'visible'});
   expect(host.splitCommands.filter(command=>command.type==='split-workspace.profile.save').map(command=>command.payload.resultVersion)).toEqual([2]);
   const saved=structuredClone(host.profiles.get('layout-2')!.layout);
   await host.issue('pane.resize',{splitId:'columns',ratio:.62});await row.getByText('Modified',{exact:true}).waitFor({state:'visible'});
   const working=structuredClone(host.layout);
   await row.getByRole('button',{name:'Actions for Desk',exact:true}).click();await page.getByRole('menuitem',{name:'Rename',exact:true}).click();
   await page.getByRole('textbox',{name:'Layout name',exact:true}).fill('Review desk');await page.getByRole('button',{name:'Rename',exact:true}).click();
   await page.getByRole('dialog',{name:'Rename layout',exact:true}).waitFor({state:'hidden'});
   expect(host.profiles.get('layout-2')!.name).toBe('Review desk');expect(host.profiles.get('layout-2')!.layout).toEqual(saved);
   expect({...host.layout,revision:0}).toEqual({...working,revision:0});expect(host.splitCommands.filter(command=>command.type==='split-workspace.profile.rename')).toHaveLength(1);expect(host.splitCommands.filter(command=>command.type==='split-workspace.profile.save')).toHaveLength(1);expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },20000);

 it('shows installed generic workspaces without replacing the personal workspace bar',async()=>{
  const absent=await fixture();try{expect(await absent.page.getByRole('button',{name:'Company',exact:true}).count()).toBe(0);expect(await absent.page.getByRole('button',{name:'Studio',exact:true}).count()).toBe(0);}finally{await absent.page.close();}
  const plugin:PluginManifest={id:'sample-visuals',name:'Sample visuals',version:'1.0.0',apiVersion:1,compatibleGenVersions:'>=0.6.5 <0.7.0',frontendEntry:'frontend/index.html',hostEntry:'host/index.mjs',workspaces:[{id:'studio',title:'Studio',entryView:'map',defaultLayout:'studio'}]};
  const present=await fixture({plugins:[plugin],deferPluginFlush:true});try{
   const studio=present.page.getByRole('button',{name:'Studio',exact:true});expect(await studio.count()).toBe(1);await studio.click();const frame=present.page.getByTitle('Studio',{exact:true});await frame.waitFor({state:'visible'});expect(await frame.getAttribute('sandbox')).toBe('allow-scripts');expect(await frame.getAttribute('src')).toContain('&workspace=studio&view=map');
   const scoped=await (await frame.elementHandle())!.contentFrame();if(!scoped)throw Error('The Studio iframe is unavailable.');await scoped.waitForFunction(()=>(window as any).fixtureConnected===true);await present.page.getByRole('navigation',{name:'Installed plug-ins',exact:true}).getByRole('button',{name:'Sample visuals',exact:true}).click();await scoped.waitForFunction(()=>(window as any).fixtureFlushPending.length>0);expect(await frame.isVisible()).toBe(true);expect(await studio.getAttribute('aria-pressed')).toBe('true');expect(await present.page.getByTitle('Sample visuals',{exact:true}).count()).toBe(0);await scoped.evaluate(()=>(window as any).releaseFixtureFlush());
   const conversationFrame=present.page.getByTitle('Sample visuals',{exact:true});await conversationFrame.waitFor({state:'visible'});expect(await frame.isVisible()).toBe(false);
   const conversation=await (await conversationFrame.elementHandle())!.contentFrame();if(!conversation)throw Error('The plug-in conversation iframe is unavailable.');await conversation.waitForFunction(()=>(window as any).fixtureConnected===true);
   const workspace=present.page.getByRole('button',{name:'Workspace',exact:true});expect(await workspace.isVisible()).toBe(true);await workspace.click();await present.page.locator('.shell-workarea').getByRole('textbox',{name:'Message',exact:true}).first().waitFor({state:'visible'});expect(await present.page.locator('.split-workspace').count()).toBeGreaterThan(0);expect(present.errors).toEqual([]);
   }finally{await present.page.close();}
 },30000);

 it('defaults ordinary Workspace to the shared split plane without a pre-seeded split mode (T02/R02)',async()=>{
  const host=await fixture({mode:'default'}),{page}=host;try{
   expect(await page.locator('.split-workspace').count()).toBeGreaterThan(0);
   const main=page.locator('[data-split-view="thread:thread-a"]');
   await main.getByRole('textbox',{name:'Message',exact:true}).waitFor({state:'visible'});
   expect(await main.textContent()).toContain('First transcript only');
   expect(await main.textContent()).not.toContain('Second transcript only');
   expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);

 it('defaults ordinary Workspace to the plane with a panel toggle, hides the overview while the panel is open, and removes the split history bar',async()=>{
  const host=await fixture({mode:'chat',plan:true}),{page}=host;try{
   expect(await page.locator('.split-workspace').count()).toBeGreaterThan(0);
   const message=page.locator('[data-split-view="thread:thread-a"]').getByRole('textbox',{name:'Message',exact:true});await message.waitFor({state:'visible'});
   const overview=page.getByRole('region',{name:'Project overview window',exact:true});await overview.waitFor({state:'visible'});
   await page.getByRole('button',{name:'Open workspace panel',exact:true}).click();
   const panel=page.getByRole('complementary',{name:'Workspace panel',exact:true});await panel.waitFor({state:'visible'});
    expect(await panel.getByRole('button',{name:'Close workspace panel',exact:true}).count()).toBe(0);
   await overview.waitFor({state:'hidden'});
    await panel.getByRole('button',{name:'Add surface',exact:true}).click();await page.getByRole('menuitem',{name:'Plan',exact:true}).click();
    await panel.getByRole('button',{name:'Add surface',exact:true}).click();await page.getByRole('menuitem',{name:'Notes',exact:true}).click();
    expect(await panel.getByRole('tab',{name:'Plan',exact:true}).isVisible()).toBe(true);expect(await panel.getByRole('tab',{name:'Notes',exact:true}).isVisible()).toBe(true);
   await page.getByRole('button',{name:'Hide workspace panel',exact:true}).click();await panel.waitFor({state:'hidden'});await overview.waitFor({state:'visible'});
   expect(await page.getByRole('button',{name:'Undo layout',exact:true}).count()).toBe(0);expect(await page.getByRole('button',{name:'Redo',exact:true}).count()).toBe(0);expect(await page.getByRole('button',{name:'Restore last layout',exact:true}).count()).toBe(0);expect(await page.locator('.split-workspace-hint').count()).toBe(0);
   expect(host.errors).toEqual([]);
  }finally{await page.close();}
 },30000);
 it('a browser dock shares the tool width budget and preserves chat space',async()=>{
  const{page}=await fixture({width:1440,height:900,mode:'chat'});
  try{
   await page.getByRole('button',{name:'Open workspace panel',exact:true}).click();
   await page.evaluate(()=>{const slot=document.createElement('section');slot.className='desktop-browser-dock';slot.setAttribute('aria-label','Synthetic browser geometry');slot.textContent='Browser slot geometry';(document.querySelector('.workspace-tools')??document.querySelector('.shell-workarea'))!.appendChild(slot);});
   const boxes=await page.evaluate(()=>{const box=(selector:string)=>{const a=document.querySelector(selector)!.getBoundingClientRect();return{x:a.x,y:a.y,right:a.right,bottom:a.bottom,width:a.width};};return{chat:box('.split-root-workarea'),panel:box('.workspace-right'),browser:box('.desktop-browser-dock'),owner:box('.shell-workarea')};});
   expect(boxes.chat.width).toBeGreaterThanOrEqual(420);expect(boxes.chat.right).toBeLessThanOrEqual(boxes.panel.x);
   expect(boxes.browser.right).toBeLessThanOrEqual(boxes.owner.right+1);expect(boxes.browser.y).toBeGreaterThanOrEqual(boxes.panel.bottom);
  }finally{await page.close();}
 },20000);
 it('artifacts stay inside the plane conversation without horizontal overflow (T02)',async()=>{
  const{page}=await fixture({mode:'chat'});
  try{
   const artifact=page.locator('[data-split-view="thread:thread-a"] .artifact').first();await artifact.waitFor({state:'visible'});
   const original=await artifact.elementHandle();await page.waitForTimeout(150);
   const bounds=await page.evaluate(()=>{const a=document.querySelector('[data-split-view="thread:thread-a"] .artifact')!.getBoundingClientRect();const c=document.querySelector('[data-split-view="thread:thread-a"]')!.getBoundingClientRect();return{artifact:{x:a.x,right:a.right,y:a.y,bottom:a.bottom},view:{x:c.x,right:c.right,y:c.y,bottom:c.bottom},overflow:document.documentElement.scrollWidth-innerWidth};});
   expect(bounds.artifact.x).toBeGreaterThanOrEqual(bounds.view.x-1);expect(bounds.artifact.right).toBeLessThanOrEqual(bounds.view.right+1);
   expect(bounds.overflow).toBeLessThanOrEqual(1);
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
    const boxes=await page.evaluate(()=>{const box=(selector:string)=>{const a=document.querySelector(selector)!.getBoundingClientRect();return{x:a.x,y:a.y,right:a.right,bottom:a.bottom,width:a.width,height:a.height};};return{chat:box('.split-root-workarea'),panel:box('.workspace-right'),owner:box('.shell-workarea'),title:box('.workspace-switcher'),overflow:document.documentElement.scrollWidth-innerWidth};});
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
   const boxes=await page.evaluate(()=>{const box=(selector:string)=>{const a=document.querySelector(selector)!.getBoundingClientRect();return{x:a.x,y:a.y,right:a.right,bottom:a.bottom,width:a.width,height:a.height};};return{chat:box('.split-root-workarea'),panel:box('.workspace-right'),owner:box('.shell-workarea'),title:box('.workspace-switcher')};});
   expect(boxes.panel.y).toBeGreaterThanOrEqual(boxes.chat.bottom);expect(boxes.panel.bottom).toBeLessThanOrEqual(boxes.owner.bottom+1);
   expect(boxes.panel.height).toBeLessThanOrEqual(boxes.owner.height*.45+1);expect(boxes.chat.height).toBeGreaterThanOrEqual(240);
   expect(boxes.panel.y).toBeGreaterThanOrEqual(boxes.title.bottom);
  }finally{await page.close();}
 },20000);
});
