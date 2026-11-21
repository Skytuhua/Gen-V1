import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/storage/store.ts';
import { Service } from '../packages/core/service.ts';
import type { RuntimeAdapter, Thread } from '../packages/contracts/index.ts';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const clean of cleanups.splice(0)) clean(); });
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'harness-power-activity-'));
  const store = new Store(dir);
  const runtime: RuntimeAdapter = { configure() {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
  cleanups.push(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const service = new Service(store, runtime);
  let sequence = 0;
  const command = (type: string, payload: Record<string, unknown>, threadId?: string) => service.command({ id: 'power-' + ++sequence, type, payload, threadId });
  return { store, service, command };
}
function wakeup(store: Store, id: string, state: string, paused = false) {
  store.put('backgroundWakeup', id, null, { wakeupId: id, taskId: 'task-' + id, state, paused, nextDueAtMs: Date.now() + 60000, trigger: { kind: 'AT_UTC', dueAtMs: Date.now() + 60000 }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', claimGeneration: 0, leaseExpiresAtMs: null, lastProcessedDueAtMs: null, skippedTotal: 0 });
}
describe('service.powerActivity', () => {
  it('reports zero activity on an empty workspace with both preferences off', async () => {
    const { service } = setup();
    expect(service.powerActivity()).toEqual({ tasks: 0, schedules: 0, keepAwakeTasks: false, keepAwakeSchedules: false });
  });
  it('counts live runs and working threads, skips awaiting input and archived threads', async () => {
    const { store, command, service } = setup();
    const ready = (await command('thread.create', { title: 'Idle' })).result as Thread;
    const working = (await command('thread.create', { title: 'Busy' })).result as Thread;
    const running = (await command('thread.create', { title: 'Running' })).result as Thread;
    const waiting = (await command('thread.create', { title: 'Waiting' })).result as Thread;
    const archived = (await command('thread.create', { title: 'Archived' })).result as Thread;
    store.internal('fixture.threads', null, () => {
      store.put('thread', working.id, null, { ...working, status: 'working' });
      store.put('thread', running.id, null, { ...running, runId: 'run-1' });
      store.put('thread', waiting.id, null, { ...waiting, status: 'awaiting_input' });
      store.put('archivedThread', archived.id, null, { ...archived, status: 'working', runId: 'run-2' });
      void ready;
    });
    expect(service.powerActivity().tasks).toBe(2);
  });
  it('counts only still-active wakeups and mirrors the saved preferences', async () => {
    const { store, command, service } = setup();
    store.internal('fixture.wakeups', null, () => {
      wakeup(store, 'w-pending', 'PENDING');
      wakeup(store, 'w-claimed', 'CLAIMED');
      wakeup(store, 'w-unknown', 'UNKNOWN');
      wakeup(store, 'w-paused', 'PENDING', true);
      wakeup(store, 'w-delivered', 'DELIVERED');
      wakeup(store, 'w-cancelled', 'CANCELLED');
      wakeup(store, 'w-blocked', 'BLOCKED');
      wakeup(store, 'w-skipped', 'SKIPPED');
    });
    await command('settings.update', { preferences: { keepAwakeTasks: true, keepAwakeSchedules: true } });
    expect(service.powerActivity()).toMatchObject({ schedules: 3, keepAwakeTasks: true, keepAwakeSchedules: true });
  });
});
