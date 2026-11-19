/** Bounded authenticated account checks. Credentials, provider bodies and issued tokens never leave the probe. */
export type EntitlementOutcome = 'accepted' | 'rejected' | 'unconfirmed';
export class ProbeHttpError extends Error { constructor(readonly status: number) { super(`HTTP ${status}`); } }

export function beforeDeadline<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new Error('Account check deadline reached.')); };
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    operation.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
export function cancelBody(response: Response) { void response.body?.cancel().catch(() => {}); }

/** One GET with a ten-second deadline, no redirects, a JSON content type and a byte ceiling. */
export async function fetchBoundedJson(url: string, headers: Record<string, string>, maxBytes: number, signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(10_000), bounded = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await beforeDeadline(fetch(url, { headers: { ...headers, Accept: 'application/json' }, redirect: 'error', signal: bounded }), bounded);
  if (!response.ok || response.redirected) { cancelBody(response); throw new ProbeHttpError(response.status); }
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) { cancelBody(response); throw new Error(); }
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) { cancelBody(response); throw new Error(); }
  if (!response.body) throw new Error();
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, text = '';
  try {
    for (;;) {
      const chunk = await beforeDeadline(reader.read(), bounded); if (chunk.done) break;
      bytes += chunk.value.byteLength; if (bytes > maxBytes) throw new Error();
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
  return JSON.parse(text);
}

/** Only an explicit authentication refusal counts as rejected; timeouts, quota and provider errors stay unconfirmed. */
export function entitlementFailure(error: unknown, signal: AbortSignal | undefined, rejected: readonly number[] = [401, 403]): EntitlementOutcome {
  signal?.throwIfAborted();
  return error instanceof ProbeHttpError && rejected.includes(error.status) ? 'rejected' : 'unconfirmed';
}

const COPILOT_HEADERS = { 'User-Agent': 'GitHubCopilotChat/0.35.0', 'Editor-Version': 'vscode/1.107.0', 'Editor-Plugin-Version': 'copilot-chat/0.35.0', 'Copilot-Integration-Id': 'vscode-chat' };
function copilotDomain(enterpriseUrl: unknown): string | undefined {
  if (enterpriseUrl === undefined || enterpriseUrl === null || enterpriseUrl === '') return 'github.com';
  if (typeof enterpriseUrl !== 'string') return undefined;
  try {
    const url = new URL(enterpriseUrl.includes('://') ? enterpriseUrl : `https://${enterpriseUrl}`);
    return url.protocol === 'https:' && !url.port && !url.username && /^(?=.{4,253}$)[a-z\d-]+(\.[a-z\d-]+)+$/.test(url.hostname) ? url.hostname : undefined;
  } catch { return undefined; }
}
/** The same Copilot token exchange the pinned SDK performs before every request; the issued token is validated and discarded, never stored. */
export async function probeCopilotEntitlement(credential: { refresh?: unknown; enterpriseUrl?: unknown }, signal?: AbortSignal): Promise<EntitlementOutcome> {
  const domain = copilotDomain(credential.enterpriseUrl);
  if (typeof credential.refresh !== 'string' || !credential.refresh || !domain) return 'unconfirmed';
  try {
    const result = await fetchBoundedJson(`https://api.${domain}/copilot_internal/v2/token`, { Authorization: `Bearer ${credential.refresh}`, ...COPILOT_HEADERS }, 64 * 1024, signal);
    if (!result || typeof result !== 'object' || typeof (result as { token?: unknown }).token !== 'string' || typeof (result as { expires_at?: unknown }).expires_at !== 'number') return 'unconfirmed';
    return 'accepted';
  } catch (error) { return entitlementFailure(error, signal); }
}
