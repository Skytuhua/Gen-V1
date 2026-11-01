import { test, expect, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { createSigningPdfFixture } from './document-preview-fixture';
import { serveTaskFixture, taskFixture, type TaskSpec } from './task-interface-fixture';

const spec: TaskSpec = { root: 'pair', elements: {
  pair: { type: 'Split', props: { ratio: .5 }, children: ['pdf', 'steps'] },
  pdf: { type: 'DocumentPreview', props: { resourceId: 'pdf', title: 'Agreement.pdf', activeFieldStateKey: 'field', fieldStateKeys: { Name: 'name', Title: 'title', Email: 'email' }, signatureStateKey: 'signature', signatureBox: { page: 1, x: 76, y: 214, width: 300, height: 60 } } },
  steps: { type: 'Steps', props: { stateKey: 'field', steps: [{ key: 'name', label: 'Name' }, { key: 'title', label: 'Title' }, { key: 'email', label: 'Email' }, { key: 'signature', label: 'Signature' }, { key: 'review', label: 'Review' }] }, children: ['name', 'title', 'email', 'signature', 'review'] },
  name: { type: 'Input', props: { stateKey: 'name', label: 'Name' } },
  title: { type: 'Input', props: { stateKey: 'title', label: 'Title' } },
  email: { type: 'Input', props: { stateKey: 'email', label: 'Email' } },
  signature: { type: 'SignaturePad', props: { stateKey: 'signature', label: 'Signature', initialMode: 'type' } },
  review: { type: 'Text', props: { text: 'Review the whole page.' } },
} };
type PanWrite = { time: number; top: number; left: number };
async function fixture(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const source = await createSigningPdfFixture({ pages: 1 });
  const sourceDocument = await PDFDocument.load(source), email = sourceDocument.getForm().getTextField('Email').acroField.getWidgets()[0].getRectangle();
  const snapshot = taskFixture(structuredClone(spec), {}, { field: 'name', name: 'Alex Morgan', title: 'Designer', email: 'alex@studio.example' });
  // Expanded previews retain manual viewport control as well as auto focus.
  snapshot.artifacts[0].placement = 'expanded';
  snapshot.resources = [{ id: 'pdf', threadId: 'task-thread', kind: 'file', path: 'C:/fixture/agreement.pdf', label: 'Agreement.pdf', writable: false, createdAt: '2026-10-30' }];
  const host = await serveTaskFixture(page, snapshot);
  let fetches = 0;
  await page.route('**/api/resources/pdf/content', route => { fetches++; return route.fulfill({ contentType: 'application/pdf', body: Buffer.from(source) }); });
  await page.addInitScript(() => {
    const native = Element.prototype.scrollTo;
    Object.assign(window, { pdfPanWrites: [] });
    Element.prototype.scrollTo = (function (this: Element, ...args: unknown[]) {
      const result = (native as (...values: unknown[]) => void).apply(this, args);
      if (this.classList.contains('document-preview-scroll')) (window as unknown as { pdfPanWrites: PanWrite[] }).pdfPanWrites.push({ time: performance.now(), top: this.scrollTop, left: this.scrollLeft });
      return result;
    }) as typeof native;
  });
  await page.goto('/');
  await expect(page.locator('.document-preview')).toHaveAttribute('data-preview-state', 'ready', { timeout: 15_000 });
  await page.waitForTimeout(800);
  const canvas = await page.locator('.document-preview canvas').elementHandle();
  return { ...host, canvas, fetches: () => fetches, emailTopFraction: (792 - email.y - email.height) / 792 };
}
const resetWrites = (page: Page) => page.evaluate(() => { (window as unknown as { pdfPanWrites: PanWrite[] }).pdfPanWrites = []; });
const writes = (page: Page) => page.evaluate(() => (window as unknown as { pdfPanWrites: PanWrite[] }).pdfPanWrites);

for(const chatWidth of ['comfortable','wide'] as const)for(const width of [1440,700,390])test(`paired inline PDF follows ${chatWidth} composer and stacks only when narrow at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:1000});
 const source=await createSigningPdfFixture({pages:1}),snapshot=taskFixture(structuredClone(spec),{},{field:'name',name:'Alex Morgan',title:'Designer',email:'alex@studio.example'});
 snapshot.settings.preferences={chatWidth};
 snapshot.resources=[{id:'pdf',threadId:'task-thread',kind:'file',path:'C:/fixture/agreement.pdf',label:'Agreement.pdf',writable:false,createdAt:'2026-10-30'}];
 await serveTaskFixture(page,snapshot);let fetches=0;
 await page.route('**/api/resources/pdf/content',route=>{fetches++;return route.fulfill({contentType:'application/pdf',body:Buffer.from(source)});});
 await page.goto('/');await expect(page.locator('.document-preview')).toHaveAttribute('data-preview-state','ready',{timeout:15000});
 const steps=page.locator('.task-steps'),content=steps.locator('.task-step-content'),navigation=steps.locator('.task-step-navigation');
 const bounds=await steps.boundingBox(),body=await content.boundingBox(),footer=await navigation.boundingBox();
 const pdf=await page.locator('.document-preview').boundingBox();
 const contentWidth=await page.locator('.surface-split').evaluate(node=>node.getBoundingClientRect().width);
 if(contentWidth>=620){expect(pdf!.x+pdf!.width).toBeLessThanOrEqual(bounds!.x);expect(Math.abs(pdf!.y-bounds!.y)).toBeLessThan(2);}
 else {expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(pdf!.y);expect(bounds!.height).toBeLessThan(220);expect(footer!.y-(body!.y+body!.height)).toBeLessThan(36);}
 const composer=await page.locator('.composer').boundingBox(),artifact=await page.locator('.artifact').boundingBox();
 expect(Math.abs(artifact!.x-composer!.x)).toBeLessThan(2);expect(Math.abs(artifact!.width-composer!.width)).toBeLessThan(2);
 expect(await page.locator('.document-preview-scroll').evaluate(node=>getComputedStyle(node).overflowY)).toBe('hidden');
 expect(pdf!.height).toBeLessThan(650);
 const canvas=await page.locator('.document-preview canvas').elementHandle();await page.getByRole('button',{name:'Go to Title',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Title',exact:true})).toBeVisible();
 expect(await page.locator('.document-preview canvas').evaluate((node,old)=>node===old,canvas)).toBe(true);expect(fetches).toBe(1);
});

test('inline field and signature navigation pans while edits retain the same frame and Fit page shows the whole page',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});
 const source=await createSigningPdfFixture({pages:1}),snapshot=taskFixture(structuredClone(spec),{},{field:'name',name:'Alex Morgan',title:'Designer',email:'alex@studio.example'});
 snapshot.resources=[{id:'pdf',threadId:'task-thread',kind:'file',path:'C:/fixture/agreement.pdf',label:'Agreement.pdf',writable:false,createdAt:'2026-10-30'}];
 const host=await serveTaskFixture(page,snapshot);let fetches=0;
 await page.route('**/api/resources/pdf/content',route=>{fetches++;return route.fulfill({contentType:'application/pdf',body:Buffer.from(source)});});
 await page.goto('/');await expect(page.locator('.document-preview')).toHaveAttribute('data-preview-state','ready',{timeout:15000});await page.waitForTimeout(750);
 const canvas=await page.locator('.document-preview canvas').elementHandle(),view=page.locator('.document-preview-scroll');
 const first=await view.evaluate(node=>node.scrollTop);
 await page.getByRole('button',{name:'Go to Email',exact:true}).click();
 await expect.poll(()=>view.evaluate(node=>node.scrollTop)).toBeGreaterThan(first+10);await page.waitForTimeout(700);
 const top=await view.evaluate(node=>node.scrollTop);
 await page.getByRole('textbox',{name:'Email',exact:true}).fill('new@example.test');
 await expect(page.locator('.document-preview')).toHaveAttribute('data-preview-state','ready',{timeout:15000});await page.waitForTimeout(500);
 expect(Math.abs(await view.evaluate(node=>node.scrollTop)-top)).toBeLessThan(1);
 await host.publish();await page.waitForTimeout(300);expect(Math.abs(await view.evaluate(node=>node.scrollTop)-top)).toBeLessThan(1);
 await page.getByRole('button',{name:'Go to Signature',exact:true}).click();await page.waitForTimeout(750);
 const mark=await page.locator('.document-active-field').boundingBox(),viewport=await view.boundingBox();
 expect(mark!.y).toBeGreaterThanOrEqual(viewport!.y);expect(mark!.y+mark!.height).toBeLessThanOrEqual(viewport!.y+viewport!.height);
 await page.getByRole('button',{name:'Fit PDF page',exact:true}).click();await page.waitForTimeout(800);
 await expect(page.locator('.document-active-field')).toHaveCount(0);
 const whole=await page.locator('.document-preview-page').boundingBox();expect(whole!.height).toBeLessThanOrEqual(viewport!.height-28);
 await page.getByRole('button',{name:'Go to Review',exact:true}).click();await page.waitForTimeout(500);
 await expect(page.locator('.document-preview')).toHaveAttribute('data-fit','page');
 expect(await page.locator('.document-preview canvas').evaluate((node,old)=>node===old,canvas)).toBe(true);expect(fetches).toBe(1);
 await page.setViewportSize({width:1440,height:720});await page.waitForTimeout(500);await view.scrollIntoViewIfNeeded();
 const chat=page.locator('.conversation-scroll');await chat.evaluate(node=>node.scrollTop=node.scrollHeight);await view.hover();
 const chatTop=await chat.evaluate(node=>node.scrollTop),pdfTop=await view.evaluate(node=>node.scrollTop);
 await page.mouse.wheel(0,-90);await expect.poll(()=>chat.evaluate(node=>node.scrollTop)).toBeLessThan(chatTop);
 expect(await view.evaluate(node=>node.scrollTop)).toBe(pdfTop);
});

test('a nearby PDF field settles promptly and stops requesting scroll work at rest', async ({ page }) => {
  await fixture(page); await resetWrites(page);
  await page.getByRole('button', { name: 'Go to Title', exact: true }).click();
  await page.waitForTimeout(500); const settled = await writes(page); expect(settled.length).toBeGreaterThan(1);
  await page.waitForTimeout(170); expect((await writes(page)).length).toBe(settled.length);
});

test('manual PDF scrolling owns the viewport through background rerender and resize until the next field choice', async ({ page }) => {
  const host = await fixture(page);
  await page.getByRole('button', { name: 'Go to Email', exact: true }).click(); await page.waitForTimeout(70);
  const view = page.locator('.document-preview-scroll'); await view.hover(); await page.mouse.wheel(0, 70);
  await resetWrites(page); await page.setViewportSize({ width: 1300, height: 1000 });
  await expect(page.locator('.document-preview')).toHaveAttribute('data-preview-state', 'ready', { timeout: 15_000 }); await page.waitForTimeout(850);
  expect(await writes(page)).toHaveLength(0);
  expect(await page.locator('.document-preview canvas').evaluate((node, old) => node === old, host.canvas)).toBe(true);
  expect(host.fetches()).toBe(1);
  await page.getByRole('button', { name: 'Go to Name', exact: true }).click();
  await expect.poll(async () => (await writes(page)).length).toBeGreaterThan(0);
});

test('manual scrolling after a zoom choice wins over its still-preparing candidate', async ({ page }) => {
  await fixture(page); await page.getByRole('button', { name: 'Zoom in PDF', exact: true }).click();
  await page.locator('.document-preview-scroll').evaluate(node => {
    node.dispatchEvent(new WheelEvent('wheel', { deltaY: 50, bubbles: true })); node.scrollTop += 50;
    (window as unknown as { pdfPanWrites: PanWrite[] }).pdfPanWrites = [];
  });
  await expect(page.locator('.document-preview')).toHaveAttribute('data-preview-state', 'ready', { timeout: 15_000 }); await page.waitForTimeout(850);
  expect(await writes(page)).toHaveLength(0);
});

test('rapid same-page choices retain one preview and move toward the latest field without a viewport jump', async ({ page }) => {
  const host = await fixture(page); await resetWrites(page);
  const observations = page.locator('.document-preview-scroll').evaluate(async node => {
    const positions: { time: number; top: number }[] = [], start = performance.now();
    while (performance.now() - start < 900) { positions.push({ time: performance.now() - start, top: node.scrollTop }); await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); }
    return positions;
  });
  await page.getByRole('button', { name: 'Go to Title', exact: true }).click(); await page.waitForTimeout(65);
  await page.getByRole('button', { name: 'Go to Email', exact: true }).click();
  const samples = await observations;
  const jumps = samples.slice(1).map((sample, index) => Math.abs(sample.top - samples[index].top));
  expect(Math.max(...jumps)).toBeLessThan(45);
  const last = samples.at(-1)!, prior = samples.find(sample => sample.time >= last.time - 100)!;
  expect(Math.abs(last.top - prior.top)).toBeLessThan(2);
  expect(await page.locator('.document-preview canvas').evaluate((node, old) => node === old, host.canvas)).toBe(true); expect(host.fetches()).toBe(1);
  await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toHaveValue('alex@studio.example');
});

test('reduced motion applies PDF focus without a travelling scroll or continuing frame loop', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await fixture(page); await resetWrites(page);
  await page.getByRole('button', { name: 'Go to Email', exact: true }).click(); await page.waitForTimeout(150);
  const accepted = await writes(page); expect(accepted.length).toBeLessThanOrEqual(1);
  await page.waitForTimeout(170); expect((await writes(page)).length).toBe(accepted.length);
  await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toBeVisible();
});

test('the focus highlight identifies the new field instead of floating through unrelated document text', async ({ page }) => {
  const host = await fixture(page);
  await page.getByRole('button', { name: 'Go to Email', exact: true }).click(); await page.waitForTimeout(80);
  const fraction = await page.locator('.document-active-field').evaluate(node => {
    const field = node.getBoundingClientRect(), page = node.parentElement!.getBoundingClientRect(); return (field.top - page.top) / page.height;
  });
  expect(Math.abs(fraction - host.emailTopFraction)).toBeLessThan(.002);
});
