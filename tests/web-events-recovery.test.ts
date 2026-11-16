import { afterEach, expect, it, vi } from 'vitest';
import type { Message, Snapshot, WorkspaceEvent } from '../packages/contracts';
import { applyRuntimeEvent } from '../apps/web/src/snapshot-events';

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


it('does not count a streaming append as older history when the cached window retains it', () => {
  const older = { id: 'retained', threadId: 'a', content: 'visible', role: 'assistant', runId: null, createdAt: '' } satisfies Message;
  const latest = { ...older, id: 'latest' };
  const snapshot = {
    seq: 10, threads: [], messages: [older], messagesTruncated: { a: 12, other: 4 },
    artifacts: [], userStates: [], data: [], requests: [], operations: [], resources: [],
    usage: {}, settings: { theme: 'dark', modelId: null }, activeThreadId: 'a',
  } satisfies Snapshot;
  const event = { id: 'event', seq: 11, threadId: 'a', type: 'runtime.assistant.delta', occurredAt: '' } satisfies Omit<WorkspaceEvent, 'payload'>;
  const append = applyRuntimeEvent(snapshot, { ...event, payload: { result: { message: latest } } })!;
  expect(append.messages).toEqual([older, latest]);
  expect(append.messagesTruncated).toBe(snapshot.messagesTruncated);
  const update = applyRuntimeEvent(append, { ...event, seq: 12, payload: { result: { message: { ...latest, content: 'updated' } } } });
  expect(update?.messages.map(item => item.content)).toEqual(['visible', 'updated']);
  expect(update?.messagesTruncated).toBe(snapshot.messagesTruncated);
});

it('keeps the same oldest request as the server after an in-place timing update and eviction', () => {
  const observation = (index: number): NonNullable<Snapshot['modelRequests']>[string][number] => ({
    version: 1, requestId: 'request-' + index,
    owner: { threadId: 'a', runId: 'r', epoch: 1, sequence: index + 1, inputIds: [], phase: 'foreground' },
    binding: { providerId: 'p', modelId: 'p/m', accountId: null },
    timings: { queued: index, acquired: 0, runtimeReady: 0, requestSent: 0, firstProviderDelta: null, firstPublicDelta: null, settled: 1, teardownConfirmed: 1 },
    usage: { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, cost: null },
    usageConvention: 'unreported', measurementSource: 'test', outcome: 'completed',
  });
  const requests = Array.from({ length: 64 }, (_, i) => observation(i));
  const snapshot = {
    seq: 10, threads: [], messages: [], artifacts: [], userStates: [], data: [], requests: [], operations: [], resources: [],
    usage: {}, settings: { theme: 'dark', modelId: null }, activeThreadId: 'a', modelRequests: { a: requests },
  } satisfies Snapshot;
  const event = (request: ReturnType<typeof observation>, seq: number): WorkspaceEvent => ({
    id: String(seq), seq, threadId: 'a', type: 'runtime.model.observation', occurredAt: '',
    payload: { result: { modelRequest: request } },
  });
  const update = { ...observation(0), timings: { ...observation(0).timings, firstPublicDelta: 2 } };
  const patched = applyRuntimeEvent(snapshot, event(update, 11))!;
  expect(patched.modelRequests?.a).toEqual([update, ...requests.slice(1)]);
  const newest = observation(64);
  const after = applyRuntimeEvent(patched, event(newest, 12))!;
  expect(after.modelRequests?.a).toEqual([...requests.slice(1), newest]);
  expect(snapshot.modelRequests.a).toEqual(requests);
});
