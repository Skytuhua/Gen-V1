import { describe, expect, it } from 'vitest';
import { chunkSpeechText, toSpeechText } from '../apps/web/src/read-aloud-text.ts';

describe('toSpeechText', () => {
  it('reads headings, lists and link labels without URLs or syntax', () => {
    const text = toSpeechText(
      '## Summary\n\n- Use **Settings** and [Help](https://example.com/docs)\n- Second `option` item\n'
    );
    expect(text).toBe('Summary\n\nUse Settings and Help\n\nSecond option item');
  });

  it('skips backtick and tilde fences, including unclosed fences', () => {
    expect(toSpeechText('Before\n\n```ts\nconst secret = 1;\n```\n\nAfter')).toBe('Before\n\nAfter');
    expect(toSpeechText('Before\n\n~~~~\ncode\n~~~~\n\nAfter')).toBe('Before\n\nAfter');
    expect(toSpeechText('Before\n\n```\nunclosed code\nmore code')).toBe('Before');
    expect(toSpeechText('Before\n\n````\ncode\n```\nstill code\n````\n\nAfter')).toBe('Before\n\nAfter');
  });

  it('drops images, comments, tags and bare URLs', () => {
    const text = toSpeechText('Look ![alt](https://x/img.png) here <!-- hidden --> now <br> visit https://example.com/path end');
    expect(text).not.toContain('http');
    expect(text).not.toContain('hidden');
    expect(text).not.toContain('<br>');
    expect(text).toContain('Look');
    expect(text).toContain('here');
    expect(text).toContain('end');
  });

  it('reads table cells in display order without delimiter lines', () => {
    const text = toSpeechText('| Name | Value |\n| --- | --- |\n| alpha | 1 |\n| beta | 2 |');
    expect(text).toBe('Name Value alpha 1 beta 2');
  });

  it('keeps readable prose from malformed tables', () => {
    const text = toSpeechText('| A | B |\n| not a separator | x |\nprose after');
    expect(text).toContain('prose after');
    expect(text).toContain('A');
  });

  it('returns empty for code-only or markup-only input and never throws on malformed markup', () => {
    expect(toSpeechText('```js\nonly code\n```')).toBe('');
    expect(toSpeechText('![only image](https://x/i.png)\n<!-- only comment -->')).toBe('');
    expect(toSpeechText('| broken\n| - |')).not.toThrow;
    expect(() => toSpeechText('**unclosed `tick [link](http://x')).not.toThrow();
  });

  it('normalizes CRLF and preserves non-Latin and supplementary code points', () => {
    const text = toSpeechText('First line\r\n\r\nテキスト\r\nEmoji 😀 done');
    expect(text).toContain('テキスト');
    expect(text).toContain('😀');
    expect(text.split('\n\n')).toHaveLength(2);
  });

  it('keeps punctuation that carries natural pauses', () => {
    expect(toSpeechText('Hello, world. Wait — really?')).toBe('Hello, world. Wait — really?');
  });
});

describe('chunkSpeechText', () => {
  it('keeps short text in one chunk', () => {
    expect(chunkSpeechText('Short reply.')).toEqual(['Short reply.']);
  });

  it('splits on paragraph boundaries first and caps each chunk at 240 UTF-16 units', () => {
    const a = 'a'.repeat(200), b = 'b'.repeat(200);
    const chunks = chunkSpeechText(`${a}\n\n${b}`);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(240);
    expect(chunks.join(' ').replace(/\s+/g, '')).toBe(a + b);
  });

  it('splits long sentences at whitespace and never drops characters', () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    const chunks = chunkSpeechText(words);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join(' ')).toBe(words);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(240);
  });

  it('breaks long words at a character boundary without splitting surrogate pairs', () => {
    const long = '😀'.repeat(200); // 400 UTF-16 units
    const chunks = chunkSpeechText(long);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(240);
      // Array.from iterates code points: a split surrogate reads as a lone surrogate.
      expect(Array.from(chunk).every(point => point === '😀')).toBe(true);
    }
    expect(chunks.join('')).toBe(long);
  });

  it('preserves order across a long reply', () => {
    const sentences = Array.from({ length: 40 }, (_, i) => `Sentence ${i} is here.`).join(' ');
    const chunks = chunkSpeechText(sentences);
    expect(chunks.join(' ')).toBe(sentences);
  });
});
