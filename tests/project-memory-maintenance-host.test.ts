import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { launchHost, type RunningHost } from '../apps/server/host.ts';
import type { RuntimeAdapter } from '../packages/contracts/index.ts';
import { PROJECT_MEMORY_LIMITS, projectMemoryViewSchema } from '../packages/contracts/project-memory.ts';
import { Service } from '../packages/core/service.ts';
import { digest } from '../packages/storage/store.ts';
import { memoryFixture } from './project-memory-fixture.ts';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { try { for (const close of cleanup.splice(0).reverse()) await close(); } finally { vi.useRealTimers(); } });
async function freePort() {
  const server = createServer(); await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing local test port');
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())); return address.port;
}
const runtime = (): RuntimeAdapter => ({ configure() {}, models: async () => [],
  start: async () => { throw Error('Purge host verification performs no model inference'); },
  followUp: async () => { throw Error('Purge host verification performs no model inference'); },
  cancel: async () => {}, compact: async () => { throw Error('Purge host verification does not replace native compaction'); },
  history: async () => [], dispose: async () => {} });

it.each([true, false])('schedules one bounded purge per host tick and preserves WAL/restart custody (memory enabled: %s)', async memoryEnabled => {
  // Only the settled source/item precondition and maintenance clock are
  // synthetic. Launch/profile lease, HTTP/CSRF, timer registration, deletion
  // fence, SQLite secure deletion and restart are the production paths.
  const seed = await memoryFixture(), marker = 'Unique retained memory claim for scheduled physical purge', item = seed.accept(marker);
  const dataDir = seed.store.dataDir, originalSource = seed.store.get('message', 'source'); seed.store.close();
  cleanup.push(() => rmSync(seed.root, { recursive: true, force: true }));
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  // freePort() closes its probe before the host binds the port, so a parallel worker can steal it in the gap; re-pick and retry on EADDRINUSE.
  let hostPort = await freePort(), widgetPort = await freePort(); while (widgetPort === hostPort) widgetPort = await freePort();
  let host: RunningHost | undefined, service!: Service, cookie = '', csrf = '';
  const addressInUse = (error: unknown) => error instanceof Error && ((error as NodeJS.ErrnoException).code === 'EADDRINUSE' || /EADDRINUSE|address already in use/i.test(error.message));
  const start = async () => {
    for (let attempt = 0;; attempt++) {
      try {
        host = await launchHost({ dataDir, port: hostPort, widgetPort, dev: false, pluginDir: join(seed.root, 'plugins'), capabilityFlags: { 'memory.projectV1': memoryEnabled } }, {
          createRuntime: runtime, createService: (store, adapter) => service = new Service(store, adapter),
        });
        return;
      } catch (error) {
        if (attempt >= 3 || !addressInUse(error)) throw error;
        hostPort = await freePort(); widgetPort = await freePort(); while (widgetPort === hostPort) widgetPort = await freePort();
      }
    }
  };
  cleanup.push(async () => { await host?.close(); });
  const authenticate = async () => {
    const response = await fetch(host!.origin + '/api/bootstrap'); expect(response.status).toBe(200);
    cookie = response.headers.get('set-cookie')!.split(';')[0]!; csrf = (await response.json()).csrfToken;
  };
  const request = (suffix: string, body?: unknown) => fetch(host!.origin + '/api/projects/project/memory' + suffix, {
    method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, Origin: host!.origin, 'Content-Type': 'application/json', 'X-Harness-CSRF': csrf },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const view = async () => { const response = await request('?threadId=thread'); expect(response.status).toBe(200); return projectMemoryViewSchema.parse(await response.json()); };
  await start(); await authenticate(); const before = await view();
  expect(before).toMatchObject({ available: memoryEnabled, enabled: true }); expect(before.items[0]!.item.id).toBe(item.id);
  const purge = vi.spyOn(service.projectMemory, 'purge');

  const reader = new DatabaseSync(join(dataDir, 'harness.sqlite'), { readOnly: true }); let held = true;
  reader.exec('BEGIN'); reader.prepare('SELECT COUNT(*) FROM entities').get();
  try {
    const forgotten = await request('/actions', { commandId: randomUUID(), scope: before.scope, operation: { action: 'forget', itemId: item.id, baseRevision: item.revision } });
    expect(forgotten.status).toBe(200);
    const deleted = await view(); expect(deleted.items).toEqual([]); expect(deleted.tombstones[0]!.purgeStatus).toBe('PENDING');
    vi.advanceTimersByTime(60_000);
    expect(purge).toHaveBeenCalledTimes(1);
    expect((await view()).tombstones[0]!.purgeStatus).toBe('PENDING');
    expect(service.store.get('projectMemorySource', digest(seed.ref))).not.toBeNull();

    // Advance wall time to retention expiry, then fire one real registered
    // interval. This is clock-controlled scheduling proof, not seven days of
    // installed execution and not a direct call to ProjectMemory.purge().
    vi.setSystemTime(Date.parse(deleted.tombstones[0]!.deletedAt) + PROJECT_MEMORY_LIMITS.purgeRetentionMs + 1);
    vi.advanceTimersByTime(60_000); await authenticate();
    expect((await view()).tombstones[0]!.purgeStatus).toBe('PENDING');
    const oldCopy = reader.prepare("SELECT body FROM entities WHERE kind='projectMemoryRevision' AND id=?").get(`${item.id}@${item.revision}`) as { body: string };
    expect(oldCopy.body).toContain(marker);
    expect(service.store.get('projectMemoryRevision', `${item.id}@${item.revision}`)).toBeNull();
    reader.exec('ROLLBACK'); reader.close(); held = false;
    vi.advanceTimersByTime(60_000);
    const completed = await view(); expect(completed.items).toEqual([]); expect(completed.tombstones[0]!.purgeStatus).toBe('COMPLETE');
    expect(service.store.get('projectMemorySource', digest(seed.ref))).toBeNull();
    expect(service.store.all('projectMemoryRevision')).toEqual([]);
    expect(service.store.get('message', 'source')).toEqual(originalSource);
    const source = await request(`/source?threadId=thread&itemId=${item.id}&revision=${item.revision}&sourceDigest=${seed.ref.digest}`); expect(source.status).toBe(404);

    await host!.close(); expect(vi.getTimerCount()).toBe(0);
    expect(readFileSync(join(dataDir, 'harness.sqlite')).includes(Buffer.from(marker))).toBe(false);
    await start(); await authenticate();
    expect((await view()).tombstones).toEqual(completed.tombstones);
    expect((await view()).items).toEqual([]);
    expect(service.store.get('message', 'source')).toEqual(originalSource);
  } finally { if (held) { reader.exec('ROLLBACK'); reader.close(); } }
}, 30_000);
