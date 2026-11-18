import { expect, test, type Page } from '@playwright/test';
import type { Operation, Thread } from '../../packages/contracts';
import type { OperationExecutionReview } from '../../packages/contracts/operation-execution-review';
import { serveTaskFixture, taskFixture } from './task-interface-fixture';

const firstTime = '2026-11-17T00:00:00.000Z', nextTime = '2026-11-18T00:00:00.000Z';
async function fixture(page: Page, kind = 'repository.test') {
  const snapshot = taskFixture({ root: 'text', elements: { text: { type: 'Text', props: { text: 'Review the prepared operation.' } } } });
  snapshot.artifacts = [];
  const operation: Operation = { id: 'advice-operation', threadId: 'task-thread', revision: 3, kind,
    description: 'Run the prepared operation.', args: {}, resourceIds: [], preconditions: {},
    status: 'prepared', approved: false, createdAt: firstTime };
  snapshot.operations = [operation];
  const host = await serveTaskFixture(page, snapshot), thread = snapshot.threads[0];
  const target = () => ({ threadId: operation.threadId, operationId: operation.id, operationRevision: operation.revision });
  const owner = () => ({ threadId: thread.id, runId: thread.runId, epoch: thread.epoch, accountBinding: thread.accountId ?? null,
    projectId: thread.projectId ?? null, workspaceId: thread.workspaceId ?? null });
  let advice: OperationExecutionReview['advice'] = { state: 'RECORDED', validation: 'NOT_REVALIDATED', recorded: {
    recordedAt: firstTime, decisionAtPreparation: 'REQUIRE_APPROVAL', advisory: { label: 'Advisory',
      classifier: 'execution-policy-advisory', model: 'deterministic-v1', version: '1.0.0', uncertainty: 'low',
      rationale: 'The launch matches the approved executable allowlist.', cannotAuthorize: true } } };
  let reads = 0, hold: Promise<void> | undefined, unavailable = false;
  let transform = (value: OperationExecutionReview): unknown => value;
  await page.route('**/api/operation-execution-review?**', async route => {
    reads++;
    const view: OperationExecutionReview = { version: 1, ...target(), current: { owner: owner(), operationStatus: operation.status,
      approved: operation.approved, threadStatus: thread.status, threadMode: thread.mode ?? 'build', archived: false, authority: 'NOT_EVALUATED' },
      execution: { mode: 'TRUSTED_HOST', backendId: 'TRUSTED_HOST', runner: operation.kind === 'repository.test' ? 'repository-test' : 'context7-stdio',
        policy: { filesystem: 'unrestricted', network: 'unrestricted', processes: 'unrestricted' }, isolated: { status: 'BLOCKED',
          stage: 'ISOLATED_EXECUTION', code: 'UNSUPPORTED_BACKEND', reason: 'No approved backend was selected.', approvedBackendId: null, platformProofRef: null } }, advice };
    const captured = structuredClone(transform(view)), wait = hold; hold = undefined;
    if (wait) await wait;
    if (unavailable) return route.fulfill({ status: 503, json: { error: { code: 'HOST_ERROR', message: 'synthetic-private-diagnostic' } } });
    return route.fulfill({ json: captured });
  });
  await page.route('**/api/operation-project-trust**', route => route.fulfill({ json: { version: 1, enabled: true, ...target(),
    reviewId: 'review-current', expiresAt: new Date(Date.now() + 600_000).toISOString(), owner: owner(),
    root: { canonicalPath: 'C:/owned/project', identity: { dev: '1', ino: '2' } },
    approvedDigests: [{ path: 'probe.test.cjs', sha256: 'a'.repeat(64), kind: 'configuration' }],
    requestedScope: { read: true, write: false, network: 'none' },
    execution: { mode: 'TRUSTED_HOST', label: 'Unrestricted host', executable: { path: 'C:/owned/node.exe', sha256: 'b'.repeat(64) },
      argv: ['--test', '--', 'probe.test.cjs'], cwd: 'C:/owned/project', filesystem: 'unrestricted', network: 'unrestricted', processes: 'unrestricted', platformProofRef: null },
    current: { trustId: 'trust-current', revision: 1, decision: 'declined' } } }));
  return { host, snapshot, operation, thread, reads: () => reads,
    advice(value: OperationExecutionReview['advice']) { advice = value; },
    fresh() { if (advice.state !== 'UNAVAILABLE') advice = { ...advice, recorded: { ...advice.recorded, recordedAt: nextTime } }; },
    transform(value: typeof transform) { transform = value; }, unavailable() { unavailable = true; },
    holdNext() { let release!: () => void; hold = new Promise<void>(resolve => { release = resolve; }); return release; },
    async open() { await page.goto('/'); await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled();
      return page.locator('[data-operation-id="advice-operation"]'); },
  };
}

test('historical advice follows the trust decision and cannot enable a declined operation', async ({ page }) => {
  const value = await fixture(page), operation = await value.open(), review = operation.getByRole('region', { name: 'Execution review', exact: true });
  await expect(operation.getByRole('region', { name: 'Project trust', exact: true })).toContainText('Project trust declined');
  await expect(review).toContainText('Historical preparation requirement: approval required');
  await expect(review).toContainText('Permission to run has not been evaluated here');
  await expect(review).toContainText('deterministic-v1'); await expect(review).toContainText('1.0.0');
  await expect(review).toContainText('Uncertainty: low');
  await expect(review).toContainText('The launch matches the approved executable allowlist.');
  await expect(operation.getByRole('button', { name: 'Approve operation', exact: true })).toBeDisabled();
  expect(await review.evaluate(element => Boolean(element.parentElement?.querySelector('.project-trust-summary')?.compareDocumentPosition(element)! & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  expect(value.host.commands.filter(command => command.type.startsWith('operation.'))).toEqual([]);
});

test('Context7 shows its actual host runner, unrestricted policy and blocked isolation stage', async ({ page }) => {
  const value = await fixture(page, 'integration.context7'), operation = await value.open(), review = operation.getByRole('region', { name: 'Execution review', exact: true });
  await expect(operation.getByRole('note', { name: 'Execution policy', exact: true })).toContainText('Unrestricted host');
  await expect(review).toContainText('TRUSTED_HOST'); await expect(review).toContainText('context7-stdio');
  await expect(review).toContainText('Files: unrestricted'); await expect(review).toContainText('Network: unrestricted');
  await expect(review).toContainText('Child processes: unrestricted'); await expect(review).toContainText('Blocked stage: isolated execution');
  await expect(review).toContainText('No approved isolation backend or platform proof is attached');
  await expect(operation.getByRole('button', { name: 'Approve operation', exact: true })).toBeEnabled();
  expect(value.host.commands.filter(command => command.type.startsWith('operation.'))).toEqual([]);
});

test('stale provenance remains historical and unavailable advice cannot invent a classifier', async ({ page }) => {
  const value = await fixture(page, 'integration.context7');
  value.transform(view => ({ ...view, advice: { ...view.advice, state: 'STALE', reason: 'TRUST_CHANGED' } }));
  const operation = await value.open(), review = operation.getByRole('region', { name: 'Execution review', exact: true });
  await expect(review).toContainText('Historical advice is stale'); await expect(review).toContainText('Project trust changed');
  value.transform(view => view); value.advice({ state: 'UNAVAILABLE', reason: 'COMPUTATION_FAILED' });
  await review.getByRole('button', { name: 'Reload execution review', exact: true }).click();
  await expect(review).toContainText('Advisory computation was unavailable'); await expect(review).not.toContainText('deterministic-v1');
  await expect(operation.getByRole('button', { name: 'Approve operation', exact: true })).toBeEnabled();
});

for (const malformed of ['version', 'owner', 'state', 'rationale', 'private-field'] as const) test(`a ${malformed} mismatch is discarded without exposing the response`, async ({ page }) => {
  const value = await fixture(page, 'integration.context7');
  value.transform(view => {
    if (malformed === 'version') return { ...view, version: 2 };
    if (malformed === 'owner') return { ...view, current: { ...view.current, owner: { ...view.current.owner, epoch: 99 } } };
    if (malformed === 'state') return { ...view, current: { ...view.current, approved: true } };
    if (malformed === 'private-field') return { ...view, secret: 'synthetic-private-response' };
    return { ...view, advice: { ...view.advice, recorded: { ...(view.advice.state !== 'UNAVAILABLE' ? view.advice.recorded : {}),
      advisory: { ...(view.advice.state !== 'UNAVAILABLE' ? view.advice.recorded.advisory : {}), rationale: 'synthetic-private-response' } } } };
  });
  const operation = await value.open(), review = operation.getByRole('region', { name: 'Execution review', exact: true });
  await expect(review).toContainText('Execution review is unavailable');
  await expect(page.locator('body')).not.toContainText('synthetic-private-response');
  await expect(review).not.toContainText('deterministic-v1');
  await expect(operation.getByRole('button', { name: 'Approve operation', exact: true })).toBeEnabled();
});

test('failed metadata reads use a generic error and preserve the separate trust gate', async ({ page }) => {
  const value = await fixture(page); value.unavailable();
  const operation = await value.open();
  await expect(operation.getByRole('region', { name: 'Execution review', exact: true })).toContainText('Execution review is unavailable');
  await expect(page.locator('body')).not.toContainText('synthetic-private-diagnostic');
  await expect(operation.getByRole('button', { name: 'Approve operation', exact: true })).toBeDisabled();
});

const ownerChanges: [string, Partial<Thread>][] = [
  ['epoch', { epoch: 1 }], ['run', { runId: 'run-new' }], ['account', { accountId: 'account-new' }],
  ['project', { projectId: 'project-new' }], ['workspace', { workspaceId: 'workspace-new' }], ['model', { modelId: 'test/model-new' }],
  ['mode', { mode: 'plan' }], ['kind', { kind: 'side' }], ['side parent', { sideParentId: 'parent-new' }], ['thread state', { status: 'working' }],
];
for (const [name, patch] of ownerChanges) test(`a late advice response is fenced after the ${name} changes`, async ({ page }) => {
  const value = await fixture(page, 'integration.context7'), release = value.holdNext();
  try {
    const operation = await value.open(); await expect.poll(value.reads).toBe(1);
    Object.assign(value.thread, patch); value.fresh(); await value.host.publish();
    await expect.poll(value.reads).toBe(2);
    const review = operation.getByRole('region', { name: 'Execution review', exact: true });
    await expect(review.locator(`time[datetime="${nextTime}"]`)).toBeVisible();
    const old = page.waitForResponse(async response => response.url().includes('/api/operation-execution-review?') && (await response.json()).advice.recorded?.recordedAt === firstTime);
    release(); await old;
    await expect(review.locator(`time[datetime="${nextTime}"]`)).toBeVisible();
    await expect(review.locator(`time[datetime="${firstTime}"]`)).toHaveCount(0);
  } finally { release(); }
});

for (const [name, patch] of [['revision', { revision: 4 }], ['approval', { approved: true }], ['operation state', { status: 'running' }]] as const)
test(`a late advice response is fenced after the ${name} changes`, async ({ page }) => {
  const value = await fixture(page, 'integration.context7'), release = value.holdNext();
  try {
    const operation = await value.open(); await expect.poll(value.reads).toBe(1);
    Object.assign(value.operation, patch); value.fresh(); await value.host.publish(); await expect.poll(value.reads).toBe(2);
    const review = operation.getByRole('region', { name: 'Execution review', exact: true });
    await expect(review.locator(`time[datetime="${nextTime}"]`)).toBeVisible();
    const old = page.waitForResponse(async response => response.url().includes('/api/operation-execution-review?') && (await response.json()).advice.recorded?.recordedAt === firstTime);
    release(); await old;
    await expect(review.locator(`time[datetime="${firstTime}"]`)).toHaveCount(0);
    await expect(review.locator(`time[datetime="${nextTime}"]`)).toBeVisible();
  } finally { release(); }
});

test('advice and policies wrap at a narrow approval surface', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const value = await fixture(page, 'integration.context7'), operation = await value.open(), review = operation.getByRole('region', { name: 'Execution review', exact: true });
  await expect(review).toContainText('deterministic-v1');
  expect(await review.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await review.getByRole('button', { name: 'Reload execution review', exact: true }).focus();
  await expect(review.getByRole('button', { name: 'Reload execution review', exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('operation-advice-narrow.png') });
});

test('ordinary file approvals do not request process execution advice', async ({ page }) => {
  const value = await fixture(page, 'file.write'), operation = await value.open();
  await expect(operation.getByRole('button', { name: 'Approve operation', exact: true })).toBeEnabled();
  await expect(operation.getByRole('region', { name: 'Execution review', exact: true })).toHaveCount(0);
  expect(value.reads()).toBe(0);
});
