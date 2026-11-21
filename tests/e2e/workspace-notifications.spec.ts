import {expect,test,type Page} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import type {WorkspaceNotificationStore} from '../../apps/web/src/workspace-notifications';
import {serveTaskFixture,taskFixture} from './task-interface-fixture';

interface Fixture {store:WorkspaceNotificationStore;calls:number[];resolve:()=>void;setSecondConversation:(shown:boolean)=>void}
async function mount(page:Page,split=false){
 const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Synthetic notifications'}}}});
 if(split)snapshot.threads.push({...snapshot.threads[0],id:'other-thread'});
 const fixture=await serveTaskFixture(page,snapshot);
 await page.goto('/');await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();
 const main=await(await page.request.get('/src/main.tsx')).text(),component=await(await page.request.get('/src/WorkspaceNotifications.tsx')).text();
 const reactPath=component.match(/from ["']([^"']+\/react\.js\?[^"']*)["']/)?.[1],domPath=main.match(/from ["']([^"']+\/react-dom_client\.js\?[^"']*)["']/)?.[1];
 if(!reactPath||!domPath)throw Error('Production React module URLs unavailable');
 if(split)await page.route('**/api/snapshot',route=>route.fulfill({status:503,json:{error:{message:'Split startup unavailable'}}}));
 await page.evaluate(async({reactPath,domPath,split})=>{
  const react=await import(reactPath),React=react.default??react,dom=await import(domPath),DOM=dom.default??dom;
  const controllerPath='/src/workspace-notifications.ts',viewPath='/src/WorkspaceNotifications.tsx';
  const {createWorkspaceNotifications}=await import(controllerPath),{WorkspaceNotifications,WorkspaceNotificationContext}=await import(viewPath),store=createWorkspaceNotifications(),calls:number[]=[];
  let resolve=()=>{};
  if(!split)for(let i=1;i<=5;i++)store.report(`Synthetic failure ${i}`,{title:`Operation ${i}`,retry:async()=>{calls.push(i);if(i===5)await new Promise<void>(done=>{resolve=done;});}});
  const appPath='/src/App.tsx',App=split?(await import(appPath)).App:null;
  const conversations=(second:boolean)=>App?React.createElement(WorkspaceNotificationContext.Provider,{value:store},React.createElement(App,{embeddedThreadId:'task-thread'}),second&&React.createElement(App,{embeddedThreadId:'other-thread'})):null;
  const host=document.createElement('div');document.body.replaceChildren(host);
  const root=DOM.createRoot(host),render=(second=true)=>root.render(React.createElement(React.Fragment,null,React.createElement(WorkspaceNotifications,{store}),React.createElement('button',{type:'button'},'Underlying content'),conversations(second)));
  render();Object.assign(window,{notificationFixture:{store,calls,resolve:()=>resolve(),setSecondConversation:render}});
 },{reactPath,domPath,split});
 if(!split)await expect(page.getByRole('button',{name:'Hide notifications (5)',exact:true})).toBeVisible();
 return fixture;
}

test('split conversations retain independent startup retries in their shared stack',async({page})=>{
 await mount(page,true);const retries=page.getByRole('button',{name:'Retry Couldn’t open workspace',exact:true});
 await expect(retries).toHaveCount(2);await page.unroute('**/api/snapshot');
 await retries.first().click();await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveCount(1);
 await expect(retries).toHaveCount(1);await retries.click();
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveCount(2);
});

test('closing a conversation releases only its startup and sync retries before reopening',async({page})=>{
 const fixture=await mount(page,true),retries=page.getByRole('button',{name:'Retry Couldn’t open workspace',exact:true});
 await expect(retries).toHaveCount(2);
 await page.evaluate(()=>(window as unknown as {notificationFixture:Fixture}).notificationFixture.setSecondConversation(false));
 await expect(retries).toHaveCount(1);
 await page.evaluate(()=>(window as unknown as {notificationFixture:Fixture}).notificationFixture.setSecondConversation(true));
 await expect(retries).toHaveCount(2);await page.unroute('**/api/snapshot');
 await retries.first().click();await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveCount(1);
 await expect(retries).toHaveCount(1);await retries.click();
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveCount(2);await expect(retries).toHaveCount(0);
 await page.route('**/api/snapshot',route=>route.fulfill({status:503,json:{error:{message:'Split sync unavailable'}}}));await fixture.publish();
 const sync=page.getByRole('button',{name:'Retry Couldn’t update workspace',exact:true});await expect(sync).toHaveCount(2);
 await page.evaluate(()=>(window as unknown as {notificationFixture:Fixture}).notificationFixture.setSecondConversation(false));
 await expect(sync).toHaveCount(1);
});

test('hidden notifications release the docked browser and finish receipt and exit timers',async({page})=>{
 await mount(page);
 const fixture='/@fs/'+encodeURI(fileURLToPath(new URL('./native-browser-bounds-fixture.tsx',import.meta.url)).replaceAll('\\','/'));
 await page.evaluate(async fixture=>{
  const root=document.createElement('div');root.id='root';Object.assign(root.style,{position:'absolute',left:'100px',top:'100px',width:'300px',height:'200px',display:'flex',flexDirection:'column'});document.body.append(root);
  await import(fixture);
 },fixture);
 await expect.poll(()=>page.evaluate(()=>window.geometryCalls.at(-1)?.bounds.width)).toBe(0);
 await page.getByRole('button',{name:'Hide notifications (5)',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.geometryCalls.at(-1)?.bounds.width)).toBeGreaterThan(0);
 await page.evaluate(async()=>{
  const {store}=(window as unknown as {notificationFixture:Fixture}).notificationFixture;
  store.dismiss(store.getSnapshot().find(entry=>entry.title==='Operation 5')!.id);
  await store.retry(store.getSnapshot().find(entry=>entry.title==='Operation 4')!.id);
 });
 await expect(page.getByRole('button',{name:'Show notifications (3)',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Show notifications (3)',exact:true}).click();
 await expect(page.getByRole('region',{name:'Workspace errors',exact:true}).getByRole('alert')).toHaveCount(3);
 await expect.poll(()=>page.evaluate(()=>window.geometryCalls.at(-1)?.bounds.width)).toBe(0);
});

test('three visible notices, bounded older errors, solid surface and reversible hiding',async({page})=>{
 await mount(page);const panel=page.getByRole('region',{name:'Workspace errors',exact:true});
 await expect(panel.getByRole('alert')).toHaveCount(3);await panel.getByRole('button',{name:'+2 more',exact:true}).click();
 await expect(panel.getByRole('alert')).toHaveCount(5);expect(await panel.locator('.workspace-notifications-list').evaluate(node=>node.clientHeight)).toBeLessThanOrEqual(312);
 await panel.getByRole('button',{name:'Dismiss Operation 1',exact:true}).scrollIntoViewIfNeeded();await expect(panel.getByRole('button',{name:'Dismiss Operation 1',exact:true})).toBeVisible();
 await panel.getByRole('button',{name:'Show fewer',exact:true}).click();await expect(panel.getByRole('alert')).toHaveCount(3);
 const surface=await panel.evaluate(node=>({background:getComputedStyle(node).backgroundColor,shadow:getComputedStyle(node).boxShadow}));
 expect(surface.background).not.toBe('rgba(0, 0, 0, 0)');expect(surface.shadow).not.toBe('none');
 expect(await panel.locator('.workspace-notification-slot').first().evaluate(node=>getComputedStyle(node).transitionProperty)).toContain('opacity');
 await page.getByRole('button',{name:'Hide notifications (5)',exact:true}).click();await expect(panel).toBeHidden();
 await page.getByRole('button',{name:'Underlying content',exact:true}).click();await expect(page.getByRole('button',{name:'Underlying content',exact:true})).toBeFocused();
 await page.getByRole('button',{name:'Show notifications (5)',exact:true}).click();await expect(panel.getByRole('alert')).toHaveCount(3);
 await panel.getByRole('button',{name:'Dismiss Operation 5',exact:true}).focus();await page.keyboard.press('Escape');await expect(panel).toBeHidden();await expect(page.getByRole('button',{name:'Show notifications (5)',exact:true})).toBeFocused();
});

test('independent retries, paused success receipt, and dismiss during a pending retry',async({page})=>{
 await mount(page);const fifth=page.getByRole('alert').filter({hasText:'Operation 5'}),fourth=page.getByRole('alert').filter({hasText:'Operation 4'});
 await fifth.getByRole('button',{name:'Retry Operation 5',exact:true}).click();await expect(fifth.getByRole('button',{name:'Retry Operation 5',exact:true})).toBeDisabled();
 await fourth.getByRole('button',{name:'Retry Operation 4',exact:true}).click();await expect(fourth).toContainText('Recovered');
 await fourth.getByRole('button',{name:'Dismiss Operation 4',exact:true}).focus();await page.waitForTimeout(2100);await expect(fourth).toBeVisible();
 expect(await page.evaluate(()=>(window as unknown as {notificationFixture:Fixture}).notificationFixture.calls)).toEqual([5,4]);
 await fifth.getByRole('button',{name:'Dismiss Operation 5',exact:true}).click();await expect(fifth).toHaveCount(0);
 await page.evaluate(()=>(window as unknown as {notificationFixture:Fixture}).notificationFixture.resolve());await expect(page.getByRole('alert').filter({hasText:'Operation 5'})).toHaveCount(0);
 await page.getByRole('button',{name:'Underlying content',exact:true}).focus();await page.mouse.move(0,700);await expect(fourth).toHaveCount(0,{timeout:4000});
 await expect(page.getByRole('alert').filter({hasText:'Operation 3'})).toBeVisible();
});

test('successful receipts expire when actual focus left with the removed retry control',async({page})=>{
 await mount(page);
 const fourth=page.getByRole('alert').filter({hasText:'Operation 4'}),fifth=page.getByRole('alert').filter({hasText:'Operation 5'});
 await fourth.getByRole('button',{name:'Retry Operation 4',exact:true}).click();await expect(fourth).toContainText('Recovered');
 expect(await fourth.evaluate(node=>node.contains(document.activeElement))).toBe(false);
 await page.mouse.move(0,700);await expect(fourth).toHaveCount(0,{timeout:3500});
 await fifth.getByRole('button',{name:'Retry Operation 5',exact:true}).click();await expect(fifth).toContainText('Retrying');
 await page.evaluate(()=>(window as unknown as {notificationFixture:Fixture}).notificationFixture.resolve());await expect(fifth).toContainText('Recovered');
 await page.getByRole('button',{name:'Underlying content',exact:true}).focus();await page.mouse.move(0,700);await expect(fifth).toHaveCount(0,{timeout:3500});
 await expect(page.getByRole('alert').filter({hasText:'Operation 3'})).toBeVisible();
});

test('a success receipt pauses while the card retains actual focus and expires after blur',async({page})=>{
 await mount(page);const fourth=page.getByRole('alert').filter({hasText:'Operation 4'});
 await fourth.getByRole('button',{name:'Retry Operation 4',exact:true}).click();await expect(fourth).toContainText('Recovered');
 await fourth.getByRole('button',{name:'Dismiss Operation 4',exact:true}).focus();await page.mouse.move(0,700);
 await page.waitForTimeout(2400);await expect(fourth).toBeVisible();
 await page.getByRole('button',{name:'Underlying content',exact:true}).focus();
 await expect(fourth).toHaveCount(0,{timeout:3000});
});

test('long errors fit narrow screens and app/OS motion policies stop translation and spinning',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:390,height:700});await mount(page);
 const panel=page.getByRole('region',{name:'Workspace errors',exact:true});await expect(panel).toHaveAttribute('data-motion','reduced');
 await page.getByRole('button',{name:'Retry Operation 5',exact:true}).click();
 expect(await panel.locator('.spinning').evaluate(node=>getComputedStyle(node).animationName)).toBe('none');
 expect(await panel.locator('.workspace-notification-slot').first().evaluate(node=>getComputedStyle(node).transform)).toBe('none');
 await page.evaluate(()=>{document.documentElement.dataset.motion='off';(window as unknown as {notificationFixture:Fixture}).notificationFixture.store.report('Unbroken'.repeat(90),{title:'Long failure'});});
 await expect(panel).toHaveAttribute('data-motion','off');const bounds=await panel.boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(390);
 expect(await panel.locator('.workspace-notifications-list').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
 expect(await panel.locator('.workspace-notification-slot').first().evaluate(node=>getComputedStyle(node).animationName)).toBe('none');
 await page.getByRole('button',{name:'Dismiss Long failure',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'Long failure'})).toHaveCount(0);
});

test('workspace sync retry reads only the snapshot and preserves an unrelated guarded handoff error',async({page})=>{
 const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Synthetic scoped recovery'}}}}),fixture=await serveTaskFixture(page,snapshot);
 let broken=false,reads=0,bootstrap=0,models=0;
 page.on('request',request=>{const path=new URL(request.url()).pathname;if(path==='/api/bootstrap')bootstrap++;if(path==='/api/models')models++;});
 await page.route('**/api/snapshot',route=>{reads++;return route.fulfill(broken?{status:503,json:{error:{message:'Workspace sync is offline'}}}:{json:snapshot});});
 await page.goto('/');await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();
 await page.evaluate(async()=>{const path='/src/editor-handoff.ts',module=await import(path);module.registerEditorHandoff('synthetic-stack',async()=>{throw Error('Save edits before leaving');});});
 broken=true;await fixture.publish();await expect(page.getByRole('alert').filter({hasText:'Workspace sync is offline'})).toHaveCount(2);
 await page.getByRole('button',{name:'New thread',exact:true}).click();const guarded=page.getByRole('alert').filter({hasText:'Save edits before leaving'});await expect(guarded).toBeVisible();
 await expect(guarded.getByRole('button',{name:/^Retry /})).toHaveCount(0);
 const before={bootstrap,models,reads};broken=false;const retries=page.getByRole('button',{name:'Retry Couldn’t update workspace',exact:true});await retries.first().click();
 await expect(page.getByRole('alert').filter({hasText:'Recovered'})).toBeVisible();expect(reads).toBe(before.reads+1);expect(bootstrap).toBe(before.bootstrap);expect(models).toBe(before.models);await expect(guarded).toBeVisible();
 await expect(retries).toHaveCount(1);await retries.click();await expect(retries).toHaveCount(0);expect(reads).toBe(before.reads+2);expect(bootstrap).toBe(before.bootstrap);expect(models).toBe(before.models);await expect(guarded).toBeVisible();
 expect(fixture.commands.filter(command=>command.type==='thread.create')).toHaveLength(0);
});

test('startup failure remains recoverable without replacing another notice',async({page})=>{
 const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Startup retry'}}}});await serveTaskFixture(page,snapshot);let broken=true;
 await page.route('**/api/snapshot',route=>route.fulfill(broken?{status:503,json:{error:{message:'Startup unavailable'}}}:{json:snapshot}));
 await page.goto('/');const error=page.getByRole('alert').filter({hasText:'Startup unavailable'});await expect(error).toBeVisible();broken=false;
 await error.getByRole('button',{name:'Retry Couldn’t open workspace',exact:true}).click();await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();await expect(error).toHaveCount(0);
});
