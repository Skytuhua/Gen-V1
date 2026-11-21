// Test-only spec for #1272 (parent #1235 task T06): the composer "Create PR"
// chip opens the publish review sheet when the host draft probe succeeds and
// keeps the legacy prompt insert otherwise. Route mocks stand in for the
// #1291 publish routes; no real host or git is involved.
import { test, expect, type Page, type Route } from '@playwright/test';
import { resolve } from 'node:path';

const HEAD = 'a'.repeat(40), REVISION = 'c'.repeat(64);
const DRAFT = {
  version: 1,
  projectId: 'project-one',
  threadId: 'thread-one',
  branch: 'gen/review',
  head: HEAD,
  revision: REVISION,
  base: 'main',
  files: [
    { path: 'src/one.ts', added: 10, removed: 2, untracked: false },
    { path: 'src/two.ts', added: null, removed: null, untracked: true },
    { path: 'src/three.ts', added: 3, removed: 1, untracked: false },
  ],
  commitMessage: 'Review publish',
  title: 'Review publish',
  body: 'Generated PR body',
};

function operation(request: Record<string, unknown>) {
  const step = { state: 'confirmed', at: '2026-11-21T00:00:00.000Z' };
  return {
    id: request.id,
    owner: { projectId: 'project-one', threadId: 'thread-one' },
    createdAt: '2026-11-21T00:00:00.000Z',
    request,
    steps: { commit: step, push: step, pr: step, link: step },
    result: { url: 'https://github.com/fixture/project/pull/12', number: 12, head: 'b'.repeat(40), repo: 'fixture/project' },
  };
}

async function fixture(page: Page, draftResponse: (route: Route) => void | Promise<void>) {
  const path = encodeURI('/@fs/' + resolve('tests/e2e/publish-thread-fixture.tsx').replaceAll('\\', '/'));
  let execute: (route: Route) => void | Promise<void> = (route) =>
    route.fulfill({ status: 404, json: { error: { code: 'HTTP_ERROR', message: 'Publish route not configured for this test.' } } });
  const api = {
    setExecute(handler: (route: Route) => void | Promise<void>) { execute = handler; },
  };
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/bootstrap') return route.fulfill({ json: { csrfToken: 'fixture' } });
    if (url.pathname === '/api/projects/project-one/publish/draft') return draftResponse(route);
    if (url.pathname === '/api/projects/project-one/publish') return execute(route);
    return route.fulfill({ status: 404, json: { error: { message: 'Unconfigured fixture request' } } });
  });
  await page.route('**/publish-thread-fixture?*', (route) =>
    route.fulfill({ contentType: 'text/html', body: `<html data-theme="dark"><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${path}');</script></body></html>` }));
  await page.goto('/publish-thread-fixture?1');
  await expect(page.getByRole('button', { name: 'Create PR', exact: true })).toBeEnabled();
  return api;
}

const draftOk = (route: Route) => route.fulfill({ json: DRAFT });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Review before publishing' });

test('chip opens the review sheet when the draft probe succeeds', async ({ page }) => {
  await fixture(page, draftOk);
  await page.getByRole('button', { name: 'Create PR', exact: true }).click();
  const sheet = dialog(page);
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.publish-review-branch')).toContainText('gen/review → origin');
  await expect(sheet.getByRole('checkbox', { name: 'Include src/one.ts' })).toBeChecked();
  await expect(sheet.getByText('+10')).toBeVisible();
  await expect(sheet.getByRole('textbox', { name: 'Commit message' })).toHaveValue('Review publish');
  await expect(sheet.getByRole('textbox', { name: 'Pull request title' })).toHaveValue('Review publish');
  await expect(sheet.getByRole('textbox', { name: 'Pull request body' })).toHaveValue('Generated PR body');
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('');
});

test('chip inserts the legacy prompt when the flag is off', async ({ page }) => {
  await fixture(page, (route) => route.fulfill({ status: 403, json: { error: { code: 'CAPABILITY_DENIED', message: 'Workspace publishing is disabled.' } } }));
  await page.getByRole('button', { name: 'Create PR', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Create a pull request for the current changes.');
});

test('excluding a file updates the selection sent on approve', async ({ page }) => {
  const api = await fixture(page, draftOk);
  const posted: Record<string, unknown>[] = [];
  api.setExecute(async (route) => {
    posted.push(route.request().postDataJSON());
    await route.fulfill({ json: operation(posted[0]) });
  });
  await page.getByRole('button', { name: 'Create PR', exact: true }).click();
  const sheet = dialog(page);
  await expect(sheet).toBeVisible();
  const row = sheet.getByRole('checkbox', { name: 'Include src/two.ts' });
  await row.uncheck();
  await expect(sheet.getByText('2 of 3 selected')).toBeVisible();
  await sheet.getByRole('button', { name: 'Commit, push and open draft PR' }).click();
  await expect(sheet.locator('.publish-review-done')).toContainText('Opened pull request #12');
  expect(posted[0]).toMatchObject({
    threadId: 'thread-one',
    head: HEAD,
    revision: REVISION,
    selectedPaths: ['src/one.ts', 'src/three.ts'],
    commitMessage: 'Review publish',
    title: 'Review publish',
    base: 'main',
  });
});

test('auth-required draft shows GitHub sign-in inside the sheet', async ({ page }) => {
  await fixture(page, (route) => route.fulfill({ status: 400, json: { error: { code: 'GITHUB_AUTH_REQUIRED', message: 'Sign in to GitHub for this Gen V1 profile.' } } }));
  await page.getByRole('button', { name: 'Create PR', exact: true }).click();
  const sheet = dialog(page);
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Sign in to GitHub' })).toBeVisible();
});

test('keyboard-only approval submits the publish request', async ({ page }) => {
  const api = await fixture(page, draftOk);
  const posted: Record<string, unknown>[] = [];
  api.setExecute(async (route) => {
    posted.push(route.request().postDataJSON());
    await route.fulfill({ json: operation(posted[0]) });
  });
  await page.getByRole('button', { name: 'Create PR', exact: true }).click();
  const sheet = dialog(page);
  await expect(sheet).toBeVisible();
  const approve = sheet.getByRole('button', { name: 'Commit, push and open draft PR' });
  await approve.focus();
  await page.keyboard.press('Enter');
  await expect(sheet.locator('.publish-review-steps')).toContainText('Done');
  expect(posted[0]?.id).toBeTruthy();
});

test('revision conflict asks for re-review with the fresh draft', async ({ page }) => {
  let calls = 0;
  const api = await fixture(page, (route) => {
    calls += 1;
    return route.fulfill({ json: { ...DRAFT, head: calls === 1 ? HEAD : 'd'.repeat(40) } });
  });
  api.setExecute(async (route) => {
    await route.fulfill({ status: 400, json: { error: { code: 'REVISION_CHANGED', message: 'The reviewed working copy changed. Refresh before publishing.' } } });
  });
  await page.getByRole('button', { name: 'Create PR', exact: true }).click();
  const sheet = dialog(page);
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Commit, push and open draft PR' }).click();
  await expect(sheet.getByRole('alert')).toContainText('The working copy changed');
  await expect(sheet.getByRole('button', { name: 'Commit, push and open draft PR' })).toBeEnabled();
});
