import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createLiteralCredentialStore } from '../packages/runtime-pi/credentials.ts';
import * as credentialHooks from '../packages/runtime-pi/credentials.ts';

const directories: string[] = [];
const child = createRequire(import.meta.url)('node:child_process') as typeof import('node:child_process');
let exec: MockInstance<typeof child.execSync>, spawn: MockInstance<typeof child.spawnSync>;
const plan = { type: 'api_key' as const, key: 'synthetic-literal-plan-key', env: { HARNESS_CONNECTION_KIND: 'opencode-go-v1' } };
const oauth = { type: 'oauth' as const, access: 'synthetic-access', refresh: 'synthetic-refresh', expires: Date.now() + 3_600_000, extra: { providerMetadata: 'retained' } };
beforeEach(() => {
  exec = vi.spyOn(child, 'execSync').mockImplementation(() => { throw new Error('Synthetic command intercepted; nothing executed.'); });
  spawn = vi.spyOn(child, 'spawnSync').mockImplementation(() => { throw new Error('Synthetic command intercepted; nothing executed.'); });
  syncBuiltinESMExports();
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No network in credential fixtures.'); }));
});

describe('protected credential evidence capability', () => {
  const acquire = (...args: Parameters<typeof credentialHooks.acquireLiteralCredentialLease>) => credentialHooks.acquireLiteralCredentialLease(...args);
  it('refuses an invalid native evidence path before opening storage', async () => {
    expect(typeof credentialHooks.acquireLiteralCredentialLease).toBe('function');
    if (process.platform !== 'linux') await expect(acquire('/never-opened/auth.json', {signal: new AbortController().signal, maxHoldMs: 1000})).rejects.toMatchObject({code: 'PI_CREDENTIAL_LEASE_UNAVAILABLE'});
  });
  it.each([20001, 300000])('honors cancellation for a finite operation hold of %sms before native activity', async maxHoldMs => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
    const cancel = new AbortController(), reason = new Error('Synthetic operation already cancelled');
    cancel.abort(reason);
    Object.defineProperty(process, 'platform', {...original, value: 'linux'});
    try {
      await expect(acquire(join(tmpdir(), 'never-opened-credential.json'), {signal: cancel.signal, maxHoldMs})).rejects.toBe(reason);
    } finally { Object.defineProperty(process, 'platform', original); }
  });
  it.each([0, -1, 300001, Number.NaN, Number.POSITIVE_INFINITY])('rejects unbounded hold %s without native credential activity', async maxHoldMs => {
    const {store, authPath} = await storage({openai: oauth}), before = await readFile(authPath);
    await expect(acquire(authPath, {signal: new AbortController().signal, maxHoldMs})).rejects.toMatchObject({code: 'PI_CREDENTIAL_LEASE_UNAVAILABLE'});
    expect(await readFile(authPath)).toEqual(before);
    await store.modify('opencode-go', async () => plan);
  });
  it('rejects an already-cancelled request without changing credentials', async () => {
    const {authPath} = await storage({openai: oauth}), before = await readFile(authPath), cancel = new AbortController();
    cancel.abort();
    await expect(acquire(authPath, {signal: cancel.signal, maxHoldMs: 1000})).rejects.toBeDefined();
    expect(await readFile(authPath)).toEqual(before);
  });
  (process.platform === 'linux' ? it : it.skip)('refuses an unprepared path without the actual root guardian, leaving native SDK storage usable', async () => {
    const {store, authPath} = await storage({openai: oauth}), before = await readFile(authPath);
    await expect(acquire(authPath, {signal: new AbortController().signal, maxHoldMs: 1000})).rejects.toBeDefined();
    expect(await readFile(authPath)).toEqual(before);
    await store.modify('opencode-go', async () => plan);
    expect(await store.read('opencode-go')).toEqual(plan);
  });
});
afterEach(async () => {
  expect(exec).not.toHaveBeenCalled(); expect(spawn).not.toHaveBeenCalled();
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); syncBuiltinESMExports();
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 30 })));
});
async function storage(data: unknown = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'harness-literal-store-')); directories.push(directory);
  const authPath = join(directory, 'auth.json'); await writeFile(authPath, JSON.stringify(data));
  return { authPath, store: await createLiteralCredentialStore(authPath) };
}

describe('literal subscription credential storage', () => {
  it('exposes only approved OAuth and explicit literal plan records without resolving foreign config', async () => {
    vi.stubEnv('HARNESS_SYNTHETIC_SECRET', 'synthetic-expanded-value');
    const { store } = await storage({ openai: oauth, 'opencode-go': { ...plan, env: { ...plan.env, UNRELATED: '!synthetic-env-command' } },
      'kimi-coding': { ...oauth }, anthropic: { type: 'api_key', key: '!synthetic-foreign-command' }, google: { type: 'api_key', key: '${HARNESS_SYNTHETIC_SECRET}' }, xai: { type: 'api_key', key: 'unmarked-payg' } });
    expect(await store.list()).toEqual([{ providerId: 'openai', type: 'oauth' }, { providerId: 'opencode-go', type: 'api_key' }]);
    expect(await store.read('openai')).toEqual(oauth);
    expect(await store.read('opencode-go')).toEqual(plan);
    for (const provider of ['anthropic', 'google', 'xai', 'kimi-coding', '__proto__']) expect(await store.read(provider)).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['!synthetic-command', '${HARNESS_SYNTHETIC_SECRET}', '$HARNESS_SYNTHETIC_SECRET', 'with space', 'bad\nkey'])('rejects marked nonliteral or unsafe values before SDK resolution', async key => {
    const { store } = await storage({ 'opencode-go': { ...plan, key } });
    expect(await store.read('opencode-go')).toBeUndefined(); expect(await store.list()).toEqual([]);
  });

  it('does not reinterpret OAuth token bytes or lose refresh metadata', async () => {
    const literal = { ...oauth, access: '!synthetic-oauth-token', refresh: '${synthetic-literal-refresh}' };
    const { store } = await storage({ openai: literal });
    expect(await store.read('openai')).toEqual(literal);
    expect(await store.modify('openai', async current => ({ ...current as typeof literal, access: 'rotated-synthetic-access' }))).toEqual({ ...literal, access: 'rotated-synthetic-access' });
  });

  it('preserves serialized concurrent writes, OAuth refresh data, deletions and unrelated raw records', async () => {
    const foreign = { type: 'api_key', key: '!synthetic-foreign-preserved' };
    const { store, authPath } = await storage({ openai: oauth, xai: oauth, anthropic: foreign });
    const peer = await createLiteralCredentialStore(authPath);
    const rotated = { ...oauth, access: 'synthetic-rotated-access', refresh: 'synthetic-rotated-refresh' };
    await Promise.all([store.modify('openai', async current => { expect(current).toEqual(oauth); return rotated; }), peer.modify('opencode-go', async () => plan), peer.delete('xai')]);
    expect(JSON.parse(await readFile(authPath, 'utf8'))).toEqual({ openai: rotated, anthropic: foreign, 'opencode-go': plan });
    expect(await store.read('openai')).toEqual(rotated); expect(await peer.read('opencode-go')).toEqual(plan);
  });

  it('keeps SDK OAuth refresh inside its credential mutation lock', async () => {
    const expired = { ...oauth, expires: Date.now() - 1000 };
    const { store, authPath } = await storage({ xai: expired });
    const runtime = await ModelRuntime.create({ authPath, credentials: store, modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
    const native = runtime.getProvider('xai')!, refreshed = { ...oauth, access: 'synthetic-refreshed-access', refresh: 'synthetic-refreshed-refresh', expires: Date.now() + 3_600_000 };
    const refresh = vi.fn(async () => refreshed);
    runtime.registerNativeProvider({ ...native, auth: { oauth: { ...native.auth.oauth!, refresh, toAuth: async credential => ({ apiKey: credential.access }) } } });
    const results = await Promise.all([runtime.getAuth('xai'), runtime.getAuth('xai')]);
    expect(results.every(result => result?.auth.apiKey === refreshed.access)).toBe(true); expect(refresh).toHaveBeenCalledTimes(1);
    expect(await store.read('xai')).toEqual(refreshed); expect(JSON.parse(await readFile(authPath, 'utf8')).xai).toEqual(refreshed);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects aborted operations before callbacks or disk mutations', async () => {
    const { store, authPath } = await storage({ openai: oauth }), controller = new AbortController(), callback = vi.fn(async () => plan);
    controller.abort();
    await expect(store.read('openai', { signal: controller.signal })).rejects.toThrow();
    await expect(store.list({ signal: controller.signal })).rejects.toThrow();
    await expect(store.modify('opencode-go', callback, { signal: controller.signal })).rejects.toThrow();
    await expect(store.delete('openai', { signal: controller.signal })).rejects.toThrow();
    expect(callback).not.toHaveBeenCalled(); expect(JSON.parse(await readFile(authPath, 'utf8'))).toEqual({ openai: oauth });
  });

  it('checks cancellation again after a mutation callback and does not commit its result', async () => {
    const { store, authPath } = await storage({ openai: oauth }), controller = new AbortController();
    await expect(store.modify('openai', async () => { controller.abort(); return { ...oauth, access: 'must-not-save' }; }, { signal: controller.signal })).rejects.toThrow();
    expect(JSON.parse(await readFile(authPath, 'utf8'))).toEqual({ openai: oauth });
  });

  it('aborts a waiting SDK file lock without invoking the waiting mutation', async () => {
    const { store, authPath } = await storage({ openai: oauth }), peer = await createLiteralCredentialStore(authPath), controller = new AbortController();
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    const holder = store.modify('openai', async current => { entered(); await held; return current; });
    await started;
    const callback = vi.fn(async () => plan), waiting = peer.modify('opencode-go', callback, { signal: controller.signal }), outcome = expect(waiting).rejects.toThrow();
    controller.abort(); await outcome; release(); await holder;
    expect(callback).not.toHaveBeenCalled(); expect(JSON.parse(await readFile(authPath, 'utf8'))).toEqual({ openai: oauth });
  });

  it.each(['anthropic', '__proto__', 'constructor', 'unknown'])('rejects writes and deletions outside the approved provider set', async provider => {
    const { store, authPath } = await storage({ openai: oauth }), callback = vi.fn(async () => plan);
    await expect(store.modify(provider, callback)).rejects.toMatchObject({ code: 'PI_CREDENTIAL_STORE_INVALID' });
    await expect(store.delete(provider)).rejects.toMatchObject({ code: 'PI_CREDENTIAL_STORE_INVALID' });
    expect(callback).not.toHaveBeenCalled(); expect(JSON.parse(await readFile(authPath, 'utf8'))).toEqual({ openai: oauth });
  });

  it('rejects unsafe new mutation values without saving them', async () => {
    const { store, authPath } = await storage();
    await expect(store.modify('opencode-go', async () => ({ ...plan, key: '!synthetic-write-probe' }))).rejects.toMatchObject({ code: 'PI_CREDENTIAL_STORE_INVALID' });
    expect(JSON.parse(await readFile(authPath, 'utf8'))).toEqual({});
  });

  it.each(['[]', 'null', '{invalid-synthetic-secret', '{"__proto__":{"polluted":true}}', '{"openai":{"constructor":{"prototype":{"polluted":true}}}}', '{"openai":{"expires":1e309}}', JSON.stringify({ giant: 'x'.repeat(1024 * 1024) })])('fails closed on invalid, prototype-bearing or oversized storage without echoing contents', async content => {
    const { store, authPath } = await storage(); await writeFile(authPath, content);
    const failure = store.read('openai');
    await expect(failure).rejects.toMatchObject({ code: 'PI_CREDENTIAL_STORE_INVALID' });
    await expect(failure).rejects.not.toThrow(/invalid-synthetic-secret|polluted|giant/);
    expect(await readFile(authPath, 'utf8')).toBe(content); expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
