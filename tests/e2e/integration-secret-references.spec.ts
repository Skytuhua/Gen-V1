import { expect, test, type Page } from '@playwright/test';
import { serveTaskFixture, taskFixture } from './task-interface-fixture';

const reference = { refId: 'context7.12345678-1234-4234-8234-123456789abc', purpose: 'Context7 documentation', owner: 'personal/context7',
  destination: { kind: 'process-env', executableSha256: 'b'.repeat(64), envName: 'CONTEXT7_API_KEY' }, revoked: false };
const current = () => ({ version: 1, enabled: true, configured: true, references: [structuredClone(reference)] });

async function fixture(page: Page) {
  const snapshot = taskFixture({ root: 'text', elements: { text: { type: 'Text', props: { text: 'Review integration settings.' } } } });
  snapshot.artifacts = [];
  const host = await serveTaskFixture(page, snapshot);
  const integration = { id: 'context7', name: 'Context7', version: '2.0.0', installed: true, enabled: true, state: 'ready',
    capabilities: { skills: [], mcp: true, hooks: [], commands: [] } };
  let metadata: unknown = current(), failure = false, reads = 0;
  const writes: unknown[] = [];
  await page.route('**/api/integrations', route => route.fulfill({ json: { integrations: [integration] } }));
  await page.route('**/api/integrations/secret-references', route => {
    reads++;
    return failure ? route.fulfill({ status: 503, json: { error: { code: 'INTEGRATION_UNAVAILABLE', message: 'Reference metadata is unavailable.' } } })
      : route.fulfill({ json: metadata });
  });
  await page.route('**/api/integrations/context7/commands', route => {
    const value = route.request().postDataJSON(); writes.push(value);
    if (value.type === 'disable') { integration.enabled = false; integration.state = 'disabled'; }
    return route.fulfill({ json: integration });
  });
  return { host, writes, reads: () => reads, set(value: unknown) { metadata = value; }, fail(value: boolean) { failure = value; },
    async open() {
      await page.goto('/');
      const settings = page.getByRole('button', { name: 'Settings', exact: true });
      await expect(settings).toBeAttached();
      const navigation = page.getByRole('button', { name: 'Open navigation', exact: true });
      if (await navigation.isVisible()) await navigation.click();
      await settings.click();
      await expect(page.getByRole('searchbox', { name: 'Search all settings', exact: true })).toBeVisible();
      const section = page.getByRole('combobox', { name: 'Settings section', exact: true });
      if (await section.isVisible()) { await section.click(); await page.getByRole('option', { name: 'Skills & Integrations', exact: true }).click(); }
      else await page.getByRole('button', { name: 'Skills & Integrations', exact: true }).click();
      return page.getByRole('region', { name: 'Secret references', exact: true });
    },
  };
}

test('settings show only the opaque reference and approved destination metadata', async ({ page }) => {
  const f = await fixture(page), region = await f.open();
  await expect(region).toContainText('Context7 documentation');
  await expect(region).toContainText(reference.refId);
  await expect(region).toContainText('CONTEXT7_API_KEY');
  await expect(region).toContainText('b'.repeat(64));
  await expect(region.getByRole('button', { name: /reveal|approve|copy.*secret/i })).toHaveCount(0);
  await expect(region.getByRole('textbox')).toHaveCount(0);
  expect(f.writes).toEqual([]); expect(f.host.commands).toEqual([]);
});

test('disabled reference authority does not misrepresent a configured credential as missing', async ({ page }) => {
  const f = await fixture(page); f.set({ version: 1, enabled: false, configured: true, references: [] });
  const region = await f.open();
  await expect(region).toContainText('Context7 credential is configured');
  await expect(region).toContainText('Secret reference approvals are disabled');
  await expect(region).not.toContainText(reference.refId);
  expect(f.writes).toEqual([]);
});

test('an unconfigured credential is explicit without a secret entry or reveal control', async ({ page }) => {
  const f = await fixture(page); f.set({ version: 1, enabled: true, configured: false, references: [] });
  const region = await f.open();
  await expect(region).toContainText('No Context7 credential is configured');
  await expect(region.getByRole('textbox')).toHaveCount(0);
  expect(f.writes).toEqual([]);
});

test('metadata failure stays unavailable and reload performs only a read', async ({ page }) => {
  const f = await fixture(page); f.fail(true);
  const region = await f.open();
  await expect(region).toContainText('Secret reference metadata is unavailable');
  f.fail(false);
  await region.getByRole('button', { name: 'Reload secret references', exact: true }).click();
  await expect(region).toContainText(reference.refId);
  expect(f.reads()).toBe(2); expect(f.writes).toEqual([]); expect(f.host.commands).toEqual([]);
});

test('unexpected credential material in a response is rejected without rendering it', async ({ page }) => {
  const f = await fixture(page); f.set({ ...current(), credential: 'synthetic-do-not-display-17' });
  const region = await f.open();
  await expect(region).toContainText('Secret reference metadata is unavailable');
  await expect(region).not.toContainText(reference.refId);
  expect(await page.locator('body').innerText()).not.toContain('synthetic-do-not-display-17');
  expect(f.writes).toEqual([]);
});

test('reference and executable identities wrap inside narrow settings', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const f = await fixture(page), region = await f.open();
  await expect(region).toContainText(reference.refId);
  await region.scrollIntoViewIfNeeded();
  expect(await region.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('secret-reference-narrow.png') });
});

test('existing integration enable controls still work independently of metadata', async ({ page }) => {
  const f = await fixture(page); await f.open();
  const toggle = page.getByRole('switch', { name: 'Context7 integration', exact: true });
  await expect(toggle).toBeChecked(); await toggle.click();
  await expect(toggle).not.toBeChecked();
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0]).toMatchObject({ type: 'disable', payload: {} });
});
