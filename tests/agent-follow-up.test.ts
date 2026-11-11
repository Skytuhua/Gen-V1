import {afterEach, expect, it, vi} from 'vitest';
import {mkdtempSync, realpathSync, lstatSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {Service} from '../packages/core/service.ts';
import {Store} from '../packages/storage/store.ts';
import type {RuntimeAdapter, RuntimeCallbacks, StartRun, Thread, Message} from '../packages/contracts/index.ts';
import {buildServer} from '../apps/server/server.ts';
import {AgentProjection} from '../packages/agent-projection/index.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {for (const close of cleanups.splice(0).reverse()) await close();});
async function fixture(onFollow?: (input: StartRun, store: Store) => Promise<void>) {
  const base = realpathSync(tmpdir()), directory = mkdtempSync(join(base, 'agent-input-')), store = new Store(directory);
  let parent!: StartRun, child!: StartRun, childEvents!: RuntimeCallbacks;
  const follows: StartRun[] = [], starts: StartRun[] = [];
  const runtime: RuntimeAdapter = {configure() {}, models: async () => [{id: 'test/model', provider: 'test', name: 'Test'}], start: async input => {parent = input;}, followUp: async input => {parent = input;}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {}};
  const service = new Service(store, runtime, {planningRuntimeFactory: () => ({...runtime, configure(value) {childEvents = value;}, async start(input) {child = input; starts.push(input);}, async followUp(input) {follows.push(input); await onFollow?.(input, store);}})});
  const send = (type: string, payload: Record<string, unknown> = {}, threadId?: string, id: string = crypto.randomUUID()) => service.command({id, type, payload, threadId});
  const thread = (await send('thread.create')).result as Thread;
  await send('message.send', {content: 'Inspect supplied evidence', modelId: 'test/model'}, thread.id);
  const parentRun = {threadId: thread.id, runId: parent.runId, epoch: parent.epoch};
  const delegated = service.tool({name: 'task_delegate', args: {commandId: 'delegate-inputs', tasks: [{id: 'read', name: 'Reader', task: 'Read the evidence', prompt: 'Read and report.', requirements: []}]}}, parentRun);
  // Attach rejection custody before any teardown can reject the outstanding tool.
  const settled = delegated.then(() => {}, () => {});
  cleanups.push(async () => {await service.dispose(); await settled; store.close(); if (realpathSync(directory) !== resolve(directory) || !directory.startsWith(base + sep) || lstatSync(directory).isSymbolicLink()) throw Error('Unsafe fixture cleanup'); rmSync(directory, {recursive: true, force: true});});
  await vi.waitFor(() => expect(starts).toHaveLength(1));
  const job = service.planning.inspect(thread.id)!.value.agents[0];
  const payload = (content = 'Check the second case too') => ({jobId: job.id, parentRun: {runId: parentRun.runId, epoch: parentRun.epoch}, childRun: {threadId: child.threadId, runId: child.runId, epoch: child.epoch}, content});
  const event = (type: string, extra: Record<string, unknown> = {}) => childEvents.onEvent({threadId: child.threadId, runId: child.runId, epoch: child.epoch, type, ...extra});
  return {store, service, send, id: thread.id, job, child: () => child, parentRun, payload, event, starts, follows, tool: (name: string, args: Record<string, unknown>) => childEvents.onTool({name, args}, child)};
}

it('commits one queued ticket and child message before invoking the existing pinned child runtime', async () => {
  let persisted = false;
  const f = await fixture(async (input, store) => {persisted = !!store.get('agentInput', input.inputId) && store.all<Message>('message', input.threadId).some(message => message.content === 'Check the second case too');});
  const receipt = await f.send('agent.followUp', f.payload(), f.id, 'follow-a');
  expect(receipt.result).toMatchObject({ticketId: 'follow-a', status: 'queued'});
  await vi.waitFor(() => expect(f.follows).toHaveLength(1));
  expect(persisted).toBe(true);
  expect(f.follows[0]).toMatchObject({threadId: f.child().threadId, runId: f.child().runId, epoch: f.child().epoch, modelId: f.child().modelId, inputId: 'follow-a', inputIds: ['follow-a'], resources: f.child().resources});
  expect(f.follows[0].prompt).toContain('read-only');
  expect(f.store.get('agentInput', 'follow-a')).toMatchObject({status: 'queued'});
  expect(f.store.get<Thread>('thread', f.id)?.runId).toBe(f.parentRun.runId);
  expect(f.starts).toHaveLength(1);
});

it('replays the original receipt after Stop without another delivery and rejects changed content under its ID', async () => {
  const f = await fixture(), payload = f.payload();
  const first = await f.send('agent.followUp', payload, f.id, 'same-input');
  await vi.waitFor(() => expect(f.follows).toHaveLength(1));
  await f.send('run.stop', {}, f.id);
  expect(await f.send('agent.followUp', payload, f.id, 'same-input')).toEqual(first);
  await expect(f.send('agent.followUp', f.payload('Different input'), f.id, 'same-input')).rejects.toMatchObject({code: 'DUPLICATE_COMMAND'});
  expect(f.follows).toHaveLength(1);
  expect(f.store.get('agentInput', 'same-input')).toMatchObject({status: 'rejected'});
});

it('denies wrong parent/child run, job, delegated destination and extra authority before writes', async () => {
  const f = await fixture(), before = f.store.sequence, resources = f.store.all('resource');
  const base = f.payload();
  for (const [payload, code] of [
    [{...base, parentRun: {...base.parentRun, epoch: base.parentRun.epoch + 1}}, 'STALE_AGENT_RUN'],
    [{...base, childRun: {...base.childRun, runId: 'other'}}, 'STALE_AGENT_RUN'],
    [{...base, jobId: 'unknown'}, 'STALE_AGENT_RUN'],
    [{...base, resources: []}, 'INVALID_PLAN_ARGUMENTS'],
    [{...base, modelId: 'other/model'}, 'INVALID_PLAN_ARGUMENTS'],
    [{...base, authority: 'company'}, 'INVALID_PLAN_ARGUMENTS'],
  ] as const) {
    await expect(f.send('agent.followUp', payload, f.id)).rejects.toMatchObject({code});
  }
  await expect(f.send('agent.followUp', base, f.child().threadId)).rejects.toMatchObject({code: 'STALE_AGENT_RUN'});
  await expect(f.send('message.send', {content: 'Bypass'}, f.child().threadId)).rejects.toMatchObject({code: 'DELEGATE_READ_ONLY'});
  expect(f.store.sequence).toBe(before); expect(f.store.all('resource')).toEqual(resources); expect(f.follows).toEqual([]);
});

it('lets Stop win over a newly committed queued input before runtime dispatch', async () => {
  const f = await fixture();
  const admitted = f.send('agent.followUp', f.payload(), f.id, 'stop-race');
  const stopped = f.send('run.stop', {}, f.id);
  await Promise.all([admitted, stopped]);
  expect(f.follows).toHaveLength(0);
  expect(f.store.get('agentInput', 'stop-race')).toMatchObject({status: 'rejected'});
  f.event('input.processing', {inputIds: ['stop-race']});
  expect(f.store.get('agentInput', 'stop-race')).toMatchObject({status: 'rejected'});
});

it('marks processing and handled only from exact child executor input identities', async () => {
  const f = await fixture(); await f.send('agent.followUp', f.payload(), f.id, 'tracked');
  await vi.waitFor(() => expect(f.follows).toHaveLength(1));
  const seq = f.store.sequence;
  f.event('input.processing', {epoch: 99, inputIds: ['tracked']});
  f.event('input.processing', {inputIds: ['invented']});
  expect(f.store.sequence).toBe(seq);
  f.event('input.processing', {inputIds: ['tracked']});
  expect(f.store.get('agentInput', 'tracked')).toMatchObject({status: 'processing'});
  f.event('assistant.message', {content: 'Checked.', inputIds: ['tracked']});
  expect(f.store.get('agentInput', 'tracked')).toMatchObject({status: 'handled'});
});

it('retains uncertain delivery without automatically retrying or reviving a settled child', async () => {
  const f = await fixture(async () => {throw Error('Provider transport lost');});
  await f.send('agent.followUp', f.payload(), f.id, 'uncertain');
  await vi.waitFor(() => expect(f.store.get('agentInput', 'uncertain')).toMatchObject({status: 'delivery_uncertain'}));
  await f.send('agent.followUp', f.payload(), f.id, 'uncertain');
  expect(f.follows).toHaveLength(1);
  f.event('settled', {aborted: false});
  await expect(f.send('agent.followUp', f.payload(), f.id, 'after-settlement')).rejects.toMatchObject({code: 'STALE_AGENT_RUN'});
  expect(f.starts).toHaveLength(1);
});

it('does not report a completed job while an unprocessed follow-up remains queued', async () => {
  const f = await fixture();
  await f.send('agent.followUp', f.payload(), f.id, 'not-entered');
  // Simulate an earlier turn finishing without ever claiming the new input.
  f.event('settled', {aborted: false});
  expect(f.service.planning.inspect(f.id)!.value.agents[0].status).toBe('needs_review');
  expect(f.store.get('agentInput', 'not-entered')).toMatchObject({status: 'rejected'});
});

it('denies later resource rebinding and update freeze without changing the existing run grants', async () => {
  const f = await fixture();
  f.store.internal('rebind', f.id, () => {const parent = f.store.get<Thread>('thread', f.id)!; f.store.put('thread', f.id, f.id, {...parent, projectId: 'other'});});
  const seq = f.store.sequence;
  await expect(f.send('agent.followUp', f.payload(), f.id)).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
  expect(f.store.sequence).toBe(seq); expect(f.follows).toHaveLength(0);
  expect(f.service.freezeForUpdate()).toBe(false);
  await expect(f.send('agent.followUp', f.payload(), f.id)).rejects.toMatchObject({code: 'HOST_CLOSING'});
});

it('rejects a binding revoked after queuing before any inference call, with an honest rejected ticket', async () => {
  const f = await fixture();
  const admitted = f.send('agent.followUp', f.payload(), f.id, 'revoked-queued');
  f.store.internal('rebind', f.id, () => {const parent = f.store.get<Thread>('thread', f.id)!; f.store.put('thread', f.id, f.id, {...parent, projectId: 'other'});});
  await admitted;
  await vi.waitFor(() => expect(f.store.get('agentInput', 'revoked-queued')).toMatchObject({status: 'rejected'}));
  expect(f.follows).toHaveLength(0);
});

it('invalidates only the owning visible child transcript when the follow-up message commits', async () => {
  const f = await fixture(), projection = new AgentProjection(f.store);
  cleanups.push(async () => projection.dispose());
  const page = projection.inventory({}), child = page.items.find(item => item.jobId === f.job.id)!;
  await f.send('agent.followUp', f.payload(), f.id, 'visible-input');
  const changes = projection.updates({after: page.sequence, scopeKey: page.scopeKey, visibleAgentIds: [child.agentId]});
  expect(changes.transcripts).toContainEqual({agentId: child.agentId, sequence: expect.any(Number)});
  const history = projection.history({agentId: child.agentId});
  expect(history.messages.some(message => message.content === f.payload().content)).toBe(true);
});

it('exposes exact active target and ticket metadata through authenticated no-store reads without a global snapshot', async () => {
  const f = await fixture(), app = await buildServer(f.service, {port: 4317, dev: false});
  cleanups.push(async () => {await app.close();});
  const boot = (await app.inject({url: '/api/bootstrap', headers: {host: '127.0.0.1:4317'}}));
  const headers = {host: '127.0.0.1:4317', cookie: String(boot.headers['set-cookie']).split(';')[0], 'x-harness-csrf': boot.json().csrfToken};
  const snapshot = vi.spyOn(f.store, 'snapshot').mockImplementation(() => {throw Error('No snapshot');});
  const url = '/api/agents/follow-up-target?' + new URLSearchParams({parentThreadId: f.id, jobId: f.job.id});
  expect((await app.inject({url, headers: {host: headers.host}})).statusCode).toBe(401);
  expect((await app.inject({url, headers: {...headers, origin: 'https://foreign.invalid'}})).statusCode).toBe(403);
  const target = await app.inject({url, headers});
  expect(target.statusCode).toBe(200); expect(target.headers['cache-control']).toBe('no-store');
  const {content: _content, ...expectedTarget} = f.payload();
  expect(target.json()).toMatchObject({authority: 'personal', parentThreadId: f.id, ...expectedTarget});
  const payload = {id: 'http-input', type: 'agent.followUp', threadId: f.id, payload: f.payload()};
  expect((await app.inject({method: 'POST', url: '/api/commands', headers: {...headers, 'x-harness-csrf': ''}, payload})).statusCode).toBe(403);
  expect((await app.inject({method: 'POST', url: '/api/commands', headers, payload})).statusCode).toBe(200);
  const ticketUrl = '/api/agents/inputs/http-input?parentThreadId=' + f.id;
  const ticket = await app.inject({url: ticketUrl, headers});
  expect(ticket.statusCode).toBe(200); expect(ticket.json()).toMatchObject({id: 'http-input', status: 'queued'});
  expect(ticket.headers['cache-control']).toBe('no-store'); expect(ticket.body).not.toContain(f.payload().content);
  expect((await app.inject({url: '/api/agents/inputs/http-input?parentThreadId=' + f.child().threadId, headers})).statusCode).toBe(404);
  expect(snapshot).not.toHaveBeenCalled();
});

it('bounds pending follow-ups and does not deliver queued work after Stop', async () => {
  let release!: () => void;
  const pause = new Promise<void>(resolve => {release = resolve;}), f = await fixture(async () => pause);
  try {
    for (let i = 0; i < 8; i++) await f.send('agent.followUp', f.payload('Input ' + i), f.id, 'pending-' + i);
    await expect(f.send('agent.followUp', f.payload('One too many'), f.id, 'pending-8')).rejects.toMatchObject({code: 'AGENT_INPUT_LIMIT'});
    expect(f.follows).toHaveLength(1);
    await f.send('run.stop', {}, f.id);
  } finally {release();}
  await new Promise(resolve => setImmediate(resolve));
  expect(f.follows).toHaveLength(1);
  expect(f.store.all<{status: string}>('agentInput', f.id).every(ticket => ticket.status === 'rejected')).toBe(true);
});

it('recovers persisted queued and processing tickets without resending or losing their transcript', async () => {
  const f = await fixture();
  await f.send('agent.followUp', f.payload('Queued input'), f.id, 'recover-queued');
  await f.send('agent.followUp', f.payload('Entered input'), f.id, 'recover-processing');
  f.event('input.processing', {inputIds: ['recover-processing']});
  const queued = f.store.get<Record<string, unknown>>('agentInput', 'recover-queued')!, processing = f.store.get<Record<string, unknown>>('agentInput', 'recover-processing')!;
  await f.send('run.stop', {}, f.id);
  // Restore the actual pre-crash durable records, without creating a runtime owner.
  f.store.internal('crash.fixture', f.id, () => {f.store.put('agentInput', 'recover-queued', f.id, queued); f.store.put('agentInput', 'recover-processing', f.id, processing);});
  const runtime: RuntimeAdapter = {configure() {}, models: async () => [], start: async () => {throw Error('Must not restart');}, followUp: async () => {throw Error('Must not resend');}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {}};
  const recovered = new Service(f.store, runtime);
  cleanups.push(async () => recovered.dispose());
  await recovered.recover();
  expect(f.store.get('agentInput', 'recover-queued')).toMatchObject({status: 'rejected'});
  expect(f.store.get('agentInput', 'recover-processing')).toMatchObject({status: 'interrupted'});
  expect(f.store.all<Message>('message', f.child().threadId).filter(message => message.content === 'Queued input' || message.content === 'Entered input')).toHaveLength(2);
});

it('retains proven processing across a later transport error and accepts the exact response', async () => {
  const f = await fixture(async input => {f.event('input.processing', {inputIds: [input.inputId]}); throw Error('Acknowledgment transport lost');});
  await f.send('agent.followUp', f.payload(), f.id, 'entered-before-error');
  await new Promise(resolve => setImmediate(resolve));
  expect(f.store.get('agentInput', 'entered-before-error')).toMatchObject({status: 'processing'});
  f.event('assistant.message', {content: 'Exact response', inputIds: ['entered-before-error']});
  expect(f.store.get('agentInput', 'entered-before-error')).toMatchObject({status: 'handled'});
});

it('publishes handled only atomically with its durable answer, even when the observer immediately Stops', async () => {
  const f = await fixture();
  await f.send('agent.followUp', f.payload(), f.id, 'atomic-answer');
  f.event('input.processing', {inputIds: ['atomic-answer']});
  let stop: Promise<unknown> | undefined, stopping = false, observedAnswer = false;
  const unsubscribe = f.store.subscribe(() => {
    if (stopping || f.store.get<{status: string}>('agentInput', 'atomic-answer')?.status !== 'handled') return;
    stopping = true;
    observedAnswer = f.store.all<Message>('message', f.child().threadId).some(message => message.content === 'Durable answer');
    stop = f.send('run.stop', {}, f.id);
  });
  try {
    expect(() => f.event('assistant.message', {content: 'Durable answer', inputIds: ['atomic-answer']})).not.toThrow();
    await stop;
    expect(observedAnswer).toBe(true);
    expect(f.store.all<Message>('message', f.child().threadId).some(message => message.content === 'Durable answer')).toBe(true);
    expect(f.store.get('agentInput', 'atomic-answer')).toMatchObject({status: 'handled'});
  } finally {unsubscribe();}
});

it('clears an obsolete uncertainty error when exact processing and response evidence arrive', async () => {
  const f = await fixture(async () => {throw Error('Transport lost');});
  await f.send('agent.followUp', f.payload(), f.id, 'later-evidence');
  await vi.waitFor(() => expect(f.store.get('agentInput', 'later-evidence')).toMatchObject({status: 'delivery_uncertain'}));
  f.event('input.processing', {inputIds: ['later-evidence']});
  expect(f.store.get('agentInput', 'later-evidence')).not.toHaveProperty('error');
  f.event('assistant.message', {content: 'Confirmed answer', inputIds: ['later-evidence']});
  expect(f.store.get('agentInput', 'later-evidence')).toMatchObject({status: 'handled'});
  expect(f.store.get('agentInput', 'later-evidence')).not.toHaveProperty('error');
});

it('requires completion from the new entered input instead of retaining the previous turn finish', async () => {
  const f = await fixture();
  await f.send('agent.followUp', f.payload(), f.id, 'new-turn');
  await f.tool('task_finish', {outcome: 'The previous turn is finished'});
  f.event('input.processing', {inputIds: ['new-turn']});
  f.event('assistant.message', {content: 'The new request needs more work', inputIds: ['new-turn']});
  f.event('settled', {aborted: false});
  expect(f.store.get('agentInput', 'new-turn')).toMatchObject({status: 'handled'});
  expect(f.service.planning.inspect(f.id)!.value.agents[0].status).toBe('needs_review');
});

it('allows a fresh completion after exact processing and ignores duplicate entry events', async () => {
  const f = await fixture();
  await f.send('agent.followUp', f.payload(), f.id, 'finished-current-turn');
  f.event('input.processing', {inputIds: ['finished-current-turn']});
  await f.tool('task_finish', {outcome: 'The current request is finished'});
  f.event('input.processing', {inputIds: ['finished-current-turn']});
  f.event('assistant.message', {content: 'Finished current request', inputIds: ['finished-current-turn']});
  f.event('settled', {aborted: false});
  expect(f.store.get('agentInput', 'finished-current-turn')).toMatchObject({status: 'handled'});
  expect(f.service.planning.inspect(f.id)!.value.agents[0].status).toBe('completed');
});
