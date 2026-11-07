import { afterEach, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/storage/store.ts';
import { ProjectTools, type WorkspaceBinding } from '../packages/workspace/tools.ts';
import { GitHubTools } from '../packages/workspace/github.ts';
import type { TerminalHost } from '../packages/workspace/terminal.ts';
import { WorkspaceActionOutcomes } from '../packages/workspace/action-outcomes.ts';
import {
  workspaceActionPayloadSchemas,
  type WorkspaceActionEnvelope,
  type WorkspaceActionOperation,
} from '../packages/contracts/workspace-action-outcomes.ts';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

it('accepts canonical Unicode review text without normalizing a leading BOM or whitespace', () => {
  const body = '\uFEFF\u00e9\u{1f680}\r\n  Literal\\n  ';
  const payload = { number: 12, event: 'COMMENT', body, head: 'a'.repeat(40), revision: 'b'.repeat(64) };
  expect(() => workspaceActionPayloadSchemas['review-pr'].parse(payload)).not.toThrow();
  expect(workspaceActionPayloadSchemas['review-pr'].parse(payload).body).toBe('\uFEFF\u00e9\u{1f680}\r\n  Literal\\n  ');
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'gen-action-outcome-')),
    path = join(root, 'repo'),
    data = join(root, 'data');
  await mkdir(path);
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', path, ...args], { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  await writeFile(join(path, 'one.txt'), 'first\n');
  git('add', '.');
  git('commit', '-m', 'Initial');
  git('remote', 'add', 'origin', 'https://github.com/example/fixture.git');
  let store = new Store(data),
    projects = new ProjectTools(store, { git: process.platform === 'win32' ? 'C:/Program Files/Git/cmd/git.exe' : 'git' });
  const connected = await projects.connect({ id: randomUUID(), type: 'workspace.project.connect', payload: { name: 'Fixture', path } }),
    projectId = (connected.result as { projects: { id: string }[] }).projects[0]!.id;
  const thread = {
    id: 'main',
    title: 'Main',
    projectId,
    projectName: 'Fixture',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'ready' as const,
    epoch: 0,
    runId: null,
    modelId: null,
    sessionPath: null,
    kind: 'main' as const,
  };
  store.internal('fixture', null, () => store.put('thread', thread.id, thread.id, thread));
  await projects.prepareWorkspace(thread);
  const binding = await projects.binding(projectId, thread.id);
  await mkdir(join(data, 'github'), { recursive: true });
  await writeFile(
    join(data, 'github', 'credentials.json'),
    JSON.stringify({ version: 1, token: 'synthetic-profile-token', login: 'fixture' }),
  );
  let github = new GitHubTools(projects, {} as TerminalHost),
    outcomes = new WorkspaceActionOutcomes(projects, github);
  cleanup.push(async () => {
    await projects.dispose();
    store.close();
    if (!root.startsWith(join(tmpdir(), 'gen-action-outcome-'))) throw Error('Unexpected fixture path');
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  return {
    root,
    path,
    data,
    projectId,
    thread,
    binding,
    get store() {
      return store;
    },
    get projects() {
      return projects;
    },
    get github() {
      return github;
    },
    get outcomes() {
      return outcomes;
    },
    async restart() {
      await projects.dispose();
      store.close();
      store = new Store(data);
      projects = new ProjectTools(store, { git: process.platform === 'win32' ? 'C:/Program Files/Git/cmd/git.exe' : 'git' });
      github = new GitHubTools(projects, {} as TerminalHost);
      outcomes = new WorkspaceActionOutcomes(projects, github);
    },
    async operation(type: WorkspaceActionEnvelope['type'] = 'stage') {
      const status = await projects.gitStatus(projectId, thread.id),
        comparison = await projects.gitComparison(projectId, thread.id, { scope: type === 'commit' ? 'staged' : 'worktree' });
      if (comparison.state !== 'ready' && comparison.state !== 'empty') throw Error('Fixture comparison failed');
      const payload =
        type === 'review-pr'
          ? { number: 12, event: 'COMMENT' as const, body: 'private review text', head: status.head, revision: status.revision }
          : type === 'commit'
            ? { message: 'private commit message', expectedHead: status.head, revision: status.revision }
            : { paths: ['one.txt'], expectedHead: status.head, revision: status.revision };
      const operation: WorkspaceActionOperation = {
        operationId: randomUUID(),
        operation: type,
        selection: {
          owner: { authority: { kind: 'local' }, projectId, threadId: thread.id },
          target:
            type === 'review-pr'
              ? { kind: 'pull-request', repo: 'example/fixture', number: 12 }
              : { kind: 'local', scope: type === 'commit' ? 'staged' : 'worktree' },
        },
        comparison:
          type === 'review-pr'
            ? {
                kind: 'pull-request',
                id: 'e'.repeat(64),
                repo: 'example/fixture',
                number: 12,
                pullRequestId: 'PR_fixture',
                baseOid: status.head,
                headOid: status.head,
                mergeBaseOid: status.head,
                baseRef: 'main',
                headRef: status.branch,
                semantics: 'merge-base',
              }
            : comparison.value.identity,
        action: { head: status.head, revision: status.revision, branch: status.branch },
        payload,
      };
      return {
        operation,
        input: { id: operation.operationId, type, payload, threadId: thread.id } satisfies WorkspaceActionEnvelope,
        status,
      };
    },
  };
}

// Only the external CLI edge is simulated; tool validation and private input handling stay real.
function remote(f: Awaited<ReturnType<typeof fixture>>, post: (body: unknown) => Promise<unknown>) {
  const run = vi.fn(async (_path: string, args: string[]) => {
    if (args.includes('POST')) return JSON.stringify(await post(JSON.parse(await readFile(args[args.indexOf('--input') + 1]!, 'utf8'))));
    if (args[0] === 'pr' && args[1] === 'view') {
      const status = await f.projects.gitStatus(f.projectId, f.thread.id);
      return JSON.stringify({ number: 12, headRefOid: status.head, headRefName: status.branch });
    }
    throw Error('Unexpected external CLI call');
  });
  (f.github as unknown as { run: typeof run }).run = run;
  return run;
}
function transformed(projectId: string, input: WorkspaceActionEnvelope) {
  return { ...input, type: 'project.' + input.type, payload: { ...input.payload, projectId } };
}

it('commits intent before local write and private result before event, then replays after Store restart', async () => {
  const f = await fixture();
  await writeFile(join(f.binding.path, 'one.txt'), 'private staged contents\n');
  const { input, operation } = await f.operation(),
    bound = f.projects.gitAction.bind(f.projects);
  const write = vi.spyOn(f.projects, 'gitAction').mockImplementation(async (...args) => {
    expect(f.store.get('workspaceActionOutcome', input.id)).toMatchObject({ status: 'started', command: transformed(f.projectId, input) });
    return bound(...args);
  });
  const events: unknown[] = [];
  f.store.subscribe((event) => {
    if (event.type === 'project.stage') {
      expect(f.store.get('workspaceActionOutcome', input.id)).toMatchObject({ status: 'confirmed', result: { gitWrite: true } });
      events.push(event);
    }
  });
  const first = await f.outcomes.execute(f.projectId, input);
  expect(first.state).toBe('confirmed');
  expect(write).toHaveBeenCalledTimes(1);
  expect(events).toHaveLength(1);
  expect(f.store.receipt(transformed(f.projectId, input))).toEqual(first.state === 'confirmed' ? first.receipt : null);
  await f.restart();
  const forbidden = vi.spyOn(f.projects, 'gitAction').mockRejectedValue(Error('must not write'));
  expect(await f.outcomes.inspect(operation)).toEqual({ state: 'confirmed' });
  expect(await f.outcomes.execute(f.projectId, input)).toEqual(first);
  expect(forbidden).not.toHaveBeenCalled();
}, 60000);

it('retains interrupted remote write as uncertain across restart without submitting it again', async () => {
  const f = await fixture(),
    { input, operation } = await f.operation('review-pr');
  let writes = 0;
  const bodies: unknown[] = [];
  remote(f, async (body) => {
    writes++;
    bodies.push(body);
    throw Error('network interrupted after remote acceptance');
  });
  expect(await f.outcomes.execute(f.projectId, input)).toEqual({ state: 'uncertain' });
  expect(bodies).toEqual([{ commit_id: operation.action.head, event: 'COMMENT', body: 'private review text' }]);
  await f.restart();
  const cli = remote(f, async () => {
    writes++;
    return { id: 99 };
  });
  expect(await f.outcomes.inspect(operation)).toEqual({ state: 'uncertain' });
  expect(await f.outcomes.execute(f.projectId, input)).toEqual({ state: 'uncertain' });
  expect(writes).toBe(1);
  expect(cli).not.toHaveBeenCalled();
  expect(f.store.receipt(transformed(f.projectId, input))).toBeNull();
}, 60000);

it('serializes same-ID attempts across separate Store connections without a double write', async () => {
  const f = await fixture(),
    { input, operation } = await f.operation('review-pr');
  let release!: () => void,
    entered!: () => void,
    writes = 0;
  const held = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r));
  remote(f, async () => {
    writes++;
    entered();
    await held;
    return { id: 77, body: 'private response' };
  });
  const otherStore = new Store(f.data),
    other = new WorkspaceActionOutcomes(new ProjectTools(otherStore), f.github);
  cleanup.push(async () => otherStore.close());
  const pending = f.outcomes.execute(f.projectId, input);
  await started;
  try {
    expect(await other.execute(f.projectId, input)).toEqual({ state: 'uncertain' });
    expect(await other.inspect(operation)).toEqual({ state: 'uncertain' });
  } finally {
    release();
  }
  expect((await pending).state).toBe('confirmed');
  expect(writes).toBe(1);
  expect(await other.execute(f.projectId, input)).toMatchObject({ state: 'confirmed' });
}, 60000);

it.each(['payload', 'type', 'threadId', 'projectId'] as const)(
  'denies reuse of an ID with a changed %s',
  async (field) => {
    const f = await fixture(),
      { input } = await f.operation('review-pr');
    let writes = 0;
    remote(f, async () => {
      writes++;
      return { id: 77 };
    });
    expect((await f.outcomes.execute(f.projectId, input)).state).toBe('confirmed');
    const changed =
      field === 'payload'
        ? { ...input, payload: { ...input.payload, body: 'changed' } }
        : field === 'type'
          ? { ...input, type: 'commit' as const, payload: { message: 'changed', revision: 'b'.repeat(64), expectedHead: 'a'.repeat(40) } }
          : field === 'threadId'
            ? { ...input, threadId: undefined }
            : input;
    await expect(f.outcomes.execute(field === 'projectId' ? 'other' : f.projectId, changed)).rejects.toMatchObject({
      code: 'DUPLICATE_COMMAND',
    });
    expect(writes).toBe(1);
  },
  60000,
);

it('inspects original payload/revision without current diff, review reads, or any write', async () => {
  const f = await fixture(),
    { input, operation } = await f.operation('review-pr');
  remote(f, async () => ({ id: 77 }));
  await f.outcomes.execute(f.projectId, input);
  const status = vi.spyOn(f.projects, 'gitStatus').mockRejectedValue(Error('must not read current diff')),
    review = vi.spyOn(f.github, 'review').mockRejectedValue(Error('must not post')),
    details = vi.spyOn(f.github, 'details').mockRejectedValue(Error('must not infer review text'));
  const seq = f.store.sequence;
  expect(await f.outcomes.inspect(operation)).toEqual({ state: 'confirmed' });
  await expect(f.outcomes.inspect({ ...operation, payload: { ...operation.payload, body: 'different body' } })).rejects.toMatchObject({
    code: 'DUPLICATE_COMMAND',
  });
  expect(await f.outcomes.inspect({ ...operation, action: { ...operation.action, revision: 'f'.repeat(64) } })).toEqual({
    state: 'uncertain',
  });
  expect(status).not.toHaveBeenCalled();
  expect(review).not.toHaveBeenCalled();
  expect(details).not.toHaveBeenCalled();
  expect(f.store.sequence).toBe(seq);
}, 60000);

it('returns revoked after working copy or account access changes, including confirmed receipts', async () => {
  const f = await fixture(),
    { input, operation } = await f.operation('review-pr');
  remote(f, async () => ({ id: 77 }));
  await f.outcomes.execute(f.projectId, input);
  const credential = join(f.data, 'github', 'credentials.json');
  await writeFile(credential, JSON.stringify({ version: 1, token: 'synthetic-other-account', login: 'other' }));
  expect(await f.outcomes.inspect(operation)).toEqual({ state: 'revoked' });
  expect(await f.outcomes.execute(f.projectId, input)).toEqual({ state: 'revoked' });
  await writeFile(credential, JSON.stringify({ version: 1, token: 'synthetic-profile-token', login: 'fixture' }));
  const binding = f.store.get<WorkspaceBinding>('workspaceBinding', f.binding.workspace!.id)!;
  f.store.internal('fixture.rebind', null, () =>
    f.store.put('workspaceBinding', binding.id, f.thread.id, { ...binding, branch: 'gen/changed-binding' }),
  );
  expect(await f.outcomes.inspect(operation)).toEqual({ state: 'revoked' });
  await rm(credential);
  expect(await f.outcomes.inspect(operation)).toEqual({ state: 'revoked' });
}, 60000);

it('keeps private intent, result, credentials and errors out of events, receipts and snapshots', async () => {
  const f = await fixture(),
    { input } = await f.operation('review-pr');
  remote(f, async () => ({ id: 77, body: 'secret remote response', privateKey: 'private-response-key' }));
  const result = await f.outcomes.execute(f.projectId, input);
  const publicData = JSON.stringify({
    result,
    snapshot: f.store.snapshot(),
    events: f.store.eventsAfter(0),
    receipts: f.store.db.prepare('SELECT body FROM receipts').all(),
  });
  for (const value of ['private review text', 'secret remote response', 'private-response-key', 'synthetic-profile-token', f.binding.path])
    expect(publicData).not.toContain(value);
  expect(f.store.get('workspaceActionOutcome', input.id)).toMatchObject({
    command: { payload: { body: 'private review text' } },
    result: { body: 'secret remote response' },
  });
}, 60000);

it('keeps missing and legacy records uncertain without adopting unbound receipts', async () => {
  const f = await fixture(),
    { input, operation } = await f.operation();
  expect(await f.outcomes.inspect(operation)).toEqual({ state: 'uncertain' });
  for (const status of ['started', 'succeeded']) {
    f.store.internal('fixture.legacy', null, () =>
      f.store.put('workspaceAction', input.id, f.thread.id, { status, command: transformed(f.projectId, input) }),
    );
    expect(await f.outcomes.inspect(operation)).toEqual({ state: 'uncertain' });
    expect(await f.outcomes.execute(f.projectId, input)).toEqual({ state: 'uncertain' });
  }
  f.store.command(transformed(f.projectId, input), () => ({ private: 'unbound legacy result' }));
  expect(await f.outcomes.inspect(operation)).toEqual({ state: 'uncertain' });
  expect(await f.outcomes.execute(f.projectId, input)).toEqual({ state: 'uncertain' });
  expect(f.store.get('workspaceActionOutcome', input.id)).toBeNull();
}, 60000);

it('records not-applied only after host rejection before starting and never restarts that ID', async () => {
  const f = await fixture(),
    { input, operation } = await f.operation('review-pr');
  let tokens = 0;
  const token = f.github.auth.token.bind(f.github.auth);
  vi.spyOn(f.github.auth, 'token').mockImplementation(async () => {
    tokens++;
    if (tokens === 2) throw Error('revoked before execution');
    return token();
  });
  const write = vi.spyOn(f.github, 'review');
  expect(await f.outcomes.execute(f.projectId, input)).toEqual({ state: 'not-applied' });
  expect(write).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  await f.restart();
  expect(await f.outcomes.inspect(operation)).toEqual({ state: 'not-applied' });
  expect(await f.outcomes.execute(f.projectId, input)).toEqual({ state: 'not-applied' });
}, 60000);

it('keeps failures after started uncertain even when there is no receipt', async () => {
  const f = await fixture(),
    { input, operation } = await f.operation();
  vi.spyOn(f.projects, 'gitAction').mockRejectedValue(Error('unclassified failure after entering tool'));
  expect(await f.outcomes.execute(f.projectId, input)).toEqual({ state: 'uncertain' });
  expect(await f.outcomes.inspect(operation)).toEqual({ state: 'uncertain' });
  expect(f.store.receipt(transformed(f.projectId, input))).toBeNull();
}, 60000);

it('keeps completed external write uncertain if durable result commit fails', async () => {
  const f = await fixture(),
    { input, operation } = await f.operation('review-pr');
  let writes = 0;
  remote(f, async () => {
    writes++;
    return { id: 77 };
  });
  f.store.db.exec("CREATE TRIGGER fixture_receipt_failure BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT,'fixture disk failure'); END");
  expect(await f.outcomes.execute(f.projectId, input)).toEqual({ state: 'uncertain' });
  await f.restart();
  expect(await f.outcomes.inspect(operation)).toEqual({ state: 'uncertain' });
  expect(await f.outcomes.execute(f.projectId, input)).toEqual({ state: 'uncertain' });
  expect(writes).toBe(1);
}, 60000);

it('recovers a confirmed review when the remote branch name differs from the managed local branch', async () => {
  const f = await fixture(),
    { input, operation } = await f.operation('review-pr');
  if (operation.comparison.kind !== 'pull-request') throw Error('Expected PR fixture');
  operation.comparison.headRef = 'feature/review';
  remote(f, async () => ({ id: 77 }));
  expect((await f.outcomes.execute(f.projectId, input)).state).toBe('confirmed');
  await f.restart();
  expect(await f.outcomes.inspect(operation)).toEqual({ state: 'confirmed' });
}, 60000);

it('keeps an active prepared reservation uncertain until its owner durably proves no execution began', async () => {
  const f = await fixture(),
    { input, operation } = await f.operation('review-pr');
  let tokens = 0,
    entered!: () => void,
    release!: () => void;
  const waiting = new Promise<void>((r) => (entered = r)),
    held = new Promise<void>((r) => (release = r)),
    token = f.github.auth.token.bind(f.github.auth);
  vi.spyOn(f.github.auth, 'token').mockImplementation(async () => {
    if (++tokens === 2) {
      entered();
      await held;
      throw Error('pre-execution rejection');
    }
    return token();
  });
  const pending = f.outcomes.execute(f.projectId, input);
  await waiting;
  try {
    expect(await f.outcomes.inspect(operation)).toEqual({ state: 'uncertain' });
    expect(await f.outcomes.execute(f.projectId, input)).toEqual({ state: 'uncertain' });
  } finally {
    release();
  }
  expect(await pending).toEqual({ state: 'not-applied' });
  expect(await f.outcomes.inspect(operation)).toEqual({ state: 'not-applied' });
}, 60000);

it('pins profile access while GitHubTools is awaiting remote validation', async () => {
  const f = await fixture(),
    { input } = await f.operation('review-pr');
  let writes = 0;
  const credential = join(f.data, 'github', 'credentials.json');
  const run = vi.fn(async (_path: string, args: string[]) => {
    if (args.includes('POST')) {
      writes++;
      return JSON.stringify({ id: 77 });
    }
    await expect(
      writeFile(credential, JSON.stringify({ version: 1, token: 'synthetic-switched-token', login: 'switched' })),
    ).rejects.toThrow();
    const status = await f.projects.gitStatus(f.projectId, f.thread.id);
    return JSON.stringify({ number: 12, headRefOid: status.head, headRefName: status.branch });
  });
  (f.github as unknown as { run: typeof run }).run = run;
  expect((await f.outcomes.execute(f.projectId, input)).state).toBe('confirmed');
  expect(writes).toBe(1);
  expect(JSON.parse(await readFile(credential, 'utf8')).token).toBe('synthetic-profile-token');
}, 60000);

it('rejects a profile replaced between inspection identity capture and credential read', async () => {
  const f = await fixture(),
    { input, operation } = await f.operation('review-pr');
  remote(f, async () => ({ id: 77 }));
  await f.outcomes.execute(f.projectId, input);
  const credential = join(f.data, 'github', 'credentials.json'),
    token = f.github.auth.token.bind(f.github.auth);
  vi.spyOn(f.github.auth, 'token').mockImplementationOnce(async () => {
    await rename(credential, credential + '.previous');
    await writeFile(credential, JSON.stringify({ version: 1, token: 'synthetic-profile-token', login: 'fixture' }));
    return token();
  });
  expect(await f.outcomes.inspect(operation)).toEqual({ state: 'revoked' });
}, 60000);

it('supports local unstage and commit through the original revision and replays a commit without a second write', async () => {
  const f = await fixture();
  await writeFile(join(f.binding.path, 'one.txt'), 'private local change\n');
  const stage = await f.operation();
  expect((await f.outcomes.execute(f.projectId, stage.input)).state).toBe('confirmed');
  const unstage = await f.operation('unstage');
  expect((await f.outcomes.execute(f.projectId, unstage.input)).state).toBe('confirmed');
  expect((await f.projects.gitStatus(f.projectId, f.thread.id)).files[0]?.staged).toBe(false);
  const restage = await f.operation();
  await f.outcomes.execute(f.projectId, restage.input);
  const commit = await f.operation('commit');
  const result = await f.outcomes.execute(f.projectId, commit.input);
  expect(result.state).toBe('confirmed');
  const after = await f.projects.gitStatus(f.projectId, f.thread.id);
  expect(after.head).not.toBe(commit.status.head);
  expect(after.files).toHaveLength(0);
  expect(await f.outcomes.execute(f.projectId, commit.input)).toEqual(result);
  expect((await f.projects.gitStatus(f.projectId, f.thread.id)).head).toBe(after.head);
}, 60000);
