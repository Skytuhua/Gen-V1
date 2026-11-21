import { test, expect, type Page } from '@playwright/test';

const now = '2026-11-21T12:00:00.000Z';
const finding = (id: string, name: string, severity: string, fixed = ['2.0.1']) => ({
  occurrence: { occurrenceId: id, ecosystem: 'npm', name, installedVersion: '1.0.0', directness: 'direct', lockPath: 'package-lock.json', importerPath: 'package.json' },
  advisoryIds: ['GHSA-aaaa-bbbb-cccc'], severity, severitySource: 'github-advisory', fixedVersions: fixed, upgradeCandidate: fixed[0] ?? null, candidateEligible: true,
});
const coverage = [
  { relativePath: 'package-lock.json', format: 'npm-lock', status: 'scanned', lockfileDigest: 'a'.repeat(64) },
  { relativePath: 'vendor/go.sum', format: 'golang', status: 'skipped_manifest', lockfileDigest: null },
];
const result = (over: Record<string, unknown> = {}) => ({
  scanId: 'op-1', status: 'complete', checkedAt: now, scopeKey: 'scope', inputDigest: 'd'.repeat(64), fresh: true,
  coverage, queriedCount: 2, findings: [finding('f-med', 'left-pad', 'medium'), finding('f-crit', 'openssl-wrapper', 'critical')],
  remoteAlerts: [], remoteAlertState: 'not_requested', ...over,
});
const preparedOp = { id: 'op-1', threadId: 't1', revision: 1, kind: 'integration.dependency.scan', args: { owner: { projectId: 'p1', threadId: 't1' } }, resourceIds: [], preconditions: { inputDigest: 'd'.repeat(64) }, description: 'Check 2 pinned dependencies from this working copy against the public OSV advisory database.', status: 'prepared', approved: false, createdAt: now };

interface Fixture { available: boolean; github: boolean; result: unknown; delayed: boolean; commands: { type: string; payload: unknown }[] }
const setup = async (page: Page, fixture: Partial<Fixture> = {}) => {
  const state: Fixture = { available: true, github: true, result: null, delayed: false, commands: [], ...fixture };
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname, method = route.request().method();
    if (path === '/api/bootstrap') return route.fulfill({ json: { csrfToken: 'fixture-csrf', widgetOrigin: 'http://localhost:4318' } });
    if (path === '/api/commands' && method === 'POST') {
      const body = route.request().postDataJSON() as { id: string; type: string; payload: unknown };
      state.commands.push({ type: body.type, payload: body.payload });
      return route.fulfill({ json: { commandId: body.id, eventSeq: 1, result: {} } });
    }
    if (path === '/api/projects/p1/dependency-check/capability')
      return state.available ? route.fulfill({ json: { available: true, sources: { osv: true, github: state.github } } }) : route.fulfill({ status: 404, json: { error: { code: 'CAPABILITY_DENIED' } } });
    if (path === '/api/projects/p1/dependency-check/result')
      return state.result ? route.fulfill({ json: state.result }) : route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND' } } });
    if (path === '/api/projects/p1/dependency-check/scan' && method === 'POST') return route.fulfill({ json: preparedOp });
    if (path === '/api/projects/p1/dependency-check/scan/run' && method === 'POST') {
      if (!state.delayed) state.result = result();
      return route.fulfill({ json: { operationId: 'op-1' } });
    }
    if (path === '/api/projects/p1/dependency-check/scan/cancel' && method === 'POST') return route.fulfill({ json: { ...preparedOp, status: 'cancelled' } });
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND' } } });
  });
  await page.goto('/fixture');
  return state;
};
const card = (page: Page) => page.locator('section.dep-check');

test('idle to approve renders severity-sorted findings, evidence and upgrade draft', async ({ page }) => {
  const state = await setup(page);
  await expect(card(page)).toBeVisible();
  await expect(card(page).getByRole('button', { name: 'Check dependencies' })).toBeVisible();
  await page.getByLabel('Include GitHub repository alerts').check();
  await card(page).getByRole('button', { name: 'Check dependencies' }).click();
  await expect(card(page).getByText(/Check 2 pinned dependencies/)).toBeVisible();
  await card(page).getByRole('button', { name: 'Approve and check' }).click();
  expect(state.commands.map(c => c.type)).toContain('operation.approve');
  await expect(card(page).getByText('Local lockfile results')).toBeVisible({ timeout: 8000 });
  const rows = card(page).locator('.dep-check-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('openssl-wrapper');
  await expect(rows.first().locator('.dep-check-severity-critical')).toContainText('Critical');
  await rows.first().getByRole('button').first().click();
  const link = card(page).locator('.dep-check-detail a').first();
  await expect(link).toHaveAttribute('href', 'https://osv.dev/vulnerability/GHSA-aaaa-bbbb-cccc');
  await card(page).getByRole('button', { name: 'Ask agent to upgrade' }).click();
  await expect.poll(() => page.evaluate(async () => {
    const path = '/apps/web/src/journal.ts', journal = await import(path);
    return (await journal.journalRead('draft:t1')) ?? '';
  })).toContain('Prepare an upgrade for dependency check op-1');
  await card(page).locator('select').selectOption('medium');
  await expect(rows).toHaveCount(1);
  await card(page).locator('select').selectOption('low');
  await expect(card(page).getByText('No findings match this filter.')).toBeVisible();
  await card(page).locator('select').selectOption('all');
  await card(page).getByText('Coverage — 2 lockfiles considered, 1 skipped').click();
  await expect(card(page).getByText('skipped manifest')).toBeVisible();
});

test('decline returns to idle without dispatching the scan', async ({ page }) => {
  const state = await setup(page);
  await card(page).getByRole('button', { name: 'Check dependencies' }).click();
  await card(page).getByRole('button', { name: 'Decline' }).click();
  await expect(card(page).getByRole('button', { name: 'Check dependencies' })).toBeVisible();
  expect(state.commands.map(c => c.type)).toContain('operation.reject');
  expect(state.commands.map(c => c.type)).not.toContain('operation.approve');
});

test('cancel during running aborts and shows no replacement results', async ({ page }) => {
  const state = await setup(page, { delayed: true });
  await card(page).getByRole('button', { name: 'Check dependencies' }).click();
  await card(page).getByRole('button', { name: 'Approve and check' }).click();
  await expect(card(page).locator('.dep-check-skeleton')).toBeVisible();
  await card(page).getByRole('button', { name: 'Cancel check' }).click();
  await expect.poll(() => state.commands.length + 0 && page.locator('.dep-check').locator('text=Local lockfile results').count()).toBe(0);
  await expect(card(page).getByRole('button', { name: 'Check dependencies' })).toBeVisible();
});

test('partial and stale states label evidence instead of implying a clean result', async ({ page }) => {
  await setup(page, { result: result({ status: 'partial' }) });
  await expect(card(page)).toBeVisible();
  await expect(card(page).getByText(/Partial — some advisory lookups did not answer/)).toBeVisible();
  await expect(card(page).locator('.dep-check-row')).toHaveCount(2);
});

test('stale result labels old evidence and blocks the upgrade action', async ({ page }) => {
  await setup(page, { result: result({ status: 'stale', fresh: false }) });
  await expect(card(page).getByText(/Out of date — lockfiles changed/)).toBeVisible();
  await card(page).locator('.dep-check-row').first().getByRole('button').first().click();
  await expect(card(page).getByRole('button', { name: 'Ask agent to upgrade' })).toHaveCount(0);
});

test('flag-off hides the card entirely', async ({ page }) => {
  await setup(page, { available: false });
  await expect(card(page)).toHaveCount(0);
});

test('narrow viewport stacks row fields and keeps controls reachable', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 });
  await setup(page, { result: result() });
  await expect(card(page)).toBeVisible();
  const versions = card(page).locator('.dep-check-versions').first();
  const row = card(page).locator('.dep-check-row-main').first();
  const vb = await versions.boundingBox(), rb = await row.boundingBox();
  expect(vb!.width).toBeGreaterThan(rb!.width * 0.7);
});
