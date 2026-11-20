import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { expect, it, vi } from 'vitest';
import { destroyEventStreams, registerEventStream, streamEvents } from '../apps/server/event-stream';

function fixture(emitCloseOnDestroy = true) {
  const events = Array.from({ length: 97 }, (_, index) => ({
    seq: index + 1, id: String(index + 1), type: 'fixture.update', threadId: null,
    payload: null, occurredAt: '2026-01-01T00:00:00.000Z',
  }));
  const writes: number[] = [];
  const response = Object.assign(new EventEmitter(), {
    write(chunk: string) {
      const id = /^id: (\d+)/.exec(chunk);
      if (id) writes.push(Number(id[1]));
      return true;
    },
    destroy() { if (emitCloseOnDestroy) response.emit('close'); },
  });
  const unsubscribe = vi.fn(), onClose = vi.fn();
  const store: Parameters<typeof streamEvents>[1] = {
    eventsAfter(after: number, limit = events.length) { return events.filter(event => event.seq > after).slice(0, limit); },
    subscribe: () => unsubscribe,
  };
  const shutdown = streamEvents(response as unknown as ServerResponse, store, 0, onClose);
  return { response: response as unknown as ServerResponse, writes, close: () => response.emit('close'), shutdown, unsubscribe, onClose };
}

it('yields during fast history replay without changing delivery order', async () => {
  const f = fixture();
  try {
    expect(f.writes.length).toBeGreaterThan(0);
    expect(f.writes.length).toBeLessThan(97);
    await expect.poll(() => f.writes.length).toBe(97);
    expect(f.writes).toEqual(Array.from({ length: 97 }, (_, index) => index + 1));
  } finally { f.close(); }
});

it('does not resume replay after the consumer closes between batches', async () => {
  const f = fixture();
  const initial = f.writes.length;
  f.close();
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(initial).toBeLessThan(97);
  expect(f.writes).toHaveLength(initial);
  expect(f.unsubscribe).toHaveBeenCalledTimes(1);
  expect(f.onClose).toHaveBeenCalledTimes(1);
});

it('destroys active SSE streams and does not wait for a second close event', () => {
  const active = fixture();
  const streams = new Map<ServerResponse, () => void>([[active.response, active.shutdown]]);
  destroyEventStreams(streams);
  expect(streams.size).toBe(0);
  expect(active.unsubscribe).toHaveBeenCalledTimes(1);
  expect(active.onClose).toHaveBeenCalledTimes(1);

  // A destroyed socket need not emit 'close' before Fastify preClose finishes.
  // Cleanup must be synchronous and independent of that event.
  const silent = fixture(false);
  const destroy = vi.spyOn(silent.response, 'destroy');
  const lingering = new Map<ServerResponse, () => void>([[silent.response, silent.shutdown]]);
  destroyEventStreams(lingering);
  expect(destroy).toHaveBeenCalledTimes(1);
  expect(silent.unsubscribe).toHaveBeenCalledTimes(1);
  expect(silent.onClose).toHaveBeenCalledTimes(1);
  expect(lingering.size).toBe(0);
  silent.close();
  expect(silent.onClose).toHaveBeenCalledTimes(1);
});


it('does not consume stream slots when a response was already closed before registration', () => {
  const streams = new Map<ServerResponse, () => void>();
  const store: Parameters<typeof streamEvents>[1] = {
    eventsAfter: vi.fn(() => []),
    subscribe: vi.fn(() => vi.fn()),
  };
  // A client can disconnect between Fastify hijack and the stream route.
  // Thirty-two dead responses must not exhaust the 32-reader limit.
  for (let index = 0; index < 32; index++) {
    const response = Object.assign(new EventEmitter(), index % 2 === 0
      ? { destroyed: true } : { writableEnded: true }) as unknown as ServerResponse;
    registerEventStream(streams, response, store, 0);
    expect(streams.size).toBe(0);
  }
  expect(store.subscribe).not.toHaveBeenCalled();
  expect(store.eventsAfter).not.toHaveBeenCalled();
});

it('releases a failed replay before registering the stream even if destroy emits no close', () => {
  const streams = new Map<ServerResponse, () => void>(), unsubscribe = vi.fn(), destroy = vi.fn();
  const response = Object.assign(new EventEmitter(), { destroy }) as unknown as ServerResponse;
  const store: Parameters<typeof streamEvents>[1] = {
    eventsAfter() { throw Error('Ledger unavailable'); },
    subscribe() { return unsubscribe; },
  };
  try {
    registerEventStream(streams, response, store, 0);
    expect(destroy).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(streams.size).toBe(0);
  } finally { destroyEventStreams(streams); }
});
