import { expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { DESKTOP_CHANNELS } from '../packages/desktop-contract/index.ts';
import { clampQuickAskHeight, createQuickAskHost, quickAskConfigValid, quickAskContextValid, quickAskOpenTarget, toElectronAccelerator } from '../apps/desktop/quick-ask.ts';
import type { QuickAskContext } from '../packages/desktop-contract/index.ts';

const emptyContext: QuickAskContext = { currentThreadId: null, currentThreadTitle: null, currentThreadSendable: false, currentProjectId: null, currentProjectName: null };
const sendableContext: QuickAskContext = { ...emptyContext, currentThreadId: 't1', currentThreadTitle: 'Work', currentThreadSendable: true };

const fakeWindow = () => {
  let visible = false, destroyed = false, bounds = { x: 0, y: 0, width: 640, height: 72 };
  const window = {
    isDestroyed: () => destroyed, isVisible: () => visible,
    show: () => { visible = true; }, hide: () => { visible = false; }, focus: () => {},
    setBounds: (next: typeof bounds) => { bounds = { ...next }; }, getBounds: () => ({ ...bounds }),
    destroy: () => { destroyed = true; visible = false; },
    webContents: {} as BrowserWindow['webContents'],
  } as unknown as BrowserWindow;
  return { window, bounds: () => bounds };
};

const makeHost = (over: Partial<Parameters<typeof createQuickAskHost>[0]> = {}) => {
  const created: ReturnType<typeof fakeWindow>[] = [], toWindow: unknown[][] = [], toMain: unknown[][] = [];
  const registered = new Map<string, () => void>();
  let focused = false;
  let focusedMain = false;
  const host = createQuickAskHost({
    createWindow: async () => { const fake = fakeWindow(); created.push(fake); return { window: fake.window, webContents: fake.window.webContents }; },
    register: (accel, action) => { registered.set(accel, action); return true; },
    unregister: accel => { registered.delete(accel); },
    cursorArea: () => ({ x: 100, y: 50, width: 1920, height: 1040 }),
    sendToWindow: (channel, value) => { toWindow.push([channel, value]); },
    sendToMain: (channel, value) => { toMain.push([channel, value]); },
    mainFocused: () => focused,
    focusMain: () => { focusedMain = true; },
    ...over,
  });
  return { host, created, toWindow, toMain, registered, focusedMain: () => focusedMain, focus: (value: boolean) => { focused = value; }, fire: async (accel = 'Alt+Space') => { registered.get(accel)!(); await new Promise(resolve => setImmediate(resolve)); } };
};

it('validates quick-ask payloads at the trust boundary', () => {
  expect(quickAskConfigValid({ enabled: true, shortcut: 'Alt+Space' })).toBe(true);
  expect(quickAskConfigValid({ enabled: 'yes', shortcut: 'Alt+Space' })).toBe(false);
  expect(quickAskConfigValid({ enabled: true, shortcut: '' })).toBe(false);
  expect(quickAskConfigValid({ enabled: true, shortcut: 'x'.repeat(81) })).toBe(false);
  expect(quickAskContextValid(sendableContext)).toBe(true);
  expect(quickAskContextValid({ ...emptyContext, extra: true })).toBe(false);
  expect(quickAskContextValid({ ...emptyContext, currentThreadSendable: 'yes' })).toBe(false);
});

it('targets the current thread only when the main window is focused and sendable', () => {
  expect(quickAskOpenTarget(sendableContext, true)).toBe('current');
  expect(quickAskOpenTarget(sendableContext, false)).toBe('new');
  expect(quickAskOpenTarget({ ...sendableContext, currentThreadSendable: false }, true)).toBe('new');
  expect(quickAskOpenTarget(emptyContext, true)).toBe('new');
});

it('maps canonical chords to Electron accelerators and rejects forbidden ones', () => {
  const table: [string, string | null][] = [
    ['Alt+Space', 'Alt+Space'], ['Ctrl+Shift+K', 'CommandOrControl+Shift+K'], ['F9', 'F9'],
    ['Ctrl+Alt+Space', 'CommandOrControl+Alt+Space'], ['Meta+Q', 'Super+Q'], ['Ctrl+F1', 'CommandOrControl+F1'],
    ['Alt+Comma', 'Alt+,'], ['Ctrl+Slash', 'CommandOrControl+/'], ['Ctrl+ArrowUp', 'CommandOrControl+Up'],
    ['Shift+A', null], ['Escape', null], ['Ctrl+Enter', null], ['A', null], ['F25', null], ['Ctrl+Tab', null], ['', null],
  ];
  for (const [chord, accelerator] of table) expect(toElectronAccelerator(chord), chord).toBe(accelerator);
});

it('reports invalid when the chord cannot register globally', () => {
  const { host, toMain, registered } = makeHost();
  expect(host.applyConfig({ enabled: true, shortcut: 'Shift+A' })).toBe('invalid');
  expect(registered.size).toBe(0);
  expect(toMain.at(-1)).toEqual([DESKTOP_CHANNELS.quickAskRegistration, 'invalid']);
  expect(host.applyConfig({ enabled: true, shortcut: 'Alt+Space' })).toBe('ready');
});

it('clamps quick-ask height to the declared range', () => {
  expect(clampQuickAskHeight(72)).toBe(72); expect(clampQuickAskHeight(280)).toBe(280); expect(clampQuickAskHeight(160)).toBe(160);
  for (const value of [71, 281, 1.5, Number.NaN, '90']) expect(() => clampQuickAskHeight(value)).toThrow();
});

it('registers the accelerator, toggles the window and reports registration state', async () => {
  const { host, created, toWindow, toMain, registered, focus, fire } = makeHost();
  expect(host.applyConfig({ enabled: true, shortcut: 'Alt+Space' })).toBe('ready');
  expect(registered.has('Alt+Space')).toBe(true);
  expect(toMain.at(-1)).toEqual([DESKTOP_CHANNELS.quickAskRegistration, 'ready']);
  host.setContext(sendableContext); focus(true);
  await fire();
  expect(created.length).toBe(1);
  expect(created[0].window.isVisible()).toBe(true);
  expect(created[0].bounds()).toEqual({ x: 740, y: 279, width: 640, height: 72 });
  expect(toWindow.at(-1)).toEqual([DESKTOP_CHANNELS.quickAskOpen, { ...sendableContext, target: 'current' }]);
  expect(toMain.at(-1)).toEqual([DESKTOP_CHANNELS.quickAskRegistration, 'in-use']);
  await fire();
  expect(created[0].window.isVisible()).toBe(false);
  expect(toMain.at(-1)).toEqual([DESKTOP_CHANNELS.quickAskRegistration, 'ready']);
});

it('re-registers on config change, reports in-use on failure and releases on off', async () => {
  const { host, registered } = makeHost({ register: vi.fn((accel: string, action: () => void) => { if (accel === 'Alt+Q') return false; return (registered.set(accel, action), true); }) });
  expect(host.applyConfig({ enabled: true, shortcut: 'Alt+Q' })).toBe('in-use');
  expect(host.applyConfig({ enabled: true, shortcut: 'Alt+Space' })).toBe('ready');
  expect(registered.has('Alt+Q')).toBe(false);
  host.applyConfig({ enabled: false, shortcut: 'Alt+Space' });
  expect(host.registration()).toBe('off'); expect(registered.has('Alt+Space')).toBe(false);
});

it('clamps the width on a narrow display', async () => {
  const { host, created, fire } = makeHost({ cursorArea: () => ({ x: 0, y: 0, width: 600, height: 800 }) });
  host.applyConfig({ enabled: true, shortcut: 'Alt+Space' });
  await fire();
  expect(created[0].bounds()).toEqual({ x: 16, y: 176, width: 568, height: 72 });
});

it('forwards sent results to the main window, focuses it and hides', async () => {
  const { host, created, toMain, focusedMain, fire } = makeHost();
  host.applyConfig({ enabled: true, shortcut: 'Alt+Space' });
  await fire();
  host.sent({ threadId: 'thread-9', target: 'new' });
  expect(toMain).toContainEqual([DESKTOP_CHANNELS.quickAskSent, { threadId: 'thread-9', target: 'new' }]);
  expect(focusedMain()).toBe(true);
  expect(created[0].window.isVisible()).toBe(false);
});
