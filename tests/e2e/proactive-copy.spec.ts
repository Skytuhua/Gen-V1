import { test, expect, type Page } from '@playwright/test';

const flushFrames = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
import { serveTaskFixture, taskFixture } from './task-interface-fixture';

test('secondary place descriptions stay behind details while selection and useful controls remain available', async ({ page }) => {
  const fixture = taskFixture({ root: 'map', elements: { map: { type: 'MapView', props: { dataBinding: 'places', stateKey: 'place', themeStateKey: 'theme', label: 'Find a quiet café' } } } }, { places: {
    points: [{ id: 'west', label: 'Fern & Fig', x: 20, y: 40, category: 'Café', address: 'West entrance', detail: 'Bright tables · Outlets · Good espresso' }, { id: 'north', label: 'Lumen', x: 60, y: 20 }], source: 'Supplied location notes',
  } });
  await serveTaskFixture(page, fixture); await page.goto('/');
  const selected = page.getByRole('region', { name: 'Selected place', exact: true });
  await expect(selected.getByText('West entrance')).not.toBeVisible();
  await expect(selected.getByText('Bright tables · Outlets · Good espresso')).not.toBeVisible();
  await expect(page.getByText('NORTH WALK', { exact: true })).toHaveCount(0);
  await selected.getByText('Place details', { exact: true }).click();
  await expect(selected.getByText('West entrance')).toBeVisible();
  await page.getByRole('button', { name: 'Night', exact: true }).click();
  await expect(selected.getByText('West entrance')).toBeVisible();
  await page.getByRole('button', { name: 'Next place', exact: true }).click();
  await expect(selected).toContainText('Lumen');
});
test('operation tabs show the task title once and retain relevant table metadata', async ({ page }) => {
  const snapshot=taskFixture({root:'tabs',elements:{tabs:{type:'Tabs',props:{labels:['users'],stateKey:'table',statusBinding:'operation'},children:['rows']},rows:{type:'Text',props:{text:'12 users updated'}}}},{operation:{title:'Task surface',detail:'Local SQLite · 4 tables',status:'success',items:[{label:'users',status:'success'}]}});
  await serveTaskFixture(page,snapshot);await page.goto('/');
  await expect(page.getByText('Local SQLite · 4 tables',{exact:true})).toBeVisible();
  await expect(page.getByText('Task surface',{exact:true})).toHaveCount(1);
});

test('only a newly published live artifact enters; restored history and unchanged snapshots stay steady', async ({ page }) => {
  const snapshot = taskFixture({ root: 'fact', elements: { fact: { type: 'Text', props: { text: 'Three locations fit the route.' } } } });
  const artifact = snapshot.artifacts[0]; snapshot.artifacts = [];
  await page.addInitScript(() => {
    const original = Element.prototype.animate; Object.assign(window, { artifactEntries: 0 });
    Element.prototype.animate = function(...args: Parameters<Element['animate']>) {
      if (this.matches('.artifact')) (window as unknown as {artifactEntries:number}).artifactEntries++;
      return original.apply(this, args);
    };
  });
  const fixture = await serveTaskFixture(page, snapshot); await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
  snapshot.artifacts = [artifact]; await fixture.publish();
  await expect(page.locator('.artifact')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as {artifactEntries:number}).artifactEntries)).toBe(1);
  await fixture.publish(); await flushFrames(page);
  expect(await page.evaluate(() => (window as unknown as {artifactEntries:number}).artifactEntries)).toBe(1);
  await page.reload(); await expect(page.locator('.artifact')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as {artifactEntries:number}).artifactEntries)).toBe(0);
});

test('an accepted source busy label wins over generic submission text while the action request settles', async ({ page }) => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const snapshot = taskFixture({ root: 'action', elements: { action: { type: 'Button', props: { actionId: 'ask', label: 'Resolve conflicts' } } } });
  const fixture = await serveTaskFixture(page, snapshot, async command => { if (command.type === 'action.submit') await gate; });
  await page.goto('/'); await page.getByRole('button', { name: 'Resolve conflicts', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Submitting…', exact: true })).toBeVisible();
  snapshot.artifacts[0].spec!.elements.action.props = { actionId: 'ask', label: 'Resolving…', disabled: true };
  await fixture.publish();
  try { await expect(page.getByRole('button', { name: 'Resolving…', exact: true })).toBeDisabled(); } finally { release(); }
});
