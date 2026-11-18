import { afterEach, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../packages/storage/store';
import type { ResourceGrant, Thread } from '../packages/contracts';
import { createRepositoryMapReader } from '../packages/core/repository-map-host';

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0)) close(); });
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'm04-repo-map-custody-')), root = join(directory, 'project'); mkdirSync(root);
  const store = new Store(join(directory, 'profile')), ctx = { threadId: 'thread', runId: 'run', epoch: 1 };
  writeFileSync(join(root, 'one.ts'), 'export const one = 1;'); writeFileSync(join(root, 'two.ts'), 'export const two = 2;');
  const info = statSync(root, { bigint: true });
  const grant: ResourceGrant = { id: 'project', threadId: 'thread', kind: 'project', path: root, label: 'Project', writable: false, createdAt: '', identity: { dev: String(info.dev), ino: String(info.ino) } };
  store.internal('fixture', 'thread', () => {
    store.put('thread', 'thread', 'thread', { id: 'thread', title: 'Fixture', status: 'working', modelId: 'test/model', accountId: null, sessionPath: null, ...ctx });
    store.put('resource', grant.id, grant.threadId, grant);
  });
  const reader = createRepositoryMapReader(), access = { store, ctx, signal: new AbortController().signal, owner: () => store.get<Thread>('thread', 'thread')! };
  cleanup.push(() => { reader.clear(); store.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 5 }); });
  return { store, root, reader, access, grant };
}

it.skipIf(process.platform !== 'win32')('retains all actual native file guards through map publication', async () => {
  const f = fixture();
  await f.reader.read(f.access, { resourceId: 'project', paths: ['one.ts', 'two.ts'] }, async value => {
    expect((value as any).files.map((file: any) => file.exports[0].name)).toEqual(['one', 'two']);
    await expect(writeFile(join(f.root, 'one.ts'), 'Changed during publication')).rejects.toBeDefined();
    await expect(writeFile(join(f.root, 'two.ts'), 'Changed during publication')).rejects.toBeDefined();
  });
  await expect(writeFile(join(f.root, 'one.ts'), 'Changed after publication')).resolves.toBeUndefined();
});

it.skipIf(process.platform !== 'win32')('binds a fresh read to changed source bytes instead of returning the old parsed entry', async () => {
  const f = fixture(), read = () => f.reader.read(f.access, { resourceId: 'project', paths: ['one.ts'] }, value => value as any);
  const before = await read(); await writeFile(join(f.root, 'one.ts'), 'export const changed = 3;'); const after = await read();
  expect(before.files[0].sha256).not.toBe(after.files[0].sha256); expect(after.files[0].exports).toEqual([{ name: 'changed', line: 1 }]);
});

it.skipIf(process.platform !== 'win32')('denies a private native-history target behind a real directory junction', async () => {
  const f = fixture(); mkdirSync(join(f.root, '.hermes'));
  writeFileSync(join(f.root, '.hermes', 'entry.ts'), "export { history } from 'PRIVATE_HISTORY_ID';\n");
  symlinkSync(join(f.root, '.hermes'), join(f.root, 'visible'), 'junction');
  const value = await f.reader.read(f.access, { resourceId: 'project', paths: ['visible/entry.ts'] }, value => value as any);
  expect(value).toMatchObject({ files: [], readBytes: 0, exclusions: [{ path: 'visible/entry.ts', reason: 'DENIED_SOURCE' }] });
  expect(JSON.stringify(value)).not.toContain('PRIVATE_HISTORY_ID');
});

it.skipIf(process.platform === 'win32')('reports actual unavailable native custody without parsing source bytes through a fallback reader', async () => {
  const f = fixture(), value = await f.reader.read(f.access, { resourceId: 'project', paths: ['one.ts'] }, value => value as any);
  expect(value.files).toEqual([]); expect(value.readBytes).toBe(0);
  expect(value.exclusions).toEqual([{ path: 'one.ts', reason: 'UNAVAILABLE_CUSTODY' }]);
});
