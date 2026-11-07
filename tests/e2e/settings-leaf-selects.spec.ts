import {expect, test, type Page} from '@playwright/test';
import {resolve} from 'node:path';
import type {EnvironmentMetadata} from '../../packages/core/environment-settings';
import type {IntegrationStatus} from '../../packages/contracts/integrations';

async function setup(page: Page, {installed = true, secretStorageAvailable = true} = {}) {
  const unexpected: string[] = [], errors: string[] = [];
  const writes: {method: string; path: string; body: Record<string, unknown>; csrf: string | undefined}[] = [];
  const metadata: EnvironmentMetadata = {revision: 7, appliesTo: 'new-project-terminals', secretStorageAvailable, entries: [{scope: 'device', name: 'SYNTHETIC_STORED_KEY', secret: true, configured: true, updatedAt: '2026-11-07T00:00:00.000Z'}]};
  const ponytail: IntegrationStatus = {id: 'ponytail', name: 'Ponytail', version: 'synthetic', installed, enabled: true, state: installed ? 'ready' : 'missing', mode: 'full', capabilities: {skills: [], commands: [], hooks: [], mcp: false}};
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:5794') {unexpected.push(request.url()); return route.abort();}
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (request.method() !== 'GET') writes.push({method: request.method(), path: url.pathname, body: request.postDataJSON(), csrf: request.headers()['x-harness-csrf']});
    if (url.pathname === '/api/bootstrap') return route.fulfill({json: {csrfToken: 'synthetic-settings-csrf'}});
    if (url.pathname === '/api/workspace') return route.fulfill({json: {projects: [
      {id: 'synthetic-alpha', name: 'Synthetic project Alpha', authority: {kind: 'local'}, rootPath: 'C:/synthetic/alpha', createdAt: '2026-11-07T00:00:00.000Z'},
      {id: 'synthetic-rootless', name: 'Synthetic rootless project', authority: {kind: 'local'}, createdAt: '2026-11-07T00:00:00.000Z'},
      {id: 'synthetic-plugin', name: 'Synthetic plugin project', authority: {kind: 'plugin', pluginId: 'synthetic-plugin'}, rootPath: 'C:/synthetic/plugin', createdAt: '2026-11-07T00:00:00.000Z'},
    ]}});
    if (url.pathname === '/api/environment' && request.method() === 'GET') return route.fulfill({json: metadata});
    if (url.pathname === '/api/environment' && request.method() === 'PUT') return route.fulfill({json: {...metadata, revision: 8}});
    if (url.pathname === '/api/integrations') return route.fulfill({json: {integrations: [ponytail]}});
    if (url.pathname === '/api/integrations/ponytail/commands') {
      ponytail.mode = (request.postDataJSON().payload as {mode: IntegrationStatus['mode']}).mode;
      return route.fulfill({json: {}});
    }
    unexpected.push(`${request.method()} ${url.pathname}`);
    return route.fulfill({status: 500, json: {error: {message: 'Unexpected synthetic fixture request'}}});
  });
  const fixture = '/@fs/' + resolve('tests/e2e/settings-leaf-selects-fixture.tsx').replaceAll('\\', '/');
  await page.route('**/settings-leaf-selects-fixture', route => route.fulfill({contentType: 'text/html', body: `<html data-theme="dark"><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${encodeURI(fixture)}');</script></body></html>`}));
  await page.goto('/settings-leaf-selects-fixture');
  const scope = page.getByRole('combobox', {name: 'Applies to', exact: true}), mode = page.getByRole('combobox', {name: 'Ponytail mode', exact: true});
  await expect(scope).toBeVisible(); await expect(mode).toBeVisible();
  return {scope, mode, writes, unexpected, errors, metadata};
}

test('scope keyboard listbox selection clears only the entered synthetic value', async ({page}, info) => {
  const host = await setup(page);
  const name = page.getByLabel('Variable name', {exact: true}), value = page.getByLabel('Secret value', {exact: true});
  await name.fill('synthetic_next_key'); await value.fill('synthetic-entered-value');
  await expect(value).toHaveAttribute('type', 'password');
  await host.scope.focus(); await host.scope.press('ArrowDown');
  const list = page.getByRole('listbox', {name: 'Applies to', exact: true});
  await expect(list).toBeVisible();
  await expect(list.getByRole('option')).toHaveText(['This device', 'Synthetic project Alpha']);
  await expect(list.getByRole('option', {name: 'This device', exact: true})).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(host.scope).toContainText('Synthetic project Alpha'); await expect(host.scope).toBeFocused();
  await expect(list).toHaveCount(0); await expect(value).toHaveValue('');
  await expect(name).toHaveValue('SYNTHETIC_NEXT_KEY');
  await expect(page.getByLabel('Store as a protected secret', {exact: true})).toBeChecked();
  await expect(page.getByLabel('Synthetic neighboring draft', {exact: true})).toHaveValue('Keep the neighboring draft');
  await expect(page.getByText('SYNTHETIC_STORED_KEY', {exact: true})).toBeVisible();
  expect(host.metadata.entries).toHaveLength(1); expect(host.writes).toEqual([]);
  await value.fill('synthetic-project-value'); await host.scope.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(value).toHaveValue('synthetic-project-value');
  await host.scope.press('ArrowDown'); await page.keyboard.press('Home'); await page.keyboard.press('Enter');
  await expect(host.scope).toContainText('This device'); await expect(value).toHaveValue('');
  await page.screenshot({path: info.outputPath('01-synthetic-scope.png')});
  expect(host.unexpected).toEqual([]); expect(host.errors).toEqual([]);
});

test('Ponytail keyboard listbox selections send exact configure commands for each mode', async ({page}, info) => {
  const host = await setup(page);
  for (const [key, mode, label] of [['End', 'ultra', 'Ultra'], ['Home', 'off', 'Off'], ['l', 'lite', 'Lite'], ['f', 'full', 'Full']]) {
    await host.mode.focus(); await host.mode.press('ArrowDown');
    const list = page.getByRole('listbox', {name: 'Ponytail mode', exact: true}); await expect(list).toBeVisible();
    await expect(list.getByRole('option')).toHaveText(['Off', 'Lite', 'Full', 'Ultra']);
    await page.keyboard.press(key); await page.keyboard.press('Enter');
    await expect(host.mode).toBeEnabled(); await expect(host.mode).toContainText(label);
    expect(host.writes.at(-1)).toEqual({method: 'POST', path: '/api/integrations/ponytail/commands', csrf: 'synthetic-settings-csrf', body: {id: expect.stringMatching(/^[0-9a-f-]{36}$/), type: 'configure', payload: {mode}}});
  }
  expect(host.writes.map(write => write.body.payload)).toEqual([{mode: 'ultra'}, {mode: 'off'}, {mode: 'lite'}, {mode: 'full'}]);
  await host.mode.press('ArrowDown'); await page.keyboard.press('Escape'); await expect(host.mode).toBeFocused();
  expect(host.writes).toHaveLength(4);
  await page.screenshot({path: info.outputPath('02-synthetic-ponytail.png')});
  expect(host.unexpected).toEqual([]); expect(host.errors).toEqual([]);
});

test('busy environment scope stays disabled and preserves the pending exact save', async ({page}) => {
  const host = await setup(page); let release!: () => void;
  const held = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/api/environment', async route => {if (route.request().method() === 'PUT') await held; await route.fallback();});
  await page.getByLabel('Variable name', {exact: true}).fill('SYNTHETIC_NEXT_KEY');
  const value = page.getByLabel('Secret value', {exact: true}); await value.fill('synthetic-pending-value');
  try {
    await page.getByRole('button', {name: 'Save variable', exact: true}).click();
    await expect(host.scope).toBeDisabled(); await expect(value).toBeDisabled();
    await host.scope.click({force: true}); await host.scope.dispatchEvent('keydown', {key: 'ArrowDown'});
    await expect(page.getByRole('listbox', {name: 'Applies to', exact: true})).toHaveCount(0);
    await expect(value).toHaveValue('synthetic-pending-value');
  } finally {release();}
  await expect(host.scope).toBeEnabled(); await expect(value).toHaveValue('');
  expect(host.writes).toEqual([{method: 'PUT', path: '/api/environment', csrf: 'synthetic-settings-csrf', body: {scope: 'device', name: 'SYNTHETIC_NEXT_KEY', value: 'synthetic-pending-value', secret: true, baseRevision: 7}}]);
  expect(host.unexpected).toEqual([]); expect(host.errors).toEqual([]);
});

test('busy Ponytail mode blocks further selection until accepted metadata reloads', async ({page}) => {
  const host = await setup(page); let release!: () => void;
  const held = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/api/integrations/ponytail/commands', async route => {await held; await route.fallback();});
  try {
    await host.mode.press('ArrowDown'); await expect(page.getByRole('listbox', {name: 'Ponytail mode', exact: true})).toBeVisible();
    await page.keyboard.press('End'); await page.keyboard.press('Enter');
    await expect(host.mode).toBeDisabled(); await expect(page.getByRole('switch', {name: 'Ponytail integration', exact: true})).toBeDisabled();
    await host.mode.click({force: true}); await host.mode.dispatchEvent('keydown', {key: 'ArrowDown'});
    await expect(page.getByRole('listbox', {name: 'Ponytail mode', exact: true})).toHaveCount(0);
  } finally {release();}
  await expect(host.mode).toBeEnabled(); await expect(host.mode).toContainText('Ultra');
  expect(host.writes).toHaveLength(1); expect(host.writes[0].body).toEqual({id: expect.any(String), type: 'configure', payload: {mode: 'ultra'}});
  expect(host.unexpected).toEqual([]); expect(host.errors).toEqual([]);
});

test('unavailable Ponytail and protected storage keep their existing disabled guards', async ({page}) => {
  const host = await setup(page, {installed: false, secretStorageAvailable: false});
  await expect(host.mode).toBeDisabled();
  await expect(page.getByRole('switch', {name: 'Ponytail integration', exact: true})).toBeDisabled();
  await host.mode.click({force: true}); await host.mode.dispatchEvent('keydown', {key: 'ArrowDown'});
  await expect(page.getByRole('listbox', {name: 'Ponytail mode', exact: true})).toHaveCount(0);
  await page.getByLabel('Variable name', {exact: true}).fill('SYNTHETIC_UNSAVED_KEY');
  await page.getByLabel('Secret value', {exact: true}).fill('synthetic-unsaved-value');
  await expect(page.getByRole('button', {name: 'Save variable', exact: true})).toBeDisabled();
  expect(host.writes).toEqual([]); expect(host.unexpected).toEqual([]); expect(host.errors).toEqual([]);
});
