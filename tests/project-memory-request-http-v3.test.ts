import { afterEach, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { buildServer } from '../apps/server/server.ts';
import { Service, type ServiceOptions } from '../packages/core/service.ts';
import { __setCapabilityFlagForTests } from '../packages/core/capability-flags.ts';
import { PROJECT_MEMORY_LIMITS, memoryPreparedRequestSchema, memoryScope, type MemoryPreparedRequest } from '../packages/contracts/project-memory.ts';
import type { RuntimeAdapter, RuntimeCallbacks, StartRun, Thread } from '../packages/contracts/index.ts';
import { memoryFixture } from './project-memory-fixture.ts';

// This fixture exercises real HTTP admission, Store and request custody with a
// controlled RuntimeAdapter. It does not claim native terminal/provider evidence.
vi.mock('node-pty', () => ({ spawn: () => { throw Error('PTY is outside the memory request HTTP fixture'); } }));

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  __setCapabilityFlagForTests('memory.projectV1', undefined);
  vi.restoreAllMocks();
});

async function fixture(options: ServiceOptions = {}, excludedText = 'SQLite persistence follows the excluded project decision.') {
  const f = await memoryFixture(store => store.internal('fixture-http-memory-owner', null, () => {
    for (const id of ['thread', 'other']) store.put('thread', id, id, {
      ...store.get<Thread>('thread', id)!, accountId: null, modelId: 'test/model', thinkingLevel: 'high',
    });
  }));
  // Seed before constructing Service so all later lifecycle and route reads use
  // its single host-owned ProjectMemory instance.
  const excluded = f.accept(excludedText);
  const included = f.accept('SQLite persistence follows the included project decision.');
  __setCapabilityFlagForTests('memory.projectV1', true);
  const starts: StartRun[] = [];
  let callbacks!: RuntimeCallbacks;
  const runtime: RuntimeAdapter = {
    configure(value) { callbacks = value; },
    models: async () => [
      { id: 'test/model', provider: 'test', name: 'Fixture model', thinkingLevels: ['high', 'low'] },
      { id: 'test/other', provider: 'test', name: 'Other fixture model', thinkingLevels: ['high', 'low'] },
    ],
    start: async input => { starts.push(input); }, followUp: async input => { starts.push(input); },
    cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {},
  };
  const service = new Service(f.store, runtime, { requestContextEnabled: true, prepareWorkspace: async () => {}, ...options });
  const app = await buildServer(service, { port: 4317, dev: false });
  cleanups.push(async () => { await app.close(); await service.dispose(); f.store.close(); rmSync(f.root, { recursive: true, force: true }); });
  const host = { host: '127.0.0.1:4317' };
  const bootstrap = await app.inject({ url: '/api/bootstrap', headers: host });
  const headers = { ...host, cookie: String(bootstrap.headers['set-cookie']).split(';')[0], 'x-harness-csrf': bootstrap.json().csrfToken };
  const prefix = '/api/projects/project/memory/requests';
  const prompt = 'SQLite project persistence';
  const body = { threadId: 'thread', prompt, modelId: 'test/model', thinkingLevel: 'high' };
  const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url, headers, payload });
  const command = (type: string, payload: Record<string, unknown>, threadId = 'thread', id = randomUUID()) => post('/api/commands', { id, type, threadId, payload });
  const prepare = async (draft = prompt) => {
    const response = await post(prefix + '/prepare', { ...body, prompt: draft });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    return memoryPreparedRequestSchema.parse(response.json());
  };
  const exclusion = (prepared: MemoryPreparedRequest) => ({
    scope: prepared.scope, contextGeneration: prepared.contextGeneration, itemId: excluded.id, revision: excluded.revision,
  });
  const latest = (threadId = 'thread') => app.inject({ url: prefix + '/latest?threadId=' + threadId, headers });
  const acceptInput = (input: StartRun) => callbacks.onEvent({ ...input, type: 'input.processing', inputIds: input.inputIds });
  const forget = async () => {
    const access = await service.projectMemory.access('project', 'thread');
    return post('/api/projects/project/memory/actions', {
      commandId: randomUUID(), scope: memoryScope(access), operation: { action: 'forget', itemId: excluded.id, baseRevision: excluded.revision },
    });
  };
  return { ...f, app, service, starts, host, headers, prefix, body, prompt, excluded, included, post, command, prepare, exclusion, latest, acceptInput, forget };
}

it('requires the Personal host session and CSRF before preparing or excluding memory', async () => {
  const f = await fixture(), url = f.prefix + '/prepare';
  expect((await f.app.inject({ method: 'POST', url, headers: f.host, payload: f.body })).statusCode).toBe(401);
  expect((await f.app.inject({ method: 'POST', url, headers: { ...f.host, cookie: f.headers.cookie }, payload: f.body })).statusCode).toBe(403);
  expect((await f.app.inject({ url: f.prefix + '/latest?threadId=thread', headers: f.host })).statusCode).toBe(401);
  const prepared = await f.prepare();
  const excludeUrl = f.prefix + '/' + prepared.requestId + '/exclude';
  expect((await f.app.inject({ method: 'POST', url: excludeUrl, headers: f.host, payload: f.exclusion(prepared) })).statusCode).toBe(401);
  expect((await f.app.inject({ method: 'POST', url: excludeUrl, headers: { ...f.host, cookie: f.headers.cookie }, payload: f.exclusion(prepared) })).statusCode).toBe(403);
  expect(f.starts).toEqual([]);
});

it('rejects unknown preparation, latest and exclusion keys without accepting caller account selection', async () => {
  const f = await fixture();
  const badPrepare = await f.post(f.prefix + '/prepare', { ...f.body, accountId: 'caller-selected-account' });
  expect(badPrepare.statusCode).toBe(400); expect(badPrepare.headers['cache-control']).toBe('no-store');
  expect((await f.app.inject({ url: f.prefix + '/latest?threadId=thread&accountId=caller-selected-account', headers: f.headers })).statusCode).toBe(400);
  const prepared = await f.prepare();
  expect(prepared.scope.accountId).toBeNull();
  expect((await f.post(f.prefix + '/' + prepared.requestId + '/exclude', { ...f.exclusion(prepared), prompt: 'replacement' })).statusCode).toBe(400);
  expect(f.starts).toEqual([]); expect(f.store.all('outbox')).toEqual([]);
});

it('returns only captured requests from latest and does not start a runtime during preview', async () => {
  const f = await fixture(), initial = await f.latest();
  expect(initial.statusCode).toBe(200); expect(initial.headers['cache-control']).toBe('no-store'); expect(initial.json()).toBeNull();
  const before = f.service.thread('thread'), prepared = await f.prepare();
  expect(prepared).toMatchObject({ phase: 'PREPARING', scope: { projectId: 'project', threadId: 'thread', accountId: null } });
  expect(prepared.recall.requestId).toBe(prepared.requestId);
  expect(prepared.recall.selectedRevisions).toEqual(expect.arrayContaining([
    { itemId: f.excluded.id, revision: f.excluded.revision }, { itemId: f.included.id, revision: f.included.revision },
  ]));
  expect(f.service.thread('thread')).toEqual(before);
  expect((await f.latest()).json()).toBeNull(); expect(f.starts).toEqual([]); expect(f.store.all('outbox')).toEqual([]);
});

it('fences exclusion by exact route project, owner scope, context generation and selected revision', async () => {
  const f = await fixture(), prepared = await f.prepare(), body = f.exclusion(prepared);
  const url = f.prefix + '/' + prepared.requestId + '/exclude';
  expect((await f.post(url, { ...body, scope: { ...body.scope, accountId: 'wrong-account' } })).statusCode).toBe(403);
  expect((await f.post(url, { ...body, scope: { ...body.scope, threadId: 'other' } })).statusCode).toBe(400);
  expect((await f.post('/api/projects/other-project/memory/requests/' + prepared.requestId + '/exclude', body)).statusCode).toBe(403);
  expect((await f.post(url, { ...body, contextGeneration: body.contextGeneration + 1 })).statusCode).toBe(403);
  expect((await f.post(url, { ...body, revision: body.revision + 1 })).statusCode).toBe(403);
  const accepted = await f.post(url, body); expect(accepted.statusCode).toBe(200); expect(accepted.headers['cache-control']).toBe('no-store');
  const updated = memoryPreparedRequestSchema.parse(accepted.json());
  expect(updated).toMatchObject({ phase: 'PREPARING', scope: prepared.scope, requestId: prepared.requestId, contextGeneration: prepared.contextGeneration });
  expect(updated.items.map(item => item.id)).not.toContain(f.excluded.id);
  expect(updated.items.map(item => item.id)).toContain(f.included.id);
  expect(updated.recall.exclusions).toContainEqual(expect.objectContaining({ itemId: f.excluded.id }));
  expect(f.starts).toEqual([]);
});

it('dispatches the exact excluded token through commands, preserves retry identity and makes captured recall immutable', async () => {
  const f = await fixture(), prepared = await f.prepare();
  const url = f.prefix + '/' + prepared.requestId + '/exclude';
  const response = await f.post(url, f.exclusion(prepared)); expect(response.statusCode).toBe(200);
  const selected = memoryPreparedRequestSchema.parse(response.json());
  const commandId = randomUUID(), payload = { content: f.prompt, modelId: 'test/model', thinkingLevel: 'high', requestContextId: selected.requestId };
  const sent = await f.command('message.send', payload, 'thread', commandId); expect(sent.statusCode).toBe(200);
  expect((await f.command('message.send', payload, 'thread', commandId)).json()).toEqual(sent.json());
  await vi.waitFor(() => expect(f.starts).toHaveLength(1));
  const input = f.starts[0];
  expect(input.requestContext).toMatchObject({ requestId: selected.requestId, contextGeneration: selected.contextGeneration });
  expect(input.prompt).not.toContain(f.excluded.text); expect(input.prompt).toContain(f.included.text);
  expect((await f.latest()).json()).toBeNull();
  f.acceptInput(input);
  const latest = await f.latest(); expect(latest.statusCode).toBe(200); expect(latest.headers['cache-control']).toBe('no-store');
  const captured = memoryPreparedRequestSchema.parse(latest.json());
  expect(captured).toMatchObject({
    phase: 'CAPTURED', scope: {projectId: selected.scope.projectId, projectIdentity: selected.scope.projectIdentity, threadId: selected.scope.threadId, accountId: selected.scope.accountId}, requestId: selected.requestId, contextGeneration: selected.contextGeneration,
    recall: {...selected.recall, scores: selected.recall.scores.map(score => ({...score, matchedTerms: []}))}, items: selected.items, injectedBytes: selected.injectedBytes,
  });
  expect(captured.scope).toEqual(memoryScope(await f.service.projectMemory.access('project', 'thread')));
  expect((await f.post(url, { ...f.exclusion(prepared), itemId: f.included.id, revision: f.included.revision })).statusCode).toBe(400);
  expect((await f.command('message.send', payload)).statusCode).toBe(400);
  expect((await f.latest()).json()).toEqual(captured); expect(f.starts).toHaveLength(1);
  expect(f.store.all('outbox', 'thread')).toHaveLength(1);
});

it.each(['prompt', 'model', 'thinking', 'thread'] as const)('rejects a prepared token with a changed %s before command admission', async change => {
  const f = await fixture(), prepared = await f.prepare();
  const response = await f.command('message.send', {
    content: change === 'prompt' ? f.prompt + ' changed' : f.prompt,
    modelId: change === 'model' ? 'test/other' : 'test/model',
    thinkingLevel: change === 'thinking' ? 'low' : 'high',
    requestContextId: prepared.requestId,
  }, change === 'thread' ? 'other' : 'thread');
  expect(response.statusCode).toBe(400);
  expect(f.starts).toEqual([]); expect(f.store.all('outbox')).toEqual([]);
});

it('returns null while disabled and for an unbound first-send owner, then captures its automatically allocated request', async () => {
  const f = await fixture();
  __setCapabilityFlagForTests('memory.projectV1', false);
  const disabled = await f.post(f.prefix + '/prepare', f.body);
  expect(disabled.statusCode).toBe(200); expect(disabled.json()).toBeNull();
  __setCapabilityFlagForTests('memory.projectV1', true);
  const created = await f.command('thread.create', { projectId: 'project', title: 'Fresh memory owner' });
  expect(created.statusCode).toBe(200); const thread = created.json().result as Thread;
  expect(thread.accountId).toBeUndefined(); expect(thread.epoch).toBe(0);
  const unbound = await f.post(f.prefix + '/prepare', { ...f.body, threadId: thread.id });
  expect(unbound.statusCode).toBe(200); expect(unbound.json()).toBeNull(); expect(f.starts).toEqual([]);
  const sent = await f.command('message.send', { content: f.prompt, modelId: 'test/model', thinkingLevel: 'high' }, thread.id);
  expect(sent.statusCode).toBe(200); await vi.waitFor(() => expect(f.starts).toHaveLength(1));
  expect((await f.latest(thread.id)).json()).toBeNull();
  f.acceptInput(f.starts[0]);
  const captured = memoryPreparedRequestSchema.parse((await f.latest(thread.id)).json());
  expect(captured).toMatchObject({ phase: 'CAPTURED', scope: { threadId: thread.id, accountId: null } });
  expect(captured.requestId).toBe(f.starts[0].requestContext!.requestId);
  expect(captured.items.map(item => item.id)).toContain(f.included.id);
  expect(f.starts[0].prompt).toContain(f.included.text);
});

it('blocks native dispatch when HTTP forget revokes a selection during asynchronous finalization', async () => {
  let entered = false, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture({requestContextHooks: {async finalize() { entered = true; await gate; return {sources: []}; }}});
  try {
    const prepared = await f.prepare();
    const sent = await f.command('message.send', { content: f.prompt, modelId: 'test/model', thinkingLevel: 'high', requestContextId: prepared.requestId });
    expect(sent.statusCode).toBe(200); await vi.waitFor(() => expect(entered).toBe(true));
    expect(f.starts).toEqual([]); expect((await f.latest()).json()).toBeNull();
    expect((await f.forget()).statusCode).toBe(200);
    release(); await f.service.deliverOutbox('thread');
    expect(f.starts).toEqual([]); expect(f.service.thread('thread').status).toBe('interrupted');
    expect((await f.latest()).json()).toBeNull();
  } finally { release(); }
});

it('keeps plaintext matched terms ephemeral before and after forgotten memory reaches purge completion', async () => {
  const marker = 'forgottencobaltmarker61', f = await fixture({}, marker), prepared = await f.prepare(marker);
  expect(prepared.recall.scores.some(score => score.matchedTerms.includes(marker))).toBe(true);
  expect((await f.command('message.send', { content: marker, modelId: 'test/model', thinkingLevel: 'high', requestContextId: prepared.requestId })).statusCode).toBe(200);
  await vi.waitFor(() => expect(f.starts).toHaveLength(1)); f.acceptInput(f.starts[0]);
  expect((await f.latest()).json()).not.toBeNull();
  expect(JSON.stringify(f.store.all('projectMemoryPreparedReceipt'))).not.toContain(marker);
  expect((await f.forget()).statusCode).toBe(200); expect((await f.latest()).json()).toBeNull();
  const purgeAt = Date.now() + PROJECT_MEMORY_LIMITS.purgeRetentionMs + 1000;
  for (let batch = 0; batch < 5; batch++) f.service.projectMemory.purge(purgeAt);
  const access = await f.service.projectMemory.access('project', 'thread');
  expect(f.service.projectMemory.tombstones(access).find(row => row.itemId === f.excluded.id)?.purgeStatus).toBe('COMPLETE');
  const receipts = f.store.all('projectMemoryPreparedReceipt');
  expect(JSON.stringify(receipts)).not.toContain(marker);
  // Original foreground task history remains outside local memory deletion.
  expect(f.store.all<{content: string}>('message', 'thread').some(message => message.content === marker)).toBe(true);
});
