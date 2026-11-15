import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import fixture from './fixtures/m04-context-v3.json';

type Owner = { threadId: string; workspaceId: string; accountId: string };
type Vault = {
  spill(input: { owner: Owner; invocationId: string; bytes: Uint8Array; mediaType: string; expiresAtMs: number }): Promise<
    { preview: string; omittedBytes: number; handle: string | null; status: 'AVAILABLE' | 'FULL_RESULT_UNAVAILABLE' }
  >;
  read(input: { owner: Owner; handle: string; offset: number; length: number }): Promise<
    { status: 'OK'; bytes: Uint8Array; offset: number; totalBytes: number; omittedBytes: number } | { status: 'UNAVAILABLE' | 'INVALID_RANGE' }
  >;
};
type ResultsModule = {
  createContextResults(options: {
    now: () => number; isAuthorized: (owner: Owner, invocationId: string) => boolean;
    storage: { put: (key: string, bytes: Uint8Array) => Promise<void>; get: (key: string) => Promise<Uint8Array | undefined> };
  }): Vault;
};
async function loadResults(): Promise<ResultsModule> {
  const load = import.meta.glob<ResultsModule>('../packages/core/context-results.ts')['../packages/core/context-results.ts'];
  if (!load) throw new Error('M04 context result storage has not been implemented');
  return load();
}
const owner = { threadId: 'thread-fixture', workspaceId: 'workspace-fixture', accountId: 'account-fixture' };
const bytes = () => Buffer.from(fixture.results.prefix + fixture.results.fill.repeat(fixture.results.fillCount) + fixture.results.suffix);

async function setup(failWrite = false) {
  const { createContextResults } = await loadResults(), records = new Map<string, Uint8Array>();
  let now = 0, allowed = true, writes = 0;
  const vault = createContextResults({
    now: () => now, isAuthorized: () => allowed,
    storage: {
      async put(key, bytes) { if (failWrite) throw new Error('fixture disk error'); writes++; records.set(key, bytes.slice()); },
      async get(key) { return records.get(key); },
    },
  });
  const spill = () => vault.spill({ owner, invocationId: 'tool-call-fixture', bytes: bytes(), mediaType: 'text/plain', expiresAtMs: 60_000 });
  return { vault, records, spill, setTime: (value: number) => { now = value; }, revoke: () => { allowed = false; }, writes: () => writes };
}

it('keeps a bounded head and tail preview and returns exact authorized bytes', async () => {
  const x = await setup(), result = await x.spill(), full = bytes(), offset = full.length - 21;
  expect(result.status).toBe('AVAILABLE'); expect(result.handle).not.toBeNull();
  expect(Buffer.byteLength(result.preview)).toBeLessThanOrEqual(fixture.results.previewCapBytes);
  expect(result.preview).toContain('BEGIN'); expect(result.preview).toContain('END');
  expect(result.omittedBytes).toBeGreaterThan(0);
  expect(x.writes()).toBe(1);
  const range = await x.vault.read({ owner, handle: result.handle!, offset, length: 21 });
  expect(range).toMatchObject({ status: 'OK', offset, totalBytes: fixture.results.expectedBytes, omittedBytes: full.length - 21 });
  if (range.status !== 'OK') throw new Error('Authorized range is not readable');
  const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
  expect(digest(range.bytes)).toBe(digest(full.subarray(offset)));
  expect(await x.vault.read({ owner, handle: result.handle!, offset: 0, length: fixture.results.rangeCapBytes + 1 })).toEqual({ status: 'INVALID_RANGE' });
});

it('does not reveal stored output after grant revocation, deletion, expiry or a change of owner', async () => {
  const x = await setup(), result = await x.spill(), handle = result.handle!;
  const request = { owner, handle, offset: 0, length: 4 };
  expect(await x.vault.read({ ...request, owner: { ...owner, accountId: 'unrelated-account' } })).toEqual({ status: 'UNAVAILABLE' });
  x.setTime(60_000); expect(await x.vault.read(request)).toEqual({ status: 'UNAVAILABLE' });
  x.setTime(0); x.revoke(); expect(await x.vault.read(request)).toEqual({ status: 'UNAVAILABLE' });
  const deleted = await setup(), issued = await deleted.spill(); deleted.records.clear();
  expect(await deleted.vault.read({ ...request, handle: issued.handle! })).toEqual({ status: 'UNAVAILABLE' });
});

it('returns a bounded usable preview but no handle when full storage fails', async () => {
  const x = await setup(true), result = await x.spill();
  expect(result).toMatchObject({ status: 'FULL_RESULT_UNAVAILABLE', handle: null });
  expect(Buffer.byteLength(result.preview)).toBeLessThanOrEqual(fixture.results.previewCapBytes);
  expect(result.preview).toContain('BEGIN'); expect(result.preview).toContain('END');
});
