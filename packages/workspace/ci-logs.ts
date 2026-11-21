import { CI_FAILURE_LIMITS } from '../contracts/ci-failures.ts';

export interface FailureExcerpt {
  excerpt: string;
  lines: number;
  truncated: boolean;
}

interface CleanLine {
  text: string;
  error: boolean;
  group: number;
}

// GitHub writes `2026-11-21T08:00:00.0000000Z <content>`; a UTF-8 BOM may lead the first line.
const TIMESTAMP = /^\uFEFF?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?/;
// CSI: ESC '[' + parameter bytes [0-9;?]* + intermediate bytes [ -/]* + final byte [@-~].
const ANSI = /\u001B\[[0-9;?]*[ -/]*[@-~]/g;

/** Azure blob storage error bodies answer expired job-log URLs. */
export function isBlobMissing(raw: string): boolean {
  return raw.includes('<Code>BlobNotFound</Code>');
}

/** Extract the failure window from a GitHub Actions job log (R04). Strips the
 * per-line ISO timestamp, ANSI escapes and group markers — group titles stay as
 * `▸ <title>` — keeps every `##[error]` line (the last
 * `CI_FAILURE_LIMITS.maxErrorLines` when a log has more) plus up to
 * `excerptLines` before the last error inside its group and `afterLines`
 * after it; a log without an error line yields its last `excerptLines` lines.
 * The result never exceeds `excerptBytes` — earlier lines are dropped first. */
export function extractFailureExcerpt(raw: string): FailureExcerpt {
  if (!raw.length) return { excerpt: '', lines: 0, truncated: false };
  const cleaned: CleanLine[] = [];
  const rawLines = raw.split(/\r?\n/);
  if (rawLines[rawLines.length - 1] === '') rawLines.pop(); // trailing newline is not a log line
  let group = -1;
  for (const line of rawLines) {
    const text = line.replace(TIMESTAMP, '').replace(ANSI, '');
    if (text.startsWith('##[endgroup]')) continue;
    if (text.startsWith('##[group]')) { group += 1; cleaned.push({ text: `▸ ${text.slice('##[group]'.length)}`, error: false, group }); continue; }
    cleaned.push({ text: text.startsWith('##[error]') ? text.slice('##[error]'.length) : text, error: text.startsWith('##[error]'), group: Math.max(group, 0) });
  }
  const errors = cleaned.flatMap((line, index) => line.error ? [index] : []);
  const keptErrors = errors.slice(-CI_FAILURE_LIMITS.maxErrorLines);
  let start: number, end: number;
  if (errors.length) {
    const last = errors[errors.length - 1];
    const groupStart = cleaned.findIndex(line => line.group === cleaned[last].group);
    start = Math.max(0, last - CI_FAILURE_LIMITS.excerptLines, groupStart);
    end = Math.min(cleaned.length - 1, last + CI_FAILURE_LIMITS.afterLines);
  } else {
    start = Math.max(0, cleaned.length - CI_FAILURE_LIMITS.excerptLines);
    end = cleaned.length - 1;
  }
  const keep = new Set(keptErrors);
  for (let index = start; index <= end; index++) keep.add(index);
  let picked = [...keep].sort((a, b) => a - b);
  const joined = () => picked.map(index => cleaned[index].text).join('\n');
  while (picked.length > 1 && Buffer.byteLength(joined(), 'utf8') > CI_FAILURE_LIMITS.excerptBytes) picked = picked.slice(1);
  const omitted = cleaned.length - picked.length;
  return { excerpt: joined(), lines: picked.length, truncated: omitted > 0 };
}
