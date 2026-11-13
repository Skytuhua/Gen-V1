import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
const fixture = '/@fs/' + resolve('tests/e2e/usage-context-fixture.tsx').replaceAll('\\', '/');
const update = async (page: Page, action: string) => {
  await expect(page.locator('html')).toHaveAttribute('data-usage-fixture-ready', 'true');
  await page.evaluate(value => window.dispatchEvent(new CustomEvent('usage-fixture', { detail: value })), action);
};
const context = (page: Page) => page.getByRole('dialog', { name: 'Context inspector' });
const usage = (page: Page) => page.getByRole('dialog', { name: 'Usage', exact: true });
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route(url => url.pathname === '/usage-context', route => route.fulfill({ contentType: 'text/html', body: `<html data-theme="dark" data-native-titlebar="true"><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${encodeURI(fixture)}');</script></body></html>` }));
  await page.route('**/api/bootstrap', route => route.fulfill({ json: { csrfToken: 'synthetic' } }));
});
test('a token decrease after a command acknowledgement is not a compaction receipt', async ({ page }) => {
  const commands: { type: string; threadId: string }[] = [];
  await page.route('**/api/commands', route => { commands.push(route.request().postDataJSON()); return route.fulfill({ json: { commandId: 'fixture', eventSeq: 1, result: {} } }); });
  await page.goto('/usage-context'); await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
  await context(page).getByRole('button', { name: 'Compact now', exact: true }).click(); await update(page, 'decrease');
  await expect(context(page)).toBeVisible(); await expect(context(page)).not.toContainText('Freed');
  expect(commands.map(value => [value.type, value.threadId])).toEqual([['run.compact', 'thread-one']]);
});
test('a compaction error does not follow a different thread or session', async ({ page }) => {
  await page.route('**/api/commands', route => route.fulfill({ status: 500, json: { error: { code: 'TEST', message: 'Synthetic compaction failure' } } }));
  await page.goto('/usage-context'); await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
  await page.getByRole('button', { name: 'Compact now', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('Synthetic compaction failure');
  await update(page, 'session'); await expect(context(page)).toBeVisible(); await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Compact now', exact: true }).click(); await expect(page.getByRole('alert')).toBeVisible();
  await update(page, 'thread'); await expect(context(page)).toBeVisible(); await expect(page.getByRole('alert')).toHaveCount(0);
});
test('a late failure from a prior session cannot update the newly selected context', async ({ page }) => {
  let reply: (() => Promise<void>) | undefined;
  await page.route('**/api/commands', route => { reply = () => route.fulfill({ status: 500, json: { error: { code: 'LATE', message: 'Late old-session failure' } } }); });
  await page.goto('/usage-context'); await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
  await context(page).getByRole('button', { name: 'Compact now', exact: true }).click();
  await expect.poll(() => Boolean(reply)).toBe(true); await update(page, 'session'); await reply!();
  await expect(context(page)).toBeVisible(); await expect(context(page).getByRole('alert')).toHaveCount(0);
  await expect(context(page).getByRole('button', { name: 'Compact now', exact: true })).toBeEnabled();
});
test('context takes keyboard focus on reveal and protects IME Escape before restoring its trigger', async ({ page }) => {
  await page.goto('/usage-context'); const opener = page.getByRole('button', { name: 'Inspect context', exact: true }); await opener.click();
  await expect(context(page)).toBeFocused(); await context(page).dispatchEvent('keydown', { key: 'Escape', isComposing: true });
  await expect(context(page)).toBeVisible(); await page.keyboard.press('Escape'); await expect(context(page)).toHaveCount(0); await expect(opener).toBeFocused();
});
test('first reveal in a short window clears native caption chrome and all viewport edges', async ({ page }) => {
  await page.setViewportSize({ width: 340, height: 240 }); await page.goto('/usage-context');
  await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
  const bounds = (await context(page).boundingBox())!;
  expect(bounds.y).toBeGreaterThanOrEqual(50); expect(bounds.x).toBeGreaterThanOrEqual(8);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(332); expect(bounds.y + bounds.height).toBeLessThanOrEqual(232);
});
test('Usage has separate Cost, Tokens and Limits with exact reported data and per-metric unknowns', async ({ page }) => {
  await page.goto('/usage-context'); await page.getByRole('button', { name: 'Open Usage', exact: true }).click();
  await expect(usage(page)).toBeVisible(); await expect(usage(page)).toContainText('0.00123456 USD');
  await usage(page).getByRole('tab', { name: 'Tokens', exact: true }).click();
  await expect(usage(page)).toContainText('Input tokens'); await expect(usage(page)).toContainText('Not reported');
  await usage(page).getByRole('tab', { name: 'Limits', exact: true }).click();
  await expect(usage(page)).toContainText('23.5%'); await expect(usage(page)).toContainText('2030'); await expect(usage(page)).not.toContainText('2030-01-01T12:34:56Z');
  await expect(usage(page)).not.toContainText('Compact'); await expect(usage(page)).not.toContainText('Thread memory');
});
test('accepted receipt needs exact ownership; measured freed count is optional and reset on restart', async ({ page }) => {
  await page.goto('/usage-context'); await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
  await update(page, 'foreign'); await expect(context(page)).not.toContainText('Freed'); await expect(context(page)).not.toContainText('Context compacted');
  await update(page, 'unmeasured'); await expect(context(page)).toContainText('Context compacted'); await expect(context(page)).not.toContainText('Freed');
  await update(page, 'accepted'); await expect(context(page)).toContainText('Freed 4K tokens');
  await update(page, 'restart'); await expect(context(page)).not.toContainText('Freed');
});
test('reported segments fit their capacity track without cumulative separator overflow', async ({ page }) => {
  await page.goto('/usage-context'); await update(page, 'categories'); await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
  const track = (await context(page).locator('.context-segment-bar').boundingBox())!;
  const end = (await context(page).locator('.context-segment').last().boundingBox())!;
  expect(end.x + end.width).toBeLessThanOrEqual(track.x + track.width + 0.1);
});
test('pending sweep is actual-pending only and stopped state is not accepted success', async ({ page }) => {
  await page.goto('/usage-context'); await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
  await expect(context(page).locator('.context-compaction-shimmer')).toHaveCount(0); await update(page, 'pending');
  await expect(context(page).getByRole('button', { name: 'Compacting…', exact: true })).toBeDisabled();
  await update(page, 'cancelled'); await expect(context(page)).toContainText('Compaction stopped'); await expect(context(page).locator('.context-compaction-shimmer')).toHaveCount(0);
});
test('reported categories reveal token/share/subitems on focus after dwell; IME and nested Escape work', async ({ page }) => {
  await page.goto('/usage-context'); await update(page, 'categories'); await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
  await expect(context(page)).not.toContainText('Session limit'); await expect(context(page)).not.toContainText('Cost');
  const tools = context(page).getByRole('button', { name: 'Tools & MCP', exact: false }); await tools.focus();
  await expect(page.getByRole('tooltip')).toContainText('500 tokens'); await expect(page.getByRole('tooltip')).toContainText('5.0%');
  await expect(page.getByRole('tooltip')).toContainText('Reported tool instructions');
  await tools.dispatchEvent('keydown', { key: 'Escape', isComposing: true }); await expect(page.getByRole('tooltip')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('tooltip')).toHaveCount(0); await expect(context(page)).toBeVisible();
  await page.keyboard.press('Escape'); await expect(context(page)).toHaveCount(0); await expect(page.getByRole('button', { name: 'Inspect context', exact: true })).toBeFocused();
});
test('unknown and invalid category measurements never retain stale values', async ({ page }) => {
  await page.goto('/usage-context'); await update(page, 'categories'); await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
  await expect(context(page)).toContainText('System'); await update(page, 'unknown');
  await expect(context(page)).toContainText('once the runtime measures this session'); await expect(context(page)).not.toContainText('System'); await expect(context(page)).not.toContainText('6K');
});
test('scope/provider filters remain in the owning modal and refresh preserves tab and selection', async ({ page }) => {
  await page.goto('/usage-context'); await page.getByRole('button', { name: 'Open Usage', exact: true }).click();
  await usage(page).getByRole('tab', { name: 'Tokens', exact: true }).focus(); await page.keyboard.press('ArrowRight');
  await expect(usage(page).getByRole('tab', { name: 'Limits', exact: true })).toHaveAttribute('aria-selected', 'true');
  await usage(page).getByRole('combobox', { name: 'Usage scope', exact: true }).click();
  const list = usage(page).getByRole('listbox', { name: 'Usage scope', exact: true }); await expect(list).toBeVisible();
  await list.getByRole('option', { name: 'Synthetic Alpha', exact: true }).click();
  await usage(page).getByRole('button', { name: 'Refresh usage', exact: true }).click();
  await expect(usage(page).getByRole('tabpanel')).not.toContainText('Synthetic Beta');
  await usage(page).getByRole('combobox', { name: 'Usage provider', exact: true }).click();
  await page.keyboard.press('Escape'); await expect(usage(page)).toBeVisible(); await page.keyboard.press('Escape'); await expect(usage(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open Usage', exact: true })).toBeFocused();
});
test('loading, empty, provider failure and refresh failure preserve honest per-metric state', async ({ page }) => {
  await page.goto('/usage-context'); await update(page, 'loading'); await page.getByRole('button', { name: 'Open Usage', exact: true }).click();
  await expect(usage(page).getByRole('status')).toContainText('Loading usage'); await expect(usage(page)).not.toContainText('No usage reported');
  await update(page, 'empty'); await expect(usage(page)).toContainText('No usage reported');
  await update(page, 'error'); await expect(usage(page).getByRole('alert')).toContainText('Synthetic provider failure');
  await update(page, 'refresh-error'); await usage(page).getByRole('button', { name: 'Refresh usage', exact: true }).click();
  await expect(usage(page).getByRole('alert')).toContainText('Synthetic refresh failure'); await expect(usage(page)).toContainText('0.00123456 USD');
});
for (const theme of ['dark', 'light']) test(`overflow keeps header fixed, rows scroll, short/narrow ${theme}`, async ({ page }, info) => {
  await page.setViewportSize({ width: 340, height: 320 }); await page.goto('/usage-context?overflow=1');
  await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
  await page.getByRole('button', { name: 'Open Usage', exact: true }).click();
  const modal = usage(page), rows = modal.getByRole('tabpanel'), header = modal.locator('.ui-modal-header');
  const before = await header.boundingBox(); await rows.evaluate(node => node.scrollTop = node.scrollHeight);
  expect(await header.boundingBox()).toEqual(before); expect(await rows.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  const bounds = (await modal.boundingBox())!; expect(bounds.x).toBeGreaterThanOrEqual(8); expect(bounds.y).toBeGreaterThanOrEqual(50);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(332); expect(bounds.y + bounds.height).toBeLessThanOrEqual(312);
  expect(await modal.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`usage-${theme}-short.png`) });
});
for (const theme of ['dark', 'light']) test(`context category overflow and details stay reachable in ${theme}`, async ({ page }, info) => {
  await page.setViewportSize({ width: 340, height: 320 }); await page.goto('/usage-context');
  await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
  await update(page, 'categories'); await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
  const dialog = context(page), tools = dialog.getByRole('button', { name: /Tools & MCP/ });
  await tools.focus(); await expect(page.getByRole('tooltip')).toContainText('Reported tool instructions');
  const detail = (await page.getByRole('tooltip').boundingBox())!;
  expect(detail.x).toBeGreaterThanOrEqual(8); expect(detail.y).toBeGreaterThanOrEqual(50);
  expect(detail.x + detail.width).toBeLessThanOrEqual(332); expect(detail.y + detail.height).toBeLessThanOrEqual(312);
  await page.screenshot({ path: info.outputPath(`context-${theme}-short.png`) });
  await page.keyboard.press('Escape'); await dialog.getByRole('button', { name: /^Free/ }).focus();
  await expect(page.getByRole('tooltip')).toContainText('3,000 tokens');
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
});
test('accepted transition uses reference timing; reduced motion suppresses travel and sweep', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.goto('/usage-context'); await update(page, 'categories');
  await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
  expect(await context(page).evaluate(node => getComputedStyle(node).animationDuration)).toBe('0.18s');
  await update(page, 'accepted'); await expect(context(page)).toContainText('Freed 4K tokens');
  expect(await context(page).locator('.context-segment').evaluateAll(nodes => nodes.some(node => node.getAnimations().some(animation => animation.effect?.getTiming().duration === 600)))).toBe(true);
  expect(await context(page).locator('.context-segment').first().evaluate(node => getComputedStyle(node).transitionDuration)).toBe('0.6s');
  expect(await context(page).getByRole('status').evaluate(node => getComputedStyle(node).animationDuration)).toBe('0.24s');
  await page.emulateMedia({ reducedMotion: 'reduce' }); await update(page, 'pending');
  await expect(context(page).locator('.context-compaction-shimmer')).toBeHidden();
  expect(await context(page).evaluate(node => getComputedStyle(node).animationName)).toBe('none');
});
test('optional summary keeps whole-header disclosure and opens the same Usage through its independent body action', async ({ page }) => {
  await page.goto('/usage-context'); const summary = page.getByRole('region', { name: 'Live usage', exact: true });
  const header = summary.getByRole('button', { name: 'Inspect live usage', exact: true });
  await header.focus(); await page.keyboard.press('Space'); await expect(summary.getByRole('button', { name: 'Open Usage', exact: true })).toBeVisible();
  await summary.getByRole('button', { name: 'Open Usage', exact: true }).click(); await expect(usage(page)).toBeVisible();
});

test('invalidating a receipt ends accepted motion immediately and after its timer deadline',async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});await page.goto('/usage-context');await update(page,'categories');
  await page.getByRole('button',{name:'Inspect context',exact:true}).click();await update(page,'accepted');
  await expect(context(page).locator('.context-measurement-accepted')).toHaveCount(1);
  await update(page,'cancelled');await expect(context(page)).toContainText('Compaction stopped');
  expect(await context(page).locator('.context-measurement-accepted').count()).toBe(0);
  expect(await context(page).locator('.context-receipt-pulse').count()).toBe(0);
  await page.waitForTimeout(750);
  expect(await context(page).locator('.context-measurement-accepted,.context-receipt-pulse').count()).toBe(0);
});
