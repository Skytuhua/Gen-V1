import {expect, test, type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {companyCspTestHost} from './company-production-csp-host';
import type {WorkPlanReadRequest, WorkPlanReadResponse} from '../../packages/company-contracts/work-plan';
import type {ApprovedJobRead} from '../../packages/company-contracts/approved-job-read';

// Synthetic read-only records; no service credentials, model, worker or native IPC.
const sample = JSON.parse(readFileSync('packages/company-contracts/owner-work-plan-candidate.1/examples.json', 'utf8')).cases[3] as {request: WorkPlanReadRequest; response: WorkPlanReadResponse};
const auth = sample.response.authorization!;
const binding: ApprovedJobRead = {companyId: 'leo-company', projectId: 'alpha', instructionId: sample.request.instruction_id, planRef: sample.request.plan_ref!, workOrderId: auth.authorization.work_order.id, authorizationDigest: auth.authorization.digest, authorizationExpiresAt: auth.authorization.expires_at_epoch_seconds};
let host: Awaited<ReturnType<typeof companyCspTestHost>>;
test.beforeAll(async () => {host = await companyCspTestHost();});
test.afterAll(async () => {await host.close();});

async function open(page: Page, entryPath = '/company/communications') {
  const calls: {path: string; body: unknown}[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    Object.assign(window, {taskCspViolations: []});
    document.addEventListener('securitypolicyviolation', event => (window as unknown as {taskCspViolations: string[]}).taskCspViolations.push(event.effectiveDirective));
  });
  // Same CSP-protected fixture document for the manager's fixed entry on reload.
  await page.route(url => url.origin === host.origin && url.pathname === '/company', async route => route.fulfill({response: await route.fetch({url: host.origin + '/company/communications'})}));
  const projects = ['alpha', 'beta'].map(id => ({id, name: `${id} synthetic project`, state: 'draft', scheduler_paused: false, task_counts: {}, occupied_synthetic_slots: 0}));
  const observation = {status: 'unavailable', observed_at: null, expires_at: null, evidence_scope: 'unavailable'};
  const data = {evidence_scope: 'synthetic_only', live_ready: false, company_accepted: false, planning_mode: 'planning_only', native_chat_planner: 'capability_missing',
    targets: {employees: 32, departments: 16, hermes: 18, codex: 14}, actual_live: {employees: 0, hermes: 0, codex: 0}, projects, employees: [], blockers: [], auth: observation, budget: observation,
    runtime_requirements: {source: 'synthetic-fixture', hermes: {mode: 'native', repository: null, commit: null, compatibility_evidence: null, image_digest: null}, codex: {mode: 'native', package: null, version: null, external_auth_candidate_status: null, image_digest: null}},
    configured_requirements_digest: 'b'.repeat(64), configured_company_digest: 'c'.repeat(64), native_limits: {task_timeout_seconds: 600, hermes_iteration_cap: 100, codex_turn_cap: null, max_child_processes_per_attempt: 1, effective_limits: null}};
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, body = request.method() === 'POST' ? request.postDataJSON() : undefined;
    calls.push({path, body});
    if (path === '/api/bootstrap') return route.fulfill({json: {csrfToken: 'PUBLIC-task-surface-fixture'}});
    if (path === '/api/company/connection') return route.fulfill({json: {configured: true, ownerAuthenticated: true, protocol: 'company-service.v1-draft1', mode: 'read_only', capabilities: {status: true}, blockers: []}});
    if (path === '/api/company/status') {const project = projects.find(item => item.id === body?.scope?.id); return route.fulfill({json: {data: {...data, ...(project ? {project, projects: [project]} : {})}, receivedAt: '2026-11-04T08:00:00Z', source: 'company_service', protocol: 'company-service.v1-draft1'}});}
    if (path === '/api/company/manager/availability') return route.fulfill({json: {configured: true, mode: 'shadow_proposals', admission: 'checked_per_request', dispatchAuthorized: false, durableCompanyStorage: false, blockers: []}});
    if (path === '/api/company/workflow') return route.fulfill({json: {protocol: 'company-service.v1-draft1', mode: 'planning_only', recordInstruction: false, authorize: false, progress: false, result: false, blockers: [], workPlans: {configured: true, readOnly: true}, approvedJob: binding}});
    if (path === '/api/company/workflow/work-plan/read') {expect(body).toEqual(sample.request); return route.fulfill({json: sample.response});}
    return route.fulfill({status: 503, json: {error: {code: 'COMPANY_UNAVAILABLE', message: 'Unavailable in this synthetic UI fixture'}}});
  });
  const response = await page.goto(host.origin + entryPath);
  expect(response?.headers()['content-security-policy']).toBe(host.csp);
  await page.getByRole('button', {name: 'Company manager', exact: true}).click();
  await page.getByRole('combobox', {name: 'Project scope'}).selectOption('alpha');
  return {calls, errors};
}
const panel = (page: Page) => page.getByRole('complementary', {name: 'Current task and plan'});
const floating = (page: Page) => page.getByRole('region', {name: 'Floating task and plan'});
const message = (page: Page) => page.getByRole('textbox', {name: 'Message to company manager', exact: true});
const toggle = (page: Page) => page.getByRole('button', {name: 'Task & plan', exact: true});

test('docks and floats the same approved record while keeping the conversation unsent', async ({page}, info) => {
  const fixture = await open(page);
  await message(page).fill('Keep this scoped manager draft.');
  await toggle(page).click();
  await expect(page.getByRole('button', {name: 'Float task panel'})).toBeVisible();
  await page.getByRole('button', {name: 'Load approved job', exact: true}).click();
  await expect(page.getByText(sample.response.plan.plan.summary, {exact: true})).toBeVisible();
  await page.locator('.company-work-plan').evaluate(element => element.setAttribute('data-retained-test-body', 'same-task'));
  await page.getByRole('button', {name: 'Float task panel'}).click();
  await expect(floating(page)).toBeVisible();
  await expect(page.getByRole('button', {name: 'Dock task panel', exact: true})).toBeFocused();
  await expect(page.locator('.company-work-plan')).toHaveAttribute('data-retained-test-body', 'same-task');
  await expect(floating(page).getByText('WorkOrder ' + binding.workOrderId, {exact: true})).toBeVisible();
  await page.screenshot({path: info.outputPath('task-floating.png'), fullPage: true});
  await page.getByRole('button', {name: 'Dock task panel', exact: true}).click();
  await expect(panel(page)).toBeVisible();
  await expect(page.getByRole('button', {name: 'Float task panel'})).toBeFocused();
  await expect(page.locator('.company-work-plan')).toHaveAttribute('data-retained-test-body', 'same-task');
  await page.getByRole('button', {name: 'Load approved job', exact: true}).focus(); await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0); await expect(toggle(page)).toBeFocused();
  await toggle(page).click(); await expect(page.locator('.company-work-plan')).toHaveAttribute('data-retained-test-body', 'same-task');
  await expect(message(page)).toHaveValue('Keep this scoped manager draft.');
  await expect(page.getByRole('button', {name: 'Send message', exact: true})).toBeDisabled();
  expect(fixture.calls.filter(call => call.path.endsWith('/work-plan/read'))).toHaveLength(1);
  expect(fixture.calls.filter(call => /\/(propose|authorize|materialize|instruction)$/.test(call.path))).toHaveLength(0);
  expect(fixture.errors).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as {taskCspViolations: string[]}).taskCspViolations)).toEqual([]);
});

test('recovers floating placement, closed state and separate project drafts without reloading the approved record', async ({page}) => {
  const fixture = await open(page);
  await message(page).fill('Alpha draft'); await toggle(page).click();
  await page.getByRole('button', {name: 'Load approved job', exact: true}).click();
  await expect(page.getByText(sample.response.plan.plan.summary, {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Float task panel'}).click();
  await page.reload();
  await expect(floating(page)).toBeVisible(); await expect(message(page)).toHaveValue('Alpha draft');
  await expect(page.getByText(sample.response.plan.plan.summary, {exact: true})).toBeVisible();
  await page.getByRole('combobox', {name: 'Project scope'}).selectOption('beta');
  await expect(floating(page)).toBeVisible();
  await expect(message(page)).toHaveValue(''); await message(page).fill('Beta draft');
  await expect(page.getByText('No task reference is available for this project.', {exact: false})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Load approved job', exact: true})).toHaveCount(0);
  await expect(page.getByText(sample.response.plan.plan.summary, {exact: true})).toHaveCount(0);
  await page.getByRole('combobox', {name: 'Project scope'}).selectOption('alpha');
  await expect(floating(page)).toBeVisible(); await expect(message(page)).toHaveValue('Alpha draft');
  await page.getByRole('button', {name: 'Dock task panel', exact: true}).focus(); await page.keyboard.press('Escape');
  await expect(floating(page)).toHaveCount(0); await expect(toggle(page)).toBeFocused();
  await page.reload(); await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
  await toggle(page).click(); await expect(floating(page)).toBeVisible();
  expect(fixture.calls.filter(call => call.path.endsWith('/work-plan/read'))).toHaveLength(1);
});

test('keeps floating controls and approved content readable on a narrow screen and disconnect', async ({page}, info) => {
  const fixture = await open(page); await page.setViewportSize({width: 390, height: 844});
  await message(page).fill('Narrow offline draft'); await toggle(page).click();
  await page.getByRole('button', {name: 'Float task panel'}).click();
  const bounds = await floating(page).boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
  await page.getByRole('button', {name: 'Move Task & plan', exact: true}).focus(); await page.keyboard.press('ArrowDown');
  await page.getByRole('button', {name: 'Minimize Task & plan', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Expand Task & plan', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Expand Task & plan', exact: true}).click();
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.getByRole('button', {name: 'Dock task panel', exact: true}).click();
  await expect(panel(page)).toBeVisible(); await expect(message(page)).toHaveValue('Narrow offline draft');
  const horizontal = await page.evaluate(() => ({width: document.documentElement.scrollWidth, viewport: innerWidth, wide: [...document.querySelectorAll('*')].map(element => ({tag: element.tagName, className: element.className, right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width})).filter(element => element.right > innerWidth + 1).slice(0, 12)}));
  await page.screenshot({path: info.outputPath('narrow-docked.png'), fullPage: true});
  expect(horizontal.width, JSON.stringify(horizontal)).toBeLessThanOrEqual(horizontal.viewport);
  await page.getByRole('button', {name: 'Close task panel'}).click(); await expect(toggle(page)).toBeFocused();
  expect(fixture.errors).toEqual([]);
});

test('failed layout recovery cannot overwrite the saved placement or manager draft', async ({page}) => {
  await open(page); await message(page).fill('Preserve this draft during layout recovery failure.');
  await toggle(page).click(); await page.getByRole('button', {name: 'Float task panel'}).click();
  const key = 'company:leo-company:task-surface:alpha:v1';
  await expect.poll(() => page.evaluate(key => localStorage.getItem(`harness:journal-pending:${encodeURIComponent(key)}`), key)).toBeNull();
  await page.addInitScript(() => {
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function(this: IDBObjectStore, key: IDBValidKey | IDBKeyRange) {
      if (sessionStorage.getItem('fail-task-surface-read') === 'yes' && key === 'company:leo-company:task-surface:alpha:v1') throw new DOMException('Synthetic layout read failure', 'AbortError');
      return get.call(this, key);
    };
  });
  await page.evaluate(() => sessionStorage.setItem('fail-task-surface-read', 'yes')); await page.reload();
  await expect(page.getByRole('alert')).toContainText('Task panel recovery is unavailable');
  await expect(toggle(page)).toBeDisabled();
  await expect(message(page)).toHaveValue('Preserve this draft during layout recovery failure.');
  await expect(message(page)).toBeEnabled();
  await page.evaluate(() => sessionStorage.removeItem('fail-task-surface-read')); await page.reload();
  await expect(floating(page)).toBeVisible();
  await expect(message(page)).toHaveValue('Preserve this draft during layout recovery failure.');
});

test('native view switches preserve the exact entry URL while journal selection and drafts recover', async ({page}) => {
  await page.addInitScript(() => {
    const context = {windowId: 'main-fixture', surface: {kind: 'main'}, windows: []};
    Object.assign(window, {harnessDesktop: {getContext: async () => context, ready: async () => context, onState: () => () => {}, onCloseRequested: () => () => {}}});
  });
  await open(page, '/company?desktopWindow=00000000-0000-4000-8000-000000000001');
  const entryUrl = page.url();
  await message(page).fill('Native immutable-URL draft');
  await page.getByRole('button', {name: 'Projects', exact: true}).click();
  expect(page.url()).toBe(entryUrl);
  await expect(page.getByRole('heading', {name: 'Projects', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Company manager', exact: true}).click();
  expect(page.url()).toBe(entryUrl); await expect(message(page)).toHaveValue('Native immutable-URL draft');
  await page.reload();
  // Native always keeps its original entry route; selection/draft remain local.
  await page.getByRole('button', {name: 'Company manager', exact: true}).click();
  expect(page.url()).toBe(entryUrl); await expect(message(page)).toHaveValue('Native immutable-URL draft');
  await expect(page.getByRole('button', {name: 'Send message', exact: true})).toBeDisabled();
});
