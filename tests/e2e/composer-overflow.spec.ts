import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

type FixtureWindow = Window & { composerOverflowFixture: { calls: string[]; setDisabled: (disabled: boolean) => void; unmount: () => void } };

async function fixture(page: Page) {
  const path = encodeURI('/@fs/' + resolve('tests/e2e/composer-overflow-fixture.tsx').replaceAll('\\', '/'));
  await page.route('**/composer-overflow-fixture?*', route => route.fulfill({ contentType: 'text/html', body: `<html data-theme="dark"><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${path}');</script></body></html>` }));
  await page.goto('/composer-overflow-fixture?');
  await expect(page.getByRole('button', { name: 'Select project', exact: true })).toBeEnabled();
}

const calls = (page: Page) => page.evaluate(() => (window as unknown as FixtureWindow).composerOverflowFixture.calls.splice(0));

// Distinct rows: entry row plus the footer's two control groups (which stack
// when .composer-footer-main wraps).
async function rows(page: Page) {
  return page.evaluate(() => {
    const tops = new Set<number>();
    for (const sel of ['.composer-entry-row', '.composer-project-controls', '.composer-runtime-controls']) {
      const el = document.querySelector(sel);
      if (el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height) tops.add(Math.round(el.getBoundingClientRect().top));
    }
    return tops.size;
  });
}

test.describe('composer overflow collapse', () => {
  for (const width of [1280, 900, 700]) {
    test(`tier-2 controls stay inline at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await fixture(page);
      await expect(page.getByRole('button', { name: 'More composer actions' })).toBeHidden();
      await expect(page.getByRole('button', { name: 'Inspect changes', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Create PR', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Saved drafts' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Inspect context usage' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Show live usage' })).toBeVisible();
      expect(await rows(page)).toBeLessThanOrEqual(2);
      await page.locator('.composer').screenshot({ path: testInfo.outputPath(`composer-${width}.png`) });
    });
  }

  test('tier-2 controls collapse into the overflow menu at 500px', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 500, height: 900 });
    await fixture(page);
    await page.locator('.composer').screenshot({ path: testInfo.outputPath('composer-500.png') });
    await expect(page.getByRole('button', { name: 'Inspect changes', exact: true })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Create PR', exact: true })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Saved drafts' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Inspect context usage' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Show live usage' })).toBeHidden();
    const trigger = page.getByRole('button', { name: 'More composer actions' });
    await expect(trigger).toBeVisible();

    await trigger.click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    for (const name of ['Saved drafts', 'Inspect changes', 'Create PR', 'Show live usage', 'Inspect context usage', 'Start voice input']) {
      await expect(menu.getByRole('menuitem', { name }).or(menu.getByRole('menuitemcheckbox', { name }))).toBeVisible();
    }
    await page.locator('body').screenshot({ path: testInfo.outputPath('composer-500-menu.png') });

    // Every menu item still performs its action.
    await menu.getByRole('menuitem', { name: 'Inspect changes' }).click();
    expect(await calls(page)).toEqual(['changes']);
  });

  test('keyboard: arrow navigation, enter activates, escape restores focus', async ({ page }) => {
    await page.setViewportSize({ width: 500, height: 900 });
    await fixture(page);
    const trigger = page.getByRole('button', { name: 'More composer actions' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    expect(await calls(page)).toEqual(['changes']);
    await expect(trigger).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('disabled menu items keep their tooltips', async ({ page }) => {
    await page.setViewportSize({ width: 500, height: 900 });
    await fixture(page);
    await page.evaluate(() => (window as unknown as FixtureWindow).composerOverflowFixture.setDisabled(true));
    await page.getByRole('button', { name: 'More composer actions' }).click();
    const item = page.getByRole('menu').getByRole('menuitem', { name: 'Inspect changes' });
    await expect(item).toBeDisabled();
    await expect(item).toHaveAttribute('title', 'Inspect recorded changes');
  });
});
