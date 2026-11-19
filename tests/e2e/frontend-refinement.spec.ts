import {test,expect} from '@playwright/test';
import {BOOT_TIMEOUT,warmApp} from './app-ready';
const fixture='/@fs/'+process.cwd().replaceAll('\\','/')+'/tests/e2e/frontend-refinement-fixture.tsx';
test.beforeAll(async({browser,baseURL})=>{await warmApp(browser,baseURL);});
test.beforeEach(async({page})=>{
 await page.route('**/frontend-refinement-check',route=>route.fulfill({contentType:'text/html',body:`<html data-theme="dark"><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${encodeURI(fixture)}');</script></body></html>`}));
 await page.goto('/frontend-refinement-check');await expect(page.getByRole('scrollbar',{name:'Scroll conversation'})).toBeVisible({timeout:BOOT_TIMEOUT});
});
test('left ticked scrollbar supports keys, track clicks, dragging, and history during updates',async({page})=>{
 const scroll=page.getByLabel('Fixture conversation'),bar=page.getByRole('scrollbar',{name:'Scroll conversation'});
 const bounds=await bar.boundingBox(),content=await scroll.boundingBox();expect(bounds!.x).toBeLessThan(content!.x+24);
 expect(bounds!.width).toBe(24);
 expect(await page.locator('.chat-scroll-track').evaluate(node=>getComputedStyle(node).width)).toBe('1px');
 expect(await page.locator('.chat-scroll-thumb').evaluate(node=>getComputedStyle(node).width)).toBe('3px');
 expect(await page.locator('.chat-scroll-track').evaluate(node=>getComputedStyle(node,'::before').backgroundImage)).toContain('repeating-linear-gradient');
 expect(await scroll.evaluate(node=>getComputedStyle(node).scrollbarWidth)).toBe('none');
 await bar.focus();await page.keyboard.press('Home');await expect.poll(()=>scroll.evaluate(node=>node.scrollTop)).toBe(0);
 await page.keyboard.press('PageDown');await expect.poll(()=>scroll.evaluate(node=>node.scrollTop)).toBeGreaterThan(50);
 const saved=await scroll.evaluate(node=>node.scrollTop);await page.getByRole('button',{name:'Grow transcript'}).click();
 await expect.poll(()=>scroll.evaluate(node=>node.scrollTop)).toBe(saved);
 await bar.click({position:{x:12,y:bounds!.height*.7}});await expect.poll(()=>scroll.evaluate(node=>node.scrollTop)).toBeGreaterThan(saved);
 const beforeDrag=await scroll.evaluate(node=>node.scrollTop);await expect(bar).toHaveAttribute('aria-valuenow',String(Math.round(beforeDrag)));const thumb=await page.locator('.chat-scroll-thumb').boundingBox();await page.mouse.move(thumb!.x+1,thumb!.y+3);await page.mouse.down();expect(await scroll.evaluate(node=>node.scrollTop)).toBeCloseTo(beforeDrag,0);await page.mouse.move(thumb!.x+1,bounds!.y+20,{steps:8});await page.mouse.up();
 await expect.poll(()=>scroll.evaluate(node=>node.scrollTop)).toBeLessThan(100);
 await bar.focus();await page.keyboard.press('End');await expect.poll(()=>scroll.evaluate(node=>node.scrollHeight-node.clientHeight-node.scrollTop)).toBeLessThan(2);
 await page.getByRole('textbox',{name:'Outside draft'}).fill('Keep this draft');await page.getByRole('button',{name:'Grow transcript'}).click();await expect(page.getByRole('textbox',{name:'Outside draft'})).toHaveValue('Keep this draft');
});
test('compact scrollbar keeps its 12px strip interactive without covering content',async({page})=>{
 await page.setViewportSize({width:640,height:800});
 const scroll=page.getByLabel('Fixture conversation'),bar=page.getByRole('scrollbar',{name:'Scroll conversation'});
 const bounds=(await bar.boundingBox())!;expect(bounds.width).toBe(12);
 expect(await page.locator('.chat-scroll-track').evaluate(node=>getComputedStyle(node).width)).toBe('1px');
 expect(await page.locator('.chat-scroll-thumb').evaluate(node=>getComputedStyle(node).width)).toBe('3px');
 // The rail must fill only the 12px padding strip: a click just inside the
 // content edge reaches the scroller instead of being intercepted by it.
 await scroll.click({position:{x:14,y:Math.round(bounds.height/2)}});
 // The fixture springs to the tail on open; pin the start before measuring.
 await bar.focus();await page.keyboard.press('Home');await expect.poll(()=>scroll.evaluate(node=>node.scrollTop)).toBe(0);
 await bar.click({position:{x:6,y:Math.round(bounds.height*.7)}});await expect.poll(()=>scroll.evaluate(node=>node.scrollTop)).toBeGreaterThan(50);
 const afterTrack=await scroll.evaluate(node=>node.scrollTop),thumb=(await page.locator('.chat-scroll-thumb').boundingBox())!;
 await page.mouse.move(thumb.x+1,thumb.y+2);await page.mouse.down();await page.mouse.move(thumb.x+1,bounds.y+10,{steps:6});await page.mouse.up();
 await expect.poll(()=>scroll.evaluate(node=>node.scrollTop)).toBeLessThan(afterTrack);
});
test('a different pointer cannot end the active scrollbar drag',async({page})=>{
 const scroll=page.getByLabel('Fixture conversation'),bar=page.getByRole('scrollbar',{name:'Scroll conversation'});
 await bar.focus();await page.keyboard.press('Home');
 const bounds=(await bar.boundingBox())!,thumb=(await page.locator('.chat-scroll-thumb').boundingBox())!;
 await page.mouse.move(thumb.x+1,thumb.y+3);await page.mouse.down();
 await bar.dispatchEvent('pointerup',{pointerId:77,pointerType:'touch',bubbles:true});
 await bar.dispatchEvent('pointercancel',{pointerId:77,pointerType:'touch',bubbles:true});
 await bar.dispatchEvent('lostpointercapture',{pointerId:77,pointerType:'touch',bubbles:true});
 await page.mouse.move(bounds.x+10,bounds.y+bounds.height*.7,{steps:3});
 await expect.poll(()=>scroll.evaluate(node=>node.scrollTop)).toBeGreaterThan(100);
 await page.mouse.up();
});
test('disconnected context is compact and connected context leads with useful project facts',async({page})=>{
 const card=page.getByLabel('Project context',{exact:true});await expect(card).toContainText('Fixture project');
 await expect(card.getByRole('button',{name:'Connect project'})).toBeVisible();expect((await card.boundingBox())!.height).toBeLessThan(140);
 await page.getByRole('button',{name:'Connect project'}).click();await expect(card).toContainText('Fixture project');await expect(card).toContainText('feature/ui');
 await expect(card.getByText('Unknown',{exact:true})).toHaveCount(0);await expect(card.getByRole('button',{name:'Commit',exact:true})).toBeHidden();
 await card.getByText('Project tools',{exact:true}).click();await expect(card.getByRole('button',{name:'Commit',exact:true})).toBeVisible();
 await card.getByRole('button',{name:'Changes',exact:false}).click();await expect(page.getByRole('status')).toHaveText('Changes opened');
});
