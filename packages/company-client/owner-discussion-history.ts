// Explicit trusted owner host only; no CLI, browser, employee or engine composition.
import {X509Certificate} from 'node:crypto';
import {request as httpsRequest} from 'node:https';
import type {ClientRequest} from 'node:http';
import {decodeBoundedJson} from '../company-contracts/communications/json.ts';
import {snapshotReadContext, type ReadContext} from '../company-contracts/communications/reads.ts';
import {
  OWNER_DISCUSSION_HISTORY_PIN, captureOwnerDiscussionHistoryContinuation,
  normalizeOwnerDiscussionHistoryRequest, validateOwnerDiscussionHistory,
  type OwnerDiscussionHistoryContinuation, type OwnerDiscussionHistoryRequest, type OwnerDiscussionHistoryResult,
} from '../company-contracts/communications/owner-discussion-history.ts';

const wireErrors = Object.freeze({400: 'INVALID_REQUEST', 401: 'AUTHENTICATION_REQUIRED', 403: 'SCOPE_DENIED', 404: 'NOT_FOUND', 409: 'RESYNC_REQUIRED', 410: 'RESYNC_REQUIRED', 503: 'RECORDS_UNAVAILABLE'} as const);
type WireStatus = keyof typeof wireErrors;
type WireError = typeof wireErrors[WireStatus];
export type OwnerDiscussionHistoryErrorCode = WireError | 'CONFIG' | 'REQUEST' | 'TIMEOUT' | 'ABORTED' | 'TRANSPORT' | 'RESPONSE';
export class OwnerDiscussionHistoryError extends Error {
  constructor(readonly code: OwnerDiscussionHistoryErrorCode, readonly status?: WireStatus) {super(code); this.name = 'OwnerDiscussionHistoryError';}
}
export interface OwnerDiscussionHistoryClientOptions {
  origin: string; role: 'owner'; credential: () => string | Promise<string>;
  ca: string | Buffer; timeoutMs?: number;
}
function object(value: unknown): value is Record<string, unknown> {return value !== null && typeof value === 'object' && !Array.isArray(value);}
function reflected(value: unknown, token: string): boolean {
  const pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (typeof item === 'string' && item.includes(token)) return true;
    if (item && typeof item === 'object') for (const [key, child] of Object.entries(item)) {
      if (key.includes(token)) return true; pending.push(child);
    }
  }
  return false;
}

export class OwnerDiscussionHistoryClient {
  #port: number;
  #credential: OwnerDiscussionHistoryClientOptions['credential'];
  #ca: Buffer;
  #timeoutMs: number;
  constructor(options: OwnerDiscussionHistoryClientOptions) {
    try {
      const allowed = ['origin', 'role', 'credential', 'ca', 'timeoutMs'];
      if (!object(options) || Reflect.ownKeys(options).some(key => typeof key !== 'string' || !allowed.includes(key))) throw 0;
      const {origin, role, credential, ca, timeoutMs = 3000} = options;
      const match = typeof origin === 'string' && /^https:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(origin);
      if (!match || Number(match[1]) > 65535 || role !== 'owner' || typeof credential !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw 0;
      if (typeof ca !== 'string' && !Buffer.isBuffer(ca)) throw 0;
      const trust = Buffer.from(ca); if (!trust.length) throw 0; new X509Certificate(trust);
      this.#port = Number(match[1]); this.#credential = credential; this.#ca = trust; this.#timeoutMs = timeoutMs;
    } catch {throw new OwnerDiscussionHistoryError('CONFIG');}
  }
  get role(): 'owner' {return 'owner';}

  /** Explicitly issue a new cut. A lost initial reply is never silently retried. */
  async start(expected: ReadContext, limit?: number, signal?: AbortSignal): Promise<OwnerDiscussionHistoryResult> {
    return this.#read(expected, limit, undefined, signal, performance.now() + this.#timeoutMs);
  }
  /** Echo the retained cursor once; the input is immutable and is never advanced in place. */
  async continue(expected: ReadContext, continuation: OwnerDiscussionHistoryContinuation, signal?: AbortSignal): Promise<OwnerDiscussionHistoryResult> {
    if (!object(continuation)) throw new OwnerDiscussionHistoryError('REQUEST');
    return this.#read(expected, undefined, continuation, signal, performance.now() + this.#timeoutMs);
  }

  #read(expected: ReadContext, limit: number | undefined, input: OwnerDiscussionHistoryContinuation | undefined, signal: AbortSignal | undefined, deadline: number): Promise<OwnerDiscussionHistoryResult> {
    let context: ReadContext, normalized: OwnerDiscussionHistoryRequest, retained: OwnerDiscussionHistoryContinuation | undefined;
    try {
      context = snapshotReadContext(expected);
      if (input !== undefined) retained = captureOwnerDiscussionHistoryContinuation(input, context);
      normalized = normalizeOwnerDiscussionHistoryRequest(context, retained ? retained.requestedLimit : limit, retained?.nextCursor ?? null);
    } catch {return Promise.reject(new OwnerDiscussionHistoryError('REQUEST'));}
    const query = retained ? `limit=${normalized.limit}&cursor=${normalized.cursor}` : limit === undefined ? '' : `limit=${normalized.limit}`;
    if (query.length > 4160) return Promise.reject(new OwnerDiscussionHistoryError('REQUEST'));
    const path = `/company/v1/projects/${normalized.project_id}/owner-discussion/history` + (query ? `?${query}` : '');
    return new Promise((resolve, reject) => {
      let settled = false, request: ClientRequest | undefined;
      const abort = () => finish('ABORTED');
      const finish = (code?: OwnerDiscussionHistoryErrorCode, value?: OwnerDiscussionHistoryResult, status?: WireStatus) => {
        if (settled) return;
        if (code !== 'ABORTED' && performance.now() >= deadline) {code = 'TIMEOUT'; status = undefined;}
        settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); request?.destroy();
        if (code) reject(new OwnerDiscussionHistoryError(code, status)); else resolve(value!);
      };
      const timer = setTimeout(() => finish('TIMEOUT'), Math.max(0, deadline - performance.now()));
      signal?.addEventListener('abort', abort, {once: true});
      if (signal?.aborted) {finish('ABORTED'); return;}
      void (async () => {
        let token: string;
        try {token = await this.#credential();} catch {finish('AUTHENTICATION_REQUIRED'); return;}
        if (settled) return;
        if (performance.now() >= deadline) {finish('TIMEOUT'); return;}
        if (typeof token !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(token)) {finish('AUTHENTICATION_REQUIRED'); return;}
        try {
          request = httpsRequest({hostname: '127.0.0.1', port: this.#port, method: 'GET', path, agent: false,
            ca: this.#ca, rejectUnauthorized: true, minVersion: 'TLSv1.2', maxHeaderSize: 16384,
            headers: {Host: `127.0.0.1:${this.#port}`, Authorization: `Bearer ${token}`, Connection: 'close'},
          }, response => {
            if (settled) {response.destroy(); return;}
            const status = response.statusCode ?? 0, code = wireErrors[status as WireStatus];
            const length = response.headers['content-length'], counts = new Map<string, number>();
            for (let i = 0; i < response.rawHeaders.length; i += 2) {const name = response.rawHeaders[i].toLowerCase(); counts.set(name, (counts.get(name) ?? 0) + 1);}
            if ((status !== 200 && !code) || counts.get('content-type') !== 1 || (counts.get('content-length') ?? 0) > 1 || counts.has('content-encoding') || !/^application\/json;\s*charset=utf-8$/i.test(response.headers['content-type'] ?? '') || (length !== undefined && (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > OWNER_DISCUSSION_HISTORY_PIN.maximumRawBytes))) {
              finish('RESPONSE'); response.destroy(); return;
            }
            const chunks: Buffer[] = []; let size = 0;
            response.on('data', (chunk: Buffer) => {
              if (settled) return; size += chunk.length;
              if (size > OWNER_DISCUSSION_HISTORY_PIN.maximumRawBytes) {finish('RESPONSE'); response.destroy(); return;}
              chunks.push(chunk);
            });
            response.on('error', () => finish('RESPONSE')); response.on('aborted', () => finish('RESPONSE'));
            response.on('end', () => {
              if (settled) return;
              void (async () => {
                try {
                  const raw = Buffer.concat(chunks);
                  if (!response.complete || length !== undefined && raw.length !== Number(length)) throw 0;
                  if (status !== 200) {
                    const value = decodeBoundedJson(raw, 262144);
                    if (!object(value) || Object.keys(value).sort().join(',') !== 'error,schema_version' || value.schema_version !== 1 || !object(value.error) || Object.keys(value.error).join(',') !== 'code' || value.error.code !== code) throw 0;
                    finish(code, undefined, status as WireStatus); return;
                  }
                  const result = await validateOwnerDiscussionHistory(raw, context, normalized, retained);
                  if (reflected(result, token)) throw 0;
                  finish(undefined, result);
                } catch {finish('RESPONSE');}
              })();
            });
          });
          request.on('error', () => finish('TRANSPORT')); request.end();
        } catch {finish('TRANSPORT');}
      })();
    });
  }
}
