import {test,expect,type Page} from '@playwright/test';
import {fileURLToPath} from 'node:url';

async function openGeometryFixture(page:Page){
 const module='/@fs/'+encodeURI(fileURLToPath(new URL('./native-browser-bounds-fixture.tsx',import.meta.url)).replaceAll('\\','/'));
 await page.route('**/geometry-check',route=>route.fulfill({contentType:'text/html',body:`<html><head><style>body{margin:0}#root{position:absolute;left:100px;top:100px;width:300px;height:200px;display:flex;flex-direction:column}.desktop-browser-native{flex:1;min-height:0}</style></head><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${module}');</script></body></html>`}));
 await page.goto('/geometry-check');await page.waitForFunction(()=>Boolean(window.geometryCalls?.length));
}

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
