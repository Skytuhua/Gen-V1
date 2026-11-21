import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rename, symlink, link, unlink, lstat, open, rm, stat, utimes, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename, dirname, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as access from '../packages/core/file-access.ts';
import { withLinuxBoundFileRead } from '../packages/core/linux-file-read.ts';
import type { ResourceGrant } from '../packages/contracts/index.ts';

type BoundRead = <T>(path: string, signal: AbortSignal, action: (descriptorPath: string) => Promise<T>, identity?: { dev: string; ino: string }) => Promise<T>;
type ResourceRead = (grant: ResourceGrant, dataDir: string, relativePath: string | undefined, maxBytes: number, signal: AbortSignal) => Promise<{ path: string; bytes: Buffer }>;
function resourceRead(): ResourceRead {
  const implementation = (access as unknown as { readResourceGrant?: ResourceRead }).readResourceGrant;
  expect(implementation, 'Granted byte reads must preserve the logical source path').toBeTypeOf('function');
  return implementation!;
}
function boundRead(): BoundRead {
  const implementation = (access as unknown as { withBoundFileRead?: BoundRead }).withBoundFileRead;
  expect(implementation, 'A descriptor-bound regular-file read API is required').toBeTypeOf('function');
  return implementation!;
}
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'm12-linux-bound-read-')); directories.push(directory);
  const source = join(directory, 'source'), storage = join(directory, 'storage');
  await mkdir(source); await mkdir(storage);
  const filename = join(source, 'notes.txt'); await writeFile(filename, 'ordinary granted text');
  const info = await lstat(filename, { bigint: true });
  const grant: ResourceGrant = { id: 'read-grant', threadId: 'thread', path: filename, label: 'Source', kind: 'file', writable: false,
    identity: { dev: String(info.dev), ino: String(info.ino) }, createdAt: '' };
  return { directory, source, storage, filename, info, grant, signal: new AbortController().signal };
}
const denied = { code: 'CAPABILITY_DENIED' };

describe.runIf(process.platform === 'linux')('Linux native descriptor-bound regular-file reads', () => {
  it('reads through the retained real descriptor and closes it after the scope', async () => {
    const f = await fixture(); let descriptor = '';
    const text = await boundRead()(f.filename, f.signal, async path => {
      descriptor = path; expect(path).toMatch(/^\/proc\/self\/fd\/\d+$/);
      return (await access.readBoundFile(path, 4096)).toString('utf8');
    }, f.grant.identity);
    expect(text).toBe('ordinary granted text');
    await expect(stat(descriptor)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('performs an actual granted read without an execution profile or private credential broker', async () => {
    const f = await fixture();
    const result = await resourceRead()(f.grant, f.storage, undefined, 4096, f.signal);
    expect(result.bytes.toString('utf8')).toBe('ordinary granted text');
    expect(result.path).toBe(f.filename);
  });

  it('preserves source basename, directory, extension and bytes without modifying the resource', async () => {
    const f = await fixture(), before = await stat(f.filename, { bigint: true }), entries = await readdir(f.source);
    const result = await resourceRead()(f.grant, f.storage, undefined, 4096, f.signal);
    expect({ path: result.path, basename: basename(result.path), directory: dirname(result.path), extension: extname(result.path) }).toEqual({
      path: f.filename, basename: 'notes.txt', directory: f.source, extension: '.txt',
    });
    expect(result.path).not.toContain('/proc/');
    const after = await stat(f.filename, { bigint: true });
    expect([after.dev, after.ino, after.size, after.mtimeNs, after.ctimeNs]).toEqual([before.dev, before.ino, before.size, before.mtimeNs, before.ctimeNs]);
    expect(await readdir(f.source)).toEqual(entries);
    expect(await readFile(f.filename)).toEqual(result.bytes);
  });

  it.each(['leaf', 'ancestor', 'magic'] as const)('rejects a %s symlink before entering the read callback', async kind => {
    const f = await fixture(); let called = false, filename = f.filename;
    let held: Awaited<ReturnType<typeof open>> | undefined;
    if (kind === 'leaf') { filename = join(f.directory, 'leaf-link'); await symlink(f.filename, filename); }
    if (kind === 'ancestor') { const alias = join(f.directory, 'alias'); await symlink(f.source, alias); filename = join(alias, 'notes.txt'); }
    if (kind === 'magic') { held = await open(f.filename, 'r'); filename = '/proc/self/fd/' + held.fd; }
    try { await expect(boundRead()(filename, f.signal, async () => { called = true; return ''; })).rejects.toMatchObject(denied); }
    finally { await held?.close(); }
    expect(called).toBe(false);
  });

  it.each(['leaf', 'ancestor'] as const)('rejects %s replacement after descriptor acquisition without reading substituted content', async kind => {
    const f = await fixture(); const secret = join(f.directory, 'not-granted.txt'); await writeFile(secret, 'PRIVATE_SUBSTITUTED_CONTENT');
    await expect(boundRead()(f.filename, f.signal, async path => {
      if (kind === 'leaf') { await rename(f.filename, f.filename + '.old'); await symlink(secret, f.filename); }
      else { await rename(f.source, f.source + '.old'); await mkdir(f.source); await symlink(secret, f.filename); }
      return access.readBoundFile(path, 4096);
    })).rejects.toMatchObject(denied);
  });

  it('rejects an inode identity that differs from the captured grant', async () => {
    const f = await fixture();
    await expect(boundRead()(f.filename, f.signal, async path => access.readBoundFile(path, 4096),
      { dev: f.grant.identity!.dev, ino: String(BigInt(f.grant.identity!.ino) + 1n) })).rejects.toMatchObject(denied);
  });

  it('rejects hardlinks both before and after the read scope starts', async () => {
    const f = await fixture(), alias = join(f.directory, 'alias.txt');
    await link(f.filename, alias);
    await expect(boundRead()(f.filename, f.signal, async path => access.readBoundFile(path, 4096))).rejects.toMatchObject(denied);
    await unlink(alias);
    await expect(boundRead()(f.filename, f.signal, async path => {
      await link(f.filename, alias); return access.readBoundFile(path, 4096);
    })).rejects.toMatchObject(denied);
  });

  it('rejects in-place edits even if the original modification time is restored', async () => {
    const f = await fixture(), before = await stat(f.filename);
    await expect(boundRead()(f.filename, f.signal, async path => {
      await writeFile(f.filename, 'modified source bytes'); await utimes(f.filename, before.atime, before.mtime);
      return access.readBoundFile(path, 4096);
    })).rejects.toMatchObject(denied);
  });

  it('denies a different pathname passed to readBoundFile inside a limited scope', async () => {
    const f = await fixture(), other = join(f.directory, 'other.txt'); await writeFile(other, 'OTHER_PRIVATE_VALUE');
    await expect(boundRead()(f.filename, f.signal, async () => access.readBoundFile(other, 4096))).rejects.toMatchObject(denied);
  });

  it('preserves protected-storage rejection for direct, symlinked and hardlinked targets', async () => {
    const f = await fixture(), accounts = join(f.storage, 'accounts'); await mkdir(accounts);
    const credential = join(accounts, 'auth.json'); await writeFile(credential, 'PRIVATE_CREDENTIAL');
    for (const [kind, candidate] of [['direct', credential], ['symlink', join(f.source, 'link.json')], ['hardlink', join(f.source, 'hard.json')]]) {
      if (kind === 'symlink') await symlink(credential, candidate!);
      if (kind === 'hardlink') await link(credential, candidate!);
      const info = await stat(candidate!, { bigint: true });
      const grant = { ...f.grant, path: candidate!, identity: { dev: String(info.dev), ino: String(info.ino) } };
      await expect(resourceRead()(grant, f.storage, undefined, 4096, f.signal)).rejects.toMatchObject(denied);
    }
  });

  it('rejects protected directory redirection before opening a granted file', async () => {
    const f = await fixture(); await symlink(f.source, join(f.storage, 'accounts'));
    await expect(resourceRead()(f.grant, f.storage, undefined, 4096, f.signal)).rejects.toMatchObject(denied);
  });

  it('holds the storage ancestry witness for the entire read scope', async () => {
    const f = await fixture(), storage = await stat(f.storage, { bigint: true });
    await expect(withLinuxBoundFileRead(f.filename, f.signal, async path => {
      await rename(f.storage, f.storage + '.moved'); await mkdir(f.storage);
      return access.readBoundFile(path, 4096);
    }, { witnesses: [{ path: f.storage, dev: String(storage.dev), ino: String(storage.ino) }] })).rejects.toMatchObject(denied);
  });

  it('checks a directory grant identity and rejects relative traversal', async () => {
    const f = await fixture(), info = await stat(f.source, { bigint: true });
    const grant = { ...f.grant, kind: 'project' as const, path: f.source, identity: { dev: String(info.dev), ino: String(info.ino) } };
    expect((await resourceRead()(grant, f.storage, 'notes.txt', 4096, f.signal)).bytes.toString()).toBe('ordinary granted text');
    await expect(resourceRead()(grant, f.storage, '../source/../not-granted.txt', 4096, f.signal)).rejects.toBeDefined();
    await rename(f.source, f.source + '.old'); await mkdir(f.source); await writeFile(f.filename, 'replacement');
    await expect(resourceRead()(grant, f.storage, 'notes.txt', 4096, f.signal)).rejects.toMatchObject(denied);
  });

  it('enforces byte limits and aborts before returning bytes', async () => {
    const f = await fixture();
    await expect(boundRead()(f.filename, f.signal, path => access.readBoundFile(path, 3))).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
    const cancelled = new AbortController(); cancelled.abort(); let called = false;
    await expect(boundRead()(f.filename, cancelled.signal, async () => { called = true; return ''; })).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(called).toBe(false);
    const active = new AbortController();
    await expect(boundRead()(f.filename, active.signal, async path => {
      active.abort(); return access.readBoundFile(path, 4096);
    })).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('rejects directories and FIFOs without blocking, and retains the original namespace guard refusal', async () => {
    const f = await fixture();
    await expect(boundRead()(f.source, f.signal, path => access.readBoundFile(path, 4096))).rejects.toMatchObject(denied);
    const fifo = join(f.source, 'fifo'); const made = spawnSync('/usr/bin/mkfifo', [fifo], { encoding: 'utf8' });
    expect(made.status, made.stderr).toBe(0);
    await expect(boundRead()(fifo, f.signal, path => access.readBoundFile(path, 4096))).rejects.toMatchObject(denied);
    await expect(access.withPathGuard([{ path: f.filename, leaf: true, readOnly: true }], f.signal,
      async () => readFile(f.filename))).rejects.toMatchObject(denied);
  });

  // Synthetic owned profile: harness storage and attachments are created inside
  // the test's own temporary directory; no real profile or host file is read.
  async function attachmentFixture() {
    const f = await fixture();
    const own = join(f.storage, 'attachments', 'thread'), other = join(f.storage, 'attachments', 'other-thread');
    await mkdir(own, { recursive: true }); await mkdir(other, { recursive: true });
    const mine = join(own, 'upload-notes.txt'), theirs = join(other, 'upload-notes.txt'), database = join(f.storage, 'harness.sqlite');
    await writeFile(mine, 'own synthetic attachment'); await writeFile(theirs, 'other synthetic attachment'); await writeFile(database, 'synthetic storage');
    const grantFor = async (path: string, kind: ResourceGrant['kind']): Promise<ResourceGrant> => {
      const info = await lstat(path, { bigint: true });
      return { id: 'attachment-grant', threadId: 'thread', path, label: basename(path), kind, writable: false, createdAt: '', identity: { dev: String(info.dev), ino: String(info.ino) } };
    };
    return { ...f, own, mine, theirs, database, grantFor };
  }

  it('reads a conversation\'s own uploaded attachment through the canonical grant root', async () => {
    const f = await attachmentFixture();
    const result = await resourceRead()(await f.grantFor(f.mine, 'attachment'), f.storage, undefined, 4096, f.signal);
    expect(result.bytes.toString('utf8')).toBe('own synthetic attachment');
    expect(result.path).toBe(f.mine);
  });

  it('keeps protected storage and another conversation\'s attachments denied', async () => {
    const f = await attachmentFixture();
    // A grant rooted at the whole attachment folder is not the owning conversation's folder.
    const folder = await f.grantFor(join(f.storage, 'attachments'), 'project');
    await expect(resourceRead()(folder, f.storage, 'other-thread/upload-notes.txt', 4096, f.signal)).rejects.toMatchObject(denied);
    await expect(resourceRead()(await f.grantFor(f.storage, 'project'), f.storage, 'harness.sqlite', 4096, f.signal)).rejects.toMatchObject(denied);
    await expect(resourceRead()(await f.grantFor(f.database, 'file'), f.storage, undefined, 4096, f.signal)).rejects.toMatchObject(denied);
    // The own-conversation grant cannot step out to a sibling conversation.
    await expect(resourceRead()(await f.grantFor(f.own, 'project'), f.storage, '../other-thread/upload-notes.txt', 4096, f.signal)).rejects.toMatchObject(denied);
  });
});
