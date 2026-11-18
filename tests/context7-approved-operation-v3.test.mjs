import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { HarnessError } from '../packages/contracts/index.ts';
import { buildToolRegistry } from '../packages/core/tool-authority.ts';
import { approvedContext7 as fixture, context7FixtureKey as key, context7FixtureRequest as request } from './fixtures/approved-context7.mjs';

// Only the native lease is substituted. Real Store, Service commands, signed
// admission, file hashes, SDK stdio and owned Node child remain in this test.
// These cases establish host composition, not Windows native acceptance.
const seam = vi.hoisted(() => ({ before: undefined, deny: false, paths: [], loss: undefined, failAfter: false }));
vi.mock('../packages/core/file-access.ts', async original => {
  const actual = await original();
  return { ...actual, withPathGuard: async (paths, signal, action, onLoss) => {
    seam.loss = onLoss;
    seam.paths.push(structuredClone(paths)); await seam.before?.();
    if (signal.aborted) throw new HarnessError('CANCELLED', 'Owned lease fixture cancelled');
    if (seam.deny) throw new HarnessError('CAPABILITY_DENIED', 'Owned lease fixture denied');
    try { return await action([]); }
    finally {
      // An ambient withPathGuard session releases its group in finally. Its
      // release rejection can replace either callback success or failure.
      if (seam.failAfter) throw new HarnessError('CAPABILITY_DENIED', 'Owned post-result custody failure');
    }
  } };
});
afterEach(() => { seam.before = undefined; seam.deny = false; seam.paths.length = 0; seam.loss = undefined; seam.failAfter = false; });

describe('Context7 SecretRef through the real approved Operation lifecycle', () => {
  it('exposes the strict preparation tool through the actual authenticated host registry', async () => {
    const x = await fixture();
    expect(buildToolRegistry().find(value => value.id === 'integration_prepare')).toMatchObject({ executorBinding: 'domain-prepare', approval: 'operation' });
    const settings = await x.host.settingsFor(x.run);
    expect(settings.hostTools.find(value => value.name === 'integration_prepare')).toMatchObject({ parameters: expect.any(Object) });
    expect(await x.starts()).toEqual([]);
  });

  it('prepares bound opaque metadata without approval or credential delivery', async () => {
    const x = await fixture(), operation = await x.prepare();
    expect(operation).toMatchObject({ kind: 'integration.context7', status: 'prepared', approved: false,
      args: { request, reference: { refId: expect.stringMatching(/^context7\./), destination: { envName: 'CONTEXT7_API_KEY' } },
        binding: { executable: { sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }, entry: { sha256: expect.stringMatching(/^[a-f0-9]{64}$/) } } } });
    expect(x.store.all('approval')).toEqual([]); expect(await x.starts()).toEqual([]);
    const records = JSON.stringify(x.store.db.prepare('SELECT kind,body FROM entities').all());
    expect(records).not.toContain(key); expect(records).not.toContain(createHash('sha256').update(key).digest('hex'));
  });

  it('delivers the exact configured credential once after signed approval and closes that session', async () => {
    const x = await fixture(), operation = await x.prepare(), result = await x.execute(operation);
    expect(result).toMatchObject({ status: 'succeeded', result: { content: [{ type: 'text', text: 'Owned public documentation result' }], isError: false } });
    expect(await x.starts()).toEqual([{ credential: true, credentialMatched: true }]);
    expect(x.store.all('approval').find(value => value.operationId === operation.id)).toMatchObject({ remainingUses: 0, hostAuthenticator: expect.any(Object) });
    expect(x.store.get('toolEffect', 'operation:' + operation.id + '@1').state).toBe('SUCCEEDED');
    expect((await x.host.manager.status('context7', x.scope)).state).toBe('ready');
    expect(seam.paths.some(paths => paths.filter(path => path.readOnly).length >= 3)).toBe(true);
    await x.service.dispatchOperation(operation.id);
    expect(await x.starts()).toHaveLength(1);
  });

  it('supports approved tool discovery without starting a child from an ordinary list request', async () => {
    const x = await fixture();
    await expect(x.service.tool({ name: 'integration_list', args: { id: 'context7' } }, x.ctx)).rejects.toMatchObject({ code: 'SECRET_REF_APPROVAL' });
    expect(await x.starts()).toEqual([]);
    const operation = await x.prepare({ id: 'context7', action: 'list_tools' });
    expect((await x.execute(operation)).result).toMatchObject({ tools: [{ name: 'owned_documentation' }] });
    expect(await x.starts()).toEqual([{ credential: true, credentialMatched: true }]);
  });

  it('does not dispatch a prepared request without the native user approval command', async () => {
    const x = await fixture(), operation = await x.prepare();
    await expect(x.service.dispatchOperation(operation.id)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    expect(await x.starts()).toEqual([]);
  });

  it.each(['replace', 'clear'])('refuses a reference after credential %s', async change => {
    const x = await fixture(), operation = await x.prepare();
    await x.host.configurePrivate({ context7ApiKey: change === 'clear' ? '' : key + '_replacement' });
    expect((await x.execute(operation)).status).toBe('failed');
    expect(await x.starts()).toEqual([]);
  });

  it.each(['entry', 'manifest'])('rejects changed %s bytes before credential resolution', async target => {
    const x = await fixture(), operation = await x.prepare();
    await appendFile(target === 'entry' ? join(x.bundle, x.entry) : join(x.bundle, 'third-party/integrations/manifest.json'), '\n');
    expect((await x.execute(operation)).status).toBe('failed');
    expect(await x.starts()).toEqual([]);
  });

  it('rejects a replaced working-directory identity even with the same path', async () => {
    const x = await fixture(), operation = await x.prepare();
    await rename(x.project, x.project + '-previous'); await mkdir(x.project);
    expect((await x.execute(operation)).status).toBe('failed'); expect(await x.starts()).toEqual([]);
  });

  it('keeps a native custody denial closed without a fallback child', async () => {
    const x = await fixture(), operation = await x.prepare(); seam.deny = true;
    expect((await x.execute(operation)).status).toBe('failed'); expect(await x.starts()).toEqual([]);
  });

  it('rechecks the exact owner after asynchronous custody acquisition', async () => {
    const x = await fixture(), operation = await x.prepare();
    seam.before = async () => {
      seam.before = undefined; const current = x.store.get('thread', x.thread.id);
      x.store.internal('fixture.revoke-owner', current.id, () => x.store.put('thread', current.id, current.id, { ...current, epoch: current.epoch + 1 }));
    };
    expect((await x.execute(operation)).status).toBe('failed'); expect(await x.starts()).toEqual([]);
  });

  it('does not accept model-selected paths, secret values or reference identities', async () => {
    const x = await fixture();
    for (const extra of [{ executable: '/model/path' }, { context7ApiKey: key }, { refId: 'model-reference' }, { id: 'promptfoo' }]) {
      await expect(x.prepare({ ...request, ...extra })).rejects.toThrow();
    }
    expect(x.store.all('operation')).toEqual([]); expect(await x.starts()).toEqual([]);
  });

  it('requires authenticated authority without enabling the policy itself', async () => {
    const x = await fixture({ toolEffectFlags: {} });
    await expect(x.prepare()).rejects.toMatchObject({ code: 'SECRET_REF_AUTHORITY_REQUIRED' });
    expect(x.store.all('operation')).toEqual([]); expect(await x.starts()).toEqual([]);
  });

  it('keeps the preparation surface absent when SecretRef mode is off', async () => {
    const x = await fixture({ secretRefsEnabled: false });
    expect((await x.host.settingsFor(x.run)).hostTools.some(value => value.name === 'integration_prepare')).toBe(false);
    await expect(x.prepare()).rejects.toThrow(); expect(await x.starts()).toEqual([]);
  });

  it('redacts a known credential before the approved result reaches public Store records', async () => {
    const x = await fixture({ echoCredential: true }), operation = await x.prepare();
    expect((await x.execute(operation)).result).toMatchObject({ content: [{ type: 'text', text: '[REDACTED]' }] });
    expect(await x.starts()).toEqual([{ credential: true, credentialMatched: true }]);
    expect(JSON.stringify(x.store.db.prepare('SELECT kind,body FROM entities').all())).not.toContain(key);
  });

  it('rejects a credential below the redactor tracking minimum before any child starts', async () => {
    const shortCredential = 'v1Q4';
    const x = await fixture({ echoCredential: true });
    await x.host.configurePrivate({ context7ApiKey: shortCredential });
    const operation = await x.prepare();
    const result = await x.execute(operation);
    expect(result.status).toBe('failed');
    expect(await x.starts()).toEqual([]);
    expect(await x.calls()).toEqual([]);
    expect(JSON.stringify(x.store.db.prepare('SELECT kind,body FROM entities').all())).not.toContain(shortCredential);
  });

  it.each(['native loss', 'key revocation', 'Stop'])('drains a real pending child and records uncertainty after %s', async cause => {
    const x = await fixture({ holdCall: true }), operation = await x.prepare(), pending = x.execute(operation);
    await expect.poll(x.calls, { timeout: 5000 }).toHaveLength(1);
    const pid = (await x.calls())[0].pid;
    if (cause === 'native loss') seam.loss();
    else if (cause === 'key revocation') await x.host.configurePrivate({ context7ApiKey: '' });
    else await x.command('run.stop');
    const result = await pending;
    expect(result.status).toBe('unknown');
    expect(x.store.get('toolEffect', 'operation:' + operation.id + '@1').state).toBe('UNKNOWN_EXTERNAL_OUTCOME');
    expect(() => process.kill(pid, 0)).toThrow();
    expect(JSON.stringify(x.store.db.prepare('SELECT kind,body FROM entities').all())).not.toContain(key);
  });

  it('preserves the observed result when native custody rejects after confirmed child teardown', async () => {
    const x = await fixture(), operation = await x.prepare(); seam.failAfter = true;
    const result = await x.execute(operation);
    expect(await x.starts()).toEqual([{ credential: true, credentialMatched: true }]);
    const pid = (await x.calls())[0].pid;
    expect(() => process.kill(pid, 0)).toThrow();
    expect(result).toMatchObject({ status: 'unknown', result: { observedResult: { content: [{ type: 'text', text: 'Owned public documentation result' }], isError: false } } });
    expect(x.store.get('toolEffect', 'operation:' + operation.id + '@1').state).toBe('UNKNOWN_EXTERNAL_OUTCOME');
  });

  it('retains known uncertainty when native release rejects after interrupted child work', async () => {
    const x = await fixture({ holdCall: true }), operation = await x.prepare(); seam.failAfter = true;
    const pending = x.execute(operation);
    await expect.poll(x.calls, { timeout: 5000 }).toHaveLength(1);
    const pid = (await x.calls())[0].pid;
    await x.host.configurePrivate({ context7ApiKey: '' });
    const result = await pending;
    expect(await x.starts()).toEqual([{ credential: true, credentialMatched: true }]);
    expect(() => process.kill(pid, 0)).toThrow();
    expect(result.status).toBe('unknown');
    expect(x.store.get('toolEffect', 'operation:' + operation.id + '@1').state).toBe('UNKNOWN_EXTERNAL_OUTCOME');
    expect(JSON.stringify(x.store.db.prepare('SELECT kind,body FROM entities').all())).not.toContain(key);
  });
});
