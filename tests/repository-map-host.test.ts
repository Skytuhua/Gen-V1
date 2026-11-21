import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Service } from '../packages/core/service';
import { Store } from '../packages/storage/store';
import { ToolAuthority, buildToolRegistry } from '../packages/core/tool-authority';
import { createHostTools, loadDomainTools } from '../packages/runtime-pi/tool-definitions';
import { hermesContextExposure, isBoundedContextRead } from '../packages/core/context-progressive-tools';
import type { DataRecord, ResourceGrant, RuntimeAdapter } from '../packages/contracts';
import { testEffectAuthenticator } from './fixtures/effect-authenticator.ts';

const custody = vi.hoisted(() => ({ active: 0, read: [] as string[], afterRead: undefined as (() => void) | undefined, hold: undefined as Promise<void> | undefined }));
// Portable host orchestration test. Resolution and file bytes are real; native
// Windows file-lock behavior is tested separately without this guard wrapper.
vi.mock('../packages/core/file-access.ts', async original => {
  const module = await original<typeof import('../packages/core/file-access.ts')>();
  return { ...module,
    withResourceGrant: async <T>(grant: ResourceGrant, dataDir: string, relative: string | undefined, write: boolean, signal: AbortSignal, action: (path: string) => Promise<T>) => {
      if (signal.aborted) throw new Error('Cancelled');
      const { resolveGrant } = await import('../packages/core/security.ts');
      const path = await resolveGrant(grant, relative, write, dataDir);
      custody.active++; try { return await action(path); } finally { custody.active--; }
    },
    readBoundFile: async (...args: Parameters<typeof module.readBoundFile>) => {
      custody.read.push(args[0]); const bytes = await module.readBoundFile(...args); await custody.hold; custody.afterRead?.(); return bytes;
    },
  };
});

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { custody.afterRead = undefined; custody.hold = undefined; custody.read.length = 0; for (const close of cleanup.splice(0)) await close(); });
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function fixture(files: Record<string, string>) {
  const directory = mkdtempSync(join(tmpdir(), 'm04-repo-map-')), root = join(directory, 'project'), store = new Store(join(directory, 'profile'));
  mkdirSync(root);
  for (const [path, content] of Object.entries(files)) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); }
  const info = statSync(root, { bigint: true }), ctx = { threadId: 'thread', runId: 'run', epoch: 1 };
  const grant: ResourceGrant = { id: 'project', threadId: 'thread', kind: 'project', path: root, label: 'Approved project', writable: false, createdAt: '', identity: { dev: String(info.dev), ino: String(info.ino) } };
  const runtime: RuntimeAdapter = { configure: () => {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
  const service = new Service(store, runtime, { toolEffectFlags: { 'audit.effectsV1': true, 'security.authorityV1': true }, toolEffectAuthenticator: testEffectAuthenticator() });
  store.internal('fixture', 'thread', () => {
    store.put('thread', 'thread', 'thread', { id: 'thread', title: 'Fixture', status: 'working', modelId: 'test/model', accountId: null, sessionPath: '/synthetic-session', ...ctx });
    store.put('resource', grant.id, grant.threadId, grant);
  });
  cleanup.push(async () => { await service.dispose(); store.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 5 }); });
  const map = async (paths: string[], extra: Record<string, unknown> = {}) => await service.tool({ name: 'repository_map', args: { resourceId: grant.id, paths, ...extra } }, ctx) as DataRecord;
  return { directory, root, store, service, grant, ctx, map };
}

it('exposes an exact registered read schema through native tool metadata and deferred disclosure', async () => {
  const definition = new ToolAuthority(buildToolRegistry()).require('repository_map');
  expect(definition).toMatchObject({ risk: 'READ', replayClass: 'READ_RETRYABLE', allowedRoles: ['run'], approval: 'none' });
  const tools = createHostTools(await loadDomainTools(), async () => ({}));
  const metadata = tools.find(tool => tool.name === 'repository_map');
  expect(metadata?.parameters).toMatchObject({ type: 'object', additionalProperties: false });
  expect(hermesContextExposure('repository_map', false)).toBe('DEFERRED');
  expect(isBoundedContextRead('repository_map')).toBe(true);
  for (const name of ['database_schema', 'database_query']) {
    expect(hermesContextExposure(name, false)).toBe('DEFERRED');
    expect(isBoundedContextRead(name)).toBe(true);
  }
  const flagOffTools = await loadDomainTools();
  expect(flagOffTools.map(t => t.name)).not.toContain('database_schema');
  expect(flagOffTools.map(t => t.name)).not.toContain('database_query');
});

it('returns verified import edges and export lines through the actual Service tool with held custody', async () => {
  const source = "import { other } from './other';\nexport function render() { return other(); }\n";
  const f = fixture({ 'src/main.ts': source, 'notes.py': 'print(1)\n', 'unrequested.ts': 'export const NEVER_READ = 1;' });
  const held: number[] = [], unsubscribe = f.store.subscribe(event => { if (event.type === 'data.published') held.push(custody.active); });
  const result = await f.map(['src/main.ts', 'notes.py']); unsubscribe();
  expect(result.value).toMatchObject({ parser: 'typescript@5.9.3', measurement: 'BYTE_ONLY', files: [
    { path: 'notes.py', mode: 'FILE_LIST_ONLY', imports: [], exports: [], sha256: hash('print(1)\n') },
    { path: 'src/main.ts', mode: 'PARSED', imports: ['./other'], exports: [{ name: 'render', line: 2 }], sha256: hash(source) },
  ] });
  expect(JSON.stringify(result.value)).not.toContain('return other()');
  expect(custody.read).toHaveLength(2); expect(custody.read.join('\n')).not.toContain('unrequested.ts');
  expect(held).toEqual([2]); expect(custody.active).toBe(0);
  expect(f.store.all('toolEffect', 'thread')).toContainEqual(expect.objectContaining({ toolId: 'repository_map', state: 'SUCCEEDED' }));
});

it('returns the same bounded host evidence through the actual native tool executor metadata', async () => {
  const f = fixture({ 'main.ts': 'export function render() {}' });
  const tools = createHostTools(await loadDomainTools(), async (_id, name, args) => f.service.tool({ name, args }, f.ctx));
  const tool = tools.find(tool => tool.name === 'repository_map')!;
  const result = await tool.execute('native-map-invocation', { resourceId: 'project', paths: ['main.ts'] }, undefined, undefined, undefined as never);
  expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({ value: { files: [{ path: 'main.ts', exports: [{ name: 'render', line: 1 }] }] } });
  expect(result.details).toMatchObject({ value: { files: [{ sha256: hash('export function render() {}') }] } });
});

it('filters private paths before reading and never expands the request into a directory crawl', async () => {
  const f = fixture({ 'src/main.ts': 'export const safe = 1;', '.env': 'NEVER_READ_SECRET', 'node_modules/hidden.ts': 'export const secret = 1;', '.git/config': 'PRIVATE_GIT', '.hermes/history.json': 'PRIVATE_HISTORY' });
  const result = await f.map(['src/main.ts', '.env', 'node_modules/hidden.ts', '.git/config', '.hermes/history.json']);
  expect((result.value as any).files.map((file: any) => file.path)).toEqual(['src/main.ts']);
  expect((result.value as any).exclusions).toHaveLength(4);
  expect(custody.read).toEqual([join(f.root, 'src/main.ts')]);
  expect(JSON.stringify(result)).not.toContain('NEVER_READ_SECRET');
});

it.skipIf(process.platform === 'win32')('rejects a public file alias to a private source before reading bytes', async () => {
  const f = fixture({ '.env': "export { token } from 'PRIVATE_MODULE_ID';\n" });
  symlinkSync('.env', join(f.root, 'public.ts'));
  const result = await f.map(['public.ts']);
  expect(result.value).toMatchObject({ files: [], readBytes: 0, exclusions: [{ path: 'public.ts', reason: 'DENIED_SOURCE' }] });
  expect(custody.read).toEqual([]); expect(JSON.stringify(result)).not.toContain('PRIVATE_MODULE_ID');
});

it('rejects a public directory alias to private native history before reading bytes', async () => {
  const f = fixture({ '.hermes/entry.ts': "export { history } from 'PRIVATE_HISTORY_ID';\n" });
  symlinkSync(join(f.root, '.hermes'), join(f.root, 'visible'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = await f.map(['visible/entry.ts']);
  expect(result.value).toMatchObject({ files: [], readBytes: 0, exclusions: [{ path: 'visible/entry.ts', reason: 'DENIED_SOURCE' }] });
  expect(custody.read).toEqual([]); expect(JSON.stringify(result)).not.toContain('PRIVATE_HISTORY_ID');
});

it('retains an ordinary in-root directory alias when its physical source is public', async () => {
  const f = fixture({ 'src/entry.ts': 'export const publicValue = 1;' });
  symlinkSync(join(f.root, 'src'), join(f.root, 'visible'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = await f.map(['visible/entry.ts']);
  expect(result.value).toMatchObject({ files: [{ path: 'visible/entry.ts', exports: [{ name: 'publicValue', line: 1 }] }], exclusions: [] });
  expect(custody.read).toEqual([join(f.root, 'src/entry.ts')]);
});

it.each([
  ['grant revocation', (f: ReturnType<typeof fixture>) => f.store.remove('resource', f.grant.id)],
  ['account drift', (f: ReturnType<typeof fixture>) => f.store.put('thread', 'thread', 'thread', { ...f.service.thread('thread'), accountId: 'changed' })],
  ['workspace drift', (f: ReturnType<typeof fixture>) => f.store.put('thread', 'thread', 'thread', { ...f.service.thread('thread'), workspaceId: 'changed' })],
  ['model drift', (f: ReturnType<typeof fixture>) => f.store.put('thread', 'thread', 'thread', { ...f.service.thread('thread'), modelId: 'test/other' })],
  ['reasoning drift', (f: ReturnType<typeof fixture>) => f.store.put('thread', 'thread', 'thread', { ...f.service.thread('thread'), thinkingLevel: 'high' })],
  ['epoch drift', (f: ReturnType<typeof fixture>) => f.store.put('thread', 'thread', 'thread', { ...f.service.thread('thread'), epoch: 2 })],
])('discards captured map bytes after %s before any result is published', async (_name, mutate) => {
  const f = fixture({ 'src/main.ts': 'export const original = 1;' });
  custody.afterRead = () => f.store.internal('fixture.change', 'thread', () => mutate(f));
  await expect(f.map(['src/main.ts'])).rejects.toBeDefined();
  expect(custody.read).toHaveLength(1);
  expect(f.store.all('data', 'thread')).toEqual([]); expect(custody.active).toBe(0);
});

it('reuses only local parsed metadata while rechecking current bytes and invalidates changed content', async () => {
  const f = fixture({ 'src/main.ts': 'export const before = 1;' });
  const first = (await f.map(['src/main.ts'])).value as any;
  const second = (await f.map(['src/main.ts'])).value as any;
  expect(first.localParseCache).toEqual({ reusedFiles: 0, parsedFiles: 1 });
  expect(second.localParseCache).toEqual({ reusedFiles: 1, parsedFiles: 0 });
  expect(second.mapDigest).toBe(first.mapDigest); expect(custody.read).toHaveLength(2);
  writeFileSync(join(f.root, 'src/main.ts'), 'export const after = 2;');
  const third = (await f.map(['src/main.ts'])).value as any;
  expect(third.localParseCache).toEqual({ reusedFiles: 0, parsedFiles: 1 });
  expect(third.files[0].exports).toEqual([{ name: 'after', line: 1 }]); expect(third.mapDigest).not.toBe(first.mapDigest);
});

it('reports actual export aliases, default exports and destructured bindings at their source lines', async () => {
  const f = fixture({ 'exports.ts': "const local = 1;\nexport { local as publicName };\nexport { remote as renamed } from './remote';\nexport default function Named() {}\nexport const { first, property: second } = { first: 1, property: 2 };\n" });
  const result = (await f.map(['exports.ts'])).value as any;
  expect(result.files[0].imports).toEqual(['./remote']);
  expect(result.files[0].exports).toEqual([
    { name: 'default', line: 4 }, { name: 'first', line: 5 }, { name: 'publicName', line: 2 }, { name: 'renamed', line: 3 }, { name: 'second', line: 5 },
  ]);
});

it('does not invent a content revision for files outside the byte budget', async () => {
  const f = fixture({ 'large.ts': 'x'.repeat(65537) });
  const result = (await f.map(['large.ts'])).value as any;
  expect(result.files[0]).toMatchObject({ path: 'large.ts', mode: 'FILE_LIST_ONLY', sha256: null, sourceRevision: null, reason: 'SOURCE_TOO_LARGE' });
  expect(result.readBytes).toBe(0); expect(custody.read).toEqual([]);
});

it('keeps combined reads and returned metadata bounded with explicit omission counts', async () => {
  const sources = Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`src/${index}.ts`, Array.from({ length: 1300 }, (_, symbol) => `export const symbol_${String(symbol).padStart(4, '0')} = ${symbol};`).join('\n') + '\n/*' + 'x'.repeat(18000) + '*/']));
  expect(Object.values(sources).every(source => Buffer.byteLength(source) <= 65536)).toBe(true);
  expect(Object.values(sources).reduce((sum, source) => sum + Buffer.byteLength(source), 0)).toBeGreaterThan(256 * 1024);
  const f = fixture(sources), result = await f.map(Object.keys(sources), { focusPaths: ['src/4.ts'], symbols: ['symbol_1299'] });
  const value = result.value as any;
  expect(value.readBytes).toBeLessThanOrEqual(256 * 1024); expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(16 * 1024);
  expect(value.files[0].path).toBe('src/4.ts');
  expect(value.files.some((file: any) => file.omittedExports > 0)).toBe(true);
  expect(value.files.some((file: any) => file.reason === 'READ_BYTE_BUDGET')).toBe(true);
});

it('refuses a fifth concurrent map while admitted readers hold their file custody', async () => {
  const f = fixture({ 'main.ts': 'export const value = 1;' });
  let release!: () => void; custody.hold = new Promise<void>(resolve => { release = resolve; });
  const reads = Array.from({ length: 4 }, () => f.map(['main.ts']));
  try { await vi.waitFor(() => expect(custody.read).toHaveLength(4)); await expect(f.map(['main.ts'])).rejects.toMatchObject({ code: 'CONTEXT_READ_LIMIT' }); }
  finally { release(); await Promise.all(reads); }
  expect(custody.active).toBe(0);
});

it('denies absent, foreign and escaping grants before reading source bytes', async () => {
  const f = fixture({ 'main.ts': 'export const value = 1;' });
  await expect(f.map(['../outside.ts'])).rejects.toMatchObject({ code: 'INVALID_TOOL_ARGUMENTS' });
  await expect(f.map(['main.ts'], { resourceId: 'missing' })).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
  f.store.internal('fixture.foreign', 'thread', () => f.store.put('resource', f.grant.id, 'foreign-thread', { ...f.grant, threadId: 'foreign-thread' }));
  await expect(f.map(['main.ts'])).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' }); expect(custody.read).toEqual([]);
});

it('does not deliver an old-owner result when grant authority is revoked during publication', async () => {
  const f = fixture({ 'main.ts': 'export const retained = 1;' });
  const unsubscribe = f.store.subscribe(event => {
    if (event.type === 'data.published') f.store.internal('fixture.revoke', 'thread', () => f.store.remove('resource', f.grant.id));
  });
  try { await expect(f.map(['main.ts'])).rejects.toMatchObject({ code: 'STALE_REQUEST_CONTEXT' }); }
  finally { unsubscribe(); }
  expect(custody.active).toBe(0);
});
