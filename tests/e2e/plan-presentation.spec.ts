import {test,expect} from '@playwright/test';
import {PLANNING_PROVENANCE,planDataId} from '../../packages/contracts/planning';
import {serveTaskFixture,taskFixture} from './task-interface-fixture';
const planValue={version:1,title:'Repair checkout failures',steps:[{id:'find',title:'Find the failing boundary',status:'working',requirements:[{id:'reproduce',label:'Reproduce quantity assertion',completed:true}]},{id:'tests',title:'Run checkout tests',status:'pending',requirements:[]}],agents:[]};
const row=()=>({id:planDataId('task-thread'),threadId:'task-thread',revision:1,provenance:PLANNING_PROVENANCE,createdAt:'2026-11-01T00:00:00Z',value:structuredClone(planValue)});
const fixture=()=>taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Checkout investigation.'}}}});

test('same-thread plan publication opens without stealing the composer and dismissal survives progress',async({page})=>{
 const snapshot=fixture();snapshot.threads[0].runId='run-a';snapshot.threads[0].epoch=1;
 await page.addInitScript(()=>localStorage.setItem('harness:floating:plan:v1',JSON.stringify({x:0,y:0,width:376,height:700,collapsed:true})));
 const host=await serveTaskFixture(page,snapshot);await page.goto('/');const message=page.getByRole('textbox',{name:'Message',exact:true});await expect(message).toBeEnabled();await message.fill('Keep typing here.');await message.focus();
 const panel=page.getByRole('region',{name:'Task plan window',exact:true});await expect(panel).toBeHidden();
 snapshot.data.push({...row(),threadId:'other'});await host.publish();await expect(panel).toBeHidden();
 snapshot.data.push({...row(),value:{...planValue,steps:[]} });await host.publish();await expect(panel).toBeHidden();
 snapshot.data[snapshot.data.length-1]=row();await host.publish();await expect(panel).toBeVisible();await expect(panel).toHaveAttribute('data-collapsed','false');await expect(message).toBeFocused();await expect(message).toHaveValue('Keep typing here.');
 await expect(page.getByRole('button',{name:'Open plan',exact:true})).toHaveCount(0);await panel.getByRole('button',{name:'Close Task plan',exact:true}).click();await expect(panel).toBeHidden();
 snapshot.data[snapshot.data.length-1].revision++;await host.publish();await expect(panel).toBeHidden();
 await page.reload();await expect(message).toBeEnabled();await expect(panel).toBeHidden();
 await page.getByRole('button',{name:'Thread options',exact:true}).click();await page.getByRole('button',{name:'Show plan',exact:true}).click();await expect(panel).toBeVisible();await expect(panel.getByRole('button',{name:'Move Task plan',exact:true})).toBeFocused();
 await panel.getByRole('button',{name:'Minimize Task plan',exact:true}).click();snapshot.data[snapshot.data.length-1].revision++;await host.publish();await expect(panel).toHaveAttribute('data-collapsed','true');
 await page.getByRole('button',{name:'Thread options',exact:true}).click();await page.getByRole('button',{name:'Show plan',exact:true}).click();await expect(panel).toHaveAttribute('data-collapsed','false');
 await panel.getByRole('button',{name:'Close Task plan',exact:true}).click();await expect(page.getByRole('button',{name:'Thread options',exact:true})).toBeFocused();
 snapshot.threads[0].runId='run-b';snapshot.threads[0].epoch++;await host.publish();await expect(panel).toBeHidden();await message.focus();snapshot.data[snapshot.data.length-1].revision++;await host.publish();await expect(panel).toBeVisible();await expect(panel).toHaveAttribute('data-collapsed','false');await expect(message).toBeFocused();
});

test('plan fits its rows, ignores old manual height, resets position and has no resize chrome',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});const snapshot=fixture();snapshot.data.push(row());
 await page.addInitScript(()=>localStorage.setItem('harness:floating:plan:v1',JSON.stringify({x:0,y:70,width:376,height:700,collapsed:false})));
 const host=await serveTaskFixture(page,snapshot);await page.goto('/');const panel=page.getByRole('region',{name:'Task plan window',exact:true});await expect(panel).toBeVisible();
 await expect.poll(async()=>(await panel.boundingBox())!.height).toBeLessThan(420);await expect(panel.getByRole('separator')).toHaveCount(0);await expect(page.locator('.floating-window-resize')).toHaveCount(0);
 const move=panel.getByRole('button',{name:'Move Task plan',exact:true});await move.press('ArrowDown');await panel.getByRole('button',{name:'Reset Task plan position',exact:true}).click();await expect.poll(()=>panel.evaluate(node=>parseFloat((node as HTMLElement).style.top))).toBe(0);
 const short=(await panel.boundingBox())!.height;const record=snapshot.data[0];record.value={...planValue,steps:Array.from({length:24},(_,index)=>({id:`test-${index}`,title:`Run checkout tests ${index+1}`,status:'pending',requirements:[]}))};record.revision++;await host.publish();
 await page.setViewportSize({width:390,height:844});const body=panel.locator('.floating-window-body');await body.evaluate(node=>node.scrollTo(0,node.scrollHeight));await expect(panel.getByText('Run checkout tests 24',{exact:true})).toBeInViewport();expect(short).toBeLessThan(420);
 await page.getByRole('button',{name:'Show live usage',exact:true}).click();const usage=page.getByRole('region',{name:'Live usage',exact:true});await usage.getByRole('button',{name:'Inspect live usage',exact:true}).click();await expect(usage.getByRole('separator')).toHaveCount(0);
 const usageMove=usage.getByRole('button',{name:'Move Live usage',exact:true});await page.setViewportSize({width:1440,height:1000});await expect.poll(async()=>(await usage.boundingBox())!.height).toBeGreaterThan(200);const height=(await usage.boundingBox())!.height;await usageMove.press('Shift+ArrowUp');await expect.poll(async()=>Math.round((await usage.boundingBox())!.height)).toBe(Math.round(height-12));
});

test('attachment chips belong to the compact composer header utility group',async({page})=>{
 const snapshot=fixture();snapshot.resources.push({id:'attachment',threadId:'task-thread',kind:'file',path:'C:/fixture/checkout.txt',label:'checkout.txt',writable:false,version:'fixture',createdAt:'2026-11-01T00:00:00Z'} as typeof snapshot.resources[number]);await serveTaskFixture(page,snapshot);await page.goto('/');
 const utility=page.locator('form.composer .composer-header-utilities');await expect(utility.getByText('checkout.txt',{exact:true})).toBeVisible();await expect(utility.getByRole('group',{name:'Task actions',exact:true})).toBeVisible();await expect(page.locator('.composer-dock > .resource-strip')).toHaveCount(0);
});

test('switching threads does not revive a dismissed plan or show it on an unrelated empty task',async({page})=>{
 const snapshot=fixture();snapshot.threads[0].title='First task';snapshot.data.push(row());const second={...snapshot.threads[0],id:'second',title:'Second task'};snapshot.threads.push(second,{...second,id:'empty',title:'Empty task'});snapshot.data.push({...row(),id:planDataId('second'),threadId:'second'});
 await serveTaskFixture(page,snapshot);await page.goto('/');const panel=page.getByRole('region',{name:'Task plan window',exact:true});await expect(panel).toBeVisible();await panel.getByRole('button',{name:'Close Task plan',exact:true}).click();await page.locator('.sidebar').getByText('Second task',{exact:true}).click();await expect(panel).toBeVisible();await page.locator('.sidebar').getByText('First task',{exact:true}).click();await expect(panel).toBeHidden();await page.locator('.sidebar').getByText('Empty task',{exact:true}).click();await expect(panel).toBeHidden();
});
