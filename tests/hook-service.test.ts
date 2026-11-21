import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../packages/storage/store.ts';
import { Service } from '../packages/core/service.ts';
import { hookSettingsFor } from '../packages/core/hook-settings.ts';
import type { RuntimeAdapter, Thread } from '../packages/contracts/index.ts';
import type { Hook } from '../packages/contracts/hooks.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
const nodee=(code:string)=>`${JSON.stringify(process.execPath)} -e ${JSON.stringify(code)}`;
const runtime: RuntimeAdapter = { configure: () => {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
const hook=(over:Partial<Hook>={}):Hook=>({ id: 'hook_' + Math.random().toString(36).slice(2, 18), name: '', event: 'PreToolUse', matcher: '', command: 'exit 0', timeoutSeconds: 30, onError: 'continue', enabled: true, ...over });
const baseThread=(over:Partial<Thread>={}):Thread=>({ id: 't1', title: 'Task', createdAt: '2026-11-20T00:00:00Z', updatedAt: '2026-11-20T00:00:00Z', kind: 'main', projectName: null, status: 'working', epoch: 1, runId: 'r1', modelId: null, sessionPath: null, ...over });

async function setup(threads: Thread[] = [baseThread()]) {
  const dir = mkdtempSync(join(tmpdir(), 'hook-service-')), store = new Store(dir), service = new Service(store, runtime), settings = hookSettingsFor(dir);
  for (const thread of threads) store.internal('fixture.thread', thread.id, () => store.put('thread', thread.id, thread.id, thread));
  cleanups.push(async () => { await service.dispose(); store.close(); rmSync(dir, { recursive: true, force: true }); });
  const activities = (threadId: string) => store.snapshot().messages.filter(message => message.threadId === threadId && message.role === 'activity');
  return { store, service, settings, activities };
}
const ctx = { threadId: 't1', runId: 'r1', epoch: 1 };

it('PreToolUse block rejects the host tool with HOOK_BLOCKED, skips the executor and records activity', async () => {
  const { service, settings, activities } = await setup();
  await settings.save({ hook: hook({ name: 'blocker', command: nodee('console.error("no tool access");process.exit(2)') }), baseRevision: 0 });
  await expect(service.tool({ name: 'task_memory', args: { action: 'list' } }, ctx)).rejects.toMatchObject({ code: 'HOOK_BLOCKED', message: expect.stringContaining('no tool access') });
  const rows = activities('t1');
  expect(rows).toHaveLength(1); expect(rows[0].content).toContain('blocker'); expect(rows[0].content).toContain('blocked');
});

it('PreToolUse exit 0 allows the tool and PostToolUse receives the tool result', async () => {
  const { service, settings, store } = await setup();
  await settings.save({ hook: hook({ command: nodee('process.stdout.write(JSON.stringify({systemMessage:"allowed"}))') }), baseRevision: 0 });
  await settings.save({ hook: hook({ name: 'probe', event: 'PostToolUse', command: nodee('let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{if(!d.includes(\'"status":"succeeded"\'))process.exit(5)})') }), baseRevision: 1 });
  const result = await service.tool({ name: 'task_memory', args: { action: 'list' } }, ctx) as { notes: unknown[] };
  expect(result.notes).toBeInstanceOf(Array);
  const record = [...service.hookRunner.lastRuns.values()].find(r => r.event === 'PostToolUse');
  expect(record?.outcome).toBe('succeeded');
  const rows = store.snapshot().messages.filter(m => m.role === 'activity');
  expect(rows).toHaveLength(1); expect(rows[0].content).toContain('allowed');
});

it('non-matching PreToolUse matcher skips the hook without running it', async () => {
  const { service, settings, store } = await setup();
  await settings.save({ hook: hook({ matcher: '^file\\.write$', command: nodee('process.exit(2)') }), baseRevision: 0 });
  const result = await service.tool({ name: 'task_memory', args: { action: 'list' } }, ctx) as { notes: unknown[] };
  expect(result.notes).toBeInstanceOf(Array); expect(store.snapshot().messages.filter(m => m.role === 'activity')).toHaveLength(0);
});

it('master switch disabled runs no hook processes even with saved hooks', async () => {
  const { service, settings, store } = await setup();
  const saved = await settings.save({ hook: hook({ command: nodee('process.exit(2)') }), baseRevision: 0 });
  await settings.setEnabled({ enabled: false, baseRevision: saved.revision });
  const result = await service.tool({ name: 'task_memory', args: { action: 'list' } }, ctx) as { notes: unknown[] };
  expect(result.notes).toBeInstanceOf(Array); expect(service.hookRunner.lastRuns.size).toBe(0);
  expect(store.snapshot().messages.filter(m => m.role === 'activity')).toHaveLength(0);
});

it('UserPromptSubmit block rejects message.send before storage with HOOK_BLOCKED', async () => {
  const { service, settings, store } = await setup();
  await settings.save({ hook: hook({ event: 'UserPromptSubmit', name: 'censor', command: nodee('process.stdout.write(JSON.stringify({decision:"block",reason:"prompt denied"}))') }), baseRevision: 0 });
  await expect(service.command({ id: 'cmd-1', type: 'message.send', threadId: 't1', payload: { content: 'hello', modelId: 'model-x' } })).rejects.toMatchObject({ code: 'HOOK_BLOCKED', message: 'Blocked by hook censor: prompt denied' });
  expect(store.snapshot().messages.filter(m => m.role === 'user')).toHaveLength(0);
  const rows = store.snapshot().messages.filter(m => m.role === 'activity');
  expect(rows).toHaveLength(1); expect(rows[0].content).toContain('censor');
});

it('UserPromptSubmit that does not block falls through to the next validation', async () => {
  const { service, settings } = await setup();
  await settings.save({ hook: hook({ event: 'UserPromptSubmit', command: 'exit 0' }), baseRevision: 0 });
  await expect(service.command({ id: 'cmd-2', type: 'message.send', threadId: 't1', payload: { content: 'hello', modelId: 'model-x' } })).rejects.toMatchObject({ code: expect.not.stringMatching('HOOK_BLOCKED') });
});

it('Stop hooks fire once when a main thread settles', async () => {
  const { service, settings, store } = await setup();
  await settings.save({ hook: hook({ event: 'Stop', name: 'fin', command: nodee('process.stdout.write(JSON.stringify({systemMessage:"turn done"}))') }), baseRevision: 0 });
  (service as unknown as { onRuntimeEvent: (event: unknown) => void }).onRuntimeEvent({ type: 'settled', threadId: 't1', runId: 'r1', epoch: 1 });
  await new Promise(resolve => setTimeout(resolve, 300));
  const rows = store.snapshot().messages.filter(m => m.role === 'activity');
  expect(rows).toHaveLength(1); expect(rows[0].content).toContain('turn done');
});

it('side and delegate threads do not trigger Stop hooks', async () => {
  const { service, settings, store } = await setup([baseThread({ id: 's1', kind: 'side', sideParentId: 't0', runId: 'r2' })]);
  await settings.save({ hook: hook({ event: 'Stop', command: nodee('process.stdout.write(JSON.stringify({systemMessage:"turn done"}))') }), baseRevision: 0 });
  (service as unknown as { onRuntimeEvent: (event: unknown) => void }).onRuntimeEvent({ type: 'settled', threadId: 's1', runId: 'r2', epoch: 1 });
  await new Promise(resolve => setTimeout(resolve, 300));
  expect(store.snapshot().messages.filter(m => m.role === 'activity')).toHaveLength(0);
});

it('op:* hook block fails the operation through the normal dispatch failure path', async () => {
  const { service, settings, store } = await setup();
  await settings.save({ hook: hook({ name: 'op-guard', matcher: '^op:.*$', command: nodee('process.exit(2)') }), baseRevision: 0 });
  const op = { id: 'op1', threadId: 't1', revision: 0, kind: 'file.write', description: 'write', args: { path: 'x.txt', content: 'hi' }, resourceIds: [], preconditions: {}, status: 'prepared' as const, approved: true, createdAt: '2026-11-20T00:00:00Z' };
  store.internal('fixture.op', 't1', () => store.put('operation', 'op1', 't1', op));
  await expect((service as unknown as { executeOperation: (id: string, control: AbortController) => Promise<unknown> }).executeOperation('op1', new AbortController())).rejects.toMatchObject({ code: 'HOOK_BLOCKED' });
  expect(store.get<typeof op>('operation', 'op1')?.status).toBe('failed');
});

it('planning child tool calls pass through the hooks path', async () => {
  const { service, settings } = await setup();
  await settings.save({ hook: hook({ name: 'plan-block', command: nodee('process.exit(2)') }), baseRevision: 0 });
  const parent = { threadId: 't1', runId: 'r1', epoch: 1 };
  const observe = (service.planning as unknown as { hooks: { observeTool: (call: { name: string; args: object }, parent: object, execute: () => Promise<unknown>) => Promise<unknown> } }).hooks.observeTool;
  await expect(observe({ name: 'task_memory', args: { action: 'list' } }, parent, async () => 'ok')).rejects.toMatchObject({ code: 'HOOK_BLOCKED' });
});
