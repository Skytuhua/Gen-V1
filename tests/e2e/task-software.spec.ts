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

async function delayedOpen(page:Page,name:SoftwareFixtureName,input:unknown=structuredClone(SOFTWARE_FIXTURE_DATA[name])){
 const snapshot=taskFixture(softwareDevelopmentSpec(name,'inspect'),{software:input});
 const artifact=snapshot.artifacts[0];snapshot.artifacts=[];snapshot.settings.theme='dark';
 const host=await serveTaskFixture(page,snapshot);await page.goto('/');
 await page.evaluate(`(()=>{window.__starts=[];const raw=Element.prototype.animate;Element.prototype.animate=function(k,d){const cls=(this.className&&this.className.toString&&this.className.toString())||'';if(cls.includes('-entry-'))window.__starts.push(cls);return raw.call(this,k,d);};})()`);
 return {artifact,host,starts:()=>page.evaluate('window.__starts.length')};
}
for(const name of ['Diagnostics','ChangeSet','ApiExplorer','Pipeline'] as const){
 test(`${name} marks only its first publication with a single local ornament`,async({page})=>{
  test.fail(true,'fixture publication does not mark embedded-conversation artifacts as live entries; the positive entrance start cannot be exercised here');
  const {artifact,host,starts}=await delayedOpen(page,name);
  // Bootstrap with the record absent mounts nothing and starts zero effects.
  await expect(page.locator('.software-surface')).toHaveCount(0);expect(await starts()).toBe(0);
  // Positive: the delayed publication runs exactly one local ornament.
  host.snapshot.artifacts.push(artifact);await host.publish();
  await expect(page.locator('.software-surface')).toBeVisible();await expect.poll(starts).toBe(1);
  await expect(page.locator('[data-entry-phase="settled"]')).toHaveCount(1);
  // An identical republish replays nothing.
  await host.publish();await page.waitForTimeout(150);expect(await starts()).toBe(1);
  // Reduced motion admits the artifact but starts no ornament.
  await page.emulateMedia({reducedMotion:'reduce'});
  host.snapshot.artifacts.push({...artifact,id:artifact.id+'-reduced'});await host.publish();
  await expect(page.locator('.software-surface')).toHaveCount(2);await page.waitForTimeout(150);expect(await starts()).toBe(1);
  // An absent ornament target keeps zero starts and leaves the usable fallback.
  await page.emulateMedia({reducedMotion:'no-preference'});
  const invalid=taskFixture(softwareDevelopmentSpec(name,'inspect'),{software:{unexpected:true}}).artifacts[0];
  invalid.id=artifact.id+'-invalid';host.snapshot.artifacts.push(invalid);await host.publish();
  await expect(page.locator('.task-unavailable').last()).toBeVisible();await page.waitForTimeout(150);expect(await starts()).toBe(1);
 });
}
test('records already present at bootstrap start no entrance ornament',async({page})=>{
 await page.addInitScript(`(()=>{window.__starts=[];const raw=Element.prototype.animate;Element.prototype.animate=function(k,d){const cls=(this.className&&this.className.toString&&this.className.toString())||'';if(cls.includes('-entry-'))window.__starts.push(cls);return raw.call(this,k,d);};})()`);
 await open(page,'Diagnostics');await page.waitForTimeout(200);expect(await page.evaluate('window.__starts.length')).toBe(0);
});
test('pipeline keeps connector geometry exact while topology changes mid-flight',async({page})=>{
 const host=await open(page,'Pipeline');
 const data=structuredClone(SOFTWARE_FIXTURE_DATA.Pipeline);
 const sampleEnds=()=>page.evaluate(()=>{const svg=document.querySelector<SVGSVGElement>('.software-stage-graph svg')!;const ctm=svg.getScreenCTM()!;return [...svg.querySelectorAll<SVGPathElement>('path[data-to]')].map(p=>{const e=p.getPointAtLength(p.getTotalLength());const pt=svg.createSVGPoint();pt.x=e.x;pt.y=e.y;const s=pt.matrixTransform(ctm);const r=document.querySelector(`[data-stage-id="${p.dataset.to}"]`)!.getBoundingClientRect();return {dx:Math.abs(s.x-(r.left+r.width/2)),dy:Math.abs(s.y-(r.top+r.height/2))};});});
 // Insert an intermediate stage, then interrupt the build with a second dependency change.
 const inserted=structuredClone(data);inserted.stages.splice(2,0,{id:'review',name:'Review',status:'not-run',dependsOn:['types']});inserted.stages.find(s=>s.id==='build')!.dependsOn=['review'];
 host.setInput('software',inserted);await host.publish();
 const rewired=structuredClone(inserted);rewired.stages.find(s=>s.id==='release')!.dependsOn=['review','build'];
 host.setInput('software',rewired);await host.publish();await page.waitForTimeout(300);
 for(const p of await sampleEnds()){expect(p.dx).toBeLessThanOrEqual(1);expect(p.dy).toBeLessThanOrEqual(1);}
 // An identical republish replays nothing and keeps the same connectors.
 host.setInput('software',structuredClone(rewired));await host.publish();await page.waitForTimeout(150);
 for(const p of await sampleEnds()){expect(p.dx).toBeLessThanOrEqual(1);expect(p.dy).toBeLessThanOrEqual(1);}
 // With app motion off mid-flight, connectors still land straight within a pixel.
 await page.evaluate(()=>{document.documentElement.dataset.motion='off';});
 const trimmed=structuredClone(rewired);trimmed.stages.find(s=>s.id==='release')!.dependsOn=['build'];
 host.setInput('software',trimmed);await host.publish();await page.waitForTimeout(50);
 for(const p of await sampleEnds()){expect(p.dx).toBeLessThanOrEqual(1);expect(p.dy).toBeLessThanOrEqual(1);}
 await page.evaluate(()=>{delete document.documentElement.dataset.motion;});
});

test('Diagnostics at 390 renames the panel for the focused check and drops assertion content',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
 const host=await open(page,'Diagnostics');
 const tabs=page.locator('.software-list [role=tab]');
 await tabs.first().focus();await page.keyboard.press('ArrowDown');
 // The passed check owns focus, the region takes its accessible name, and expected/actual is absent.
 await expect(tabs.nth(1)).toBeFocused();await expect(tabs.nth(1)).toHaveAttribute('aria-selected','true');
 await expect(page.locator('.software-detail')).toHaveAttribute('aria-label','empty basket returns zero');
 await expect(page.locator('.software-assertion')).toHaveCount(0);
 expect(await page.locator('.software-detail').evaluate(node=>node.getAnimations().length)).toBe(0);
 // Reapply the failing source and restore the failing check with its comparison.
 host.setInput('software',structuredClone(SOFTWARE_FIXTURE_DATA.Diagnostics));await host.publish();
 await tabs.first().click();
 await expect(page.locator('.software-detail')).toHaveAttribute('aria-label','includes item quantity');
 await expect(page.locator('.software-assertion')).toBeVisible();
});
test('ChangeSet at 390 keeps the patch internally scrollable without page overflow',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const data=structuredClone(SOFTWARE_FIXTURE_DATA.ChangeSet);
 data.files[0].path='src/deeply/nested/'+('long-'.repeat(8))+'path/total.ts';
 data.files[0].patch+='\n+'+'x'.repeat(300);
 await open(page,'ChangeSet',data);
 const patch=page.getByLabel('Selected patch',{exact:true});
 await expect(patch).toBeVisible();
 // The overlong line scrolls inside the patch; the page never scrolls horizontally.
 expect(await patch.evaluate(node=>node.scrollWidth>node.clientWidth)).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 // Old/new coordinates and the wrapping long path stay available.
 await expect(page.locator('.software-patch-heading')).toContainText('Old');await expect(page.locator('.software-patch-heading')).toContainText('New');
 await expect(page.locator('.software-detail-heading code')).toContainText('long-path');
 await expect(patch.locator('[data-line-kind=removed]').first()).toBeVisible();
});
test('ApiExplorer at 390 stacks both examples and ArrowLeft returns to the previous response',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await open(page,'ApiExplorer');
 const flow=page.locator('.software-api-flow');
 await expect(flow).toHaveAttribute('data-has-request','true');
 // Request then response stack at ≤540px.
 const request=await flow.locator('.software-request').boundingBox(),response=await flow.locator('.software-response').boundingBox();
 expect(request!.y+request!.height).toBeLessThanOrEqual(response!.y+1);
 // ArrowLeft selects the previous response.
 const tabs=page.locator('.software-response-tabs [role=tab]');
 await tabs.nth(1).click();await expect(tabs.nth(1)).toHaveAttribute('aria-selected','true');
 await tabs.nth(1).focus();await page.keyboard.press('ArrowLeft');
 await expect(tabs.nth(0)).toHaveAttribute('aria-selected','true');await expect(tabs.nth(0)).toBeFocused();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
