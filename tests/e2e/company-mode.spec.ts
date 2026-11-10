import {expect, test, type Page} from '@playwright/test';

// Explicit synthetic protocol fixtures. These tests do not contact Maritime,
// authenticate a real owner, dispatch employees or establish live acceptance.
async function companyFixture(page: Page) {
  const calls: {path: string; body?: unknown}[] = [];
  let fail = false;
  const project = {id: 'project-fixture', name: 'Synthetic project', state: 'draft', scheduler_paused: false, task_counts: {queued: 2, completed: 1}, occupied_synthetic_slots: 0, marketing: {status: 'available', evidence_scope: 'local_draft_records', live_ready: false, campaigns: [{id: 'campaign-fixture', project_id: 'project-fixture', state: 'draft_only', goal: '<img src=x onerror=alert(1)> Synthetic campaign', audience: 'Fixture reviewers', channels: ['newsletter'], production_approval: {status: 'unavailable', expires_at: null}}], content_queue: [], exceptions: [], truncated: false}};
  const data = {
    evidence_scope: 'synthetic_only', live_ready: false, company_accepted: false, planning_mode: 'planning_only', native_chat_planner: 'capability_missing',
    targets: {employees: 32, departments: 16, hermes: 18, codex: 14}, actual_live: {employees: 0, hermes: 0, codex: 0},
    employees: [{id: 'E01', department: 'Company management', state: 'planned_unverified', target_runtime: 'hermes', effective_runtime: null, required_model: 'fixture-model', required_reasoning: 'max', effective_model: null, effective_reasoning: null, required_route: {provider: 'openai-codex', billing_route: 'subscription', fallbacks: []}, effective_route: null, required_mode: 'native', effective_mode: null, effective_config_digest: null, configured_profile_version: 1, configured_profile_digest: 'a'.repeat(64), synthetic_admission: {present: false, expired: false, evidence_scope: 'unavailable'}, playbooks: {configured: [], active: false, state: 'inactive_pending_evaluation'}}],
    projects: [project], auth: {status: 'unavailable', observed_at: null, expires_at: null, evidence_scope: 'unavailable'}, budget: {status: 'unavailable', observed_at: null, expires_at: null, evidence_scope: 'unavailable'},
    blockers: ['native_runtime_dispatch_unavailable', 'synthetic_review_is_not_live_acceptance'], runtime_requirements: {source: 'synthetic-fixture', hermes: {mode: 'native', repository: null, commit: null, compatibility_evidence: null, image_digest: null}, codex: {mode: 'native', package: null, version: null, external_auth_candidate_status: null, image_digest: null}}, configured_requirements_digest: 'b'.repeat(64), configured_company_digest: 'c'.repeat(64), native_limits: {task_timeout_seconds: 600, hermes_iteration_cap: 100, codex_turn_cap: null, max_child_processes_per_attempt: 1, effective_limits: null},
  };
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : undefined;
    calls.push({path, body});
    if (path === '/api/bootstrap') return route.fulfill({json: {csrfToken: 'synthetic-company-csrf'}});
    if (path === '/api/company/connection') return route.fulfill({json: {configured: true, protocol: 'company-service.v1-draft1', serviceBaseline: '770b566-synthetic-fixture', mode: 'read_only', ownerAuthenticated: !fail, capabilities: {status: true, artifactPreview: false, reviewPackage: false, planning: false, dispatch: false, publication: false, events: false, emergencyStop: false}, blockers: []}});
    if (path === '/api/company/status') {
      if (fail) return route.fulfill({status: 503, json: {error: {code: 'COMPANY_UNAVAILABLE', message: 'Synthetic service unavailable'}}});
      return route.fulfill({json: {data: {...data, ...(body?.scope?.kind === 'project' ? {projects: [project], project} : {})}, receivedAt: '2026-11-02T12:00:00.000Z', source: 'company_service', protocol: 'company-service.v1-draft1'}});
    }
    return route.fulfill({status: 403, json: {error: {code: 'UNEXPECTED_PERSONAL_API', message: 'Company mode cannot call a personal API'}}});
  });
  return {calls, failNextStatus: () => {fail = true;}};
}

async function rejectJournalRead(page: Page, key: string) {
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function(this: IDBObjectStore, query: IDBValidKey | IDBKeyRange) {
      if (query === sessionStorage.getItem('company-test:failed-journal-read')) {
        throw new DOMException('Synthetic journal read failure', 'AbortError');
      }
      return original.call(this, query);
    };
  });
  await page.evaluate(value => sessionStorage.setItem('company-test:failed-journal-read', value), key);
}

test('company mode shows source-backed targets and actuals without a personal API or event stream', async ({page}) => {
  const fixture = await companyFixture(page); await page.goto('/company/projects');
  await expect(page.getByRole('heading', {name: 'Projects', exact: true}).first()).toBeVisible();
  await expect(page.getByText('Company records connected', {exact: true})).toBeVisible();
  await page.getByText('Team configuration and test evidence', {exact: true}).click();
  await expect(page.getByRole('row', {name: 'Hermes 18 0'})).toBeVisible();
  await expect(page.getByRole('row', {name: 'Codex 14 0'})).toBeVisible();
  await expect(page.getByText('Employee setup is not verified', {exact: true})).toBeVisible();
  await page.locator('summary').filter({hasText: /^Execution controls$/}).click();
  for (const name of ['Pause', 'Cancel', 'Emergency stop']) await expect(page.getByRole('button', {name, exact: true})).toBeDisabled();
  expect(fixture.calls.every(call => call.path === '/api/bootstrap' || call.path.startsWith('/api/company/'))).toBe(true);
  expect(fixture.calls.filter(call => call.path === '/api/company/status')).toHaveLength(1);
  await page.getByRole('button', {name: 'People', exact: true}).click();
  await expect(page.getByRole('cell', {name: 'Effective runtime unavailable', exact: false})).toBeVisible();
  expect(fixture.calls.filter(call => call.path === '/api/company/status')).toHaveLength(1);
});

test('owner notes, selection and filters survive refresh and reload', async ({page}) => {
  const fixture = await companyFixture(page); await page.goto('/company/projects');
  const notes = page.getByRole('textbox', {name: 'Owner notes', exact: true});
  await expect(notes).toBeEnabled(); await notes.fill('Keep this local review note.');
  await expect(page.getByText('Saved on this device', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'People', exact: true}).click();
  await page.getByRole('textbox', {name: 'Filter company records'}).fill('E01');
  await page.getByRole('button', {name: 'Refresh status'}).click();
  await expect(notes).toHaveValue('Keep this local review note.');
  const beforeReconnect = fixture.calls.filter(call => call.path === '/api/company/status').length;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => fixture.calls.filter(call => call.path === '/api/company/status').length).toBeGreaterThan(beforeReconnect);
  await expect(notes).toHaveValue('Keep this local review note.');
  await expect(page.getByRole('textbox', {name: 'Filter company records'})).toHaveValue('E01');
  await page.reload();
  await expect(page.getByRole('heading', {name: 'People', exact: true})).toBeVisible();
  await expect(notes).toHaveValue('Keep this local review note.');
  await expect(page.getByRole('textbox', {name: 'Filter company records'})).toHaveValue('E01');
  await page.getByRole('combobox', {name: 'Project scope'}).selectOption('project-fixture');
  await expect.poll(() => fixture.calls.some(call => JSON.stringify(call.body) === JSON.stringify({scope: {kind: 'project', id: 'project-fixture'}}))).toBe(true);
});

test('a failed view-selection read does not discard readable owner notes', async ({page}) => {
  const fixture = await companyFixture(page); await page.goto('/company/projects');
  const notes = page.getByRole('textbox', {name: 'Owner notes', exact: true});
  await expect(notes).toBeEnabled(); await notes.fill('Keep the readable owner draft.');
  await expect(page.getByText('Saved on this device', {exact: true})).toBeVisible();
  await rejectJournalRead(page, 'company:leo-company:workspace:v1'); await page.reload();
  await expect(notes).toHaveValue('Keep the readable owner draft.');
  await expect(notes).toBeEnabled();
  await expect(page.getByRole('heading', {name: 'Projects', exact: true}).first()).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('View selection could not be recovered');
  await notes.fill('Edited after independent notes recovery.');
  await expect(page.getByText('Saved on this device', {exact: true})).toBeVisible();
  await page.evaluate(() => sessionStorage.removeItem('company-test:failed-journal-read')); await page.reload();
  await expect(notes).toHaveValue('Edited after independent notes recovery.');
  expect(fixture.calls.every(call => ['/api/bootstrap', '/api/company/connection', '/api/company/status'].includes(call.path))).toBe(true);
});

test('a failed notes read cannot enable a blank overwrite and reload recovers the exact draft', async ({page}) => {
  const fixture = await companyFixture(page); await page.goto('/company/projects');
  const notes = page.getByRole('textbox', {name: 'Owner notes', exact: true});
  const draft = 'Preserve this unread draft.\nOwner edit: é 界 😀';
  await expect(notes).toBeEnabled(); await notes.fill(draft);
  await expect(page.getByText('Saved on this device', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'People', exact: true}).click();
  await page.getByRole('textbox', {name: 'Filter company records'}).fill('E01');
  await rejectJournalRead(page, 'company:leo-company:owner-notes:v1'); await page.reload();
  await expect(notes).toBeDisabled();
  await expect(page.getByText('Notes recovery unavailable · reload to retry', {exact: true})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'People', exact: true})).toBeVisible();
  await expect(page.getByRole('textbox', {name: 'Filter company records'})).toHaveValue('E01');
  await page.getByRole('button', {name: 'Refresh status'}).click();
  await expect(notes).toBeDisabled();
  await page.evaluate(() => sessionStorage.removeItem('company-test:failed-journal-read')); await page.reload();
  await expect(notes).toBeEnabled(); await expect(notes).toHaveValue(draft);
  expect(fixture.calls.every(call => ['/api/bootstrap', '/api/company/connection', '/api/company/status'].includes(call.path))).toBe(true);
});

test('failed refresh retains the prior snapshot and notes without claiming a current connection', async ({page}) => {
  const fixture = await companyFixture(page); await page.goto('/company/projects');
  await expect(page.getByText('Company records connected', {exact: true})).toBeVisible();
  await page.getByText('Team configuration and test evidence', {exact: true}).click();
  await page.getByRole('textbox', {name: 'Owner notes', exact: true}).fill('Unsent local note');
  fixture.failNextStatus(); await page.getByRole('button', {name: 'Refresh status'}).click();
  await expect(page.getByRole('alert')).toContainText('Company records could not be refreshed');
  await page.getByRole('alert').getByText('Details', {exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('Synthetic service unavailable');
  await expect(page.getByText('Company records unavailable', {exact: true})).toBeVisible();
  await expect(page.getByRole('row', {name: 'Hermes 18 0'})).toBeVisible();
  await expect(page.getByRole('textbox', {name: 'Owner notes', exact: true})).toHaveValue('Unsent local note');
  await expect(page.getByText(/previous snapshot/).first()).toBeVisible();
});

test('campaign fields stay text and narrow layouts retain all company views', async ({page}) => {
  await companyFixture(page); await page.setViewportSize({width: 390, height: 844}); await page.goto('/company/projects');
  await expect(page.getByText('Company records connected', {exact: true})).toBeVisible();
  await page.getByText('More tools', {exact: true}).click();
  await page.getByRole('button', {name: 'Campaigns', exact: true}).click();
  await expect(page.getByText('<img src=x onerror=alert(1)> Synthetic campaign', {exact: true})).toBeVisible();
  await expect(page.locator('.company-view img')).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.getByRole('button', {name: 'Review desk', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'No review package loaded'})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
