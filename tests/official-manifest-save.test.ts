import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ failRename: false }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (from: string, to: string) => {
      if (fake.failRename) throw Object.assign(new Error('simulated rename failure'), { code: 'EIO' });
      return actual.rename(from, to);
    },
  };
});

const { openManifest, saveManifest } = await import('../packages/runtime-official/manifest.ts');

it('removes the uncommitted draft and keeps the previous manifest when an atomic save fails', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'official-manifest-draft-'));
  const state = await openManifest(dataDir, 'cursor-sdk', 'thread', null);
  const previous = await readFile(state.path, 'utf8');
  state.value.inputs['input-uuid'] = { inputIds: ['input'], runId: 'run', epoch: 1, observed: false };
  fake.failRename = true;
  try { await expect(saveManifest(state)).rejects.toMatchObject({ code: 'EIO' }); }
  finally { fake.failRename = false; }
  const drafts = (await readdir(dirname(state.path))).filter(name => name.startsWith('.session-') && name.endsWith('.tmp'));
  expect(drafts).toEqual([]);
  expect(await readFile(state.path, 'utf8')).toBe(previous);
});
