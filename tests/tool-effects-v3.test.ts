import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Service } from '../packages/core/service.ts';
import { Store } from '../packages/storage/store.ts';
import { buildToolRegistry, ToolAuthority } from '../packages/core/tool-authority.ts';
import { ToolEffectLedger, createToolEffectFlags, type ToolEffectFlag } from '../packages/core/tool-effects.ts';
import type { ApprovalV1, ToolEffectRecord } from '../packages/contracts/tool-effects.ts';
import type { Operation, RunContext, RuntimeAdapter, RuntimeCallbacks, StartRun, Thread, ToolCall } from '../packages/contracts/index.ts';
import * as domain from '../packages/capabilities/index.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});


const thread = (over: Partial<Thread> = {}): Thread => ({
  id: 'thread-1', title: 't', projectName: null, createdAt: '', updatedAt: '', status: 'working',
  epoch: 1, runId: 'run-1', modelId: 'test/model', sessionPath: null, accountId: 'acct-1', projectId: 'p1', workspaceId: 'w1', ...over,
} as Thread);
const ctx = { threadId: 'thread-1', runId: 'run-1', epoch: 1 };

async function ledgerFixture() {
  const root = await mkdtemp(join(tmpdir(), 'harness-tool-effects-'));
  const store = new Store(join(root, 'state'));
  const authority = new ToolAuthority(buildToolRegistry());
  const ledger = new ToolEffectLedger(store, authority, createToolEffectFlags({ 'audit.effectsV1': true, 'security.authorityV1': true }));
  cleanups.push(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  return { store, authority, ledger };
}

async function serviceFixture(toolEffectFlags: Partial<Record<ToolEffectFlag, boolean>> = { 'audit.effectsV1': true, 'security.authorityV1': true }) {
  const root = await mkdtemp(join(tmpdir(), 'harness-tool-effects-svc-'));
  const store = new Store(join(root, 'state'));
  let callbacks!: RuntimeCallbacks;
  const runtime: RuntimeAdapter = { configure: value => { callbacks = value; }, models: async () => [{ id: 'test/model', provider: 'test', name: 'Test' }], start: async (_input: StartRun) => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
  const service = new Service(store, runtime, { toolEffectFlags });
  const command = (type: string, threadId?: string, payload: Record<string, unknown> = {}) => service.command({ id: crypto.randomUUID(), type, payload, threadId });
  const first = (await command('thread.create')).result as Thread;
  const operation = (id: string) => {
    const op: Operation = { id, threadId: first.id, revision: 1, kind: 'fixture.check', description: 'Ledger regression', args: {}, resourceIds: [], preconditions: {}, status: 'prepared', approved: false, createdAt: new Date().toISOString() };
    store.internal('fixture.operation', first.id, () => store.put('operation', id, first.id, op));
    return op;
  };
  cleanups.push(async () => { await service.dispose(); store.close(); await rm(root, { recursive: true, force: true }); });
  return { service, store, command, first, operation, get callbacks() { return callbacks; } };
}

it('admits then persists DISPATCHED before invoking the executor, then settles', async () => {
  const { store, ledger } = await ledgerFixture();
  let seenDuringExecution: string | undefined;
  const result = await ledger.invoke(
    { call: { name: 'repository_read', args: { commandId: 'inv-1', resourceId: 'r' } }, ctx, thread: thread(), role: 'run' },
    async () => { seenDuringExecution = (store.get<ToolEffectRecord>('toolEffect', 'inv-1'))?.state; return { ok: true }; });
  expect(result).toEqual({ ok: true });
  expect(seenDuringExecution).toBe('DISPATCHED');
  const effect = ledger.get('inv-1');
  expect(effect?.state).toBe('SUCCEEDED');
  expect(effect?.transitions.map(t => t.to)).toEqual(['PREPARED', 'DISPATCHED', 'SUCCEEDED']);
  expect(effect?.definitionDigest).toBeTruthy();
});

it('coalesces duplicate invocation IDs and conflicts on changed arguments', async () => {
  const { ledger } = await ledgerFixture();
  const calls: string[] = [];
  const call: ToolCall = { name: 'repository_read', args: { commandId: 'inv-2', resourceId: 'r' } };
  await ledger.invoke({ call, ctx, thread: thread(), role: 'run' }, async () => { calls.push('run'); return 7; });
  const replayed = await ledger.invoke({ call, ctx, thread: thread(), role: 'run' }, async () => { calls.push('again'); return 8; });
  expect(calls).toEqual(['run']);
  expect(replayed).toBe(7);
  await expect(ledger.invoke({ call: { name: 'repository_read', args: { commandId: 'inv-2', resourceId: 'changed' } }, ctx, thread: thread(), role: 'run' }, async () => 9))
    .rejects.toMatchObject({ code: 'INVOCATION_CONFLICT' });
  await expect(ledger.invoke({ call, ctx: { ...ctx, runId: 'run-2' }, thread: thread({ runId: 'run-2' }), role: 'run' }, async () => 10))
    .rejects.toMatchObject({ code: 'INVOCATION_CONFLICT' });
});

it('requires approval for external mutating calls and records them undispatched', async () => {
  const { ledger } = await ledgerFixture();
  let ran = false;
  await expect(ledger.invoke(
    { call: { name: 'task_delegate', args: { commandId: 'inv-3', tasks: [] } }, ctx, thread: thread(), role: 'run' },
    async () => { ran = true; })).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
  expect(ran).toBe(false);
  const effect = ledger.get('inv-3');
  expect(effect?.state).toBe('PREPARED');
  expect(effect?.transitions.map(t => t.to)).toEqual(['PREPARED']);
});

it('denies an out-of-role call and records DENIED without dispatching', async () => {
  const { ledger } = await ledgerFixture();
  let ran = false;
  await expect(ledger.invoke(
    { call: { name: 'ui_present', args: { commandId: 'inv-4', artifactId: 'a' } }, ctx, thread: thread(), role: 'side' },
    async () => { ran = true; })).rejects.toMatchObject({ code: 'AUTHORITY_DENIED' });
  expect(ran).toBe(false);
  expect(ledger.get('inv-4')?.state).toBe('DENIED');
});

it('lets two callers sharing one approval dispatch only once', async () => {
  const { store, ledger } = await ledgerFixture();
  const operation: Operation = { id: 'op-shared', threadId: 'thread-1', revision: 1, kind: 'file.replace', description: 'x', args: {}, resourceIds: [], preconditions: {}, status: 'prepared', approved: true, createdAt: '' };
  const approval = ledger.issueApproval(operation, thread());
  store.internal('fixture.approval', 'thread-1', () => store.put('approval', approval.approvalId, 'thread-1', approval));
  const started: string[] = [];
  const first = ledger.admitOperationDispatch(operation, thread(), () => started.push('first'));
  expect(first?.state).toBe('DISPATCHED');
  expect(store.get<ApprovalV1>('approval', approval.approvalId)?.remainingUses).toBe(0);
  await expect(Promise.resolve().then(() => ledger.admitOperationDispatch(operation, thread(), () => started.push('second'))))
    .rejects.toMatchObject({ code: 'INVOCATION_IN_FLIGHT' });
  ledger.settle(first!.invocationId, { value: { done: true } }, 'SUCCEEDED');
  const replay = ledger.admitOperationDispatch(operation, thread(), () => started.push('third'));
  expect(replay?.state).toBe('SUCCEEDED');
  expect(started).toEqual(['first']);
});

it('refuses an expired approval before any dispatch is persisted', async () => {
  const { store, ledger } = await ledgerFixture();
  const operation: Operation = { id: 'op-expired', threadId: 'thread-1', revision: 1, kind: 'file.replace', description: 'x', args: {}, resourceIds: [], preconditions: {}, status: 'prepared', approved: true, createdAt: '' };
  const approval = { ...ledger.issueApproval(operation, thread()), expiresAt: new Date(Date.now() - 1).toISOString() };
  store.internal('fixture.approval', 'thread-1', () => store.put('approval', approval.approvalId, 'thread-1', approval));
  expect(() => ledger.admitOperationDispatch(operation, thread(), () => undefined)).toThrowError(/expired|consumed/);
  expect(ledger.get('operation:op-expired@1')).toBeNull();
});

it('issues an approval on operation.approve and consumes it at the single dispatch', async () => {
  const x = await serviceFixture();
  const op = x.operation('op-approve');
  const dispatch = vi.spyOn(domain, 'executeDomainOperation').mockImplementation(async () => ({ verified: true }));
  await x.command('operation.approve', x.first.id, { operationId: op.id, revision: 1 });
  // operation.approve auto-dispatches approved prepared operations; the single
  // use of the approval happens inside that admission transaction.
  await vi.waitFor(() => expect(x.store.get<Operation>('operation', op.id)?.status).toBe('succeeded'));
  const approval = x.store.all<ApprovalV1>('approval').find(a => a.operationId === op.id);
  expect(approval?.issuer).toBe('authenticated_user');
  expect(x.store.get<ApprovalV1>('approval', approval!.approvalId)?.remainingUses).toBe(0);
  const effect = x.store.get<ToolEffectRecord>('toolEffect', 'operation:' + op.id + '@1');
  expect(effect?.state).toBe('SUCCEEDED');
  expect(effect?.approvalId).toBe(approval!.approvalId);
  await x.service.dispatchOperation(op.id);
  expect(dispatch).toHaveBeenCalledTimes(1);
});

it('denies dispatch when the approved owner drifts (epoch bump)', async () => {
  const x = await serviceFixture();
  const op = x.operation('op-drift');
  vi.spyOn(domain, 'executeDomainOperation').mockImplementation(async () => ({ verified: true }));
  const approved: Operation = { ...op, approved: true };
  x.store.internal('fixture.approved', x.first.id, () => x.store.put('operation', op.id, x.first.id, approved));
  const approval = { approvalId: 'ap-drift', operationId: op.id, actionCommitment: '', owner: { threadId: x.first.id, runId: null, epoch: x.first.epoch, projectId: x.first.projectId ?? null, workspaceId: x.first.workspaceId ?? null, accountBinding: x.first.accountId ?? null }, targetPreconditions: [], issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), remainingUses: 1, issuer: 'authenticated_user' };
  const { actionCommitment } = await import('../packages/core/tool-effects.ts');
  x.store.internal('fixture.approval', x.first.id, () => x.store.put('approval', approval.approvalId, x.first.id, { ...approval, actionCommitment: actionCommitment(approved, x.store.get<Thread>('thread', x.first.id)!) }));
  const current = x.store.get<Thread>('thread', x.first.id)!;
  x.store.internal('fixture.drift', x.first.id, () => x.store.put('thread', current.id, x.first.id, { ...current, epoch: current.epoch + 1 }));
  await expect(x.service.dispatchOperation(op.id)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
  expect(x.store.get<ToolEffectRecord>('toolEffect', 'operation:' + op.id + '@1')).toBeNull();
});

it('retains a historical result when the owner is archived mid-dispatch but publishes nothing current', async () => {
  const { store, authority, ledger } = await ledgerFixture();
  const planted = thread();
  store.internal('fixture.thread', 'thread-1', () => store.put('thread', planted.id, planted.id, planted));
  const effect = ledger.admit({
    call: { name: 'repository_read', args: { invocationId: 'arch-1', path: 'README.md' } },
    owner: { threadId: 'thread-1', runId: 'run-1', epoch: 1, projectId: null, workspaceId: null, accountBinding: 'acct-1' },
    definition: authority.require('repository_read'),
  });
  expect(effect.state).toBe('DISPATCHED');
  // Parent archived while the child effect is in flight: epoch bump + runId cleared.
  const before = store.get<Thread>('thread', 'thread-1')!;
  store.internal('fixture.archive', 'thread-1', () => store.put('thread', 'thread-1', 'thread-1', { ...before, epoch: before.epoch + 1, runId: null, status: 'stopped' }));
  // Late settlement is retained historically under the original owner.
  ledger.settle('arch-1', { value: { content: 'late' } }, 'SUCCEEDED');
  const retained = ledger.get('arch-1');
  expect(retained?.state).toBe('SUCCEEDED');
  expect(retained?.owner.runId).toBe('run-1');
  expect(retained?.owner.epoch).toBe(1);
  // A new call under the revoked owner is denied before dispatch — nothing is revived.
  const stale: RunContext = { threadId: 'thread-1', runId: 'run-1', epoch: 1 };
  const archived = store.get<Thread>('thread', 'thread-1')!;
  await expect(ledger.invoke({ call: { name: 'repository_read', args: { invocationId: 'arch-2' } }, ctx: stale, thread: archived, role: 'run' }, async () => ({})))
    .rejects.toMatchObject({ code: 'AUTHORITY_DENIED' });
  expect(ledger.get('arch-2')?.state).toBe('DENIED');
});

it('redacts nested secret-looking argument values in the public summary', async () => {
  const { publicRedactedSummary } = await import('../packages/core/tool-effects.ts');
  const summary = publicRedactedSummary({ name: 'repository_read', args: { commandId: 'x', headers: { token: 'abc123', safe: 'v' }, list: [{ password: 'pw' }] } });
  expect(summary).not.toContain('abc123');
  expect(summary).not.toContain('pw');
  expect(summary).toContain('<redacted>');
  expect(summary).toContain('safe');
});

it('honors the latest approval when an operation is approved again', async () => {
  const { store, ledger } = await ledgerFixture();
  const operation: Operation = { id: 'op-reapprove', threadId: 'thread-1', revision: 1, kind: 'file.replace', description: '', args: {}, resourceIds: [], preconditions: {}, status: 'prepared', approved: true, createdAt: '' };
  const first = ledger.issueApproval(operation, thread());
  store.internal('fixture.approval', 'thread-1', () => store.put('approval', first.approvalId, 'thread-1', { ...first, remainingUses: 0 }));
  const second = ledger.issueApproval(operation, thread());
  store.internal('fixture.approval2', 'thread-1', () => store.put('approval', second.approvalId, 'thread-1', second));
  expect(ledger.approvalFor('op-reapprove')?.approvalId).toBe(second.approvalId);
  expect(() => ledger.verifyOperationApproval(operation, thread())).not.toThrow();
});

it('binds learning invocations to the thread\'s current owner after the run settles', async () => {
  const { ledger } = await ledgerFixture();
  const settled = thread({ runId: null });
  const value = await ledger.invoke(
    { call: { name: 'skills_list', args: { commandId: 'learn-1' } }, ctx: { threadId: 'thread-1' }, thread: settled, role: 'learning' },
    async () => ({ skills: [] }));
  expect(value).toEqual({ skills: [] });
  const effect = ledger.get('learn-1');
  expect(effect?.state).toBe('SUCCEEDED');
  expect(effect?.owner.runId).toBeNull();
});

it('still requires the bound approval under authorityV1 when effectsV1 is off', async () => {
  const x = await serviceFixture({ 'security.authorityV1': true });
  const op = x.operation('op-authority-only');
  const dispatch = vi.spyOn(domain, 'executeDomainOperation').mockImplementation(async () => ({ verified: true }));
  const approved: Operation = { ...op, approved: true };
  x.store.internal('fixture.approved', x.first.id, () => x.store.put('operation', op.id, x.first.id, approved));
  await expect(x.service.dispatchOperation(op.id)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
  expect(dispatch).not.toHaveBeenCalled();
});
