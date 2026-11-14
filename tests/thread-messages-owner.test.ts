import { afterEach, expect, it, vi } from 'vitest';
import type { Message, Snapshot } from '../packages/contracts';

const hooks = vi.hoisted(() => ({
  position: 0,
  slots: [] as unknown[],
  effects: [] as (() => void)[],
  layouts: [] as (() => void)[],
  getPage: vi.fn(),
}));

vi.mock('react', () => {
  function effect(queue: (() => void)[], run: () => void | (() => void), deps: unknown[]) {
    const index = hooks.position++;
    const previous = hooks.slots[index] as { deps: unknown[]; cleanup?: () => void } | undefined;
    if (previous?.deps.length === deps.length && previous.deps.every((value, i) => Object.is(value, deps[i]))) return;
    queue.push(() => { previous?.cleanup?.(); const done = run(); hooks.slots[index] = { deps, cleanup: done }; });
  }
  return {
    useState: (initial: unknown) => {
      const index = hooks.position++;
      if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [hooks.slots[index], (next: unknown) => { hooks.slots[index] = typeof next === 'function' ? next(hooks.slots[index]) : next; }];
    },
    useRef: (initial: unknown) => {
      const index = hooks.position++;
      return hooks.slots[index] ??= { current: initial };
    },
    useEffect: (run: () => void, deps: unknown[]) => effect(hooks.effects, run, deps),
    useLayoutEffect: (run: () => void, deps: unknown[]) => effect(hooks.layouts, run, deps),
    useCallback: (fn: unknown) => { hooks.position++; return fn; },
  };
});
vi.mock('../apps/web/src/api', () => ({ getThreadMessages: hooks.getPage }));

import { useThreadMessages } from '../apps/web/src/thread-messages';

const message = (threadId: string, id: string): Message => ({
  id, threadId, role: 'user', content: id, createdAt: '2026-01-01T00:00:00Z', runId: null,
});
const snapshot: Pick<Snapshot, 'messages' | 'messagesTruncated'> = { messages: [message('a', 'a-current'), message('b', 'b-current')], messagesTruncated: { a: 2, b: 1 } };
function render(owner: string) {
  hooks.position = 0;
  const result = useThreadMessages(snapshot, owner);
  for (const queue of [hooks.layouts, hooks.effects]) for (const run of queue.splice(0)) run();
  return result;
}
afterEach(() => { hooks.slots.length = 0; hooks.getPage.mockReset(); });

it('can load history for a new owner immediately after switching from a pending request', async () => {
  let complete!: (page: { messages: Message[]; truncated: number }) => void;
  hooks.getPage.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
  const pending = render('a').loadMore();
  expect(render('a').loading).toBe(true);
  render('b');
  expect(render('b').loading).toBe(false);
  complete({ messages: [message('a', 'a-old')], truncated: 1 });
  await pending;
  expect(render('b').messages.map(value => value.id)).toEqual(['b-current']);
});

it('does not display older results from the prior conversation on the first render after a switch', async () => {
  hooks.getPage.mockResolvedValueOnce({ messages: [message('a', 'a-old')], truncated: 1 });
  await render('a').loadMore();
  expect(render('a').messages.map(value => value.id)).toEqual(['a-old', 'a-current']);
  expect(render('b').messages.map(value => value.id)).toEqual(['b-current']);
});
