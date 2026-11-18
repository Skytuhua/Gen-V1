import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { link, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ownedContext7 } from './fixtures/owned-context7.mjs';

const key = 'context7_synthetic_metadata_fixture_only';
async function status(host) {
  expect(typeof host.secretReferences).toBe('function');
  return host.secretReferences();
}

describe('Context7 secret-reference metadata at the actual host boundary', () => {
  it('keeps disabled metadata free of executable/key custody I/O', async () => {
    const x = await ownedContext7({ secretRefsEnabled: false, nodeExecutable: '/missing-owned-executable' });
    await x.host.configurePrivate({ context7ApiKey: key });
    expect(await status(x.host)).toEqual({ version: 1, enabled: false, configured: true, references: [] });
    expect(await x.starts()).toEqual([]);
  });

  it('reports unconfigured status without reading an executable', async () => {
    const x = await ownedContext7({ secretRefsEnabled: true, nodeExecutable: '/missing-owned-executable' });
    expect(await status(x.host)).toEqual({ version: 1, enabled: true, configured: false, references: [] });
    expect(await x.starts()).toEqual([]);
  });

  it('publishes only an opaque reference and observed permitted destination', async () => {
    const x = await ownedContext7({ secretRefsEnabled: true });
    await x.host.configurePrivate({ context7ApiKey: key });
    const first = await status(x.host), second = await status(x.host);
    expect(first).toMatchObject({ version: 1, enabled: true, configured: true, references: [{
      refId: expect.stringMatching(/^context7\.[a-f0-9-]{36}$/), purpose: 'Context7 documentation', owner: 'personal/context7',
      destination: { kind: 'process-env', envName: 'CONTEXT7_API_KEY', executableSha256: expect.stringMatching(/^[a-f0-9]{64}$/) }, revoked: false,
    }] });
    expect(Object.keys(first.references[0]).sort()).toEqual(['destination', 'owner', 'purpose', 'refId', 'revoked']);
    expect(second).toEqual(first);
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain(key);
    expect(serialized).not.toContain(createHash('sha256').update(key).digest('hex'));
    expect(await x.starts()).toEqual([]);
    first.references[0].destination.envName = 'CHANGED_BY_READER';
    expect(await status(x.host)).toEqual(second);
  });

  it('rotates the reference after a changed key and clears it after removal', async () => {
    const x = await ownedContext7({ secretRefsEnabled: true });
    await x.host.configurePrivate({ context7ApiKey: key });
    const first = await status(x.host);
    await x.host.configurePrivate({ context7ApiKey: key + '_replacement' });
    const second = await status(x.host);
    expect(second.references[0].refId).not.toBe(first.references[0].refId);
    expect(second.references[0].destination).toEqual(first.references[0].destination);
    await x.host.configurePrivate({ context7ApiKey: '' });
    expect(await status(x.host)).toEqual({ version: 1, enabled: true, configured: false, references: [] });
    expect(await x.starts()).toEqual([]);
  });

  it('returns a bounded generic unavailable status for a missing installed executable', async () => {
    const x = await ownedContext7({ secretRefsEnabled: true, nodeExecutable: '/missing-private-target/' + key });
    await x.host.configurePrivate({ context7ApiKey: key });
    const result = await status(x.host);
    expect(result).toMatchObject({ version: 1, enabled: true, configured: true, references: [], unavailableReason: expect.any(String) });
    expect(result.unavailableReason.length).toBeLessThanOrEqual(200);
    expect(JSON.stringify(result)).not.toContain(key);
    expect(await x.starts()).toEqual([]);
  });

  it('requires approved execution before a configured key can reach the MCP child', async () => {
    const x = await ownedContext7({ secretRefsEnabled: true });
    await x.host.configurePrivate({ context7ApiKey: key });
    await expect(x.host.manager.listTools('context7', x.scope)).rejects.toMatchObject({ code: 'SECRET_REF_APPROVAL' });
    expect(await x.starts()).toEqual([]);
  });

  it('preserves the existing unflagged private child configuration', async () => {
    const x = await ownedContext7({ secretRefsEnabled: false });
    await x.host.configurePrivate({ context7ApiKey: key });
    expect(await x.host.manager.listTools('context7', x.scope)).toMatchObject([{ name: 'owned_documentation' }]);
    expect(await x.starts()).toEqual([{ credential: true }]);
  });

  it('rotates the reference when the observed executable bytes change', async () => {
    const x = await ownedContext7({ secretRefsEnabled: true });
    const executable = join(x.root, 'metadata-only-executable');
    await writeFile(executable, 'owned executable bytes one');
    // This fixture inspects an ordinary owned file. It never launches it.
    const y = await ownedContext7({ secretRefsEnabled: true, nodeExecutable: executable });
    await y.host.configurePrivate({ context7ApiKey: key });
    const before = await status(y.host);
    await writeFile(executable, 'owned executable bytes two');
    const after = await status(y.host);
    expect(after.references[0].refId).not.toBe(before.references[0].refId);
    expect(after.references[0].destination.executableSha256).not.toBe(before.references[0].destination.executableSha256);
    expect(await y.starts()).toEqual([]);
  });

  it('does not expose a current reference for a multiply linked target', async () => {
    const x = await ownedContext7({ secretRefsEnabled: true }), executable = join(x.root, 'owned-target');
    await writeFile(executable, 'owned metadata target'); await link(executable, join(x.root, 'second-name'));
    const y = await ownedContext7({ secretRefsEnabled: true, nodeExecutable: executable });
    await y.host.configurePrivate({ context7ApiKey: key });
    expect(await status(y.host)).toMatchObject({ configured: true, references: [], unavailableReason: expect.any(String) });
    expect(await y.starts()).toEqual([]);
  });

  it('clears current metadata on host close without releasing a credential', async () => {
    const x = await ownedContext7({ secretRefsEnabled: true });
    await x.host.configurePrivate({ context7ApiKey: key });
    expect((await status(x.host)).references).toHaveLength(1);
    await x.host.close();
    expect(await status(x.host)).toEqual({ version: 1, enabled: true, configured: false, references: [] });
    expect(await x.starts()).toEqual([]);
  });
});
