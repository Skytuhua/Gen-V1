import { test, expect, type Page } from '@playwright/test';
import { taskFixture, serveTaskFixture } from './task-interface-fixture';

const at = (minutes: number) => new Date(Date.UTC(2026, 0, 20, 12, minutes)).toISOString();
const journal = (page: Page) => page.evaluate(async () => { const path = '/src/journal.ts'; return (await import(path)).journalEntries() as Promise<{ key: string; record: { value: unknown } }[]>; });

async function fixture(page: Page, { truncated = 0, theme = 'dark' as 'dark' | 'light' } = {}) {
  const snapshot = taskFixture({ root: 'text', elements: { text: { type: 'Text', props: { text: 'Prompt history fixture' } } } });
  snapshot.settings.theme = theme;
  const other = { id: 'other-thread', title: 'Side project notes', projectName: 'Other', status: 'ready' as const, epoch: 0, runId: null, modelId: 'test/model', sessionPath: 'fixture', createdAt: at(0), updatedAt: at(0) };
  snapshot.threads.push(other);
  snapshot.messages.push(
    { id: 'p1', threadId: 'task-thread', role: 'user', content: 'first prompt\ncontinued on a second line', runId: null, createdAt: at(1) },
    { id: 'p2', threadId: 'task-thread', role: 'user', content: 'Terminal excerpt · project fixture\noutput only', runId: null, createdAt: at(2) },
    { id: 'p3', threadId: 'task-thread', role: 'user', content: 'second prompt\n\nTerminal excerpt · project fixture\ntrailing output', runId: null, createdAt: at(3) },
    { id: 'p4', threadId: 'other-thread', role: 'user', content: 'other thread prompt', runId: null, createdAt: at(4) },
    { id: 'p5', threadId: 'arch-thread', role: 'user', content: 'archived prompt', runId: null, createdAt: at(5) },
    { id: 'p6', threadId: 'task-thread', role: 'assistant', content: 'not a prompt', runId: null, createdAt: at(6) },
  );
  if (truncated) snapshot.messagesTruncated = { 'task-thread': truncated };
  const host = await serveTaskFixture(page, snapshot);
  const pages: { messages: unknown[]; truncated: number }[] = [];
  await page.route('**/api/threads/*/messages?*', route => {
    const id = new URL(route.request().url()).pathname.split('/')[3];
    pages.push({ messages: [], truncated: 0 });
    return route.fulfill({ json: { messages: id === 'task-thread' ? [{ id: 'p0', threadId: 'task-thread', role: 'user', content: 'paged older prompt', runId: null, createdAt: at(-1) }] : [], truncated: 0 } });
  });
  await page.goto('/');
  const draft = page.getByRole('textbox', { name: 'Message', exact: true });
  await expect(draft).toBeEnabled(); await draft.focus();
  return { ...host, draft, pages };
}

test('ArrowUp browses newest-first current thread then other threads; ArrowDown returns and Escape restores the draft', async ({ page }) => {
  const host = await fixture(page);
  // p2 is excerpt-only and drops out; order: p3, p1, p4 (archived p5 excluded).
  await host.draft.press('ArrowUp'); await expect(host.draft).toHaveValue('second prompt');
  await expect(page.locator('.prompt-history-count')).toHaveText('History 1 of 3');
  await host.draft.press('ArrowUp'); await expect(host.draft).toHaveValue('first prompt\ncontinued on a second line');
  await expect(page.locator('.prompt-history-count')).toHaveText('History 2 of 3');
  await host.draft.evaluate(input => (input as HTMLTextAreaElement).setSelectionRange(0, 0));
  await host.draft.press('ArrowUp'); await expect(host.draft).toHaveValue('other thread prompt');
  await expect(page.locator('.prompt-history-count')).toHaveText('History 3 of 3');
  await expect(page.locator('.prompt-history-source')).toContainText('Side project notes');
  await host.draft.press('ArrowDown'); await expect(host.draft).toHaveValue('first prompt\ncontinued on a second line');
  await host.draft.press('ArrowDown'); await expect(host.draft).toHaveValue('second prompt');
  await host.draft.press('ArrowDown'); await expect(host.draft).toHaveValue('');
  await expect(page.locator('.prompt-history-chip')).toHaveCount(0);
});

test('typing while browsing keeps the text as an ordinary journaled draft; Escape exits without journaling history', async ({ page }) => {
  const host = await fixture(page);
  await host.draft.press('ArrowUp'); await expect(host.draft).toHaveValue('second prompt');
  await host.draft.press('x'); await expect(host.draft).toHaveValue('second promptx');
  await expect.poll(async () => (await journal(page)).some(row => row.record.value === 'second promptx')).toBe(true);
  expect(await host.draft.evaluate(input => (input as HTMLTextAreaElement).selectionStart)).toBe('second promptx'.length);
  await host.draft.fill(''); await host.draft.press('ArrowUp'); await host.draft.press('Escape');
  await expect(host.draft).toHaveValue(''); await expect(page.locator('.prompt-history-chip')).toHaveCount(0);
  expect(host.commands.some(command => command.type === 'run.stop')).toBe(false);
});

test('caret rules: Up requires an empty draft and, while browsing, the first line; Down requires the last line', async ({ page }) => {
  const host = await fixture(page);
  await host.draft.fill('occupied'); await host.draft.press('ArrowUp'); await expect(host.draft).toHaveValue('occupied');
  await host.draft.fill(''); await host.draft.press('ArrowUp'); await host.draft.press('ArrowUp');
  await expect(host.draft).toHaveValue('first prompt\ncontinued on a second line');
  // Multi-line entry: caret on the last line blocks ArrowUp; on the first line it pages older.
  await host.draft.evaluate(input => { const field = input as HTMLTextAreaElement; field.setSelectionRange(field.value.length, field.value.length); });
  await host.draft.press('ArrowUp'); await expect(host.draft).toHaveValue('first prompt\ncontinued on a second line');
  await host.draft.evaluate(input => (input as HTMLTextAreaElement).setSelectionRange(0, 0));
  await host.draft.press('ArrowUp'); await expect(host.draft).toHaveValue('other thread prompt');
  await host.draft.press('ArrowDown'); await expect(host.draft).toHaveValue('first prompt\ncontinued on a second line');
  // Caret back on the first line blocks ArrowDown.
  await host.draft.evaluate(input => (input as HTMLTextAreaElement).setSelectionRange(0, 0));
  await host.draft.press('ArrowDown'); await expect(host.draft).toHaveValue('first prompt\ncontinued on a second line');
});

test('a truncated current thread pages older prompts at the boundary and never refetches', async ({ page }) => {
  const host = await fixture(page, { truncated: 7 });
  await host.draft.press('ArrowUp');
  await host.draft.evaluate(input => (input as HTMLTextAreaElement).setSelectionRange(0, 0));
  await host.draft.press('ArrowUp'); // multi-line last current entry: caret on first line
  await expect.poll(() => host.pages.length).toBe(1);
  await host.draft.evaluate(input => (input as HTMLTextAreaElement).setSelectionRange(0, 0));
  await host.draft.press('ArrowUp'); await expect(host.draft).toHaveValue('paged older prompt');
  await host.draft.press('ArrowUp'); await expect(host.draft).toHaveValue('other thread prompt');
  await host.draft.press('ArrowUp'); await expect(host.draft).toHaveValue('other thread prompt');
  expect(host.pages.length).toBe(1);
});

test('Ctrl+R opens the search popover without reloading; Enter journals the pick and refocuses the composer', async ({ page }) => {
  const host = await fixture(page);
  let navigated = false; page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigated = true; });
  await host.draft.press('Control+r');
  const popover = page.locator('.prompt-history-popover'); await expect(popover).toBeVisible();
  expect(navigated).toBe(false);
  const search = popover.getByRole('searchbox'); await expect(search).toBeFocused();
  await search.fill('other');
  const option = page.getByRole('option', { name: /other thread prompt/ }); await expect(option).toBeVisible();
  await search.press('Enter');
  await expect(host.draft).toHaveValue('other thread prompt'); await expect(host.draft).toBeFocused();
  await expect(popover).toHaveCount(0);
  await expect.poll(async () => (await journal(page)).some(row => row.record.value === 'other thread prompt')).toBe(true);
  await host.draft.press('Control+r'); await expect(popover).toBeVisible();
  await search.press('Escape'); await expect(popover).toHaveCount(0); await expect(host.draft).toBeFocused();
});

test('the slash command menu keeps precedence over history keys', async ({ page }) => {
  const host = await fixture(page);
  await host.draft.fill('/m');
  const popover = page.locator('.composer-command-popover'); await expect(popover).toBeVisible();
  await host.draft.press('ArrowUp'); await host.draft.press('ArrowDown');
  await expect(host.draft).toHaveValue('/m'); await expect(page.locator('.prompt-history-chip')).toHaveCount(0);
});

test('chip motion respects reduced-motion and captures evidence at desktop and narrow widths', async ({ page }, info) => {
  const host = await fixture(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await host.draft.press('ArrowUp');
  const chip = page.locator('.prompt-history-chip'); await expect(chip).toBeVisible();
  expect(await chip.evaluate(element => Number.parseFloat(getComputedStyle(element).animationDuration))).toBeLessThanOrEqual(0.08);
  await page.setViewportSize({ width: 1280, height: 800 });
  await info.attach('history-dark-1280.png', { body: await page.screenshot(), contentType: 'image/png' });
  await page.setViewportSize({ width: 420, height: 800 });
  await info.attach('history-dark-420.png', { body: await page.screenshot(), contentType: 'image/png' });
});

test('light theme evidence at desktop and narrow widths', async ({ page }, info) => {
  const host = await fixture(page, { theme: 'light' });
  await host.draft.press('ArrowUp'); await expect(page.locator('.prompt-history-chip')).toBeVisible();
  await host.draft.press('Control+r'); await expect(page.locator('.prompt-history-popover')).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await info.attach('history-light-1280.png', { body: await page.screenshot(), contentType: 'image/png' });
  await page.setViewportSize({ width: 420, height: 800 });
  await info.attach('history-light-420.png', { body: await page.screenshot(), contentType: 'image/png' });
});
