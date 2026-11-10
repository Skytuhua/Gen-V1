import {test,expect} from '@playwright/test';
import {resolve} from 'node:path';
const fixture='/@fs/'+resolve('tests/e2e/context-compact-fixture.tsx').replaceAll('\\','/');
test.beforeEach(async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.route('**/context-compact-check*',route=>route.fulfill({contentType:'text/html',body:`<html data-theme="dark"><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${encodeURI(fixture)}');</script></body></html>`}));
});
for(const width of [1440,390])test(`context popup is compact and keeps actual values at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:844});await page.goto('/context-compact-check');await page.getByRole('button',{name:'Inspect context usage'}).click();
 const popup=page.getByRole('dialog',{name:'Context inspector'});await expect(popup).toBeVisible();
 const bounds=(await popup.boundingBox())!;expect(bounds.width).toBeLessThanOrEqual(320);expect(bounds.height).toBeLessThan(260);expect(bounds.x).toBeGreaterThanOrEqual(12);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width-12);
 await expect(popup.getByRole('button',{name:'Close context inspector'})).toHaveCount(0);
 await expect(popup).toContainText('8K of 272K');await expect(popup).toContainText('3%');await expect(popup).toContainText('Unavailable');await expect(popup).toContainText('62%');
 await expect(popup.getByText('Category breakdown unavailable',{exact:true})).toBeHidden();
 await popup.getByText('Usage details',{exact:true}).click();await expect(popup).toContainText('7.9K');await expect(popup).toContainText('100');
 await expect(popup).not.toContainText('Reported by the runtime. Provider reset times and quota breakdowns are unavailable.');
 expect(await popup.evaluate(node=>getComputedStyle(node).scrollbarWidth)).toBe('none');
});
test('context popup closes through Escape, outside click and its toggle without an X',async({page})=>{
 await page.goto('/context-compact-check');const toggle=page.getByRole('button',{name:'Inspect context usage'}),popup=page.getByRole('dialog',{name:'Context inspector'});
 await toggle.click();await popup.getByText('Usage details',{exact:true}).focus();await page.keyboard.press('Escape');await expect(popup).toHaveCount(0);await expect(toggle).toBeFocused();
 await toggle.click();await page.getByRole('button',{name:'Outside action'}).click();await expect(popup).toHaveCount(0);
 await toggle.click();await toggle.click();await expect(popup).toHaveCount(0);
});
test('unsupported compaction remains disabled and sends no command',async({page})=>{
 const commands:unknown[]=[];await page.route('**/api/commands',route=>{commands.push(route.request().postDataJSON());return route.fulfill({json:{commandId:'fixture',seq:1,result:{}}});});
 await page.goto('/context-compact-check?unavailable=1');await page.getByRole('button',{name:'Inspect context usage'}).click();const compact=page.getByRole('button',{name:'Compact now',exact:true});
 await expect(compact).toBeDisabled();await expect(compact).toHaveAttribute('title',/Gemini.*does not support/);await compact.evaluate(node=>(node as HTMLButtonElement).click());expect(commands).toEqual([]);
});
test('available compaction keeps its existing owning-thread command',async({page})=>{
 const commands:{type:string;threadId?:string}[]=[];await page.route('**/api/commands',route=>{commands.push(route.request().postDataJSON());return route.fulfill({json:{commandId:'fixture',seq:1,result:{}}});});
 await page.goto('/context-compact-check');await page.getByRole('button',{name:'Inspect context usage'}).click();await page.getByRole('button',{name:'Compact now',exact:true}).click();
 await expect.poll(()=>commands.map(value=>[value.type,value.threadId])).toEqual([['run.compact','owning-thread']]);
});
