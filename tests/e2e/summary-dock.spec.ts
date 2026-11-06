import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const fixture = '/@fs/' + resolve('tests/e2e/summary-dock-fixture.tsx').replaceAll('\\', '/');
test.beforeEach(async ({ page }) => {
  await page.route(url => url.pathname === '/summary-dock', route => route.fulfill({ contentType: 'text/html',
    body: `<html data-theme="dark"><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${encodeURI(fixture)}');</script></body></html>`,
  }));
  await page.goto('/summary-dock');
});

test('clicking the overview title collapses its body exactly once', async ({ page }) => {
  const panel = page.getByRole('region', { name: 'Project overview window', exact: true });
  await expect(panel.getByRole('textbox', { name: 'Overview draft' })).toBeVisible();
  await panel.getByText('Project overview', { exact: true }).click();
  await expect(panel).toHaveAttribute('data-collapsed', 'true');
  await expect(panel.getByRole('textbox', { name: 'Overview draft' })).toBeHidden();
});

test('the disclosure target covers the full header, including its blank area', async ({ page }) => {
  const panel = page.getByRole('region', { name: 'Project overview window', exact: true });
  const button = panel.getByRole('button', { name: /(?:Collapse|Minimize) Project overview/ });
  const target = await button.boundingBox(), bounds = await panel.boundingBox();
  expect(target!.width).toBeGreaterThanOrEqual(bounds!.width - 4);
});

test('keyboard collapse keeps body identity and body actions independent', async ({ page }) => {
  const panel = page.getByRole('region', { name: 'Project overview window', exact: true });
  const draft = panel.getByRole('textbox', { name: 'Overview draft' }), original = await draft.elementHandle();
  await draft.fill('Preserve this overview edit');
  await panel.getByRole('button', { name: 'Open full plan' }).click();
  await expect(page.getByRole('status', { name: 'Body actions' })).toHaveText('1');
  await expect(panel).toHaveAttribute('data-collapsed', 'false');
  const toggle = panel.getByRole('button', { name: 'Collapse Project overview' });
  const bodyId = await toggle.getAttribute('aria-controls');
  await toggle.focus(); await toggle.press('Enter');
  await expect(panel.locator(`[id="${bodyId}"]`)).toHaveAttribute('inert', '');
  await panel.getByRole('button', { name: 'Expand Project overview' }).press('Space');
  expect(await draft.evaluate((node, previous) => node === previous, original)).toBe(true);
  await expect(draft).toHaveValue('Preserve this overview edit');
});

test('external expansion preserves field focus and is not replayed on hide/reveal', async ({ page }) => {
  const panel = page.getByRole('region', { name: 'Project overview window', exact: true });
  await panel.getByText('Project overview', { exact: true }).click();
  const main = page.getByRole('textbox', { name: 'Main draft' }); await main.focus();
  await page.evaluate(() => window.dispatchEvent(new Event('summary-expand')));
  await expect(panel).toHaveAttribute('data-collapsed', 'false'); await expect(main).toBeFocused();
  await panel.getByText('Project overview', { exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('summary-hide')));
  await page.evaluate(() => window.dispatchEvent(new Event('summary-show')));
  await expect(panel).toHaveAttribute('data-collapsed', 'true');
  await page.evaluate(() => window.dispatchEvent(new Event('summary-expand')));
  await expect(panel).toHaveAttribute('data-collapsed', 'false');
});

test('Escape respects composition and collapse restores the disclosure focus', async ({ page }) => {
  const panel = page.getByRole('region', { name: 'Project overview window', exact: true });
  const draft = panel.getByRole('textbox', { name: 'Overview draft' }); await draft.focus();
  await draft.dispatchEvent('keydown', { key: 'Escape', isComposing: true });
  await expect(panel).toHaveAttribute('data-collapsed', 'false');
  await draft.press('Escape');
  await expect(panel.getByRole('button', { name: 'Expand Project overview' })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(panel).toBeVisible();
});

test('explicit reopening focuses the header and hiding restores its connected opener', async ({ page }) => {
  await page.goto('/summary-dock?focus=1');
  const panel = page.getByRole('region', { name: 'Project overview window', exact: true });
  const main = page.getByRole('textbox', { name: 'Main draft' }); await main.focus();
  await page.evaluate(() => window.dispatchEvent(new Event('summary-hide')));
  await page.evaluate(() => window.dispatchEvent(new Event('summary-show')));
  await expect(panel.getByRole('button', { name: 'Collapse Project overview' })).toBeFocused();
  await panel.getByRole('textbox', { name: 'Overview draft' }).focus();
  await page.evaluate(() => window.dispatchEvent(new Event('summary-hide')));
  await expect(main).toBeFocused();
});

test('usage preference and cold reload retain collapse without stale visibility keys', async ({ page }) => {
  const usage = page.getByRole('region', { name: 'Live usage', exact: true });
  await usage.getByRole('button', { name: 'Inspect live usage' }).click();
  await expect(usage).toContainText('18% used');
  await page.getByRole('button', { name: 'Toggle usage preference' }).click(); await expect(usage).toHaveCount(0);
  await page.getByRole('button', { name: 'Toggle usage preference' }).click();
  await expect(usage).toHaveAttribute('data-collapsed', 'false');
  await usage.getByRole('button', { name: 'Minimize live usage' }).click();
  await page.reload(); await expect(usage).toHaveAttribute('data-collapsed', 'true');
  expect(await page.evaluate(() => (window as unknown as Window & { summaryResizeCount: number }).summaryResizeCount)).toBe(0);
});

for (const scenario of [
  { width: 1000, height: 650 }, { width: 706, height: 500 }, { width: 705, height: 500 },
  { width: 680, height: 390 }, { width: 390, height: 600 },
]) {
  test.describe(`${scenario.width}x${scenario.height} cold owner`, () => {
    test.use({ viewport: scenario });
    test('keeps headers inside the dock and reserves chat space with delayed content', async ({ page }, testInfo) => {
      await page.goto('/summary-dock?delayed=1'); await expect(page.getByTestId('delayed-details')).toBeVisible();
      const boxes = await page.evaluate(() => {
        const rect = (selector: string) => { const b = document.querySelector(selector)!.getBoundingClientRect(); return { x: b.x, y: b.y, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
        return { owner: rect('.summary-layout-owner'), chat: rect('.workspace'), dock: rect('.summary-dock'),
          headers: [...document.querySelectorAll('.docked-summary-header')].map(node => { const b = node.getBoundingClientRect(); return { x: b.x, right: b.right, y: b.y, bottom: b.bottom,
            uncovered: node.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)) }; }),
          overflow: document.documentElement.scrollWidth - innerWidth,
          resizes: (window as unknown as Window & { summaryResizeCount: number }).summaryResizeCount };
      });
      expect(boxes.resizes).toBe(0); expect(boxes.overflow).toBeLessThanOrEqual(1);
      for (const header of boxes.headers) {
        expect(header.uncovered).toBe(true);
        expect(header.x).toBeGreaterThanOrEqual(boxes.dock.x); expect(header.right).toBeLessThanOrEqual(boxes.dock.right + 1);
        expect(header.y).toBeGreaterThanOrEqual(boxes.dock.y); expect(header.bottom).toBeLessThanOrEqual(boxes.dock.bottom + 1);
      }
      if (scenario.width >= 706) {
        expect(boxes.chat.width).toBeGreaterThanOrEqual(420); expect(boxes.chat.right).toBeLessThanOrEqual(boxes.dock.x);
      } else {
        expect(boxes.chat.height).toBeGreaterThanOrEqual(240); expect(boxes.dock.y).toBeGreaterThanOrEqual(boxes.chat.bottom);
        expect(boxes.dock.height).toBeLessThanOrEqual(boxes.owner.height * .45 + 1);
      }
      await page.screenshot({ path: testInfo.outputPath('summary-dock.png') });
    });
  });
}
