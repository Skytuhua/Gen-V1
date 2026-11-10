import { expect, type Page } from '@playwright/test';
import { basename, resolve } from 'node:path';
import { build } from 'esbuild';
import { WIDGET_WORKER_CSP } from '../../packages/widgets/protocol';
import { WIDGET_BASE_CSS } from '../../packages/widgets/theme';

let runtime: ReturnType<typeof build> | undefined;
export async function holdWidgetMount(page: Page, failFirst = false) {
  let release!: () => void, requests = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/bootstrap', route => route.fulfill({ json: { csrfToken: 'settle-fixture', widgetOrigin: 'http://localhost:4318' } }));
  await page.route('**/api/artifacts/*/mount', async route => {
    const attempt = ++requests;
    await gate;
    if (failFirst && attempt === 1) return route.fulfill({ status: 503, json: { error: { message: 'Synthetic widget mount unavailable' } } });
    return route.fulfill({ json: { url: 'http://localhost:4318/widget/task-surface#token=settle-token&mountId=settle-mount', token: 'settle-token', mountId: 'settle-mount', revision: 1 } });
  });
  const asset = async (name: string) => {
    runtime ??= build({ entryPoints: ['packages/widgets/receiver.ts', 'packages/widgets/worker.ts'], outdir: '/tmp/artifact-settle-widget-assets', bundle: true, platform: 'browser', format: 'iife', write: false });
    return (await runtime).outputFiles!.find(file => basename(file.path) === `${name}.js`)!.text;
  };
  await page.route('http://localhost:4318/widget/**', async route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>${WIDGET_BASE_CSS}</style><body data-artifact-id="task-surface"><main id="harness-root"></main><script>${await asset('receiver')}</script></body>` }));
  await page.route('**/widget-runtime/worker.js', async route => route.fulfill({ contentType: 'text/javascript', headers: { 'Content-Security-Policy': WIDGET_WORKER_CSP }, body: await asset('worker') }));
  return { release, requests: () => requests };
}

type Paint = { height: number | null; afterTop: number; pending: boolean };
type JournalWindow = Window & { artifactPaints: Paint[]; artifactJournalPending: boolean; releaseArtifactJournal: () => void };

export async function holdArtifactJournal(page: Page) {
  await page.addInitScript(() => {
    const target = window as unknown as JournalWindow;
    const gate = new Promise<void>(resolve => { target.releaseArtifactJournal = () => { target.artifactJournalPending = false; resolve(); }; });
    const open = indexedDB.open.bind(indexedDB), success = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'onsuccess')!;
    indexedDB.open = (...args) => {
      const request = open(...args);
      Object.defineProperty(request, 'onsuccess', { set(handler) {
        success.set!.call(request, (event: Event) => {
          target.artifactJournalPending = true;
          void gate.then(() => handler.call(request, event));
        });
      } });
      return request;
    };
  });
}

export async function releaseArtifactJournal(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as unknown as JournalWindow).artifactJournalPending)).toBe(true);
  await page.evaluate(async () => {
    // Let the pending state reach actual paint frames before completing the read.
    for (let frame = 0; frame < 4; frame++) await new Promise(requestAnimationFrame);
    (window as unknown as JournalWindow).releaseArtifactJournal();
  });
}

export async function serveArtifactSettleFixture(page: Page, query = '') {
  await page.addInitScript(() => {
    const target = window as unknown as JournalWindow;
    target.artifactPaints = [];
    const sample = () => {
      const shell = document.querySelector('.artifact'), following = document.querySelector('[data-after-artifact]');
      if (following) target.artifactPaints.push({ height: shell?.getClientRects().length ? shell.getBoundingClientRect().height : null, afterTop: following.getBoundingClientRect().top, pending: target.artifactJournalPending === true });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const path = encodeURI('/@fs/' + resolve('tests/e2e/artifact-settle-fixture.tsx').replaceAll('\\', '/'));
  await page.route('**/api/**', route => route.fulfill({ status: 404 }));
  await page.route(url => url.pathname === '/artifact-settle-fixture', route => route.fulfill({ contentType: 'text/html', body: `<html data-theme="dark"><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${path}');</script></body></html>` }));
  await page.goto('/artifact-settle-fixture' + query);
  await expect(page.getByRole('button', { name: 'Publish artifact', exact: true })).toBeVisible();
}

export async function expectArtifactGeometry(page: Page) {
  const final = await page.locator('.artifact').evaluate(node => ({ height: node.getBoundingClientRect().height, afterTop: document.querySelector('[data-after-artifact]')!.getBoundingClientRect().top }));
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const paints = await page.evaluate(() => (window as unknown as JournalWindow).artifactPaints);
  const painted = paints.filter(paint => paint.height !== null);
  expect(painted.length).toBeGreaterThan(0);
  for (const paint of painted) {
    expect(paint.height, 'artifact height from its first painted frame').toBe(final.height);
    expect(paint.afterTop, 'following conversation position from the first artifact paint').toBe(final.afterTop);
  }
  return { final, paints };
}
