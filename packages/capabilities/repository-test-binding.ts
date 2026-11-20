import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { z } from 'zod';
import { HarnessError } from '../contracts/index.ts';
import { withPathGuard } from '../core/file-access.ts';
import { buildToolRegistry } from '../core/tool-authority.ts';
import { toolSchemas } from './schemas.ts';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const identity = z.strictObject({
  path: z.string().min(1).max(32767).refine(path => isAbsolute(path) && !path.includes('\0')),
  dev: z.string().regex(/^\d+$/), ino: z.string().regex(/^\d+$/),
});
const file = identity.extend({ bytes: z.number().int().nonnegative().max(512 * 1024 * 1024), sha256 });
const bindingSchema = z.strictObject({
  version: z.literal(1), executable: file, cwd: identity, test: file,
  argv: z.tuple([z.literal('--test'), z.literal('--'), toolSchemas.repository_test_prepare.shape.testFile]),
  definition: z.strictObject({ id: z.literal('repository_test_prepare'), version: z.number().int().positive(),
    schemaDigest: sha256, executorBinding: z.literal('domain-prepare') }),
});
export type RepositoryTestBinding = z.infer<typeof bindingSchema>;
// This schema is internal to stored operations. The public tool remains strict
// and cannot accept a model-supplied binding. Old receipts remain readable.
const operationSchema = toolSchemas.repository_test_prepare.extend({ executionBinding: bindingSchema.optional() });
export function parseRepositoryTestOperation(args: unknown) {
  const parsed = operationSchema.safeParse(args);
  if (!parsed.success) throw new HarnessError('INVALID_OPERATION', 'Invalid prepared repository test');
  return parsed.data;
}
const changed = () => new HarnessError('PRECONDITION_FAILED', 'Repository test launch target changed; prepare and approve the test again');
function active(signal: AbortSignal) {
  if (signal.aborted) throw new HarnessError('CANCELLED', 'Repository test cancelled');
}
async function captureIdentity(path: string, directory: boolean) {
  const canonical = await realpath(path), info = await lstat(canonical, { bigint: true });
  if (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1n) throw changed();
  return { path: canonical, dev: String(info.dev), ino: String(info.ino) };
}
function sameIdentity(a: z.infer<typeof identity>, b: z.infer<typeof identity>) {
  return a.path === b.path && a.dev === b.dev && a.ino === b.ino;
}
async function hashFile(expected: z.infer<typeof identity>, maxBytes: number, signal: AbortSignal) {
  const handle = await open(expected.path, 'r');
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || String(before.dev) !== expected.dev || String(before.ino) !== expected.ino) throw changed();
    if (before.size > BigInt(maxBytes)) throw new HarnessError('RESOURCE_LIMIT', 'Repository test launch file exceeds its byte limit');
    const bytes = Number(before.size), buffer = Buffer.alloc(Math.min(bytes, 1024 * 1024)), hash = createHash('sha256');
    let offset = 0;
    while (offset < bytes) {
      active(signal);
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, bytes - offset), offset);
      if (!bytesRead) throw changed();
      hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (after.size !== before.size || after.nlink !== 1n) throw changed();
    return { ...expected, bytes, sha256: hash.digest('hex') };
  } finally { await handle.close(); }
}

/** Native read-only leases cover hashing through child termination. A digest
 * check alone cannot protect the hash-to-spawn interval. Unsupported native
 * file custody remains denied by withPathGuard; there is no fallback here. */
export async function withRepositoryTestBinding<T>(cwdPath: string, testPath: string, testFile: string,
  signal: AbortSignal, action: (binding: RepositoryTestBinding, signal: AbortSignal) => Promise<T>): Promise<T> {
  const [executable, cwd, test] = await Promise.all([
    captureIdentity(process.execPath, false), captureIdentity(cwdPath, true), captureIdentity(testPath, false),
  ]);
  // The child receives this exact relative argv. Redirected path components
  // would otherwise leave an unguarded alias between the check and Node's open.
  if (relative(resolve(cwd.path, testFile), test.path) !== '') throw changed();
  const loss = new AbortController(), guardedSignal = AbortSignal.any([signal, loss.signal]);
  return withPathGuard([
    { ...executable, leaf: true, readOnly: true },
    { ...cwd, leaf: true },
    { ...test, leaf: true, readOnly: true },
  ], guardedSignal, async () => {
    // Acquisition is asynchronous. Revalidate all identities after it, then
    // read both files while the native deny-write/deny-delete handles are held.
    const [currentExecutable, currentCwd, currentTest] = await Promise.all([
      captureIdentity(process.execPath, false), captureIdentity(cwdPath, true), captureIdentity(testPath, false),
    ]);
    if (!sameIdentity(executable, currentExecutable) || !sameIdentity(cwd, currentCwd) || !sameIdentity(test, currentTest)) throw changed();
    const executableFile = await hashFile(executable, 512 * 1024 * 1024, guardedSignal);
    const testSource = await hashFile(test, 8 * 1024 * 1024, guardedSignal);
    const definition = buildToolRegistry().find(entry => entry.id === 'repository_test_prepare');
    if (!definition || definition.executorBinding !== 'domain-prepare') throw changed();
    active(guardedSignal);
    return action({ version: 1, executable: executableFile, cwd, test: testSource, argv: ['--test', '--', testFile],
      definition: { id: 'repository_test_prepare', version: definition.version, schemaDigest: definition.schemaDigest, executorBinding: definition.executorBinding } }, guardedSignal);
  }, () => loss.abort());
}

export function requireRepositoryTestBinding(expected: RepositoryTestBinding | undefined, actual: RepositoryTestBinding, testSha256: string | undefined) {
  const parsed = bindingSchema.safeParse(actual);
  if (!expected || !parsed.success || JSON.stringify(expected) !== JSON.stringify(parsed.data) || parsed.data.test.sha256 !== testSha256) throw changed();
}
