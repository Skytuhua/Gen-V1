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

  it('allows zero cache lifetime to force an advisory recheck', async () => {
    const result = await screenPackage(identity, knownBad, {
      cache: cache(record()), now, maxCacheAgeMs: 0,
    });
    expect(result).toMatchObject({ cacheHit: false, staleCache: true });
    expect(result.record.status).toBe('KNOWN_BAD');
    expect(screeningGate(result.record)).toBe('BLOCK');
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
