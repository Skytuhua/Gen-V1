import {expect,test,type Page} from '@playwright/test';
import {applySplitWorkspaceCommand,createSplitWorkspaceLayout} from '../../packages/core/split-workspace-layout';
import {shellInit,shellRoute,shellSnapshot} from '../../scripts/capture-ui/shell-api';
import {projectContext} from '../../scripts/capture-ui/browser-data';

test.beforeEach(async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('harness:summary:usage:v1',JSON.stringify({collapsed:false})));
 await page.addInitScript(()=>{const requests:unknown[]=[];Object.defineProperty(window,'wo5Requests',{value:requests});window.addEventListener('redundant-request',event=>requests.push((event as CustomEvent).detail));});
 await page.route('**/api/**',route=>route.abort('blockedbyclient'));
});
async function ownerApp(page:Page,mode:'chat'|'split'|'desktop'|'loading'='chat'){
 const snapshot=shellSnapshot();snapshot.threads[0].projectId='capture-project';
 let layout=applySplitWorkspaceCommand(createSplitWorkspaceLayout(),'view.open',{paneId:'pane-main',view:{id:'owner-thread',kind:'thread',binding:{authority:{kind:'local'},threadId:'one',projectId:'capture-project'}}});
 let releaseSend:()=>void=()=>{};
 const sendGate=new Promise<void>(resolve=>{releaseSend=resolve;});
 await page.addInitScript(shellInit);
 if(mode==='split')await page.addInitScript(()=>localStorage.setItem('harness:workspace-mode:v3','split'));
 if(mode==='loading')await page.addInitScript(()=>{
  const get=IDBObjectStore.prototype.get,held:(()=>void)[]=[];
  Object.assign(window,{wo5ReleaseComposerDraft:()=>held.splice(0).forEach(release=>release())});
  IDBObjectStore.prototype.get=function(key){const request=get.call(this,key);if(key==='draft:one')request.addEventListener('success',event=>{event.stopImmediatePropagation();held.push(()=>request.dispatchEvent(new Event('success')));},{once:true});return request;};
 });
 if(mode==='desktop')await page.addInitScript(()=>{
  let detached=false;const state=()=>({windows:[{id:'main',surface:{kind:'main'},ready:true,minimized:false},...(detached?[{id:'child',surface:{kind:'thread',threadId:'one'},ready:true,minimized:false}]:[])]});
  Object.assign(window,{harnessDesktop:{getContext:async()=>({windowId:'main',surface:{kind:'main'},...state()}),ready:async()=>{},onCloseRequested:()=>()=>{},focus:async()=>{},onState:(listener:(value:ReturnType<typeof state>)=>void)=>{Object.assign(window,{wo5SetDetached:(value:boolean)=>{detached=value;listener(state());}});return()=>{};}}});
 });
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  if(path==='/api/projects/capture-project/context')return route.fulfill({json:{...projectContext,threadId:'one'}});
  if(path==='/api/projects/capture-project/git'){
   expect(url.searchParams.get('threadId')).toBe('one');
   return route.fulfill({json:{head:'a'.repeat(40),revision:'b'.repeat(64),branch:'audit',files:[],diff:'Owner fallback diff',stagedDiff:'',truncated:false,gitWrite:false}});
  }
  if(path==='/api/split-workspace')return route.fulfill({json:layout});
  if(path==='/api/split-workspace/profiles')return route.fulfill({json:[]});
  if(path==='/api/split-workspace/commands'){
   const command=route.request().postDataJSON();layout=applySplitWorkspaceCommand(layout,command.type,command.payload);
   return route.fulfill({json:{commandId:command.id,eventSeq:snapshot.seq,result:layout}});
  }
  if(path==='/api/commands'&&route.request().postDataJSON().type==='message.send')await sendGate;
  return shellRoute(route,snapshot,false);
 });
 await page.goto('/actual-app');
 if(mode==='loading')await expect(page.getByRole('button',{name:'Inspect changes',exact:true})).toBeDisabled();else await expect(page.getByRole('button',{name:'Inspect changes',exact:true})).toBeEnabled();
 const overview=page.locator('.summary-overview:visible').first();
 await overview.getByRole('button',{name:'Expand Project overview',exact:true}).click();
 await expect(overview.locator('.project-context-card')).toContainText('Audit project');
 return {overview,fallback:overview.getByRole('button',{name:/^Changes/}),releaseSend};
}
test('actual detached composer restores overview Changes until its owner docks again',async({page},info)=>{
 const {fallback}=await ownerApp(page,'desktop');await expect(fallback).toHaveCount(0);
 await page.evaluate(()=>(window as unknown as {wo5SetDetached:(value:boolean)=>void}).wo5SetDetached(true));
 await expect(page.getByRole('button',{name:'Focus chat',exact:true})).toBeVisible();await expect(fallback).toBeVisible();
 await page.screenshot({path:info.outputPath('r2-detached.png'),fullPage:true});
 await fallback.focus();await page.keyboard.press('Enter');await expect(page.locator('.live-diff')).toContainText('Owner fallback diff');
 await page.evaluate(()=>(window as unknown as {wo5SetDetached:(value:boolean)=>void}).wo5SetDetached(false));
 await expect(page.getByRole('button',{name:'Inspect changes',exact:true})).toBeEnabled();await expect(fallback).toHaveCount(0);
});
for(const state of ['parked','minimized'] as const)test(`actual ${state} split composer retains its same-owner overview Changes route`,async({page},info)=>{
 const {fallback}=await ownerApp(page,'split');await expect(fallback).toHaveCount(0);
 if(state==='parked'){
  await page.getByRole('button',{name:'Area actions',exact:true}).click();await page.getByRole('menuitem',{name:'Park current view',exact:true}).click();
 }else await page.getByRole('button',{name:'Minimize area',exact:true}).click();
 await expect(page.getByRole('button',{name:'Inspect changes',exact:true})).toHaveCount(0);await expect(fallback).toBeVisible();
 await page.screenshot({path:info.outputPath(`r2-${state}.png`),fullPage:true});
 if(state==='minimized'){
  await page.getByRole('button',{name:'Restore area',exact:true}).click();await expect(page.getByRole('button',{name:'Inspect changes',exact:true})).toBeEnabled();await expect(fallback).toHaveCount(0);
  await page.getByRole('button',{name:'Minimize area',exact:true}).click();await expect(fallback).toBeVisible();
 }
 await fallback.focus();await page.keyboard.press('Enter');await expect(page.locator('.live-diff')).toContainText('Owner fallback diff');
});
test('actual loading composer keeps overview Changes until its draft is ready',async({page})=>{
 const {fallback}=await ownerApp(page,'loading');await expect(fallback).toBeVisible();
 await page.evaluate(()=>(window as unknown as {wo5ReleaseComposerDraft:()=>void}).wo5ReleaseComposerDraft());
 await expect(page.getByRole('button',{name:'Inspect changes',exact:true})).toBeEnabled();await expect(fallback).toHaveCount(0);
});
test('actual busy composer restores overview Changes until its action is enabled again',async({page})=>{
 const {fallback,releaseSend}=await ownerApp(page);await expect(fallback).toHaveCount(0);
 await page.getByRole('textbox',{name:'Message',exact:true}).fill('Hold this ordinary send');
 try{
  await page.getByRole('button',{name:'Send message',exact:true}).click();await expect(page.getByRole('button',{name:'Inspect changes',exact:true})).toBeDisabled();await expect(fallback).toBeVisible();
 }finally{releaseSend();}
 await expect(page.getByRole('button',{name:'Inspect changes',exact:true})).toBeEnabled();await expect(fallback).toHaveCount(0);
});
test('production App hides the equivalent overview route and opens same-owner Changes from its composer',async({page})=>{
 const snapshot=shellSnapshot();snapshot.threads[0].projectId='capture-project';
 await page.addInitScript(shellInit);
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/projects/capture-project/context')return route.fulfill({json:{...projectContext,threadId:'one'}});
  if(path==='/api/projects/capture-project/git'){
   expect(new URL(route.request().url()).searchParams.get('threadId')).toBe('one');
   return route.fulfill({json:{projectId:'capture-project',threadId:'one',head:'a'.repeat(40),revision:'b'.repeat(64),branch:'audit',files:[],diff:'Same-owner production diff',stagedDiff:'',gitWrite:false}});
  }
  return shellRoute(route,snapshot,false);
 });
 await page.goto('/actual-app');
 await page.getByRole('button',{name:'Expand Project overview',exact:true}).click();
 await expect(page.locator('.project-context-card')).toContainText('Audit project');
 await expect(page.locator('.project-context-card').getByRole('button',{name:/^Changes/})).toHaveCount(0);
 await page.getByRole('button',{name:'Inspect changes',exact:true}).click();
 await expect(page.locator('.live-diff')).toContainText('Same-owner production diff');
});
for(const width of [1440,1024,768])test(`reduced UI keeps its destinations at ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:1000});await page.goto('/redundant-ui');
 await expect(page.getByRole('button',{name:'work/layout',exact:true})).toBeVisible();
 await expect(page.locator('.project-context-card').getByRole('button',{name:/^Changes/})).toHaveCount(0);
 await expect(page.locator('.floating-usage-details dl')).toHaveCount(0);
 const changes=page.getByRole('button',{name:'Inspect changes',exact:true});await changes.focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('region',{name:'Tool destination'})).toContainText('new live value');
 await expect(page.getByRole('region',{name:'Tool destination'})).toContainText('+4 −2');
 expect(await page.evaluate(()=>(window as unknown as {wo5Requests:unknown[]}).wo5Requests)).toContainEqual({path:'/api/projects/project-one/git',threadId:'thread-a',method:'GET'});
 const open=page.getByRole('button',{name:'Open Usage',exact:true});await open.focus();await page.keyboard.press('Enter');
 const dialog=page.getByRole('dialog',{name:'Usage',exact:true});await expect(dialog).toContainText('Audit the workspace');await expect(dialog).not.toContainText('Another owner');
 await expect(dialog).toContainText('0.012345');
 await page.screenshot({path:info.outputPath(`6-usage-${width}.png`),fullPage:true});
 await dialog.getByRole('tab',{name:'Tokens',exact:true}).click();await expect(dialog).toContainText('18,321');await expect(dialog).toContainText('791');
 await dialog.getByRole('tab',{name:'Limits',exact:true}).click();await expect(dialog).toContainText('23.456%');await expect(dialog).toContainText('67.89%');
 await page.keyboard.press('Escape');await expect(open).toBeFocused();
 await page.getByRole('button',{name:'Usage panel',exact:true}).click();await expect(page.locator('.usage-context')).toContainText('18%');
 await page.getByRole('button',{name:'Recorded changes',exact:true}).click();await expect(page.getByRole('region',{name:'Tool destination'})).toContainText('new recorded value');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await expect(page.getByRole('textbox',{name:'Prompt',exact:true})).toHaveValue('Keep my composer draft');
});
for(const mode of ['custom','scoped','detached'])test(`retains the overview route for unproven ${mode} owners`,async({page})=>{
 await page.goto('/redundant-ui?mode='+mode);
 const overview=page.locator('.project-context-card').getByRole('button',{name:/^Changes/});await expect(overview).toBeVisible();await overview.focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('region',{name:'Tool destination'})).toContainText('new live value');
 await expect(page.getByRole('button',{name:'Inspect changes',exact:true})).toHaveCount(0);
 if(mode==='detached'){
  await expect(page.locator('.floating-usage-details')).toContainText('18,321');await expect(page.locator('.floating-usage-details')).toContainText('67.89%');
  await expect(page.getByRole('button',{name:'Open Usage',exact:true})).toHaveCount(0);
 }
});
test('a proven custom owner can use the equivalent composer action',async({page})=>{
 await page.goto('/redundant-ui?mode=custom-proven');await expect(page.getByRole('button',{name:'work/layout',exact:true})).toBeVisible();
 await expect(page.locator('.project-context-card').getByRole('button',{name:/^Changes/})).toHaveCount(0);
 await page.getByRole('button',{name:'Inspect changes',exact:true}).click();await expect(page.locator('.live-diff')).toContainText('new live value');
});
test('ownerless usage retains details rather than assuming a destination',async({page})=>{
 await page.goto('/redundant-ui?mode=ownerless');await expect(page.locator('.floating-usage-details dl')).toContainText('Input tokens');
});
test('Notes preserves its unsaved draft through navigation and reload',async({page})=>{
 await page.goto('/redundant-ui');await page.getByRole('button',{name:'Notes',exact:true}).click();
 const editor=page.getByRole('textbox',{name:'Note decision',exact:true});await expect(editor).toBeEnabled();await editor.fill('Keep this unsaved owner A note.');
 await page.getByRole('button',{name:'Usage panel',exact:true}).click();
 await expect(page.getByRole('region',{name:'Thread memory',exact:true})).toHaveCount(0);
 await expect(editor).toHaveCount(0);
 await page.getByRole('button',{name:'Notes',exact:true}).click();await expect(editor).toHaveValue('Keep this unsaved owner A note.');
 await page.reload();await page.getByRole('button',{name:'Notes',exact:true}).click();await expect(editor).toHaveValue('Keep this unsaved owner A note.');
 await expect(page.getByRole('region',{name:'Thread memory',exact:true})).toHaveCount(1);
});
test('retained destinations surface actual loading/error/empty boundaries',async({page})=>{
 await page.goto('/redundant-ui?state=loading');await expect(page.locator('.project-context-card')).toContainText('Reading project');
 await page.evaluate(()=>window.dispatchEvent(new Event('redundant-release')));await expect(page.getByRole('button',{name:'work/layout',exact:true})).toBeVisible();
 await page.goto('/redundant-ui?state=error');await expect(page.locator('.project-context-card').getByRole('alert')).toContainText('could not load');
 await page.goto('/redundant-ui?state=empty');await expect(page.locator('.project-context-card')).toContainText('No project connected.');
 await page.goto('/redundant-ui?state=usage-loading');await page.getByRole('button',{name:'Open Usage',exact:true}).click();await expect(page.getByRole('dialog').getByRole('status')).toContainText('Refreshing usage');
 await page.goto('/redundant-ui?state=usage-error');await page.getByRole('button',{name:'Open Usage',exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Usage refresh failed');
});
for(const motion of ['reduced','off'])test(`light/zoom keyboard destinations respect ${motion} motion`,async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/redundant-ui');
 await page.evaluate(motion=>{document.documentElement.dataset.theme='light';document.documentElement.dataset.motion=motion;document.documentElement.style.zoom='1.25';},motion);
 const opener=page.getByRole('button',{name:'Open Usage',exact:true});await opener.focus();
 expect(await opener.evaluate(el=>getComputedStyle(el).outlineStyle)).not.toBe('none');await page.keyboard.press('Enter');await expect(page.getByRole('dialog',{name:'Usage',exact:true})).toBeVisible();
 await page.keyboard.press('Escape');await expect(opener).toBeFocused();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
