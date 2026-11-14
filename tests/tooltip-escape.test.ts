import { afterEach, expect, it, vi } from 'vitest';

const setup = vi.hoisted(() => ({ effects: [] as (() => void | (() => void))[] }));
vi.mock('react', () => ({
  useEffect: (effect: () => void | (() => void)) => setup.effects.push(effect),
  useLayoutEffect: vi.fn(),
  useRef: (current: unknown) => ({ current }),
  useState: (value: unknown) => [value, vi.fn()],
}));

import { TooltipLayer } from '../packages/ui-shell/Tooltip';

class Anchor {
  isConnected = true;
  textContent = 'Save';
  private attributes = new Map([['title', 'Save the current draft']]);
  closest() { return this; }
  hasAttribute(key: string) { return this.attributes.has(key); }
  getAttribute(key: string) { return this.attributes.get(key) ?? null; }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  setup.effects.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mount() {
  vi.useFakeTimers();
  const listeners = new Map<string, (value: unknown) => void>();
  vi.stubGlobal('Element', Anchor);
  vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('document', {
    documentElement: {},
    addEventListener: (name: string, fn: (event: unknown) => void) => listeners.set(name, fn),
    removeEventListener() {},
  });
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '350' }));
  TooltipLayer();
  const cleanup = setup.effects[0]();
  if (cleanup) cleanups.push(cleanup);
  listeners.get('pointerover')!({ pointerType: 'mouse', target: new Anchor() });
  return (input: { isComposing?: boolean; keyCode?: number } = {}) => {
    const event = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn(), ...input };
    listeners.get('keydown')!(event);
    return event;
  };
}

it('does not capture Escape while the tooltip is only waiting to open', () => {
  const escape = mount();
  expect(escape().stopPropagation).not.toHaveBeenCalled();
});

it.each([{ isComposing: true }, { keyCode: 229 }])('leaves IME Escape alone: %j', input => {
  const escape = mount();
  vi.advanceTimersByTime(350);
  expect(escape(input).stopPropagation).not.toHaveBeenCalled();
  expect(escape().stopPropagation).toHaveBeenCalledOnce();
});
