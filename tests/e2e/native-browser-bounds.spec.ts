import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';

test('fixed CSS browser slots resend after owner zoom changes and remain occluded by dialogs',async({page})=>{
 const module='/@fs/'+encodeURI(fileURLToPath(new URL('./native-browser-bounds-fixture.tsx',import.meta.url)).replaceAll('\\','/'));
 await page.route('**/geometry-check',route=>route.fulfill({contentType:'text/html',body:`<html><head><style>body{margin:0}#root{position:absolute;left:100px;top:100px;width:300px;height:200px;display:flex;flex-direction:column}.desktop-browser-native{flex:1;min-height:0}</style></head><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${module}');</script></body></html>`}));
 await page.goto('/geometry-check');await expect.poll(()=>page.evaluate(()=>window.geometryCalls?.length??0)).toBe(1);
 expect(await page.evaluate(()=>window.geometryCalls.at(-1)?.native)).toEqual({x:100,y:100,width:300,height:200});
 await page.evaluate(()=>{window.geometryZoom=1.25;Object.defineProperty(window,'devicePixelRatio',{configurable:true,value:1.25});window.dispatchEvent(new Event('resize'));});
 await expect.poll(()=>page.evaluate(()=>window.geometryCalls.at(-1)?.native)).toEqual({x:125,y:125,width:375,height:250});
 await page.evaluate(()=>{const dialog=document.createElement('dialog');dialog.id='geometry-modal';document.body.append(dialog);dialog.showModal();});await expect.poll(()=>page.evaluate(()=>window.geometryCalls.at(-1)?.native.width)).toBe(0);
 await page.evaluate(()=>document.getElementById('geometry-modal')!.remove());await expect.poll(()=>page.evaluate(()=>window.geometryCalls.at(-1)?.native)).toEqual({x:125,y:125,width:375,height:250});
});
