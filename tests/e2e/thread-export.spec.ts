import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { serveTaskFixture, taskFixture } from './task-interface-fixture';

const DOCUMENT = [
  '<!-- gen-v1-thread-export v1 -->',
  '# Release plan',
  '',
  '| | |',
  '|---|---|',
  '| Messages | 2 |',
  '',
  '## User · 2026-10-29T23:00:00.000Z',
  '',
  'First fixture message',
  '',
  '## Assistant · 2026-10-29T23:01:00.000Z',
  '',
  'Last fixture message',
  '',
  '### Plan · revision 1 — Prepare the handoff',
  '',
  '1. [done] Review',
  '',
  '<details>',
  '<summary>Tool activity (2)</summary>',
  '',
  '- 23:00:10Z `bash: running`',
  '- 23:00:20Z `write: out.md`',
  '',
  '</details>',
  '',
].join('\n');

test('the sidebar options menu exports the row thread as a Markdown download', async ({ page }) => {
  const snapshot = taskFixture({ root: 'stack', elements: { stack: { type: 'Stack', props: { children: [] } } } });
  snapshot.threads[0]!.title = 'Release plan';
  await serveTaskFixture(page, snapshot);
  await page.route('**/api/threads/task-thread/export.md', route => route.fulfill({
    status: 200,
    contentType: 'text/markdown; charset=utf-8',
    headers: { 'X-Gen-Export-Filename': 'release-plan-2026-10-29.md', 'Cache-Control': 'no-store' },
    body: DOCUMENT,
  }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Options for Release plan', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export “Release plan” as Markdown' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('release-plan-2026-10-29.md');
  const saved = await readFile((await file.path())!, 'utf8');
  expect(saved).toContain('First fixture message');
  expect(saved).toContain('Last fixture message');
  expect(saved).toContain('### Plan · revision 1');
  expect(saved).toContain('<summary>Tool activity (2)</summary>');
  await expect(page.getByRole('status').filter({ hasText: 'Exported “Release plan”' })).toBeVisible();
});
