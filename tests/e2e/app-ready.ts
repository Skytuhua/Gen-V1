import {test, type Browser, type Page, type Request} from '@playwright/test';

/** App boot is the cold module-graph transform plus the first snapshot render, and
 * a loaded CI runner multiplies both. This budget covers those boot phases only —
 * assertions after the snapshot lands keep the default timeout — and it must stay
 * under the enclosing test timeout (root and micro-motion suites: 45 s). */
export const BOOT_TIMEOUT = 30_000;

/** The response the first render depends on, awaited as the host's own signal
 * rather than polling the DOM for a guessed duration. Register before `goto`. */
export const snapshotServed = (page: Page) => page.waitForResponse(response => new URL(response.url()).pathname === '/api/snapshot' && response.status() === 200, {timeout: BOOT_TIMEOUT});

/** Compile the app graph once per spec file (Playwright's `beforeAll` is per file)
 * so no individual test carries the cold transform in its own readiness assertion.
 * It is deliberately fatal: a file whose warm-up cannot complete would fail every
 * test in it anyway, and quietly continuing would hide the cost. */
export const warmApp = async (browser: Browser, baseURL: string | undefined) => {
  if (!baseURL) throw new Error('warmApp needs the suite baseURL; this project configures none.');
  const context = await browser.newContext(), page = await context.newPage();
  try { await page.goto(baseURL, {waitUntil: 'load', timeout: BOOT_TIMEOUT}); }
  catch (cause) { throw new Error(`The app graph did not finish its warm-up navigation: ${String(cause)}`); }
  finally { await context.close(); }
};

/** A module, stylesheet or document the dev server never answered. One such
 * miss aborts the whole ES module graph, so the app never mounts (blank page). */
const bootTransportFailure = (page: Page) => {
  let stop = () => {};
  const failed = new Promise<Request>(resolve => {
    const listener = (request: Request) => {
      if (['document', 'script', 'stylesheet'].includes(request.resourceType()) && !new URL(request.url()).pathname.startsWith('/api/') &&
          /^net::ERR_(CONNECTION_\w+|EMPTY_RESPONSE)$/.test(request.failure()?.errorText ?? '')) resolve(request);
    };
    page.on('requestfailed', listener); stop = () => page.off('requestfailed', listener);
  });
  return {failed, stop};
};

/** Navigate and wait for the snapshot; null when the app graph lost a request first. */
const bootOnce = async (page: Page, navigate: () => Promise<unknown>) => {
  const served = snapshotServed(page), transport = bootTransportFailure(page);
  try {
    const outcome = Promise.race([served.then(() => null), transport.failed]);
    await navigate(); const failed = await outcome;
    if (failed) served.catch(() => {});
    return failed;
  } finally { transport.stop(); }
};

/** Open the app and wait for the snapshot its first render depends on. Callers
 * assert their own content afterwards, so readiness never rides a content timeout.
 * A dev-server transport miss during boot (seen on Windows CI as ERR_CONNECTION_FAILED
 * for one stylesheet) gets exactly one annotated reload; a second miss fails the test. */
export const openApp = async (page: Page) => {
  const failed = await bootOnce(page, () => page.goto('/'));
  if (!failed) return;
  const description = `${failed.url()} ${failed.failure()?.errorText}; reloaded once`;
  test.info().annotations.push({type: 'boot-transport-retry', description}); console.warn(`[openApp] boot request failed: ${description}`);
  const again = await bootOnce(page, () => page.reload());
  if (again) throw new Error(`The app graph lost a dev-server request twice during boot: ${again.url()} ${again.failure()?.errorText}`);
};

/** Reload and wait for the snapshot the rebuilt view depends on. */
export const reloadApp = async (page: Page) => { const served = snapshotServed(page); await page.reload(); await served; };
