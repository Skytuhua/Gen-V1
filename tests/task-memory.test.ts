import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../packages/storage/store';
import { Service } from '../packages/core/service';
import type { RuntimeAdapter, StartRun, Thread } from '../packages/contracts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'harness-memory-'));
  const store = new Store(dir); const starts: StartRun[] = [];
  const runtime: RuntimeAdapter = { configure() {}, models: async () => [{ id: 'test/model', provider: 'test', name: 'Test' }], start: async input => { starts.push(input); }, followUp: async input => { starts.push(input); }, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
  const service = new Service(store, runtime);
  cleanups.push(async () => { await service.dispose(); store.close(); rmSync(dir, { recursive: true, force: true }); });
  const command = async (type: string, payload: Record<string, unknown>, threadId?: string, id: string = crypto.randomUUID()) => service.command({ id, type, payload, threadId });
  const thread = (await command('thread.create', { title: 'Notes' })).result as Thread;
  return { store, service, starts, command, threadId: thread.id };
}
it('persists revisioned thread notes, exposes them, and restores them to the owning run', async () => {
  const x = await fixture();
  const first = await x.command('memory.save', { key: 'decision', content: 'Use UTC for exported dates.', baseRevision: 0 }, x.threadId, 'memory-retry');
  expect(await x.command('memory.save', { key: 'decision', content: 'Use UTC for exported dates.', baseRevision: 0 }, x.threadId, 'memory-retry')).toEqual(first);
  expect(x.store.snapshot().memory?.[0]).toMatchObject({ key: 'decision', content: 'Use UTC for exported dates.', revision: 1, threadId: x.threadId });
  await expect(x.command('memory.save', { key: 'decision', content: 'Wrong stale edit', baseRevision: 0 }, x.threadId)).rejects.toMatchObject({ code: 'STALE_MEMORY' });
  await x.command('message.send', { content: 'Continue', modelId: 'test/model' }, x.threadId);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(x.starts[0].memory).toContain('Use UTC for exported dates.');
  expect(x.starts[0].memory).not.toContain(x.store.dataDir);
  const other = (await x.command('thread.create', { title: 'Other' })).result as Thread;
  await expect(x.command('memory.delete', { key: 'decision', baseRevision: 1 }, other.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await x.command('memory.delete', { key: 'decision', baseRevision: 1 }, x.threadId);
  expect(x.store.snapshot().memory).toHaveLength(0);
});
it('bounds memory and never treats notes as effect receipts or authority', async () => {
  const x = await fixture();
  await expect(x.command('memory.save', { key: 'secret', content: 'sk-proj-abcdefghijklmnopqrstuvwxyz123456', baseRevision: 0 }, x.threadId)).rejects.toMatchObject({ code: 'INVALID_MEMORY' });
  await expect(x.command('memory.save', { key: 'huge', content: 'a'.repeat(2000), baseRevision: 0 }, x.threadId)).rejects.toMatchObject({ code: 'INVALID_MEMORY' });
  await x.command('memory.save', { key: 'note', content: 'An agent note, not execution evidence.', baseRevision: 0 }, x.threadId);
  await x.command('message.send', { content: 'Continue', modelId: 'test/model' }, x.threadId);
  await new Promise(resolve => setTimeout(resolve, 0));
  const ctx = { threadId: x.threadId, runId: x.starts[0].runId, epoch: x.starts[0].epoch };
  const saved = await x.service.tool({ name: 'task_memory', args: { action: 'save', key: 'constraint', content: 'Keep source files intact.', baseRevision: 0 } }, ctx);
  expect(saved).toMatchObject({ key: 'constraint', revision: 1 });
  await x.command('run.stop', {}, x.threadId);
  await expect(x.service.tool({ name: 'task_memory', args: { action: 'save', key: 'late', content: 'Late', baseRevision: 0 } }, ctx)).rejects.toMatchObject({ code: 'CANCELLED_RUN' });
  expect(x.store.all('operation')).toHaveLength(0);
});
it('retains revision identity across forgetting and recreating a note key', async () => {
  const x = await fixture();
  await x.command('memory.save', { key: 'decision', content: 'Old decision', baseRevision: 0 }, x.threadId);
  await x.command('memory.delete', { key: 'decision', baseRevision: 1 }, x.threadId);
  await x.command('memory.save', { key: 'decision', content: 'A new decision', baseRevision: 0 }, x.threadId);
  await expect(x.command('memory.save', { key: 'decision', content: 'Stale editor overwrites', baseRevision: 1 }, x.threadId)).rejects.toMatchObject({ code: 'STALE_MEMORY' });
  expect(x.store.snapshot().memory?.[0].content).toBe('A new decision');
});
