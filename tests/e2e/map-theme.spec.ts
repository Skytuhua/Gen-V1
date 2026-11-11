import { test, expect } from '@playwright/test';
import { serveTaskFixture, taskFixture } from './task-interface-fixture';

for (const persisted of [false, true]) test(`map follows the shell until a style is chosen (${persisted ? 'saved' : 'local'})`, async ({ page }) => {
  const snapshot = taskFixture({ root: 'map', elements: { map: { type: 'MapView', props: { dataBinding: 'places', stateKey: 'place', ...(persisted ? { themeStateKey: 'mapTheme' } : {}), label: 'Places' } } } }, { places: { points: [{ id: 'one', label: 'One', x: 20, y: 40 }] } });
  snapshot.settings.theme = 'dark';
  const host = await serveTaskFixture(page, snapshot);
  await page.goto('/');
  const map = page.getByRole('region', { name: 'Places', exact: true });
  await expect(map).toBeVisible({ timeout: 20000 });
  await expect(map).toHaveAttribute('data-map-theme', 'night');
  snapshot.settings.theme = 'light'; await host.publish();
  await expect(map).toHaveAttribute('data-map-theme', 'paper');
  await map.getByRole('button', { name: 'Terrain', exact: true }).click();
  snapshot.settings.theme = 'dark'; await host.publish();
  await expect(map).toHaveAttribute('data-map-theme', 'terrain');
});
