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
