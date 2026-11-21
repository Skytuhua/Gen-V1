import { HarnessError } from '../contracts/index.ts';

/**
 * #1531 T03 — shared proxy primitives for backend and desktop. Only zod-free
 * contract types are imported so the desktop bundle stays undici-free.
 */
export interface NetworkProxySnapshot {
  revision: number;
  url: string | null;
  credentials: string | null;
  bypass: string[];
}

/** Proxy env for spawned runtime/login processes; {} when unset. */
export function networkProxyChildEnvFor(snapshot: NetworkProxySnapshot | null): NodeJS.ProcessEnv {
  if (!snapshot?.url) return {};
  const url = new URL(snapshot.url);
  if (snapshot.credentials) {
    const [user, pass] = snapshot.credentials.split(/:(.*)/s);
    url.username = user; url.password = pass;
  }
  const proxy = url.toString();
  const noProxy = snapshot.bypass.join(',');
  return { HTTP_PROXY: proxy, HTTPS_PROXY: proxy, NO_PROXY: noProxy, http_proxy: proxy, https_proxy: proxy, no_proxy: noProxy };
}

/** Always-direct destinations: loopback + Gen local endpoints win over any setting or inherited env. */
export const MANDATORY_LOCAL_BYPASS = ['localhost', '.localhost', '127.0.0.0/8', '::1', '[::ffff:127.0.0.0]/104'] as const;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const HOSTNAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
/** Canonicalize one bypass entry; rejects wildcards, CIDR, schemes, paths per spec. */

const invalid = (message: string) => new HarnessError('NETWORK_PROXY_INVALID', message);
export function parseBypassEntry(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 200) throw invalid('Bypass entries must be 1-200 characters.');
  if (/[*\/]|:\/\/|\\/.test(trimmed)) throw invalid(`Unsupported bypass entry "${trimmed}". Use host, .suffix, host:port or [ipv6]:port.`);
  // [ipv6]:port | [ipv6]
  const v6 = trimmed.match(/^\[([0-9a-fA-F:]+)\](?::(\d{1,5}))?$/);
  if (v6) {
    if (v6[2] && (+v6[2] > 65535)) throw invalid('Bypass port is out of range.');
    return `[${v6[1].toLowerCase()}]${v6[2] ? ':' + v6[2] : ''}`;
  }
  const hostPort = trimmed.match(/^([^:]+)(?::(\d{1,5}))?$/);
  if (!hostPort) throw invalid(`Unsupported bypass entry "${trimmed}".`);
  const [, host, port] = hostPort;
  if (port && (+port > 65535)) throw invalid('Bypass port is out of range.');
  const suffix = host.startsWith('.');
  const bare = suffix ? host.slice(1) : host;
  const lower = bare.toLowerCase();
  if (IPV4.test(lower)) {
    if (lower.split('.').some(n => +n > 255)) throw invalid('Bypass IPv4 octet is out of range.');
  } else if (!HOSTNAME.test(lower) || lower.includes('..')) {
    throw invalid(`Unsupported bypass host "${trimmed}".`);
  }
  return `${suffix ? '.' : ''}${lower}${port ? ':' + port : ''}`;
}
export function canonicalizeBypass(list: string[]): string[] {
  return [...new Set(list.map(parseBypassEntry))].sort();
}

/** Effective-port aware bypass matcher (host-private). */
export function bypassesHost(entries: string[], host: string, port: number): boolean {
  const h = host.toLowerCase();
  const v6 = /^\[(.+)\]$/.exec(h)?.[1];
  for (const entry of entries) {
    const m = entry.match(/^(.*?)(?::(\d{1,5}))?$/);
    let eh = m![1], ep = m![2] ? +m![2] : null;
    const ev6 = eh.match(/^\[(.+)\]$/);
    if (ev6) eh = ev6[1];
    if (ep !== null && ep !== port) continue;
    if (eh.startsWith('.')) {
      const suffix = eh.slice(1);
      if (h === suffix || h.endsWith('.' + suffix) || (v6 && v6 === suffix)) return true;
    } else if (h === eh || (v6 && v6 === eh)) return true;
  }
  // CIDR-style loopback entries from the mandatory list.
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) && entries.includes('127.0.0.0/8')) return true;
  if ((h === '::1' || v6 === '::1') && entries.includes('::1')) return true;
  if ((h.startsWith('::ffff:127.') || (v6 ?? '').startsWith('::ffff:127.')) && entries.includes('[::ffff:127.0.0.0]/104')) return true;
  return false;
}
