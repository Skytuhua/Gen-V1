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
