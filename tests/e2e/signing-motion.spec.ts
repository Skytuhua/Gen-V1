import { createHash } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { createSigningPdfFixture } from './document-preview-fixture';
import { serveTaskFixture, taskFixture, type TaskSpec } from './task-interface-fixture';

const spec: TaskSpec = { root: 'pair', elements: {
  pair: { type: 'Split', props: { ratio: .5 }, children: ['pdf', 'form'] },
  pdf: { type: 'DocumentPreview', props: { resourceId: 'input', title: 'Agreement.pdf', fieldStateKeys: { Name: 'name' }, activeFieldStateKey: 'field' } },
  form: { type: 'Panel', props: {}, children: ['name'] }, name: { type: 'Input', props: { stateKey: 'name', label: 'Name' } },
} };
async function fixture(page: Page) {
  const source = await createSigningPdfFixture({ pages: 1 }), pdf = await PDFDocument.load(source); pdf.getForm().getTextField('Name').setText('Saved export'); const output = await pdf.save();
  const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  const snapshot = taskFixture(structuredClone(spec), {}, { name: 'Alex Morgan', field: 'Name' });
  snapshot.resources = ['input', 'output'].map(id => ({ id, threadId: snapshot.threads[0].id, kind: id === 'input' ? 'file' as const : 'export' as const, path: 'C:/fixture/' + id, label: id, writable: id === 'output', createdAt: '2026-10-30' }));
  snapshot.operations = [{ id: 'export', threadId: snapshot.threads[0].id, revision: 1, kind: 'pdf.export', description: 'Export saved', args: { resourceId: 'input', exportResourceId: 'output', outputPath: 'signed.pdf' }, resourceIds: ['input', 'output'], preconditions: { sha256: sha(source), outputSha256: sha(output) }, status: 'succeeded', approved: true, result: { resourceId: 'output', path: 'signed.pdf', sha256: sha(output) }, createdAt: '2026-10-30' }];
  const host = await serveTaskFixture(page, snapshot);
  const images = new Map<string, Buffer>();
  await page.route('**/api/commands', async route => {
    const command = route.request().postDataJSON(); if (command.type !== 'resource.upload') return route.fallback();
    const id = 'signature-mark-' + images.size; images.set(id, Buffer.from(command.payload.base64, 'base64'));
    snapshot.resources.push({ id, threadId: snapshot.threads[0].id, kind: 'attachment', path: 'C:/fixture/' + id, label: 'signature.png', writable: false, createdAt: '2026-10-30' });
    return route.fulfill({ json: { commandId: command.id, seq: snapshot.seq, result: { id, threadId: snapshot.threads[0].id, kind: 'attachment' } } });
  });
  let hold: Promise<void> | undefined, release = () => {}, denied = false, corrupt = false, fetches = 0;
  await page.route('**/api/resources/**', async route => {
    fetches++;
    const id = new URL(route.request().url()).pathname.split('/')[3];
    if (images.has(id)) return route.fulfill({ contentType: 'image/png', body: images.get(id)! });
    if (route.request().url().includes('/output/')) { await hold; if (denied) return route.fulfill({ status: 403 }); return route.fulfill({ contentType: 'application/pdf', body: Buffer.from(corrupt ? source : output) }); }
    return route.fulfill({ contentType: 'application/pdf', body: Buffer.from(source) });
  });
  await page.addInitScript(() => {
    const original = Element.prototype.scrollTo;
    Object.assign(window, { pdfPanCalls: 0 });
    Element.prototype.scrollTo = (function (this: Element, ...args: unknown[]) { if (this.classList.contains('document-preview-scroll')) (window as unknown as { pdfPanCalls: number }).pdfPanCalls++; return (original as (...values: unknown[]) => void).apply(this, args); }) as typeof original;
  });
  return { ...host, fetches: () => fetches, delay() { hold = new Promise<void>(resolve => { release = resolve; }); }, release() { release(); }, deny() { denied = true; }, corrupt() { corrupt = true; }, async complete() {
    const node = snapshot.artifacts[0].spec!.elements.pdf; node.props = { resourceId: 'output', resourcePath: 'signed.pdf', title: 'Agreement.pdf', fit: 'page', exportOperationId: 'export' }; await host.publish();
  } };
}
test('ordinary draft edits do not restart field navigation', async ({ page }) => {
  const host = await fixture(page); await page.goto('/'); const preview = page.locator('.document-preview'); await expect(preview).toHaveAttribute('data-preview-state', 'ready', { timeout: 15_000 }); await page.waitForTimeout(900);
  await page.evaluate(() => { (window as unknown as { pdfPanCalls: number }).pdfPanCalls = 0; });
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('A changed name');
  await expect.poll(() => host.snapshot.userStates[0].values.name).toBe('A changed name'); await page.waitForTimeout(1000);
  expect(await page.evaluate(() => (window as unknown as { pdfPanCalls: number }).pdfPanCalls)).toBe(0);
});
for (const reduce of [false, true]) test(`generated signature reveal respects ${reduce ? 'reduced' : 'normal'} motion and never animates direct drawing`, async ({ page }) => {
  if (reduce) await page.emulateMedia({ reducedMotion: 'reduce' });
  const host = await fixture(page);
  host.snapshot.artifacts[0].spec!.elements.form.children!.push('signature');
  host.snapshot.artifacts[0].spec!.elements.signature = { type: 'SignaturePad', props: { stateKey: 'signature', nameStateKey: 'name', initialMode: 'generate', label: 'Your signature' } };
  await page.addInitScript(() => {
    const animate = Element.prototype.animate; Object.assign(window, { signatureReveals: [] });
    Element.prototype.animate = function (frames, options) { if (this.classList.contains('signature-image-preview')) (window as unknown as { signatureReveals: unknown[] }).signatureReveals.push({ frames, options }); return animate.call(this, frames, options); };
  });
  await page.goto('/'); await page.getByRole('region',{name:'Your signature',exact:true}).scrollIntoViewIfNeeded(); await expect(page.getByRole('img', { name: 'Selected visual signature', exact: true })).toBeVisible();
  const logs = () => page.evaluate(() => (window as unknown as { signatureReveals: { frames: { clipPath?: string }[]; options: { duration: number } }[] }).signatureReveals);
  if (reduce) expect(await logs()).toHaveLength(0); else { await expect.poll(async () => (await logs()).length).toBe(1); expect((await logs())[0].options.duration).toBe(550); const right=Number((await logs())[0].frames[0].clipPath?.match(/inset\(0 ([\d.]+)%/)?.[1]); expect(right).toBeGreaterThan(20); expect(right).toBeLessThan(90); }
  await page.getByRole('button', { name: 'Draw', exact: true }).click(); const drawing = page.locator('.signature-canvas'); await drawing.scrollIntoViewIfNeeded(); const box = (await drawing.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 30); await page.mouse.down(); await page.mouse.move(box.x + 80, box.y + 70, { steps: 3 }); await page.mouse.up();
  await expect.poll(() => host.snapshot.userStates[0].values.signature).toMatchObject({ kind: 'drawn' }); expect((await logs()).length).toBe(reduce ? 0 : 1);
});
test('verified export keeps the same visible canvas while a candidate loads, then commits', async ({ page }) => {
  const host = await fixture(page); await page.goto('/'); const preview = page.locator('.document-preview'); await expect(preview).toHaveAttribute('data-preview-state', 'ready', { timeout: 15_000 });
  const canvas = await preview.locator('canvas').elementHandle(); host.delay(); await host.complete();
  await expect(preview).toHaveAttribute('data-export-handoff', 'pending'); expect(await preview.locator('canvas').evaluate(node => (node as HTMLCanvasElement).width)).toBeGreaterThan(0);
  host.release(); await expect(preview).toHaveAttribute('data-export-handoff', 'ready');
  expect(await preview.locator('canvas').evaluate((node, prior) => node === prior, canvas)).toBe(true);
});
test('completion holds editing geometry until the verified candidate and receipt can enter together', async ({ page }) => {
  const host = await fixture(page); await page.goto('/'); const preview = page.locator('.document-preview');
  await expect(preview).toHaveAttribute('data-preview-state', 'ready', { timeout: 15_000 }); await page.waitForTimeout(800);
  const before = await preview.locator('canvas').boundingBox();
  host.delay(); await host.complete(); await expect(preview).toHaveAttribute('data-export-handoff', 'pending'); await page.waitForTimeout(700);
  const held = await preview.locator('canvas').boundingBox(); expect(Math.abs(held!.width - before!.width)).toBeLessThan(2);
  await page.evaluate(() => {
    const samples: {phase:string|undefined;width:number;t:number}[]=[]; Object.assign(window,{completionFrames:samples}); const started=performance.now();
    const sample=()=>{const node=document.querySelector<HTMLElement>('.document-preview')!;samples.push({phase:node.dataset.exportHandoff,width:node.querySelector('canvas')!.getBoundingClientRect().width,t:performance.now()-started});if(performance.now()-started<5000)requestAnimationFrame(sample);};requestAnimationFrame(sample);
  });
  host.release(); await expect(preview).toHaveAttribute('data-export-handoff', 'ready'); await page.waitForTimeout(700);
  const frames=await page.evaluate(()=>(window as unknown as {completionFrames:{phase:string|undefined;width:number;t:number}[]}).completionFrames);
  const beginning=frames.find(frame=>frame.phase==='ready')!,end=frames.at(-1)!;
  expect(beginning.width-end.width).toBeGreaterThan(30);
});
for (const failure of ['denied', 'hash', 'cross-thread', 'original-hash', 'original-grant', 'unapproved', 'unknown'] as const) test(`failed ${failure} handoff clears retained source pixels`, async ({ page }) => {
  const host = await fixture(page); await page.goto('/'); const preview = page.locator('.document-preview'); await expect(preview).toHaveAttribute('data-preview-state', 'ready', { timeout: 15_000 });
  if (failure === 'denied') host.deny(); else if (failure === 'hash') host.corrupt(); else if (failure === 'cross-thread') host.snapshot.operations[0].threadId = 'another-thread'; else if (failure === 'original-hash') host.snapshot.operations[0].preconditions.sha256 = 'c'.repeat(64); else if (failure === 'original-grant') host.snapshot.resources.find(grant => grant.id === 'input')!.path = 'C:/changed/input'; else if (failure === 'unapproved') host.snapshot.operations[0].approved = false; else host.snapshot.operations[0].status = 'unknown';
  await host.complete(); await expect(preview.getByRole('alert')).toBeVisible(); expect(await preview.locator('canvas').evaluate(node => (node as HTMLCanvasElement).width)).toBe(0);
});
test('revoked grant clears an already committed preview', async ({ page }) => {
  const host = await fixture(page); await page.goto('/'); const preview = page.locator('.document-preview'); await expect(preview).toHaveAttribute('data-preview-state', 'ready', { timeout: 15_000 });
  host.snapshot.resources = host.snapshot.resources.filter(grant => grant.id !== 'input'); await host.publish();
  await expect(preview.getByRole('alert')).toContainText('no longer available'); expect(await preview.locator('canvas').evaluate(node => (node as HTMLCanvasElement).width)).toBe(0);
});
test('cloned export evidence does not refetch or replay a committed handoff', async ({ page }) => {
  const host = await fixture(page); await page.goto('/'); const preview = page.locator('.document-preview'); await expect(preview).toHaveAttribute('data-preview-state', 'ready', { timeout: 15_000 }); await host.complete(); await expect(preview).toHaveAttribute('data-export-handoff', 'ready');
  const count = host.fetches(); host.snapshot.operations = structuredClone(host.snapshot.operations); host.snapshot.resources = structuredClone(host.snapshot.resources); await host.publish(); await page.waitForTimeout(300);
  expect(host.fetches()).toBe(count); await expect(preview).toHaveAttribute('data-export-handoff', 'ready');
});
test('cancelling the continuity reference clears the predecessor while the destination is loading', async ({ page }) => {
  const host = await fixture(page); await page.goto('/'); const preview = page.locator('.document-preview'); await expect(preview).toHaveAttribute('data-preview-state', 'ready', { timeout: 15_000 });
  host.delay(); await host.complete(); await expect(preview).toHaveAttribute('data-export-handoff', 'pending');
  delete host.snapshot.artifacts[0].spec!.elements.pdf.props.exportOperationId; await host.publish();
  await expect.poll(() => preview.locator('canvas').evaluate(node => (node as HTMLCanvasElement).width)).toBe(0);
  host.release(); await expect(preview).toHaveAttribute('data-preview-state', 'ready', { timeout: 15_000 });
});
