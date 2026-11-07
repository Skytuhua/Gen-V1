import { afterEach, expect, it, vi } from 'vitest';
import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HostCommand, Thread } from '../packages/contracts/index.ts';
import type { WorkspaceActionEnvelope, WorkspaceActionOperation } from '../packages/contracts/workspace-action-outcomes.ts';
import { Store } from '../packages/storage/store.ts';
import { ProjectTools, type WorkspaceBinding } from '../packages/workspace/tools.ts';
import { GitHubTools } from '../packages/workspace/github.ts';
import type { TerminalHost } from '../packages/workspace/terminal.ts';
import { WorkspaceActionOutcomes } from '../packages/workspace/action-outcomes.ts';
import { withPrivateGitFamily } from '../packages/workspace/git-storage.ts';
import { withPathGuard } from '../packages/core/file-access.ts';

// Explicitly synthetic native guard/tool edges. The wrapper, SQLite Store,
// ProjectTools.binding, privateFamilyForBinding and contract parsing remain real.
// These tests do not attest native guards, Git, provider writes or route wiring.
vi.mock('../packages/core/file-access.ts', async (original) => ({
  ...(await original<typeof import('../packages/core/file-access.ts')>()),
  withPathGuard: vi.fn<typeof import('../packages/core/file-access.ts').withPathGuard>(async (_paths, _signal, action) => action([])),
}));
vi.mock('../packages/workspace/git-storage.ts', async (original) => ({
  ...(await original<typeof import('../packages/workspace/git-storage.ts')>()),
  withPrivateGitFamily: vi.fn<typeof import('../packages/workspace/git-storage.ts').withPrivateGitFamily>(async (family, signal, action) =>
    action(family.gitDirectory, family.path, signal),
  ),
}));

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(withPrivateGitFamily).mockClear();
  vi.mocked(withPathGuard).mockClear();
  for (const close of cleanup.splice(0).reverse()) await close();
});

function gate() {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    entered,
    release,
    async wait() {
      enter();
      await held;
    },
  };
}

async function fixture(id = 'action:63', type: 'review-pr' | 'stage' = 'review-pr') {
  const root = await mkdtemp(join(tmpdir(), 'gen-outcome-authority-'));
  const store = new Store(join(root, 'data'));
  cleanup.push(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const path = join(root, 'worktree'),
    commonDirectory = join(store.dataDir, 'git', 'project', 'repository.git');
  await mkdir(path);
  const stat = await lstat(path, { bigint: true });
  const identity = { dev: String(stat.dev), ino: String(stat.ino) };
  const workspace: WorkspaceBinding = {
    id: 'workspace',
    projectId: 'project',
    threadId: 'thread',
    familyId: 'project',
    path,
    branch: 'gen/original',
    gitDirectory: join(commonDirectory, 'worktrees', 'workspace'),
    commonDirectory,
    identity,
    gitDirectoryIdentity: { dev: '1', ino: '2' },
    commonDirectoryIdentity: { dev: '1', ino: '3' },
  };
  const thread: Thread = {
    id: 'thread',
    projectId: 'project',
    workspaceId: workspace.id,
    title: 'Thread',
    projectName: 'Project',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'ready',
    epoch: 0,
    runId: null,
    modelId: null,
    sessionPath: null,
    kind: 'main',
  };
  store.internal('fixture', null, () => {
    store.put('workspaceProject', 'project', null, {
      id: 'project',
      name: 'Project',
      authority: { kind: 'local' },
      rootPath: path,
      createdAt: thread.createdAt,
    });
    store.put('workspaceProjectRoot', 'project', null, { path, identity });
    store.put('workspaceGitFamily', 'project', null, {
      projectId: 'project',
      commonDirectory,
      commonDirectoryIdentity: workspace.commonDirectoryIdentity,
    });
    store.put('workspaceBinding', workspace.id, thread.id, workspace);
    store.put('workspaceBinding', 'replacement', thread.id, { ...workspace, id: 'replacement' });
    store.put('thread', thread.id, thread.id, thread);
  });
  await mkdir(join(store.dataDir, 'github'));
  await writeFile(join(store.dataDir, 'github', 'credentials.json'), 'synthetic-credential');
  const projects = new ProjectTools(store),
    github = new GitHubTools(projects, {} as TerminalHost);
  vi.spyOn(github, 'repo').mockResolvedValue({ path, repo: 'example/fixture' });
  const token = vi.spyOn(github.auth, 'token').mockResolvedValue('synthetic-token');
  const review = vi.spyOn(github, 'review').mockResolvedValue({ id: 77, body: 'private-result' });
  const status = vi.spyOn(projects, 'gitStatus').mockResolvedValue({
    head: 'a'.repeat(40),
    branch: workspace.branch,
    revision: 'b'.repeat(64),
    files: [],
    diff: '',
    stagedDiff: '',
    truncated: false,
    gitWrite: true,
  });
  const local = vi.spyOn(projects, 'gitAction').mockResolvedValue({ gitWrite: true } as Awaited<ReturnType<ProjectTools['gitAction']>>);
  const outcomes = new WorkspaceActionOutcomes(projects, github);
  const payload =
    type === 'review-pr'
      ? { number: 12, event: 'COMMENT' as const, body: '\uFEFF private review\r\n', head: 'a'.repeat(40), revision: 'b'.repeat(64) }
      : { paths: ['one.txt'], expectedHead: 'a'.repeat(40), revision: 'b'.repeat(64) };
  const input: WorkspaceActionEnvelope = { id, type, threadId: thread.id, payload };
  const operation: WorkspaceActionOperation = {
    operationId: id,
    operation: type,
    payload,
    selection: {
      owner: { authority: { kind: 'local' }, projectId: 'project', threadId: thread.id },
      target: type === 'review-pr' ? { kind: 'pull-request', repo: 'example/fixture', number: 12 } : { kind: 'local', scope: 'worktree' },
    },
    comparison:
      type === 'review-pr'
        ? {
            kind: 'pull-request',
            id: 'e'.repeat(64),
            repo: 'example/fixture',
            number: 12,
            pullRequestId: 'PR_fixture',
            baseOid: 'a'.repeat(40),
            headOid: 'a'.repeat(40),
            mergeBaseOid: 'a'.repeat(40),
            baseRef: 'main',
            headRef: workspace.branch,
            semantics: 'merge-base',
          }
        : {
            kind: 'local',
            id: 'e'.repeat(64),
            scope: 'worktree',
            headOid: 'a'.repeat(40),
            branch: workspace.branch,
            revision: 'b'.repeat(64),
            base: { kind: 'index', revision: 'index' },
            head: { kind: 'worktree', revision: 'worktree' },
          },
    action: { head: 'a'.repeat(40), revision: 'b'.repeat(64), branch: workspace.branch },
  };
  const command: HostCommand = { ...input, type: 'project.' + type, payload: { ...input.payload, projectId: 'project' } };
  function change(kind: 'binding' | 'selection' | 'authority' | 'epoch-aba' | 'unrelated') {
    store.internal('fixture.change', null, () => {
      if (kind === 'binding') store.put('workspaceBinding', workspace.id, thread.id, { ...workspace, branch: 'gen/rebound' });
      if (kind === 'selection') store.put('thread', thread.id, thread.id, { ...thread, workspaceId: 'replacement' });
      if (kind === 'authority') store.remove('workspaceProject', 'project');
      if (kind === 'epoch-aba') {
        store.put('thread', thread.id, thread.id, { ...thread, workspaceId: 'replacement', epoch: 1 });
        store.put('thread', thread.id, thread.id, { ...thread, epoch: 2 });
      }
      if (kind === 'unrelated') store.put('thread', 'other-thread', 'other-thread', { ...thread, id: 'other-thread', epoch: 9 });
    });
  }
  return { store, projects, github, outcomes, token, review, local, status, input, operation, command, change };
}

const uuid = 'e2bea952-716b-42b6-9c03-8c1e9ad00339';

it.each(['binding', 'selection', 'authority', 'epoch-aba'] as const)(
  'denies admission when %s changes during credential read',
  async (change) => {
    const f = await fixture(uuid),
      held = gate();
    f.token.mockImplementationOnce(async () => {
      await held.wait();
      return 'synthetic-token';
    });
    const pending = f.outcomes.execute('project', f.input);
    await held.entered;
    f.change(change);
    held.release();
    expect(await pending).toEqual({ state: 'revoked' });
    expect(f.review).not.toHaveBeenCalled();
    expect(f.store.get('workspaceActionOutcome', f.input.id)).toBeNull();
  },
);

it('denies admission when selection changes during native family validation', async () => {
  const f = await fixture(uuid),
    held = gate();
  vi.mocked(withPrivateGitFamily).mockImplementationOnce(async (family, signal, action) => {
    await held.wait();
    return action(family.gitDirectory, family.path, signal);
  });
  const pending = f.outcomes.execute('project', f.input);
  await held.entered;
  f.change('selection');
  held.release();
  expect(await pending).toEqual({ state: 'revoked' });
  expect(f.review).not.toHaveBeenCalled();
});

it('does not publish stale inspection after a credential await', async () => {
  const f = await fixture(uuid);
  expect((await f.outcomes.execute('project', f.input)).state).toBe('confirmed');
  const held = gate();
  f.token.mockImplementationOnce(async () => {
    await held.wait();
    return 'synthetic-token';
  });
  const pending = f.outcomes.inspect(f.operation);
  await held.entered;
  f.change('selection');
  const seq = f.store.sequence;
  held.release();
  expect(await pending).toEqual({ state: 'revoked' });
  expect(await f.outcomes.inspect(f.operation)).toEqual({ state: 'revoked' });
  expect(f.store.sequence).toBe(seq);
  expect(f.review).toHaveBeenCalledTimes(1);
});

it.each(['inspect', 'replay'] as const)('rechecks %s at the final public Promise continuation', async (mode) => {
  const f = await fixture(uuid);
  expect((await f.outcomes.execute('project', f.input)).state).toBe('confirmed');
  if (mode === 'replay') vi.mocked(withPathGuard).mockImplementationOnce(async (_paths, _signal, action) => action([]));
  vi.mocked(withPathGuard).mockImplementationOnce(async (_paths, _signal, action) => {
    const value = await action([]);
    // Synthetic guard teardown schedules an owner change after the internal
    // fence continuation, but before execute/inspect resumes for publication.
    queueMicrotask(() => queueMicrotask(() => f.change('selection')));
    return value;
  });
  const result = mode === 'inspect' ? await f.outcomes.inspect(f.operation) : await f.outcomes.execute('project', f.input);
  expect(result).toEqual({ state: 'revoked' });
  expect(f.review).toHaveBeenCalledTimes(1);
});

it('does not dispatch after a binding change in the final credential read', async () => {
  const f = await fixture(uuid),
    held = gate();
  f.token.mockResolvedValueOnce('synthetic-token').mockImplementationOnce(async () => {
    await held.wait();
    return 'synthetic-token';
  });
  const pending = f.outcomes.execute('project', f.input);
  await held.entered;
  f.change('binding');
  held.release();
  expect(['revoked', 'not-applied']).toContain((await pending).state);
  expect(f.review).not.toHaveBeenCalled();
  expect(f.store.receipt(f.command)).toBeNull();
});

it('does not dispatch local writes after ownership changes during gitStatus', async () => {
  const f = await fixture(uuid, 'stage'),
    held = gate();
  const value = await f.projects.gitStatus('project', 'thread');
  f.status.mockImplementationOnce(async () => {
    await held.wait();
    return value;
  });
  const pending = f.outcomes.execute('project', f.input);
  await held.entered;
  f.change('selection');
  held.release();
  expect((await pending).state).not.toBe('confirmed');
  expect(f.local).not.toHaveBeenCalled();
  expect(f.store.receipt(f.command)).toBeNull();
});

it.each(['binding', 'selection', 'epoch-aba'] as const)(
  'retains known write evidence while revoking the current %s projection',
  async (change) => {
    const f = await fixture(uuid),
      held = gate();
    f.review.mockImplementationOnce(async () => {
      await held.wait();
      return { id: 77, body: 'private-result' };
    });
    const pending = f.outcomes.execute('project', f.input);
    await held.entered;
    const admitted = f.store.get<{ ownerFence: string }>('workspaceActionOutcome', f.input.id)!;
    f.change(change);
    held.release();
    expect(await pending).toEqual({ state: 'revoked' });
    expect(f.store.get('workspaceActionOutcome', f.input.id)).toMatchObject({
      command: f.command,
      ownerFence: admitted.ownerFence,
      status: 'confirmed',
      result: { id: 77, body: 'private-result' },
    });
    expect(f.store.receipt(f.command)).toMatchObject({ commandId: f.input.id, result: { state: 'revoked' } });
    expect(await f.outcomes.inspect(f.operation)).toEqual({ state: 'revoked' });
    expect(await f.outcomes.execute('project', f.input)).toEqual({ state: 'revoked' });
    expect(f.review).toHaveBeenCalledTimes(1);
    expect(f.review).toHaveBeenCalledWith('project', 'thread', f.input.payload);
    expect(JSON.stringify(f.store.eventsAfter(0))).not.toContain('private-result');
    expect(JSON.stringify(f.store.snapshot())).not.toContain('private-result');
  },
);

it('rechecks authority after synchronous outcome subscribers before returning confirmation', async () => {
  const f = await fixture(uuid);
  f.store.subscribe((event) => {
    if (event.type === 'project.review-pr') f.change('selection');
  });
  expect(await f.outcomes.execute('project', f.input)).toEqual({ state: 'revoked' });
  expect(f.store.get('workspaceActionOutcome', f.input.id)).toMatchObject({ status: 'confirmed', result: { id: 77 } });
  expect(f.review).toHaveBeenCalledTimes(1);
});

it('does not dispatch after a started-event subscriber changes the owner', async () => {
  const f = await fixture(uuid);
  f.store.subscribe((event) => {
    if (event.type === 'project.action.started') f.change('selection');
  });
  expect((await f.outcomes.execute('project', f.input)).state).not.toBe('confirmed');
  expect(f.review).not.toHaveBeenCalled();
  expect(f.store.receipt(f.command)).toBeNull();
});

it('preserves an unknown dispatched result and never retries after revocation', async () => {
  const f = await fixture(uuid),
    held = gate();
  f.review.mockImplementationOnce(async () => {
    await held.wait();
    throw Error('synthetic lost response');
  });
  const pending = f.outcomes.execute('project', f.input);
  await held.entered;
  f.change('selection');
  held.release();
  expect(['uncertain', 'revoked']).toContain((await pending).state);
  expect(f.store.get('workspaceActionOutcome', f.input.id)).toMatchObject({ status: 'started', command: f.command });
  expect(f.store.receipt(f.command)).toBeNull();
  expect(await f.outcomes.execute('project', f.input)).toEqual({ state: 'revoked' });
  expect(f.review).toHaveBeenCalledTimes(1);
});

it('does not revoke an owner for unrelated Store changes', async () => {
  const f = await fixture(uuid),
    held = gate();
  f.token.mockImplementationOnce(async () => {
    await held.wait();
    return 'synthetic-token';
  });
  const pending = f.outcomes.execute('project', f.input);
  await held.entered;
  f.change('unrelated');
  held.release();
  expect((await pending).state).toBe('confirmed');
  expect(await f.outcomes.inspect(f.operation)).toEqual({ state: 'confirmed' });
});

it.each(['action:63', 'A_.-9', 'x'.repeat(200), uuid])('recovers the accepted command ID %s without resubmission', async (id) => {
  const f = await fixture(id);
  await f.outcomes.execute('project', f.input); // Deliberately discard the response.
  const reopened = new Store(f.store.dataDir);
  cleanup.push(async () => reopened.close());
  const recovered = new WorkspaceActionOutcomes(new ProjectTools(reopened), f.github);
  expect(await recovered.inspect(f.operation)).toEqual({ state: 'confirmed' });
  expect((await recovered.execute('project', f.input)).state).toBe('confirmed');
  expect(reopened.receipt(f.command)?.commandId).toBe(id);
  expect(f.review).toHaveBeenCalledTimes(1);
});

it.each(['', 'bad/id', 'x'.repeat(201)])('rejects invalid command ID %s before persistence or dispatch', async (id) => {
  const f = await fixture(id),
    seq = f.store.sequence;
  await expect(f.outcomes.execute('project', f.input)).rejects.toThrow();
  await expect(f.outcomes.inspect(f.operation)).rejects.toThrow();
  expect(f.store.sequence).toBe(seq);
  expect(f.review).not.toHaveBeenCalled();
});
