import { Agent, ProxyAgent, type Dispatcher } from 'undici';
import { bypassesHost, type NetworkProxySettings } from './network-proxy-settings.ts';
import { networkProxyChildEnvFor, type NetworkProxySnapshot } from './network-proxy-env.ts';

/**
 * #1531 T03 — scoped proxy transport for host fetch lanes and spawned workers.
 * Bound once per profile at service startup and refreshed after each policy
 * write: revision-snapshotted so admitted work keeps its revision and new work
 * picks up the saved one. Bypasses (incl. mandatory local) always go direct;
 * non-bypassed http(s) origins go through the configured upstream with
 * credentials confined to the CONNECT hop. Never mutates global dispatcher
 * or process.env.
 */

let settingsRef: NetworkProxySettings | null = null;
let snapshot: NetworkProxySnapshot | null = null;
let direct: Agent | null = null;
let upstream: ProxyAgent | null = null;
let upstreamRevision = -1;

/** Bind a profile's policy store and load the initial snapshot. */
export async function initNetworkProxyTransport(settings: NetworkProxySettings) {
  settingsRef = settings;
  await refreshNetworkProxyTransport();
}
/** Re-read the policy snapshot; call after every successful save/remove.
 *  An unreadable/corrupt policy keeps the last good snapshot (or unset) — the
 *  settings route surfaces NETWORK_PROXY_UNAVAILABLE to the caller; transport
 *  never downgrades a working proxy and never crashes the host. */
export async function refreshNetworkProxyTransport() {
  if (!settingsRef) return;
  try { snapshot = await settingsRef.policy(); } catch { /* keep last good snapshot */ }
  revisionSink?.(snapshot?.revision ?? 0);
}
/** Server main registers the trusted sidecar notifier; routes never see it. */
let revisionSink: ((revision: number) => void) | null = null;
export function setNetworkProxyRevisionSink(sink: ((revision: number) => void) | null) { revisionSink = sink; }

const ensureAgents = () => {
  if (!snapshot || !snapshot.url || upstreamRevision === snapshot.revision) return;
  upstreamRevision = snapshot.revision;
  const url = new URL(snapshot.url);
  if (snapshot.credentials) {
    const [user, pass] = snapshot.credentials.split(/:(.*)/s);
    url.username = user; url.password = pass;
  }
  upstream = new ProxyAgent({ uri: url.toString() });
  direct ??= new Agent();
};

/** Dispatcher for a single request init; undefined = default/global (no policy). */
export function networkProxyDispatcher(): Dispatcher | undefined {
  if (!snapshot?.url) return undefined;
  ensureAgents();
  const up = upstream!, dir = direct!, bypass = snapshot.bypass;
  const originOf = (origin: string | URL) => {
    const u = typeof origin === 'string' ? new URL(origin) : origin;
    return { host: u.hostname, port: u.port ? +u.port : (u.protocol === 'https:' ? 443 : 80) };
  };
  return {
    dispatch: (opts: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler) => {
      const { host, port } = originOf(opts.origin as string | URL);
      return (bypassesHost(bypass, host, port) ? dir : up).dispatch(opts, handler);
    },
    close: () => Promise.resolve(),
    destroy: (err: Error | null, cb: (e: Error | null) => void) => { cb(err); return Promise.resolve(); },
  } as unknown as Dispatcher;
}

/** fetch with the current revision's dispatcher injected per call (never global). */
export const networkProxyFetch: typeof fetch = (input, init?) =>
  fetch(input, { ...init, dispatcher: networkProxyDispatcher() } as RequestInit);

/** Proxy env for spawned runtime/login processes; empty object when unset. */
export function networkProxyChildEnv(): NodeJS.ProcessEnv {
  return networkProxyChildEnvFor(snapshot);
}

/** Test seam: reset cached snapshot/agents. */
export function resetNetworkProxyTransport() {
  settingsRef = null; snapshot = null; upstream = null; direct = null; upstreamRevision = -1;
}
