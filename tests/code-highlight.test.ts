import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { highlightable, parseFenceLanguage } from '../apps/web/src/code-language.ts';
import { loadParser, resolve as resolveLanguage, segments } from '../apps/web/src/code-highlight.ts';

describe('parseFenceLanguage', () => {
  it.each([
    ['ts', 'ts'],
    ['TypeScript title="a.ts"', 'typescript'],
    ['{.python}', 'python'],
    ['c++', 'c++'],
    ['c#', 'c#'],
    ['  json  ', 'json'],
  ])('parses %s -> %s', (info, expected) => {
    expect(parseFenceLanguage(info)).toBe(expected);
  });
  it.each([[''], ['<script>'], ['a'.repeat(33)], ['{not-a-tag!}']])('rejects %s', (info) => {
    expect(parseFenceLanguage(info)).toBeNull();
  });
});

describe('highlightable', () => {
  it('excludes plain-style tags', () => {
    for (const tag of ['text', 'txt', 'plain', 'plaintext', 'diff', 'patch']) expect(highlightable(tag, 'x')).toBe(false);
  });
  it('caps at 20,000 characters and 1,000 lines', () => {
    expect(highlightable('ts', 'x'.repeat(20_000))).toBe(true);
    expect(highlightable('ts', 'x'.repeat(20_001))).toBe(false);
    expect(highlightable('ts', 'x\n'.repeat(999))).toBe(true);
    expect(highlightable('ts', 'x\n'.repeat(1_000))).toBe(false);
  });
});

describe('resolve', () => {
  it.each([
    ['ts', 'TypeScript'],
    ['py', 'Python'],
    ['sh', 'Shell'],
    ['yml', 'YAML'],
    ['csharp', 'C#'],
    ['c', 'C'],
  ])('resolves %s -> %s', (tag, name) => {
    expect(resolveLanguage(tag)?.name).toBe(name);
  });
  it('returns null for an unknown tag without fuzzy matching', () => {
    expect(resolveLanguage('foo')).toBeNull();
    expect(resolveLanguage('tss')).toBeNull();
  });
});

describe('loadParser + segments', () => {
  async function highlight(tag: string, code: string) {
    const parser = await loadParser(tag);
    expect(parser).not.toBeNull();
    return segments(code, parser!);
  }
  it.each([
    ['ts', 'const x: number = 1;\n\n'],
    ['python', 'def f():\n    return "a"\n'],
    ['json', '{"a": [1, true, null]}\n'],
    ['css', 'a { color: red; }\n'],
    ['html', '<p class="x">hi</p>\n'],
    ['shell', 'echo "hi" && ls\n'],
  ])('segments of %s join back to the exact code', async (tag, code) => {
    const out = await highlight(tag, code);
    expect(out.map((s) => s.text).join('')).toBe(code);
  });
  it('highlights TypeScript keywords, strings and comments', async () => {
    const out = await highlight('ts', 'const x = "a"; // c\n');
    const found = (cls: string) => out.filter((s) => s.classes.includes(cls)).map((s) => s.text).join('');
    expect(found('tok-keyword')).toContain('const');
    expect(found('tok-string')).toContain('"a"');
    expect(found('tok-comment')).toContain('// c');
  });
  it('keeps a <script> string inside a text segment', async () => {
    const code = 'const markup = "<script>";\n';
    const out = await highlight('ts', code);
    expect(out.map((s) => s.text).join('')).toBe(code);
    expect(out.some((s) => s.classes.includes('tok-string') && s.text.includes('<script>'))).toBe(true);
  });
});

describe('syntax token contrast (WCAG AA against --subtle)', () => {
  const css = readFileSync(resolve('apps/web/src/markdown.css'), 'utf8');
  const styles = readFileSync(resolve('apps/web/src/styles.css'), 'utf8');
  function channel(hex: string) {
    const value = Number.parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((c) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
  }
  const luminance = (hex: string) => { const [r, g, b] = channel(hex); return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!; };
  const ratio = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  function subtleOf(theme: 'light' | 'dark') {
    const scope = theme === 'light' ? ':root' : ':root[data-theme="dark"]';
    const block = styles.slice(styles.indexOf(scope));
    const match = /--subtle:(#[0-9a-fA-F]{6})/.exec(block);
    if (!match) throw Error(`no --subtle for ${theme}`);
    return match[1]!;
  }
  function themeBlock(theme: 'light' | 'dark') {
    const root = theme === 'light' ? ':root {' : ':root[data-theme="dark"] {';
    const start = css.indexOf(root);
    const end = css.indexOf('}', start);
    return css.slice(start, end);
  }
  it.each(['light', 'dark'] as const)('every hex --syntax-* token meets 4.5:1 in %s', (theme) => {
    const subtle = subtleOf(theme);
    const tokens = [...themeBlock(theme).matchAll(/--syntax-[a-z]+:(#[0-9a-fA-F]{6})/g)].map((m) => m[1]!);
    expect(tokens.length).toBeGreaterThan(0);
    for (const token of tokens) expect(ratio(token, subtle), `${token} vs ${subtle}`).toBeGreaterThanOrEqual(4.5);
  });
});
