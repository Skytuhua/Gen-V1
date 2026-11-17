import {test,expect,type Page} from '@playwright/test';
import {resolve} from 'node:path';
import {CHAT_LAYOUT_KEY} from '../../packages/ui-shell/chat-layout';

const fixture='/@fs/'+resolve('tests/e2e/chat-view-escape-fixture.tsx').replaceAll('\\','/');
const panel=(page:Page)=>page.getByRole('main',{name:'Chat',exact:true});
async function open(page:Page){
 await page.route('**/chat-view-escape-check',route=>route.fulfill({contentType:'text/html',body:`<html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${encodeURI(fixture)}');</script></body></html>`}));
 await page.goto('/chat-view-escape-check');
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Switch layout',exact:true}).click();
 await page.getByRole('menuitemcheckbox',{name:'Pop-up',exact:true}).click();
 await expect(panel(page)).toHaveAttribute('data-chat-mode','popup');
 await expect.poll(()=>panel(page).evaluate(element=>element.getAnimations().filter(effect=>effect.playState==='running'||effect.playState==='paused').length)).toBe(0);
}
async function drag(page:Page,dx:number,dy:number){
 const box=await page.getByRole('button',{name:'Move chat panel',exact:true}).boundingBox();if(!box)throw Error('Missing chat move handle');
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+dx,box.y+box.height/2+dy,{steps:12});
}
async function bounds(page:Page){const box=await panel(page).boundingBox();if(!box)throw Error('Missing chat');return box;}

test('active drag Escape cancels before an open tooltip and then releases keyboard ownership',async({page})=>{
 await open(page);const before=await bounds(page);
 await drag(page,-64,-32);await expect(panel(page)).toHaveAttribute('data-tracking','true');
 // The real TooltipLayer owns a document capture listener. The active drag
 // must cancel first, then release ownership so the next Escape dismisses it.
 await page.keyboard.press('Tab');const tooltip=page.getByRole('tooltip');await expect(tooltip).toBeVisible();
 await page.keyboard.press('Escape');await expect(panel(page)).toHaveAttribute('data-tracking','false');
 const cancelled=await bounds(page);for(const key of ['x','y','width','height'] as const)expect(cancelled[key]).toBeCloseTo(before[key],0);
 await page.mouse.up();await page.keyboard.press('Escape');await expect(tooltip).not.toBeVisible();
});
for(const composition of [{name:'composition flag',isComposing:true,keyCode:27},{name:'legacy key 229',isComposing:false,keyCode:229}])test(`active drag ignores Escape with IME ${composition.name}`,async({page})=>{
 await open(page);const before=await bounds(page),saved=await page.evaluate(key=>localStorage.getItem(key),CHAT_LAYOUT_KEY);
 await drag(page,-64,-32);await expect(panel(page)).toHaveAttribute('data-tracking','true');
 const prevented=await page.evaluate(flags=>{
  const event=new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true,isComposing:flags.isComposing,keyCode:flags.keyCode});
  document.activeElement!.dispatchEvent(event);return event.defaultPrevented;
 },composition);
 expect(prevented).toBe(false);await expect(panel(page)).toHaveAttribute('data-tracking','true');
 expect((await bounds(page)).x).toBeCloseTo(before.x-64,0);expect(await page.evaluate(key=>localStorage.getItem(key),CHAT_LAYOUT_KEY)).toBe(saved);
 await page.keyboard.press('Escape');await expect(panel(page)).toHaveAttribute('data-tracking','false');await page.mouse.up();
 expect((await bounds(page)).x).toBeCloseTo(before.x,0);
});
