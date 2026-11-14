import { afterEach, expect, it, vi } from 'vitest';

class Stream {
  static instances: Stream[] = [];
  onopen?: () => void;
  onerror?: () => void;
  onmessage?: (event: { data: string }) => void;
  close = vi.fn();
  addEventListener = vi.fn();
  constructor() { Stream.instances.push(this); }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Stream.instances = [];
});

async function setup(bootstrap: () => Promise<Response>) {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal('window', {});
  vi.stubGlobal('EventSource', Stream);
  vi.stubGlobal('fetch', vi.fn(bootstrap));
  return (await import('../apps/web/src/api.ts')).subscribe;
}

it('does not refresh an unsubscribed view when pending session renewal finishes', async () => {
  let finish!: (response: Response) => void;
  const subscribe = await setup(() => new Promise(resolve => { finish = resolve; }));
  const refresh = vi.fn(async () => {});
  const unsubscribe = subscribe(0, vi.fn(), vi.fn(), refresh);
  Stream.instances[0].onerror!();
  await vi.advanceTimersByTimeAsync(500);
  unsubscribe();
  finish(Response.json({ csrfToken: 'test' }));
  await vi.advanceTimersByTimeAsync(0);
  expect(refresh).not.toHaveBeenCalled();
  expect(Stream.instances).toHaveLength(1);
});

it('ignores queued callbacks from a disconnected stream', async () => {
  const subscribe = await setup(async () => Response.json({ csrfToken: 'test' }));
  const accept = vi.fn(), connectivity = vi.fn(), refresh = vi.fn(async () => {});
  const unsubscribe = subscribe(0, accept, connectivity, refresh);
  try {
    const stale = Stream.instances[0];
    stale.onerror!();
    stale.onerror!();
    stale.onopen!();
    stale.onmessage!({ data: '{"seq":42}' });
    await vi.advanceTimersByTimeAsync(500);
    expect(accept).not.toHaveBeenCalled();
    expect(connectivity.mock.calls).toEqual([[false]]);
    expect(refresh).toHaveBeenCalledOnce();
    expect(Stream.instances).toHaveLength(2);
  } finally { unsubscribe(); }
});
