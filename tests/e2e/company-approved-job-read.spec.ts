import {expect, test} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {companyCspTestHost} from './company-production-csp-host';
import type {WorkPlanReadRequest, WorkPlanReadResponse} from '../../packages/company-contracts/work-plan';
import type {ApprovedJobRead} from '../../packages/company-contracts/approved-job-read';
const sample = JSON.parse(readFileSync('packages/company-contracts/owner-work-plan-candidate.1/examples.json', 'utf8')).cases[3] as {request: WorkPlanReadRequest; response: WorkPlanReadResponse}, auth = sample.response.authorization!;
const binding: ApprovedJobRead = {companyId: 'leo-company', projectId: 'alpha', instructionId: sample.request.instruction_id, planRef: sample.request.plan_ref!, workOrderId: auth.authorization.work_order.id, authorizationDigest: auth.authorization.digest, authorizationExpiresAt: auth.authorization.expires_at_epoch_seconds};
let host: Awaited<ReturnType<typeof companyCspTestHost>>;
test.beforeAll(async () => {host = await companyCspTestHost();});
test.afterAll(async () => {await host.close();});
test('existing plan view reads an exact approved job without write controls and preserves drafts under production CSP', async ({page}) => {
  const posts: string[] = []; let deny = false;
  await page.addInitScript(() => {Object.assign(window, {approvedCspViolations: []}); document.addEventListener('securitypolicyviolation', event => (window as unknown as {approvedCspViolations: string[]}).approvedCspViolations.push(event.effectiveDirective));});
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === 'POST') posts.push(path);
    if (path === '/api/bootstrap') return route.fulfill({json: {csrfToken: 'PUBLIC-approved-read-browser-fixture'}});
    if (path === '/api/company/connection') return route.fulfill({json: {configured: false, protocol: 'company-service.v1-draft1', serviceBaseline: 'fixture-only', mode: 'read_only', ownerAuthenticated: false, capabilities: {status: false}, blockers: []}});
    if (path === '/api/company/workflow') return route.fulfill({json: {protocol: 'company-service.v1-draft1', mode: 'planning_only', recordInstruction: false, authorize: false, progress: false, result: false, blockers: [], workPlans: {configured: true, readOnly: true}, approvedJob: binding}});
    if (path === '/api/company/workflow/work-plan/read') {
      expect(request.postDataJSON()).toEqual(sample.request);
      return route.fulfill(deny ? {status: 403, json: {error: {code: 'scope_denied'}}} : {json: sample.response});
    }
    return route.fulfill({status: 503, json: {error: {code: 'COMPANY_UNAVAILABLE', message: 'Unavailable in this browser fixture'}}});
  });
  const response = await page.goto(host.origin + '/company/communications');
  expect(response?.headers()['content-security-policy']).toBe(host.csp);
  await expect(page.getByRole('heading', {name: 'Approved job · read-only'})).toBeVisible();
  const draft = page.getByRole('textbox', {name: 'Task outcome', exact: true}); await expect(draft).toBeEnabled(); await draft.fill('Keep this unsent owner draft');
  await expect(page.getByText('Saved on this device · not submitted', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Load approved job', exact: true}).click();
  await expect(page.getByText(sample.response.plan.plan.summary, {exact: true})).toBeVisible();
  await expect(page.getByText('WorkOrder ' + binding.workOrderId, {exact: true})).toBeVisible();
  await expect(page.getByText('Planned steps and staffing are not queued tasks or admitted employees. Current execution remains unavailable.', {exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Authorize exact WorkOrder', exact: true})).toHaveCount(0);
  await expect(page.getByText('Prepare a proposed plan', {exact: true})).toHaveCount(0);
  await page.reload(); await expect(draft).toHaveValue('Keep this unsent owner draft');
  await expect(page.getByText(sample.response.plan.plan.summary, {exact: true})).toBeVisible();
  await expect(page.getByText('Saved read · current eligibility has not been refreshed.', {exact: true})).toBeVisible();
  deny = true; await page.getByRole('button', {name: 'Load approved job', exact: true}).click();
  await expect(page.getByText(/Current company access was denied. Protected plan records are hidden/)).toBeVisible();
  await expect(page.getByText(sample.response.plan.plan.summary, {exact: true})).toHaveCount(0);
  expect(posts).toEqual(['/api/company/workflow/work-plan/read', '/api/company/workflow/work-plan/read']);
  expect(await page.evaluate(() => (window as unknown as {approvedCspViolations: string[]}).approvedCspViolations)).toEqual([]);
});
