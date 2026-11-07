import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const fixture = '/@fs/' + resolve('tests/e2e/project-picker-fixture.tsx').replaceAll('\\', '/');
test.beforeEach(async ({ page }) => {
  await page.route(url => url.pathname === '/project-picker', route => route.fulfill({ contentType: 'text/html', body: `<html data-theme="dark" data-native-titlebar="true"><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${encodeURI(fixture)}');</script></body></html>` }));
  await page.goto('/project-picker');
});

test('cancel creates no thread, retains draft and restores the opener; Add project delegates once', async ({ page }) => {
  const opener = page.getByRole('button', { name: 'Open project picker', exact: true });
  await opener.click();
  await expect(page.getByRole('combobox', { name: 'Search projects' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(page.getByLabel('Created threads')).toHaveText('0');
  await expect(page.getByLabel('Preserved draft')).toHaveValue('Keep my draft');
  await opener.click(); await page.getByRole('button', { name: 'Add project', exact: true }).click();
  await expect(page.getByLabel('Connection requests')).toHaveText('1');
  await expect(page.getByLabel('Created threads')).toHaveText('0');
});

test('search matches exact supplied location and name, preserves caret keys and IME', async ({ page }) => {
  await page.getByRole('button', { name: 'Open project picker', exact: true }).click();
  const search = page.getByRole('combobox', { name: 'Search projects' });
  await search.fill('Synthetic/Beta');
  await expect(page.getByRole('option', { name: 'Beta', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Alpha', exact: true })).toHaveCount(0);
  await search.press('Home'); await search.press('ArrowRight');
  expect(await search.evaluate(node => (node as HTMLInputElement).selectionStart)).toBe(1);
  await search.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await search.dispatchEvent('keydown', { key: 'Escape', keyCode: 229 });
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Created threads')).toHaveText('0');
  await search.press('Enter');
  await expect(page.getByLabel('Created threads')).toHaveText('1');
});

test('hover does not select; arrows announce an active row and explicit selection commits once', async ({ page }) => {
  await page.getByRole('button', { name: 'Open project picker', exact: true }).click();
  const alpha = page.getByRole('option', { name: 'Alpha', exact: true }), beta = page.getByRole('option', { name: 'Beta', exact: true });
  await expect(alpha).toHaveAttribute('aria-selected', 'true');
  await beta.hover(); await expect(alpha).toHaveAttribute('aria-selected', 'true');
  const search = page.getByRole('combobox', { name: 'Search projects' });
  await search.press('ArrowDown');
  await expect(search).toHaveAttribute('aria-activedescendant', await beta.getAttribute('id') ?? '');
  await search.press('Enter'); await search.press('Enter');
  await expect(page.getByLabel('Created threads')).toHaveText('1');
});

test('personal No project is explicit and foreign namespaces never enter the list', async ({ page }) => {
  await page.getByRole('button', { name: 'Open project picker', exact: true }).click();
  await expect(page.getByRole('option', { name: 'Foreign', exact: true })).toHaveCount(0);
  await page.getByRole('option', { name: 'No project', exact: true }).click();
  await expect(page.getByLabel('Created threads')).toHaveText('1');
  await page.goto('/project-picker?plugin=1');
  await page.getByRole('button', { name: 'Open project picker', exact: true }).click();
  await expect(page.getByRole('option', { name: 'No project', exact: true })).toHaveCount(0);
  await expect(page.getByRole('option', { name: 'Alpha', exact: true })).toHaveCount(0);
  await expect(page.getByRole('option', { name: 'Foreign', exact: true })).toBeVisible();
});

test('custom and palette overrides update the actual sidebar badge, survive reload and reset to fallback', async ({ page }) => {
  const badge = page.locator('.thread-project-monogram').first();
  const fallback = await badge.evaluate(node => getComputedStyle(node).color);
  await page.getByRole('button', { name: 'Open project picker', exact: true }).click();
  await page.getByRole('button', { name: 'Color for Alpha' }).click();
  await page.getByRole('button', { name: 'rose', exact: true }).click();
  await expect(badge).toHaveCSS('color', 'rgb(232, 72, 118)');
  await page.getByRole('button', { name: 'Color for Alpha' }).click();
  await page.getByRole('textbox', { name: 'Custom color' }).fill('#12ab34');
  await page.getByRole('button', { name: 'Save color', exact: true }).click();
  await expect(badge).toHaveCSS('color', 'rgb(18, 171, 52)');
  await page.keyboard.press('Escape'); await page.reload();
  await expect(badge).toHaveCSS('color', 'rgb(18, 171, 52)');
  await page.getByRole('button', { name: 'Open project picker', exact: true }).click();
  await page.getByRole('button', { name: 'Color for Alpha' }).click();
  await page.getByRole('button', { name: 'Use automatic color' }).click();
  await expect(badge).toHaveCSS('color', fallback);
  await expect(page.getByLabel('Created threads')).toHaveText('0');
});

test('invalid custom data and host save failure retain the picker and previous badge', async ({ page }) => {
  await page.goto('/project-picker?fail-color=1');
  const badge = page.locator('.thread-project-monogram').first(), before = await badge.evaluate(node => getComputedStyle(node).color);
  await page.getByRole('button', { name: 'Open project picker', exact: true }).click();
  await page.getByRole('button', { name: 'Color for Alpha' }).click();
  await page.getByRole('textbox', { name: 'Custom color' }).fill('url(bad)');
  await page.getByRole('button', { name: 'Save color', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('six-digit');
  await page.getByRole('textbox', { name: 'Custom color' }).fill('#123abc');
  await page.getByRole('button', { name: 'Save color', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Synthetic save failed');
  await expect(badge).toHaveCSS('color', before);
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Color for Alpha' })).toBeFocused();
});

test('creation failure does not dismiss or falsely report success', async ({ page }) => {
  await page.goto('/project-picker?fail=1');
  await page.getByRole('button', { name: 'Open project picker', exact: true }).click();
  await page.getByRole('option', { name: 'Alpha', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Synthetic creation failed');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Created threads')).toHaveText('0');
});

for (const theme of ['dark', 'light']) test(`first-open selected row, scrolling and nested color fit a short narrow ${theme} window`, async ({ page }, info) => {
  await page.setViewportSize({ width: 400, height: 340 });
  await page.goto('/project-picker?last=1');
  await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
  await page.getByRole('button', { name: 'Open project picker', exact: true }).click();
  const dialog = page.getByRole('dialog'), last = page.getByRole('option', { name: 'Project 59', exact: true });
  await expect(last).toBeInViewport();
  const box = await dialog.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(8); expect(box!.y).toBeGreaterThanOrEqual(50);
  expect(box!.x + box!.width).toBeLessThanOrEqual(392); expect(box!.y + box!.height).toBeLessThanOrEqual(332);
  await expect(page.getByRole('button', { name: 'Add project', exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath(`project-picker-list-${theme}.png`) });
  await page.getByRole('button', { name: 'Color for Project 59' }).click();
  const popup = page.getByRole('group', { name: 'Project color' });
  const pop = await popup.boundingBox(); expect(pop!.x).toBeGreaterThanOrEqual(8); expect(pop!.y).toBeGreaterThanOrEqual(50);
  expect(pop!.x + pop!.width).toBeLessThanOrEqual(392); expect(pop!.y + pop!.height).toBeLessThanOrEqual(332);
  expect(await popup.evaluate(node => Boolean(node.closest('dialog:modal')))).toBe(true);
  await page.screenshot({ path: info.outputPath(`project-picker-${theme}.png`) });
});

test('compact rows and actions remain reachable in a 320 by 280 window', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 280 });
  await page.getByRole('button', { name: 'Open project picker', exact: true }).click();
  const search = page.getByRole('combobox', { name: 'Search projects' });
  await search.fill('No project');
  const row = page.getByRole('option', { name: 'No project', exact: true });
  expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(32);
  await expect(page.getByRole('button', { name: 'Add project', exact: true })).toBeInViewport();
  await search.fill('Alpha');
  await expect(page.getByRole('option', { name: 'Alpha', exact: true })).toBeInViewport();
  const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
  const box = await cancel.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(272);
});

test('catalog replacement cannot commit a removed active project', async ({ page }) => {
  await page.getByRole('button', { name: 'Open project picker', exact: true }).click();
  await page.getByRole('button', { name: 'Update projects' }).dispatchEvent('click');
  await expect(page.getByRole('option', { name: 'Alpha', exact: true })).toHaveCount(0);
  const search = page.getByRole('combobox', { name: 'Search projects' });
  await search.fill('Beta'); await search.press('Enter');
  await expect(page.getByLabel('Created threads')).toHaveText('1');
});

test('supplied recent order is independent of committed selection and four-pixel row spacing', async ({ page }) => {
  await page.goto('/project-picker?recent=1');
  await page.getByRole('button', { name: 'Open project picker', exact: true }).click();
  const rows = page.getByRole('option');
  await expect(rows.nth(0)).toHaveAccessibleName('No project');
  await expect(rows.nth(1)).toHaveAccessibleName('Beta');
  await expect(rows.nth(2)).toHaveAccessibleName('Alpha');
  await expect(rows.nth(2)).toHaveAttribute('aria-selected', 'true');
  const first = await rows.nth(1).boundingBox(), second = await rows.nth(2).boundingBox();
  expect(second!.y - first!.y - first!.height).toBe(4);
});

test('unrelated snapshots preserve user scrolling after first-open selected-row reveal', async ({ page }) => {
  await page.goto('/project-picker?last=1');
  await page.getByRole('button', { name: 'Open project picker', exact: true }).click();
  await expect(page.getByRole('option', { name: 'Project 59', exact: true })).toBeInViewport();
  const list = page.getByRole('listbox', { name: 'Projects' });
  await list.evaluate(node => { node.scrollTop = 0; });
  await page.getByRole('button', { name: 'Unrelated update 0' }).dispatchEvent('click');
  await expect.poll(() => list.evaluate(node => node.scrollTop)).toBe(0);
});
