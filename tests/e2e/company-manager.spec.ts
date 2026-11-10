import {expect, test, type Page, type Route} from '@playwright/test';
import type {CompanyManagerInteraction} from '../../packages/company-manager/journal';
import path from 'node:path';

// Synthetic API fixtures only: no real admission, subscription inference,
// employee dispatch, company persistence or company acceptance is exercised.
type Input = {projectId: string; requestId: string; instruction: string};
function interaction(input: Input, status: CompanyManagerInteraction['status'] = 'draft_ready'): CompanyManagerInteraction {
  return {
    id: input.requestId, projectId: input.projectId, input, scope: 'local_ui_interaction', companyReceipt: null,
    status, createdAt: 1, updatedAt: 2,
    ...(status === 'uncertain' ? {errorCode: 'COMPANY_MANAGER_CLEANUP' as const} : {}),
    ...(status === 'draft_ready' ? {draft: {
      id: `draft-${input.requestId}`, kind: 'local_manager_draft' as const, state: 'unsubmitted' as const,
      authority: 'proposal_only' as const, evidenceScope: 'local_manager_output' as const,
      requestId: input.requestId, projectId: input.projectId, dispatchAuthorized: false as const, companyReceipt: null,
      permitId: 'synthetic-permit', policyRevision: 'synthetic-policy', sourceRefs: ['source-fixture'], createdAt: 2, digest: 'a'.repeat(64),
      content: {
        summary: `<img src=x onerror=alert(1)> Draft for ${input.projectId}`, interpretation: 'Synthetic interpretation',
        assumptions: ['Synthetic assumption'], blockers: [{kind: 'owner_decision' as const, detail: 'Confirm the scope'}],
        tasks: [{id: 'task-fixture', title: 'Review sources', instructions: 'Read the supplied references.', dependsOn: [], proposedEmployeeId: 'E02', sourceRefs: ['source-fixture'], deliverable: 'research' as const, requiredEvidence: ['A source-backed review']}],
      },
    }} : {}),
  };
}

async function managerFixture(page: Page, configured = true) {
  const calls: {path: string; body: unknown}[] = [];
  const records = new Map<string, CompanyManagerInteraction>();
  let propose: ((route: Route, input: Input) => Promise<void>) | undefined;
  let cancel: ((route: Route, input: Input) => Promise<void>) | undefined;
  const projects = ['project-fixture', 'project-other'].map(id => ({id, name: id === 'project-fixture' ? 'Synthetic project' : 'Other project', state: 'draft', scheduler_paused: false, task_counts: {}, occupied_synthetic_slots: 0}));
  const observation = {status: 'unavailable', observed_at: null, expires_at: null, evidence_scope: 'unavailable'};
  const data = {
    evidence_scope: 'synthetic_only', live_ready: false, company_accepted: false, planning_mode: 'planning_only', native_chat_planner: 'capability_missing',
    targets: {employees: 32, departments: 16, hermes: 18, codex: 14}, actual_live: {employees: 0, hermes: 0, codex: 0},
    projects, employees: [], blockers: [], auth: observation, budget: observation,
    runtime_requirements: {source: 'synthetic-fixture', hermes: {mode: 'native', repository: null, commit: null, compatibility_evidence: null, image_digest: null}, codex: {mode: 'native', package: null, version: null, external_auth_candidate_status: null, image_digest: null}},
    configured_requirements_digest: 'b'.repeat(64), configured_company_digest: 'c'.repeat(64), native_limits: {task_timeout_seconds: 600, hermes_iteration_cap: 100, codex_turn_cap: null, max_child_processes_per_attempt: 1, effective_limits: null},
  };
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : undefined;
    calls.push({path, body});
    if (path === '/api/bootstrap') return route.fulfill({json: {csrfToken: 'synthetic-manager-csrf'}});
    if (path === '/api/company/connection') return route.fulfill({json: {configured: true, protocol: 'company-service.v1-draft1', serviceBaseline: 'synthetic-fixture', mode: 'read_only', ownerAuthenticated: true, capabilities: {status: true, artifactPreview: false, reviewPackage: false, planning: false, dispatch: false, publication: false, events: false, emergencyStop: false}, blockers: []}});
    if (path === '/api/company/status') {
      const project = projects.find(item => item.id === body?.scope?.id);
      return route.fulfill({json: {data: {...data, ...(project ? {projects: [project], project} : {})}, receivedAt: '2026-11-02T12:00:00.000Z', source: 'company_service', protocol: 'company-service.v1-draft1'}});
    }
    if (path === '/api/company/manager/availability') return route.fulfill({json: {configured, mode: 'shadow_proposals', admission: 'checked_per_request', dispatchAuthorized: false, durableCompanyStorage: false, blockers: configured ? [] : ['Trusted E01 admission is unavailable.']}});
    if (path === '/api/company/manager/propose') {
      if (propose) return propose(route, body);
      const record = interaction(body); records.set(body.requestId, record); return route.fulfill({json: record});
    }
    if (path === '/api/company/manager/request') {
      const record = records.get(body.requestId);
      return record ? route.fulfill({json: record}) : route.fulfill({status: 404, json: {error: {code: 'NOT_FOUND', message: 'Synthetic request unavailable'}}});
    }
    if (path === '/api/company/manager/cancel') {
      if (cancel) return cancel(route, body);
      return route.fulfill({json: records.get(body.requestId)});
    }
    return route.fulfill({status: 403, json: {error: {code: 'UNEXPECTED_API', message: 'Unexpected API in synthetic company test'}}});
  });
  return {calls, records, onPropose: (value: typeof propose) => {propose = value;}, onCancel: (value: typeof cancel) => {cancel = value;}};
}
async function openPlan(page: Page, project = 'project-fixture') {
  await page.goto('/company/plan');
  if (project) await page.getByRole('combobox', {name: 'Project scope'}).selectOption(project);
}
const draftButton = (page: Page) => page.getByRole('button', {name: 'Create local draft', exact: true});
const instruction = (page: Page) => page.getByRole('textbox', {name: 'E01 planning instruction', exact: true});
const notes = (page: Page) => page.getByRole('textbox', {name: 'Local draft notes', exact: true});
const managerMessage = (page: Page) => page.getByRole('textbox', {name: 'Message to company manager', exact: true});

test('the main company entry opens the manager, and local planning never grants Send authority', async ({page}) => {
  const fixture = await managerFixture(page);
  await page.goto('/company/projects');
  await page.getByRole('combobox', {name: 'Project scope'}).selectOption('project-fixture');
  await page.goto('/company');
  await expect(page.getByRole('heading', {name: 'Message your company manager', exact: true})).toBeVisible();
  await expect(page.getByText('Company records connected', {exact: true})).toBeVisible();
  await expect(page.getByRole('heading', {name: "Your manager isn't connected yet", exact: true})).toBeVisible();
  await expect(page.getByText(/This connection supports local plan drafts/)).toBeVisible();
  await expect(managerMessage(page)).toBeEnabled();
  await managerMessage(page).fill('Keep this message as a draft.');
  await expect(page.getByText('Draft saved on this device', {exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Send message', exact: true})).toBeDisabled();
  await managerMessage(page).press('Enter');
  await page.getByRole('button', {name: 'Check manager connection', exact: true}).click();
  await expect(page.getByText(/This connection supports local plan drafts/)).toBeVisible();
  await expect(page.locator('.company-trust-strip')).toHaveCount(0);
  await expect(page.locator('.company-table')).toHaveCount(0);
  expect(fixture.calls.filter(call => /\/(propose|instruction|cancel)$/.test(call.path))).toHaveLength(0);
  expect(fixture.calls.every(call => call.path === '/api/bootstrap' || call.path.startsWith('/api/company/'))).toBe(true);
});

test('manager drafts retain explicit project scope through navigation, offline edits and reload', async ({page}) => {
  const fixture = await managerFixture(page, false); await page.goto('/company');
  await expect(managerMessage(page)).toBeDisabled();
  await page.getByRole('combobox', {name: 'Project scope'}).selectOption('project-fixture');
  await managerMessage(page).fill('First project message');
  await expect(page.getByText('Draft saved on this device', {exact: true})).toBeVisible();
  await page.getByRole('combobox', {name: 'Project scope'}).selectOption('project-other');
  await expect(managerMessage(page)).toHaveValue('');
  await managerMessage(page).fill('Other project message');
  await expect(page.getByText('Draft saved on this device', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'People', exact: true}).click();
  await page.getByRole('button', {name: 'Company manager', exact: true}).click();
  await expect(managerMessage(page)).toHaveValue('Other project message');
  await page.reload(); await expect(managerMessage(page)).toHaveValue('Other project message');
  await page.getByRole('combobox', {name: 'Project scope'}).selectOption('project-fixture');
  await expect(managerMessage(page)).toHaveValue('First project message');
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.getByRole('heading', {name: 'You’re offline', exact: true})).toBeVisible();
  await expect(page.getByText('Offline · saved records', {exact: true})).toBeVisible();
  await managerMessage(page).fill('Offline project edit');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText('Company records connected', {exact: true})).toBeVisible();
  await expect(managerMessage(page)).toHaveValue('Offline project edit');
  await expect(page.getByRole('button', {name: 'Send message', exact: true})).toBeDisabled();
  expect(fixture.calls.filter(call => call.path.endsWith('/propose'))).toHaveLength(0);
  await page.goto('/company/plan');
  await expect(instruction(page)).toHaveValue('Offline project edit');
});

test('a failed manager draft read cannot overwrite saved text', async ({page}) => {
  const fixture = await managerFixture(page, false); await page.goto('/company');
  await page.getByRole('combobox', {name: 'Project scope'}).selectOption('project-fixture');
  await managerMessage(page).fill('Preserve unread message: é 界 😀');
  await expect(page.getByText('Draft saved on this device', {exact: true})).toBeVisible();
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function(this: IDBObjectStore, query: IDBValidKey | IDBKeyRange) {
      if (sessionStorage.getItem('company-test:fail-manager-read') === 'yes' && query === 'company:leo-company:manager:project-fixture:v1') throw new DOMException('Synthetic draft read failure', 'AbortError');
      return original.call(this, query);
    };
  });
  await page.evaluate(() => sessionStorage.setItem('company-test:fail-manager-read', 'yes'));
  await page.reload();
  await expect(page.getByText(/Draft recovery unavailable/)).toBeVisible();
  await expect(managerMessage(page)).toBeDisabled();
  await page.evaluate(() => sessionStorage.removeItem('company-test:fail-manager-read'));
  await page.reload();
  await expect(managerMessage(page)).toHaveValue('Preserve unread message: é 界 😀');
  expect(fixture.calls.filter(call => call.path.endsWith('/propose'))).toHaveLength(0);
});

test('denied company records disappear while scoped drafts remain editable and unsent', async ({page}) => {
  const fixture = await managerFixture(page, false); await page.goto('/company');
  await page.getByRole('combobox', {name: 'Project scope'}).selectOption('project-fixture');
  await managerMessage(page).fill('Keep my denied-scope draft');
  await page.route('**/api/company/status', route => route.fulfill({status: 403, json: {error: {code: 'COMPANY_FORBIDDEN', message: 'Synthetic project access denied'}}}));
  await page.getByRole('button', {name: 'Refresh company records', exact: true}).click();
  await expect(page.getByText('Company records unavailable', {exact: true})).toBeVisible();
  await expect(page.locator('.company-project-threads button')).toHaveCount(0);
  await expect(page.getByRole('combobox', {name: 'Project scope'})).toHaveValue('project-fixture');
  await expect(managerMessage(page)).toHaveValue('Keep my denied-scope draft');
  await expect(managerMessage(page)).toBeEnabled();
  await expect(page.getByRole('button', {name: 'Send message', exact: true})).toBeDisabled();
  expect(fixture.calls.filter(call => call.path.endsWith('/propose'))).toHaveLength(0);
});

test('task panel uses only the selected project and the host-pinned approved reference', async ({page}) => {
  const fixture = await managerFixture(page, false);
  const job = {companyId: 'leo-company', projectId: 'project-other', instructionId: 'instruction-fixture',
    planRef: {kind: 'work_plan', id: 'plan-fixture', project_id: 'project-other', revision: 1, digest: 'a'.repeat(64)},
    workOrderId: 'work-fixture', authorizationDigest: 'b'.repeat(64), authorizationExpiresAt: 1999999999};
  await page.route('**/api/company/workflow', route => route.fulfill({json: {protocol: 'company-service.v1-draft1', mode: 'planning_only', recordInstruction: false, authorize: false, progress: false, result: false, blockers: [], approvedJob: job}}));
  await page.goto('/company');
  await page.getByRole('combobox', {name: 'Project scope'}).selectOption('project-fixture');
  await page.getByRole('button', {name: 'Task & plan', exact: true}).click();
  await expect(page.getByText(/No task reference is available for this project/)).toBeVisible();
  await expect(page.getByRole('button', {name: 'Load approved job', exact: true})).toHaveCount(0);
  await page.getByRole('combobox', {name: 'Project scope'}).selectOption('project-other');
  await expect(page.getByRole('button', {name: 'Load approved job', exact: true})).toBeEnabled();
  await page.getByRole('button', {name: 'Load approved job', exact: true}).click();
  await expect.poll(() => fixture.calls.some(call => call.path.endsWith('/work-plan/read'))).toBe(true);
  expect(fixture.calls.find(call => call.path.endsWith('/work-plan/read'))?.body).toEqual({project_id: job.projectId, instruction_id: job.instructionId, plan_ref: job.planRef});
  expect(fixture.calls.filter(call => /\/(propose|authorize|instruction)$/.test(call.path))).toHaveLength(0);
});

test('desktop and narrow manager layout preserve readable, keyboard accessible controls', async ({page}, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await managerFixture(page, false); await page.goto('/company');
  await page.getByRole('combobox', {name: 'Project scope'}).selectOption('project-fixture');
  await managerMessage(page).fill('Review the approved task with me before any work starts.');
  await expect(page.getByText('Draft saved on this device', {exact: true})).toBeVisible();
  await expect(page.getByRole('heading', {level: 1})).toHaveCount(1);
  const evidence = path.dirname(testInfo.project.outputDir);
  await page.screenshot({path: path.join(evidence, 'manager-desktop.png'), fullPage: true});
  await page.setViewportSize({width: 390, height: 844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await managerMessage(page).focus();
  await expect(managerMessage(page)).toBeFocused();
  await page.screenshot({path: path.join(evidence, 'manager-narrow.png'), fullPage: true});
  await page.getByRole('button', {name: 'Task & plan', exact: true}).click();
  await expect(page.getByRole('complementary', {name: 'Current task and plan'})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', {name: 'Close task panel'}).click();
  await expect(page.getByRole('complementary', {name: 'Current task and plan'})).toHaveCount(0);
  await expect(managerMessage(page)).toHaveValue('Review the approved task with me before any work starts.');
  expect(errors).toEqual([]);
});

test('an absent host record can retry only the exact saved request after explicit recovery', async ({page}) => {
  const fixture = await managerFixture(page);
  let attempts = 0;
  fixture.onPropose(async (route, input) => {
    if (++attempts === 1) return route.fulfill({status: 503, json: {error: {code: 'COMPANY_UNAVAILABLE', message: 'Synthetic owner scope check unavailable'}}});
    const record = interaction(input); fixture.records.set(input.requestId, record); await route.fulfill({json: record});
  });
  await openPlan(page); await instruction(page).fill('Original saved instruction'); await draftButton(page).click();
  await expect(page.getByRole('alert')).toContainText('Synthetic owner scope check unavailable');
  await instruction(page).fill('Edited next instruction');
  await page.getByRole('button', {name: 'Recover existing request', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Retry saved request', exact: true})).toBeVisible({timeout: 2000});
  expect(fixture.calls.filter(call => call.path.endsWith('/propose'))).toHaveLength(1);
  await page.getByRole('button', {name: 'Retry saved request', exact: true}).click();
  await expect(page.getByText('Local draft ready for owner review.', {exact: true})).toBeVisible();
  const requests = fixture.calls.filter(call => call.path.endsWith('/propose')).map(call => call.body);
  expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
  await expect(instruction(page)).toHaveValue('Edited next instruction');
});

test('unconfigured E01 remains disabled and all-project scope cannot draft', async ({page}) => {
  const fixture = await managerFixture(page, false); await openPlan(page, '');
  await expect(page.getByText('Choose a project to prepare a local draft.', {exact: true})).toBeVisible();
  await page.getByRole('combobox', {name: 'Project scope'}).selectOption('project-fixture');
  await instruction(page).fill('Prepare a plan.');
  await expect(draftButton(page)).toBeDisabled();
  await expect(page.getByText('Trusted E01 admission is unavailable.', {exact: true})).toBeVisible();
  expect(fixture.calls.filter(call => call.path.endsWith('/propose'))).toHaveLength(0);
  expect(fixture.calls.every(call => call.path === '/api/bootstrap' || call.path.startsWith('/api/company/'))).toBe(true);
});

test('draft review preserves edits during inference, refresh and reload and renders source text', async ({page}) => {
  const fixture = await managerFixture(page);
  let finish: (() => Promise<void>) | undefined;
  fixture.onPropose(async (route, input) => {await new Promise<void>(resolve => {finish = async () => {const record = interaction(input); fixture.records.set(input.requestId, record); await route.fulfill({json: record}); resolve();};});});
  await openPlan(page); await instruction(page).fill('Original instruction'); await draftButton(page).click();
  await expect.poll(() => Boolean(finish)).toBe(true);
  await instruction(page).fill('Edited next instruction'); await notes(page).fill('Owner review stays local.');
  await finish!();
  await expect(page.getByText('<img src=x onerror=alert(1)> Draft for project-fixture', {exact: true})).toBeVisible();
  await expect(page.getByText('Local draft · Unsubmitted · No dispatch', {exact: true})).toBeVisible();
  await expect(page.getByText('A source-backed review', {exact: true})).toBeVisible();
  await expect(page.locator('.company-manager img')).toHaveCount(0);
  await expect(page.locator('.company-manager a')).toHaveCount(0);
  await page.getByRole('button', {name: 'Refresh status', exact: true}).click();
  await expect(instruction(page)).toHaveValue('Edited next instruction');
  await page.reload();
  await expect(notes(page)).toHaveValue('Owner review stays local.');
  await expect(instruction(page)).toHaveValue('Edited next instruction');
  await expect(page.getByText('Synthetic interpretation', {exact: true})).toBeVisible();
  expect(fixture.calls.filter(call => call.path.endsWith('/propose'))).toHaveLength(1);
  expect(fixture.calls.find(call => call.path.endsWith('/propose'))?.body).toMatchObject({instruction: 'Original instruction'});
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async () => {throw new Error('Synthetic clipboard unavailable');}}}));
  await page.getByRole('button', {name: 'Copy draft JSON', exact: true}).click();
  await expect(page.getByRole('textbox', {name: 'Draft JSON to copy', exact: true})).toHaveValue(/local_manager_draft/);
});

test('a lost response recovers the saved request after reload without a second inference', async ({page}) => {
  const fixture = await managerFixture(page);
  let sent: Input | undefined;
  fixture.onPropose(async (route, input) => {sent = input; fixture.records.set(input.requestId, interaction(input, 'pending')); await route.abort('failed');});
  await openPlan(page); await instruction(page).fill('Recover this exact request'); await draftButton(page).click();
  await expect(page.getByRole('alert')).toContainText('The draft response is unavailable.');
  await expect(page.getByRole('button', {name: 'Recover existing request', exact: true})).toBeEnabled();
  await page.reload();
  await expect(page.getByText('E01 planning is pending.', {exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Create new local draft', exact: true})).toBeDisabled();
  fixture.records.set(sent!.requestId, interaction(sent!));
  await page.getByRole('button', {name: 'Recover existing request', exact: true}).click();
  await expect(page.getByText('Synthetic interpretation', {exact: true})).toBeVisible();
  expect(fixture.calls.filter(call => call.path.endsWith('/propose'))).toHaveLength(1);
  expect(fixture.calls.filter(call => call.path.endsWith('/request')).every(call => JSON.stringify(call.body) === JSON.stringify({projectId: sent!.projectId, requestId: sent!.requestId}))).toBe(true);
});

test('stop planning reports uncertain cleanup without claiming company emergency stop', async ({page}) => {
  const fixture = await managerFixture(page);
  let finish: (() => Promise<void>) | undefined;
  fixture.onPropose(async (route, input) => {fixture.records.set(input.requestId, interaction(input, 'pending')); await new Promise<void>(resolve => {finish = async () => {await route.fulfill({json: interaction(input, 'uncertain')}); resolve();};});});
  fixture.onCancel(async (route, input) => {const record = interaction(fixture.records.get(input.requestId)!.input, 'uncertain'); fixture.records.set(input.requestId, record); await route.fulfill({json: record});});
  await openPlan(page); await instruction(page).fill('Bounded synthetic plan'); await draftButton(page).click();
  await expect.poll(() => Boolean(finish)).toBe(true);
  await page.getByRole('button', {name: 'Stop E01 planning', exact: true}).click();
  await expect(page.getByText('E01 cleanup is unconfirmed. This request remains unresolved.', {exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Create new local draft', exact: true})).toBeDisabled();
  await page.locator('summary').filter({hasText: /^Execution controls$/}).click();
  await expect(page.getByRole('button', {name: 'Emergency stop', exact: true})).toBeDisabled();
  await finish!();
  await expect(page.getByText('E01 cleanup is unconfirmed. This request remains unresolved.', {exact: true})).toBeVisible();
  expect(fixture.calls.filter(call => call.path.endsWith('/cancel'))).toHaveLength(1);
});

test('changing projects isolates drafts and local edits without cancelling a request', async ({page}) => {
  const fixture = await managerFixture(page); await openPlan(page);
  await instruction(page).fill('First project instruction'); await notes(page).fill('First project note'); await draftButton(page).click();
  await expect(page.getByText('Synthetic interpretation', {exact: true})).toBeVisible();
  await page.getByRole('combobox', {name: 'Project scope'}).selectOption('project-other');
  await expect(instruction(page)).toHaveValue(''); await expect(notes(page)).toHaveValue('');
  await expect(page.getByText('Synthetic interpretation', {exact: true})).toHaveCount(0);
  await instruction(page).fill('Other project instruction');
  await page.getByRole('combobox', {name: 'Project scope'}).selectOption('project-fixture');
  await expect(instruction(page)).toHaveValue('First project instruction'); await expect(notes(page)).toHaveValue('First project note');
  await expect(page.getByText('Synthetic interpretation', {exact: true})).toBeVisible();
  expect(fixture.calls.filter(call => call.path.endsWith('/cancel'))).toHaveLength(0);
});

test('only an explicit new-draft action creates a new request identity after editing', async ({page}) => {
  const fixture = await managerFixture(page); await openPlan(page);
  await instruction(page).fill('First instruction'); await draftButton(page).click();
  await expect(page.getByText('Synthetic interpretation', {exact: true})).toBeVisible();
  await instruction(page).fill('Second instruction');
  expect(fixture.calls.filter(call => call.path.endsWith('/propose'))).toHaveLength(1);
  await page.getByRole('button', {name: 'Create new local draft', exact: true}).click();
  await expect.poll(() => fixture.calls.filter(call => call.path.endsWith('/propose')).length).toBe(2);
  const inputs = fixture.calls.filter(call => call.path.endsWith('/propose')).map(call => call.body as Input);
  expect(inputs[0].requestId).not.toBe(inputs[1].requestId);
  expect(inputs.map(input => input.instruction)).toEqual(['First instruction', 'Second instruction']);
  expect(Object.keys(inputs[0]).sort()).toEqual(['instruction', 'projectId', 'requestId']);
});

test('a mismatched project response cannot become a local draft', async ({page}) => {
  const fixture = await managerFixture(page);
  fixture.onPropose(async (route, input) => {await route.fulfill({json: interaction({...input, projectId: 'project-other'})});});
  await openPlan(page); await instruction(page).fill('Keep the exact project scope'); await draftButton(page).click();
  await expect(page.getByRole('alert')).toContainText('incompatible local E01 interaction');
  await expect(page.getByText('Synthetic interpretation', {exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Create new local draft', exact: true})).toBeDisabled();
});
