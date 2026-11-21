import { describe, expect, it } from 'vitest';
import { findTextReferences, parseCodeSpanReference, referenceFolder, referenceName } from '../apps/web/src/file-references';

const ref = (path: string, line: number | null = null, column: number | null = null) => ({ path, line, column });

describe('parseCodeSpanReference', () => {
  it.each([
    ['src/app.ts', ref('src/app.ts')],
    ['src/app.ts:42', ref('src/app.ts', 42)],
    ['./src/app.ts:42:7', ref('src/app.ts', 42, 7)],
    ['package.json', ref('package.json')],
    ['README.md', ref('README.md')],
    ['docs/a.md:1', ref('docs/a.md', 1)],
    ['a/b/c/file.txt:9999999:1', ref('a/b/c/file.txt', 9999999, 1)],
  ])('parses %s', (input, expected) => {
    expect(parseCodeSpanReference(input)).toEqual(expected);
  });

  it.each([
    '/etc/hosts', '~/x.ts', 'C:\\a\\b.ts', 'C:/a/b.ts', 'a\\b.ts', '../x.ts', 'src/../x.ts',
    '.git/config', 'src/.GIT/x', 'a//b.ts', 'src/app.ts:0', 'src/app.ts:042', 'https://x.dev/a.ts',
    'README', 'src/x.ts:10000000', 'with space/x.ts', 'src/app.ts:1:2:3', '',
    'src/app.ts:12a', './', './a/b.ts:0',
  ])('rejects %s', input => {
    expect(parseCodeSpanReference(input)).toBeNull();
  });
});

describe('findTextReferences', () => {
  it('finds plain references with and without lines', () => {
    expect(findTextReferences('edit src/app.ts next')).toEqual([{ start: 5, end: 15, ref: ref('src/app.ts') }]);
    expect(findTextReferences('see src/app.ts:42')).toEqual([{ start: 4, end: 17, ref: ref('src/app.ts', 42) }]);
    expect(findTextReferences('(see docs/a.md).')).toEqual([{ start: 5, end: 14, ref: ref('docs/a.md') }]);
    expect(findTextReferences('try ./pkg/mod.go:9:2,')).toEqual([{ start: 4, end: 20, ref: ref('pkg/mod.go', 9, 2) }]);
    expect(findTextReferences('open a/.eslintrc.json please')).toEqual([{ start: 5, end: 21, ref: ref('a/.eslintrc.json') }]);
  });

  it('drops trailing punctuation from candidates', () => {
    for (const end of ['.', ',', ';', ':', '!', '?']) {
      const found = findTextReferences(`see src/app.ts${end} done`);
      expect(found).toEqual([{ start: 4, end: 14, ref: ref('src/app.ts') }]);
    }
  });

  it.each([
    'edit /etc/hosts today', 'open ../x.ts', 'check .git/config now', 'foo:a/b.ts next', 'foo)a/b.ts now',
    'use https://x.dev/a.ts instead', 'and/or', 'client/server', 'app.ts alone',
    'README without dot or slash', 'src/app.ts:0 later', 'src/app.ts:042 later',
    'the a\\b.ts path', 'src/file nope.ts today',
  ])('stays plain for %s', text => {
    expect(findTextReferences(text)).toEqual([]);
  });

  it('respects the per-message candidate limit', () => {
    const text = Array.from({ length: 80 }, (_, i) => `dir/f${i}.ts`).join(' ');
    expect(findTextReferences(text)).toHaveLength(64);
    expect(findTextReferences(text, 3)).toHaveLength(3);
  });

  it('handles many matches without quadratic cost', () => {
    const text = 'a/'.repeat(50_000);
    const started = performance.now();
    findTextReferences(text);
    expect(performance.now() - started).toBeLessThan(50);
  });
});

describe('referenceFolder/referenceName', () => {
  it('splits at the last slash', () => {
    expect(referenceFolder('a/b/c.ts')).toBe('a/b');
    expect(referenceName('a/b/c.ts')).toBe('c.ts');
    expect(referenceFolder('file.ts')).toBe('');
    expect(referenceName('file.ts')).toBe('file.ts');
  });
});
