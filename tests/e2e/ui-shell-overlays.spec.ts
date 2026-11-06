import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const fixture = '/@fs/' + resolve('tests/e2e/ui-shell-overlays-fixture.tsx').replaceAll('\\', '/');
test.beforeEach(async ({ page }) => {
  await page.route(url => url.pathname === '/ui-shell-overlays', route => route.fulfill({
    contentType: 'text/html', body: `<html data-theme="dark" data-native-titlebar="true"><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${encodeURI(fixture)}');</script></body></html>`,
  }));
  await page.goto('/ui-shell-overlays');
});

test('a model popup belongs to its native modal and keeps selection, draft and Escape usable', async ({ page }) => {
  await page.getByRole('combobox', { name: 'Model', exact: true }).click();
  const popup = page.locator('.model-picker-popover');
  expect(await popup.evaluate(node => Boolean(node.closest('dialog[open]')))).toBe(true);
  await expect(page.getByRole('searchbox', { name: 'Search models' })).toBeFocused();
  await page.getByRole('option', { name: 'Model B', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toContainText('Model B');
  await expect(page.getByRole('textbox', { name: 'Preserved draft' })).toHaveValue('Keep this draft');
  await page.getByRole('combobox', { name: 'Model', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search models' }).press('Escape');
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toBeFocused();
  await expect(page.getByRole('dialog', { name: 'Fixture settings' })).toBeVisible();
});

test('blocking dialog backdrops blur the background without blurring their content', async ({ page }) => {
  const styles = await page.getByRole('dialog').evaluate(dialog => ({
    backdrop: getComputedStyle(dialog, '::backdrop').backdropFilter,
    content: getComputedStyle(dialog).filter,
  }));
  expect(styles.backdrop).toBe('blur(6px)');
  expect(styles.content).toBe('none');
});

test('composition Escape and Enter neither close the popup nor select a model', async ({ page }) => {
  const trigger = page.getByRole('combobox', { name: 'Model', exact: true });
  await trigger.click();
  const search = page.getByRole('searchbox', { name: 'Search models' });
  await search.press('ArrowDown');
  await search.dispatchEvent('keydown', { key: 'Escape', isComposing: true });
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await search.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await expect(trigger).toContainText('Model A');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
});

test('first opening a long catalog reveals the committed selected model', async ({ page }) => {
  await page.goto('/ui-shell-overlays?large=1');
  await page.getByRole('combobox', { name: 'Model', exact: true }).click();
  const result = await page.getByRole('option', { name: 'Catalog model 99', exact: true }).evaluate(option => {
    const bounds = option.getBoundingClientRect();
    const list = option.closest('[role="listbox"]')!.getBoundingClientRect();
    return { top: bounds.top, bottom: bounds.bottom, listTop: list.top, listBottom: list.bottom };
  });
  expect(result.top).toBeGreaterThanOrEqual(result.listTop);
  expect(result.bottom).toBeLessThanOrEqual(result.listBottom);
});

test('Escape closes a popup before its surrounding ARIA modal region', async ({ page }) => {
  await page.goto('/ui-shell-overlays?aria=1');
  const trigger = page.getByRole('combobox', { name: 'Model', exact: true });
  await trigger.click();
  await page.getByRole('searchbox', { name: 'Search models' }).press('Escape');
  await expect(page.getByRole('dialog', { name: 'Fixture settings' })).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toBeFocused();
});

for (const scenario of [
  { name: 'narrow light', viewport: { width: 390, height: 420 }, theme: 'light' },
  { name: 'short dark', viewport: { width: 280, height: 240 }, theme: 'dark' },
]) {
  test.describe(scenario.name, () => {
    test.use({ viewport: scenario.viewport, contextOptions: { reducedMotion: 'reduce' } });
    test('popup fits its first visible frame below native caption controls', async ({ page }, testInfo) => {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, scenario.theme);
      await page.getByRole('combobox', { name: 'Model', exact: true }).click();
      const popup = page.locator('.model-picker-popover');
      const bounds = await popup.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(8);
      expect(bounds!.y).toBeGreaterThanOrEqual(50);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(scenario.viewport.width - 8);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(scenario.viewport.height - 8);
      await expect(page.getByRole('searchbox', { name: 'Search models' })).toBeFocused();
      await page.screenshot({ path: testInfo.outputPath('modal-popup.png') });
    });
  });
}
