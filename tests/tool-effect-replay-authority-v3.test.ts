import { testEffectAuthenticator } from './fixtures/effect-authenticator.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Thread, ToolCall } from '../packages/contracts/index.ts';
import { Store } from '../packages/storage/store.ts';
import { ToolAuthority, type RegistryEntry } from '../packages/core/tool-authority.ts';
import { ToolEffectLedger, createToolEffectFlags, ownerFor } from '../packages/core/tool-effects.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
const thread = (overrides: Partial<Thread> = {}): Thread => ({
  id: 'thread-1', title: 'Replay authority', projectName: null, createdAt: '', updatedAt: '', status: 'working',
  epoch: 1, runId: 'run-1', modelId: 'test/model', sessionPath: null,
  accountId: 'account-1', projectId: 'project-1', workspaceId: 'workspace-1', ...overrides,
} as Thread);
const ctx = { threadId: 'thread-1', runId: 'run-1', epoch: 1 };
const call: ToolCall = { name: 'fixture.read', args: { invocationId: 'same-input', path: 'README.md' } };
const definition = (overrides: Partial<RegistryEntry> = {}): RegistryEntry => ({
  id: call.name, version: 1, schemaDigest: 'a'.repeat(64), risk: 'READ', replayClass: 'READ_RETRYABLE',
  allowedRoles: ['run'], executorBinding: 'read', approval: 'none', ...overrides,
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'harness-replay-authority-'));
  const store = new Store(join(root, 'state'));
  cleanups.push(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  const signer = testEffectAuthenticator();
  const create = (entry = definition()) => new ToolEffectLedger(store, new ToolAuthority([entry]), createToolEffectFlags({ 'audit.effectsV1': true, 'security.authorityV1': true }), signer);
  const ledger = create();
  const executor = vi.fn(async () => ({ content: 'account-one-only' }));
  await ledger.invoke({ call, ctx, thread: thread(), role: 'run' }, executor);
  return { ledger, create, executor, retained: ledger.get('same-input') };
}

describe('cached tool outcomes retain current authorization', () => {
  it('does not bypass a denied actor role or overwrite the successful receipt', async () => {
    const { ledger, executor, retained } = await fixture();
    await expect(ledger.invoke({ call, ctx, thread: thread(), role: 'side' }, executor)).rejects.toMatchObject({ code: 'AUTHORITY_DENIED' });
    expect(executor).toHaveBeenCalledTimes(1);
    expect(ledger.get('same-input')).toEqual(retained);
  });

  it('does not revive a stopped run by returning its previous cached result', async () => {
    const { ledger, executor, retained } = await fixture();
    await expect(ledger.invoke({ call, ctx, thread: thread({ epoch: 2, runId: null }), role: 'run' }, executor)).rejects.toMatchObject({ code: 'AUTHORITY_DENIED' });
    expect(executor).toHaveBeenCalledTimes(1);
    expect(ledger.get('same-input')).toEqual(retained);
  });

  it.each(['accountId', 'projectId', 'workspaceId'] as const)('refuses reuse after %s changes without a second dispatch', async key => {
    const { ledger, executor, retained } = await fixture();
    await expect(ledger.invoke({ call, ctx, thread: thread({ [key]: 'new-binding' }), role: 'run' }, executor)).rejects.toMatchObject({ code: 'INVOCATION_CONFLICT' });
    expect(executor).toHaveBeenCalledTimes(1);
    expect(ledger.get('same-input')).toEqual(retained);
  });

  it('refuses the same arguments under a changed registered schema', async () => {
    const { ledger, create, executor, retained } = await fixture();
    const changed = create(definition({ schemaDigest: 'b'.repeat(64) }));
    await expect(changed.invoke({ call, ctx, thread: thread(), role: 'run' }, executor)).rejects.toMatchObject({ code: 'INVOCATION_CONFLICT' });
    expect(executor).toHaveBeenCalledTimes(1);
    expect(ledger.get('same-input')).toEqual(retained);
  });

  it('does not bypass a newly required explicit approval with an older result', async () => {
    const { ledger, create, executor, retained } = await fixture();
    const restricted = create(definition({ approval: 'explicit' }));
    await expect(restricted.invoke({ call, ctx, thread: thread(), role: 'run' }, executor)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    expect(executor).toHaveBeenCalledTimes(1);
    expect(ledger.get('same-input')).toEqual(retained);
  });

  it.each(['accountId', 'projectId', 'workspaceId'] as const)('applies the same %s identity check to direct duplicate admission', async key => {
    const { ledger, retained } = await fixture();
    expect(() => ledger.admit({ call, owner: ownerFor(thread({ [key]: 'new-binding' }), ctx), definition: definition() })).toThrowError(/different arguments or owner/);
    expect(ledger.get('same-input')).toEqual(retained);
  });

  it('rejects a changed schema at direct duplicate admission', async () => {
    const { ledger, retained } = await fixture();
    expect(() => ledger.admit({ call, owner: ownerFor(thread(), ctx), definition: definition({ schemaDigest: 'b'.repeat(64) }) })).toThrowError(/different arguments or owner/);
    expect(ledger.get('same-input')).toEqual(retained);
  });

  it('continues to deduplicate a currently authorized identical retry', async () => {
    const { ledger, executor, retained } = await fixture();
    await expect(ledger.invoke({ call, ctx, thread: thread(), role: 'run' }, executor)).resolves.toEqual({ content: 'account-one-only' });
    expect(executor).toHaveBeenCalledTimes(1);
    expect(ledger.get('same-input')).toEqual(retained);
  });
});
