import { test, expect, type Page, type Route } from '@playwright/test';
import type { HostCommand, TaskMemory as Note } from '../../packages/contracts';
import type { MemoryFixture, Setup } from './fixtures/memory-recovery';

declare global { interface Window { memoryFixture: MemoryFixture } }
const savedKey = 'memory-draft:thread-a:saved:decision', createKey = 'memory-draft:thread-a:create';
const draft = { key: 'decision', content: 'Recovered exact draft.\nSecond line.', baseRevision: 2 };
const note = (key = 'decision', revision = 3, threadId = 'thread-a'): Note => ({ id: `${threadId}:${key}`, threadId, key, content: 'Saved decision.', revision, author: 'user', updatedAt: '2026-11-07T00:00:00Z' });
const audits = new WeakMap<Page, { blocked: string[]; errors: string[] }>();
test.afterEach(async ({ page }) => { const audit = audits.get(page); if (audit) { expect(audit.blocked).toEqual([]); expect(audit.errors).toEqual([]); } });
async function mount(page: Page, setup: Setup = {}, respond?: (route: Route, command: HostCommand) => Promise<void>) {
  const commands: HostCommand[] = [], blocked: string[] = [], errors: string[] = []; audits.set(page, { blocked, errors });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(value => Object.assign(window, { memorySetup: value }), setup);
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:5816') { blocked.push(url.href); await route.abort(); return; }
    if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
    if (url.pathname === '/api/bootstrap') { await route.fulfill({ json: { csrfToken: 'synthetic-memory-csrf' } }); return; }
    if (url.pathname === '/api/commands') {
      const command = route.request().postDataJSON() as HostCommand;
      if (!['memory.save', 'memory.delete'].includes(command.type)) { blocked.push(command.type); await route.abort(); return; }
      expect(route.request().headers()['x-harness-csrf']).toBe('synthetic-memory-csrf'); commands.push(command);
      if (respond) await respond(route, command);
      else await route.fulfill({ json: { commandId: command.id, seq: 2, result: { ...note(String(command.payload.key), Number(command.payload.baseRevision) + 1), ...command.payload, revision: Number(command.payload.baseRevision) + 1 } } });
      return;
    }
    blocked.push(url.href); await route.abort();
  });
  await page.goto('/tests/e2e/fixtures/memory-recovery.html');
  await expect(page.getByRole('region', { name: 'Thread memory', exact: true })).toBeVisible();
  return commands;
}
const editor = (page: Page) => page.getByRole('textbox', { name: 'Note decision', exact: true });
const held = (page: Page, key = savedKey) => expect.poll(() => page.evaluate(key => window.memoryFixture.held().includes(key), key)).toBe(true);
const release = (page: Page, key = savedKey, fail = false) => page.evaluate(({ key, fail }) => window.memoryFixture.release(key, fail), { key, fail });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

test('Delete keeps the existing editor lock until its exact-revision acknowledgment', async ({ page }) => {
  const gate = deferred();
  const commands = await mount(page, {}, async (route, command) => { await gate.promise; await route.fulfill({ json: { commandId: command.id, seq: 2, result: {} } }); });
  await expect(editor(page)).toBeEnabled(); await editor(page).fill('Draft explicitly forgotten.');
  await page.getByRole('button', { name: 'Forget decision' }).click(); await expect.poll(() => commands.length).toBe(1);
  await expect(editor(page)).toBeDisabled(); await page.locator('form').dispatchEvent('submit'); expect(commands).toHaveLength(1);
  gate.resolve(); await expect(editor(page)).toBeEnabled();
  expect(commands[0]).toMatchObject({ type: 'memory.delete', threadId: 'thread-a', payload: { key: 'decision', baseRevision: 3 } });
});

for (const fail of [false, true]) test(`a slow ${fail ? 'failed' : 'successful'} Save retains a newer local edit and its exact revision`, async ({ page }) => {
  const gate = deferred();
  const commands = await mount(page, {}, async (route, command) => {
    await gate.promise;
    await route.fulfill(fail ? { status: 503, json: { error: { code: 'SYNTHETIC_FAILURE', message: 'Synthetic save failed. Your draft is retained.' } } } : { json: { commandId: command.id, seq: 2, result: { ...note(), revision: 4 } } });
  });
  await expect(editor(page)).toBeEnabled(); await editor(page).fill('Submitted edit.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click(); await expect.poll(() => commands.length).toBe(1);
  await expect(editor(page)).toBeEnabled(); await editor(page).fill('Newer unconfirmed edit.');
  gate.resolve(); await expect(page.getByRole('button', { name: 'Save note', exact: true })).toBeEnabled();
  await expect(editor(page)).toHaveValue('Newer unconfirmed edit.');
  expect(commands[0]).toMatchObject({ type: 'memory.save', threadId: 'thread-a', payload: { key: 'decision', content: 'Submitted edit.', baseRevision: 3 } });
  expect(await page.evaluate(key => window.memoryFixture.read(key), savedKey)).toEqual({ key: 'decision', content: 'Newer unconfirmed edit.', baseRevision: 3 });
  await page.evaluate(() => window.memoryFixture.show(false)); await page.evaluate(() => window.memoryFixture.show(true));
  await expect(editor(page)).toHaveValue('Newer unconfirmed edit.');
});

test('Cancel and non-composing Escape keep the draft and restore Add focus', async ({ page }) => {
  const commands = await mount(page, { notes: [] });
  const add = page.getByRole('button', { name: 'Add memory note' }); await add.focus(); await add.press('Enter');
  const key = page.getByRole('textbox', { name: 'Note key', exact: true }); await expect(key).toBeFocused(); await key.fill('retained');
  const content = page.getByRole('textbox', { name: 'New thread note', exact: true }); await content.fill('Keep on Cancel.');
  await content.dispatchEvent('keydown', { key: 'Escape', isComposing: true }); await expect(content).toBeVisible();
  await content.press('Escape'); await expect(content).toHaveCount(0); await expect(add).toBeFocused();
  await page.getByRole('button', { name: 'Resume unsaved note', exact: true }).click(); await expect(key).toHaveValue('retained');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(add).toBeFocused();
  await page.evaluate(() => window.memoryFixture.show(false)); await page.evaluate(() => window.memoryFixture.show(true));
  await expect(page.getByRole('textbox', { name: 'New thread note', exact: true })).toHaveValue('Keep on Cancel.'); expect(commands).toEqual([]);
});

test('pending recovery blocks edits, Save and Delete without overwriting the unread draft', async ({ page }, info) => {
  const commands = await mount(page, { drafts: { [savedKey]: draft }, reads: { [savedKey]: 'hold' } }); await held(page);
  await page.screenshot({ path: info.outputPath('01-pending-recovery.png') });
  await expect(editor(page)).toBeDisabled(); await expect(page.getByRole('button', { name: 'Save note', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Forget decision' })).toBeDisabled();
  await page.getByRole('button', { name: 'Forget decision' }).dispatchEvent('click');
  await page.locator('.memory-note').first().dispatchEvent('submit'); expect(commands).toEqual([]);
  await release(page); await expect(editor(page)).toHaveValue(draft.content);
  await expect(editor(page)).toBeEnabled(); await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect.poll(() => commands.length).toBe(1); expect(commands[0]).toMatchObject({ type: 'memory.save', threadId: 'thread-a', payload: draft });
});

test('failed recovery stays blocked and keyboard Retry restores the exact key, content and revision', async ({ page }, info) => {
  const recovered = { key: 'date-format', content: 'YYYY-MM-DD\nKeep this exact.', baseRevision: 0 };
  const commands = await mount(page, { notes: [], drafts: { [createKey]: recovered }, reads: { [createKey]: 'fail' } });
  // Opening the empty editor must also be safe while recovery has failed.
  await page.getByRole('button', { name: 'Add memory note' }).click();
  await expect(page.getByRole('alert')).toContainText('recovery');
  await page.screenshot({ path: info.outputPath('02-failed-recovery.png') });
  await expect(page.getByRole('textbox', { name: 'Note key', exact: true })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'New thread note', exact: true })).toBeDisabled();
  const retry = page.getByRole('button', { name: 'Retry', exact: true }); await retry.focus(); await retry.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Note key', exact: true })).toHaveValue(recovered.key);
  await expect(page.getByRole('textbox', { name: 'New thread note', exact: true })).toHaveValue(recovered.content);
  await page.getByRole('button', { name: 'Add note', exact: true }).click(); await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({ type: 'memory.save', threadId: 'thread-a', payload: recovered });
});

test('a fresh staged draft reopens automatically on remount without Add', async ({ page }) => {
  const recovered = { key: 'unsaved', content: 'Keep the unsaved create draft.', baseRevision: 0 };
  await mount(page, { notes: [], drafts: { [createKey]: recovered }, staged: true });
  await expect(page.getByRole('textbox', { name: 'New thread note', exact: true })).toHaveValue(recovered.content);
  await page.getByRole('textbox', { name: 'New thread note', exact: true }).fill('Newest local edit.');
  await page.evaluate(() => window.memoryFixture.show(false)); await expect(page.locator('.task-memory')).toHaveCount(0);
  await page.evaluate(() => window.memoryFixture.show(true));
  await expect(page.getByRole('textbox', { name: 'Note key', exact: true })).toHaveValue('unsaved');
  await expect(page.getByRole('textbox', { name: 'New thread note', exact: true })).toHaveValue('Newest local edit.');
});

for (const fail of [false, true]) test(`obsolete read ${fail ? 'error' : 'success'} cannot cross a thread or note change`, async ({ page }) => {
  await mount(page, { drafts: { [savedKey]: draft }, reads: { [savedKey]: 'hold' }, notes: [note(), note('other', 1, 'thread-b')] }); await held(page);
  await page.getByRole('button', { name: 'Switch synthetic thread' }).click();
  const other = page.getByRole('textbox', { name: 'Note other', exact: true }); await expect(other).toBeEnabled(); await other.fill('Current thread edit.');
  await release(page, savedKey, fail); await expect(other).toHaveValue('Current thread edit.'); await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Switch synthetic thread' }).click(); await expect(editor(page)).toHaveValue(draft.content);
  await editor(page).fill('Current note edit.'); await page.evaluate(note => window.memoryFixture.publish([note]), note('replacement'));
  await expect(page.getByRole('textbox', { name: 'Note replacement', exact: true })).toBeEnabled();
  await page.evaluate(note => window.memoryFixture.publish([note]), note()); await expect(editor(page)).toHaveValue('Current note edit.');
});

test('capacity is quiet below ten notes and visible near the twelve-note limit', async ({ page }) => {
  await mount(page); await expect(page.getByText('1/12', { exact: true })).toHaveCount(0);
  await page.evaluate(notes => window.memoryFixture.publish(notes), Array.from({ length: 10 }, (_, index) => note(`note-${index}`)));
  await expect(page.getByText('10/12', { exact: true })).toBeVisible();
  await page.evaluate(notes => window.memoryFixture.publish(notes), Array.from({ length: 12 }, (_, index) => note(`note-${index}`)));
  await expect(page.getByRole('button', { name: 'Add memory note' })).toBeDisabled();
});

test('saved-note recovery failure blocks Delete until Retry and keeps stale revision disclosure', async ({ page }) => {
  const commands = await mount(page, { drafts: { [savedKey]: draft }, reads: { [savedKey]: 'fail' } });
  await expect(page.getByRole('alert')).toContainText('recovery'); await expect(editor(page)).toBeDisabled();
  const forget = page.getByRole('button', { name: 'Forget decision' }); await expect(forget).toBeDisabled();
  await forget.dispatchEvent('click'); await page.locator('form').dispatchEvent('submit'); expect(commands).toEqual([]);
  await page.getByRole('button', { name: 'Retry', exact: true }).click(); await expect(editor(page)).toHaveValue(draft.content);
  await expect(page.getByText('A newer saved note is available', { exact: true })).toBeVisible();
  await forget.click(); await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({ type: 'memory.delete', threadId: 'thread-a', payload: { key: 'decision', baseRevision: 2 } });
  await expect.poll(() => page.evaluate(key => window.memoryFixture.read(key), savedKey)).toBeNull();
});

test('Use saved note clears only its captured draft and a subsequent edit uses the saved revision', async ({ page }) => {
  const commands = await mount(page, { drafts: { [savedKey]: draft } }); await expect(editor(page)).toHaveValue(draft.content);
  await page.getByText('A newer saved note is available', { exact: true }).click();
  await page.getByRole('button', { name: 'Use saved note', exact: true }).click(); await expect(editor(page)).toHaveValue('Saved decision.');
  await editor(page).fill('Edit after adopting the saved note.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click(); await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({ type: 'memory.save', threadId: 'thread-a', payload: { key: 'decision', content: 'Edit after adopting the saved note.', baseRevision: 3 } });
  await expect.poll(() => page.evaluate(key => window.memoryFixture.read(key), savedKey)).toBeNull();
});

test('an acknowledgment from a disposed editor cannot clear a newer remounted draft', async ({ page }) => {
  const gate = deferred();
  const commands = await mount(page, {}, async (route, command) => { await gate.promise; await route.fulfill({ json: { commandId: command.id, seq: 2, result: { ...note(), revision: 4 } } }); });
  await expect(editor(page)).toBeEnabled(); await editor(page).fill('Submitted from old mount.'); await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect.poll(() => commands.length).toBe(1);
  await page.evaluate(() => window.memoryFixture.show(false)); await expect(page.locator('.task-memory')).toHaveCount(0);
  await page.evaluate(() => window.memoryFixture.show(true)); await expect(editor(page)).toHaveValue('Submitted from old mount.');
  await editor(page).fill('New mount keeps its own edit.');
  const acknowledgment = page.waitForResponse(response => new URL(response.url()).pathname === '/api/commands');
  gate.resolve(); await (await acknowledgment).finished();
  await page.evaluate(() => window.memoryFixture.flush());
  expect(await page.evaluate(key => window.memoryFixture.read(key), savedKey)).toEqual({ key: 'decision', content: 'New mount keeps its own edit.', baseRevision: 3 });
  await expect(editor(page)).toHaveValue('New mount keeps its own edit.');
});

for (const fail of [false, true]) test(`obsolete ${fail ? 'failed' : 'successful'} read cannot affect a replacement note or later edit`, async ({ page }) => {
  await mount(page, { drafts: { [savedKey]: draft }, reads: { [savedKey]: 'hold' } }); await held(page);
  await page.evaluate(note => window.memoryFixture.publish([note]), note('replacement'));
  const replacement = page.getByRole('textbox', { name: 'Note replacement', exact: true }); await expect(replacement).toBeEnabled(); await replacement.fill('Replacement edit.');
  await release(page, savedKey, fail); await expect(replacement).toHaveValue('Replacement edit.'); await expect(page.getByRole('alert')).toHaveCount(0);
});

test('unhandled API requests are actually blocked by the synthetic host', async ({ page }) => {
  await mount(page);
  expect(await page.evaluate(() => fetch('/api/unhandled-memory-probe').then(() => false, () => true))).toBe(true);
  expect(audits.get(page)!.blocked.splice(0)).toEqual(['http://127.0.0.1:5816/api/unhandled-memory-probe']);
});

for (const view of [
  { number: '03', name: 'dark', theme: 'dark', width: 1000, height: 760, failed: false },
  { number: '04', name: 'light-error', theme: 'light', width: 1000, height: 760, failed: true },
  { number: '05', name: 'narrow', theme: 'dark', width: 320, height: 720, failed: false },
  { number: '06', name: 'short-error', theme: 'dark', width: 640, height: 360, failed: true },
  { number: '07', name: 'reduced-motion', theme: 'light', width: 800, height: 600, failed: false },
]) test(`synthetic visual: ${view.name}`, async ({ page }, info) => {
  await page.setViewportSize({ width: view.width, height: view.height });
  if (view.name === 'reduced-motion') await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(page, { drafts: { [savedKey]: draft }, reads: view.failed ? { [savedKey]: 'fail' } : {} });
  await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, view.theme);
  await page.evaluate(() => document.fonts.ready);
  if (view.failed) { await expect(page.getByRole('alert')).toBeVisible(); await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible(); }
  else { await expect(editor(page)).toHaveValue(draft.content); await expect(editor(page)).toBeEnabled(); }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`${view.number}-${view.name}.png`), fullPage: true });
  if (view.failed) { const retry = page.getByRole('button', { name: 'Retry', exact: true }); await retry.scrollIntoViewIfNeeded(); await retry.focus(); await retry.press('Enter'); await expect(editor(page)).toHaveValue(draft.content); }
});
