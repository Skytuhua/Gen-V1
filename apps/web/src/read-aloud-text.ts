// Pure Markdown-to-speech projection for the read-aloud feature (#1392 T01).
// Uses the Markdown grammar as input, never mounted DOM text (hidden labels,
// copy actions and asynchronously revealed content must not be read). Malformed
// markup never throws; readable prose is retained, fenced code and comments are
// never read.

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const TABLE_DELIMITER = /^\s*\|?(?:\s*:?-{1,}:?\s*\|)+\s*:?-{0,}:?\s*\|?\s*$/;
const TABLE_CELLS = /^\s*\|.*\|\s*$/;

function stripTagsAndComments(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<!--[\s\S]*$/g, ' ')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    .replace(/<(?=\s|$)/g, ' ');
}

function inlineText(line: string): string {
  let text = line;
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  text = text.replace(/!\[[^\]]*\]\[[^\]]*\]/g, ' ');
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  text = text.replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1');
  text = text.replace(/<(https?|mailto):[^>\s]*>/g, ' ');
  text = text.replace(/\bhttps?:\/\/\S+/g, ' ');
  text = text.replace(/`([^`]*)`/g, '$1');
  text = text.replace(/`([^`]*)$/g, '$1');
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1');
  text = text.replace(/(\*[^*]+\*)/g, m => m.slice(1, -1)).replace(/(_[^_]+_)/g, m => m.slice(1, -1));
  text = text.replace(/~~([^~]+)~~/g, '$1');
  text = text.replace(/\*\*|~~|__|(\*)(?![\d])/g, '');
  text = text.replace(/\\([\\`*{}[\]()#+\-.!_>~|])/g, '$1');
  return text;
}

function blockLine(line: string): string {
  let text = line.replace(/^\s{0,3}#{1,6}\s+/, '');
  text = text.replace(/^\s{0,3}>\s?/, '');
  text = text.replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, '');
  text = text.replace(/^\s*(?:[-*+]|\d{1,9}[.)])\s+/, '');
  text = text.replace(/^\s{0,3}(?:-{3,}|_{3,}|\*{3,})\s*$/, ' ');
  return text;
}

function tableCells(line: string): string {
  const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => inlineText(cell).trim()).filter(Boolean);
  return cells.join(', ');
}

/** Project a Markdown reply to readable speech text. Empty output means the
 * reply has no speakable prose (code-only, markup-only) and cannot start. */
export function toSpeechText(markdown: string): string {
  const lines = stripTagsAndComments(markdown.replace(/\r\n?/g, '\n')).split('\n');
  const speech: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const fence = line.match(FENCE_OPEN);
    if (fence) {
      const character = fence[1][0], length = fence[1].length;
      const close = new RegExp(`^ {0,3}${character}{${length},}\\s*$`);
      index += 1;
      while (index < lines.length && !close.test(lines[index])) index += 1;
      if (index < lines.length) index += 1;
      continue;
    }
    if (TABLE_DELIMITER.test(line)) { index += 1; continue; }
    const spoken = TABLE_CELLS.test(line) ? tableCells(line) : inlineText(blockLine(line)).trim();
    if (spoken) speech.push(spoken);
    index += 1;
  }
  return speech.join('\n');
}

const SENTENCE_END = /(?<=[.!?…:;])\s+/;

function pushBounded(chunks: string[], text: string, cap: number): void {
  let rest = text;
  while (rest.length > cap) {
    let boundary = rest.lastIndexOf(' ', cap);
    if (boundary < Math.ceil(cap / 2)) {
      boundary = cap;
      const code = rest.charCodeAt(boundary - 1);
      if (code >= 0xd800 && code <= 0xdbff) boundary -= 1;
    }
    const head = rest.slice(0, boundary).trimEnd();
    if (head) chunks.push(head);
    rest = rest.slice(boundary).trimStart();
  }
  if (rest) chunks.push(rest);
}

/** Split speech text into utterance chunks of at most `maxUnits` UTF-16 code
 * units, breaking at paragraph, sentence then whitespace boundaries and never
 * splitting a surrogate pair. Content characters are never dropped. */
export function chunkSpeechText(text: string, maxUnits = 240): string[] {
  const chunks: string[] = [];
  for (const paragraph of text.split('\n')) {
    const segment = paragraph.trim();
    if (!segment) continue;
    if (segment.length <= maxUnits) { chunks.push(segment); continue; }
    let pending = '';
    for (const piece of segment.split(SENTENCE_END)) {
      const candidate = pending ? `${pending} ${piece}` : piece;
      if (candidate.length <= maxUnits) { pending = candidate; continue; }
      if (pending) { chunks.push(pending); pending = ''; }
      if (piece.length <= maxUnits) { pending = piece; continue; }
      pushBounded(chunks, piece, maxUnits);
    }
    if (pending) chunks.push(pending);
  }
  return chunks;
}
