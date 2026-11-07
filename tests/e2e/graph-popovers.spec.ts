import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{await page.route('**/*',route=>{const url=new URL(route.request().url());return url.origin==='http://127.0.0.1:5806'&&!url.pathname.startsWith('/api/')?route.continue():route.abort();});await page.goto('/tests/e2e/fixtures/graph-popovers.html');await expect(page.getByRole('button',{name:'Map modules',exact:true})).toBeVisible();});
test('graph details stay owned by their modal and Escape leaves the diagram open',async({page})=>{
 await page.getByRole('button',{name:'Open diagram',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Diagram details',exact:true}),node=dialog.getByRole('button',{name:'Review dependencies',exact:true});await node.focus();const tooltip=dialog.getByRole('tooltip');await expect(tooltip).toContainText('export function total');await expect(tooltip).toHaveClass(/ui-popover/);await node.press('Escape');await expect(tooltip).toHaveCount(0);await expect(dialog).toBeVisible();await expect(node).toBeFocused();
});
test('IME Escape cannot dismiss graph details or change the source selection',async({page})=>{
 const node=page.getByRole('button',{name:'Map modules',exact:true});await node.focus();await expect(page.getByRole('tooltip')).toBeVisible();await node.dispatchEvent('keydown',{key:'Escape',isComposing:true});await expect(page.getByRole('tooltip')).toBeVisible();await node.dispatchEvent('keydown',{key:'Escape',keyCode:229});await expect(page.getByRole('tooltip')).toBeVisible();await expect(node).toHaveAttribute('aria-pressed','false');await node.press('Escape');await expect(page.getByRole('tooltip')).toHaveCount(0);
});
test('graph hover observes the shared dwell and check details also use the shared popover',async({page})=>{
 const node=page.getByRole('button',{name:'Map modules',exact:true});await node.hover();await expect(page.getByRole('tooltip')).toHaveCount(0);await expect(page.getByRole('tooltip')).toBeVisible();await page.getByRole('button',{name:'Outside graph',exact:true}).hover();await expect(page.getByRole('tooltip')).toHaveCount(0);await page.locator('.task-graph-check').focus();await expect(page.getByRole('tooltip')).toContainText('The supplied type check passed.');await expect(page.getByRole('tooltip')).toHaveClass(/ui-popover/);
});

test('graph details follow a reordered moving anchor without changing selection or supplied content',async({page})=>{
 const node=page.getByRole('button',{name:'Map modules',exact:true});await node.focus();const tooltip=page.getByRole('tooltip');await expect(tooltip).toBeVisible();const before=(await node.boundingBox())!.y;
 await page.evaluate(()=>(window as unknown as {graphFixture:{reorder:()=>void}}).graphFixture.reorder());await expect.poll(async()=>(await node.boundingBox())!.y-before).toBeGreaterThan(45);
 await expect.poll(async()=>Math.abs((await tooltip.boundingBox())!.y-((await node.boundingBox())!.y+(await node.boundingBox())!.height+8))).toBeLessThan(2);
 await expect(node).toBeFocused();await expect(node).toHaveAttribute('aria-pressed','false');await expect(tooltip).toContainText('Source modules and imports');
});

test('pointer transfer stays readable and selection retains the exact source value',async({page})=>{
 const node=page.getByRole('button',{name:'Map modules',exact:true});await node.hover();const tooltip=page.getByRole('tooltip');await expect(tooltip).toBeVisible();await tooltip.hover();await expect(tooltip).toBeVisible();await page.getByRole('button',{name:'Outside graph',exact:true}).hover();await expect(tooltip).toHaveCount(0);
 await page.getByRole('button',{name:'Review dependencies',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as unknown as {graphFixture:{store:{get:(path:string)=>unknown}}}).graphFixture.store.get('/values/selection'))).toBe('worker');
 expect(await page.evaluate(()=>{const fixture=(window as unknown as {graphFixture:{store:{get:(path:string)=>unknown};graph:unknown}}).graphFixture;return JSON.stringify(fixture.store.get('/inputs/network'))===JSON.stringify(fixture.graph);})).toBe(true);
});

for(const theme of ['dark','light'] as const)for(const zoom of [1,1.25,1.5])test(`${theme} graph details stay below title chrome at ${zoom*100}% CSS zoom in a short window`,async({page},testInfo)=>{
 await page.setViewportSize({width:390,height:360});await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(({theme,zoom})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.zoom=String(zoom);},{theme,zoom});
 await page.getByRole('button',{name:'Map modules',exact:true}).focus();const tooltip=page.getByRole('tooltip');await expect(tooltip).toBeVisible();const box=(await tooltip.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(7);expect(box.y).toBeGreaterThanOrEqual(49);expect(box.x+box.width).toBeLessThanOrEqual(383);expect(box.y+box.height).toBeLessThanOrEqual(353);
 await expect(tooltip).toContainText('Source modules and imports');await page.screenshot({path:testInfo.outputPath('graph-popup.png')});
});

test('a hidden or inert graph owner cannot leave its hovered details exposed',async({page})=>{
 const node=page.getByRole('button',{name:'Map modules',exact:true});await node.hover();const tooltip=page.getByRole('tooltip');await expect(tooltip).toBeVisible();await tooltip.hover();await page.locator('.task-graph').evaluate(owner=>owner.setAttribute('inert',''));await expect(tooltip).toHaveCount(0);
 await page.locator('.task-graph').evaluate(owner=>owner.removeAttribute('inert'));await node.focus();await expect(tooltip).toBeVisible();await page.locator('.task-graph').evaluate(owner=>owner.setAttribute('aria-hidden','true'));await expect(tooltip).toHaveCount(0);
});

test('graph tooltip motion uses the approved enter and inert exit states',async({page})=>{
 const node=page.getByRole('button',{name:'Map modules',exact:true});await node.focus();const tooltip=page.getByRole('tooltip');await expect(tooltip).toBeVisible();expect(await tooltip.evaluate(element=>getComputedStyle(element).animationDuration)).toBe('0.16s');await node.press('Escape');const leaving=page.locator('.task-node-popover');await expect(leaving).toHaveAttribute('data-state','closed');await expect(leaving).toHaveAttribute('aria-hidden','true');await expect(leaving).toHaveAttribute('inert','');await expect(page.getByRole('tooltip')).toHaveCount(0);await expect(leaving).toHaveCount(0);
});

test('a hidden owner cancels a pending graph hover before its dwell can expose details',async({page})=>{
 await page.getByRole('button',{name:'Map modules',exact:true}).hover();const flashed=await page.evaluate(async()=>{document.querySelector('.task-graph')!.setAttribute('aria-hidden','true');const start=performance.now();let exposed=false;while(performance.now()-start<650){await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));const element=document.querySelector<HTMLElement>('.task-node-popover');if(element){const style=getComputedStyle(element),box=element.getBoundingClientRect();if(box.width>0&&box.height>0&&style.visibility!=='hidden'&&Number(style.opacity)>0)exposed=true;}}return exposed;});expect(flashed).toBe(false);await expect(page.getByRole('tooltip')).toHaveCount(0);
});

for(const policy of ['off','reduced'])test(`graph hover respects the application's ${policy} motion preference`,async({page})=>{
 await page.evaluate(policy=>document.documentElement.dataset.motion=policy,policy);const node=page.getByRole('button',{name:'Map modules',exact:true});await node.focus();const tooltip=page.getByRole('tooltip');await expect(tooltip).toBeVisible();expect(await tooltip.evaluate(element=>getComputedStyle(element).animationName)).toBe('none');await node.press('Escape');await expect(page.locator('.task-node-popover')).toHaveCount(0);
});
