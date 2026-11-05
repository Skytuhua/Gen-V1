import {expect,test} from '@playwright/test';
import {resolve} from 'node:path';

const fixture='/@fs/'+resolve('tests/e2e/canvas-clarity-fixture.tsx').split(String.fromCharCode(92)).join('/');
test.beforeEach(async({page})=>{
 await page.route('**/no-detach-canvas-check*',route=>route.fulfill({contentType:'text/html',body:`<html data-theme="dark"><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${fixture}');</script></body></html>`}));
 await page.goto('/no-detach-canvas-check');await expect(page.getByRole('button',{name:'Move Main investigation',exact:true})).toBeVisible();
});

test('canvas offers only in-app panel controls even when a detach callback is supplied',async({page})=>{
 await expect(page.getByRole('button',{name:/detach|separate window/i})).toHaveCount(0);
 for(const name of ['Pin Main investigation','Collapse Main investigation','Hide Main investigation','Resize Main investigation'])await expect(page.getByRole('button',{name,exact:true})).toHaveCount(1);
 expect(await page.evaluate(()=>(window as any).__canvasDetachCalls??0)).toBe(0);
});

test('dragging outside the app saves an in-app placement with no detach cue or callback',async({page})=>{
 const draft=page.getByRole('textbox',{name:'Draft parent'});await draft.fill('Keep the in-app draft');const identity=await draft.elementHandle();
 const handle=page.getByRole('button',{name:'Move Main investigation',exact:true}),box=await handle.boundingBox();if(!box)throw new Error('Move handle missing');
 await page.mouse.move(box.x+24,box.y+14);await page.mouse.down();await page.mouse.move(page.viewportSize()!.width+32,200);
 await expect(page.getByText('Release to open in a window',{exact:true})).toHaveCount(0);await page.mouse.up();
 expect(await page.evaluate(()=>(window as any).__canvasDetachCalls??0)).toBe(0);
 await expect.poll(()=>page.evaluate(()=>(window as any).__canvasPanelWrites?.length??0)).toBe(1);
 const state=await page.evaluate(()=>(window as any).__canvasFixture.panels.find((panel:any)=>panel.binding.threadId==='parent'));
 expect(state.placement).toBe('canvas');expect(state.visible).toBe(true);expect(state.bounds.x).toBeGreaterThan(1000);
 await page.getByRole('button',{name:'Fit',exact:true}).click();await expect(draft).toBeVisible();await expect(draft).toHaveValue('Keep the in-app draft');
 expect(await draft.evaluate((node,old)=>node===old,identity)).toBe(true);
});

test('in-app movement resizing pinning and hiding still save ordinary panel state',async({page})=>{
 const readPanel=()=>page.evaluate(()=>(window as any).__canvasFixture.panels.find((panel:any)=>panel.binding.threadId==='parent'));
 const original=await readPanel(),handle=page.getByRole('button',{name:'Move Main investigation',exact:true}),box=await handle.boundingBox();if(!box)throw new Error('Move handle missing');
 await page.getByRole('textbox',{name:'Draft parent'}).fill('Ordinary canvas draft');
 await page.mouse.move(box.x+24,box.y+14);await page.mouse.down();await page.mouse.move(box.x+96,box.y+54);await page.mouse.up();
 await expect.poll(async()=>({x:(await readPanel()).bounds.x,y:(await readPanel()).bounds.y})).toEqual({x:original.bounds.x+72,y:original.bounds.y+40});
 await handle.focus();await page.keyboard.press('Shift+ArrowRight');await expect.poll(async()=>(await readPanel()).bounds.width).toBe(original.bounds.width+8);
 await page.keyboard.press('Shift+ArrowDown');await expect.poll(async()=>(await readPanel()).bounds.height).toBe(original.bounds.height+8);
 await page.getByRole('button',{name:'Pin Main investigation',exact:true}).click();await expect(page.getByRole('button',{name:'Unpin Main investigation',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('textbox',{name:'Draft parent'})).toHaveValue('Ordinary canvas draft');
 await page.getByRole('button',{name:'Hide Main investigation',exact:true}).click();await expect.poll(async()=>(await readPanel()).visible).toBe(false);
 expect(await page.evaluate(()=>(window as any).__canvasDetachCalls??0)).toBe(0);
});

test('embedded panels stay reachable after an outside drag without Fit or panning',async({page})=>{
 await page.goto('/no-detach-canvas-check?embedded=1');await expect(page.getByRole('button',{name:'Fit',exact:true})).toHaveCount(0);
 const draft=page.getByRole('textbox',{name:'Draft parent'}),identity=await draft.elementHandle();await draft.fill('Keep the embedded edit');
 const handle=page.getByRole('button',{name:'Move Main investigation',exact:true}),box=(await handle.boundingBox())!;
 await page.mouse.move(box.x+24,box.y+14);await page.mouse.down();await page.mouse.move(page.viewportSize()!.width+100,page.viewportSize()!.height+100);await page.mouse.up();
 await expect.poll(()=>page.evaluate(()=>(window as any).__canvasPanelWrites?.length??0)).toBe(1);
 const reachable=()=>handle.evaluate(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&node.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));});
 expect(await reachable()).toBe(true);await handle.focus();for(let count=0;count<20;count++)await handle.press('ArrowRight');expect(await reachable()).toBe(true);
 await expect(draft).toHaveValue('Keep the embedded edit');expect(await draft.evaluate((node,old)=>node===old,identity)).toBe(true);expect(await page.evaluate(()=>(window as any).__canvasDetachCalls??0)).toBe(0);
});
