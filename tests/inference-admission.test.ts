import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Service } from '../packages/core/service';
import { Store } from '../packages/storage/store';
import { __setCapabilityFlagForTests } from '../packages/core/capability-flags';
import type { ResourceGrant, RuntimeAdapter, RuntimeCallbacks, StartRun, Thread } from '../packages/contracts';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  __setCapabilityFlagForTests('context.compilerV1', undefined);
  for (const close of cleanup.splice(0)) await close();
});
async function fixture() {
  __setCapabilityFlagForTests('context.compilerV1', true);
  const folder = mkdtempSync(join(tmpdir(), 'm04-inference-admission-')), store = new Store(join(folder, 'profile'));
  const file = join(folder, 'approved.txt'); writeFileSync(file, 'Original approved content');
  const identity = statSync(file, { bigint: true });
  const grant: ResourceGrant = { id: 'approved-file', threadId: 'thread', kind: 'file', path: file, label: 'Approved source', writable: false, createdAt: '', identity: { dev: String(identity.dev), ino: String(identity.ino) } };
  let callbacks!: RuntimeCallbacks, started!: StartRun;
  const runtime: RuntimeAdapter = { configure: value => { callbacks = value; }, models: async () => [{ id: 'test/model', provider: 'test', name: 'Fixture model', thinkingLevels: ['medium', 'high'] }],
    start: async input => { started = input; }, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
  const service = new Service(store, runtime);
  cleanup.push(async () => { await service.dispose(); store.close(); rmSync(folder, { recursive: true, force: true, maxRetries: 5 }); });
  const update = (patch: Partial<Thread>) => store.internal('fixture', 'thread', () => store.put('thread', 'thread', 'thread', {
    id: 'thread', title: 'Fixture', projectName: null, createdAt: '', updatedAt: '', status: 'ready', modelId: 'test/model', accountId: null, thinkingLevel: 'medium', sessionPath: null, runId: null, epoch: 1,
    ...store.get<Thread>('thread', 'thread'), ...patch,
  }));
  update({});
  store.internal('fixture', 'thread', () => {
    store.put('resource', grant.id, 'thread', grant);
    store.put('outbox', 'input', 'thread', { id: 'input', threadId: 'thread', content: 'Keep the approved source private', status: 'persisted', runId: null });
  });
  await (Reflect.get(service, 'deliverOutbox') as (id: string) => Promise<void>).call(service, 'thread');
  expect(started).toBeDefined();
  expect(callbacks.onBeforeInference).toEqual(expect.any(Function));
  const request = (sequence = 1) => ({ ctx: { threadId: started.threadId, runId: started.runId, epoch: started.epoch },
    modelId: started.modelId, accountId: started.accountId ?? null, thinkingLevel: started.thinkingLevel ?? null, sequence, inputIds: ['input'] });
  const admit = (value = request()) => Promise.resolve().then(() => callbacks.onBeforeInference!(value));
  return { service, store, folder, file, grant, started, callbacks, update, request, admit };
}

it('rechecks an admitted owner before each actual inference without reading task history or changing input', async () => {
  const f = await fixture(), prompt = f.started.prompt, sequence = f.store.sequence;
  const inspect = vi.spyOn(f.service.planning, 'inspect').mockImplementation(() => { throw Error('Inference authority must not refold task history'); });
  await expect(f.admit()).resolves.toBeUndefined();
  await expect(f.admit(f.request(2))).resolves.toBeUndefined();
  expect(inspect).not.toHaveBeenCalled(); expect(f.started.prompt).toBe(prompt); expect(f.store.sequence).toBe(sequence);
});

it.each(['run', 'epoch', 'model', 'account', 'thinking', 'workspace', 'project', 'mode', 'grant', 'removed-grant', 'physical-source'])('rejects a next inference after %s authority changes', async change => {
  const f = await fixture();
  const patches: Record<string, Partial<Thread>> = { run: { runId: 'other-run' }, epoch: { epoch: f.started.epoch + 1 }, model: { modelId: 'test/other' }, account: { accountId: 'other-account' }, thinking: { thinkingLevel: 'high' }, workspace: { workspaceId: 'other-workspace' }, project: { projectId: 'other-project' }, mode: { mode: 'plan' } };
  if (change === 'grant' || change === 'removed-grant') f.store.internal('fixture', 'thread', () => change === 'grant'
    ? f.store.put('resource', f.grant.id, 'thread', { ...f.grant, writable: true }) : f.store.remove('resource', f.grant.id));
  else if (change === 'physical-source') { renameSync(f.file, join(f.folder, 'old.txt')); writeFileSync(f.file, 'Replacement'); }
  else f.update(patches[change]!);
  await expect(f.admit()).rejects.toBeDefined();
});

it.each(['model', 'account', 'thinking', 'input', 'sequence'])('rejects a forged %s in the runtime admission request', async change => {
  const f = await fixture(), request = f.request();
  if (change === 'model') request.modelId = 'test/other';
  else if (change === 'account') request.accountId = 'foreign';
  else if (change === 'thinking') request.thinkingLevel = 'high';
  else if (change === 'input') request.inputIds = ['unaccepted-input'];
  else request.sequence = 0;
  await expect(f.admit(request)).rejects.toBeDefined();
});

it('rejects a repeated sequence and retires admission after settlement', async () => {
  const f = await fixture(); await f.admit();
  await expect(f.admit()).rejects.toBeDefined();
  f.callbacks.onEvent({ ...f.request().ctx, type: 'settled', aborted: true });
  await expect(f.admit(f.request(2))).rejects.toBeDefined();
});

it('allows a canonical session update and new task notes without granting changed structural authority', async () => {
  const f = await fixture();
  f.callbacks.onEvent({ ...f.request().ctx, type: 'session', sessionPath: '/canonical-native-history' });
  f.store.internal('fixture', 'thread', () => f.store.put('taskMemory', 'decision', 'thread', { id: 'decision', revision: 1, content: 'Current decision' }));
  await expect(f.admit()).resolves.toBeUndefined();
});

it('retires stopped owners across 129 public conversations and ignores old settlement after a replacement starts', async () => {
  __setCapabilityFlagForTests('context.compilerV1', true);
  const folder = mkdtempSync(join(tmpdir(), 'm04-admission-stop-')), store = new Store(join(folder, 'profile'));
  const starts = new Map<string, StartRun>(); let callbacks!: RuntimeCallbacks;
  const runtime: RuntimeAdapter = { configure: value => { callbacks = value; }, models: async () => [{ id: 'test/model', provider: 'test', name: 'Fixture model' }],
    start: async input => { starts.set(input.threadId, input); }, followUp: async () => {},
    cancel: async ctx => { callbacks.onEvent({ ...ctx, type: 'settled', aborted: true }); }, compact: async () => {}, history: async () => [], dispose: async () => {} };
  const service = new Service(store, runtime);
  cleanup.push(async () => { await service.dispose(); store.close(); rmSync(folder, { recursive: true, force: true, maxRetries: 5 }); });
  let previous!: StartRun;
  for (let index = 0; index < 129; index++) {
    const thread = (await service.command({ id: randomUUID(), type: 'thread.create', payload: {} })).result as Thread;
    await service.command({ id: randomUUID(), type: 'message.send', threadId: thread.id, payload: { content: 'Start an ordinary task', modelId: 'test/model' } });
    await vi.waitFor(() => expect(starts.has(thread.id), 'Conversation ' + (index + 1)).toBe(true), { timeout: 1500, interval: 1 });
    previous = starts.get(thread.id)!;
    await service.command({ id: randomUUID(), type: 'run.stop', threadId: thread.id, payload: {} });
  }
  await service.command({ id: randomUUID(), type: 'run.resume', threadId: previous.threadId, payload: {} });
  await vi.waitFor(() => expect(starts.get(previous.threadId)?.runId).not.toBe(previous.runId));
  const replacement = starts.get(previous.threadId)!;
  callbacks.onEvent({ threadId: previous.threadId, runId: previous.runId, epoch: previous.epoch, type: 'settled', aborted: true });
  await expect(Promise.resolve().then(() => callbacks.onBeforeInference!({ ctx: replacement, modelId: replacement.modelId, accountId: replacement.accountId ?? null,
    thinkingLevel: replacement.thinkingLevel ?? null, sequence: 1, inputIds: replacement.inputIds ?? [replacement.inputId] }))).resolves.toBeUndefined();
});
