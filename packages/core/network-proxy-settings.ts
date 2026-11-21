import { mkdir, readFile, rename, writeFile, lstat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { HarnessError } from '../contracts/index.ts';
import { MANDATORY_LOCAL_BYPASS, bypassesHost, canonicalizeBypass, parseBypassEntry } from './network-proxy-env.ts';
import { windowsSecretCodec, type SecretCodec } from '../storage/secret-codec.ts';
import type { NetworkProxyPublicState } from '../contracts/network-proxy.ts';

/**
 * #1531 T02 — profile-wide network proxy policy.
 * One versioned atomic document per profile directory; the credential blob and
 * the sanitized endpoint/bypass land in the same transaction (no plaintext, no
 * split-brain). Host-private snapshot methods are never exposed on routes.
 */

const invalid = (message: string) => new HarnessError('NETWORK_PROXY_INVALID', message);

/** Parse + canonicalize a proxy URL; userinfo is split out, never persisted inside url. */
export function parseProxyUrl(raw: string): { url: string; credentials: string | null } {
  if (Buffer.byteLength(raw, 'utf8') > 4096) throw invalid('Proxy URL is too long.');
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw invalid('Enter a valid proxy URL, for example http://proxy.corp:8080.'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw invalid('Only http:// or https:// proxies are supported.');
  if (!parsed.hostname) throw invalid('Proxy URL requires a host.');
  if (parsed.pathname !== '/' && parsed.pathname !== '') throw invalid('Proxy URL must not carry a path.');
  if (parsed.search || parsed.hash) throw invalid('Proxy URL must not carry query or fragment.');
  if (parsed.port && (+parsed.port < 1 || +parsed.port > 65535)) throw invalid('Proxy port is out of range.');
  let credentials: string | null = null;
  if (parsed.username || parsed.password) {
    if (!/^[\x20-\x7e]*$/.test(decodeURIComponentSafe(parsed.username) + decodeURIComponentSafe(parsed.password))) throw invalid('Credentials contain unsupported characters.');
    credentials = `${parsed.username}:${parsed.password}`;
  }
  parsed.username = ''; parsed.password = '';
  return { url: parsed.toString().replace(/\/$/, ''), credentials };
}
const decodeURIComponentSafe = (v: string) => { try { return decodeURIComponent(v); } catch { throw invalid('Credentials contain malformed percent escapes.'); } };



const document = z.strictObject({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  url: z.string().nullable(),
  bypass: z.array(z.string()).max(64),
  credentials: z.string().nullable(),
});
type ProxyDocument = z.infer<typeof document>;
const empty = (): ProxyDocument => ({ version: 1, revision: 0, url: null, bypass: [], credentials: null });

const settingsByDirectory = new Map<string, NetworkProxySettings>();
export function networkProxySettingsFor(dataDir: string, codec?: SecretCodec) {
  const key = resolve(dataDir);
  let s = settingsByDirectory.get(key);
  if (!s) { s = new NetworkProxySettings(key, codec); settingsByDirectory.set(key, s); }
  return s;
}

export { MANDATORY_LOCAL_BYPASS, bypassesHost, parseBypassEntry, canonicalizeBypass };

export class NetworkProxySettings {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly directory: string;
  private readonly file: string;
  private readonly codec: SecretCodec;
  private readonly secretStorageAvailable: boolean;
  constructor(dataDir: string, codec?: SecretCodec) {
    this.directory = resolve(dataDir, 'network-proxy');
    this.file = join(this.directory, 'policy.json');
    this.codec = codec ?? windowsSecretCodec();
    this.secretStorageAvailable = Boolean(codec) || process.platform === 'win32';
  }
  private async load(): Promise<ProxyDocument> {
    try {
      const info = await lstat(this.file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw Error('Invalid proxy policy storage');
      return document.parse(JSON.parse(await readFile(this.file, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty();
      throw new HarnessError('NETWORK_PROXY_UNAVAILABLE', 'The saved proxy policy could not be read. Remove or replace it in Settings.');
    }
  }
  private metadata(v: ProxyDocument): NetworkProxyPublicState {
    return { revision: v.revision, url: v.url, bypass: v.bypass, mandatoryBypass: [...MANDATORY_LOCAL_BYPASS], hasCredentials: Boolean(v.credentials), secretStorageAvailable: this.secretStorageAvailable };
  }
  async read(): Promise<NetworkProxyPublicState> { await this.queue.catch(() => {}); return this.metadata(await this.load()); }
  private mutate(action: (v: ProxyDocument) => Promise<ProxyDocument>) {
    const next = this.queue.catch(() => {}).then(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const value = document.parse(await action(await this.load())), serialized = JSON.stringify(value), tmp = join(this.directory, randomUUID() + '.tmp');
      try { await writeFile(tmp, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' }); await rename(tmp, this.file); }
      finally { await unlink(tmp).catch(() => {}); }
      return this.metadata(value);
    });
    this.queue = next; return next;
  }
  async save(raw: unknown): Promise<NetworkProxyPublicState> {
    const input = z.strictObject({
      baseRevision: z.number().int().nonnegative(),
      url: z.string().max(4096).nullable(),
      bypass: z.array(z.string().max(200)).max(64).default([]),
      clearCredentials: z.literal(true).optional(),
    }).parse(raw);
    return this.mutate(async current => {
      if (current.revision !== input.baseRevision) throw new HarnessError('NETWORK_PROXY_CHANGED', 'The proxy settings changed. Refresh before saving.');
      if (input.url === null) return { version: 1, revision: current.revision + 1, url: null, bypass: [], credentials: null };
      const parsed = parseProxyUrl(input.url);
      let credentials = current.credentials;
      const endpointChanged = parsed.url !== current.url;
      if (endpointChanged) credentials = null; // never carry credentials to a different endpoint
      if (input.clearCredentials) credentials = null;
      if (parsed.credentials && !input.clearCredentials) {
        if (!this.secretStorageAvailable) throw new HarnessError('NETWORK_PROXY_STORAGE', 'Secure credential storage is unavailable on this platform. Save the proxy without credentials.');
        credentials = await this.codec.protect(parsed.credentials);
      }
      return { version: 1, revision: current.revision + 1, url: parsed.url, bypass: canonicalizeBypass(input.bypass), credentials };
    });
  }
  async remove(raw: unknown): Promise<NetworkProxyPublicState> {
    const input = z.strictObject({ baseRevision: z.number().int().nonnegative() }).parse(raw);
    return this.mutate(async current => {
      if (current.revision !== input.baseRevision) throw new HarnessError('NETWORK_PROXY_CHANGED', 'The proxy settings changed. Refresh before removing.');
      return { ...empty(), revision: current.revision + 1 };
    });
  }
  /** Host-private immutable snapshot for transport wiring; never returned by routes. */
  async policy(): Promise<{ revision: number; url: string | null; credentials: string | null; bypass: string[] }> {
    await this.queue.catch(() => {});
    const v = await this.load();
    // CIDR loopback markers stay in: bypassesHost special-cases them.
    return { revision: v.revision, url: v.url, credentials: v.credentials ? await this.codec.unprotect(v.credentials) : null, bypass: [...MANDATORY_LOCAL_BYPASS, ...v.bypass] };
  }
}
