import { afterEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as unknown[],
  effect: undefined as undefined | (() => void),
}));
vi.mock('react', () => ({
  useState(initial: unknown) {
    const slot = fixture.cursor++;
    if (!(slot in fixture.slots)) fixture.slots[slot] = initial;
    return [fixture.slots[slot], (value: unknown) => { fixture.slots[slot] = typeof value === 'function' ? value(fixture.slots[slot]) : value; }];
  },
  useRef(initial: unknown) { const slot = fixture.cursor++; return fixture.slots[slot] ??= { current: initial }; },
  useCallback(fn: unknown) { return fn; },
  useLayoutEffect(effect: () => void) { effect(); },
  useEffect(effect: () => void) { fixture.effect = effect; },
}));
vi.mock('../apps/web/src/api.ts', () => ({
  authenticated: (send: () => Promise<Response>) => send(),
  read: (response: Response) => response.json(),
  ApiError: class extends Error { constructor(public code: string, message: string, public details?: unknown) { super(message); } },
}));

import { useProjectContext } from '../apps/web/src/project-api';

function render(project?: string, thread?: string) {
  fixture.cursor = 0;
  return useProjectContext(project, thread);
}
afterEach(() => { vi.unstubAllGlobals(); fixture.slots.length = 0; fixture.effect = undefined; });

it('does not show one thread’s project context after selecting a different thread', async () => {
  const context = { status: 'ready', title: 'Previous context', project: { id: 'project', name: 'Previous context' }, machineName: 'runner', editor: { available: false, label: '' }, branch: null, head: null, changes: { added: null, removed: null, files: null }, lineage: [], scripts: [], capabilities: { git: false, terminal: false, pullRequests: false } };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(context)));
  render('project', 'first'); fixture.effect!();
  await vi.waitFor(() => expect(render('project', 'first').context).toEqual(context));
  expect(render('project', 'second')).toMatchObject({ context: null, loading: true, error: '' });
});

it('does not show a previous project error when no project is selected', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw Error('Previous context unavailable'); }));
  render('project', 'first'); fixture.effect!();
  await vi.waitFor(() => expect(render('project', 'first').error).toBe('Previous context unavailable'));
  expect(render(undefined, 'second')).toMatchObject({ context: null, loading: false, error: '' });
});
