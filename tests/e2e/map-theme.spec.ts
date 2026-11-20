import { test, expect } from '@playwright/test';
import { serveTaskFixture, taskFixture, type TaskSpec } from './task-interface-fixture';

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

test('a carousel that mounts when map data arrives begins observing viewport size',async({page})=>{
 const snapshot=taskFixture({root:'map',elements:{map:{type:'MapView',props:{dataBinding:'places',stateKey:'place',label:'Places'}}}},{places:null});
 const host=await serveTaskFixture(page,snapshot);
 await page.addInitScript(()=>{
  const Base=window.ResizeObserver;
  Object.assign(window,{observedPlaceCarousels:new WeakSet<Element>()});
  window.ResizeObserver=class extends Base{override observe(target:Element,options?:ResizeObserverOptions){
   if(target.classList.contains('task-map-carousel'))(window as unknown as {observedPlaceCarousels:WeakSet<Element>}).observedPlaceCarousels.add(target);
   super.observe(target,options);
  }};
 });
 await page.route('**/api/workspace',route=>route.fulfill({json:{projects:[],state:{version:1,revision:0,activeCanvasId:'workspace',canvases:[{id:'workspace',version:1,name:'Workspace',preset:'workspace',panels:[],viewport:{x:0,y:0,zoom:1},filter:'all',projectIds:[]}],profiles:[],disabledKinds:[],integrations:{}}}}));
 await page.goto('/');await expect(page.getByText('Map points are unavailable from the connected source.')).toBeVisible({timeout:20000});
 host.setInput('places',{points:[{id:'one',label:'One',x:20,y:40},{id:'two',label:'Two',x:55,y:40}]});await host.publish();
 const carousel=page.getByLabel('Place carousel',{exact:true});await expect(carousel).toBeVisible();
 expect(await carousel.evaluate(node=>(window as unknown as {observedPlaceCarousels:WeakSet<Element>}).observedPlaceCarousels.has(node))).toBe(true);
});

const walkPoints = [
  { id: 'fern', label: 'Fern & Fig', x: 12, y: 30, category: 'Cafe', address: '12 Alder Lane', detail: 'Window seats and a short counter.' },
  { id: 'press', label: 'Press House', x: 38, y: 62, category: 'Shop' },
  { id: 'bridge', label: 'Bridge Steps', x: 63, y: 22 },
  { id: 'stair', label: 'Old Stair Garden', x: 88, y: 55, category: 'Garden' },
];
const walkData = { points: walkPoints, routes: [{ id: 'walk', pointIds: ['fern', 'press', 'bridge'], label: 'Walking loop' }], source: 'Neighborhood survey' };
const mapSpec = { root: 'map', elements: { map: { type: 'MapView', props: { dataBinding: 'places', stateKey: 'place', label: 'Places' } } } } as unknown as TaskSpec;
const scrollProbe = `(() => { const scroll = Element.prototype.scrollTo; window.mapScrollCalls = []; Element.prototype.scrollTo = function(...args) { if (this.classList.contains('task-map-carousel')) window.mapScrollCalls.push(args[0]); return scroll.apply(this, args); }; })()`;

test('pins, navigator buttons and keyboard land without sweeping intermediate cards', async ({ page }) => {
  const snapshot = taskFixture(mapSpec, { places: walkData }, { place: 'fern' });
  const host = await serveTaskFixture(page, snapshot);
  await page.addInitScript(scrollProbe);
  await page.goto('/');
  const carousel = page.getByLabel('Place carousel', { exact: true });
  await expect(page.getByRole('region', { name: 'Selected place', exact: true })).toContainText('Fern & Fig');
  const scrollCalls = () => page.evaluate(() => (window as unknown as { mapScrollCalls: { behavior?: string; left?: number }[] }).mapScrollCalls);
  const alignedAt = async (pointIndex: number) => {
    const width = await carousel.evaluate(node => node.clientWidth);
    expect(width).toBeGreaterThan(0);
    await expect.poll(async () => Math.abs(await carousel.evaluate(node => node.scrollLeft) - pointIndex * width), { timeout: 4_000 }).toBeLessThanOrEqual(1);
  };
  // Farthest pin commits instantly — no smooth travel across cards 1 and 2.
  await page.getByRole('button', { name: 'Select Old Stair Garden', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Selected place', exact: true })).toContainText('Old Stair Garden');
  await alignedAt(3);
  expect((await scrollCalls()).every(call => call.behavior !== 'smooth')).toBe(true);
  // Pointer Next glides one adjacent card.
  await page.getByRole('button', { name: 'Next place', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Selected place', exact: true })).toContainText('Fern & Fig');
  await alignedAt(0);
  // Wraparound committed instantly even though the route wrapped last to first.
  expect((await scrollCalls()).some(call => call.behavior !== 'smooth')).toBe(true);
  await page.getByRole('button', { name: 'Next place', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Selected place', exact: true })).toContainText('Press House');
  await alignedAt(1);
  // Keyboard activation on Previous lands instantly on the adjacent card.
  await page.getByRole('button', { name: 'Previous place', exact: true }).press('Enter');
  await expect(page.getByRole('region', { name: 'Selected place', exact: true })).toContainText('Fern & Fig');
  await alignedAt(0);
  // Home/End on the focused carousel jump instantly and do not scroll the page.
  await carousel.focus(); await carousel.press('End');
  await expect(page.getByRole('region', { name: 'Selected place', exact: true })).toContainText('Old Stair Garden');
  await alignedAt(3);
  await carousel.press('Home');
  await expect(page.getByRole('region', { name: 'Selected place', exact: true })).toContainText('Fern & Fig');
  await alignedAt(0);
  // A resize realigns without requesting smooth scrolling.
  const before = (await scrollCalls()).length;
  await page.setViewportSize({ width: 500, height: 700 });
  await alignedAt(0);
  expect((await scrollCalls()).slice(before).every(call => call.behavior !== 'smooth')).toBe(true);
  void host;
});

test('the shared row stays put when details expand and only new route pairs reveal', async ({ page }) => {
  const snapshot = taskFixture(mapSpec, { places: walkData }, { place: 'fern' });
  const host = await serveTaskFixture(page, snapshot);
  await page.goto('/');
  const meta = page.locator('.task-map-meta');
  await expect(meta).toContainText('Cafe'); await expect(meta).toContainText('1 / 4');
  const navBox = async () => (await page.getByRole('button', { name: 'Next place', exact: true }).boundingBox())!;
  const before = await navBox();
  await page.getByRole('region', { name: 'Selected place', exact: true }).getByText('Place details', { exact: true }).click();
  const after = await navBox();
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1); expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
  const accents = () => page.locator('.task-map-route-accent').count();
  // Identical republishes and a theme change draw no route accents.
  for (let i = 0; i < 3; i += 1) { await host.publish(); }
  await page.getByRole('button', { name: 'Night', exact: true }).click();
  await expect.poll(accents).toBe(0);
  // One appended adjacent pair gets one transient accent; removed points fall back.
  host.setInput('places', { ...walkData, routes: [{ id: 'walk', pointIds: ['fern', 'press', 'bridge', 'stair'] }] }); await host.publish();
  await expect.poll(accents).toBe(1); await expect.poll(accents, { timeout: 4_000 }).toBe(0);
  host.setInput('places', { ...walkData, points: walkPoints.filter(point => point.id !== 'fern'), routes: [{ id: 'walk', pointIds: ['press', 'bridge'] }] }); await host.publish();
  await expect(page.getByRole('region', { name: 'Selected place', exact: true })).toContainText('Press House');
  await expect(meta).toContainText('1 / 3');
  // Under reduced motion an appended pair commits with no accent at all.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  host.setInput('places', { ...walkData, points: walkPoints.filter(point => point.id !== 'fern'), routes: [{ id: 'walk', pointIds: ['press', 'bridge', 'stair'] }] }); await host.publish();
  await expect.poll(accents).toBe(0);
});

test('a single point disables navigation and empty sources keep the unavailable copy', async ({ page }) => {
  const snapshot = taskFixture(mapSpec, { places: { points: [walkPoints[0]] } });
  const host = await serveTaskFixture(page, snapshot);
  await page.goto('/');
  await expect(page.locator('.task-map-meta')).toContainText('1 / 1');
  await expect(page.getByRole('button', { name: 'Previous place', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Next place', exact: true })).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Selected place', exact: true })).toContainText('Fern & Fig');
  host.setInput('places', null); await host.publish();
  await expect(page.getByText('Map points are unavailable from the connected source.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous place', exact: true })).toHaveCount(0);
});
