import { test, expect, type Page } from '@playwright/test';
import { serveTaskFixture, taskFixture } from './task-interface-fixture';

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
  await expect(trigger).toContainText('GPT-6.1 Terra'); await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Use this model');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => host.commands.find(command => command.type === 'message.send')?.payload.modelId).toBe('openai/terra');
});

test('model search has an empty state and Escape, outside click, and Tab dismiss without choosing', async ({ page }) => {
  const host = await mount(page), trigger = page.getByRole('combobox', { name: 'Model', exact: true });
  await trigger.click(); const search = page.getByRole('searchbox', { name: 'Search models', exact: true });
  await search.fill('no matching model');
  await expect(page.getByRole('listbox', { name: 'Available models', exact: true }).getByRole('option')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('No models found');
  await search.press('Enter'); await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await search.press('Escape'); await expect(trigger).toBeFocused();
  await trigger.click(); await expect(search).toHaveValue('');
  const message = page.getByRole('textbox', { name: 'Message', exact: true }); await message.click({ position: { x: 8, y: 8 } });
  await expect(trigger).toHaveAttribute('aria-expanded', 'false'); await expect(message).toBeFocused();
  await trigger.click(); await search.press('Tab');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false'); await expect(search).not.toBeVisible();
  await expect(trigger).toContainText('GPT-6.1 Sol'); expect(host.commands).toHaveLength(0);
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
