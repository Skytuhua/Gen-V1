import {test,expect,type Page} from '@playwright/test';
import {serveTaskFixture,taskFixture} from './task-interface-fixture';
import {SOFTWARE_FIXTURE_DATA,softwareDevelopmentSpec,type SoftwareFixtureName} from '../../scripts/software-development-fixtures';
import {SOFTWARE_DATA_SCHEMAS} from '../../packages/ui-catalog/software-development';

async function open(page:Page,name:SoftwareFixtureName,actionId?:string){
  const snapshot=taskFixture(softwareDevelopmentSpec(name,actionId),{software:structuredClone(SOFTWARE_FIXTURE_DATA[name])});
  if(actionId)snapshot.artifacts[0].actions[actionId]={kind:'agent',prompt:'Inspect the selected source evidence'};
  const host=await serveTaskFixture(page,snapshot);await page.goto('/');
  await expect(page.locator('.software-surface')).toBeVisible();return host;
}

async function trackSoftwareMotion(page:Page){
  await page.addInitScript(()=>{
    const original=Element.prototype.animate;
    Object.assign(window,{softwareMotion:[] as {target:string;frames:Keyframe[]}[]});
    Element.prototype.animate=function(frames,options){
      const target=this.getAttribute('class')??'';
      if(target.includes('software-'))(window as unknown as {softwareMotion:unknown[]}).softwareMotion.push({target,frames});
      return original.call(this,frames,options);
    };
  });
}

test('accepted check results receive finite feedback without replaying on snapshot or theme updates',async({page})=>{
  await trackSoftwareMotion(page);const host=await open(page,'Diagnostics');
  const state=page.locator('.software-check-state');const identity=await state.elementHandle();
  const calls=()=>page.evaluate(()=>(window as unknown as {softwareMotion:{target:string}[]}).softwareMotion.filter(row=>row.target.includes('software-check-state')).length);
  expect(await calls()).toBe(0);
  const data=SOFTWARE_DATA_SCHEMAS.Diagnostics.parse(structuredClone(SOFTWARE_FIXTURE_DATA.Diagnostics));data.items[0]={...data.items[0],status:'passed',actual:'12'};
  host.setInput('software',data);await host.publish();
  await expect(state).toHaveText('Passed');await expect.poll(calls).toBe(1);
  expect(await state.evaluate((node,previous)=>node===previous,identity)).toBe(true);
  await expect(page.locator('.software-assertion>div:last-child code')).toHaveText('12');
  host.setInput('software',structuredClone(data));host.snapshot.settings.theme='dark';await host.publish();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');expect(await calls()).toBe(1);
  await expect.poll(()=>state.evaluate(node=>node.getAnimations().filter(animation=>animation.playState==='running').length)).toBe(0);
  await page.reload();await expect(state).toHaveText('Passed');expect(await calls()).toBe(0);
});

test('API response transitions retain panel identity and keyboard focus with bounded interruption',async({page})=>{
  await trackSoftwareMotion(page);const host=await open(page,'ApiExplorer');
  const response=page.locator('.software-response [role=tabpanel]'),identity=await response.elementHandle();
  const conflict=page.getByRole('tab',{name:'Response 409',exact:true}),created=page.getByRole('tab',{name:'Response 201',exact:true});
  await conflict.focus();await page.keyboard.press('Enter');
  await expect(conflict).toBeFocused();await expect(response).toContainText('idempotency_conflict');
  const calls=()=>page.evaluate(()=>(window as unknown as {softwareMotion:{target:string}[]}).softwareMotion.filter(row=>row.target.includes('software-response-content')).length);
  await expect.poll(calls).toBe(1);expect(await response.evaluate((node,previous)=>node===previous,identity)).toBe(true);
  await created.click();await conflict.click();await created.click();
  await expect(response).toContainText('ord_123');expect(await response.evaluate(node=>node.getAnimations().filter(animation=>animation.playState==='running').length)).toBeLessThanOrEqual(1);
  await page.getByRole('tab',{name:'GET /orders/{id}',exact:true}).click();
  expect(await response.evaluate(node=>node.getAnimations().filter(animation=>animation.playState==='running').length)).toBe(0);
  await page.getByRole('tab',{name:'POST /orders',exact:true}).click();
  const before=await calls();host.setInput('software',structuredClone(SOFTWARE_FIXTURE_DATA.ApiExplorer));host.snapshot.artifacts[0].title='Reviewed API snapshot';await host.publish();await expect(page.locator('.artifact-title')).toHaveText('Reviewed API snapshot');expect(await calls()).toBe(before);
  await page.emulateMedia({reducedMotion:'reduce'});await conflict.click();
  const frames=await page.evaluate(()=>(window as unknown as {softwareMotion:{target:string;frames:Keyframe[]}[]}).softwareMotion.filter(row=>row.target.includes('software-response-content')).at(-1)?.frames??[]);
  expect(frames.every(frame=>frame.transform===undefined)).toBe(true);
  await expect.poll(()=>response.evaluate(node=>node.getAnimations().filter(animation=>animation.playState==='running').length)).toBe(0);
  expect(host.commands.filter(command=>command.type==='action.submit')).toHaveLength(0);
});
test('diagnostic selection and source-updated results survive reload without remounting the inspector',async({page})=>{
  const host=await open(page,'Diagnostics','inspect');
  await expect(page.getByRole('tabpanel',{name:'includes item quantity',exact:true})).toContainText('Expected 12, received 3');
  const inspector=await page.locator('.software-inspector').elementHandle();
  await page.getByRole('tab',{name:'empty basket returns zero',exact:true}).click();
  await expect.poll(()=>host.snapshot.userStates[0].values.selection).toBe('empty');
  const data=SOFTWARE_DATA_SCHEMAS.Diagnostics.parse(structuredClone(SOFTWARE_FIXTURE_DATA.Diagnostics));data.items[1]={...data.items[1],message:'Verified with the updated source',status:'passed'};
  host.setInput('software',data);await host.publish();
  await expect(page.getByRole('tabpanel',{name:'empty basket returns zero',exact:true})).toContainText('Verified with the updated source');
  expect(await page.locator('.software-inspector').evaluate((node,previous)=>node===previous,inspector)).toBe(true);
  await page.reload();await expect(page.getByRole('tab',{name:'empty basket returns zero',exact:true})).toHaveAttribute('aria-selected','true');
  await page.getByRole('button',{name:'Investigate failure',exact:true}).click();
  await expect.poll(()=>host.commands.filter(command=>command.type==='action.submit').length).toBe(1);
  const action=host.commands.find(command=>command.type==='action.submit')!;
  expect(action.payload.payload).toMatchObject({diagnosticId:'empty',file:'total.test.mjs',status:'passed'});
});
test('change review uses the selected file and opens exact native approval without approving itself',async({page})=>{
  const snapshot=taskFixture(softwareDevelopmentSpec('ChangeSet','review'),{software:structuredClone(SOFTWARE_FIXTURE_DATA.ChangeSet)});
  snapshot.artifacts[0].actions.review={kind:'operation',operationId:'patch-operation'};
  snapshot.operations=[{id:'patch-operation',threadId:'task-thread',revision:2,kind:'file.replace',description:'Replace tests/total.test.ts with the exact reviewed version',resourceIds:[],args:{path:'tests/total.test.ts'},preconditions:{sha256:'a'.repeat(64)},status:'prepared',approved:false,createdAt:'2026-10-30'}];
  const host=await serveTaskFixture(page,snapshot,async()=>({approvalRequired:true,operation:{id:'patch-operation'}}));await page.goto('/');
  await page.getByRole('tab',{name:'tests/total.test.ts',exact:true}).click();
  await expect(page.getByRole('tabpanel',{name:'tests/total.test.ts',exact:true})).toContainText('includes quantity');
  await page.getByRole('button',{name:'Review selected file',exact:true}).click();
  await expect(page.getByRole('button',{name:'Approve operation',exact:true})).toBeFocused();
  expect(host.commands.filter(command=>command.type==='operation.approve')).toHaveLength(0);
  expect(host.commands.find(command=>command.type==='action.submit')?.payload.payload).toMatchObject({fileId:'test',path:'tests/total.test.ts'});
});
test('API contracts expose typed details locally and never send the illustrated request',async({page})=>{
  const requested:string[]=[];page.on('request',request=>{if(request.url().includes('/orders'))requested.push(request.url());});
  const host=await open(page,'ApiExplorer');
  const create=page.getByRole('tabpanel',{name:'POST /orders',exact:true});
  await expect(create).toContainText('Idempotency-Key');await expect(create.getByRole('button',{name:'Review endpoint',exact:true})).toBeDisabled();
  await page.getByRole('tab',{name:'GET /orders/{id}',exact:true}).click();
  await expect(page.getByRole('tabpanel',{name:'GET /orders/{id}',exact:true})).toContainText('Response 404');
  await expect.poll(()=>host.snapshot.userStates[0].values.selection).toBe('read');
  host.snapshot.settings.theme='dark';await host.publish();
  await expect(page.getByRole('tab',{name:'GET /orders/{id}',exact:true})).toHaveAttribute('aria-selected','true');
  expect(requested).toEqual([]);expect(host.commands.filter(command=>command.type==='action.submit')).toHaveLength(0);
});
test('pipeline phase comes only from accepted evidence while output and prerequisites remain inspectable',async({page})=>{
  const host=await open(page,'Pipeline');await page.getByRole('tab',{name:'Build',exact:true}).click();
  const detail=page.getByRole('tabpanel',{name:'Build',exact:true});await expect(detail).toContainText('Blocked');await expect(detail).toContainText('Requires Typecheck');
  await expect(detail.getByRole('button',{name:'Inspect stage',exact:true})).toBeDisabled();
  const data=SOFTWARE_DATA_SCHEMAS.Pipeline.parse(structuredClone(SOFTWARE_FIXTURE_DATA.Pipeline));data.stages[2]={...data.stages[2],status:'running',log:'Building the server bundle'};
  host.setInput('software',data);await host.publish();await expect(detail).toContainText('Running');
  await detail.getByText('Stage output',{exact:true}).click();await expect(detail).toContainText('Building the server bundle');
  expect(host.commands.filter(command=>command.type==='action.submit')).toHaveLength(0);
  await page.reload();await expect(page.getByRole('tab',{name:'Build',exact:true})).toHaveAttribute('aria-selected','true');
});
for(const name of ['Diagnostics','ChangeSet','ApiExplorer','Pipeline'] as const)test(`${name} supports narrow keyboard exploration and reduced motion`,async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await open(page,name);
  const tabs=page.locator('.software-list [role=tab]');await tabs.first().focus();await page.keyboard.press('ArrowDown');
  await expect(tabs.nth(1)).toBeFocused();await expect(tabs.nth(1)).toHaveAttribute('aria-selected','true');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  const moving=await page.locator('.software-detail').evaluate(node=>node.getAnimations().some(animation=>animation.effect instanceof KeyframeEffect&&animation.effect.getKeyframes().some(frame=>frame.transform!==undefined)));
  expect(moving).toBe(false);
});
test('invalid and oversized source records fail closed without executable markup',async({page})=>{
  const host=await open(page,'Diagnostics');
  host.setInput('software',{items:[{id:'x',title:'<img src=x onerror=alert(1)>',status:'failed'},{id:'x',title:'duplicate',status:'passed'}]});await host.publish();
  await expect(page.getByText('Diagnostic data is unavailable.',{exact:false})).toBeVisible();
  expect(await page.locator('.artifact img').count()).toBe(0);
  host.setInput('software',{items:new Array(101)});await host.publish();
  await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();
});
