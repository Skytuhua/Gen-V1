// Trusted owner-host only. No CLI, browser, employee or manager-engine composition.
import {X509Certificate} from 'node:crypto';
import {request as httpsRequest} from 'node:https';
import type {ClientRequest} from 'node:http';
import {decodeBoundedJson} from '../company-contracts/communications/json.ts';
import {snapshotReadContext, type ReadContext} from '../company-contracts/communications/reads.ts';
import {OWNER_DISCUSSION_THREAD_PIN, validateOwnerDiscussionThread, type OwnerDiscussionThread} from '../company-contracts/communications/owner-discussion-thread.ts';

const wireErrors = Object.freeze({
  400: 'INVALID_REQUEST', 401: 'AUTHENTICATION_REQUIRED', 403: 'SCOPE_DENIED',
  404: 'NOT_FOUND', 503: 'RECORDS_UNAVAILABLE',
} as const);
type WireError = typeof wireErrors[keyof typeof wireErrors];
export type OwnerDiscussionThreadErrorCode = WireError | 'CONFIG' | 'REQUEST' | 'TIMEOUT' | 'ABORTED' | 'TRANSPORT' | 'RESPONSE';
export class OwnerDiscussionThreadError extends Error {
  constructor(readonly code: OwnerDiscussionThreadErrorCode) {super(code); this.name = 'OwnerDiscussionThreadError';}
}
export interface OwnerDiscussionThreadClientOptions {
  origin: string; role: 'owner'; credential: () => string | Promise<string>;
  ca: string | Buffer; timeoutMs?: number;
}
const projectPattern = /^[a-z][a-z0-9-]{0,62}$/;
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function reflected(value: unknown, token: string): boolean {
  const pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (typeof item === 'string' && item.includes(token)) return true;
    if (item && typeof item === 'object') for (const [key, child] of Object.entries(item)) {
      if (key.includes(token)) return true;
      pending.push(child);
    }
  }
  return false;
}

export class OwnerDiscussionThreadClient {
  #port: number;
  #credential: OwnerDiscussionThreadClientOptions['credential'];
  #ca: Buffer;
  #timeoutMs: number;
  constructor(options: OwnerDiscussionThreadClientOptions) {
    try {
      const allowed = ['origin', 'role', 'credential', 'ca', 'timeoutMs'];
      if (!object(options) || Reflect.ownKeys(options).some(key => typeof key !== 'string' || !allowed.includes(key))) throw 0;
      const {origin, role, credential, ca, timeoutMs = 3000} = options;
      const match = typeof origin === 'string' && /^https:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(origin);
      if (!match || Number(match[1]) > 65535 || role !== 'owner' || typeof credential !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw 0;
      if (typeof ca !== 'string' && !Buffer.isBuffer(ca)) throw 0;
      const trust = Buffer.from(ca);
      if (!trust.length) throw 0;
      new X509Certificate(trust); // Validate material without exposing OpenSSL errors.
      this.#port = Number(match[1]); this.#credential = credential; this.#ca = trust; this.#timeoutMs = timeoutMs;
    } catch {throw new OwnerDiscussionThreadError('CONFIG');}
  }
  get role(): 'owner' {return 'owner';}

  /** Expected company/project/limit are caller-retained query data, never authority
   * learned from the response. Registry authorization remains service-owned. */
  async readThread(expected: ReadContext, limit?: number, signal?: AbortSignal): Promise<OwnerDiscussionThread> {
    let context: ReadContext;
    const expectedLimit = limit === undefined ? 20 : limit;
    try {
      context = snapshotReadContext(expected);
      if (context.scope.kind !== 'project' || !projectPattern.test(context.scope.id) || context.scope.id === 'company-ops' || !Number.isInteger(expectedLimit) || expectedLimit < 1 || expectedLimit > 50) throw 0;
    } catch {throw new OwnerDiscussionThreadError('REQUEST');}
    const path = `/company/v1/projects/${context.scope.id}/owner-discussion/thread` + (limit === undefined ? '' : `?limit=${expectedLimit}`);
    return new Promise<OwnerDiscussionThread>((resolve, reject) => {
      let settled = false, request: ClientRequest | undefined;
      const deadline = performance.now() + this.#timeoutMs;
      const abort = () => finish('ABORTED');
      const finish = (code?: OwnerDiscussionThreadErrorCode, value?: OwnerDiscussionThread) => {
        if (settled) return;
        if (code !== 'ABORTED' && performance.now() >= deadline) code = 'TIMEOUT';
        settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
        request?.destroy();
        if (code) reject(new OwnerDiscussionThreadError(code)); else resolve(value!);
      };
      const timer = setTimeout(() => finish('TIMEOUT'), this.#timeoutMs);
      signal?.addEventListener('abort', abort, {once: true});
      if (signal?.aborted) {finish('ABORTED'); return;}
      void (async () => {
        let token: string;
        try {token = await this.#credential();} catch {finish('AUTHENTICATION_REQUIRED'); return;}
        if (settled) return;
        if (performance.now() >= deadline) {finish('TIMEOUT'); return;}
        if (typeof token !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(token)) {finish('AUTHENTICATION_REQUIRED'); return;}
        try {
          request = httpsRequest({
            hostname: '127.0.0.1', port: this.#port, method: 'GET', path, agent: false,
            ca: this.#ca, rejectUnauthorized: true, minVersion: 'TLSv1.2', maxHeaderSize: 16384,
            headers: {Host: `127.0.0.1:${this.#port}`, Authorization: `Bearer ${token}`, Connection: 'close'},
          }, response => {
            if (settled) {response.destroy(); return;}
            const status = response.statusCode ?? 0;
            const code = wireErrors[status as keyof typeof wireErrors];
            const length = response.headers['content-length'];
            const counts = new Map<string, number>();
            for (let i = 0; i < response.rawHeaders.length; i += 2) {
              const key = response.rawHeaders[i].toLowerCase(); counts.set(key, (counts.get(key) ?? 0) + 1);
            }
            if ((status !== 200 && !code) || counts.get('content-type') !== 1 || (counts.get('content-length') ?? 0) > 1 || counts.has('content-encoding') || !/^application\/json;\s*charset=utf-8$/i.test(response.headers['content-type'] ?? '') || (length !== undefined && (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > OWNER_DISCUSSION_THREAD_PIN.maximumRawBytes))) {
              finish('RESPONSE'); response.destroy(); return;
            }
            let size = 0;
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => {
              if (settled) return;
              size += chunk.length;
              if (size > OWNER_DISCUSSION_THREAD_PIN.maximumRawBytes) {finish('RESPONSE'); response.destroy(); return;}
              chunks.push(chunk);
            });
            response.on('error', () => finish('RESPONSE'));
            response.on('aborted', () => finish('RESPONSE'));
            response.on('end', () => {
              if (settled) return;
              void (async () => {
                try {
                  const raw = Buffer.concat(chunks);
                  if (!response.complete || length !== undefined && raw.length !== Number(length)) throw 0;
                  if (status !== 200) {
                    const value = decodeBoundedJson(raw, 262144);
                    if (!object(value) || Object.keys(value).sort().join(',') !== 'error,schema_version' || value.schema_version !== 1 || !object(value.error) || Object.keys(value.error).join(',') !== 'code' || value.error.code !== code) throw 0;
                    finish(code); return;
                  }
                  const page = await validateOwnerDiscussionThread(raw, context, expectedLimit);
                  if (reflected(page, token)) throw 0;
                  finish(undefined, page);
                } catch {finish('RESPONSE');}
              })();
            });
          });
          request.on('error', () => finish('TRANSPORT'));
          request.end();
        } catch {finish('TRANSPORT');}
      })();
    });
  }
}
