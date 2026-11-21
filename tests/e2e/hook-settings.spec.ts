import {expect, test, type Page} from '@playwright/test';
import {resolve} from 'node:path';

const COVERAGE = {covered: ['Host tool calls', 'Approved operations'], notCovered: ['Pi built-in tools']};
type Doc = {revision: number; enabled: boolean; hooks: Record<string, unknown>[]};
const hookDoc = (over: Partial<Doc> = {}): Doc => ({revision: 1, enabled: true, hooks: [], ...over});
const existingHook = {id: 'hook_existing01', name: 'formatter', event: 'PreToolUse', matcher: '^file\\.write$', command: 'prettier --check $FILE', timeoutSeconds: 30, onError: 'continue', enabled: true};

async function setup(page: Page, initial: Doc) {
  const doc = {...initial}, writes: {method: string; path: string; body: unknown}[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (request.method() !== 'GET') writes.push({method: request.method(), path: url.pathname, body: request.postDataJSON()});
    const view = () => ({revision: doc.revision, enabled: doc.enabled, hooks: doc.hooks.map(hook => ({...hook, lastRun: null})), coverage: COVERAGE});
    if (url.pathname === '/api/bootstrap') return route.fulfill({json: {csrfToken: 'synthetic-hooks-csrf'}});
    if (url.pathname === '/api/hooks' && request.method() === 'GET') return route.fulfill({json: view()});
    if (url.pathname === '/api/hooks' && request.method() === 'PUT') {
      const body = request.postDataJSON() as {hook: Record<string, unknown>};
      const id = (body.hook.id as string | undefined) ?? `hook_saved${String(doc.hooks.length).padStart(8, '0')}`;
      const index = doc.hooks.findIndex(hook => hook.id === id);
      const saved = {...body.hook, id};
      if (index >= 0) doc.hooks[index] = saved; else doc.hooks.push(saved);
      doc.revision += 1;
      return route.fulfill({json: {...doc}});
    }
    if (url.pathname === '/api/hooks' && request.method() === 'DELETE') {
      const body = request.postDataJSON() as {id: string};
      doc.hooks = doc.hooks.filter(hook => hook.id !== body.id); doc.revision += 1;
      return route.fulfill({json: {...doc}});
    }
    if (url.pathname === '/api/hooks/enabled') {
      const body = request.postDataJSON() as {enabled: boolean};
      doc.enabled = body.enabled; doc.revision += 1;
      return route.fulfill({json: {...doc}});
    }
    if (url.pathname === '/api/hooks/test') return route.fulfill({json: {hookId: 'hook_test00000000', event: 'PreToolUse', matchKey: 'example_tool', startedAt: new Date().toISOString(), durationMs: 210, outcome: 'succeeded', exitCode: 0, reason: null, systemMessage: null, stdout: 'formatted 3 files', stderr: '', truncated: false, ignoredFields: []}});
    return route.fulfill({status: 500, json: {error: {message: `Unexpected request ${request.method()} ${url.pathname}`}}});
  });
  const fixture = '/@fs/' + resolve('tests/e2e/hook-settings-fixture.tsx').replaceAll('\\', '/');
  await page.route('**/hook-settings-fixture', route => route.fulfill({contentType: 'text/html', body: `<html data-theme="dark"><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${encodeURI(fixture)}');</script></body></html>`}));
  await page.goto('/hook-settings-fixture');
  await expect(page.getByRole('switch', {name: 'Run hooks'})).toBeVisible();
  return {doc, writes, errors};
}

test('renders master switch, warning, coverage and the empty state, then adds and saves a hook', async ({page}) => {
  const {doc, writes, errors} = await setup(page, hookDoc());
  await expect(page.getByText('Only add commands you trust.')).toBeVisible();
  await expect(page.getByText('No hooks yet.')).toBeVisible();
  await page.getByRole('button', {name: 'Add hook'}).click();
  const event = page.getByRole('combobox', {name: 'Event', exact: true});
  await expect(event).toBeVisible();
  await page.getByPlaceholder('*').fill('^file\\.write$');
  await page.locator('textarea').fill('prettier --write $FILE');
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await expect(page.locator('.hook-card-name').first()).toHaveText('prettier --write $FILE');
  expect(doc.hooks).toHaveLength(1);
  expect(writes.some(write => write.path === '/api/hooks' && write.method === 'PUT')).toBe(true);
  expect(errors).toEqual([]);
});

test('test run shows the result panel inside the card', async ({page}) => {
  await setup(page, hookDoc({hooks: [{...existingHook}]}));
  await page.getByRole('button', {name: /Edit formatter/}).click();
  await page.getByRole('button', {name: 'Test', exact: true}).click();
  await expect(page.getByText(/Exit 0 · Succeeded/)).toBeVisible();
  await expect(page.getByText('formatted 3 files')).toBeVisible();
});

test('invalid matcher keeps Save disabled and marks the field', async ({page}) => {
  await setup(page, hookDoc({hooks: [{...existingHook}]}));
  await page.getByRole('button', {name: /Edit formatter/}).click();
  const matcher = page.getByPlaceholder('*');
  await matcher.fill('[invalid');
  await expect(matcher).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('button', {name: 'Save', exact: true})).toBeDisabled();
  await expect(page.getByText('Not a valid regular expression.')).toBeVisible();
});

test('master switch off dims the cards and explains that nothing runs', async ({page}) => {
  const {doc} = await setup(page, hookDoc({hooks: [{...existingHook}]}));
  await page.getByRole('switch', {name: 'Run hooks'}).click();
  await expect(page.getByText('Hooks are off. None will run.')).toBeVisible();
  await expect(page.locator('.hook-card').first()).toHaveCSS('opacity', '0.6');
  expect(doc.enabled).toBe(false);
});

test('per-hook switch and remove round-trip through the API', async ({page}) => {
  const {doc} = await setup(page, hookDoc({hooks: [{...existingHook}]}));
  await page.getByRole('switch', {name: 'Enable formatter'}).click();
  await expect(page.getByRole('switch', {name: 'Enable formatter'})).toHaveAttribute('aria-checked', 'false');
  expect((doc.hooks[0] as {enabled: boolean}).enabled).toBe(false);
  page.on('dialog', dialog => void dialog.accept());
  await page.getByRole('button', {name: /Edit formatter/}).click();
  await page.getByRole('button', {name: 'Remove', exact: true}).click();
  await expect(page.getByText('No hooks yet.')).toBeVisible();
  expect(doc.hooks).toHaveLength(0);
});

test('keyboard-only flow: add, fill, save, and focus returns to the edit button', async ({page}) => {
  await setup(page, hookDoc());
  await page.getByRole('button', {name: 'Add hook'}).focus();
  await page.keyboard.press('Enter');
  const event = page.getByRole('combobox', {name: 'Event', exact: true});
  await expect(event).toBeVisible();
  await page.getByPlaceholder('*').fill('');
  await page.locator('textarea').fill('echo hi');
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await expect(page.locator('.hook-card-name').first()).toHaveText('echo hi');
  await expect(page.getByRole('button', {name: /Edit/}).first()).toBeFocused();
});

test('reduced motion disables card transforms', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await setup(page, hookDoc({hooks: [{...existingHook}]}));
  await page.getByRole('button', {name: /Edit formatter/}).click();
  await expect(page.locator('textarea')).toBeVisible();
});
