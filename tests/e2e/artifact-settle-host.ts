import { expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

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
