import { afterEach, describe, expect, it, vi } from 'vitest';
import * as childProcess from 'node:child_process';
import { once } from 'node:events';
import { copyFile, link, mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createEffectAuthenticator, initializeEffectKey, openEffectKey,
  type EffectKeyCustody,
} from '../packages/core/host-effect-authenticator.ts';
import { assertNotStorage } from '../packages/core/security.ts';
import type { SecretCodec } from '../packages/core/environment-settings.ts';

const keyId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
async function directory() {
  const root = await mkdtemp(join(tmpdir(), 'host-effect-key-'));
  cleanups.push(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  return root;
}
const keyFile = (root: string) => join(root, 'effect-authority', 'key.json');
function owned(custody: EffectKeyCustody) {
  cleanups.push(() => custody.close().catch(() => {}));
  return custody;
}
// Explicit codec injection tests file custody without claiming DPAPI coverage.
const codec: SecretCodec = {
  protect: async value => Buffer.from('test-protected:' + value).toString('base64'),
  unprotect: async value => {
    const text = Buffer.from(value, 'base64').toString();
    if (!text.startsWith('test-protected:')) throw Error('invalid test ciphertext');
    return text.slice('test-protected:'.length);
  },
};

describe('host-only effect authenticators', () => {
  it('normalizes values and separates purpose, key and key identity', () => {
    const auth = createEffectAuthenticator(Buffer.alloc(32, 1), keyId);
    const first = auth.commit('arguments', { b: [2, 1], a: 1 });
    expect(first).toBe(auth.commit('arguments', { a: 1, b: [2, 1] }));
    expect(auth.verify('arguments', { a: 1, b: [2, 1] }, first)).toBe(true);
    expect(auth.verify('action', { a: 1, b: [2, 1] }, first)).toBe(false);
    expect(createEffectAuthenticator(Buffer.alloc(32, 2), keyId).verify('arguments', { a: 1, b: [2, 1] }, first)).toBe(false);
    expect(createEffectAuthenticator(Buffer.alloc(32, 1), otherId).verify('arguments', { a: 1, b: [2, 1] }, first)).toBe(false);
    expect(auth.verify('arguments', { a: 2, b: [2, 1] }, first)).toBe(false);
  });

  it.each(['', '0'.repeat(64), 'v2:' + keyId + ':' + '0'.repeat(64), 'v1:' + keyId + ':xyz', 'x'.repeat(4096)])
    ('rejects a malformed authenticator without accepting a prefix: %s', tag => {
      const auth = createEffectAuthenticator(Buffer.alloc(32, 1), keyId);
      expect(auth.verify('grant', { remainingUses: 1 }, tag)).toBe(false);
    });

  it('owns its key copy, exposes no key, and revokes synchronous authority', () => {
    const bytes = Buffer.alloc(32, 7), auth = createEffectAuthenticator(bytes, keyId);
    const tag = auth.commit('grant', { remainingUses: 1 });
    bytes.fill(0);
    expect(auth.verify('grant', { remainingUses: 1 }, tag)).toBe(true);
    expect(JSON.stringify(auth)).toBe(JSON.stringify({ keyId }));
    auth.revoke(); auth.revoke();
    expect(() => auth.commit('grant', { remainingUses: 1 })).toThrowError(/unavailable/i);
    expect(() => auth.verify('grant', { remainingUses: 1 }, tag)).toThrowError(/unavailable/i);
  });

  it('rejects invalid key material and key identifiers', () => {
    expect(() => createEffectAuthenticator(Buffer.alloc(31), keyId)).toThrow();
    expect(() => createEffectAuthenticator(Buffer.alloc(33), keyId)).toThrow();
    expect(() => createEffectAuthenticator(Buffer.alloc(32), 'unknown')).toThrow();
  });

  it('reserves the key directory from task resource grants', async () => {
    const root = await directory();
    expect(() => assertNotStorage(keyFile(root), root)).toThrowError(/storage|credentials/i);
    expect(() => assertNotStorage(join(root, 'ordinary-project', 'notes.txt'), root)).not.toThrow();
  });

  it.skipIf(process.platform === 'win32')('fails closed without a supported native custody boundary', async () => {
    const root = await directory();
    await expect(initializeEffectKey(root, { codec })).rejects.toMatchObject({ code: 'EFFECT_KEY_UNAVAILABLE' });
    await expect(openEffectKey(root, { codec })).rejects.toMatchObject({ code: 'EFFECT_KEY_UNAVAILABLE' });
    await expect(readFile(keyFile(root))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe.runIf(process.platform === 'win32')('real Windows effect-key custody', () => {
  it('persists through real CurrentUser DPAPI and reopens the same authority', async () => {
    const root = await directory(), custody = owned(await initializeEffectKey(root));
    const tag = custody.authenticator.commit('arguments', { password: 'synthetic-private-argument' });
    const serialized = await readFile(keyFile(root), 'utf8');
    expect(Object.keys(JSON.parse(serialized)).sort()).toEqual(['keyId', 'protectedKey', 'version']);
    expect(serialized).not.toContain('synthetic-private-argument');
    const closing = custody.close();
    expect(() => custody.authenticator.commit('grant', {})).toThrowError(/unavailable/i);
    await closing;
    const reopened = owned(await openEffectKey(root, { expectedKeyId: custody.authenticator.keyId }));
    expect(reopened.authenticator.verify('arguments', { password: 'synthetic-private-argument' }, tag)).toBe(true);
  });

  it('allows only one competing initializer and never overwrites its key', async () => {
    const root = await directory();
    const attempts = await Promise.allSettled([initializeEffectKey(root, { codec }), initializeEffectKey(root, { codec })]);
    expect(attempts.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    const success = attempts.find(value => value.status === 'fulfilled') as PromiseFulfilledResult<EffectKeyCustody>;
    const custody = owned(success.value), original = await readFile(keyFile(root), 'utf8');
    await expect(initializeEffectKey(root, { codec })).rejects.toMatchObject({ code: 'EFFECT_KEY_UNAVAILABLE' });
    expect(await readFile(keyFile(root), 'utf8')).toBe(original);
    await custody.close();
  });

  it('holds read-only file custody until close', async () => {
    const root = await directory(), custody = owned(await initializeEffectKey(root, { codec }));
    await expect(writeFile(keyFile(root), 'replacement')).rejects.toThrow();
    await expect(rename(keyFile(root), keyFile(root) + '.moved')).rejects.toThrow();
    await custody.close();
    await writeFile(keyFile(root), 'corrupt');
    await expect(openEffectKey(root, { codec })).rejects.toMatchObject({ code: 'EFFECT_KEY_UNAVAILABLE' });
    // Failure has released the guard before rejecting, so cleanup can own the file.
    await unlink(keyFile(root));
  });

  it('refuses lost keys and refuses to recreate a partially initialized profile', async () => {
    const root = await directory(), custody = owned(await initializeEffectKey(root, { codec }));
    await custody.close(); await unlink(keyFile(root));
    await expect(openEffectKey(root, { codec })).rejects.toMatchObject({ code: 'EFFECT_KEY_UNAVAILABLE' });
    await expect(initializeEffectKey(root, { codec })).rejects.toMatchObject({ code: 'EFFECT_KEY_UNAVAILABLE' });
  });

  it('binds the key to its exact profile and requested key identity', async () => {
    const root = await directory(), other = await directory();
    const custody = owned(await initializeEffectKey(root, { codec }));
    await expect(openEffectKey(root, { codec, expectedKeyId: otherId })).rejects.toMatchObject({ code: 'EFFECT_KEY_UNAVAILABLE' });
    await mkdir(join(other, 'effect-authority')); await copyFile(keyFile(root), keyFile(other));
    await expect(openEffectKey(other, { codec })).rejects.toMatchObject({ code: 'EFFECT_KEY_UNAVAILABLE' });
  });

  it('refuses multi-link key files and hides unprotect failure details', async () => {
    const root = await directory(), custody = owned(await initializeEffectKey(root, { codec }));
    await custody.close(); await link(keyFile(root), join(root, 'alias.json'));
    await expect(openEffectKey(root, { codec })).rejects.toMatchObject({ code: 'EFFECT_KEY_UNAVAILABLE' });
    await unlink(join(root, 'alias.json'));
    const error = await openEffectKey(root, { codec: { ...codec, unprotect: async () => { throw Error('private-codec-diagnostic'); } } }).catch(value => value);
    expect(error).toMatchObject({ code: 'EFFECT_KEY_UNAVAILABLE' });
    expect(String(error)).not.toContain('private-codec-diagnostic');
    await unlink(keyFile(root));
  });

  it('revokes synchronous authority when its actual owned native guard exits', async () => {
    const root = await directory(), originalSpawn = childProcess.spawn;
    const guards: childProcess.ChildProcess[] = [];
    vi.spyOn(childProcess, 'spawn').mockImplementation((...args: Parameters<typeof childProcess.spawn>) => {
      const child = originalSpawn(...args);
      if (Array.isArray(args[1]) && args[1].some(value => String(value).endsWith('windows-path-guard.ps1'))) guards.push(child);
      return child;
    });
    const custody = owned(await initializeEffectKey(root, { codec }));
    const guard = guards.filter(child => child.exitCode === null && child.signalCode === null).at(-1);
    expect(guard?.pid).toBeTruthy();
    const stopped = once(guard!, 'exit');
    expect(guard!.kill()).toBe(true); await stopped;
    expect(() => custody.authenticator.commit('grant', {})).toThrowError(/unavailable/i);
    await expect(custody.close()).rejects.toMatchObject({ code: 'EFFECT_KEY_UNAVAILABLE' });
  });
});
