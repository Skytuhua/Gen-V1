import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NetworkProxySettings } from '../packages/core/network-proxy-settings.ts';
import {
  initNetworkProxyTransport, refreshNetworkProxyTransport,
  networkProxyDispatcher, networkProxyChildEnv, resetNetworkProxyTransport,
} from '../packages/core/network-proxy-transport.ts';

// #1531 T03 — transport snapshot/env behavior. Routing correctness itself is
// covered by tests/network-proxy-settings.test.ts (bypassesHost matrix).
const stubCodec = { protect: async (v: string) => `enc(${v})`, unprotect: async (v: string) => v.slice(4, -1) };

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'gen-proxy-t-')); resetNetworkProxyTransport(); });
afterEach(async () => { resetNetworkProxyTransport(); await rm(dir, { recursive: true, force: true }); });

describe('network proxy transport', () => {
  it('no policy -> default dispatcher, empty child env', async () => {
    await initNetworkProxyTransport(new NetworkProxySettings(dir, stubCodec));
    expect(networkProxyDispatcher()).toBeUndefined();
    expect(networkProxyChildEnv()).toEqual({});
  });
  it('configured policy -> dispatcher + credentialed child env with NO_PROXY', async () => {
    const s = new NetworkProxySettings(dir, stubCodec);
    await s.save({ baseRevision: 0, url: 'http://u:p@proxy.corp:3128', bypass: ['.corp', 'exact.host:8080'] });
    await initNetworkProxyTransport(s);
    expect(networkProxyDispatcher()).toBeDefined();
    const env = networkProxyChildEnv();
    expect(env.HTTP_PROXY).toBe('http://u:p@proxy.corp:3128/');
    expect(env.HTTPS_PROXY).toBe(env.HTTP_PROXY);
    expect(env.no_proxy).toBe(env.NO_PROXY);
    expect(env.NO_PROXY!.split(',')).toContain('localhost');
    expect(env.NO_PROXY!.split(',')).toContain('exact.host:8080');
  });
  it('policy removal via refresh -> back to default env; save bumps revision', async () => {
    const s = new NetworkProxySettings(dir, stubCodec);
    await s.save({ baseRevision: 0, url: 'http://a.corp:1', bypass: [] });
    await initNetworkProxyTransport(s);
    expect(networkProxyDispatcher()).toBeDefined();
    await s.remove({ baseRevision: 1 });
    await refreshNetworkProxyTransport();
    expect(networkProxyDispatcher()).toBeUndefined();
    expect(networkProxyChildEnv()).toEqual({});
  });
  it('policy() failure keeps the last good snapshot (no crash, no downgrade)', async () => {
    const s = new NetworkProxySettings(dir, stubCodec);
    await s.save({ baseRevision: 0, url: 'http://keep.corp:1', bypass: [] });
    await initNetworkProxyTransport(s);
    // corrupt the file: refresh must not throw or clear the working snapshot
    const fs = await import('node:fs/promises');
    await fs.writeFile(join(dir, 'network-proxy', 'policy.json'), '{not json', 'utf8');
    await refreshNetworkProxyTransport();
    expect(networkProxyChildEnv().HTTP_PROXY).toContain('keep.corp:1');
    expect(networkProxyDispatcher()).toBeDefined();
  });
  it('empty/null snapshot yields empty child env (desktop sign-in fallback)', async () => {
    const { networkProxyChildEnvFor } = await import('../packages/core/network-proxy-env.ts');
    expect(networkProxyChildEnvFor(null)).toEqual({});
    expect(networkProxyChildEnvFor({ revision: 1, url: null, credentials: null, bypass: [] })).toEqual({});
  });
  it('new revision replaces the cached upstream after refresh', async () => {
    const s = new NetworkProxySettings(dir, stubCodec);
    await s.save({ baseRevision: 0, url: 'http://one.corp:1', bypass: [] });
    await initNetworkProxyTransport(s);
    networkProxyDispatcher(); // builds r1 upstream
    await s.save({ baseRevision: 1, url: 'http://two.corp:2', bypass: [] });
    await refreshNetworkProxyTransport();
    expect(networkProxyDispatcher()).toBeDefined();
    expect(networkProxyChildEnv().HTTP_PROXY).toContain('two.corp:2');
  });
});
