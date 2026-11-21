import { expect, test, type Page } from '@playwright/test';
import { serveTaskFixture, taskFixture } from './task-interface-fixture';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

test('audit UI-003 and UI-005 separate readiness and offer safe missing-integration recovery',async({page})=>{
 const f=await fixture(page);let reads=0,installed=false;
 const raw="ENOENT: no such file or directory, lstat 'C:/fixture/private/integrations/graphify'";
 await page.route('**/api/integrations',route=>{reads++;return route.fulfill({json:{integrations:[
  {id:'graphify',name:'Graphify',version:'1.0',installed,enabled:true,state:installed?'ready':'missing',error:installed?undefined:raw,capabilities:{skills:['graph'],commands:[],hooks:[],mcp:false}},
  {id:'context7',name:'Context7',version:'2.0',installed:true,enabled:true,state:'ready',capabilities:{skills:[],commands:[],hooks:[],mcp:true}},
 ]}});});
 await f.open();const row=page.locator('.integration-settings .settings-row').filter({has:page.getByRole('heading',{name:/Graphify/})});await expect(row).toBeVisible();
 const directory=process.env.AUDIT_CAPTURE_DIR,phase=process.env.AUDIT_CAPTURE_PHASE??'after';
 if(directory){await mkdir(directory,{recursive:true});for(const finding of ['ui-003','ui-005'])await page.screenshot({path:resolve(directory,`${finding}-${phase}.png`)});}
 await expect(row).toContainText("Graphify isn't installed in this environment");await expect(row.getByText(raw,{exact:true})).toBeHidden();
 const heading=row.getByRole('heading');expect(await heading.evaluate(node=>getComputedStyle(node).columnGap)).not.toBe('normal');
 await row.getByText('Technical details',{exact:true}).click();await expect(row.getByText(raw,{exact:true})).toBeVisible();
 if(directory)await page.screenshot({path:resolve(directory,`ui-003-${phase}-details.png`)});
 const previous=reads;installed=true;await row.getByRole('button',{name:'Recheck Graphify',exact:true}).click();
 await expect(row.locator('.availability')).toHaveText('ready');expect(reads).toBeGreaterThan(previous);expect(f.writes).toEqual([]);
});

test('integration inventory errors disclose diagnostics and read-only recheck recovers',async({page})=>{
 const f=await fixture(page);let unavailable=true;
 const raw="ENOENT C:/fixture/private/inventory";
 await page.route('**/api/integrations',route=>unavailable?route.fulfill({status:503,json:{error:{code:'UNAVAILABLE',message:raw}}}):route.fulfill({json:{integrations:[]}}));
 await f.open();const inventory=page.locator('.integration-settings');
 await expect(inventory.getByRole('status')).toContainText('Integrations could not be checked or updated');await expect(inventory.getByText(raw,{exact:true})).toBeHidden();
 unavailable=false;await inventory.getByRole('button',{name:'Recheck integrations',exact:true}).click();
 await expect(inventory.getByRole('status')).toHaveCount(0);await expect(inventory.locator('.settings-row')).toHaveCount(0);expect(f.writes).toEqual([]);
});

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
      await expect(settings).toBeAttached({timeout:15000});
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
