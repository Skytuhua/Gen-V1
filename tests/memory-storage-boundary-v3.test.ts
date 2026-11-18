import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { chmod, link, lstat, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { ResourceGrant } from '../packages/contracts/index.ts';
import * as security from '../packages/core/security.ts';
import { withResourceGrant } from '../packages/core/file-access.ts';

const guard = vi.hoisted(() => ({ paths: [] as { path: string; leaf: boolean }[] }));
// This fixture verifies that the application asks for the namespace pin. It is
// deliberately not evidence of native Windows or Linux custody enforcement.
vi.mock('../packages/core/linux-path-guard.ts', () => ({
  withLinuxDirectoryGuard: async (paths: { path: string; leaf: boolean }[], _signal: AbortSignal, action: (session: unknown, entries: unknown[]) => Promise<unknown>) => {
    guard.paths = paths;
    return action({ exited: false, loss: new Set(), rpc: async () => [] }, []);
  },
}));

const roots: string[] = [];
afterEach(async () => { guard.paths = []; for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'm05-storage-'))); roots.push(root);
  const profile = join(root, 'profile'); await mkdir(profile);
  const ordinary = join(root, 'ordinary.txt'); await writeFile(ordinary, 'ordinary task source');
  const grant = (path: string, writable = true): ResourceGrant => ({ id: 'grant-1', threadId: 'thread-1', kind: 'file', path, writable, label: basename(path), createdAt: '2026-11-15T10:00:00.000Z' });
  return { root, profile, ordinary, grant };
}
function ledgerPath(profile: string) {
  expect(security.projectMemoryDeletionLedgerPath, 'M05 requires one canonical host-owned external deletion path').toBeTypeOf('function');
  return security.projectMemoryDeletionLedgerPath(profile);
}

it('denies the legacy deletion mirror through direct and ancestor resource grants', async () => {
  const f = await fixture(), legacy = join(f.profile, 'project-memory-deletions.jsonl');
  await writeFile(legacy, 'synthetic deletion fence', { mode: 0o600 });
  for (const write of [false, true]) {
    await expect(security.resolveGrant(f.grant(legacy), undefined, write, f.profile)).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
    await expect(security.resolveGrant(f.grant(f.root), 'profile/project-memory-deletions.jsonl', write, f.profile)).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
  }
  await expect(security.resolveGrant(f.grant(f.ordinary), undefined, false, f.profile)).resolves.toBe(f.ordinary);
});

it('derives the sibling fence from the canonical profile instead of a restored identity', async () => {
  const f = await fixture(), alias = join(f.root, 'profile-alias');
  await symlink(f.profile, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const canonical = await realpath(f.profile), key = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
  const expected = join(dirname(canonical), '.gen-memory-deletions-' + createHash('sha256').update(key, 'utf8').digest('hex') + '.jsonl');
  expect(ledgerPath(f.profile)).toBe(expected);
  expect(ledgerPath(alias)).toBe(expected);
  expect(dirname(expected)).not.toBe(canonical);
});

it('denies sibling ledger reads and writes through direct, ancestor and not-yet-created paths', async () => {
  const f = await fixture(), ledger = ledgerPath(f.profile);
  await expect(security.resolveGrant(f.grant(f.root), basename(ledger), true, f.profile)).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
  await writeFile(ledger, 'synthetic deletion fence', { mode: 0o600 });
  for (const write of [false, true]) {
    await expect(security.resolveGrant(f.grant(ledger), undefined, write, f.profile)).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
    await expect(security.resolveGrant(f.grant(f.root), basename(ledger), write, f.profile)).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
  }
  await expect(security.resolveGrant(f.grant(f.root), basename(f.ordinary), true, f.profile)).resolves.toBe(f.ordinary);
});

it('reserves the deletion-ledger namespace across profile scopes', async () => {
  const f = await fixture(), peerLedger = join(f.root, '.gen-memory-deletions-' + 'f'.repeat(64) + '.jsonl');
  await writeFile(peerLedger, 'other profile deletion fence', { mode: 0o600 });
  await expect(security.resolveGrant(f.grant(f.root), basename(peerLedger), false, f.profile)).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
  const alias = join(f.root, 'public-alias.txt'); await symlink(peerLedger, alias, process.platform === 'win32' ? 'file' : undefined);
  await expect(security.resolveGrant(f.grant(alias), undefined, false, f.profile)).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
});

it.each(['symlink', 'hardlink', 'directory'] as const)('fails resource admission closed when the current ledger is a %s', async attack => {
  const f = await fixture(), ledger = ledgerPath(f.profile);
  if (attack === 'symlink') await symlink(f.ordinary, ledger, process.platform === 'win32' ? 'file' : undefined);
  else if (attack === 'hardlink') await link(f.ordinary, ledger);
  else await mkdir(ledger);
  await expect(security.resolveGrant(f.grant(f.ordinary), undefined, false, f.profile)).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
  expect((await lstat(ledger)).isSymbolicLink()).toBe(attack === 'symlink');
});

it.skipIf(process.platform === 'win32')('requires the current deletion ledger to retain private POSIX permissions', async () => {
  const f = await fixture(), ledger = ledgerPath(f.profile);
  await writeFile(ledger, 'synthetic deletion fence', { mode: 0o600 });
  await chmod(ledger, 0o644);
  await expect(security.resolveGrant(f.grant(f.ordinary), undefined, false, f.profile)).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
});

it.skipIf(process.platform !== 'linux')('requests the canonical ledger-parent namespace pin before an ordinary grant action', async () => {
  const f = await fixture(), ledger = ledgerPath(f.profile);
  await writeFile(ledger, 'synthetic deletion fence', { mode: 0o600 });
  let invoked = false;
  await withResourceGrant(f.grant(f.ordinary), f.profile, undefined, false, new AbortController().signal, async path => {
    invoked = true; expect(path).toBe(f.ordinary);
    expect(guard.paths).toContainEqual({ path: dirname(ledger), leaf: false });
  });
  expect(invoked).toBe(true);
});

it.each([
  ['environment/values.json', '{"version":1,"revision":0,"entries":[]}'],
  ['checkpoint-store/blobs/' + 'a'.repeat(64), 'retained checkpoint bytes'],
  ['effect-authority/key.json', 'synthetic protected host key payload'],
])('denies private %s through direct and ancestor grants', async (relativePath, contents) => {
  const f = await fixture(), target = join(f.profile, relativePath);
  await mkdir(dirname(target), { recursive: true }); await writeFile(target, contents);
  for (const write of [false, true]) {
    await expect(security.resolveGrant(f.grant(target), undefined, write, f.profile)).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
    await expect(security.resolveGrant(f.grant(f.root), 'profile/' + relativePath, write, f.profile)).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
  }
  await expect(security.resolveGrant(f.grant(f.ordinary), undefined, false, f.profile)).resolves.toBe(f.ordinary);
});
