/**
 * Pure Markdown-to-speech projection for the read-aloud feature (#1392).
 * Mirrors the block grammar of Markdown.tsx; never reads the mounted DOM.
 */

const heading = (line: string) => /^ {0,3}(#{1,6})[ \t]+(.*)$/.exec(line);
const fence = (line: string) => /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
const listMarker = (line: string) => /^([ \t]*)([-+*]|\d{1,9}[.)])[ \t]+(.*)$/.exec(line);

function tableCells(line: string): string[] | null {
  const source = line.trim(), cells: string[] = [];
  let value = '', ticks = 0, pipes = 0;
  for (let index = 0; index < source.length; index++) {
    const character = source[index]!;
    if (character === '\\' && source[index + 1] === '|' && !ticks) { value += '|'; index++; continue; }
    if (character === '\\' && source[index + 1] === '\\' && !ticks) { value += '\\'; index++; continue; }
    if (character === '`') {
      let end = index + 1; while (source[end] === '`') end++;
      const count = end - index;
      if (!ticks) ticks = count; else if (ticks === count) ticks = 0;
      value += source.slice(index, end); index = end - 1; continue;
    }
    if (character === '|' && !ticks) { cells.push(value.trim()); value = ''; pipes++; } else value += character;
  }
  cells.push(value.trim());
  if (source.startsWith('|')) cells.shift();
  if (source.endsWith('|') && cells.at(-1) === '') cells.pop();
  return pipes ? cells : null;
}

function tableStart(lines: string[], index: number) {
  if (!lines[index]?.includes('|') || !lines[index + 1]?.includes('-')) return null;
  const header = tableCells(lines[index]!), separator = tableCells(lines[index + 1]!);
  if (!header || !separator || !header.length || header.length !== separator.length
    || !separator.every(cell => /^:?-{3,}:?$/.test(cell))) return null;
  return header;
}

/** Strip inline markup to speakable prose: keep code words, link labels, emphasis text. */
function inline(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\((?:https?:\/\/[^\s)]+|#[^\s)]+|[^)\s]*)\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[\s(])__([^_]+)__/g, '$1$2')
    .replace(/(^|[\s*_])_([^_]+)_/g, '$1$2')
    .replace(/(^|[\s*])\*([^*]+)\*/g, '$1$2')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/<[^>\n]*>/g, ' ')
    .replace(/(?<!\w)https?:\/\/\S+/g, ' ')
    .replace(/\[\^[^\]]+\]/g, ' ');
}

/** Project a Markdown reply to speakable prose; returns '' when nothing readable remains. */
export function toSpeechText(markdown: string): string {
  const lines = markdown.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  const paragraphs: string[] = [];
  let index = 0, pending: string[] = [];
  const flush = () => {
    const text = pending.join(' ').replace(/[ \t]+/g, ' ').trim();
    if (text) paragraphs.push(text);
    pending = [];
  };
  while (index < lines.length) {
    const line = lines[index]!;
    if (!line.trim()) { flush(); index++; continue; }
    const opening = fence(line);
    if (opening) {
      flush();
      const character = opening[1]![0]!, minimum = opening[1]!.length;
      index++;
      while (index < lines.length && !new RegExp(`^ {0,3}${character}{${minimum},}[ \\t]*$`).test(lines[index]!)) index++;
      if (index < lines.length) index++;
      continue;
    }
    const title = heading(line);
    if (title) { flush(); pending.push(inline(title[2]!)); flush(); index++; continue; }
    const header = tableStart(lines, index);
    if (header) {
      flush(); index += 2;
      for (const cell of header) { const value = inline(cell).trim(); if (value) pending.push(value); }
      while (index < lines.length && lines[index]!.trim()) {
        const row = tableCells(lines[index]!);
        if (!row || row.length > header.length) break;
        for (const cell of row) { const value = inline(cell).trim(); if (value) pending.push(value); }
        index++;
      }
      flush();
      continue;
    }
    const item = listMarker(line);
    if (item) {
      flush();
      const indent = item[1]!.replaceAll('\t', '    ').length;
      if (indent < 4) { pending.push(inline(item[3]!)); index++; continue; }
    }
    const text = inline(line).trim();
    if (text) pending.push(text);
    index++;
  }
  flush();
  return paragraphs.filter(Boolean).join('\n\n');
}

const CHUNK_LIMIT = 240;

/** Split speakable text into utterances of at most 240 UTF-16 code units each. */
export function chunkSpeechText(text: string): string[] {
  const chunks: string[] = [];
  const push = (value: string) => {
    for (const part of value.split(/(?<=[.!?…。！？:;])\s+|(?<=\n)/)) {
      let piece = part.trim();
      while (piece.length > CHUNK_LIMIT) {
        let cut = piece.lastIndexOf(' ', CHUNK_LIMIT);
        if (cut <= 0) {
          // No whitespace: break at a Unicode character boundary, never inside a surrogate pair.
          cut = CHUNK_LIMIT;
          const code = piece.charCodeAt(cut - 1);
          if (code >= 0xd800 && code <= 0xdbff) cut--;
        }
        chunks.push(piece.slice(0, cut));
        piece = piece.slice(cut).trim();
      }
      if (piece) chunks.push(piece);
    }
  };
  for (const paragraph of text.split(/\n\n+/)) push(paragraph);
  return chunks;
}

const eligibilityCache = new Map<string, boolean>();
/** Cached early-exit check for whether a reply has any speakable prose. */
export function hasSpeechText(markdown: string): boolean {
  const cached = eligibilityCache.get(markdown);
  if (cached !== undefined) return cached;
  const value = Boolean(toSpeechText(markdown));
  eligibilityCache.set(markdown, value);
  if (eligibilityCache.size > 500) eligibilityCache.delete(eligibilityCache.keys().next().value!);
  return value;
}
