import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/storage/store.ts';
import { ToolAuthority, buildToolRegistry } from '../packages/core/tool-authority.ts';
import { ToolEffectLedger, createToolEffectFlags, privateArgumentCommitment } from '../packages/core/tool-effects.ts';
import { createEffectAuthenticator } from '../packages/core/host-effect-authenticator.ts';

const cleanups = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
const keyId = '00000000-0000-4000-8000-000000000003';
const signer = (byte = 3) => createEffectAuthenticator(Buffer.alloc(32, byte), keyId);
const flags = () => createToolEffectFlags({ 'audit.effectsV1': true, 'security.authorityV1': true });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'effect-authentication-'));
  let store = new Store(join(root, 'state'));
  const auth = signer(), authority = new ToolAuthority(buildToolRegistry());
  let ledger = new ToolEffectLedger(store, authority, flags(), auth);
  const thread = { id: 'owner', title: 'Owner', projectName: null, createdAt: '', updatedAt: '', status: 'working',
    epoch: 1, runId: 'run-1', modelId: 'test/model', sessionPath: null, accountId: null, projectId: null, workspaceId: null };
  const operation = { id: 'owned-action', threadId: thread.id, revision: 1, kind: 'fixture.write',
    args: { api_token: 'synthetic-low-entropy-private-value', target: 'owned-file' }, resourceIds: [],
    preconditions: { revision: '1' }, description: 'Owned action', status: 'prepared', approved: true, createdAt: '' };
  store.internal('fixture', thread.id, () => { store.put('thread', thread.id, thread.id, thread); store.put('operation', operation.id, thread.id, operation); });
  const save = approval => store.internal('fixture.approval', thread.id, () => store.put('approval', approval.approvalId, thread.id, approval));
  const approve = () => { const approval = ledger.issueApproval(operation, thread); save(approval); return approval; };
  const dispatch = () => {
    ledger.verifyOperationApproval(operation, thread);
    return ledger.admitOperationDispatch(operation, thread, () => store.put('operation', operation.id, thread.id, { ...operation, status: 'running' }));
  };
  cleanups.push(async () => { auth.revoke(); store.close(); await rm(root, { recursive: true, force: true }); });
  return { thread, ctx: { threadId: thread.id, runId: thread.runId, epoch: thread.epoch }, operation, auth, save, approve, dispatch, get store() { return store; }, get ledger() { return ledger; },
    withoutSigner: () => new ToolEffectLedger(store, authority, flags()),
    reopen: next => { store.close(); store = new Store(join(root, 'state')); ledger = new ToolEffectLedger(store, authority, flags(), next); },
  };
}

function authentic(auth, grant) {
  const { hostAuthenticator, ...fields } = grant;
  expect(hostAuthenticator).toMatchObject({ version: 1, keyId: auth.keyId });
  expect(auth.verify('grant', fields, hostAuthenticator.tag)).toBe(true);
}

it('issues and atomically spends an authenticated grant, with a separately authenticated spent state', async () => {
  const x = await fixture(), approval = x.approve();
  authentic(x.auth, approval);
  const effect = x.dispatch(), spent = x.store.get('approval', approval.approvalId);
  expect(effect.state).toBe('DISPATCHED'); expect(spent.remainingUses).toBe(0);
  authentic(x.auth, spent);
  expect(spent.hostAuthenticator.tag).not.toBe(approval.hostAuthenticator.tag);
  expect(x.store.get('operation', x.operation.id).status).toBe('running');
});

it.each([
  ['issuer', grant => ({ ...grant, issuer: 'model' })],
  ['uses', grant => ({ ...grant, remainingUses: 2 })],
  ['preconditions', grant => ({ ...grant, targetPreconditions: ['revision=unapproved'] })],
  ['issuedAt', grant => ({ ...grant, issuedAt: 'not-a-date' })],
  ['expiresAt', grant => ({ ...grant, expiresAt: 'not-a-date' })],
  ['unknown field', grant => ({ ...grant, newAuthority: 'unapproved' })],
  ['MAC', grant => ({ ...grant, hostAuthenticator: { version: 1, keyId, tag: 'v1:' + keyId + ':' + '0'.repeat(64) } })],
  ['authenticator version', grant => ({ ...grant, hostAuthenticator: { ...grant.hostAuthenticator, version: 2 } })],
])('denies a tampered %s before dispatch and preserves the presented row', async (_label, mutate) => {
  const x = await fixture(), tampered = mutate(x.approve()); x.save(tampered);
  const sequence = x.store.sequence;
  expect(x.dispatch).toThrowError(/approval|approved|authentic/i);
  expect(x.store.get('approval', tampered.approvalId)).toEqual(tampered);
  expect(x.store.get('operation', x.operation.id).status).toBe('prepared');
  expect(x.ledger.get('operation:' + x.operation.id + '@1')).toBeNull();
  expect(x.store.sequence).toBe(sequence);
});

it('keeps an unsigned legacy grant readable but refuses its enabled-mode authority', async () => {
  const x = await fixture(), { hostAuthenticator: _auth, ...legacy } = x.approve(); x.save(legacy);
  expect(x.ledger.approvalFor(x.operation.id)).toEqual(legacy);
  expect(x.dispatch).toThrowError(/approval|authentic/i);
  expect(x.ledger.get('operation:' + x.operation.id + '@1')).toBeNull();
});

it('does not revive a spent grant by changing remainingUses back to one', async () => {
  const x = await fixture(), approval = x.approve(); x.dispatch();
  const spent = x.store.get('approval', approval.approvalId); x.save({ ...spent, remainingUses: 1 });
  expect(() => x.ledger.verifyOperationApproval(x.operation, x.thread)).toThrowError(/approval|authentic/i);
  expect(x.ledger.get('operation:' + x.operation.id + '@1').state).toBe('DISPATCHED');
});

it('rolls back authenticated spending together with dispatch and the operation update', async () => {
  const x = await fixture(), approval = x.approve(), sequence = x.store.sequence;
  expect(() => x.ledger.admitOperationDispatch(x.operation, x.thread, () => {
    x.store.put('operation', x.operation.id, x.thread.id, { ...x.operation, status: 'running' });
    throw Error('owned transactional fault');
  })).toThrowError('owned transactional fault');
  expect(x.store.get('approval', approval.approvalId)).toEqual(approval);
  expect(x.ledger.get('operation:' + x.operation.id + '@1')).toBeNull();
  expect(x.store.get('operation', x.operation.id)).toEqual(x.operation);
  expect(x.store.sequence).toBe(sequence);
});

it('survives Store restart with the same key and preserves the single dispatch receipt', async () => {
  const x = await fixture(), approval = x.approve(); x.reopen(signer());
  const effect = x.dispatch(); x.ledger.settle(effect.invocationId, { value: { writes: 1 } }, 'SUCCEEDED');
  x.reopen(signer());
  const mark = vi.fn();
  expect(x.ledger.admitOperationDispatch(x.operation, x.thread, mark).outcome.value).toEqual({ writes: 1 });
  expect(mark).not.toHaveBeenCalled();
  expect(x.store.get('approval', approval.approvalId).remainingUses).toBe(0);
});

it('refuses a different key after restart instead of treating it as a fresh approval', async () => {
  const x = await fixture(), approval = x.approve(); x.reopen(signer(4));
  expect(x.dispatch).toThrowError(/approval|authentic/i);
  expect(x.store.get('approval', approval.approvalId)).toEqual(approval);
  expect(x.ledger.get('operation:' + x.operation.id + '@1')).toBeNull();
});

it('requires custody for issuance while retaining readable prior evidence', async () => {
  const x = await fixture(), approval = x.approve(), missing = x.withoutSigner();
  expect(missing.approvalFor(x.operation.id)).toEqual(approval);
  expect(() => missing.issueApproval(x.operation, x.thread)).toThrowError(/unavailable/i);
  expect(() => missing.verifyOperationApproval(x.operation, x.thread)).toThrowError(/unavailable/i);
});

it('requires custody for a new audited invocation before invoking its executor', async () => {
  const x = await fixture(), executor = vi.fn(async () => 'forbidden');
  await expect(x.withoutSigner().invoke({ call: { name: 'repository_read', args: { invocationId: 'missing-key' } },
    ctx: x.ctx, thread: x.thread, role: 'run' }, executor)).rejects.toMatchObject({ code: 'EFFECT_KEY_UNAVAILABLE' });
  expect(executor).not.toHaveBeenCalled(); expect(x.ledger.get('missing-key')).toBeNull();
});

it('uses keyed invocation commitments consistently across admission and dedupe', async () => {
  const x = await fixture(), call = { name: 'repository_read', args: { invocationId: 'keyed-read', api_token: 'small-private-value' } };
  const executor = vi.fn(async () => ({ value: 'observed-once' }));
  await x.ledger.invoke({ call, ctx: x.ctx, thread: x.thread, role: 'run' }, executor);
  const effect = x.ledger.get('keyed-read');
  expect(effect.privateArgumentCommitment).not.toBe(privateArgumentCommitment(call));
  expect(effect.privateArgumentCommitment).toBe(x.ledger.privateArgumentCommitment(call));
  await expect(x.ledger.invoke({ call, ctx: x.ctx, thread: x.thread, role: 'run' }, executor)).resolves.toEqual({ value: 'observed-once' });
  expect(executor).toHaveBeenCalledTimes(1);
  expect(effect.publicRedactedSummary).not.toContain('small-private-value');
});

it('retains the existing default-off ledger behavior for legacy callers', async () => {
  const x = await fixture(), disabled = new ToolEffectLedger(x.store, new ToolAuthority(buildToolRegistry()));
  const approval = disabled.issueApproval(x.operation, x.thread);
  expect(approval.hostAuthenticator).toBeUndefined();
  expect(approval.remainingUses).toBe(1);
});
