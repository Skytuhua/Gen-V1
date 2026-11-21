import { expect, test, type Page } from '@playwright/test';
import { serveTaskFixture, taskFixture } from './task-interface-fixture';

// #1134 — selecting a theme must apply it immediately; Apply persists it.
async function openAppearance(page: Page, theme: 'dark' | 'light' | 'system' = 'dark') {
  const snapshot = taskFixture({ root: 'text', elements: { text: { type: 'Text', props: { text: 'Theme fixture' } } } });
  snapshot.settings.theme = theme;
  const host = await serveTaskFixture(page, snapshot);
  await page.route('**/api/environment', route => route.fulfill({ json: { revision: 0, entries: [], secretStorageAvailable: false } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Appearance', exact: true }).click();
  const scheme = dialog.getByRole('combobox', { name: 'Color scheme', exact: true });
  await expect(scheme).toBeVisible();
  return { ...host, dialog, scheme };
}

const canvasColor = (page: Page) => page.locator('html').evaluate(node => getComputedStyle(node).getPropertyValue('--canvas').trim());

test('selecting Light applies the light theme immediately and Apply persists it', async ({ page }) => {
  const { dialog, scheme, commands } = await openAppearance(page, 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await scheme.click();
  await page.getByRole('option', { name: 'Light', exact: true }).click();
  // The fix: selection applies now — previously this stayed 'dark' until Apply.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await canvasColor(page)).toBe('#fff');
  await expect(scheme).toContainText('Light');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => commands.filter(command => command.type === 'settings.update').at(-1)?.payload.theme).toBe('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(scheme).toContainText('Light');
});

test('a saved light theme still applies after a reload', async ({ page }) => {
  const { dialog, scheme } = await openAppearance(page, 'dark');
  await scheme.click();
  await page.getByRole('option', { name: 'Light', exact: true }).click();
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).waitFor();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('System follows emulated prefers-color-scheme', async ({ page }) => {
  await openAppearance(page, 'system');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('Cancel restores the saved theme and sends no settings update', async ({ page }) => {
  const { dialog, scheme, commands } = await openAppearance(page, 'dark');
  await scheme.click();
  await page.getByRole('option', { name: 'Light', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(commands.filter(command => command.type === 'settings.update')).toHaveLength(0);
});
