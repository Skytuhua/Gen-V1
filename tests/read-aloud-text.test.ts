import { describe, expect, it } from 'vitest';
import { chunkSpeechText, toSpeechText } from '../apps/web/src/read-aloud-text.ts';

const GOLDEN = [
  '## Summary',
  '',
  '- Use **Settings** and [Help](https://example.com/help) for the `workspace` panel.',
  '- Second item with _emphasis_ and ~~strike~~.',
  '',
  '```ts',
  'const secret = "never read";',
  '```',
  '',
  '| Name | Value |',
  '| ---- | ----- |',
  '| alpha | 42 |',
  '| beta | 7 |',
  '',
  '![diagram](https://example.com/diagram.png)',
  '<!-- internal note -->',
  '',
  'Visit https://example.com/raw or <https://example.com/auto> then stop.',
  '',
  '~~~',
  'unclosed tilde fence content',
  'still inside fence',
].join('\r\n');

describe('toSpeechText', () => {
  it('projects the golden fixture to prose without code, urls or markup', () => {
    const speech = toSpeechText(GOLDEN);
    expect(speech).toContain('Summary');
    expect(speech).toContain('Use Settings and Help for the workspace panel.');
    expect(speech).toContain('alpha, 42');
    expect(speech).toContain('beta, 7');
    expect(speech).toContain('then stop.');
    expect(speech).not.toMatch(/never read|unclosed tilde|still inside/);
    expect(speech).not.toMatch(/https?:\/\//);
    expect(speech).not.toMatch(/internal note/);
    expect(speech).not.toMatch(/[#*`_~[\]|!<>-]/);
    expect(speech).not.toContain('diagram');
  });
  it('handles CRLF, unterminated fences and code-only input', () => {
    expect(toSpeechText('```\nonly code\n')).toBe('');
    expect(toSpeechText('Only code `inline`')).toBe('Only code inline');
    expect(toSpeechText('<!-- only a comment -->')).toBe('');
    expect(toSpeechText('~~gone~~')).toBe('gone');
  });
  it('keeps punctuation, non-Latin and supplementary code points', () => {
    const speech = toSpeechText('Résumé: naïve façade — café. 。 Emoji \u{1F600} done!');
    expect(speech).toContain('Résumé: naïve façade — café.');
    expect(speech).toContain('。');
    expect(speech).toContain('\u{1F600}');
  });
  it('reads link labels, headings, lists and table cells in display order', () => {
    const speech = toSpeechText('# T\n\n1. [A](http://x) and `b`.\n\n| a | b |\n| - | - |\n| 1 | 2 |');
    expect(speech.split('\n')).toEqual(['T', 'A and b.', 'a, b', '1, 2']);
  });
  it('never throws on malformed markup and keeps readable prose', () => {
    expect(toSpeechText('a **bold without close\nnext | row | partial')).not.toContain('**');
    expect(toSpeechText('| a | b |\nnot a table row | stray')).toContain('a, b');
  });
});

describe('chunkSpeechText', () => {
  it('keeps paragraphs and sentences whole under the cap', () => {
    const chunks = chunkSpeechText('First sentence. Second sentence.\nNew paragraph here.', 60);
    expect(chunks.join(' ')).toContain('First sentence. Second sentence.');
    expect(chunks).toContain('New paragraph here.');
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(60);
  });
  it('bounds every chunk and drops no non-whitespace characters', () => {
    const text = Array.from({ length: 40 }, (_, i) => `Sentence ${i} ends.`).join(' ');
    const chunks = chunkSpeechText(text, 50);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(50);
    expect(chunks.join(' ').replace(/\s+/g, '')).toBe(text.replace(/\s+/g, ''));
  });
  it('splits long words at character boundaries without breaking surrogate pairs', () => {
    const emoji = '\u{1F600}';
    const chunks = chunkSpeechText('x'.repeat(500) + emoji + 'y'.repeat(300), 100);
    expect(chunks.join('')).toBe('x'.repeat(500) + emoji + 'y'.repeat(300));
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(100);
    expect(chunks.some(c => c.includes(emoji))).toBe(true);
  });
  it('chunks a long reply deterministically under the default cap', () => {
    const text = toSpeechText(GOLDEN) + ' ' + 'word '.repeat(400).trim();
    const chunks = chunkSpeechText(text);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(240);
    expect(chunks[0]).toContain('Summary');
    expect(chunks[chunks.length - 1]).toMatch(/word$/);
  });
});
