import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ArtifactRecord, DataRecord, HostCommand, InputRequest, Operation, RunContext, RuntimeAdapter, RuntimeCallbacks, StartRun, Thread } from '../packages/contracts/index.ts';
import { Service } from '../packages/core/service.ts';
import { Store } from '../packages/storage/store.ts';
import { createArtifactInputResolver } from '../apps/web/src/artifact-inputs.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0)) await cleanup(); });

function syntheticRuntime() {
  const runs: StartRun[] = [];
  let callbacks!: RuntimeCallbacks;
  const runtime: RuntimeAdapter = {
    configure: value => { callbacks = value; },
    models: async () => [{ id: 'test/model', provider: 'test', name: 'Synthetic model' }],
    start: async run => { runs.push(run); }, followUp: async run => { runs.push(run); },
    cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {},
  };
  return { runtime, runs, events: () => callbacks };
}

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'operation-evidence-')), stateDir = join(dir, 'state');
  let store = new Store(stateDir), adapter = syntheticRuntime(), service = new Service(store, adapter.runtime);
  cleanups.push(async () => { try { await service.dispose(); } finally { store.close(); rmSync(dir, { recursive: true, force: true }); } });
  await service.recover();
  const send = (type: string, payload: Record<string, unknown> = {}, threadId?: string, id = crypto.randomUUID()) => service.command({ id, type, payload, threadId });
  const thread = (await send('thread.create', { title: 'Evidence audit' })).result as Thread;
  await send('message.send', { content: 'Prepare synthetic evidence only', modelId: 'test/model' }, thread.id);
  await service.deliverOutbox(thread.id);
  return {
    get store() { return store; }, get service() { return service; }, get adapter() { return adapter; }, send, threadId: thread.id,
    ctx: (): RunContext => { const run = adapter.runs.findLast(run => run.threadId === thread.id)!; return { threadId: thread.id, runId: run.runId, epoch: run.epoch }; },
    prepare: (threadId = thread.id) => (service as unknown as { context(id: string): { prepareOperation(kind: string, args: Record<string, unknown>, resourceIds: string[], preconditions: Record<string, string>, description: string): Operation } }).context(threadId).prepareOperation('audit.synthetic', {}, [], {}, 'Synthetic operation; never dispatch'),
    restart: async () => { await service.dispose(); store.close(); store = new Store(stateDir); adapter = syntheticRuntime(); service = new Service(store, adapter.runtime); },
  };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
const spec = { root: 'main', elements: { main: { type: 'Text', props: { text: 'Operation evidence' } } } };
async function present(x: Fixture, op: Operation, revision: number) {
  const shown = await x.service.tool({ name: 'ui_present', args: { title: 'Operation evidence', spec, bindings: { evidence: { mode: 'live', id: op.id }, historical: { mode: 'snapshot', ref: { id: op.id, revision } } } } }, x.ctx()) as { artifactId: string };
  return x.store.get<ArtifactRecord>('artifact', shown.artifactId)!;
}
async function ask(x: Fixture) {
  return await x.service.tool({ name: 'ui_request_input', args: { title: 'Continue?', prompt: 'Continue the synthetic task?', responseSchema: { type: 'boolean' } } }, x.ctx()) as { requestId: string; revision: number };
}
function withdraw(x: Fixture, request: { requestId: string; revision: number }, id = crypto.randomUUID()): HostCommand {
  return { id, type: 'request.withdraw', threadId: x.threadId, payload: { ...request } };
}
function rawEntity(store: Store, kind: string, id: string) {
  return (store.db.prepare('SELECT body FROM entities WHERE kind=? AND id=?').get(kind, id) as { body: string } | undefined)?.body;
}
function receipts(store: Store) { return store.db.prepare('SELECT * FROM receipts ORDER BY id').all(); }
function failVersion(store: Store, id: string) {
  const put = store.put.bind(store);
  return vi.spyOn(store, 'put').mockImplementation((kind, key, threadId, value) => {
    if (kind === 'dataVersion' && key === id) throw new Error('Synthetic evidence write failure');
    put(kind, key, threadId, value);
  });
}
function seedRunning(x: Fixture) {
  const prepared = x.prepare(), operation: Operation = { ...prepared, status: 'running', revision: 7, approved: true, result: { receipt: 'retained result' } };
  const data: DataRecord = { ...x.service.data(x.threadId, operation.id), revision: 2, value: { operationId: operation.id, status: 'running', description: operation.description, result: operation.result } };
  x.store.internal('fixture.running', x.threadId, () => { x.store.put('operation', operation.id, x.threadId, operation); x.store.put('data', data.id, x.threadId, data); x.store.put('dataVersion', data.id + '@2', x.threadId, data); });
  return { operation, data };
}

it('withdrawal updates every prepared operation and both evidence consumers atomically', async () => {
  const x = await setup(), first = x.prepare(), second = x.prepare();
  const other = (await x.send('thread.create', { title: 'Other thread' })).result as Thread, foreign = x.prepare(other.id), running = seedRunning(x).operation;
  const controls = [foreign, running], controlData = controls.map(op => x.service.data(op.threadId, op.id));
  const old = [first, second].map(op => rawEntity(x.store, 'dataVersion', op.id + '@1'));
  const artifact = await present(x, first, 1), request = await ask(x);
  const committed: unknown[] = [], unsubscribe = x.store.subscribe(event => { if (event.type === 'request.withdraw') committed.push({ request: x.store.get<InputRequest>('request', request.requestId)?.status, operations: [first, second].map(op => x.store.get<Operation>('operation', op.id)?.status), inputs: createArtifactInputResolver()(artifact, x.store.snapshot()) }); });
  try { await x.service.command(withdraw(x, request)); } finally { unsubscribe(); }
  expect(x.store.get('request', request.requestId)).toMatchObject({ status: 'withdrawn', revision: 2 });
  for (const [index, op] of [first, second].entries()) {
    expect(x.store.get('operation', op.id)).toEqual({ ...op, status: 'cancelled', revision: 2 });
    const head = x.service.data(x.threadId, op.id);
    expect(head).toMatchObject({ revision: 2, value: { operationId: op.id, status: 'cancelled' } });
    expect(rawEntity(x.store, 'dataVersion', op.id + '@1')).toBe(old[index]);
    expect(x.service.data(x.threadId, op.id, 2)).toEqual(head);
  }
  for (const [index, op] of controls.entries()) { expect(x.store.get('operation', op.id)).toEqual(op); expect(x.service.data(op.threadId, op.id)).toEqual(controlData[index]); }
  expect(committed).toEqual([{ request: 'withdrawn', operations: ['cancelled', 'cancelled'], inputs: { evidence: expect.objectContaining({ status: 'cancelled' }), historical: expect.objectContaining({ status: 'prepared' }) } }]);
  expect(createArtifactInputResolver()(artifact, x.store.snapshot())).toMatchObject({ evidence: { status: 'cancelled' }, historical: { status: 'prepared' } });
  expect(await x.service.tool({ name: 'ui_inspect', args: { dataId: first.id } }, x.ctx())).toMatchObject({ revision: 2, value: { status: 'cancelled' } });
  expect(await x.service.tool({ name: 'ui_inspect', args: { dataId: first.id, revision: 1 } }, x.ctx())).toMatchObject({ revision: 1, value: { status: 'prepared' } });
});

it('withdrawal duplicate receipt does not advance evidence', async () => {
  const x = await setup(), op = x.prepare(), request = await ask(x), command = withdraw(x, request);
  const first = await x.service.command(command), head = x.service.data(x.threadId, op.id), versions = x.store.all('dataVersion'), seq = x.store.sequence, beforeReceipts = receipts(x.store);
  expect(head).toMatchObject({ revision: 2, value: { status: 'cancelled' } });
  expect(await x.service.command(command)).toEqual(first);
  expect(x.store.receipt(command)).toEqual(first);
  expect(x.service.data(x.threadId, op.id)).toEqual(head); expect(x.store.all('dataVersion')).toEqual(versions); expect(x.store.sequence).toBe(seq);
  await expect(x.service.command(withdraw(x, request))).rejects.toMatchObject({ code: 'STALE_REQUEST' });
  expect(x.service.data(x.threadId, op.id)).toEqual(head); expect(x.store.all('dataVersion')).toEqual(versions); expect(x.store.sequence).toBe(seq); expect(receipts(x.store)).toEqual(beforeReceipts);
});

it('withdrawal evidence failure rolls back ledger request and receipt', async () => {
  const x = await setup(), op = x.prepare(), request = await ask(x), command = withdraw(x, request), head = x.service.data(x.threadId, op.id), before = x.store.snapshot(), beforeReceipts = receipts(x.store);
  const spy = failVersion(x.store, op.id + '@2');
  try { await expect(x.service.command(command)).rejects.toThrow('Synthetic evidence write failure'); } finally { spy.mockRestore(); }
  expect(x.store.get('operation', op.id)).toEqual(op); expect(x.service.data(x.threadId, op.id)).toEqual(head);
  expect(x.store.get('request', request.requestId)).toMatchObject({ status: 'pending', revision: 1 });
  expect(x.store.get('dataVersion', op.id + '@2')).toBeNull(); expect(x.store.receipt(command)).toBeNull(); expect(receipts(x.store)).toEqual(beforeReceipts);
  expect(x.store.snapshot()).toEqual(before); expect(x.store.eventsAfter(before.seq)).toEqual([]);
  await x.service.command(command);
  expect(x.store.get('operation', op.id)).toMatchObject({ status: 'cancelled', revision: 2 });
  expect(x.service.data(x.threadId, op.id)).toMatchObject({ revision: 2, value: { status: 'cancelled' } }); expect(x.store.receipt(command)).not.toBeNull();
});

it('restart recovery projects unknown once and retains running revision', async () => {
  const x = await setup(), { operation, data } = seedRunning(x), artifact = await present(x, operation, 2);
  const historical = rawEntity(x.store, 'dataVersion', operation.id + '@2'), beforeReceipts = receipts(x.store);
  await x.restart(); await x.service.recover();
  const unknown = { ...operation, status: 'unknown', error: 'Execution was interrupted before its outcome was recorded' };
  expect(x.store.get('operation', operation.id)).toEqual(unknown);
  const head = x.service.data(x.threadId, operation.id);
  expect(head).toMatchObject({ revision: 3, value: { operationId: operation.id, status: 'unknown', result: { receipt: 'retained result' } } });
  expect(x.service.data(x.threadId, operation.id, 3)).toEqual(head);
  expect(rawEntity(x.store, 'dataVersion', operation.id + '@2')).toBe(historical); expect(x.service.data(x.threadId, operation.id, 2)).toEqual(data);
  expect(createArtifactInputResolver()(artifact, x.store.snapshot())).toMatchObject({ evidence: { status: 'unknown' }, historical: { status: 'running' } });
  const versions = x.store.all('dataVersion');
  await x.service.recover();
  expect(x.store.get('operation', operation.id)).toEqual(unknown); expect(x.service.data(x.threadId, operation.id)).toEqual(head); expect(x.store.all('dataVersion')).toEqual(versions);
  expect(receipts(x.store)).toEqual(beforeReceipts); expect(x.adapter.runs).toEqual([]);
});

it('recovery evidence failure leaves interrupted execution durable', async () => {
  const x = await setup(), { operation, data } = seedRunning(x), historical = rawEntity(x.store, 'dataVersion', operation.id + '@2');
  await x.restart();
  const beforeReceipts = receipts(x.store), seq = x.store.sequence, thread = x.store.get('thread', x.threadId), spy = failVersion(x.store, operation.id + '@3');
  try { await expect(x.service.recover()).rejects.toThrow('Synthetic evidence write failure'); } finally { spy.mockRestore(); }
  expect(x.store.get('operation', operation.id)).toEqual(operation); expect(x.service.data(x.threadId, operation.id)).toEqual(data);
  expect(rawEntity(x.store, 'dataVersion', operation.id + '@2')).toBe(historical); expect(x.store.get('dataVersion', operation.id + '@3')).toBeNull();
  expect(x.store.get('thread', x.threadId)).toEqual(thread); expect(x.store.eventsAfter(seq).filter(event => event.type === 'workspace.recovered')).toEqual([]); expect(receipts(x.store)).toEqual(beforeReceipts);
  await x.service.recover();
  expect(x.store.get('operation', operation.id)).toEqual({ ...operation, status: 'unknown', error: 'Execution was interrupted before its outcome was recorded' });
  expect(x.service.data(x.threadId, operation.id)).toMatchObject({ revision: 3, value: { status: 'unknown' } }); expect(x.adapter.runs).toEqual([]);
});
