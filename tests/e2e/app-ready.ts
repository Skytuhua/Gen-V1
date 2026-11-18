import type {Browser, Page} from '@playwright/test';

/** App boot is the cold module-graph transform plus the first snapshot render, and
 * a loaded CI runner multiplies both. This budget covers those boot phases only;
 * assertions that run after the snapshot lands keep the default timeout. */
export const BOOT_TIMEOUT = 60_000;

/** The response the first render depends on, awaited as the host's own signal
 * rather than polling the DOM for a guessed duration. Register before `goto`. */
export const snapshotServed = (page: Page) => page.waitForResponse(response => new URL(response.url()).pathname === '/api/snapshot' && response.status() === 200, {timeout: BOOT_TIMEOUT});

/** Compile the app graph once per worker so no individual test carries the cold
 * transform inside its own readiness assertion. */
export const warmApp = async (browser: Browser, baseURL?: string) => {
  const context = await browser.newContext(), page = await context.newPage();
  try { await page.goto(baseURL ?? '/', {waitUntil: 'load', timeout: BOOT_TIMEOUT}); }
  catch (cause) { throw new Error(`The app graph did not finish its warm-up navigation: ${String(cause)}`); }
  finally { await context.close(); }
};

/** Open the app and wait for the snapshot its first render depends on. Callers
 * assert their own content afterwards, so readiness never rides a content timeout. */
export const openApp = async (page: Page) => { const served = snapshotServed(page); await page.goto('/'); await served; };

/** Reload and wait for the snapshot the rebuilt view depends on. */
export const reloadApp = async (page: Page) => { const served = snapshotServed(page); await page.reload(); await served; };
