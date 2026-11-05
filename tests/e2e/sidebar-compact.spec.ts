import {test,expect} from '@playwright/test';
import {resolve} from 'node:path';
const fixture='/@fs/'+encodeURI(resolve(import.meta.dirname,'sidebar-compact-fixture.tsx').replaceAll('\\','/'));
test.beforeEach(async({page})=>{
 await page.route('**/sidebar-compact-check*',route=>route.fulfill({contentType:'text/html',body:`<html><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${fixture}');</script></body></html>`}));
 await page.goto('/sidebar-compact-check');
 await expect(page.getByRole('complementary',{name:'Thread navigation'})).toBeVisible();
});
test('compact rows show project monogram chip, readable title and metadata, and preserve detail access',async({page})=>{
 const searchBox=await page.getByRole('textbox',{name:'Search threads',exact:true}).boundingBox();
 const filterBox=await page.getByRole('button',{name:'Filter threads',exact:true}).boundingBox();
 const newThreadBox=await page.getByRole('button',{name:'New thread',exact:true}).boundingBox();
 expect(Math.abs(searchBox!.y-filterBox!.y)).toBeLessThanOrEqual(4);
 expect(Math.abs(searchBox!.y-newThreadBox!.y)).toBeLessThanOrEqual(4);

 const row=page.locator('.sidebar-thread-row').first(),item=row.locator('.thread-item');
 await expect(item.locator(':scope > :first-child')).toHaveClass('thread-item-header');
 await expect(item.locator('.thread-project-monogram')).toHaveText('EP');
 await expect(item.locator('.thread-project-label')).toHaveText('Example project');
 await expect(item.locator('.thread-branch-meta')).toContainText('feature/compact-sidebar');
 expect((await row.boundingBox())!.height).toBeLessThanOrEqual(74);
 expect((await page.locator('.sidebar-thread-row').nth(3).boundingBox())!.height).toBeLessThanOrEqual(58);
 expect(await item.evaluate(node=>getComputedStyle(node).borderLeftWidth)).toBe('0px');
 expect(await item.locator('.thread-item-title').evaluate(node=>parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(13);
 expect(await item.locator('.thread-item-meta').evaluate(node=>parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(11.5);
 await expect(item).toHaveAttribute('title',/feature\/compact-sidebar.*openai\/gpt-6.1-sol/);
 await row.getByRole('button',{name:/Options for/}).focus();
 await page.keyboard.press('Enter');
 await page.getByRole('button',{name:'Pin thread',exact:true}).click();
 expect(await page.evaluate(()=>(window as unknown as {sidebarCompactCalls:string[]}).sidebarCompactCalls)).toContain('presentation:{"pinned":true}');
});
test('footer invokes supplied actions and the single updater while plug-in navigation survives',async({page})=>{
 await expect(page.locator('.sidebar-footer button')).toHaveCount(4);
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Pull requests',exact:true}).click();
 await page.getByRole('button',{name:'Usage',exact:true}).click();
 await page.getByRole('button',{name:'Update',exact:true}).click();
 await page.getByRole('navigation',{name:'Installed plug-ins'}).getByRole('button').click();
 expect(await page.evaluate(()=>(window as unknown as {sidebarCompactCalls:string[]}).sidebarCompactCalls)).toEqual(['settings','pull-requests','usage','update:check','plugin']);
});
test('footer falls back to its existing workspace context',async({page})=>{
 await page.goto('/sidebar-compact-check?fallback=1');
 await page.getByRole('button',{name:'Pull requests',exact:true}).click();
 await page.getByRole('button',{name:'Usage',exact:true}).click();
 expect(await page.evaluate(()=>(window as unknown as {sidebarCompactCalls:string[]}).sidebarCompactCalls)).toEqual(['workspace:linked-pull-requests','workspace:usage']);
});
test('hidden scrollbar keeps wheel and keyboard navigation usable',async({page})=>{
 const list=page.locator('.thread-list');
 expect(await list.evaluate(node=>getComputedStyle(node).scrollbarWidth)).toBe('none');
 await list.hover();await page.mouse.wheel(0,600);
 await expect.poll(()=>list.evaluate(node=>node.scrollTop)).toBeGreaterThan(100);
 await list.focus();await page.keyboard.press('End');
 await expect.poll(()=>list.evaluate(node=>node.scrollTop+node.clientHeight>=node.scrollHeight-2)).toBe(true);
 const footer=page.locator('.sidebar-footer');
 expect((await footer.boundingBox())!.y+(await footer.boundingBox())!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
});

test('ready rows show age only while working and input states remain visible',async({page})=>{
 const ready=page.locator('.sidebar-thread-row').first();
 await expect(ready.locator('.thread-item-status')).toHaveCount(0);
 await expect(ready.locator('.thread-item-meta')).toHaveText(/^(now|\d+[mhd])$/);
 await expect(ready.locator('.thread-item')).toHaveAttribute('title',/Ready/);
 await expect(page.locator('.sidebar-thread-row').nth(1).locator('.thread-item-status')).toHaveText('Working');
 await expect(page.locator('.sidebar-thread-row').nth(2).locator('.thread-item-status')).toHaveText('Your input');
});

test('detach callbacks expose no entrypoints and ordinary thread menus still work',async({page})=>{
 await page.goto('/sidebar-compact-check?navigation=1');
 await expect(page.getByRole('button',{name:/detach/i})).toHaveCount(0);
 await expect(page.locator('.brand-row .desktop-window-actions')).toHaveCount(0);
 const options=page.locator('.sidebar-thread-row').first().getByRole('button',{name:/Options for/});
 await options.click();
 await expect(page.getByRole('button',{name:/detach/i})).toHaveCount(0);
 await page.getByRole('button',{name:'Rename thread',exact:true}).click();
 await options.click();
 await page.getByRole('button',{name:'Archive thread',exact:true}).click();
 expect(await page.evaluate(()=>(window as unknown as {sidebarCompactCalls:string[]}).sidebarCompactCalls)).toEqual(['rename','archive']);
 await expect(page.getByRole('navigation',{name:'Installed plug-ins'})).toBeVisible();
});
