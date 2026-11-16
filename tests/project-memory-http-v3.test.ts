import { afterEach, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { memoryFixture } from './project-memory-fixture.ts';
import { buildServer } from '../apps/server/server.ts';
import { Service } from '../packages/core/service.ts';
import { __setCapabilityFlagForTests } from '../packages/core/capability-flags.ts';
import { memoryScope, projectMemoryViewSchema, memorySourceDetailSchema, memoryForgetPreviewSchema, memoryMutationResultSchema, memoryExportSchema } from '../packages/contracts/project-memory.ts';
import type { RuntimeAdapter } from '../packages/contracts/index.ts';

// HTTP/Store integration does not open terminals. Keep the unrelated native PTY
// dependency inert; an accidental terminal call fails this fixture explicitly.
vi.mock('node-pty', () => ({ spawn: () => { throw Error('PTY is outside the memory HTTP fixture'); } }));

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { __setCapabilityFlagForTests('memory.projectV1', undefined); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  const f = await memoryFixture();
  __setCapabilityFlagForTests('memory.projectV1', true);
  const runtime: RuntimeAdapter = { configure() {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
  const service = new Service(f.store, runtime), app = await buildServer(service, { port: 4317, dev: false });
  cleanups.push(async () => { await app.close(); await service.dispose(); f.store.close(); rmSync(f.root, { recursive: true, force: true }); });
  const host = { host: '127.0.0.1:4317' }, boot = await app.inject({url: '/api/bootstrap', headers: host});
  const headers = { ...host, cookie: String(boot.headers['set-cookie']).split(';')[0], 'x-harness-csrf': boot.json().csrfToken };
  return { ...f, app, headers, host, get: (suffix: string) => app.inject({ url: '/api/projects/project/memory' + suffix, headers }) };
}

it('serves account-scoped memory and exact sources only behind host session authentication', async () => {
  const f = await fixture(), item = f.accept();
  expect((await f.app.inject({ url: '/api/projects/project/memory?threadId=thread', headers: f.host })).statusCode).toBe(401);
  const response = await f.get('?threadId=thread'); expect(response.statusCode).toBe(200); expect(response.headers['cache-control']).toBe('no-store');
  const view = projectMemoryViewSchema.parse(response.json()); expect(view.items[0].item.id).toBe(item.id);
  const source = await f.get(`/source?threadId=thread&itemId=${item.id}&revision=${item.revision}&sourceDigest=${f.ref.digest}`);
  expect(source.statusCode).toBe(200); expect(memorySourceDetailSchema.parse(source.json()).ref).toEqual(f.ref);
  expect((await f.get(`/source?threadId=thread&itemId=${item.id}&revision=${item.revision}&sourceDigest=${'f'.repeat(64)}`)).statusCode).toBe(404);
  expect((await f.get('?threadId=thread&accountId=untrusted')).statusCode).toBe(400);
});

it('requires CSRF and exact owner/revision for review while preserving retry receipts', async () => {
  const f = await fixture(), item = f.propose(), url = '/api/projects/project/memory/actions';
  const payload = { commandId: randomUUID(), scope: memoryScope(f.access), operation: {action: 'accept', itemId: item.id, baseRevision: item.revision} };
  expect((await f.app.inject({method: 'POST', url, headers: {host: f.headers.host, cookie: f.headers.cookie}, payload})).statusCode).toBe(403);
  const first = await f.app.inject({method: 'POST', url, headers: f.headers, payload}); expect(first.statusCode).toBe(200); memoryMutationResultSchema.parse(first.json());
  expect((await f.app.inject({method: 'POST', url, headers: f.headers, payload})).json()).toEqual(first.json());
  const stale = await f.app.inject({method: 'POST', url, headers: f.headers, payload: {...payload, commandId: randomUUID()}}); expect(stale.statusCode).toBe(400);
  const other = await f.app.inject({method: 'POST', url, headers: f.headers, payload: {...payload, commandId: randomUUID(), scope: {...payload.scope, accountId: 'wrong'}}}); expect(other.statusCode).toBe(403);
  const preview = await f.get(`/forget?threadId=thread&itemId=${item.id}&revision=2`); expect(preview.statusCode).toBe(200); memoryForgetPreviewSchema.parse(preview.json());
  const exported = await f.app.inject({method: 'POST', url: '/api/projects/project/memory/export', headers: f.headers, payload: {scope: payload.scope}}); expect(exported.statusCode).toBe(200); memoryExportSchema.parse(exported.json());
});

it('retains read and correction operations after host rollback but refuses new opt-in', async () => {
  const f = await fixture(), item = f.accept(); __setCapabilityFlagForTests('memory.projectV1', false);
  const view = projectMemoryViewSchema.parse((await f.get('?threadId=thread')).json()); expect(view.available).toBe(false); expect(view.items).toHaveLength(1);
  const update = (operation: unknown) => f.app.inject({method: 'POST', url: '/api/projects/project/memory/actions', headers: f.headers, payload: {commandId: randomUUID(), scope: view.scope, operation}});
  expect((await update({action: 'edit', itemId: item.id, baseRevision: item.revision, text: 'Corrected retained memory'})).statusCode).toBe(200);
  expect((await update({action: 'configure', baseRevision: view.configRevision, enabled: true, sourceThreadIds: ['thread']})).json().error.code).toBe('MEMORY_DISABLED');
});
