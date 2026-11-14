import type { ReactElement } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  index: 0, slots: [] as unknown[], effects: [] as (() => void)[], notify: vi.fn(),
}));
vi.mock('react', () => {
  function effect(fn: () => void | (() => void), deps: unknown[]) {
    const i = state.index++, previous = state.slots[i] as { deps: unknown[]; cleanup?: () => void } | undefined;
    if (previous && deps.every((value, j) => Object.is(value, previous.deps[j]))) return;
    state.effects.push(() => { previous?.cleanup?.(); state.slots[i] = { deps, cleanup: fn() }; });
  }
  return {
    useState(initial: unknown) {
      const i = state.index++;
      if (!(i in state.slots)) state.slots[i] = initial;
      return [state.slots[i], (next: unknown) => { state.slots[i] = next; }];
    },
    useRef(current: unknown) { const i = state.index++; return state.slots[i] ??= { current }; },
    useEffect: effect,
    useLayoutEffect: effect,
  };
});
vi.mock('../packages/ui-shell/Toast', () => ({ toast: state.notify }));
import { CopyButton } from '../apps/web/src/CopyButton';

function render(text: string) {
  state.index = 0;
  const root = CopyButton({ text, label: 'Copy message' }) as ReactElement<Record<string, unknown>>;
  state.effects.splice(0).forEach(run => run());
  const children = (Array.isArray(root.props.children) ? root.props.children : []) as ReactElement<Record<string, unknown>>[];
  const button = root.type === 'button' ? root : children.find(node => node.type === 'button')!;
  const status = children.find(node => node.props.role === 'status');
  return { button, status };
}
afterEach(() => { state.slots = []; state.effects = []; state.notify.mockReset(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('keeps the button name stable and announces successful copy without moving focus', async () => {
  vi.useFakeTimers();
  const write = vi.fn(async () => {});
  vi.stubGlobal('navigator', { clipboard: { writeText: write } });
  (render('alpha').button.props.onClick as () => void)();
  await Promise.resolve();
  const copied = render('alpha');
  expect(write).toHaveBeenCalledWith('alpha');
  expect(copied.button.props['aria-label']).toBe('Copy message');
  expect(copied.status?.props.children).toBe('Copied');
});

it('does not show success for the new text after an old clipboard write settles', async () => {
  vi.useFakeTimers();
  let done!: () => void;
  vi.stubGlobal('navigator', { clipboard: { writeText: () => new Promise<void>(resolve => { done = resolve; }) } });
  (render('alpha').button.props.onClick as () => void)();
  render('beta');
  done();
  await Promise.resolve();
  expect(render('beta').button.props.title).toBe('Copy message');
});
