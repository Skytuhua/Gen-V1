import {test,expect,type Page} from '@playwright/test';
import {EMPTY_USAGE} from '../../packages/contracts';
import {PLANNING_PROVENANCE,planDataId} from '../../packages/contracts/planning';
import {clampFloatingLayout} from '../../apps/web/src/floating-layout';
import {serveTaskFixture,taskFixture} from './task-interface-fixture';
const now='2026-10-30T05:00:00.000Z';
function fixture(){const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Investigating the checkout boundary.'}}}});snapshot.data.push({id:planDataId('task-thread'),threadId:'task-thread',revision:1,provenance:PLANNING_PROVENANCE,createdAt:now,value:{version:1,title:'Repair checkout failures',steps:[{id:'investigate',title:'Find the failing boundary',status:'working',requirements:[{id:'reproduce',label:'Reproduce the failure',completed:true},{id:'locate',label:'Locate the assertion',completed:false}],agentIds:[]}],agents:[]}});snapshot.usage['task-thread']={...EMPTY_USAGE,inputTokens:12640,outputTokens:820,contextTokens:35000,contextWindow:200000};return snapshot;}
async function settledWindow(panel:ReturnType<Page['getByRole']>){await expect.poll(()=>panel.evaluate(node=>node.getAnimations().filter(animation=>animation.playState==='running').length)).toBe(0);}
async function showUsage(page:Page){const usage=page.getByRole('region',{name:'Live usage',exact:true});if(!await usage.isVisible())await page.getByRole('button',{name:'Show live usage',exact:true}).click();await expect(usage).toBeVisible();return usage;}
async function openPlan(page:Page){await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();const panel=page.getByRole('region',{name:'Project context window',exact:true});await expect(panel).toBeVisible();await settledWindow(panel);await showUsage(page);return panel;}

test('floating geometry rejects nonfinite storage and confines windows to a narrow viewport',()=>{
 const result=clampFloatingLayout({x:9000,y:-400,width:4000,height:5000,collapsed:false},{width:390,height:844,top:60,bottom:620},{width:280,height:180});
 expect(result.x).toBeGreaterThanOrEqual(8);expect(result.y).toBeGreaterThanOrEqual(60);expect(result.x+result.width).toBeLessThanOrEqual(382);expect(result.y+result.height).toBeLessThanOrEqual(620);
 const invalid=clampFloatingLayout({x:NaN,y:Infinity,width:-400,height:NaN,collapsed:false},{width:1000,height:800},{width:280,height:180});expect(Object.values(invalid).filter(value=>typeof value==='number').every(Number.isFinite)).toBe(true);
});

test('viewport clamping preserves the original window size and right-edge placement when space returns',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await serveTaskFixture(page,fixture());await page.goto('/');const panel=await openPlan(page),before=await panel.boundingBox();await page.setViewportSize({width:390,height:844});await settledWindow(panel);expect((await panel.boundingBox())!.width).toBeLessThanOrEqual(374);await page.setViewportSize({width:1440,height:1000});await settledWindow(panel);await expect.poll(async()=>Math.round((await panel.boundingBox())!.x)).toBe(Math.round(before!.x));expect((await panel.boundingBox())!.width).toBeCloseTo(before!.width,0);
});

test('the protected context only minimizes and preserves its draft on reload',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await serveTaskFixture(page,fixture());await page.goto('/');const panel=await openPlan(page);
 await expect(page.getByRole('tab',{name:'Plan',exact:true})).toHaveCount(0);await page.getByRole('textbox',{name:'Message',exact:true}).fill('Keep this composer draft.');
 await expect(panel.getByRole('button',{name:/^Move |^Resize |^Close |^Detach |^Reset /})).toHaveCount(0);
 await panel.getByRole('button',{name:'Minimize Project context',exact:true}).click();await expect(panel).toHaveAttribute('data-collapsed','true');await expect(panel).toBeVisible();
 await page.reload();const restored=await openPlan(page);await expect(restored).toBeVisible();await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Keep this composer draft.');
});

test('minimizing and Escape retain the same task content without a delete control',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await serveTaskFixture(page,fixture());await page.goto('/');const panel=await openPlan(page),body=page.getByRole('region',{name:'Task plan',exact:true});const original=await body.elementHandle();
 await expect(panel.getByRole('separator')).toHaveCount(0);
 await panel.getByRole('button',{name:'Minimize Project context',exact:true}).click();await expect(body).toBeHidden();await expect(panel.locator('.floating-window-body')).toHaveAttribute('inert','');
 await panel.getByRole('button',{name:'Expand Project context',exact:true}).click();await expect(body).toBeVisible();expect(await body.evaluate((node,old)=>node===old,original)).toBe(true);
 await panel.getByRole('button',{name:'Minimize Project context',exact:true}).focus();await page.keyboard.press('Escape');await expect(panel).toBeVisible();await expect(panel).toHaveAttribute('data-collapsed','true');await panel.getByRole('button',{name:'Expand Project context',exact:true}).click();expect(await body.evaluate((node,old)=>node===old,original)).toBe(true);
});

test('live usage stays available and remembers its minimized state without close or resize controls',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await serveTaskFixture(page,fixture());await page.goto('/');let usage=page.getByRole('region',{name:'Live usage',exact:true});await expect(usage).toBeHidden();await page.getByRole('button',{name:'Show live usage',exact:true}).click();await expect(usage).toHaveAttribute('data-collapsed','true');
 await expect(usage.getByRole('button',{name:/^Move |^Resize |^Close Live usage$|^Detach |^Reset /})).toHaveCount(0);
 await usage.getByRole('button',{name:'Inspect live usage',exact:true}).click();await expect(usage).toHaveAttribute('data-collapsed','false');
 await page.keyboard.press('Escape');await expect(usage).toHaveAttribute('data-collapsed','true');await expect(usage.getByRole('button',{name:'Inspect live usage',exact:true})).toBeFocused();
 await page.reload();await expect(usage).toBeHidden();await page.getByRole('button',{name:'Show live usage',exact:true}).click();usage=page.getByRole('region',{name:'Live usage',exact:true});await expect(usage).toBeVisible();await expect(usage).toHaveAttribute('data-collapsed','true');
});

test('both windows fit a narrow viewport, retain keyboard access and leave Stop available',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});const snapshot=fixture();snapshot.threads[0].status='working';snapshot.threads[0].runId='fixture-run';await serveTaskFixture(page,snapshot);await page.goto('/');await openPlan(page);
 const usage=page.getByRole('region',{name:'Live usage',exact:true});await usage.getByRole('button',{name:'Inspect live usage',exact:true}).click();
 for(const name of ['Project context window','Live usage']){const bounds=await page.getByRole('region',{name,exact:true}).boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(390);expect(bounds!.y).toBeGreaterThanOrEqual(0);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(844);}
 const stop=page.getByRole('button',{name:'Stop agent',exact:true});expect(await stop.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));})).toBe(true);await expect(stop).toBeEnabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});
