import {test,expect,type Page} from '@playwright/test';
import {serveTaskFixture,taskFixture} from './task-interface-fixture';
import {SOFTWARE_FIXTURE_DATA,softwareDevelopmentSpec,type SoftwareFixtureName} from '../../scripts/software-development-fixtures';
import {SOFTWARE_DATA_SCHEMAS} from '../../packages/ui-catalog/software-development';

async function open(page:Page,name:SoftwareFixtureName,input:unknown=structuredClone(SOFTWARE_FIXTURE_DATA[name])){
  const snapshot=taskFixture(softwareDevelopmentSpec(name,'inspect'),{software:input});
  snapshot.artifacts[0].actions.inspect={kind:'agent',prompt:'Inspect the supplied evidence'};
  snapshot.settings.theme='dark';
  const host=await serveTaskFixture(page,snapshot);await page.goto('/');
  await expect(page.locator('.software-surface')).toBeVisible();return host;
}

test('diagnostic selection stays anchored when passing evidence replaces a failure',async({page})=>{
  const host=await open(page,'Diagnostics');
  const inventory=page.getByRole('tablist',{name:'Diagnostics',exact:true});
  const detail=page.locator('.software-detail');
  for(const width of [700,600]){
    await page.setViewportSize({width,height:1000});
    const surface=await page.locator('.software-surface').evaluate(node=>node.clientWidth);
    const list=await inventory.boundingBox(),panel=await detail.boundingBox();
    if(surface>=640)expect(list!.x+list!.width).toBeLessThanOrEqual(panel!.x+1);
    else expect(list!.y+list!.height).toBeLessThanOrEqual(panel!.y+1);
  }
  await page.setViewportSize({width:1440,height:1000});
  const before=await inventory.getByRole('tab').evaluateAll(nodes=>nodes.map(node=>Math.round(node.getBoundingClientRect().top*10)));
  const data=SOFTWARE_DATA_SCHEMAS.Diagnostics.parse(structuredClone(SOFTWARE_FIXTURE_DATA.Diagnostics));data.items[0]={...data.items[0],status:'passed'};
  host.setInput('software',data);await host.publish();await expect(page.locator('.software-check-state').first()).toHaveText('Passed');
  const after=await inventory.getByRole('tab').evaluateAll(nodes=>nodes.map(node=>Math.round(node.getBoundingClientRect().top*10)));
  expect(after).toEqual(before);
  const target=inventory.getByRole('tab',{name:'rounds the final total',exact:true}),box=await target.boundingBox();
  const hit=await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('[role="tab"]')?.getAttribute('aria-label')??null,{x:box!.x+box!.width/2,y:box!.y+box!.height/2});
  expect(hit).toBe('rounds the final total');
  await target.click();
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

test('same-file patch refresh preserves selection scroll and emits one revision marker',async({page})=>{
  const host=await open(page,'ChangeSet');
  await expect(page.locator('.software-patch-updated')).toHaveCount(0);
  const data=SOFTWARE_DATA_SCHEMAS.ChangeSet.parse(structuredClone(SOFTWARE_FIXTURE_DATA.ChangeSet));
  data.files[0]={...data.files[0],patch:`${data.files[0].patch}\n+// later revision`};
  host.setInput('software',data);await host.publish();
  await expect(page.locator('.software-patch-updated')).toHaveText('Patch updated');
  host.setInput('software',structuredClone(data));await host.publish();
  await expect(page.locator('.software-patch-updated')).toHaveText('Patch updated');
  const patch=page.getByLabel('Selected patch',{exact:true});
  await page.getByRole('tab',{name:'tests/total.test.ts',exact:true}).click();
  const scrolled=await patch.evaluate(node=>{const x=Math.max(0,node.scrollWidth-node.clientWidth),y=Math.max(0,node.scrollHeight-node.clientHeight);node.scrollLeft=Math.min(40,x);node.scrollTop=Math.min(40,y);return {x:node.scrollLeft,y:node.scrollTop};});
  const next=structuredClone(data);next.files.find(file=>file.id==='test')!.patch+='\n+// second revision';
  host.setInput('software',next);await host.publish();
  await expect(page.getByRole('tabpanel',{name:'tests/total.test.ts',exact:true}).locator('.software-patch-updated')).toHaveText('Patch updated');
  expect(await patch.evaluate(node=>({x:node.scrollLeft,y:node.scrollTop}))).toEqual(scrolled);
});

test('a four-stage linear rail responds to its content width',async({page})=>{
  const chain={title:'Linear',stages:[
    {id:'d',name:'Build',status:'not-run' as const,dependsOn:['c']},
    {id:'a',name:'Lint',status:'passed' as const},
    {id:'c',name:'Tests',status:'running' as const,dependsOn:['b']},
    {id:'b',name:'Types',status:'passed' as const,dependsOn:['a']},
  ]};
  const host=await open(page,'Pipeline',chain);
  const rail=page.getByRole('tablist',{name:'Pipeline stages',exact:true});
  expect(await rail.getByRole('tab').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label')))).toEqual(['Lint','Types','Tests','Build']);
  await page.evaluate(()=>{document.querySelector<HTMLElement>('.software-stage-graph')!.style.width='615px';});
  await expect(rail).toHaveAttribute('aria-orientation','vertical');
  expect(new Set(await rail.getByRole('tab').evaluateAll(nodes=>nodes.map(node=>Math.round(node.getBoundingClientRect().top)))).size).toBe(4);
  await page.evaluate(()=>{document.querySelector<HTMLElement>('.software-stage-graph')!.style.width='616px';});
  await expect(rail).toHaveAttribute('aria-orientation','horizontal');
  expect(new Set(await rail.getByRole('tab').evaluateAll(nodes=>nodes.map(node=>Math.round(node.getBoundingClientRect().top)))).size).toBe(1);
  const edge=await page.evaluate(()=>{
    const graph=document.querySelector('.software-stage-graph')!,rect=graph.getBoundingClientRect();
    const button=document.querySelector('[data-stage-id="c"]')!.getBoundingClientRect();
    const path=graph.querySelector<SVGPathElement>('path[data-to="c"]')!;
    const end=path.getPointAtLength(path.getTotalLength());
    return {x:end.x,y:end.y,cx:button.left-rect.left+button.width/2,cy:button.top-rect.top+button.height/2};
  });
  expect(Math.abs(edge.x-edge.cx)).toBeLessThanOrEqual(1);expect(Math.abs(edge.y-edge.cy)).toBeLessThanOrEqual(1);
  host.setInput('software',structuredClone(chain));await host.publish();
  const edgeAfter=await page.evaluate(()=>{const path=document.querySelector<SVGPathElement>('path[data-to="c"]')!;const end=path.getPointAtLength(path.getTotalLength());return {x:end.x,y:end.y};});
  expect(Math.abs(edgeAfter.x-edge.cx)).toBeLessThanOrEqual(1);expect(Math.abs(edgeAfter.y-edge.cy)).toBeLessThanOrEqual(1);
  await open(page,'Pipeline',{title:'Fan',stages:[{id:'a',name:'A',status:'passed' as const},{id:'b',name:'B',status:'passed' as const},{id:'c',name:'C',status:'blocked' as const,dependsOn:['a','b']},{id:'d',name:'D',status:'not-run' as const,dependsOn:['c']}]});
  const dag=page.locator('.software-stage-graph');await dag.getByRole('tab').first().waitFor();
  await expect(dag).not.toHaveAttribute('data-chain');
  // A fan-in DAG keeps per-level rows and depth columns instead of a single line.
  expect(await dag.getByRole('tab').evaluateAll(nodes=>nodes.map(node=>(node as HTMLElement).style.gridColumn+'/'+node.style.gridRow).join(','))).toBe('1/1,1/2,2/1,3/1');
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
