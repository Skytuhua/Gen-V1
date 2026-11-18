const { afterEach, expect, it, vi } = await import('vitest');
const { mkdtemp, rm } = await import('node:fs/promises');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { Store } = await import('../packages/storage/store.ts');
const { buildToolRegistry, ToolAuthority } = await import('../packages/core/tool-authority.ts');
const { publicRedactedSummary, ToolEffectLedger } = await import('../packages/core/tool-effects.ts');

const cleanups = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

it.each(['Authorization', 'Proxy-Authorization', 'Cookie', 'Set-Cookie', 'aUtHoRiZaTiOn'])
  ('redacts the standard credential header %s from public effect summaries', header => {
    const secret = 'fixture-sensitive-value-' + header;
    const summary = publicRedactedSummary({ name: 'integration_call', args: { headers: { [header]: secret } } });
    expect(summary).not.toContain(secret);
    expect(summary).toContain('<redacted>');
  });

it('redacts credential headers nested in request arrays', () => {
  const summary = publicRedactedSummary({
    name: 'integration_call', args: { requests: [{ headers: { Authorization: 'nested-fixture-secret' } }] },
  });
  expect(summary).not.toContain('nested-fixture-secret');
  expect(summary).toContain('<redacted>');
});

it('retains existing secret-key redaction', () => {
  const summary = publicRedactedSummary({ name: 'integration_call', args: { api_token: 'old-fixture-secret' } });
  expect(summary).not.toContain('old-fixture-secret');
  expect(summary).toContain('<redacted>');
});

it('keeps an ordinary header useful and omits the command control identifier', () => {
  const summary = publicRedactedSummary({
    name: 'integration_call', args: { headers: { Accept: 'application/json' }, commandId: 'hidden-control-id' },
  });
  expect(summary).toContain('application/json');
  expect(summary).not.toContain('hidden-control-id');
});

it.each([
  { role: 'run', code: 'APPROVAL_REQUIRED', state: 'PREPARED' },
  { role: 'side', code: 'AUTHORITY_DENIED', state: 'DENIED' },
])('persists a redacted $state receipt before any provider executor can run', async ({ role, code, state }) => {
  const root = await mkdtemp(join(tmpdir(), 'effect-header-redaction-'));
  const store = new Store(join(root, 'state'));
  cleanups.push(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  const ledger = new ToolEffectLedger(store, new ToolAuthority(buildToolRegistry()));
  const thread = {
    id: 'header-thread', runId: 'header-run', epoch: 1,
    accountId: null, projectId: null, workspaceId: null,
  };
  const executor = vi.fn(async () => ({ unexpected: true }));
  const invocationId = 'header-' + state;
  await expect(ledger.invoke({
    call: { name: 'integration_call', args: {
      invocationId, headers: { Authorization: 'provider-fixture-secret', Cookie: 'session=fixture-cookie' },
    } },
    ctx: { threadId: thread.id, runId: thread.runId, epoch: thread.epoch }, thread, role,
  }, executor)).rejects.toMatchObject({ code });
  expect(executor).not.toHaveBeenCalled();
  const effect = store.get('toolEffect', invocationId);
  expect(effect).toMatchObject({ state, toolId: 'integration_call' });
  expect(effect.publicRedactedSummary).not.toContain('provider-fixture-secret');
  expect(effect.publicRedactedSummary).not.toContain('session=fixture-cookie');
  expect(effect.publicRedactedSummary).toContain('<redacted>');
});
