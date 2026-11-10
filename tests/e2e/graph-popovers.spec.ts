import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{await page.route('**/*',route=>{const url=new URL(route.request().url());return url.origin==='http://127.0.0.1:5806'&&!url.pathname.startsWith('/api/')?route.continue():route.abort();});await page.goto('/tests/e2e/fixtures/graph-popovers.html');await expect(page.getByRole('button',{name:'Map modules',exact:true})).toBeVisible();});
test('graph details stay owned by their modal and Escape leaves the diagram open',async({page})=>{
 await page.getByRole('button',{name:'Open diagram',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Diagram details',exact:true}),node=dialog.getByRole('button',{name:'Review dependencies',exact:true});await node.focus();const tooltip=dialog.getByRole('tooltip');await expect(tooltip).toContainText('export function total');await expect(tooltip).toHaveClass(/ui-popover/);await node.press('Escape');await expect(tooltip).toHaveCount(0);await expect(dialog).toBeVisible();await expect(node).toBeFocused();
});

for (const width of [768, 1024, 1440]) for (const overflowing of [false, true]) {
 test(`graph dialog reserves its footer throughout entry at ${width}px${overflowing ? ' with a scrolling body' : ''}`, async ({page}, testInfo) => {
  await page.setViewportSize({width, height:overflowing ? 480 : 1024});
  if (overflowing) await page.evaluate(() => {
   const {store, graph} = (window as unknown as {graphFixture:{store:{set:(path:string,value:unknown)=>void};graph:{nodes:{id:string;label:string}[]}}}).graphFixture;
   store.set('/inputs/network', {...graph, nodes:[...graph.nodes, ...Array.from({length:20}, (_, index) => ({id:`extra-${index}`, label:`Additional source ${index + 1}`}))], summary:{label:'Review the dependency findings', status:'pending', detail:'Review the supplied source relationships before continuing with the dependency findings.'}});
  });
  // Observe the open attribute before the first paint, then every animation
  // frame. Waiting for visibility alone can miss the initial zero-height footer.
  const frames = await page.evaluate(() => new Promise<{reserved:number;summaryGap:number;sourceGap:number;actionGap:number;visibleTop:number;visibleBottom:number;bodyGap:number;footerTop:number}[]>(resolve => {
   const samples:{reserved:number;summaryGap:number;sourceGap:number;actionGap:number;visibleTop:number;visibleBottom:number;bodyGap:number;footerTop:number}[] = [];
   const sample = (dialog:HTMLDialogElement) => {
    const footer = dialog.querySelector<HTMLElement>('.task-graph-footer')!.getBoundingClientRect();
    const summary = dialog.querySelector<HTMLElement>('.task-graph-summary')!.getBoundingClientRect();
    const checks = dialog.querySelector<HTMLElement>('.task-graph-checks')!.getBoundingClientRect();
    const action = dialog.querySelector<HTMLElement>('.task-graph-footer-actions button')!.getBoundingClientRect();
    const source = dialog.querySelector<HTMLElement>('.task-graph-relationships summary')!.getBoundingClientRect();
    const body = dialog.querySelector<HTMLElement>('.task-graph-viewport')!.getBoundingClientRect();
    const bounds = dialog.getBoundingClientRect();
    const text = document.createRange(); text.selectNodeContents(dialog.querySelector('.task-graph-summary > span')!);
    const summaryText = text.getBoundingClientRect();
    samples.push({reserved:footer.bottom-Math.max(summary.bottom, action.bottom, checks.bottom, summaryText.bottom), summaryGap:summary.top-checks.bottom, sourceGap:source.top-footer.bottom, actionGap:action.left-Math.max(summary.right, summaryText.right), visibleTop:Math.min(footer.top, checks.top, summary.top, action.top)-bounds.top, visibleBottom:bounds.bottom-Math.max(footer.bottom, source.bottom), bodyGap:footer.top-body.bottom, footerTop:footer.top});
   };
   const observer = new MutationObserver(() => {
    const dialog = document.querySelector<HTMLDialogElement>('dialog[open]');
    if (!dialog) return;
    observer.disconnect(); sample(dialog);
    const started = performance.now();
    const tick = () => {sample(dialog); if (performance.now()-started < 700) requestAnimationFrame(tick); else resolve(samples);};
    requestAnimationFrame(tick);
   });
   observer.observe(document.body, {subtree:true, childList:true, attributes:true, attributeFilter:['open']});
   (Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Open diagram')!).click();
  }));
  expect(frames.length).toBeGreaterThan(2);
  for (const [index, frame] of frames.entries()) {
   for (const key of ['reserved', 'summaryGap', 'sourceGap', 'actionGap', 'visibleTop', 'visibleBottom', 'bodyGap'] as const) expect(frame[key], `${key} at entry frame ${index}`).toBeGreaterThanOrEqual(-1);
   expect(frame.footerTop, `footer position at entry frame ${index}`).toBeCloseTo(frames[0].footerTop, 0);
  }
  const dialog = page.getByRole('dialog', {name:'Diagram details', exact:true});
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.y).toBeGreaterThanOrEqual(42);
  expect(bounds.y+bounds.height).toBeLessThanOrEqual((overflowing ? 480 : 1024)-8);
  if (overflowing) {
   const body = dialog.locator('.task-graph-viewport');
   expect(await body.evaluate(element => element.scrollHeight-element.clientHeight)).toBeGreaterThan(0);
   await body.evaluate(element => {element.scrollTop=element.scrollHeight;});
   expect(await body.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
   await expect(dialog.getByRole('button', {name:'Additional source 20', exact:true})).toBeInViewport();
  }
  const close = dialog.getByRole('button', {name:'Close dialog', exact:true});
  await expect(close).toBeFocused();
  // Tab into the graph, then Shift+Tab back to verify Close is reachable.
  // Continue forward through every graph node and footer control to Inspect source.
  const graphArea = dialog.locator('.task-graph-viewport');
  const nodeLabels = ['Map modules', 'Review dependencies', 'Review findings', ...(overflowing ? Array.from({length:20}, (_, index) => `Additional source ${index + 1}`) : [])];
  const tabOrder = [graphArea, close, graphArea, ...nodeLabels.map(name => dialog.getByRole('button', {name, exact:true})), dialog.locator('.task-graph-check'), dialog.getByRole('button', {name:'Inspect 1 conflicts', exact:true}), dialog.getByRole('button', {name:'Continue review', exact:true}), dialog.locator('.task-graph-relationships summary')];
  for (const action of tabOrder) {
   await page.keyboard.press(action === close ? 'Shift+Tab' : 'Tab'); await expect(action).toBeFocused();
   await expect(action).toBeInViewport();
   expect(await action.evaluate(element => element.matches(':focus-visible') && getComputedStyle(element).outlineStyle !== 'none' && Number.parseFloat(getComputedStyle(element).outlineWidth) > 0)).toBe(true);
  }
  await page.screenshot({path:testInfo.outputPath('graph-dialog.png')});
 });
}
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
