import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CreateModelRuntimeOptions } from '@earendil-works/pi-coding-agent';
import { HarnessError } from '../contracts/index.ts';
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
