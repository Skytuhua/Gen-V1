import {test,expect,type Page} from '@playwright/test';
import {serveTaskFixture,taskFixture} from './task-interface-fixture';
import {SOFTWARE_FIXTURE_DATA,softwareDevelopmentSpec,type SoftwareFixtureName} from '../../scripts/software-development-fixtures';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';

async function open(page:Page,name:SoftwareFixtureName,theme?:'light'|'dark'){const snapshot=taskFixture(softwareDevelopmentSpec(name),{software:structuredClone(SOFTWARE_FIXTURE_DATA[name])});if(theme)snapshot.settings.theme=theme;const host=await serveTaskFixture(page,snapshot);await page.goto('/');await expect(page.locator('.software-surface')).toBeVisible();return host;}

test('diagnostics make the failure and complete check inventory readable without opening logs',async({page})=>{
 await open(page,'Diagnostics');
 await expect(page.getByLabel('Recorded results')).toContainText('1 failed');
 await expect(page.getByLabel('Recorded results')).toContainText('1 passed');
 await expect(page.getByLabel('Recorded results')).toContainText('1 not run');
 const comparison=page.getByRole('region',{name:'Assertion comparison',exact:true});
 await expect(comparison.getByText('Expected',{exact:true})).toBeVisible();await expect(comparison.getByText('Received',{exact:true})).toBeVisible();await expect(comparison).toContainText('12');await expect(comparison).toContainText('3');
 await expect(page.locator('.software-diagnostic-details')).not.toHaveAttribute('open');
});

test('a proposed patch exposes accurate old and new line numbers without changing the file',async({page})=>{
 const host=await open(page,'ChangeSet');const patch=page.getByLabel('Selected patch',{exact:true});
 await expect(patch.locator('[data-line-kind="removed"]')).toHaveAttribute('data-old-line','2');
 await expect(patch.locator('[data-line-kind="added"]')).toHaveAttribute('data-new-line','2');
 await expect(patch.locator('[data-line-kind="removed"] .patch-old-line')).toHaveText('2');await expect(patch.locator('[data-line-kind="added"] .patch-new-line')).toHaveText('2');
 expect(host.commands.filter(command=>command.type==='action.submit'||command.type==='operation.approve')).toHaveLength(0);
});

test('API examples read as request and response with local response selection and progressive parameters',async({page})=>{
 const host=await open(page,'ApiExplorer');const panel=page.getByRole('tabpanel',{name:'POST /orders',exact:true});
 await expect(panel.getByRole('region',{name:'Request example',exact:true})).toBeVisible();await expect(panel.getByRole('region',{name:'Response example',exact:true})).toBeVisible();
 const parameters=panel.locator('.software-parameter-details');await expect(parameters).not.toHaveAttribute('open');await parameters.locator('summary').click();await expect(parameters.getByText('Idempotency-Key',{exact:true})).toBeVisible();
 await panel.getByRole('tab',{name:'Response 409',exact:true}).click();await expect(panel.getByRole('region',{name:'Response example',exact:true})).toContainText('idempotency_conflict');
 expect(host.commands.filter(command=>command.type==='action.submit')).toHaveLength(0);
});

test('the release view opens at its actual blocker and makes ordered prerequisites inspectable',async({page})=>{
 await open(page,'Pipeline');await expect(page.getByRole('tab',{name:'Typecheck',exact:true})).toHaveAttribute('aria-selected','true');
 const rail=page.getByRole('tablist',{name:'Pipeline stages',exact:true});await expect(rail).toHaveAttribute('aria-orientation','vertical');await expect(rail).toHaveClass(/software-stage-rail/);
 const panel=page.getByRole('tabpanel',{name:'Typecheck',exact:true});await expect(panel).toContainText('Failed');await expect(panel).toContainText('Requires Tests');await expect(panel.getByText('src/orders.ts:42: Type number is not assignable to type string.',{exact:true})).toBeVisible();
});

for(const name of ['Diagnostics','ChangeSet','ApiExplorer','Pipeline'] as const)test(`${name} remains readable within a phone-width artifact`,async({page})=>{
 await page.setViewportSize({width:390,height:900});await open(page,name);expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);await expect(page.locator('.software-detail')).toBeVisible();
});

if(process.env.SOFTWARE_CLARITY_CAPTURE_DIR)for(const name of ['Diagnostics','ChangeSet','ApiExplorer','Pipeline'] as const)for(const mode of ['light','dark','narrow'] as const)test(`capture ${name} ${mode}`,async({page})=>{
 await page.setViewportSize(mode==='narrow'?{width:390,height:1000}:{width:1600,height:1000});await open(page,name,mode==='dark'?'dark':'light');await page.evaluate(()=>document.fonts.ready);await expect(page.locator('.software-detail')).toBeVisible();await expect(page.getByRole('button',{name:'Saved',exact:true})).toBeAttached();await page.locator('.conversation-scroll').evaluate(node=>{node.scrollTop=0;});
 const folder=process.env.SOFTWARE_CLARITY_CAPTURE_DIR!;await mkdir(folder,{recursive:true});await page.screenshot({path:join(folder,`${name.toLowerCase()}-${mode}.png`)});
});
