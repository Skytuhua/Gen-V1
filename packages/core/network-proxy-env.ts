/**
 * #1531 T03 — pure env builder shared by the backend transport and the desktop
 * main process. No imports: the desktop bundle must not pull in undici.
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
