import { test, expect, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import type { ArtifactRecord, HostCommand, Snapshot, Thread } from '../../packages/contracts';
import { DOCUMENT_SCHEMAS } from '../../packages/ui-catalog/documents';
import { createSigningPdfFixture, SIGNING_FIELD_STATE_KEYS, SIGNING_SIGNATURE_BOX } from './document-preview-fixture';
import { observeDraftWorkers, pageTreePdf } from './pdf-test-helper';

const timestamp = '2026-10-29T23:00:00.000Z';
const thread = (id: string, title: string): Thread => ({ id, title, projectName: null, createdAt: timestamp, updatedAt: timestamp, status: 'ready', epoch: 0, runId: null, modelId: null, sessionPath: null });
function workspace(previewProps: Record<string, unknown> = {}): Snapshot {
  const artifact: ArtifactRecord = {
    id: 'pdf-artifact', threadId: 'pdf-thread', messageId: 'pdf-message', title: 'Review agreement', purpose: 'Synthetic PDF regression fixture; no model inference', kind: 'structured', revision: 1,
    spec: { root: 'split', elements: {
      split: { type: 'Split', props: { ratio: .5 }, children: ['preview', 'fields'] },
      preview: { type: 'DocumentPreview', props: { resourceId: 'granted-pdf', resourcePath: 'contracts/Agreement & review.pdf', title: 'Agreement.pdf', fieldStateKeys: SIGNING_FIELD_STATE_KEYS, activeFieldStateKey: 'activeField', signatureStateKey: 'visualSignature', signatureBox: SIGNING_SIGNATURE_BOX, ...previewProps } },
      fields: { type: 'Stack', props: { gap: 'md' }, children: ['name', 'email', 'signature'] },
      name: { type: 'Input', props: { stateKey: 'name', label: 'Full name' } }, email: { type: 'Input', props: { stateKey: 'email', label: 'Notice email' } },
      signature: { type: 'SignaturePad', props: { stateKey: 'visualSignature', nameStateKey: 'name', label: 'Visual signature', initialMode: 'draw' } },
    } },
    widget: null, bindings: {}, actions: {}, stateId: 'pdf-state', lifecycle: 'active', placement: 'inline', pinned: false, catalogVersion: '1.0.0', createdAt: timestamp, updatedAt: timestamp,
  };
  return { seq: 1, threads: [thread('pdf-thread', 'PDF review'), thread('other-thread', 'Other task')], messages: [{ id: 'pdf-message', threadId: 'pdf-thread', role: 'assistant', content: 'Review the synthetic document beside its editable fields.', createdAt: timestamp, runId: null }], artifacts: [artifact], userStates: [{ id: 'pdf-state', threadId: 'pdf-thread', revision: 0, schemaVersion: 1, values: { name: 'John Doe', title: 'Founder', email: '', signedDate: 'October 24, 2026', activeField: 'Email', visualSignature: null } }], data: [], requests: [], operations: [], resources: [{ id: 'granted-pdf', threadId: 'pdf-thread', kind: 'project', path: '/synthetic/grant', label: 'Synthetic PDF grant', writable: false, createdAt: timestamp }], usage: {}, settings: { theme: 'light', modelId: null }, activeThreadId: 'pdf-thread' };
}

async function fixtureHost(page: Page, bytes: Uint8Array, options: { snapshot?: Snapshot; status?: number; oversized?: boolean } = {}) {
  const state = { snapshot: options.snapshot ?? workspace(), commands: [] as HostCommand[], resourceUrls: [] as string[], pngs: new Map<string, Buffer>() };
  await page.addInitScript(() => {
    class FixtureEvents extends EventTarget { onopen: (() => void) | null = null; constructor() { super(); queueMicrotask(() => this.onopen?.()); } close() {} }
    Object.defineProperty(window, 'EventSource', { value: FixtureEvents });
  });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/bootstrap') return route.fulfill({ json: { csrfToken: 'synthetic-token' } });
    if (url.pathname === '/api/models') return route.fulfill({ json: { models: [] } });
    if (url.pathname === '/api/snapshot') return route.fulfill({ json: state.snapshot });
    if (url.pathname === '/api/resources/granted-pdf/content') {
      state.resourceUrls.push(url.href);
      return route.fulfill({ status: options.status ?? 200, contentType: 'application/pdf', ...(options.oversized ? { headers: { 'Content-Length': String(20 * 1024 * 1024 + 1) } } : {}), body: Buffer.from(bytes) });
    }
    const pngId = url.pathname.match(/^\/api\/resources\/([^/]+)\/content$/)?.[1];
    if (pngId && state.pngs.has(pngId)) return route.fulfill({ contentType: 'image/png', body: state.pngs.get(pngId)! });
    if (url.pathname !== '/api/commands') return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Synthetic fixture route unavailable' } } });
    const command = route.request().postDataJSON() as HostCommand; state.commands.push(command);
    const payload = command.payload as Record<string, unknown>;
    let result: unknown = {};
    if (command.type === 'resource.upload') { const id = `signature-${state.pngs.size}`; state.pngs.set(id, Buffer.from(String(payload.base64), 'base64')); result = { id, threadId: command.threadId, kind: 'attachment', label: 'signature.png', path: '/synthetic/signature.png', writable: false, createdAt: timestamp }; state.snapshot.resources.push(result as Snapshot['resources'][number]); }
    if (command.type === 'state.save') { const record = state.snapshot.userStates[0]; record.values = payload.values as Record<string, unknown>; record.revision++; result = record; }
    if (command.type === 'artifact.expand') state.snapshot.artifacts[0].placement = payload.expanded ? 'expanded' : 'inline';
    state.snapshot.seq++;
    return route.fulfill({ json: { commandId: command.id, eventSeq: state.snapshot.seq, result } });
  });
  return state;
}
const preview = (page: Page) => page.getByRole('region', { name: 'Agreement.pdf', exact: true });
async function image(page: Page) { return preview(page).locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL()); }

test('signing pairs by available artifact width and keeps the same canvas on narrow reflow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixtureHost(page, await createSigningPdfFixture()); await page.goto('/');
  await expect(preview(page).getByRole('status')).toContainText('Page 1 of 2');
  const stacked = async () => page.locator('.surface-split').evaluate(element => {
    const document = element.querySelector('.document-preview')!.getBoundingClientRect();
    const questions = element.children[1]!.getBoundingClientRect();
    return { width: element.getBoundingClientRect().width, before: questions.bottom <= document.top + 2, paired: document.right <= questions.left };
  });
  expect((await stacked()).width).toBeGreaterThanOrEqual(620); expect((await stacked()).paired).toBe(true);
  await page.evaluate(() => Object.assign(window, { __signingCanvas: document.querySelector('.document-preview canvas') }));
  await page.setViewportSize({ width: 390, height: 1000 });
  await expect.poll(async () => (await stacked()).before).toBe(true);
  expect((await stacked()).before).toBe(true);
  expect(await page.evaluate(() => document.querySelector('.document-preview canvas') === (window as unknown as { __signingCanvas: Element }).__signingCanvas)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('the signature step focuses the declared visual mark box',async({page})=>{
 const state=await fixtureHost(page,await createSigningPdfFixture());
 state.snapshot.userStates[0].values.activeField='visualSignature';
 await page.goto('/');await expect(page.locator('.document-active-field')).toBeVisible({timeout:15_000});
 await expect(preview(page).getByRole('status')).toContainText('Page 1 of 2');
 // The committed page status precedes the retained focus spring settling.
 // Assert the actual declared mark reaches full viewport containment.
 await expect.poll(()=>page.locator('.document-active-field').evaluate(element=>{const rect=element.getBoundingClientRect();const viewport=element.closest('.document-preview-scroll')!.getBoundingClientRect();return {topVisible:rect.top>=viewport.top,bottomVisible:rect.bottom<=viewport.bottom};})).toEqual({topVisible:true,bottomVisible:true});
});

test('repeated page-tree references are denied before expansion while the host timer and Settings stay responsive', async ({ page }) => {
  await fixtureHost(page, await createSigningPdfFixture());
  await page.goto('/'); await expect(preview(page).getByRole('status')).toContainText('Page 1 of 2');
  const result = await page.evaluate(async original => {
    const path = '/src/DocumentPreview.tsx'; const { createPdfDraft } = await import(path);
    let maximumLag = 0, previous = performance.now();
    const timer = setInterval(() => { const now = performance.now(); maximumLag = Math.max(maximumLag, now - previous); previous = now; }, 25);
    const started = performance.now();
    // Let Playwright drive Settings while the actual draft is in flight.
    (window as unknown as Record<string, unknown>).__parsing = true;
    const denial = await createPdfDraft(new Uint8Array(original)).then(() => 'ACCEPTED', (error: Error) => error.message);
    await new Promise(resolve => setTimeout(resolve, 50)); clearInterval(timer);
    return { denial, maximumLag, elapsed: performance.now() - started };
  }, Array.from(pageTreePdf()));
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  expect(result.maximumLag).toBeLessThan(200);
  expect(result.denial).toContain('Invalid PDF page tree');
  expect(result.elapsed).toBeLessThan(3000);
});

test('focused Name and Email preserve their left prefix and actual canvas ink at desktop and narrow widths', async ({ page }) => {
  const snapshot = workspace(); snapshot.userStates[0].values.name = 'Alex Morgan'; snapshot.userStates[0].values.email = 'alex@example.test';
  await fixtureHost(page, await createSigningPdfFixture(), { snapshot });
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 700, height: 900 }]) {
    await page.setViewportSize(viewport); await page.goto('/');
    await expect(preview(page).getByRole('status')).toHaveText('Draft preview · Page 1 of 2');
    const geometry = await preview(page).evaluate(region => {
      const canvas = region.querySelector('canvas')!, scroller = region.querySelector('.document-preview-scroll')!;
      const bounds = canvas.getBoundingClientRect(), visible = scroller.getBoundingClientRect(), field = region.querySelector('.document-active-field')!.getBoundingClientRect();
      const context = canvas.getContext('2d')!;
      // The first 33 PDF units contain "Alex" / "alex" from the fixture's real field appearances.
      const ink = [458, 374].map(y => {
        const x0 = Math.floor(78 / 612 * canvas.width), y0 = Math.floor((792 - y - 27) / 792 * canvas.height);
        const w = Math.max(1, Math.floor(33 / 612 * canvas.width)), h = Math.max(1, Math.floor(25 / 792 * canvas.height));
        const pixels = context.getImageData(x0, y0, w, h).data;
        let dark = 0; for (let index = 0; index < pixels.length; index += 4) if (pixels[index] < 100 && pixels[index + 1] < 100 && pixels[index + 2] < 100) dark++;
        return dark;
      });
      return { ink, fieldLeft: field.left - visible.left, prefixLeft: bounds.left + 78 / 612 * bounds.width - visible.left, prefixRight: bounds.left + 111 / 612 * bounds.width - visible.left, viewport: scroller.clientWidth, fieldWidth: field.width, scrollLeft: scroller.scrollLeft };
    });
    expect(geometry.ink.every(count => count > 8)).toBe(true);
    expect(geometry.fieldLeft, JSON.stringify(geometry)).toBeGreaterThanOrEqual(10);
    expect(geometry.prefixLeft).toBeGreaterThanOrEqual(10);
    expect(geometry.prefixRight).toBeLessThan(geometry.viewport - 10);
  }
});

test('cyclic Kids and parent chains receive a fast explicit page-tree denial', async ({ page }) => {
  await fixtureHost(page, await createSigningPdfFixture()); await page.goto('/');
  const results = await page.evaluate(async fixtures => {
    const path = '/src/DocumentPreview.tsx'; const { createPdfDraft } = await import(path);
    return Promise.all(fixtures.map(async bytes => createPdfDraft(new Uint8Array(bytes)).then(() => 'ACCEPTED', (error: Error) => error.message)));
  }, [Array.from(pageTreePdf('cyclic')), Array.from(pageTreePdf('parent-cycle'))]);
  expect(results).toEqual([expect.stringContaining('Invalid PDF page tree'), expect.stringContaining('Invalid PDF page tree')]);
});

test('draft abort and the hard deadline terminate actual workers while Settings remains usable', async ({ page }) => {
  test.setTimeout(40_000);
  const bytes = await createSigningPdfFixture(); await fixtureHost(page, bytes); await page.goto('/');
  await expect(preview(page).getByRole('status')).toContainText('Page 1 of 2');
  await observeDraftWorkers(page);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/src/pdf-draft.worker.ts*', async route => { await gate; await route.continue().catch(() => {}); });
  try {
    const pending = page.evaluate(async original => {
      const path = '/src/DocumentPreview.tsx'; const { createPdfDraft } = await import(path);
      const controller = new AbortController();
      const aborted = createPdfDraft(new Uint8Array(original), {}, null, undefined, controller.signal).then(() => 'ACCEPTED', (error: Error) => error.name);
      controller.abort();
      const started = performance.now();
      const timedOut = await createPdfDraft(new Uint8Array(original)).then(() => 'ACCEPTED', (error: Error) => error.message);
      return { aborted: await aborted, timedOut, elapsed: performance.now() - started };
    }, Array.from(bytes));
    await expect.poll(() => page.evaluate(() => (window as unknown as { __draftWorkers: unknown[] }).__draftWorkers.length)).toBe(2);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    const result = await pending;
    expect(result.aborted).toBe('AbortError'); expect(result.timedOut).toContain('time limit');
    expect(result.elapsed).toBeGreaterThanOrEqual(14_000); expect(result.elapsed).toBeLessThan(18_000);
    expect(await page.evaluate(() => (window as unknown as { __draftWorkers: { terminated: boolean }[] }).__draftWorkers.every(worker => worker.terminated))).toBe(true);
  } finally { release(); await page.unroute('**/src/pdf-draft.worker.ts*'); }
});

test('replacement state and unmount abort their own pending draft worker', async ({ page }) => {
  await fixtureHost(page, await createSigningPdfFixture()); await page.goto('/');
  await expect(preview(page).getByRole('status')).toContainText('Page 1 of 2');
  await observeDraftWorkers(page);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/src/pdf-draft.worker.ts*', async route => { await gate; await route.continue().catch(() => {}); });
  const workers = () => page.evaluate(() => (window as unknown as { __draftWorkers: { terminated: boolean }[] }).__draftWorkers.map(record => record.terminated));
  try {
    await page.getByRole('textbox', { name: 'Full name', exact: true }).fill('Replacement one');
    await expect.poll(workers).toEqual([false]);
    await page.getByRole('textbox', { name: 'Full name', exact: true }).fill('Replacement two');
    await expect.poll(workers).toEqual([true, false]);
    await page.getByRole('button', { name: 'Other task Ready', exact: true }).click();
    await expect.poll(workers).toEqual([true, true]);
    await page.getByRole('button', { name: 'PDF review Ready', exact: true }).click();
  } finally { release(); await page.unroute('**/src/pdf-draft.worker.ts*'); }
  await expect(preview(page).getByRole('status')).toContainText('Page 1 of 2');
});

test('worker cloning bounds source views and field state and validates response identity and output bounds', async ({ page }) => {
  const bytes = await createSigningPdfFixture(); await fixtureHost(page, bytes); await page.goto('/');
  await expect(preview(page).getByRole('status')).toContainText('Page 1 of 2');
  await observeDraftWorkers(page);
  const result = await page.evaluate(async original => {
    const path = '/src/DocumentPreview.tsx'; const { createPdfDraft } = await import(path);
    const denials: string[] = [];
    for (const values of [{ Name: 'a'.repeat(10001) }, { Name: new Array(101).fill('x') }, { Name: { nested: 'not a PDF field value' } }, Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`field${i}`, 'x']))]) {
      denials.push(await createPdfDraft(new Uint8Array(original), values).then(() => 'ACCEPTED', (error: Error) => error.message));
    }
    type Record = { worker: Worker; terminated: boolean; request: { id: string; sourceBytes: number; backingBytes: number; keys: string[] } };
    const records = (window as unknown as { __draftWorkers: Record[] }).__draftWorkers;
    const beforeValid = records.length;
    const allocation = new Uint8Array(21 * 1024 * 1024); allocation.set(original, 17);
    const source = allocation.subarray(17, 17 + original.length);
    const draft = await createPdfDraft(source, { Name: 'Alex Morgan' });
    const valid = { bytes: draft.bytes.length, originalIntact: source[0] === 37 && source.length === original.length, request: records[0]?.request, terminated: records[0]?.terminated };
    const rejected: string[] = [];
    for (const kind of ['wrong-id', 'oversized-bytes', 'nonfinite-rectangle', 'too-many-rectangles', 'oversized-error']) {
      const pending = createPdfDraft(new Uint8Array(original)).then(() => 'ACCEPTED', (error: Error) => error.message);
      const record = records.at(-1)!;
      const field = { name: 'Name', page: 1, rect: [0, 0, 100, 20] };
      const response = kind === 'oversized-error' ? { id: record.request.id, error: 'x'.repeat(1001) } : {
        id: kind === 'wrong-id' ? 'another-request' : record.request.id,
        draft: { edited: false, bytes: kind === 'oversized-bytes' ? new Uint8Array(20 * 1024 * 1024 + 1) : new Uint8Array(original), fields: kind === 'too-many-rectangles' ? new Array(4001).fill(field) : [{ ...field, rect: kind === 'nonfinite-rectangle' ? [NaN, 0, 100, 20] : field.rect }] },
      };
      // Exercise the host boundary without changing the fixed trusted worker implementation.
      record.worker.dispatchEvent(new MessageEvent('message', { data: response })); rejected.push(await pending);
    }
    return { denials, beforeValid, valid, rejected, terminated: records.every(record => record.terminated), uniqueIds: new Set(records.map(record => record.request.id)).size === records.length };
  }, Array.from(bytes));
  expect(result.denials.every(message => message !== 'ACCEPTED')).toBe(true); expect(result.beforeValid).toBe(0);
  expect(result.valid.bytes).toBeGreaterThan(100); expect(result.valid.originalIntact).toBe(true); expect(result.valid.terminated).toBe(true);
  expect(result.valid.request.sourceBytes).toBe(bytes.length); expect(result.valid.request.backingBytes).toBe(bytes.length);
  expect(result.valid.request.keys).toEqual(['box', 'id', 'signature', 'source', 'values']);
  expect(result.rejected).toEqual(Array(5).fill('Invalid PDF draft worker response.'));
  expect(result.terminated).toBe(true); expect(result.uniqueIds).toBe(true);
});

test('real AcroForm edits reach the PDF canvas, focused field, pages, and derived bytes without executing PDF actions', async ({ page }) => {
  const bytes = await createSigningPdfFixture({ activeContent: true });
  const state = await fixtureHost(page, bytes);
  const errors: string[] = [], externalRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().startsWith('https://pdf-action.invalid')) externalRequests.push(request.url()); });
  await page.goto('/');
  await expect(preview(page).getByRole('status')).toHaveText('Draft preview · Page 1 of 2');
  await expect(preview(page).locator('.document-active-field')).toBeVisible();
  const before = await image(page);
  await page.getByRole('textbox', { name: 'Full name', exact: true }).fill('Ada Lovelace');
  await expect.poll(() => image(page)).not.toBe(before);
  await expect.poll(() => state.snapshot.userStates[0].values.name).toBe('Ada Lovelace');
  const derived = await page.evaluate(async ({ original }) => {
    const modulePath = '/src/DocumentPreview.tsx'; const { createPdfDraft } = await import(modulePath);
    const draft = await createPdfDraft(new Uint8Array(original), { Name: 'Ada Lovelace', Email: 'ada@example.test', Accepted: true, Delivery: 'Personal' });
    return Array.from(draft.bytes as Uint8Array);
  }, { original: Array.from(bytes) });
  const document = await PDFDocument.load(new Uint8Array(derived));
  expect(document.getForm().getTextField('Name').getText()).toBe('Ada Lovelace');
  expect(document.getForm().getTextField('Email').getText()).toBe('ada@example.test');
  expect(document.getForm().getCheckBox('Accepted').isChecked()).toBe(true);
  expect(document.getForm().getDropdown('Delivery').getSelected()).toEqual(['Personal']);
  const original = await PDFDocument.load(bytes); expect(original.getForm().getTextField('Name').getText()).toBe('John Doe');
  await preview(page).getByRole('button', { name: 'Next PDF page' }).click();
  await expect(preview(page).getByRole('status')).toHaveText('Draft preview · Page 2 of 2');
  await preview(page).getByRole('button', { name: 'Focus active PDF field' }).click();
  await expect(preview(page).getByRole('status')).toHaveText('Draft preview · Page 1 of 2');
  expect(new URL(state.resourceUrls[0]).searchParams.get('path')).toBe('contracts/Agreement & review.pdf');
  expect(await preview(page).getByRole('link', { name: 'Download source PDF' }).getAttribute('href')).toContain('path=contracts%2FAgreement+%26+review.pdf');
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__pdfExecuted)).toBeUndefined();
  expect(externalRequests).toEqual([]); expect(errors).toEqual([]);
});

test('drawn and keyboard marks stay normalized across theme, resize and remount; typed signatures update the PDF', async ({ page }) => {
  const state = await fixtureHost(page, await createSigningPdfFixture());
  await page.goto('/'); await expect(preview(page).getByRole('status')).toContainText('Page 1 of 2');
  const signature = page.getByRole('application', { name: 'Draw visual signature' });
  await signature.scrollIntoViewIfNeeded();
  const box = await signature.boundingBox(); expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * .15, box!.y + box!.height * .65); await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * .35, box!.y + box!.height * .3, { steps: 6 });
  await page.mouse.move(box!.x + box!.width * .75, box!.y + box!.height * .6, { steps: 8 }); await page.mouse.up();
  await expect.poll(() => (state.snapshot.userStates[0].values.visualSignature as { kind?: string })?.kind).toBe('drawn');
  const saved = structuredClone(state.snapshot.userStates[0].values.visualSignature) as { kind: string; points: { x: number; y: number }[] };
  expect(saved.points.length).toBeGreaterThan(5); expect(saved.points.every(point => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1)).toBe(true);
  const lightImage = await signature.evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL());
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await expect.poll(() => signature.evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL())).not.toBe(lightImage);
  await page.setViewportSize({ width: 1050, height: 850 });
  expect(state.snapshot.userStates[0].values.visualSignature).toEqual(saved);
  await page.getByRole('button', { name: 'Other task Ready', exact: true }).click(); await expect(signature).toHaveCount(0);
  await page.getByRole('button', { name: 'PDF review Ready', exact: true }).click(); await expect(signature).toBeVisible();
  expect(state.snapshot.userStates[0].values.visualSignature).toEqual(saved);
  await signature.focus(); await signature.press('Enter'); await signature.press('ArrowRight'); await signature.press('ArrowUp'); await signature.press('Enter');
  await expect.poll(() => (state.snapshot.userStates[0].values.visualSignature as { strokes?: unknown[] }).strokes?.length).toBe(2);
  await signature.press('Backspace'); await expect.poll(() => state.snapshot.userStates[0].values.visualSignature).toEqual(saved);
  await signature.press('Delete'); await expect.poll(() => state.snapshot.userStates[0].values.visualSignature).toBeNull();
  const before = await image(page);
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await page.getByRole('button', { name: 'Edit name', exact: true }).click();
  await page.getByRole('textbox', { name: 'Type your name', exact: true }).fill('Ada Lovelace');
  await expect.poll(() => (state.snapshot.userStates[0].values.visualSignature as { kind?: string })?.kind).toBe('image');
  await expect.poll(() => image(page)).not.toBe(before);
  await page.getByRole('button', { name: 'Other task Ready', exact: true }).click(); await page.getByRole('button', { name: 'PDF review Ready', exact: true }).click();
  await page.getByRole('button', { name: 'Generate', exact: true }).click(); await expect(page.getByRole('img', { name: 'Selected visual signature' })).toBeVisible();
});

test('mismatched fields, invalid options and placement fail meaningfully; unsafe resource references never become URLs', async ({ page }) => {
  const bytes = await createSigningPdfFixture();
  await fixtureHost(page, bytes, { snapshot: workspace({ fieldStateKeys: { MissingField: 'name' } }) });
  await page.goto('/'); await expect(preview(page).getByRole('alert')).toContainText('PDF field “MissingField” was not found');
  const results = await page.evaluate(async original => {
    const path = '/src/DocumentPreview.tsx'; const { createPdfDraft, resourceContentUrl } = await import(path);
    const invalid: string[] = [];
    for (const values of [{ Name: true }, { Delivery: 'Unlisted' }, { Accepted: 'yes' }]) {
      try { await createPdfDraft(new Uint8Array(original), values); invalid.push('ACCEPTED'); } catch (error) { invalid.push((error as Error).message); }
    }
    try { await createPdfDraft(new Uint8Array(original), {}, { kind: 'typed', text: 'Ada' }, { page: 1, x: 600, y: 100, width: 100, height: 50 }); invalid.push('ACCEPTED'); } catch (error) { invalid.push((error as Error).message); }
    for (const [id, relative] of [['https://outside.invalid/doc.pdf', undefined], ['granted-pdf', '../secret.pdf'], ['granted-pdf', 'C:\\secret.pdf'], ['granted-pdf', '\u0000file.pdf']]) {
      try { resourceContentUrl(id, relative); invalid.push('ACCEPTED'); } catch { invalid.push('UNSAFE_RESOURCE_REJECTED'); }
    }
    return invalid;
  }, Array.from(bytes));
  expect(results[0]).toContain('Cannot preview PDF field “Name”'); expect(results[1]).toContain('available options'); expect(results[2]).toContain('Cannot preview PDF field “Accepted”'); expect(results[3]).toContain('must fit within an unrotated PDF page');
  expect(results.slice(4)).toEqual(Array(4).fill('UNSAFE_RESOURCE_REJECTED'));
  expect(DOCUMENT_SCHEMAS.SignaturePad.safeParse({ stateKey: '__proto__' }).success).toBe(false);
  expect(DOCUMENT_SCHEMAS.DocumentPreview.safeParse({ resourceId: 'grant', signatureStateKey: 'signature' }).success).toBe(false);
});

test('denied, non-PDF, oversized and excessive-page sources show recoverable errors', async ({ page }) => {
  for (const fixture of [
    { bytes: await createSigningPdfFixture(), status: 403, expected: 'no longer available to this thread' },
    { bytes: new TextEncoder().encode('not a PDF'), expected: 'not a PDF' },
    { bytes: await createSigningPdfFixture(), oversized: true, expected: 'up to 20 MiB' },
    { bytes: await createSigningPdfFixture({ pages: 201 }), expected: '1 to 200 pages' },
    { bytes: await createSigningPdfFixture({ readOnlyName: true }), expected: 'read-only' },
  ]) {
    await page.unroute('**/api/**'); await fixtureHost(page, fixture.bytes, fixture); await page.goto('/');
    await expect(preview(page).getByRole('alert')).toContainText(fixture.expected);
    await expect(preview(page).getByRole('button', { name: 'Retry preview' })).toBeVisible();
    await expect(preview(page).getByRole('link', { name: 'Open source PDF' }).last()).toBeVisible();
  }
});

test('unmount destroys the actual PDF loading task and rapid rerenders leave no canvas races', async ({ page }) => {
  const bytes = await createSigningPdfFixture(), state = await fixtureHost(page, bytes);
  state.snapshot.artifacts[0].placement = 'expanded';
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await expect(preview(page).getByRole('status')).toContainText('Page 1 of 2');
  await page.evaluate(async original => {
    const path = '/src/DocumentPreview.tsx'; const { loadPdfRenderer } = await import(path);
    const renderer = await loadPdfRenderer(); const probe = renderer.getDocument({ data: new Uint8Array(original), useWorkerFetch: false, useWasm: false });
    const prototype = Object.getPrototypeOf(probe), destroy = prototype.destroy;
    (window as unknown as Record<string, unknown>).__destroyCount = 0;
    prototype.destroy = function (...args: unknown[]) { const win = window as unknown as Record<string, number>; win.__destroyCount++; return destroy.apply(this, args); };
    const document = await probe.promise, pdfPage = await document.getPage(1);
    const canvas = window.document.createElement('canvas'); canvas.width = 612; canvas.height = 792;
    const task = pdfPage.render({ canvas, viewport: pdfPage.getViewport({ scale: 1 }) });
    const renderPrototype = Object.getPrototypeOf(task), cancel = renderPrototype.cancel;
    (window as unknown as Record<string, unknown>).__cancelCount = 0;
    renderPrototype.cancel = function (...args: unknown[]) { const win = window as unknown as Record<string, number>; win.__cancelCount++; return cancel.apply(this, args); };
    await task.promise; await probe.destroy();
  }, Array.from(bytes));
  await preview(page).getByRole('button', { name: 'Zoom in PDF' }).click({ clickCount: 3 });
  await page.getByRole('button', { name: 'Collapse artifact', exact: true }).click();
  await page.getByRole('button', { name: 'Other task Ready', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Record<string, number>).__destroyCount)).toBeGreaterThan(1);
  await expect.poll(() => page.evaluate(() => (window as unknown as Record<string, number>).__cancelCount)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'PDF review Ready', exact: true }).click(); await expect(preview(page).getByRole('status')).toContainText('Page 1 of 2');
  expect(errors).toEqual([]);
});

test('pending draft retains full-opacity committed pixels and field focus does not parse again', async ({ page }) => {
  const state = await fixtureHost(page, await createSigningPdfFixture()); await page.goto('/');
  await expect(preview(page).getByRole('status')).toContainText('Page 1 of 2');
  await observeDraftWorkers(page);
  const before = await image(page); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/src/pdf-draft.worker.ts*', async route => { await gate; await route.continue().catch(() => {}); });
  try {
    await page.getByRole('textbox', { name: 'Full name', exact: true }).fill('Buffered candidate');
    await expect(preview(page)).toHaveAttribute('aria-busy', 'true');
    expect(await image(page)).toBe(before);
    expect(await preview(page).locator('.document-preview-page').evaluate(element => getComputedStyle(element).opacity)).toBe('1');
  } finally { release(); await page.unroute('**/src/pdf-draft.worker.ts*'); }
  await expect.poll(() => image(page)).not.toBe(before);
  const count = () => page.evaluate(() => (window as unknown as { __draftWorkers: unknown[] }).__draftWorkers.length);
  const workersBefore = await count();
  await preview(page).getByRole('button', { name: 'Focus active PDF field' }).click();
  await preview(page).getByRole('button', { name: 'Focus active PDF field' }).click();
  await page.waitForTimeout(750);
  expect(await count()).toBe(workersBefore); expect(state.resourceUrls).toHaveLength(1);
});

test('Generate styles and PNG upload persist the identical canonical resource for preview and export', async ({ page }) => {
  const snapshot = workspace(); snapshot.userStates[0].values.activeField = 'visualSignature';
  const state = await fixtureHost(page, await createSigningPdfFixture(), { snapshot }); await page.goto('/');
  await expect(preview(page).getByRole('status')).toContainText('Page 1 of 2');
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await page.getByRole('button', { name: 'Edit name', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Type your name', exact: true }); await expect(input).toBeEnabled(); await input.fill('Grace Hopper');
  await expect.poll(() => (state.snapshot.userStates[0].values.visualSignature as { kind?: string })?.kind).toBe('image');
  const first = (state.snapshot.userStates[0].values.visualSignature as { resourceId: string }).resourceId;
  const uploaded = state.pngs.get(first)!; expect(uploaded.length).toBeLessThan(512 * 1024);
  expect(uploaded.readUInt32BE(16)).toBe(960); expect(uploaded.readUInt32BE(20)).toBe(320);
  await page.getByRole('button', { name: 'Another style', exact: true }).click();
  await expect.poll(() => (state.snapshot.userStates[0].values.visualSignature as { resourceId?: string })?.resourceId).not.toBe(first);
  const second = (state.snapshot.userStates[0].values.visualSignature as { resourceId: string }).resourceId; expect(state.pngs.get(second)!.equals(uploaded)).toBe(false);
  await expect(preview(page)).toHaveAttribute('aria-busy', 'false');
  const evidencePath = test.info().outputPath('signature-generated.png'); await page.getByRole('region', { name: 'Review agreement', exact: true }).screenshot({ path: evidencePath });
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await page.getByLabel('Upload PNG signature').setInputFiles({ name: 'signature.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await expect(page.getByRole('alert')).toContainText('Choose a PNG');
  const before = state.pngs.size;
  await page.getByLabel('Upload PNG signature').setInputFiles({ name: 'mark.png', mimeType: 'image/png', buffer: uploaded });
  await expect.poll(() => state.pngs.size).toBe(before + 1);
  await expect(page.getByRole('img', { name: 'Selected visual signature' })).toBeVisible();
  const mark = state.snapshot.userStates[0].values.visualSignature as { kind: 'image'; resourceId: string };
  const derived = await page.evaluate<number[], { original: number[]; mark: { kind: 'image'; resourceId: string }; png: number[]; box: typeof SIGNING_SIGNATURE_BOX }>(async ({ original, mark, png, box }) => { const path = '/src/DocumentPreview.tsx'; const { createPdfDraft } = await import(path); return Array.from((await createPdfDraft(new Uint8Array(original), {}, mark, box, undefined, new Uint8Array(png))).bytes); }, { original: Array.from(await createSigningPdfFixture()), mark, png: Array.from(state.pngs.get(mark.resourceId)!), box: SIGNING_SIGNATURE_BOX });
  const doc = await PDFDocument.load(new Uint8Array(derived)); expect(doc.getPageCount()).toBe(2);
  await page.reload(); await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Selected visual signature' })).toBeVisible();
});

test('PDF render suspends during frame starvation and resumes without replacing the committed surface', async ({ page }) => {
  await fixtureHost(page, await createSigningPdfFixture()); await page.goto('/'); await expect(preview(page).getByRole('status')).toContainText('Page 1 of 2');
  const before = await image(page);
  await page.evaluate(() => { const original = window.requestAnimationFrame.bind(window); const pending: FrameRequestCallback[] = []; Object.assign(window, { __resumeFrames: () => { window.requestAnimationFrame = original; pending.forEach(callback => original(callback)); } }); window.requestAnimationFrame = callback => { pending.push(callback); return pending.length; }; document.querySelector<HTMLButtonElement>('[aria-label="Zoom out PDF"]')!.click(); });
  const state = () => page.evaluate(() => document.querySelector('.document-preview')?.getAttribute('data-preview-state'));
  const pixels = () => page.evaluate(() => document.querySelector<HTMLCanvasElement>('.document-preview canvas')!.toDataURL());
  await expect.poll(state).toBe('suspended'); expect(await pixels()).toBe(before);
  await page.waitForTimeout(15_300); expect(await page.evaluate(() => document.querySelector('.document-preview [role="alert"]')?.textContent)).toBeUndefined(); expect(await pixels()).toBe(before);
  await page.evaluate(() => (window as unknown as { __resumeFrames: () => void }).__resumeFrames());
  await expect(preview(page)).toHaveAttribute('data-preview-state', 'ready'); await expect.poll(() => image(page)).not.toBe(before);
});

test('pending canonical PNG survives reload and replays its stable upload command before submit can proceed', async ({ page }) => {
  const state = await fixtureHost(page, await createSigningPdfFixture());
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const ids: string[] = []; let first = true;
  await page.route('**/api/commands', async route => { const request = route.request().postDataJSON() as HostCommand; if (request.type !== 'resource.upload') return route.fallback(); ids.push(request.id); if (first) { first = false; await gate; await route.fallback().catch(() => {}); } else await route.fallback(); });
  try {
    await page.goto('/'); await expect(preview(page).getByRole('status')).toContainText('Page 1 of 2');
    await page.getByRole('textbox', { name: 'Full name', exact: true }).fill('Katherine Johnson');
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await expect.poll(() => ids.length).toBe(1);
    const pending = await page.evaluate(async () => { const path = '/src/signature-assets.tsx'; const { hasPendingDocumentAssets } = await import(path); return hasPendingDocumentAssets('pdf-thread', 'pdf-state'); }); expect(pending).toBe(true);
    const staged = await page.evaluate(() => localStorage.getItem('harness:signature-assets:v1:pdf-thread:pdf-state')); expect(staged).toContain(ids[0]);
    await expect(page.getByRole('img', { name: 'Selected visual signature' })).toBeVisible();
    await page.reload(); await expect.poll(() => ids.length).toBe(2); expect(ids[1]).toBe(ids[0]);
    await expect.poll(() => (state.snapshot.userStates[0].values.visualSignature as { kind?: string })?.kind).toBe('image');
    expect(await page.evaluate(async () => { const path = '/src/signature-assets.tsx'; return (await import(path)).hasPendingDocumentAssets('pdf-thread', 'pdf-state'); })).toBe(false);
  } finally { release(); await page.unroute('**/api/commands'); }
});

test('changing source identity clears the old pixels and highlight while retry revalidates the source', async ({ page }) => {
  const bytes = await createSigningPdfFixture(), state = await fixtureHost(page, bytes);
  await page.goto('/'); await expect(preview(page).getByRole('status')).toContainText('Page 1 of 2');
  await preview(page).getByRole('button', { name: 'Zoom out PDF' }).click(); await expect(preview(page)).toHaveAttribute('aria-busy', 'false');
  let reads = 0, release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/resources/replacement-pdf/content*', async route => { reads++; if (reads === 1) { await gate; return route.fulfill({ status: 403, json: { error: { code: 'FORBIDDEN', message: 'Synthetic replacement denial' } } }); } return route.fulfill({ contentType: 'application/pdf', body: Buffer.from(bytes) }); });
  const artifact = state.snapshot.artifacts[0]; artifact.spec!.elements.preview.props.resourceId = 'replacement-pdf';
  await page.getByRole('button', { name: 'Expand artifact' }).click();
  await expect.poll(() => reads).toBe(1);
  expect(await preview(page).locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).width)).toBe(0);
  await expect(preview(page).locator('.document-active-field')).toHaveCount(0);
  release(); await expect(preview(page).getByRole('alert')).toContainText('no longer available');
  await preview(page).getByRole('button', { name: 'Retry preview' }).click(); await expect.poll(() => reads).toBe(2); await expect(preview(page).getByRole('status')).toContainText('Page 1 of 2');
  await page.unroute('**/api/resources/replacement-pdf/content*');
});

test('a pending page change retains committed pixels, highlight and status until the candidate swap', async ({ page }) => {
  const bytes = await createSigningPdfFixture(); await fixtureHost(page, bytes); await page.goto('/'); await expect(preview(page).getByRole('status')).toContainText('Page 1 of 2');
  const before = await image(page);
  await page.evaluate(async original => {
    const path = '/src/DocumentPreview.tsx'; const { loadPdfRenderer } = await import(path); const renderer = await loadPdfRenderer();
    const probe = renderer.getDocument({ data: new Uint8Array(original), useWorkerFetch: false, useWasm: false }); const document = await probe.promise, first = await document.getPage(1);
    const prototype = Object.getPrototypeOf(first), render = prototype.render;
    prototype.render = function (this: { pageNumber: number }, ...args: unknown[]) {
      const task = render.apply(this, args); if (this.pageNumber !== 2) return task;
      const promise = task.promise.then(() => new Promise<void>(resolve => Object.assign(window, { __pendingPage2: true, __releasePage2: resolve })));
      return { promise, cancel: task.cancel.bind(task) };
    };
    await probe.destroy();
  }, Array.from(bytes));
  await preview(page).getByRole('button', { name: 'Next PDF page' }).click();
  try {
    await expect.poll(() => page.evaluate(() => (window as unknown as { __pendingPage2?: boolean }).__pendingPage2)).toBe(true);
    expect(await image(page)).toBe(before); await expect(preview(page).locator('.document-active-field')).toBeVisible(); await expect(preview(page).getByRole('status')).toContainText('Page 1 of 2');
  } finally { await page.evaluate(() => (window as unknown as { __releasePage2?: () => void }).__releasePage2?.()); }
  await expect(preview(page).getByRole('status')).toContainText('Page 2 of 2'); await expect(preview(page).locator('.document-active-field')).toHaveCount(0);
});
