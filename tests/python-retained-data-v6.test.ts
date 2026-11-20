import { afterEach, describe, expect, it, vi } from 'vitest';
import { link, lstat, mkdir, mkdtemp, open, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// Owned temporary fixtures only. These tests exercise the shared structural
// walk used by the Python worker before launch and after the stopped-state
// proof; they do not run the native interpreter or claim a platform proof.
const unavailable = new Set<string>();
vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, lstat: (async (path: string, options?: { bigint?: boolean }) => {
    const info = await actual.lstat(path, options as { bigint: true });
    return unavailable.has(path) ? Object.assign(Object.create(Object.getPrototypeOf(info)), info, { blocks: undefined }) : info;
  }) as typeof actual.lstat };
});
const { inspectPythonPrivateDirectory, PYTHON_RETAINED_DATA_LIMITS, PYTHON_PREFLIGHT_DIRECTORY_LIMITS } = await import('../packages/runtime/python-program-worker.ts');

const CEILING = 67_108_864n;
const roots: string[] = [];
async function root(): Promise<string> { const value = await mkdtemp(join(tmpdir(), 'm12-retained-')); roots.push(value); return value; }
async function filled(path: string, bytes: number): Promise<void> {
  const handle = await open(path, 'w'); const chunk = Buffer.alloc(1024 * 1024, 7);
  try { for (let written = 0; written < bytes;) { const size = Math.min(chunk.length, bytes - written); await handle.write(chunk, 0, size); written += size; } await handle.sync(); }
  finally { await handle.close(); }
}
const allocated = async (...paths: string[]) => { let total = 0n; for (const path of paths) total += (await lstat(path, { bigint: true })).blocks * 512n; return total; };
afterEach(async () => { unavailable.clear(); await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

// Cases marked linuxFs need Linux filesystem semantics: truncate() leaves a
// sparse file, ext4 charges block-map metadata to a dense file, and mkfifo makes
// a FIFO. On Windows, libuv reports st_blocks as NTFS AllocationSize/512, so a
// truncated file is fully allocated, a dense 64 MiB file is exactly 64 MiB and
// there are no FIFOs. Each such case keeps its full Linux assertions; every
// platform-neutral case, including both ceilings, still runs everywhere.
const linuxFs = process.platform === 'linux';

describe('M12 Python retained-data accounting (accepted retained state, not a filesystem quota)', () => {
  it('pins separate inclusive 64 MiB ceilings for logical and allocated bytes and refuses looser overrides', async () => {
    expect(PYTHON_RETAINED_DATA_LIMITS).toEqual({ maxLogicalBytes: CEILING, maxAllocatedBytes: CEILING });
    expect(Object.isFrozen(PYTHON_RETAINED_DATA_LIMITS)).toBe(true);
    expect(PYTHON_PREFLIGHT_DIRECTORY_LIMITS).toEqual({ maxEntries: 4096, maxDepth: 32 });
    await expect(inspectPythonPrivateDirectory(tmpdir(), undefined, { maxLogicalBytes: CEILING + 1n, maxAllocatedBytes: CEILING }))
      .rejects.toMatchObject({ code: 'PYTHON_RETAINED_DATA_UNAVAILABLE' });
    await expect(inspectPythonPrivateDirectory(tmpdir(), undefined, { maxLogicalBytes: CEILING, maxAllocatedBytes: CEILING + 1n }))
      .rejects.toMatchObject({ code: 'PYTHON_RETAINED_DATA_UNAVAILABLE' });
  });

  it('admits exactly 64 MiB of logical length and refuses one byte more', async () => {
    const dir = await root(), file = join(dir, 'sparse.bin');
    await writeFile(file, ''); await truncate(file, Number(CEILING));
    const accounting = await inspectPythonPrivateDirectory(dir);
    expect(accounting).toMatchObject({ entries: 2, maxDepth: 1, regularFiles: 1, logicalBytes: CEILING });
    expect(accounting.allocatedBytes).toBeLessThanOrEqual(CEILING);
    await truncate(file, Number(CEILING) + 1);
    await expect(inspectPythonPrivateDirectory(dir)).rejects.toMatchObject({ code: 'PYTHON_RETAINED_DATA_LIMIT' });
  });

  it.runIf(linuxFs)('refuses one logical byte over 64 MiB on the logical ceiling while sparse allocation stays below its own', async () => {
    const dir = await root(), file = join(dir, 'sparse.bin');
    await writeFile(file, ''); await truncate(file, Number(CEILING));
    const accounting = await inspectPythonPrivateDirectory(dir);
    expect(accounting).toMatchObject({ entries: 2, maxDepth: 1, regularFiles: 1, logicalBytes: CEILING });
    expect(accounting.allocatedBytes).toBeLessThan(CEILING);
    await truncate(file, Number(CEILING) + 1);
    await expect(inspectPythonPrivateDirectory(dir)).rejects.toMatchObject({ code: 'PYTHON_RETAINED_DATA_LIMIT', message: expect.stringMatching(/logical/) });
  });

  it('sums logical length across nested files', async () => {
    const dir = await root(); await mkdir(join(dir, 'a', 'b'), { recursive: true });
    await writeFile(join(dir, 'one'), ''); await truncate(join(dir, 'one'), Number(CEILING / 2n));
    await writeFile(join(dir, 'a', 'b', 'two'), ''); await truncate(join(dir, 'a', 'b', 'two'), Number(CEILING / 2n));
    expect((await inspectPythonPrivateDirectory(dir)).logicalBytes).toBe(CEILING);
    await writeFile(join(dir, 'a', 'one-more'), 'x');
    await expect(inspectPythonPrivateDirectory(dir)).rejects.toMatchObject({ code: 'PYTHON_RETAINED_DATA_LIMIT' });
  });

  it('applies the allocated-bytes ceiling inclusively at the exact measured boundary', async () => {
    const dir = await root(), file = join(dir, 'data.bin');
    await filled(file, 3 * 1024 * 1024 + 17);
    const measured = await allocated(dir, file);
    const accounting = await inspectPythonPrivateDirectory(dir);
    expect(accounting.allocatedBytes).toBe(measured);
    expect(accounting.allocatedBytes % 512n).toBe(0n);
    await expect(inspectPythonPrivateDirectory(dir, undefined, { maxLogicalBytes: CEILING, maxAllocatedBytes: measured })).resolves.toMatchObject({ allocatedBytes: measured });
    await expect(inspectPythonPrivateDirectory(dir, undefined, { maxLogicalBytes: CEILING, maxAllocatedBytes: measured - 1n }))
      .rejects.toMatchObject({ code: 'PYTHON_RETAINED_DATA_LIMIT', message: expect.stringMatching(/allocated/) });
  });

  it.runIf(linuxFs)('refuses real allocated data over 64 MiB even while logical length stays within its ceiling', async () => {
    const dir = await root(), file = join(dir, 'dense.bin');
    await filled(file, Number(CEILING));
    expect((await lstat(file)).size).toBe(Number(CEILING));
    expect(await allocated(dir, file)).toBeGreaterThan(CEILING);
    await expect(inspectPythonPrivateDirectory(dir)).rejects.toMatchObject({ code: 'PYTHON_RETAINED_DATA_LIMIT', message: expect.stringMatching(/allocated/) });
  });

  it('never adds the two metrics together', async () => {
    const dir = await root(); await filled(join(dir, 'dense.bin'), 40 * 1024 * 1024);
    const accounting = await inspectPythonPrivateDirectory(dir);
    expect(accounting.logicalBytes + accounting.allocatedBytes).toBeGreaterThan(CEILING);
    expect(accounting.logicalBytes).toBeLessThanOrEqual(CEILING);
    expect(accounting.allocatedBytes).toBeLessThanOrEqual(CEILING);
  });

  it('fails closed when size accounting is unavailable instead of counting zero', async () => {
    const dir = await root(), file = join(dir, 'file'); await writeFile(file, 'x');
    unavailable.add(file);
    await expect(inspectPythonPrivateDirectory(dir)).rejects.toMatchObject({ code: 'PYTHON_RETAINED_DATA_UNAVAILABLE' });
  });

  it('fails closed when the directory disappears during accounting', async () => {
    await expect(inspectPythonPrivateDirectory(join(await root(), 'missing'))).rejects.toMatchObject({ code: 'PYTHON_RETAINED_DATA_UNAVAILABLE' });
  });

  it.runIf(linuxFs)('keeps the existing special-file refusal for a FIFO', async () => {
    const special = await root(); execFileSync('mkfifo', [join(special, 'pipe')]);
    expect((await lstat(join(special, 'pipe'))).isFIFO()).toBe(true);
    await expect(inspectPythonPrivateDirectory(special)).rejects.toMatchObject({ code: 'PYTHON_PROFILE_DENIED' });
  });

  it('keeps the existing link, entry and depth refusals', async () => {
    const linked = await root(); await writeFile(join(linked, 'a'), 'x'); await symlink(join(linked, 'a'), join(linked, 'b'));
    await expect(inspectPythonPrivateDirectory(linked)).rejects.toMatchObject({ code: 'PYTHON_PROFILE_DENIED' });
    const hard = await root(); await writeFile(join(hard, 'a'), 'x'); await link(join(hard, 'a'), join(hard, 'b'));
    await expect(inspectPythonPrivateDirectory(hard)).rejects.toMatchObject({ code: 'PYTHON_PROFILE_DENIED' });
    const wide = await root(); await Promise.all(Array.from({ length: 4095 }, (_, i) => writeFile(join(wide, `f${i}`), '')));
    await expect(inspectPythonPrivateDirectory(wide)).resolves.toMatchObject({ entries: 4096 });
    await writeFile(join(wide, 'extra'), '');
    await expect(inspectPythonPrivateDirectory(wide)).rejects.toMatchObject({ code: 'PYTHON_DIRECTORY_LIMIT' });
    const deep = await root(); let path = deep; for (let i = 0; i < 32; i++) path = join(path, 'd');
    await mkdir(path, { recursive: true });
    await expect(inspectPythonPrivateDirectory(deep)).resolves.toMatchObject({ maxDepth: 32 });
    await mkdir(join(path, 'd'));
    await expect(inspectPythonPrivateDirectory(deep)).rejects.toMatchObject({ code: 'PYTHON_DIRECTORY_LIMIT' });
  });

  it('stops traversal at the checkpoint before another filesystem operation', async () => {
    const dir = await root(); for (let i = 0; i < 8; i++) await writeFile(join(dir, `f${i}`), 'x');
    let calls = 0;
    const cancelled = Object.assign(new Error('cancelled'), { code: 'PROGRAM_CANCELLED' });
    const { HarnessError } = await import('../packages/contracts/index.ts');
    await expect(inspectPythonPrivateDirectory(dir, () => { if (++calls > 5) throw new HarnessError('PROGRAM_CANCELLED', cancelled.message); }))
      .rejects.toMatchObject({ code: 'PROGRAM_CANCELLED' });
    expect(calls).toBe(6);
  });
});
