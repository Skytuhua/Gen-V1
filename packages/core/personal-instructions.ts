import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HarnessError } from '../contracts/index.ts';
import { PERSONAL_INSTRUCTIONS_MAX_BYTES, type PersonalInstructionsExclusion, type PersonalInstructionsView } from '../contracts/personal-instructions.ts';
import { unsupportedDirective } from './approved-project-context.ts';

export const personalInstructionsPath = (dataDir: string) => join(dataDir, 'personal-instructions', 'AGENTS.md');

const hash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
const decode = (bytes: Buffer) => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
const UTF8_ERROR = 'Personal instructions must be plain UTF-8 text.';
const DIRECTIVE_ERROR = "Includes and hooks aren't supported in personal instructions.";
const SIZE_ERROR = (bytes: number) => `Keep personal instructions under ${Math.round(PERSONAL_INSTRUCTIONS_MAX_BYTES / 1024)} KB (now ${(bytes / 1024).toFixed(1)} KB).`;

const absent = (path: string): PersonalInstructionsView => ({ text: '', digest: null, bytes: 0, updatedAt: null, status: 'ABSENT', path });
const excluded = (path: string, reason: PersonalInstructionsExclusion, text = '', bytes = 0, updatedAt: string | null = null, digest: string | null = null): PersonalInstructionsView =>
  ({ text, digest, bytes, updatedAt, status: 'EXCLUDED', reason, path });

export async function readPersonalInstructions(dataDir: string): Promise<PersonalInstructionsView> {
  const path = personalInstructionsPath(dataDir);
  let info;
  try { info = await lstat(path); }
  catch { return absent(path); }
  if (!info.isFile() || info.nlink !== 1) return excluded(path, 'UNAVAILABLE_SOURCE');
  if (info.size > PERSONAL_INSTRUCTIONS_MAX_BYTES) {
    const raw = info.size <= 1024 * 1024 ? await readFile(path) : null;
    const digest = raw ? hash(raw) : hash(`${info.size}:${info.mtimeMs}`);
    return excluded(path, 'SOURCE_TOO_LARGE', raw ? decodeSafe(raw) : '', info.size, info.mtime.toISOString(), digest);
  }
  const bytes = await readFile(path);
  const digest = hash(bytes);
  let text: string;
  try { text = decode(bytes); } catch { return excluded(path, 'SOURCE_NOT_TEXT', '', bytes.length, info.mtime.toISOString(), digest); }
  if (text.includes('\0')) return excluded(path, 'SOURCE_NOT_TEXT', '', bytes.length, info.mtime.toISOString(), digest);
  if (unsupportedDirective.test(text)) return excluded(path, 'UNSUPPORTED_DIRECTIVE', text, bytes.length, info.mtime.toISOString(), digest);
  return { text, digest, bytes: bytes.length, updatedAt: info.mtime.toISOString(), status: 'OK', path };
}
function decodeSafe(bytes: Buffer) { try { return decode(bytes); } catch { return ''; } }

export function normalizePersonalInstructions(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (normalized.includes('\0')) throw new HarnessError('SOURCE_NOT_TEXT', UTF8_ERROR);
  if (Buffer.byteLength(normalized, 'utf8') > PERSONAL_INSTRUCTIONS_MAX_BYTES) throw new HarnessError('SOURCE_TOO_LARGE', SIZE_ERROR(Buffer.byteLength(normalized, 'utf8')));
  if (unsupportedDirective.test(normalized)) throw new HarnessError('UNSUPPORTED_DIRECTIVE', DIRECTIVE_ERROR);
  return normalized;
}

let writeQueue: Promise<unknown> = Promise.resolve();

export async function writePersonalInstructions(dataDir: string, text: string, baseDigest: string | null): Promise<PersonalInstructionsView> {
  const run = writeQueue.then(() => writePersonalInstructionsNow(dataDir, text, baseDigest));
  writeQueue = run.catch(() => {});
  return run;
}

async function writePersonalInstructionsNow(dataDir: string, text: string, baseDigest: string | null): Promise<PersonalInstructionsView> {
  const normalized = normalizePersonalInstructions(text);
  const path = personalInstructionsPath(dataDir);
  const current = await readPersonalInstructions(dataDir);
  const currentDigest = current.digest;
  if (currentDigest !== baseDigest) throw new HarnessError('STALE_REQUEST_CONTEXT', 'The file changed on disk. Reload to see the new text, then save again.');
  if (!normalized) {
    await rm(path, { force: true });
    return absent(path);
  }
  const dir = join(dataDir, 'personal-instructions');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dir, `AGENTS.md.tmp-${randomBytes(6).toString('hex')}`);
  try {
    await writeFile(tmp, normalized, { mode: 0o600 });
    await rename(tmp, path);
  } finally {
    await rm(tmp, { force: true });
  }
  return readPersonalInstructions(dataDir);
}

export async function capturePersonalInstructions(dataDir: string, enabled: boolean): Promise<{ text: string; digest: string } | undefined> {
  if (!enabled) return undefined;
  try {
    const view = await readPersonalInstructions(dataDir);
    if (view.status !== 'OK' || !view.text || !view.digest) return undefined;
    return { text: view.text, digest: view.digest };
  } catch {
    return undefined;
  }
}
