import { test, expect, type Page } from '@playwright/test';
import { serveTaskFixture, serveTaskSplitLayout, taskFixture } from './task-interface-fixture';

const models = [
  { id: 'openai/sol', provider: 'openai', name: 'GPT-6.1 Sol', thinkingLevels: ['low', 'high'] },
  { id: 'claude-code/sonnet', provider: 'claude-code', name: 'Claude Sonnet' },
  { id: 'openai/terra', provider: 'openai', name: 'GPT-6.1 Terra' },
];
async function mount(page: Page) {
  const snapshot = taskFixture({ root: 'text', elements: { text: { type: 'Text', props: { text: 'Synthetic model selection fixture' } } } });
  snapshot.settings = { theme: 'dark', modelId: 'openai/sol' };
  snapshot.threads[0].modelId = 'openai/sol';
  const host = await serveTaskFixture(page, snapshot);
  await page.route('**/api/models*', route => route.fulfill({ json: { models } }));
  await page.goto('/');
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toContainText('GPT-6.1 Sol');
  return host;
}

test('model search groups the advertised catalog and keyboard selection reaches the next message', async ({ page }) => {
  const host = await mount(page), trigger = page.getByRole('combobox', { name: 'Model', exact: true });
  await trigger.focus(); await trigger.press('ArrowDown');
  const search = page.getByRole('searchbox', { name: 'Search models', exact: true });
  await expect(search).toBeFocused();
  const list = page.getByRole('listbox', { name: 'Available models', exact: true });
  await expect(list.getByRole('group', { name: 'ChatGPT / Codex', exact: true }).getByRole('option')).toHaveCount(2);
  await expect(list.getByRole('group', { name: 'Claude', exact: true }).getByRole('option')).toHaveCount(1);
  await expect(list.getByRole('option', { name: 'GPT-6.1 Sol', exact: true })).toHaveAttribute('aria-selected', 'true');
  await search.fill('gpt'); await search.press('ArrowDown'); await search.press('Enter');
  await expect(trigger).toContainText('GPT-6.1 Terra');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');await search.press('Escape');await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Use this model');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => host.commands.find(command => command.type === 'message.send')?.payload.modelId).toBe('openai/terra');
});

test('model search has an empty state, Escape and outside click dismiss, and Tab stays in the combined dialog', async ({ page }) => {
  const host = await mount(page), trigger = page.getByRole('combobox', { name: 'Model', exact: true });
  await trigger.click(); const search = page.getByRole('searchbox', { name: 'Search models', exact: true });
  await search.fill('no matching model');
  await expect(page.getByRole('listbox', { name: 'Available models', exact: true }).getByRole('option')).toHaveCount(0);
  await expect(page.getByRole('status').filter({hasText:'No models found'})).toBeVisible();
  await search.press('Enter'); await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await search.press('Escape'); await expect(trigger).toBeFocused();
  await trigger.click(); await expect(search).toHaveValue('');
  const message = page.getByRole('textbox', { name: 'Message', exact: true }); await message.click({ position: { x: 8, y: 8 } });
  await expect(trigger).toHaveAttribute('aria-expanded', 'false'); await expect(message).toBeFocused();
  await trigger.click(); await search.press('Tab');
  const dialog=page.getByRole('dialog',{name:'Model and reasoning',exact:true});await expect(dialog).toBeVisible();await expect.poll(()=>dialog.evaluate(node=>node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false'); await expect(search).not.toBeVisible();
  await expect(trigger).toContainText('GPT-6.1 Sol'); expect(host.commands).toHaveLength(0);
});

test('a first send keeps a usable model when the account pin lands before the bound model id', async ({ page }) => {
  const snapshot = taskFixture({ root: 'text', elements: { text: { type: 'Text', props: { text: 'Synthetic model selection fixture' } } } });
  snapshot.settings = { theme: 'dark', modelId: null };
  snapshot.threads[0].modelId = 'openai/sol';
  const created: ReturnType<typeof taskFixture>['threads'][number] = { id: 'sent-thread', title: 'First send', projectName: 'Reusable task surfaces', status: 'ready', epoch: 0, runId: null, modelId: null, sessionPath: null, createdAt: '2026-10-29T23:00:00.000Z', updatedAt: '2026-10-29T23:00:00.000Z' };
  const host = await serveTaskFixture(page, snapshot);
  await serveTaskSplitLayout(page);
  await page.route('**/api/models*', route => route.fulfill({ json: { models } }));
  await page.goto('/');
  const trigger = page.getByRole('combobox', { name: 'Model', exact: true });
  await expect(trigger).toContainText('GPT-6.1 Sol');
  // An unbound thread selected from the sidebar must not wedge the composer
  // once the host binds its account before the bound model id propagates.
  snapshot.threads = [created]; snapshot.activeThreadId = created.id; snapshot.messages = [];
  await host.publish();
  await page.getByRole('button', { name: /First send/ }).first().click();
  await expect(trigger).toContainText('GPT-6.1 Sol');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('First send');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => host.commands.some(command => command.type === 'message.send')).toBe(true);
  snapshot.messages = [{ id: 'sent', threadId: created.id, role: 'user', content: 'First send', runId: null, createdAt: '2026-10-29T23:00:01.000Z' }];
  await host.publish();
  snapshot.threads = [{ ...created, sessionPath: 'fixture-session' }];
  await host.publish();
  snapshot.threads = [{ ...created, sessionPath: 'fixture-session', modelId: 'openai/sol' }];
  await host.publish();
  await expect(trigger).toContainText('GPT-6.1 Sol');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).not.toHaveAttribute('title', 'Connect an available model in Settings to send.');
});

test('an active run closes model selection and locks the trigger', async ({ page }) => {
  const host = await mount(page), trigger = page.getByRole('combobox', { name: 'Model', exact: true });
  await trigger.click(); await expect(page.getByRole('searchbox', { name: 'Search models', exact: true })).toBeFocused();
  host.snapshot.threads[0].status = 'working'; host.snapshot.threads[0].runId = 'fixture-run'; await host.publish();
  await expect(trigger).toBeDisabled(); await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('listbox', { name: 'Available models', exact: true })).not.toBeVisible();
  expect(host.commands).toHaveLength(0);
});

test('model selection fits both themes on a phone and removes spatial motion when requested', async ({ page }, testInfo) => {
  const host = await mount(page);
  for (const motion of ['no-preference', 'reduce'] as const) for (const width of [1440, 390]) for (const theme of ['dark', 'light'] as const) {
    await page.emulateMedia({ reducedMotion: motion });
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    host.snapshot.settings.theme = theme; await host.publish();
    const trigger = page.getByRole('combobox', { name: 'Model', exact: true }); await trigger.click();
    const popover = page.locator('.model-picker-popover'); await expect(popover).toHaveAttribute('data-state', 'open');
    await popover.evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {}))));
    const bounds = (await popover.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(8); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 8);
    expect(bounds.y).toBeGreaterThanOrEqual(8); expect(bounds.y + bounds.height).toBeLessThanOrEqual(width === 390 ? 836 : 992);
    const spatial = await popover.evaluate(node => node.getAnimations().some(animation => (animation.effect as KeyframeEffect).getKeyframes().some(frame => frame.transform && frame.transform !== 'none')));
    if (motion === 'reduce') expect(spatial).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`model-picker-${width}-${theme}-${motion}.png`) });
    await page.getByRole('searchbox', { name: 'Search models', exact: true }).press('Escape');
  }
});

test('the model picker never paints over the sidebar at supported widths', async ({ page }, testInfo) => {
  await mount(page);
  for (const width of [1280, 900, 700, 500]) {
    await page.setViewportSize({ width, height: 1000 });
    const trigger = page.getByRole('combobox', { name: 'Model', exact: true }); await trigger.click();
    const popover = page.locator('.model-picker-popover'); await expect(popover).toHaveAttribute('data-state', 'open');
    await popover.evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {}))));
    const bounds = (await popover.boundingBox())!;
    const column = await trigger.evaluate(el => el.closest('.workspace-layout-workarea')?.getBoundingClientRect().toJSON() ?? null);
    if (column) {
      expect(bounds.x).toBeGreaterThanOrEqual(column.x + 8 - 0.5);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(column.x + column.width - 8 + 0.5);
    }
    const sidebar = await page.locator('.sidebar:visible').first().boundingBox();
    if (sidebar) {
      const overlap = Math.max(0, Math.min(bounds.x + bounds.width, sidebar.x + sidebar.width) - Math.max(bounds.x, sidebar.x));
      expect(overlap).toBe(0);
    }
    await page.screenshot({ path: testInfo.outputPath(`model-picker-column-${width}.png`) });
    await page.getByRole('searchbox', { name: 'Search models', exact: true }).press('Escape');
  }
});
