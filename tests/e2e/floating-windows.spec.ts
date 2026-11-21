import {test,expect,type Page} from '@playwright/test';
import {EMPTY_USAGE} from '../../packages/contracts';
import {PLANNING_PROVENANCE,planDataId} from '../../packages/contracts/planning';
import {clampFloatingLayout} from '../../apps/web/src/floating-layout';
import {serveTaskFixture,taskFixture} from './task-interface-fixture';
const now='2026-10-30T05:00:00.000Z';
function fixture(){const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Investigating the checkout boundary.'}}}});snapshot.data.push({id:planDataId('task-thread'),threadId:'task-thread',revision:1,provenance:PLANNING_PROVENANCE,createdAt:now,value:{version:1,title:'Repair checkout failures',steps:[{id:'investigate',title:'Find the failing boundary',status:'working',requirements:[{id:'reproduce',label:'Reproduce the failure',completed:true},{id:'locate',label:'Locate the assertion',completed:false}],agentIds:[]}],agents:[]}});snapshot.usage['task-thread']={...EMPTY_USAGE,inputTokens:12640,outputTokens:820,contextTokens:35000,contextWindow:200000};return snapshot;}
async function openPlan(page:Page){await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled({timeout:15000});if(await page.locator('.workspace-right').count()===0)await page.getByRole('button',{name:'Open workspace panel',exact:true}).click();if(await page.getByRole('tab',{name:'Project',exact:true}).count()===0){await page.getByRole('button',{name:'Add surface',exact:true}).click();await page.getByRole('menuitem',{name:'Project',exact:true}).click();}const tab=page.getByRole('tab',{name:'Overview',exact:true});if(await tab.getAttribute('aria-selected')!=='true')await tab.click();const overview=page.locator('.project-context-card');await expect(overview).toBeVisible();return overview;}
async function openUsage(page:Page){const usage=page.getByRole('region',{name:'Live usage',exact:true}),launcher=page.getByRole('button',{name:'Show live usage',exact:true});await launcher.click();await expect(usage).toBeVisible();return usage;}

test('floating geometry rejects nonfinite storage and confines windows to a narrow viewport',()=>{
 const result=clampFloatingLayout({x:9000,y:-400,width:4000,height:5000,collapsed:false},{width:390,height:844,top:60,bottom:620},{width:280,height:180});
 expect(result.x).toBeGreaterThanOrEqual(8);expect(result.y).toBeGreaterThanOrEqual(60);expect(result.x+result.width).toBeLessThanOrEqual(382);expect(result.y+result.height).toBeLessThanOrEqual(620);
 const invalid=clampFloatingLayout({x:NaN,y:Infinity,width:-400,height:NaN,collapsed:false},{width:1000,height:800},{width:280,height:180});expect(Object.values(invalid).filter(value=>typeof value==='number').every(Number.isFinite)).toBe(true);
});

test('the protected context only minimizes and preserves its draft on reload',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await serveTaskFixture(page,fixture());await page.goto('/');const overview=await openPlan(page);
 await expect(page.getByRole('region',{name:'Plan',exact:true})).toHaveCount(0);await page.getByRole('textbox',{name:'Message',exact:true}).fill('Keep this composer draft.');
 await expect(overview.getByRole('button',{name:/^Move |^Resize |^Close |^Detach |^Reset /})).toHaveCount(0);
 await page.getByRole('button',{name:'Hide workspace panel',exact:true}).click();await expect(page.locator('.workspace-right')).toHaveCount(0);
 await page.reload();await expect(page.locator('.workspace-right')).toHaveCount(0);
 await openPlan(page);await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Keep this composer draft.');
});

test('switching project tabs retains the same task content without a delete control',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await serveTaskFixture(page,fixture());await page.goto('/');const overview=await openPlan(page),body=page.getByRole('region',{name:'Plan summary',exact:true});const original=await body.elementHandle();await expect(body.getByText('Repair checkout failures',{exact:true})).toBeVisible();
 await expect(overview.getByRole('separator')).toHaveCount(0);
 await page.getByRole('tab',{name:'Pull requests',exact:true}).click();await expect(body).toBeHidden();
 await page.getByRole('tab',{name:'Overview',exact:true}).click();await expect(body).toBeVisible();expect(await body.evaluate((node,old)=>node===old,original)).toBe(true);
});

test('live usage stays available and remembers its minimized state without close or resize controls',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await serveTaskFixture(page,fixture());await page.goto('/');let usage=await openUsage(page);await expect(usage).toHaveAttribute('data-collapsed','true');
 await expect(usage.getByRole('button',{name:/^Move |^Resize |^Close Live usage$|^Detach |^Reset /})).toHaveCount(0);
 await usage.getByRole('button',{name:'Inspect live usage',exact:true}).click();await expect(usage).toHaveAttribute('data-collapsed','false');
 await page.keyboard.press('Escape');await expect(usage).toHaveAttribute('data-collapsed','true');await expect(usage.getByRole('button',{name:'Inspect live usage',exact:true})).toBeFocused();
 await page.reload();usage=await openUsage(page);await expect(usage).toBeVisible();await expect(usage).toHaveAttribute('data-collapsed','true');
});

test('the project drawer fits a narrow viewport, retains keyboard access and leaves Stop available',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});const snapshot=fixture();snapshot.threads[0].status='working';snapshot.threads[0].runId='fixture-run';await serveTaskFixture(page,snapshot);await page.goto('/');await openPlan(page);
 const panel=page.locator('.workspace-right'),pbox=await panel.boundingBox();expect(pbox!.x).toBeGreaterThanOrEqual(0);expect(pbox!.x+pbox!.width).toBeLessThanOrEqual(390);
 await expect(page.locator('.workspace-panel-scrim')).toBeVisible();
 await panel.locator('button').first().focus();await page.keyboard.press('Escape');await expect(panel).toHaveCount(0);
 const stop=page.getByRole('button',{name:'Stop agent',exact:true});expect(await stop.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));})).toBe(true);await expect(stop).toBeEnabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});
