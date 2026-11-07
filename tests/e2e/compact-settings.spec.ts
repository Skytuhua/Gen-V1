import {expect, test, type Page} from '@playwright/test';
import {resolve} from 'node:path';
import type {ShellSettingsReadModel, ThreadNavigationRow} from '../../packages/contracts/shell-read-models';
import type {HostCommand} from '../../packages/contracts';

const thread = (id: string): ThreadNavigationRow => ({id, title: 'Archived ' + id, status: 'ready', projectName: 'Synthetic project', runId: null, createdAt: '2026-11-06', updatedAt: '2026-11-06'});
async function setup(page: Page) {
  const grants = Array.from({length: 125}, (_, i) => ({id: 'r' + i, threadId: 'authorized-thread', kind: 'file' as const, label: 'Exact grant ' + i, path: 'C:/authorized/' + i, writable: false}));
  const archives = Array.from({length: 125}, (_, i) => thread('a' + i));
  const model: ShellSettingsReadModel = {sequence: 7, settings: {theme: 'dark', modelId: 'model-one', selectedAccounts: {openai: 'account-one'}}, accounts: [{id: 'account-one', providerId: 'openai', label: 'First account', enabled: true, createdAt: '2026-11-06', updatedAt: '2026-11-06'}, {id: 'account-two', providerId: 'openai', label: 'Second account', enabled: true, createdAt: '2026-11-06', updatedAt: '2026-11-06'}], skills: [{name: 'saved-skill', description: 'Synthetic saved skill', category: 'general', revision: 2, state: 'active', enabled: true, protected: false, origin: 'user', managed: true, author: 'user', createdAt: '', updatedAt: '', lastUsedAt: null, useCount: 4, patchCount: 1}], skillProposals: [], learning: {supported: true, status: 'idle', lastReview: null}, projects: [{id: 'project', name: 'Synthetic project'}], resources: grants.slice(0, 100), resourcePage: {total: 125, nextCursor: 'resource-100'}, counts: {threads: 205, archivedThreads: 125, artifacts: 37, resources: 125, uncertainOperations: 4}};
  const commands: HostCommand[] = [], reads: string[] = [];
  page.on('request', request => reads.push(new URL(request.url()).pathname + new URL(request.url()).search));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (path === '/api/bootstrap') return route.fulfill({json: {csrfToken: 'fixture'}});
    if (path === '/api/shell/settings') return route.fulfill({json: model});
    if (path === '/api/shell/resources') return route.fulfill({json: {sequence: 7, total: 125, items: grants.slice(100), nextCursor: null}});
    if (path === '/api/shell/navigation') return route.fulfill({json: {sequence: 7, total: archives.length, order: 'created-desc', stats: {pinned: 0, working: 0, waiting: 0, settled: 0, minOrder: 0, maxOrder: 0}, items: url.searchParams.has('cursor') ? archives.slice(100) : archives.slice(0, 100), nextCursor: !url.searchParams.has('cursor') && archives.length > 100 ? 'archive-100' : null}});
    if (path === '/api/models') return route.fulfill({json: {models: [{id: model.settings.selectedAccounts?.openai === 'account-two' ? 'model-two' : 'model-one', name: model.settings.selectedAccounts?.openai === 'account-two' ? 'Second model' : 'First model', provider: 'openai'}]}});
    if (path === '/api/commands') {
      const command = route.request().postDataJSON() as HostCommand; commands.push(command);
      if (command.type === 'account.select') model.settings.selectedAccounts = {openai: command.payload.accountId as string};
      if (command.type === 'settings.update') model.settings = {...model.settings, ...command.payload};
      if (command.type === 'thread.restore') {archives.splice(archives.findIndex(row => row.id === command.threadId), 1); model.counts.archivedThreads--;}
      return route.fulfill({json: {commandId: command.id, seq: ++model.sequence, result: {}}});
    }
    if (path === '/api/environment') return route.fulfill({json: {revision: 0, entries: [], secretStorageAvailable: false}});
    if (path === '/api/workspace') return route.fulfill({json: {projects: []}});
    if (path === '/api/integrations') return route.fulfill({json: {integrations: []}});
    if (path === '/api/account-auth') return route.fulfill({json: {state: 'signed-out', message: 'Synthetic readiness', identity: {availability: 'unavailable'}}});
    return route.fulfill({status: 500, json: {error: {message: 'Unexpected fixture read: ' + path}}});
  });
  const fixture = '/@fs/' + resolve('tests/e2e/compact-settings-fixture.tsx').replaceAll('\\', '/');
  await page.route('**/compact-settings-fixture', route => route.fulfill({contentType: 'text/html', body: `<html data-theme="dark"><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${encodeURI(fixture)}');</script></body></html>`}));
  const open = () => page.goto('/compact-settings-fixture');
  const dialog = page.getByRole('dialog', {name: 'Settings', exact: true});
  const nav = dialog.getByRole('navigation', {name: 'Settings sections'});
  return {model, commands, reads, open, dialog, nav};
}
test('actual compact Settings uses every real section, complete grants/archive and zero forbidden reads', async ({page}) => {
  const host = await setup(page); await host.open();
  const labels = ['General', 'Appearance', 'Chat & Composer', 'Models & Accounts', 'Projects & Working Copies', 'Source Control & Reviews', 'Skills & Integrations', 'Notifications & Usage', 'Browser', 'Keyboard Shortcuts', 'Data & Recovery', 'About & Licenses'];
  for (const label of labels) {await host.nav.getByRole('button', {name: label, exact: true}).click(); await expect(host.dialog.getByRole('heading', {level: 1, name: label, exact: true})).toBeVisible();}
  await host.nav.getByRole('button', {name: 'Projects & Working Copies', exact: true}).click(); await expect(host.dialog.getByText('Exact grant 124', {exact: true})).toBeVisible();
  await host.nav.getByRole('button', {name: 'Data & Recovery', exact: true}).click();
  await expect(host.dialog.getByText('125 archived', {exact: true})).toBeVisible();
  await expect(host.dialog.getByText(/205 threads.*37 artifacts.*125 grants.*4 uncertain/)).toBeVisible();
  await host.dialog.locator('.settings-row').filter({has: page.getByRole('heading', {name: 'Archived a124', exact: true})}).getByRole('button', {name: 'Restore thread'}).click();
  await expect(host.dialog.getByText('124 archived', {exact: true})).toBeVisible();
  await host.dialog.getByRole('button', {name: 'Refresh settings', exact: true}).click();
  await host.nav.getByRole('button', {name: 'General', exact: true}).click(); await host.dialog.getByRole('switch', {name: 'Archive confirmation', exact: true}).click();
  await expect.poll(() => host.commands.some(command => command.type === 'settings.update')).toBe(true);
  expect(host.reads.filter(path => /snapshot|\/api\/events|\/src\/App\.tsx|\/content|\/tree|draft-references|\/api\/skills\//.test(path))).toEqual([]);
});
test('account defaults refresh the unbound model catalog and model selection keeps exact command authority', async ({page}) => {
  const host = await setup(page); await host.open(); await host.nav.getByRole('button', {name: 'Models & Accounts', exact: true}).click();
  const provider = host.dialog.locator('[data-provider="openai"]'); await provider.getByRole('radio', {name: 'Second account', exact: true}).check(); await provider.getByRole('button', {name: 'Use account', exact: true}).click();
  await expect(host.dialog.getByRole('combobox', {name: 'Default model', exact: true})).toBeEnabled();
  await host.dialog.getByRole('combobox', {name: 'Default model', exact: true}).click(); await page.getByRole('option', {name: 'Second model', exact: true}).click();
  await expect.poll(() => host.commands.some(command => command.type === 'settings.update' && command.payload.modelId === 'model-two')).toBe(true);
  expect(host.commands.find(command => command.type === 'account.select')?.payload).toEqual({providerId: 'openai', accountId: 'account-two'});
  expect(host.reads.filter(path => path.startsWith('/api/models')).every(path => !path.includes('threadId'))).toBe(true);
  expect(host.reads.some(path => path.includes('refresh=1'))).toBe(true);
});
test('saved skill details use only the explicit endpoint when inspected', async ({page}) => {
  const host = await setup(page); let details = 0;
  await page.route('**/api/skills/saved-skill*', route => {details++; return route.fulfill({json: {skill: host.model.skills[0], content: 'Exact saved instructions', files: [], versions: [], nextVersionOffset: null}});});
  await host.open(); await host.nav.getByRole('button', {name: 'Skills & Integrations', exact: true}).click(); expect(details).toBe(0);
  await host.dialog.getByRole('button', {name: 'Inspect saved-skill', exact: true}).click(); await expect(host.dialog.getByRole('textbox', {name: 'Instructions for saved-skill'})).toHaveValue('Exact saved instructions'); expect(details).toBe(1);
});
test('failed loading is explicit and retry loads real settings', async ({page}) => {
  const host = await setup(page); let fail = true; await page.route('**/api/shell/settings', route => fail ? route.fulfill({status: 503, json: {error: {message: 'Synthetic metadata failure'}}}) : route.fallback());
  await host.open(); await expect(host.dialog.getByRole('alert')).toContainText('Synthetic metadata failure'); expect(host.reads).not.toContain('/api/snapshot');
  fail = false; await host.dialog.getByRole('button', {name: 'Retry settings', exact: true}).click(); await expect(host.nav).toBeVisible();
});
test('a changed scope aborts late metadata and the old result cannot replace the new scope', async ({page}) => {
  const host = await setup(page); let calls = 0, release!: () => void;
  const held = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/api/shell/settings', async route => {calls++; if (calls === 1) {await held; await route.fulfill({json: {...host.model, projects: [{id: 'stale', name: 'Stale scope'}]}}).catch(() => {});} else await route.fallback();});
  await host.open(); await expect(host.dialog.getByRole('status')).toContainText('Opening settings');
  await page.evaluate(() => (document.querySelector('button') as HTMLButtonElement).click());
  await expect(host.nav).toBeVisible(); release();
  await host.nav.getByRole('button', {name: 'Appearance', exact: true}).click(); await expect(host.dialog.getByText('Synthetic project', {exact: true})).toBeVisible(); await expect(host.dialog.getByText('Stale scope')).toHaveCount(0);
});
test('late model reads cannot replace the catalog after account selection', async ({page}) => {
  const host = await setup(page); let calls = 0, release!: () => void;
  const held = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/api/models*', async route => {
    if (++calls !== 1) return route.fallback();
    await held; await route.fulfill({json: {models: [{id: 'stale-model', name: 'Stale model', provider: 'openai'}]}}).catch(() => {});
  });
  await host.open(); await host.nav.getByRole('button', {name: 'Models & Accounts', exact: true}).click();
  const provider = host.dialog.locator('[data-provider="openai"]');
  await provider.getByRole('radio', {name: 'Second account', exact: true}).check(); await provider.getByRole('button', {name: 'Use account', exact: true}).click();
  await expect.poll(() => calls).toBeGreaterThan(1); release();
  await host.dialog.getByRole('combobox', {name: 'Default model', exact: true}).click();
  await expect(page.getByRole('option', {name: 'Second model', exact: true})).toBeVisible(); await expect(page.getByRole('option', {name: 'Stale model', exact: true})).toHaveCount(0);
});
test('actual compact draft export preserves the signature guard and sends only exact journal keys', async ({page}) => {
  const host = await setup(page); const requested: unknown[] = [];
  await page.route('**/api/shell/draft-references', route => {requested.push(route.request().postDataJSON()); return route.fulfill({json: {threads: [{id: 'signature-only'}], skills: [], userStates: [], requests: []}});});
  await host.open(); await host.nav.getByRole('button', {name: 'Data & Recovery', exact: true}).click();
  await page.evaluate(async () => {
    const path = '/src/journal.ts'; const journal = await import(path); await journal.journalWrite('draft:new', 'Private local browser draft');
    localStorage.setItem('harness:signature-assets:v1:signature-only:state', JSON.stringify([{id: 'mark', stateKey: 'signature', base64: 'mark'}]));
  });
  await host.dialog.getByRole('button', {name: 'Export local drafts', exact: true}).click();
  await expect(host.dialog.getByRole('alert')).toContainText('pending signature'); expect(requested).toEqual([{keys: ['draft:new']}]);
  await page.evaluate(() => localStorage.removeItem('harness:signature-assets:v1:signature-only:state'));
  const download = page.waitForEvent('download'); await host.dialog.getByRole('button', {name: 'Export local drafts', exact: true}).click();
  expect((await download).suggestedFilename()).toBe('harness-drafts.json');
  expect(JSON.stringify(requested)).not.toContain('Private local browser draft'); expect(host.reads).not.toContain('/api/snapshot');
});
test('the injected browser callback receives the accepted start page and closes Settings', async ({page}) => {
  const host = await setup(page); host.model.settings.preferences = {browserStartUrl: 'https://example.com/accepted'};
  await host.open(); await host.nav.getByRole('button', {name: 'Browser', exact: true}).click();
  await host.dialog.getByRole('textbox', {name: 'Browser start page', exact: true}).fill('https://example.com/unsaved');
  await host.dialog.getByRole('button', {name: 'Open browser', exact: true}).click();
  expect(await page.evaluate(() => (window as unknown as {openedUrl: string}).openedUrl)).toBe('https://example.com/accepted'); await expect(host.dialog).toHaveCount(0);
});
test('accepted appearance applies immediately in the standalone compact consumer', async ({page}) => {
  const host = await setup(page); await host.open(); await host.nav.getByRole('button', {name: 'Appearance', exact: true}).click();
  await host.dialog.getByRole('combobox', {name: 'Density', exact: true}).click(); await page.getByRole('option', {name: /^Touch/}).click();
  await host.dialog.getByRole('combobox', {name: 'Color scheme', exact: true}).click(); await page.getByRole('option', {name: 'Light', exact: true}).click();
  await host.dialog.getByRole('button', {name: 'Apply', exact: true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-density', 'touch'); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
