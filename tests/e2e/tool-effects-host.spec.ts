import { readFile, stat } from 'node:fs/promises';
import type { ApprovalV1, ToolEffectRecord } from '../../packages/contracts/tool-effects.ts';
import { AFTER, BEFORE, evidence, grantFixtureFile, openHost, sendFixture, test, expect } from '../host-fixture.ts';

// Explicit test-host opt-in. All other HostFixture users retain default-off
// ledger flags; the browser, HTTP routes, file guards and SQLite remain real.
test.use({ toolEffectFlags: { 'audit.effectsV1': true, 'security.authorityV1': true } });

test('approved file replacement exposes its durable ledger receipt through the actual host', async ({ page, host }, info) => {
  test.setTimeout(60_000);
  await openHost(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('dialog', { name: 'Settings', exact: true })
    .getByRole('button', { name: 'Projects & Working Copies', exact: true }).click();
  await grantFixtureFile(page, host);
  await sendFixture(page, 'operation', host);
  const artifact = page.getByRole('region', { name: 'Evidence document', exact: true })
    .or(page.getByRole('dialog', { name: 'Evidence document', exact: true }));
  await artifact.getByRole('button', { name: 'Expand artifact', exact: true }).click();
  await artifact.getByRole('button', { name: 'Apply document replacement', exact: true }).click();
  const approvalPanel = page.getByRole('region', { name:/^Operation approval:/, exact: true });
  await expect(approvalPanel.getByRole('button', { name: 'Approve operation', exact: true })).toBeFocused();
  const operation = host.snapshot().operations[0]!;
  const thread = host.snapshot().threads.find(value => value.id === operation.threadId)!;
  const owner = {
    threadId: thread.id, runId: thread.runId, epoch: thread.epoch,
    accountBinding: thread.accountId ?? null, projectId: thread.projectId ?? null, workspaceId: thread.workspaceId ?? null,
  };
  const invocationId = 'operation:' + operation.id + '@' + operation.revision;
  expect(operation).toMatchObject({ status: 'prepared', approved: false });
  expect(host.store.get('toolEffect', invocationId)).toBeNull();
  expect(await readFile(host.sourceFile, 'utf8')).toBe(BEFORE);

  await approvalPanel.getByRole('button', { name: 'Approve operation', exact: true }).click();
  await expect.poll(() => host.store.get<ToolEffectRecord>('toolEffect', invocationId)?.state).toBe('SUCCEEDED');
  expect(await readFile(host.sourceFile, 'utf8')).toBe(AFTER);
  const modified = (await stat(host.sourceFile)).mtimeMs;
  const receipt = host.store.get<ToolEffectRecord>('toolEffect', invocationId)!;
  expect(receipt.owner).toEqual(owner);
  expect(receipt.transitions.map(value => value.to)).toEqual(['PREPARED', 'DISPATCHED', 'SUCCEEDED']);
  const spentApproval = host.store.get<ApprovalV1>('approval', receipt.approvalId!)!;
  expect(spentApproval).toMatchObject({ operationId: operation.id, owner, remainingUses: 0 });

  const visibleReceipt = async () => {
    const outcome = page.getByRole('region', { name:/^Operation outcome:/, exact: true });
    await expect(outcome).toContainText('Succeeded');
    await outcome.locator('details.operation-receipt > summary').click();
    const details = outcome.locator('details.action-details');
    await expect(details.locator('summary')).toHaveText('Action details');
    await details.locator('summary').click();
    await expect(details.locator('pre')).toContainText('"state": "SUCCEEDED"');
    const displayed = JSON.parse(await details.locator('pre').textContent() ?? '');
    expect(displayed).toMatchObject({
      state: 'SUCCEEDED', tool: 'operation:file.replace', owner,
      approval: { id: spentApproval.approvalId, remainingUses: 0 },
    });
    expect(displayed.transitions.map((value: { to: string }) => value.to))
      .toEqual(['PREPARED', 'DISPATCHED', 'SUCCEEDED']);
  };
  await visibleReceipt();
  await evidence(page, info, 'actual-host-approved-ledger');
  await page.reload();
  await visibleReceipt();
  expect(host.store.get('toolEffect', invocationId)).toEqual(receipt);
  expect((await stat(host.sourceFile)).mtimeMs).toBe(modified);

  await page.goto('about:blank');
  await host.restart();
  expect(host.runtime.deliveries).toHaveLength(0);
  expect(host.store.get('toolEffect', invocationId)).toEqual(receipt);
  expect(host.store.get('approval', spentApproval.approvalId)).toEqual(spentApproval);
  await openHost(page);
  await visibleReceipt();
  expect(await readFile(host.sourceFile, 'utf8')).toBe(AFTER);
  expect((await stat(host.sourceFile)).mtimeMs).toBe(modified);
  expect(host.runtime.deliveries).toHaveLength(0);
  expect(host.commands.filter(value => value.type === 'operation.approve')).toHaveLength(1);
  await evidence(page, info, 'actual-host-restored-ledger');
});
