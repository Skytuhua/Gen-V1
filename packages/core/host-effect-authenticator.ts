import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { HarnessError } from '../contracts/index.ts';
import { digest } from '../storage/store.ts';
import { windowsSecretCodec, type SecretCodec } from './environment-settings.ts';
import { readBoundFile, withPathGuard } from './file-access.ts';

const domains = ['arguments', 'action', 'grant', 'operation-definition'] as const;
export type EffectAuthenticationDomain = typeof domains[number];
export interface EffectAuthenticator {
  readonly keyId: string;
  commit(domain: EffectAuthenticationDomain, value: unknown): string;
  verify(domain: EffectAuthenticationDomain, value: unknown, commitment: string): boolean;
}
export interface RevocableEffectAuthenticator extends EffectAuthenticator { revoke(): void }
export interface EffectKeyCustody { readonly authenticator: EffectAuthenticator; close(): Promise<void> }
interface KeyOptions { codec?: SecretCodec; expectedKeyId?: string }

const unavailable = () => new HarnessError('EFFECT_KEY_UNAVAILABLE', 'Protected effect authority is unavailable.');
const keyIdentity = z.string().uuid();
const envelope = z.strictObject({ version: z.literal(1), keyId: keyIdentity, protectedKey: z.string().min(1).max(32_768) });
const payload = z.strictObject({ version: z.literal(1), keyId: keyIdentity, profile: z.string().min(1).max(4096), key: z.string().regex(/^[a-f0-9]{64}$/) });
const MAX_KEY_FILE_BYTES = 65_536;

/** Trusted host construction only. The retained copy is never a Store value,
 * environment entry, command argument, diagnostic or model-visible resolver. */
export function createEffectAuthenticator(bytes: Uint8Array, keyId: string): RevocableEffectAuthenticator {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 32 || !keyIdentity.safeParse(keyId).success) throw unavailable();
  const key = Buffer.from(bytes); let active = true;
  const assertCurrent = () => { if (!active) throw unavailable(); };
  const commit = (domain: EffectAuthenticationDomain, value: unknown): string => {
    assertCurrent(); if (!domains.includes(domain)) throw unavailable();
    const mac = createHmac('sha256', key)
      .update('gen-v1/effect-authenticator/v1\0' + keyId + '\0' + domain + '\0')
      .update(digest(value)).digest('hex');
    return 'v1:' + keyId + ':' + mac;
  };
  return Object.freeze({
    keyId, commit,
    verify(domain: EffectAuthenticationDomain, value: unknown, commitment: string) {
      assertCurrent();
      const prefix = 'v1:' + keyId + ':';
      if (typeof commitment !== 'string' || commitment.length !== prefix.length + 64
        || !commitment.startsWith(prefix) || !/^[a-f0-9]{64}$/.test(commitment.slice(prefix.length))) return false;
      return timingSafeEqual(Buffer.from(commit(domain, value).slice(prefix.length), 'hex'), Buffer.from(commitment.slice(prefix.length), 'hex'));
    },
    revoke() { active = false; key.fill(0); },
  });
}

async function canonicalProfile(dataDir: string): Promise<string> {
  // The existing Linux guard does not implement read-only leaf custody. Do not
  // turn a codec injection or an ordinary filesystem check into a fallback.
  if (process.platform !== 'win32' || !dataDir.trim()) throw unavailable();
  const path = resolve(dataDir), info = await lstat(path), actual = await realpath(path);
  if (!info.isDirectory() || info.isSymbolicLink() || path.toLowerCase() !== actual.toLowerCase()) throw unavailable();
  return actual;
}
const profileBinding = (profile: string) => profile.toLowerCase();

/** Explicit first creation. Existing or partially initialized custody is never
 * overwritten. Ordinary reopen must use openEffectKey instead. */
export async function initializeEffectKey(dataDir: string, options: Pick<KeyOptions, 'codec'> = {}): Promise<EffectKeyCustody> {
  let key: Buffer | undefined;
  try {
    const profile = await canonicalProfile(dataDir), keyId = randomUUID();
    const directory = join(profile, 'effect-authority'), path = join(directory, 'key.json');
    key = randomBytes(32);
    const protectedKey = await (options.codec ?? windowsSecretCodec()).protect(JSON.stringify({ version: 1, keyId, profile: profileBinding(profile), key: key.toString('hex') }));
    const serialized = JSON.stringify(envelope.parse({ version: 1, keyId, protectedKey }));
    await withPathGuard([{ path: profile, leaf: false, allowChildWrites: true }], new AbortController().signal, async () => {
      await mkdir(directory, { mode: 0o700 });
      await withPathGuard([{ path: directory, leaf: false, allowChildWrites: true, childWriteRoot: profile }], new AbortController().signal, async () => {
        const file = await open(path, 'wx', 0o600);
        try { await file.writeFile(serialized, 'utf8'); await file.sync(); }
        finally { await file.close(); }
      });
    }, undefined, { startupAcquisition: true });
    return await openEffectKey(profile, { ...options, expectedKeyId: keyId });
  } catch { throw unavailable(); }
  finally { key?.fill(0); }
}

/** Keep native custody alive while synchronous Store transactions use the key.
 * Closing or losing custody revokes signing before asynchronous teardown. */
export async function openEffectKey(dataDir: string, options: KeyOptions = {}): Promise<EffectKeyCustody> {
  try {
    const profile = await canonicalProfile(dataDir), path = join(profile, 'effect-authority', 'key.json');
    if (options.expectedKeyId !== undefined && !keyIdentity.safeParse(options.expectedKeyId).success) throw unavailable();
    const info = await lstat(path, { bigint: true });
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n || info.size > BigInt(MAX_KEY_FILE_BYTES)) throw unavailable();
    const identity = { dev: String(info.dev), ino: String(info.ino), size: Number(info.size) };
    let signer: RevocableEffectAuthenticator | undefined, lost = false;
    let release!: () => void, accept!: (value: EffectKeyCustody) => void, reject!: (error: Error) => void;
    const released = new Promise<void>(resolveRelease => { release = resolveRelease; });
    const ready = new Promise<EffectKeyCustody>((resolveReady, rejectReady) => { accept = resolveReady; reject = rejectReady; });
    const revoke = () => { lost = true; signer?.revoke(); release(); };
    const lifetime = withPathGuard([{
      path, leaf: true, readOnly: true, allowChildWrites: true, childWriteRoot: profile, dev: identity.dev, ino: identity.ino,
    }], new AbortController().signal, async () => {
      let bytes: Buffer | undefined;
      try {
        const stored = envelope.parse(JSON.parse((await readBoundFile(path, MAX_KEY_FILE_BYTES, identity)).toString('utf8')));
        if (options.expectedKeyId !== undefined && stored.keyId !== options.expectedKeyId) throw unavailable();
        const plaintext = await (options.codec ?? windowsSecretCodec()).unprotect(stored.protectedKey);
        if (Buffer.byteLength(plaintext, 'utf8') > 16_384) throw unavailable();
        const decoded = payload.parse(JSON.parse(plaintext));
        if (decoded.keyId !== stored.keyId || decoded.profile !== profileBinding(profile) || lost) throw unavailable();
        bytes = Buffer.from(decoded.key, 'hex'); signer = createEffectAuthenticator(bytes, stored.keyId);
        accept(Object.freeze({ authenticator: signer, close() { revoke(); return lifetime; } }));
        await released;
      } finally { bytes?.fill(0); signer?.revoke(); }
    }, revoke, { startupAcquisition: true }).catch(() => { revoke(); const error = unavailable(); reject(error); throw error; });
    // A post-open loss is retained for close(); it is not an unhandled detached
    // rejection. An opening failure rejects ready only after native teardown.
    void lifetime.catch(() => {});
    return await ready;
  } catch { throw unavailable(); }
}
