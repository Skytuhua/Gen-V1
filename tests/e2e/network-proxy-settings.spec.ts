import { expect, test, type Page } from '@playwright/test';
import { serveTaskFixture, taskFixture } from './task-interface-fixture';

interface ProxyState { revision: number; url: string | null; bypass: string[]; mandatoryBypass: string[]; hasCredentials: boolean; secretStorageAvailable: boolean }

// #1531 T05 — Settings card: search/focus, save, remove, cancel and conflict recovery.
async function openSettings(page: Page, state: ProxyState, calls: { method: string; body: Record<string, unknown> }[]) {
  const snapshot = taskFixture({ root: 'text', elements: { text: { type: 'Text', props: { text: 'Proxy settings fixture' } } } });
  const host = await serveTaskFixture(page, snapshot);
  await page.route('**/api/network-proxy', async route => {
    const method = route.request().method();
    if (method === 'GET') return route.fulfill({ json: state });
    calls.push({ method, body: route.request().postDataJSON() as Record<string, unknown> });
    if ((route.request().postDataJSON() as { baseRevision?: number }).baseRevision !== state.revision) {
      return route.fulfill({ status: 409, json: { error: { code: 'NETWORK_PROXY_CHANGED', message: 'The proxy settings changed.' } } });
    }
    state.revision++;
    if (method === 'DELETE') Object.assign(state, { url: null, bypass: [], hasCredentials: false });
    else {
      const body = route.request().postDataJSON() as { url: string | null; bypass: string[] };
      const parsed = body.url ? new URL(body.url) : null;
      Object.assign(state, { url: parsed ? `${parsed.protocol}//${parsed.host}` : null, bypass: body.bypass, hasCredentials: Boolean(parsed?.username) });
    }
    await route.fulfill({ json: state });
  });
  await page.route('**/api/environment', route => route.fulfill({ json: { revision: 0, entries: [], secretStorageAvailable: false } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(dialog).toBeVisible();
  return { host, dialog };
}

const pristine = (): ProxyState => ({ revision: 1, url: null, bypass: [], mandatoryBypass: ['localhost', '127.0.0.1'], hasCredentials: false, secretStorageAvailable: true });

test('search finds the card and Save persists a canonical endpoint with bypass', async ({ page }) => {
  const state = pristine(), calls: { method: string; body: Record<string, unknown> }[] = [];
  const { dialog } = await openSettings(page, state, calls);
  await dialog.getByRole('searchbox', { name: 'Search all settings' }).fill('proxy');
  await dialog.getByRole('button', { name: /Network proxy/ }).click();
  const card = dialog.locator('[data-setting-id="network-proxy"]');
  await expect(card.getByText('Not configured')).toBeVisible();
  await card.getByRole('button', { name: 'Configure proxy' }).click();
  await expect(card.getByLabel('Proxy URL')).toBeFocused();
  await card.getByLabel('Proxy URL').fill('https://proxy.example:8443');
  await card.getByLabel('Bypass list').fill('.example.org, build.example.net:443');
  await card.getByLabel('Proxy credentials').fill('corp-user:corp-secret');
  await card.getByRole('button', { name: 'Save proxy' }).click();
  await expect(card.getByText('Proxy saved.')).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(calls[0].method).toBe('PUT');
  expect(calls[0].body).toMatchObject({ baseRevision: 1, url: 'https://corp-user:corp-secret@proxy.example:8443/', bypass: ['.example.org', 'build.example.net:443'] });
  await expect(card.getByText('Authenticated endpoint · 2 bypass entries')).toBeVisible();
  await expect(card.getByText('Local connections always bypass the proxy')).toBeVisible();
});

test('remove asks for in-place confirmation and DELETEs the revision', async ({ page }) => {
  const state: ProxyState = { ...pristine(), url: 'https://proxy.example:8443', hasCredentials: true }, calls: { method: string; body: Record<string, unknown> }[] = [];
  const { dialog } = await openSettings(page, state, calls);
  await dialog.getByRole('button', { name: 'Models & Accounts' }).click();
  const card = dialog.locator('[data-setting-id="network-proxy"]');
  await expect(card.getByText('https://proxy.example:8443')).toBeVisible();
  await card.getByRole('button', { name: 'Remove proxy' }).click();
  await card.getByRole('button', { name: 'Keep proxy' }).click();
  expect(calls).toHaveLength(0);
  await card.getByRole('button', { name: 'Remove proxy' }).click();
  await card.getByRole('button', { name: 'Confirm removal' }).click();
  await expect(card.getByText('Proxy removed.')).toBeVisible();
  expect(calls).toEqual([{ method: 'DELETE', body: { baseRevision: 1 } }]);
  await expect(card.getByText('No proxy configured')).toBeVisible();
});

test('a stale revision conflict refreshes the card and keeps the saved endpoint', async ({ page }) => {
  const state: ProxyState = { ...pristine(), url: 'https://proxy.example:8443' }, calls: { method: string; body: Record<string, unknown> }[] = [];
  const { dialog } = await openSettings(page, state, calls);
  await dialog.getByRole('button', { name: 'Models & Accounts' }).click();
  const card = dialog.locator('[data-setting-id="network-proxy"]');
  state.revision = 7; // someone else saved in between
  await card.getByRole('button', { name: 'Change proxy URL' }).click();
  await card.getByLabel('Proxy URL').fill('http://other.proxy:3128');
  await card.getByRole('button', { name: 'Save proxy' }).click();
  await expect(card.getByRole('alert')).toContainText('changed elsewhere. Review the latest values, then retry your draft.');
  await expect(card.getByLabel('Proxy URL')).toHaveValue('http://other.proxy:3128'); // non-secret draft survives the refresh
  expect(calls).toHaveLength(1);
  // A retry against the fresh revision persists.
  await card.getByRole('button', { name: 'Save proxy' }).click();
  await expect(card.getByText('Proxy saved.')).toBeVisible();
  expect(calls[1].body).toMatchObject({ baseRevision: 7, url: 'http://other.proxy:3128' });
});
