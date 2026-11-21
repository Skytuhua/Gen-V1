export interface FileReference { path: string; line: number | null; column: number | null }

const encoder = new TextEncoder();
// PATH(:LINE(:COLUMN)?) — 1-based, no leading zeros, LINE/COLUMN <= 9,999,999.
const LINE_SUFFIX = /:([1-9]\d{0,6})(?::([1-9]\d{0,6}))?$/;
// A candidate in prose: an allowed prefix, then >=2 slash-separated segments and an optional :line:col.
const PLAIN_CANDIDATE = /(?:^|[\s([{'"])(\.?\/?[^\s'"()\\]+(?:\/[^\s'"()\\]+)+(?::\d{1,7}(?::\d{1,7})?)?)/g;
const TRAILING_PUNCT = /[.,;:!?)\]'"]+$/;
const HAS_EXTENSION = /\.[A-Za-z0-9]{1,12}$/;
const DOTFILE = /^\.[^/]+$/;

export function referenceFolder(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}
export function referenceName(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? path : path.slice(index + 1);
}

/** Mirrors the server-side pathName/gitSegment guards: nothing the server would refuse is ever requested. */
function validReferencePath(raw: string): string | null {
  let path = raw;
  if (path.startsWith('./')) path = path.slice(2);
  if (!path || path.length > 1024 || encoder.encode(path).length > 1024) return null;
  if (path.startsWith('/') || path.startsWith('~') || path.includes('\\') || path.includes('://')) return null;
  if (/^[A-Za-z]:/.test(path)) return null;
  if (/[\u0000-\u001f\u007f\u2028\u2029\s]/.test(path)) return null;
  const segments = path.split('/');
  for (const segment of segments) if (!segment || segment === '.' || segment === '..' || segment.toLowerCase() === '.git') return null;
  return path;
}

function parseReference(raw: string): FileReference | null {
  const suffix = LINE_SUFFIX.exec(raw);
  const body = suffix ? raw.slice(0, suffix.index) : raw;
  const line = suffix ? Number(suffix[1]) : null;
  const column = suffix?.[2] ? Number(suffix[2]) : null;
  if (body.includes(':')) return null;
  const path = validReferencePath(body);
  return path === null ? null : { path, line, column };
}

/** Whole-string parse for code-span content: a single segment needs a '.', multi-segment paths are always candidates. */
export function parseCodeSpanReference(text: string): FileReference | null {
  const ref = parseReference(text);
  if (!ref) return null;
  if (!ref.path.includes('/') && !ref.path.includes('.')) return null;
  return ref;
}

/** Plain-prose references: at least one '/', last segment carries an extension or is a dotfile. */
export function findTextReferences(text: string, limit = 64): Array<{ start: number; end: number; ref: FileReference }> {
  const found: Array<{ start: number; end: number; ref: FileReference }> = [];
  PLAIN_CANDIDATE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while (found.length < limit && (match = PLAIN_CANDIDATE.exec(text))) {
    let candidate = match[1];
    const start = match.index + (match[0].length - candidate.length);
    let end = start + candidate.length;
    candidate = candidate.replace(TRAILING_PUNCT, '');
    end = start + candidate.length;
    const ref = parseReference(candidate);
    if (!ref || !ref.path.includes('/')) continue;
    const last = referenceName(ref.path);
    if (!HAS_EXTENSION.test(last) && !DOTFILE.test(last)) continue;
    found.push({ start, end, ref });
  }
  return found;
}
