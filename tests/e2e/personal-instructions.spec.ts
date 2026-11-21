import {expect, test, type Page} from '@playwright/test';
import {resolve} from 'node:path';
import type {PersonalInstructionsView} from '../../packages/contracts/personal-instructions';

const OK: PersonalInstructionsView = {text: 'Prefer pnpm.\n', digest: 'a'.repeat(64), bytes: 13, updatedAt: '2026-11-20T00:00:00.000Z', status: 'OK'};

async function setup(page: Page, initial: PersonalInstructionsView = OK) {
  const unexpected: string[] = [], errors: string[] = [];
  const writes: {method: string; path: string; body: Record<string, unknown>; csrf: string | undefined}[] = [];
  let view = initial;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:5823') {unexpected.push(request.url()); return route.abort();}
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (request.method() !== 'GET') writes.push({method: request.method(), path: url.pathname, body: request.postDataJSON(), csrf: request.headers()['x-harness-csrf']});
    if (url.pathname === '/api/bootstrap') return route.fulfill({json: {csrfToken: 'synthetic-personal-csrf'}});
    if (url.pathname === '/api/personal-instructions') return route.fulfill({json: view});
    if (url.pathname === '/api/commands') {
      const body = request.postDataJSON();
      if (body.type === 'instructions.personal.update') {
        const payload = body.payload as {text: string};
        view = {...view, text: payload.text, bytes: new TextEncoder().encode(payload.text).length, digest: 'b'.repeat(64), updatedAt: '2026-11-21T00:00:00.000Z', status: 'OK'};
        return route.fulfill({json: {commandId: body.id, eventSeq: 1, result: view}});
      }
      return route.fulfill({json: {commandId: body.id, eventSeq: 1, result: {}}});
    }
    unexpected.push(`${request.method()} ${url.pathname}`);
    return route.fulfill({status: 500, json: {error: {message: 'Unexpected synthetic fixture request'}}});
  });
  const fixture = '/@fs/' + resolve('tests/e2e/personal-instructions-fixture.tsx').replaceAll('\\', '/');
  await page.route('**/personal-instructions-fixture', route => route.fulfill({contentType: 'text/html', body: `<html data-theme="dark"><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${encodeURI(fixture)}');</script></body></html>`}));
  await page.goto('/personal-instructions-fixture');
  const editor = page.getByLabel('Personal instructions', {exact: true});
  await expect(editor).toBeVisible();
  return {editor, writes, unexpected, errors, setView: (next: PersonalInstructionsView) => { view = next; }};
}

test('loads the stored text, shows the byte counter and saves via Ctrl+S', async ({page}) => {
  const host = await setup(page);
  await expect(host.editor).toHaveValue('Prefer pnpm.\n');
  await expect(page.getByText(/of 16\.0 KB/)).toBeVisible();
  const save = page.getByRole('button', {name: 'Save', exact: true});
  await expect(save).toBeDisabled();
  await host.editor.fill('Prefer pnpm.\nAlways run lint.');
  await expect(save).toBeEnabled();
  await host.editor.press('ControlOrMeta+s');
  await expect(page.getByText('Saved')).toBeVisible();
  const update = host.writes.find(write => write.body.type === 'instructions.personal.update');
  expect(update).toBeTruthy();
  expect(update!.csrf).toBe('synthetic-personal-csrf');
  expect((update!.body.payload as {text: string}).text).toBe('Prefer pnpm.\nAlways run lint.');
  expect((update!.body.payload as {baseDigest: string | null}).baseDigest).toBe('a'.repeat(64));
  expect(host.errors).toEqual([]);
  expect(host.unexpected).toEqual([]);
});

test('revert restores the stored text and the off switch dims the editor', async ({page}) => {
  const host = await setup(page);
  await host.editor.fill('A draft the user abandons.');
  const revert = page.getByRole('button', {name: 'Revert', exact: true});
  await expect(revert).toBeEnabled();
  await revert.click();
  await expect(host.editor).toHaveValue('Prefer pnpm.\n');
  await expect(revert).toBeDisabled();
  await page.getByRole('switch', {name: 'Use personal instructions', exact: true}).click();
  await expect(host.editor).toHaveAttribute('data-off', 'true');
  await expect(page.getByText('Off. Saved text is kept but not sent.')).toBeVisible();
  expect(host.errors).toEqual([]);
});

test('over-limit drafts block saving and excluded sources explain why', async ({page}) => {
  const host = await setup(page, {text: '', digest: null, bytes: 0, updatedAt: null, status: 'EXCLUDED', reason: 'SOURCE_TOO_LARGE'} as unknown as PersonalInstructionsView);
  await expect(page.getByRole('alert').filter({hasText: 'over the size limit'})).toBeVisible();
  await host.editor.fill('x'.repeat(17 * 1024));
  const save = page.getByRole('button', {name: 'Save', exact: true});
  await expect(save).toBeDisabled();
  await expect(page.getByText(/too long/)).toBeVisible();
  await expect(page.locator('.personal-instructions-counter')).toHaveClass(/over/);
  expect(host.errors).toEqual([]);
});
