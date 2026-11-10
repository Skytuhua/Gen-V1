import {expect, test, type Page} from '@playwright/test';
import samples from '../../packages/company-contracts/owner-work-plan-candidate.1/examples.json' with {type: 'json'};
import {createHash} from 'node:crypto';
import type {WorkPlanAuthorizeResponse} from '../../packages/company-contracts/work-plan';

const sample = (name: string) => structuredClone(samples.cases.find(item => item.name === name)!);
const proposed = sample('read_proposed').response as Extract<typeof samples.cases[number]['response'], {eligibility: unknown}>;
const canonical = (value: unknown): string => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}' : JSON.stringify(value);
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
function wrongBudget() {
  const value = sample('authorize_exact').response as unknown as WorkPlanAuthorizeResponse;
  const auth = value.authorization!;
  auth.work_order.record.budget_cents += 1;
  auth.work_order.digest = digest(auth.work_order.record);
  auth.owner_approval.scope = structuredClone(auth.work_order.record);
  const {digest: _authDigest, ...authBody} = auth; auth.digest = digest(authBody);
  value.receipt!.work_order_digest = auth.work_order.digest;
  const {digest: _receiptDigest, ...receiptBody} = value.receipt!; value.receipt!.digest = digest(receiptBody);
  return value;
}
async function setup(page: Page, forgedAuthorization = false) {
  const calls: {operation: string; body: Record<string, unknown>}[] = [];
  let accepted = false, stale = false, denied = false;
  await page.clock.install({time: new Date(100_000)});
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/bootstrap') return route.fulfill({json: {csrfToken: 'PUBLIC-work-plan-ui'}});
    if (path === '/api/company/workflow') return route.fulfill({json: {protocol: 'company-service.v1-draft1', mode: 'planning_only', recordInstruction: true, authorize: false, progress: false, result: false, blockers: [], workPlans: {configured: true}}});
    if (path.includes('/work-plan/')) {
      const operation = path.split('/').at(-1)!, body = route.request().postDataJSON(); calls.push({operation, body});
      if (operation === 'read') return denied ? route.fulfill({status: 403, json: {error: {code: 'scope_denied', message: 'PRIVATE-not-for-display'}}}) : route.fulfill({json: stale ? sample('read_historical_expired_superseded').response : accepted ? sample('read_authorized_recovery').response : proposed});
      if (operation === 'authorize') {accepted = true; return forgedAuthorization ? route.fulfill({json: wrongBudget()}) : route.fulfill({status: 503, json: {error: {code: 'COMPANY_TRANSPORT', message: 'Synthetic discarded reply'}}});}
      return route.fulfill({status: 409, json: {error: {code: 'stale_plan', message: 'Read the current plan'}}});
    }
    return route.fulfill({status: 503, json: {error: {code: 'COMPANY_UNAVAILABLE', message: 'Synthetic owner-work-plan fixture only'}}});
  });
  await page.goto('/company/communications');
  const instruction = (sample('propose_initial').response as {plan: {basis: {instruction: {record: Record<string, unknown>}}}}).plan.basis.instruction.record;
  await page.evaluate(async value => {
    const source = '/src/journal.ts';
    const journal = await import(source);
    await journal.journalWrite('company:leo-company:owner-task:v1', {projectId: 'alpha', instruction: value.instruction,
      request: {project_id: 'alpha', message_id: 'saved-intake', instruction: value.instruction},
      receipt: {protocol: 'company-service.v1-draft1', source: 'company_service', receivedAt: '1970-01-01T00:01:40.000Z', proposal: value}});
  }, instruction);
  await page.reload();
  return {calls, makeStale: () => {stale = true;}, denyRead: (value: boolean) => {denied = value;}};
}
test('exact review → explicit WorkOrder authorization → lost-reply read recovery never starts work', async ({page}) => {
  const {calls} = await setup(page);
  const panel = page.getByRole('region', {name: 'Work plan review'});
  await expect(panel).toBeVisible(); expect(calls).toHaveLength(0);
  await expect(panel.getByRole('button', {name: 'Authorize exact WorkOrder'})).toBeDisabled();
  await panel.getByRole('button', {name: 'Read saved plan', exact: true}).click();
  await expect(panel.getByText('Owner-forwarded plan · no model provenance', {exact: true})).toBeVisible();
  await expect(panel.locator('.company-exact-plan').getByText(proposed.plan.plan.summary, {exact: true})).toBeVisible();
  await expect(panel.getByText('Charter registration snapshot', {exact: true})).toBeVisible();
  await page.evaluate(() => {Object.defineProperty(crypto, 'randomUUID', {configurable: true, value: () => 'authorize-1'});});
  await panel.getByRole('button', {name: 'Authorize exact WorkOrder'}).click();
  await expect(panel.getByText(/Authorization outcome is unconfirmed/)).toBeVisible();
  const sent = calls.find(call => call.operation === 'authorize')!.body;
  expect(sent).toEqual(sample('authorize_exact').request);
  await page.reload(); await expect(panel).toBeVisible();
  expect(calls.filter(call => call.operation === 'authorize')).toHaveLength(1);
  await panel.getByRole('button', {name: 'Recover authorization receipt', exact: true}).click();
  await expect(panel.getByText('WorkOrder stored', {exact: true})).toBeVisible();
  await expect(panel.getByText('No tasks created · dispatch disabled · live readiness unverified', {exact: true})).toBeVisible();
  expect(calls.filter(call => call.operation === 'authorize')).toHaveLength(1);
  expect(calls.at(-1)?.body.plan_ref).toEqual(sent.plan_ref);
  await expect(page.getByRole('button', {name: 'Open result unavailable'})).toBeDisabled();
});
test('reopen needs fresh exact review and superseded authorization never becomes current authority', async ({page}) => {
  const {calls, makeStale} = await setup(page), panel = page.getByRole('region', {name: 'Work plan review'});
  await panel.getByRole('button', {name: 'Read saved plan', exact: true}).click();
  await expect(panel.getByRole('button', {name: 'Authorize exact WorkOrder'})).toBeEnabled();
  await page.reload();
  await expect(panel.getByRole('button', {name: 'Authorize exact WorkOrder'})).toBeDisabled();
  makeStale(); await panel.getByRole('button', {name: 'Read saved plan', exact: true}).click();
  await expect(panel.getByText('Historical authorization · current authority unavailable', {exact: true})).toBeVisible();
  await expect(panel.getByRole('button', {name: 'Authorize exact WorkOrder'})).toBeDisabled();
  expect(calls.every(call => call.operation === 'read')).toBe(true);
});
test('closed stale rejection preserves its envelope without permanently locking the editable draft', async ({page}) => {
  const {calls} = await setup(page), panel = page.getByRole('region', {name: 'Work plan review'});
  await panel.getByText('Prepare a proposed plan', {exact: true}).click();
  await panel.getByRole('textbox', {name: 'Plan summary', exact: true}).fill('A changed owner proposal');
  await panel.getByRole('textbox', {name: 'Step instruction', exact: true}).fill('Inspect approved source');
  await panel.getByRole('textbox', {name: 'Acceptance checks (one per line)', exact: true}).fill('Return a bounded report');
  await panel.getByRole('button', {name: 'Store proposed plan', exact: true}).click();
  await expect(panel.getByText(/Proposed plan was rejected/)).toBeVisible();
  await expect(panel.getByRole('textbox', {name: 'Plan summary', exact: true})).toBeEnabled();
  const first = calls.find(call => call.operation === 'propose')!;
  expect(first.body.expected_head_ref).toBeNull();
  await panel.getByRole('button', {name: 'Read saved plan', exact: true}).click();
  await panel.getByRole('button', {name: 'Store proposed plan', exact: true}).click();
  await expect.poll(() => calls.filter(call => call.operation === 'propose').length).toBe(2);
  const requests = calls.filter(call => call.operation === 'propose'); expect(requests).toHaveLength(2);
  expect(requests[1].body.message_id).not.toBe(requests[0].body.message_id);
  expect(requests[1].body.expected_head_ref).toEqual(sample('authorize_exact').request.plan_ref);
});
test('a self-consistent wrong-budget receipt cannot confirm the reviewed WorkOrder', async ({page}) => {
  await setup(page, true); const panel = page.getByRole('region', {name: 'Work plan review'});
  await panel.getByRole('button', {name: 'Read saved plan', exact: true}).click();
  await page.evaluate(() => {Object.defineProperty(crypto, 'randomUUID', {configurable: true, value: () => 'authorize-1'});});
  await panel.getByRole('button', {name: 'Authorize exact WorkOrder'}).click();
  await expect(panel.getByText(/Authorization outcome is unconfirmed/)).toBeVisible();
  await expect(panel.getByRole('region', {name: 'Stored WorkOrder receipt'})).toHaveCount(0);
});
test('denied protected plan is hidden in both review and editor while the local journal is retained', async ({page}) => {
  const {denyRead} = await setup(page), panel = page.getByRole('region', {name: 'Work plan review'});
  await panel.getByRole('button', {name: 'Read saved plan', exact: true}).click();
  await panel.getByText('Prepare a proposed plan', {exact: true}).click();
  await expect(panel.getByRole('textbox', {name: 'Plan summary', exact: true})).toHaveValue(proposed.plan.plan.summary);
  denyRead(true); await panel.getByRole('button', {name: 'Read saved plan', exact: true}).click();
  await expect(panel.getByText(/Current company access was denied/)).toBeVisible();
  await expect(panel.getByRole('textbox', {name: 'Plan summary', exact: true})).toHaveCount(0);
  await expect(panel.locator('.company-exact-plan')).toHaveCount(0);
  await page.reload(); await expect(panel).toBeVisible();
  await expect(panel.getByRole('textbox', {name: 'Plan summary', exact: true})).toHaveCount(0);
  denyRead(false); await panel.getByRole('button', {name: 'Read saved plan', exact: true}).click();
  await expect(panel.getByText('Prepare a proposed plan', {exact: true})).toBeVisible();
  await panel.getByText('Prepare a proposed plan', {exact: true}).click();
  await expect(panel.getByRole('textbox', {name: 'Plan summary', exact: true})).toHaveValue(proposed.plan.plan.summary);
});
test('a bounded partial draft with nine checks survives reopen and remains editable but cannot submit', async ({page}) => {
  const {calls} = await setup(page), panel = page.getByRole('region', {name: 'Work plan review'});
  await panel.getByText('Prepare a proposed plan', {exact: true}).click();
  await panel.getByRole('textbox', {name: 'Plan summary', exact: true}).fill('Owner partial draft');
  const checks = Array.from({length: 9}, (_, index) => `Check ${index + 1}`).join('\n');
  await panel.getByRole('textbox', {name: 'Acceptance checks (one per line)', exact: true}).fill(checks);
  await expect(panel.getByText('Plan draft saved on this device · not submitted', {exact: true})).toBeVisible();
  await page.reload(); await panel.getByText('Prepare a proposed plan', {exact: true}).click();
  await expect(panel.getByRole('textbox', {name: 'Acceptance checks (one per line)', exact: true})).toHaveValue(checks);
  await expect(panel.getByRole('textbox', {name: 'Plan summary', exact: true})).toBeEnabled();
  await expect(panel.getByRole('button', {name: 'Store proposed plan', exact: true})).toBeDisabled();
  expect(calls).toHaveLength(0);
});
