import {test,expect,type Page} from '@playwright/test';
import {serveTaskFixture,taskFixture} from './task-interface-fixture';
import {SOFTWARE_FIXTURE_DATA,softwareDevelopmentSpec,type SoftwareFixtureName} from '../../scripts/software-development-fixtures';

async function open(page:Page,name:SoftwareFixtureName,input:unknown=structuredClone(SOFTWARE_FIXTURE_DATA[name])){
  const snapshot=taskFixture(softwareDevelopmentSpec(name,'inspect'),{software:input});
  snapshot.artifacts[0].actions.inspect={kind:'agent',prompt:'Inspect the supplied evidence'};
  snapshot.settings.theme='dark';
  const host=await serveTaskFixture(page,snapshot);await page.goto('/');
  await expect(page.locator('.software-surface')).toBeVisible();return host;
}

test('the assertion and source lead an investigation, with other checks below the working evidence',async({page})=>{
  const host=await open(page,'Diagnostics');
  const comparison=page.getByRole('region',{name:'Assertion comparison',exact:true});
  const checks=page.getByRole('tablist',{name:'Diagnostics',exact:true});
  const assertionBox=await comparison.boundingBox(),checksBox=await checks.boundingBox();
  expect(assertionBox!.y+assertionBox!.height).toBeLessThan(checksBox!.y);
  await expect(page.locator('.software-investigation')).toContainText('assert.equal');
  await page.getByRole('tab',{name:'rounds the final total',exact:true}).click();
  await expect(page.getByRole('tabpanel',{name:'rounds the final total',exact:true})).toContainText('Not run');
  await expect.poll(()=>host.snapshot.userStates[0].values.selection).toBe('rounding');
  await page.reload();await expect(page.getByRole('tab',{name:'rounds the final total',exact:true})).toHaveAttribute('aria-selected','true');
  expect(host.commands.filter(command=>command.type==='action.submit')).toHaveLength(0);
});

test('file selection is a compact strip above a full-width, source-preserving patch',async({page})=>{
  const host=await open(page,'ChangeSet');
  const files=await page.getByRole('tablist',{name:'Changed files',exact:true}).boundingBox();
  const patch=await page.getByLabel('Selected patch',{exact:true}).boundingBox();
  const surface=await page.locator('.software-changes').boundingBox();
  expect(files!.y+files!.height).toBeLessThan(patch!.y);
  expect(patch!.width).toBeGreaterThan(surface!.width*.9);
  await expect(page.getByLabel('Selected patch',{exact:true}).locator('[data-line-kind="added"]')).toContainText('item.quantity');
  await page.getByRole('tab',{name:'tests/total.test.ts',exact:true}).click();
  await page.getByRole('button',{name:'Review selected file',exact:true}).click();
  await expect.poll(()=>host.commands.filter(command=>command.type==='action.submit').length).toBe(1);
  expect(host.commands.find(command=>command.type==='action.submit')?.payload.payload).toMatchObject({fileId:'test',path:'tests/total.test.ts'});
});

test('the API exchange owns the surface below a route strip without sending any request',async({page})=>{
  const requests:string[]=[];page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/orders'))requests.push(request.url());});
  const host=await open(page,'ApiExplorer');
  const routes=await page.getByRole('tablist',{name:'API endpoints',exact:true}).boundingBox();
  const flow=await page.locator('.software-api-flow').boundingBox();
  const surface=await page.locator('.software-api').boundingBox();
  expect(routes!.y+routes!.height).toBeLessThan(flow!.y);
  expect(flow!.width).toBeGreaterThan(surface!.width*.9);
  await page.getByRole('tab',{name:'Response 409',exact:true}).click();
  await expect(page.getByRole('region',{name:'Response example',exact:true})).toContainText('idempotency_conflict');
  await page.getByRole('tab',{name:'GET /orders/{id}',exact:true}).click();
  await expect.poll(()=>host.snapshot.userStates[0].values.selection).toBe('read');
  expect(requests).toEqual([]);expect(host.commands.filter(command=>command.type==='action.submit')).toHaveLength(0);
});

test('pipeline geometry follows actual dependencies and leaves execution evidence authoritative',async({page})=>{
  const stages={title:'Release gate',stages:[
    {id:'test',name:'Tests',status:'passed'},
    {id:'lint',name:'Lint',status:'failed',log:'Unexpected unused import'},
    {id:'bundle',name:'Bundle',status:'blocked',dependsOn:['test','lint']},
    {id:'publish',name:'Publish',status:'not-run',dependsOn:['bundle']},
  ]};
  const host=await open(page,'Pipeline',stages);
  const graph=page.locator('.software-stage-graph');await expect(graph).toBeVisible();
  await expect(graph.locator('[data-stage-id="test"]')).toHaveAttribute('data-depth','0');
  await expect(graph.locator('[data-stage-id="lint"]')).toHaveAttribute('data-depth','0');
  await expect(graph.locator('[data-stage-id="bundle"]')).toHaveAttribute('data-depth','1');
  await expect(graph.locator('[data-stage-id="publish"]')).toHaveAttribute('data-depth','2');
  await expect(graph.locator('path[data-from="lint"][data-to="bundle"]')).toHaveCount(1);
  await page.getByRole('tab',{name:'Bundle',exact:true}).click();
  const detail=page.getByRole('tabpanel',{name:'Bundle',exact:true});
  await expect(detail).toContainText('Requires Tests, Lint');
  await expect(detail.getByRole('button',{name:'Inspect Lint prerequisite',exact:true})).toBeVisible();
  await detail.getByRole('button',{name:'Inspect Lint prerequisite',exact:true}).click();
  await expect(page.getByRole('tabpanel',{name:'Lint',exact:true})).toContainText('Unexpected unused import');
  expect(host.commands.filter(command=>command.type==='action.submit')).toHaveLength(0);
  expect(host.snapshot.data[0].value).toEqual(stages);
});

for(const name of ['Diagnostics','ChangeSet','ApiExplorer','Pipeline'] as const)test(`${name} keeps neutral selection, keyboard access and chat-only scrolling on narrow screens`,async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});const host=await open(page,name);
  const tabs=page.locator('.software-list [role=tab]');await tabs.first().focus();await page.keyboard.press('ArrowDown');
  await expect(tabs.nth(1)).toBeFocused();await expect(tabs.nth(1)).toHaveAttribute('aria-selected','true');
  const color=await tabs.nth(1).evaluate(node=>getComputedStyle(node).backgroundColor.match(/[\d.]+/g)?.slice(0,3).map(Number)??[]);
  expect(Math.max(...color)-Math.min(...color)).toBeLessThanOrEqual(5);
  const overflow=await page.locator('.software-surface').evaluate(node=>[node,...node.querySelectorAll('*')].filter(element=>{const css=getComputedStyle(element);return ['auto','scroll'].includes(css.overflowY)&&element.scrollHeight>element.clientHeight+1;}).map(element=>element.className));
  expect(overflow).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await expect.poll(()=>page.locator('.software-detail').evaluate(node=>node.getAnimations().length)).toBe(0);
  await host.publish();expect(await page.locator('.software-detail').evaluate(node=>node.getAnimations().length)).toBe(0);
});
