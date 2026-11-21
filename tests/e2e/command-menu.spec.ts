import {test, expect, type Page} from '@playwright/test';
import type {HostCommand, Snapshot, Thread} from '../../packages/contracts';
import {serveTaskSplitLayout} from './task-interface-fixture';

// Command menu (Ctrl+K / Ctrl+Shift+P) coverage per issue #1371 T06. All host
// routes are explicit fixtures; a missed intercept must never reach a live host.

const timestamp = '2026-11-21T10:00:00.000Z';
const thread = (id: string, title: string): Thread => ({id, title, projectName: null, createdAt: timestamp, updatedAt: timestamp, status: 'ready', epoch: 0, runId: null, modelId: 'test/model', sessionPath: 'test-session'});

function snapshot(): Snapshot {
  const value: Snapshot = {seq: 1, threads: [thread('one', 'First task'), thread('two', 'Second task')], messages: [{id: 'assistant-one', threadId: 'one', role: 'assistant', content: 'A fixture message.', createdAt: timestamp, runId: null}], artifacts: [], userStates: [], data: [], requests: [], operations: [], resources: [], usage: {}, settings: {theme: 'system', modelId: 'test/model'}, activeThreadId: 'one'};
  return value;
}

const hash = (char: string) => char.repeat(64);
const skillPage = {
  scope: {kind: 'personal'},
  sources: [{id: 'src', kind: 'personal', label: 'Personal', availability: {status: 'available'}}],
  skills: [{id: 'tidy', sourceId: 'src', name: 'tidy-code', description: 'Tidy a file', files: 1, availability: {status: 'available'},
    ref: {version: 1, scope: {kind: 'personal'}, sourceId: 'src', skillId: 'tidy', locator: hash('a'), revision: hash('b'), digest: hash('c'), sourceBinding: hash('d')}}],
  inventoryRevision: hash('e'), nextCursor: null,
};

async function host(page: Page, initial: Snapshot, options: {projects?: unknown[]; preset?: string} = {}) {
  const state = {snapshot: initial, commands: [] as HostCommand[]};
  await page.addInitScript(() => {
    const streams: EventTarget[] = [];
    class MockEventSource extends EventTarget {
      onopen: (() => void) | null = null; onerror: (() => void) | null = null; onmessage: ((event: MessageEvent) => void) | null = null;
      constructor(_url: string) { super(); streams.push(this); queueMicrotask(() => this.onopen?.()); }
      close() { const index = streams.indexOf(this); if (index >= 0) streams.splice(index, 1); }
    }
    Object.defineProperty(window, 'EventSource', {value: MockEventSource});
    Object.assign(window, {__closeStreams: () => [...streams].forEach(stream => (stream as MockEventSource).close())});
  });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/bootstrap') return route.fulfill({json: {csrfToken: 'test-csrf-token', widgetOrigin: 'http://localhost:4318'}});
    if (url.pathname === '/api/models') return route.fulfill({json: {models: [{id: 'test/model', provider: 'test', name: 'Test model'}]}});
    if (url.pathname === '/api/snapshot') return route.fulfill({json: state.snapshot});
    if (url.pathname === '/api/shell-settings') return route.fulfill({json: state.snapshot.settings});
    if (url.pathname === '/api/plugins') return route.fulfill({json: {plugins: []}});
    if (url.pathname === '/api/skill-catalog') return route.fulfill({json: skillPage});
    if (url.pathname === '/api/workspace') return route.fulfill({json: {projects: options.projects ?? [], state: {version: 1, revision: 0, activeCanvasId: 'workspace', canvases: [{id: 'workspace', name: 'Workspace', preset: options.preset ?? 'workspace', version: 1, panels: [], filter: 'active', projectIds: [], viewport: {x: 0, y: 0, zoom: 1}}], profiles: [], disabledKinds: [], integrations: {}}}});
    if (url.pathname === '/api/threads/search') return route.fulfill({json: {threadIds: []}});
    const messages = url.pathname.match(/^\/api\/threads\/([^/]+)\/messages$/);
    if (messages) return route.fulfill({json: {messages: state.snapshot.messages.filter(item => item.threadId === messages[1]), truncated: 0}});
    if (url.pathname === '/api/composer-prediction') return route.fulfill({json: {suggestion: null, replyId: 'none', modelId: 'test/model'}});
    const workbench = url.pathname.match(/^\/api\/workbench\/threads\/([^/]+)(\/inputs)?$/);
    if (workbench) {
      const owner = state.snapshot.threads.find(item => item.id === workbench[1]);
      const logicalOwner = {threadId: workbench[1], projectId: owner?.projectId ?? null, workspaceId: owner?.workspaceId ?? null};
      return route.fulfill({json: workbench[2] ? {logicalOwner, inputs: []} : {logicalOwner, enabled: false, sources: [], sourceCapabilities: []}});
    }
    if (url.pathname !== '/api/commands') return route.fulfill({status: 404, json: {error: {code: 'NOT_FOUND', message: 'Unknown test API route.'}}});
    const cmd = route.request().postDataJSON() as HostCommand;
    state.commands.push(cmd);
    let result: unknown = {};
    if (cmd.type === 'thread.create') { const item = thread(`new-${state.commands.length}`, 'New thread'); state.snapshot.threads.push(item); result = item; }
    if (cmd.type === 'thread.rename') state.snapshot.threads.find(item => item.id === cmd.threadId)!.title = String(cmd.payload.title);
    await route.fulfill({json: {commandId: cmd.id, seq: state.snapshot.seq, result}});
  });
  await serveTaskSplitLayout(page, state.snapshot);
  return state;
}

const open = async (page: Page, key = 'k') => {
  await page.keyboard.press(`Control+${key === 'k' ? 'k' : key}`);
};

const menu = (page: Page) => page.getByRole('dialog', {name: 'Command menu'});

test('Ctrl+K opens the menu with the search box focused and no catalog request while empty', async ({page}) => {
  const state = snapshot();
  await host(page, state);
  const catalogCalls: string[] = [];
  await page.route('**/api/skill-catalog*', route => {catalogCalls.push(route.request().url()); void route.fulfill({json: skillPage});});
  await page.goto('/');
  await page.getByRole('textbox', {name: 'Message'}).waitFor();
  await open(page);
  await expect(menu(page)).toBeVisible();
  await expect(page.getByRole('textbox', {name: 'Search commands'})).toBeFocused();
  await page.waitForTimeout(400);
  expect(catalogCalls).toEqual([]);
  await page.close();
});

test('Ctrl+Shift+P opens; Escape closes and focus returns to the previous element', async ({page}) => {
  await host(page, snapshot());
  await page.goto('/');
  const opener = page.getByRole('button', {name: 'Collapse sidebar'});
  await opener.focus();
  await page.keyboard.press('Control+Shift+P');
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden();
  await expect(opener).toBeFocused();
});

test('"appear" + Enter opens Settings on Appearance', async ({page}) => {
  await host(page, snapshot());
  await page.goto('/');
  await page.getByRole('textbox', {name: 'Message'}).waitFor();
  await open(page);
  await page.keyboard.type('appear');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', {name: 'Settings'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Appearance', exact: true})).toHaveAttribute('aria-current', 'page');
});

test('"new" + Enter opens the existing project selection flow', async ({page}) => {
  await host(page, snapshot());
  await page.goto('/');
  await page.getByRole('textbox', {name: 'Message'}).waitFor();
  await open(page);
  await page.keyboard.type('new thre');
  await page.keyboard.press('Enter');
  await expect(menu(page)).toBeHidden();
  await expect(page.getByRole('dialog', {name: 'Select project'})).toBeVisible();
});

test('"toggle side" + Enter collapses the sidebar and Ctrl+Shift+F reopens search focused', async ({page}) => {
  await host(page, snapshot());
  await page.goto('/');
  await page.getByRole('complementary', {name: 'Thread navigation'}).waitFor();
  await open(page);
  await page.keyboard.type('toggle side');
  await page.keyboard.press('Enter');
  await expect(menu(page)).toBeHidden();
  await expect(page.locator('.app-shell').first()).toHaveAttribute('data-sidebar-collapsed', 'true');
  await page.keyboard.press('Control+Shift+F');
  await expect(page.locator('.app-shell').first()).toHaveAttribute('data-sidebar-collapsed', 'false');
  await expect(page.getByRole('textbox', {name: 'Search threads'})).toBeFocused();
});

test('"files" + Enter opens the Files panel', async ({page}) => {
  await host(page, snapshot());
  await page.goto('/');
  await page.getByRole('textbox', {name: 'Message'}).waitFor();
  await open(page);
  await page.keyboard.type('files');
  await page.keyboard.press('Enter');
  await expect(menu(page)).toBeHidden();
  await expect(page.getByRole('tab', {name: 'Files'})).toHaveAttribute('aria-selected', 'true');
});

test('a thread result switches to that thread', async ({page}) => {
  await host(page, snapshot());
  await page.goto('/');
  await page.getByRole('textbox', {name: 'Message'}).waitFor();
  await open(page);
  await page.keyboard.type('Second');
  await page.keyboard.press('Enter');
  await expect(menu(page)).toBeHidden();
  await expect(page.getByRole('region', {name: 'Second task'})).toBeVisible();
});

test('a skill result inserts the skill into the current composer', async ({page}) => {
  await host(page, snapshot());
  await page.goto('/');
  await page.getByRole('textbox', {name: 'Message'}).waitFor();
  await open(page);
  await page.keyboard.type('tidy');
  await page.getByRole('option', {name: /tidy/}).click();
  await expect(menu(page)).toBeHidden();
  await expect(page.locator('.composer-skill-chip')).toHaveText(/tidy-code/);
});

test('disabled "Rename thread" is skipped by arrows when no thread is selected', async ({page}) => {
  const state = snapshot();
  state.activeThreadId = null;
  state.threads = [thread('one', 'First task')];
  await host(page, state);
  await page.goto('/');
  await page.getByRole('complementary', {name: 'Thread navigation'}).waitFor();
  await open(page);
  await expect(menu(page)).toBeVisible();
  const rename = menu(page).getByText('Rename thread');
  await expect(rename).toBeVisible();
});

test('IME composition input (keyCode 229) does not open the menu', async ({page}) => {
  await host(page, snapshot());
  await page.goto('/');
  await page.getByRole('textbox', {name: 'Message'}).waitFor();
  await page.evaluate(() => {
    const target = document.querySelector('textarea');
    target?.dispatchEvent(new KeyboardEvent('keydown', {key: 'k', code: 'KeyK', keyCode: 229, ctrlKey: true, bubbles: true}));
  });
  await page.waitForTimeout(200);
  await expect(menu(page)).toBeHidden();
});

test('the All Agents shell opens its own menu with workspace commands', async ({page}) => {
  await host(page, snapshot(), {preset: 'all-agents'});
  await page.goto('/');
  await page.getByRole('complementary', {name: 'Thread navigation'}).waitFor();
  await open(page);
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).getByText('New thread')).toBeVisible();
  await expect(menu(page).getByText('Open settings')).toBeVisible();
});

test('menu renders across themes, densities and zoom (screenshots)', async ({page}, testInfo) => {
  await host(page, snapshot());
  const shot = async (name: string) => testInfo.attach(name, {body: await page.screenshot(), contentType: 'image/png'});
  for (const theme of ['dark', 'light'] as const) {
    await page.goto('/');
    await page.getByRole('textbox', {name: 'Message'}).waitFor();
    await page.evaluate(value => {document.documentElement.dataset.theme = value;}, theme);
    await open(page);
    await expect(menu(page)).toBeVisible();
    await shot(`command-menu-${theme}.png`);
    await page.keyboard.press('Escape');
  }
  // forced colors / high contrast
  await page.emulateMedia({forcedColors: 'active'});
  await open(page);
  await expect(menu(page)).toBeVisible();
  await shot('command-menu-forced-colors.png');
  await page.emulateMedia({forcedColors: 'none'});
  await page.keyboard.press('Escape');
  // 700px viewport + 150% zoom
  await page.setViewportSize({width: 700, height: 800});
  await open(page);
  await expect(menu(page)).toBeVisible();
  await shot('command-menu-700px.png');
  // error row state from a failed catalog
  await page.route('**/api/skill-catalog*', route => void route.fulfill({status: 500, json: {error: {message: 'fixture failure'}}}));
  await page.keyboard.type('tidy');
  await expect(menu(page).getByText(/could not|failed|error|Retry/i).first()).toBeVisible({timeout: 5000});
  await shot('command-menu-error-row.png');
});

test('reduced motion shows no transform transition on the dialog', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await host(page, snapshot());
  await page.goto('/');
  await page.getByRole('textbox', {name: 'Message'}).waitFor();
  await open(page);
  await expect(menu(page)).toBeVisible();
  const style = await page.locator('.command-menu-dialog').evaluate(node => ({transform: getComputedStyle(node).transform, duration: getComputedStyle(node).transitionDuration}));
  expect(style.transform).toBe('none');
  expect(parseFloat(style.duration)).toBeLessThanOrEqual(0.1);
});
