import { test, expect } from '@playwright/test';
import { serveTestResultsFixture } from './test-results-fixture';
for (const [name, theme, width] of [['dark', 'dark', 1280], ['light', 'light', 1280], ['narrow', 'dark', 420]] as const) {
  test(`shot ${name}`, async ({ page }) => {
    const host = await serveTestResultsFixture(page);
    host.snapshot.settings.theme = theme;
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    const card = page.getByRole('region', { name: 'Test results', exact: true });
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.getByRole('tree').getByRole('treeitem', { name: 'includes item quantity failed' }).click();
    await card.screenshot({ path: `test-results-test-results/card-${name}.png` });
  });
}
