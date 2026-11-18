import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/storage/store.ts';
import { ToolEffectLedger, ownerFor } from '../packages/core/tool-effects.ts';
import { ToolAuthority, type RegistryEntry } from '../packages/core/tool-authority.ts';
import type { Thread, ToolCall } from '../packages/contracts/index.ts';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'effect-replay-owner-'));
  const store = new Store(root);
  cleanups.push(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const thread = { id: 'thread-a', runId: 'run-a', epoch: 1, accountId: 'account-a', projectId: 'project-a', workspaceId: 'workspace-a' } as Thread;
  const ctx = { threadId: thread.id, runId: thread.runId, epoch: thread.epoch };
  const definition: RegistryEntry = { id: 'fixture_read', version: 1, schemaDigest: 'a'.repeat(64),
    risk: 'READ', replayClass: 'READ_RETRYABLE', allowedRoles: ['run'], executorBinding: 'read', approval: 'none' };
  const authority = new ToolAuthority([definition]);
  const ledger = new ToolEffectLedger(store, authority);
  const call: ToolCall = { name: definition.id, args: { invocationId: 'inv-a', path: 'fixture.txt' } };
  const input = { call, ctx, thread, role: 'run' as const };
  const executor = vi.fn(async () => ({ value: 'private original result' }));
  return { ledger, authority, definition, call, input, thread, executor };
}

describe('M02 replay retains exact owner and current authorization', () => {
  it.each(['accountId', 'projectId', 'workspaceId'] as const)('rejects invoke replay after %s changes', async field => {
    const x = fixture();
    await x.ledger.invoke(x.input, x.executor);
    const before = x.ledger.get('inv-a');
    await expect(x.ledger.invoke({ ...x.input, thread: { ...x.thread, [field]: 'other' } }, x.executor))
      .rejects.toMatchObject({ code: 'INVOCATION_CONFLICT' });
    expect(x.executor).toHaveBeenCalledTimes(1);
    expect(x.ledger.get('inv-a')).toEqual(before);
  });

  it.each(['accountId', 'projectId', 'workspaceId'] as const)('rejects direct readmission after %s changes', field => {
    const x = fixture();
    x.ledger.admit({ call: x.call, owner: ownerFor(x.thread), definition: x.definition });
    const before = x.ledger.get('inv-a');
    expect(() => x.ledger.admit({ call: x.call, owner: ownerFor({ ...x.thread, [field]: 'other' }), definition: x.definition }))
      .toThrow(expect.objectContaining({ code: 'INVOCATION_CONFLICT' }));
    expect(x.ledger.get('inv-a')).toEqual(before);
  });

  it.each(['epoch', 'role'] as const)('does not bypass a current %s denial with cached success', async change => {
    const x = fixture();
    await x.ledger.invoke(x.input, x.executor);
    const before = x.ledger.get('inv-a');
    const input = change === 'epoch'
      ? { ...x.input, thread: { ...x.thread, epoch: 2, runId: null } }
      : { ...x.input, role: 'side' as const };
    await expect(x.ledger.invoke(input, x.executor)).rejects.toMatchObject({ code: 'AUTHORITY_DENIED' });
    expect(x.executor).toHaveBeenCalledTimes(1);
    expect(x.ledger.get('inv-a')).toEqual(before);
  });

  it.each(['invoke', 'admit'] as const)('rejects a changed schema during %s', async method => {
    const x = fixture();
    await x.ledger.invoke(x.input, x.executor);
    const before = x.ledger.get('inv-a');
    // The authority parses its own copy, so a schema change reaches the ledger
    // through the entry it actually authorizes against, not the caller's object.
    x.definition.schemaDigest = 'b'.repeat(64);
    x.authority.require(x.definition.id).schemaDigest = 'b'.repeat(64);
    const replay = () => method === 'invoke' ? x.ledger.invoke(x.input, x.executor)
      : x.ledger.admit({ call: x.call, owner: ownerFor(x.thread), definition: x.definition });
    await expect(Promise.resolve().then(replay)).rejects.toMatchObject({ code: 'INVOCATION_CONFLICT' });
    expect(x.ledger.get('inv-a')).toEqual(before);
    expect(x.executor).toHaveBeenCalledTimes(1);
  });

  it('reuses an unchanged authorized receipt without dispatching twice', async () => {
    const x = fixture();
    const original = await x.ledger.invoke(x.input, x.executor);
    expect(await x.ledger.invoke(x.input, x.executor)).toEqual(original);
    expect(x.executor).toHaveBeenCalledTimes(1);
  });
});
