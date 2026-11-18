const { afterEach, expect, it } = await import('vitest');
const { mkdtemp, rm } = await import('node:fs/promises');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { ZodError } = await import('zod');
const { Store } = await import('../packages/storage/store.ts');
const { buildToolRegistry, ToolAuthority } = await import('../packages/core/tool-authority.ts');
const { createToolEffectFlags, ToolEffectLedger } = await import('../packages/core/tool-effects.ts');
const { toolDefinitionSchema } = await import('../packages/contracts/tool-effects.ts');
const { testEffectAuthenticator } = await import('./fixtures/effect-authenticator.ts');

const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const definition = () => buildToolRegistry().find(entry => entry.id === 'repository_read');

it.each([2, 99])('rejects unsupported definition version %s in the V1 contract', version => {
  const { approval, ...contract } = definition();
  expect(approval).toBe('none');
  const parsed = toolDefinitionSchema.safeParse({ ...contract, version });
  expect(parsed.success).toBe(false);
  expect(parsed.error.issues.some(issue => issue.path[0] === 'version')).toBe(true);
});

it.each([2, 99])('refuses registry version %s before ledger admission or executor invocation', async version => {
  const x = await fixture();
  await expect(x.invoke(version)).rejects.toBeInstanceOf(ZodError);
  expect(x.invocations()).toBe(0);
  expect(x.store.all('toolEffect')).toEqual([]);
});

it('accepts the supported V1 contract and executes its registered definition once', async () => {
  const { approval, ...contract } = definition();
  expect(approval).toBe('none');
  expect(toolDefinitionSchema.parse(contract)).toEqual(contract);
  const x = await fixture();
  expect(await x.invoke(1)).toEqual({ content: 'read result' });
  expect(x.invocations()).toBe(1);
  expect(x.store.get('toolEffect', 'version-check')).toMatchObject({
    state: 'SUCCEEDED', toolId: 'repository_read',
  });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tool-definition-version-'));
  const store = new Store(join(root, 'state'));
  cleanups.push(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  let count = 0;
  const thread = {
    id: 'version-thread', runId: 'version-run', epoch: 1,
    accountId: null, projectId: null, workspaceId: null,
  };
  const invoke = async version => {
    const authority = new ToolAuthority([{ ...definition(), version }]);
    const ledger = new ToolEffectLedger(store, authority,
      createToolEffectFlags({ 'audit.effectsV1': true, 'security.authorityV1': true }), testEffectAuthenticator());
    return ledger.invoke({
      call: { name: 'repository_read', args: { invocationId: 'version-check', resourceId: 'fixture' } },
      ctx: { threadId: thread.id, runId: thread.runId, epoch: thread.epoch }, thread, role: 'run',
    }, async () => { count++; return { content: 'read result' }; });
  };
  return { store, invoke, invocations: () => count };
}
