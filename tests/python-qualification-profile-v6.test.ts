import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  QUALIFICATION_PROFILE_ID, QUALIFICATION_ROOT, profileFromManifest, pythonQualificationProfile, verifyQualificationRoot,
} from './fixtures/python-qualification-profile.ts';

// Test-only runtime profile selection. These cases need no native runtime:
// they prove the default stays the historical host profile and that the
// opt-in staged profile is hash-verified, path-checked and exact.
const R = QUALIFICATION_ROOT, H = (n: string) => n.repeat(64).slice(0, 64);
const lib = (name: string, mountPath: string) => ({ path: `${R}/usr/lib/x86_64-linux-gnu/${name}`, mountPath, sha256: H('a') });
const runtime = {
  version: 1, backendId: 'm12-linux-bwrap-python-v1',
  bwrap: { path: `${R}/usr/bin/bwrap`, sha256: H('1') }, interpreter: { path: `${R}/usr/bin/python3.13`, sha256: H('2') },
  stdlib: { path: `${R}/usr/lib/python3.13`, sha256: H('3') },
  libraries: [lib('libc.so.6', '/lib/x86_64-linux-gnu/libc.so.6'), lib('libm.so.6', '/lib/x86_64-linux-gnu/libm.so.6'),
    lib('libz.so.1.3.1', '/lib/x86_64-linux-gnu/libz.so.1'), lib('libexpat.so.1.13.0', '/lib/x86_64-linux-gnu/libexpat.so.1'),
    lib('libffi.so.8.1.4', '/lib/x86_64-linux-gnu/libffi.so.8'), lib('ld-linux-x86-64.so.2', '/lib64/ld-linux-x86-64.so.2')],
  workerSha256: H('4'), confinementSha256: H('5'), supervisorSha256: H('6'),
};
const manifest = (over: (value: any) => void = () => {}) => {
  const value: any = { schema: 'm12-python-qualification-staging/v1', snapshot: '20261107T144357Z', profiles: {
    [QUALIFICATION_PROFILE_ID]: { root: R, runtime: structuredClone(runtime), runtimeFingerprint: H('f') },
    'debian13-pinned-v3-reproduction': { root: '/var/tmp/m12-qual-debian13-20261107T144357Z.b1/root', runtime: structuredClone(runtime), runtimeFingerprint: H('e') },
  } };
  over(value);
  const bytes = Buffer.from(JSON.stringify(value));
  return { bytes, sha: createHash('sha256').update(bytes).digest('hex') };
};
const ENV = ['M12_PYTHON_QUALIFICATION_MANIFEST', 'M12_PYTHON_QUALIFICATION_MANIFEST_SHA256', 'M12_PYTHON_QUALIFICATION_PROFILE'] as const;
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

describe('M12 test-only Python qualification profile', () => {
  it('keeps the historical host paths byte-for-byte when not opted in', () => {
    const profile = pythonQualificationProfile({});
    expect(profile).toEqual({ id: 'historical-host-v3', source: 'historical-host', inspection: {
      backendId: 'm12-linux-bwrap-python-v1', bwrapPath: '/usr/bin/bwrap', interpreterPath: '/usr/bin/python3.13', stdlibPath: '/usr/lib/python3.13',
      libraries: [
        { path: '/lib/x86_64-linux-gnu/libc.so.6', mountPath: '/lib/x86_64-linux-gnu/libc.so.6' },
        { path: '/lib/x86_64-linux-gnu/libm.so.6', mountPath: '/lib/x86_64-linux-gnu/libm.so.6' },
        { path: '/lib/x86_64-linux-gnu/libz.so.1', mountPath: '/lib/x86_64-linux-gnu/libz.so.1' },
        { path: '/lib/x86_64-linux-gnu/libexpat.so.1', mountPath: '/lib/x86_64-linux-gnu/libexpat.so.1' },
        { path: '/lib/x86_64-linux-gnu/libffi.so.8', mountPath: '/lib/x86_64-linux-gnu/libffi.so.8' },
        { path: '/lib64/ld-linux-x86-64.so.2', mountPath: '/lib64/ld-linux-x86-64.so.2' },
      ] } });
    expect(profile.expected).toBeUndefined();
  });

  it('refuses partial opt-in and relative manifest paths', () => {
    for (const index of [0, 1, 2]) expect(() => pythonQualificationProfile({ [ENV[index]]: 'x' })).toThrow(/all of/);
    expect(() => pythonQualificationProfile({ [ENV[0]]: 'manifest.json', [ENV[1]]: H('0'), [ENV[2]]: QUALIFICATION_PROFILE_ID })).toThrow(/absolute/);
  });

  it('derives the staged inspection paths from the pinned root and returns the exact expected runtime', () => {
    const { bytes, sha } = manifest();
    const profile = profileFromManifest(bytes, sha, QUALIFICATION_PROFILE_ID);
    expect(profile.inspection).toEqual({ backendId: 'm12-linux-bwrap-python-v1', bwrapPath: `${R}/usr/bin/bwrap`,
      interpreterPath: `${R}/usr/bin/python3.13`, stdlibPath: `${R}/usr/lib/python3.13`,
      libraries: [['libc.so.6', '/lib/x86_64-linux-gnu/libc.so.6'], ['libm.so.6', '/lib/x86_64-linux-gnu/libm.so.6'],
        ['libz.so.1', '/lib/x86_64-linux-gnu/libz.so.1'], ['libexpat.so.1', '/lib/x86_64-linux-gnu/libexpat.so.1'],
        ['libffi.so.8', '/lib/x86_64-linux-gnu/libffi.so.8'], ['ld-linux-x86-64.so.2', '/lib64/ld-linux-x86-64.so.2']]
        .map(([name, mountPath]) => ({ path: `${R}/usr/lib/x86_64-linux-gnu/${name}`, mountPath })) });
    expect(profile.expected).toEqual({ runtime, runtimeFingerprint: H('f'), manifestSha256: sha });
  });

  it('refuses a manifest whose bytes do not match the supplied SHA-256', () => {
    const { bytes, sha } = manifest();
    expect(() => profileFromManifest(Buffer.concat([bytes, Buffer.from(' ')]), sha, QUALIFICATION_PROFILE_ID)).toThrow(/SHA-256 mismatch/);
    expect(() => profileFromManifest(bytes, sha.toUpperCase(), QUALIFICATION_PROFILE_ID)).toThrow(/lowercase hex/);
  });

  it('accepts only the security-current profile; the zlib +b1 reproduction is provenance only', () => {
    const { bytes, sha } = manifest();
    expect(() => profileFromManifest(bytes, sha, 'debian13-pinned-v3-reproduction')).toThrow(/only debian13-security-current/);
  });

  it('refuses a different root, paths outside the root, a changed mount layout and a different snapshot', () => {
    const cases: ((value: any) => void)[] = [
      value => { value.profiles[QUALIFICATION_PROFILE_ID].root = '/var/tmp/other/root'; },
      value => { value.profiles[QUALIFICATION_PROFILE_ID].runtime.interpreter.path = '/usr/bin/python3.13'; },
      value => { value.profiles[QUALIFICATION_PROFILE_ID].runtime.libraries[0].path = `${R}/../escape/libc.so.6`; },
      value => { value.profiles[QUALIFICATION_PROFILE_ID].runtime.libraries[0].mountPath = '/lib/other.so'; },
      value => { value.snapshot = '20260101T000000Z'; },
      value => { value.profiles[QUALIFICATION_PROFILE_ID].runtime.extra = true; },
    ];
    for (const change of cases) {
      const { bytes, sha } = manifest(change);
      expect(() => profileFromManifest(bytes, sha, QUALIFICATION_PROFILE_ID)).toThrow();
    }
  });

  it('requires the qualification root to be a present plain directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'm12-qual-root-')); dirs.push(dir);
    const root = join(dir, 'root'); await writeFile(join(dir, 'file'), '');
    expect(() => verifyQualificationRoot(root)).toThrow(/not present/);
    expect(() => verifyQualificationRoot(join(dir, 'file'))).toThrow(/plain directory/);
    await symlink(dir, root);
    expect(() => verifyQualificationRoot(root)).toThrow(/plain directory/);
  });

  // POSIX owner/mode semantics. On Windows, libuv reports st_mode 0666 for
  // every non-readonly entry and chmod only toggles the readonly attribute, so
  // a group/other-writable check cannot be satisfied there. The staged
  // qualification profile itself is Linux x64 only.
  it.runIf(process.platform !== 'win32')('requires a canonical, owned, non-shared-writable root directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'm12-qual-root-')); dirs.push(dir);
    const root = join(dir, 'root');
    await symlink(dir, root);
    expect(() => verifyQualificationRoot(root)).toThrow(/plain directory/);
    await chmod(dir, 0o775);
    expect(() => verifyQualificationRoot(dir)).toThrow(/writable/);
    await chmod(dir, 0o755);
    expect(() => verifyQualificationRoot(dir)).not.toThrow();
  });

  it('loads the real staging manifest through the environment when explicitly selected', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'm12-qual-manifest-')); dirs.push(dir);
    const { bytes, sha } = manifest(); const path = join(dir, 'manifest.json'); await writeFile(path, bytes);
    const env = { [ENV[0]]: path, [ENV[1]]: sha, [ENV[2]]: QUALIFICATION_PROFILE_ID };
    let staged = true; try { verifyQualificationRoot(R); } catch { staged = false; }
    if (staged) expect(pythonQualificationProfile(env).expected?.manifestSha256).toBe(sha);
    else expect(() => pythonQualificationProfile(env)).toThrow(/not present/);
    const link = join(dir, 'link.json'); await symlink(path, link);
    expect(() => pythonQualificationProfile({ ...env, [ENV[0]]: link })).toThrow(/regular file/);
  });
});
