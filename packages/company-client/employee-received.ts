// Explicit machine ACK only. The caller supplies the supervisor's already-persisted command.
import {X509Certificate} from 'node:crypto';
import {request as httpsRequest} from 'node:https';
import type {ClientRequest} from 'node:http';
import {decodeBoundedJson} from '../company-contracts/communications/json.ts';
import {captureEmployeeReceivedContext, prepareEmployeeReceivedCommand, validateEmployeeDeliveryReceipt,
  type EmployeeReceivedContext, type EmployeeDeliveryReceipt} from '../company-contracts/communications/employee-received.ts';

const wireErrors = Object.freeze({400: ['INVALID_REQUEST'], 401: ['AUTHENTICATION_REQUIRED'], 403: ['SCOPE_DENIED'],
  404: ['NOT_FOUND'], 409: ['IDEMPOTENCY_CONFLICT'], 503: ['AUTHORITY_UNAVAILABLE', 'RECORDS_UNAVAILABLE']} as const);
type WireStatus = keyof typeof wireErrors;
type WireCode = typeof wireErrors[WireStatus][number];
export type EmployeeReceivedClientErrorCode = WireCode | 'CONFIG' | 'REQUEST' | 'TIMEOUT' | 'ABORTED' | 'TRANSPORT' | 'RESPONSE';
export class EmployeeReceivedClientError extends Error {
  constructor(readonly code: EmployeeReceivedClientErrorCode, readonly status?: WireStatus) {super(code); this.name = 'EmployeeReceivedClientError';}
}
export interface EmployeeReceivedClientOptions {
  origin: string; role: 'machine'; credential: () => string | Promise<string>; ca: string | Buffer; timeoutMs?: number;
}
function object(value: unknown): value is Record<string, unknown> {return value !== null && typeof value === 'object' && !Array.isArray(value);}
function reflected(value: unknown, token: string): boolean {
  if (typeof value === 'string') return value.includes(token);
  return !!value && typeof value === 'object' && Object.entries(value).some(([key, child]) => key.includes(token) || reflected(child, token));
}
export class EmployeeReceivedClient {
  #port: number; #ca: Buffer; #credential: EmployeeReceivedClientOptions['credential']; #timeoutMs: number;
  constructor(options: EmployeeReceivedClientOptions) {
    try {
      if (!object(options) || Reflect.ownKeys(options).some(key => typeof key !== 'string' || !['origin', 'role', 'credential', 'ca', 'timeoutMs'].includes(key))) throw 0;
      const {origin, role, credential, ca, timeoutMs = 3000} = options;
      const match = typeof origin === 'string' && /^https:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(origin);
      if (!match || Number(match[1]) > 65535 || role !== 'machine' || typeof credential !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw 0;
      if (typeof ca !== 'string' && !Buffer.isBuffer(ca)) throw 0;
      const trust = Buffer.from(ca); if (!trust.length) throw 0; new X509Certificate(trust);
      this.#port = Number(match[1]); this.#ca = trust; this.#credential = credential; this.#timeoutMs = timeoutMs;
    } catch {throw new EmployeeReceivedClientError('CONFIG');}
  }
  get role(): 'machine' {return 'machine';}
  /** One network attempt; uncertain outcomes retain the caller's same command and local journal. */
  async acknowledge(expected: EmployeeReceivedContext, envelopeRaw: Uint8Array, rawPersistedACK: Uint8Array, signal?: AbortSignal): Promise<EmployeeDeliveryReceipt> {
    const deadline = performance.now() + this.#timeoutMs;
    let context: EmployeeReceivedContext, envelope: Uint8Array, command: Uint8Array;
    try {
      context = captureEmployeeReceivedContext(expected);
      if (!(envelopeRaw instanceof Uint8Array) || envelopeRaw.byteLength > 262144 || !(rawPersistedACK instanceof Uint8Array) || rawPersistedACK.byteLength > 32768) throw 0;
      envelope = Uint8Array.from(envelopeRaw); command = Uint8Array.from(rawPersistedACK);
    } catch {throw new EmployeeReceivedClientError('REQUEST');}
    return new Promise((resolve, reject) => {
      let settled = false, pending: ClientRequest | undefined;
      const finish = (code?: EmployeeReceivedClientErrorCode, value?: EmployeeDeliveryReceipt, status?: WireStatus) => {
        if (settled) return;
        if (code !== 'ABORTED' && performance.now() >= deadline) {code = 'TIMEOUT'; status = undefined;}
        settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); pending?.destroy();
        if (code) reject(new EmployeeReceivedClientError(code, status)); else resolve(value!);
      };
      const abort = () => finish('ABORTED'), timer = setTimeout(() => finish('TIMEOUT'), Math.max(0, deadline - performance.now()));
      signal?.addEventListener('abort', abort, {once: true}); if (signal?.aborted) {finish('ABORTED'); return;}
      void (async () => {
        let prepared;
        try {prepared = await prepareEmployeeReceivedCommand(command, context, envelope);} catch {finish('REQUEST'); return;}
        if (settled) return;
        let token: string;
        try {token = await this.#credential();} catch {finish('AUTHENTICATION_REQUIRED'); return;}
        if (settled) return; if (performance.now() >= deadline) {finish('TIMEOUT'); return;}
        if (typeof token !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(token)) {finish('AUTHENTICATION_REQUIRED'); return;}
        const body = Buffer.from(command);
        try {
          pending = httpsRequest({hostname: '127.0.0.1', port: this.#port, method: 'POST', path: '/company/v1/commands',
            headers: {Host: `127.0.0.1:${this.#port}`, Authorization: `Bearer ${token}`, Connection: 'close',
              'Content-Type': 'application/json', 'Content-Length': String(body.length)},
            ca: this.#ca, rejectUnauthorized: true, minVersion: 'TLSv1.2', agent: false, maxHeaderSize: 16384}, response => {
            if (settled) {response.destroy(); return;}
            const status = response.statusCode ?? 0, allowed = wireErrors[status as WireStatus] as readonly WireCode[] | undefined;
            const counts = new Map<string, number>();
            for (let index = 0; index < response.rawHeaders.length; index += 2) {const name = response.rawHeaders[index].toLowerCase(); counts.set(name, (counts.get(name) ?? 0) + 1);}
            const length = response.headers['content-length'];
            if ((status !== 200 && !allowed) || counts.get('content-type') !== 1 || counts.get('content-length') !== 1 || counts.has('content-encoding') || counts.has('transfer-encoding') ||
              !/^application\/json;\s*charset=utf-8$/i.test(response.headers['content-type'] ?? '') || length === undefined || !/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > 262144) {
              finish('RESPONSE'); response.destroy(); return;
            }
            const chunks: Buffer[] = []; let size = 0;
            response.on('data', (chunk: Buffer) => {if (settled) return; size += chunk.length; if (size > 262144) {finish('RESPONSE'); response.destroy(); return;} chunks.push(chunk);});
            response.on('error', () => finish('RESPONSE')); response.on('aborted', () => finish('RESPONSE'));
            response.on('end', () => {
              if (settled) return;
              void (async () => {
                try {
                  const bytes = Buffer.concat(chunks); if (!response.complete || bytes.length !== Number(length)) throw 0;
                  if (status !== 200) {
                    const value = decodeBoundedJson(bytes, 262144);
                    if (!object(value) || Object.keys(value).sort().join(',') !== 'error,schema_version' || value.schema_version !== 1 || !object(value.error) ||
                      Object.keys(value.error).join(',') !== 'code' || !allowed?.includes(value.error.code as WireCode)) throw 0;
                    finish(value.error.code as WireCode, undefined, status as WireStatus); return;
                  }
                  const result = await validateEmployeeDeliveryReceipt(bytes, context, prepared);
                  if (reflected(result, token)) throw 0; finish(undefined, result);
                } catch {finish('RESPONSE');}
              })();
            });
          });
          pending.on('error', () => finish('TRANSPORT')); pending.end(body);
        } catch {finish('TRANSPORT');}
      })();
    });
  }
}
