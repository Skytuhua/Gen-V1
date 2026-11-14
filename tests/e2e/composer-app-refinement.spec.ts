import {test,expect,type Page} from '@playwright/test';
import {createWorkspaceCanvas} from '../../packages/core/workspace-layout';
import type {HostCommand,Thread} from '../../packages/contracts';
import type {WorkspaceEnvelope} from '../../packages/contracts/workspace';
import {planDataId,PLANNING_PROVENANCE} from '../../packages/contracts/planning';
import {serveTaskFixture,taskFixture} from './task-interface-fixture';

async function fixture(page:Page,started=false){
 const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Fixture content'}}}});
 snapshot.artifacts=[];snapshot.userStates=[];snapshot.settings.theme='dark';
 snapshot.threads[0]={...snapshot.threads[0],title:'Original chat',projectId:'first',projectName:'First project',mode:'build',sessionPath:started?'fixture-session':null};
 snapshot.messages=Array.from({length:55},(_,index)=>({id:'message-'+index,threadId:'task-thread',role:'assistant' as const,content:'Original conversation message '+index,runId:null,createdAt:'2026-11-04'}));
 const host=await serveTaskFixture(page,snapshot),commands:HostCommand[]=[],workspaceCommands:HostCommand[]=[];
 const envelope:WorkspaceEnvelope={projects:[{id:'first',name:'First project',rootPath:'C:/fixture/first',authority:{kind:'local'},createdAt:'2026-11-04'},{id:'second',name:'Second project',rootPath:'C:/fixture/second',authority:{kind:'local'},createdAt:'2026-11-04'},{id:'private',name:'Other authority',authority:{kind:'plugin',pluginId:'fixture-plugin',scopeId:'private'},rootPath:'C:/not-personal',createdAt:'2026-11-04'}],state:{version:1,revision:0,activeCanvasId:'main',canvases:[createWorkspaceCanvas('workspace','Workspace','main')],profiles:[],disabledKinds:[],integrations:{}}};
 await page.route('**/api/workspace',route=>route.fulfill({json:envelope}));
 await page.route('**/api/workspace/commands',async route=>{
  const command=route.request().postDataJSON() as HostCommand;workspaceCommands.push(command);const p=command.payload;
  if(command.type==='workspace.project.connect'){
   const thread=snapshot.threads.find(value=>value.id===p.threadId)!;
   if(thread.runId||thread.sessionPath||thread.workspaceId)return route.fulfill({status:409,json:{error:{code:'PROJECT_BUSY',message:'Start a new chat to use another project.'}}});
   const project=envelope.projects.find(value=>value.rootPath===p.path)!;thread.projectId=project.id;thread.projectName=project.name;
  }
  if(command.type==='workspace.canvas.create'){
   const owner=snapshot.threads.find(value=>value.id===p.threadId),canvas=createWorkspaceCanvas(p.preset as 'research',String(p.name),'canvas-'+envelope.state.canvases.length,owner?{authority:{kind:'local'},threadId:owner.id,projectId:owner.projectId}:undefined);envelope.state.canvases.push(canvas);envelope.state.activeCanvasId=canvas.id;
  }
  if(command.type==='workspace.canvas.select')envelope.state.activeCanvasId=String(p.canvasId);
  if(command.type==='workspace.canvas.viewport'){const canvas=envelope.state.canvases.find(value=>value.id===p.canvasId)!;canvas.viewport={x:Number(p.x),y:Number(p.y),zoom:Number(p.zoom)};}
  envelope.state.revision++;return route.fulfill({json:{commandId:command.id,seq:snapshot.seq,result:envelope}});
 });
 await page.route('**/api/commands',async route=>{
  const command=route.request().postDataJSON() as HostCommand;commands.push(command);let result:unknown={};
  if(command.type==='thread.mode')snapshot.threads.find(value=>value.id===command.threadId)!.mode=command.payload.mode as Thread['mode'];
  else if(command.type==='thread.create'){const sideParentId=typeof command.payload.sideParentId==='string'?command.payload.sideParentId:undefined,created={...snapshot.threads[0],id:sideParentId?'side-thread':'new-thread',title:'New chat',sideParentId,projectId:undefined,projectName:'Conversations',sessionPath:null,workspaceId:undefined,runId:null};snapshot.threads.push(created);result=created;}
  else return route.fallback();
  snapshot.seq++;return route.fulfill({json:{commandId:command.id,seq:snapshot.seq,result}});
 });
 await page.goto('/');await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();
 return {...host,envelope,commands,workspaceCommands};
}

test('text entry shares its first row with Changes and Create PR at wide and narrow widths',async({page})=>{
 await fixture(page);const draft=page.getByRole('textbox',{name:'Message',exact:true});
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});
  const input=(await draft.boundingBox())!,actions=(await page.getByRole('group',{name:'Task actions',exact:true}).boundingBox())!;
  expect(Math.abs(actions.y-input.y)).toBeLessThanOrEqual(6);expect(input.x+input.width).toBeLessThanOrEqual(actions.x);
  expect(await page.locator('.composer-header-utilities').count()).toBe(0);expect((await page.locator('.composer').boundingBox())!.height).toBeLessThan(150);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 }
 await draft.fill('Keep this thought');await page.getByRole('button',{name:'Create PR',exact:true}).click();
 await expect(draft).toHaveValue('Create a pull request for the current changes.\n\nKeep this thought');await expect(draft).toBeFocused();
});

for(const motion of ['no-preference','reduce'] as const)test(`attachment band exists only for attached resources and preserves input under ${motion}`,async({page})=>{
 await page.emulateMedia({reducedMotion:motion});const host=await fixture(page),draft=page.getByRole('textbox',{name:'Message',exact:true}),original=await draft.elementHandle();
 await draft.fill('Preserve my draft');await expect(page.locator('.composer-attachment-band')).toHaveCount(0);const before=(await page.locator('.composer').boundingBox())!.height;
 host.snapshot.resources.push({id:'project-resource',threadId:'task-thread',kind:'project',path:'C:/fixture/first',label:'First project',writable:false,createdAt:'2026-11-05T00:00:00Z'});await host.publish();
 await expect(page.locator('.composer-attachment-band')).toHaveCount(0);
 host.snapshot.resources.push({id:'attached-notes',threadId:'task-thread',kind:'attachment',path:'C:/fixture/notes.txt',label:'notes.txt',writable:false,createdAt:'2026-11-05T00:00:00Z'});await host.publish();
 await expect(page.locator('.resource-chip',{hasText:'notes.txt'})).toBeVisible();await expect(page.getByRole('group',{name:'Attachments',exact:true})).toBeVisible();await expect.poll(async()=>(await page.locator('.composer').boundingBox())!.height-before).toBeGreaterThanOrEqual(24);
 expect(await draft.evaluate((node,old)=>node===old,original)).toBe(true);await expect(draft).toHaveValue('Preserve my draft');
 await draft.focus();await draft.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,keyCode:229});expect(host.commands.some(value=>value.type==='message.send')).toBe(false);
 host.snapshot.resources=host.snapshot.resources.filter(resource=>resource.id!=='attached-notes');await host.publish();await expect(page.locator('.composer-attachment-band')).toHaveCount(0);
 expect(Math.abs((await page.locator('.composer').boundingBox())!.height-before)).toBeLessThanOrEqual(1);expect(await draft.evaluate((node,old)=>node===old,original)).toBe(true);await expect(draft).toHaveValue('Preserve my draft');
});

test('attachment band reverses an interrupted exit without removing the live row',async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});const host=await fixture(page);
 const attachment={id:'attached-notes',threadId:'task-thread',kind:'attachment' as const,path:'C:/fixture/notes.txt',label:'notes.txt',writable:false,createdAt:'2026-11-05T00:00:00Z'};
 host.snapshot.resources=[attachment];await host.publish();const band=page.locator('.composer-attachment-band');await expect(band).toBeVisible();const original=await band.elementHandle();
 host.snapshot.resources=[];await host.publish();await expect(band).toHaveAttribute('data-state','closing');await expect(band).toHaveAttribute('inert','');
 host.snapshot.resources=[attachment];await host.publish();await expect(band).toHaveAttribute('data-state','open');
 await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));await expect(band).toBeVisible();expect(await band.evaluate((node,old)=>node===old,original)).toBe(true);
});

test('composer removes repeated captions and toggles Build Plan without changing its draft',async({page})=>{
 const host=await fixture(page),draft=page.getByRole('textbox',{name:'Message',exact:true});await draft.fill('Keep this thought');
 for(const text of ['Local workspace','Enter to send · Shift + Enter for a new line','Legacy connection'])await expect(page.getByText(text,{exact:true})).toHaveCount(0);
 const toggle=page.getByRole('button',{name:'Task mode',exact:true});await expect(toggle).toHaveText('Build');await toggle.click();await expect(toggle).toHaveText('Plan');await toggle.click();await expect(toggle).toHaveText('Build');await expect(draft).toHaveValue('Keep this thought');
 expect(host.commands.filter(value=>value.type==='thread.mode').map(value=>value.payload.mode)).toEqual(['plan','build']);
 await draft.focus();expect(await page.locator('.composer').evaluate(node=>getComputedStyle(node).boxShadow)).not.toBe('none');
 await page.emulateMedia({reducedMotion:'reduce'});expect(await page.locator('.composer').evaluate(node=>getComputedStyle(node).animationName)).toBe('none');
 await page.screenshot({path:'.harness-frontend-refinement/shell-desktop.png'});
 await page.setViewportSize({width:390,height:844});await expect(draft).toHaveValue('Keep this thought');
 const send=await page.getByRole('button',{name:'Send message',exact:true}).boundingBox();expect(send!.x+send!.width).toBeLessThanOrEqual(390);await expect(page.getByRole('button',{name:'Select project',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.harness-frontend-refinement/shell-narrow.png'});
});
test('project selection uses the explicit local host binding and leaves attachments on plus',async({page})=>{
 const host=await fixture(page),draft=page.getByRole('textbox',{name:'Message',exact:true});await draft.fill('Unsent draft');
 await page.getByRole('button',{name:'Select project',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Select project',exact:true});await expect(dialog).toBeVisible();await expect(dialog.getByText('Other authority',{exact:true})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Select Second project',exact:true}).click();await expect(dialog).toHaveCount(0);
 expect(host.workspaceCommands.find(value=>value.type==='workspace.project.connect')?.payload).toMatchObject({threadId:'task-thread',name:'Second project',path:'C:/fixture/second'});await expect(draft).toHaveValue('Unsent draft');expect(host.snapshot.threads[0].projectId).toBe('second');
 const choosing=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Attach files',exact:true}).click();expect((await choosing).isMultiple()).toBe(true);
});
test('started chat opens an explicitly new project chat and retains its original binding and draft',async({page})=>{
 const host=await fixture(page,true);await page.getByRole('textbox',{name:'Message',exact:true}).fill('Original draft stays here');await page.getByRole('button',{name:'Select project',exact:true}).click();
 await page.getByRole('button',{name:'New chat in Second project',exact:true}).click();await expect(page.getByRole('dialog',{name:'Select project',exact:true})).toHaveCount(0);
 expect(host.snapshot.threads[0].projectId).toBe('first');expect(host.workspaceCommands.find(value=>value.type==='workspace.project.connect')?.payload.threadId).toBe('new-thread');
 await page.getByRole('button',{name:'Original chat Ready',exact:true}).click();await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Original draft stays here');
});
test('Research opens conversation sources and notes for the selected thread and returns to the saved chat position',async({page})=>{
 const host=await fixture(page);const bar=page.getByRole('scrollbar',{name:'Scroll conversation',exact:true});await bar.focus();await page.keyboard.press('Home');
 await page.getByRole('textbox',{name:'Message',exact:true}).fill('Research draft');await page.getByRole('button',{name:'Research',exact:true}).click();await expect(page.locator('.canvas-panel-notes')).toBeVisible();await expect(page.locator('.canvas-panel-files')).toBeVisible();await expect(page.locator('.canvas-panel-thread')).toBeVisible();
 const research=host.envelope.state.canvases.find(value=>value.preset==='research')!;expect(research.panels.every(panel=>panel.binding.threadId==='task-thread'&&panel.binding.projectId==='first')).toBe(true);await expect(page.locator('.canvas-panel-notes')).toContainText('No saved notes.');
 await page.getByRole('button',{name:'Workspace',exact:true}).click();await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Research draft');await expect.poll(()=>page.getByLabel('Conversation',{exact:true}).evaluate(node=>node.scrollTop)).toBeLessThan(2);
});

test('chat header omits retired controls while sidebar rename and archive remain available and detach stays desktop-only',async({page})=>{
 await fixture(page);
 const header=page.locator('.workspace-header');
 await expect(header.locator('.desktop-window-actions,.header-thread-status,.thread-menu-wrap')).toHaveCount(0);
 await expect(header.getByRole('button',{name:/detach (thread|artifact|workspace|plan|navigation|browser)|side conversation|project context|thread options/i})).toHaveCount(0);
 await expect(header.getByRole('button',{name:'Open workspace panel',exact:true})).toBeVisible();
 await expect(header.getByText('Ready',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:/detach (thread|artifact|workspace|plan|navigation|browser)/i})).toHaveCount(0);
 await page.getByRole('button',{name:'Options for Original chat',exact:true}).click();
 await expect(page.getByRole('menuitem',{name:'Rename thread',exact:true})).toBeVisible();
 await expect(page.getByRole('menuitem',{name:'Archive thread',exact:true})).toBeVisible();
 await expect(page.getByRole('menuitem',{name:'Detach thread',exact:true})).toHaveCount(0);
});

test('a ready plan opens automatically and right-side tools can only be minimized',async({page})=>{
 const host=await fixture(page),draft=page.getByRole('textbox',{name:'Message',exact:true});
 await draft.fill('Keep writing while the plan arrives');await draft.focus();
 const context=page.getByRole('region',{name:'Project context window',exact:true});
 host.snapshot.data.push({id:planDataId('task-thread'),threadId:'task-thread',revision:1,provenance:PLANNING_PROVENANCE,createdAt:'2026-11-04T00:00:00Z',value:{version:1,title:'Review the next steps',steps:[{id:'inspect',title:'Inspect the current draft',status:'working',requirements:[],agentIds:[]}],agents:[]}});
 await host.publish();await expect(context).toBeVisible();await expect(context.getByText('Inspect the current draft',{exact:true})).toBeVisible();await expect(draft).toBeFocused();
 const usage=page.getByRole('region',{name:'Live usage',exact:true});await expect(usage).toBeVisible();
 for(const tool of [context,usage])await expect(tool.getByRole('button',{name:/close |detach|reset .*position|resize|^move /i})).toHaveCount(0);
 await context.getByRole('button',{name:'Minimize Project context',exact:true}).click();await expect(context).toHaveAttribute('data-collapsed','true');await expect(context).toBeVisible();
 await context.getByRole('button',{name:'Expand Project context',exact:true}).click();await expect(context.getByText('Inspect the current draft',{exact:true})).toBeVisible();
 await expect(draft).toHaveValue('Keep writing while the plan arrives');
});

for(const alias of ['btw','side'])test(`/${alias} still sends a side question without a header button`,async({page})=>{
 const host=await fixture(page);
 await expect(page.locator('.side-chat-composer textarea')).toBeEnabled();
 await page.getByRole('textbox',{name:'Message',exact:true}).fill(`/${alias} Explain the next step`);
 await page.getByRole('button',{name:'Send message',exact:true}).click();
 await expect.poll(()=>host.commands.filter(command=>command.type==='message.send').map(command=>({threadId:command.threadId,content:command.payload.content}))).toEqual([{threadId:'side-thread',content:'Explain the next step'}]);
 expect(host.commands.find(command=>command.type==='thread.create')?.payload.sideParentId).toBe('task-thread');
 await expect(page.getByRole('region',{name:'Side conversation window',exact:true})).toBeVisible();
 await expect(page.locator('.workspace-header').getByRole('button',{name:'Open side conversation',exact:true})).toHaveCount(0);
});
