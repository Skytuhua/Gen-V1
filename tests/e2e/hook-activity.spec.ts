import {test, expect} from '@playwright/test';
import {taskFixture, serveTaskFixture} from './task-interface-fixture';

const spec = {root: 'text', elements: {text: {type: 'Text', props: {text: 'Hook rows fixture'}}}};
const now = '2026-10-29T23:00:00.000Z';
const activity = (id: string, content: string, threadId = 'task-thread') => ({id, threadId, role: 'activity' as const, content, runId: null, createdAt: now, activityKind: 'hook' as const});

test('hook activity rows show the icon, line, and escaped collapsed output', async ({page}) => {
  const snapshot = taskFixture(spec);
  snapshot.messages.push(
    activity('h1', 'Hook guard blocked repository_test_prepare: forbidden · 3 ms\n<b>bold</b> raw output'),
    activity('h2', 'Hook lint failed (exit 1): Hook lint exited 1. · 5 ms'),
    activity('h3', 'Hook slow timed out after 30 s · 30001 ms'),
    activity('h4', 'Hook notify: tests still running · 4 ms'),
  );
  await serveTaskFixture(page, snapshot);
  await page.goto('/');
  const group = page.locator('details.activity');
  await expect(group).toBeVisible({timeout: 15000});
  await group.locator('> summary').click();
  const rows = page.locator('.activity-hook');
  await expect(rows).toHaveCount(4);
  await expect(rows.locator('svg.lucide-webhook')).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('Hook guard blocked repository_test_prepare: forbidden');
  await expect(rows.nth(1)).toContainText('Hook lint failed (exit 1)');
  await expect(rows.nth(2)).toContainText('Hook slow timed out after 30 s');
  await expect(rows.nth(3)).toContainText('Hook notify: tests still running');
  // Output stays collapsed until the row's own expand affordance, and renders escaped.
  const output = rows.nth(0).locator('.activity-hook-output');
  await expect(output.locator('pre')).toBeHidden();
  await output.locator('summary').click();
  const pre = output.locator('pre');
  await expect(pre).toBeVisible();
  await expect(pre).toContainText('<b>bold</b> raw output');
  await expect(pre.locator('b')).toHaveCount(0);
});

test('a blocked prompt keeps the draft and shows the hook message under the composer', async ({page}) => {
  await serveTaskFixture(page, taskFixture(spec));
  await page.route('**/api/commands', async route => {
    const command = route.request().postDataJSON() as {type: string};
    if (command.type === 'message.send') return route.fulfill({status: 409, json: {error: {code: 'HOOK_BLOCKED', message: 'Blocked by hook Key check: Prompt contains what looks like an API key.'}}});
    return route.fallback();
  });
  await page.goto('/');
  const draft = page.getByRole('textbox', {name: 'Message', exact: true});
  await draft.fill('remember sk-test-key');
  await page.getByRole('button', {name: 'Send message', exact: true}).click();
  const banner = page.locator('.composer-error', {hasText: 'Blocked by hook Key check: Prompt contains what looks like an API key.'});
  await expect(banner).toBeVisible();
  await expect(banner.locator('svg.lucide-ban')).toBeVisible();
  await expect(draft).toHaveValue('remember sk-test-key');
  await draft.fill('remember nothing sensitive');
  await expect(banner).toHaveCount(0);
});
