import {expect,test} from '@playwright/test';
import {resolve} from 'node:path';
const fixture='/@fs/'+resolve('tests/e2e/canvas-clarity-fixture.tsx').split(String.fromCharCode(92)).join('/');
test.beforeEach(async({page})=>{
 await page.route('**/canvas-clarity-check',route=>route.fulfill({contentType:'text/html',body:`<html data-theme="dark"><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${fixture}');</script></body></html>`}));
 await page.goto('/canvas-clarity-check');await expect(page.getByRole('button',{name:'Reset canvas zoom'})).toHaveText('100%');
});
test('agent families are contained by project and preserve edits through pin and collapse',async({page})=>{
 await expect(page.locator('.canvas-project-group')).toHaveCount(1);await expect(page.locator('.canvas-family-group')).toHaveCount(1);
 await expect(page.locator('.canvas-family-group')).toHaveAttribute('aria-owns',/live-thread:clarity:parent.*live-thread:clarity:child/);
 const draft=page.getByRole('textbox',{name:'Draft parent'});await draft.fill('Keep this draft');
 await page.getByRole('button',{name:'Pin Main investigation',exact:true}).click();await expect(page.locator('[data-panel-id="live-thread:clarity:parent"]')).toHaveAttribute('data-pinned','true');
 const orders=await page.locator('.canvas-panel').evaluateAll(nodes=>nodes.map(node=>Number((node as HTMLElement).style.zIndex)));expect(orders[0]).toBeGreaterThan(orders[1]);
 await page.getByRole('button',{name:'Collapse Main investigation',exact:true}).click();await page.getByRole('button',{name:'Expand Main investigation',exact:true}).click();await expect(draft).toHaveValue('Keep this draft');
 expect(await page.evaluate(()=>(window as any).__canvasMounts['live-thread:clarity:parent'])).toBe(1);
});
test('wheel zoom uses canvas chrome while transcript wheel input scrolls its content',async({page})=>{
 const canvas=page.locator('.workspace-canvas'),box=await canvas.boundingBox();if(!box)throw new Error('Canvas missing');
 await page.mouse.move(box.x+box.width-20,box.y+100);await page.mouse.wheel(0,-160);await expect(page.getByRole('button',{name:'Reset canvas zoom'})).not.toHaveText('100%');
 const zoom=await page.getByRole('button',{name:'Reset canvas zoom'}).textContent();const body=page.locator('[data-panel-id="live-thread:clarity:parent"] .canvas-panel-body');const bodyBox=await body.boundingBox();if(!bodyBox)throw new Error('Transcript missing');await body.hover({position:{x:bodyBox.width-80,y:160}});await page.mouse.wheel(0,240);await expect.poll(()=>body.evaluate(node=>node.scrollTop)).toBeGreaterThan(0);await expect(page.getByRole('button',{name:'Reset canvas zoom'})).toHaveText(zoom!);
});
test('a delayed failed viewport write cannot roll back newer wheel input',async({page})=>{
 await page.evaluate(()=>(window as any).__delayFirstCanvasWrite=true);const box=await page.locator('.workspace-canvas').boundingBox();if(!box)throw new Error('Canvas missing');
 await page.mouse.move(box.x+box.width-20,box.y+100);await page.mouse.wheel(0,-80);await expect.poll(()=>page.evaluate(()=>(window as any).__canvasViewportWrites?.length??0)).toBe(1);
 await page.mouse.wheel(0,-120);const latest=await page.getByRole('button',{name:'Reset canvas zoom'}).textContent();await page.evaluate(()=>(window as any).__rejectCanvasWrite());
 await expect.poll(()=>page.evaluate(()=>(window as any).__canvasViewportWrites?.length??0)).toBe(2);await expect(page.getByRole('button',{name:'Reset canvas zoom'})).toHaveText(latest!);
});
test('Fit and Arrange keep editors mounted and pointer cancellation clears drag state',async({page})=>{
 const draft=page.getByRole('textbox',{name:'Draft parent'});await draft.fill('Persist across arrange');await page.getByRole('button',{name:'Arrange',exact:true}).click();await expect(page.getByRole('button',{name:'Arrange',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Fit',exact:true}).click();await expect(draft).toHaveValue('Persist across arrange');
 const handle=page.getByRole('button',{name:'Move Main investigation',exact:true}),box=await handle.boundingBox();if(!box)throw new Error('Handle missing');
 await page.mouse.move(box.x+20,box.y+12);await page.mouse.down();await page.mouse.move(box.x+80,box.y+40);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.up();await expect(page.locator('html')).not.toHaveClass(/workspace-canvas-interaction/);
});

test('switching canvases before debounce saves both owning viewports',async({page})=>{
 await page.evaluate(()=>{
  const canvas=document.querySelector('.workspace-canvas')!,rect=canvas.getBoundingClientRect(),wheel=(deltaY:number)=>canvas.dispatchEvent(new WheelEvent('wheel',{deltaY,clientX:rect.right-20,clientY:rect.top+100,bubbles:true,cancelable:true}));
  wheel(-80);(window as any).__switchCanvas('other');wheel(-160);
 });
 await expect.poll(()=>page.evaluate(()=>(window as any).__canvasViewportWrites?.map((value:any)=>value.canvasId).sort()??[])).toEqual(['clarity','other']);
 const saved=await page.evaluate(()=>(window as any).__canvasFixture.saved);expect(saved.clarity.viewport.zoom).toBeCloseTo(Math.exp(.12));expect(saved.other.viewport.zoom).toBeCloseTo(Math.exp(.24));
 await expect(page.getByRole('button',{name:'Reset canvas zoom'})).toHaveText('127%');
 await page.evaluate(()=>(window as any).__switchCanvas('clarity'));await expect(page.getByRole('button',{name:'Reset canvas zoom'})).toHaveText('113%');
});

test('an in-flight outgoing canvas save retains the second canvas viewport',async({page})=>{
 await page.evaluate(()=>(window as any).__delayFirstCanvasWrite=true);
 await page.evaluate(()=>{const canvas=document.querySelector('.workspace-canvas')!,rect=canvas.getBoundingClientRect();canvas.dispatchEvent(new WheelEvent('wheel',{deltaY:-80,clientX:rect.right-20,clientY:rect.top+100,bubbles:true,cancelable:true}));});
 await expect.poll(()=>page.evaluate(()=>(window as any).__canvasViewportWrites?.length??0)).toBe(1);
 await page.evaluate(()=>{(window as any).__switchCanvas('other');const canvas=document.querySelector('.workspace-canvas')!,rect=canvas.getBoundingClientRect();canvas.dispatchEvent(new WheelEvent('wheel',{deltaY:-160,clientX:rect.right-20,clientY:rect.top+100,bubbles:true,cancelable:true}));});
 await expect(page.getByRole('button',{name:'Reset canvas zoom'})).toHaveText('127%');await page.evaluate(()=>(window as any).__resolveCanvasWrite());
 await expect.poll(()=>page.evaluate(()=>(window as any).__canvasViewportWrites?.map((value:any)=>value.canvasId)??[])).toEqual(['clarity','other']);
 await expect(page.getByRole('button',{name:'Reset canvas zoom'})).toHaveText('127%');
 const saved=await page.evaluate(()=>(window as any).__canvasFixture.saved);expect(saved.clarity.viewport.zoom).toBeCloseTo(Math.exp(.12));expect(saved.other.viewport.zoom).toBeCloseTo(Math.exp(.24));
});
