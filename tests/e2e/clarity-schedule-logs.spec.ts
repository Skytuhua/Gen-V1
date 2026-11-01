import {test,expect,type Page} from '@playwright/test';
import {taskFixture,serveTaskFixture} from './task-interface-fixture';

const slots={title:'Design review',timeZone:'America/Los_Angeles',slots:[
 {id:'short',start:'2026-11-03T09:00:00-08:00',end:'2026-11-03T09:30:00-08:00',label:'Design review',availability:'available'},
 {id:'busy',start:'2026-11-03T10:00:00-08:00',end:'2026-11-03T11:00:00-08:00',label:'Team review',availability:'unavailable'},
 {id:'long',start:'2026-11-03T11:30:00-08:00',end:'2026-11-03T13:00:00-08:00',label:'Working session',availability:'available'},
 {id:'tentative',start:'2026-11-04T14:00:00-08:00',end:'2026-11-04T14:45:00-08:00',label:'Afternoon review',availability:'tentative'},
]};
async function schedule(page:Page,theme:'light'|'dark'='light'){
 const snapshot=taskFixture({root:'schedule',elements:{schedule:{type:'SchedulePicker',props:{dataBinding:'slots',stateKey:'time',actionId:'ask',actionLabel:'Propose time'}}}},{slots});
 snapshot.settings.theme=theme;const host=await serveTaskFixture(page,snapshot);await page.goto('/');return host;
}

for(const theme of ['light','dark'] as const)test(`time blocks and selected checks remain visibly distinct in ${theme}`,async({page})=>{
 await schedule(page,theme);const option=page.getByRole('option',{name:'Working session',exact:true});
 const band=option.locator('.schedule-interval-band');await expect(band).toBeVisible();expect((await band.boundingBox())!.height).toBeGreaterThanOrEqual(26);
 await option.click();await expect(option).toHaveAttribute('aria-selected','true');
 const selection=option.locator('.schedule-choice');await expect(selection.locator('svg')).toBeVisible();
 const contrast=await selection.evaluate(node=>{const rgb=(color:string)=>color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(v=>{const c=v/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});const lum=(color:string)=>{const c=rgb(color);return .2126*c[0]+.7152*c[1]+.0722*c[2];};const style=getComputedStyle(node),fg=lum(style.color),bg=lum(style.backgroundColor);return (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);});
 expect(contrast).toBeGreaterThanOrEqual(4.5);await expect(option).toHaveAccessibleDescription(/Selected/);
});

test('availability and tentative selection are understandable without relying on color',async({page})=>{
 const host=await schedule(page);const unavailable=page.getByRole('option',{name:'Team review',exact:true}),tentative=page.getByRole('option',{name:'Afternoon review',exact:true});
 await expect(unavailable).toHaveAccessibleDescription(/Unavailable/);await expect(tentative).toHaveAccessibleDescription(/Tentative/);
 await tentative.click();await expect(tentative.locator('.schedule-availability')).toHaveText('Selected · Tentative');
 await expect(page.locator('.schedule-proposal')).toContainText('Wed, Nov 4');
 await expect(page.getByRole('button',{name:'Propose time',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Propose time',exact:true}).click();
 await expect.poll(()=>host.commands.filter(command=>command.type==='action.submit').length).toBe(1);
 expect(host.commands.find(command=>command.type==='action.submit')!.payload.payload).toEqual({slotId:'tentative',start:slots.slots[3].start,end:slots.slots[3].end,timeZone:slots.timeZone});
});

test('narrow selection targets stay clear and leave scrolling to chat',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});const host=await schedule(page,'dark');
 const first=page.getByRole('option',{name:'Design review',exact:true});await first.click();await first.press('ArrowDown');
 const selected=page.getByRole('option',{name:'Working session',exact:true});await expect(selected).toBeFocused();await expect(selected).toHaveAttribute('aria-selected','true');
 expect((await selected.boundingBox())!.height).toBeGreaterThanOrEqual(44);
 const sizes=await selected.evaluate(node=>({width:node.clientWidth,scrollWidth:node.scrollWidth,overflow:getComputedStyle(node.closest('.schedule-slots')!).overflowY}));
 expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.width+1);expect(['auto','scroll']).not.toContain(sizes.overflow);
 await expect.poll(()=>host.snapshot.userStates[0].values.time).toMatchObject({selectedId:'long'});await page.reload();await expect(selected).toHaveAttribute('aria-selected','true');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('log rows expose their inline context affordance while keeping messages once',async({page})=>{
 const data={title:'Checkout investigation',events:[{id:'accepted',level:'info',message:'Request accepted'},{id:'failed',level:'error',message:'Quantity assertion failed',detail:'Expected 12, received 3',correlationId:'checkout-17'}]};
 const snapshot=taskFixture({root:'logs',elements:{logs:{type:'LogExplorer',props:{dataBinding:'events',stateKey:'logs',actionId:'ask'}}}},{events:data});await serveTaskFixture(page,snapshot);await page.goto('/');
 const failure=page.getByRole('option',{name:'error: Quantity assertion failed',exact:true});await expect(failure.locator('.log-event-indicator')).toBeVisible();await failure.click();
 await expect(failure.locator('.log-event-indicator')).toHaveAttribute('data-expanded','true');
 await expect(page.getByText('Quantity assertion failed',{exact:true})).toHaveCount(1);await page.getByText('Event details',{exact:true}).click();await expect(page.locator('.log-selection pre')).toContainText('Expected 12, received 3');
});

test('pending proposals do not label a later local selection as the submitted time',async({page})=>{
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
 const snapshot=taskFixture({root:'schedule',elements:{schedule:{type:'SchedulePicker',props:{dataBinding:'slots',stateKey:'time',actionId:'ask'}}}},{slots});
 const host=await serveTaskFixture(page,snapshot,async()=>{await pending;return {};});await page.goto('/');
 try{
  await page.getByRole('option',{name:'Design review',exact:true}).click();await page.getByRole('button',{name:'Propose this time',exact:true}).click();
  await expect(page.getByRole('button',{name:'Sending…',exact:true})).toBeDisabled();await page.getByRole('option',{name:'Afternoon review',exact:true}).click();
  await expect(page.locator('.schedule-proposal')).not.toContainText('Wed, Nov 4');
  expect(host.commands.find(command=>command.type==='action.submit')!.payload.payload).toMatchObject({slotId:'short'});
 }finally{release();}
});
