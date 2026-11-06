import { afterEach, expect, it, vi } from 'vitest';
import { get, type ClientRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, realpath, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { Store } from '../packages/storage/store.ts';
import { Service } from '../packages/core/service.ts';
import { buildServer } from '../apps/server/server.ts';
import type { RuntimeAdapter } from '../packages/contracts/index.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.restoreAllMocks(); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'harness-event-stream-')), store = new Store(root);
  const runtime: RuntimeAdapter = { configure: () => {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
  const service = new Service(store, runtime), app = await buildServer(service, { port: 4317, dev: false });
  // Host-owned projections may commit startup metadata before fixture events.
  const baseline = store.sequence;
  let response: ServerResponse | undefined, request: ClientRequest | undefined, incoming: IncomingMessage | undefined;
  let blocked = false, releaseRequested = false, writes = 0, subscriptions = 0, peakQueued = 0, text = '';
  const subscribe = store.subscribe.bind(store);
  vi.spyOn(store, 'subscribe').mockImplementation(listener => { subscriptions++; const remove = subscribe(listener); return () => { subscriptions--; remove(); }; });
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/events')) return;
    response = reply.raw;
    const write = response.write.bind(response), emit = response.emit.bind(response) as (event: string | symbol, ...args: unknown[]) => boolean;
    response.write = ((chunk: string | Buffer) => {
      const result = write(chunk);
      peakQueued = Math.max(peakQueued, response!.writableLength);
      if (String(chunk).startsWith('id: ')) { if (++writes === 1) blocked = true; return blocked ? false : result; }
      return result;
    }) as typeof response.write;
    response.emit = ((event: string | symbol, ...args: unknown[]) => {
      if (event === 'drain' && blocked) { if (!releaseRequested) return false; blocked = false; }
      return emit(event, ...args);
    }) as typeof response.emit;
  });
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  const boot = await app.inject({ url: '/api/bootstrap', headers: { host: '127.0.0.1:4317' } }), cookie = String(boot.headers['set-cookie']).split(';')[0];
  const open = async (after = 0) => {
    incoming = await new Promise<IncomingMessage>((done, fail) => { request = get(`${url}/api/events?after=${baseline+after}`, { headers: { host: '127.0.0.1:4317', cookie } }, done); request.once('error', fail); });
    incoming.setEncoding('utf8'); incoming.on('data', chunk => { text += chunk; }); incoming.on('error', () => {});
    await new Promise<void>(done => setImmediate(done));
  };
  // A forced false also needs a synthetic drain when Node accepted the chunk below its high water mark.
  const release = () => { releaseRequested = true; if (response && !response.writableNeedDrain) { blocked = false; response.emit('drain'); } };
  const publish = (count: number) => { for (let n = 0; n < count; n++) store.internal('fixture.progress', null, () => 'x'.repeat(48 * 1024)); };
  cleanups.push(async () => {
    release(); incoming?.destroy(); request?.destroy(); await app.close(); await service.dispose(); store.close();
    if (await realpath(root) !== resolve(root) || !resolve(root).startsWith(await realpath(tmpdir()) + sep) || (await lstat(root)).isSymbolicLink()) throw new Error('Unsafe fixture cleanup');
    await rm(root, { recursive: true, force: true });
  });
  return { store, baseline, app, open, publish, release, close: () => { incoming?.destroy(); request?.destroy(); }, writes: () => writes, peakQueued: () => peakQueued, subscriptions: () => subscriptions, response: () => response!, ids: () => [...text.matchAll(/^id: (\d+)$/gm)].map(match => Number(match[1])) };
}

it('pauses historical replay at backpressure, then delivers replay and live arrivals in order', async () => {
  const x = await fixture(); x.publish(20); await x.open(5);
  const pausedWrites = x.writes(); x.publish(10); const afterLiveBurst = x.writes(); x.release();
  await expect.poll(() => x.ids().length).toBe(25);
  expect(pausedWrites).toBe(1); expect(afterLiveBurst).toBe(1);
  expect(x.peakQueued()).toBeLessThan(x.response().writableHighWaterMark + 64 * 1024);
  expect(x.ids()).toEqual(x.store.eventsAfter(x.baseline+5).map(event => event.seq));
});

it('pauses a live burst without building an in-memory event backlog', async () => {
  const x = await fixture(); await x.open(); x.publish(100); const pausedWrites = x.writes(); x.release();
  await expect.poll(() => x.ids().length).toBe(100);
  expect(pausedWrites).toBe(1); expect(x.ids()).toEqual(x.store.eventsAfter(x.baseline).map(event => event.seq));
  expect(x.peakQueued()).toBeLessThan(x.response().writableHighWaterMark + 64 * 1024);
});

it('releases a disconnected drain waiter and its store subscription', async () => {
  const x = await fixture(); x.publish(3); await x.open(); x.close();
  await expect.poll(() => x.subscriptions()).toBe(0);
  expect(x.response().listenerCount('drain')).toBe(0);
  x.publish(3); expect(x.writes()).toBe(1);
});

it('closes a waiting stream on host shutdown without retaining its drain listener', async () => {
  const x = await fixture(); x.publish(3); await x.open(); await x.app.close();
  expect(x.subscriptions()).toBe(0); expect(x.response().listenerCount('drain')).toBe(0);
  expect(x.writes()).toBe(1);
});

it('keeps complete ledger reads compatible and validates bounded page sizes', async () => {
  const x = await fixture(); x.publish(5);
  expect(x.store.eventsAfter(x.baseline)).toHaveLength(5);
  expect(x.store.eventsAfter(x.baseline+1, 2).map(event => event.seq)).toEqual([x.baseline+2, x.baseline+3]);
  for (const limit of [0, -1, 1.5, 1001]) expect(() => x.store.eventsAfter(0, limit)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
});
