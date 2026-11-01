import { expect, test } from '@playwright/test';
import { serveTaskFixture, taskFixture } from './task-interface-fixture';

test('Settings load on demand, retain focus and drafts, and reuse the loaded module', async ({ page }) => {
  const fixture = await serveTaskFixture(page, taskFixture({ root: 'note', elements: { note: { type: 'Input', props: { label: 'Review note', stateKey: 'note' } } } }));
  let requests = 0, release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/src/Settings.tsx*', async route => { requests++; await delayed; await route.continue(); });
  try {
    await page.goto('/', { waitUntil: 'commit' });
    const composer = page.getByRole('textbox', { name: 'Message', exact: true });
    await expect(composer).toBeEnabled(); expect(requests).toBe(0);
    await composer.fill('Keep my next message');
    await composer.press('Control+,');
    await expect(page.getByRole('status').filter({ hasText: 'Opening settings' })).toBeVisible();
    expect(requests).toBe(1);
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
    await expect(composer).toBeFocused();
    await composer.press('Control+,');
    await expect(page.getByRole('status').filter({ hasText: 'Opening settings' })).toBeVisible();
    expect(requests).toBe(1);
    release();
    const settings = page.locator('dialog.settings-dialog');
    await expect(settings).toBeVisible();
    expect(await settings.evaluate(node => node.contains(document.activeElement))).toBe(true);
    const search = settings.getByRole('searchbox', { name: 'Search all settings', exact: true });
    await search.fill('chat width'); const original = await search.elementHandle();
    await fixture.publish();
    await expect(search).toHaveValue('chat width');
    expect(await search.evaluate((node, previous) => node === previous, original)).toBe(true);
    await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
    await expect(composer).toHaveValue('Keep my next message');
    await expect(composer).toBeFocused();
    const opener = page.getByRole('button', { name: 'Settings', exact: true });
    await opener.click(); await expect(settings).toBeVisible();
    await page.keyboard.press('Escape'); await expect(settings).toHaveCount(0);
    await expect(opener).toBeFocused(); expect(requests).toBe(1);
  } finally { release(); }
});

test('a failed Settings chunk preserves the conversation and can be safely reloaded', async ({ page }) => {
  await serveTaskFixture(page, taskFixture({ root: 'note', elements: { note: { type: 'Input', props: { label: 'Review note', stateKey: 'note' } } } }));
  let requests = 0; const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/src/Settings.tsx*', route => ++requests === 1 ? route.abort('failed') : route.continue());
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'Message', exact: true }), note = page.getByRole('textbox', { name: 'Review note', exact: true });
  await composer.fill('Keep the composer draft'); await note.fill('Keep the artifact draft');
  const original = await note.elementHandle(), opener = page.getByRole('button', { name: 'Settings', exact: true });
  await opener.click();
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('alert')).toContainText('Settings could not load');
  await expect(composer).toHaveValue('Keep the composer draft'); await expect(note).toHaveValue('Keep the artifact draft');
  expect(await note.evaluate((node, previous) => node === previous, original)).toBe(true);
  await Promise.all([page.waitForEvent('framenavigated', frame => frame === page.mainFrame()), page.getByRole('button', { name: 'Reload to retry', exact: true }).click()]);
  await expect(composer).toHaveValue('Keep the composer draft'); await expect(note).toHaveValue('Keep the artifact draft');
  await opener.click();
  const settings = page.locator('dialog.settings-dialog'); await expect(settings).toBeVisible();
  await expect(settings.getByRole('searchbox', { name: 'Search all settings', exact: true })).toBeVisible();
  expect(requests).toBe(2); expect(pageErrors).toEqual([]);
  await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(opener).toBeFocused(); await expect(note).toHaveValue('Keep the artifact draft');
});

test('failed draft persistence blocks Settings recovery reload and retains the memory draft', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(indexedDB, 'open', { value: () => { throw Error('IDB unavailable'); } });
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key.startsWith('harness:journal-pending:')) throw Error('Staging unavailable'); return original.call(this, key, value); };
  });
  await serveTaskFixture(page, taskFixture({ root: 'text', elements: { text: { type: 'Text', props: { text: 'Current task' } } } }));
  await page.route('**/src/Settings.tsx*', route => route.abort('failed'));
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'Message', exact: true }); await expect(composer).toBeEnabled();
  await composer.fill('Only memory retains this draft');
  await expect(page.getByText('Draft could not be stored locally. Keep this tab open.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const alert = page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('alert'); await expect(alert).toContainText('Settings could not load');
  let navigations = 0; page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
  await page.getByRole('button', { name: 'Reload to retry', exact: true }).click();
  await expect(alert).toContainText('Drafts could not be saved'); expect(navigations).toBe(0);
  await expect(composer).toHaveValue('Only memory retains this draft');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click(); await expect(composer).toBeEnabled();
});

test('PNG preprocessing blocks Settings recovery reload before the mark reaches its journal', async ({ page }) => {
  await page.addInitScript(() => {
    const decode = window.createImageBitmap.bind(window);
    window.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => {
      const bitmap = await (decode as (...args: unknown[]) => Promise<ImageBitmap>)(...args);
      return new Promise<ImageBitmap>(resolve => Object.assign(window, { releaseMarkDecode: () => resolve(bitmap) }));
    }) as typeof createImageBitmap;
  });
  await serveTaskFixture(page, taskFixture({ root: 'signature', elements: { signature: { type: 'SignaturePad', props: { stateKey: 'signature', initialMode: 'upload' } } } }));
  await page.route('**/src/Settings.tsx*', route => route.abort('failed'));
  try {
    await page.goto('/');
    const signature = page.locator('.signature-pad'), original = await signature.elementHandle();
    const base64 = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 50; canvas.getContext('2d')!.fillRect(10, 10, 70, 10); return canvas.toDataURL('image/png').split(',')[1]; });
    await page.getByLabel('Upload PNG signature', { exact: true }).setInputFiles({ name: 'mark.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') });
    await expect.poll(() => page.evaluate(() => typeof (window as unknown as { releaseMarkDecode?: unknown }).releaseMarkDecode)).toBe('function');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const alert = page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('alert'); await expect(alert).toContainText('Settings could not load');
    let navigations = 0; page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
    await page.getByRole('button', { name: 'Reload to retry', exact: true }).click();
    await expect(alert).toContainText('signature mark'); expect(navigations).toBe(0);
    expect(await signature.evaluate((node, previous) => node === previous, original)).toBe(true);
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click(); await expect(page.getByLabel('Upload PNG signature', { exact: true })).toBeEnabled();
  } finally { await page.evaluate(() => (window as unknown as { releaseMarkDecode?: () => void }).releaseMarkDecode?.()); }
});
