import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CreateModelRuntimeOptions } from '@earendil-works/pi-coding-agent';
import { HarnessError } from '../contracts/index.ts';
import { acquireLinuxCredentialReadBarrier } from '../core/linux-path-guard.ts';
import { acquireWindowsCredentialReadBarrier } from '../core/windows-credential-lease.ts';
import { SUBSCRIPTION_OAUTH_PROVIDER_IDS, isSubscriptionProviderId } from '../contracts/connections.ts';
import { isPlanCredential, isPlanProvider } from './plan-keys.ts';

export type LiteralCredentialStore = NonNullable<CreateModelRuntimeOptions['credentials']>;
type Credential = NonNullable<Awaited<ReturnType<LiteralCredentialStore['read']>>>;
type OperationOptions = Parameters<LiteralCredentialStore['read']>[1];
type LockResult<T> = { result: T; next?: string };
interface Backend {
  withLock<T>(fn: (current: string | undefined) => LockResult<T>): T;
  withLockAsync<T>(fn: (current: string | undefined) => Promise<LockResult<T>>, options?: OperationOptions): Promise<T>;
}
interface NativeStorageModule {
  FileAuthStorageBackend: new (authPath: string) => Backend;
  AuthStorage: { fromStorage(backend: Backend): LiteralCredentialStore };
}
export interface LiteralCredentialLease {
  readonly expiresAt: number;
  readonly signal: AbortSignal;
  readonly settled: Promise<void>;
  assertCurrent(): void;
  read(providerId: string): Credential | undefined;
  /** A rejection means ownership is uncertain: retain the caller's profile/use holds. */
  release(): Promise<void>;
}
const MAX_STORAGE_BYTES = 1024 * 1024;
const RESERVED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
function invalidStore() { return new HarnessError('PI_CREDENTIAL_STORE_INVALID', 'Credential storage is invalid or exceeds its limits. Restore a valid auth.json or sign in again.'); }
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }

/** Parse data only; never expand environment references or execute Pi configuration commands. */
function parseData(content: string | undefined): Record<string, unknown> {
  if (content === undefined || content === '') return Object.create(null) as Record<string, unknown>;
  if (Buffer.byteLength(content, 'utf8') > MAX_STORAGE_BYTES) throw invalidStore();
  try {
    const value: unknown = JSON.parse(content.replace(/^\uFEFF/, ''));
    if (!isRecord(value)) throw invalidStore();
    let entries = 0;
    const inspect = (item: unknown, depth: number) => {
      if (depth > 16 || ++entries > 16384) throw invalidStore();
      if (typeof item === 'number' && !Number.isFinite(item)) throw invalidStore();
      if (item && typeof item === 'object') for (const [key, nested] of Object.entries(item)) {
        if (RESERVED_KEYS.has(key)) throw invalidStore();
        inspect(nested, depth + 1);
      }
    };
    inspect(value, 0);
    return Object.assign(Object.create(null) as Record<string, unknown>, value);
  } catch { throw invalidStore(); }
}
function admitted(providerId: string, value: unknown): Credential | undefined {
  if (!isSubscriptionProviderId(providerId) || !isRecord(value)) return undefined;
  if (isPlanProvider(providerId)) return isPlanCredential(providerId, value)
    ? { type: 'api_key', key: value.key, env: { HARNESS_CONNECTION_KIND: value.env!.HARNESS_CONNECTION_KIND } } : undefined;
  if (SUBSCRIPTION_OAUTH_PROVIDER_IDS.some(id => id === providerId) && value.type === 'oauth'
    && typeof value.access === 'string' && value.access.length > 0 && value.access.length <= 65536
    && typeof value.refresh === 'string' && value.refresh.length <= 65536
    && typeof value.expires === 'number' && Number.isFinite(value.expires) && value.expires >= 0) return structuredClone(value) as Credential;
  return undefined;
}

let storageModule: Promise<NativeStorageModule> | undefined;
function storageModuleUrl(): string {
  const require = createRequire(import.meta.url), name = '@earendil-works/pi-coding-agent';
  for (const directory of require.resolve.paths(name) ?? []) {
    let metadata: string;
    try { metadata = require.resolve(join(directory, name, 'package.json')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') continue; throw error; }
    const info: unknown = JSON.parse(readFileSync(metadata, 'utf8'));
    if (!isRecord(info) || info.name !== name || info.version !== '1.4.0') throw new HarnessError('PI_UNAVAILABLE', 'Literal credential storage requires the pinned Pi SDK 1.4.0. Complete pnpm install and restart.');
    return pathToFileURL(require.resolve(join(dirname(metadata), 'dist/core/auth-storage.js'))).href;
  }
  throw new HarnessError('PI_UNAVAILABLE', 'Pi SDK 1.4.0 credential storage is unavailable. Complete pnpm install and restart.');
}
function nativeStorage() {
  // This private backend is pinned with Pi 1.4.0. Resolve through its installed import entry,
  // without importing an independently resolved transitive pi-ai version or replacing SDK methods.
  storageModule ??= import(storageModuleUrl()) as Promise<NativeStorageModule>;
  return storageModule;
}

/** Host-only snapshot under the native mount/share-deny write barrier.
 * The caller retains profile/use custody through a bounded operation (at most five minutes)
 * and release. Expiry revokes authority but never restores writes by itself. */
export async function acquireLiteralCredentialLease(authPath: string, options: {signal: AbortSignal; maxHoldMs: number}): Promise<LiteralCredentialLease> {
  const unavailable = () => new HarnessError('PI_CREDENTIAL_LEASE_UNAVAILABLE', 'Protected credential evidence is unavailable.');
  const uncertain = () => new HarnessError('PI_CREDENTIAL_LEASE_RELEASE_UNCERTAIN', 'Credential evidence custody did not settle. Retain caller custody.');
  if (!['linux', 'win32'].includes(process.platform) || !options || !(options.signal instanceof AbortSignal)
    || !Number.isSafeInteger(options.maxHoldMs) || options.maxHoldMs < 1 || options.maxHoldMs > 300000
    || typeof authPath !== 'string' || !isAbsolute(authPath) || resolve(authPath) !== authPath) throw unavailable();
  options.signal.throwIfAborted();
  // Native SDK locks alone cannot fence delayed refresh writers after lock loss.
  // Linux protects the existing mount; Windows denies write/delete sharing in this process.
  const windowsBarrier = process.platform === 'win32' ? acquireWindowsCredentialReadBarrier(authPath, options) : undefined;
  const barrier = windowsBarrier ?? await acquireLinuxCredentialReadBarrier(authPath, options);
  const revoked = new AbortController(), uid = process.platform === 'linux' ? BigInt(process.getuid!()) : 0n;
  let authFd: number | undefined, invalid = false, original = '';
  let snapshot: Record<string, unknown> = Object.create(null);
  let releasePromise: Promise<void> | undefined;
  let settledResolve!: () => void, settledReject!: (error: unknown) => void;
  const settled = new Promise<void>((done, fail) => {settledResolve = done; settledReject = fail;});
  void settled.catch(() => {});
  const closeHandle = () => {if (authFd !== undefined) {const fd = authFd; authFd = undefined; closeSync(fd);}};
  const invalidate = () => {
    if (!invalid) {
      invalid = true;
      revoked.abort(new HarnessError('PI_CREDENTIAL_LEASE_LOST', 'Credential evidence is no longer current.'));
    }
  };
  const content = () => {
    if (windowsBarrier) return windowsBarrier.read();
    if (authFd === undefined) throw unavailable();
    const held = fstatSync(authFd, {bigint: true}), current = lstatSync(authPath, {bigint: true});
    if (!held.isFile() || held.nlink !== 1n || held.uid !== uid || (held.mode & 0o077n) !== 0n
      || current.isSymbolicLink() || current.dev !== held.dev || current.ino !== held.ino
      || held.size > BigInt(MAX_STORAGE_BYTES)) throw unavailable();
    const buffer = Buffer.alloc(Number(held.size) + 1); let size = 0;
    while (size < buffer.length) {const read = readSync(authFd, buffer, size, buffer.length - size, size); if (!read) break; size += read;}
    const after = fstatSync(authFd, {bigint: true}), named = lstatSync(authPath, {bigint: true});
    if (BigInt(size) !== held.size || after.size !== held.size || after.nlink !== 1n
      || after.mtimeNs !== held.mtimeNs || after.ctimeNs !== held.ctimeNs
      || named.isSymbolicLink() || named.dev !== after.dev || named.ino !== after.ino) throw unavailable();
    return buffer.subarray(0, size);
  };
  const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const release = () => {
    if (!releasePromise) {
      // Publish the promise before abort listeners can reenter release().
      releasePromise = Promise.resolve().then(async () => {
        let closeError = false;
        try {closeHandle();} catch {closeError = true;}
        try {await barrier.release();} catch {throw uncertain();}
        if (closeError) throw uncertain();
      });
      void releasePromise.then(settledResolve, settledReject);
      invalidate();
      barrier.signal.removeEventListener('abort', invalidate);
      snapshot = Object.create(null) as Record<string, unknown>;
    }
    return releasePromise;
  };
  const assertCurrent = () => {
    if (invalid || options.signal.aborted) {invalidate(); throw unavailable();}
    try {
      barrier.assertCurrent();
      if (digest(content()) !== original) throw unavailable();
      barrier.assertCurrent();
    } catch {invalidate(); throw unavailable();}
  };
  try {
    barrier.assertCurrent();
    // Nonblocking open refuses FIFO/device traps before the ordinary-file check.
    if (process.platform === 'linux') authFd = openSync(authPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const bytes = content(); snapshot = parseData(bytes.toString('utf8')); original = digest(bytes);
    barrier.signal.addEventListener('abort', invalidate, {once: true});
    assertCurrent();
    return Object.freeze({expiresAt: barrier.expiresAt, signal: revoked.signal, settled, assertCurrent,
      read(providerId: string) {assertCurrent(); return admitted(providerId, snapshot[providerId]);}, release});
  } catch {
    await release();
    throw unavailable();
  }
}

/** SDK file locks and mutations, with app-owned literal reads before any runtime refresh can run. */
export async function createLiteralCredentialStore(authPath: string): Promise<LiteralCredentialStore> {
  const { FileAuthStorageBackend, AuthStorage } = await nativeStorage();
  const raw = new FileAuthStorageBackend(authPath);
  const sizeCheck = () => {
    try { if (statSync(authPath).size > MAX_STORAGE_BYTES) throw invalidStore(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw invalidStore(); }
  };
  const checked: Backend = {
    withLock(fn) {
      sizeCheck();
      return raw.withLock(current => { parseData(current); const result = fn(current); if (result.next !== undefined) parseData(result.next); return result; });
    },
    async withLockAsync(fn, options) {
      options?.signal?.throwIfAborted(); sizeCheck();
      return raw.withLockAsync(async current => {
        options?.signal?.throwIfAborted(); parseData(current);
        const result = await fn(current); options?.signal?.throwIfAborted();
        if (result.next !== undefined) parseData(result.next);
        return result;
      }, options);
    },
  };
  const native = AuthStorage.fromStorage(checked);
  const readData = async (options?: OperationOptions) => {
    options?.signal?.throwIfAborted();
    const result = await checked.withLockAsync(async current => ({ result: parseData(current) }), options);
    options?.signal?.throwIfAborted(); return result;
  };
  return {
    async read(providerId, options) {
      options?.signal?.throwIfAborted();
      if (!isSubscriptionProviderId(providerId)) return undefined;
      return admitted(providerId, (await readData(options))[providerId]);
    },
    async list(options) {
      const data = await readData(options);
      return Object.keys(data).flatMap(providerId => { const credential = admitted(providerId, data[providerId]); return credential ? [{ providerId, type: credential.type }] : []; });
    },
    async modify(providerId, fn, options) {
      options?.signal?.throwIfAborted();
      if (!isSubscriptionProviderId(providerId)) throw invalidStore();
      const result = await native.modify(providerId, async current => {
        options?.signal?.throwIfAborted();
        const next = await fn(admitted(providerId, current)); options?.signal?.throwIfAborted();
        if (next === undefined) return undefined;
        const literal = admitted(providerId, next); if (!literal) throw invalidStore();
        return literal;
      }, options);
      options?.signal?.throwIfAborted(); return admitted(providerId, result);
    },
    async delete(providerId, options) {
      options?.signal?.throwIfAborted();
      if (!isSubscriptionProviderId(providerId)) throw invalidStore();
      await native.delete(providerId, options); options?.signal?.throwIfAborted();
    },
  };
}
