import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const fixture = '/@fs/' + resolve('tests/e2e/database-visual-fixture.tsx').replaceAll('\\', '/');
const out = process.env.DATABASE_VISUAL_OUTPUT ?? 'database-visual';
test.beforeEach(async ({ page }) => {
  await page.route(url => url.pathname === '/database-visual', route => route.fulfill({
    contentType: 'text/html', body: `<html data-theme="dark"><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${encodeURI(fixture)}');</script></body></html>`,
  }));
});

/** T09 visual evidence: one screenshot per state required by #1348 VISUAL_DESIGN_AND_MOTION. */
const shot = async (page: Page, query: string, name: string) => {
  await page.goto(`/database-visual?${query}`);
  await expect(page.locator('main')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
};

test('database visual states', async ({ page }) => {
  await shot(page, 'view=tree&theme=dark', 'tree-dark');
  await shot(page, 'view=tree&theme=light&filter=orders', 'tree-light-filtered');
  await shot(page, 'view=grid&theme=dark', 'grid-dark');
  await shot(page, 'view=grid&theme=light&density=compact', 'grid-light-compact');
  await shot(page, 'view=grid&theme=dark&density=touch', 'grid-dark-touch');
  await shot(page, 'view=grid-draft&theme=dark', 'grid-draft-edit');
  await shot(page, 'view=grid-empty&theme=dark', 'grid-empty');
  await shot(page, 'view=skeleton&theme=dark', 'skeleton-dark');
  await shot(page, 'view=card&theme=dark', 'card-dark');
  await shot(page, 'view=card&theme=light', 'card-light');
  await shot(page, 'view=empty&theme=dark', 'empty-dark');
  await shot(page, 'view=error&theme=dark', 'error-dark');
  for (const zoom of ['1.25', '1.5']) {
    await page.goto('/database-visual?view=grid&theme=dark');
    await page.evaluate(value => { document.body.style.zoom = value; }, zoom);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${out}/grid-zoom-${zoom.replace('.', '')}.png` });
    await page.evaluate(() => { document.body.style.zoom = ''; });
  }
});

test('reduced motion drops grid/card animations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/database-visual?view=card&theme=dark');
  const grid = page.locator('.query-result-grid');
  await expect(grid).toBeVisible();
  expect(await grid.evaluate(node => getComputedStyle(node).animationName)).toBe('none');
  expect(await page.locator('.query-result-card').evaluate(node => getComputedStyle(node).animationName)).toBe('none');
});
