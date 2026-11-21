import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFileReferenceVerifier } from '../apps/web/src/file-reference-verifier';

const owner = { projectId: 'p1', threadId: 't1' };
const listing = (names: string[], kinds: Record<string, string> = {}) => ({ entries: names.map(name => ({ name, kind: kinds[name] ?? 'file' })) });

const verifierWith = (calls: { folder: string; signal: AbortSignal }[], fetch?: (folder: string, signal: AbortSignal) => Promise<{ entries: { name: string; kind: string }[] }>) =>
  createFileReferenceVerifier(owner, {
    fetchFolder: fetch ?? (async (folder, signal) => { calls.push({ folder, signal }); return listing(['a.ts', 'b.ts']); }),
  });

describe('createFileReferenceVerifier', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shares one folder listing across sibling references', async () => {
    const calls: { folder: string }[] = [];
    const verifier = verifierWith(calls);
    verifier.request('src/a.ts');
    verifier.request('src/b.ts');
    verifier.request('other/c.ts');
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.map(call => call.folder).sort()).toEqual(['other', 'src']);
    expect(verifier.status('src/a.ts')).toBe('file');
    expect(verifier.status('src/missing.ts')).toBe('absent');
  });

  it('reports directories as absent and root files with no path param', async () => {
    const calls: { folder: string }[] = [];
    const verifier = verifierWith(calls, async folder => { calls.push({ folder }); return listing(['a.ts'], { 'a.ts': 'file' }); });
    verifier.request('package.json');
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([{ folder: '' }]);
    expect(verifier.status('package.json')).toBe('absent');
    const dir = verifierWith(calls, async () => listing(['sub'], { sub: 'directory' }));
    dir.request('sub/file.ts');
    await vi.advanceTimersByTimeAsync(0);
    expect(dir.status('sub/file.ts')).toBe('absent');
  });

  it('marks failures absent and only refetches after the TTL', async () => {
    let failures = true;
    const verifier = verifierWith([], async () => { if (failures) throw Error('denied'); return listing(['a.ts']); });
    verifier.request('src/a.ts');
    await vi.advanceTimersByTimeAsync(0);
    expect(verifier.status('src/a.ts')).toBe('absent');
    verifier.request('src/a.ts');
    await vi.advanceTimersByTimeAsync(29_000);
    expect(verifier.status('src/a.ts')).toBe('absent'); // failure cache still live
    await vi.advanceTimersByTimeAsync(2_000);
    failures = false;
    verifier.request('src/a.ts');
    await vi.advanceTimersByTimeAsync(0);
    expect(verifier.status('src/a.ts')).toBe('file');
  });

  it('caps concurrent listings at 4 and drains in order', async () => {
    const folders = Array.from({ length: 10 }, (_, i) => `d${i}`);
    const pending: string[] = [];
    const releases: (() => void)[] = [];
    const verifier = createFileReferenceVerifier(owner, {
      fetchFolder: (folder) => { pending.push(folder); return new Promise(resolve => releases.push(() => resolve(listing(['x.ts'])))); },
    });
    for (const folder of folders) verifier.request(`${folder}/x.ts`);
    await vi.advanceTimersByTimeAsync(0);
    expect(pending).toEqual(['d0', 'd1', 'd2', 'd3']);
    while (releases.length) releases.shift()!(), await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(pending).toEqual(folders);
  });

  it('aborts in-flight requests on dispose', async () => {
    const signals: AbortSignal[] = [];
    const verifier = createFileReferenceVerifier(owner, { fetchFolder: (_folder, signal) => { signals.push(signal); return new Promise(() => {}); } });
    verifier.request('a/x.ts');
    await vi.advanceTimersByTimeAsync(0);
    verifier.dispose();
    expect(signals[0].aborted).toBe(true);
  });
});
