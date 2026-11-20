import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import type { PythonRuntimeConfiguration } from '../../packages/runtime/python-program-worker.ts';

// TEST-ONLY selection of the pinned Python runtime used by the native M12
// suites. Without the opt-in environment the historical host paths are
// returned unchanged. The alternate profile is accepted only from a staging
// manifest whose exact SHA-256 is supplied, only for the one qualification
// profile, and only at its exact disposable root. Nothing here approves a
// production runtime, changes a production pin or enables a flag.

export const QUALIFICATION_ENV = Object.freeze({
  manifest: 'M12_PYTHON_QUALIFICATION_MANIFEST',
  manifestSha256: 'M12_PYTHON_QUALIFICATION_MANIFEST_SHA256',
  profile: 'M12_PYTHON_QUALIFICATION_PROFILE',
});
/** The security-current Debian 13 package set is the only qualification
 * profile. The zlib +b1 reproduction profile is provenance evidence only. */
export const QUALIFICATION_PROFILE_ID = 'debian13-security-current';
export const QUALIFICATION_SNAPSHOT = '20261107T144357Z';
export const QUALIFICATION_ROOT = '/var/tmp/m12-qual-debian13-20261107T144357Z/root';
const MANIFEST_SCHEMA = 'm12-python-qualification-staging/v1';
const MAX_MANIFEST_BYTES = 1024 * 1024;

const MOUNTS = [
  ['libc.so.6', '/lib/x86_64-linux-gnu/libc.so.6'], ['libm.so.6', '/lib/x86_64-linux-gnu/libm.so.6'],
  ['libz.so.1', '/lib/x86_64-linux-gnu/libz.so.1'], ['libexpat.so.1', '/lib/x86_64-linux-gnu/libexpat.so.1'],
  ['libffi.so.8', '/lib/x86_64-linux-gnu/libffi.so.8'], ['ld-linux-x86-64.so.2', '/lib64/ld-linux-x86-64.so.2'],
] as const;

export interface PythonRuntimeInspectionInput {
  backendId: string; bwrapPath: string; interpreterPath: string; stdlibPath: string;
  libraries: { path: string; mountPath: string }[];
}
export interface PythonQualificationProfile {
  readonly id: string;
  readonly source: 'historical-host' | 'staging-manifest';
  readonly inspection: PythonRuntimeInspectionInput;
  /** Present only for the manifest profile: the exact runtime the inspection must reproduce. */
  readonly expected?: { readonly runtime: PythonRuntimeConfiguration; readonly runtimeFingerprint: string; readonly manifestSha256: string };
}

const BACKEND_ID = 'm12-linux-bwrap-python-v1';
const historical = (): PythonQualificationProfile => ({
  id: 'historical-host-v3', source: 'historical-host',
  inspection: {
    backendId: BACKEND_ID, bwrapPath: '/usr/bin/bwrap', interpreterPath: '/usr/bin/python3.13', stdlibPath: '/usr/lib/python3.13',
    libraries: [
      { path: '/lib/x86_64-linux-gnu/libc.so.6', mountPath: '/lib/x86_64-linux-gnu/libc.so.6' },
      { path: '/lib/x86_64-linux-gnu/libm.so.6', mountPath: '/lib/x86_64-linux-gnu/libm.so.6' },
      { path: '/lib/x86_64-linux-gnu/libz.so.1', mountPath: '/lib/x86_64-linux-gnu/libz.so.1' },
      { path: '/lib/x86_64-linux-gnu/libexpat.so.1', mountPath: '/lib/x86_64-linux-gnu/libexpat.so.1' },
      { path: '/lib/x86_64-linux-gnu/libffi.so.8', mountPath: '/lib/x86_64-linux-gnu/libffi.so.8' },
      { path: '/lib64/ld-linux-x86-64.so.2', mountPath: '/lib64/ld-linux-x86-64.so.2' },
    ],
  },
});

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const pinned = z.strictObject({ path: z.string(), sha256: hash });
const runtimeSchema = z.strictObject({
  version: z.literal(1), backendId: z.literal(BACKEND_ID), bwrap: pinned, interpreter: pinned, stdlib: pinned,
  libraries: z.array(z.strictObject({ path: z.string(), mountPath: z.string(), sha256: hash })).length(MOUNTS.length),
  workerSha256: hash, confinementSha256: hash, supervisorSha256: hash,
});
const manifestSchema = z.object({
  schema: z.literal(MANIFEST_SCHEMA), snapshot: z.literal(QUALIFICATION_SNAPSHOT),
  profiles: z.record(z.string(), z.object({ root: z.string(), runtime: runtimeSchema, runtimeFingerprint: hash })),
});

const refuse = (message: string): never => { throw new Error(`M12 Python qualification profile refused: ${message}`); };

/** Canonical root, owned by this user, not group/world writable, not a link. */
export function verifyQualificationRoot(root: string): void {
  let info;
  try { info = lstatSync(root); } catch { return refuse(`root ${root} is not present; stage it first`); }
  if (!info.isDirectory() || info.isSymbolicLink()) refuse('root is not a plain directory');
  if (realpathSync(root) !== root) refuse('root is not canonical');
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) refuse('root is not owned by the test user');
  if (info.mode & 0o022) refuse('root is group or world writable');
}

/** Pure manifest validation; the caller supplies the manifest bytes. */
export function profileFromManifest(bytes: Buffer, expectedSha256: string, profileId: string, root = QUALIFICATION_ROOT): PythonQualificationProfile {
  if (!/^[0-9a-f]{64}$/.test(expectedSha256)) refuse('manifest SHA-256 must be 64 lowercase hex digits');
  if (bytes.length > MAX_MANIFEST_BYTES) refuse('manifest is too large');
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expectedSha256) refuse('manifest SHA-256 mismatch');
  if (profileId !== QUALIFICATION_PROFILE_ID) refuse(`only ${QUALIFICATION_PROFILE_ID} is a qualification profile`);
  const manifest = manifestSchema.parse(JSON.parse(bytes.toString('utf8')));
  const profile = manifest.profiles[profileId] ?? refuse('profile is absent from the manifest');
  if (profile.root !== root) refuse('profile root does not match the pinned disposable root');
  const inspection: PythonRuntimeInspectionInput = {
    backendId: BACKEND_ID, bwrapPath: `${root}/usr/bin/bwrap`, interpreterPath: `${root}/usr/bin/python3.13`,
    stdlibPath: `${root}/usr/lib/python3.13`,
    libraries: MOUNTS.map(([name, mountPath]) => ({ path: `${root}/usr/lib/x86_64-linux-gnu/${name}`, mountPath })),
  };
  // Every pinned path must stay inside the root, and mount targets must equal
  // the historical sandbox layout exactly.
  const inside = (path: string) => path.startsWith(`${root}/`) && !path.split('/').includes('..');
  const runtime = profile.runtime as PythonRuntimeConfiguration;
  for (const path of [runtime.bwrap.path, runtime.interpreter.path, runtime.stdlib.path, ...runtime.libraries.map(library => library.path)])
    if (!inside(path)) refuse(`pinned path ${path} is outside the qualification root`);
  runtime.libraries.forEach((library, index) => { if (library.mountPath !== MOUNTS[index]![1]) refuse('library mount layout changed'); });
  return Object.freeze({ id: profileId, source: 'staging-manifest', inspection,
    expected: Object.freeze({ runtime, runtimeFingerprint: profile.runtimeFingerprint, manifestSha256: actual }) });
}

/** Opt-in only: all three variables set selects the manifest profile; none set
 * keeps the historical host profile; any partial setting is refused. */
export function pythonQualificationProfile(env: NodeJS.ProcessEnv = process.env): PythonQualificationProfile {
  const values = [env[QUALIFICATION_ENV.manifest], env[QUALIFICATION_ENV.manifestSha256], env[QUALIFICATION_ENV.profile]];
  if (values.every(value => value === undefined)) return historical();
  if (values.some(value => !value)) refuse('set all of M12_PYTHON_QUALIFICATION_MANIFEST, _MANIFEST_SHA256 and _PROFILE, or none');
  const [path, sha, id] = values as string[];
  if (!isAbsolute(path)) refuse('manifest path must be absolute');
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink()) refuse('manifest must be a regular file');
  if (info.size > MAX_MANIFEST_BYTES) refuse('manifest is too large');
  const profile = profileFromManifest(readFileSync(path), sha, id);
  verifyQualificationRoot(QUALIFICATION_ROOT);
  return profile;
}
