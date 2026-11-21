import { test, expect, type Page } from '@playwright/test';
import { serveTaskFixture, taskFixture } from './task-interface-fixture';
import { EMPTY_USAGE, type Snapshot } from '../../packages/contracts';

// Run A: 72 s completed. Run B: 4,309 s stopped, preceded by an activity group.
// Run C: active, started 65 s before the frozen clock.
const FROZEN = new Date(Date.now() + 60 * 60 * 1000);
const stamp = (offsetMs: number) => new Date(FROZEN.getTime() + offsetMs).toISOString();

function fixture(): Snapshot {
  const snapshot = taskFixture({ root: 'text', elements: { text: { type: 'Text', props: { text: 'Review the supplied brief.' } } } });
  const thread = snapshot.threads[0]!;
  thread.status = 'working'; thread.runId = 'c';
  snapshot.messages = [
    { id: 'u-a', threadId: thread.id, role: 'user', content: 'First turn', runId: 'a', createdAt: stamp(-400000) },
    { id: 'r-a', threadId: thread.id, role: 'assistant', content: 'Run A reply text.', runId: 'a', createdAt: stamp(-390000) },
    { id: 'act-b1', threadId: thread.id, role: 'activity', content: 'B searched the codebase.', runId: 'b', createdAt: stamp(-300000) },
    { id: 'act-b2', threadId: thread.id, role: 'activity', content: 'B edited two files.', runId: 'b', createdAt: stamp(-290000) },
    { id: 'r-b', threadId: thread.id, role: 'assistant', content: 'Run B reply.', runId: 'b', createdAt: stamp(-280000) },
    { id: 'u-c', threadId: thread.id, role: 'user', content: 'Third turn', runId: 'c', createdAt: stamp(-120000) },
  ];
  snapshot.artifacts = [];
  snapshot.turnTimings = [
    { runId: 'a', threadId: thread.id, startedAt: stamp(-400000), endedAt: stamp(-328000), outcome: 'completed' },
    { runId: 'b', threadId: thread.id, startedAt: stamp(-4589000), endedAt: stamp(-280000), outcome: 'stopped' },
    { runId: 'c', threadId: thread.id, startedAt: stamp(-65000) },
  ];
  snapshot.usage[thread.id] = { ...EMPTY_USAGE, activity: 'generating' };
  snapshot.settings.preferences = { ...snapshot.settings.preferences, timeFormat: '24h' };
  return snapshot;
}

async function serve(page: Page) {
  const snapshot = fixture();
  const host = await serveTaskFixture(page, snapshot);
  await page.goto('/');
  await expect(page.locator('.turn-duration')).toHaveCount(2);
  return { host, snapshot };
}

test('finished runs show one duration line under their last row', async ({ page }) => {
  await serve(page);
  const lines = page.locator('.turn-duration');
  await expect(lines.nth(0)).toHaveText(/Worked for 1m 12s/);
  await expect(lines.nth(1)).toHaveText(/Stopped after 1h 11m 49s/);
  await expect(page.locator('.message[data-message-id="r-a"] + .turn-duration')).toHaveCount(1);
  await expect(page.locator('.message[data-message-id="r-b"] + .turn-duration')).toHaveCount(1);
  await expect(lines.nth(0).locator('time')).toHaveAttribute('dateTime', 'PT1M12S');
  await expect(lines.nth(1).locator('time')).toHaveAttribute('dateTime', 'PT1H11M49S');
  // Restored lines carry no insertion animation flag.
  await expect(lines.nth(0)).not.toHaveAttribute('data-arrival', 'true');
});

test('hover title honors the 12h and 24h time format preference', async ({ page }) => {
  const { host, snapshot } = await serve(page);
  const line = page.locator('.turn-duration').first();
  const h24 = await line.getAttribute('title');
  expect(h24).toMatch(/^Started .+ · ended .+$/);
  expect(h24).not.toMatch(/[AP]M/);
  snapshot.settings.preferences = { ...snapshot.settings.preferences, timeFormat: '12h' };
  await host.publish();
  const h12 = await line.getAttribute('title');
  expect(h12).toMatch(/^Started .+ · ended .+$/);
  expect(h12).toMatch(/[AP]M/);
});

test('working status counts live without resetting across activity changes', async ({ page }) => {
  await page.clock.install();
  await page.clock.pauseAt(FROZEN);
  const { host, snapshot } = await serve(page);
  const status = page.locator('.working-status');
  await expect(status).toContainText('Generating…');
  await expect(status.locator('.turn-elapsed')).toHaveText('1m 5s');
  await page.clock.runFor(1000);
  await expect(status.locator('.turn-elapsed')).toHaveText('1m 6s');
  snapshot.usage[snapshot.threads[0]!.id] = { ...EMPTY_USAGE, activity: 'tool' };
  await host.publish();
  await expect(status).toContainText('Running tool…');
  await page.clock.runFor(1000);
  await expect(status.locator('.turn-elapsed')).toHaveText('1m 7s');
});

test('a run ending live arrives animated and reduced motion swaps the keyframes', async ({ page }) => {
  await page.clock.install();
  await page.clock.pauseAt(FROZEN);
  const { host, snapshot } = await serve(page);
  snapshot.turnTimings![2] = { ...snapshot.turnTimings![2]!, endedAt: stamp(0), outcome: 'completed' };
  snapshot.threads[0]!.runId = null; snapshot.threads[0]!.status = 'completed';
  await host.publish();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const fresh = page.locator('.turn-duration').nth(2);
  await expect(fresh).toHaveText(/Worked for 1m 5s/);
  await expect(fresh).toHaveAttribute('data-arrival', 'true');
  expect(await fresh.evaluate(node => getComputedStyle(node).animationName)).not.toBe('ui-item-in');
});

test('the duration line stays out of Conversation Find and Copy message', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await serve(page);
  await page.locator('.composer textarea').focus();
  await page.keyboard.press('Control+f');
  await page.getByRole('textbox', { name: 'Find phrase' }).fill('Worked');
  await expect(page.getByRole('status').filter({ hasText: '0 results' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('.message[data-message-id="r-a"]').getByRole('button', { name: 'Copy message', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Run A reply text.');
});

for (const variant of [{ name: 'light', theme: 'light', width: 1440 }, { name: 'dark', theme: 'dark', width: 1440 }, { name: 'narrow', theme: 'light', width: 390 }] as const)
  test(`evidence: duration lines and live count in ${variant.name}`, async ({ page }, info) => {
    test.skip(process.env.HARNESS_CAPTURE_UI !== '1', 'Opt-in UI evidence capture.');
    await page.clock.install();
    await page.clock.pauseAt(FROZEN);
    await page.setViewportSize({ width: variant.width, height: 1000 });
    const snapshot = fixture();
    snapshot.settings.theme = variant.theme;
    await serveTaskFixture(page, snapshot);
    await page.goto('/');
    await expect(page.locator('.turn-duration')).toHaveCount(2);
    await expect(page.locator('.turn-elapsed')).toHaveText('1m 5s');
    await page.screenshot({ path: info.outputPath(`turn-duration-${variant.name}.png`), fullPage: true });
  });
