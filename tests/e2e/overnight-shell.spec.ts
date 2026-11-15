import {test,expect} from '@playwright/test';
import {serveTaskFixture,taskFixture} from './task-interface-fixture';

const fixture=()=>{const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Review the current changes.'}}}});snapshot.settings.theme='dark';snapshot.threads[0].projectName='Workspace';return snapshot;};

test('sidebar group folding retains its rows, becomes inert immediately and reverses without losing identity',async({page})=>{
 const snapshot=fixture();snapshot.threads[0].runId='run-1';const host=await serveTaskFixture(page,snapshot);await page.goto('/');
 const group=page.locator('.thread-group').filter({has:page.getByRole('button',{name:'Working 1',exact:true})}),toggle=group.locator('h2 button'),row=group.locator('.sidebar-thread-row').first();await expect(row).toBeVisible();const original=await row.elementHandle();
 await toggle.click();expect(await original!.evaluate(node=>node.isConnected)).toBe(true);await expect(row.locator('xpath=ancestor::*[@inert][1]')).toHaveCount(1);
 expect(await row.evaluate(node=>node.getBoundingClientRect().height)).toBeGreaterThan(0);
 await toggle.click();await expect(toggle).toHaveAttribute('aria-expanded','true');await expect(row).toBeVisible();expect(await row.evaluate((node,previous)=>node===previous,original)).toBe(true);
 const region=group.locator('.task-motion-region');await expect(region).toHaveAttribute('data-open','true');await host.publish();await expect(region).toHaveAttribute('data-open','true');
 await toggle.click();await expect(region).toHaveAttribute('data-open','false');await page.reload();await expect(toggle).toHaveAttribute('aria-expanded','false');await expect(row).toBeHidden();
});

for(const preference of ['reduced','disabled'] as const)test(`sidebar groups settle immediately with ${preference} shell motion`,async({page})=>{
 const snapshot=fixture();snapshot.threads[0].runId='run-1';if(preference==='reduced')await page.emulateMedia({reducedMotion:'reduce'});else snapshot.settings.preferences={panelAnimations:false};await serveTaskFixture(page,snapshot);await page.goto('/');const group=page.locator('.thread-group').filter({has:page.getByRole('button',{name:'Working 1',exact:true})});await group.locator('h2 button').click();const region=group.locator('.task-motion-region');await expect(region).toHaveAttribute('data-open','false');expect(await region.evaluate(node=>node.getBoundingClientRect().height)).toBe(0);
});
