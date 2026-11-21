import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Service } from '../packages/core/service.ts';
import { Store } from '../packages/storage/store.ts';
import { createJavaScriptExecutor } from '../packages/runtime/tool-program-worker.ts';
import type { RuntimeAdapter, Thread, ResourceGrant } from '../packages/contracts/index.ts';
import type { ToolProgramResult } from '../packages/core/tool-programs.ts';
import * as domain from '../packages/capabilities/index.ts';
import { buildServer } from '../apps/server/server.ts';
import { testEffectAuthenticator } from './fixtures/effect-authenticator.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function fixture(enabled = true) {
  const dir = await mkdtemp(join(tmpdir(), 'm12-service-')), store = new Store(join(dir, 'state'));
  const executor = await createJavaScriptExecutor();
  const runtime: RuntimeAdapter = { configure() {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
  const service = new Service(store, runtime, { toolEffectFlags: { 'audit.effectsV1': true, 'security.authorityV1': true },
    toolEffectAuthenticator: testEffectAuthenticator(),
    toolPrograms: { flags: { 'tools.jsReadProgramV1': enabled }, javascript: executor } });
  const thread: Thread = { id: 'thread', title: 'M12 integration', projectName: null, status: 'working', epoch: 1, runId: 'run', modelId: null, accountId: 'account', sessionPath: null, createdAt: '', updatedAt: '' };
  const filename = join(dir, 'source.json'); await writeFile(filename, '{"rows":[1,2,3]}'); const info = await stat(filename, { bigint: true });
  const grant: ResourceGrant = { id: 'r', threadId: thread.id, path: filename, label: 'Source', kind: 'file', writable: false, createdAt: '', identity: { dev: String(info.dev), ino: String(info.ino) } };
  store.internal('fixture', thread.id, () => { store.put('thread', thread.id, thread.id, thread); store.put('resource', grant.id, thread.id, grant); });
  cleanups.push(async () => { await service.dispose(); store.close(); await rm(dir, { recursive: true, force: true }); });
  return { service, store, thread, ctx: { threadId: thread.id, runId: 'run', epoch: 1 } };
}

it('keeps actual JavaScript nested host results private and returns only the explicit aggregate', async () => {
  const f = await fixture();
  vi.spyOn(domain, 'handleDomainTool').mockImplementation(async (_name, _args, context) => context.publishData({ rows: [1, 2, 3], privateMarker: 'M12_PRIVATE_BULK' }, 'fixture source'));
  await f.service.tool({ name: 'tool_program_discover', args: { names: ['repository_read'] } }, f.ctx);
  const result = await f.service.tool({ name: 'tool_program', args: {
    commandId: 'program-request', source: "const values = await Promise.all([tools.call('repository_read', {resourceId:'r'}), tools.call('repository_read', {resourceId:'r'})]); return {total: values.reduce((sum, value) => sum + value.value.rows.reduce((a,b) => a+b,0), 0)};",
    allowedTools: ['repository_read'], requestedAggregate: 'Sum the fixture rows',
  } }, f.ctx) as ToolProgramResult;
  expect(result).toMatchObject({ state: 'SUCCEEDED', aggregate: { total: 12 } });
  expect(result.sourceRefs).toHaveLength(2);
  expect(f.store.all('data')).toEqual([]);
  expect(f.store.all('dataVersion')).toEqual([]);
  expect(JSON.stringify(f.store.snapshot())).not.toContain('M12_PRIVATE_BULK');
  expect(JSON.stringify(f.store.eventsAfter(0))).not.toContain('M12_PRIVATE_BULK');
  expect(JSON.stringify(f.store.all('toolEffect'))).not.toContain('M12_PRIVATE_BULK');
  const view = f.service.toolProgramView(f.thread.id);
  expect(view.programs[0]?.calls).toHaveLength(2);
  expect(JSON.stringify(view)).not.toContain('M12_PRIVATE_BULK');
});

it('does not advertise or execute a disabled program capability', async () => {
  const f = await fixture(false);
  expect(f.service.programToolMetadata()).toEqual([]);
  await expect(f.service.tool({ name: 'tool_program', args: { commandId: 'disabled', source: 'return 1', allowedTools: [], requestedAggregate: 'one' } }, f.ctx)).rejects.toMatchObject({ code: 'PROGRAM_DISABLED' });
});

it('deduplicates a top-level program command without running its script a second time', async () => {
  const f = await fixture();
  const call = { name: 'tool_program', args: { commandId: 'once', source: 'return 42', allowedTools: [], requestedAggregate: 'answer' } };
  const first = await f.service.tool(call, f.ctx);
  const second = await f.service.tool(call, f.ctx);
  expect(second).toEqual(first);
  expect(f.store.all('toolProgram')).toHaveLength(1);
  await expect(f.service.tool({ ...call, args: { ...call.args, source: 'return 43' } }, f.ctx)).rejects.toMatchObject({ code: 'DUPLICATE_PROGRAM_REQUEST' });
});

it('cancels a prepared JavaScript card when another program already owns the execution lane', async () => {
  const f = await fixture();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(domain, 'handleDomainTool').mockImplementation(async (_name, _args, context) => {
    entered(); await held; return context.publishData({ value: 1 }, 'held fixture source');
  });
  await f.service.tool({ name: 'tool_program_discover', args: { names: ['repository_read'] } }, f.ctx);
  const first = f.service.tool({ name: 'tool_program', args: { commandId: 'owns-lane',
    source: "await tools.call('repository_read', {resourceId:'r'}); return 1;", allowedTools: ['repository_read'], requestedAggregate: 'one' } }, f.ctx);
  await started;
  try {
    await expect(f.service.tool({ name: 'tool_program', args: { commandId: 'busy-lane',
      source: 'return 2', allowedTools: [], requestedAggregate: 'two' } }, f.ctx)).rejects.toMatchObject({ code: 'PROGRAM_BUSY' });
    const cards = f.service.toolProgramView(f.thread.id).programs;
    expect(cards).toHaveLength(2);
    expect(cards.filter(card => card.program.state === 'PREPARED')).toHaveLength(0);
    expect(cards.filter(card => card.program.state === 'CANCELLED')).toHaveLength(1);
  } finally { release(); await first; }
});

it('supports authenticated retained inspection after settlement without renewing execution authority', async () => {
  const f = await fixture();
  const result = await f.service.tool({ name: 'tool_program', args: { commandId: 'retained', source: 'return {answer:42}', allowedTools: [], requestedAggregate: 'answer' } }, f.ctx) as ToolProgramResult;
  f.store.internal('fixture.settled', f.thread.id, () => f.store.put('thread', f.thread.id, f.thread.id, { ...f.thread, runId: null, status: 'ready' }));
  const page = await f.service.toolProgramResultRange(f.thread.id, result.programId, result.resultRef!, { offset: 0, limit: 1024 });
  expect(page.text).toBe('{"answer":42}');
  f.store.internal('fixture.rebound', f.thread.id, () => f.store.put('thread', f.thread.id, f.thread.id, { ...f.thread, accountId: 'another' }));
  await expect(f.service.toolProgramResultRange(f.thread.id, result.programId, result.resultRef!, { offset: 0, limit: 1024 })).rejects.toMatchObject({ code: 'PROGRAM_OWNER_REVOKED' });
});

it('serves only authenticated bounded retained result pages and metadata, with current owner checks', async () => {
  const f = await fixture();
  const result = await f.service.tool({ name: 'tool_program', args: { commandId: 'http', source: 'return {answer:42}', allowedTools: [], requestedAggregate: 'answer' } }, f.ctx) as ToolProgramResult;
  const app = await buildServer(f.service, { port: 4317, dev: false });
  try {
    const host = { host: '127.0.0.1:4317' };
    const boot = await app.inject({ url: '/api/bootstrap', headers: host });
    const headers = { ...host, cookie: String(boot.headers['set-cookie']).split(';')[0] };
    const url = `/api/threads/thread/tool-programs/${result.programId}/results/${result.resultRef}`;
    expect((await app.inject({ url, headers: host })).statusCode).toBe(401);
    const list = await app.inject({ url: '/api/threads/thread/tool-programs', headers });
    expect(list.statusCode).toBe(200);
    expect(list.json().programs[0]).not.toHaveProperty('aggregate');
    const page = await app.inject({ url: url + '?offset=0&limit=5', headers });
    expect(page.statusCode).toBe(200);
    expect(page.headers['cache-control']).toBe('no-store');
    expect(page.json()).toMatchObject({ text: '{"ans', offset: 0, nextOffset: 5 });
    for (const query of ['?limit=65537', '?offset=-1', '?offset=1.5', '?limit=2&limit=3', '?extra=secret']) {
      expect((await app.inject({ url: url + query, headers })).statusCode).toBe(400);
    }
    expect((await app.inject({ url: url.replace('/thread/', '/foreign/'), headers })).statusCode).not.toBe(200);
    f.store.internal('fixture.rebound', f.thread.id, () => f.store.put('thread', f.thread.id, f.thread.id, { ...f.thread, accountId: 'another' }));
    expect((await app.inject({ url, headers })).statusCode).not.toBe(200);
  } finally { await app.close(); }
});

it('reads the conversation\'s own uploaded attachment through an actual program text_import and keeps other grants denied', async () => {
  // Synthetic upload into the test's own temporary profile; no real file is read.
  const f = await fixture();
  const upload = (await f.service.command({ id: 'upload-1', type: 'resource.upload', threadId: f.thread.id,
    payload: { name: 'notes.txt', base64: Buffer.from('own synthetic attachment').toString('base64') } })).result as ResourceGrant;
  expect(upload).toMatchObject({ id: 'upload-1', threadId: f.thread.id, kind: 'attachment' });
  await f.service.tool({ name: 'tool_program_discover', args: { names: ['text_import'] } }, f.ctx);
  const read = async (commandId: string, resourceId: string) => await f.service.tool({ name: 'tool_program', args: {
    commandId, source: `const value = await tools.call('text_import', {resourceId: '${resourceId}'}); return {text: value.value.text};`,
    allowedTools: ['text_import'], requestedAggregate: 'Return the attachment text',
  } }, f.ctx) as ToolProgramResult;
  const own = await read('read-own', 'upload-1');
  expect(own.error).toBeNull();
  expect(own).toMatchObject({ state: 'SUCCEEDED', aggregate: { text: 'own synthetic attachment' } });
  // A grant owned by another conversation is not reachable from this program.
  f.store.internal('fixture.foreign', 'other', () => {
    f.store.put('thread', 'other', 'other', { ...f.thread, id: 'other' });
    f.store.put('resource', 'foreign', 'other', { ...upload, id: 'foreign', threadId: 'other' });
  });
  const foreign = await read('read-foreign', 'foreign');
  expect(foreign.state).toBe('FAILED');
  expect(foreign.aggregate).toBeUndefined();
});
