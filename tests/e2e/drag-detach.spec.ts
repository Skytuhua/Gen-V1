import {test,expect,type Page,type Locator} from '@playwright/test';
import {resolve} from 'node:path';

const fixture='/@fs/'+resolve('tests/e2e/drag-detach-fixture.tsx').split(String.fromCharCode(92)).join('/');
test.beforeEach(async({page})=>{
 await page.setViewportSize({width:1440,height:900});await page.emulateMedia({reducedMotion:'reduce'});
 await page.route('**/drag-detach-check*',route=>route.fulfill({contentType:'text/html',body:`<html data-theme="dark"><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${fixture}');</script></html>`}));
});
async function startDrag(page:Page,handle:Locator){const box=await handle.boundingBox();if(!box)throw new Error('Move handle missing');await page.mouse.move(box.x+24,box.y+14);await page.mouse.down();return box;}
async function detachCount(page:Page){return page.evaluate(()=>(window as unknown as Window&{dragDetachEvents:{detach:number}}).dragDetachEvents.detach);}
async function updateCount(page:Page){return page.evaluate(()=>(window as unknown as Window&{dragDetachEvents:{updates:number}}).dragDetachEvents.updates);}
async function expectNoDetachUi(page:Page){await expect(page.getByRole('button',{name:/detach|separate window/i})).toHaveCount(0);await expect(page.getByText('Release to open in a window',{exact:true})).toHaveCount(0);}

for(const surface of ['floating','canvas']){
 test(`${surface}: supplied callbacks never expose detach controls`,async({page})=>{
  await page.goto(`/drag-detach-check?surface=${surface}&mode=failure`);await expect(page.getByRole('button',{name:'Move Movable panel',exact:true})).toBeVisible();
  await expectNoDetachUi(page);expect(await detachCount(page)).toBe(0);
 });
 test(`${surface}: release beyond every app edge stays in app and retains the editor`,async({page})=>{
  for(const point of [{x:1472,y:200},{x:-32,y:220},{x:650,y:-32},{x:650,y:932}]){
   await page.goto(`/drag-detach-check?surface=${surface}&mode=failure`);
   const handle=page.getByRole('button',{name:'Move Movable panel',exact:true}),draft=page.locator('textarea'),identity=await draft.elementHandle();await draft.fill('Keep this in-app edit');
   await startDrag(page,handle);await page.mouse.move(point.x,point.y);await expectNoDetachUi(page);await page.mouse.up();
   expect(await detachCount(page)).toBe(0);await expect(page.getByRole('alert')).toHaveCount(0);
   if(surface==='canvas'){await expect.poll(()=>updateCount(page)).toBe(1);await page.getByRole('button',{name:'Fit',exact:true}).click();await expect(page.locator('.canvas-panel')).toBeVisible();}
   await expect(draft).toHaveValue('Keep this in-app edit');expect(await draft.evaluate((node,old)=>node===old,identity)).toBe(true);
  }
 });
 test(`${surface}: cancellation and blur outside never invoke callbacks or lose edits`,async({page})=>{
  for(const ending of ['cancel','blur']){
   await page.goto(`/drag-detach-check?surface=${surface}&mode=failure`);
   const handle=page.getByRole('button',{name:'Move Movable panel',exact:true}),draft=page.locator('textarea'),identity=await draft.elementHandle();await draft.fill(`Keep after ${ending}`);
   await startDrag(page,handle);await page.mouse.move(1472,200);await expectNoDetachUi(page);
   if(ending==='cancel')await handle.dispatchEvent('pointercancel',{pointerId:1});else await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
   await page.mouse.up();expect(await detachCount(page)).toBe(0);expect(await updateCount(page)).toBe(0);
   await expect(draft).toHaveValue(`Keep after ${ending}`);expect(await draft.evaluate((node,old)=>node===old,identity)).toBe(true);
   await expect(page.locator('html')).not.toHaveClass(/(?:workspace-canvas|floating-window)-interaction/);
  }
 });
}

test('crossing the canvas edge inside the app remains an ordinary saved move',async({page})=>{
 await page.goto('/drag-detach-check?surface=canvas&mode=failure');const handle=page.getByRole('button',{name:'Move Movable panel',exact:true}),draft=page.locator('textarea'),identity=await draft.elementHandle();await draft.fill('Canvas move draft');
 const before=await page.locator('.canvas-panel').evaluate(node=>({x:parseFloat((node as HTMLElement).style.left),y:parseFloat((node as HTMLElement).style.top)}));
 await startDrag(page,handle);await page.mouse.move(1150,230);await expectNoDetachUi(page);await page.mouse.up();
 expect(await detachCount(page)).toBe(0);await expect.poll(()=>updateCount(page)).toBe(1);
 const after=await page.locator('.canvas-panel').evaluate(node=>({x:parseFloat((node as HTMLElement).style.left),y:parseFloat((node as HTMLElement).style.top)}));expect(after.x).toBeGreaterThan(before.x);expect(after.y).not.toBe(before.y);
 await page.getByRole('button',{name:'Fit',exact:true}).click();await expect(draft).toHaveValue('Canvas move draft');expect(await draft.evaluate((node,old)=>node===old,identity)).toBe(true);
});

test('a notes editor remains mounted through a cancelled outside canvas drag',async({page})=>{
 await page.goto('/drag-detach-check?surface=canvas&mode=failure&kind=notes');const draft=page.locator('textarea'),identity=await draft.elementHandle();await draft.fill('Notes draft');
 const handle=page.getByRole('button',{name:'Move Movable panel',exact:true});await startDrag(page,handle);await page.mouse.move(1472,200);await expectNoDetachUi(page);
 expect(await draft.evaluate((node,old)=>node===old,identity)).toBe(true);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.up();
 expect(await detachCount(page)).toBe(0);expect(await updateCount(page)).toBe(0);await expect(draft).toHaveValue('Notes draft');expect(await draft.evaluate((node,old)=>node===old,identity)).toBe(true);
});
