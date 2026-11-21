import type { ReviewCommentAnchor } from '../../../packages/contracts/review-comments.ts';

export interface ParsedDiffLine { kind: 'context' | 'add' | 'del' | 'meta'; oldLine: number | null; newLine: number | null; text: string }
export interface ParsedHunk { header: string; oldStart: number; oldCount: number; newStart: number; newCount: number; lines: ParsedDiffLine[] }
export interface ParsedFile { path: string; oldPath: string | null; added: boolean; deleted: boolean; binary: boolean; hunks: ParsedHunk[] }

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;
const strip = (value: string): string => value.replace(/^[ab]\//, '');

/** Parses `git diff` / `git diff --staged` text into files, hunks and numbered
 * lines. Malformed sections are skipped rather than throwing so a partially
 * fetched diff still renders. */
export function parseUnifiedDiff(text: string): ParsedFile[] {
  const files: ParsedFile[] = [];
  let file: ParsedFile | null = null;
  let hunk: ParsedHunk | null = null;
  let oldLine = 0, newLine = 0;
  const nextFile = (): ParsedFile => { const created: ParsedFile = { path: '', oldPath: null, added: false, deleted: false, binary: false, hunks: [] }; files.push(created); return created; };
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const match = /^diff --git a\/(\S+) b\/(\S+)$/.exec(line);
      file = nextFile(); hunk = null;
      if (match) file.path = match[2];
      continue;
    }
    if (!file) continue;
    if (line.startsWith('rename from ')) { file.oldPath = line.slice('rename from '.length); continue; }
    if (line.startsWith('rename to ')) { file.path = line.slice('rename to '.length); continue; }
    if (line.startsWith('new file mode') || line.startsWith('deleted file mode')) {
      if (line.startsWith('new file mode')) file.added = true; else file.deleted = true;
      continue;
    }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) { file.binary = true; continue; }
    if (line.startsWith('--- ')) {
      const value = line.slice(4).trim();
      if (value !== '/dev/null') file.oldPath = strip(value);
      continue;
    }
    if (line.startsWith('+++ ')) {
      const value = line.slice(4).trim();
      if (value !== '/dev/null') file.path = strip(value);
      continue;
    }
    const header = HUNK.exec(line);
    if (header) {
      hunk = { header: line, oldStart: Number(header[1]), oldCount: Number(header[2] ?? '1'), newStart: Number(header[3]), newCount: Number(header[4] ?? '1'), lines: [] };
      file.hunks.push(hunk); oldLine = hunk.oldStart; newLine = hunk.newStart;
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith('\\')) { hunk.lines.push({ kind: 'meta', oldLine: null, newLine: null, text: line }); continue; }
    const marker = line[0], body = line.slice(1);
    if (marker === ' ') hunk.lines.push({ kind: 'context', oldLine: oldLine++, newLine: newLine++, text: body });
    else if (marker === '+') hunk.lines.push({ kind: 'add', oldLine: null, newLine: newLine++, text: body });
    else if (marker === '-') hunk.lines.push({ kind: 'del', oldLine: oldLine++, newLine: null, text: body });
  }
  return files.filter(f => f.path || f.oldPath);
}

/** Lines a comment may anchor to on one side of the file. */
export function commentableLines(file: ParsedFile, side: 'new' | 'old'): { line: number; hunkHeader: string; text: string }[] {
  const rows: { line: number; hunkHeader: string; text: string }[] = [];
  for (const hunk of file.hunks)
    for (const row of hunk.lines)
      if (row.kind === 'context' || (side === 'new' ? row.kind === 'add' : row.kind === 'del'))
        rows.push({ line: side === 'new' ? row.newLine! : row.oldLine!, hunkHeader: hunk.header, text: row.text });
  return rows;
}

export interface RelocatedAnchor { startLine: number; endLine: number; hunkHeader: string }

/** Re-anchors a comment in a newer revision of the diff by matching its stored
 * excerpt against the file's commentable lines. Exactly-zero matches mean the
 * anchor is gone (the caller marks the comment outdated); multiple matches
 * pick the position nearest the recorded start line. */
export function relocateAnchor(anchor: ReviewCommentAnchor, files: ParsedFile[]): RelocatedAnchor | null {
  const wanted = anchor.side === 'new' ? anchor.path : anchor.path;
  const file = files.find(f => (anchor.side === 'new' ? f.path : f.oldPath ?? f.path) === wanted);
  if (!file) return null;
  const rows = commentableLines(file, anchor.side);
  const width = anchor.endLine - anchor.startLine + 1;
  const excerpt = anchor.excerpt.split('\n').slice(0, width);
  const matches: RelocatedAnchor[] = [];
  for (let i = 0; i + excerpt.length <= rows.length; i++) {
    if (!excerpt.every((text, offset) => rows[i + offset].text === text)) continue;
    matches.push({ startLine: rows[i].line, endLine: rows[i + Math.min(width, excerpt.length) - 1].line, hunkHeader: rows[i].hunkHeader });
  }
  if (!matches.length) return null;
  matches.sort((a, b) => Math.abs(a.startLine - anchor.startLine) - Math.abs(b.startLine - anchor.startLine));
  return matches[0];
}
