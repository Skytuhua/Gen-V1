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
    await base.publish();
  });
  await page.route('**/api/models*', async route => { const url = new URL(route.request().url()); discoveries.push(url.search); const thread = snapshot.threads.find(item => item.id === url.searchParams.get('threadId')); const id = thread?.accountId ?? snapshot.settings.selectedAccounts?.openai; await route.fulfill({ json: { models: [model(id === work ? 'Work model' : 'Personal model')] } }); });
  await page.route('**/api/account-auth?*', route => { const query = new URL(route.request().url()).searchParams; return route.fulfill({json:{providerId:query.get('providerId'),accountId:query.get('accountId')||null,state:'configured',identity:{availability:'unavailable',subject:null,email:null,organization:null,subscription:null},lastCheckedAt:now,localSignout:!['claude-code','gemini-cli'].includes(query.get('providerId')!),message:'A credential is configured; authenticated identity is unavailable.'}}); });
  await page.route('**/api/composer-prediction/cancel', route=>route.fulfill({json:{cancelled:true}}));
  return { ...base, commands, discoveries, failNext(message: string) { fail = message; }, holdNext() { return new Promise<void>(resolve => { pending = resolve; }); }, release() { pending?.(); } };
}
async function openAccounts(page: Page) { await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.getByRole('button', { name: 'Models & Accounts', exact: true }).click(); return page.locator('.connection-row[data-provider="openai"]'); }
async function expectCatalog(page: Page, modelName: string) {
  await page.getByRole('combobox', { name: 'Model', exact: true }).click();
  await expect(page.getByRole('listbox', { name: 'Available models', exact: true }).getByRole('option', { name: modelName, exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search models', exact: true }).press('Escape');
}

test('opening provider settings checks only the selected account detail',async({page})=>{
  await host(page);const checks:string[]=[];
  page.on('request',request=>{if(request.url().includes('/api/account-auth?'))checks.push(new URL(request.url()).search);});
  await page.goto('/');await openAccounts(page);
  await expect.poll(()=>checks.length).toBe(1);
  expect(new URLSearchParams(checks[0]).get('accountId')).toBe(personal);
  await page.getByRole('radio',{name:'Work',exact:true}).check();
  await expect.poll(()=>checks.length).toBe(2);
  expect(new URLSearchParams(checks[1]).get('accountId')).toBe(work);
});

test('an owned flow completes while Settings is closed and refreshes its bound catalog once',async({page})=>{
  await page.addInitScript(()=>{
    const w=window as any;w.__signIns=[];w.__flow=null;w.__flowPolls=0;
    w.harnessDesktop={getContext:async()=>({windowId:'main',surface:{kind:'main'},windows:[]}),ready:async()=>({}),onState:()=>()=>{},onCloseRequested:()=>()=>{},list:async()=>[],browser:async()=>({}),
      activeSignIn:async()=>w.__flow?.state==='waiting'?w.__flow:null,
      signIn:async(providerId:string,accountId:string)=>{w.__signIns.push([providerId,accountId]);return w.__flow={id:'flow-hidden',providerId,accountId,state:'waiting',startedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),message:'Complete native sign-in.'};},
      signInStatus:async()=>{w.__flowPolls++;return w.__flow;},
      cancelSignIn:async()=>w.__flow={...w.__flow,state:'cancelled',message:'Cancelled.'},
    };
  });
  const h=await host(page);let authReads=0;page.on('request',request=>{if(request.url().includes('/api/account-auth?'))authReads++;});await page.goto('/');const provider=await openAccounts(page);
  await expect(provider.locator('.connection-account-auth')).toHaveAttribute('aria-busy','false');const beforeAuth=authReads;
  await provider.getByRole('button',{name:'Connect Personal',exact:true}).click();
  await expect(provider.getByRole('button',{name:'Cancel sign-in',exact:true})).toBeVisible();
  await page.waitForFunction(()=>(window as any).__flowPolls>0);expect(authReads).toBe(beforeAuth);
  await page.getByRole('dialog',{name:'Settings',exact:true}).press('Escape');
  await expect(page.getByRole('dialog',{name:'Settings',exact:true})).not.toBeVisible();
  const before=h.discoveries.length;
  await page.evaluate(()=>{const w=window as any;w.__flow={...w.__flow,state:'completed',message:'Console completed.'};});
  await expect.poll(()=>h.discoveries.length).toBe(before+1);
  expect(new URLSearchParams(h.discoveries.at(-1)).get('threadId')).toBe('task-thread');
  expect(new URLSearchParams(h.discoveries.at(-1)).get('providerId')).toBe('openai');
  expect(new URLSearchParams(h.discoveries.at(-1)).get('accountId')).toBe(personal);
  expect(await page.evaluate(()=>(window as any).__signIns)).toEqual([['openai',personal]]);
});

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
  await expect(provider).not.toContainText('Existing tasks keep this account');
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
  await page.goto('/'); await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toHaveText('Personal only',{timeout:15000});
  const provider = await openAccounts(page); await provider.getByRole('button', { name: 'Remove Personal', exact: true }).click();
  await expect(provider).toContainText('Default for new tasks: Legacy connection');
  const defaultModel = page.getByRole('combobox', { name: 'Default model', exact: true });
  await expect(defaultModel).not.toContainText('Personal only');
  await defaultModel.click();
  await expect(page.getByRole('option', { name: 'Legacy only', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
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
  await page.getByRole('searchbox', { name: 'Search models', exact: true }).press('Escape');
  await openAccounts(page);
  // The explicit composer choice persists as the new-task default, so assert the
  // refreshed catalog through its options rather than the trigger label.
  const defaultModel = page.getByRole('combobox', { name: 'Default model', exact: true });
  await defaultModel.click();
  await expect(page.getByRole('listbox', { name: 'Default model', exact: true }).getByRole('option', { name: 'Personal model', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  const pinnedReads = requests.filter(query => query.includes('threadId=task-thread')).length;
  snapshot.settings.selectedAccounts = { openai: work }; await h.publish();
  await defaultModel.click();
  const catalogOptions = page.getByRole('listbox', { name: 'Default model', exact: true });
  await expect(catalogOptions.getByRole('option', { name: 'Work model', exact: true })).toBeVisible();
  await expect(catalogOptions.getByRole('option', { name: 'Personal model', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  const catalogReads = requests.length; snapshot.settings.selectedAccounts = { openai: work }; snapshot.settings.theme = 'light'; await h.publish();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light'); expect(requests).toHaveLength(catalogReads);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
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
  await expect(page.getByRole('status').filter({ hasText: 'A task is using this account' })).toBeVisible();
  await expect(provider.getByRole('radio', { name: 'Work', exact: true })).toBeEnabled();
});

test('Settings search and section navigation retain the unsaved account choice',async({page})=>{
  const h=await host(page);await page.goto('/');const provider=await openAccounts(page),owner=await provider.elementHandle();
  await provider.getByRole('radio',{name:'Work',exact:true}).check();
  const dialog=page.getByRole('dialog',{name:'Settings',exact:true});await dialog.getByRole('searchbox',{name:'Search all settings',exact:true}).fill('ChatGPT');
  await dialog.getByRole('button',{name:/^ChatGPT \/ Codex Models & accounts/}).click();
  await expect(provider.getByRole('radio',{name:'Work',exact:true})).toBeChecked();expect(await owner!.evaluate(node=>node.isConnected)).toBe(true);
  await dialog.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:'General',exact:true}).click();
  await dialog.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:'Models & Accounts',exact:true}).click();
  await expect(provider.getByRole('radio',{name:'Work',exact:true})).toBeChecked();expect(h.snapshot.settings.selectedAccounts?.openai).toBe(personal);expect(h.commands).toHaveLength(0);
});

test('Settings search retains the pending account write and its hidden failure for retry',async({page})=>{
  const h=await host(page),attempts:HostCommand[]=[];let release!:()=>void,started!:()=>void,failed!:()=>void,fail=true;
  const pending=new Promise<void>(resolve=>{release=resolve;}),seen=new Promise<void>(resolve=>{started=resolve;}),rejected=new Promise<void>(resolve=>{failed=resolve;});
  await page.route('**/api/commands',async route=>{
    const request=route.request().postDataJSON() as HostCommand;if(request.type!=='account.select')return route.fallback();attempts.push(request);
    if(!fail)return route.fallback();fail=false;started();await pending;await route.fulfill({status:409,json:{error:{code:'ACCOUNT_BUSY',message:'Synthetic held account update failed.'}}});failed();
  });
  try{
    await page.goto('/');const provider=await openAccounts(page);await provider.getByRole('radio',{name:'Work',exact:true}).check();await provider.getByRole('button',{name:'Use account',exact:true}).click();await seen;
    const dialog=page.getByRole('dialog',{name:'Settings',exact:true}),search=dialog.getByRole('searchbox',{name:'Search all settings',exact:true});
    await search.fill('ChatGPT');await dialog.getByRole('button',{name:/^ChatGPT \/ Codex Models & accounts/}).click();
    await expect(provider.getByRole('radio',{name:'Work',exact:true})).toBeChecked();await expect(provider.getByRole('radio',{name:'Personal',exact:true})).toBeDisabled();
    const saving=provider.getByRole('button',{name:'Saving default…',exact:true});await expect(saving).toBeDisabled();await saving.dispatchEvent('click');expect(attempts).toHaveLength(1);
    await search.fill('ChatGPT');release();await rejected;await dialog.getByRole('button',{name:/^ChatGPT \/ Codex Models & accounts/}).click();
    const error=dialog.getByRole('status').filter({hasText:'Synthetic held account update failed.'});await expect(error).toBeVisible();await expect(provider.getByRole('radio',{name:'Work',exact:true})).toBeChecked();
    await provider.getByRole('button',{name:'Use account',exact:true}).click();await expect(provider.locator(`[data-account-id="${work}"]`).getByText('Default',{exact:true})).toBeVisible();await expect(error).toHaveCount(0);
    expect(attempts).toHaveLength(2);expect(attempts.every(request=>request.payload.accountId===work)).toBe(true);expect(h.commands.filter(request=>request.type==='account.select')).toHaveLength(1);
  }finally{release();}
});

test('an account radio is a pending choice until the new-task default is saved', async ({ page }) => {
  const h = await host(page); await page.goto('/'); const provider = await openAccounts(page);
  const personalRow = provider.locator(`[data-account-id="${personal}"]`), workRow = provider.locator(`[data-account-id="${work}"]`);
  await expect(personalRow.getByText('Default', { exact: true })).toBeVisible();
  await provider.getByRole('radio', { name: 'Work', exact: true }).check();
  await expect(provider.getByRole('status').filter({hasText:'Work is selected.'})).toContainText('Work is selected. Use account to make it the default for new tasks.');
  await expect(personalRow.getByText('Default', { exact: true })).toBeVisible();
  expect(h.commands).toHaveLength(0);
  const held = h.holdNext(); await provider.getByRole('button', { name: 'Use account', exact: true }).click(); await held;
  await expect(provider.getByRole('button', { name: 'Saving default…', exact: true })).toBeDisabled();
  await expect(provider.locator('.connection-accounts')).toHaveAttribute('aria-busy', 'true'); h.release();
  await expect(workRow.getByText('Default', { exact: true })).toBeVisible();
  await expect(personalRow.getByText('Default', { exact: true })).toHaveCount(0);
  await expect(provider.getByRole('status').filter({hasText:'Work is the default for new tasks.'})).toContainText('Work is the default for new tasks.');
});

test('bound thread catalogs follow their pinned account and ignore late discovery from another thread', async ({ page }) => {
  const h = await host(page); const releases:(()=>void)[]=[];let requests=0,lateDone=0;
  await page.route('**/api/models*', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('threadId') === 'work-thread') {
      requests++; await new Promise<void>(resolve => { releases.push(resolve); });
      await route.fulfill({ json: { models: [model('Work model', 'openai/work-only')] } }); lateDone++; return;
    }
    return route.fallback();
  });
  await page.goto('/'); await expect(page.locator('.composer-account')).toHaveText('Personal');
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toContainText('Personal model');
  await page.getByRole('button', { name: 'Work task Ready', exact: true }).click(); await expect.poll(() => requests).toBeGreaterThan(0);
  await expect(page.locator('.composer-account:visible')).toHaveText('Work');
  await page.getByRole('button', { name: 'Personal task Ready', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toContainText('Personal model'); for(const release of releases)release();
  await expect.poll(() => h.discoveries.filter(q => q.includes('task-thread')).length).toBeGreaterThan(1);
  await expect.poll(() => lateDone).toBe(requests);
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).not.toContainText('Work model');
  const provider = await openAccounts(page); await provider.getByRole('radio', { name: 'Work', exact: true }).check(); await provider.getByRole('button', { name: 'Use account', exact: true }).click();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click(); await expect(page.locator('.composer-account:visible')).toHaveText('Personal');
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
  await page.goto('/'); await expect(page.locator('.composer-account')).toHaveCount(0);
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
  await page.getByRole('dialog',{name:'Settings',exact:true}).getByRole('button',{name:/^ChatGPT \/ Codex Models & accounts/}).click();
  await expect(provider).toBeVisible();
  const settings=page.getByRole('dialog',{name:'Settings',exact:true}),header=settings.locator(':scope>.ui-modal-header');
  const frame=(await settings.boundingBox())!,title=(await header.boundingBox())!;expect(title.y).toBeGreaterThanOrEqual(frame.y);
  const mark=provider.locator('.connection-auth-summary strong');await expect(mark).toHaveText('Saved, not verified');await expect(provider).toHaveCSS('outline-style','none');
  const treatment=await mark.evaluate(node=>({background:getComputedStyle(node).backgroundColor,dotWidth:getComputedStyle(node,'::before').width,dotHeight:getComputedStyle(node,'::before').height}));
  expect(treatment).toEqual({background:'rgba(0, 0, 0, 0)',dotWidth:'6px',dotHeight:'6px'});
  expect(await provider.locator('.connection-account-badge').evaluate(node=>getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  for (const theme of ['dark', 'light'] as const) { snapshot.settings.theme = theme; await h.publish(); await expect(page.locator('html')).toHaveAttribute('data-theme', theme); await page.getByRole('dialog', { name: 'Settings', exact: true }).screenshot({ path: testInfo.outputPath(`accounts-${theme}.png`) }); }
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect.poll(() => provider.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.screenshot({ path: testInfo.outputPath('accounts-narrow.png') });
});

test('browser connection commands include the opaque account id and labels stay out of commands', async ({ page }) => {
  await host(page); await page.goto('/'); const provider = await openAccounts(page);
  await provider.getByRole('radio',{name:'Work',exact:true}).check();
  await provider.getByText('Connect from a terminal',{exact:true}).click();
  await expect(provider.locator('.connection-account-auth code')).toHaveText(`pnpm agent:login --provider openai --account-id ${work}`);
  await expect(provider.locator('.connection-account-auth code')).not.toContainText('Work');
});

test('desktop sign-in targets the chosen provider and account only on an explicit connect click', async ({ page }) => {
  await page.addInitScript(() => { const w = window as any; w.__signIns = []; w.harnessDesktop = { getContext: async () => ({ windowId: 'main', surface: { kind: 'main' }, windows: [] }), ready: async () => ({}), onState: () => () => {}, onCloseRequested: () => () => {}, list: async () => [], signIn: async (...args: unknown[]) => { w.__signIns.push(args); }, browser: async () => ({}) }; });
  await host(page); await page.goto('/'); const provider = await openAccounts(page);
  await provider.getByRole('radio', { name: 'Work', exact: true }).check(); await provider.getByRole('button', { name: 'Use account', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__signIns)).toEqual([]);
  await provider.getByRole('button', { name: 'Connect Work', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__signIns)).toEqual([['openai', work]]);
});

test('shows per-account readiness without turning model counts or local labels into authenticated identity',async({page})=>{
  await host(page);
  await page.route(`**/api/account-auth?providerId=openai&accountId=${work}`,route=>route.fulfill({json:{providerId:'openai',accountId:work,state:'signed-out',identity:{availability:'unavailable',subject:null,email:null,organization:null,subscription:null},lastCheckedAt:now,localSignout:true,message:'No credential configured.'}}));
  await page.goto('/');const provider=await openAccounts(page),detail=provider.locator('.connection-account-auth');
  await expect(detail).toContainText('Saved, not verified');await expect(detail).not.toContainText('Authenticated identity unavailable.');await expect(detail).not.toContainText('Last checked');
  await expect(detail.getByRole('button',{name:'Sign out locally',exact:true})).toBeEnabled();
  await provider.getByRole('radio',{name:'Work',exact:true}).check();await expect(detail).toContainText('Not signed in');
  await expect(provider.locator('header').first()).not.toContainText('models available');await expect(provider).not.toContainText('Verified provider user');
  await expect(detail.getByRole('button',{name:'Sign out locally',exact:true})).toBeDisabled();
});

test('desktop owned sign-in exposes completion, cancellation and retry on its account row',async({page})=>{
  await page.addInitScript(()=>{
    const w=window as any;let active:any=null,count=0;w.__cancelled=[];
    w.harnessDesktop={getContext:async()=>({windowId:'main',surface:{kind:'main'},windows:[]}),ready:async()=>({}),onState:()=>()=>{},onCloseRequested:()=>()=>{},list:async()=>[],browser:async()=>({}),
      signIn:async(providerId:string,accountId:string)=>active={id:`flow-${++count}`,providerId,accountId,state:'waiting',startedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),message:'Complete native sign-in.'},
      signInStatus:async(id:string)=>active?.id===id?active:null,
      activeSignIn:async()=>active&&['waiting','opening','cancelling','blocked'].includes(active.state)?active:null,
      cancelSignIn:async(id:string)=>{w.__cancelled.push(id);active={...active,state:'cancelled',updatedAt:new Date().toISOString(),message:'Owned console closed.'};return active;}};
  });
  await host(page);await page.goto('/');let provider=await openAccounts(page);await provider.getByRole('radio',{name:'Work',exact:true}).check();let row=provider.locator('.connection-account-auth');
  await row.getByRole('button',{name:'Connect Work',exact:true}).click();await expect(row).toContainText('Complete native sign-in.');await expect(row.getByRole('button',{name:'Cancel sign-in',exact:true})).toBeVisible();
  await page.getByRole('dialog',{name:'Settings',exact:true}).press('Escape');provider=await openAccounts(page);await provider.getByRole('radio',{name:'Work',exact:true}).check();row=provider.locator('.connection-account-auth');
  await expect(row.getByRole('button',{name:'Cancel sign-in',exact:true})).toBeVisible();
  await row.getByRole('button',{name:'Cancel sign-in',exact:true}).click();await expect(row).toContainText('Owned console closed.');await expect(row.getByRole('button',{name:'Retry sign-in',exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>(window as any).__cancelled)).toEqual(['flow-1']);await row.getByRole('button',{name:'Retry sign-in',exact:true}).click();await expect(row.getByRole('button',{name:'Cancel sign-in',exact:true})).toBeVisible();
});

test('local signout names its scope and preserves account metadata',async({page})=>{
  await host(page);let target:any;
  await page.route('**/api/account-auth/signout',async route=>{target=route.request().postDataJSON();await route.fulfill({json:{...target,state:'signed-out',identity:{availability:'unavailable',subject:null,email:null,organization:null,subscription:null},lastCheckedAt:now,localSignout:true,message:'Local credentials removed. Remote sessions and provider grants were not revoked.'}});});
  await page.goto('/');const provider=await openAccounts(page);await provider.getByRole('radio',{name:'Work',exact:true}).check();const detail=provider.locator('.connection-account-auth');await detail.getByRole('button',{name:'Sign out locally',exact:true}).click();
  await expect(detail).toHaveAttribute('data-state','signed-out');await expect(detail.getByRole('button',{name:'Sign out locally',exact:true})).toBeDisabled();expect(target).toEqual({providerId:'openai',accountId:work});await expect(provider.getByRole('button',{name:'Rename Work',exact:true})).toBeVisible();
});

for(const lateError of [false,true])test(`switching account cancels readiness and ignores late ${lateError?'failure':'identity'}`,async({page})=>{
  await host(page);let release!:()=>void,started=false,finished=false,aborted=false;
  page.on('requestfailed',request=>{if(new URL(request.url()).searchParams.get('accountId')===personal)aborted=true;});
  await page.route(`**/api/account-auth?providerId=openai&accountId=${personal}`,async route=>{
    started=true;await new Promise<void>(resolve=>{release=resolve;});
    try{await route.fulfill(lateError?{status:500,json:{error:{message:'Late Personal failure'}}}:{json:{providerId:'openai',accountId:personal,state:'authenticated',identity:{availability:'verified',subject:'late-personal-subject',email:'late-personal@example.invalid',organization:null,subscription:null},lastCheckedAt:now,localSignout:true,message:'Late Personal identity'}});}catch{}finally{finished=true;}
  });
  await page.goto('/');const provider=await openAccounts(page);await expect.poll(()=>started).toBe(true);
  await provider.getByRole('radio',{name:'Work',exact:true}).check();
  const detail=provider.locator('.connection-account-auth');await expect(detail).toContainText('Saved, not verified');
  release();await expect.poll(()=>finished).toBe(true);await expect.poll(()=>aborted).toBe(true);
  await expect(detail).not.toContainText(/late-personal|Late Personal|Connection status is unavailable/);
  await expect(provider.getByRole('radio',{name:'Work',exact:true})).toBeChecked();
});

test('signing out a non-default account preserves unrelated pinned and default catalogs',async({page})=>{
  const h=await host(page);
  await page.route('**/api/account-auth/signout',route=>route.fulfill({json:{providerId:'openai',accountId:work,state:'signed-out',identity:{availability:'unavailable',subject:null,email:null,organization:null,subscription:null},lastCheckedAt:now,localSignout:true,message:'Local Work credentials removed.'}}));
  await page.goto('/');const provider=await openAccounts(page);await provider.getByRole('radio',{name:'Work',exact:true}).check();
  const detail=provider.locator('.connection-account-auth');await expect(detail).toHaveAttribute('aria-busy','false');
  const reads=h.discoveries.length;await detail.getByRole('button',{name:'Sign out locally',exact:true}).click();
  await expect(detail).toHaveAttribute('data-state','signed-out');await expect(detail).toHaveAttribute('aria-busy','false');
  expect(h.discoveries).toHaveLength(reads);await expect(page.getByRole('combobox',{name:'Default model',exact:true})).toContainText('Personal model');
});

for(const failedRefresh of [false,true])test(`auth invalidation reaches the saved retained-canvas conversation catalog (failure=${failedRefresh})`,async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('harness:workspace-mode:v3','retained-canvas'));
  await host(page);let signedOut=false;
  await page.route('**/api/models*',route=>signedOut&&failedRefresh?route.fulfill({status:500,json:{error:{message:'Targeted catalog unavailable'}}}):route.fulfill({json:{models:[model(signedOut?'Refreshed Personal model':'Personal model')]}}));
  await page.route('**/api/account-auth/signout',route=>{signedOut=true;return route.fulfill({json:{providerId:'openai',accountId:personal,state:'signed-out',identity:{availability:'unavailable',subject:null,email:null,organization:null,subscription:null},lastCheckedAt:now,localSignout:true,message:'Local credentials removed.'}});});
  await page.route('**/api/workspace',route=>route.fulfill({json:{projects:[],state:{version:1,revision:0,activeCanvasId:'saved-canvas',canvases:[{version:1,id:'saved-canvas',name:'Saved canvas',preset:'custom',viewport:{x:0,y:0,zoom:1},panels:[{id:'saved-thread',kind:'thread',binding:{authority:{kind:'local'},threadId:'task-thread'},canvasId:'saved-canvas',placement:'canvas',visible:true,collapsed:false,bounds:{x:0,y:0,width:600,height:560},order:0,alwaysOnTop:false}],filter:'active',projectIds:[]}],profiles:[],disabledKinds:[],integrations:{}}}}));
  await page.goto('/');await expect(page.getByRole('combobox',{name:'Model',exact:true})).toContainText('Personal model',{timeout:15000});
  const provider=await openAccounts(page);await provider.getByRole('button',{name:'Sign out locally',exact:true}).click();await expect(provider.locator('.connection-account-auth')).toHaveAttribute('data-state','signed-out');
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Model',exact:true})).toContainText(failedRefresh?'openai/shared':'Refreshed Personal model');
  if(failedRefresh)await expect(page.getByRole('button',{name:'Send message',exact:true})).toBeDisabled();
});

test('auth refresh retains an unavailable explicit model and unsent draft until a new selection',async({page})=>{
  const snapshot=fixture();snapshot.threads=[];snapshot.activeThreadId=null;
  await host(page,snapshot);let signedOut=false;
  const otherModel={id:'cursor-sdk/other',provider:'cursor-sdk',name:'Other provider model'};
  await page.route('**/api/models*',route=>route.fulfill({json:{models:new URL(route.request().url()).searchParams.has('providerId')?(signedOut?[]:[model('Personal model')]):[...(signedOut?[]:[model('Personal model')]),otherModel]}}));
  await page.route('**/api/account-auth/signout',route=>{signedOut=true;return route.fulfill({json:{providerId:'openai',accountId:personal,state:'signed-out',identity:{availability:'unavailable',subject:null,email:null,organization:null,subscription:null},lastCheckedAt:now,localSignout:true,message:'Local Personal credentials removed.'}});});
  await page.goto('/');const picker=page.getByRole('combobox',{name:'Model',exact:true});await expect(picker).toContainText('Personal model',{timeout:15000});
  await picker.click();await page.getByRole('option',{name:'Personal model',exact:true}).click();await page.keyboard.press('Escape');
  const draft=page.getByRole('textbox',{name:'Message',exact:true});await draft.fill('Keep this unsent draft and my explicit model.');
  const provider=await openAccounts(page);await provider.getByRole('button',{name:'Sign out locally',exact:true}).click();await expect(provider.locator('.connection-account-auth')).toHaveAttribute('aria-busy','false');
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await expect(picker).toContainText('openai/shared');await expect(picker).not.toContainText('Other provider model');
  await expect(draft).toHaveValue('Keep this unsent draft and my explicit model.');await expect(page.getByRole('button',{name:'Send message',exact:true})).toBeDisabled();
  await picker.click();await page.getByRole('option',{name:'Other provider model',exact:true}).click();await page.keyboard.press('Escape');
  await expect(picker).toContainText('Other provider model');await expect(draft).toHaveValue('Keep this unsent draft and my explicit model.');
});


test('terminal-owned sign-in shows progress and blocks conflicting account actions',async({page})=>{
  await page.addInitScript(()=>{const context={windowId:'main',surface:{kind:'main'},windows:[]};(window as any).harnessDesktop={getContext:async()=>context,ready:async()=>context,onState:()=>()=>{},onCloseRequested:()=>()=>{},list:async()=>[],signIn:async()=>{throw Error('Unexpected sign-in');},browser:async()=>({})};});
  await host(page);
  await page.route('**/api/account-auth?*',route=>{const query=new URL(route.request().url()).searchParams;return route.fulfill({json:{providerId:query.get('providerId'),accountId:query.get('accountId'),state:'signing-in',identity:{availability:'unavailable',subject:null,email:null,organization:null,subscription:null},lastCheckedAt:now,localSignout:true,message:'A terminal sign-in is already active.'}});});
  await page.goto('/');const provider=await openAccounts(page),detail=provider.locator('.connection-account-auth');
  await expect(detail).toHaveAttribute('data-state','signing-in');await expect(detail.locator('.connection-auth-summary strong')).toHaveText('Sign-in in progress');
  await expect(detail.getByRole('button',{name:'Connect Personal',exact:true})).toBeDisabled();await expect(detail.getByRole('button',{name:'Sign out locally',exact:true})).toBeDisabled();
});
