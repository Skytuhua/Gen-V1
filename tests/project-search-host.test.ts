import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HarnessError, type Thread } from '../packages/contracts/index.ts';
import { projectOwnerSchema, projectSearchPathSchema, searchIssueSchema, searchMatchSchema, searchRequestSchema, searchResponseSchema, type SearchResponse } from '../packages/contracts/project-search.ts';
import { Store } from '../packages/storage/store.ts';
import { ProjectTools, type WorkspaceBinding } from '../packages/workspace/tools.ts';
import { ProjectSearch, PROJECT_SEARCH_LIMITS } from '../packages/workspace/project-search.ts';
import { withPathGuard } from '../packages/core/file-access.ts';

// Only the native guard edge is synthetic in portable service tests. Files, byte reads,
// hashes, SQLite and ProjectTools.binding are real. A separate test uses the real guard.
vi.mock('../packages/core/file-access.ts', async original => ({
  ...await original<typeof import('../packages/core/file-access.ts')>(),
  withPathGuard: vi.fn<typeof withPathGuard>(async (_paths, signal, action) => { signal.throwIfAborted(); return action([]); }),
}));
vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});
const cleanup: (() => Promise<void>)[] = [];
beforeEach(async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.mocked(fs.open).mockImplementation(actual.open);
  vi.mocked(withPathGuard).mockImplementation(async (_paths, signal, action) => { signal.throwIfAborted(); return action([]); });
});
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); vi.mocked(withPathGuard).mockClear(); for (const close of cleanup.splice(0).reverse()) await close(); });
const digest = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const statIdentity = async (path: string) => { const info = await fs.lstat(path, { bigint: true }); return { dev: String(info.dev), ino: String(info.ino) }; };
async function fixture(clock?: { now(): number; monotonic(): number }) {
  const root = await fs.mkdtemp(join(tmpdir(), 'gen-project-search-')), path = join(root, 'repo'), store = new Store(join(root, 'data'));
  await fs.mkdir(path);
  const projects = new ProjectTools(store), receipt = await projects.connect({ id: 'connect', type: 'workspace.project.connect', payload: { name: 'Search', path } });
  const projectId = (receipt.result as { projects: { id: string }[] }).projects[0]!.id, search = new ProjectSearch(projects, clock);
  cleanup.push(async () => { search.dispose(); await projects.dispose(); store.close(); await fs.rm(root, { recursive: true, force: true }); });
  const write = async (relative: string, data: string | Buffer) => { const file = join(path, relative); await fs.mkdir(join(file, '..'), { recursive: true }); await fs.writeFile(file, data); };
  return { root, path, store, projects, projectId, search, write };
}
async function allPages(f: Awaited<ReturnType<typeof fixture>>, q: string, first: SearchResponse, limit = 100) {
  const matches = [...first.matches]; let page = first;
  while (page.nextCursor !== null) {
    page = await f.search.search(f.projectId, { q, limit, cursor: page.nextCursor });
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(512 * 1024);
    matches.push(...page.matches);
  }
  return matches;
}

describe('frozen strict schemas', () => {
  it('counts Unicode code points, trims queries, and rejects unknown or malformed input', () => {
    expect(searchRequestSchema.parse({ q: '  ' + '😀'.repeat(200) + '  ' }).q).toHaveLength(400);
    for (const input of [{ q: '' }, { q: ' \n ' }, { q: '😀'.repeat(201) }, { q: '\ud800' }, { q: 'x', limit: '1' }, { q: 'x', limit: 0 }, { q: 'x', limit: 101 }, { q: 'x', limit: 1.5 }, { q: 'x', threadId: '../t' }, { q: 'x', unexpected: true }]) expect(searchRequestSchema.safeParse(input).success).toBe(false);
  });
  it.each(['/absolute', '../secret', 'a/../secret', './a', 'a//b', 'a/', 'C:/file', 'a\\b', 'a\0b', 'a:stream', '.git/config', 'a/.GIT/config', 'a/CON.txt', 'nul', 'a/COM¹.txt', 'a/LPT9', 'a/foo.', 'a/foo ', 'harness.sqlite', 'a/.harness-directory-guard', 'é'.repeat(513)])('rejects unsafe result paths: %j', path => {
    expect(projectSearchPathSchema.safeParse(path).success).toBe(false);
  });
  it('keeps all response objects strict and preserves the exact nullable owner/match fields', async () => {
    const f = await fixture(); await f.write('needle.txt', 'needle');
    const response = await f.search.search(f.projectId, { q: 'needle' });
    expect(searchResponseSchema.parse(response)).toEqual(response);
    for (const [schema, value] of [[projectOwnerSchema, response.owner], [searchMatchSchema, response.matches[0]], [searchIssueSchema, { path: null, reason: 'changed' }], [searchResponseSchema, response]] as const) expect(schema.safeParse({ ...value, unknown: 1 }).success).toBe(false);
    expect(searchMatchSchema.safeParse({ ...response.matches[0], line: 1 }).success).toBe(false);
    expect(searchIssueSchema.safeParse({ path: '/private', reason: 'changed' }).success).toBe(false);
  });
});

it('reads live untracked path/content hits, sorts paths then kinds/lines, and hashes complete raw bytes', async () => {
  const f = await fixture(), raw = '\ufeff😀 ÉCOLE école\r\nsecond École\rlast\n';
  await f.write('z-ÉCOLE.txt', raw); await f.write('a/école.txt', 'École twice école'); await f.write('a.txt', 'none');
  const before = f.store.sequence, binding = vi.spyOn(f.projects, 'binding');
  const result = await f.search.search(f.projectId, { q: '  école ' });
  expect(result.owner).toMatchObject({ projectId: f.projectId, threadId: null, workingCopyId: null, binding: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(result.matches.map(({ path, kind, line, column }) => [path, kind, line, column])).toEqual([
    ['a/école.txt', 'path', null, null], ['a/école.txt', 'text', 1, 1], ['z-ÉCOLE.txt', 'path', null, null], ['z-ÉCOLE.txt', 'text', 1, 4], ['z-ÉCOLE.txt', 'text', 2, 8],
  ]);
  expect(result.matches.filter(match => match.path === 'z-ÉCOLE.txt').every(match => match.sha256 === digest(raw))).toBe(true);
  expect(result).toMatchObject({ complete: true, nextCursor: null, issues: [], limits: PROJECT_SEARCH_LIMITS });
  expect(JSON.stringify(result)).not.toContain(f.root); expect(JSON.stringify(result)).not.toContain('ino');
  expect(binding).toHaveBeenCalledTimes(2); expect(f.store.sequence).toBe(before);
  await f.write('a.txt', 'new école');
  expect((await f.search.search(f.projectId, { q: 'école' })).matches.some(match => match.path === 'a.txt')).toBe(true);
  expect((await f.search.search(f.projectId, { q: 'missing' })).matches).toEqual([]);
});

it('treats query metacharacters and shell syntax as literal text and preserves code-point columns/previews', async () => {
  const f = await fixture(), literal = '.*[$(echo unsafe)]';
  await f.write('literal.txt', '😀İ ' + literal + '\n' + '😀'.repeat(600) + literal);
  const result = await f.search.search(f.projectId, { q: literal });
  expect(result.matches.map(match => match.column)).toEqual([4, 601]);
  expect([...result.matches[1]!.preview]).toHaveLength(512);
  expect((await f.search.search(f.projectId, { q: 'absent.*' })).matches).toEqual([]);
});

it('matches Unicode case folds and reports columns in the original unexpanded line', async () => {
  const f = await fixture(); await f.write('Straße.txt', '😀 ẞ Straße ΟΣ ος οσ İ x');
  expect((await f.search.search(f.projectId, { q: 'STRASSE' })).matches.map(match => [match.kind, match.column])).toEqual([['path', null], ['text', 5]]);
  expect((await f.search.search(f.projectId, { q: 'οσ' })).matches[0]!.column).toBe(12);
  expect((await f.search.search(f.projectId, { q: 'x' })).matches.find(match => match.kind === 'text')!.column).toBe(23);
  expect((await f.search.search(f.projectId, { q: 'ı' })).matches).toEqual([]);
});

it('uses the exact admitted main-thread working copy, including files under host worktrees', async () => {
  const f = await fixture(), path = join(f.store.dataDir, 'worktrees', 'copy'); await fs.mkdir(path, { recursive: true });
  await f.write('root.txt', 'needle in root'); await fs.writeFile(join(path, 'untracked.txt'), 'needle in copy');
  const identity = await statIdentity(path), thread: Thread = { id: 'main', projectId: f.projectId, workspaceId: 'copy', title: 'Main', projectName: 'Search', kind: 'main', createdAt: '', updatedAt: '', status: 'ready', epoch: 0, runId: null, modelId: null, sessionPath: null };
  const workspace: WorkspaceBinding = { id: 'copy', threadId: thread.id, projectId: f.projectId, path, identity, branch: 'gen/main', gitDirectory: join(f.store.dataDir, 'git', 'copy'), commonDirectory: join(f.store.dataDir, 'git'), gitDirectoryIdentity: identity, commonDirectoryIdentity: identity };
  f.store.internal('fixture', null, () => {
    f.store.put('thread', thread.id, thread.id, thread); f.store.put('workspaceBinding', workspace.id, thread.id, workspace);
    f.store.put('thread', 'other', 'other', { ...thread, id: 'other', projectId: 'different' });
    f.store.put('thread', 'side', 'side', { ...thread, id: 'side', kind: 'side' });
  });
  const copy = await f.search.search(f.projectId, { threadId: 'main', q: 'needle' });
  expect(copy.owner).toMatchObject({ threadId: 'main', workingCopyId: 'copy' }); expect(copy.matches.map(match => match.path)).toEqual(['untracked.txt']);
  const root = await f.search.search(f.projectId, { q: 'needle' }); expect(copy.owner.binding).not.toBe(root.owner.binding);
  for (const threadId of ['other', 'side', 'unknown']) await expect(f.search.search(f.projectId, { threadId, q: 'needle' })).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
});

it('discloses binary, per-file size and deliberate exclusions without marking an otherwise complete scan incomplete', async () => {
  const f = await fixture();
  for (const path of ['.git/config', 'deep/.GIT/config', 'node_modules/pkg/a.txt', '.harness-directory-guard', 'harness.sqlite', 'safe/CON.txt']) await f.write(path, 'needle private');
  await f.write('needle-invalid.txt', Buffer.from([0xc0, 0xaf])); await f.write('needle-nul.txt', Buffer.from('needle\0secret'));
  await f.write('large.txt', Buffer.alloc(1024 * 1024 + 1)); await f.write('ok.txt', 'needle');
  const result = await f.search.search(f.projectId, { q: 'needle' });
  expect(result.matches.map(match => match.path)).toEqual(['ok.txt']); expect(result.complete).toBe(true);
  expect(result.issues).toEqual(expect.arrayContaining([{ path: 'needle-invalid.txt', reason: 'binary' }, { path: 'needle-nul.txt', reason: 'binary' }, { path: 'large.txt', reason: 'too_large' }, { path: null, reason: 'excluded' }]));
  expect(result.exclusions).toEqual(['.git', 'node_modules', '.harness-directory-guard', 'links/reparse points', 'multiple-hardlink files', 'protected host storage']);
  expect(searchResponseSchema.safeParse(result).success).toBe(true);
});

it('never descends into protected host storage, including checkpoint bytes', async () => {
  const f = await fixture(); await fs.mkdir(join(f.store.dataDir, 'accounts')); await fs.mkdir(join(f.store.dataDir, 'checkpoints'));
  await fs.writeFile(join(f.store.dataDir, 'accounts', 'private.txt'), 'needle private account'); await fs.writeFile(join(f.store.dataDir, 'checkpoints', 'private.txt'), 'needle private checkpoint');
  const real = await f.projects.binding(f.projectId); vi.spyOn(f.projects, 'binding').mockResolvedValue({ ...real, path: f.root });
  const result = await f.search.search(f.projectId, { q: 'needle' });
  expect(result.matches).toEqual([]); expect(JSON.stringify(result)).not.toContain('private.txt');
  expect(result.issues.filter(issue => issue.reason === 'excluded').length).toBeGreaterThanOrEqual(3);
});

it('bounds the issue list and reports truncation', async () => {
  const f = await fixture(); await Promise.all(Array.from({ length: 105 }, (_, i) => f.write(`binary-${i}.txt`, Buffer.from([0]))));
  const result = await f.search.search(f.projectId, { q: 'x' });
  expect(result).toMatchObject({ complete: true, issuesTruncated: true }); expect(result.issues).toHaveLength(100);
});

it('stops at the 1,000-match cap and leaves an exactly full finished scan complete', async () => {
  const f = await fixture(); await f.write('hits.txt', 'needle\n'.repeat(1001));
  const result = await f.search.search(f.projectId, { q: 'needle' });
  expect(result.complete).toBe(false); expect(result.issues).toContainEqual({ path: null, reason: 'match_limit' });
  expect(await allPages(f, 'needle', result)).toHaveLength(1000);
  await f.write('hits.txt', 'needle\n'.repeat(1000));
  expect((await f.search.search(f.projectId, { q: 'needle' })).complete).toBe(true);
});

it('stops before reading more than 32 MiB of ordinary file bytes', async () => {
  const f = await fixture({ now: () => 0, monotonic: () => 0 }); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const block = Buffer.alloc(1024 * 1024);
  await Promise.all(Array.from({ length: 33 }, (_, i) => f.write(`file-${i}.txt`, block)));
  const result = await f.search.search(f.projectId, { q: 'needle' });
  expect(result.complete).toBe(false); expect(result.issues).toContainEqual({ path: null, reason: 'byte_limit' });
  expect(result.issues.filter(issue => issue.reason === 'binary')).toHaveLength(32);
  expect(vi.mocked(withPathGuard).mock.calls.filter(([paths]) => paths[0]!.leaf)).toHaveLength(32);
});

it('stops at 10,000 ordinary files, without visiting the next file', async () => {
  const f = await fixture({ now: () => 0, monotonic: () => 0 });
  for (let batch = 0; batch < 101; batch++) await Promise.all(Array.from({ length: batch === 100 ? 1 : 100 }, (_, i) => f.write(`file-${batch * 100 + i}.txt`, '')));
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const result = await f.search.search(f.projectId, { q: 'needle' });
  expect(result.complete).toBe(false); expect(result.issues).toContainEqual({ path: null, reason: 'file_limit' });
  expect(vi.mocked(withPathGuard).mock.calls.filter(([paths]) => paths[0]!.leaf)).toHaveLength(10_000);
}, 60_000);

it('bounds UTF-8 snapshot and response sizes, reports response_limit, and emits every retained match exactly once', async () => {
  const f = await fixture(); await f.write('hits.txt', ('needle' + '😀'.repeat(512) + '\n').repeat(1000));
  // The source itself must stay under the per-file cap.
  await f.write('a.txt', ('needle' + '😀'.repeat(250) + '\n').repeat(700));
  await f.write('b.txt', ('needle' + '😀'.repeat(250) + '\n').repeat(700));
  const result = await f.search.search(f.projectId, { q: 'needle' });
  expect(result.complete).toBe(false); expect(result.issues).toContainEqual({ path: null, reason: 'response_limit' });
  const matches = await allPages(f, 'needle', result);
  expect(matches.length).toBeGreaterThan(100); expect(matches.length).toBeLessThan(1000);
  expect(new Set(matches.map(match => `${match.path}:${match.line}`)).size).toBe(matches.length);
  expect(Buffer.byteLength(JSON.stringify({ ...result, matches, nextCursor: null }))).toBeLessThanOrEqual(1024 * 1024);
});

it('pages immutable results with stale hashes and rejects tampering, query/page/owner changes and restart', async () => {
  const f = await fixture(); await f.write('a.txt', 'needle\nneedle\nneedle');
  const first = await f.search.search(f.projectId, { q: 'NEEDLE', limit: 1 }); expect(first.complete).toBe(true);
  await f.write('a.txt', 'edited needle'); await f.write('new.txt', 'needle');
  const cursor = first.nextCursor!, second = await f.search.search(f.projectId, { q: ' needle ', limit: 1, cursor });
  expect(second.matches[0]).toMatchObject({ line: 2, sha256: digest('needle\nneedle\nneedle') });
  expect(second.matches[0]!.sha256).not.toBe(digest(await fs.readFile(join(f.path, 'a.txt'))));
  const third = await f.search.search(f.projectId, { q: 'needle', limit: 1, cursor: second.nextCursor! }); expect(third.nextCursor).toBeNull();
  first.matches[0]!.preview = 'mutated'; second.issues.push({ path: null, reason: 'timeout' });
  expect((await f.search.search(f.projectId, { q: 'needle', limit: 1, cursor })).issues).toEqual([]);
  for (const input of [{ q: 'different', limit: 1, cursor }, { q: 'needle', limit: 2, cursor }, { q: 'needle', limit: 1, cursor: cursor.replace('.1.', '.2.') }, { q: 'needle', limit: 1, cursor: 'random' }, { q: 'needle', limit: 1, cursor, threadId: 'other' }]) await expect(f.search.search(f.projectId, input)).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  await expect(f.search.search('different', { q: 'needle', limit: 1, cursor })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  await expect(new ProjectSearch(f.projects).search(f.projectId, { q: 'needle', limit: 1, cursor })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
});

it('expires cursors at five minutes and evicts the oldest snapshot after 100 retained scans', async () => {
  let now = 0; const f = await fixture({ now: () => now, monotonic: () => 0 }); await f.write('a.txt', 'needle\nneedle');
  const first = await f.search.search(f.projectId, { q: 'needle', limit: 1 });
  for (let i = 0; i < 100; i++) await f.search.search(f.projectId, { q: 'needle', limit: 1 });
  await expect(f.search.search(f.projectId, { q: 'needle', limit: 1, cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  const fresh = await f.search.search(f.projectId, { q: 'needle', limit: 1 }); now = 300_000;
  await expect(f.search.search(f.projectId, { q: 'needle', limit: 1, cursor: fresh.nextCursor! })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
});

it('invalidates a page after root rebinding and denies an initial response if admission is revoked during scanning', async () => {
  const f = await fixture(); await f.write('a.txt', 'needle\nneedle');
  const first = await f.search.search(f.projectId, { q: 'needle', limit: 1 }), other = join(f.root, 'other'); await fs.mkdir(other);
  f.store.internal('fixture', null, () => f.store.put('workspaceProjectRoot', f.projectId, null, { path: other, identity: { dev: '0', ino: '0' } }));
  await expect(f.search.search(f.projectId, { q: 'needle', limit: 1, cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  const binding = vi.spyOn(f.projects, 'binding'); binding.mockRejectedValueOnce(new HarnessError('PROJECT_NOT_CONNECTED', 'Connect a project.'));
  await expect(f.search.search(f.projectId, { q: 'x' })).rejects.toMatchObject({ code: 'PROJECT_NOT_CONNECTED' });
  binding.mockRestore();
  f.store.internal('fixture', null, () => f.store.put('workspaceProjectRoot', f.projectId, null, { path: f.path, identity: { dev: '0', ino: '0' } }));
  const current = await statIdentity(f.path); f.store.internal('fixture', null, () => f.store.put('workspaceProjectRoot', f.projectId, null, { path: f.path, identity: current }));
  const original = f.projects.binding.bind(f.projects); let calls = 0;
  vi.spyOn(f.projects, 'binding').mockImplementation(async (...args) => { if (++calls === 2) throw new HarnessError('CAPABILITY_DENIED', 'Access revoked.'); return original(...args); });
  await expect(f.search.search(f.projectId, { q: 'needle' })).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
});

it('returns partial 200 data at the two-second deadline and never starts work after a late guard acquisition', async () => {
  const f = await fixture(); await f.write('a.txt', 'needle'); vi.useFakeTimers();
  let release!: () => void, entered!: () => void, callbacks = 0;
  const held = new Promise<void>(resolve => { release = resolve; }), acquired = new Promise<void>(resolve => { entered = resolve; });
  vi.mocked(withPathGuard).mockImplementationOnce(async (_paths, _signal, action) => { entered(); await held; callbacks++; return action([]); });
  const pending = f.search.search(f.projectId, { q: 'needle' }); await acquired; await vi.advanceTimersByTimeAsync(2000);
  const result = await pending; expect(result).toMatchObject({ complete: false, matches: [], issues: [{ path: null, reason: 'timeout' }] });
  release(); await Promise.resolve(); await Promise.resolve(); expect(callbacks).toBe(1); expect(withPathGuard).toHaveBeenCalledTimes(1);
});

it('honors pre-cancellation and mid-scan cancellation without scheduling later file reads', async () => {
  const f = await fixture(), controller = new AbortController(); await f.write('a.txt', 'needle'); controller.abort();
  await expect(f.search.search(f.projectId, { q: 'needle' }, controller.signal)).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
  expect(withPathGuard).not.toHaveBeenCalled();
  const during = new AbortController();
  vi.mocked(withPathGuard).mockImplementationOnce(async (_paths, _signal, action) => { during.abort(); return action([]); });
  await expect(f.search.search(f.projectId, { q: 'needle' }, during.signal)).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
  expect(withPathGuard).toHaveBeenCalledTimes(1);
});

it('reports a lost native guard as an incomplete scan', async () => {
  const f = await fixture(); await f.write('a.txt', 'needle');
  vi.mocked(withPathGuard).mockImplementationOnce(async (_paths, _signal, _action, loss) => { loss?.(); throw new HarnessError('CAPABILITY_DENIED', 'Synthetic native failure.'); });
  const result = await f.search.search(f.projectId, { q: 'needle' }); expect(result).toMatchObject({ complete: false, matches: [], issues: [{ path: null, reason: 'changed' }] });
  expect(JSON.stringify(result)).not.toContain('Synthetic');
});

it('surfaces unreadable files without raw host errors or absolute paths', async () => {
  const f = await fixture(); await f.write('a.txt', 'needle');
  const original = (await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).open;
  vi.mocked(fs.open).mockImplementation(async (...args) => { if (String(args[0]) === join(f.path, 'a.txt')) throw Object.assign(new Error('/private/credential.txt denied'), { code: 'EACCES' }); return original(...args); });
  const result = await f.search.search(f.projectId, { q: 'needle' });
  expect(result).toMatchObject({ complete: false, matches: [], issues: [{ path: 'a.txt', reason: 'unreadable' }] });
  expect(JSON.stringify(result)).not.toContain('/private');
});

it('excludes live symlinks/junctions and hard links without following their targets', async () => {
  const f = await fixture(), outside = join(f.root, 'outside'); await fs.mkdir(outside); await fs.writeFile(join(outside, 'private.txt'), 'needle outside');
  await fs.symlink(outside, join(f.path, 'junction'), process.platform === 'win32' ? 'junction' : 'dir');
  await fs.link(join(outside, 'private.txt'), join(f.path, 'hard.txt'));
  const result = await f.search.search(f.projectId, { q: 'needle' }); expect(result.matches).toEqual([]); expect(result.complete).toBe(true);
  expect(result.issues).toEqual(expect.arrayContaining([{ path: 'junction', reason: 'excluded' }, { path: 'hard.txt', reason: 'excluded' }]));
});

it.each(['symlink', 'hardlink', 'ordinary', 'directory'] as const)('denies a race-swapped %s at the read boundary', async mode => {
  const f = await fixture(), outside = join(f.root, 'outside'); await fs.mkdir(outside); await fs.writeFile(join(outside, 'a.txt'), 'needle outside secret'); await f.write('sub/a.txt', 'needle inside');
  let swapped = false;
  vi.mocked(withPathGuard).mockImplementation(async (paths, _signal, action) => {
    if (paths[0]!.leaf && !swapped) {
      swapped = true;
      if (mode === 'directory') { await fs.rename(join(f.path, 'sub'), join(f.path, 'old-sub')); await fs.symlink(outside, join(f.path, 'sub'), process.platform === 'win32' ? 'junction' : 'dir'); }
      else {
        await fs.rename(join(f.path, 'sub/a.txt'), join(f.path, 'sub/old.txt'));
        if (mode === 'symlink') {
          if (process.platform === 'win32') throw new HarnessError('CAPABILITY_DENIED', 'Native boundary denies file substitution.');
          await fs.symlink(join(outside, 'a.txt'), join(f.path, 'sub/a.txt'));
        } else if (mode === 'hardlink') await fs.link(join(outside, 'a.txt'), join(f.path, 'sub/a.txt'));
        else await fs.writeFile(join(f.path, 'sub/a.txt'), 'needle replacement');
      }
    }
    return action([]);
  });
  const result = await f.search.search(f.projectId, { q: 'needle' }); expect(swapped).toBe(true);
  expect(result.complete).toBe(false); expect(result.issues).toContainEqual({ path: 'sub/a.txt', reason: 'changed' });
  expect(result.matches.some(match => match.preview.includes('outside') || match.preview.includes('replacement'))).toBe(false);
});

it('detects in-place content changes during a read and emits no stale file matches', async () => {
  const f = await fixture(); await f.write('a.txt', 'needle original');
  const original = (await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).open;
  vi.mocked(fs.open).mockImplementation(async (...args) => {
    const handle = await original(...args);
    if (String(args[0]) === join(f.path, 'a.txt')) {
      const read = handle.read.bind(handle);
      vi.spyOn(handle, 'read').mockImplementation(async (...readArgs: Parameters<typeof read>) => { const result = await read(...readArgs); await fs.appendFile(join(f.path, 'a.txt'), 'changed'); return result; });
    }
    return handle;
  });
  const result = await f.search.search(f.projectId, { q: 'needle' }); expect(result).toMatchObject({ complete: false, matches: [], issues: [{ path: 'a.txt', reason: 'changed' }] });
});

it.skipIf(process.platform === 'win32')('rejects malformed UTF-8 names and duplicate Windows path names', async () => {
  const f = await fixture(); await fs.writeFile(Buffer.concat([Buffer.from(f.path + '/'), Buffer.from([0xff])]), 'needle private');
  await f.write('A.txt', 'needle'); await f.write('a.txt', 'needle');
  const result = await f.search.search(f.projectId, { q: 'needle' }); expect(result.matches).toHaveLength(1);
  expect(result.issues).toContainEqual({ path: null, reason: 'excluded' });
});

it('uses the real platform guard: Windows ordinary reads succeed; unsupported platforms fail closed', async () => {
  const f = await fixture(); await f.write('a.txt', 'needle');
  const actual = await vi.importActual<typeof import('../packages/core/file-access.ts')>('../packages/core/file-access.ts');
  vi.mocked(withPathGuard).mockImplementation(actual.withPathGuard);
  const result = await f.search.search(f.projectId, { q: 'needle' });
  if (process.platform === 'win32') expect(result).toMatchObject({ complete: true, matches: [{ path: 'a.txt', kind: 'text' }] });
  else expect(result).toMatchObject({ complete: false, matches: [], issues: [{ path: null, reason: 'changed' }] });
});
