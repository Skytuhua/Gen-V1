import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../packages/storage/store.ts';
import { Service } from '../packages/core/service.ts';
import { buildServer } from '../apps/server/server.ts';
import type { RuntimeAdapter } from '../packages/contracts/index.ts';
import { __setCapabilityFlagForTests, capabilityEnabled } from '../packages/core/capability-flags.ts';
import { getPreferences, mergePreferences } from '../packages/contracts/preferences.ts';
import { SETTINGS_ROWS } from '../apps/web/src/Settings.tsx';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  __setCapabilityFlagForTests('workspace.secretScanV1', undefined);
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

const runtime: RuntimeAdapter = { configure: () => {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'secret-scan-settings-')), store = new Store(dir);
  const service = new Service(store, runtime);
  cleanups.push(async () => { await service.dispose(); store.close(); rmSync(dir, { recursive: true, force: true }); });
  const send = (type: string, payload: Record<string, unknown> = {}, threadId?: string) => service.command({ id: crypto.randomUUID(), type, payload, threadId });
  return { store, service, send };
}

it('defaults secret checks on and stores the preference losslessly', () => {
  expect(getPreferences({}).secretScan).toBe(true);
  expect(mergePreferences(getPreferences({}), { secretScan: false }).secretScan).toBe(false);
  expect(getPreferences({ preferences: { secretScan: false } }).secretScan).toBe(false);
});

it('keeps workspace.secretScanV1 off until explicitly configured', () => {
  expect(capabilityEnabled('workspace.secretScanV1')).toBe(false);
  __setCapabilityFlagForTests('workspace.secretScanV1', true);
  expect(capabilityEnabled('workspace.secretScanV1')).toBe(true);
});

it('registers the setting row for search and inventory', () => {
  const row = SETTINGS_ROWS.find(item => item.id === 'secret-scan');
  expect(row).toMatchObject({ title: 'Check for secrets before commit and push', section: 'diffs' });
});

it('writes a secretScan.disabled audit record only on a real transition off', async () => {
  const x = await fixture();
  const records = () => x.store.all<{ event: string; at: string }>('workspaceSecretScan');
  await x.send('settings.update', { preferences: { chatWidth: 'full' } });
  expect(records()).toEqual([]);
  await x.send('settings.update', { preferences: { secretScan: false } });
  expect(records()).toHaveLength(1);
  expect(records()[0]).toMatchObject({ event: 'secretScan.disabled' });
  // Re-patching the same off value is not a new transition.
  await x.send('settings.update', { preferences: { secretScan: false, chatWidth: 'wide' } });
  expect(records()).toHaveLength(1);
  await x.send('settings.update', { preferences: { secretScan: true } });
  expect(records()).toHaveLength(1);
  await x.send('settings.update', { preferences: { secretScan: false } });
  expect(records()).toHaveLength(2);
});

it('publishes the host flag on /api/shell-settings so the web can hide the row when off', async () => {
  const x = await fixture(), app = await buildServer(x.service, { port: 4317, dev: false });
  cleanups.push(async () => { await app.close(); });
  const bootstrap = await app.inject({ url: '/api/bootstrap', headers: { host: '127.0.0.1:4317' } });
  const headers = { host: '127.0.0.1:4317', cookie: String(bootstrap.headers['set-cookie']).split(';')[0] };
  const read = async () => (await app.inject({ url: '/api/shell-settings', headers })).json() as { flags?: Record<string, boolean> };
  expect((await read()).flags?.['workspace.secretScanV1']).toBe(false);
  __setCapabilityFlagForTests('workspace.secretScanV1', true);
  expect((await read()).flags?.['workspace.secretScanV1']).toBe(true);
});
