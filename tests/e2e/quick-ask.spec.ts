import {test,expect,type Page} from '@playwright/test';
import {taskFixture,serveTaskFixture} from './task-interface-fixture';
import type {HostCommand} from '../../packages/contracts';

const fixture=()=>taskFixture({root:'field',elements:{field:{type:'Input',props:{stateKey:'name',label:'Review name'}}}});

/** Stubbed desktop bridge for the quick-ask surface; __quickAskOpen pushes the open payload the main window would send. */
async function quickAskBridge(page:Page,registration='ready'){
 await page.addInitScript(state=>{
  const w=window as unknown as Record<string,any>;
  const windows=[{id:'main',surface:{kind:'main'},ready:true,minimized:false},{id:'quick-ask',surface:{kind:'quick-ask'},ready:true,minimized:false}];
  const context=()=>({windowId:'quick-ask',surface:{kind:'quick-ask'},windows});
  w.__desktopCalls=[];w.__registration=state;
  w.harnessDesktop={
   getContext:async()=>context(),ready:async()=>context(),list:async()=>windows,
   onState:(fn:(state:any)=>void)=>{w.__desktopState=fn;return()=>{};},
   onCloseRequested:()=>()=>{},
   detach:async()=>({}),reattach:async()=>{},minimize:async()=>{},resetBounds:async()=>{},
   focus:async(id:string)=>{w.__desktopCalls.push(['focus',id]);},browser:async()=>{},
   quickAskHide:async()=>{w.__desktopCalls.push(['quickAskHide']);},
   quickAskResize:async(height:number)=>{w.__desktopCalls.push(['quickAskResize',height]);},
   quickAskSent:async(notice:unknown)=>{w.__desktopCalls.push(['quickAskSent',notice]);},
   setQuickAskConfig:async(config:unknown)=>{w.__desktopCalls.push(['setQuickAskConfig',config]);return w.__registration;},
   setQuickAskContext:async()=>{},
   onQuickAskOpen:(fn:(value:any)=>void)=>{w.__quickAskOpen=fn;return()=>{};},
   onQuickAskRegistration:(fn:(state:any)=>void)=>{w.__quickAskRegistration=fn;return()=>{};},
  };
 },registration);
}

const openQuickAsk=async(page:Page,overrides:Record<string,unknown>={})=>{await page.waitForFunction(()=>typeof (window as any).__quickAskOpen==='function');await page.evaluate(value=>(window as any).__quickAskOpen({target:'new',currentThreadId:null,currentThreadTitle:null,currentThreadSendable:false,currentProjectId:'project-1',currentProjectName:'Fixture project',...value}),overrides);};

/** Records /api/commands and lets a test fail the next one; the fixture keeps serving snapshot/events. */
async function quickAskCommands(page:Page){
 const commands:HostCommand[]=[];const state={failType:'',seq:100,created:0};
 await page.route('**/api/commands',route=>{
  const command=route.request().postDataJSON() as HostCommand;commands.push(command);
  if(command.type===state.failType){state.failType='';return route.fulfill({status:500,json:{error:{code:'SYNTHETIC_FAILURE',message:'Synthetic send failure.'}}});}
  const result=command.type==='thread.create'?{id:`quick-thread-${++state.created}`}:{};
  void route.fulfill({json:{commandId:command.id,seq:++state.seq,result}});
 });
 return {commands,fail:(type:string)=>{state.failType=type;}};
}

test('quick-ask surface renders the composer, sends to a new thread and notifies the host',async({page})=>{
 await quickAskBridge(page);await serveTaskFixture(page,fixture());const host=await quickAskCommands(page);
 await page.goto('/');
 const input=page.getByRole('textbox',{name:'Ask Gen V1',exact:true});
 await openQuickAsk(page);
 await expect(input).toBeVisible({timeout:15000});
 await expect(page.getByRole('radio',{name:'New thread',exact:true})).toHaveAttribute('aria-checked','true');
 await expect(page.locator('.quick-ask-where')).toContainText('Fixture project');
 await input.fill('Summarize the fixture');
 await page.keyboard.press('Enter');
 await expect.poll(()=>host.commands.map(command=>command.type)).toEqual(['thread.create','message.send']);
 const send=host.commands[1];
 expect(send.threadId).toBe('quick-thread-1');
 expect(send.payload).toMatchObject({content:'Summarize the fixture',modelId:'test/model'});
 await expect.poll(()=>page.evaluate(()=>(window as any).__desktopCalls.filter((call:any)=>call[0]==='quickAskSent'))).toEqual([['quickAskSent',{threadId:'quick-thread-1',target:'new'}]]);
 await expect(input).toHaveValue('');
});

test('current-thread target stays disabled while the thread cannot accept input',async({page})=>{
 await quickAskBridge(page);await serveTaskFixture(page,fixture());
 await page.goto('/');
 await openQuickAsk(page,{target:'current',currentThreadId:'task-thread',currentThreadTitle:'Busy fixture',currentThreadSendable:false});
 const radio=page.getByRole('radio',{name:'Current thread',exact:true});
 await expect(radio).toBeDisabled();
 await expect(radio).toHaveAttribute('title','This thread is busy');
});

test('a failed send keeps the draft and the retry reuses the command id and thread',async({page})=>{
 await quickAskBridge(page);await serveTaskFixture(page,fixture());const host=await quickAskCommands(page);
 await page.goto('/');
 const input=page.getByRole('textbox',{name:'Ask Gen V1',exact:true});
 await openQuickAsk(page);
 await input.fill('Retry this prompt');
 host.fail('message.send');
 await page.keyboard.press('Enter');
 await expect(page.getByRole('alert')).toContainText('Synthetic send failure');
 await expect(input).toHaveValue('Retry this prompt');
 await page.getByRole('button',{name:'Retry',exact:true}).click();
 await expect(page.getByRole('alert')).toHaveCount(0);
 const sends=host.commands.filter(command=>command.type==='message.send');
 expect(sends).toHaveLength(2);
 expect(sends[0].id).toBe(sends[1].id);
 expect(sends.every(command=>command.threadId==='quick-thread-1')).toBe(true);
 expect(host.commands.filter(command=>command.type==='thread.create')).toHaveLength(1);
});

test('Escape hides the quick-ask window through the bridge',async({page})=>{
 await quickAskBridge(page);await serveTaskFixture(page,fixture());
 await page.goto('/');
 await openQuickAsk(page);
 await page.getByRole('textbox',{name:'Ask Gen V1',exact:true}).press('Escape');
 await expect.poll(()=>page.evaluate(()=>(window as any).__desktopCalls)).toContainEqual(['quickAskHide']);
});

/** Main-window bridge so Settings renders as the desktop build; registration state is pushed through __quickAskRegistration. */
async function mainBridge(page:Page,registration='ready'){
 await page.addInitScript(state=>{
  const w=window as unknown as Record<string,any>;
  const windows=[{id:'main',surface:{kind:'main'},ready:true,minimized:false}];
  w.__registration=state;
  w.harnessDesktop={
   getContext:async()=>({windowId:'main',surface:{kind:'main'},windows}),ready:async()=>({}),list:async()=>windows,
   onState:(fn:(state:any)=>void)=>{w.__desktopState=fn;return()=>{};},
   onCloseRequested:()=>()=>{},
   detach:async()=>({}),reattach:async()=>{},minimize:async()=>{},resetBounds:async()=>{},
   focus:async()=>{},browser:async()=>{},
   setQuickAskConfig:async()=>w.__registration,setQuickAskContext:async()=>{},
   onQuickAskOpen:()=>()=>{},
   onQuickAskRegistration:(fn:(state:any)=>void)=>{w.__quickAskRegistration=fn;return()=>{};},
  };
 },registration);
}

test('settings show the quick-ask group only with the desktop bridge and reflect each registration state',async({page})=>{
 const snapshot=fixture();
 (snapshot.settings as Record<string,unknown>).preferences={quickAskEnabled:true};
 // Browser build: no bridge, no group, no search hit.
 await serveTaskFixture(page,snapshot);
 await page.goto('/');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await expect(page.locator('[data-setting-id="quick-ask-enabled"]')).toHaveCount(0);
 await page.getByRole('searchbox',{name:'Search all settings',exact:true}).fill('hotkey');
 await expect(page.locator('.settings-result',{hasText:'Quick ask'})).toHaveCount(0);
 // Desktop build: the group renders, search finds it, and each state gets its copy.
 await mainBridge(page,'ready');
 await page.reload();
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await expect(page.locator('[data-setting-id="quick-ask-enabled"]')).toBeVisible({timeout:15000});
 await expect(page.locator('[data-setting-id="quick-ask-shortcut"]')).toBeVisible();
 await expect(page.locator('[data-setting-id="quick-ask-shortcut"]')).toContainText('Ready. Press Alt+Space in any app.');
 await page.getByRole('searchbox',{name:'Search all settings',exact:true}).fill('hotkey');
 await expect(page.getByRole('button',{name:/Quick ask/,exact:false}).first()).toBeVisible();
 await page.getByRole('button',{name:'General',exact:true}).click();
 await page.evaluate(()=>(window as any).__quickAskRegistration('in-use'));
 await expect(page.locator('[data-setting-id="quick-ask-shortcut"]')).toContainText('is used by another app');
 await page.evaluate(()=>(window as any).__quickAskRegistration('invalid'));
 await expect(page.locator('[data-setting-id="quick-ask-shortcut"]')).toContainText('Use a shortcut with Ctrl, Alt or Win');
 await page.evaluate(()=>(window as any).__quickAskRegistration('off'));
 await expect(page.locator('[data-setting-id="quick-ask-shortcut"] p')).toHaveCount(0);
 // Switching quick ask off disables the shortcut field.
 await expect(page.locator('[data-setting-id="quick-ask-shortcut"] input')).toBeEnabled();
 await page.getByRole('switch',{name:'Quick ask',exact:true}).click();
 await expect(page.locator('[data-setting-id="quick-ask-shortcut"] input')).toBeDisabled({timeout:15000});
});

test('quick-ask panel evidence: dark, light and reduced motion',async({page},testInfo)=>{
 for(const [name,theme,motion] of [['dark','dark','no-preference'],['light','light','no-preference'],['reduced-motion','dark','reduce']] as const){
  const run=await page.context().browser()!.newContext({colorScheme:theme,reducedMotion:motion});
  const shot=await run.newPage();
  await quickAskBridge(shot);await serveTaskFixture(shot,fixture());
  await shot.goto('/');
  await openQuickAsk(shot);
  const input=shot.getByRole('textbox',{name:'Ask Gen V1',exact:true});
  await expect(input).toBeVisible({timeout:15000});
  await shot.locator('.quick-ask-panel').screenshot({path:testInfo.outputPath(`quick-ask-${name}.png`)});
  await run.close();
 }
});
