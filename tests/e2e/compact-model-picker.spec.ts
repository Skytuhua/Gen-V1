import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { serveTaskFixture, taskFixture } from './task-interface-fixture';

const fixture = '/@fs/' + resolve('tests/e2e/compact-model-picker-fixture.tsx').replaceAll('\\', '/');
const trigger = (page: Page) => page.getByRole('combobox', { name: 'Model', exact: true });
const search = (page: Page) => page.getByRole('searchbox', { name: 'Search models', exact: true });
test.beforeEach(async ({ page }) => {
  await page.route(url => url.pathname === '/compact-model-picker', route => route.fulfill({
    contentType: 'text/html', body: `<html data-theme="dark" data-native-titlebar="true"><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${encodeURI(fixture)}');</script></body></html>`,
  }));
  await page.goto('/compact-model-picker');
});

test('wide picker keeps readable rows, a filter rail and a reasoning side panel', async ({ page }) => {
  await trigger(page).click();
  const popup = page.locator('.model-picker-popover');
  await popup.evaluate(node => Promise.all(node.getAnimations().map(a => a.finished)));
  const box = (await popup.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(680); expect(box.width).toBeLessThanOrEqual(760);
  const list = (await page.getByRole('listbox', { name: 'Available models' }).boundingBox())!;
  const panel = (await page.getByRole('group', { name: 'Reasoning', exact: true }).boundingBox())!;
  expect(panel.x).toBeGreaterThanOrEqual(list.x + list.width);
  const rail = (await page.getByRole('group', { name: 'Model filters' }).boundingBox())!;
  expect(rail.x + rail.width).toBeLessThanOrEqual(list.x);
  await expect(page.getByRole('listbox', { name: 'Available models' }).getByText('Alpha', { exact: true })).toHaveCount(1);
  const rows = await page.getByRole('option').evaluateAll(nodes => nodes.map(n => ({
    height: n.getBoundingClientRect().height, font: getComputedStyle(n).fontSize,
  })));
  for (const row of rows) { expect(row.height).toBeGreaterThanOrEqual(54); expect(parseFloat(row.font)).toBeGreaterThanOrEqual(14); }
  const gap = await page.getByRole('group', { name: 'ChatGPT / Codex', exact: true }).getByRole('option').evaluateAll(nodes =>
    nodes[1].getBoundingClientRect().top - nodes[0].getBoundingClientRect().bottom);
  expect(gap).toBeGreaterThanOrEqual(4);
  expect(await page.locator('.model-picker-search').evaluate(n => n.getBoundingClientRect().height)).toBe(44);
});

test('search ArrowRight Home and End edit the caret without moving focus or committing', async ({ page }) => {
  await trigger(page).click(); await search(page).fill('alpha');
  await search(page).press('Home');
  expect(await search(page).evaluate(n => (n as HTMLInputElement).selectionStart)).toBe(0);
  await search(page).press('ArrowRight'); await expect(search(page)).toBeFocused();
  expect(await search(page).evaluate(n => (n as HTMLInputElement).selectionStart)).toBe(1);
  await search(page).press('End');
  expect(await search(page).evaluate(n => (n as HTMLInputElement).selectionStart)).toBe(5);
  await expect(page.getByLabel('Committed choice')).toHaveText('openai/alpha|high');
});

test('hover and keyboard focus differ from the committed checkmark until Enter', async ({ page }) => {
  await trigger(page).click();
  const alpha = page.getByRole('option', { name: 'Alpha', exact: true });
  const beta = page.getByRole('option', { name: 'Same name', exact: true }).first();
  await beta.hover(); await expect(alpha).toHaveAttribute('aria-selected', 'true');
  await expect(beta).toHaveAttribute('aria-selected', 'false');
  expect(await beta.evaluate(n => getComputedStyle(n).backgroundColor)).not.toBe(await alpha.evaluate(n => getComputedStyle(n).backgroundColor));
  await expect(alpha.locator('.model-picker-check')).toBeVisible();
  await expect(beta.locator('.model-picker-check')).toHaveCount(0);
  await search(page).press('ArrowUp'); await expect(page.getByLabel('Committed choice')).toHaveText('openai/alpha|high');
  expect(await alpha.evaluate(n => getComputedStyle(n).outlineStyle)).not.toBe('none');
  await search(page).press('ArrowDown'); await search(page).press('Enter');
  await expect(page.getByLabel('Committed choice')).toHaveText('openai/beta|');
  await expect(beta).toContainText('openai/beta');
});

for (const count of [1, 2]) test(`${count} model catalog exposes exact reasoning radios in the side panel`, async ({ page }) => {
  await expect(trigger(page)).toBeVisible();
  await page.evaluate(count => (window as any).updateModelCatalog([
    { id: 'openai/alpha', name: 'Alpha', provider: 'openai', thinkingLevels: ['high', 'budget_16384'] },
    ...(count === 2 ? [{ id: 'openai/other', name: 'Other', provider: 'openai' }] : []),
  ]), count);
  await trigger(page).click();
  const panel = page.getByRole('group', { name: 'Reasoning', exact: true });
  await expect(panel.getByRole('radio')).toHaveText(['Default', 'High', 'Budget 16384']);
  expect(await panel.evaluate(n => Boolean(n.closest('.model-picker-popover')))).toBe(true);
  await panel.getByRole('radio', { name: 'Budget 16384' }).click();
  await expect(page.getByLabel('Committed choice')).toHaveText('openai/alpha|budget_16384');
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'true');
});

test('reasoning radios expose only exact supported levels and keyboard selection stays in the panel', async ({ page }) => {
  await trigger(page).click();
  const panel = page.getByRole('group', { name: 'Reasoning', exact: true });
  await expect(panel.getByRole('radio')).toHaveText(['Default', 'Low', 'High', 'Extra high', 'Ultra']);
  await panel.getByRole('radio', { name: 'High', exact: true }).focus();
  await page.keyboard.press('End');
  await expect(page.getByLabel('Committed choice')).toHaveText('openai/alpha|ultra');
  await expect(panel.getByRole('radio', { name: 'Ultra', exact: true })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByLabel('Committed choice')).toHaveText('openai/alpha|');
  await page.keyboard.press('Escape');
  await expect(trigger(page)).toBeFocused(); await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
});

for (const owner of ['native', 'aria']) test(`picker closes before its ${owner} modal and retains the draft`, async ({ page }) => {
  await page.goto(`/compact-model-picker?${owner}=1`); await trigger(page).click();
  await expect(page.getByRole('group', { name: 'Reasoning', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('dialog', { name: 'Picker owner', exact: true })).toBeVisible();
  await expect(page.getByLabel('Preserved draft')).toHaveValue('Keep this draft');
});

test('IME composing and legacy 229 Escape Enter do not dismiss or commit', async ({ page }) => {
  await trigger(page).dispatchEvent('keydown', { key: 'Enter', keyCode: 229 });
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
  await trigger(page).click(); await search(page).press('ArrowDown');
  for (const composition of [{ isComposing: true }, { keyCode: 229 }]) for (const key of ['Escape', 'Enter']) {
    await search(page).dispatchEvent('keydown', { key, ...composition });
    await expect(trigger(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByLabel('Committed choice')).toHaveText('openai/alpha|high');
  }
});

test('long duplicate names retain IDs, exact unsupported levels, and unavailable selection', async ({ page }) => {
  await trigger(page).click();
  await expect(page.getByRole('option', { name: 'Same name', exact: true }).first()).toContainText('openai/beta');
  await expect(page.getByRole('option', { name: 'Same name', exact: true }).last()).toContainText('claude-code/beta');
  await page.getByRole('option', { name: 'Same name', exact: true }).last().click();
  await expect(page.getByRole('group', { name: 'Reasoning', exact: true })).toContainText('No reasoning settings');
  await page.evaluate(() => (window as any).updateModelCatalog([]));
  await expect(trigger(page)).toBeDisabled(); await expect(trigger(page)).toContainText('claude-code/beta');
  await expect(page.getByLabel('Committed choice')).toHaveText('claude-code/beta|');
});

test('first open scrolls to selected model 99 and running lock closes the picker', async ({ page }) => {
  await page.goto('/compact-model-picker?large=1'); await trigger(page).click();
  const row = await page.getByRole('option', { name: 'Catalog model 99', exact: true }).evaluate(n => {
    const r = n.getBoundingClientRect(), l = n.closest('[role="listbox"]')!.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, listTop: l.top, listBottom: l.bottom };
  });
  expect(row.top).toBeGreaterThanOrEqual(row.listTop); expect(row.bottom).toBeLessThanOrEqual(row.listBottom);
  await page.getByRole('button', { name: 'Toggle working' }).click();
  await expect(trigger(page)).toBeDisabled(); await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: 'Toggle working' }).click();
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
});

for (const theme of ['dark', 'light']) test(`${theme} long catalog stays readable in narrow short windows`, async ({ page }, info) => {
  for (const viewport of [{ width: 1024, height: 600 }, { width: 390, height: 420 }, { width: 280, height: 240 }]) {
    await page.setViewportSize(viewport); await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/compact-model-picker?large=1');
    await expect(trigger(page)).toBeVisible();
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; (window as any).updateModelCatalog([
      { id: 'openai/catalog-99', provider: 'openai', name: 'A very long catalog model name that must wrap and remain fully readable at narrow widths', thinkingLevels: ['low', 'high'] },
      ...Array.from({ length: 20 }, (_, i) => ({ id: `openai/${i}`, provider: 'openai', name: `Model ${i}` })),
    ]); }, theme);
    await trigger(page).click(); const popup = page.locator('.model-picker-popover');
    await popup.evaluate(node => Promise.all(node.getAnimations().map(a => a.finished)));
    const b = (await popup.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(8); expect(b.y).toBeGreaterThanOrEqual(50);
    expect(b.x + b.width).toBeLessThanOrEqual(viewport.width - 8); expect(b.y + b.height).toBeLessThanOrEqual(viewport.height - 8);
    expect(await popup.evaluate(n => n.scrollWidth <= n.clientWidth)).toBe(true);
    const high = page.getByRole('radio', { name: 'High', exact: true });
    await high.scrollIntoViewIfNeeded(); await expect(high).toBeVisible();
    await page.screenshot({ path: info.outputPath(`${theme}-${viewport.width}x${viewport.height}.png`) });
    await page.keyboard.press('Escape'); await trigger(page).click(); await search(page).fill('no-such-catalog-entry');
    await expect(popup.getByRole('status')).toContainText('No models found');
  }
});

test('empty search keeps its recovery text visible and does not collapse the popup', async ({ page }) => {
  await trigger(page).click();
  const popup = page.locator('.model-picker-popover');
  const height = await popup.evaluate(n => n.clientHeight);
  await search(page).fill('no-such-catalog-entry');
  const status = popup.getByRole('status'); await expect(status).toBeVisible();
  expect(await popup.evaluate(n => n.clientHeight)).toBe(height);
  const bounds = await status.evaluate(n => {
    const r = n.getBoundingClientRect(), p = n.closest('.model-picker-main')!.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, parentTop: p.top, parentBottom: p.bottom, height: n.clientHeight, content: n.scrollHeight };
  });
  expect(bounds.top).toBeGreaterThanOrEqual(bounds.parentTop); expect(bounds.bottom).toBeLessThanOrEqual(bounds.parentBottom);
  expect(bounds.height).toBeGreaterThanOrEqual(bounds.content);
});

test('provider rail filters the catalog and All models restores it', async ({ page }) => {
  await trigger(page).click();
  await expect(page.getByRole('option')).toHaveCount(3);
  await page.getByRole('group', { name: 'Model filters' }).getByRole('button', { name: /^Claude/ }).click();
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('option', { name: 'Same name', exact: true })).toContainText('claude-code/beta');
  await page.getByRole('group', { name: 'Model filters' }).getByRole('button', { name: /^All models/ }).click();
  await expect(page.getByRole('option')).toHaveCount(3);
});

test('favorite stars persist locally, filter through the rail and never commit the model', async ({ page }) => {
  await trigger(page).click();
  const popup = page.locator('.model-picker-popover');
  const star = page.getByRole('button', { name: 'Add openai/beta to favorites', exact: true });
  await star.click();
  await expect(page.getByLabel('Committed choice')).toHaveText('openai/alpha|high');
  await expect(page.getByRole('button', { name: 'Remove openai/beta from favorites', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('harness:model-favorites:v1'))).toBe(JSON.stringify(['openai/beta']));
  await page.getByRole('group', { name: 'Model filters' }).getByRole('button', { name: /^Favorites/ }).click();
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('option', { name: 'Same name', exact: true })).toContainText('openai/beta');
  await page.getByRole('button', { name: 'Remove openai/beta from favorites', exact: true }).click();
  await expect(popup.getByRole('status')).toContainText('No favorites yet');
  expect(await page.evaluate(() => localStorage.getItem('harness:model-favorites:v1'))).toBe(JSON.stringify([]));
  await page.reload(); await trigger(page).click();
  await expect(page.getByRole('group', { name: 'Model filters' }).getByRole('button', { name: /^Favorites/ })).toContainText('0');
});

test('Ctrl+number quick-select commits the matching visible row', async ({ page }) => {
  await trigger(page).click();
  await expect(page.getByRole('option', { name: 'Alpha', exact: true }).locator('kbd')).toHaveText('Ctrl 1');
  await search(page).press('Control+2');
  await expect(page.getByLabel('Committed choice')).toHaveText('openai/beta|');
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'true');
  await search(page).press('Control+3');
  await expect(page.getByLabel('Committed choice')).toHaveText('claude-code/beta|');
  await search(page).press('Control+9');
  await expect(page.getByLabel('Committed choice')).toHaveText('claude-code/beta|');
});

test('actual composer sends the explicit model and effort on its pinned account', async ({ page }) => {
  // First full-app load in this suite pays the cold Vite transform cost.
  test.slow();
  const snapshot = taskFixture({ root: 'text', elements: { text: { type: 'Text', props: { text: 'Synthetic' } } } });
  snapshot.artifacts = []; snapshot.messages = []; snapshot.settings = { theme: 'dark', modelId: 'openai/alpha' };
  snapshot.threads[0].modelId = 'openai/alpha'; snapshot.threads[0].accountId = 'pinned-account';
  snapshot.accounts = [{ id: 'pinned-account', providerId: 'openai', label: 'Pinned', enabled: true, createdAt: '2026-11-01', updatedAt: '2026-11-01' }];
  const host = await serveTaskFixture(page, snapshot);
  await page.route('**/api/models*', route => route.fulfill({ json: { models: [
    { id: 'openai/alpha', name: 'Alpha', provider: 'openai', thinkingLevels: ['low'] },
    { id: 'openai/beta', name: 'Beta', provider: 'openai', thinkingLevels: ['max'] },
  ] } }));
  await page.goto('/'); await expect(page.locator('.composer-account')).toHaveText('Pinned', { timeout: 20000 });
  await trigger(page).click(); await page.getByRole('option', { name: 'Beta', exact: true }).click();
  await page.getByRole('radio', { name: 'Max', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Use exact settings');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => host.commands.find(c => c.type === 'message.send')).toMatchObject({
    threadId: 'task-thread', payload: { modelId: 'openai/beta', thinkingLevel: 'max', content: 'Use exact settings' },
  });
  expect(snapshot.threads[0].accountId).toBe('pinned-account');
});
