import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/storage/store.ts';
import { buildToolRegistry, ToolAuthority } from '../packages/core/tool-authority.ts';
import { __setEffectFaultHookForTests, ToolEffectLedger } from '../packages/core/tool-effects.ts';
import { disableEffects, observationFreshness, reconcileEffect, recoverEffects, retryDecision } from '../packages/core/effect-recovery.ts';
import { ToolEffectReadModels } from '../packages/core/tool-effect-read-models.ts';
import { __setCapabilityFlagForTests } from '../packages/core/capability-flags.ts';
import type { ToolEffectRecord } from '../packages/contracts/tool-effects.ts';
import type { Thread, ToolCall } from '../packages/contracts/index.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  __setEffectFaultHookForTests(null);
  __setCapabilityFlagForTests('audit.effectsV1', undefined);
  __setCapabilityFlagForTests('security.authorityV1', undefined);
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

const thread = (over: Partial<Thread> = {}): Thread => ({
  id: 'thread-1', title: 't', projectName: null, createdAt: '', updatedAt: '', status: 'working',
  epoch: 1, runId: 'run-1', modelId: 'test/model', sessionPath: null, accountId: 'acct-1', projectId: 'p1', workspaceId: 'w1', ...over,
} as Thread);
const ctx = { threadId: 'thread-1', runId: 'run-1', epoch: 1 };
const call = (commandId: string): ToolCall => ({ name: 'repository_read', args: { commandId, resourceId: 'r' } });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'harness-effect-recovery-'));
  const store = new Store(join(root, 'state'));
  const authority = new ToolAuthority(buildToolRegistry());
  const ledger = new ToolEffectLedger(store, authority);
  __setCapabilityFlagForTests('audit.effectsV1', true);
  __setCapabilityFlagForTests('security.authorityV1', true);
  cleanups.push(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  return { store, authority, ledger };
}

it('leaves nothing durable when the admission boundary faults', async () => {
  const { ledger } = await fixture();
  __setEffectFaultHookForTests(at => { if (at === 'admission') throw new Error('crash'); });
  await expect(ledger.invoke({ call: call('crash-admit'), ctx, thread: thread(), role: 'run' }, async () => 1)).rejects.toThrow('crash');
  expect(ledger.get('crash-admit')).toBeNull();
});

it('marks a dispatched-but-never-settled effect uncertain on recovery', async () => {
  const { store, ledger } = await fixture();
  __setEffectFaultHookForTests(at => { if (at === 'settlement') throw new Error('crash'); });
  await expect(ledger.invoke({ call: call('crash-settle'), ctx, thread: thread(), role: 'run' }, async () => ({ external: true }))).rejects.toThrow('crash');
  __setEffectFaultHookForTests(null);
  expect(ledger.get('crash-settle')?.state).toBe('DISPATCHED');
  const outcome = recoverEffects(store);
  expect(outcome.uncertain).toEqual(['crash-settle']);
  const effect = ledger.get('crash-settle');
  expect(effect?.state).toBe('UNKNOWN_EXTERNAL_OUTCOME');
  expect(effect?.transitions.at(-1)?.note).toBe('host_restart');
});

it('fails undispatched prepared effects as interrupted and keeps transitions', async () => {
  const { store, ledger } = await fixture();
  await expect(ledger.invoke(
    { call: { name: 'task_delegate', args: { commandId: 'pending-1', tasks: [] } }, ctx, thread: thread(), role: 'run' },
    async () => undefined)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
  const outcome = recoverEffects(store);
  expect(outcome.interrupted).toEqual(['pending-1']);
  expect(ledger.get('pending-1')?.state).toBe('FAILED');
  expect(ledger.get('pending-1')?.transitions.map(t => t.to)).toEqual(['PREPARED', 'FAILED']);
});

it('retries reads only under a fresh valid owner, never ambiguous effects', async () => {
  const { authority, ledger } = await fixture();
  const unknown = { ...ledger.get('x') ?? {} } as ToolEffectRecord;
  const read = authority.require('repository_read');
  expect(retryDecision({ ...unknown, state: 'UNKNOWN_EXTERNAL_OUTCOME' }, read, true)).toEqual({ retry: true, reason: 'read_retryable' });
  expect(retryDecision({ ...unknown, state: 'UNKNOWN_EXTERNAL_OUTCOME' }, read, false).reason).toBe('owner_revoked');
  expect(retryDecision({ ...unknown, state: 'DISPATCHED' }, read, true).reason).toBe('not_retryable_state');
  expect(retryDecision({ ...unknown, state: 'UNKNOWN_EXTERNAL_OUTCOME' }, authority.require('operation_execute'), true)).toEqual({ retry: false, reason: 'not_replayable' });
  expect(retryDecision({ ...unknown, state: 'UNKNOWN_EXTERNAL_OUTCOME' }, authority.require('integration_call'), true)).toEqual({ retry: true, reason: 'provider_idempotent_same_key' });
});

it('settles an OPERATION_OUTCOME_UNKNOWN error as uncertain, not failed', async () => {
  const { store, ledger } = await fixture();
  const { HarnessError } = await import('../packages/contracts/index.ts');
  await expect(ledger.invoke({ call: call('u2'), ctx, thread: thread(), role: 'run' }, async () => { throw new HarnessError('OPERATION_OUTCOME_UNKNOWN', 'executor lost'); }))
    .rejects.toThrow('executor lost');
  expect(ledger.get('u2')?.state).toBe('UNKNOWN_EXTERNAL_OUTCOME');
  expect(reconcileEffect(store, 'u2').basis).toBe('unresolved');
  expect(reconcileEffect(store, 'u2').transitions.at(-1)?.to).toBe('UNKNOWN_EXTERNAL_OUTCOME');
});

it('pages invocations through a bounded cursor and fences other owners', async () => {
  const { store, ledger } = await fixture();
  for (const id of ['p1', 'p2', 'p3'])
    await ledger.invoke({ call: call(id), ctx, thread: thread(), role: 'run' }, async () => 1);
  await ledger.invoke({ call: call('other-thread'), ctx: { threadId: 'thread-2', runId: 'r', epoch: 1 }, thread: thread({ id: 'thread-2', runId: 'r' }), role: 'run' }, async () => 1);
  store.internal('fixture.thread', 'thread-1', () => store.put('thread', 'thread-1', 'thread-1', thread()));
  const reads = new ToolEffectReadModels(store);
  const context = reads.context({ threadId: 'thread-1' });
  expect(context.coverage.some(note => note.includes('COVERAGE_GAP'))).toBe(true);
  const page1 = reads.invocations({ threadId: 'thread-1', scopeKey: context.scopeKey, limit: 2 });
  expect(page1.effects).toHaveLength(2);
  expect(page1.freshness).toBe('CURRENT');
  const page2 = reads.invocations({ threadId: 'thread-1', scopeKey: context.scopeKey, limit: 2, cursor: page1.nextCursor! });
  expect(page1.effects.map(e => e.invocationId)).not.toContain('other-thread');
  expect([...page1.effects, ...page2.effects].map(e => e.invocationId)).not.toContain('other-thread');
  const observed = reads.observations({ threadId: 'thread-1', scopeKey: context.scopeKey, invocationId: 'p1' });
  expect(observed.effect.state).toBe('SUCCEEDED');
  expect(() => reads.observations({ threadId: 'thread-1', scopeKey: context.scopeKey, invocationId: 'other-thread' })).toThrowError(/unavailable/);
  expect(() => reads.invocations({ threadId: 'thread-1', scopeKey: context.scopeKey, cursor: 'bogus' })).toThrowError(/reopen/);
});

it('marks outstanding effects uncertain on rollback and preserves approvals', async () => {
  const { store, authority, ledger } = await fixture();
  const definition = authority.require('repository_read');
  const admitted = ledger.admit({ call: call('rb-1'), owner: { threadId: 'thread-1', runId: 'run-1', epoch: 1, projectId: 'p1', workspaceId: 'w1', accountBinding: 'acct-1' }, definition });
  expect(admitted.state).toBe('DISPATCHED');
  const operation = { id: 'op-rb', threadId: 'thread-1', revision: 1, kind: 'file.replace', description: '', args: {}, resourceIds: [], preconditions: {}, status: 'prepared' as const, approved: true, createdAt: '' };
  const approval = ledger.issueApproval(operation, thread());
  store.internal('fixture.approval', 'thread-1', () => store.put('approval', approval.approvalId, 'thread-1', { ...approval, remainingUses: 0 }));
  const result = disableEffects(store);
  expect(result.marked).toEqual(['rb-1']);
  expect(ledger.get('rb-1')?.state).toBe('UNKNOWN_EXTERNAL_OUTCOME');
  expect(store.get<{ remainingUses: number }>('approval', approval.approvalId)?.remainingUses).toBe(0);
});

it('reports observation freshness independent of outcome', async () => {
  const { store } = await fixture();
  const fence = store.sequence;
  expect(observationFreshness(store, fence)).toBe('CURRENT');
  store.internal('fixture.tick', 'thread-1', () => ({ n: 1 }));
  expect(observationFreshness(store, fence)).toBe('STALE');
  expect(observationFreshness(store, null)).toBe('INDETERMINATE');
});

it('does not repeat an effect across an invocation page boundary', async () => {
  const { store, ledger } = await fixture();
  for (const id of ['b1', 'b2', 'b3'])
    await ledger.invoke({ call: call(id), ctx, thread: thread(), role: 'run' }, async () => 1);
  store.internal('fixture.thread', 'thread-1', () => store.put('thread', 'thread-1', 'thread-1', thread()));
  const reads = new ToolEffectReadModels(store);
  const context = reads.context({ threadId: 'thread-1' });
  const seen: string[] = [];
  let cursor: string | undefined;
  do {
    const page = reads.invocations({ threadId: 'thread-1', scopeKey: context.scopeKey, limit: 2, cursor });
    seen.push(...page.effects.map(e => e.invocationId));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  expect(seen).toHaveLength(3);
  expect(new Set(seen).size).toBe(3);
});

const operationDefinition = { id: 'operation:file.replace', version: 1, schemaDigest: 'd', risk: 'HOST_EXECUTE' as const, replayClass: 'NONREPLAYABLE' as const, allowedRoles: ['run' as const], executorBinding: 'domain' as const, approval: 'operation' as const };
const crashedOperation = { id: 'op-crash', threadId: 'thread-1', revision: 1, kind: 'file.replace', description: '', args: {}, resourceIds: [], preconditions: {}, status: 'succeeded' as const, approved: true, createdAt: '', result: { done: true } };

it('settles a crashed operation dispatch from the committed operation record', async () => {
  const { store, ledger } = await fixture();
  const admitted = ledger.admit({
    call: { name: 'operation:file.replace', args: { invocationId: 'operation:op-crash@1', operationId: 'op-crash' } },
    owner: { threadId: 'thread-1', runId: 'run-1', epoch: 1, projectId: 'p1', workspaceId: 'w1', accountBinding: 'acct-1' },
    definition: operationDefinition,
  });
  expect(admitted.state).toBe('DISPATCHED');
  store.internal('fixture.operation', 'thread-1', () => store.put('operation', 'op-crash', 'thread-1', crashedOperation));
  const outcome = recoverEffects(store);
  expect(outcome.uncertain).toEqual([]);
  const effect = ledger.get('operation:op-crash@1');
  expect(effect?.state).toBe('SUCCEEDED');
  expect(effect?.transitions.at(-1)?.note).toBe('host_restart: recorded in operation ledger');
});

it('does not inherit an operation outcome onto a forged invocation identity', async () => {
  const { store, authority, ledger } = await fixture();
  // A caller-chosen invocationId that merely LOOKS like op-crash's dispatch:
  // the recorded tool and owner do not match the operation, so the effect
  // stays uncertain rather than inheriting the recorded success.
  const admitted = ledger.admit({
    call: { name: 'repository_read', args: { commandId: 'operation:op-crash@1', resourceId: 'r' } },
    owner: { threadId: 'thread-1', runId: 'run-1', epoch: 1, projectId: 'p1', workspaceId: 'w1', accountBinding: 'acct-1' },
    definition: authority.require('repository_read'),
  });
  expect(admitted.state).toBe('DISPATCHED');
  store.internal('fixture.operation', 'thread-1', () => store.put('operation', 'op-crash', 'thread-1', crashedOperation));
  const outcome = recoverEffects(store);
  expect(outcome.uncertain).toEqual(['operation:op-crash@1']);
  expect(ledger.get('operation:op-crash@1')?.state).toBe('UNKNOWN_EXTERNAL_OUTCOME');
});
