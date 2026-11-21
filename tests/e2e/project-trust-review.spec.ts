import { expect, test, type Page } from '@playwright/test';
import type { Operation } from '../../packages/contracts';
import { serveTaskFixture, taskFixture } from './task-interface-fixture';

async function fixture(page: Page) {
  const snapshot = taskFixture({ root: 'text', elements: { text: { type: 'Text', props: { text: 'Review this project test.' } } } });
  snapshot.artifacts = [];
  const operation: Operation = { id: 'trust-operation', threadId: 'task-thread', revision: 3, kind: 'repository.test',
    description: 'Run the prepared project test.', args: { resourceId: 'project-one', testFile: 'probe.test.cjs', recipe: 'node-test' },
    resourceIds: ['project-one'], preconditions: { testSha256: 'a'.repeat(64) }, status: 'prepared', approved: false,
    createdAt: '2026-11-17T00:00:00.000Z' };
  snapshot.operations = [operation];
  const host = await serveTaskFixture(page, snapshot);
  const target = { threadId: 'task-thread', operationId: 'trust-operation', operationRevision: 3 };
  const review = { version: 1, enabled: true, ...target, reviewId: 'review-current', expiresAt: new Date(Date.now() + 600_000).toISOString(),
    owner: { threadId: 'task-thread', runId: null, epoch: 0, projectId: null, workspaceId: null, accountBinding: null },
    root: { canonicalPath: 'C:/workspace/project', identity: { dev: '100', ino: '200' } },
    approvedDigests: [{ path: 'probe.test.cjs', sha256: 'a'.repeat(64), kind: 'configuration' }],
    requestedScope: { read: true, write: true, network: 'none' },
    execution: { mode: 'TRUSTED_HOST', label: 'Unrestricted host', executable: { path: 'C:/Program Files/Gen/node.exe', sha256: 'b'.repeat(64) },
      argv: ['--test', '--', 'probe.test.cjs'], cwd: 'C:/workspace/project', filesystem: 'unrestricted', network: 'unrestricted', processes: 'unrestricted', platformProofRef: null },
    current: { trustId: 'trust-current', revision: 0, decision: 'required' },
  };
  const decisions: unknown[] = [];
  let failure = false, reads = 0, hold: Promise<void> | undefined;
  await page.route('**/api/operation-project-trust**', async route => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET') {
      reads++;
      const captured = structuredClone(review), blocked = hold, failed = failure; hold = undefined;
      if (blocked) await blocked;
      if (failed) return route.fulfill({ status: 503, json: { error: { code: 'CAPABILITY_DENIED', message: 'Native file custody is unavailable.' } } });
      if (!captured.enabled) return route.fulfill({ json: { version: 1, enabled: false, ...target, reason: 'PROJECT_TRUST_DISABLED' } });
      if (url.searchParams.get('threadId') !== 'task-thread' || url.searchParams.get('operationId') !== 'trust-operation' || url.searchParams.get('operationRevision') !== '3')
        return route.fulfill({ status: 400, json: { error: { code: 'INVALID_INPUT', message: 'The operation target is required.' } } });
      if (url.pathname.endsWith('/status')) return route.fulfill({ json: { version: 1, enabled: true, ...target, owner: captured.owner, current: captured.current } });
      return route.fulfill({ json: captured });
    }
    const input = route.request().postDataJSON(); decisions.push(input);
    if (url.pathname.endsWith('/decisions')) {
      review.current = { trustId: 'trust-current', revision: 1, decision: input.decision };
      review.reviewId = 'review-after-decision';
    } else review.current = { trustId: 'trust-current', revision: 2, decision: 'revoked' };
    return route.fulfill({ json: { version: 1, ...target, current: review.current } });
  });
  return { review, snapshot, host, decisions, reads: () => reads,
    fail(value: boolean) { failure = value; },
    holdNext() { let release!: () => void; hold = new Promise<void>(done => { release = done; }); return release; },
    async open() { await page.goto('/'); await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled();
      return page.getByRole('region', { name:/^Operation approval:/, exact: true }); },
  };
}

test('trusting reviewed bytes requires explicit host selection and a separate operation approval', async ({ page }) => {
  const value = await fixture(page), approval = await value.open();
  await expect(approval.getByRole('button', { name: 'Approve operation', exact: true })).toBeDisabled();
  await approval.getByRole('button', { name: 'Review project trust', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Trust project bytes', exact: true });
  await expect(dialog).toContainText('C:/workspace/project');
  await expect(dialog).toContainText('a'.repeat(64));
  await expect(dialog).toContainText('b'.repeat(64));
  await expect(dialog).toContainText('Unrestricted host');
  const trust = dialog.getByRole('button', { name: 'Trust these bytes', exact: true });
  await expect(trust).toBeDisabled();
  await dialog.getByRole('checkbox', { name: 'Choose Unrestricted host for this operation', exact: true }).check();
  await trust.click();
  await expect.poll(() => value.decisions).toEqual([{ threadId: 'task-thread', operationId: 'trust-operation', operationRevision: 3,
    reviewId: 'review-current', expectedTrustRevision: 0, decision: 'trusted', executionMode: 'TRUSTED_HOST' }]);
  await expect(approval).toContainText('Trusted reviewed bytes');
  await expect(approval.getByRole('button', { name: 'Approve operation', exact: true })).toBeEnabled();
  expect(value.host.commands.filter(command => command.type.startsWith('operation.'))).toEqual([]);
  await approval.getByRole('button', { name: 'Approve operation', exact: true }).click();
  await expect.poll(() => value.host.commands.filter(command => command.type === 'operation.approve').length).toBe(1);
  expect(value.host.commands.find(command => command.type === 'operation.approve')?.payload).toEqual({ operationId: 'trust-operation', revision: 3 });
});

test('declining project trust leaves the operation unapproved', async ({ page }) => {
  const value = await fixture(page), approval = await value.open();
  await approval.getByRole('button', { name: 'Review project trust', exact: true }).click();
  await page.getByRole('dialog', { name: 'Trust project bytes', exact: true }).getByRole('button', { name: 'Decline', exact: true }).click();
  await expect.poll(() => value.decisions).toEqual([{ threadId: 'task-thread', operationId: 'trust-operation', operationRevision: 3,
    reviewId: 'review-current', expectedTrustRevision: 0, decision: 'declined' }]);
  await expect(approval.getByRole('button', { name: 'Approve operation', exact: true })).toBeDisabled();
  expect(value.host.commands.filter(command => command.type.startsWith('operation.'))).toEqual([]);
});

test('a late trust preview cannot replace the current owner review', async ({ page }) => {
  const value = await fixture(page), release = value.holdNext();
  try {
    const approval = await value.open();
    await expect.poll(value.reads).toBe(1);
    value.snapshot.threads[0].epoch = 1;
    value.review.owner.epoch = 1; value.review.reviewId = 'review-new-owner'; value.review.approvedDigests[0].sha256 = 'c'.repeat(64);
    await value.host.publish();
    await expect.poll(value.reads).toBe(2);
    await approval.getByRole('button', { name: 'Review project trust', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Trust project bytes', exact: true });
    await expect(dialog).toContainText('c'.repeat(64));
    const old = page.waitForResponse(async response => response.url().includes('/api/operation-project-trust?') && (await response.json()).reviewId === 'review-current');
    release(); await old;
    await expect(dialog).toContainText('c'.repeat(64));
    await expect(dialog).not.toContainText('a'.repeat(64));
    await dialog.getByRole('checkbox', { name: 'Choose Unrestricted host for this operation', exact: true }).check();
    await dialog.getByRole('button', { name: 'Trust these bytes', exact: true }).click();
    await expect.poll(() => (value.decisions[0] as { reviewId?: string } | undefined)?.reviewId).toBe('review-new-owner');
  } finally { release(); }
});

for (const mismatch of ['version', 'owner'] as const) test(`a ${mismatch}-mismatched preview cannot enable approval`, async ({ page }) => {
  const value = await fixture(page);
  if (mismatch === 'version') value.review.version = 2; else value.review.owner.epoch = 99;
  const approval = await value.open();
  await expect(approval).toContainText('Project trust could not be reviewed');
  await expect(approval.getByRole('button', { name: 'Approve operation', exact: true })).toBeDisabled();
  await expect(approval.getByRole('button', { name: 'Review project trust', exact: true })).toHaveCount(0);
});

test('unavailable trust remains blocked and reload performs only a new review read', async ({ page }) => {
  const value = await fixture(page); value.fail(true);
  const approval = await value.open();
  await expect(approval).toContainText('Project trust could not be reviewed');
  await expect(approval.getByRole('button', { name: 'Approve operation', exact: true })).toBeDisabled();
  value.fail(false);
  await approval.getByRole('button', { name: 'Reload project trust', exact: true }).click();
  await expect(approval.getByRole('button', { name: 'Review project trust', exact: true })).toBeEnabled();
  expect(value.decisions).toEqual([]);
  expect(value.host.commands.filter(command => command.type.startsWith('operation.'))).toEqual([]);
});

test('the disabled host capability preserves ordinary per-operation approval', async ({ page }) => {
  const value = await fixture(page); value.review.enabled = false;
  const approval = await value.open();
  await expect(approval.getByRole('button', { name: 'Approve operation', exact: true })).toBeEnabled();
  await expect(approval.getByRole('button', { name: 'Review project trust', exact: true })).toHaveCount(0);
  expect(value.decisions).toEqual([]);
});

test('changing to plan mode discards previously usable project trust', async ({ page }) => {
  const value = await fixture(page);
  value.review.current = { trustId: 'trust-current', revision: 1, decision: 'trusted' };
  const approval = await value.open();
  await expect(approval.getByRole('button', { name: 'Approve operation', exact: true })).toBeEnabled();
  value.snapshot.threads[0].mode = 'plan'; value.fail(true);
  await value.host.publish();
  await expect.poll(value.reads).toBe(2);
  await expect(approval).toContainText('Project trust could not be reviewed');
  await expect(approval.getByRole('button', { name: 'Approve operation', exact: true })).toBeDisabled();
  expect(value.decisions).toEqual([]);
});

test('changing the model clears trust readiness before the new review returns', async ({ page }) => {
  const value = await fixture(page);
  value.review.current = { trustId: 'trust-current', revision: 1, decision: 'trusted' };
  const approval = await value.open(), approve = approval.getByRole('button', { name: 'Approve operation', exact: true });
  await expect(approve).toBeEnabled();
  const release = value.holdNext();
  try {
    value.snapshot.threads[0].modelId = 'test/model-new'; value.fail(true);
    await value.host.publish();
    await expect(approve).toBeDisabled();
    await expect.poll(value.reads).toBe(2);
    await expect(approval).not.toContainText('Trusted reviewed bytes');
    release();
    await expect(approval).toContainText('Project trust could not be reviewed');
    await expect(approve).toBeDisabled();
    expect(value.decisions).toEqual([]);
    expect(value.host.commands.filter(command => command.type.startsWith('operation.'))).toEqual([]);
  } finally { release(); }
});

test('a late trust preview cannot replace the review after a model change', async ({ page }) => {
  const value = await fixture(page), release = value.holdNext();
  try {
    const approval = await value.open();
    await expect.poll(value.reads).toBe(1);
    value.snapshot.threads[0].modelId = 'test/model-new';
    value.review.reviewId = 'review-new-model'; value.review.approvedDigests[0].sha256 = 'c'.repeat(64);
    await value.host.publish();
    await expect.poll(value.reads).toBe(2);
    await approval.getByRole('button', { name: 'Review project trust', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Trust project bytes', exact: true });
    await expect(dialog).toContainText('c'.repeat(64));
    const old = page.waitForResponse(async response => response.url().includes('/api/operation-project-trust?') && (await response.json()).reviewId === 'review-current');
    release(); await old;
    await expect(dialog).toContainText('c'.repeat(64));
    await expect(dialog).not.toContainText('a'.repeat(64));
    await dialog.getByRole('checkbox', { name: 'Choose Unrestricted host for this operation', exact: true }).check();
    await dialog.getByRole('button', { name: 'Trust these bytes', exact: true }).click();
    await expect.poll(() => (value.decisions[0] as { reviewId?: string } | undefined)?.reviewId).toBe('review-new-model');
    expect(value.host.commands.filter(command => command.type.startsWith('operation.'))).toEqual([]);
  } finally { release(); }
});

test('a model change reloads recorded trust without retaining the old revoke control', async ({ page }) => {
  const value = await fixture(page);
  value.snapshot.operations[0].approved = true;
  value.review.current = { trustId: 'trust-current', revision: 1, decision: 'trusted' };
  await value.open();
  const status = page.getByRole('region', { name: 'Recorded project trust', exact: true });
  await expect(status).toContainText('Project trust recorded');
  await expect(status.getByRole('button', { name: 'Revoke project trust', exact: true })).toBeEnabled();
  const release = value.holdNext();
  try {
    value.snapshot.threads[0].modelId = 'test/model-new'; value.fail(true);
    await value.host.publish();
    await expect(status).not.toContainText('Project trust recorded');
    await expect(status.getByRole('button', { name: 'Revoke project trust', exact: true })).toHaveCount(0);
    await expect.poll(value.reads).toBe(2);
    release();
    await expect(status).toContainText('Recorded project trust is unavailable');
    expect(value.decisions).toEqual([]);
    expect(value.host.commands.filter(command => command.type.startsWith('operation.'))).toEqual([]);
  } finally { release(); }
});

test('revoking reviewed trust disables the separate operation approval', async ({ page }) => {
  const value = await fixture(page);
  value.review.current = { trustId: 'trust-current', revision: 1, decision: 'trusted' };
  const approval = await value.open();
  await expect(approval.getByRole('button', { name: 'Approve operation', exact: true })).toBeEnabled();
  await approval.getByRole('button', { name: 'Revoke project trust', exact: true }).click();
  await expect.poll(() => value.decisions).toEqual([{ threadId: 'task-thread', operationId: 'trust-operation', operationRevision: 3,
    trustId: 'trust-current', expectedTrustRevision: 1 }]);
  await expect(approval).toContainText('Project trust revoked');
  await expect(approval.getByRole('button', { name: 'Approve operation', exact: true })).toBeDisabled();
  expect(value.host.commands.filter(command => command.type.startsWith('operation.'))).toEqual([]);
});

test('trust can still be revoked after approval while the operation is queued', async ({ page }) => {
  const value = await fixture(page);
  value.review.current = { trustId: 'trust-current', revision: 1, decision: 'trusted' };
  const approval = await value.open();
  await approval.getByRole('button', { name: 'Approve operation', exact: true }).click();
  await expect.poll(() => value.host.commands.filter(command => command.type === 'operation.approve').length).toBe(1);
  value.snapshot.operations[0].approved = true;
  await value.host.publish();
  const outcome = page.getByRole('region', { name:/^Operation outcome:/, exact: true });
  await expect(outcome.getByRole('button', { name: 'Revoke project trust', exact: true })).toBeEnabled();
  await expect(outcome.getByRole('button', { name: 'Review project trust', exact: true })).toHaveCount(0);
  await expect(outcome.getByRole('button', { name: 'Approve operation', exact: true })).toHaveCount(0);
  await outcome.getByRole('button', { name: 'Revoke project trust', exact: true }).click();
  await expect.poll(() => value.decisions).toEqual([{ threadId: 'task-thread', operationId: 'trust-operation', operationRevision: 3,
    trustId: 'trust-current', expectedTrustRevision: 1 }]);
  await expect(outcome).toContainText('Project trust revoked');
  expect(value.host.commands.filter(command => command.type.startsWith('operation.'))).toHaveLength(1);
});

test('an expired review cannot submit trust or decline', async ({ page }) => {
  const value = await fixture(page); value.review.expiresAt = new Date(Date.now() - 1000).toISOString();
  const approval = await value.open();
  await approval.getByRole('button', { name: 'Review project trust', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Trust project bytes', exact: true });
  await expect(dialog).toContainText('This review expired');
  await expect(dialog.getByRole('button', { name: 'Trust these bytes', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Decline', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Reload project trust', exact: true })).toBeEnabled();
  expect(value.decisions).toEqual([]);
});

test('a narrow trust review wraps exact bytes and keeps keyboard decisions reachable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const value = await fixture(page), approval = await value.open();
  const opener = approval.getByRole('button', { name: 'Review project trust', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Trust project bytes', exact: true });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await dialog.getByRole('checkbox', { name: 'Choose Unrestricted host for this operation', exact: true }).focus();
  await page.keyboard.press('Space');
  const trust = dialog.getByRole('button', { name: 'Trust these bytes', exact: true });
  await expect(trust).toBeEnabled();
  await trust.focus();
  await expect(trust).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('project-trust-narrow.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(value.decisions).toEqual([]);
});
