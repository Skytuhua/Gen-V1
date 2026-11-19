import {test,expect,type Page} from '@playwright/test';
import {createWorkspaceCanvas} from '../../packages/core/workspace-layout';
import type {HostCommand,Thread} from '../../packages/contracts';
import type {WorkspaceEnvelope} from '../../packages/contracts/workspace';
import {planDataId,PLANNING_PROVENANCE} from '../../packages/contracts/planning';
import {serveTaskFixture,taskFixture} from './task-interface-fixture';
import {snapshotServed,warmApp} from './app-ready';

test.beforeAll(async({browser,baseURL})=>{await warmApp(browser,baseURL);});

async function fixture(page:Page,started=false){
 const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Fixture content'}}}});
 snapshot.artifacts=[];snapshot.userStates=[];snapshot.settings.theme='dark';
 snapshot.threads[0]={...snapshot.threads[0],title:'Original chat',projectId:'first',projectName:'First project',mode:'build',sessionPath:started?'fixture-session':null};
 snapshot.messages=Array.from({length:55},(_,index)=>({id:'message-'+index,threadId:'task-thread',role:'assistant' as const,content:'Original conversation message '+index,runId:null,createdAt:'2026-11-04'}));
 const host=await serveTaskFixture(page,snapshot),commands:HostCommand[]=[],workspaceCommands:HostCommand[]=[];
 const envelope:WorkspaceEnvelope={projects:[{id:'first',name:'First project',rootPath:'C:/fixture/first',authority:{kind:'local'},createdAt:'2026-11-04T00:00:00.000Z'},{id:'second',name:'Second project',rootPath:'C:/fixture/second',authority:{kind:'local'},createdAt:'2026-11-04T00:00:00.000Z'},{id:'private',name:'Other authority',authority:{kind:'plugin',pluginId:'fixture-plugin',scopeId:'private'},rootPath:'C:/not-personal',createdAt:'2026-11-04T00:00:00.000Z'}],state:{version:1,revision:0,activeCanvasId:'main',canvases:[createWorkspaceCanvas('workspace','Workspace','main')],profiles:[],disabledKinds:[],integrations:{}}};
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
  else if(command.type==='thread.create'){const sideParentId=typeof command.payload.sideParentId==='string'?command.payload.sideParentId:undefined,projectId=typeof command.payload.projectId==='string'?command.payload.projectId:undefined,created={...snapshot.threads[0],id:sideParentId?'side-thread':'new-thread',title:'New chat',sideParentId,projectId,projectName:projectId?envelope.projects.find(value=>value.id===projectId)?.name??'Conversations':'Conversations',sessionPath:null,workspaceId:undefined,runId:null};snapshot.threads.push(created);result=created;}
  else return route.fallback();
  snapshot.seq++;return route.fulfill({json:{commandId:command.id,seq:snapshot.seq,result}});
 });
 const served=snapshotServed(page);await page.goto('/');await served;await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();
 return {...host,envelope,commands,workspaceCommands};
}

test('text entry shares its first row with Changes and Create PR at wide and narrow widths',async({page})=>{
 await fixture(page);const draft=page.getByRole('textbox',{name:'Message',exact:true});
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});
  // Read related geometry in the same browser task. Separate boundingBox RPCs
  // can straddle the resize and compare controls from different layout frames.
  await expect(async()=>{
   const bounds=await page.locator('.composer').evaluate(composer=>{
    const input=composer.querySelector('textarea')!.getBoundingClientRect();
    const actions=composer.querySelector('[role="group"][aria-label="Task actions"]')!.getBoundingClientRect();
    return {viewport:[innerWidth,innerHeight],topDelta:Math.abs(actions.y-input.y),inputRight:input.right,actionsLeft:actions.left,
     utilities:composer.querySelectorAll('.composer-header-utilities').length,height:composer.getBoundingClientRect().height,overflow:document.documentElement.scrollWidth-innerWidth};
   });
   expect(bounds.viewport).toEqual([width,900]);expect(bounds.topDelta).toBeLessThanOrEqual(6);expect(bounds.inputRight).toBeLessThanOrEqual(bounds.actionsLeft);
   expect(bounds.utilities).toBe(0);expect(bounds.height).toBeLessThan(150);expect(bounds.overflow).toBeLessThanOrEqual(1);
  }).toPass({timeout:5000});
 }
 await draft.fill('Keep this thought');await page.getByRole('button',{name:'Create PR',exact:true}).click();
 await expect(draft).toHaveValue('Create a pull request for the current changes.\n\nKeep this thought');await expect(draft).toBeFocused();
});

for(const dismissal of ['Cancel','Add resource'] as const)test(`resource picker ${dismissal} preserves a newly focused composer before its deferred frame`,async({page})=>{
 const host=await fixture(page),settings=page.getByRole('button',{name:'Settings',exact:true});
 await settings.click();
 await page.getByRole('dialog',{name:'Settings',exact:true}).getByRole('button',{name:'Projects & Working Copies',exact:true}).click();
 await page.getByRole('button',{name:'Add resource',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Add a resource',exact:true});await expect(dialog).toBeVisible();
 if(dismissal==='Add resource')await dialog.getByRole('textbox',{name:'Absolute local path',exact:true}).fill('C:/fixture/first');
 // Hold the next frame so a deliberate new focus can occur after the modal
 // unmounts and before the deferred restoration runs. No production timers change.
 await page.evaluate(()=>{
  const original=requestAnimationFrame,callbacks:FrameRequestCallback[]=[];
  window.requestAnimationFrame=callback=>{callbacks.push(callback);return callbacks.length;};
  Object.assign(window,{releaseResourceFrames:()=>{window.requestAnimationFrame=original;for(const callback of callbacks)callback(performance.now());}});
 });
 await dialog.getByRole('button',{name:dismissal,exact:true}).click();await expect(dialog).toHaveCount(0);
 const draft=page.getByRole('textbox',{name:'Message',exact:true});await draft.focus();await expect(draft).toBeFocused();
 await page.evaluate(()=>(window as unknown as {releaseResourceFrames:()=>void}).releaseResourceFrames());
 await expect(draft).toBeFocused();await page.keyboard.insertText('Keep the input after closing the resource picker.');
 await expect(draft).toHaveValue('Keep the input after closing the resource picker.');
 await expect(page.getByRole('button',{name:'Send message',exact:true})).toBeEnabled();
 expect(host.commands.filter(command=>command.type==='resource.grant')).toHaveLength(dismissal==='Add resource'?1:0);
});

test('resource picker keyboard dismissal restores its opener when focus was not moved',async({page})=>{
 await fixture(page);const settings=page.getByRole('button',{name:'Settings',exact:true});await settings.click();
 await page.getByRole('dialog',{name:'Settings',exact:true}).getByRole('button',{name:'Projects & Working Copies',exact:true}).click();
 await page.getByRole('button',{name:'Add resource',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Add a resource',exact:true});await expect(dialog).toBeVisible();
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(settings).toBeFocused();
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
 await page.addStyleTag({content:'.resource-chip{animation-play-state:paused!important}'});
 const attachment={id:'attached-notes',threadId:'task-thread',kind:'attachment' as const,path:'C:/fixture/notes.txt',label:'notes.txt',writable:false,createdAt:'2026-11-05T00:00:00Z'};
 host.snapshot.resources=[attachment];await host.publish();const band=page.locator('.composer-attachment-band');await expect(band).toBeVisible();
 host.snapshot.resources=[];await host.publish();await expect(band.locator('.resource-chip[data-leaving]')).toHaveCount(1);await expect(band).toHaveAttribute('data-state','open');
 host.snapshot.resources=[attachment];await host.publish();await expect(band.locator('.resource-chip:not([data-leaving])',{hasText:'notes.txt'})).toHaveCount(1);await expect(band.locator('.resource-chip[data-leaving]')).toHaveCount(0);
 await expect(band).toBeVisible();
});

test('composer removes repeated captions and toggles Build Plan without changing its draft',async({page})=>{
 const host=await fixture(page),draft=page.getByRole('textbox',{name:'Message',exact:true});await draft.fill('Keep this thought');
 for(const text of ['Local workspace','Enter to send · Shift + Enter for a new line','Legacy connection'])await expect(page.getByText(text,{exact:true})).toHaveCount(0);
 const toggle=page.getByRole('button',{name:'Task mode',exact:true});await expect(toggle).toHaveText('Build');await toggle.click();await expect(toggle).toHaveText('Plan');await toggle.click();await expect(toggle).toHaveText('Build');await expect(draft).toHaveValue('Keep this thought');
 expect(host.commands.filter(value=>value.type==='thread.mode').map(value=>value.payload.mode)).toEqual(['plan','build']);
 await draft.focus();expect(await page.locator('.composer').evaluate(node=>getComputedStyle(node).boxShadow)).toBe('none');
 await page.emulateMedia({reducedMotion:'reduce'});expect(await page.locator('.composer').evaluate(node=>getComputedStyle(node).animationName)).toBe('none');
 await page.screenshot({path:'.harness-frontend-refinement/shell-desktop.png'});
 await page.setViewportSize({width:390,height:844});await expect(draft).toHaveValue('Keep this thought');
 const send=await page.getByRole('button',{name:'Send message',exact:true}).boundingBox();expect(send!.x+send!.width).toBeLessThanOrEqual(390);await expect(page.getByRole('button',{name:'Select project',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.harness-frontend-refinement/shell-narrow.png'});
});
test('project selection uses the explicit local host binding and leaves attachments on plus',async({page})=>{
 const host=await fixture(page),draft=page.getByRole('textbox',{name:'Message',exact:true});await draft.fill('Unsent draft');
 await page.getByRole('button',{name:'Select project',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Select project',exact:true});await expect(dialog).toBeVisible();await expect(dialog.getByText('Other authority',{exact:true})).toHaveCount(0);
 await dialog.getByRole('option',{name:'Second project',exact:true}).click();await expect(dialog).toHaveCount(0);
 expect(host.workspaceCommands.find(value=>value.type==='workspace.project.connect')?.payload).toMatchObject({threadId:'task-thread',name:'Second project',path:'C:/fixture/second'});await expect(draft).toHaveValue('Unsent draft');expect(host.snapshot.threads[0].projectId).toBe('second');
 const choosing=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Attach files',exact:true}).click();expect((await choosing).isMultiple()).toBe(true);
});
test('started chat opens an explicitly new project chat and retains its original binding and draft',async({page})=>{
 const host=await fixture(page,true);await page.getByRole('textbox',{name:'Message',exact:true}).fill('Original draft stays here');await page.getByRole('button',{name:'Select project',exact:true}).click();
 await page.getByRole('dialog',{name:'Select project',exact:true}).getByRole('option',{name:'Second project',exact:true}).click();await expect(page.getByRole('dialog',{name:'Select project',exact:true})).toHaveCount(0);
 const created=host.snapshot.threads.find(value=>value.id==='new-thread');expect(created?.projectId).toBe('second');expect(created?.projectName).toBe('Second project');expect(host.snapshot.threads[0].projectId).toBe('first');
 await page.getByRole('button',{name:'Original chat Ready',exact:true}).click();await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Original draft stays here');
});

test('chat header omits retired controls while sidebar rename and archive remain available and detach stays desktop-only',async({page})=>{
 await fixture(page);
 const header=page.locator('.workspace-header');
 await expect(header.locator('.desktop-window-actions,.header-thread-status,.thread-menu-wrap')).toHaveCount(0);
 await expect(header.getByRole('button',{name:/detach (thread|artifact|workspace|plan|navigation|browser)|side conversation|project context|thread options/i})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Open panel',exact:true})).toBeVisible();
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
 const context=page.getByRole('region',{name:'Project overview window',exact:true});
 host.snapshot.data.push({id:planDataId('task-thread'),threadId:'task-thread',revision:1,provenance:PLANNING_PROVENANCE,createdAt:'2026-11-04T00:00:00Z',value:{version:1,title:'Review the next steps',steps:[{id:'inspect',title:'Inspect the current draft',status:'working',requirements:[],agentIds:[]}],agents:[]}});
 await host.publish();const rail=page.getByRole('region',{name:'Task plan: Review the next steps',exact:true});await expect(rail).toBeVisible();await expect(rail.getByText('Inspect the current draft',{exact:true})).toBeVisible();await context.getByRole('button',{name:'Expand Project overview',exact:true}).click();await expect(context.getByText('Review the next steps',{exact:true})).toBeVisible();await expect(draft).toHaveValue('Keep writing while the plan arrives');
 await page.getByRole('button',{name:'Show live usage',exact:true}).click();const usage=page.getByRole('region',{name:'Live usage',exact:true});await expect(usage).toBeVisible();
 for(const tool of [context,usage])await expect(tool.getByRole('button',{name:/close |detach|reset .*position|resize|^move /i})).toHaveCount(0);
 await context.getByRole('button',{name:'Collapse Project overview',exact:true}).click();await expect(context).toHaveAttribute('data-collapsed','true');await expect(context).toBeVisible();
 await context.getByRole('button',{name:'Expand Project overview',exact:true}).click();await expect(context.getByText('Review the next steps',{exact:true})).toBeVisible();
 await expect(draft).toHaveValue('Keep writing while the plan arrives');
});

for(const alias of ['btw','side'])test(`/${alias} still sends a side question without a header button`,async({page})=>{
 const host=await fixture(page),owner=page.locator('[data-split-view="thread:task-thread"]');
 await expect(owner.locator('.side-chat-composer textarea')).toBeEnabled();
 await owner.getByRole('textbox',{name:'Message',exact:true}).fill(`/${alias} Explain the next step`);
 await owner.getByRole('button',{name:'Send message',exact:true}).click();
 await expect.poll(()=>host.commands.filter(command=>command.type==='message.send').map(command=>({threadId:command.threadId,content:command.payload.content}))).toEqual([{threadId:'side-thread',content:'Explain the next step'}]);
 expect(host.commands.find(command=>command.type==='thread.create')?.payload.sideParentId).toBe('task-thread');
 await expect(owner.getByRole('region',{name:'Side conversation window',exact:true})).toBeVisible();
 await expect(owner.locator('.workspace-header').getByRole('button',{name:'Open side conversation',exact:true})).toHaveCount(0);
});
