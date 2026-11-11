import {test,expect,type Page} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {EMPTY_USAGE} from '../../packages/contracts';
import {PLANNING_PROVENANCE,planDataId} from '../../packages/contracts/planning';
import {branchGraphData,branchGraphSpec,serveTaskFixture,taskFixture} from './task-interface-fixture';

function fixture(includePlan=true){
  const snapshot=taskFixture({root:'field',elements:{field:{type:'Input',props:{stateKey:'name',label:'Review name'}}}});
  snapshot.threads[0].title='Review the proposed changes';snapshot.threads[0].projectName='Generative Harness';
  snapshot.messages[0].content='The draft is ready to review.';
  snapshot.artifacts[0].title='Review the delivery';
  if(includePlan)snapshot.data.push({id:planDataId('task-thread'),threadId:'task-thread',revision:1,provenance:PLANNING_PROVENANCE,createdAt:'2026-10-31T00:00:00Z',value:{version:1,title:'Review the delivery',steps:[{id:'inspect',title:'Inspect the proposed changes',status:'working',requirements:[{id:'check',label:'Verify the result',completed:false}],agentIds:[]}],agents:[]}});
  return snapshot;
}
async function centered(page:Page){
  await expect.poll(async()=>{
    const main=await page.locator('.workspace').boundingBox(),composer=await page.locator('.composer-dock').boundingBox();
    return main&&composer?Math.abs((main.x+main.width/2)-(composer.x+composer.width/2)):Infinity;
  }).toBeLessThan(1);
}

async function matchesComposer(page:Page){
  await expect.poll(()=>page.evaluate(()=>{
    const composer=document.querySelector('.composer')!.getBoundingClientRect();
    const artifacts=[...document.querySelectorAll('.conversation .artifact:not(.artifact-expanded):not(.artifact-in-workspace)')];
    return Math.max(...artifacts.map(element=>{
      const box=element.getBoundingClientRect();
      return Math.max(Math.abs(box.left-composer.left),Math.abs(box.right-composer.right));
    }));
  })).toBeLessThan(1);
}

for(const chatWidth of ['comfortable','wide','full'] as const)test(`all inline artifact widths match the ${chatWidth} composer`,async({page})=>{
  await page.setViewportSize({width:1920,height:1080});await page.emulateMedia({reducedMotion:'reduce'});
  const snapshot=fixture();snapshot.settings.preferences={chatWidth};
  if(chatWidth==='full')snapshot.messages[0].content=Array(35).fill('Review the proposed changes before continuing.').join('\n\n');
  const original=snapshot.artifacts[0];
  snapshot.artifacts=['compact','standard','wide'].map((width,index)=>({...original,id:`width-${width}`,stateId:`width-state-${index}`,presentation:{width:width as 'compact'|'standard'|'wide',frame:'card' as const}}));
  snapshot.userStates=snapshot.artifacts.map(artifact=>({...snapshot.userStates[0],id:artifact.stateId}));
  await serveTaskFixture(page,snapshot);await page.goto('/');
  await expect(page.locator('.artifact')).toHaveCount(3);await matchesComposer(page);
  await page.getByRole('button',{name:'Open workspace panel',exact:true}).click();await matchesComposer(page);
  await page.getByRole('button',{name:'Close workspace panel',exact:true}).click();
  await page.getByRole('button',{name:'Toggle sidebar',exact:true}).click();await matchesComposer(page);
  await page.setViewportSize({width:900,height:1000});await matchesComposer(page);
  await page.setViewportSize({width:390,height:844});await matchesComposer(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  if(process.env.INLINE_WIDTH_CAPTURE_DIR&&chatWidth==='wide'){
    await mkdir(process.env.INLINE_WIDTH_CAPTURE_DIR,{recursive:true});
    await page.screenshot({path:resolve(process.env.INLINE_WIDTH_CAPTURE_DIR,'narrow.png')});
    await page.setViewportSize({width:1920,height:1080});await matchesComposer(page);
    await page.screenshot({path:resolve(process.env.INLINE_WIDTH_CAPTURE_DIR,'desktop.png')});
  }
});

test('default shell uses all space after navigation and centers artifact and composer without a right rail',async({page})=>{
  await page.setViewportSize({width:1920,height:1080});await serveTaskFixture(page,fixture(false));await page.goto('/');
  await expect(page.getByRole('textbox',{name:'Review name',exact:true})).toBeVisible();
  const main=await page.locator('.workspace').boundingBox();expect(main!.x+main!.width).toBeCloseTo(1920,0);
  await centered(page);
  const artifact=await page.locator('[data-artifact-id="task-surface"]').boundingBox();
  expect(artifact!.x+artifact!.width/2).toBeCloseTo(main!.x+main!.width/2,0);
  await expect(page.getByRole('region',{name:'Live usage',exact:true})).toBeHidden();
  await expect(page.getByRole('button',{name:'Show live usage',exact:true})).toBeVisible();
  expect(await page.locator('.floating-rail').evaluate(node=>getComputedStyle(node).borderLeftWidth)).toBe('0px');
});

test('automatic Plan reserves task space while telemetry preserves the mounted conversation',async({page})=>{
  await page.setViewportSize({width:1600,height:1100});const snapshot=fixture();snapshot.usage['task-thread']={...EMPTY_USAGE,inputTokens:14210,outputTokens:960};await serveTaskFixture(page,snapshot);await page.goto('/');
  const input=page.getByRole('textbox',{name:'Review name',exact:true});await input.fill('Keep the current review');const original=await input.elementHandle();
  await page.getByRole('textbox',{name:'Message',exact:true}).fill('Keep my next message');
  const plan=page.getByRole('region',{name:'Task plan window',exact:true});await expect(plan).toBeVisible();
  const area=await page.locator('.shell-workarea').boundingBox();
  await expect.poll(async()=>(await page.locator('.workspace').boundingBox())!.width).toBeCloseTo(area!.width-400,0);
  const before=await page.locator('.workspace').boundingBox();await centered(page);
  const body=await page.getByRole('region',{name:'Task plan',exact:true}).elementHandle();
  await page.getByRole('button',{name:'Show live usage',exact:true}).click();await expect(page.getByRole('region',{name:'Live usage',exact:true})).toBeVisible();
  await plan.getByRole('button',{name:'Close Task plan',exact:true}).click();await page.getByRole('button',{name:'Thread options',exact:true}).click();await page.getByRole('button',{name:'Show plan',exact:true}).click();
  expect(await page.getByRole('region',{name:'Task plan',exact:true}).evaluate((node,old)=>node===old,body)).toBe(true);
  expect(await input.evaluate((node,old)=>node===old,original)).toBe(true);await expect(input).toHaveValue('Keep the current review');
  await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Keep my next message');
  await expect.poll(async()=>(await page.locator('.workspace').boundingBox())!.width).toBeCloseTo(before!.width,0);
});

test('explicit workspace panels claim only their own width and closing restores the full centered surface',async({page})=>{
  await page.setViewportSize({width:1920,height:1080});await serveTaskFixture(page,fixture(false));await page.goto('/');await expect(page.getByRole('textbox',{name:'Review name',exact:true})).toBeVisible();
  const input=await page.getByRole('textbox',{name:'Review name',exact:true}).elementHandle(),before=await page.locator('.workspace').boundingBox();
  await page.getByRole('button',{name:'Open workspace panel',exact:true}).click();await expect(page.getByRole('complementary',{name:'Workspace panel',exact:true})).toBeVisible();await centered(page);
  await expect.poll(()=>page.getByRole('complementary',{name:'Workspace panel',exact:true}).evaluate(node=>node.getAnimations().filter(animation=>animation.playState==='running').length)).toBe(0);
  const main=await page.locator('.workspace').boundingBox(),panel=await page.getByRole('complementary',{name:'Workspace panel',exact:true}).boundingBox();
  expect(main!.x+main!.width).toBeCloseTo(panel!.x,0);expect(panel!.x+panel!.width).toBeCloseTo(1920,0);
  await page.getByRole('button',{name:'Close workspace panel',exact:true}).click();await expect.poll(async()=>(await page.locator('.workspace').boundingBox())!.width).toBeCloseTo(before!.width,0);await centered(page);
  expect(await page.getByRole('textbox',{name:'Review name',exact:true}).evaluate((node,old)=>node===old,input)).toBe(true);
});

test('narrow default layout has no empty tool strip and sidebar collapse centers the available workspace',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await serveTaskFixture(page,fixture(false));await page.goto('/');
  await expect(page.getByRole('textbox',{name:'Review name',exact:true})).toBeVisible();const main=await page.locator('.workspace').boundingBox();expect(main!.height).toBeCloseTo(844,0);await centered(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Toggle sidebar',exact:true}).click();
  await expect.poll(async()=>(await page.locator('.workspace').boundingBox())!.x).toBe(0);await centered(page);expect((await page.locator('.workspace').boundingBox())!.width).toBeCloseTo(1440,0);
});

test('a usage tool opened from an empty overlay anchors to the bottom and restores its chosen position',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});await serveTaskFixture(page,fixture(false));await page.goto('/');
  await page.getByRole('button',{name:'Show live usage',exact:true}).click();const usage=page.getByRole('region',{name:'Live usage',exact:true});
  await expect.poll(async()=>{const box=await usage.boundingBox();return box?Math.round(box.y+box.height):0;}).toBe(988);
  await usage.getByRole('button',{name:'Move Live usage',exact:true}).press('ArrowUp');
  await expect.poll(async()=>{const box=await usage.boundingBox();return box?Math.round(box.y+box.height):0;}).toBe(976);
  await page.reload();await expect(usage).toBeVisible();await expect.poll(async()=>{const box=await usage.boundingBox();return box?Math.round(box.y+box.height):0;}).toBe(976);
});

const captures=process.env.T3_CENTERED_CAPTURE_DIR;
if(captures)for(const variant of [{name:'dark',width:1920,height:1080,theme:'dark'},{name:'light',width:1920,height:1080,theme:'light'},{name:'narrow',width:390,height:844,theme:'dark'}])test(`capture centered T3 shell ${variant.name}`,async({page})=>{
  await page.setViewportSize(variant);const snapshot=taskFixture(branchGraphSpec('vertical'),{graph:{...branchGraphData,summary:{label:'Review two conflicts',status:'pending'}}});snapshot.settings.theme=variant.theme as 'dark'|'light';snapshot.threads[0].title='Review session refresh';snapshot.threads[0].projectName='Generative Harness';snapshot.artifacts[0].title='Session refresh';snapshot.messages[0].content='Two overlapping changes need review.';await serveTaskFixture(page,snapshot);await page.goto('/');
  await expect(page.getByText('Keep retries ordered',{exact:true})).toBeVisible();await centered(page);await mkdir(captures,{recursive:true});await page.screenshot({path:resolve(captures,`${variant.name}.png`)});
});
