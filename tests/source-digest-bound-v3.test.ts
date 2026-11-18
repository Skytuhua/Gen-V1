import {afterEach, describe, expect, it} from 'vitest';
import {chmodSync, closeSync, ftruncateSync, mkdtempSync, openSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sourceDigest, sourceDigestSync} from '../packages/core/project-verification.ts';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    try { chmodSync(join(root, 'oversized.bin'), 0o600); } catch { /* already gone or unreadable */ }
    rmSync(root, {recursive: true, force: true});
  }
});
function root() {
  const directory = mkdtempSync(join(tmpdir(), 'source-digest-bound-'));
  roots.push(directory);
  return directory;
}
// Sparse, so the bound is exercised without writing 64 MiB to disk.
function oversized(directory: string, bytes: number, mode?: number) {
  const path = join(directory, 'oversized.bin');
  const handle = openSync(path, 'w');
  try { ftruncateSync(handle, bytes); } finally { closeSync(handle); }
  if (mode !== undefined) chmodSync(path, mode);
  return path;
}

describe('source digest bounds', () => {
  it('refuses an oversized input from its declared size without reading it first', () => {
    // The file is both oversized and unreadable. Refusing on the declared size
    // reports RESOURCE_LIMIT; reading first would surface the open failure,
    // which is what makes this a bound rather than a post-read check.
    const directory = root(), path = oversized(directory, 64 * 1024 * 1024 + 1, 0o000);
    let error: unknown;
    try { sourceDigestSync(directory, ['oversized.bin']); } catch (caught) { error = caught; }
    chmodSync(path, 0o600);
    expect(error).toMatchObject({code: 'RESOURCE_LIMIT'});
  });

  it('still digests an ordinary file and rejects one that grew past the bound', async () => {
    const directory = root();
    writeFileSync(join(directory, 'small.txt'), 'bounded\n');
    expect(sourceDigestSync(directory, ['small.txt'])).toBe(await sourceDigest(directory, ['small.txt']));
    oversized(directory, 64 * 1024 * 1024 + 1, 0o600);
    expect(() => sourceDigestSync(directory, ['oversized.bin'])).toThrow(/size limit/i);
    await expect(sourceDigest(directory, ['oversized.bin'])).rejects.toMatchObject({code: 'RESOURCE_LIMIT'});
  });

  it('keeps the file-count bound before touching the filesystem', async () => {
    const directory = root(), files = Array.from({length: 2049}, (_, index) => `file-${index}.txt`);
    expect(() => sourceDigestSync(directory, files)).toThrow(/file limit/i);
    await expect(sourceDigest(directory, files)).rejects.toThrow(/file limit/i);
  });
});
