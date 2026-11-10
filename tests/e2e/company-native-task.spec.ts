import {expect, test, type BrowserContext, type Page, type Route} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {companyCspTestHost} from './company-production-csp-host';
import type {DesktopContext, DesktopSurface, DesktopWindowInfo} from '../../packages/desktop-contract';
import type {ApprovedJobRead} from '../../packages/company-contracts/approved-job-read';
import type {WorkPlanReadResponse} from '../../packages/company-contracts/work-plan';

// Two browser pages model bridge calls only. Personal owns actual Electron proof.
const sample = JSON.parse(readFileSync('packages/company-contracts/owner-work-plan-candidate.1/examples.json', 'utf8')).cases[3];
const result = sample.response as WorkPlanReadResponse, auth = result.authorization!.authorization;
const binding: ApprovedJobRead = {companyId: 'leo-company', projectId: 'alpha', instructionId: sample.request.instruction_id, planRef: sample.request.plan_ref,
  workOrderId: auth.work_order.id, authorizationDigest: auth.digest, authorizationExpiresAt: auth.expires_at_epoch_seconds};
const surface: DesktopSurface = {kind: 'company-task', companyId: 'leo-company', projectId: 'alpha', resourceId: binding.workOrderId};
let host: Awaited<ReturnType<typeof companyCspTestHost>>;
test.beforeAll(async () => {host = await companyCspTestHost();});
test.afterAll(async () => {await host.close();});

async function fixture(context: BrowserContext, beforeTask?: (page: Page) => Promise<void>) {
  const windows = new Map<Page, DesktopWindowInfo>(), calls: string[] = [];
  let nextWindow = 0;
  let child: Page | undefined, requestRead: ((route: Route) => Promise<void>) | undefined;
  const projects = ['alpha', 'beta'].map(id => ({id, name: `Synthetic ${id}`, state: 'draft', scheduler_paused: false, task_counts: {}, occupied_synthetic_slots: 0}));
  const observation = {status: 'unavailable', observed_at: null, expires_at: null, evidence_scope: 'unavailable'};
  const data = {evidence_scope: 'synthetic_only', live_ready: false, company_accepted: false, planning_mode: 'planning_only', native_chat_planner: 'capability_missing',
    targets: {employees: 32, departments: 16, hermes: 18, codex: 14}, actual_live: {employees: 0, hermes: 0, codex: 0}, projects, employees: [], blockers: [], auth: observation, budget: observation,
    runtime_requirements: {source: 'synthetic', hermes: {mode: 'native', repository: null, commit: null, compatibility_evidence: null, image_digest: null}, codex: {mode: 'native', package: null, version: null, external_auth_candidate_status: null, image_digest: null}},
    configured_requirements_digest: 'b'.repeat(64), configured_company_digest: 'c'.repeat(64), native_limits: {task_timeout_seconds: 600, hermes_iteration_cap: 100, codex_turn_cap: null, max_child_processes_per_attempt: 1, effective_limits: null}};
  await context.route(url => url.origin === host.origin && url.pathname === '/company', async route => route.fulfill({response: await route.fetch({url: host.origin + '/company/communications'})}));
  await context.route('**/api/**', async route => {
    const request = route.request(), pathname = new URL(request.url()).pathname;
    calls.push(pathname);
    if (pathname === '/api/bootstrap') return route.fulfill({json: {csrfToken: 'PUBLIC-native-task-fixture'}});
    if (pathname === '/api/company/connection') return route.fulfill({json: {configured: true, ownerAuthenticated: true, protocol: 'company-service.v1-draft1', mode: 'read_only', capabilities: {status: true}, blockers: []}});
    if (pathname === '/api/company/status') {const project = projects.find(item => item.id === request.postDataJSON().scope.id); return route.fulfill({json: {data: {...data, ...(project ? {projects: [project], project} : {})}, receivedAt: '2026-11-04T08:00:00Z', source: 'company_service', protocol: 'company-service.v1-draft1'}});}
    if (pathname === '/api/company/workflow') return route.fulfill({json: {protocol: 'company-service.v1-draft1', mode: 'planning_only', recordInstruction: false, authorize: false, progress: false, result: false, blockers: [], workPlans: {configured: true, readOnly: true}, approvedJob: binding}});
    if (pathname === '/api/company/manager/availability') return route.fulfill({json: {configured: false, mode: 'shadow_proposals', admission: 'checked_per_request', dispatchAuthorized: false, durableCompanyStorage: false, blockers: []}});
    if (pathname === '/api/company/workflow/work-plan/read') {expect(request.postDataJSON()).toEqual(sample.request); return requestRead ? requestRead(route) : route.fulfill({json: result});}
    return route.fulfill({status: 403, json: {error: {code: 'UNAVAILABLE', message: 'Unavailable in this synthetic UI fixture'}}});
  });
  function desktop(page: Page): DesktopContext {const record = windows.get(page)!; return {windowId: record.id, surface: record.surface, windows: [...windows.values()]};}
  async function broadcast(focusSurface?: DesktopSurface) {
    for (const page of windows.keys()) if (!page.isClosed()) await page.evaluate(state => (window as unknown as {taskNativeState: (state: unknown) => void}).taskNativeState(state), {windows: [...windows.values()], ...(focusSurface ? {focusSurface} : {})});
  }
  async function add(kind: DesktopSurface) {
    const page = await context.newPage(), id = `window-${++nextWindow}`;
    windows.set(page, {id, surface: kind, ready: false, minimized: false});
    page.once('close', () => windows.delete(page));
    let ready!: () => void; const recovered = new Promise<void>(done => {ready = done;});
    await page.exposeFunction('taskNativeCall', async (operation: string, input?: DesktopSurface) => {
      if (operation === 'context') return desktop(page);
      if (operation === 'ready') {calls.push('native:ready:' + kind.kind); windows.get(page)!.ready = true; ready(); await broadcast(); return desktop(page);}
      if (operation === 'detach') {
        calls.push('native:detach'); expect(input).toEqual(surface);
        if (!await page.evaluate(() => (window as unknown as {taskNativeClose: () => Promise<boolean>}).taskNativeClose())) throw Error('Save failed');
        const opened = await add(input!); child = opened.page; await opened.recovered; return windows.get(child)!;
      }
      if (operation === 'reattach') {
        calls.push('native:reattach');
        if (!await page.evaluate(() => (window as unknown as {taskNativeClose: () => Promise<boolean>}).taskNativeClose())) throw Error('Save failed');
        const record = windows.get(page)!; windows.delete(page); await broadcast(record.surface); return;
      }
      if (operation === 'focus') return;
      throw Error('Unsupported desktop fixture call');
    });
    await page.addInitScript(() => {
      const listeners = new Set<(state: never) => void>(); let close = async () => true;
      const call = (operation: string, input?: unknown) => (window as unknown as {taskNativeCall: (operation: string, input?: unknown) => Promise<never>}).taskNativeCall(operation, input);
      Object.assign(window, {taskNativeState: (state: never) => listeners.forEach(listener => listener(state)), taskNativeClose: () => close(),
        harnessDesktop: {getContext: () => call('context'), ready: () => call('ready'), detach: (value: unknown) => call('detach', value), reattach: () => call('reattach'), focus: () => call('focus'),
          onState: (listener: (state: never) => void) => {listeners.add(listener); return () => listeners.delete(listener);},
          onCloseRequested: (handler: () => Promise<boolean>) => {close = handler; return () => {close = async () => true;};}}});
    });
    if (kind.kind === 'company-task') await beforeTask?.(page);
    const response = await page.goto(host.origin + '/company?desktopWindow=' + id);
    expect(response?.headers()['content-security-policy']).toBe(host.csp);
    return {page, recovered};
  }
  const main = await add({kind: 'main'}); await main.recovered;
  await main.page.getByRole('combobox', {name: 'Project scope'}).selectOption('alpha');
  return {main: main.page, child: () => child!, calls, add, onRead: (handler: typeof requestRead) => {requestRead = handler;}};
}

test('one approved task moves through the bridge, shares its cache and returns to its exact project', async ({context}) => {
  const f = await fixture(context), main = f.main;
  await main.getByRole('textbox', {name: 'Message to company manager', exact: true}).fill('Keep this main draft while the task moves.');
  await main.getByRole('button', {name: 'Task & plan', exact: true}).click();
  await main.getByRole('button', {name: 'Detach task into separate window'}).click();
  await expect(main.getByRole('button', {name: 'Focus task window'})).toBeVisible();
  const child = f.child(); await expect(child.getByRole('main', {name: 'Detached company task'})).toBeVisible();
  await expect(main.getByRole('button', {name: 'Load approved job', exact: true})).toHaveCount(0);
  await child.getByRole('button', {name: 'Load approved job', exact: true}).click();
  await expect(child.getByText(result.plan.plan.summary, {exact: true})).toBeVisible();
  await main.getByRole('combobox', {name: 'Project scope'}).selectOption('beta');
  await expect(main.getByText(result.plan.plan.summary, {exact: true})).toHaveCount(0);
  await child.getByRole('button', {name: 'Dock in main window'}).click();
  await expect(main.getByRole('combobox', {name: 'Project scope'})).toHaveValue('alpha');
  await expect(main.getByText(result.plan.plan.summary, {exact: true})).toBeVisible();
  await expect(main.getByText('Saved read · current eligibility has not been refreshed.', {exact: true})).toBeVisible();
  await expect(main.getByRole('textbox', {name: 'Message to company manager', exact: true})).toHaveValue('Keep this main draft while the task moves.');
  await expect(main.getByRole('button', {name: 'Send message', exact: true})).toBeDisabled();
  expect(f.calls.filter(path => path.endsWith('/work-plan/read'))).toHaveLength(1);
  expect(f.calls.some(path => /\/(propose|authorize|materialize|instruction)$/.test(path))).toBe(false);
});

test('a pending task read blocks native handoff without losing its eventual cached result', async ({context}) => {
  const f = await fixture(context); let release!: () => void;
  f.onRead(async route => {await new Promise<void>(done => {release = done;}); await route.fulfill({json: result});});
  await f.main.getByRole('button', {name: 'Task & plan', exact: true}).click();
  await f.main.getByRole('button', {name: 'Load approved job', exact: true}).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await f.main.getByRole('button', {name: 'Detach task into separate window'}).click();
  await expect(f.main.getByRole('alert')).toContainText('The task could not move yet');
  expect(f.calls).not.toContain('native:detach');
  release(); await expect(f.main.getByText(result.plan.plan.summary, {exact: true})).toBeVisible();
  await f.main.getByRole('button', {name: 'Detach task into separate window'}).click();
  await expect(f.main.getByRole('button', {name: 'Focus task window'})).toBeVisible();
});

test('a foreign native context cannot display the configured approved task or announce readiness', async ({context}) => {
  const f = await fixture(context);
  const bad = await f.add({...surface, projectId: 'beta'} as DesktopSurface);
  await expect(bad.page.getByText(/This task window cannot open/)).toBeVisible();
  await expect(bad.page.getByText(result.plan.plan.summary, {exact: true})).toHaveCount(0);
  await expect(bad.page.getByRole('button', {name: 'Load approved job', exact: true})).toHaveCount(0);
});

test('the detached cache survives main close and independent renderer reload/reopen', async ({context}) => {
  const f = await fixture(context);
  await f.main.getByRole('textbox', {name: 'Message to company manager', exact: true}).fill('Draft survives the other window.');
  await f.main.getByRole('button', {name: 'Task & plan', exact: true}).click();
  await f.main.getByRole('button', {name: 'Detach task into separate window'}).click();
  await expect(f.main.getByRole('button', {name: 'Focus task window'})).toBeVisible();
  const child = f.child(); await child.getByRole('button', {name: 'Load approved job', exact: true}).click();
  await expect(child.getByText(result.plan.plan.summary, {exact: true})).toBeVisible();
  await f.main.close(); await child.reload();
  await expect(child.getByText(result.plan.plan.summary, {exact: true})).toBeVisible();
  await expect(child.getByText('Saved read · current eligibility has not been refreshed.', {exact: true})).toBeVisible();
  const reopened = await f.add({kind: 'main'}); await reopened.recovered;
  await expect(reopened.page.getByRole('button', {name: 'Focus task window'})).toBeVisible();
  await expect(reopened.page.getByRole('textbox', {name: 'Message to company manager', exact: true})).toHaveValue('Draft survives the other window.');
  expect(f.calls.filter(path => path.endsWith('/work-plan/read'))).toHaveLength(1);
});

test('failed detached cache recovery never announces ready or removes the main task body', async ({context}) => {
  const f = await fixture(context, async page => {
    await page.addInitScript(key => {
      const get = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function(this: IDBObjectStore, query: IDBValidKey | IDBKeyRange) {
        if (query === key) throw new DOMException('Synthetic task cache failure', 'AbortError');
        return get.call(this, query);
      };
    }, `company:leo-company:approved-read:${binding.instructionId}:v1`);
  });
  await f.main.getByRole('button', {name: 'Task & plan', exact: true}).click();
  await expect(f.main.getByRole('button', {name: 'Load approved job', exact: true})).toBeEnabled();
  await f.main.getByRole('button', {name: 'Detach task into separate window'}).click();
  await expect.poll(() => Boolean(f.child())).toBe(true);
  await expect(f.child().getByRole('alert')).toContainText('The saved task could not be recovered');
  await expect(f.main.locator('.company-work-plan')).toHaveCount(1);
  expect(f.calls).not.toContain('native:ready:company-task');
});

test.describe('narrow native task preference custody', () => {
  test.use({viewport: {width: 392, height: 781}});
  test('native ready and dock preserve the mounted floating shell and its delayed saved size', async ({context}, info) => {
    const f = await fixture(context), main = f.main;
    const key = 'harness:floating:company:leo-company:task-plan:alpha:v1';
    const preferred = {x: 8, y: 60, width: 366, height: 609.6146240234375, collapsed: false};
    await main.getByRole('textbox', {name: 'Message to company manager', exact: true}).fill('Keep the manager draft through the native move.');
    // Restore the shell before the conversation composer exists, as on startup.
    await main.getByText('More tools', {exact: true}).click(); await main.getByRole('button', {name: 'Plan', exact: true}).click();
    await main.getByRole('combobox', {name: 'Project scope'}).selectOption('beta');
    await main.evaluate(({key, preferred}) => localStorage.setItem(key, JSON.stringify(preferred)), {key, preferred});
    await main.getByRole('combobox', {name: 'Project scope'}).selectOption('alpha');
    await main.waitForTimeout(250); // Settle the existing 120ms preference writer.
    const before = await main.evaluate(key => JSON.parse(localStorage.getItem(key)!), key);
    expect(before.height).toBe(preferred.height); expect(before.width).toBe(preferred.width);
    await main.getByRole('button', {name: 'Company manager', exact: true}).click();
    await main.getByRole('button', {name: 'Task & plan', exact: true}).click();
    await expect(main.getByRole('button', {name: 'Detach task into separate window'})).toBeEnabled();
    await main.locator('.company-task-surface-floating').evaluate(element => element.setAttribute('data-retained-shell', 'original'));
    await main.getByRole('button', {name: 'Detach task into separate window'}).click();
    await expect(main.getByRole('button', {name: 'Focus task window'})).toBeVisible();
    const shellDuringNative = await main.locator('.company-task-surface-floating').count();
    await expect(main.locator('.company-work-plan')).toHaveCount(0);
    await expect(f.child().locator('.company-work-plan')).toHaveCount(1);
    await f.child().getByRole('button', {name: 'Dock in main window'}).click(); await f.child().close();
    await expect(main.getByRole('button', {name: 'Float task panel'})).toBeVisible();
    await main.waitForTimeout(300); // A pre-120ms read misses the destructive write.
    const after = await main.evaluate(key => JSON.parse(localStorage.getItem(key)!), key);
    await info.attach('floating-preference-boundary.json', {body: JSON.stringify({preferred, before, shellDuringNative, after, viewport: main.viewportSize()}, null, 2), contentType: 'application/json'});
    expect(after, JSON.stringify({before, after, shellDuringNative})).toEqual(before);
    expect(shellDuringNative).toBe(1);
    await expect(main.locator('.company-task-surface-floating')).toHaveAttribute('data-retained-shell', 'original');
    await expect(main.locator('.company-work-plan')).toHaveCount(1);
    await expect(main.getByRole('textbox', {name: 'Message to company manager', exact: true})).toHaveValue('Keep the manager draft through the native move.');
  });
});
