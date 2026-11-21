import { test, expect } from '@playwright/test';
import { taskFixture, serveTaskFixture } from './task-interface-fixture';

async function setup(page: Parameters<typeof serveTaskFixture>[0], composerSpellcheck = false) {
  const snapshot = taskFixture({ root: 'text', elements: { text: { type: 'Text', props: { text: 'Spellcheck integration fixture' } } } });
  snapshot.settings.preferences = { composerSpellcheck, spellcheckLanguage: null };
  const host = await serveTaskFixture(page, snapshot);
  await page.goto('/');
  return { ...host, draft: page.getByRole('textbox', { name: 'Message', exact: true }) };
}

test('prompt textarea follows the composer spellcheck preference while non-prose fields stay off', async ({ page }) => {
  const host = await setup(page);
  await expect(host.draft).toHaveAttribute('spellcheck', 'false');
  // The six non-prose inputs already carry spellCheck={false} in source; the two
  // rendered in this fixture (thread search stays unset-by-design absent here is
  // covered by the unit grep) — assert every rendered non-prose input that
  // declares the attribute keeps it false.
  for (const input of await page.locator('[spellcheck]').all()) await expect(input).toHaveAttribute('spellcheck', 'false');
  await host.publish();
});

test('enabling Check spelling in Settings flips the textarea attribute and persists', async ({ page }) => {
  const host = await setup(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await dialog.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Chat & Composer', exact: true }).click();
  const languageRow = dialog.locator('.settings-row-reveal');
  const toggle = dialog.getByRole('switch', { name: 'Check spelling', exact: true });
  await expect(languageRow).toHaveAttribute('data-open', 'false');
  await toggle.click();
  await expect(languageRow).toHaveAttribute('data-open', 'true');
  await expect(host.draft).toHaveAttribute('spellcheck', 'true');
  expect(host.commands.some(c => c.type === 'settings.update' && (c.payload.preferences as Record<string, unknown> | undefined)?.composerSpellcheck === true)).toBe(true);
  await page.reload();
  await expect(host.draft).toHaveAttribute('spellcheck', 'true');
});
