import { test, expect, type Page } from '@playwright/test';

async function fixture(page: Page) {
  const requests: string[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:5821' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/widget-runtime')) {
      requests.push(url.href); return route.abort();
    }
    return route.continue();
  });
  await page.goto('/tests/e2e/fixtures/background-work.html');
  await expect(page.locator('.background-card')).toHaveCount(9);
  return { requests, errors };
}
const calls = (page: Page) => page.evaluate(() => window.backgroundWork.calls);
const card = (page: Page, workId: string) => page.locator(`.background-card[data-work-id="${workId}"]`);

test('drawer shows every required state with command, owner, elapsed and Open child task', async ({ page }) => {
  const { requests, errors } = await fixture(page);
  await expect(card(page, 'w-queued').locator('.background-state')).toHaveText('Waiting');
  await expect(card(page, 'w-running').locator('.background-state')).toHaveText('Running');
  await expect(card(page, 'w-human').locator('.background-state').first()).toHaveText('Waiting for you');
  await expect(card(page, 'w-blocked').locator('.background-state')).toHaveText('Blocked');
  await expect(card(page, 'w-blocked')).toContainText('HOLD_FORK_API');
  await expect(card(page, 'w-ok').locator('.background-state')).toHaveText('Completed');
  await expect(card(page, 'w-ok').locator('.background-outcome')).toHaveText('Succeeded');
  await expect(card(page, 'w-failed').locator('.background-outcome')).toHaveText('Failed');
  await expect(card(page, 'w-cancelled').locator('.background-outcome')).toHaveText('Cancelled');
  await expect(card(page, 'w-unknown').locator('.background-state')).toHaveText('Outcome unknown');
  await expect(card(page, 'w-unknown')).toContainText('exit receipt');
  await expect(card(page, 'w-running')).toContainText('/usr/bin/node -e console.log(1)');
  await expect(card(page, 'w-running')).toContainText('thread-b');
  await expect(card(page, 'w-running')).toContainText('pid 4242');
  await expect(card(page, 'w-running')).toContainText('Elapsed');
  await card(page, 'w-running').getByRole('button', { name: 'Open child task' }).click();
  expect(await calls(page)).toContainEqual({ type: 'open', id: 'thread-b' });
  expect(requests).toEqual([]); expect(errors).toEqual([]);
});

test('human card responds with the exact request revision and declines without approval', async ({ page }) => {
  const { requests, errors } = await fixture(page);
  const human = card(page, 'w-human').locator('.background-human');
  await expect(human).toContainText('req-1');
  await expect(human).toContainText('revision 2');
  await human.getByLabel('Answer').fill('proceed carefully');
  await human.getByRole('button', { name: 'Respond' }).click();
  await expect.poll(() => calls(page)).toContainEqual({ type: 'respond', id: 'req-1', revision: 2, response: { answer: 'proceed carefully' } });
  await expect(card(page, 'w-human').locator('.background-state').first()).toHaveText('Waiting');
  await expect(card(page, 'w-human').locator('.background-human')).toHaveCount(0);
  expect(requests).toEqual([]); expect(errors).toEqual([]);
});

test('decline settles the human step as cancelled without an approval', async ({ page }) => {
  const { requests, errors } = await fixture(page);
  const human = card(page, 'w-human').locator('.background-human');
  await human.getByRole('button', { name: 'Decline' }).click();
  await expect.poll(() => calls(page)).toContainEqual({ type: 'decline', id: 'req-1', revision: 2 });
  await expect(card(page, 'w-human').locator('.background-outcome')).toHaveText('Cancelled');
  expect(await calls(page)).not.toContainEqual(expect.objectContaining({ type: 'respond' }));
  expect(requests).toEqual([]); expect(errors).toEqual([]);
});

test('credential steps expose no plaintext entry and point at the secure surface', async ({ page }) => {
  await fixture(page);
  const credential = card(page, 'w-credential').locator('.background-human');
  await expect(credential).toContainText('secure credential surface');
  await expect(credential.locator('input')).toHaveCount(0);
  await expect(credential.getByRole('button', { name: 'Respond' })).toHaveCount(0);
});

test('failed and stale responses surface errors without completing work', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => { window.backgroundWork.respondMode = 'stale'; });
  const human = card(page, 'w-human').locator('.background-human');
  await human.getByLabel('Answer').fill('late answer');
  await human.getByRole('button', { name: 'Respond' }).click();
  await expect(human.locator('.error-text')).toContainText('no longer pending');
  await expect(card(page, 'w-human').locator('.background-state').first()).toHaveText('Waiting for you');
  await page.evaluate(() => { window.backgroundWork.respondMode = 'reject'; });
  await human.getByRole('button', { name: 'Respond' }).click();
  await expect(human.locator('.error-text')).toContainText('could not be delivered');
  expect(await calls(page)).not.toContainEqual(expect.objectContaining({ type: 'decline' }));
});

test('output uses cursor-based retrieval and refresh keeps the returned cursor', async ({ page }) => {
  const { requests, errors } = await fixture(page);
  const running = card(page, 'w-running');
  await running.getByRole('button', { name: 'Output' }).click();
  await expect(running.locator('.background-output pre')).toContainText('cursor was 0');
  await running.getByRole('button', { name: 'Refresh output' }).click();
  await expect(running.locator('.background-output pre')).toContainText('cursor was 9');
  expect(await calls(page)).toEqual([
    { type: 'output', id: 'w-running', cursor: 0 },
    { type: 'output', id: 'w-running', cursor: 9 },
  ]);
  await page.evaluate(() => { window.backgroundWork.outputMode = 'reject'; });
  await running.getByRole('button', { name: 'Refresh output' }).click();
  await expect(running.locator('.error-text')).toContainText('Output could not load');
  expect(requests).toEqual([]); expect(errors).toEqual([]);
});

test('schedules expose next occurrence, display timezone, last run and pause custody', async ({ page }) => {
  const { requests, errors } = await fixture(page);
  const row = page.locator('.background-schedule[data-wakeup-id="s-interval"]');
  await expect(row).toContainText('Every 60s (UTC interval)');
  await expect(row).toContainText('timezone Europe/Berlin (display only)');
  await expect(row).toContainText('last run');
  await expect(row).toContainText('skipped 4');
  await row.getByRole('button', { name: 'Pause' }).click();
  await expect.poll(() => calls(page)).toContainEqual({ type: 'pause', id: 's-interval' });
  await expect(row.getByRole('button', { name: 'Resume' })).toBeVisible();
  await row.getByRole('button', { name: 'Resume' }).click();
  await expect.poll(() => calls(page)).toContainEqual({ type: 'resume', id: 's-interval' });
  expect(requests).toEqual([]); expect(errors).toEqual([]);
});

test('external inbox separates proposed from approved and gates approval on a model', async ({ page }) => {
  const { requests, errors } = await fixture(page);
  const inbox = page.locator('.background-intake');
  await expect(inbox).toContainText('repository 1442565952');
  await expect(inbox).toContainText('source octocat');
  const proposed = inbox.locator('.background-intake-row[data-intake-id="i-proposed"]');
  await expect(proposed).toContainText('Repair the export path');
  await expect(proposed.getByRole('button', { name: 'Approve' })).toBeDisabled();
  await proposed.getByRole('combobox', { name: 'Approval model' }).click();
  await page.getByRole('option', { name: 'Test model' }).click();
  await expect(proposed.getByRole('button', { name: 'Approve' })).toBeEnabled();
  await proposed.getByRole('button', { name: 'Approve' }).click();
  await expect.poll(() => calls(page)).toContainEqual({ type: 'approve', id: 'i-proposed', modelId: 'test/model' });
  await expect(inbox.locator('[data-intake-list="proposed"] .background-intake-row[data-intake-id="i-proposed"]')).toHaveCount(0);
  await expect(inbox.locator('[data-intake-list="approved"] .background-intake-row[data-intake-id="i-proposed"]')).toHaveCount(1);
  await inbox.locator('.background-intake-row[data-intake-id="i-approved"]').getByRole('button', { name: 'Open child task' }).click();
  expect(await calls(page)).toContainEqual({ type: 'open', id: 'thread-approved' });
  await expect(inbox).toContainText('Rejected or duplicate deliveries: 1 (WRONG_REPOSITORY)');
  expect(requests).toEqual([]); expect(errors).toEqual([]);
});

test('close warning never promises sleep execution and quarantine stays visible', async ({ page }) => {
  await fixture(page);
  const warning = page.locator('.background-close-warning');
  await expect(warning).toContainText('Background work stops when Gen closes');
  await expect(warning).toContainText('laptop sleep never runs work');
  await expect(warning).toContainText('1 uncertain outcome(s) remain quarantined');
});

test('loading, empty, offline and retry states stay distinct from success', async ({ page }) => {
  const { requests, errors } = await fixture(page);
  await page.evaluate(() => { window.backgroundWork.refreshMode = 'loading'; });
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('status')).toContainText('Loading background work');
  await page.evaluate(() => { window.backgroundWork.refreshMode = 'empty'; });
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.locator('.background-empty')).toContainText('No background work yet');
  await page.evaluate(() => { window.backgroundWork.refreshMode = 'error'; });
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('alert')).toContainText('reconnecting');
  await page.evaluate(() => { window.backgroundWork.refreshMode = 'success'; });
  await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('.background-card')).toHaveCount(9);
  expect(requests).toEqual([]); expect(errors).toEqual([]);
});

test('cancel is offered only for live work and records the owned stop', async ({ page }) => {
  await fixture(page);
  await expect(card(page, 'w-ok').getByRole('button', { name: 'Cancel' })).toHaveCount(0);
  await expect(card(page, 'w-unknown').getByRole('button', { name: 'Cancel' })).toHaveCount(0);
  await card(page, 'w-queued').getByRole('button', { name: 'Cancel' }).click();
  await expect.poll(() => calls(page)).toContainEqual({ type: 'cancel', id: 'w-queued' });
  await expect(card(page, 'w-queued').locator('.background-outcome')).toHaveText('Cancelled');
});
