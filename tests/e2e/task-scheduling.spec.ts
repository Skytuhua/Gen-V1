import {test,expect,type Page} from '@playwright/test';
import {serveTaskFixture,taskFixture} from './task-interface-fixture';

// Synthetic renderer input; no calendar, terminal, model or external effect.
const windows={title:'Review availability',timeZone:'America/New_York',slots:[
  {id:'short',start:'2026-11-03T10:00:00-05:00',end:'2026-11-03T10:30:00-05:00',label:'Opening review',availability:'available',detail:'Bring the latest document.'},
  {id:'occupied',start:'2026-11-03T10:45:00-05:00',end:'2026-11-03T11:00:00-05:00',label:'Existing meeting',availability:'unavailable'},
  {id:'long',start:'2026-11-03T11:00:00-05:00',end:'2026-11-03T12:00:00-05:00',label:'Implementation review',availability:'available'},
  {id:'alternate',start:'2026-11-04T14:00:00-05:00',end:'2026-11-04T14:45:00-05:00',label:'Alternate review',availability:'tentative',detail:'Confirm the reviewer.'},
]};
const events={title:'Payment investigation',events:[
  {id:'received',timestamp:'2026-11-03T15:00:00Z',level:'info',message:'Request accepted',stream:'checkout',correlationId:'payment-17'},
  {id:'retry',timestamp:'2026-11-03T15:00:01Z',level:'warning',message:'Retry budget nearly exhausted',stream:'checkout',detail:'Attempts: 2 of 3',correlationId:'payment-17'},
  {id:'failed',level:'error',message:'Worker exited',stream:'payments',detail:'checkout.mjs:42',correlationId:'payment-17'},
  {id:'other',timestamp:'2026-11-03T15:00:02Z',level:'info',message:'Health check passed',stream:'health',correlationId:'health-8'},
]};
async function open(page:Page,kind:'SchedulePicker'|'LogExplorer',data:unknown,values:Record<string,unknown>={},action?:Parameters<typeof serveTaskFixture>[2]){
  const snapshot=taskFixture({root:'view',elements:{view:{type:kind,props:{dataBinding:'source',stateKey:'view',actionId:'ask'}}}},{source:data},values);
  snapshot.settings.theme='dark';
  const host=await serveTaskFixture(page,snapshot,action);await page.goto('/');return host;
}

test('availability tracks expose all supplied days and proportionate intervals without a duplicate selection card',async({page})=>{
  await open(page,'SchedulePicker',windows);
  await expect(page.locator('.schedule-day')).toHaveCount(2);
  await expect(page.getByRole('option',{name:'Alternate review',exact:true})).toBeVisible();
  const short=page.getByRole('option',{name:'Opening review',exact:true}),long=page.getByRole('option',{name:'Implementation review',exact:true});
  const shortBar=short.locator('.schedule-interval-band'),longBar=long.locator('.schedule-interval-band');
  await expect(shortBar).toBeVisible();
  expect((await longBar.boundingBox())!.width/(await shortBar.boundingBox())!.width).toBeCloseTo(2,1);
  await short.click();await expect(page.locator('.schedule-selection')).toHaveCount(0);
  await expect(page.getByText('Opening review',{exact:true})).toHaveCount(1);
  await expect(short).toContainText('30 min');await expect(long).toContainText('1 hr');
  await expect(page.getByText('America/New_York',{exact:true})).toBeVisible();
});

test('selection, keyboard navigation and exact proposal survive reload and source changes',async({page})=>{
  const host=await open(page,'SchedulePicker',windows);
  const first=page.getByRole('option',{name:'Opening review',exact:true});await first.click();await first.press('ArrowDown');
  const long=page.getByRole('option',{name:'Implementation review',exact:true});await expect(long).toBeFocused();await expect(long).toHaveAttribute('aria-selected','true');
  await long.press('ArrowDown');const alternate=page.getByRole('option',{name:'Alternate review',exact:true});await expect(alternate).toBeFocused();
  await expect.poll(()=>host.snapshot.userStates[0].values.view).toMatchObject({selectedId:'alternate',visibleDate:'2026-11-04'});
  await page.reload();await expect(alternate).toHaveAttribute('aria-selected','true');
  await page.getByRole('button',{name:'Propose this time',exact:true}).click();
  await expect.poll(()=>host.commands.filter(command=>command.type==='action.submit').length).toBe(1);
  expect(host.commands.find(command=>command.type==='action.submit')!.payload.payload).toEqual({slotId:'alternate',start:windows.slots[3].start,end:windows.slots[3].end,timeZone:'America/New_York'});
  host.setInput('source',{...windows,slots:windows.slots.filter(slot=>slot.id!=='alternate')});await host.publish();
  await expect(page.getByRole('button',{name:'Propose this time',exact:true})).toBeDisabled();
  await expect(page.getByText('The selected window is no longer supplied. Choose another.',{exact:true})).toBeVisible();
  await expect(page.getByRole('option',{name:'Existing meeting',exact:true})).toBeDisabled();
});

test('pending proposals keep the clicked action mounted and preserve the submitted interval',async({page})=>{
  let release!:()=>void;const pending=new Promise<void>(done=>{release=done;});
  const host=await open(page,'SchedulePicker',windows,{},async()=>{await pending;return {};});
  try{
    await page.getByRole('option',{name:'Opening review',exact:true}).click();const submit=page.getByRole('button',{name:'Propose this time',exact:true}),original=await submit.elementHandle();await submit.click();
    await expect(page.getByRole('button',{name:'Sending…',exact:true})).toBeDisabled();await page.getByRole('option',{name:'Alternate review',exact:true}).click();
    expect(await page.getByRole('button',{name:'Sending…',exact:true}).evaluate((node,old)=>node===old,original)).toBe(true);
    expect(host.commands.filter(command=>command.type==='action.submit')).toHaveLength(1);
    expect(host.commands.find(command=>command.type==='action.submit')!.payload.payload).toMatchObject({slotId:'short'});
  }finally{release();}
});

test('narrow neutral tracks remain readable and leave scrolling to chat',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
  const many={...windows,slots:Array.from({length:22},(_,index)=>({...windows.slots[0],id:`slot-${index}`,label:`Review ${index+1}`,start:new Date(Date.UTC(2026,10,3,15,index*10)).toISOString(),end:new Date(Date.UTC(2026,10,3,15,index*10+5)).toISOString()}))};
  await open(page,'SchedulePicker',many);const choice=page.getByRole('option',{name:'Review 1',exact:true});await choice.click();
  const selected=await choice.evaluate(node=>{const style=getComputedStyle(node);return {color:style.backgroundColor,overflow:getComputedStyle(node.closest('.schedule-slots')!).overflowY};});
  const rgb=selected.color.match(/\d+/g)!.map(Number);expect(Math.max(...rgb.slice(0,3))-Math.min(...rgb.slice(0,3))).toBeLessThanOrEqual(3);
  expect(['scroll','auto']).not.toContain(selected.overflow);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
  const chat=page.locator('.conversation-scroll');await choice.hover();const before=await chat.evaluate(node=>node.scrollTop);await page.mouse.wheel(0,350);await expect.poll(()=>chat.evaluate(node=>node.scrollTop)).toBeGreaterThan(before+30);
});

test('log context expands beside its event with related evidence and no repeated message',async({page})=>{
  const host=await open(page,'LogExplorer',events);
  const failure=page.getByRole('option',{name:'error: Worker exited',exact:true});await failure.click();
  const entry=page.locator('.log-entry').filter({has:failure});await expect(entry.locator('.log-selection')).toBeVisible();
  await expect(entry).toContainText('3 related events');await expect(entry.locator('.log-selection')).toContainText('Unavailable');
  await expect(page.getByText('Worker exited',{exact:true})).toHaveCount(1);
  await entry.getByText('Event details',{exact:true}).click();await expect(entry.locator('pre')).toContainText('checkout.mjs:42');
  await page.getByRole('searchbox',{name:'Search logs',exact:true}).fill('Worker');await expect(page.getByRole('listbox',{name:'Log events',exact:true}).getByRole('option')).toHaveCount(1);
  await expect.poll(()=>host.snapshot.userStates[0].values.view).toMatchObject({selectedId:'failed',query:'Worker'});
  await page.reload();await expect(failure).toHaveAttribute('aria-selected','true');await expect(page.getByRole('searchbox',{name:'Search logs',exact:true})).toHaveValue('Worker');
  await page.getByRole('button',{name:'Investigate event',exact:true}).click();await expect.poll(()=>host.commands.filter(command=>command.type==='action.submit').length).toBe(1);
  expect(host.commands.find(command=>command.type==='action.submit')!.payload.payload).toEqual({eventId:'failed',correlationId:'payment-17'});
});

test('same-source snapshots do not replay interval entrances or replace the selected control',async({page})=>{
  const host=await open(page,'SchedulePicker',windows);const option=page.getByRole('option',{name:'Opening review',exact:true});await option.click();const initial=await option.elementHandle();
  await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.playState==='running').map(a=>a.finished.catch(()=>{}))));await page.evaluate(()=>{(window as any).__taskAnimationCalls=0;const animate=Element.prototype.animate;Element.prototype.animate=function(...args){(window as any).__taskAnimationCalls++;return animate.apply(this,args);};});
  for(let index=0;index<3;index++){host.setInput('source',structuredClone(windows));await host.publish();}
  expect(await option.evaluate((node,old)=>node===old,initial)).toBe(true);
  expect(await page.evaluate(()=>(window as any).__taskAnimationCalls)).toBe(0);
});

test('an overnight interval identifies its ending day and retains its actual elapsed duration',async({page})=>{
  await open(page,'SchedulePicker',{...windows,slots:[{id:'overnight',start:'2026-11-03T23:30:00-05:00',end:'2026-11-04T00:30:00-05:00',label:'Late handoff',availability:'available'}]});
  const slot=page.getByRole('option',{name:'Late handoff',exact:true});await expect(slot).toContainText('Nov 4');await expect(slot).toContainText('1 hr');
  await page.setViewportSize({width:390,height:844});
  expect(await slot.locator('.schedule-slot-time').evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
});
