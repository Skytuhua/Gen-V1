import {test,expect} from '@playwright/test';
import {serveTaskFixture,taskFixture} from './task-interface-fixture';
import {PLANNING_PROVENANCE,planDataId} from '../../packages/contracts/planning';

const fixture=()=>{const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Review the current changes.'}}}});snapshot.settings.theme='dark';snapshot.threads[0].projectName='Workspace';return snapshot;};

test('sidebar group folding retains its rows, becomes inert immediately and reverses without losing identity',async({page})=>{
 const snapshot=fixture(),host=await serveTaskFixture(page,snapshot);await page.goto('/');
 const group=page.locator('.thread-group').filter({has:page.getByRole('button',{name:'Workspace 1',exact:true})}),toggle=group.locator('h2 button'),row=group.locator('.sidebar-thread-row').first();await expect(row).toBeVisible();const original=await row.elementHandle();
 await toggle.click();expect(await original!.evaluate(node=>node.isConnected)).toBe(true);await expect(row.locator('xpath=ancestor::*[@inert][1]')).toHaveCount(1);
 expect(await row.evaluate(node=>node.getBoundingClientRect().height)).toBeGreaterThan(0);
 await toggle.click();await expect(toggle).toHaveAttribute('aria-expanded','true');await expect(row).toBeVisible();expect(await row.evaluate((node,previous)=>node===previous,original)).toBe(true);
 const region=group.locator('.task-motion-region');await expect(region).toHaveAttribute('data-motion-phase','open');await host.publish();await expect(region).toHaveAttribute('data-motion-phase','open');
 await toggle.click();await expect(region).toHaveAttribute('data-motion-phase','closed');await page.reload();await expect(toggle).toHaveAttribute('aria-expanded','false');await expect(row).toBeHidden();
});

for(const preference of ['normal','reduced','disabled'] as const)test(`Plan recentering is coordinated and input remains usable with ${preference} motion`,async({page})=>{
 const snapshot=fixture();if(preference==='reduced')await page.emulateMedia({reducedMotion:'reduce'});if(preference==='disabled')snapshot.settings.preferences={panelAnimations:false};const host=await serveTaskFixture(page,snapshot);await page.goto('/');const message=page.getByRole('textbox',{name:'Message',exact:true});await expect(message).toBeEnabled();await message.fill('Keep this draft.');await message.focus();
 await page.evaluate(()=>{const shell=document.querySelector<HTMLElement>('.shell-workarea')!;const samples:number[]=[];Object.assign(window,{reserveSamples:samples});let started=0;const sample=(time:number)=>{started||=time;samples.push(parseFloat(getComputedStyle(shell).paddingRight));if(time-started<650)requestAnimationFrame(sample);else Object.assign(window,{reserveSamplesDone:true});};requestAnimationFrame(sample);});
 snapshot.data.push({id:planDataId('task-thread'),threadId:'task-thread',revision:1,provenance:PLANNING_PROVENANCE,createdAt:new Date().toISOString(),value:{version:1,title:'Review checkout',steps:[{id:'test',title:'Run checkout tests',status:'working',requirements:[]}],agents:[]}});await host.publish();
 await expect(page.getByRole('region',{name:'Task plan window',exact:true})).toBeVisible();await expect(message).toBeFocused();await expect(message).toHaveValue('Keep this draft.');await expect.poll(()=>page.locator('.shell-workarea').evaluate(node=>parseFloat(getComputedStyle(node).paddingRight))).toBe(400);await expect.poll(()=>page.evaluate(()=>(window as unknown as {reserveSamplesDone?:boolean}).reserveSamplesDone)).toBe(true);
 const samples=await page.evaluate(()=>(window as unknown as {reserveSamples:number[]}).reserveSamples);expect(samples.some(value=>value>1&&value<399)).toBe(preference==='normal');
 const composer=await page.locator('.composer').boundingBox(),artifact=await page.locator('.artifact').boundingBox();expect(composer!.x).toBeCloseTo(artifact!.x,0);expect(composer!.width).toBeCloseTo(artifact!.width,0);
});

for(const preference of ['reduced','disabled'] as const)test(`sidebar groups settle immediately with ${preference} shell motion`,async({page})=>{
 const snapshot=fixture();if(preference==='reduced')await page.emulateMedia({reducedMotion:'reduce'});else snapshot.settings.preferences={panelAnimations:false};await serveTaskFixture(page,snapshot);await page.goto('/');const group=page.locator('.thread-group').filter({has:page.getByRole('button',{name:'Workspace 1',exact:true})});await group.locator('h2 button').click();const region=group.locator('.task-motion-region');await expect(region).toHaveAttribute('data-motion-phase','closed');expect(await region.evaluate(node=>node.getBoundingClientRect().height)).toBe(0);
});
