import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContextResults, CONTEXT_PREVIEW_CAP_BYTES } from '../packages/core/context-results.ts';
import { openContextResultCustody } from '../packages/core/context-result-custody.ts';
import { measure, measuredArm, recordOfflineBenchmark } from './fixtures/offline-benchmark-receipt.ts';

it('measures full result custody versus an authorized bounded range over the same oversized output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'm01-oversized-output-'));
  const owner = { threadId: 'output-thread', workspaceId: 'output-workspace', accountId: null };
  const source = Buffer.alloc(4 * 1024 * 1024, 'seed-42-output-ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  try {
    const initial = createContextResults({
      storage: await openContextResultCustody(root), now: () => 1,
      isAuthorized: (_owner, invocation) => invocation === 'owned-oversized-output',
    });
    const issued = await initial.spill({ owner, invocationId: 'owned-oversized-output', bytes: source,
      mediaType: 'text/plain', expiresAtMs: 1000 });
    expect(issued.status).toBe('AVAILABLE'); expect(issued.handle).toBeTruthy();
    expect(Buffer.byteLength(issued.preview)).toBeLessThanOrEqual(CONTEXT_PREVIEW_CAP_BYTES);
    expect(issued.omittedBytes).toBeGreaterThan(0);
    // Reopen the real durable vault. Count the payload bytes returned by its
    // actual get method, without replacing filesystem custody with a mock.
    const storage = await openContextResultCustody(root);
    let storagePayloadBytes = 0;
    const observedStorage = { ...storage, async get(key: string) {
      const data = await storage.get(key); storagePayloadBytes += data?.byteLength ?? 0; return data;
    } };
    const reopened = createContextResults({
      storage: observedStorage, now: () => 1,
      isAuthorized: (_owner, invocation) => invocation === 'owned-oversized-output',
    });
    const baseline = await measure(() => observedStorage.get(issued.handle!));
    const baselineInputBytes = storagePayloadBytes;
    storagePayloadBytes = 0;
    const offset = 1024 * 1024 + 17, length = 4096;
    const candidate = await measure(() => reopened.read({ owner, handle: issued.handle!, offset, length }));
    const candidateInputBytes = storagePayloadBytes;
    expect(baseline.value).toBeDefined(); expect(sha256(baseline.value!)).toBe(sha256(source));
    expect(candidate.value.status).toBe('OK');
    if (candidate.value.status !== 'OK') throw new Error('Required authorized range is unavailable');
    expect(Buffer.from(candidate.value.bytes)).toEqual(source.subarray(offset, offset + length));
    expect(candidate.value.totalBytes).toBe(source.length);
    expect(candidate.value.omittedBytes).toBe(source.length - length);
    expect(baselineInputBytes).toBe(source.length); expect(candidateInputBytes).toBe(source.length);
    expect(await reopened.read({ owner: { ...owner, threadId: 'foreign' }, handle: issued.handle!, offset, length }))
      .toEqual({ status: 'UNAVAILABLE' });
    recordOfflineBenchmark(root, {
      fixture: 'oversized-output', model: null, account: null, seed: 42,
      config: 'Same 4 MiB durable result after reopen: full storage read versus authorized 4096-byte range',
      baseline: measuredArm('baseline', baseline.elapsedMs, baselineInputBytes, baseline.value!.byteLength),
      candidate: measuredArm('candidate', candidate.elapsedMs, candidateInputBytes, candidate.value.bytes.byteLength),
      notes: [
        'Input bytes count payload data returned by the real storage.get method; metadata/header reads are outside this count.',
        'Output bytes are actual returned payload bytes. The current range implementation still reads the full stored payload.',
        'Fixture generation, durable spill, assertions, and receipt serialization are outside the measured reads.',
        'No disk-I/O reduction, latency improvement, provider behavior, or end-to-end runtime wiring is claimed.',
      ],
    }, { sourceDigest: sha256(source), retainedBytes: source.length, previewBytes: Buffer.byteLength(issued.preview),
      offset, requestedBytes: length, baselineStatus: 'FULL_RESULT', candidateStatus: candidate.value.status,
      reopened: true, foreignOwnerStatus: 'UNAVAILABLE' });
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 5 }); }
});
