import {deferred} from './fixtures/deferred.ts';
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Operation, RuntimeAdapter, RuntimeCallbacks, StartRun, Thread } from '../packages/contracts/index.ts';
import type { ApprovalV1, ToolEffectRecord } from '../packages/contracts/tool-effects.ts';
import { Service } from '../packages/core/service.ts';
import { buildToolRegistry, ToolAuthority } from '../packages/core/tool-authority.ts';
import { createToolEffectFlags, ToolEffectLedger } from '../packages/core/tool-effects.ts';
import { Store } from '../packages/storage/store.ts';
import * as domain from '../packages/capabilities/index.ts';
import { testEffectAuthenticator } from './fixtures/effect-authenticator.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'effect-operation-owner-'));
  const store = new Store(join(root, 'state'));
  const flags = { 'audit.effectsV1': true, 'security.authorityV1': true } as const;
  const authenticator = testEffectAuthenticator();
  const ledger = new ToolEffectLedger(store, new ToolAuthority(buildToolRegistry()), createToolEffectFlags(flags), authenticator);
  let callbacks!: RuntimeCallbacks;
  const starts: StartRun[] = [];
  const runtime: RuntimeAdapter = {
    configure: value => { callbacks = value; },
    models: async () => [{ id: 'test/model', provider: 'test', name: 'Test' }],
    start: async input => { starts.push(input); },
    followUp: async () => {}, cancel: async () => {}, compact: async () => {},
    history: async () => [], dispose: async () => {},
  };
  const service = new Service(store, runtime, { toolEffectFlags: flags, toolEffectAuthenticator: authenticator });
  const command = (type: string, threadId?: string, payload: Record<string, unknown> = {}) =>
    service.command({ id: crypto.randomUUID(), type, threadId, payload });
  const first = (await command('thread.create')).result as Thread;
  const second = (await command('thread.create')).result as Thread;
  const operation = (id: string, owner = first) => {
    const value: Operation = { id, threadId: owner.id, revision: 1, kind: 'fixture.check',
      description: 'Count one external effect', args: {}, resourceIds: [], preconditions: {},
      status: 'prepared', approved: false, createdAt: new Date().toISOString() };
    store.internal('fixture.operation', owner.id, () => store.put('operation', id, owner.id, value));
    return value;
  };
  cleanups.push(async () => { await service.dispose(); store.close(); await rm(root, { recursive: true, force: true }); });
  return { store, ledger, service, command, first, second, operation, starts, authenticator, get callbacks() { return callbacks; } };
}

it.each(['different-run', null])('rejects approval from a different run owner (%s) with the same epoch', async runId => {
  const x = await fixture();
  const original = { ...x.first, runId: 'original-run', epoch: 1 };
  const op = x.operation('owner-change');
  const approval = x.ledger.issueApproval(op, original);
  x.store.internal('fixture.approval', original.id, () => x.store.put('approval', approval.approvalId, original.id, approval));

  expect(() => x.ledger.verifyOperationApproval(op, { ...original, runId }))
    .toThrow(expect.objectContaining({ code: 'APPROVAL_REQUIRED' }));
  expect(x.store.get<ApprovalV1>('approval', approval.approvalId)?.remainingUses).toBe(1);
  expect(x.ledger.get('operation:owner-change@1')).toBeNull();
});

it('rejects approval from another thread even when its other owner fields match', async () => {
  const x = await fixture();
  const op = x.operation('thread-change');
  const approval = x.ledger.issueApproval(op, x.first);
  x.store.internal('fixture.approval', x.first.id, () => x.store.put('approval', approval.approvalId, x.first.id, approval));

  expect(() => x.ledger.verifyOperationApproval(op, x.second))
    .toThrow(expect.objectContaining({ code: 'APPROVAL_REQUIRED' }));
  expect(x.store.get<ApprovalV1>('approval', approval.approvalId)?.remainingUses).toBe(1);
});

it.each(['current-run', null])('accepts an unchanged approval owner (%s)', async runId => {
  const x = await fixture();
  const owner = { ...x.first, runId };
  const op = x.operation('unchanged');
  const approval = x.ledger.issueApproval(op, owner);
  x.store.internal('fixture.approval', owner.id, () => x.store.put('approval', approval.approvalId, owner.id, approval));

  expect(() => x.ledger.verifyOperationApproval(op, owner)).not.toThrow();
  expect(x.store.get<ApprovalV1>('approval', approval.approvalId)?.remainingUses).toBe(1);
});

const ownerDrifts: [string, (thread: Thread) => Thread][] = [
  ['threadId', thread => ({ ...thread, id: thread.id + '-other' })],
  ['runId', thread => ({ ...thread, runId: 'other-run' })],
  ['epoch', thread => ({ ...thread, epoch: thread.epoch + 1 })],
  ['accountBinding', thread => ({ ...thread, accountId: 'other-account' })],
  ['projectId', thread => ({ ...thread, projectId: 'other-project' })],
  ['workspaceId', thread => ({ ...thread, workspaceId: 'other-workspace' })],
];

it.each(ownerDrifts)('rejects a genuine authenticated approval when only its %s drifts', async (_field, drift) => {
  const x = await fixture();
  const op = x.operation('owner-dimension');
  const approval = x.ledger.issueApproval(op, x.first);
  x.store.internal('fixture.approval', x.first.id, () => x.store.put('approval', approval.approvalId, x.first.id, approval));

  expect(() => x.ledger.verifyOperationApproval(op, x.first)).not.toThrow();
  expect(() => x.ledger.verifyOperationApproval(op, drift(x.first))).toThrowError(/owner changed/);
  expect(x.store.get<ApprovalV1>('approval', approval.approvalId)?.remainingUses).toBe(1);
  expect(x.ledger.get('operation:owner-dimension@1')).toBeNull();
});

it('does not dispatch a queued approved operation after its foreground run settles', async () => {
  const x = await fixture(), entered = deferred(), release = deferred();
  await x.command('message.send', x.second.id, { content: 'Prepare the action', modelId: 'test/model' });
  await x.service.deliverOutbox(x.second.id);
  const run = x.starts[0];
  const blocker = x.operation('blocking-action'), queued = x.operation('queued-action', x.second);
  const effects: string[] = [];
  // The external executor is deliberately controlled. Store transactions,
  // authenticated command handling, run lifecycle and admission remain real.
  vi.spyOn(domain, 'executeDomainOperation').mockImplementation(async op => {
    effects.push(op.id);
    if (op.id === blocker.id) { entered.resolve(); await release.promise; }
    return { completed: op.id };
  });
  await x.command('operation.approve', blocker.threadId, { operationId: blocker.id, revision: blocker.revision });
  await entered.promise;
  let queuedResult: Promise<{ value: unknown } | { error: unknown }> | undefined;
  try {
    await x.command('operation.approve', queued.threadId, { operationId: queued.id, revision: queued.revision });
    queuedResult = x.service.dispatchOperation(queued.id).then(value => ({ value }), error => ({ error }));
    const approved = x.store.all<ApprovalV1>('approval', queued.threadId).find(value => value.operationId === queued.id)!;
    expect(approved.owner.runId).toBe(run.runId);
    x.callbacks.onEvent({ ...run, type: 'input.processing', inputIds: run.inputIds });
    x.callbacks.onEvent({ ...run, type: 'assistant.message', content: 'Action prepared', inputIds: run.inputIds });
    x.callbacks.onEvent({ ...run, type: 'settled' });
    expect(x.store.get<Thread>('thread', queued.threadId)).toMatchObject({ runId: null, epoch: approved.owner.epoch });
    release.resolve();
    expect(await queuedResult).toMatchObject({ error: { code: 'APPROVAL_REQUIRED' } });
    expect(effects).toEqual([blocker.id]);
    expect(x.store.get<ApprovalV1>('approval', approved.approvalId)?.remainingUses).toBe(1);
    expect(x.store.get<Operation>('operation', queued.id)?.status).toBe('prepared');
    expect(x.store.get<ToolEffectRecord>('toolEffect', 'operation:' + queued.id + '@1')).toBeNull();
  } finally {
    release.resolve();
    await queuedResult;
  }
});
