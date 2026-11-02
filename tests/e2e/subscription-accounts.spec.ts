import { test, expect, type Page } from '@playwright/test';
import type { HostCommand, ModelInfo } from '../../packages/contracts';
import type { ConnectionAccount } from '../../packages/contracts/accounts';
import { serveTaskFixture, taskFixture } from './task-interface-fixture';

const personal = '13b23643-8c4d-42ac-a5f5-d14823bc4441';
const work = '13b23643-8c4d-42ac-a5f5-d14823bc4442';
const created = '13b23643-8c4d-42ac-a5f5-d14823bc4443';
const now = '2026-11-01T00:00:00.000Z';
const account = (id: string, label: string): ConnectionAccount => ({ id, providerId: 'openai', label, enabled: true, createdAt: now, updatedAt: now });
const model = (name: string, id = 'openai/shared'): ModelInfo => ({ id, provider: 'openai', name });
function fixture() {
  const snapshot = taskFixture({ root: 'text', elements: { text: { type: 'Text', props: { text: 'Account fixture' } } } });
  snapshot.artifacts = []; snapshot.messages = []; snapshot.accounts = [account(personal, 'Personal'), account(work, 'Work')];
  snapshot.settings = { theme: 'dark', modelId: 'openai/shared', selectedAccounts: { openai: personal } };
  snapshot.threads[0] = { ...snapshot.threads[0], title: 'Personal task', accountId: personal, modelId: 'openai/shared' };
  snapshot.threads.push({ ...snapshot.threads[0], id: 'work-thread', title: 'Work task', accountId: work });
  return snapshot;
}
async function host(page: Page, snapshot = fixture()) {
  const base = await serveTaskFixture(page, snapshot); const commands: HostCommand[] = [], discoveries: string[] = [];
  let fail = '', pending: (() => void) | undefined;
  await page.route('**/api/commands', async route => {
    const command = route.request().postDataJSON() as HostCommand; commands.push(command);
    if (!command.type.startsWith('account.')) return route.fallback();
    if (fail) { const message = fail; fail = ''; return route.fulfill({ status: 409, json: { error: { code: 'ACCOUNT_BUSY', message } } }); }
    if (pending) { const release = pending; pending = undefined; await new Promise<void>(resolve => { release(); pending = resolve; }); pending = undefined; }
    const p = command.payload, row = snapshot.accounts!.find(item => item.id === p.accountId);
    if (command.type === 'account.create') snapshot.accounts!.push(account(created, String(p.label)));
    if (command.type === 'account.rename' && row) row.label = String(p.label);
    if (command.type === 'account.select') snapshot.settings.selectedAccounts = { ...snapshot.settings.selectedAccounts, [String(p.providerId)]: p.accountId as string | null };
    if (command.type === 'account.remove' && row) { row.enabled = false; if (snapshot.settings.selectedAccounts?.openai === row.id) snapshot.settings.selectedAccounts.openai = null; }
    if (command.type === 'account.restore' && row) row.enabled = true;
    await route.fulfill({ json: { commandId: command.id, seq: ++snapshot.seq, result: row ?? snapshot.accounts!.at(-1) } });
  });
  await page.route('**/api/models*', async route => { const url = new URL(route.request().url()); discoveries.push(url.search); const thread = snapshot.threads.find(item => item.id === url.searchParams.get('threadId')); const id = thread?.accountId ?? snapshot.settings.selectedAccounts?.openai; await route.fulfill({ json: { models: [model(id === work ? 'Work model' : 'Personal model')] } }); });
  await page.route('**/api/account-auth?*', route => { const query = new URL(route.request().url()).searchParams; return route.fulfill({json:{providerId:query.get('providerId'),accountId:query.get('accountId')||null,state:'configured',identity:{availability:'unavailable',subject:null,email:null,organization:null,subscription:null},lastCheckedAt:now,localSignout:!['claude-code','gemini-cli'].includes(query.get('providerId')!),message:'A credential is configured; authenticated identity is unavailable.'}}); });
  await page.route('**/api/composer-prediction/cancel', route=>route.fulfill({json:{cancelled:true}}));
  return { ...base, commands, discoveries, failNext(message: string) { fail = message; }, holdNext() { return new Promise<void>(resolve => { pending = resolve; }); }, release() { pending?.(); } };
}
async function openAccounts(page: Page) { await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.getByRole('button', { name: 'Providers', exact: true }).click(); return page.locator('.connection-row[data-provider="openai"]'); }
async function expectCatalog(page: Page, modelName: string) {
  await page.getByRole('combobox', { name: 'Model', exact: true }).click();
  await expect(page.getByRole('listbox', { name: 'Available models', exact: true }).getByRole('option', { name: modelName, exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search models', exact: true }).press('Escape');
}

test('explicit account CRUD persists two same-provider profiles without starting authentication', async ({ page }) => {
  const h = await host(page); await page.goto('/'); const provider = await openAccounts(page);
  await expect(provider.getByRole('radio', { name: 'Personal', exact: true })).toBeChecked();
  await provider.getByRole('radio', { name: 'Work', exact: true }).check();
  expect(h.commands.filter(c => c.type === 'account.select')).toHaveLength(0);
  await provider.getByRole('button', { name: 'Use account', exact: true }).click();
  await expect(provider.getByText('Default for new tasks: Work', { exact: true })).toBeVisible();
  await provider.getByRole('button', { name: 'Add account', exact: true }).click();
  await provider.getByRole('textbox', { name: 'Account label', exact: true }).fill('Studio');
  await provider.getByRole('button', { name: 'Save account', exact: true }).click();
  await provider.getByRole('button', { name: 'Rename Studio', exact: true }).click();
  await provider.getByRole('textbox', { name: 'Account label', exact: true }).fill('Studio renamed');
  await provider.getByRole('button', { name: 'Save account', exact: true }).click();
  await page.reload(); const reloaded = await openAccounts(page);
  await expect(reloaded.getByRole('radio', { name: 'Studio renamed', exact: true })).toBeVisible();
  await expect(reloaded.getByRole('radio', { name: 'Work', exact: true })).toBeChecked();
  expect(h.commands.filter(c => !c.type.startsWith('account.'))).toEqual([]);
  await expect(page.locator('body')).not.toContainText(/access_token|refresh_token|api[_-]?key\s*[:=]|@example\.com/);
});

test('removed accounts remain visible, cannot be selected, and can be restored', async ({ page }) => {
  const h = await host(page); await page.goto('/'); const provider = await openAccounts(page);
  await provider.getByRole('button', { name: 'Remove Personal', exact: true }).click();
  await expect(provider.getByRole('radio', { name: 'Personal', exact: true })).toBeDisabled();
  await expect(provider).toContainText('Existing tasks keep this account');
  await provider.getByRole('button', { name: 'Restore Personal', exact: true }).click();
  await expect(provider.getByRole('radio', { name: 'Personal', exact: true })).toBeEnabled();
  expect(h.commands.map(c => c.type)).toEqual(['account.remove', 'account.restore']);
});

for (const emptyThread of [false, true]) test(`removing the default refreshes ${emptyThread ? 'an unbound thread' : 'a new task'} and its Settings catalog`, async ({ page }) => {
  const snapshot = fixture();
  snapshot.threads = emptyThread ? [{ ...snapshot.threads[0], id: 'draft-thread', title: 'Blank task', modelId: null, sessionPath: null, accountId: undefined }] : [];
  snapshot.activeThreadId = emptyThread ? 'draft-thread' : null;
  snapshot.settings.modelId = 'openai/personal-only';
  await host(page, snapshot);
  await page.route('**/api/models*', route => route.fulfill({ json: { models: snapshot.settings.selectedAccounts?.openai === personal ? [model('Personal only', 'openai/personal-only')] : [model('Legacy only', 'openai/legacy-only')] } }));
  await page.goto('/'); await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toHaveText('Personal only');
  const provider = await openAccounts(page); await provider.getByRole('button', { name: 'Remove Personal', exact: true }).click();
  await expect(provider).toContainText('Default for new tasks: Legacy connection');
  await page.getByRole('button', { name: 'Threads', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Default model', exact: true })).toContainText('Legacy only');
  await expect(page.getByRole('combobox', { name: 'Default model', exact: true })).not.toContainText('Personal only');
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toHaveText('Legacy only');
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).not.toContainText('Personal only');
});

for (const pinned of [false, true]) test(`external default changes refresh Settings and ${pinned ? 'preserve a pinned catalog' : 'refresh a new task catalog'}`, async ({ page }) => {
  const snapshot = fixture();
  if (!pinned) { snapshot.threads = []; snapshot.activeThreadId = null; }
  const h = await host(page, snapshot), requests: string[] = [];
  await page.route('**/api/models*', route => { const url = new URL(route.request().url()); requests.push(url.search); const owner = snapshot.threads.find(thread => thread.id === url.searchParams.get('threadId')); const id = owner?.accountId ?? snapshot.settings.selectedAccounts?.openai; return route.fulfill({ json: { models: [model(id === work ? 'Work model' : 'Personal model'), model('Alternative model', 'openai/alternative')] } }); });
  await page.goto('/'); await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toContainText('Personal model');
  await page.getByRole('combobox', { name: 'Model', exact: true }).click();
  await page.getByRole('option', { name: 'Alternative model', exact: true }).click();
  await openAccounts(page); await page.getByRole('button', { name: 'Threads', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Default model', exact: true })).toContainText('Personal model');
  const pinnedReads = requests.filter(query => query.includes('threadId=task-thread')).length;
  snapshot.settings.selectedAccounts = { openai: work }; await h.publish();
  await expect(page.getByRole('combobox', { name: 'Default model', exact: true })).toContainText('Work model');
  await expect(page.getByRole('combobox', { name: 'Default model', exact: true })).not.toContainText('Personal model');
  const catalogReads = requests.length; snapshot.settings.selectedAccounts = { openai: work }; snapshot.settings.theme = 'light'; await h.publish();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light'); expect(requests).toHaveLength(catalogReads);
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expectCatalog(page, pinned ? 'Personal model' : 'Work model');
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toHaveText('Alternative model');
  expect(requests.filter(query => query.includes('threadId=task-thread'))).toHaveLength(pinnedReads);
});

test('pending account actions block duplicate submissions and expose recoverable host errors', async ({ page }) => {
  const h = await host(page); await page.goto('/'); const provider = await openAccounts(page);
  await provider.getByRole('radio', { name: 'Work', exact: true }).check(); const held = h.holdNext();
  await provider.getByRole('button', { name: 'Use account', exact: true }).click(); await held;
  await expect(provider.getByRole('button', { name: 'Saving default…', exact: true })).toBeDisabled(); h.release();
  await expect(provider.getByRole('button', { name: 'Add account', exact: true })).toBeEnabled();
  h.failNext('A task is using this account. Try again after it stops.');
  await provider.getByRole('button', { name: 'Remove Work', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('A task is using this account');
  await expect(provider.getByRole('radio', { name: 'Work', exact: true })).toBeEnabled();
});

test('an account radio is a pending choice until the new-task default is saved', async ({ page }) => {
  const h = await host(page); await page.goto('/'); const provider = await openAccounts(page);
  const personalRow = provider.locator(`[data-account-id="${personal}"]`), workRow = provider.locator(`[data-account-id="${work}"]`);
  await expect(personalRow.getByText('Default', { exact: true })).toBeVisible();
  await provider.getByRole('radio', { name: 'Work', exact: true }).check();
  await expect(provider.getByRole('status')).toContainText('Work is selected. Use account to make it the default for new tasks.');
  await expect(personalRow.getByText('Default', { exact: true })).toBeVisible();
  expect(h.commands).toHaveLength(0);
  const held = h.holdNext(); await provider.getByRole('button', { name: 'Use account', exact: true }).click(); await held;
  await expect(provider.getByRole('button', { name: 'Saving default…', exact: true })).toBeDisabled();
  await expect(provider.locator('.connection-accounts')).toHaveAttribute('aria-busy', 'true'); h.release();
  await expect(workRow.getByText('Default', { exact: true })).toBeVisible();
  await expect(personalRow.getByText('Default', { exact: true })).toHaveCount(0);
  await expect(provider.getByRole('status')).toContainText('Work is the default for new tasks.');
});

test('bound thread catalogs follow their pinned account and ignore late discovery from another thread', async ({ page }) => {
  const h = await host(page); let release: (() => void) | undefined, requests = 0, lateDone = false;
  await page.route('**/api/models*', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('threadId') === 'work-thread') {
      requests++; await new Promise<void>(resolve => { release = resolve; });
      await route.fulfill({ json: { models: [model('Work model', 'openai/work-only')] } }); lateDone = true; return;
    }
    return route.fallback();
  });
  await page.goto('/'); await expect(page.locator('.composer-account')).toHaveText('Personal');
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toContainText('Personal model');
  await page.getByRole('button', { name: 'Work task Ready', exact: true }).click(); await expect.poll(() => requests).toBe(1);
  await expect(page.locator('.composer-account')).toHaveText('Work');
  await page.getByRole('button', { name: 'Personal task Ready', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toContainText('Personal model'); release?.();
  await expect.poll(() => h.discoveries.filter(q => q.includes('task-thread')).length).toBeGreaterThan(1);
  await expect.poll(() => lateDone).toBe(true);
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).not.toContainText('Work model');
  const provider = await openAccounts(page); await provider.getByRole('radio', { name: 'Work', exact: true }).check(); await provider.getByRole('button', { name: 'Use account', exact: true }).click();
  await page.getByRole('button', { name: 'Close settings', exact: true }).click(); await expect(page.locator('.composer-account')).toHaveText('Personal');
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toContainText('Personal model');
});

test('a bound thread with no catalog keeps its saved model and offers explicit setup', async ({ page }) => {
  await host(page); await page.route('**/api/models*', route => route.fulfill({ json: { models: [], error: 'Sign in to this account to load its models.' } }));
  await page.goto('/'); await expect(page.locator('.composer-account')).toHaveText('Personal');
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toHaveText('openai/shared');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep this task pinned'); await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
});

test('pre-account tasks stay pinned to the legacy connection when a named default exists', async ({ page }) => {
  const snapshot = fixture(); delete snapshot.threads[0].accountId;
  await host(page, snapshot); const discoveries: string[] = [];
  await page.route('**/api/models*', route => { const url = new URL(route.request().url()); discoveries.push(url.search); return route.fulfill({ json: { models: [] } }); });
  await page.goto('/'); await expect(page.locator('.composer-account')).toHaveText('Legacy connection');
  await expect.poll(() => discoveries).toContain('?threadId=task-thread');
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toHaveText('openai/shared');
});

test('account labels fit the existing settings layout across dark, light, and narrow views', async ({ page }, testInfo) => {
  const snapshot = fixture(), h = await host(page, snapshot); await page.goto('/'); const provider = await openAccounts(page);
  await provider.getByRole('button', { name: 'Rename Work', exact: true }).click();
  await expect(provider.getByRole('textbox', { name: 'Account label', exact: true })).toHaveAttribute('maxlength', '80');
  await provider.getByRole('textbox', { name: 'Account label', exact: true }).fill('An account label with a long project and workspace name');
  await provider.getByRole('button', { name: 'Save account', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search all settings', exact: true }).fill('ChatGPT');
  for (const theme of ['dark', 'light'] as const) { snapshot.settings.theme = theme; await h.publish(); await expect(page.locator('html')).toHaveAttribute('data-theme', theme); await page.getByRole('dialog', { name: 'Settings', exact: true }).screenshot({ path: testInfo.outputPath(`accounts-${theme}.png`) }); }
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect.poll(() => provider.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.screenshot({ path: testInfo.outputPath('accounts-narrow.png') });
});

test('browser connection commands include the opaque account id and labels stay out of commands', async ({ page }) => {
  await host(page); await page.goto('/'); const provider = await openAccounts(page);
  await expect(provider.locator(`[data-account-id="${work}"] code`)).toHaveText(`pnpm agent:login --provider openai --account-id ${work}`);
  await expect(provider.locator(`[data-account-id="${work}"] code`)).not.toContainText('Work');
});

test('desktop sign-in targets the chosen provider and account only on an explicit connect click', async ({ page }) => {
  await page.addInitScript(() => { const w = window as any; w.__signIns = []; w.harnessDesktop = { getContext: async () => ({ windowId: 'main', surface: { kind: 'main' }, windows: [] }), ready: async () => ({}), onState: () => () => {}, onCloseRequested: () => () => {}, list: async () => [], signIn: async (...args: unknown[]) => { w.__signIns.push(args); }, browser: async () => ({}) }; });
  await host(page); await page.goto('/'); const provider = await openAccounts(page);
  await provider.getByRole('radio', { name: 'Work', exact: true }).check(); await provider.getByRole('button', { name: 'Use account', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__signIns)).toEqual([]);
  await provider.getByRole('button', { name: 'Connect Work', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__signIns)).toEqual([['openai', work]]);
});

test('shows per-account readiness without turning model counts or local labels into authenticated identity',async({page})=>{
  await host(page);
  await page.route(`**/api/account-auth?providerId=openai&accountId=${work}`,route=>route.fulfill({json:{providerId:'openai',accountId:work,state:'signed-out',identity:{availability:'unavailable',subject:null,email:null,organization:null,subscription:null},lastCheckedAt:now,localSignout:true,message:'No credential configured.'}}));
  await page.goto('/');const provider=await openAccounts(page),personalRow=provider.locator(`[data-account-id="${personal}"]`),workRow=provider.locator(`[data-account-id="${work}"]`);
  await expect(personalRow).toContainText('Credential configured');await expect(personalRow).toContainText('Authenticated identity unavailable.');await expect(workRow).toContainText('signed out');
  await expect(provider.locator('header').first()).not.toContainText('models available');await expect(provider).not.toContainText('Verified provider user');
  await expect(personalRow.getByRole('button',{name:'Sign out locally',exact:true})).toBeEnabled();await expect(workRow.getByRole('button',{name:'Sign out locally',exact:true})).toBeDisabled();
});

test('desktop owned sign-in exposes completion, cancellation and retry on its account row',async({page})=>{
  await page.addInitScript(()=>{
    const w=window as any;let active:any=null,count=0;w.__cancelled=[];
    w.harnessDesktop={getContext:async()=>({windowId:'main',surface:{kind:'main'},windows:[]}),ready:async()=>({}),onState:()=>()=>{},onCloseRequested:()=>()=>{},list:async()=>[],browser:async()=>({}),
      signIn:async(providerId:string,accountId:string)=>active={id:`flow-${++count}`,providerId,accountId,state:'waiting',startedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),message:'Complete native sign-in.'},
      signInStatus:async(id:string)=>active?.id===id?active:null,
      cancelSignIn:async(id:string)=>{w.__cancelled.push(id);active={...active,state:'cancelled',updatedAt:new Date().toISOString(),message:'Owned console closed.'};return active;}};
  });
  await host(page);await page.goto('/');const provider=await openAccounts(page),row=provider.locator(`[data-account-id="${work}"]`);
  await row.getByRole('button',{name:'Connect Work',exact:true}).click();await expect(row).toContainText('Complete native sign-in.');await expect(row.getByRole('button',{name:'Cancel sign-in',exact:true})).toBeVisible();
  await row.getByRole('button',{name:'Cancel sign-in',exact:true}).click();await expect(row).toContainText('Owned console closed.');await expect(row.getByRole('button',{name:'Retry sign-in',exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>(window as any).__cancelled)).toEqual(['flow-1']);await row.getByRole('button',{name:'Retry sign-in',exact:true}).click();await expect(row.getByRole('button',{name:'Cancel sign-in',exact:true})).toBeVisible();
});

test('local signout names its scope and preserves account metadata',async({page})=>{
  await host(page);let target:any;
  await page.route('**/api/account-auth/signout',async route=>{target=route.request().postDataJSON();await route.fulfill({json:{...target,state:'signed-out',identity:{availability:'unavailable',subject:null,email:null,organization:null,subscription:null},lastCheckedAt:now,localSignout:true,message:'Local credentials removed. Remote sessions and provider grants were not revoked.'}});});
  await page.goto('/');const provider=await openAccounts(page),row=provider.locator(`[data-account-id="${work}"]`);await row.getByRole('button',{name:'Sign out locally',exact:true}).click();
  await expect(row).toContainText('Remote sessions and provider grants were not revoked.');expect(target).toEqual({providerId:'openai',accountId:work});await expect(row.getByRole('button',{name:'Rename Work',exact:true})).toBeVisible();
});
