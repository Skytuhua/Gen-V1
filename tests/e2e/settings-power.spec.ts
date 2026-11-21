import { expect, test } from '@playwright/test';
import { serveTaskFixture, taskFixture } from './task-interface-fixture';

async function openSettings(page: import('@playwright/test').Page) {
  const snapshot = taskFixture({ root: 'text', elements: { text: { type: 'Text', props: { text: 'Power settings fixture' } } } });
  const host = await serveTaskFixture(page, snapshot);
  await page.route('**/api/commands', route => route.fallback());
  await page.route('**/api/workspace', route => route.fulfill({ json: { projects: [], state: { version: 1, revision: 0, activeCanvasId: 'workspace-default', canvases: [{ version: 1, id: 'workspace-default', name: 'Workspace', preset: 'workspace', viewport: { x: 0, y: 0, zoom: 1 }, panels: [], filter: 'active', projectIds: [] }], profiles: [], disabledKinds: [], integrations: {} } } }));
  await page.route('**/api/environment', route => route.fulfill({ json: { revision: 0, entries: [], secretStorageAvailable: false } }));
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await expect(composer).toBeEnabled();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(dialog).toBeVisible();
  return { ...host, dialog, nav: dialog.getByRole('navigation', { name: 'Settings sections' }), search: dialog.getByRole('searchbox', { name: 'Search all settings' }) };
}

test('keep-awake rows stay out of the browser build', async ({ page }) => {
  const { dialog, nav, search } = await openSettings(page);
  await nav.getByRole('button', { name: 'General', exact: true }).click();
  await expect(dialog.locator('[data-setting-id="keep-awake-tasks"]')).toHaveCount(0);
  await expect(dialog.locator('[data-setting-id="keep-awake-schedules"]')).toHaveCount(0);
  await expect(dialog.getByRole('switch', { name: 'Keep the PC awake for tasks' })).toHaveCount(0);
  await search.fill('keep the PC awake');
  await expect(dialog.getByText('No matching settings.')).toBeVisible();
  await search.fill('power');
  await expect(dialog.locator('.settings-result', { hasText: 'Keep the PC awake' })).toHaveCount(0);
});
