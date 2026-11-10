import {expect, test, type Page} from '@playwright/test';

const command = {project_id: 'alpha', message_id: 'fixed', instruction: 'Inspect the approved build. Publish nothing.'};
const proposal = {id: 'proposal-1', project_id: 'alpha', instruction: command.instruction, kind: 'planning_proposal', state: 'planning_only', planner: 'capability_missing', model_produced: false, dispatch_authorized: false, live_ready: false, evidence_scope: 'local_owner_instruction', blockers: ['Native task execution is unavailable.']};
async function fixture(page: Page, configured: boolean, uncertain = false) {
  const sent: typeof command[] = [];
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/bootstrap') return route.fulfill({json: {csrfToken: 'PUBLIC-workflow'}});
    if (path === '/api/company/workflow') return route.fulfill({json: {protocol: 'company-service.v1-draft1', mode: 'planning_only', recordInstruction: configured, authorize: false, progress: false, result: false, blockers: ['Live team is unavailable.']}});
    if (path === '/api/company/workflow/instruction') {
      sent.push(route.request().postDataJSON());
      if (uncertain && sent.length === 1) return route.fulfill({status: 503, json: {error: {code: 'COMPANY_TRANSPORT', message: 'Unconfirmed'}}});
      return route.fulfill({json: {protocol: 'company-service.v1-draft1', source: 'company_service', receivedAt: new Date().toISOString(), proposal: {...proposal, instruction: sent.at(-1)!.instruction}}});
    }
    return route.fulfill({status: 503, json: {error: {code: 'COMPANY_UNAVAILABLE', message: 'No live company connection'}}});
  });
  return sent;
}
test('owner saves an unsent task and sees plan, progress and result unavailable without live authority', async ({page}) => {
  const sent = await fixture(page, false);
  await page.goto('/company/communications');
  const panel = page.getByRole('region', {name: 'Owner task'});
  await expect(panel).toBeVisible();
  const draft = panel.getByRole('textbox', {name: 'Task outcome'});
  await expect(draft).toBeEnabled(); await draft.fill(command.instruction);
  await expect(panel.getByText('Saved on this device · not submitted', {exact: true})).toBeVisible();
  await expect(panel.getByRole('button', {name: 'Request plan', exact: true})).toBeDisabled();
  await expect(panel.getByRole('button', {name: 'Authorize task unavailable'})).toBeDisabled();
  await expect(panel.getByRole('button', {name: 'Open result unavailable'})).toBeDisabled();
  await page.reload(); await expect(draft).toHaveValue(command.instruction); expect(sent).toHaveLength(0);
});
test('owner records one instruction through host; explicit recovery retains exact request after lost response', async ({page}) => {
  const sent = await fixture(page, true, true);
  await page.goto('/company/communications');
  const panel = page.getByRole('region', {name: 'Owner task'});
  // No project status is provided. Exact scope must be chosen by the owner and
  // will be independently authorized by Company Control, never a fixture default.
  await panel.getByRole('textbox', {name: 'Project ID'}).fill('alpha');
  await panel.getByRole('textbox', {name: 'Task outcome'}).fill(command.instruction);
  await panel.getByRole('button', {name: 'Request plan', exact: true}).click();
  await expect(panel.getByText(/Submission is unconfirmed/)).toBeVisible();
  expect(sent).toHaveLength(1);
  await page.reload(); await expect(panel.getByText(/Submission is unconfirmed/)).toBeVisible(); expect(sent).toHaveLength(1);
  await panel.getByRole('button', {name: 'Check saved request'}).click();
  await expect(panel.getByText('Instruction recorded · executable plan unavailable', {exact: true})).toBeVisible();
  expect(sent).toHaveLength(2); expect(sent[1]).toEqual(sent[0]);
  await expect(panel.getByRole('button', {name: 'Authorize task unavailable'})).toBeDisabled();
  await expect(panel.getByText('Native task execution is unavailable.', {exact: true})).toBeVisible();
  await expect(panel.getByText('Real employee progress unavailable', {exact: true})).toBeVisible();
});
test('native company keeps its exact URL and flushes saved work before close', async ({page}) => {
  await fixture(page, false);
  await page.addInitScript(() => {
    const state = window as unknown as {harnessDesktop: unknown; companyReady: boolean; closeCompany?: () => Promise<boolean>};
    state.harnessDesktop = {ready: async () => {state.companyReady = true;}, onCloseRequested: (handler: () => Promise<boolean>) => {state.closeCompany = handler; return () => {};}};
  });
  await page.goto('/company/communications?desktopWindow=test-company');
  await expect.poll(() => page.evaluate(() => (window as unknown as {companyReady: boolean}).companyReady)).toBe(true);
  const source = page.getByRole('combobox', {name: 'Communication data source'});
  await source.selectOption('fixture');
  await expect(page.getByText('Synthetic fixture · no live employees', {exact: true})).toBeVisible();
  await expect(page).toHaveURL(/\/company\/communications\?desktopWindow=test-company$/);
  expect(await page.evaluate(() => (window as unknown as {closeCompany: () => Promise<boolean>}).closeCompany())).toBe(true);
  await page.reload(); await expect(source).toHaveValue('fixture');
});
test('native recovery errors remain visible and failed draft flush denies close', async ({page}) => {
  await fixture(page, false);
  await page.addInitScript(() => {
    const state = window as unknown as {harnessDesktop: unknown; companyReady: boolean; closeCompany?: () => Promise<boolean>};
    state.harnessDesktop = {ready: async () => {state.companyReady = true;}, onCloseRequested: (handler: () => Promise<boolean>) => {state.closeCompany = handler; return () => {};}};
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function(query) {
      if (query === 'company:leo-company:owner-task:v1') throw new DOMException('Owned recovery fixture', 'AbortError');
      return get.call(this, query);
    };
  });
  await page.goto('/company/communications?desktopWindow=test-recovery');
  await expect.poll(() => page.evaluate(() => (window as unknown as {companyReady: boolean}).companyReady)).toBe(true);
  await expect(page.getByRole('textbox', {name: 'Task outcome'})).toBeDisabled();
  await expect(page.getByText(/Draft recovery unavailable. Keep this window open/)).toBeVisible();
  // A later owner-note write fails in this task-owned browser storage only.
  await page.evaluate(() => {IDBObjectStore.prototype.put = () => {throw new DOMException('Owned write fixture', 'QuotaExceededError');};});
  await page.getByRole('textbox', {name: 'Owner notes', exact: true}).fill('Keep this unsaved note visible');
  await expect(page.getByText('Save failed · keep this window open', {exact: true})).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as {closeCompany: () => Promise<boolean>}).closeCompany())).toBe(false);
  await expect(page.getByText(/Saved work could not be flushed/)).toBeVisible();
  await expect(page.getByRole('textbox', {name: 'Owner notes', exact: true})).toHaveValue('Keep this unsaved note visible');
});
