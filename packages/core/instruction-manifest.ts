import { createHash } from 'node:crypto';

export interface HostAdmittedInstruction {
  readonly path: string;
  readonly physicalId: string;
  readonly scope: string;
  readonly precedence: number;
}
const nameApproved = /^(AGENTS|CLAUDE|GEMINI)\.md$/i;
const relative = (path: string) =>
  path.length <= 1024 && !/[\\:\u0000]/.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..');
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Projects files already admitted by a host reader; never expands includes or discovers new paths. */
export function buildInstructionManifest(files: readonly HostAdmittedInstruction[], readAdmitted: (file: HostAdmittedInstruction) => string) {
  if (files.length > 128) throw new RangeError('Too many instruction files');
  const seen = new Map<string, string>();
  const entries: { path: string; scope: string; precedence: number; digest: string; bytes: number }[] = [];
  const duplicates: { path: string; retainedPath: string }[] = [];
  for (const file of files.toSorted((a, b) => a.precedence - b.precedence || compare(a.path, b.path))) {
    const { path, physicalId, scope, precedence } = file;
    if (!relative(path) || !nameApproved.test(path.split('/').at(-1)!) || !physicalId || !Number.isSafeInteger(precedence) ||
      (scope && (!relative(scope) || !path.startsWith(scope + '/')))) throw new Error('Invalid host-admitted instruction identity');
    const duplicate = seen.get(physicalId);
    if (duplicate) { duplicates.push({ path, retainedPath: duplicate }); continue; }
    const text = readAdmitted(file), bytes = Buffer.byteLength(text);
    if (bytes > 64 * 1024) throw new RangeError('Instruction file exceeds the byte limit');
    seen.set(physicalId, path);
    entries.push({ path, scope, precedence, bytes, digest: createHash('sha256').update(text).digest('hex') });
  }
  return { entries, duplicates, precedence: 'later overrides earlier within its recorded scope' as const };
}
