import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { createSigningPdfFixture } from './document-preview-fixture';
import { serveTaskFixture, taskFixture, type TaskSpec } from './task-interface-fixture';

type PairLayout = 'Stack' | 'Split';
function signingSpec(layout: PairLayout, nested = false): TaskSpec {
  const elements: TaskSpec['elements'] = {
    column: { type: 'Stack', props: { gap: 'md' }, children: layout === 'Stack' ? ['heading', 'pdf', 'signature', 'tail'] : ['heading', 'pair', 'tail'] },
    heading: { type: 'Heading', props: { text: 'Review this agreement' } },
    pair: { type: 'Split', props: { ratio: .5 }, children: ['pdf', 'signature'] },
    pdf: { type: 'DocumentPreview', props: { resourceId: 'pdf', title: 'Agreement.pdf', fit: 'page' } },
    signature: { type: 'SignaturePad', props: { stateKey: 'signature', label: 'Signature controls', initialMode: 'draw' } },
    tail: { type: 'Text', props: { text: 'Keep this text below the signing pair.' } },
    outside: { type: 'Input', props: { stateKey: 'note', label: 'Independent note' } },
    outer: { type: 'Grid', props: { columns: 2, gap: 'md' }, children: ['column', 'outside'] },
  };
  return { root: nested ? 'outer' : 'column', elements };
}
async function mount(page: Page, spec: TaskSpec, viewport = 1440) {
  await page.setViewportSize({ width: viewport, height: 1000 });
  const source = await createSigningPdfFixture({ pages: 1 }), snapshot = taskFixture(spec);
  snapshot.resources = [{ id: 'pdf', threadId: 'task-thread', kind: 'file', path: 'C:/fixture/agreement.pdf', label: 'Agreement.pdf', writable: false, createdAt: '2026-10-30' }];
  await serveTaskFixture(page, snapshot);
  await page.route('**/api/resources/pdf/content', route => route.fulfill({ contentType: 'application/pdf', body: Buffer.from(source) }));
  const fixturePath = encodeURI('/@fs/' + resolve('tests/e2e/document-pair-fixture.tsx').replaceAll('\\', '/'));
  await page.route('**/document-pair-layout*', route => route.fulfill({ contentType: 'text/html', body: `<html data-theme="dark"><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${fixturePath}');</script></body></html>` }));
  await page.goto('/document-pair-layout?artifactWidth=900', { waitUntil: 'domcontentloaded' });
}
const pair = (page: Page) => page.locator('.document-pair');
const ready = (page: Page) => expect(page.locator('.document-preview')).toHaveAttribute('data-preview-state', 'ready', { timeout: 15000 });
async function geometry(page: Page) {
  return pair(page).evaluate(node => {
    const pdf = node.querySelector(':scope > .document-preview')!.getBoundingClientRect(), signature = node.querySelector(':scope > .signature-pad')!.getBoundingClientRect();
    return { width: node.getBoundingClientRect().width, paired: pdf.right <= signature.left && Math.abs(pdf.y - signature.y) < 1, stacked: pdf.bottom <= signature.top || signature.bottom <= pdf.top };
  });
}
async function visibleFocus(page: Page) {
  const draw = page.getByRole('button', { name: 'Draw', exact: true }); await draw.focus();
  await expect(draw).toBeFocused(); await expect(draw).toHaveCSS('outline-style', 'solid'); await expect(draw).toHaveCSS('outline-width', '2px');
  return draw;
}

for (const layout of ['Stack', 'Split'] as const) for (const viewport of [1024, 1440]) test(`nested ${layout} measures its 442px parent inside a 900px artifact at ${viewport}`, async ({ page }) => {
  await mount(page, signingSpec(layout, true), viewport); await ready(page);
  await expect(page.locator('.artifact-content')).toHaveCSS('width', '900px');
  expect((await geometry(page)).width).toBe(442); expect((await geometry(page)).stacked).toBe(true);
  const canvas = await page.locator('.document-preview canvas').elementHandle(), draw = await visibleFocus(page);
  const heading = page.getByRole('heading', { name: 'Review this agreement' }), tail = page.getByText('Keep this text below the signing pair.', { exact: true });
  for (const available of [640, 619, 619.5, 620, 442]) {
    // The artifact remains 900px; only the nested column's available width changes.
    await page.locator('.artifact-content > .surface-layout').evaluate((node, width) => { (node as HTMLElement).style.gridTemplateColumns = `minmax(0,${width}px) minmax(0,1fr)`; }, available);
    await expect.poll(async () => (await geometry(page)).paired).toBe(available >= 620);
    expect((await geometry(page)).stacked).toBe(available < 620);
    await expect(page.locator('.artifact-content')).toHaveCSS('width', '900px');
    const group = await pair(page).boundingBox(), title = await heading.boundingBox(), after = await tail.boundingBox();
    expect(title!.y + title!.height).toBeLessThanOrEqual(group!.y); expect(after!.y).toBeGreaterThanOrEqual(group!.y + group!.height);
    expect(await heading.evaluate(node => node.parentElement!.classList.contains('surface-layout'))).toBe(true);
    expect(await tail.evaluate(node => node.parentElement!.classList.contains('surface-layout'))).toBe(true);
    await expect(draw).toBeFocused(); await expect(draw).toHaveCSS('outline-width', '2px');
    expect(await page.locator('.document-preview canvas').evaluate((node, previous) => node === previous, canvas)).toBe(true);
  }
  const fit = page.getByRole('button', { name: 'Fit PDF page', exact: true }); await fit.focus();
  await expect(fit).toBeFocused(); await expect(fit).toHaveCSS('outline-width', '2px');
});

for (const columns of [1, 3]) test(`explicit ${columns}-column layout retains its authored children and columns`, async ({ page }) => {
  const spec = signingSpec('Stack'); spec.elements.column = { ...spec.elements.column, type: 'Grid', props: { columns, gap: 'md' } };
  await mount(page, spec); await ready(page);
  await expect(page.locator('.document-pair-container')).toHaveCount(0);
  const layout = page.locator('.artifact-content > .surface-layout');
  expect(await layout.evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length)).toBe(columns);
  await expect(layout.locator(':scope > *')).toHaveCount(4);
  await visibleFocus(page);
});

async function holdModule(page: Page, name: string) {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(url => url.pathname.endsWith(`/${name}.tsx`), async route => { await gate; await route.continue().catch(() => {}); });
  return release;
}
type Frame = { display: string; width: number; pdf: number[]; signature: number[]; tail: number[] };
type FrameWindow = Window & { pairFrames: Frame[]; stopPairFrames: boolean };
const frames = (page: Page) => page.evaluate(() => (window as unknown as FrameWindow).pairFrames);

for (const layout of ['Stack', 'Split'] as const) for (const nested of [false, true]) test(`${layout} reserves ${nested ? 'stacked 442px' : 'paired 900px'} geometry before lazy components resolve`, async ({ page }) => {
  const releasePdf = await holdModule(page, 'DocumentPreview'), releaseSignature = await holdModule(page, 'SignaturePad');
  await page.addInitScript(() => {
    const state = window as unknown as FrameWindow; state.pairFrames = []; state.stopPairFrames = false;
    const bounds = (node: Element) => { const box = node.getBoundingClientRect(); return [box.x, box.y, box.width, box.height]; };
    const sample = () => {
      const group = document.querySelector('.document-pair'), pdf = group?.querySelector(':scope > .document-preview'), signature = group?.querySelector(':scope > .signature-pad');
      const tail = [...document.querySelectorAll('.surface-text')].find(node => node.textContent === 'Keep this text below the signing pair.');
      if (group && pdf && signature && tail) state.pairFrames.push({ display: getComputedStyle(group).display, width: group.getBoundingClientRect().width, pdf: bounds(pdf), signature: bounds(signature), tail: bounds(tail) });
      if (!state.stopPairFrames) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  try {
    await mount(page, signingSpec(layout, nested));
    await expect(page.locator('.document-preview')).toHaveAttribute('data-preview-state', 'loading');
    await expect(page.locator('.signature-pad')).toHaveAttribute('aria-busy', 'true');
    await expect.poll(async () => (await frames(page)).length).toBeGreaterThan(0);
    expect((await geometry(page)).paired).toBe(!nested); expect((await geometry(page)).stacked).toBe(nested);
    const before = (await frames(page))[0];
    releaseSignature();
    await expect(page.locator('.signature-pad[aria-busy]')).toHaveCount(0);
    const draw = await visibleFocus(page);
    await expect(page.locator('.document-preview')).toHaveAttribute('data-preview-state', 'loading');
    releasePdf(); await ready(page); await expect(draw).toBeFocused();
    await page.evaluate(async () => { await new Promise(requestAnimationFrame); (window as unknown as FrameWindow).stopPairFrames = true; });
    const samples = await frames(page);
    for (const frame of samples) {
      expect(frame.display).toBe(nested ? 'flex' : 'grid'); expect(frame.width).toBe(nested ? 442 : 900);
      for (const field of ['pdf', 'signature', 'tail'] as const) frame[field].forEach((value, index) => expect(Math.abs(value - before[field][index])).toBeLessThan(1));
    }
  } finally { releasePdf(); releaseSignature(); }
});
