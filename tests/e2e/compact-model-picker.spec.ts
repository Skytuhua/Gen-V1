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

test('compact list keeps readable rows and one reasoning footer below the catalog', async ({ page }) => {
  await trigger(page).click();
  const popup = page.locator('.model-picker-popover');
  await popup.evaluate(node => Promise.all(node.getAnimations().map(a => a.finished)));
  const box = (await popup.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(380); expect(box.width).toBeLessThanOrEqual(420);
  const list = (await page.getByRole('listbox', { name: 'Available models' }).boundingBox())!;
  const footer = (await page.getByRole('group', { name: 'Reasoning', exact: true }).boundingBox())!;
  expect(footer.y).toBeGreaterThanOrEqual(list.y + list.height);
  await expect(popup.getByText('Alpha', { exact: true })).toHaveCount(1);
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

for (const count of [1, 2]) test(`${count} model catalog opens reasoning through the shared portal`, async ({ page }) => {
  await expect(trigger(page)).toBeVisible();
  await page.evaluate(count => (window as any).updateModelCatalog([
    { id: 'openai/alpha', name: 'Alpha', provider: 'openai', thinkingLevels: ['high', 'budget_16384'] },
    ...(count === 2 ? [{ id: 'openai/other', name: 'Other', provider: 'openai' }] : []),
  ]), count);
  await trigger(page).click(); await page.getByRole('button', { name: 'Reasoning: High' }).click();
  const menu = page.getByRole('menu');
  expect(await menu.evaluate(n => !n.closest('.model-picker-popover'))).toBe(true);
  await page.getByRole('menuitemcheckbox', { name: 'Budget 16384' }).click();
  await expect(page.getByLabel('Committed choice')).toHaveText('openai/alpha|budget_16384');
});

test('reasoning menu exposes only exact supported levels and navigation never commits', async ({ page }) => {
  await trigger(page).click();
  await page.getByRole('button', { name: 'Reasoning: High', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Reasoning: High', exact: true });
  await expect(menu.getByRole('menuitemcheckbox')).toHaveText(['Default', 'Low', 'High', 'Extra high', 'Ultra']);
  await page.keyboard.press('End'); await expect(page.getByLabel('Committed choice')).toHaveText('openai/alpha|high');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Committed choice')).toHaveText('openai/alpha|ultra');
  await expect(trigger(page)).toBeFocused(); await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
});

for (const owner of ['native', 'aria']) test(`nested reasoning closes before its ${owner} modal and retains the draft`, async ({ page }) => {
  await page.goto(`/compact-model-picker?${owner}=1`); await trigger(page).click();
  await page.getByRole('button', { name: 'Reasoning: High' }).click();
  const menu = page.getByRole('menu');
  expect(await menu.evaluate(n => !!n.closest('dialog[open], [role="dialog"][aria-modal="true"]'))).toBe(true);
  await page.keyboard.press('Escape'); await expect(menu).not.toBeVisible();
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape'); await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
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

test('first open scrolls to selected model 99 and running lock closes both menus', async ({ page }) => {
  await page.goto('/compact-model-picker?large=1'); await trigger(page).click();
  const row = await page.getByRole('option', { name: 'Catalog model 99', exact: true }).evaluate(n => {
    const r = n.getBoundingClientRect(), l = n.closest('[role="listbox"]')!.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, listTop: l.top, listBottom: l.bottom };
  });
  expect(row.top).toBeGreaterThanOrEqual(row.listTop); expect(row.bottom).toBeLessThanOrEqual(row.listBottom);
  await page.getByRole('button', { name: 'Reasoning: High' }).click();
  await page.getByRole('button', { name: 'Toggle working' }).click();
  await expect(trigger(page)).toBeDisabled(); await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('menu')).not.toBeVisible();
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
    await page.getByRole('button', { name: 'Reasoning: High' }).click(); await expect(page.getByRole('menuitemcheckbox', { name: 'High', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`${theme}-${viewport.width}x${viewport.height}.png`) });
    await page.keyboard.press('Escape'); await search(page).focus(); await search(page).fill('no-such-catalog-entry');
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

test('actual composer sends the explicit model and effort on its pinned account', async ({ page }) => {
  const snapshot = taskFixture({ root: 'text', elements: { text: { type: 'Text', props: { text: 'Synthetic' } } } });
  snapshot.artifacts = []; snapshot.messages = []; snapshot.settings = { theme: 'dark', modelId: 'openai/alpha' };
  snapshot.threads[0].modelId = 'openai/alpha'; snapshot.threads[0].accountId = 'pinned-account';
  snapshot.accounts = [{ id: 'pinned-account', providerId: 'openai', label: 'Pinned', enabled: true, createdAt: '2026-11-01', updatedAt: '2026-11-01' }];
  const host = await serveTaskFixture(page, snapshot);
  await page.route('**/api/models*', route => route.fulfill({ json: { models: [
    { id: 'openai/alpha', name: 'Alpha', provider: 'openai', thinkingLevels: ['low'] },
    { id: 'openai/beta', name: 'Beta', provider: 'openai', thinkingLevels: ['max'] },
  ] } }));
  await page.goto('/'); await expect(page.locator('.composer-account')).toHaveText('Pinned');
  await trigger(page).click(); await page.getByRole('option', { name: 'Beta', exact: true }).click();
  await page.getByRole('button', { name: 'Reasoning: Default' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Max', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Use exact settings');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => host.commands.find(c => c.type === 'message.send')).toMatchObject({
    threadId: 'task-thread', payload: { modelId: 'openai/beta', thinkingLevel: 'max', content: 'Use exact settings' },
  });
  expect(snapshot.threads[0].accountId).toBe('pinned-account');
});
