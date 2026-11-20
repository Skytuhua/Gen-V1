import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { HarnessError } from '../contracts/index.ts';
import { context7SecretReferenceMetadataSchema, integrationPrepareArgsSchema } from '../contracts/integration-secrets.ts';
import { toolOwnerSchema } from '../contracts/tool-effects.ts';
import { withPathGuard } from '../core/file-access.ts';
import { buildToolRegistry } from '../core/tool-authority.ts';
import { observeContext7Executable, type ObservedContext7Executable } from './context7-secret-reference.ts';

const path = z.string().min(1).max(32767).refine(value => isAbsolute(value) && !value.includes('\0'));
const digits = z.string().regex(/^\d+$/), sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const identity = z.strictObject({ path, dev: digits, ino: digits });
const file = identity.extend({ size: digits, mtimeNs: z.string().regex(/^-?\d+$/), ctimeNs: z.string().regex(/^-?\d+$/), sha256 });
const definition = z.strictObject({ id: z.literal('integration_prepare'), version: z.literal(1), schemaDigest: sha256, executorBinding: z.literal('domain-prepare') });
const bindingSchema = z.strictObject({ version: z.literal(1), executable: file, entry: file, manifest: file, packageManifest: file,
  cwd: identity, argv: z.array(z.string().max(4096)).min(1).max(64), definition });
export type Context7ExecutionBinding = z.infer<typeof bindingSchema>;
export interface Context7LaunchDescriptor { executable: string; entry: string; manifest: string; packageManifest: string; cwd: string; args: string[] }
export const context7OperationArgsSchema = z.strictObject({
  version: z.literal(1), request: integrationPrepareArgsSchema, reference: context7SecretReferenceMetadataSchema, binding: bindingSchema,
  owner: toolOwnerSchema, modelId: z.string().min(1).max(200),
});
const changed = () => new HarnessError('PRECONDITION_FAILED', 'Context7 launch binding changed; prepare and approve this action again.');
function active(signal: AbortSignal) { if (signal.aborted) throw new HarnessError('CANCELLED', 'The approved Context7 action was cancelled.'); }
async function directory(value: string) {
  try {
    const canonical = await realpath(value), info = await lstat(canonical, { bigint: true });
    if (!info.isDirectory() || info.isSymbolicLink()) throw changed();
    return { path: canonical, dev: String(info.dev), ino: String(info.ino) };
  } catch (error) { if (error instanceof HarnessError) throw error; throw changed(); }
}
/** Preparation observes actual installed files. It neither resolves a secret
 * nor establishes a native lease. The dispatch path below must repeat it. */
export async function captureContext7Binding(launch: Context7LaunchDescriptor, executable?: ObservedContext7Executable): Promise<Context7ExecutionBinding> {
  const [currentExecutable, entry, manifest, packageManifest, cwd] = await Promise.all([
    executable ?? observeContext7Executable(launch.executable), observeContext7Executable(launch.entry),
    observeContext7Executable(launch.manifest), observeContext7Executable(launch.packageManifest), directory(launch.cwd),
  ]);
  const registered = buildToolRegistry().find(value => value.id === 'integration_prepare');
  if (!registered || registered.version !== 1 || registered.executorBinding !== 'domain-prepare') throw changed();
  return bindingSchema.parse({ version: 1, executable: currentExecutable, entry, manifest, packageManifest, cwd,
    argv: [entry.path, ...launch.args], definition: { id: registered.id, version: registered.version, schemaDigest: registered.schemaDigest, executorBinding: registered.executorBinding } });
}

/** Existing native namespace custody covers revalidation through confirmed
 * temporary-child teardown. It is not an OS sandbox for Context7 code. */
export async function withContext7Binding<T>(launch: Context7LaunchDescriptor, expected: Context7ExecutionBinding,
  signal: AbortSignal, action: (binding: Context7ExecutionBinding, signal: AbortSignal) => Promise<T>): Promise<T> {
  const approved = bindingSchema.parse(expected), loss = new AbortController(), guarded = AbortSignal.any([signal, loss.signal]);
  active(guarded);
  return withPathGuard([
    ...[approved.executable, approved.entry, approved.manifest, approved.packageManifest].map(value => ({ path: value.path, dev: value.dev, ino: value.ino, leaf: true, readOnly: true })),
    { ...approved.cwd, leaf: true },
  ], guarded, async () => {
    let current;
    try { current = await captureContext7Binding(launch); }
    catch (error) { if (error instanceof HarnessError && error.code === 'SECRET_REF_UNAVAILABLE') throw changed(); throw error; }
    if (JSON.stringify(current) !== JSON.stringify(approved)) throw changed();
    active(guarded); return action(current, guarded);
  }, () => loss.abort());
}
