import { once } from 'node:events';
import { setImmediate as yieldToHost } from 'node:timers/promises';
import type { ServerResponse } from 'node:http';
import type { Store } from '../../packages/storage/store.ts';

/** Release hijacked SSE responses during Fastify preClose without waiting for
 * a second 'close' event. The client's disconnect can race with shutdown,
 * and an already-destroyed response need not emit 'close' again. */
export function destroyEventStreams(streams: Set<ServerResponse>): void {
  for (const stream of streams) stream.destroy();
  streams.clear();
}

/** The durable ledger is the queue. Retain only one event while a reader drains. */
export function streamEvents(response: ServerResponse, store: Pick<Store, 'eventsAfter' | 'subscribe'>, after: number, onClose: () => void): void {
  if (response.destroyed || response.writableEnded) { onClose(); return; }
  const controller = new AbortController();
  let cursor = after, pumping = false, closed = false, comment = ': connected\n\n';
  async function pump() {
    if (pumping || closed) return;
    pumping = true;
    let written = 0;
    try {
      while (!closed) {
        const event = store.eventsAfter(cursor, 1)[0];
        if (!event && !comment) break;
        const chunk = event ? `id: ${event.seq}\nevent: workspace\ndata: ${JSON.stringify(event)}\n\n` : comment;
        if (event) cursor = event.seq; else comment = '';
        if (!response.write(chunk)) {
          await once(response, 'drain', { signal: controller.signal });
          written = 0;
        } else if (++written === 32) {
          // A fast reader might not exert backpressure during a long replay.
          // Give other requests and disconnects a turn without queuing events.
          await yieldToHost();
          written = 0;
        }
      }
    } catch { if (!closed) response.destroy(); }
    finally { pumping = false; }
  }
  const unsubscribe = store.subscribe(() => { void pump(); });
  const heartbeat = setInterval(() => { comment = ': heartbeat\n\n'; void pump(); }, 15000);
  heartbeat.unref();
  const close = () => {
    if (closed) return;
    closed = true; controller.abort(); clearInterval(heartbeat); unsubscribe();
    response.off('close', close); response.off('error', fail); onClose();
  };
  const fail = () => response.destroy();
  response.once('close', close); response.once('error', fail);
  void pump();
}
