import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, lstatSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/storage/store.ts';
import { ProjectTools, discardUnboundWorktree, type WorkspaceBinding } from '../packages/workspace/tools.ts';
import type { HostCommand, Thread } from '../packages/contracts/index.ts';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), 'harness-tools-')), root = mkdtempSync(join(tmpdir(), 'harness-project-'));
  const store = new Store(dataDir);
  cleanups.push(() => { store.close(); rmSync(dataDir, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); });
  return { store, tools: new ProjectTools(store, { git: 'git' }), dataDir, root };
}

const connect = (id: string, payload: Record<string, unknown>): HostCommand => ({ id, type: 'workspace.project.connect', payload } as HostCommand);
const thread = (over: Record<string, unknown>): Thread => ({ id: 'thread-1', title: 'T', status: 'ready', runId: null, updatedAt: '2026-01-01T00:00:00Z', ...over } as Thread);

describe('ProjectTools.connect', () => {
  it('rejects malformed payloads before touching the store', async () => {
    const { tools, store } = fixture();
    await expect(tools.connect(connect('c1', { path: '/tmp/x' }))).rejects.toThrow();
    await expect(tools.connect(connect('c2', { name: '   ', path: '/tmp/x' }))).rejects.toThrow();
    await expect(tools.connect(connect('c3', { name: 'x'.repeat(101), path: '/tmp/x' }))).rejects.toThrow();
    expect(store.all('workspaceProject')).toEqual([]);
  });
  it('refuses a project folder inside or containing harness storage', async () => {
    const { tools, dataDir } = fixture();
    const nested = join(dataDir, 'inside');
    mkdirSync(nested, { recursive: true });
    await expect(tools.connect(connect('c1', { name: 'nested', path: nested }))).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
    const parent = mkdtempSync(join(tmpdir(), 'harness-parent-'));
    cleanups.push(() => rmSync(parent, { recursive: true, force: true }));
    const store = new Store(join(parent, 'data'));
    cleanups.push(() => store.close());
    await expect(new ProjectTools(store, { git: 'git' }).connect(connect('c2', { name: 'parent', path: parent }))).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
  });
  it('enrolls a local folder, replays the same command id and rejects a changed payload under it', async () => {
    const { tools, store, root } = fixture();
    const command = connect('cmd-connect', { name: 'Local', path: root });
    const first = await tools.connect(command), second = await tools.connect(command);
    expect(second).toEqual(first);
    const projects = store.all<{ id: string; name: string; rootPath: string }>('workspaceProject');
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ name: 'Local', rootPath: root });
    expect(store.get<{ path: string }>('workspaceProjectRoot', projects[0].id)?.path).toBe(root);
    await expect(tools.connect(connect('cmd-connect', { name: 'Renamed', path: root }))).rejects.toMatchObject({ code: 'DUPLICATE_COMMAND' });
  });
  it('binds an idle thread to the project and refuses a busy one', async () => {
    const { tools, store, root } = fixture();
    store.internal('fixture.thread', null, () => {
      store.put('thread', 'idle-thread', null, thread({ id: 'idle-thread' }));
      store.put('thread', 'busy-thread', null, thread({ id: 'busy-thread', runId: 'run-1' }));
    });
    await expect(tools.connect(connect('c-busy', { name: 'B', path: root, threadId: 'busy-thread' }))).rejects.toMatchObject({ code: 'PROJECT_BUSY' });
    await tools.connect(connect('c-idle', { name: 'I', path: root, threadId: 'idle-thread' }));
    expect(store.get<{ projectId?: string }>('thread', 'idle-thread')?.projectId).toBe(store.all<{ id: string }>('workspaceProject')[0].id);
  });
  it('honors baseRevision as a precondition', async () => {
    const { tools, store, root } = fixture();
    await expect(tools.connect(connect('c-rev', { name: 'R', path: root, baseRevision: 999 }))).rejects.toMatchObject({ code: 'WORKSPACE_CHANGED' });
    expect(store.all('workspaceProject')).toEqual([]);
  });
});

describe('ProjectTools.binding', () => {
  it('reports missing projects, non-local authority and unconnected roots distinctly', async () => {
    const { tools, store } = fixture();
    await expect(tools.binding('missing-project')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    store.internal('fixture.project', null, () => {
      store.put('workspaceProject', 'remote-project', null, { id: 'remote-project', name: 'Remote', authority: { kind: 'company' }, createdAt: '2026-01-01T00:00:00Z' });
      store.put('workspaceProject', 'local-project', null, { id: 'local-project', name: 'Local', authority: { kind: 'local' }, createdAt: '2026-01-01T00:00:00Z' });
    });
    await expect(tools.binding('remote-project')).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
    await expect(tools.binding('local-project')).rejects.toMatchObject({ code: 'PROJECT_NOT_CONNECTED' });
  });
  it('denies delegate, side and cross-project threads', async () => {
    const { tools, store, root } = fixture();
    await tools.connect(connect('c1', { name: 'L', path: root }));
    const projectId = store.all<{ id: string }>('workspaceProject')[0].id;
    store.internal('fixture.threads', null, () => {
      store.put('thread', 'main-thread', null, thread({ id: 'main-thread', projectId }));
      store.put('thread', 'delegate-thread', null, thread({ id: 'delegate-thread', projectId, kind: 'delegate' }));
      store.put('thread', 'side-thread', null, thread({ id: 'side-thread', projectId, kind: 'side' }));
      store.put('thread', 'child-thread', null, thread({ id: 'child-thread', projectId, sideParentId: 'main-thread' }));
      store.put('workspaceProject', 'other-project', null, { id: 'other-project', name: 'Other', authority: { kind: 'local' }, createdAt: '2026-01-01T00:00:00Z' });
      store.put('thread', 'other-thread', null, thread({ id: 'other-thread', projectId: 'other-project' }));
    });
    for (const id of ['delegate-thread', 'side-thread', 'child-thread', 'other-thread']) {
      await expect(tools.binding(projectId, id), id).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
    }
    await expect(tools.binding(projectId, 'main-thread')).resolves.toMatchObject({ path: root });
  });
  it('denies a project folder replaced or swapped for a link after enrollment', async () => {
    const { tools, store, root } = fixture();
    await tools.connect(connect('c1', { name: 'L', path: root }));
    const projectId = store.all<{ id: string }>('workspaceProject')[0].id;
    const stashed = join(root, '..', 'moved');
    rmSync(stashed, { recursive: true, force: true });
    execFileSync('mv', [root, stashed]);
    cleanups.push(() => rmSync(stashed, { recursive: true, force: true }));
    mkdirSync(root);
    await expect(tools.binding(projectId)).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
    rmdirSync(root);
    const twin = mkdtempSync(join(tmpdir(), 'harness-twin-'));
    cleanups.push(() => rmSync(twin, { recursive: true, force: true }));
    symlinkSync(twin, root);
    await expect(tools.binding(projectId)).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
  });
});

describe('ProjectTools.validateRepository', () => {
  const git = (...args: string[]) => execFileSync('git', args, { stdio: 'ignore' });
  function repo() {
    const { root } = fixture();
    git('-C', root, 'init', '--quiet', '-b', 'main');
    writeFileSync(join(root, 'f.txt'), 'x');
    git('-C', root, 'add', 'f.txt');
    git('-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--quiet', '-m', 'init');
    return root;
  }
  it('accepts an ordinary repository and reports its common directory', async () => {
    const { tools } = fixture();
    const path = repo();
    await expect(tools.validateRepository(path)).resolves.toEqual({ common: join(path, '.git'), gitDirectory: join(path, '.git') });
  });
  it('rejects config redirects, executable filters and alternate object stores', async () => {
    const { tools } = fixture();
    const path = repo(), config = join(path, '.git', 'config'), original = String(await import('node:fs/promises').then((fs) => fs.readFile(config, 'utf8')));
    writeFileSync(config, original + '\n[include]\n\tpath = ../elsewhere\n');
    await expect(tools.validateRepository(path)).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
    writeFileSync(config, original + '\n[filter "x"]\n\tclean = sed s/x/y/\n');
    await expect(tools.validateRepository(path)).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
    writeFileSync(config, original);
    mkdirSync(join(path, '.git', 'objects', 'info'), { recursive: true });
    writeFileSync(join(path, '.git', 'objects', 'info', 'alternates'), '/elsewhere\n');
    await expect(tools.validateRepository(path)).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
  });
  it('rejects a linked worktree pointer without its managed binding', async () => {
    const { tools, root } = fixture();
    const path = repo(), linked = join(root, 'linked');
    git('-C', path, 'worktree', 'add', '--quiet', '-b', 'wt', linked, 'HEAD');
    await expect(tools.validateRepository(linked)).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
    const fake = { gitDirectory: '/elsewhere/.git', commonDirectory: '/elsewhere/.git' } as WorkspaceBinding;
    await expect(tools.validateRepository(linked, fake)).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
  });
});

describe('ProjectTools Git boundaries', () => {
  it('denies Git actions and status against a plain local folder', async () => {
    const { tools, store, root } = fixture();
    await tools.connect(connect('c1', { name: 'L', path: root }));
    const projectId = store.all<{ id: string }>('workspaceProject')[0].id;
    await expect(tools.gitAction(projectId, undefined, { type: 'commit', revision: 'x', message: 'm' })).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
    await expect(tools.git(join(root, 'sub'), ['status'])).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
    await expect(tools.gitAction(projectId, undefined, { type: 'stage', revision: 'x', paths: ['a.ts'] })).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
  });
  it('validates comparison requests before binding', async () => {
    const { tools } = fixture();
    await expect(tools.gitComparison('missing', undefined, { scope: 'bogus' })).rejects.toThrow();
    await expect(tools.gitComparisonFile('missing', undefined, { comparisonId: 'not-hex', path: 'a.ts' })).rejects.toThrow();
    const connected = fixture();
    await connected.tools.connect(connect('c1', { name: 'L', path: connected.root }));
    const projectId = connected.store.all<{ id: string }>('workspaceProject')[0].id;
    await expect(connected.tools.gitComparisonFile(projectId, undefined, { comparisonId: 'a'.repeat(64), path: 'a.ts' })).rejects.toThrow();
  });
});

describe('ProjectTools files and context', () => {
  it('denies traversal and Git metadata before any guarded read', async () => {
    const { tools, store, root } = fixture();
    await tools.connect(connect('c1', { name: 'L', path: root }));
    const projectId = store.all<{ id: string }>('workspaceProject')[0].id;
    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, '.git', 'config'), '[core]\n\tbare = false\n');
    await expect(tools.files(projectId, undefined, '..')).rejects.toThrow();
    await expect(tools.file(projectId, undefined, '../outside.ts')).rejects.toThrow();
    await expect(tools.files(projectId, undefined, '.git')).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
    await expect(tools.file(projectId, undefined, '.git/config')).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
    await expect(tools.file(projectId, undefined, 'missing.ts')).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('returns project context with capability flags and a status error for non-Git folders', async () => {
    const { tools, store, root } = fixture();
    await tools.connect(connect('c1', { name: 'L', path: root }));
    const projectId = store.all<{ id: string }>('workspaceProject')[0].id;
    store.internal('fixture.thread', null, () => store.put('thread', 'main-thread', null, thread({ id: 'main-thread', projectId })));
    const context = await tools.context(projectId, 'main-thread');
    expect(context).toMatchObject({
      project: { id: projectId, name: 'L' }, threadId: 'main-thread', branch: null, head: null,
      changes: { added: null, removed: null, files: null },
      capabilities: { git: false, gitWrite: false, untrackedIncluded: false, terminal: true, pullRequests: false },
    });
    expect(typeof context.machineName).toBe('string');
    expect(typeof context.error).toBe('string');
    expect(context.threadRevision).toBeTruthy();
  });
});

describe('discardUnboundWorktree', () => {
  it('removes the working copy and deletes the branch it created', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'harness-repo-'));
    cleanups.push(() => rmSync(dataDir, { recursive: true, force: true }));
    const git = (...args: string[]) => execFileSync('git', args, { stdio: 'ignore' });
    git('-C', dataDir, 'init', '--quiet', '-b', 'main');
    writeFileSync(join(dataDir, 'f.txt'), 'x');
    git('-C', dataDir, 'add', 'f.txt');
    git('-C', dataDir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--quiet', '-m', 'init');
    const worktree = join(dataDir, 'copy');
    git('-C', dataDir, 'worktree', 'add', '--quiet', '-b', 'wt-branch', worktree, 'HEAD');
    expect(() => lstatSync(worktree)).not.toThrow();
    await discardUnboundWorktree('git', join(dataDir, '.git'), worktree, 'wt-branch');
    expect(() => lstatSync(worktree)).toThrowError(expect.objectContaining({ code: 'ENOENT' }));
    expect(() => execFileSync('git', ['-C', dataDir, 'rev-parse', '--verify', 'wt-branch'], { stdio: 'pipe' })).toThrow();
  });
});
