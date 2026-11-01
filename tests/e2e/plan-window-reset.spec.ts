import {test,expect,type Page,type Locator} from '@playwright/test';
import {EMPTY_USAGE} from '../../packages/contracts';
import {PLANNING_PROVENANCE,planDataId} from '../../packages/contracts/planning';
import {serveTaskFixture,taskFixture} from './task-interface-fixture';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

function fixture(){
 const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Inspect the task boundary.'}}}});
 snapshot.data.push({id:planDataId('task-thread'),threadId:'task-thread',revision:1,provenance:PLANNING_PROVENANCE,createdAt:'2026-10-30T00:00:00Z',value:{version:1,title:'Repair checkout failures',steps:[{id:'inspect',title:'Find the failing boundary',status:'working',requirements:[{id:'reproduce',label:'Reproduce the quantity assertion',completed:true}],agentIds:[]},{id:'verify',title:'Verify the repair',status:'pending',requirements:[],agentIds:[]}],agents:[]}});
 snapshot.usage['task-thread']={...EMPTY_USAGE,inputTokens:12640,outputTokens:820};
 return snapshot;
}
const resetName='Reset Task plan position';
async function settled(panel:Locator){await expect.poll(()=>panel.evaluate(node=>node.getAnimations().filter(animation=>animation.playState==='running').length)).toBe(0);}
async function open(page:Page,width=1440){await page.setViewportSize({width,height:1000});await serveTaskFixture(page,fixture());await page.goto('/');await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();const plan=page.getByRole('region',{name:'Task plan window',exact:true});await expect(plan).toBeVisible();await settled(plan);return plan;}

test('plan reset restores only position, preserves mounted work and content height, and persists across reload',async({page})=>{
 const plan=await open(page),before=await plan.boundingBox(),body=page.getByRole('region',{name:'Task plan',exact:true}),original=await body.elementHandle();
 const usage=page.getByRole('region',{name:'Live usage',exact:true});await expect(usage.getByRole('button',{name:/Reset .* position/})).toHaveCount(0);
 await page.getByRole('textbox',{name:'Message',exact:true}).fill('Preserve this draft.');
 const step=plan.getByRole('button',{name:/Find the failing boundary/});await step.click();await expect(step).toHaveAttribute('aria-expanded','false');
 const move=plan.getByRole('button',{name:'Move Task plan',exact:true});await move.press('Shift+ArrowDown');await move.press('ArrowDown');await move.press('ArrowDown');await settled(plan);
 const changed=await plan.boundingBox();expect(changed!.y).toBeCloseTo(before!.y+24,0);expect(changed!.height).toBeLessThanOrEqual(before!.height);
 await plan.getByRole('button',{name:resetName,exact:true}).click();await settled(plan);
 const reset=await plan.boundingBox();expect(reset!.y).toBeCloseTo(before!.y,0);expect(reset!.x).toBeCloseTo(before!.x,0);expect(reset!.height).toBeCloseTo(changed!.height,0);
 expect(await body.evaluate((node,old)=>node===old,original)).toBe(true);await expect(step).toHaveAttribute('aria-expanded','false');
 expect(await plan.locator('.plan-step').first().evaluate(node=>getComputedStyle(node,'::before').content)).toBe('none');
 await page.reload();const restored=page.getByRole('region',{name:'Task plan window',exact:true});await expect(restored).toBeVisible();await settled(restored);
 expect((await restored.boundingBox())!.y).toBeCloseTo(before!.y,0);expect((await restored.boundingBox())!.height).toBeCloseTo(before!.height,0);await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Preserve this draft.');
});

test('reset remains usable while minimized and returns to the content height when expanded',async({page})=>{
 const plan=await open(page),move=plan.getByRole('button',{name:'Move Task plan',exact:true});await move.press('Shift+ArrowDown');await move.press('ArrowDown');await settled(plan);const resized=(await plan.boundingBox())!.height;
 await plan.getByRole('button',{name:'Minimize Task plan',exact:true}).click();await expect(plan).toHaveAttribute('data-collapsed','true');
 await plan.getByRole('button',{name:resetName,exact:true}).click();await expect(plan).toHaveAttribute('data-collapsed','true');
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('harness:floating:plan:v1')!).y)).toBe(0);
 await plan.getByRole('button',{name:'Expand Task plan',exact:true}).click();await settled(plan);expect((await plan.boundingBox())!.height).toBeCloseTo(resized,0);
 await page.setViewportSize({width:1600,height:1100});await settled(plan);expect(await plan.evaluate(node=>parseFloat((node as HTMLElement).style.top))).toBe(0);
});

test('reset terminates an active pointer drag instead of allowing later moves to overwrite it',async({page})=>{
 const plan=await open(page),move=plan.getByRole('button',{name:'Move Task plan',exact:true}),start=await move.boundingBox();
 await page.mouse.move(start!.x+12,start!.y+12);await page.mouse.down();await page.mouse.move(start!.x+12,start!.y+72,{steps:5});await expect(plan).toHaveAttribute('data-interacting','true');
 await plan.getByRole('button',{name:resetName,exact:true}).evaluate(node=>(node as HTMLButtonElement).click());await expect(plan).toHaveAttribute('data-interacting','false');
 await page.mouse.move(start!.x+12,start!.y+112,{steps:3});await page.mouse.up();await settled(plan);expect(await plan.evaluate(node=>parseFloat((node as HTMLElement).style.top))).toBe(0);expect(await page.locator('html').evaluate(node=>node.classList.contains('floating-window-interaction'))).toBe(false);
});

test.describe('touch plan reset',()=>{
test.use({hasTouch:true});
test('narrow touch reset keeps plan and usage separate and leaves the composer reachable',async({page})=>{
 const plan=await open(page,390);await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'Show live usage',exact:true}).click();const usage=page.getByRole('region',{name:'Live usage',exact:true});await usage.getByRole('button',{name:'Inspect live usage',exact:true}).click();
 const button=plan.getByRole('button',{name:resetName,exact:true});await button.tap();await expect(button).toBeFocused();await settled(plan);
 const p=await plan.boundingBox(),u=await usage.boundingBox();expect(p!.y+p!.height).toBeLessThanOrEqual(u!.y-8);
 const message=page.getByRole('textbox',{name:'Message',exact:true});expect(await message.evaluate(node=>{const bounds=node.getBoundingClientRect();return node.contains(document.elementFromPoint(bounds.x+bounds.width/2,bounds.y+bounds.height/2));})).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});
});

const captureDirectory=process.env.PLAN_RESET_CAPTURE_DIR;
if(captureDirectory)for(const width of [1440,390])test(`capture reset plan ${width}`,async({page})=>{
 const plan=await open(page,width);await expect(plan.getByRole('button',{name:resetName,exact:true})).toBeVisible();
 await expect(plan.getByText('Verify the repair',{exact:true})).toBeVisible();
 await plan.getByRole('button',{name:resetName,exact:true}).focus();await settled(plan);
 await mkdir(captureDirectory,{recursive:true});await page.screenshot({path:resolve(captureDirectory,`plan-reset-${width}.png`)});
});
