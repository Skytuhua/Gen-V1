import {describe, expect, it} from 'vitest';
import {
  createExplorerOpenHandler,
  explorerProjectName,
  openExplorerProject,
  type ExplorerOpenProjectDeps,
  type ExplorerProjectRef,
  type ExplorerToastOptions,
} from '../apps/web/src/explorer-open-project';

const project = (id: string, rootPath?: string, authority: 'local' | 'plugin' = 'local'): ExplorerProjectRef =>
  ({ id, rootPath, authority: { kind: authority } });

type Call =
  | { kind: 'connect'; name: string; path: string }
  | { kind: 'createThread'; projectId: string }
  | { kind: 'select'; threadId: string }
  | { kind: 'toast'; message: string; options?: ExplorerToastOptions };

interface Harness {
  calls: Call[];
  deps: ExplorerOpenProjectDeps;
  state: { projects: ExplorerProjectRef[] | null };
  enqueue: ExplorerOpenProjectDeps['connect'];
}

function harness(initial: ExplorerProjectRef[] = [], connectResult?: ExplorerProjectRef[]): Harness {
  const state = { projects: [...initial] as ExplorerProjectRef[] | null };
  const calls: Call[] = [];
  const enqueue: Harness['enqueue'] = async (name, path) => {
    calls.push({ kind: 'connect', name, path });
    return { projects: connectResult ?? state.projects ?? [] };
  };
  const deps: ExplorerOpenProjectDeps = {
    projects: () => state.projects,
    connect: enqueue,
    pendingThread: () => null,
    createThread: async projectId => { calls.push({ kind: 'createThread', projectId }); return `thread-${projectId}`; },
    select: threadId => { calls.push({ kind: 'select', threadId }); },
    toast: (message, options) => { calls.push({ kind: 'toast', message, options }); },
  };
  return { calls, deps, state, enqueue };
}

const connectCalls = (calls: Call[]) => calls.filter((call): call is Extract<Call, { kind: 'connect' }> => call.kind === 'connect');
const threadCalls = (calls: Call[]) => calls.filter((call): call is Extract<Call, { kind: 'createThread' }> => call.kind === 'createThread');
const selectCalls = (calls: Call[]) => calls.filter((call): call is Extract<Call, { kind: 'select' }> => call.kind === 'select');
const toastCalls = (calls: Call[]) => calls.filter((call): call is Extract<Call, { kind: 'toast' }> => call.kind === 'toast');

describe('explorerProjectName', () => {
  it.each([
    ['C:\\Users\\me\\Docs', 'Docs'],
    ['C:\\Users\\me\\Docs\\', 'Docs'],
    ['C:\\Users\\me\\Docs\\\\\\', 'Docs'],
    ['D:\\My Folder', 'My Folder'],
    ['E:\\ ', 'Folder'],
    ['C:\\', 'C:'],
    ['d:\\', 'd:'],
    ['\\\\srv\\share', 'share'],
    ['\\\\srv\\share\\', 'share'],
    ['\\\\srv\\share\\dir', 'dir'],
    ['\\\\srv\\share\\dir\\', 'dir'],
    ['F:\\.config', '.config'],
  ])('derives %s -> %s', (path, expected) => {
    expect(explorerProjectName(path)).toBe(expected);
  });

  it('caps names at the 100-character project label limit', () => {
    const long = `C:\\${'a'.repeat(140)}`;
    expect(explorerProjectName(long)).toBe('a'.repeat(100));
  });

  it('falls back to Folder when no basename exists', () => {
    expect(explorerProjectName('')).toBe('Folder');
    expect(explorerProjectName('   ')).toBe('Folder');
  });
});

describe('openExplorerProject', () => {
  it('enrolls a new folder, creates a scoped empty conversation, and reveals it', async () => {
    const { calls, deps } = harness();
    await openExplorerProject('C:\\Users\\me\\Docs', {
      ...deps,
      connect: async (name, path) => {
        calls.push({ kind: 'connect', name, path });
        return { projects: [project('p-new', 'C:\\Users\\me\\Docs')] };
      },
    });
    expect(calls).toEqual([
      { kind: 'connect', name: 'Docs', path: 'C:\\Users\\me\\Docs' },
      { kind: 'createThread', projectId: 'p-new' },
      { kind: 'select', threadId: 'thread-p-new' },
      { kind: 'toast', message: '✓ Opened Docs as a project', options: expect.objectContaining({ tone: 'success' }) },
    ]);
  });

  it('reuses an existing project matched by the supplied absolute path', async () => {
    const existing = project('p-old', 'C:\\Users\\me\\Docs');
    const { calls, deps } = harness([existing]);
    await openExplorerProject('C:\\Users\\me\\Docs', deps);
    expect(connectCalls(calls)).toEqual([{ kind: 'connect', name: 'Docs', path: 'C:\\Users\\me\\Docs' }]);
    expect(threadCalls(calls)).toEqual([{ kind: 'createThread', projectId: 'p-old' }]);
    expect(selectCalls(calls)).toEqual([{ kind: 'select', threadId: 'thread-p-old' }]);
  });

  it('resolves a new project enrolled under a canonical root alias via the new project id', async () => {
    const { calls, deps } = harness();
    await openExplorerProject('C:\\Foo', {
      ...deps,
      connect: async () => ({ projects: [project('p-new', 'c:\\foo')] }),
    });
    expect(threadCalls(calls)).toEqual([{ kind: 'createThread', projectId: 'p-new' }]);
    expect(selectCalls(calls)).toEqual([{ kind: 'select', threadId: 'thread-p-new' }]);
  });

  it('does not claim a plugin-owned project with a matching root path', async () => {
    const plugin = project('p-plugin', 'C:\\Users\\me\\Docs', 'plugin');
    const { calls, deps } = harness([plugin]);
    await openExplorerProject('C:\\Users\\me\\Docs', deps);
    expect(threadCalls(calls)).toEqual([]);
    expect(toastCalls(calls)).toEqual([
      { kind: 'toast', message: "Couldn't open C:\\Users\\me\\Docs: the project connected but could not be located in the workspace.", options: { tone: 'error' } },
    ]);
  });

  it('shows a path+reason error toast and creates nothing when connect rejects the folder', async () => {
    const { calls, deps } = harness();
    await openExplorerProject('C:\\Gen V1\\storage', {
      ...deps,
      connect: async (name, path) => { calls.push({ kind: 'connect', name, path }); throw new Error('Choose a project folder outside harness application data.'); },
    });
    expect(toastCalls(calls)).toEqual([
      { kind: 'toast', message: "Couldn't open C:\\Gen V1\\storage: Choose a project folder outside harness application data.", options: { tone: 'error' } },
    ]);
    expect(threadCalls(calls)).toEqual([]);
    expect(selectCalls(calls)).toEqual([]);
  });

  it('shows a safe error when the workspace envelope is not loaded yet', async () => {
    const { calls, deps, state } = harness();
    state.projects = null;
    await openExplorerProject('C:\\Users\\me\\Docs', deps);
    expect(connectCalls(calls)).toEqual([]);
    expect(toastCalls(calls)).toEqual([
      { kind: 'toast', message: "Couldn't open C:\\Users\\me\\Docs: the workspace is still loading. Try again.", options: { tone: 'error' } },
    ]);
  });

  it('retains the enrolled project and reports the stage when conversation creation fails', async () => {
    const { calls, deps } = harness();
    await openExplorerProject('C:\\Users\\me\\Docs', {
      ...deps,
      connect: async () => ({ projects: [project('p-new', 'C:\\Users\\me\\Docs')] }),
      createThread: async () => { calls.push({ kind: 'createThread', projectId: 'p-new' }); throw new Error('host busy'); },
    });
    expect(toastCalls(calls)).toEqual([
      { kind: 'toast', message: "Couldn't open C:\\Users\\me\\Docs: the project connected, but the conversation could not start. host busy", options: { tone: 'error' } },
    ]);
    expect(selectCalls(calls)).toEqual([]);
  });

  it('waits for an unrelated in-flight creation instead of adopting it', async () => {
    const { calls, deps } = harness();
    let release!: () => void;
    const foreign = new Promise<string>(resolve => { release = () => resolve('thread-foreign'); });
    let pending = true;
    const done = openExplorerProject('C:\\Users\\me\\Docs', {
      ...deps,
      connect: async () => ({ projects: [project('p-new', 'C:\\Users\\me\\Docs')] }),
      pendingThread: () => pending ? foreign : null,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(threadCalls(calls)).toEqual([]);
    release();
    pending = false;
    await done;
    expect(threadCalls(calls)).toEqual([{ kind: 'createThread', projectId: 'p-new' }]);
    expect(selectCalls(calls)).toEqual([{ kind: 'select', threadId: 'thread-p-new' }]);
  });

  it('survives a rejected foreign creation and still creates its own scoped thread', async () => {
    const { calls, deps } = harness();
    let pending: Promise<string> | null = Promise.reject(new Error('cancelled'));
    pending.catch(() => {});
    await openExplorerProject('C:\\Users\\me\\Docs', {
      ...deps,
      connect: async () => ({ projects: [project('p-new', 'C:\\Users\\me\\Docs')] }),
      pendingThread: () => { const value = pending; pending = null; return value; },
    });
    expect(threadCalls(calls)).toEqual([{ kind: 'createThread', projectId: 'p-new' }]);
    expect(selectCalls(calls)).toEqual([{ kind: 'select', threadId: 'thread-p-new' }]);
  });

  it('never issues message, run, or trust commands — the conversation is created empty', async () => {
    const { calls, deps } = harness();
    await openExplorerProject('C:\\Users\\me\\Docs', {
      ...deps,
      connect: async (name, path) => { calls.push({ kind: 'connect', name, path }); return { projects: [project('p-new', 'C:\\Users\\me\\Docs')] }; },
    });
    expect(calls.map(call => call.kind)).toEqual(['connect', 'createThread', 'select', 'toast']);
  });

  it('success toast carries a Reveal action that re-selects the conversation', async () => {
    const { calls, deps } = harness();
    await openExplorerProject('C:\\Users\\me\\Docs', {
      ...deps,
      connect: async () => ({ projects: [project('p-new', 'C:\\Users\\me\\Docs')] }),
    });
    const success = toastCalls(calls)[0];
    expect(success.options?.action?.label).toBe('Reveal');
    success.options?.action?.onClick();
    expect(selectCalls(calls)).toEqual([
      { kind: 'select', threadId: 'thread-p-new' },
      { kind: 'select', threadId: 'thread-p-new' },
    ]);
  });
});

describe('createExplorerOpenHandler', () => {
  const openEnvelope = (path: string) => ({ projects: [project(`p-${path.length}`, path)] });

  it('deduplicates an identical path that is still being processed', async () => {
    const { calls, deps } = harness();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const dispatch = createExplorerOpenHandler(() => ({
      ...deps,
      connect: async (name, path) => { calls.push({ kind: 'connect', name, path }); await gate; return openEnvelope(path); },
    }));
    dispatch('C:\\Users\\me\\Docs');
    dispatch('C:\\Users\\me\\Docs');
    dispatch('C:\\Users\\me\\Docs');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(connectCalls(calls)).toHaveLength(1);
    release();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(threadCalls(calls)).toHaveLength(1);
    expect(selectCalls(calls)).toHaveLength(1);
  });

  it('serializes distinct paths in arrival order, each getting its own conversation', async () => {
    const { calls, deps } = harness();
    const order: string[] = [];
    const dispatch = createExplorerOpenHandler(() => ({
      ...deps,
      connect: async (name, path) => { calls.push({ kind: 'connect', name, path }); order.push(path); return openEnvelope(path); },
    }));
    dispatch('C:\\Alpha');
    dispatch('C:\\Beta');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(order).toEqual(['C:\\Alpha', 'C:\\Beta']);
    expect(threadCalls(calls)).toHaveLength(2);
    expect(selectCalls(calls)).toHaveLength(2);
  });

  it('opens a second conversation for the same path after the first request completed', async () => {
    const { calls, deps } = harness();
    const dispatch = createExplorerOpenHandler(() => ({
      ...deps,
      connect: async (name, path) => { calls.push({ kind: 'connect', name, path }); return openEnvelope(path); },
    }));
    dispatch('C:\\Users\\me\\Docs');
    await new Promise(resolve => setTimeout(resolve, 0));
    dispatch('C:\\Users\\me\\Docs');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(connectCalls(calls)).toHaveLength(2);
    expect(threadCalls(calls)).toHaveLength(2);
  });

  it('keeps processing queued paths after an earlier request failed', async () => {
    const { calls, deps } = harness();
    const dispatch = createExplorerOpenHandler(() => ({
      ...deps,
      connect: async (name, path) => {
        calls.push({ kind: 'connect', name, path });
        if (path === 'C:\\Bad') throw new Error('rejected folder');
        return openEnvelope(path);
      },
    }));
    dispatch('C:\\Bad');
    dispatch('C:\\Good');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(connectCalls(calls)).toHaveLength(2);
    expect(threadCalls(calls)).toEqual([{ kind: 'createThread', projectId: 'p-7' }]);
    expect(toastCalls(calls)[0]?.options?.tone).toBe('error');
    expect(selectCalls(calls)).toEqual([{ kind: 'select', threadId: 'thread-p-7' }]);
  });

  it('resolves deps lazily per request so the latest render state is used', async () => {
    const { calls, deps, state } = harness();
    state.projects = null;
    const dispatch = createExplorerOpenHandler(() => ({ ...deps, projects: () => state.projects }));
    dispatch('C:\\Users\\me\\Docs');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(connectCalls(calls)).toEqual([]);
    state.projects = [];
    dispatch('C:\\Users\\me\\Docs');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(connectCalls(calls)).toEqual([{ kind: 'connect', name: 'Docs', path: 'C:\\Users\\me\\Docs' }]);
  });

  it('does not throw when a dispatch is issued while a foreign creation is pending', async () => {
    const { deps } = harness();
    const foreign = new Promise<string>(() => {});
    const dispatch = createExplorerOpenHandler(() => ({
      ...deps,
      connect: async () => ({ projects: [project('p-new')] }),
      pendingThread: () => foreign,
    }));
    expect(() => dispatch('C:\\Users\\me\\Docs')).not.toThrow();
  });
});
