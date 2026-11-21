import {afterEach, expect, it, vi} from 'vitest';
import {linkSync, mkdirSync, symlinkSync} from 'node:fs';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {Thread} from '../packages/contracts/index.ts';
import {Store} from '../packages/storage/store.ts';
import {ProjectTools} from '../packages/workspace/tools.ts';
import {FileSuggestions, rankFileSuggestions} from '../packages/workspace/file-suggestions.ts';
import {withPathGuard} from '../packages/core/file-access.ts';

vi.mock('../packages/core/file-access.ts', async original => ({
  ...await original<typeof import('../packages/core/file-access.ts')>(),
  withPathGuard: vi.fn<typeof withPathGuard>(async (_paths, signal, action) => { signal.throwIfAborted(); return action([]); }),
}));
afterEach(async () => {vi.restoreAllMocks(); vi.mocked(withPathGuard).mockClear();});

const signal = () => new AbortController().signal;
async function fixture(clock?: () => number) {
  const root = await mkdtemp(join(tmpdir(), 'gen-mentions-')), path = join(root, 'repo');
  await mkdir(join(path, 'src', 'deep'), {recursive: true});
  await writeFile(join(path, 'src', 'main.ts'), 'a'); await writeFile(join(path, 'src', 'deep', 'util.ts'), 'b');
  await writeFile(join(path, 'README.md'), 'c');
  const store = new Store(join(root, 'data')), projects = new ProjectTools(store);
  const receipt = await projects.connect({id: 'connect', type: 'workspace.project.connect', payload: {name: 'Mention', path}});
  const projectId = (receipt.result as {projects: {id: string}[]}).projects[0]!.id;
  const thread: Thread = {id: 't1', projectId, title: 'T', projectName: null, createdAt: '', updatedAt: '', kind: 'main', status: 'ready', epoch: 0, runId: null, modelId: null, sessionPath: null};
  store.internal('fixture', thread.id, () => store.put('thread', thread.id, thread.id, thread));
  const suggestions = new FileSuggestions(projects, clock);
  const close = async () => {store.close(); await rm(root, {recursive: true, force: true});};
  return {root, path, store, projects, suggestions, projectId, threadId: thread.id, close};
}

it.each([
  ['ma', ['src/main.ts']],
  ['main', ['src/main.ts']],
  ['', ['README.md', 'src/main.ts', 'src/deep/util.ts']],
  ['src/', ['src/main.ts', 'src/deep/util.ts']],
  ['deep/', ['src/deep/util.ts']],
  ['zzz', []],
  ['mt', ['src/main.ts']],
])('ranks query %s within tiers: basename first, shorter paths, then code-point order', (query, expected) => {
  const paths = ['README.md', 'src/main.ts', 'src/deep/util.ts'];
  expect(rankFileSuggestions(paths, query, 50).map(i => i.path)).toEqual(expected);
});

it('orders equal tiers by shorter path then code point and caps the result', () => {
  const paths = ['ab/thing.ts', 'a/thing.ts', 'thing.ts', 'x/y/thing.ts'];
  expect(rankFileSuggestions(paths, 'thing', 50).map(i => i.path)).toEqual(['thing.ts', 'a/thing.ts', 'ab/thing.ts', 'x/y/thing.ts']);
  expect(rankFileSuggestions(paths, 'thing', 2)).toHaveLength(2);
  expect(rankFileSuggestions(['b.ts', 'a.ts'], '', 1).map(i => i.path)).toEqual(['a.ts']);
  expect(rankFileSuggestions(paths, 'THING.TS', 50)[0]).toEqual({path: 'thing.ts', name: 'thing.ts', directory: ''});
  expect(rankFileSuggestions(paths, 'y/th', 50).map(i => i.path)).toEqual(['x/y/thing.ts']);
});

it('walks the bound root once, excluding guarded, linked and skipped entries', async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.path, 'node_modules'), {recursive: true}); await writeFile(join(f.path, 'node_modules', 'x.js'), 'x');
    await mkdir(join(f.path, '.git'), {recursive: true}); await writeFile(join(f.path, '.git', 'config'), 'g');
    await mkdir(join(f.path, '.GIT'), {recursive: true}); await writeFile(join(f.path, '.GIT', 'config'), 'g');
    await writeFile(join(f.path, '.harness-directory-guard'), 'guard');
    await writeFile(join(f.path, 'target-file.ts'), 't'); linkSync(join(f.path, 'target-file.ts'), join(f.path, 'hardlinked.ts'));
    try { symlinkSync('main.ts', join(f.path, 'src', 'linked.ts')); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'EPERM') throw cause; }
    const result = await f.suggestions.suggest(f.projectId, f.threadId, '', 50, signal());
    expect(result).toMatchObject({complete: true});
    expect(result.items.map(i => i.path)).toEqual(['README.md', 'src/main.ts', 'src/deep/util.ts']);
    expect(withPathGuard).toHaveBeenCalledTimes(1);
    const again = await f.suggestions.suggest(f.projectId, f.threadId, 'main', 50, signal());
    expect(again.items.map(i => i.path)).toEqual(['src/main.ts']);
    expect(withPathGuard).toHaveBeenCalledTimes(1); // cached index shared within 15 s
  } finally {await f.close();}
});

it('refreshes the cached index after fifteen seconds', async () => {
  let now = 1_000_000;
  const f = await fixture(() => now);
  try {
    await f.suggestions.suggest(f.projectId, f.threadId, '', 50, signal());
    now += 16_000;
    await f.suggestions.suggest(f.projectId, f.threadId, '', 50, signal());
    expect(withPathGuard).toHaveBeenCalledTimes(2);
  } finally {await f.close();}
});

it('stops the walk at the entry budget and reports limitReason entries', async () => {
  const f = await fixture(() => 0), many = join(f.path, 'many'); // frozen clock: the entry cap, not the clock, bounds this walk
  mkdirSync(many);
  for (let batch = 0; batch < 20_001; batch += 500) await Promise.all(Array.from({length: Math.min(500, 20_001 - batch)}, (_, i) => writeFile(join(many, 'f' + String(batch + i).padStart(6, '0') + '.ts'), '')));
  try {
    const result = await f.suggestions.suggest(f.projectId, f.threadId, '', 50, signal());
    expect(result).toMatchObject({complete: false, limitReason: 'entries'});
  } finally {await f.close();}
}, 240_000);

it('stops the walk when the injected clock exceeds the time budget', async () => {
  let now = 0;
  const f = await fixture(() => (now += 1_000));
  try {
    const result = await f.suggestions.suggest(f.projectId, f.threadId, '', 50, signal());
    expect(result.complete).toBe(false); expect(result.limitReason).toBe('time');
  } finally {await f.close();}
});

it('rejects an aborted signal and propagates binding errors for side threads and unknown projects', async () => {
  const f = await fixture();
  try {
    const controller = new AbortController(); controller.abort();
    await expect(f.suggestions.suggest(f.projectId, f.threadId, '', 50, controller.signal)).rejects.toMatchObject({name: 'AbortError'});
    vi.mocked(withPathGuard).mockClear();
    const side: Thread = {id: 's1', projectId: f.projectId, title: 'S', projectName: null, createdAt: '', updatedAt: '', kind: 'side', status: 'ready', epoch: 0, runId: null, modelId: null, sessionPath: null, sideParentId: f.threadId};
    f.store.internal('fixture.side', side.id, () => f.store.put('thread', side.id, side.id, side));
    await expect(f.suggestions.suggest(f.projectId, side.id, '', 50, signal())).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
    await expect(f.suggestions.suggest('unknown-project', f.threadId, '', 50, signal())).rejects.toMatchObject({code: 'NOT_FOUND'});
    expect(withPathGuard).not.toHaveBeenCalled();
  } finally {await f.close();}
});
