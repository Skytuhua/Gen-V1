import {test, expect, type Page} from '@playwright/test';
import {taskFixture, serveTaskFixture} from './task-interface-fixture';

const items = [
  {path: 'README.md', name: 'README.md', directory: ''},
  {path: 'src/main.ts', name: 'main.ts', directory: 'src'},
  {path: 'dir with space/note.md', name: 'note.md', directory: 'dir with space'},
];

async function suggestions(page: Page, threadId: string, patch: {enabled?: boolean; complete?: boolean; fail?: boolean; items?: typeof items} = {}) {
  const reads: string[] = [];
  await page.route('**/api/projects/synthetic-project/file-suggestions?*', async route => {
    const url = new URL(route.request().url()); reads.push(url.search);
    if (patch.fail) return route.fulfill({status: 500, json: {error: {code: 'SUGGESTIONS_FAILED', message: 'The index is unavailable.'}}});
    await route.fulfill({json: {enabled: patch.enabled ?? true, projectId: 'synthetic-project', threadId, query: url.searchParams.get('q') ?? '', items: patch.items ?? items, complete: patch.complete ?? true}});
  });
  return reads;
}

async function journalValue(page: Page, key: string) {
  return page.evaluate(key => new Promise<unknown>((resolve, reject) => {
    const open = indexedDB.open('generative-harness-journal', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, request = db.transaction('entries').objectStore('entries').get(key);
      request.onsuccess = () => {resolve(request.result?.value); db.close();};
      request.onerror = () => {reject(request.error); db.close();};
    };
  }), key);
}

async function fixture(page: Page, projectId = 'synthetic-project') {
  const snapshot = taskFixture({root: 'text', elements: {text: {type: 'Text', props: {text: 'Mention menu integration fixture'}}}});
  if (projectId) snapshot.threads[0].projectId = projectId;
  const host = await serveTaskFixture(page, snapshot);
  await suggestions(page, 'task-thread');
  await page.goto('/'); const input = page.getByRole('textbox', {name: 'Message', exact: true}); await expect(input).toBeEnabled({timeout: 15_000}); await input.focus();
  return {...host, input};
}

test('main composer suggests, inserts and sends a file mention', async ({page}) => {
  const f = await fixture(page); await f.input.fill('Summarize @');
  const menu = page.getByRole('listbox', {name: 'Project files'}); await expect(menu).toBeVisible();
  await expect(menu.getByRole('option', {name: /README\.md/})).toBeVisible();
  await f.input.press('ArrowDown'); await f.input.press('Enter');
  await expect(f.input).toHaveValue('Summarize @src/main.ts '); await expect(f.input).toBeFocused();
  await expect.poll(() => journalValue(page, 'mentions:task-thread')).toEqual([{path: 'src/main.ts'}]);
  await f.input.press('Enter');
  await expect.poll(() => f.commands.filter(command => command.type === 'message.send').map(command => command.payload.fileMentions)).toEqual([[{path: 'src/main.ts'}]]);
  await expect.poll(() => journalValue(page, 'mentions:task-thread')).toBeNull();
});

test('paths with whitespace are quoted and Escape leaves the token untouched', async ({page}) => {
  const f = await fixture(page); await f.input.fill('@');
  const menu = page.getByRole('listbox', {name: 'Project files'}); await expect(menu).toBeVisible();
  await menu.getByRole('option', {name: /note\.md/}).click();
  await expect(f.input).toHaveValue('@"dir with space/note.md" '); await expect(f.input).toBeFocused();
  await f.input.fill('Check @re'); await expect(menu).toBeVisible();
  await f.input.press('Escape'); await expect(menu).toBeHidden(); await expect(f.input).toHaveValue('Check @re');
  expect(f.commands.filter(command => command.type === 'message.send')).toHaveLength(0);
});

test('a removed token drops the mention silently; reload restores an intact one', async ({page}) => {
  const f = await fixture(page); await f.input.fill('See @');
  await page.getByRole('listbox', {name: 'Project files'}).getByRole('option', {name: /main\.ts/}).click();
  await expect(f.input).toHaveValue('See @src/main.ts ');
  await page.reload(); const input = page.getByRole('textbox', {name: 'Message', exact: true});
  await expect(input).toHaveValue('See @src/main.ts ');
  await expect.poll(() => journalValue(page, 'mentions:task-thread')).toEqual([{path: 'src/main.ts'}]);
  await input.fill('See notes only'); await page.getByRole('button', {name: 'Send message', exact: true}).click();
  await expect.poll(() => f.commands.filter(command => command.type === 'message.send').length).toBe(1);
  expect(f.commands.find(command => command.type === 'message.send')!.payload).not.toHaveProperty('fileMentions');
});

test('a disabled host closes the menu and leaves @ as plain text', async ({page}) => {
  const snapshot = taskFixture({root: 'text', elements: {text: {type: 'Text', props: {text: 'Flag-off fixture'}}}});
  snapshot.threads[0].projectId = 'synthetic-project';
  const host = await serveTaskFixture(page, snapshot);
  await suggestions(page, 'task-thread', {enabled: false, items: []});
  await page.goto('/'); const input = page.getByRole('textbox', {name: 'Message', exact: true}); await input.fill('Read @');
  await expect(page.getByRole('listbox', {name: 'Project files'})).toHaveCount(0);
  await input.press('Enter');
  await expect.poll(() => host.commands.filter(command => command.type === 'message.send').length).toBe(1);
  expect(host.commands.find(command => command.type === 'message.send')!.payload).not.toHaveProperty('fileMentions');
});

test('error, retry, empty and no-project states announce politely without losing the draft', async ({page}) => {
  const f = await fixture(page);
  await page.route('**/api/projects/synthetic-project/file-suggestions?*', route => route.fulfill({status: 500, json: {error: {code: 'SUGGESTIONS_FAILED', message: 'The index is unavailable.'}}}));
  await f.input.fill('Try @');
  await expect(page.getByRole('alert').filter({hasText: 'The index is unavailable.'})).toBeVisible();
  await suggestions(page, 'task-thread', {items: []});
  await page.getByRole('alert').getByRole('button', {name: 'Retry'}).click();
  await expect(page.getByRole('status').filter({hasText: 'No matching files'})).toBeVisible();
  await expect(f.input).toHaveValue('Try @');
  await page.unroute('**/api/projects/synthetic-project/file-suggestions?*');
});

test('a composer without a project explains the no-project state', async ({page}) => {
  const f = await fixture(page, ''); await f.input.fill('@');
  await expect(page.getByRole('status').filter({hasText: 'Connect a project to mention files.'})).toBeVisible();
  await f.input.press('Escape'); await expect(f.input).toHaveValue('@');
});

test('composition Enter never selects while the mention menu is open', async ({page}) => {
  const f = await fixture(page); await f.input.fill('Check @');
  await expect(page.getByRole('listbox', {name: 'Project files'})).toBeVisible();
  await f.input.dispatchEvent('compositionstart');
  await f.input.dispatchEvent('keydown', {key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true});
  await expect(f.input).toHaveValue('Check @');
  expect(f.commands.filter(command => command.type === 'message.send')).toHaveLength(0);
  await f.input.dispatchEvent('compositionend');
});

test('scoped composer suggests and sends the same mention payload', async ({page}) => {
  const commands: {type: string; payload: Record<string, unknown>}[] = [];
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/bootstrap') return route.fulfill({json: {csrfToken: 'fixture-csrf', widgetOrigin: 'http://localhost:4318'}});
    if (path === '/api/models') return route.fulfill({json: {models: [{id: 'synthetic/model', provider: 'test', name: 'Synthetic'}]}});
    if (path.endsWith('/file-suggestions')) {
      const url = new URL(route.request().url());
      return route.fulfill({json: {enabled: true, projectId: 'synthetic-project', threadId: 'exact-owner', query: url.searchParams.get('q') ?? '', items, complete: true}});
    }
    if (path === '/api/commands') {const command = route.request().postDataJSON(); commands.push(command); return route.fulfill({json: {commandId: command.id, seq: 1, result: {}}});}
    return route.fulfill({status: 404});
  });
  await page.goto('/fixture'); const input = page.getByRole('textbox', {name: 'Message', exact: true}); await expect(input).toBeEnabled();
  await input.fill('Review @');
  const menu = page.getByRole('listbox', {name: 'Project files'});
  await expect(menu.getByRole('option', {name: /README\.md/})).toBeVisible();
  await input.press('Enter'); await expect(input).toHaveValue('Review @README.md ');
  await page.getByRole('button', {name: 'Send message', exact: true}).click();
  await expect.poll(() => commands.filter(command => command.type === 'message.send').map(command => command.payload.fileMentions)).toEqual([[{path: 'README.md'}]]);
});
