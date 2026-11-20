import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PackageScreeningV1 } from '../packages/contracts/execution-profile.ts';
import {
  screenPackage, screeningGate, type AdvisoryDatabase, type PackageIdentity,
  type ScreeningRecordCache,
} from '../packages/core/package-screening.ts';
import { installPluginPackage, readPluginIndex } from '../packages/plugins/installation.ts';

const identity: PackageIdentity = { name: 'example-plugin', version: '1.0.0', digest: 'a'.repeat(64) };
const checkedAt = '2026-11-17T00:00:00.000Z';
const now = () => Date.parse(checkedAt) + 1_000;
const exception = { actor: 'operator-a', reason: 'Reviewed this exact package while the scanner is offline.' };
const unavailable: AdvisoryDatabase = { database: 'current-db', query: async () => ({ status: 'UNAVAILABLE' }) };
const knownBad: AdvisoryDatabase = { database: 'current-db', query: async () => ({ status: 'MATCH', advisoryIds: ['TEST-001'] }) };

function record(overrides: Partial<PackageScreeningV1> = {}): PackageScreeningV1 {
  return {
    version: 1, screeningId: 'cached-record', pkg: { ...identity },
    source: { kind: 'registry', locator: 'current-db' },
    advisory: { database: 'current-db', asOf: checkedAt },
    status: 'NO_KNOWN_MATCH', decision: 'ALLOW', reason: 'No advisory match.',
    checkedAt, cacheAgeMs: 0, ...overrides,
  };
}

function cache(initial?: PackageScreeningV1): ScreeningRecordCache {
  let current = initial;
  return { get: () => current, put: (_key, next) => { current = next; } };
}

describe('M03 cached package screening authority', () => {
  it('fails closed on inconsistent persisted screening status and decision pairs', () => {
    const cases: Array<Pick<PackageScreeningV1, 'status' | 'decision'>> = [
      { status: 'UNAVAILABLE', decision: 'ALLOW' },
      { status: 'NO_KNOWN_MATCH', decision: 'DENY' },
      { status: 'NO_KNOWN_MATCH', decision: 'OPERATOR_EXCEPTION' },
      { status: 'KNOWN_BAD', decision: 'ALLOW' },
    ];
    for (const invalid of cases) {
      expect(screeningGate(record(invalid))).toBe('BLOCK');
    }
  });

  it('does not reuse an earlier operator exception without a current exception', async () => {
    const stored = cache();
    const first = await screenPackage(identity, unavailable, { cache: stored, now, exception });
    expect(screeningGate(first.record)).toBe('EXCEPTION_RECORDED');
    expect(first.exception).toMatchObject(exception);

    const next = await screenPackage(identity, unavailable, { cache: stored, now });
    expect(screeningGate(next.record)).toBe('BLOCK');
    expect(next.record).toMatchObject({ status: 'UNAVAILABLE', decision: 'DENY' });
    expect(next.exception).toBeUndefined();
  });

  it('records the current operator exception when the cache contains an unavailable denial', async () => {
    const stored = cache();
    await screenPackage(identity, unavailable, { cache: stored, now });
    const next = await screenPackage(identity, unavailable, { cache: stored, now, exception });
    expect(screeningGate(next.record)).toBe('EXCEPTION_RECORDED');
    expect(next.exception).toMatchObject({ ...exception, recordedAt: '2026-11-17T00:00:01.000Z' });
  });

  it('rechecks an unavailable result so an earlier exception cannot hide a new known-bad result', async () => {
    const stored = cache();
    await screenPackage(identity, unavailable, { cache: stored, now, exception });
    const next = await screenPackage(identity, knownBad, { cache: stored, now, exception });
    expect(next.record.status).toBe('KNOWN_BAD');
    expect(screeningGate(next.record)).toBe('BLOCK');
    expect(next.exception).toBeUndefined();
  });

  it('cannot reuse a clean lookup from a different advisory database', async () => {
    const stored = cache(record({ advisory: { database: 'previous-db', asOf: checkedAt } }));
    const next = await screenPackage(identity, knownBad, { cache: stored, now });
    expect(next.record.advisory.database).toBe('current-db');
    expect(next.record.status).toBe('KNOWN_BAD');
    expect(screeningGate(next.record)).toBe('BLOCK');
  });

  for (const pkg of [
    { ...identity, name: 'another-plugin' },
    { ...identity, version: '2.0.0' },
    { ...identity, digest: 'b'.repeat(64) },
  ]) {
    it(`does not use a cache record for another package identity: ${JSON.stringify(pkg)}`, async () => {
      const next = await screenPackage(identity, knownBad, { cache: cache(record({ pkg })), now });
      expect(next.record.pkg).toEqual(identity);
      expect(screeningGate(next.record)).toBe('BLOCK');
    });
  }

  it('keeps delimiter-colliding package identities in separate advisory cache entries', async () => {
    const first: PackageIdentity = { ...identity, name: 'alpha@beta', version: 'gamma' };
    const second: PackageIdentity = { ...identity, name: 'alpha', version: 'beta@gamma' };
    // Both identities produced alpha@beta@gamma#<digest> under the old key.
    const entries = new Map<string, PackageScreeningV1>();
    const stored: ScreeningRecordCache = {
      get: key => entries.get(key),
      put: (key, next) => { entries.set(key, next); },
    };
    const blocked = await screenPackage(first, knownBad, { cache: stored, now });
    expect(screeningGate(blocked.record)).toBe('BLOCK');
    const clean: AdvisoryDatabase = {
      database: 'current-db',
      query: async () => ({ status: 'NO_MATCH', asOf: checkedAt }),
    };
    const other = await screenPackage(second, clean, { cache: stored, now });
    expect(other.record).toMatchObject({ status: 'NO_KNOWN_MATCH', decision: 'ALLOW', pkg: second });
    expect(entries.size).toBe(2);
    const replay = await screenPackage(first, unavailable, { cache: stored, now });
    expect(replay).toMatchObject({
      cacheHit: true, record: { screeningId: blocked.record.screeningId, status: 'KNOWN_BAD', decision: 'DENY' },
    });
    expect(screeningGate(replay.record)).toBe('BLOCK');
  });

  it('retains a matching legacy-key known-bad denial during the cache-key migration', async () => {
    const legacyKey = `${identity.name}@${identity.version}#${identity.digest}`;
    const prior = record({ status: 'KNOWN_BAD', decision: 'DENY' });
    const entries = new Map<string, PackageScreeningV1>([[legacyKey, prior]]);
    const stored: ScreeningRecordCache = {
      get: key => entries.get(key),
      put: (key, next) => { entries.set(key, next); },
    };
    const twoDaysLater = () => Date.parse(checkedAt) + 2 * 24 * 60 * 60 * 1000;
    const result = await screenPackage(identity, unavailable, {
      cache: stored, now: twoDaysLater, maxCacheAgeMs: 0, exception,
    });
    expect(result).toMatchObject({
      cacheHit: false, staleCache: true,
      record: { screeningId: prior.screeningId, status: 'KNOWN_BAD', decision: 'DENY' },
    });
    expect(screeningGate(result.record)).toBe('BLOCK');
    expect(result.exception).toBeUndefined();
    expect(entries.get(legacyKey)).toEqual(prior);
  });

  it('rechecks a cache timestamp in the future', async () => {
    const stored = cache(record({ checkedAt: '2026-11-18T00:00:00.000Z' }));
    const next = await screenPackage(identity, knownBad, { cache: stored, now });
    expect(screeningGate(next.record)).toBe('BLOCK');
    expect(next.record.cacheAgeMs).toBeGreaterThanOrEqual(0);
  });

  it('reports the actual cache age for a reused clean result without granting trust', async () => {
    const next = await screenPackage(identity, knownBad, { cache: cache(record()), now });
    expect(next.cacheHit).toBe(true);
    expect(next.record.cacheAgeMs).toBe(1_000);
    expect(next.record.status).toBe('NO_KNOWN_MATCH');
    expect(screeningGate(next.record)).toBe('NEUTRAL');
    expect(next.exception).toBeUndefined();
  });

  it('rejects non-finite, negative, fractional or longer-than-24h cache lifetimes', async () => {
    // Before the fix, Infinity reused this two-day-old NO_KNOWN_MATCH entry
    // without querying a now-known-bad advisory database.
    const oldCleanResult = cache(record());
    let queries = 0;
    const advisory: AdvisoryDatabase = {
      database: 'current-db',
      query: async () => { queries++; return { status: 'MATCH', advisoryIds: ['TEST-002'] }; },
    };
    const twoDaysLater = () => Date.parse(checkedAt) + 2 * 24 * 60 * 60 * 1000;
    for (const maxCacheAgeMs of [Infinity, NaN, -1, 0.5, 24 * 60 * 60 * 1000 + 1]) {
      await expect(screenPackage(identity, advisory, {
        cache: oldCleanResult, now: twoDaysLater, maxCacheAgeMs,
      })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
    expect(queries).toBe(0);
  });

  it('rechecks at zero cache lifetime, including equal checkedAt and now timestamps', async () => {
    for (const clock of [now, () => Date.parse(checkedAt)]) {
      let queries = 0;
      const advisory: AdvisoryDatabase = {
        database: 'current-db',
        query: async () => { queries++; return { status: 'MATCH', advisoryIds: ['TEST-001'] }; },
      };
      const result = await screenPackage(identity, advisory, {
        cache: cache(record()), now: clock, maxCacheAgeMs: 0,
      });
      expect(result).toMatchObject({ cacheHit: false, staleCache: true });
      expect(result.record.status).toBe('KNOWN_BAD');
      expect(screeningGate(result.record)).toBe('BLOCK');
      expect(queries).toBe(1);
    }
  });

  it('rechecks a recently cached clean result when its advisory snapshot is stale', async () => {
    const staleSnapshot = '2026-11-15T00:00:00.000Z';
    const stored = cache(record({
      checkedAt: new Date(now()).toISOString(),
      advisory: { database: 'current-db', asOf: staleSnapshot },
    }));
    let queries = 0;
    const advisory: AdvisoryDatabase = {
      database: 'current-db',
      query: async () => { queries++; return { status: 'MATCH', advisoryIds: ['TEST-STALENESS'] }; },
    };
    const result = await screenPackage(identity, advisory, { cache: stored, now });
    expect(result).toMatchObject({ cacheHit: false, staleCache: true });
    expect(queries).toBe(1);
    expect(result.record.status).toBe('KNOWN_BAD');
    expect(screeningGate(result.record)).toBe('BLOCK');
  });

  it('blocks old or future-dated NO_MATCH advisory snapshots instead of caching a clean answer', async () => {
    for (const asOf of ['2026-11-15T00:00:00.000Z', '2026-11-18T00:00:00.000Z']) {
      let queries = 0;
      const advisory: AdvisoryDatabase = {
        database: 'current-db',
        query: async () => { queries++; return { status: 'NO_MATCH', asOf }; },
      };
      const stored = cache();
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await screenPackage(identity, advisory, { cache: stored, now });
        expect(result.record).toMatchObject({
          status: 'UNAVAILABLE', decision: 'DENY',
          advisory: { database: 'current-db', asOf },
        });
        expect(screeningGate(result.record)).toBe('BLOCK');
        expect(result.cacheHit).toBe(false);
      }
      expect(queries).toBe(2);
    }
  });

  it('rejects NO_MATCH without declared snapshot provenance before caching a clean result', async () => {
    for (const asOf of [undefined, '', 'not-a-date']) {
      let cached = false;
      let queried = 0;
      const advisory: AdvisoryDatabase = {
        database: 'current-db',
        query: async () => {
          queried++;
          return { status: 'NO_MATCH', ...(asOf === undefined ? {} : { asOf }) };
        },
      };
      await expect(screenPackage(identity, advisory, {
        now, cache: { get: () => undefined, put: () => { cached = true; } },
      })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      expect(queried).toBe(1);
      expect(cached).toBe(false);
    }
  });
  it('accepts a fresh snapshot created during an in-flight advisory query', async () => {
    const start = Date.parse(checkedAt);
    let clock = start;
    const advisory: AdvisoryDatabase = {
      database: 'current-db',
      query: async () => {
        clock += 50;
        const asOf = new Date(clock).toISOString();
        clock += 50;
        return { status: 'NO_MATCH', asOf };
      },
    };
    const result = await screenPackage(identity, advisory, { now: () => clock });
    expect(result.record.status).toBe('NO_KNOWN_MATCH');
    expect(screeningGate(result.record)).toBe('NEUTRAL');
    expect(result.record.advisory.asOf).toBe(new Date(start + 50).toISOString());
    expect(result.record.checkedAt).toBe(new Date(start + 100).toISOString());
  });

  it('retains a known-bad denial even if the matching advisory snapshot is old', async () => {
    const advisory: AdvisoryDatabase = {
      database: 'current-db',
      query: async () => ({
        status: 'MATCH', asOf: '2026-11-15T00:00:00.000Z', advisoryIds: ['TEST-KNOWN-BAD'],
      }),
    };
    const result = await screenPackage(identity, advisory, { now });
    expect(result.record.status).toBe('KNOWN_BAD');
    expect(screeningGate(result.record)).toBe('BLOCK');
  });

  it('retains a stale known-bad block when the advisory refresh is unavailable or stale', async () => {
    const twoDaysLater = () => Date.parse(checkedAt) + 2 * 24 * 60 * 60 * 1000;
    const stored = cache(record({ status: 'KNOWN_BAD', decision: 'DENY' }));
    let queries = 0;
    const unavailableRefresh: AdvisoryDatabase = {
      database: 'current-db',
      query: async () => { queries++; return { status: 'UNAVAILABLE' }; },
    };
    for (const exceptionInput of [exception, undefined, exception]) {
      const refreshed = await screenPackage(identity, unavailableRefresh, {
        cache: stored, now: twoDaysLater, exception: exceptionInput,
      });
      expect(refreshed).toMatchObject({
        cacheHit: false, staleCache: true,
        record: { status: 'KNOWN_BAD', decision: 'DENY', checkedAt },
      });
      expect(screeningGate(refreshed.record)).toBe('BLOCK');
      expect(refreshed.exception).toBeUndefined();
    }
    expect(queries).toBe(3);

    const staleClean: AdvisoryDatabase = {
      database: 'current-db',
      query: async () => ({ status: 'NO_MATCH', asOf: checkedAt }),
    };
    const staleResult = await screenPackage(identity, staleClean, { cache: stored, now: twoDaysLater, exception });
    expect(staleResult.record).toMatchObject({ status: 'KNOWN_BAD', decision: 'DENY' });
    expect(screeningGate(staleResult.record)).toBe('BLOCK');

    // A genuinely fresh snapshot can supersede the prior match, but remains neutral, never trusted.
    const freshClean: AdvisoryDatabase = {
      database: 'current-db',
      query: async () => ({ status: 'NO_MATCH', asOf: new Date(twoDaysLater()).toISOString() }),
    };
    const cleared = await screenPackage(identity, freshClean, { cache: stored, now: twoDaysLater });
    expect(cleared).toMatchObject({ cacheHit: false, staleCache: true });
    expect(cleared.record).toMatchObject({ status: 'NO_KNOWN_MATCH', decision: 'ALLOW' });
    expect(screeningGate(cleared.record)).toBe('NEUTRAL');
  });

  it.each([
    ['older', '2026-11-16T22:00:00.000Z'],
    ['equal', '2026-11-16T23:00:00.000Z'],
  ])('retains a known-bad block after a fresh NO_MATCH from an %s snapshot', async (_order, asOf) => {
    const prior = record({
      status: 'KNOWN_BAD', decision: 'DENY',
      advisory: { database: 'current-db', asOf: '2026-11-16T23:00:00.000Z' },
    });
    const stored = cache(prior);
    const refreshTime = () => Date.parse('2026-11-17T02:00:00.000Z');
    const advisory: AdvisoryDatabase = {
      database: 'current-db',
      query: async () => ({ status: 'NO_MATCH', asOf }),
    };
    const result = await screenPackage(identity, advisory, {
      cache: stored, now: refreshTime, maxCacheAgeMs: 60 * 60 * 1000, exception,
    });
    expect(result).toMatchObject({
      cacheHit: false, staleCache: true, record: { ...prior, cacheAgeMs: 2 * 60 * 60 * 1000 },
    });
    expect(screeningGate(result.record)).toBe('BLOCK');
    expect(result.exception).toBeUndefined();

    const next = await screenPackage(identity, unavailable, {
      cache: stored, now: refreshTime, maxCacheAgeMs: 60 * 60 * 1000,
    });
    expect(next.record.screeningId).toBe(prior.screeningId);
    expect(screeningGate(next.record)).toBe('BLOCK');
  });

  it('retains a known-bad block when the advisory query throws', async () => {
    const prior = record({ status: 'KNOWN_BAD', decision: 'DENY' });
    const advisory: AdvisoryDatabase = {
      database: 'current-db',
      query: async () => { throw new Error('Advisory service unreachable'); },
    };
    const result = await screenPackage(identity, advisory, {
      cache: cache(prior), now, maxCacheAgeMs: 0, exception,
    });
    expect(result).toMatchObject({
      cacheHit: false, staleCache: true, record: { ...prior, cacheAgeMs: 1_000 },
    });
    expect(screeningGate(result.record)).toBe('BLOCK');
    expect(result.exception).toBeUndefined();
  });

  it('updates a known-bad block with the latest matching advisory and query time', async () => {
    const prior = record({ status: 'KNOWN_BAD', decision: 'DENY' });
    const refreshAt = new Date(now()).toISOString();
    const stored = cache(prior);
    const olderMatch: AdvisoryDatabase = {
      database: 'current-db',
      query: async () => ({
        status: 'MATCH', asOf: '2026-11-16T23:00:00.000Z', advisoryIds: ['TEST-OLDER'],
      }),
    };
    const retained = await screenPackage(identity, olderMatch, { cache: stored, now, maxCacheAgeMs: 0 });
    expect(retained.record).toMatchObject({ screeningId: prior.screeningId, advisory: prior.advisory });
    expect(screeningGate(retained.record)).toBe('BLOCK');

    const newMatch: AdvisoryDatabase = {
      database: 'current-db',
      query: async () => ({ status: 'MATCH', asOf: refreshAt, advisoryIds: ['TEST-NEW-MATCH'] }),
    };
    const updated = await screenPackage(identity, newMatch, { cache: stored, now, maxCacheAgeMs: 0 });
    expect(updated.record).toMatchObject({
      checkedAt: refreshAt, advisory: { database: 'current-db', asOf: refreshAt },
      status: 'KNOWN_BAD', decision: 'DENY', reason: expect.stringContaining('TEST-NEW-MATCH'),
    });
    expect(screeningGate(updated.record)).toBe('BLOCK');

    const reused = await screenPackage(identity, unavailable, { cache: stored, now });
    expect(reused.cacheHit).toBe(true);
    expect(reused.record.screeningId).toBe(updated.record.screeningId);
  });

  it('scopes retained known-bad blocks to the advisory database that recorded them', async () => {
    const prior = record({
      advisory: { database: 'previous-db', asOf: checkedAt },
      status: 'KNOWN_BAD', decision: 'DENY',
    });
    const result = await screenPackage(identity, unavailable, { cache: cache(prior), now, exception });
    expect(result).toMatchObject({
      cacheHit: false, staleCache: true,
      record: { status: 'UNAVAILABLE', decision: 'OPERATOR_EXCEPTION', advisory: { database: 'current-db' } },
    });
    expect(screeningGate(result.record)).toBe('EXCEPTION_RECORDED');
  });

  it('rechecks stale cache and retains unavailable as a distinct denial', async () => {
    const next = await screenPackage(identity, unavailable, {
      cache: cache(record()), now, maxCacheAgeMs: 999,
    });
    expect(next).toMatchObject({ cacheHit: false, staleCache: true });
    expect(next.record.status).toBe('UNAVAILABLE');
    expect(screeningGate(next.record)).toBe('BLOCK');
  });

  it('never turns a cached known-bad result into an operator exception', async () => {
    const next = await screenPackage(identity, unavailable, {
      cache: cache(record({ status: 'KNOWN_BAD', decision: 'DENY' })), now, exception,
    });
    expect(next.cacheHit).toBe(true);
    expect(screeningGate(next.record)).toBe('BLOCK');
    expect(next.exception).toBeUndefined();
  });

  it('blocks the actual installer when the only exception belongs to a previous screening request', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'screening-install-'));
    const source = join(directory, 'source'), destination = join(directory, 'installed');
    try {
      await mkdir(source);
      await mkdir(join(source, 'frontend'));
      await mkdir(join(source, 'host'));
      const files = {
        'plugin.json': JSON.stringify({
          id: identity.name, name: 'Screening fixture', version: identity.version,
          apiVersion: 1, compatibleGenVersions: '>=0.6.3 <0.7.0',
          frontendEntry: 'frontend/index.html', hostEntry: 'host/main.mjs',
        }),
        'frontend/index.html': '<p>Screening fixture</p>',
        'host/main.mjs': 'export default { activate() { throw Error("must not execute"); } };',
      };
      const sha = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
      const inventory = JSON.stringify({ version: 1, files: Object.entries(files).map(([path, bytes]) => ({
        path, bytes: Buffer.byteLength(bytes), sha256: sha(bytes),
      })) });
      for (const [path, bytes] of Object.entries(files)) await writeFile(join(source, path), bytes);
      await writeFile(join(source, 'plugin-files.json'), inventory);
      const pkg = { ...identity, digest: sha(inventory) }, stored = cache();
      await screenPackage(pkg, unavailable, { cache: stored, exception });

      await expect(installPluginPackage(source, destination, pkg.digest, '0.6.3', {
        screening: { advisory: unavailable, cache: stored },
      })).rejects.toThrow(/screening denied activation/i);
      // The caller can supply a plausible actor/reason without an authenticated
      // operator decision or a durable separate audit record. It must not bypass
      // the real installer even though the pure screening computation records it.
      await expect(installPluginPackage(source, destination, pkg.digest, '0.6.3', {
        screening: { advisory: unavailable, cache: stored, exception },
      })).rejects.toThrow(/authenticated approval and durable audit evidence/i);
      expect(await readPluginIndex(destination)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
