import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { mkdtempSync, writeFileSync, rmSync, renameSync, mkdirSync, lstatSync, truncateSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectTrustLedger } from '../packages/core/project-trust.ts';
import { SecretReferenceLedger } from '../packages/core/secret-references.ts';
import { digestFileSha256 } from '../packages/core/execution-policy.ts';
import { createVerificationBindingAuthority, MAX_APPROVED_FILE_BYTES, MAX_EXECUTABLE_BYTES, type DescribeVerificationExecutor, type ObservedVerificationBackend, type VerificationExecutorHostConfig } from '../packages/core/verification-executor-binding.ts';
import { createVerificationExecutorFactory } from '../packages/core/verification-executor.ts';
import type { ExecutionProfileV1 } from '../packages/contracts/execution-profile.ts';

// Keep disk I/O real; individual tests control only a filesystem observation.
vi.mock('node:fs', async original => ({ ...await original<typeof import('node:fs')>() }));

const dirs: string[] = [];
afterEach(() => { dirs.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })); vi.restoreAllMocks(); });
async function fixture() {
  const parent = mkdtempSync(join(tmpdir(), 'verification-binding-')); dirs.push(parent);
  const root = join(parent, 'project'); mkdirSync(root);
  const executable = join(root, 'tool'); writeFileSync(executable, 'unit-test executable bytes');
  const sha256 = await digestFileSha256(executable);
  const trust = new ProjectTrustLedger();
  await trust.decide({ trustId: 'trust', rootPath: root, approvedFiles: [{ path: 'tool', kind: 'executable' }], scope: { read: true, write: true, network: 'none' }, decision: 'trusted' });
  const owner = { threadId: 'thread', runId: 'run', epoch: 1, projectId: 'project', workspaceId: null, accountBinding: 'account' };
  // These doubles test admission behavior only; they are not native proof.
  const backend: ObservedVerificationBackend = {
    backendId: 'unit-test-backend', platform: process.platform, installed: true, approved: true,
    proof: { platformProofRef: 'unit-test-proof', platform: process.platform, status: 'PASS', recordedAt: '2026-11-17T00:00:00.000Z', evidenceRef: 'unit-test-only' },
    launch: vi.fn(), launchObserved: vi.fn(),
  };
  const profile: ExecutionProfileV1 = { profileId: 'workspace-check', version: 1, backendId: backend.backendId, capabilities: ['process.execute', 'fs.read'], readRoots: [root], writeRoots: [], networkPolicy: { mode: 'none' }, secretRefs: [], executableAllowlist: [{ executableSha256: sha256, argv: ['test'] }], platformProofRef: 'unit-test-proof' };
  const config: VerificationExecutorHostConfig = {
    approvedBackendId: backend.backendId, backends: [backend], profiles: [{ profile, trustId: 'trust', projectId: 'project', workspaceId: null, accountBinding: 'account' }],
    executables: [{ id: 'test-tool', path: executable }], trust, secrets: new SecretReferenceLedger(), environment: { LANG: 'C' },
    flags: { HARNESS_FLAG_VERIFICATION_WORKFLOW_V1: '1', HARNESS_FLAG_SECURITY_EXECUTION_PROFILES_V1: '1', HARNESS_FLAG_SECURITY_PROJECT_TRUST_V1: '1' },
  };
  const input: DescribeVerificationExecutor = { owner, rootPath: root, profileId: profile.profileId, executableIds: ['test-tool'], approvedOrigins: [], signal: new AbortController().signal, assertCurrent: vi.fn() };
  return { root, parent, executable, sha256, trust, owner, backend, profile, config, input, authority: createVerificationBindingAuthority(config) };
}

it('describes host identities without launching and freezes approval metadata', async () => {
  const f = await fixture(), binding = await f.authority.describe(f.input);
  expect(binding.executables).toEqual([{ id: 'test-tool', canonicalPath: f.executable, sha256: f.sha256 }]);
  expect(binding.environmentId).toMatch(/^[a-f0-9]{64}$/);
  expect(Object.isFrozen(binding.profile.executableAllowlist)).toBe(true);
  expect(f.backend.launchObserved).not.toHaveBeenCalled();
  expect(f.backend.launch).not.toHaveBeenCalled();
});

it('disables the executor when no host environment flags are set', async () => {
  const f = await fixture(), factory = createVerificationExecutorFactory({ ...f.config, flags: {} });
  await expect(factory.describe(f.input)).rejects.toMatchObject({ code: 'CAPABILITY_DISABLED' });
  expect(f.backend.launchObserved).not.toHaveBeenCalled();
  expect(f.backend.launch).not.toHaveBeenCalled();
});

it('checks a read-side binding synchronously without consuming it or opening execution', async () => {
  const f = await fixture(), binding = await f.authority.describe(f.input);
  expect(f.authority.assertCurrent(binding, f.input)).toBeUndefined();
  expect(f.authority.assertCurrent(binding, f.input)).toBeUndefined();
  await f.authority.take(binding, f.input);
  expect(f.authority.assertCurrent(binding, f.input)).toBeUndefined();
  expect(f.backend.launchObserved).not.toHaveBeenCalled();
});

it.each(['trust', 'executable', 'root', 'profile', 'proof', 'environment', 'implementation'] as const)('rejects a stale %s at the synchronous read-side commit fence', async kind => {
  const f = await fixture(), binding = await f.authority.describe(f.input);
  if (kind === 'trust') f.trust.revoke('trust');
  if (kind === 'executable') writeFileSync(f.executable, 'other-test executable text');
  if (kind === 'root') { renameSync(f.root, join(f.parent, 'old')); mkdirSync(f.root); }
  if (kind === 'profile') f.profile.version++;
  if (kind === 'proof') f.backend.proof!.status = 'FAIL';
  if (kind === 'environment') (f.config.environment as Record<string, string>).LANG = 'changed';
  if (kind === 'implementation') f.backend.launchObserved = vi.fn();
  expect(() => f.authority.assertCurrent(binding, f.input)).toThrow('Verification execution basis changed.');
});

it('refuses foreign, cloned, cancelled and changed-owner read-side binding checks', async () => {
  const f = await fixture(), binding = await f.authority.describe(f.input);
  expect(() => f.authority.assertCurrent(structuredClone(binding), f.input)).toThrow(/binding is foreign/);
  expect(() => createVerificationBindingAuthority(f.config).assertCurrent(binding, f.input)).toThrow(/binding is foreign/);
  expect(() => f.authority.assertCurrent(binding, { ...f.input, owner: { ...f.owner, epoch: 9 } })).toThrow(/another owner/);
  const controller = new AbortController(); controller.abort();
  expect(() => f.authority.assertCurrent(binding, { ...f.input, signal: controller.signal })).toThrow(/cancelled/);
});

it('checks approved configuration file witnesses as well as executable witnesses', async () => {
  const f = await fixture(), path = join(f.root, 'build-config'); writeFileSync(path, 'approved config');
  await f.trust.decide({ trustId: 'trust', rootPath: f.root, approvedFiles: [{ path: 'tool', kind: 'executable' }, { path: 'build-config', kind: 'configuration' }], scope: { read: true, write: true, network: 'none' }, decision: 'trusted' });
  const binding = await f.authority.describe(f.input); writeFileSync(path, 'modified config');
  expect(() => f.authority.assertCurrent(binding, f.input)).toThrow('Verification execution basis changed.');
});

it('detects changed approved bytes when filesystem timestamps remain unchanged', async () => {
  const f = await fixture(), path = join(f.root, 'build-config'); writeFileSync(path, 'approved config');
  await f.trust.decide({ trustId: 'trust', rootPath: f.root, approvedFiles: [{ path: 'tool', kind: 'executable' }, { path: 'build-config', kind: 'configuration' }], scope: { read: true, write: true, network: 'none' }, decision: 'trusted' });
  const targetIdentity = lstatSync(path, { bigint: true }), originalStat = fs.lstatSync, originalFstat = fs.fstatSync;
  vi.spyOn(fs, 'lstatSync').mockImplementation(((target, options) => {
    const value = originalStat(target, options);
    if (target === path && value && 'mtimeNs' in value) Object.assign(value, { mtimeNs: 0n, ctimeNs: 0n });
    return value;
  }) as typeof fs.lstatSync);
  vi.spyOn(fs, 'fstatSync').mockImplementation(((fd, options) => {
    const value = originalFstat(fd, options);
    if (value.dev === targetIdentity.dev && value.ino === targetIdentity.ino && 'mtimeNs' in value) Object.assign(value, { mtimeNs: 0n, ctimeNs: 0n });
    return value;
  }) as typeof fs.fstatSync);
  const before = lstatSync(path, { bigint: true });
  const binding = await f.authority.describe(f.input);
  writeFileSync(path, 'modified config');
  const after = lstatSync(path, { bigint: true });
  for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'nlink'] as const) expect(after[key]).toBe(before[key]);
  expect(() => f.authority.assertCurrent(binding, f.input)).toThrow('Verification execution basis changed.');
  await expect(f.authority.take(binding, f.input)).rejects.toThrow();
});

it.each(['configuration', 'executable'] as const)('rejects an oversized %s witness without reading the oversized contents', async kind => {
  const f = await fixture(), path = kind === 'configuration' ? join(f.root, 'build-config') : join(f.parent, 'host-tool');
  writeFileSync(path, kind === 'configuration' ? 'approved config' : 'unit-test executable bytes');
  if (kind === 'configuration') await f.trust.decide({ trustId: 'trust', rootPath: f.root, approvedFiles: [{ path: 'tool', kind: 'executable' }, { path: 'build-config', kind: 'configuration' }], scope: { read: true, write: true, network: 'none' }, decision: 'trusted' });
  else (f.config.executables as { id: string; path: string }[])[0]!.path = path;
  truncateSync(path, (kind === 'configuration' ? MAX_APPROVED_FILE_BYTES : MAX_EXECUTABLE_BYTES) + 1);
  let bytesRead = 0;
  const originalRead = fs.readSync;
  vi.spyOn(fs, 'readSync').mockImplementation(((...args: Parameters<typeof fs.readSync>) => {
    const count = originalRead(...args); bytesRead += count; return count;
  }) as typeof fs.readSync);
  await expect(f.authority.describe(f.input)).rejects.toThrow();
  expect(bytesRead).toBeLessThan(1024);
});

it('rejects a configuration truncated after its last bytes were read', async () => {
  const f = await fixture(), path = join(f.root, 'build-config'); writeFileSync(path, 'approved config');
  await f.trust.decide({ trustId: 'trust', rootPath: f.root, approvedFiles: [{ path: 'tool', kind: 'executable' }, { path: 'build-config', kind: 'configuration' }], scope: { read: true, write: true, network: 'none' }, decision: 'trusted' });
  const binding = await f.authority.describe(f.input), target = lstatSync(path, { bigint: true });
  let truncated = false;
  const originalRead = fs.readSync;
  vi.spyOn(fs, 'readSync').mockImplementation(((...args: Parameters<typeof fs.readSync>) => {
    const count = originalRead(...args), identity = fs.fstatSync(args[0], { bigint: true });
    if (!truncated && count > 0 && identity.dev === target.dev && identity.ino === target.ino) { truncateSync(path, 0); truncated = true; }
    return count;
  }) as typeof fs.readSync);
  expect(() => f.authority.assertCurrent(binding, f.input)).toThrow('Verification execution basis changed.');
  expect(truncated).toBe(true);
});

it('rejects a byte appended after the measured length even when descriptor metadata is unchanged', async () => {
  const f = await fixture(), path = join(f.root, 'build-config'); writeFileSync(path, 'approved config');
  await f.trust.decide({ trustId: 'trust', rootPath: f.root, approvedFiles: [{ path: 'tool', kind: 'executable' }, { path: 'build-config', kind: 'configuration' }], scope: { read: true, write: true, network: 'none' }, decision: 'trusted' });
  const binding = await f.authority.describe(f.input);
  const target = lstatSync(path, { bigint: true }), originalFstat = fs.fstatSync, originalRead = fs.readSync;
  let appended = false;
  vi.spyOn(fs, 'fstatSync').mockImplementation(((fd, options) => {
    const value = originalFstat(fd, options);
    if (value.dev === target.dev && value.ino === target.ino && 'mtimeNs' in value)
      Object.assign(value, { size: target.size, mtimeNs: target.mtimeNs, ctimeNs: target.ctimeNs });
    return value;
  }) as typeof fs.fstatSync);
  vi.spyOn(fs, 'readSync').mockImplementation(((...args: Parameters<typeof fs.readSync>) => {
    const count = originalRead(...args), identity = originalFstat(args[0], { bigint: true });
    if (!appended && count === Number(target.size) && identity.dev === target.dev && identity.ino === target.ino) {
      appendFileSync(path, '!');
      appended = true;
    }
    return count;
  }) as typeof fs.readSync);
  expect(() => f.authority.assertCurrent(binding, f.input)).toThrow('Verification execution basis changed.');
  expect(appended).toBe(true);
});

it('rejects premature EOF before reading the measured length', async () => {
  const f = await fixture(), binding = await f.authority.describe(f.input);
  const target = lstatSync(f.executable, { bigint: true }), originalRead = fs.readSync;
  let prematureEof = false;
  vi.spyOn(fs, 'readSync').mockImplementation(((...args: Parameters<typeof fs.readSync>) => {
    const identity = fs.fstatSync(args[0], { bigint: true });
    if (!prematureEof && identity.dev === target.dev && identity.ino === target.ino) {
      prematureEof = true;
      return 0;
    }
    return originalRead(...args);
  }) as typeof fs.readSync);
  expect(() => f.authority.assertCurrent(binding, f.input)).toThrow('Verification execution basis changed.');
  expect(prematureEof).toBe(true);
});

it('rejects backend implementation replacement during asynchronous preparation', async () => {
  const f = await fixture(), verify = f.trust.verify.bind(f.trust);
  vi.spyOn(f.trust, 'verify').mockImplementation(async (...args) => { const result = await verify(...args); f.backend.launchObserved = vi.fn(); return result; });
  await expect(f.authority.describe(f.input)).rejects.toThrow(/changed/);
});

it('rejects cloned, wrong-owner and already-spent bindings', async () => {
  const f = await fixture(), binding = await f.authority.describe(f.input);
  await expect(f.authority.take(structuredClone(binding), f.input)).rejects.toThrow(/foreign/);
  await expect(f.authority.take(binding, { ...f.input, owner: { ...f.owner, epoch: 2 } })).rejects.toThrow(/another owner/);
  await f.authority.take(binding, f.input);
  await expect(f.authority.take(binding, f.input)).rejects.toThrow(/spent/);
});

it.each(['trust', 'executable', 'root', 'profile', 'proof', 'environment'] as const)('rejects %s changes after approval metadata was prepared', async kind => {
  const f = await fixture(), binding = await f.authority.describe(f.input);
  if (kind === 'trust') f.trust.revoke('trust');
  if (kind === 'executable') writeFileSync(f.executable, 'changed executable');
  if (kind === 'root') { renameSync(f.root, join(f.parent, 'old')); mkdirSync(f.root); writeFileSync(f.executable, 'unit-test executable bytes'); }
  if (kind === 'profile') f.profile.version++;
  if (kind === 'proof') f.backend.proof!.recordedAt = '2026-11-17T01:00:00.000Z';
  if (kind === 'environment') (f.config.environment as Record<string, string>).LANG = 'en_US.UTF-8';
  await expect(f.authority.take(binding, f.input)).rejects.toThrow();
  expect(f.backend.launchObserved).not.toHaveBeenCalled();
});

it('checks cancellation and owner changes after asynchronous trust verification', async () => {
  const f = await fixture();
  let finish!: () => void, current = true;
  const wait = new Promise<void>(resolve => { finish = resolve; });
  const verify = f.trust.verify.bind(f.trust);
  vi.spyOn(f.trust, 'verify').mockImplementation(async (...args) => { await wait; return verify(...args); });
  const pending = f.authority.describe({ ...f.input, assertCurrent: () => { if (!current) throw Error('stale owner'); } });
  await vi.waitFor(() => expect(f.trust.verify).toHaveBeenCalled());
  current = false; finish();
  await expect(pending).rejects.toThrow('stale owner');
  const controller = new AbortController(); controller.abort();
  await expect(f.authority.describe({ ...f.input, signal: controller.signal })).rejects.toThrow(/cancelled/);
});

it('rejects profile and trust revocation while preparation is awaiting the filesystem', async () => {
  const f = await fixture();
  const verify = f.trust.verify.bind(f.trust);
  vi.spyOn(f.trust, 'verify').mockImplementation(async (...args) => {
    const result = await verify(...args);
    f.backend.approved = false;
    return result;
  });
  await expect(f.authority.describe(f.input)).rejects.toThrow(/authority changed/);
});

it('rejects replacement backend implementations that reuse old proof metadata', async () => {
  const f = await fixture(), binding = await f.authority.describe(f.input);
  f.backend.launchObserved = vi.fn();
  await expect(f.authority.take(binding, f.input)).rejects.toThrow(/environment changed/);
});

it.each(['missing', 'unapproved', 'wrong-platform', 'no-evidence', 'unobserved'] as const)('blocks %s backends without a fallback launch', async kind => {
  const f = await fixture();
  if (kind === 'missing') (f.config as { approvedBackendId: string | null }).approvedBackendId = null;
  if (kind === 'unapproved') f.backend.approved = false;
  if (kind === 'wrong-platform') f.backend.proof!.platform = process.platform === 'win32' ? 'linux' : 'win32';
  if (kind === 'no-evidence') delete f.backend.proof!.evidenceRef;
  if (kind === 'unobserved') (f.backend as unknown as { launchObserved: undefined }).launchObserved = undefined;
  await expect(f.authority.describe(f.input)).rejects.toThrow();
  expect(f.backend.launch).not.toHaveBeenCalled();
});

it('rejects unrestricted profiles, foreign roots, arbitrary executable ids and browser origins', async () => {
  const f = await fixture();
  await expect(f.authority.describe({ ...f.input, executableIds: ['caller-path'] })).rejects.toThrow(/executable/i);
  await expect(f.authority.describe({ ...f.input, approvedOrigins: ['https://outside.example'] })).rejects.toThrow(/origins/);
  f.profile.writeRoots = [f.parent];
  await expect(f.authority.describe(f.input)).rejects.toThrow(/roots/);
  f.profile.writeRoots = []; f.profile.profileId = 'TRUSTED_HOST';
  await expect(f.authority.describe({ ...f.input, profileId: 'TRUSTED_HOST' })).rejects.toThrow(/confined/);
});
