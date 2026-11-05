import {test,expect,type Page} from '@playwright/test';
import {resolve} from 'node:path';

const fixture='/@fs/'+resolve('tests/e2e/right-tools-fixture.tsx').replaceAll('\\','/');
const events=(page:Page)=>page.evaluate(()=>(window as unknown as Window&{rightToolEvents:{closed:number;detached:number}}).rightToolEvents);
test.beforeEach(async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await page.emulateMedia({reducedMotion:'reduce'});
 await page.route('**/right-tools-check*',route=>route.fulfill({contentType:'text/html',body:`<html data-theme="dark"><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${fixture}');</script></html>`}));
});
test('minimize-only context exposes one action and keeps its editor mounted',async({page})=>{
 await page.goto('/right-tools-check');const panel=page.getByRole('region',{name:'Project context window',exact:true}),draft=page.getByRole('textbox',{name:'Context draft'}),identity=await draft.elementHandle();
 await draft.fill('Preserve this edit');await expect(panel.getByRole('button')).toHaveCount(1);
 await expect(panel.getByRole('button',{name:/Close|Reset|Detach|Move|Resize/})).toHaveCount(0);
 const before=(await panel.boundingBox())!,title=panel.locator('.floating-window-title');
 await panel.dispatchEvent('keydown',{key:'ArrowLeft',bubbles:true});await panel.dispatchEvent('keydown',{key:'ArrowDown',shiftKey:true,bubbles:true});
 const titleBox=(await title.boundingBox())!;await page.mouse.move(titleBox.x+10,titleBox.y+10);await page.mouse.down();await page.mouse.move(titleBox.x-100,titleBox.y+60);await page.mouse.up();
 const after=(await panel.boundingBox())!;expect(Math.round(after.x)).toBe(Math.round(before.x));expect(Math.round(after.y)).toBe(Math.round(before.y));expect(Math.round(after.width)).toBe(Math.round(before.width));expect(Math.round(after.height)).toBe(Math.round(before.height));
 await panel.getByRole('button',{name:'Minimize Project context',exact:true}).click();await expect(draft).toBeHidden();await expect(panel.locator('.floating-window-body')).toHaveAttribute('inert','');
 await panel.getByRole('button',{name:'Expand Project context',exact:true}).click();expect(await draft.evaluate((node,old)=>node===old,identity)).toBe(true);await expect(draft).toHaveValue('Preserve this edit');
 await panel.dispatchEvent('keydown',{key:'Escape',bubbles:true});await expect(panel).toHaveAttribute('data-collapsed','true');await panel.dispatchEvent('keydown',{key:'Escape',bubbles:true});await expect(panel).toBeVisible();expect(await events(page)).toEqual({closed:0,detached:0});
});
test('generic floating windows ignore a supplied detach callback even outside the app',async({page})=>{
 await page.goto('/right-tools-check?mode=generic');const panel=page.getByRole('region',{name:'Project context window',exact:true});
 await expect(panel.getByRole('button',{name:'Detach Project context',exact:true})).toHaveCount(0);
 const handle=panel.getByRole('button',{name:'Move Project context',exact:true}),box=(await handle.boundingBox())!;
 await page.mouse.move(box.x+20,box.y+12);await page.mouse.down();await page.mouse.move(1460,200);await expect(page.getByText('Release to open in a window',{exact:true})).toHaveCount(0);await page.mouse.up();
 expect((await events(page)).detached).toBe(0);await expect(panel.getByRole('textbox',{name:'Context draft'})).toHaveValue('Keep context edits');
 await panel.getByRole('button',{name:'Close Project context',exact:true}).click();expect((await events(page)).closed).toBe(1);
});
test('minimize-only context restores collapse state while retiring old free-window geometry',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('harness:floating:right-context:v1',JSON.stringify({x:420,y:350,width:600,height:800,collapsed:true,floating:true})));
 await page.goto('/right-tools-check');const panel=page.getByRole('region',{name:'Project context window',exact:true});
 await expect(panel).toHaveAttribute('data-collapsed','true');await expect(panel).toHaveAttribute('data-floating','false');await expect(panel).toHaveAttribute('data-axis','none');
 const bounds=(await panel.boundingBox())!;expect(bounds.width).toBeLessThanOrEqual(376);expect(bounds.x).toBeGreaterThan(1000);
 await panel.getByRole('button',{name:'Expand Project context',exact:true}).click();await expect(panel.getByRole('textbox',{name:'Context draft'})).toHaveValue('Keep context edits');
});
test('live usage starts compact and visible despite an old dismissed preference',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('harness:usage-floating-open','false'));await page.goto('/right-tools-check?mode=usage');const panel=page.getByRole('region',{name:'Live usage',exact:true});
 await expect(panel).toBeVisible();await expect(panel).toHaveAttribute('data-collapsed','true');await expect(panel).toContainText('18%');expect((await panel.boundingBox())!.width).toBeLessThanOrEqual(320);
 await expect(page.getByRole('button',{name:'Show live usage',exact:true})).toHaveCount(0);await expect(panel.getByRole('button')).toHaveCount(1);
 await panel.getByRole('button',{name:'Inspect live usage',exact:true}).click();await expect(panel).toContainText('18% used');
 const details=panel.locator('details');await expect(details).not.toHaveAttribute('open','');await expect(panel.getByText('Reported cost',{exact:true})).toBeHidden();
 await details.locator('summary').click();await expect(panel.getByText('12.6K',{exact:true})).toBeVisible();await expect(panel.getByText('820',{exact:true})).toBeVisible();await expect(panel.getByText('$0.0123',{exact:true})).toBeVisible();await expect(panel.getByText('25%',{exact:true})).toBeVisible();await expect(panel.getByText('55%',{exact:true})).toBeVisible();
 await panel.getByRole('button',{name:'Minimize live usage',exact:true}).click();await expect(panel).toHaveAttribute('data-collapsed','true');await expect(panel).toBeVisible();
});
test('unavailable secondary usage stays in Details and the visibility preference still works',async({page})=>{
 await page.goto('/right-tools-check?mode=usage&unknown=1');const panel=page.getByRole('region',{name:'Live usage',exact:true});
 await panel.getByRole('button',{name:'Inspect live usage',exact:true}).click();await expect(panel.getByText('Unavailable',{exact:true}).first()).toBeHidden();
 await expect(panel.getByText(/runtime-reported|API billing|account quotas|unless reported/i)).toHaveCount(0);
 await page.getByRole('button',{name:'Toggle usage preference'}).click();await expect(panel).toHaveCount(0);await page.getByRole('button',{name:'Toggle usage preference'}).click();await expect(panel).toBeVisible();
});
