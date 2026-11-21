import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/storage/store.ts';
import { ToolAuthority, buildToolRegistry } from '../packages/core/tool-authority.ts';
import { m12Ledger } from './fixtures/tool-program-replay-harness-v3.ts';
import type { Thread } from '../packages/contracts/index.ts';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()));
const thread = { id: 't', runId: 'r', epoch: 1, projectId: 'p', workspaceId: 'w', accountId: 'a' } as Thread;
const ctx = { threadId: 't', runId: 'r', epoch: 1 };
const call = { name: 'repository_read', args: { invocationId: 'nested', resourceId: 'resource', path: 'private argument' } };
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'm12-authority-')), store = new Store(dir);
  cleanups.push(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { store, ledger: m12Ledger(store, new ToolAuthority(buildToolRegistry())) };
}

it.each(['accountId', 'projectId', 'workspaceId'] as const)('does not reattach a receipt after %s changes', async key => {
  const { ledger } = fixture();
  await ledger.invoke({ call, ctx, thread, role: 'run' }, async () => 7);
  await expect(ledger.invoke({ call, ctx, thread: { ...thread, [key]: 'other' }, role: 'run' }, async () => 8)).rejects.toMatchObject({ code: 'INVOCATION_CONFLICT' });
  expect(ledger.get('nested')?.outcome?.value).toBe(7);
});

it('rechecks current role authority before returning a completed receipt', async () => {
  const { ledger } = fixture();
  await ledger.invoke({ call, ctx, thread, role: 'run' }, async () => 7);
  await expect(ledger.invoke({ call, ctx, thread, role: 'side' }, async () => 8)).rejects.toMatchObject({ code: 'AUTHORITY_DENIED' });
  expect(ledger.get('nested')?.state).toBe('SUCCEEDED');
});

it('binds receipt reuse to the entire current definition', async () => {
  const { store, ledger } = fixture();
  await ledger.invoke({ call, ctx, thread, role: 'run' }, async () => 7);
  const entries = buildToolRegistry().map(entry => entry.id === call.name ? { ...entry, schemaDigest: entry.schemaDigest + ':changed' } : entry);
  const changed = m12Ledger(store, new ToolAuthority(entries));
  await expect(changed.invoke({ call, ctx, thread, role: 'run' }, async () => 8)).rejects.toMatchObject({ code: 'INVOCATION_CONFLICT' });
});

it('links a private nested call to its parent without publishing arguments or raw errors', async () => {
  const { store, ledger } = fixture();
  await expect(ledger.invoke({ call, ctx, thread, role: 'run', parentInvocationId: 'program', privateArguments: true }, async () => {
    expect(ledger.get('nested')?.parentInvocationId).toBe('program');
    throw new Error('private source error');
  })).rejects.toThrow();
  const receipt = ledger.get('nested');
  expect(receipt?.parentInvocationId).toBe('program');
  expect(JSON.stringify(receipt)).not.toContain('private argument');
  expect(JSON.stringify(receipt)).not.toContain('private source error');
  expect(JSON.stringify(store.eventsAfter(0))).not.toContain('private argument');
});
