import {test,expect} from '@playwright/test';
const fixture='/@fs/'+process.cwd().replaceAll('\\','/')+'/tests/e2e/frontend-refinement-fixture.tsx';
test.beforeEach(async({page})=>{
 await page.route('**/frontend-refinement-check',route=>route.fulfill({contentType:'text/html',body:`<html data-theme="dark"><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${encodeURI(fixture)}');</script></body></html>`}));
 await page.goto('/frontend-refinement-check');await expect(page.getByRole('scrollbar',{name:'Scroll conversation'})).toBeVisible();
});
test('left ticked scrollbar supports keys, track clicks, dragging, and history during updates',async({page})=>{
 const scroll=page.getByLabel('Fixture conversation'),bar=page.getByRole('scrollbar',{name:'Scroll conversation'});
 const bounds=await bar.boundingBox(),content=await scroll.boundingBox();expect(bounds!.x).toBeLessThan(content!.x+24);
 expect(await scroll.evaluate(node=>getComputedStyle(node).scrollbarWidth)).toBe('none');
 await bar.focus();await page.keyboard.press('Home');await expect.poll(()=>scroll.evaluate(node=>node.scrollTop)).toBe(0);
 await page.keyboard.press('PageDown');await expect.poll(()=>scroll.evaluate(node=>node.scrollTop)).toBeGreaterThan(50);
 const saved=await scroll.evaluate(node=>node.scrollTop);await page.getByRole('button',{name:'Grow transcript'}).click();
 await expect.poll(()=>scroll.evaluate(node=>node.scrollTop)).toBe(saved);
 await bar.click({position:{x:12,y:bounds!.height*.7}});await expect.poll(()=>scroll.evaluate(node=>node.scrollTop)).toBeGreaterThan(saved);
 const thumb=await page.locator('.chat-scroll-thumb').boundingBox();const beforeDrag=await scroll.evaluate(node=>node.scrollTop);await page.mouse.move(thumb!.x+3,thumb!.y+3);await page.mouse.down();expect(await scroll.evaluate(node=>node.scrollTop)).toBeCloseTo(beforeDrag,0);await page.mouse.move(thumb!.x+3,bounds!.y+20,{steps:8});await page.mouse.up();
 await expect.poll(()=>scroll.evaluate(node=>node.scrollTop)).toBeLessThan(100);
 await bar.focus();await page.keyboard.press('End');await expect.poll(()=>scroll.evaluate(node=>node.scrollHeight-node.clientHeight-node.scrollTop)).toBeLessThan(2);
 await page.getByRole('textbox',{name:'Outside draft'}).fill('Keep this draft');await page.getByRole('button',{name:'Grow transcript'}).click();await expect(page.getByRole('textbox',{name:'Outside draft'})).toHaveValue('Keep this draft');
});
test('disconnected context is compact and connected context leads with useful project facts',async({page})=>{
 const card=page.getByLabel('Project context',{exact:true});await expect(card).toContainText('Fixture project');
 await expect(card.getByRole('button',{name:'Connect project'})).toBeVisible();expect((await card.boundingBox())!.height).toBeLessThan(140);
 await page.getByRole('button',{name:'Connect project'}).click();await expect(card).toContainText('Fixture project');await expect(card).toContainText('feature/ui');
 await expect(card.getByText('Unknown',{exact:true})).toHaveCount(0);await expect(card.getByRole('button',{name:'Commit',exact:true})).toBeHidden();
 await card.getByText('Project tools',{exact:true}).click();await expect(card.getByRole('button',{name:'Commit',exact:true})).toBeVisible();
 await card.getByRole('button',{name:'Changes',exact:false}).click();await expect(page.getByRole('status')).toHaveText('Changes opened');
});
