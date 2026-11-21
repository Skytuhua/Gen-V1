import {test,expect,type Page} from '@playwright/test';
import {fileURLToPath} from 'node:url';

async function openGeometryFixture(page:Page,options:{presets?:boolean;width?:number;height?:number}={}){
 const {presets=false,width=300,height=200}=options;
 const module='/@fs/'+encodeURI(fileURLToPath(new URL('./native-browser-bounds-fixture.tsx',import.meta.url)).replaceAll('\\','/'));
 const geometry=`#root{position:absolute;left:100px;top:100px;width:${width}px;height:${height}px;display:flex;flex-direction:column}.desktop-browser-slot{display:flex;flex-direction:column;flex:1;min-height:0;position:relative}.desktop-browser-native{flex:1;min-height:0}`+(presets?`.desktop-browser-dock{display:flex;flex-direction:column;height:100%;flex:1 1 auto;min-width:0;border-left:0;container-type:inline-size}@container (max-width:400px){.desktop-browser-toolbar strong{clip:rect(0 0 0 0);clip-path:inset(50%)}}`:'');
 await page.route('**/geometry-check**',route=>route.fulfill({contentType:'text/html',body:`<html><head><style>body{margin:0}${geometry}</style></head><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${module}');</script></body></html>`}));
 await page.goto(presets?'/geometry-check?presets=1':'/geometry-check');await page.waitForFunction(()=>Boolean(window.geometryCalls?.length));
}
const presetCalls=(page:Page,preset?:unknown)=>page.evaluate(preset=>window.geometryCalls.filter(call=>call.preset===preset),preset);
const waitForPresetSend=(page:Page,preset:unknown)=>expect.poll(async()=>(await presetCalls(page,preset)).at(-1)?.result,{timeout:8000}).toBeTruthy();

test('fixed CSS browser slots resend after owner zoom changes and remain occluded by dialogs',async({page})=>{
 await openGeometryFixture(page);await expect.poll(()=>page.evaluate(()=>window.geometryCalls?.length??0)).toBe(1);
 expect(await page.evaluate(()=>window.geometryCalls.at(-1)?.native)).toEqual({x:100,y:100,width:300,height:200});
 await page.evaluate(()=>{window.geometryZoom=1.25;Object.defineProperty(window,'devicePixelRatio',{configurable:true,value:1.25});window.dispatchEvent(new Event('resize'));});
 await expect.poll(()=>page.evaluate(()=>window.geometryCalls.at(-1)?.native)).toEqual({x:125,y:125,width:375,height:250});
 await page.evaluate(()=>{const dialog=document.createElement('dialog');dialog.id='geometry-modal';document.body.append(dialog);dialog.showModal();});await expect.poll(()=>page.evaluate(()=>window.geometryCalls.at(-1)?.native.width)).toBe(0);
 await page.evaluate(()=>document.getElementById('geometry-modal')!.remove());await expect.poll(()=>page.evaluate(()=>window.geometryCalls.at(-1)?.native)).toEqual({x:125,y:125,width:375,height:250});
});

for(const kind of ['menu','select'] as const)test(`shared ${kind} popup hides the native browser until dismissal`,async({page})=>{
 await openGeometryFixture(page);
 const before=await page.evaluate(()=>window.geometryCalls.at(-1)!.native);
 const trigger=kind==='menu'?page.getByRole('button',{name:'Browser tools',exact:true}):page.getByRole('combobox',{name:'Browser view',exact:true});
 const popup=page.getByRole(kind==='menu'?'menu':'listbox');
 await trigger.click();await expect(popup).toBeVisible();
 // Controls sit outside the browser: popup ownership must work beyond point-hit sampling.
 const slot=await page.locator('.desktop-browser-native').boundingBox(),popupBounds=await popup.boundingBox();
 expect(popupBounds!.x).toBeGreaterThanOrEqual(slot!.x+slot!.width);
 await expect.poll(()=>page.evaluate(()=>window.geometryCalls.at(-1)!.native)).toEqual({x:0,y:0,width:0,height:0});
 await page.keyboard.press('Escape');await expect(popup).toHaveCount(0);await expect(trigger).toBeFocused();
 await expect.poll(()=>page.evaluate(()=>window.geometryCalls.at(-1)!.native)).toEqual(before);
});

test('docked width presets center native bounds and report actual width',async({page},testInfo)=>{
 await openGeometryFixture(page,{presets:true,width:820,height:500});
 await waitForPresetSend(page,'fit');
 await expect(page.locator('.desktop-browser-readout')).toHaveText(/Fit · \d+ px actual/);
 for(const preset of [390,768] as const){
  await page.locator(`[data-preset="${preset}"]`).click();
  await expect.poll(async()=>{const call=await presetCalls(page,preset);return call.at(-1)?.result?.effective;},{timeout:8000}).toBe(preset);
  const call=(await presetCalls(page,preset)).at(-1)!;
  const left=call.bounds.x,span=call.bounds.width;
  expect(call.native.width).toBe(preset);expect(call.native.height).toBe(call.bounds.height);
  expect(call.native.x).toBe(left+Math.floor((span-preset)/2));expect(call.native.y).toBe(call.bounds.y);
  expect(call.native.x).toBeGreaterThanOrEqual(left);expect(call.native.x+call.native.width).toBeLessThanOrEqual(left+span);
  await expect(page.locator('.desktop-browser-readout')).toHaveText(`${preset} px actual`);
  await page.screenshot({path:testInfo.outputPath(`preset-${preset}-light.png`)});
 }
 await page.emulateMedia({colorScheme:'dark'});
 await page.locator('[data-preset="fit"]').click();
 await expect(page.locator('.desktop-browser-readout')).toHaveText(/Fit · \d+ px actual/);
 await page.screenshot({path:testInfo.outputPath('preset-fit-dark.png')});
});

test('unavailable widths explain why and shrink falls back to Fit once',async({page},testInfo)=>{
 await openGeometryFixture(page,{presets:true,width:520,height:420});
 await waitForPresetSend(page,'fit');
 const button768=page.locator('[data-preset="768"]');
 await expect(button768).toBeDisabled();
 await expect(page.locator('.desktop-browser-reasons')).toContainText('768 px needs 768 px; available 520 px');
 await page.locator('[data-preset="390"]').click();
 await expect.poll(async()=>{const call=await presetCalls(page,390);return call.at(-1)?.result?.effective;},{timeout:8000}).toBe(390);
 await page.evaluate(()=>{document.getElementById('root')!.style.width='250px';});
 await expect(page.locator('.desktop-browser-notice')).toHaveText('390 px no longer fits. Switched to Fit.',{timeout:8000});
 await expect(page.locator('[data-preset="fit"]')).toHaveAttribute('aria-pressed','true');
 await expect.poll(async()=>{const calls=await presetCalls(page,390);return calls.at(-1)?.result?.fallback;},{timeout:8000}).toBe('insufficient-space');
 await page.screenshot({path:testInfo.outputPath('preset-fallback-notice.png')});
 await page.evaluate(()=>{document.getElementById('root')!.style.width='520px';});
 await expect(page.locator('[data-preset="390"]')).toBeEnabled();
 await expect(page.locator('[data-preset="fit"]')).toHaveAttribute('aria-pressed','true');
});

test('preview selection survives navigation and occlusion but resets for a new browser',async({page})=>{
 await openGeometryFixture(page,{presets:true,width:820,height:500});
 await waitForPresetSend(page,'fit');
 await page.locator('[data-preset="390"]').click();
 await expect.poll(async()=>{const call=await presetCalls(page,390);return call.at(-1)?.result?.effective;},{timeout:8000}).toBe(390);
 await page.getByRole('button',{name:'Reload browser'}).click();
 await page.evaluate(()=>{const dialog=document.createElement('dialog');dialog.id='preset-modal';document.body.append(dialog);dialog.showModal();});
 await expect.poll(()=>page.evaluate(()=>window.geometryCalls.at(-1)?.native),{timeout:8000}).toEqual({x:0,y:0,width:0,height:0});
 await page.evaluate(()=>document.getElementById('preset-modal')!.remove());
 await expect.poll(async()=>{const call=await presetCalls(page,390);return call.at(-1)?.native.width;},{timeout:8000}).toBe(390);
 await expect(page.locator('[data-preset="390"]')).toHaveAttribute('aria-pressed','true');
 await page.evaluate(()=>window.geometryBrowser('browser-2'));
 await expect(page.locator('[data-preset="fit"]')).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('.desktop-browser-readout')).not.toHaveText('390 px actual');
});

test('latest preview request wins and failures expose retry',async({page})=>{
 await openGeometryFixture(page,{presets:true,width:820,height:500});
 await waitForPresetSend(page,'fit');
 await page.evaluate(()=>{window.previewDelayMs=250;});
 await page.locator('[data-preset="390"]').click();
 await page.evaluate(()=>{window.previewDelayMs=0;});
 await page.locator('[data-preset="768"]').click();
 await expect.poll(async()=>(await presetCalls(page,390)).length+(await presetCalls(page,768)).length,{timeout:8000}).toBeGreaterThanOrEqual(2);
 await expect(page.locator('.desktop-browser-readout')).toHaveText('768 px actual');
 await page.evaluate(()=>{window.previewFail=true;});
 await page.locator('[data-preset="768"]').click();
 await expect(page.locator('.desktop-browser-notice')).toHaveText('Preview size could not be updated.',{timeout:8000});
 await page.evaluate(()=>{window.previewFail=false;});
 await page.locator('[data-preset="768"]').click();
 await expect(page.locator('.desktop-browser-readout')).toHaveText('768 px actual',{timeout:8000});
});

test('width controls remain keyboard accessible in narrow and reduced-motion layouts',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await openGeometryFixture(page,{presets:true,width:380,height:420});
 await waitForPresetSend(page,'fit');
 await expect(page.locator('[data-preset="390"]')).toBeDisabled();
 await expect(page.locator('[data-preset="768"]')).toBeDisabled();
 await expect(page.locator('.desktop-browser-reasons')).toContainText('390 px needs 390 px; available 380 px');
 expect(await page.locator('.desktop-browser-toolbar strong').evaluate(element=>getComputedStyle(element).clip)).not.toBe('auto');
 const fit=page.locator('[data-preset="fit"]');
 await fit.press('Enter');
 await expect(fit).toBeFocused();
 await expect(fit).toHaveAttribute('aria-pressed','true');
});
