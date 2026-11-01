import { lstat, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SdkCredentialStore, StoredSdkCredentials } from '@cursor/sdk';
import { HarnessError } from '../contracts/index.ts';
import { officialRuntimeHome } from './environment.ts';
import { secureDirectory, within } from './manifest.ts';

export const CURSOR_LOGIN_BACKEND = 'https://api2.cursor.sh';
export const CURSOR_LOGIN_WEBSITE = 'https://cursor.com';
export const cursorAuthPath = (dataDir: string): string => join(officialRuntimeHome(dataDir, 'cursor-sdk'), 'sdk-browser-login.json');
export const cursorAuthRequired = () => new HarnessError('OFFICIAL_SUBSCRIPTION_REQUIRED', 'Sign in through the private official Cursor browser login before using this connection. Paid tier and remaining allowance are not reported by this SDK.');

/** Only this store's explicit browser-login save path can establish provenance. */
export function cursorCredentialStore(dataDir: string, browserLogin = false): SdkCredentialStore {
  const path = cursorAuthPath(dataDir);
  const valid = (value: unknown): value is StoredSdkCredentials => {
    const c = value as StoredSdkCredentials | undefined;
    return !!c && c.version === 1 && c.backendUrl === CURSOR_LOGIN_BACKEND && typeof c.apiKey === 'string' && c.apiKey.length > 0 && c.apiKey.length < 16_384 && !/[\r\n\u0000]/.test(c.apiKey) && Number.isFinite(c.createdAtMs) && (c.apiKeyExpiresAtMs === undefined || (Number.isFinite(c.apiKeyExpiresAtMs) && c.apiKeyExpiresAtMs > Date.now()));
  };
  return {
    async load() {
      try {
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 32_768 || !within(await realpath(resolve(dataDir)), await realpath(path))) return undefined;
        const stored = JSON.parse(await readFile(path, 'utf8'));
        return stored?.version === 1 && stored.provenance === 'cursor-sdk-official-browser' && valid(stored.credentials) ? stored.credentials : undefined;
      } catch { return undefined; }
    },
    async save(credentials) {
      if (!browserLogin || !valid(credentials)) throw cursorAuthRequired();
      await secureDirectory(dataDir, dirname(path));
      const temporary = join(dirname(path), `.browser-login-${randomUUID()}.tmp`);
      await writeFile(temporary, JSON.stringify({ version: 1, provenance: 'cursor-sdk-official-browser', credentials }), { mode: 0o600, flag: 'wx' });
      await rename(temporary, path);
    },
    async clear() { if (!browserLogin) throw cursorAuthRequired(); await unlink(path).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); },
  };
}

export function assertCursorLoginUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw cursorAuthRequired(); }
  const keys = [...url.searchParams.keys()].sort();
  if (url.origin !== CURSOR_LOGIN_WEBSITE || url.pathname !== '/loginDeepControl' || url.username || url.password || url.hash || JSON.stringify(keys) !== JSON.stringify(['challenge', 'mode', 'redirectTarget', 'uuid']) || url.searchParams.get('mode') !== 'login' || url.searchParams.get('redirectTarget') !== 'sdk' || !/^[A-Za-z0-9_-]{40,100}$/.test(url.searchParams.get('challenge') ?? '') || !/^[A-Za-z0-9-]{32,40}$/.test(url.searchParams.get('uuid') ?? '')) throw cursorAuthRequired();
  return url.href;
}
