import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/storage/store.ts';
import { HarnessError, type RunContext, type RuntimeAdapter, type RuntimeCallbacks, type StartRun, type Thread } from '../packages/contracts/index.ts';
import { PlanningCoordinator, type PlanningHooks } from '../packages/core/planning.ts';
import { agentProgress, PlanUpdateSchema } from '../packages/contracts/planning.ts';
import { PLANNING_TOOLS } from '../packages/core/planning-tools.ts';
import type { DomainContext } from '../packages/capabilities/index.ts';
import {createRuntime} from '../packages/runtime/index.ts';
import {accountResolver,beginAccountLogin} from '../packages/core/accounts.ts';
import {applySkillOperations} from '../packages/core/skills.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const clean of cleanups.splice(0)) await clean(); });

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'harness-plan-'));
  const store = new Store(directory), controller = new AbortController();
  const ctx: RunContext = { threadId: 'parent', runId: 'run', epoch: 1 };
  store.internal('seed', ctx.threadId, () => store.put('thread', ctx.threadId, ctx.threadId, {
    id: ctx.threadId, title: 'Inspect failures', projectName: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    status: 'working', epoch: 1, runId: ctx.runId, modelId: 'subscription/model', sessionPath: null,
  } satisfies Thread));
  store.internal('seed', ctx.threadId, () => store.put('resource', 'source', ctx.threadId, { id: 'source', threadId: ctx.threadId, kind: 'project', path: directory, label: 'Source', writable: true, createdAt: new Date().toISOString() }));
  let valid = true;
  const children: { runtime: RuntimeAdapter; callbacks: RuntimeCallbacks; input?: StartRun; cancel: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[] = [];
  const domain: DomainContext = { threadId: ctx.threadId, signal: controller.signal,
    resolveResource: vi.fn(async () => directory), publishData: vi.fn(() => ({ id: 'read', threadId: ctx.threadId, revision: 1, value: {}, provenance: 'test', createdAt: '' })),
    prepareOperation: vi.fn(() => { throw new Error('Mutation must not run'); }), progress: vi.fn(),
  };
  const hooks: PlanningHooks = { store,
    assertRun: value => { if (!valid || value.threadId !== ctx.threadId || value.runId !== ctx.runId || value.epoch !== ctx.epoch) throw new HarnessError('CANCELLED_RUN', 'Stale authority'); },
    domainContext: () => domain,
    runtimeFactory: () => {
      const child = { callbacks: undefined as unknown as RuntimeCallbacks, input: undefined as StartRun | undefined, cancel: vi.fn(async () => {}), dispose: vi.fn(async () => {}), runtime: undefined as unknown as RuntimeAdapter };
      child.runtime = { configure: c => { child.callbacks = c; }, models: async () => [], start: async input => { child.input = input; }, followUp: async () => {}, cancel: child.cancel, compact: async () => {}, history: async () => [], dispose: child.dispose };
      children.push(child); return child.runtime;
    },
  };
  const coordinator = new PlanningCoordinator(hooks);
  cleanups.push(async () => { await coordinator.dispose(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const tasks = (count = 1) => Array.from({ length: count }, (_, i) => ({ id: `task-${i}`, name: `Reader ${i}`, task: 'Inspect a failure', prompt: 'Read the supplied source and report evidence.', requirements: [{ id: 'read', label: 'Read the failing case' }] }));
  const waitStarted = async (count = 1) => { await vi.waitFor(() => expect(children.filter(c => c.input)).toHaveLength(count)); };
  const event = (i: number, type: string, extra = {}) => children[i].callbacks.onEvent({ ...children[i].input!, type, ...extra });
  const tool = (i: number, name: string, args = {}) => children[i].callbacks.onTool({ name, args }, children[i].input!);
  return { store, coordinator, ctx, controller, children, domain, hooks, directory, tasks, waitStarted, event, tool, revoke: () => { valid = false; } };
}

it('lets auxiliary readers load shared skills while denying library mutations',async()=>{
 const x=setup();x.store.internal('fixture.skill',null,()=>applySkillOperations(x.store,[{action:'create',name:'inspect-failure',description:'Inspect a failing check using actual evidence.',content:'Read the failing assertion before changing its source.',baseRevision:0}],{kind:'user'}));
 const pending=x.coordinator.delegate(x.ctx,{commandId:'read-skills',tasks:x.tasks()},x.controller.signal);await x.waitStarted();
 try{expect(await x.tool(0,'skills_list')).toMatchObject({skills:[expect.objectContaining({name:'inspect-failure'})]});expect(await x.tool(0,'skill_view',{name:'inspect-failure'})).toMatchObject({content:'Read the failing assertion before changing its source.'});await expect(x.tool(0,'skill_manage',{operations:[]})).rejects.toMatchObject({code:'AGENT_TOOL_DENIED'});}finally{x.event(0,'settled');await pending;}
});

it('persists real delegate threads and deduplicated transcripts without settling the parent',async()=>{
 const x=setup(),tasks=x.tasks(),pending=x.coordinator.delegate(x.ctx,{commandId:'transcript',tasks},x.controller.signal);await x.waitStarted();
 try{
  const job=x.coordinator.inspect(x.ctx.threadId)!.value.agents[0];expect(job.childThreadId).toBe(x.children[0].input!.threadId);
  expect(x.store.get<Thread>('thread',job.childThreadId!)).toMatchObject({kind:'delegate',parentThreadId:x.ctx.threadId,jobId:job.id,status:'working'});
  expect(x.store.all('message',job.childThreadId!)).toContainEqual(expect.objectContaining({role:'user',content:expect.stringContaining(tasks[0].prompt)}));
  x.event(0,'assistant.delta',{messageId:'child-answer',delta:'Found '});x.event(0,'assistant.delta',{messageId:'child-answer',delta:'evidence.'});
  x.event(0,'assistant.message',{messageId:'child-final',content:'Found evidence.'});x.event(0,'assistant.message',{messageId:'child-final',content:'Found evidence.'});
  x.event(0,'activity',{message:'Reading source'});x.event(0,'session',{sessionPath:'owned-child-session'});x.event(0,'usage',{usage:{inputTokens:19,outputTokens:3}});
  expect(x.store.all<{role:string;content:string}>('message',job.childThreadId!).filter(m=>m.role==='assistant')).toEqual([expect.objectContaining({content:'Found evidence.'})]);
  expect(x.store.get<Thread>('thread',job.childThreadId!)?.sessionPath).toBe('owned-child-session');expect(x.store.get('usage',job.childThreadId!)).toMatchObject({value:{inputTokens:19}});
  x.event(0,'settled');await pending;const before=x.store.sequence;x.event(0,'assistant.message',{content:'late'});expect(x.store.sequence).toBe(before);
  expect(x.store.get<Thread>('thread',x.ctx.threadId)?.status).toBe('working');expect(x.store.get<Thread>('thread',job.childThreadId!)?.runId).toBeNull();
 }finally{x.controller.abort();await pending;}
});

it('pins auxiliary readers to the parent account before asynchronous runtime creation',async()=>{
 const x=setup(),accountId=crypto.randomUUID(),parent=x.store.get<Thread>('thread',x.ctx.threadId)!;
 x.store.internal('fixture.account',parent.id,()=>{x.store.put('account',accountId,null,{id:accountId,providerId:'openai',label:'Parent',enabled:true,createdAt:'now',updatedAt:'now'});x.store.put('thread',parent.id,parent.id,{...parent,accountId,modelId:'openai/model'});});
 const pending=x.coordinator.delegate(x.ctx,{commandId:'bound-account',tasks:x.tasks()},x.controller.signal);await x.waitStarted();
 try{expect(x.children[0].input).toMatchObject({accountId,modelId:'openai/model'});}finally{x.event(0,'settled');await pending;}
});

it('retains auxiliary account use after parent revocation until native cancellation completes',async()=>{
 const x=setup(),parent=x.store.get<Thread>('thread',x.ctx.threadId)!,factory=x.hooks.runtimeFactory!;let release!:()=>void;const gate=new Promise<void>(done=>{release=done;});
 x.store.internal('fixture.provider',parent.id,()=>x.store.put('thread',parent.id,parent.id,{...parent,modelId:'openai/model'}));
 x.hooks.runtimeFactory=()=>{const native=factory() as RuntimeAdapter;native.cancel=vi.fn(()=>gate);return createRuntime({dataDir:x.store.dataDir,accounts:accountResolver(x.store)},{pi:()=>native,official:()=>({...native,configure:()=>{}})});};
 const pending=x.coordinator.delegate(x.ctx,{commandId:'auxiliary-use',tasks:x.tasks()},x.controller.signal);await x.waitStarted();
 x.store.internal('fixture.revoke',parent.id,()=>x.store.put('thread',parent.id,parent.id,{...parent,modelId:'openai/model',runId:null,status:'stopped'}));const cancelling=x.coordinator.cancel(x.ctx);
 try{expect(()=>beginAccountLogin(x.store,'openai',null)).toThrow(expect.objectContaining({code:'ACCOUNT_BUSY'}));}finally{release();await cancelling;await pending;}
 expect(x.store.all('accountUse')).toHaveLength(0);
});

describe('durable plan and real auxiliary jobs', () => {
  it('advertises only strict bounded JSON schemas and rejects forged or oversized plan state', () => {
    expect(PLANNING_TOOLS.map(tool => tool.name)).toEqual(['plan_update', 'task_delegate', 'agent_progress']);
    for (const tool of PLANNING_TOOLS) {
      expect(tool.parameters).toMatchObject({ type: 'object', additionalProperties: false });
      expect(JSON.parse(JSON.stringify(tool.parameters))).toEqual(tool.parameters);
    }
    const x = setup();
    expect(() => x.coordinator.updatePlan(x.ctx, { title: 'Bad', steps: [{ id: 'one', title: 'One', status: 'working', requirements: [], agentIds: ['invented'] }] })).toThrowError(HarnessError);
    expect(() => x.coordinator.updatePlan(x.ctx, { title: 'Too many', steps: Array.from({ length: 25 }, (_, i) => ({ id: `step-${i}`, title: 'Step', status: 'pending', requirements: [] })) })).toThrowError(HarnessError);
    expect(x.store.snapshot().data).toHaveLength(0);
  });
  it('publishes one same-thread versioned data identity, preserving host-owned agents', async () => {
    const x = setup();
    const first = x.coordinator.updatePlan(x.ctx, { title: 'Repair tests', steps: [{ id: 'diagnose', title: 'Diagnose', status: 'working', requirements: [{ id: 'read', label: 'Read failure', completed: false }] }] });
    const second = x.coordinator.updatePlan(x.ctx, { title: 'Repair tests', steps: [{ id: 'diagnose', title: 'Diagnose', status: 'completed', requirements: [{ id: 'read', label: 'Read failure', completed: true }] }] });
    expect(second.id).toBe(first.id); expect(second.revision).toBe(2); expect(second.provenance).toBe('harness:plan');
    expect(x.store.get('dataVersion', first.id + '@1')).toEqual(first);
    expect(x.store.snapshot().data).toHaveLength(1);
    expect(PlanUpdateSchema.safeParse({ title: 'Forged', steps: [], agents: [{ status: 'completed' }] }).success).toBe(false);
  });

  it('runs three isolated jobs concurrently and awaits local completion plus settlement', async () => {
    const x = setup(); const promise = x.coordinator.delegate(x.ctx, { commandId: 'three', tasks: x.tasks(3) }, x.controller.signal);
    let returned = false; void promise.then(() => { returned = true; }); await x.waitStarted(3);
    expect(new Set(x.children.map(c => c.input!.threadId)).size).toBe(3);
    expect(x.children.every(c => c.input!.threadId !== x.ctx.threadId && c.input!.modelId === 'subscription/model')).toBe(true);
    expect(x.children[0].input!.resources[0]).toMatchObject({ id: 'source', writable: false });
    expect(returned).toBe(false);
    await x.tool(0, 'agent_progress', { completedRequirementIds: ['read'] });
    await x.tool(0, 'task_finish', { outcome: 'Verified', summary: 'Source checked' });
    expect(returned).toBe(false);
    x.event(0, 'settled'); x.event(1, 'settled');
    await x.tool(2, 'agent_progress', { reportedPercent: 35 }); x.event(2, 'settled');
    const result = await promise;
    expect(result.jobs.map(j => j.status)).toEqual(['completed', 'needs_review', 'needs_review']);
    expect(result.jobs.map(agentProgress)).toEqual([100, 0, 0]);
    expect(x.children.every(c => c.dispose.mock.calls.length === 1)).toBe(true);
  });

  it('accepts progress only from actual reports and rejects unknown completed criteria', async () => {
    const x = setup(); const promise = x.coordinator.delegate(x.ctx, { commandId: 'progress', tasks: [{ ...x.tasks()[0], requirements: [] }] }, x.controller.signal); await x.waitStarted();
    expect(agentProgress(x.coordinator.inspect(x.ctx.threadId)!.value.agents[0])).toBe(null);
    await x.tool(0, 'agent_progress', { reportedPercent: 43 });
    expect(agentProgress(x.coordinator.inspect(x.ctx.threadId)!.value.agents[0])).toBe(43);
    await expect(x.tool(0, 'agent_progress', { completedRequirementIds: ['invented'] })).rejects.toMatchObject({ code: 'INVALID_AGENT_PROGRESS' });
    x.event(0, 'settled'); await promise;
  });

  it('rejects all UI, operation, nested delegation and write paths under parent authority', async () => {
    const x = setup(); const promise = x.coordinator.delegate(x.ctx, { commandId: 'reader', tasks: x.tasks() }, x.controller.signal); await x.waitStarted();
    for (const name of ['ui_present', 'ui_request_input', 'operation_execute', 'repository_test_prepare', 'task_delegate', 'plan_update']) {
      await expect(x.tool(0, name)).rejects.toMatchObject({ code: 'AGENT_TOOL_DENIED' });
    }
    await expect(x.children[0].callbacks.onTool({ name: 'task_finish', args: { outcome: 'Forged' } }, { ...x.children[0].input!, epoch: 9 })).rejects.toMatchObject({ code: 'CANCELLED_RUN' });
    x.revoke(); await expect(x.tool(0, 'text_import', { resourceId: 'source' })).rejects.toMatchObject({ code: 'CANCELLED_RUN' });
    x.event(0, 'settled'); await promise;
    expect(x.domain.resolveResource).not.toHaveBeenCalled();
  });

  it('coalesces identical pending retries, returns terminal results, and rejects changed command content', async () => {
    const x = setup(), args = { commandId: 'retry', tasks: x.tasks() };
    const a = x.coordinator.delegate(x.ctx, args, x.controller.signal), b = x.coordinator.delegate(x.ctx, args, x.controller.signal);
    await x.waitStarted(); expect(x.children).toHaveLength(1);
    await expect(x.coordinator.delegate(x.ctx, { ...args, tasks: [{ ...args.tasks[0], name: 'Changed' }] }, x.controller.signal)).rejects.toMatchObject({ code: 'DUPLICATE_COMMAND' });
    x.event(0, 'settled'); expect(await a).toEqual(await b);
    expect(await x.coordinator.delegate(x.ctx, args, x.controller.signal)).toEqual(await a); expect(x.children).toHaveLength(1);
  });

  it('revokes Stop authority, terminates all workers, and ignores late success or forged events', async () => {
    const x = setup(); const promise = x.coordinator.delegate(x.ctx, { commandId: 'stop', tasks: x.tasks(3) }, x.controller.signal); await x.waitStarted(3);
    x.revoke(); x.controller.abort(); await x.coordinator.cancel(x.ctx);
    const result = await promise;
    expect(result.jobs.every(j => j.status === 'cancelled')).toBe(true);
    expect(x.children.every(c => c.cancel.mock.calls.length === 1)).toBe(true);
    const revision = x.coordinator.inspect(x.ctx.threadId)!.revision;
    x.event(0, 'settled'); x.event(0, 'assistant.message', { content: 'Late successful result' });
    x.children[1].callbacks.onEvent({ ...x.children[1].input!, epoch: 999, type: 'usage', usage: { inputTokens: 10 } });
    expect(x.coordinator.inspect(x.ctx.threadId)!.revision).toBe(revision);
    await expect(x.tool(0, 'task_finish', { outcome: 'Late' })).rejects.toMatchObject({ code: 'CANCELLED_RUN' });
  });

  it('streams bounded usage and does not complete the parent task', async () => {
    const x = setup(); const promise = x.coordinator.delegate(x.ctx, { commandId: 'usage', tasks: x.tasks() }, x.controller.signal); await x.waitStarted();
    x.event(0, 'usage', { usage: { inputTokens: 12, outputTokens: 3, cost: null, sessionPercent: null } });
    expect(x.coordinator.inspect(x.ctx.threadId)!.value.agents[0].usage).toMatchObject({ inputTokens: 12, outputTokens: 3, cost: null });
    x.event(0, 'settled'); await promise;
    expect(x.store.get<Thread>('thread', x.ctx.threadId)!.status).toBe('working');
    expect(x.store.get('finish', x.ctx.runId)).toBe(null);
  });

  it('reserves startup slots and cancels a queued factory before any child starts', async () => {
    const x = setup(); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const create = vi.fn(x.hooks.runtimeFactory!); x.hooks.runtimeFactory = async () => { await gate; return create(); };
    const pending = x.coordinator.delegate(x.ctx, { commandId: 'startup', tasks: x.tasks(3) }, x.controller.signal);
    let extraError: unknown;
    const extra = x.coordinator.delegate(x.ctx, { commandId: 'extra', tasks: x.tasks() }, x.controller.signal).catch(error => { extraError = error; });
    x.revoke(); await x.coordinator.cancel(x.ctx);
    const result = await Promise.race([pending, new Promise<null>(resolve => setTimeout(() => resolve(null), 300))]);
    release(); await extra;
    await pending;
    expect(result, 'Cancellation must release pending startup').not.toBe(null);
    expect(result!.jobs.every(job => job.status === 'cancelled')).toBe(true);
    expect(extraError).toMatchObject({ code: 'AGENT_LIMIT' });
    expect(create).not.toHaveBeenCalled();expect(x.children).toHaveLength(0);
  });

  it('shares pending factory teardown between abort, cancel and dispose and never starts its late adapter',async()=>{
    const x=setup();let releaseFactory!:()=>void,releaseDispose!:()=>void;const factoryGate=new Promise<void>(done=>{releaseFactory=done;}),disposeGate=new Promise<void>(done=>{releaseDispose=done;}),create=x.hooks.runtimeFactory!;
    const factory=vi.fn(async()=>{await factoryGate;const adapter=await create();adapter.dispose=vi.fn(async()=>{await disposeGate;});return adapter;});x.hooks.runtimeFactory=factory;
    const delegated=x.coordinator.delegate(x.ctx,{commandId:'factory-already-entered',tasks:x.tasks()},x.controller.signal);await vi.waitFor(()=>expect(factory).toHaveBeenCalledOnce());
    x.revoke();x.controller.abort();let cancelled=false,disposed=false;const cancelling=x.coordinator.cancel(x.ctx).then(()=>{cancelled=true;}),disposing=x.coordinator.dispose().then(()=>{disposed=true;});
    try{
      await Promise.resolve();expect(cancelled).toBe(false);expect(disposed).toBe(false);expect(x.coordinator.hasActiveChildren(x.ctx.threadId)).toBe(true);
      releaseFactory();await vi.waitFor(()=>expect(x.children).toHaveLength(1));await vi.waitFor(()=>expect(x.children[0].runtime.dispose).toHaveBeenCalledOnce());
      expect(x.children[0].input).toBeUndefined();expect(x.children[0].cancel).toHaveBeenCalledOnce();expect(cancelled).toBe(false);expect(disposed).toBe(false);
      releaseDispose();await Promise.all([cancelling,disposing,delegated]);expect(x.coordinator.hasActiveChildren(x.ctx.threadId)).toBe(false);
    }finally{releaseFactory();releaseDispose();await Promise.allSettled([cancelling,disposing,delegated]);}
  });

  it('retains the final usage measurement even when intermediate events are coalesced', async () => {
    const x = setup(); const pending = x.coordinator.delegate(x.ctx, { commandId: 'final-usage', tasks: x.tasks() }, x.controller.signal); await x.waitStarted();
    x.event(0, 'usage', { usage: { inputTokens: 10, outputTokens: 2 } });
    x.event(0, 'usage', { usage: { inputTokens: 20, outputTokens: 8 } }); x.event(0, 'settled');
    expect((await pending).jobs[0].usage).toMatchObject({ inputTokens: 20, outputTokens: 8 });
  });

  it('cancels and disposes the exact child context after runtime failure', async () => {
    const x = setup(); const pending = x.coordinator.delegate(x.ctx, { commandId: 'failure', tasks: x.tasks() }, x.controller.signal); await x.waitStarted();
    x.event(0, 'error', { message: 'Subscription request failed' });
    expect((await pending).jobs[0]).toMatchObject({ status: 'failed', error: 'Subscription request failed' });
    expect(x.children[0].cancel).toHaveBeenCalledWith(expect.objectContaining({ threadId: x.children[0].input!.threadId, runId: x.children[0].input!.runId, epoch: 1 }));
    expect(x.children[0].dispose).toHaveBeenCalledOnce();
  });

  it('bounds Unicode completion summaries in bytes and rejects oversized progress reports', async () => {
    const x = setup(); const pending = x.coordinator.delegate(x.ctx, { commandId: 'unicode', tasks: [{ ...x.tasks()[0], requirements: [] }] }, x.controller.signal); await x.waitStarted();
    await expect(x.tool(0, 'agent_progress', { summary: '🙂'.repeat(512) })).rejects.toMatchObject({ code: 'INVALID_PLAN_ARGUMENTS' });
    await x.tool(0, 'task_finish', { outcome: '🙂'.repeat(512) }); x.event(0, 'settled');
    expect(Buffer.byteLength((await pending).jobs[0].summary!)).toBeLessThanOrEqual(1024);
  });

  it('requires a fresh local completion claim after later progress or reading', async () => {
    const x = setup(); const pending = x.coordinator.delegate(x.ctx, { commandId: 'claim', tasks: x.tasks() }, x.controller.signal); await x.waitStarted();
    await x.tool(0, 'task_finish', { outcome: 'Done' });
    await x.tool(0, 'agent_progress', { completedRequirementIds: ['read'] }); x.event(0, 'settled');
    expect((await pending).jobs[0].status).toBe('needs_review');
  });

  it('maps actual source reads to the captured parent context and prevents publication after Stop', async () => {
    const x = setup(), filename = join(x.directory, 'supplied.txt'); writeFileSync(filename, 'A supplied fact.');
    const contexts: RunContext[] = [];
    x.hooks.domainContext = (ctx, signal) => { contexts.push(ctx); expect(signal).toBe(x.controller.signal); return x.domain; };
    x.domain.withResource = async (_id, _path, write, action) => { expect(write).toBe(false); return action(filename); };
    const pending = x.coordinator.delegate(x.ctx, { commandId: 'read-fact', tasks: x.tasks() }, x.controller.signal); await x.waitStarted();
    await x.tool(0, 'text_import', { resourceId: 'source' });
    expect(contexts).toEqual([x.ctx]);
    expect(x.domain.publishData).toHaveBeenCalledWith(expect.objectContaining({ text: 'A supplied fact.', resourceId: 'source' }), expect.stringContaining('sha256:'));
    expect(x.coordinator.inspect(x.ctx.threadId)!.value.agents[0].evidence).toEqual([{ id: 'read', revision: 1 }]);
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    x.domain.withResource = async (_id, _path, _write, action) => { await gate; return action(filename); };
    const stale = x.tool(0, 'text_import', { resourceId: 'source' });
    x.revoke(); x.controller.abort(); await x.coordinator.cancel(x.ctx); release();
    await expect(stale).rejects.toMatchObject({ code: 'CANCELLED_RUN' }); await pending;
    expect(x.domain.publishData).toHaveBeenCalledTimes(1);
  });

  it('marks crash-left work interrupted and refuses automatic billing replay on the old command ID', async () => {
    const x = setup(), args = { commandId: 'crashed', tasks: x.tasks() };
    const promise = x.coordinator.delegate(x.ctx, args, x.controller.signal); await x.waitStarted();
    const recovered = new PlanningCoordinator({ store: x.store, assertRun: () => {}, domainContext: () => x.domain, runtimeFactory: () => { throw new Error('Must not restart'); } });
    recovered.recover();
    expect(recovered.inspect(x.ctx.threadId)!.value.agents[0].status).toBe('interrupted');
    await expect(recovered.delegate(x.ctx, args, x.controller.signal)).rejects.toMatchObject({ code: 'DELEGATION_INTERRUPTED' });
    await recovered.dispose(); x.controller.abort(); await x.coordinator.cancel(x.ctx); await promise;
  });
});
