import {test,expect,type Page} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {EMPTY_USAGE} from '../../packages/contracts';
import {PLANNING_PROVENANCE,planDataId} from '../../packages/contracts/planning';
import {serveTaskFixture,taskFixture} from './task-interface-fixture';

const snapshot=()=>{
 const value=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Inspect the checkout calculation.'}}}});
 value.data.push({id:planDataId('task-thread'),threadId:'task-thread',revision:1,provenance:PLANNING_PROVENANCE,createdAt:'2026-10-30T00:00:00Z',value:{version:1,title:'Repair checkout failures',steps:[{id:'inspect',title:'Find the failing boundary',status:'working',requirements:[{id:'first',label:'Reproduce the exact quantity assertion',completed:true},{id:'second',label:'Compare the existing implementation',completed:false}],agentIds:['reader']}],agents:[{id:'reader',commandId:'batch',taskId:'inspect',reportedPercent:null,createdAt:'2026-10-30T00:00:00Z',updatedAt:'2026-10-30T00:00:00Z',name:'Test investigator',task:'Trace the quantity assertion and compare both affected caller paths.',status:'working',completedRequirementIds:['one'],requirements:[{id:'one',label:'Locate the quantity assertion'},{id:'two',label:'Compare the empty-basket boundary'}]}]}});
 value.usage['task-thread']={...EMPTY_USAGE,inputTokens:12640,outputTokens:820,contextTokens:35000,contextWindow:200000};return value;
};
const captureDirectory=process.env.RESERVED_RAIL_CAPTURE_DIR;
async function showPlan(page:Page){const panel=page.getByRole('region',{name:'Project context window',exact:true});await expect(panel).toBeVisible();return panel;}
async function showUsage(page:Page){const usage=page.getByRole('region',{name:'Live usage',exact:true});await expect(usage).toBeVisible();return usage;}
async function open(page:Page,value=snapshot()){
 await serveTaskFixture(page,value);await page.goto('/');await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();await showPlan(page);await showUsage(page);
 const plan=page.getByRole('region',{name:'Project context window',exact:true});await expect(plan).toBeVisible();await expect.poll(()=>plan.evaluate(el=>el.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);return plan;
}

test('workspace artifact stays inside its panel beside expanded Plan and keeps the same renderer',async({page})=>{
 await page.setViewportSize({width:1920,height:1080});await serveTaskFixture(page,snapshot());await page.goto('/');
 const text=await page.getByText('Inspect the checkout calculation.',{exact:true}).elementHandle();await page.getByRole('button',{name:'Open artifact in workspace',exact:true}).click();
 const panel=page.getByRole('complementary',{name:'Workspace panel',exact:true}),artifact=page.locator('.artifact-in-workspace');await expect(panel).toBeVisible();await expect(artifact).toBeVisible();
 await showPlan(page);await showUsage(page);
 await expect.poll(async()=>{const w=await panel.boundingBox(),a=await artifact.boundingBox();return Boolean(w&&a&&Math.abs(w.x+w.width-1920)<1&&a.x>=w.x&&a.x+a.width<=w.x+w.width+1);}).toBe(true);
 expect(await page.getByText('Inspect the checkout calculation.',{exact:true}).evaluate((node,old)=>node===old,text)).toBe(true);
});
test('expanded usage stays compact and readable instead of reserving an oversized tool',async({page})=>{
 await page.setViewportSize({width:1600,height:1080});await open(page);const usage=page.getByRole('region',{name:'Live usage',exact:true});await usage.getByRole('button',{name:'Inspect live usage',exact:true}).click();await expect(usage).toHaveAttribute('data-collapsed','false');await expect(usage.getByText('Conversation space',{exact:true})).toBeVisible();await expect.poll(async()=>Math.round((await usage.boundingBox())!.height)).toBeLessThanOrEqual(280);
});
test('both protected tools minimize to a compact flow region on narrow screens',async({page})=>{
 await page.setViewportSize({width:390,height:844});const value=snapshot();value.data=[];await serveTaskFixture(page,value);await page.goto('/');await showUsage(page);
 await expect(page.getByRole('region',{name:'Project context window',exact:true})).toHaveAttribute('data-collapsed','true');
 await expect.poll(async()=>Math.round((await page.getByRole('complementary',{name:'Task tools',exact:true}).boundingBox())!.height)).toBeLessThanOrEqual(110);
 await expect.poll(async()=>Math.round((await page.getByRole('region',{name:'Live usage',exact:true}).boundingBox())!.height)).toBe(36);
});
test('minimized tools leave the full chat width beside an explicitly opened artifact panel',async({page})=>{
 await page.setViewportSize({width:1600,height:1000});const plan=await open(page);await plan.getByRole('button',{name:'Minimize Project context',exact:true}).click();await expect(plan).toBeVisible();expect((await page.locator('.workspace').boundingBox())!.x+(await page.locator('.workspace').boundingBox())!.width).toBeCloseTo(1600,0);
 await page.getByRole('button',{name:'Open artifact in workspace',exact:true}).click();await expect.poll(async()=>{const main=await page.locator('.workspace').boundingBox(),panel=await page.locator('.workspace-right').boundingBox();return Math.abs(main!.x+main!.width-panel!.x)<1&&Math.abs(panel!.x+panel!.width-1600)<1;}).toBe(true);
});
test('expanded context keeps the header and composer across the full available chat frame',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});const plan=await open(page);
 const main=(await page.locator('.workspace').boundingBox())!,header=(await page.locator('.workspace-header').boundingBox())!,composer=(await page.locator('.composer-dock').boundingBox())!;
 expect(main.x+main.width).toBeCloseTo(1440,0);expect(header.x+header.width).toBeCloseTo(main.x+main.width,0);expect(composer.x+composer.width/2).toBeCloseTo(main.x+main.width/2,0);
 expect((await plan.boundingBox())!.x).toBeGreaterThan(main.x);
});

test('protected context has only minimize controls while keeping the composer draft',async({page})=>{
 await page.setViewportSize({width:1600,height:1100});const plan=await open(page);
 await page.getByRole('textbox',{name:'Message',exact:true}).fill('Keep composing');
 await expect(plan.getByRole('button',{name:/^Move |^Resize |^Detach |^Close |^Reset /})).toHaveCount(0);await plan.getByRole('button',{name:'Minimize Project context',exact:true}).click();await expect(plan).toBeVisible();await plan.getByRole('button',{name:'Expand Project context',exact:true}).click();await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Keep composing');
});

test('minimizing context leaves no blank lane and preserves the artifact renderer',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});const plan=await open(page),body=await page.getByText('Inspect the checkout calculation.',{exact:true}).elementHandle(),before=(await page.locator('.workspace').boundingBox())!;
 await plan.getByRole('button',{name:'Minimize Project context',exact:true}).click();await expect.poll(async()=>(await page.locator('.workspace').boundingBox())!.width).toBeCloseTo(before.width,0);
 await plan.getByRole('button',{name:'Expand Project context',exact:true}).click();expect(await page.getByText('Inspect the checkout calculation.',{exact:true}).evaluate((node,old)=>node===old,body)).toBe(true);
});

test('narrow explicit tools occupy a bounded flow region without covering composer or Stop',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});const value=snapshot();value.threads[0].status='working';value.threads[0].runId='fixture-run';await serveTaskFixture(page,value);await page.goto('/');await showPlan(page);const usage=await showUsage(page);await usage.getByRole('button',{name:'Inspect live usage',exact:true}).click();
 const rail=page.getByRole('complementary',{name:'Task tools',exact:true});await expect(rail).toBeVisible();const main=await page.locator('.workspace').boundingBox(),region=await rail.boundingBox();expect(main!.y+main!.height).toBeLessThanOrEqual(region!.y+1);
 for(const name of ['Message','Stop agent']){const el=name==='Message'?page.getByRole('textbox',{name,exact:true}):page.getByRole('button',{name,exact:true});expect(await el.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);}expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});
if(captureDirectory)for(const mode of ['light','dark','narrow','narrow-compact']as const)test(`capture floating tools ${mode}`,async({page})=>{
 const narrow=mode.startsWith('narrow');await page.setViewportSize(narrow?{width:390,height:844}:{width:1920,height:1080});const value=snapshot();value.settings.theme=mode==='dark'?'dark':'light';
 if(mode==='narrow-compact'){await serveTaskFixture(page,value);await page.goto('/');await showUsage(page);}
 else{const panel=await open(page,value);await expect(panel.getByText('Repair checkout failures',{exact:true})).toBeVisible();await panel.getByRole('button',{name:'Inspect Test investigator',exact:true}).click();await expect(panel.getByText('Compare the empty-basket boundary',{exact:true})).toBeVisible();await panel.locator('.floating-window-body').evaluate(node=>node.scrollTop=0);await page.getByRole('button',{name:'Inspect live usage',exact:true}).click();await expect(page.getByRole('progressbar',{name:'Test investigator progress',exact:true})).toHaveAttribute('aria-valuenow','50');}
 await page.waitForTimeout(750);await mkdir(captureDirectory,{recursive:true});await page.screenshot({path:resolve(captureDirectory,`floating-tools-${mode}.png`)});
});
