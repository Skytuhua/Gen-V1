import { afterEach, expect, it, vi } from 'vitest';
import { workspaceEvents } from '../apps/desktop/workspace-events';

afterEach(() => vi.unstubAllGlobals());

it('relays only the highest complete sequence per decoded chunk', async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } });
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(null, { headers: { 'Set-Cookie': 'harness_session=abcd; HttpOnly' } }))
    .mockResolvedValueOnce(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }));
  vi.stubGlobal('fetch', fetch);
  const notify = vi.fn(), relay = workspaceEvents('http://127.0.0.1:4317', notify);
  const encoder = new TextEncoder();
  try {
    await expect.poll(() => relay.state().connected).toBe(true);
    stream.enqueue(encoder.encode('id: 1\nevent: workspace\ndata: {}\n\nid: 2\nevent: workspace\ndata: {}\n\nid: 3'));
    await expect.poll(() => relay.state().sequence).toBe(2);
    expect(notify.mock.calls.map(([value]) => value)).toEqual([
      { connected: true, sequence: 0 },
      { connected: true, sequence: 2 },
    ]);
    stream.enqueue(encoder.encode('\nevent: workspace\ndata: {}\n\nid: 2\n\n'));
    await expect.poll(() => relay.state().sequence).toBe(3);
    expect(notify.mock.calls.at(-1)?.[0]).toEqual({ connected: true, sequence: 3 });
  } finally { await relay.close(); }
  expect(notify.mock.calls.at(-1)?.[0]).toEqual({ connected: false, sequence: 3 });
});
