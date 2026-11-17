import { createHash, randomUUID } from 'node:crypto';
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

function clip(bytes: Uint8Array): { preview: string; omittedBytes: number } {
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

/** Unwired host helper. The supplied storage owns durable custody and retention. */
export function createContextResults(options: { storage: ContextResultStorage; now: () => number; isAuthorized: (owner: ContextResultOwnerV1, invocationId: string) => boolean }) {
  const records = new Map<string, ToolResultHandleV1>();
  let writing = 0;
  const authorized = (owner: ContextResultOwnerV1, invocation: string) => {
    try { return options.isAuthorized(owner, invocation) === true; } catch { return false; }
  };
  return {
    async spill(input: Spill): Promise<Preview> {
      const { invocationId, expiresAtMs, mediaType } = input, owner = { ...input.owner };
      const absent: Preview = { preview: '', omittedBytes: input.bytes.length, handle: null, status: 'FULL_RESULT_UNAVAILABLE' };
      if (!authorized(owner, invocationId)) return absent;
      const preview = clip(input.bytes);
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
        if (!authorized(owner, invocationId) || expiresAtMs <= options.now()) return absent;
        await options.storage.put(handle, data, record);
        if (!authorized(owner, invocationId) || expiresAtMs <= options.now()) return absent;
        records.set(handle, record);
        return { ...preview, handle, status: 'AVAILABLE' };
      } catch {
        return authorized(owner, invocationId) ? fallback : absent;
      } finally { writing--; }
    },
    async read(input: Read): Promise<Range> {
      const unavailable = { status: 'UNAVAILABLE' } as const;
      let record: ToolResultHandleV1 | undefined;
      try { record = records.get(input.handle) ?? await options.storage.getRecord?.(input.handle); }
      catch { return unavailable; }
      if (!record || !sameOwner(input.owner, record.owner) || record.expiresAtMs <= options.now() ||
        !authorized(record.owner, record.sourceInvocationId)) return unavailable;
      const { offset, length } = input;
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 1 || length > CONTEXT_RANGE_CAP_BYTES ||
        offset >= record.bytes || length > record.bytes - offset) return { status: 'INVALID_RANGE' };
      try {
        const data = await options.storage.get(record.handle);
        if (!data || record.expiresAtMs <= options.now() || !authorized(record.owner, record.sourceInvocationId) ||
          data.length !== record.bytes || digest(data) !== record.digest) return unavailable;
        return { status: 'OK', bytes: Uint8Array.from(data.subarray(offset, offset + length)), offset,
          totalBytes: record.bytes, omittedBytes: record.bytes - length };
      } catch { return unavailable; }
    },
  };
}
