import type { Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ReviewComment } from '../../packages/contracts/review-comments.ts';
import { browserCommand } from '../host-fixture.ts';
import { REVIEW_FIXTURE_LABEL, REVIEW_HOST_URL, REVIEW_NOT_CHANGED_NOTE, test, expect, type ReviewHostFixture } from '../review-comments-host-fixture.ts';

const git = promisify(execFile);
const composer = (page: Page) => page.getByRole('textbox', { name: 'Message', exact: true });
const review = (page: Page) => page.locator('.review-diff');
const plain = (page: Page) => page.locator('pre.live-diff');
const gutter = (page: Page, path: string, side: 'new' | 'old', line: number) =>
  page.getByRole('button', { name: `Comment on ${path} ${side} line ${line}`, exact: true });
const card = (page: Page, text: string) => review(page).locator('article.review-comment').filter({ hasText: text });
const comments = (host: ReviewHostFixture, threadId: string) => host.store.all<ReviewComment>('reviewComment', threadId);

const ALPHA_BASE = Array.from({ length: 40 }, (_, index) => `export const line${index + 1} = ${index + 1};`).join('\n') + '\n';

async function seedProject(host: ReviewHostFixture) {
  await mkdir(join(host.projectPath, 'src'), { recursive: true });
  await writeFile(join(host.projectPath, 'src/alpha.ts'), ALPHA_BASE);
  await writeFile(join(host.projectPath, 'src/obsolete.ts'),
    Array.from({ length: 8 }, (_, index) => `export const gone${index + 1} = ${index + 1};`).join('\n') + '\n');
  await host.git('init', '-b', 'main');
  await host.git('config', 'user.email', 'review-fixture@example.test');
  await host.git('config', 'user.name', 'Review Fixture');
  await host.git('add', '-A');
  await host.git('commit', '-m', 'Seed review fixture');
}

/** Worktree edit, staged new file, deletion and an untracked file. */
async function seedChanges(worktree: string) {
  const appended = ['one', 'two', 'three', 'four', 'five', 'six'].map(name => `export const extra${name} = true;`);
  await writeFile(join(worktree, 'src/alpha.ts'), ALPHA_BASE.replace('line5 = 5;', 'line5 = 55;') + appended.join('\n') + '\n');
  await rm(join(worktree, 'src/obsolete.ts'));
  await writeFile(join(worktree, 'src/staged-beta.ts'),
    Array.from({ length: 10 }, (_, index) => `export const staged${index + 1} = ${index + 1};`).join('\n') + '\n');
  await git('git', ['-C', worktree, 'add', 'src/staged-beta.ts']);
  await writeFile(join(worktree, 'stray-notes.txt'), 'Untracked notes stay out of the diff.\n');
}

async function connectProject(page: Page, host: ReviewHostFixture) {
  await page.goto(REVIEW_HOST_URL);
  await expect(composer(page)).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toHaveText(REVIEW_FIXTURE_LABEL);
  await page.getByRole('button', { name: 'New thread', exact: true }).click();
  await page.getByRole('button', { name: 'Add project', exact: true }).click();
  const connection = page.getByRole('dialog', { name: 'Connect project', exact: true });
  await connection.getByRole('textbox', { name: 'Project name', exact: true }).fill('Review project');
  await connection.getByRole('textbox', { name: 'Local folder', exact: true }).fill(host.projectPath);
  await connection.getByRole('button', { name: 'Connect project', exact: true }).click();
  await page.getByRole('option', { name: 'Review project', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Select project', exact: true })).toHaveCount(0);
  await expect.poll(() => host.store.snapshot().threads.length).toBe(1);
  const thread = host.store.snapshot().threads[0]!;
  // Persist the chosen model the way the composer model picker does.
  await browserCommand(page, 'settings.update', { modelId: 'fixture/review-comments' });
  await composer(page).click(); await composer(page).fill('Set up the review workspace.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => host.runtime.deliveries.length).toBe(1);
  await expect.poll(() => host.service.thread(thread.id).status).toBe('ready');
  await expect.poll(() => host.store.all('workspaceBinding', thread.id).length).toBe(1);
  return thread;
}

async function openChanges(page: Page) {
  await page.getByRole('button', { name: 'Inspect changes', exact: true }).click();
  await expect(plain(page)).toBeAttached();
}

test('worktree comments send, resolve, hide, reopen, edit and resend through the real host', async ({ page, reviewHost }, info) => {
  await seedProject(reviewHost);
  const thread = await connectProject(page, reviewHost);
  await seedChanges(reviewHost.worktree(thread.id));

  await openChanges(page);
  await expect(review(page)).toBeVisible();
  await expect(plain(page)).toBeHidden();
  // The untracked file is listed in the change summary but never commentable.
  await expect(page.locator('.live-change-list')).toContainText('stray-notes.txt');
  await expect(page.locator('section.review-diff-file[aria-label="stray-notes.txt"]')).toHaveCount(0);
  await expect(review(page).getByRole('button', { name: /^Comment on stray-notes\.txt/ })).toHaveCount(0);

  // Mouse: single-line comment submitted with Ctrl+Enter.
  await gutter(page, 'src/alpha.ts', 'new', 41).click();
  const single = page.getByRole('form', { name: 'Comment on src/alpha.ts lines 41-41', exact: true });
  await expect(single.getByRole('textbox', { name: 'Review comment', exact: true })).toBeFocused();
  await single.getByRole('textbox', { name: 'Review comment', exact: true }).fill('Rename this helper for clarity.');
  await single.getByRole('textbox', { name: 'Review comment', exact: true }).press('Control+Enter');
  await expect(single).toHaveCount(0);
  const first = card(page, 'Rename this helper');
  await expect(first).toContainText('src/alpha.ts:41 · draft');

  // Keyboard: Enter opens the composer, Escape cancels and restores focus.
  await gutter(page, 'src/alpha.ts', 'new', 43).press('Enter');
  await expect(page.getByRole('form', { name: 'Comment on src/alpha.ts lines 43-43' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('form', { name: /^Comment on src\/alpha\.ts/ })).toHaveCount(0);
  await expect(gutter(page, 'src/alpha.ts', 'new', 43)).toBeFocused();

  // Mouse: Shift+click extends the range; the form button submits.
  await gutter(page, 'src/alpha.ts', 'new', 43).click();
  await gutter(page, 'src/alpha.ts', 'new', 45).click({ modifiers: ['Shift'] });
  const range = page.getByRole('form', { name: 'Comment on src/alpha.ts lines 43-45', exact: true });
  await expect(range).toBeVisible();
  await range.getByRole('textbox', { name: 'Review comment', exact: true }).fill('Collapse these into a table.');
  await range.getByRole('button', { name: 'Comment', exact: true }).click();
  const second = card(page, 'Collapse these');
  await expect(second).toContainText('src/alpha.ts:43-45 · draft');

  // Deleted lines take an old-side comment.
  await gutter(page, 'src/obsolete.ts', 'old', 3).click();
  const removed = page.getByRole('form', { name: 'Comment on src/obsolete.ts lines 3-3', exact: true });
  await removed.getByRole('textbox', { name: 'Review comment', exact: true }).fill('Confirm this removal is safe.');
  await removed.getByRole('textbox', { name: 'Review comment', exact: true }).press('Control+Enter');
  const third = card(page, 'Confirm this removal');
  await expect(third).toContainText('src/obsolete.ts:3 · draft');

  // All three drafts leave in one send; the scripted agent resolves through
  // review_comment_resolve and the third settles as unaddressed.
  await expect(review(page).locator('.review-diff-send-bar')).toContainText('3 review comments ready');
  await review(page).getByRole('button', { name: 'Send 3 comments', exact: true }).click();
  await expect.poll(() => reviewHost.runtime.resolutions.length).toBe(2);
  expect(reviewHost.runtime.resolutions.map(item => item.outcome)).toEqual(['fixed', 'not_changed']);
  const delivered = reviewHost.runtime.deliveries[1]!;
  expect(delivered.prompt).toContain('Review comments on the working-copy diff');
  expect(delivered.prompt).toContain('review_comment_resolve exactly once per commentId');

  // Live SSE refetch flips statuses without a reload; resolved hides by default.
  await expect(first).toHaveCount(0);
  await expect(second).toContainText('· replied by agent');
  await expect(second).toContainText(`Agent: ${REVIEW_NOT_CHANGED_NOTE}`);
  await expect(third).toContainText('· unaddressed');
  await review(page).getByRole('checkbox', { name: 'Show resolved', exact: true }).check();
  await expect(first).toContainText('· resolved by agent');
  await expect(review(page).locator('.sr-only[role="status"]')).toContainText('is now resolved');

  // Reopen + edit returns to draft; resend resolves the single comment.
  await second.getByRole('button', { name: 'Reopen', exact: true }).click();
  await expect(second).toContainText('· draft');
  await second.getByRole('button', { name: 'Edit', exact: true }).click();
  await second.getByRole('textbox', { name: 'Edit comment', exact: true }).fill('Collapse these into a sorted table.');
  await second.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(review(page).locator('.review-diff-send-bar')).toContainText('1 review comment ready');
  await review(page).getByRole('button', { name: 'Send 1 comments', exact: true }).click();
  await expect.poll(() => reviewHost.runtime.resolutions.length).toBe(3);
  await expect(second).toContainText('· resolved by agent');
  expect(comments(reviewHost, thread.id).map(item => item.status).sort()).toEqual(['resolved', 'resolved', 'unaddressed']);

  const image = info.outputPath('review-comments-resolved.png');
  await page.screenshot({ path: image, fullPage: true });
  await info.attach('review-comments-resolved', { path: image, contentType: 'image/png' });
});

test('staged scope, reload persistence, outdated anchors and edit-conflict text retention', async ({ page, reviewHost }, info) => {
  await seedProject(reviewHost);
  const thread = await connectProject(page, reviewHost);
  const worktree = reviewHost.worktree(thread.id);
  await seedChanges(worktree);
  await openChanges(page);
  await expect(review(page)).toBeVisible();

  // The staged view is commentable and keeps its own scope.
  await page.getByRole('checkbox', { name: 'Staged', exact: true }).check();
  await gutter(page, 'src/staged-beta.ts', 'new', 2).click();
  const staged = page.getByRole('form', { name: 'Comment on src/staged-beta.ts lines 2-2', exact: true });
  await staged.getByRole('textbox', { name: 'Review comment', exact: true }).fill('Stage this with the migration.');
  await staged.getByRole('textbox', { name: 'Review comment', exact: true }).press('Control+Enter');
  await expect.poll(() => comments(reviewHost, thread.id).map(item => item.anchor.scope)).toEqual(['staged']);
  await page.getByRole('checkbox', { name: 'Staged', exact: true }).uncheck();
  await expect(review(page).locator('.review-diff-send-bar')).toHaveCount(0);

  // An unsaved composer draft is journaled across a reload.
  await gutter(page, 'src/alpha.ts', 'new', 42).click();
  await page.getByRole('textbox', { name: 'Review comment', exact: true }).fill('Unsent draft text');
  await page.reload();
  await expect(composer(page)).toBeVisible();
  await openChanges(page);
  await gutter(page, 'src/alpha.ts', 'new', 42).click();
  await expect(page.getByRole('textbox', { name: 'Review comment', exact: true })).toHaveValue('Unsent draft text');

  // Saved comments survive a reload too.
  await page.getByRole('textbox', { name: 'Review comment', exact: true }).press('Control+Enter');
  const saved = card(page, 'Unsent draft text');
  await expect(saved).toContainText('src/alpha.ts:42 · draft');
  await page.reload();
  await expect(composer(page)).toBeVisible();
  await openChanges(page);
  await expect(card(page, 'Unsent draft text')).toContainText('src/alpha.ts:42 · draft');

  // A write with a stale expectedRev conflicts; the error surfaces and the
  // unsaved text stays. The comments GET is briefly intercepted so the card
  // keeps the pre-conflict revision — commands themselves are untouched.
  const stale = comments(reviewHost, thread.id).find(item => item.anchor.scope === 'worktree')!;
  const edited = card(page, 'src/alpha.ts:42');
  await edited.getByRole('button', { name: 'Edit', exact: true }).click();
  await review(page).getByRole('textbox', { name: 'Edit comment', exact: true }).fill('Conflicted edit');
  await page.route('**/review-comments', route => route.abort());
  try {
    const bump = await browserCommand(page, 'review.comment.edit', { id: stale.id, expectedRev: stale.rev, body: 'Changed under the editor.' }, thread.id);
    expect(bump.status).toBe(200);
    await edited.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(review(page).getByRole('alert')).toContainText('changed');
    await edited.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(review(page).getByRole('textbox', { name: 'Edit comment', exact: true })).toHaveValue('Conflicted edit');
    await edited.getByRole('button', { name: 'Cancel', exact: true }).click();
  } finally { await page.unroute('**/review-comments'); }

  // Editing the working copy again marks earlier anchors outdated after Refresh.
  await writeFile(join(worktree, 'src/alpha.ts'), (await readFile(join(worktree, 'src/alpha.ts'), 'utf8')) + 'export const late = 1;\n');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(review(page).locator('.review-diff-outdated summary')).toContainText('1 outdated comment');
  await expect(review(page).locator('.review-diff-file article.review-comment')).toHaveCount(0);
  await review(page).locator('.review-diff-outdated summary').click();
  await expect(review(page).locator('.review-diff-outdated article.review-comment')).toContainText('src/alpha.ts:42');

  const image = info.outputPath('review-comments-outdated.png');
  await page.screenshot({ path: image, fullPage: true });
  await info.attach('review-comments-outdated', { path: image, contentType: 'image/png' });
});

test('side conversations expose no review-comment controls and the host denies them', async ({ page, reviewHost }) => {
  await seedProject(reviewHost);
  const thread = await connectProject(page, reviewHost);
  await seedChanges(reviewHost.worktree(thread.id));

  // The /side prefix opens the floating side conversation; it has no
  // review-comment surface of its own.
  await composer(page).click(); await composer(page).fill('/side Is the workspace ready?');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const sideWindow = page.locator('.side-chat');
  await expect(sideWindow.getByRole('textbox', { name: 'Side question', exact: true })).toBeVisible();
  await expect(sideWindow.getByRole('button', { name: 'Inspect changes' })).toHaveCount(0);
  await expect.poll(() => reviewHost.store.snapshot().threads.find(item => item.sideParentId === thread.id)?.id).toBeTruthy();
  const side = reviewHost.store.snapshot().threads.find(item => item.sideParentId === thread.id)!;
  await expect(review(page)).toHaveCount(0);

  const denied = await browserCommand(page, 'review.comment.create', {
    id: crypto.randomUUID(),
    anchor: { path: 'src/alpha.ts', side: 'new', startLine: 41, endLine: 41, scope: 'worktree', head: 'head', revision: 'rev', hunkHeader: '', excerpt: 'x', excerptTruncated: false },
    body: 'Side comments are not allowed.' }, side.id);
  expect(denied.status).toBeGreaterThanOrEqual(400);
  // Side threads reject mutating commands before the review gate is reached.
  expect(JSON.stringify(denied.body)).toContain('SIDE_CHAT_READ_ONLY');
  expect(comments(reviewHost, side.id)).toEqual([]);
});

test.describe('flag off', () => {
  test.use({ reviewEnabled: false });
  test('flag off keeps the plain diff and denies review commands', async ({ page, reviewHost }) => {
    await seedProject(reviewHost);
    const thread = await connectProject(page, reviewHost);
    await seedChanges(reviewHost.worktree(thread.id));
    await openChanges(page);
    await expect(plain(page)).toBeVisible();
    await expect(plain(page)).toHaveAttribute('aria-label', 'Unstaged diff');
    await expect(review(page)).toHaveCount(0);

    const listed = await page.evaluate(async id =>
      (await fetch(`/api/threads/${id}/review-comments`, { credentials: 'same-origin' })).json(), thread.id);
    expect(listed).toEqual({ enabled: false, comments: [] });
    const denied = await browserCommand(page, 'review.comment.create', {
      id: crypto.randomUUID(),
      anchor: { path: 'src/alpha.ts', side: 'new', startLine: 41, endLine: 41, scope: 'worktree', head: 'head', revision: 'rev', hunkHeader: '', excerpt: 'x', excerptTruncated: false },
      body: 'Disabled comments are denied.' }, thread.id);
    expect(denied.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(denied.body)).toContain('CAPABILITY_DENIED');
    expect(comments(reviewHost, thread.id)).toEqual([]);
  });
});
