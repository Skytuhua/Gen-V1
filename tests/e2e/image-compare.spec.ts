import { test, expect, type Page } from '@playwright/test';
import { deflateSync, crc32 } from 'node:zlib';
import { serveTaskFixture, taskFixture } from './task-interface-fixture';

function png(width: number, height: number, rgb: [number, number, number]) {
  const chunk = (type: string, bytes: Buffer) => { const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4); length.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(Buffer.concat([name, bytes]))); return Buffer.concat([length, name, bytes, crc]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) rows[y * (width * 3 + 1) + 1 + x * 3 + c] = rgb[c];
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const bootstraps = new WeakMap<Page, Promise<void>>();
async function fixture(page: Page, differentSizes = false) {
  bootstraps.set(page, page.waitForResponse('**/api/snapshot').then(() => {}));
  const snapshot = taskFixture({ root: 'compare', elements: { compare: { type: 'ImageCompare', props: { beforeResourceId: 'before', afterResourceId: 'after', stateKey: 'comparison', title: 'Front elevation' } } } });
  snapshot.resources = ['before', 'after', 'replacement'].map(id => ({ id, threadId: 'task-thread', kind: 'file' as const, path: `C:/fixture/${id}.png`, label: `${id}.png`, writable: false, createdAt: '2026-10-30' }));
  const host = await serveTaskFixture(page, snapshot); let denied = false, delayed: Promise<void> | undefined, release = () => {}, requests = 0;
  await page.route('**/api/resources/**/content', async route => {
    requests++; const id = new URL(route.request().url()).pathname.split('/')[3];
    if (id === 'replacement') { await delayed; if (denied) return route.fulfill({ status: 403 }); }
    return route.fulfill({ contentType: 'image/png', body: png(id === 'after' && differentSizes ? 160 : 320, 200, id === 'before' ? [30, 80, 140] : [195, 115, 45]) });
  });
  return { ...host, requests: () => requests, deny() { denied = true; }, allow() { denied = false; }, hold() { delayed = new Promise<void>(resolve => { release = resolve; }); }, release() { release(); } };
}
const ready = async (page: Page) => { await bootstraps.get(page); await expect(page.locator('html')).toHaveAttribute('data-motion', /^(system|reduced|off)$/); await expect(page.getByRole('slider', { name: 'Comparison position', exact: true })).toBeEnabled(); };
test('comparison follows the pointer immediately and keeps keyboard and saved view state through reload', async ({ page }) => {
  const host = await fixture(page); await page.goto('/'); await ready(page);
  const slider = page.getByRole('slider', { name: 'Comparison position', exact: true }); await slider.focus(); await slider.press('End'); await expect(slider).toHaveValue('100'); await slider.press('Home'); await expect(slider).toHaveValue('0'); await slider.press('ArrowRight'); await expect(slider).toHaveValue('1');
  const stage = page.locator('.image-compare-stage'), bounds = (await stage.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * .3, bounds.y + bounds.height * .5); await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width * .72, bounds.y + bounds.height * .5, { steps: 3 }); await page.mouse.up();
  await expect.poll(() => host.snapshot.userStates[0].values.comparison).toMatchObject({ percent: 72, mode: 'overlay' });
  expect(await stage.evaluate(node => node.querySelector('.image-compare-before')!.getAnimations().length)).toBe(0);
  await page.getByRole('button', { name: 'Side by side', exact: true }).click(); await expect.poll(() => host.snapshot.userStates[0].values.comparison).toMatchObject({ percent: 72, mode: 'split' });
  await page.reload(); await expect(page.getByRole('button', { name: 'Side by side', exact: true })).toHaveAttribute('aria-pressed', 'true'); await page.getByRole('button', { name: 'Overlay', exact: true }).click(); await expect(slider).toHaveValue('72');
});
test('mode changes keep the same loaded images and do not distort different source aspect ratios', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const host = await fixture(page, true); await page.goto('/'); await ready(page); const before = await page.getByRole('img', { name: 'Before', exact: true }).elementHandle(); const after = await page.getByRole('img', { name: 'After', exact: true }).elementHandle(), requests = host.requests();
  await page.locator('.image-compare').screenshot({ path: testInfo.outputPath('image-compare-light-overlay.png') });
  await page.getByRole('button', { name: 'Side by side', exact: true }).click(); await page.waitForTimeout(400);
  expect(await page.getByRole('img', { name: 'Before', exact: true }).evaluate((node, prior) => node === prior, before)).toBe(true); expect(await page.getByRole('img', { name: 'After', exact: true }).evaluate((node, prior) => node === prior, after)).toBe(true); expect(host.requests()).toBe(requests);
  for (const image of await page.locator('.image-compare img').all()) expect(await image.evaluate(node => getComputedStyle(node).objectFit)).toBe('contain');
  await expect(page.getByText('Different image sizes', { exact: true })).toBeVisible();
  host.snapshot.settings.theme = 'dark'; await host.publish(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.getByRole('img', { name: 'Before', exact: true }).evaluate((node, prior) => node === prior, before)).toBe(true); expect(host.requests()).toBe(requests);
  await page.locator('.image-compare').screenshot({ path: testInfo.outputPath('image-compare-dark-split.png') });
});
test('changing either source clears prior pixels while loading and a denied replacement stays cleared until retry', async ({ page }) => {
  const host = await fixture(page); await page.goto('/'); await ready(page); host.hold(); host.deny(); host.snapshot.artifacts[0].spec!.elements.compare.props.afterResourceId = 'replacement'; host.snapshot.artifacts[0].revision++; await host.publish();
  await expect(page.locator('.image-compare').getByRole('status')).toContainText('Loading images'); await expect(page.locator('.image-compare-stage')).toHaveAttribute('data-ready', 'false'); await expect(page.getByRole('slider', { name: 'Comparison position', exact: true })).toBeDisabled();
  host.release(); await expect(page.getByRole('alert')).toContainText('After image could not be loaded'); await expect(page.locator('.image-compare img')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry images', exact: true })).toBeVisible();
  host.allow(); await page.getByRole('button', { name: 'Retry images', exact: true }).click(); await ready(page); await expect(page.getByRole('img', { name: 'After', exact: true })).toHaveAttribute('src', '/api/resources/replacement/content');
});
test('narrow and reduced-motion comparison remains keyboard operable without travelling mode effects', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' }); await fixture(page); await page.goto('/'); await ready(page);
  const slider = page.getByRole('slider', { name: 'Comparison position', exact: true }); await slider.focus(); await slider.press('ArrowRight'); await expect(slider).toHaveValue('51'); await page.getByRole('button', { name: 'Side by side', exact: true }).click();
  expect(await page.locator('.image-compare-stage').evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation.effect instanceof KeyframeEffect && animation.effect.getKeyframes().some(frame => frame.transform && frame.transform !== 'none')).length)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.image-compare').screenshot({ path: testInfo.outputPath('image-compare-narrow-split.png') });
});

test('revoking either grant or moving it to another thread clears both images without another content request', async ({ page }) => {
  const host = await fixture(page); await page.goto('/'); await ready(page); const requests = host.requests();
  host.snapshot.resources.find(resource => resource.id === 'after')!.threadId = 'other-thread'; await host.publish();
  await expect(page.getByRole('alert')).toContainText('no longer available to this thread'); await expect(page.locator('.image-compare img')).toHaveCount(0); expect(host.requests()).toBe(requests);
  host.snapshot.resources.find(resource => resource.id === 'after')!.threadId = 'task-thread'; await host.publish(); await ready(page);
  host.snapshot.resources = host.snapshot.resources.filter(resource => resource.id !== 'before'); await host.publish(); await expect(page.getByRole('alert')).toContainText('no longer available to this thread'); await expect(page.locator('.image-compare img')).toHaveCount(0);
});

for(const policy of ['off','reduced'] as const){
 test(`app ${policy} settles active image geometry without replay`,async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});await fixture(page);await page.goto('/');await ready(page);
  await page.getByRole('button',{name:'Side by side',exact:true}).click();
  const values=await page.locator('.image-compare-stage').evaluate(async(node,policy)=>{const stage=node as HTMLElement,before=stage.style.getPropertyValue('--image-compare-width');document.documentElement.dataset.motion=policy;await Promise.resolve();const after=stage.style.getPropertyValue('--image-compare-width');document.documentElement.dataset.motion='system';await Promise.resolve();return {before,after,restored:stage.style.getPropertyValue('--image-compare-width')};},policy);
  expect(values.before).not.toBe('50%');expect(values.after).toBe('50%');expect(values.restored).toBe('50%');
 });
 test(`saved ${policy} reload reaches image geometry immediately`,async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});const host=await fixture(page);await page.goto('/');await ready(page);
  await page.evaluate(async policy=>{await fetch('/api/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'saved-motion',type:'settings.update',payload:{preferences:{motion:policy}}})});},policy);
  expect(host.snapshot.settings.preferences?.motion).toBe(policy);await page.reload();await ready(page);await expect(page.locator('html')).toHaveAttribute('data-motion',policy);
  await page.getByRole('button',{name:'Side by side',exact:true}).click();expect(await page.locator('.image-compare-stage').evaluate(node=>(node as HTMLElement).style.getPropertyValue('--image-compare-width'))).toBe('50%');
  const source=await (await page.request.get('/src/SentenceReveal.tsx')).text(),main=await (await page.request.get('/src/main.tsx')).text();
  const reactPath=source.match(/["']([^"']*\/react\.js[^"']*)["']/)![1],domPath=main.match(/["']([^"']*\/react-dom_client\.js[^"']*)["']/)![1];
  const position=await page.evaluate(async({reactPath,domPath})=>{
   const react=await import(reactPath),React=react.default??react,dom=await import(domPath),revealPath='/src/SentenceReveal.tsx',scrollPath='/src/conversation-scroll.ts';
   const {SentenceReveal}=await import(revealPath),{createConversationScroll}=await import(scrollPath);
   const scroll=document.createElement('div'),body=document.createElement('div');scroll.style.cssText='height:100px;overflow:auto';body.style.height='500px';scroll.append(body);document.body.append(scroll);
   const controller=createConversationScroll(scroll);controller.update('saved',{top:0,tail:true});body.style.height='1000px';controller.update('saved',{top:400,tail:true});const followed=scroll.scrollTop;controller.scrollTo(100);controller.jump();const jumped=scroll.scrollTop;controller.dispose();scroll.remove();
   const host=document.createElement('div');host.className='saved-policy-prose';document.body.append(host);const root=(dom.createRoot??dom.default.createRoot)(host),animations:unknown[]=[];const animate=Element.prototype.animate;
   Element.prototype.animate=function(frames,options){if(this.classList.contains('sentence-reveal-veil'))animations.push(frames);return animate.call(this,frames,options);};
   root.render(React.createElement(SentenceReveal,{text:'Fresh prose after a saved preference reload.',animate:true,initialReveal:true},'Fresh prose after a saved preference reload.'));
   Object.assign(window,{savedProseAnimations:animations,unmountSavedProse:()=>{root.unmount();host.remove();Element.prototype.animate=animate;}});return {followed,jumped};
  },{reactPath,domPath});
  expect(position).toEqual({followed:900,jumped:900});await expect(page.locator('.saved-policy-prose')).toHaveText('Fresh prose after a saved preference reload.');
  expect(await page.locator('.saved-policy-prose [data-reveal-start]').count()).toBe(0);expect(await page.evaluate(()=>(window as unknown as {savedProseAnimations:unknown[]}).savedProseAnimations.length)).toBe(0);
  await page.evaluate(()=>(window as unknown as {unmountSavedProse:()=>void}).unmountSavedProse());
 });
}

test('System follows a live OS reduction without replaying image geometry',async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});await fixture(page);await page.goto('/');await ready(page);await page.getByRole('button',{name:'Side by side',exact:true}).click();
 await page.emulateMedia({reducedMotion:'reduce'});await expect.poll(()=>page.locator('.image-compare-stage').evaluate(node=>(node as HTMLElement).style.getPropertyValue('--image-compare-width'))).toBe('50%');
 await page.emulateMedia({reducedMotion:'no-preference'});expect(await page.locator('.image-compare-stage').evaluate(node=>(node as HTMLElement).style.getPropertyValue('--image-compare-width'))).toBe('50%');
});
