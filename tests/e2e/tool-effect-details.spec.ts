import { expect, test, type Page } from '@playwright/test';
import type { Operation } from '../../packages/contracts';
import type { ToolEffectObservation } from '../../apps/web/src/api';
import { serveTaskFixture, taskFixture } from './task-interface-fixture';

const coverage = 'Native tool execution is not fully observed by this ledger.';
async function fixture(page: Page) {
  const snapshot = taskFixture({ root: 'text', elements: { text: { type: 'Text', props: { text: 'Review the recorded action.' } } } });
  snapshot.artifacts = [];
  const operation: Operation = { id: 'effect-action', threadId: 'task-thread', revision: 1, kind: 'file.replace',
    description: 'Replace the approved file.', args: {}, resourceIds: ['file-one'], preconditions: {},
    status: 'running', approved: true, createdAt: '2026-11-17T00:00:00.000Z' };
  snapshot.operations = [operation];
  const host = await serveTaskFixture(page, snapshot);
  const observation: ToolEffectObservation = {
    effect: { effectId: 'effect-one', invocationId: 'operation:effect-action@1', toolId: 'operation:file.replace',
      state: 'DISPATCHED', publicRedactedSummary: 'Replace the approved file.', targetPreconditions: ['file-one:approved-bytes'],
      approvalId: 'approval-one', providerReceiptRef: null, createdAt: operation.createdAt, updatedAt: operation.createdAt,
      owner: { threadId: 'task-thread', runId: null, epoch: 0, projectId: null, workspaceId: null, accountBinding: null },
      transitions: [{ from: null, to: 'DISPATCHED', at: operation.createdAt }] },
    approval: { approvalId: 'approval-one', operationId: operation.id, expiresAt: '2026-11-17T00:10:00.000Z',
      issuedAt: operation.createdAt, remainingUses: 0, issuer: 'authenticated_user' },
    freshness: 'CURRENT', coverage: [coverage],
  };
  let failure: string | null = null, reads = 0, nextHold: Promise<void> | undefined;
  await page.route('**/api/tool-effects/**', async route => {
    if (!new URL(route.request().url()).pathname.endsWith('/observations'))
      return route.fulfill({ json: { scopeKey: 'a'.repeat(64), coverage: [coverage] } });
    reads++;
    const captured = structuredClone(observation), error = failure, held = nextHold;
    nextHold = undefined;
    if (held) await held;
    return error
      ? route.fulfill({ status: error === 'NOT_FOUND' ? 404 : 503, json: { error: { code: error, message: 'Evidence unavailable' } } })
      : route.fulfill({ json: captured });
  });
  return { snapshot, operation, observation, host, reads: () => reads,
    fail: (value: string | null) => { failure = value; },
    holdNext: () => { let release!: () => void; nextHold = new Promise<void>(done => { release = done; }); return release; },
    open: async () => {
      await page.goto('/');
      await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled();
      const drawer = page.locator('.action-details');
      await drawer.locator('summary').click();
      return drawer;
    },
  };
}

test('failed evidence reads stay visibly unavailable and a reload performs no action', async ({ page }) => {
  const value = await fixture(page); value.fail('HOST_UNAVAILABLE');
  const drawer = await value.open();
  await expect(drawer.getByRole('status')).toContainText('Execution evidence could not be loaded.');
  await expect(drawer).not.toContainText('No execution-ledger record');
  value.fail(null);
  await drawer.getByRole('button', { name: 'Reload evidence', exact: true }).click();
  await expect(drawer.locator('pre')).toContainText('"state": "DISPATCHED"');
  await expect(drawer).toContainText(coverage);
  expect(value.host.commands.filter(command => command.type.startsWith('operation.'))).toEqual([]);
});

test('an absent ledger record retains its host coverage note', async ({ page }) => {
  const value = await fixture(page); value.fail('NOT_FOUND');
  const drawer = await value.open();
  await expect(drawer).toContainText('No execution-ledger record for this action');
  await expect(drawer).toContainText(coverage);
  await expect(drawer.getByRole('button', { name: 'Reload evidence', exact: true })).toBeEnabled();
});

test('the open drawer refreshes when a dispatched action becomes uncertain', async ({ page }) => {
  const value = await fixture(page), drawer = await value.open();
  await expect(drawer.locator('pre')).toContainText('"state": "DISPATCHED"');
  value.operation.status = 'unknown';
  value.observation.effect!.state = 'UNKNOWN_EXTERNAL_OUTCOME';
  value.observation.freshness = 'INDETERMINATE';
  await value.host.publish();
  await expect(drawer.locator('pre')).toContainText('"state": "UNKNOWN_EXTERNAL_OUTCOME"');
  await expect(drawer.locator('pre')).toContainText('file-one:approved-bytes');
  await expect(page.getByRole('button', { name: 'Inspect outcome', exact: true })).toBeEnabled();
  await expect(drawer.getByRole('button', { name: /retry/i })).toHaveCount(0);
});

test('a late response cannot replace evidence fetched after a run-owner change', async ({ page }) => {
  const value = await fixture(page), drawer = await value.open();
  await expect(drawer.locator('pre')).toContainText('"state": "DISPATCHED"');
  const initialReads = value.reads(), release = value.holdNext();
  try {
    value.operation.status = 'unknown';
    value.observation.effect!.state = 'UNKNOWN_EXTERNAL_OUTCOME';
    value.observation.effect!.outcome = { error: 'Earlier observation' };
    await value.host.publish();
    await expect.poll(value.reads).toBe(initialReads + 1);
    await expect(drawer.getByRole('status')).toContainText('Loading execution evidence');
    value.snapshot.threads[0].epoch++;
    value.observation.effect!.outcome = { error: 'Fresh owner observation' };
    value.observation.freshness = 'STALE';
    await value.host.publish();
    await expect(drawer.locator('pre')).toContainText('Fresh owner observation');
    release();
    await expect(drawer.locator('pre')).toContainText('Fresh owner observation');
    await expect(drawer.locator('pre')).not.toContainText('Earlier observation');
    expect(value.host.commands.filter(command => command.type.startsWith('operation.'))).toEqual([]);
  } finally { release(); }
});
