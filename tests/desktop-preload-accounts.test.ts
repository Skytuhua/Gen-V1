import { beforeAll, expect, it, vi } from 'vitest';
import type { DesktopBridge } from '../packages/desktop-contract/index.ts';
import { DESKTOP_CHANNELS } from '../packages/desktop-contract/index.ts';
import { parseDesktopSignInTarget } from '../apps/desktop/auth-launcher.ts';
import { pluginDesktopChannelAllowed } from '../apps/desktop/window-policy.ts';

const ipc = vi.hoisted(() => ({ invoke: vi.fn(async (..._args: unknown[]) => {}), expose: vi.fn(), on: vi.fn(), remove: vi.fn() }));
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: ipc.expose }, ipcRenderer: { invoke: ipc.invoke, on: ipc.on, removeListener: ipc.remove } }));
let bridge: DesktopBridge;
beforeAll(async () => { await import('../apps/desktop/preload.ts'); bridge = ipc.expose.mock.calls[0][1] as DesktopBridge; });
it('recovers active sign-in metadata without payload and denies it to plugin windows', async () => {
  expect(DESKTOP_CHANNELS.activeSignIn).toBe('harness-desktop:active-sign-in');
  await bridge.activeSignIn!();
  expect(ipc.invoke).toHaveBeenLastCalledWith(DESKTOP_CHANNELS.activeSignIn);
  expect(pluginDesktopChannelAllowed(DESKTOP_CHANNELS.activeSignIn)).toBe(false);
});
it('preserves explicit account IDs through the real preload bridge', async () => {
  const accountId = '8933cc31-976d-4f76-a183-035c4b3263e8';
  await bridge.signIn('openai', accountId);
  expect(ipc.invoke).toHaveBeenLastCalledWith(DESKTOP_CHANNELS.signIn, { provider: 'openai', accountId });
  await bridge.signIn('claude-code');
  expect(ipc.invoke).toHaveBeenLastCalledWith(DESKTOP_CHANNELS.signIn, 'claude-code');
});
it.each(['', null])('does not silently reinterpret invalid account %j as legacy authentication', async value => {
  await bridge.signIn('openai', value as never);
  const target = ipc.invoke.mock.calls.at(-1)![1];
  expect(() => parseDesktopSignInTarget(target)).toThrow();
});
it('forwards only serialized project memory through the explicit export channel', async () => {
  expect(bridge.exportProjectMemory).toBeTypeOf('function');
  const serialized = JSON.stringify({redacted: true, scope: {projectId: 'project-a'}});
  await bridge.exportProjectMemory!(serialized);
  expect(ipc.invoke).toHaveBeenLastCalledWith(DESKTOP_CHANNELS.memoryExport, serialized);
});
it('forwards quick-ask config and context through dedicated channels', async () => {
  await bridge.setQuickAskConfig!({ enabled: true, shortcut: 'Alt+Space' });
  expect(ipc.invoke).toHaveBeenLastCalledWith(DESKTOP_CHANNELS.quickAskConfig, { enabled: true, shortcut: 'Alt+Space' });
  const context = { currentThreadId: 't1', currentThreadTitle: 'Title', currentThreadSendable: true, currentProjectId: null, currentProjectName: null };
  await bridge.setQuickAskContext!(context);
  expect(ipc.invoke).toHaveBeenLastCalledWith(DESKTOP_CHANNELS.quickAskContext, context);
  await expect(bridge.setQuickAskConfig!({ enabled: 'yes' } as never)).rejects.toThrow();
  await expect(bridge.setQuickAskContext!({ currentThreadId: 't1' } as never)).rejects.toThrow();
});
it('rejects malformed quick-ask window actions before they reach main', async () => {
  await bridge.quickAskResize!(120);
  expect(ipc.invoke).toHaveBeenLastCalledWith(DESKTOP_CHANNELS.quickAskResize, 120);
  for (const height of [71, 281, 1.5, Number.NaN]) await expect(bridge.quickAskResize!(height)).rejects.toThrow();
  await bridge.quickAskSent!({ threadId: 'thread-1', target: 'current' });
  expect(ipc.invoke).toHaveBeenLastCalledWith(DESKTOP_CHANNELS.quickAskSent, { threadId: 'thread-1', target: 'current' });
  await expect(bridge.quickAskSent!({ threadId: '__proto__', target: 'current' })).rejects.toThrow();
  await expect(bridge.quickAskSent!({ threadId: 'thread-1', target: 'later' } as never)).rejects.toThrow();
  await bridge.quickAskHide!();
  expect(ipc.invoke).toHaveBeenLastCalledWith(DESKTOP_CHANNELS.quickAskHide);
});
it('drops malformed quick-ask open and registration events', () => {
  const opens: unknown[] = [], states: unknown[] = [];
  const offOpen = bridge.onQuickAskOpen!(value => opens.push(value)), offReg = bridge.onQuickAskRegistration!(value => states.push(value));
  const openHandler = ipc.on.mock.calls.find(call => call[0] === DESKTOP_CHANNELS.quickAskOpen)![1] as (event: unknown, value: unknown) => void;
  const regHandler = ipc.on.mock.calls.find(call => call[0] === DESKTOP_CHANNELS.quickAskRegistration)![1] as (event: unknown, value: unknown) => void;
  const open = { target: 'new', currentThreadId: null, currentThreadTitle: null, currentThreadSendable: false, currentProjectId: null, currentProjectName: null };
  openHandler(null, open); openHandler(null, { target: 'elsewhere' }); openHandler(null, null);
  regHandler(null, 'in-use'); regHandler(null, 'enabled'); regHandler(null, {});
  expect(opens).toEqual([open]); expect(states).toEqual(['in-use']);
  offOpen(); offReg();
  expect(ipc.remove).toHaveBeenCalledWith(DESKTOP_CHANNELS.quickAskOpen, openHandler);
  expect(ipc.remove).toHaveBeenCalledWith(DESKTOP_CHANNELS.quickAskRegistration, regHandler);
});
