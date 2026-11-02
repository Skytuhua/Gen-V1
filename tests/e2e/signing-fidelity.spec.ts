import { test, expect, type Page } from '@playwright/test';
import { createSigningPdfFixture } from './document-preview-fixture';
import { serveTaskFixture, taskFixture, type TaskSpec } from './task-interface-fixture';

const signingSpec = (fit?: 'width' | 'page'): TaskSpec => ({ root: 'pair', elements: {
  pair: { type: 'Split', props: { ratio: .5 }, children: ['pdf', 'steps'] },
  pdf: { type: 'DocumentPreview', props: { resourceId: 'agreement', title: 'Agreement.pdf', ...(fit ? { fit } : {}) } },
  steps: { type: 'Steps', props: { stateKey: 'step', steps: [{ key: 'notices', label: 'Notices' }, { key: 'signature', label: 'Signature' }] }, children: ['choices', 'signature'] },
  choices: { type: 'ChoiceList', props: { stateKey: 'email', label: 'Where should notices go?', options: [{ value: 'work@example.test', label: 'Work' }, { value: 'personal@example.test', label: 'Personal' }], custom: { label: 'Something else', placeholder: 'Your email address' } } },
  signature: { type: 'SignaturePad', props: { stateKey: 'signature', nameStateKey: 'name', label: 'Add your signature', initialMode: 'generate' } },
} });

test('canonical dark signature ink stays readable in the image-backed well in dark theme',async({page})=>{
 const fixture=await signingFixture(page,undefined,{step:'signature'});fixture.snapshot.settings.theme='dark';await page.goto('/');await expect(page.locator('.signature-image-preview img')).toBeVisible();
 const contrast=await page.locator('.signature-well[data-mode="generate"]').evaluate(node=>{const color=getComputedStyle(node).backgroundColor.match(/[\d.]+/g)!.slice(0,3).map(Number);const luminance=(rgb:number[])=>rgb.map(value=>{const n=value/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);const background=luminance(color),ink=luminance([25,27,48]);return(Math.max(background,ink)+.05)/(Math.min(background,ink)+.05);});expect(contrast).toBeGreaterThan(7);
});

test('expanded Fit page fits the whole PDF without replacing its canvas',async({page})=>{
 const host=await signingFixture(page);host.snapshot.artifacts[0].spec!.root='pdf';host.snapshot.artifacts[0].placement='expanded';await page.goto('/');const preview=page.locator('.document-preview');await expect(preview).toHaveAttribute('data-preview-state','ready');
 await preview.evaluate(node=>{(node as HTMLElement).style.height='360px';(node as HTMLElement).style.minHeight='0px';Object.assign(window,{fitCanvas:node.querySelector('canvas')});});await preview.hover();await page.getByRole('button',{name:'Fit PDF page',exact:true}).click();await expect(preview).toHaveAttribute('data-fit','page');await expect(page.getByRole('button',{name:'Fit PDF page',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect.poll(()=>preview.evaluate(node=>{const page=node.querySelector('.document-preview-page')!.getBoundingClientRect(),viewport=node.querySelector('.document-preview-scroll')!.getBoundingClientRect();return Math.min(page.top-viewport.top,viewport.bottom-page.bottom);})).toBeGreaterThanOrEqual(0);
 expect(await preview.evaluate(node=>node.querySelector('canvas')===(window as unknown as {fitCanvas:Element}).fitCanvas)).toBe(true);expect(host.downloads()).toBe(1);
});

test('a delayed PNG decode cannot replace a newer drawn mark',async({page})=>{
 await page.addInitScript(()=>{const decode=window.createImageBitmap.bind(window);window.createImageBitmap=(async(...args:Parameters<typeof createImageBitmap>)=>{const bitmap=await (decode as (...args:unknown[])=>Promise<ImageBitmap>)(...args);return new Promise<ImageBitmap>(resolve=>Object.assign(window,{releaseMarkDecode:()=>resolve(bitmap)}));}) as typeof createImageBitmap;});
 const host=await signingFixture(page,undefined,{step:'signature',name:''});await page.goto('/');const signature=page.getByRole('region',{name:'Add your signature',exact:true});await signature.getByRole('button',{name:'Upload',exact:true}).click();const base64=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=100;canvas.height=50;canvas.getContext('2d')!.fillRect(10,10,70,10);return canvas.toDataURL('image/png').split(',')[1];});
 await signature.getByLabel('Upload PNG signature',{exact:true}).setInputFiles({name:'mark.png',mimeType:'image/png',buffer:Buffer.from(base64,'base64')});await expect.poll(()=>page.evaluate(()=>typeof (window as unknown as {releaseMarkDecode?:unknown}).releaseMarkDecode)).toBe('function');
 await signature.getByRole('button',{name:'Draw',exact:true}).click();const canvas=signature.getByRole('application',{name:'Draw visual signature',exact:true});await canvas.focus();await canvas.press('Enter');await canvas.press('ArrowRight');await canvas.press('ArrowDown');await canvas.press('Enter');await expect.poll(()=>(host.snapshot.userStates[0].values.signature as {kind:string})?.kind).toBe('drawn');
 await page.evaluate(async()=>{(window as unknown as {releaseMarkDecode:()=>void}).releaseMarkDecode();await new Promise(requestAnimationFrame);});await expect(signature.getByText('Saving signature…',{exact:true})).toHaveCount(0);expect(host.images.size).toBe(0);expect((host.snapshot.userStates[0].values.signature as {kind:string}).kind).toBe('drawn');
});

async function signingFixture(page: Page, fit?: 'width' | 'page', values: Record<string, unknown> = {}) {
  const snapshot = taskFixture(signingSpec(fit), {}, { name: 'Alex Morgan', step: 'notices', ...values });
  const fixture = await serveTaskFixture(page, snapshot);
  const pdf = await createSigningPdfFixture({ pages: 1 }), images = new Map<string, Buffer>();
  let downloads = 0;
  await page.route('**/api/resources/**', route => {
    const id = new URL(route.request().url()).pathname.split('/')[3];
    if (id === 'agreement') { downloads++; return route.fulfill({ contentType: 'application/pdf', body: Buffer.from(pdf) }); }
    return images.has(id) ? route.fulfill({ contentType: 'image/png', body: images.get(id)! }) : route.fulfill({ status: 404 });
  });
  await page.route('**/api/commands', async route => {
    const command = route.request().postDataJSON();
    if (command.type !== 'resource.upload') return route.fallback();
    const id = `mark-${images.size}`;
    images.set(id, Buffer.from(command.payload.base64, 'base64'));
    return route.fulfill({ json: { commandId: command.id, seq: snapshot.seq, result: { id, threadId: 'task-thread', kind: 'attachment', label: 'signature.png' } } });
  });
  return { ...fixture, images, downloads: () => downloads };
}

for (const [kind, signature] of Object.entries({ typed: { kind: 'typed', text: 'Alex Morgan' }, drawn: { kind: 'drawn', points: [{ x: .2, y: .4 }, { x: .8, y: .6 }] } })) {
  test(`legacy ${kind} signature remains legible in the generated well in dark theme`, async ({ page }) => {
    const fixture = await signingFixture(page, undefined, { step: 'signature', signature });
    fixture.snapshot.settings.theme = 'dark';
    await page.goto('/');
    const mark = page.locator(kind === 'drawn' ? '.signature-image-preview svg' : '.signature-generated-name');
    await expect(mark).toBeVisible();
    const contrast = await mark.evaluate(node => {
      const rgb = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number);
      const luminance = (color: number[]) => color.map(value => { const n = value / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
      const background = luminance(rgb(getComputedStyle(node.closest('.signature-well')!).backgroundColor));
      const ink = luminance(rgb(getComputedStyle(node).color));
      return (Math.max(background, ink) + .05) / (Math.min(background, ink) + .05);
    });
    expect(contrast).toBeGreaterThan(7);
    expect(fixture.images.size).toBe(0);
  });
}

test('page fit reveals the entire PDF and changes fit without remounting or downloading again', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  const fixture = await signingFixture(page, 'page');
  // Exercise explicit standalone fit modes at a width where width-fit exceeds
  // the bounded viewport. A narrow paired half can fit naturally in both modes.
  fixture.snapshot.artifacts[0].spec!.root = 'pdf';
  await page.goto('/');
  const preview = page.getByRole('region', { name: 'Agreement.pdf', exact: true });
  await expect(preview).toHaveAttribute('data-preview-state', 'ready', { timeout: 15_000 });
  await preview.hover();
  const fits = () => preview.evaluate(element => {
    const page = element.querySelector('.document-preview-page')!.getBoundingClientRect(), viewport = element.querySelector('.document-preview-scroll')!.getBoundingClientRect();
    return { top: page.top - viewport.top, bottom: viewport.bottom - page.bottom, left: page.left - viewport.left, right: viewport.right - page.right };
  });
  expect((await fits()).top).toBeGreaterThanOrEqual(34);
  expect((await fits()).bottom).toBeGreaterThanOrEqual(32);
  expect((await fits()).left).toBeGreaterThanOrEqual(0);
  expect((await fits()).right).toBeGreaterThanOrEqual(0);
  await page.evaluate(() => Object.assign(window, { signingCanvas: document.querySelector('.document-preview canvas') }));
  fixture.snapshot.artifacts[0].spec!.elements.pdf.props.fit = 'width'; await fixture.publish();
  await expect(preview).toHaveAttribute('data-fit', 'width');
  await expect.poll(async () => (await fits()).bottom).toBeLessThan(0);
  fixture.snapshot.artifacts[0].spec!.elements.pdf.props.fit = 'page'; await fixture.publish();
  await expect(preview).toHaveAttribute('data-fit', 'page');
  await expect.poll(async () => (await fits()).bottom).toBeGreaterThanOrEqual(32);
  expect(await page.evaluate(() => document.querySelector('.document-preview canvas') === (window as unknown as { signingCanvas: Element }).signingCanvas)).toBe(true);
  expect(fixture.downloads()).toBe(1);
});

test('custom choice appears on demand and restores the same saved non-option value after reload', async ({ page }) => {
  const fixture = await signingFixture(page); await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Something else', exact: true })).toHaveCount(0);
  const choiceHeight = (await page.getByRole('group', { name: 'Where should notices go?' }).boundingBox())!.height;
  await page.getByRole('radio', { name: 'Something else', exact: true }).check();
  const custom = page.getByRole('textbox', { name: 'Something else', exact: true });
  await expect(custom).toBeFocused(); await custom.fill('other@example.test');
  expect((await page.getByRole('group', { name: 'Where should notices go?' }).boundingBox())!.height).toBeCloseTo(choiceHeight, 0);
  await expect.poll(() => fixture.snapshot.userStates[0].values.email).toBe('other@example.test');
  await page.reload(); await expect(custom).toHaveValue('other@example.test');
  await page.getByRole('radio', { name: 'Work', exact: true }).check();
  await expect(custom).toHaveCount(0);
  await expect.poll(() => fixture.snapshot.userStates[0].values.email).toBe('work@example.test');
});

test('completed document and centered receipt retain a legible whole-page presentation', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const fixture = await signingFixture(page, 'page');
  const spec = fixture.snapshot.artifacts[0].spec!;
  spec.elements.steps = { type: 'Panel', props: { align: 'center' }, children: ['receipt'] };
  delete spec.elements.choices; delete spec.elements.signature;
  spec.elements.receipt = { type: 'Status', props: { label: 'Signed for Alex Morgan', status: 'success', presentation: 'receipt' } };
  await page.goto('/');
  const preview = page.locator('.document-preview'); await expect(preview).toHaveAttribute('data-preview-state', 'ready');
  expect((await preview.locator('.document-preview-page').boundingBox())!.height).toBeGreaterThanOrEqual(380);
  await expect(page.getByRole('status').filter({ hasText: 'Signed for Alex Morgan' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('signature modes share one well; style variation saves a different PNG without a duplicate preview', async ({ page }) => {
  const fixture = await signingFixture(page, undefined, { step: 'signature' }); await page.goto('/');
  const signature = page.getByRole('region', { name: 'Add your signature', exact: true });
  await expect(signature.locator('.signature-well')).toHaveCount(1);
  await expect(signature.getByRole('textbox', { name: 'Type your name', exact: true })).toHaveCount(0);
  await expect(signature.getByRole('img', { name: 'Selected visual signature' })).toBeVisible();
  const before = await signature.locator('.signature-well').boundingBox();
  await expect.poll(() => fixture.images.size).toBe(1); const first = [...fixture.images.values()][0];
  await signature.getByRole('button', { name: 'Another style', exact: true }).click();
  await expect.poll(() => fixture.images.size).toBe(2); expect([...fixture.images.values()][1].equals(first)).toBe(false);
  await signature.getByRole('button', { name: 'Draw', exact: true }).click();
  const draw = await signature.locator('.signature-well').boundingBox(); expect(draw!.height).toBeCloseTo(before!.height, 0);
  await signature.getByRole('button', { name: 'Upload', exact: true }).click();
  const upload = await signature.locator('.signature-well').boundingBox(); expect(upload!.height).toBeCloseTo(before!.height, 0);
  await signature.getByRole('button', { name: 'Generate', exact: true }).click();
  await signature.getByRole('button', { name: 'Edit name', exact: true }).click();
  await signature.getByRole('textbox', { name: 'Type your name', exact: true }).fill('Ada Lovelace');
  await expect.poll(() => fixture.images.size).toBeGreaterThan(2);
  await expect(signature.getByRole('img', { name: 'Selected visual signature' })).toHaveCount(1);
});

test('step transition keeps both panels mounted, outgoing controls inert and saved edits intact', async ({ page }) => {
  const fixture = await signingFixture(page); await page.goto('/');
  await page.getByRole('radio', { name: 'Work', exact: true }).check();
  await page.evaluate(() => Object.assign(window, { signingPanel: document.querySelector('.task-step-content>div') }));
  const observed = await page.evaluate(async () => {
    document.querySelector<HTMLButtonElement>('button[aria-label="Next step"]')!.click();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const panels = [...document.querySelectorAll<HTMLElement>('.task-step-content>div')];
    return panels.map(element => ({ hidden: element.hidden, inert: element.inert, phase: element.dataset.phase, animations: element.getAnimations().map(animation => animation.effect?.getTiming().duration) }));
  });
  expect(observed[0].hidden).toBe(false); expect(observed[0].inert).toBe(true); expect(observed[0].phase).toBe('leaving');
  expect(observed[1].inert).toBe(false); expect(observed[1].animations.some(duration=>typeof duration==='number'&&duration>=180&&duration<=320)).toBe(true);
  await expect(page.locator('.task-step-content>div').first()).toBeHidden();
  await page.getByRole('button', { name: 'Previous step' }).click();
  await expect(page.getByRole('radio', { name: 'Work', exact: true })).toBeChecked();
  expect(await page.evaluate(() => document.querySelector('.task-step-content>div') === (window as unknown as { signingPanel: Element }).signingPanel)).toBe(true);
  await expect.poll(() => fixture.snapshot.userStates[0].values.email).toBe('work@example.test');
});

test('reduced motion switches steps immediately without exposing outgoing controls', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await signingFixture(page); await page.goto('/');
  await page.getByRole('button', { name: 'Next step', exact: true }).click();
  await expect(page.locator('.task-step-content>div').first()).toBeHidden();
  expect(await page.locator('.task-step-content>div').evaluateAll(elements => elements.flatMap(element => element.getAnimations()))).toEqual([]);
});
