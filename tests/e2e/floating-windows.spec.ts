import {test,expect,type Page} from '@playwright/test';
import {EMPTY_USAGE} from '../../packages/contracts';
import {PLANNING_PROVENANCE,planDataId} from '../../packages/contracts/planning';
import {clampFloatingLayout} from '../../apps/web/src/floating-layout';
import {serveTaskFixture,taskFixture} from './task-interface-fixture';
const now='2026-10-30T05:00:00.000Z';
function fixture(){const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Investigating the checkout boundary.'}}}});snapshot.data.push({id:planDataId('task-thread'),threadId:'task-thread',revision:1,provenance:PLANNING_PROVENANCE,createdAt:now,value:{version:1,title:'Repair checkout failures',steps:[{id:'investigate',title:'Find the failing boundary',status:'working',requirements:[{id:'reproduce',label:'Reproduce the failure',completed:true},{id:'locate',label:'Locate the assertion',completed:false}],agentIds:[]}],agents:[]}});snapshot.usage['task-thread']={...EMPTY_USAGE,inputTokens:12640,outputTokens:820,contextTokens:35000,contextWindow:200000};return snapshot;}
async function settledWindow(panel:ReturnType<Page['getByRole']>){await expect.poll(()=>panel.evaluate(node=>node.getAnimations().filter(animation=>animation.playState==='running').length)).toBe(0);}
async function openPlan(page:Page){await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();const panel=page.getByRole('region',{name:'Task plan window',exact:true});if(!await panel.isVisible()){await page.getByRole('button',{name:'Thread options',exact:true}).click();await page.getByRole('button',{name:'Show plan',exact:true}).click();}await expect(panel).toBeVisible();await settledWindow(panel);return panel;}

test('floating geometry rejects nonfinite storage and confines windows to a narrow viewport',()=>{
 const result=clampFloatingLayout({x:9000,y:-400,width:4000,height:5000,collapsed:false},{width:390,height:844,top:60,bottom:620},{width:280,height:180});
 expect(result.x).toBeGreaterThanOrEqual(8);expect(result.y).toBeGreaterThanOrEqual(60);expect(result.x+result.width).toBeLessThanOrEqual(382);expect(result.y+result.height).toBeLessThanOrEqual(620);
 const invalid=clampFloatingLayout({x:NaN,y:Infinity,width:-400,height:NaN,collapsed:false},{width:1000,height:800},{width:280,height:180});expect(Object.values(invalid).filter(value=>typeof value==='number').every(Number.isFinite)).toBe(true);
});

test('viewport clamping preserves the original window size and right-edge placement when space returns',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await serveTaskFixture(page,fixture());await page.goto('/');const panel=await openPlan(page),before=await panel.boundingBox();await page.setViewportSize({width:390,height:844});await settledWindow(panel);expect((await panel.boundingBox())!.width).toBeLessThanOrEqual(374);await page.setViewportSize({width:1440,height:1000});await settledWindow(panel);await expect.poll(async()=>Math.round((await panel.boundingBox())!.x)).toBe(Math.round(before!.x));expect((await panel.boundingBox())!.width).toBeCloseTo(before!.width,0);
});

test('the content-fit plan moves by keyboard, ignores height sizing, and preserves bounds on reload',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await serveTaskFixture(page,fixture());await page.goto('/');const panel=await openPlan(page);
 await expect(page.getByRole('tab',{name:'Plan',exact:true})).toHaveCount(0);await page.getByRole('textbox',{name:'Message',exact:true}).fill('Keep this composer draft.');
 const handle=panel.getByRole('button',{name:'Move Task plan',exact:true}),before=await panel.boundingBox();await handle.focus();await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowDown');await page.keyboard.press('Shift+ArrowDown');
 await expect.poll(async()=>{const next=await panel.boundingBox();return next&&before?Math.round(next.x-before.x):0;}).toBe(0);
 await settledWindow(panel);const after=await panel.boundingBox();expect(after!.y).toBeCloseTo(before!.y+12,0);expect(after!.width).toBeCloseTo(before!.width,0);expect(after!.height).toBeCloseTo(before!.height,0);
 await page.reload();const restored=await openPlan(page);const bounds=await restored.boundingBox();expect(bounds!.x).toBeCloseTo(after!.x,0);expect(bounds!.width).toBeCloseTo(after!.width,0);await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Keep this composer draft.');
});

test('pointer drag retains the same task content through minimize and close without resize chrome',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await serveTaskFixture(page,fixture());await page.goto('/');const panel=await openPlan(page),body=page.getByRole('region',{name:'Task plan',exact:true});const original=await body.elementHandle();
 const move=panel.getByRole('button',{name:'Move Task plan',exact:true}),start=await move.boundingBox(),before=await panel.boundingBox();
 await page.mouse.move(start!.x+10,start!.y+10);await page.mouse.down();await page.mouse.move(start!.x-130,start!.y+50,{steps:8});await page.mouse.up();await expect.poll(async()=>Math.round((await panel.boundingBox())!.x-before!.x)).toBe(0);await expect.poll(async()=>Math.round((await panel.boundingBox())!.y-before!.y)).toBe(40);
 await expect(panel.getByRole('separator')).toHaveCount(0);
 await panel.getByRole('button',{name:'Minimize Task plan',exact:true}).click();await expect(body).toBeHidden();await expect(panel.locator('.floating-window-body')).toHaveAttribute('inert','');
 await panel.getByRole('button',{name:'Expand Task plan',exact:true}).click();await expect(body).toBeVisible();expect(await body.evaluate((node,old)=>node===old,original)).toBe(true);
 await panel.getByRole('button',{name:'Close Task plan',exact:true}).click();await expect(panel).toBeHidden();await openPlan(page);expect(await body.evaluate((node,old)=>node===old,original)).toBe(true);
});

test('live usage is a movable floating window with remembered bounds and a recoverable close control',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await serveTaskFixture(page,fixture());await page.goto('/');await page.getByRole('button',{name:'Show live usage',exact:true}).click();let usage=page.getByRole('region',{name:'Live usage',exact:true});await expect(usage).toHaveAttribute('data-collapsed','true');
 const move=usage.getByRole('button',{name:'Move Live usage',exact:true});await move.focus();await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowUp');await settledWindow(usage);const compact=await usage.boundingBox();
 await usage.getByRole('button',{name:'Inspect live usage',exact:true}).click();await expect(usage).toHaveAttribute('data-collapsed','false');await expect(usage.getByText('Reported cost',{exact:true})).toBeVisible();
 await page.keyboard.press('Escape');await expect(usage).toHaveAttribute('data-collapsed','true');await expect(usage.getByRole('button',{name:'Inspect live usage',exact:true})).toBeFocused();
 await page.reload();usage=page.getByRole('region',{name:'Live usage',exact:true});await expect(usage).toBeVisible();await expect.poll(async()=>(await usage.boundingBox())!.x).toBeCloseTo(compact!.x,0);await expect.poll(async()=>(await usage.boundingBox())!.y).toBeCloseTo(compact!.y,0);
 await usage.getByRole('button',{name:'Close Live usage',exact:true}).click();await expect(usage).toBeHidden();await page.getByRole('button',{name:'Show live usage',exact:true}).click();await expect(usage).toBeVisible();
});

test('both windows fit a narrow viewport, retain keyboard access and leave Stop available',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});const snapshot=fixture();snapshot.threads[0].status='working';snapshot.threads[0].runId='fixture-run';await serveTaskFixture(page,snapshot);await page.goto('/');await openPlan(page);
 await page.getByRole('button',{name:'Show live usage',exact:true}).click();const usage=page.getByRole('region',{name:'Live usage',exact:true});await usage.getByRole('button',{name:'Inspect live usage',exact:true}).click();
 for(const name of ['Task plan window','Live usage']){const bounds=await page.getByRole('region',{name,exact:true}).boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(390);expect(bounds!.y).toBeGreaterThanOrEqual(0);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(844);}
 const stop=page.getByRole('button',{name:'Stop agent',exact:true});expect(await stop.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));})).toBe(true);await expect(stop).toBeEnabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});
