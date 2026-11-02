import { beforeAll, expect, it, vi } from 'vitest';
import type { DesktopBridge } from '../packages/desktop-contract/index.ts';
import { DESKTOP_CHANNELS } from '../packages/desktop-contract/index.ts';
import { parseDesktopSignInTarget } from '../apps/desktop/auth-launcher.ts';

const ipc = vi.hoisted(() => ({ invoke: vi.fn(async (..._args: unknown[]) => {}), expose: vi.fn(), on: vi.fn(), remove: vi.fn() }));
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: ipc.expose }, ipcRenderer: { invoke: ipc.invoke, on: ipc.on, removeListener: ipc.remove } }));
let bridge: DesktopBridge;
beforeAll(async () => { await import('../apps/desktop/preload.ts'); bridge = ipc.expose.mock.calls[0][1] as DesktopBridge; });
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
