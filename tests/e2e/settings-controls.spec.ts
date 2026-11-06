import { expect, test, type Locator, type Page } from '@playwright/test';
import type { HostCommand } from '../../packages/contracts';
import { getPreferences, type UiPreferences } from '../../packages/contracts/preferences';
import { serveTaskFixture, taskFixture } from './task-interface-fixture';

async function openSettings(page: Page, theme: 'dark' | 'light' = 'dark') {
  const snapshot = taskFixture({ root: 'text', elements: { text: { type: 'Text', props: { text: 'Settings regression fixture' } } } });
  snapshot.settings.theme = theme;
  const host = await serveTaskFixture(page, snapshot);
  await page.route('**/api/commands', async route => {
    const command = route.request().postDataJSON() as HostCommand;
    if (command.type !== 'settings.update') return route.fallback();
    host.commands.push(command);
    snapshot.settings.preferences = { ...getPreferences(snapshot.settings), ...(command.payload.preferences as Partial<UiPreferences>) };
    snapshot.seq++;
    await route.fulfill({ json: { commandId: command.id, seq: snapshot.seq, result: {} } });
  });
  await page.route('**/api/workspace', route => route.fulfill({ json: { projects: [], state: { version: 1, revision: 0, activeCanvasId: 'workspace-default', canvases: [{ version: 1, id: 'workspace-default', name: 'Workspace', preset: 'workspace', viewport: { x: 0, y: 0, zoom: 1 }, panels: [], filter: 'active', projectIds: [] }], profiles: [], disabledKinds: [], integrations: {} } } }));
  await page.route('**/api/environment', route => route.fulfill({ json: { revision: 0, entries: [], secretStorageAvailable: false } }));
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await expect(composer).toBeEnabled();
  await composer.fill('Retain this conversation draft');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(dialog).toBeVisible();
  return { ...host, dialog, composer, nav: dialog.getByRole('navigation', { name: 'Settings sections' }), search: dialog.getByRole('searchbox', { name: 'Search all settings' }) };
}

async function scalarText(content: Locator) {
  return content.evaluate(node => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const numbers: string[] = [];
    while (walker.nextNode()) if (/^\s*\d+\s*$/.test(walker.currentNode.textContent ?? '') && walker.currentNode.parentElement === node) numbers.push(walker.currentNode.textContent!.trim());
    return numbers;
  });
}

test('Environments and every section stay free of stray scalars through blank, matching, empty and reset search', async ({ page }, info) => {
  const { dialog, nav, search, composer } = await openSettings(page);
  await nav.getByRole('button', { name: 'Environments', exact: true }).click();
  await expect(dialog.getByText('No variables configured.', { exact: true })).toBeVisible();
  await dialog.screenshot({ path: info.outputPath('environments.png') });
  expect(await scalarText(dialog.locator('main'))).toEqual([]);
  for (const label of await nav.getByRole('button').allTextContents()) {
    await nav.getByRole('button', { name: label, exact: true }).click();
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(dialog.getByRole('heading', { level: 1, name: label, exact: true })).toBeVisible();
    expect(await scalarText(dialog.locator('main')), `${label}: blank`).toEqual([]);
    await search.fill('chat width');
    await expect(dialog.locator('[data-setting-id="chat-width"]')).toBeVisible();
    await expect(nav.locator('[aria-current]')).toHaveCount(0);
    expect(await scalarText(dialog.locator('main')), `${label}: matching`).toEqual([]);
    await search.fill('no-match-9f8c7b6a');
    if (label !== 'Skills & learning') await expect(dialog.getByText('No matching settings.', { exact: true })).toBeVisible();
    expect(await scalarText(dialog.locator('main')), `${label}: empty results`).toEqual([]);
    await search.fill('   ');
    await expect(nav.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
    expect(await scalarText(dialog.locator('main')), `${label}: reset`).toEqual([]);
  }
  await nav.getByRole('button', { name: 'About', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Gen updates' })).toBeVisible();
  await search.fill('update');
  await expect(dialog.getByRole('region', { name: 'Gen updates' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(composer).toHaveValue('Retain this conversation draft');
});

test('preferences and supported environment actions remain usable after search reset', async ({ page }) => {
  const { dialog, nav, search, snapshot, commands } = await openSettings(page);
  await search.fill('chat width');
  await dialog.getByRole('combobox', { name: 'Chat width', exact: true }).selectOption('wide');
  await expect.poll(() => commands.filter(command => command.type === 'settings.update').map(command => command.payload)).toEqual([{ preferences: { chatWidth: 'wide' } }]);
  await expect(dialog.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Chat width', exact: true })).toHaveValue('wide');
  await nav.getByRole('button', { name: 'Environments', exact: true }).click();
  await expect(search).toHaveValue('');
  const entry = { scope: 'device', name: 'EXAMPLE_VALUE', secret: false, updatedAt: '2026-11-05T00:00:00.000Z' };
  const mutations: { method: string; payload: Record<string, unknown> }[] = [];
  await page.route('**/api/environment', async route => {
    const request = route.request();
    mutations.push({ method: request.method(), payload: request.postDataJSON() });
    await route.fulfill({ json: { revision: mutations.length, entries: request.method() === 'PUT' ? [entry] : [], secretStorageAvailable: false } });
  });
  await dialog.getByLabel('Store as a protected secret', { exact: true }).uncheck();
  await dialog.getByLabel('Variable name', { exact: true }).fill('EXAMPLE_VALUE');
  await dialog.getByLabel('Value', { exact: true }).fill('synthetic-value');
  snapshot.seq++;
  await page.evaluate(seq => window.dispatchEvent(new CustomEvent('task-fixture-update', { detail: seq })), snapshot.seq);
  await expect(dialog.getByLabel('Value', { exact: true })).toHaveValue('synthetic-value');
  await dialog.getByRole('button', { name: 'Save variable', exact: true }).click();
  await expect(dialog.getByText('EXAMPLE_VALUE', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(dialog.getByText('No variables configured.', { exact: true })).toBeVisible();
  expect(mutations).toEqual([
    { method: 'PUT', payload: { scope: 'device', name: 'EXAMPLE_VALUE', value: 'synthetic-value', secret: false, baseRevision: 0 } },
    { method: 'DELETE', payload: { scope: 'device', name: 'EXAMPLE_VALUE', baseRevision: 1 } },
  ]);
});

for (const theme of ['dark', 'light'] as const) for (const zoom of [1, 1.25, 1.5]) {
  test(`${theme} navigation keeps selected Labs, hovered About and keyboard focus separate at ${zoom * 100}% CSS zoom`, async ({ page }, info) => {
    const { dialog, nav } = await openSettings(page, theme);
    await page.evaluate(value => { document.documentElement.style.zoom = String(value); }, zoom);
    const labs = nav.getByRole('button', { name: 'Labs', exact: true }), about = nav.getByRole('button', { name: 'About', exact: true });
    await labs.click();
    await about.hover();
    await dialog.screenshot({ path: info.outputPath('navigation.png') });
    const selected = await labs.boundingBox(), hovered = await about.boundingBox();
    expect(hovered!.y - selected!.y - selected!.height).toBeGreaterThanOrEqual(4 * zoom - 0.1);
    await expect(nav.locator('[aria-current]')).toHaveCount(1);
    await expect(labs).toHaveAttribute('aria-current', 'page');
    await expect(about).not.toHaveAttribute('aria-current');
    const selectedStyle = await labs.evaluate(node => { const style = getComputedStyle(node); return [style.backgroundColor, style.boxShadow]; });
    await expect.poll(() => about.evaluate(node => { const style = getComputedStyle(node); return [style.backgroundColor, style.boxShadow]; })).not.toEqual(selectedStyle);
    await page.keyboard.press('Tab');
    await expect(about).toBeFocused();
    const focus = await about.evaluate(node => { const style = getComputedStyle(node); return { visible: node.matches(':focus-visible'), width: style.outlineWidth, offset: style.outlineOffset, style: style.outlineStyle }; });
    expect(focus.visible).toBe(true);
    expect(focus.style).toBe('solid');
    expect(parseFloat(focus.width) * zoom).toBeGreaterThanOrEqual(1.9);
    expect(parseFloat(focus.offset)).toBe(-parseFloat(focus.width));
    await expect(labs).toHaveAttribute('aria-current', 'page');
    const geometry = await nav.getByRole('button').evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(node);
      const text = range.getBoundingClientRect();
      return { label: node.textContent, height: rect.height, width: rect.width, unclipped: text.left >= rect.left && text.right <= rect.right && text.top >= rect.top && text.bottom <= rect.bottom, overflow: node.scrollWidth > node.clientWidth };
    }));
    expect(geometry.filter(row => row.height < 32 * zoom - 0.1 || row.width < 32 * zoom - 0.1 || !row.unclipped || row.overflow)).toEqual([]);
    const longLabel = nav.getByRole('button', { name: 'Bundled integrations' });
    await longLabel.evaluate(node => { node.textContent = 'Bundled integrations with a longer localized label'; });
    await longLabel.scrollIntoViewIfNeeded();
    expect(await longLabel.evaluate(node => { const range = document.createRange(); range.selectNodeContents(node); const text = range.getBoundingClientRect(), rect = node.getBoundingClientRect(); return text.right <= rect.right && text.bottom <= rect.bottom && node.scrollWidth <= node.clientWidth; })).toBe(true);
    await dialog.screenshot({ path: info.outputPath('long-label.png') });
  });
}
