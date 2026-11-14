import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { expect, it, vi } from 'vitest';
import { streamEvents } from '../apps/server/event-stream';

function fixture() {
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
    destroy() { response.emit('close'); },
  });
  const unsubscribe = vi.fn(), onClose = vi.fn();
  const store: Parameters<typeof streamEvents>[1] = {
    eventsAfter(after: number, limit = events.length) { return events.filter(event => event.seq > after).slice(0, limit); },
    subscribe: () => unsubscribe,
  };
  streamEvents(response as unknown as ServerResponse, store, 0, onClose);
  return { writes, close: () => response.emit('close'), unsubscribe, onClose };
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
