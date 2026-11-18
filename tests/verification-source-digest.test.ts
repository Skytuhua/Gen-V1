import {afterEach, expect, it} from 'vitest';
import {closeSync, ftruncateSync, mkdtempSync, openSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {sourceDigest, sourceDigestSync} from '../packages/core/project-verification';

const roots: string[] = [];
afterEach(() => {for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});});
function fixture() {const root = mkdtempSync(join(tmpdir(), 'verification-digest-')); roots.push(root); return root;}
function sparse(root: string, path: string, bytes: number) {
  const fd = openSync(join(root, path), 'w');
  try {ftruncateSync(fd, bytes);} finally {closeSync(fd);}
}

it.each(['sync', 'async'] as const)('bounds total %s digest input even when every file fits its individual limit', async mode => {
  const root = fixture(), files = ['a.ts', 'b.ts', 'c.ts'];
  for (const file of files) sparse(root, file, 48 * 1024 * 1024);
  if (mode === 'sync') expect(() => sourceDigestSync(root, files)).toThrowError(expect.objectContaining({code: 'RESOURCE_LIMIT'}));
  else await expect(sourceDigest(root, files)).rejects.toMatchObject({code: 'RESOURCE_LIMIT'});
});

it.each(['sync', 'async'] as const)('rejects an oversized %s file', async mode => {
  const root = fixture(); sparse(root, 'large.ts', 64 * 1024 * 1024 + 1);
  if (mode === 'sync') expect(() => sourceDigestSync(root, ['large.ts'])).toThrowError(expect.objectContaining({code: 'RESOURCE_LIMIT'}));
  else await expect(sourceDigest(root, ['large.ts'])).rejects.toMatchObject({code: 'RESOURCE_LIMIT'});
});

it('keeps byte-exact async/sync digests, stable ordering and empty-file semantics', async () => {
  const root = fixture();
  writeFileSync(join(root, 'small.ts'), 'export const message = "é∑";\n');
  sparse(root, 'chunks.ts', 3 * 64 * 1024 + 17);
  writeFileSync(join(root, 'empty.ts'), '');
  const files = ['small.ts', 'chunks.ts', 'empty.ts'];
  const original = sourceDigestSync(root, files);
  expect(await sourceDigest(root, files.slice().reverse())).toBe(original);
  expect(sourceDigestSync(root, files.slice().reverse())).toBe(original);
  writeFileSync(join(root, 'chunks.ts'), 'A changed source must invalidate the digest.');
  expect(sourceDigestSync(root, files)).not.toBe(original);
  expect(await sourceDigest(root, files)).toBe(sourceDigestSync(root, files));
});
