import { describe, expect, it } from 'vitest';
import {
  REPO_MAP_PARSER,
  buildRepoMap,
  rankRepoMap,
  repoMapLanguageSupported,
  repoMapPathAllowed,
  repoMapPrivateSegment,
} from '../packages/workspace/repo-map.ts';

describe('repoMapPrivateSegment', () => {
  it('rejects credential-like and tool-private segments case-insensitively', () => {
    for (const part of ['.git', 'NODE_MODULES', '.env', '.env.local', 'tls.pem', 'server.key', 'cert.pfx', 'bundle.p12', '.harness', '.harness-data', '.claude', '.codex', '.pi', '.hermes', 'secret', 'secrets', 'credential', 'credentials']) {
      expect(repoMapPrivateSegment(part), part).toBe(true);
    }
  });
  it('keeps ordinary and merely prefixed segments admissible', () => {
    for (const part of ['src', '.github', 'mysecrets', 'credentials.json', 'env', '.envrc', 'keys', 'index.ts']) {
      expect(repoMapPrivateSegment(part), part).toBe(false);
    }
  });
});

describe('repoMapLanguageSupported', () => {
  it('accepts JavaScript and TypeScript extensions case-insensitively only', () => {
    for (const path of ['a.ts', 'a.tsx', 'a.js', 'a.jsx', 'a.mts', 'a.cts', 'a.mjs', 'a.cjs', 'A.TS', 'dir/decl.d.ts']) {
      expect(repoMapLanguageSupported(path), path).toBe(true);
    }
    for (const path of ['a.json', 'a.md', 'a.css', 'a.py', 'ats', 'a.ts.bak']) {
      expect(repoMapLanguageSupported(path), path).toBe(false);
    }
  });
});

describe('repoMapPathAllowed', () => {
  it('accepts ordinary relative paths and rejects traversal, separators, roots and oversized paths', () => {
    expect(repoMapPathAllowed('src/index.ts')).toBe(true);
    expect(repoMapPathAllowed('a')).toBe(true);
    for (const path of ['', '/abs/path.ts', 'a//b.ts', './a.ts', 'a/./b.ts', 'a/../b.ts', '..', 'a/b/', 'C:\\x.ts', 'C:/x.ts']) {
      expect(repoMapPathAllowed(path), JSON.stringify(path)).toBe(false);
    }
    expect(repoMapPathAllowed('a\0b.ts')).toBe(false);
    expect(repoMapPathAllowed('a:b.ts')).toBe(false);
    expect(repoMapPathAllowed('dir/node_modules/pkg.ts')).toBe(false);
    expect(repoMapPathAllowed('dir/.env.local')).toBe(false);
    expect(repoMapPathAllowed('x'.repeat(1024))).toBe(true);
    expect(repoMapPathAllowed('x'.repeat(1025))).toBe(false);
  });
});

describe('buildRepoMap', () => {
  const read = (files: Record<string, string>) => (path: string) => {
    if (!(path in files)) throw new Error('unadmitted read: ' + path);
    return files[path];
  };

  it('sorts and deduplicates granted paths and never reads disallowed or unsupported files', () => {
    const files = { 'b.ts': 'export const b = 1;', 'a.ts': 'export const a = 1;', 'notes.md': 'not parsed' };
    const seen: string[] = [];
    const map = buildRepoMap(['b.ts', 'a.ts', 'b.ts', 'evil/../x.ts', 'notes.md'], (path) => { seen.push(path); return read(files)(path); });
    expect(map.files.map((file) => file.path)).toEqual(['a.ts', 'b.ts', 'notes.md']);
    expect(map.files[2].mode).toBe('FILE_LIST_ONLY');
    expect(seen).toEqual(['a.ts', 'b.ts']);
    expect(map.omittedFiles).toBe(0);
  });

  it('caps the map at 128 files and reports the remainder as omitted', () => {
    const files = Object.fromEntries(Array.from({ length: 130 }, (_, index) => [`f${String(index).padStart(3, '0')}.ts`, 'export const x = 0;']));
    const map = buildRepoMap(Object.keys(files), read(files));
    expect(map.files).toHaveLength(128);
    expect(map.omittedFiles).toBe(2);
    expect(map.files.every((file) => file.mode === 'PARSED')).toBe(true);
  });

  it('lists sources over 256 KiB and sources with parse errors without parsing them', () => {
    const big = 'export const x = ' + '1'.repeat(256 * 1024) + ';';
    const files = { 'big.ts': big, 'broken.ts': 'export const = ;', 'ok.ts': 'export const ok = 1;' };
    const map = buildRepoMap(Object.keys(files), read(files));
    expect(map.files.map((file) => [file.path, file.mode])).toEqual([['big.ts', 'FILE_LIST_ONLY'], ['broken.ts', 'FILE_LIST_ONLY'], ['ok.ts', 'PARSED']]);
    expect(Buffer.byteLength(big)).toBeGreaterThan(256 * 1024);
  });

  it('records runtime, type-only, re-export and import-type edges, but not dynamic import calls or require', () => {
    const source = [
      "import value from './runtime';",
      "import type { T } from './types';",
      "export { other } from './reexport';",
      "import eq = require('./legacy');",
      "type Ref = import('./nested').Inner;",
      "const lazy = await import('./lazy');",
      "const req = require('./cjs');",
      'export const done = true;',
    ].join('\n');
    const map = buildRepoMap(['m.ts'], read({ 'm.ts': source }));
    expect(map.files[0].imports).toEqual(['./legacy', './nested', './reexport', './runtime', './types']);
  });

  it('records exported declarations with one-based lines across forms', () => {
    const source = [
      'const helper = 1;',
      'export const named = 1, { destructured } = { destructured: 2 }, [first] = [1];',
      'export function fn() {}',
      'export class K {}',
      'export interface I { x: number }',
      'export type Alias = string;',
      'export enum E { A }',
      'export namespace N { export const inner = 1; }',
      'export { helper as renamed };',
      'export default helper;',
    ].join('\n');
    const map = buildRepoMap(['m.ts'], read({ 'm.ts': source }));
    expect(map.files[0].mode).toBe('PARSED');
    expect(map.files[0].exports).toEqual([
      { name: 'Alias', line: 6 },
      { name: 'E', line: 7 },
      { name: 'I', line: 5 },
      { name: 'K', line: 4 },
      { name: 'N', line: 8 },
      { name: 'default', line: 10 },
      { name: 'destructured', line: 2 },
      { name: 'first', line: 2 },
      { name: 'fn', line: 3 },
      { name: 'named', line: 2 },
      { name: 'renamed', line: 9 },
    ]);
  });

  it('distinguishes export-equals from default exports and records namespace exports', () => {
    const eq = buildRepoMap(['m.ts'], read({ 'm.ts': 'const value = 1;\nexport = value;' }));
    expect(eq.files[0].exports).toEqual([{ name: 'export=', line: 2 }]);
    const ns = buildRepoMap(['m.ts'], read({ 'm.ts': "export * as all from './x';" }));
    expect(ns.files[0].exports).toEqual([{ name: 'all', line: 1 }]);
    expect(ns.files[0].imports).toEqual(['./x']);
  });
});

describe('rankRepoMap', () => {
  const file = (path: string, exports_: string[] = []) => ({ path, mode: 'PARSED' as const, imports: ['./dep'], exports: exports_.map((name, index) => ({ name, line: index + 1 })) });

  it('orders requested paths first, then referenced-symbol count, then path and first symbol', () => {
    const map = { files: [file('b.ts', ['shared']), file('a.ts', ['shared', 'extra']), file('z.ts'), file('c.ts', ['shared', 'extra'])] };
    const ranked = rankRepoMap(map, { paths: ['z.ts'], symbols: ['shared', 'extra'] });
    expect(ranked.files.map((entry) => entry.path)).toEqual(['z.ts', 'a.ts', 'c.ts', 'b.ts']);
    expect(ranked.files[0].requestedPath).toBe(true);
    expect(ranked.files[1].matchedSymbols).toEqual(['extra', 'shared']);
  });

  it('ignores disallowed request paths and empty symbols without mutating the map', () => {
    const original = file('a.ts', ['keep']);
    const map = { files: [original] };
    const ranked = rankRepoMap(map, { paths: ['../evil', 'a.ts'], symbols: ['', 'keep', 'keep'] });
    expect(ranked.files[0].requestedPath).toBe(true);
    expect(ranked.files[0].referencedSymbols).toBe(1);
    ranked.files[0].exports.push({ name: 'injected', line: 99 });
    expect(original.exports).toHaveLength(1);
    expect(map.files[0].exports).toHaveLength(1);
  });

  it('handles an empty request deterministically', () => {
    const map = { files: [file('b.ts'), file('a.ts')] };
    expect(rankRepoMap(map, {}).files.map((entry) => entry.path)).toEqual(['a.ts', 'b.ts']);
  });
});

describe('REPO_MAP_PARSER', () => {
  it('pins the parser implementation and version', () => {
    expect(REPO_MAP_PARSER).toMatch(/^typescript@\d+\.\d+\.\d+/);
  });
});
