import { createHash, randomUUID } from 'node:crypto';
import { types } from 'node:util';
import type { ContextResultOwnerV1, ToolResultHandleV1 } from '../contracts/request-context.ts';

export const CONTEXT_PREVIEW_CAP_BYTES = 16 * 1024;
export const CONTEXT_RANGE_CAP_BYTES = 1024 * 1024;
export const RESULT_CAP_BYTES = 16 * 1024 * 1024;
export const MAX_TRACKED_RESULTS = 128;
const OMIT = '\n[… result clipped …]\n';
export type ContextResultStorage = {
  put(key: string, bytes: Uint8Array, record: ToolResultHandleV1): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  getRecord?(key: string): Promise<ToolResultHandleV1 | undefined>;
  pruneExpired?(now: number): Promise<number>;
};
type Spill = { owner: ContextResultOwnerV1; invocationId: string; bytes: Uint8Array; mediaType: string; expiresAtMs: number };
type Read = { owner: ContextResultOwnerV1; handle: string; offset: number; length: number };
type Preview = { preview: string; omittedBytes: number; handle: string | null; status: 'AVAILABLE' | 'FULL_RESULT_UNAVAILABLE' };
type Range = { status: 'OK'; bytes: Uint8Array; offset: number; totalBytes: number; omittedBytes: number } |
  { status: 'UNAVAILABLE' | 'INVALID_RANGE' };
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const sameOwner = (a: ContextResultOwnerV1, b: ContextResultOwnerV1) =>
  a.threadId === b.threadId && a.workspaceId === b.workspaceId && a.accountId === b.accountId;

export function clipContextResult(bytes: Uint8Array): { preview: string; omittedBytes: number } {
  try {
    if (bytes.length <= CONTEXT_PREVIEW_CAP_BYTES)
      return { preview: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), omittedBytes: 0 };
    const half = Math.floor((CONTEXT_PREVIEW_CAP_BYTES - Buffer.byteLength(OMIT)) / 2);
    const start = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, half), { stream: true });
    let boundary = bytes.length - half;
    while (boundary < bytes.length && (bytes[boundary]! & 0xc0) === 0x80) boundary++;
    const tail = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(boundary));
    return { preview: start + OMIT + tail, omittedBytes: bytes.length - Buffer.byteLength(start) - Buffer.byteLength(tail) };
  } catch {
    return { preview: '[Non-UTF-8 output; text preview unavailable]', omittedBytes: bytes.length };
  }
}

export type EncodedContextResult = { bytes: Uint8Array | null; mediaType: string; totalBytes: number | null; preview: string; omittedBytes: number | null };

/** Serialize plain tool data once, without getters, proxies or custom toJSON.
 * Keep at most the storage cap and bounded head/tail, even for larger output.
 * The inspection ceiling is explicit; unsupported shapes never escape raw. */
export function encodeContextResult(value: unknown): EncodedContextResult {
  const mediaType = typeof value === 'string' ? 'text/plain' : 'application/json';
  const half = Math.floor((CONTEXT_PREVIEW_CAP_BYTES - Buffer.byteLength(OMIT)) / 2);
  let totalBytes = 0, nodes = 0, head = Buffer.alloc(0), tail = Buffer.alloc(0), chunks: Buffer[] | null = [];
  const ancestors = new Set<object>();
  function* stringParts(text: string): Generator<string> {
    for (let start = 0; start < text.length;) {
      let end = Math.min(start + 4096, text.length);
      const before = text.charCodeAt(end - 1), after = text.charCodeAt(end);
      if (end < text.length && before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) end--;
      yield text.slice(start, end); start = end;
    }
  }
  function* quoted(text: string): Generator<string> {
    yield '"'; for (const part of stringParts(text)) yield JSON.stringify(part).slice(1, -1); yield '"';
  }
  function* json(item: unknown, depth: number): Generator<string> {
    if (++nodes > 65536 || depth > 32) throw Error('Inspection limit');
    if (typeof item === 'string') { yield* quoted(item); return; }
    if (item === null || typeof item === 'boolean' || typeof item === 'number') { yield JSON.stringify(item); return; }
    if (typeof item !== 'object' || types.isProxy(item) || ancestors.has(item)) throw Error('Unsupported result');
    const array = Array.isArray(item), prototype = Object.getPrototypeOf(item);
    if (array ? prototype !== Array.prototype || item.length > 65536 : prototype !== Object.prototype && prototype !== null) throw Error('Unsupported result');
    if (Object.getOwnPropertyDescriptor(item, 'toJSON')) throw Error('Custom serialization');
    ancestors.add(item);
    try {
      if (array) {
        yield '[';
        for (let index = 0; index < item.length; index++) {
          if (index) yield ',';
          const property = Object.getOwnPropertyDescriptor(item, String(index));
          if (property && !('value' in property)) throw Error('Accessor result');
          yield* json(property?.value === undefined ? null : property.value, depth + 1);
        }
        yield ']';
      } else {
        const keys = Reflect.ownKeys(item); if (keys.length > 65536) throw Error('Inspection limit');
        yield '{'; let count = 0;
        for (const key of keys) {
          if (typeof key !== 'string') throw Error('Unsupported property');
          const property = Object.getOwnPropertyDescriptor(item, key)!;
          if (!('value' in property)) throw Error('Accessor result');
          if (!property.enumerable || property.value === undefined) continue;
          if (count++) yield ',';
          yield* quoted(key); yield ':'; yield* json(property.value, depth + 1);
        }
        yield '}';
      }
    } finally { ancestors.delete(item); }
  }
  try {
    for (const part of typeof value === 'string' ? stringParts(value) : json(value, 0)) {
      const bytes = Buffer.from(part); totalBytes += bytes.length;
      if (totalBytes > 64 * 1024 * 1024) throw Error('Inspection limit');
      if (head.length < half) head = Buffer.concat([head, bytes.subarray(0, half - head.length)]);
      tail = Buffer.concat([tail, bytes]).subarray(-half);
      if (totalBytes > RESULT_CAP_BYTES) chunks = null; else chunks?.push(bytes);
    }
    if (chunks) { const bytes = Buffer.concat(chunks, totalBytes); return { bytes, mediaType, totalBytes, ...clipContextResult(bytes) }; }
    const start = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(head, { stream: true });
    let boundary = 0; while (boundary < tail.length && (tail[boundary]! & 0xc0) === 0x80) boundary++;
    const end = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(tail.subarray(boundary));
    return { bytes: null, mediaType, totalBytes, preview: start + OMIT + end, omittedBytes: totalBytes - Buffer.byteLength(start) - Buffer.byteLength(end) };
  } catch {
    return { bytes: null, mediaType, totalBytes: null, preview: '[Tool output is outside the supported bounded serialization; full result unavailable]', omittedBytes: null };
  }
}

/** The host supplies current invocation authority; storage owns private custody. */
export function createContextResults(options: { storage: ContextResultStorage; now: () => number; isAuthorized: (owner: ContextResultOwnerV1, invocationId: string) => boolean | Promise<boolean> }) {
  const records = new Map<string, ToolResultHandleV1>();
  let writing = 0;
  const authorized = async (owner: ContextResultOwnerV1, invocation: string) => {
    try { return await options.isAuthorized(owner, invocation) === true; } catch { return false; }
  };
  return {
    async spill(input: Spill): Promise<Preview> {
      const { invocationId, expiresAtMs, mediaType } = input, owner = { ...input.owner };
      const absent: Preview = { preview: '', omittedBytes: input.bytes.length, handle: null, status: 'FULL_RESULT_UNAVAILABLE' };
      if (!await authorized(owner, invocationId)) return absent;
      const preview = clipContextResult(input.bytes);
      const fallback: Preview = { ...preview, handle: null, status: 'FULL_RESULT_UNAVAILABLE' };
      const now = options.now();
      for (const [handle, record] of records) if (record.expiresAtMs <= now) records.delete(handle);
      if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= now ||
        input.bytes.length > RESULT_CAP_BYTES || records.size + writing >= MAX_TRACKED_RESULTS) return fallback;
      const data = Uint8Array.from(input.bytes);
      const handle = randomUUID();
      const record: ToolResultHandleV1 = { handle, owner, sourceInvocationId: invocationId, digest: digest(data),
        bytes: data.length, mediaType, expiresAtMs, operation: 'read-result-range' };
      writing++;
      try {
        const persisted = await options.storage.pruneExpired?.(now);
        if (persisted !== undefined && persisted + writing > MAX_TRACKED_RESULTS) return fallback;
        if (!await authorized(owner, invocationId) || expiresAtMs <= options.now()) return absent;
        await options.storage.put(handle, data, record);
        if (!await authorized(owner, invocationId) || expiresAtMs <= options.now()) return absent;
        records.set(handle, record);
        return { ...preview, handle, status: 'AVAILABLE' };
      } catch {
        return await authorized(owner, invocationId) ? fallback : absent;
      } finally { writing--; }
    },
    async read(input: Read): Promise<Range> {
      const unavailable = { status: 'UNAVAILABLE' } as const;
      let record: ToolResultHandleV1 | undefined;
      try { record = records.get(input.handle) ?? await options.storage.getRecord?.(input.handle); }
      catch { return unavailable; }
      if (!record || !sameOwner(input.owner, record.owner) || record.expiresAtMs <= options.now() ||
        !await authorized(record.owner, record.sourceInvocationId)) return unavailable;
      const { offset, length } = input;
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 1 || length > CONTEXT_RANGE_CAP_BYTES ||
        offset >= record.bytes || length > record.bytes - offset) return { status: 'INVALID_RANGE' };
      try {
        const data = await options.storage.get(record.handle);
        if (!data || record.expiresAtMs <= options.now() || !await authorized(record.owner, record.sourceInvocationId) ||
          data.length !== record.bytes || digest(data) !== record.digest) return unavailable;
        return { status: 'OK', bytes: Uint8Array.from(data.subarray(offset, offset + length)), offset,
          totalBytes: record.bytes, omittedBytes: record.bytes - length };
      } catch { return unavailable; }
    },
  };
}
