import { afterEach, expect, it, vi } from 'vitest';

const setup = vi.hoisted(() => ({ effects: [] as (() => void | (() => void))[], setters: [] as ReturnType<typeof vi.fn>[] }));
vi.mock('react', () => ({
  useEffect: (effect: () => void | (() => void)) => setup.effects.push(effect),
  useLayoutEffect: vi.fn(),
  useRef: (current: unknown) => ({ current }),
  useState: (value: unknown) => { const setter = vi.fn(); setup.setters.push(setter); return [value, setter]; },
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
  setup.setters.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mount() {
  vi.useFakeTimers();
  const listeners = new Map<string, (value: unknown) => void>();
  let mutation!: (records: unknown[]) => void;
  vi.stubGlobal('Element', Anchor);
  vi.stubGlobal('MutationObserver', class {
    constructor(callback: (records: unknown[]) => void) { mutation = callback; }
    observe() {} disconnect() {}
  });
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
  const target = new Anchor();
  listeners.get('pointerover')!({ pointerType: 'mouse', target });
  const escape = (input: { isComposing?: boolean; keyCode?: number } = {}) => {
    const event = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn(), ...input };
    listeners.get('keydown')!(event);
    return event;
  };
  return { escape, updateTitle(title: string) {
    target.setAttribute('title', title);
    mutation([{ type: 'attributes', attributeName: 'title', target }]);
    return target;
  } };
}

it('does not capture Escape while the tooltip is only waiting to open', () => {
  const {escape} = mount();
  expect(escape().stopPropagation).not.toHaveBeenCalled();
});

it.each([{ isComposing: true }, { keyCode: 229 }])('leaves IME Escape alone: %j', input => {
  const {escape} = mount();
  vi.advanceTimersByTime(350);
  expect(escape(input).stopPropagation).not.toHaveBeenCalled();
  expect(escape().stopPropagation).toHaveBeenCalledOnce();
});

it('refreshes the already visible tooltip and accessible description when its title changes', () => {
  const {updateTitle} = mount();
  vi.advanceTimersByTime(350);
  const setShown = setup.setters[0];
  expect(setShown).toHaveBeenLastCalledWith(expect.objectContaining({text:'Save the current draft'}));
  const target = updateTitle('A newer draft is available');
  expect(target.getAttribute('aria-description')).toBe('A newer draft is available');
  expect(target.getAttribute('title')).toBe('');
  expect(setShown).toHaveBeenLastCalledWith(expect.objectContaining({text:'A newer draft is available',target,leaving:false}));
});

it('reads the newest tooltip title at the end of the existing hover delay', () => {
  const {updateTitle} = mount();
  setup.setters[0].mockClear();
  vi.advanceTimersByTime(300);
  updateTitle('Saving finished');
  const setShown = setup.setters[0];
  expect(setShown).not.toHaveBeenCalled();
  vi.advanceTimersByTime(50);
  expect(setShown).toHaveBeenLastCalledWith(expect.objectContaining({text:'Saving finished',leaving:false}));
});
