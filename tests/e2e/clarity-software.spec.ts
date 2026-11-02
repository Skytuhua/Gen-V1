import {test,expect,type Page} from '@playwright/test';
import {serveTaskFixture,taskFixture} from './task-interface-fixture';
import {SOFTWARE_FIXTURE_DATA,softwareDevelopmentSpec,type SoftwareFixtureName} from '../../scripts/software-development-fixtures';

async function open(page:Page,name:SoftwareFixtureName,theme:'light'|'dark'='light',input:unknown=structuredClone(SOFTWARE_FIXTURE_DATA[name])){
 const snapshot=taskFixture(softwareDevelopmentSpec(name),{software:input});snapshot.settings.theme=theme;
 const host=await serveTaskFixture(page,snapshot);await page.goto('/');await expect(page.locator('.software-surface')).toBeVisible();return host;
}

test('diagnostic values only use error color when the supplied result failed',async({page})=>{
 const input={title:'Recorded comparison',items:[{id:'check',title:'includes item quantity',status:'passed',expected:'12',actual:'12'}]};
 const host=await open(page,'Diagnostics','light',input);
 const values=page.getByRole('region',{name:'Assertion comparison',exact:true}).locator('pre');
 const colors=await values.evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).color));
 expect(colors[1]).toBe(colors[0]);
 host.setInput('software',{...input,items:[{...input.items[0],status:'failed',actual:'3'}]});await host.publish();
 await expect.poll(()=>values.nth(1).evaluate(node=>getComputedStyle(node).color)).not.toBe(colors[0]);
 expect(host.commands.filter(command=>command.type==='action.submit')).toHaveLength(0);
});

test('patch review identifies removed and added code before the hunk without relying on color',async({page})=>{
 const host=await open(page,'ChangeSet');
 const legend=page.getByLabel('Patch legend',{exact:true});
 await expect(legend).toBeVisible();await expect(legend).toContainText('Removed');await expect(legend).toContainText('Added');
 await expect(page.locator('.software-patch-heading')).toContainText('Before');await expect(page.locator('.software-patch-heading')).toContainText('After');
 expect(await page.locator('.software-patch-heading').evaluate(node=>parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(11);
 await expect(page.getByLabel('Selected patch',{exact:true}).locator('[data-line-kind=removed] .patch-gutter')).toHaveText('−');
 await expect(page.getByLabel('Selected patch',{exact:true}).locator('[data-line-kind=added] .patch-gutter')).toHaveText('+');
 expect(host.snapshot.data[0].value).toEqual(SOFTWARE_FIXTURE_DATA.ChangeSet);
});

test('API contract labels both examples and explains common response codes without executing them',async({page})=>{
 const requests:string[]=[];page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/orders'))requests.push(request.url());});
 const host=await open(page,'ApiExplorer');
 await expect(page.getByRole('heading',{name:'Request example',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Response example',exact:true})).toBeVisible();
 await expect(page.getByRole('tab',{name:'Response 201',exact:true})).toContainText('Created');await expect(page.getByRole('tab',{name:'Response 409',exact:true})).toContainText('Conflict');
 await page.getByRole('tab',{name:'Response 201',exact:true}).focus();await page.keyboard.press('ArrowRight');
 await expect(page.getByRole('tab',{name:'Response 409',exact:true})).toBeFocused();await expect(page.getByRole('region',{name:'Response example',exact:true})).toContainText('idempotency_conflict');
 expect(requests).toEqual([]);expect(host.commands.filter(command=>command.type==='action.submit')).toHaveLength(0);
});

test('pipeline arrows show dependency direction and blocked output names what it waits for',async({page})=>{
 const host=await open(page,'Pipeline');
 const paths=page.locator('.software-stage-connections path[data-from]');
 expect(await paths.count()).toBeGreaterThan(0);
 for(const path of await paths.all())await expect(path).toHaveAttribute('marker-mid',/^url\(#/);
 await page.getByRole('tab',{name:'Build',exact:true}).click();
 const build=page.getByRole('tabpanel',{name:'Build',exact:true});await expect(build).toContainText('Waiting for Typecheck');
 await build.getByRole('button',{name:'Inspect Typecheck prerequisite',exact:true}).click();
 const types=page.getByRole('tabpanel',{name:'Typecheck',exact:true});await expect(types.locator('.software-command-label')).toHaveText('Command');await expect(types.locator('.software-log summary')).toContainText('Typecheck');
 expect(host.snapshot.data[0].value).toEqual(SOFTWARE_FIXTURE_DATA.Pipeline);
});

test('a blocked stage names unresolved checks without suggesting passed prerequisites are pending',async({page})=>{
 const input=structuredClone(SOFTWARE_FIXTURE_DATA.Pipeline);input.stages[2].dependsOn=['test','types'];
 await open(page,'Pipeline','light',input);await page.getByRole('tab',{name:'Build',exact:true}).click();
 const note=page.getByRole('tabpanel',{name:'Build',exact:true}).locator('.software-empty');
 await expect(note).toHaveText('Waiting for Typecheck.');
});

for(const theme of ['light','dark'] as const)test(`clarity labels remain readable and locally navigable in narrow ${theme} mode`,async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await open(page,'ApiExplorer',theme);
 const response=page.getByRole('tab',{name:'Response 409',exact:true});await response.focus();await page.keyboard.press('ArrowLeft');await expect(page.getByRole('tab',{name:'Response 201',exact:true})).toBeFocused();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 expect(await page.locator('.software-surface').evaluate(node=>[node,...node.querySelectorAll('*')].some(element=>{const css=getComputedStyle(element);return ['auto','scroll'].includes(css.overflowY)&&element.scrollHeight>element.clientHeight+1;}))).toBe(false);
});
