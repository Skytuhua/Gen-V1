import { once } from 'node:events';
import type { ServerResponse } from 'node:http';
import type { Store } from '../../packages/storage/store.ts';

/** The durable ledger is the queue. Retain only one event while a reader drains. */
export function streamEvents(response: ServerResponse, store: Pick<Store, 'eventsAfter' | 'subscribe'>, after: number, onClose: () => void): void {
  if (response.destroyed || response.writableEnded) { onClose(); return; }
  const controller = new AbortController();
  let cursor = after, pumping = false, closed = false, comment = ': connected\n\n';
  async function pump() {
    if (pumping || closed) return;
    pumping = true;
    try {
      while (!closed) {
        const event = store.eventsAfter(cursor, 1)[0];
        if (!event && !comment) break;
        const chunk = event ? `id: ${event.seq}\nevent: workspace\ndata: ${JSON.stringify(event)}\n\n` : comment;
        if (event) cursor = event.seq; else comment = '';
        if (!response.write(chunk)) await once(response, 'drain', { signal: controller.signal });
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
