import {test,expect,type Page} from '@playwright/test';

const flushFrames=(page:Page)=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
import {resolve} from 'node:path';

const fixture='/@fs/'+resolve('tests/e2e/free-floating-fixture.tsx').replaceAll('\\','/');
test.beforeEach(async({page})=>{
 await page.setViewportSize({width:1440,height:1000});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.route('**/free-floating-check*',route=>route.fulfill({contentType:'text/html',body:`<div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${fixture}');</script>`}));
});
test('closing a tool animates safely and an immediate reopen stays open',async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.addInitScript(()=>{const original=Element.prototype.animate;(window as any).__exitAnimations=[];Element.prototype.animate=function(frames,options){const animation=original.call(this,frames,options);if((this as HTMLElement).dataset.floatingId==='free-test'&&Array.isArray(frames)&&frames.at(-1)?.opacity===0)(window as any).__exitAnimations.push(animation.finished.catch(()=>{}));return animation;};});
 await page.goto('/free-floating-check');
 const panel=page.locator('[data-floating-id="free-test"]');
 await panel.getByRole('button',{name:'Close Test tool',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).__exitAnimations.length)).toBe(1);
 await expect(panel).toHaveAttribute('inert','');
 await page.getByRole('button',{name:'Open test tool',exact:true}).click();
 await page.evaluate(async()=>{await Promise.allSettled((window as any).__exitAnimations);});
 await expect(panel).toBeVisible();await expect(panel).not.toHaveAttribute('inert','');
 await expect(panel.getByRole('textbox',{name:'Tool draft'})).toHaveValue('Keep my draft');
});
test('reduced motion closes immediately and returns focus to the opener',async({page})=>{
 await page.addInitScript(()=>{const original=Element.prototype.animate;(window as any).__exitCount=0;Element.prototype.animate=function(frames,options){if((this as HTMLElement).dataset.floatingId==='free-test'&&Array.isArray(frames)&&frames.at(-1)?.opacity===0)(window as any).__exitCount++;return original.call(this,frames,options);};});
 await page.goto('/free-floating-check');const panel=page.locator('[data-floating-id="free-test"]'),opener=page.getByRole('button',{name:'Open test tool',exact:true});
 await panel.getByRole('button',{name:'Close Test tool',exact:true}).click();await expect(panel).toBeHidden();
 await opener.click();await panel.getByRole('textbox',{name:'Tool draft'}).focus();await page.keyboard.press('Escape');
 await expect(panel).toBeHidden();await expect(opener).toBeFocused();expect(await page.evaluate(()=>(window as any).__exitCount)).toBe(0);
});
test('keyboard movement releases the rail in both axes and manual sizing preserves the draft',async({page})=>{
 await page.goto('/free-floating-check');
 const panel=page.getByRole('region',{name:'Test tool window',exact:true}),handle=panel.getByRole('button',{name:'Move Test tool',exact:true});
 const before=(await panel.boundingBox())!;
 await handle.focus();await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowDown');
 await expect.poll(async()=>Math.round((await panel.boundingBox())!.x-before.x)).toBe(-12);
 await expect.poll(async()=>Math.round((await panel.boundingBox())!.y-before.y)).toBe(12);
 await page.keyboard.press('Shift+ArrowRight');
 await expect.poll(async()=>Math.round((await panel.boundingBox())!.width-before.width)).toBe(12);
 await page.keyboard.press('Shift+ArrowLeft');await page.keyboard.press('Shift+ArrowDown');
 await expect.poll(async()=>Math.round((await panel.boundingBox())!.width-before.width)).toBe(0);
 await expect.poll(async()=>Math.round((await panel.boundingBox())!.height-before.height)).toBe(12);
 await expect(panel.getByRole('textbox',{name:'Tool draft'})).toHaveValue('Keep my draft');
 await flushFrames(page);await page.reload();
 await expect(panel).toHaveAttribute('data-floating','true');
 await expect.poll(async()=>Math.round((await panel.boundingBox())!.x-before.x)).toBe(-12);
});

test('free floating on a narrow workspace releases the reserved tool area',async({page})=>{
 await page.setViewportSize({width:700,height:844});await page.goto('/free-floating-check');
 const panel=page.getByRole('region',{name:'Test tool window',exact:true});
 await panel.getByRole('button',{name:'Move Test tool',exact:true}).focus();await page.keyboard.press('ArrowLeft');
 await expect(panel).toHaveAttribute('data-floating','true');
 await expect.poll(()=>page.locator('.shell-workarea').evaluate(node=>getComputedStyle(node).getPropertyValue('--task-rail-height').trim())).toBe('0px');
 expect((await page.locator('.floating-rail').boundingBox())!.height).toBe(0);
 await expect(panel.getByRole('textbox',{name:'Tool draft'})).toHaveValue('Keep my draft');
});
test('pointer drag leaves the anchor without remounting, and hidden scrollbar still scrolls',async({page})=>{
 await page.goto('/free-floating-check');
 const panel=page.getByRole('region',{name:'Test tool window',exact:true}),handle=panel.getByRole('button',{name:'Move Test tool',exact:true});
 const draft=panel.getByRole('textbox',{name:'Tool draft'}),original=await draft.elementHandle();await draft.fill('Retain this edit');
 const before=(await panel.boundingBox())!,grab=(await handle.boundingBox())!;
 await page.mouse.move(grab.x+30,grab.y+14);await page.mouse.down();await page.mouse.move(grab.x-110,grab.y+54,{steps:8});await page.mouse.up();
 await expect.poll(async()=>Math.round((await panel.boundingBox())!.x-before.x)).toBe(-140);
 await expect.poll(async()=>Math.round((await panel.boundingBox())!.y-before.y)).toBe(40);
 await panel.getByRole('button',{name:'Minimize Test tool',exact:true}).click();await panel.getByRole('button',{name:'Expand Test tool',exact:true}).click();
 expect(await draft.evaluate((node,old)=>node===old,original)).toBe(true);await expect(draft).toHaveValue('Retain this edit');
 const body=panel.locator('.floating-window-body');expect(await body.evaluate(node=>getComputedStyle(node).scrollbarWidth)).toBe('none');
 await body.hover();await page.mouse.wheel(0,350);await expect.poll(()=>body.evaluate(node=>node.scrollTop)).toBeGreaterThan(0);
 await panel.getByRole('button',{name:'Close Test tool',exact:true}).click();await page.getByRole('button',{name:'Open test tool',exact:true}).click();
 expect(await draft.evaluate((node,old)=>node===old,original)).toBe(true);await expect(draft).toHaveValue('Retain this edit');
 await handle.focus();await page.keyboard.press('Home');await expect(panel).toHaveAttribute('data-floating','false');
});
test('adapter recovery is read before any write and keeps its recovered free coordinates',async({page})=>{
 await page.goto('/free-floating-check?adapter=1');
 const panel=page.getByRole('region',{name:'Test tool window',exact:true});
 await expect.poll(async()=>Math.round((await panel.boundingBox())!.x)).toBe(430);
 await expect.poll(async()=>Math.round((await panel.boundingBox())!.y)).toBe(160);
 await expect.poll(()=>page.evaluate(()=>(window as unknown as Window&{floatingEvents:string[]}).floatingEvents.some(event=>event.startsWith('write:')))).toBe(true);
 const events=await page.evaluate(()=>(window as unknown as Window&{floatingEvents:string[]}).floatingEvents);
 expect(events[0]).toBe('read');expect(events.filter(event=>event.startsWith('write:')).every(event=>event==='write:430:160')).toBe(true);
});
test('blur ends an active drag and viewport changes keep the tool reachable',async({page})=>{
 await page.goto('/free-floating-check');
 const panel=page.getByRole('region',{name:'Test tool window',exact:true}),handle=panel.getByRole('button',{name:'Move Test tool',exact:true}),grab=(await handle.boundingBox())!;
 await page.mouse.move(grab.x+20,grab.y+14);await page.mouse.down();await page.mouse.move(grab.x-80,grab.y+54);
 await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await expect(panel).toHaveAttribute('data-interacting','false');const after=(await panel.boundingBox())!;
 await page.mouse.move(300,300);await page.mouse.up();expect(Math.round((await panel.boundingBox())!.x)).toBe(Math.round(after.x));
 await page.setViewportSize({width:600,height:700});
 await expect.poll(async()=>{const bounds=(await panel.boundingBox())!;return bounds.x>=220&&bounds.x+bounds.width<=600&&bounds.y>=0&&bounds.y+bounds.height<=700;}).toBe(true);
});
test('content-fit adapter recovery keeps free coordinates without taking input focus',async({page})=>{
 await page.goto('/free-floating-check?adapter=1&content=1');
 const panel=page.getByRole('region',{name:'Test tool window',exact:true});
 await expect.poll(async()=>Math.round((await panel.boundingBox())!.x)).toBe(430);
 await expect.poll(async()=>Math.round((await panel.boundingBox())!.y)).toBe(160);
 const handle=panel.getByRole('button',{name:'Move Test tool',exact:true});
 const before=(await panel.boundingBox())!;await handle.focus();await page.keyboard.press('Shift+ArrowRight');
 expect(Math.round((await panel.boundingBox())!.width)).toBe(Math.round(before.width));
});
test('pointer cancellation ends a move without losing the window or draft',async({page})=>{
 await page.goto('/free-floating-check');
 const panel=page.getByRole('region',{name:'Test tool window',exact:true}),handle=panel.getByRole('button',{name:'Move Test tool',exact:true}),grab=(await handle.boundingBox())!;
 await page.mouse.move(grab.x+20,grab.y+14);await page.mouse.down();await page.mouse.move(grab.x-80,grab.y+54);
 await handle.dispatchEvent('pointercancel',{pointerId:1});await expect(panel).toHaveAttribute('data-interacting','false');
 const after=(await panel.boundingBox())!;await page.mouse.move(300,300);await page.mouse.up();
 expect(Math.round((await panel.boundingBox())!.x)).toBe(Math.round(after.x));
 await expect(panel.getByRole('textbox',{name:'Tool draft'})).toHaveValue('Keep my draft');
});
