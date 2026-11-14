import {test,expect} from '@playwright/test';
import {PLANNING_PROVENANCE,planDataId} from '../../packages/contracts/planning';
import {serveTaskFixture,taskFixture} from './task-interface-fixture';
const planValue={version:1,title:'Repair checkout failures',steps:[{id:'find',title:'Find the failing boundary',status:'working',requirements:[{id:'reproduce',label:'Reproduce quantity assertion',completed:true}]},{id:'tests',title:'Run checkout tests',status:'pending',requirements:[]}],agents:[]};
const row=()=>({id:planDataId('task-thread'),threadId:'task-thread',revision:1,provenance:PLANNING_PROVENANCE,createdAt:'2026-11-01T00:00:00Z',value:structuredClone(planValue)});
const fixture=()=>taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Checkout investigation.'}}}});

test('same-thread plan publication opens the overview without stealing the composer and collapse survives progress',async({page})=>{
 const snapshot=fixture();snapshot.threads[0].runId='run-a';snapshot.threads[0].epoch=1;
 const host=await serveTaskFixture(page,snapshot);await page.goto('/');const message=page.getByRole('textbox',{name:'Message',exact:true});await expect(message).toBeEnabled();await message.fill('Keep typing here.');await message.focus();
 const overview=page.getByRole('region',{name:'Project overview window',exact:true});await expect(overview).toHaveAttribute('data-collapsed','true');
 snapshot.data.push({...row(),threadId:'other'});await host.publish();await expect(overview.locator('[data-plan-revision]')).toHaveCount(0);
 snapshot.data.push({...row(),value:{version:1,title:'Not a plan',steps:'invalid',agents:[]} });await host.publish();await expect(overview.locator('[data-plan-revision]')).toHaveCount(0);
 snapshot.data[snapshot.data.length-1]=row();await host.publish();
 await expect(overview.getByText('Update available',{exact:true})).toBeVisible();await expect(overview).toHaveAttribute('data-collapsed','true');await expect(message).toBeFocused();
 await overview.getByRole('button',{name:'Expand Project overview',exact:true}).click();await expect(overview).toHaveAttribute('data-collapsed','false');await expect(overview.getByRole('region',{name:'Plan summary',exact:true})).toBeVisible();await expect(message).toHaveValue('Keep typing here.');
 await overview.getByRole('button',{name:'Collapse Project overview',exact:true}).click();await expect(overview).toHaveAttribute('data-collapsed','true');
 snapshot.data[snapshot.data.length-1].revision++;await host.publish();await expect(overview).toHaveAttribute('data-collapsed','true');await expect(overview.getByText('Update available',{exact:true})).toHaveCount(0);
 await page.reload();await expect(message).toBeEnabled();await expect(overview).toHaveAttribute('data-collapsed','true');
 snapshot.threads[0].runId='run-b';snapshot.threads[0].epoch++;snapshot.data[snapshot.data.length-1].revision++;await host.publish();await expect(overview.getByText('Update available',{exact:true})).toBeVisible();
 await overview.getByRole('button',{name:'Expand Project overview',exact:true}).click();await expect(overview).toHaveAttribute('data-collapsed','false');await expect(overview.getByRole('region',{name:'Plan summary',exact:true})).toHaveAttribute('data-plan-revision','3');await expect(message).toHaveValue('Keep typing here.');
});

test('attachment chips belong to the compact composer header utility group',async({page})=>{
 const snapshot=fixture();snapshot.resources.push({id:'attachment',threadId:'task-thread',kind:'file',path:'C:/fixture/checkout.txt',label:'checkout.txt',writable:false,version:'fixture',createdAt:'2026-11-01T00:00:00Z'} as typeof snapshot.resources[number]);await serveTaskFixture(page,snapshot);await page.goto('/');
 const attachments=page.locator('form.composer').getByRole('group',{name:'Attachments',exact:true});await expect(attachments.getByText('checkout.txt',{exact:true})).toBeVisible();await expect(page.locator('form.composer').getByRole('group',{name:'Task actions',exact:true})).toBeVisible();await expect(page.locator('.composer-dock > .resource-strip')).toHaveCount(0);
});

test('switching threads shows each plan in the shared overview and collapse persists',async({page})=>{
 const snapshot=fixture();snapshot.threads[0].title='First task';snapshot.data.push(row());const second={...snapshot.threads[0],id:'second',title:'Second task'};snapshot.threads.push(second,{...second,id:'empty',title:'Empty task'});snapshot.data.push({...row(),id:planDataId('second'),threadId:'second',revision:2});
 await serveTaskFixture(page,snapshot);await page.goto('/');const overview=page.getByRole('region',{name:'Project overview window',exact:true});const summary=overview.getByRole('region',{name:'Plan summary',exact:true});
 await overview.getByRole('button',{name:'Expand Project overview',exact:true}).click();await expect(summary).toBeVisible();await expect(summary).toHaveAttribute('data-plan-revision','1');
 await page.locator('.sidebar').getByText('Second task',{exact:true}).click();await expect(summary).toHaveAttribute('data-plan-revision','2');
 await overview.getByRole('button',{name:'Collapse Project overview',exact:true}).click();await expect(overview).toHaveAttribute('data-collapsed','true');
 await page.locator('.sidebar').getByText('First task',{exact:true}).click();await expect(overview).toHaveAttribute('data-collapsed','true');
 await page.locator('.sidebar').getByText('Empty task',{exact:true}).click();await expect(overview.locator('[data-plan-revision]')).toHaveCount(0);
});
