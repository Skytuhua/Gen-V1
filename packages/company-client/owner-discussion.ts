// Explicit trusted owner-host use only; no CLI, browser or engine composition.
import {X509Certificate} from 'node:crypto';
import {request as httpsRequest} from 'node:https';
import type {ClientRequest} from 'node:http';
import {canonicalBytes, decodeBoundedJson} from '../company-contracts/communications/json.ts';
import {snapshotReadContext, type ReadContext} from '../company-contracts/communications/reads.ts';
import {
  OWNER_DISCUSSION_PIN, parseOwnerDiscussionCommand, validateOwnerDiscussionReceipt, validateOwnerDiscussionReadBack,
  type OwnerDiscussionCommand, type OwnerDiscussionReceipt, type OwnerDiscussionReadBack,
} from '../company-contracts/communications/owner-discussion.ts';

const wireErrors = Object.freeze({400: 'INVALID_REQUEST', 401: 'AUTHENTICATION_REQUIRED', 403: 'SCOPE_DENIED', 404: 'NOT_FOUND', 409: 'IDEMPOTENCY_CONFLICT', 503: 'RECORDS_UNAVAILABLE'} as const);
type WireError = typeof wireErrors[keyof typeof wireErrors];
export type OwnerDiscussionErrorCode = WireError | 'CONFIG' | 'REQUEST' | 'TIMEOUT' | 'ABORTED' | 'TRANSPORT' | 'RESPONSE';
export class OwnerDiscussionError extends Error {
  constructor(readonly code: OwnerDiscussionErrorCode) {super(code); this.name = 'OwnerDiscussionError';}
}
export interface OwnerDiscussionClientOptions {
  origin: string; role: 'owner'; credential: () => string | Promise<string>;
  ca: string | Buffer; timeoutMs?: number;
}
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

export class OwnerDiscussionClient {
  #port: number;
  #credential: OwnerDiscussionClientOptions['credential'];
  #ca: Buffer;
  #timeoutMs: number;
  constructor(options: OwnerDiscussionClientOptions) {
    try {
      const allowed = ['origin', 'role', 'credential', 'ca', 'timeoutMs'];
      if (!object(options) || Reflect.ownKeys(options).some(key => typeof key !== 'string' || !allowed.includes(key))) throw 0;
      const {origin, role, credential, ca, timeoutMs = 3000} = options;
      const match = typeof origin === 'string' && /^https:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(origin);
      if (!match || Number(match[1]) > 65535 || role !== 'owner' || typeof credential !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw 0;
      if (typeof ca !== 'string' && !Buffer.isBuffer(ca)) throw 0;
      const trust = Buffer.from(ca); if (!trust.length) throw 0;
      new X509Certificate(trust);
      this.#port = Number(match[1]); this.#credential = credential; this.#ca = trust; this.#timeoutMs = timeoutMs;
    } catch {throw new OwnerDiscussionError('CONFIG');}
  }
  get role(): 'owner' {return 'owner';}

  /** Retain this exact command/ID for explicit reconciliation after an uncertain response. */
  async append(expected: ReadContext, rawCommand: Uint8Array, signal?: AbortSignal): Promise<OwnerDiscussionReceipt> {
    return this.#perform(expected, rawCommand, undefined, signal, performance.now() + this.#timeoutMs) as Promise<OwnerDiscussionReceipt>;
  }

  /** Read only the exact historical pair referenced by a retained, validated receipt. */
  async readBack(expected: ReadContext, rawCommand: Uint8Array, receipt: OwnerDiscussionReceipt, signal?: AbortSignal): Promise<OwnerDiscussionReadBack> {
    if (!object(receipt)) throw new OwnerDiscussionError('REQUEST');
    return this.#perform(expected, rawCommand, receipt, signal, performance.now() + this.#timeoutMs) as Promise<OwnerDiscussionReadBack>;
  }

  #perform(expected: ReadContext, input: Uint8Array, expectedReceipt: OwnerDiscussionReceipt | undefined, signal: AbortSignal | undefined, deadline: number): Promise<OwnerDiscussionReceipt | OwnerDiscussionReadBack> {
    let context: ReadContext, command: OwnerDiscussionCommand, raw: Buffer, receiptRaw: Uint8Array | undefined;
    try {
      context = snapshotReadContext(expected);
      if (context.scope.kind !== 'project' || !/^[a-z][a-z0-9-]{0,62}$/.test(context.scope.id) || context.scope.id === 'company-ops' || !(input instanceof Uint8Array) || input.byteLength > 32768) throw 0;
      raw = Buffer.from(input); command = parseOwnerDiscussionCommand(raw);
      if (expectedReceipt !== undefined) receiptRaw = canonicalBytes(expectedReceipt);
    } catch {return Promise.reject(new OwnerDiscussionError('REQUEST'));}
    const method = receiptRaw === undefined ? 'POST' : 'GET';
    return new Promise((resolve, reject) => {
      let settled = false, request: ClientRequest | undefined;
      const abort = () => finish('ABORTED');
      const finish = (code?: OwnerDiscussionErrorCode, value?: OwnerDiscussionReceipt | OwnerDiscussionReadBack) => {
        if (settled) return;
        if (code !== 'ABORTED' && performance.now() >= deadline) code = 'TIMEOUT';
        settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); request?.destroy();
        if (code) reject(new OwnerDiscussionError(code)); else resolve(value!);
      };
      const timer = setTimeout(() => finish('TIMEOUT'), Math.max(0, deadline - performance.now()));
      signal?.addEventListener('abort', abort, {once: true});
      if (signal?.aborted) {finish('ABORTED'); return;}
      void (async () => {
        let receipt: OwnerDiscussionReceipt | undefined;
        if (receiptRaw !== undefined) {
          try {receipt = await validateOwnerDiscussionReceipt(receiptRaw, context, command);} catch {finish('REQUEST'); return;}
        }
        if (settled) return;
        if (performance.now() >= deadline) {finish('TIMEOUT'); return;}
        let token: string;
        try {token = await this.#credential();} catch {finish('AUTHENTICATION_REQUIRED'); return;}
        if (settled) return;
        if (performance.now() >= deadline) {finish('TIMEOUT'); return;}
        if (typeof token !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(token)) {finish('AUTHENTICATION_REQUIRED'); return;}
        const base = `/company/v1/projects/${context.scope.id}/owner-discussion`;
        const path = receipt ? `${base}/conversations/${receipt.conversation_ref.id}/messages/${receipt.message_ref.id}` : `${base}/messages`;
        const headers: Record<string, string> = {Host: `127.0.0.1:${this.#port}`, Authorization: `Bearer ${token}`, Connection: 'close'};
        if (method === 'POST') {headers['Content-Type'] = 'application/json'; headers['Content-Length'] = String(raw.length);}
        try {
          request = httpsRequest({hostname: '127.0.0.1', port: this.#port, method, path, headers, agent: false,
            ca: this.#ca, rejectUnauthorized: true, minVersion: 'TLSv1.2', maxHeaderSize: 16384,
          }, response => {
            if (settled) {response.destroy(); return;}
            const status = response.statusCode ?? 0, code = wireErrors[status as keyof typeof wireErrors];
            const length = response.headers['content-length'], counts = new Map<string, number>();
            for (let i = 0; i < response.rawHeaders.length; i += 2) {
              const name = response.rawHeaders[i].toLowerCase(); counts.set(name, (counts.get(name) ?? 0) + 1);
            }
            if ((status !== 200 && !code) || counts.get('content-type') !== 1 || (counts.get('content-length') ?? 0) > 1 || counts.has('content-encoding') || !/^application\/json;\s*charset=utf-8$/i.test(response.headers['content-type'] ?? '') || (length !== undefined && (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > OWNER_DISCUSSION_PIN.maximumRawBytes))) {
              finish('RESPONSE'); response.destroy(); return;
            }
            const chunks: Buffer[] = []; let size = 0;
            response.on('data', (chunk: Buffer) => {
              if (settled) return;
              size += chunk.length;
              if (size > OWNER_DISCUSSION_PIN.maximumRawBytes) {finish('RESPONSE'); response.destroy(); return;}
              chunks.push(chunk);
            });
            response.on('error', () => finish('RESPONSE')); response.on('aborted', () => finish('RESPONSE'));
            response.on('end', () => {
              if (settled) return;
              void (async () => {
                try {
                  const bytes = Buffer.concat(chunks);
                  if (!response.complete || length !== undefined && bytes.length !== Number(length)) throw 0;
                  if (status !== 200) {
                    const value = decodeBoundedJson(bytes, 262144);
                    if (!object(value) || Object.keys(value).sort().join(',') !== 'error,schema_version' || value.schema_version !== 1 || !object(value.error) || Object.keys(value.error).join(',') !== 'code' || value.error.code !== code) throw 0;
                    finish(code); return;
                  }
                  const result = receipt ? await validateOwnerDiscussionReadBack(bytes, context, command, receipt) : await validateOwnerDiscussionReceipt(bytes, context, command);
                  if (reflected(result, token)) throw 0;
                  finish(undefined, result);
                } catch {finish('RESPONSE');}
              })();
            });
          });
          request.on('error', () => finish('TRANSPORT'));
          request.end(method === 'POST' ? raw : undefined);
        } catch {finish('TRANSPORT');}
      })();
    });
  }
}
