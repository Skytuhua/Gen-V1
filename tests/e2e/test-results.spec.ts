import { expect, test, type Page } from '@playwright/test';
import type { HostCommand } from '../../packages/contracts';
import { serveTestResultsFixture } from './test-results-fixture';

test.use({ viewport: { width: 1280, height: 800 } });
const card = (page: Page) => page.getByRole('region', { name: 'Test results', exact: true });
const open = async (page: Page, flag = true) => {
  const host = await serveTestResultsFixture(page, { flag });
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled({ timeout: 15000 });
  return host;
};

test('a recorded run renders above the receipt with summary, tree and failure detail', async ({ page }) => {
  await open(page);
  const surface = card(page);
  await expect(surface).toBeVisible();
  await expect(surface.getByRole('button', { name: /Ran 3 tests, 1 failed/ })).toBeVisible();
  const tree = surface.getByRole('tree');
  await expect(tree).toBeVisible();
  // Failed suite opens by default; the failed test row shows its status and duration.
  const failed = tree.getByRole('treeitem', { name: 'includes item quantity failed' });
  await expect(failed).toBeVisible();
  await failed.click();
  const detail = page.getByRole('group', { name: 'Failure details for includes item quantity' });
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('Expected 12, received 3');
  await expect(detail.getByText('Expected', { exact: true })).toBeVisible();
  await expect(detail.getByText('Actual', { exact: true })).toBeVisible();
  await expect(detail).toContainText('at total (src/total.ts:3:15)');
  // The receipt stays below the card.
  await expect(page.getByRole('region', { name: 'Operation outcome' })).toBeVisible();
});

test('tree keyboard navigation moves focus and expands failure detail', async ({ page }) => {
  await open(page);
  const surface = card(page), tree = surface.getByRole('tree');
  await expect(tree).toBeVisible();
  const failed = tree.getByRole('treeitem', { name: 'includes item quantity failed' });
  await failed.focus();
  await page.keyboard.press('ArrowDown');
  await expect(tree.getByRole('treeitem', { name: 'empty basket returns zero passed' })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(failed).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('group', { name: 'Failure details for includes item quantity' })).toBeVisible();
  await page.keyboard.press('End');
  await expect(tree.getByRole('treeitem').last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(tree.getByRole('treeitem').first()).toBeFocused();
});

test('copy failure announces through the live region', async ({ page }) => {
  await open(page);
  const tree = card(page).getByRole('tree');
  await tree.getByRole('treeitem', { name: 'includes item quantity failed' }).click();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy failure for includes item quantity' }).click();
  await expect(card(page).getByRole('status')).toContainText('Failure copied');
});

test('rerun sends the test.rerun command and shows the chip state', async ({ page }) => {
  const host = await open(page);
  const tree = card(page).getByRole('tree');
  await tree.getByRole('treeitem', { name: 'includes item quantity failed' }).click();
  await page.getByRole('button', { name: 'Rerun this test: includes item quantity' }).click();
  const sent = host.commands.find((command: HostCommand) => command.type === 'test.rerun');
  expect(sent).toBeTruthy();
  expect(sent!.payload).toMatchObject({ operationId: 'test-operation', testId: 't00000000000000a1' });
  await host.addRerun('t00000000000000a1', 'running');
  await expect(card(page).getByLabel('Rerunning…')).toBeVisible();
});

test('flag off renders the plain receipt only', async ({ page }) => {
  await open(page, false);
  await expect(page.getByRole('region', { name: 'Operation outcome' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Test results' })).toHaveCount(0);
});

test.describe('narrow viewport', () => {
  test.use({ viewport: { width: 420, height: 800 } });
  test('hides durations and keeps the card usable', async ({ page }) => {
    await open(page);
    const surface = card(page);
    await expect(surface).toBeVisible();
    await expect(surface.locator('.tr-duration')).toBeHidden();
    await expect(surface.getByRole('button', { name: /Ran 3 tests/ })).toBeVisible();
  });
});

test.describe('reduced motion', () => {
  test('renders with opacity-only reduced transitions', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    const surface = card(page);
    await expect(surface).toBeVisible();
    const style = await surface.locator('.tr-caret').first().evaluate(node => { const s = getComputedStyle(node); return { duration: s.transitionDuration, transform: s.transform }; });
    // Reduced motion: duration collapses to <=80ms (global appearance rule pins .01ms).
    expect(['0.01ms', '0.08s', '80ms', '1e-05s']).toContain(style.duration);
    expect(style.transform).toBe('none');
  });
});
