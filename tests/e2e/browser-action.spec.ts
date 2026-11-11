import {test,expect,type Page} from '@playwright/test';

async function open(page:Page,mode='docked'){
 await page.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:5812'?route.continue():route.abort());
 await page.goto(`/tests/e2e/fixtures/browser-action.html?mode=${mode}`);
 await expect(page.getByRole('textbox',{name:'Browser address'})).toBeVisible();
 if(mode!=='no-host')await page.waitForFunction(()=>window.browserActionFixture.subscribed);
}
async function count(page:Page,total:number){await expect.poll(()=>page.evaluate(()=>window.browserActionFixture.actions.length)).toBe(total);}
async function paint(page:Page){await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));}
async function failReload(page:Page){await page.getByRole('button',{name:'Reload browser',exact:true}).click();await count(page,1);await page.evaluate(()=>window.browserActionFixture.finish(0,'error'));await expect(page.getByRole('alert')).toHaveText('Synthetic bridge rejection');}

for(const mode of ['docked','detached'])test.describe(mode,()=>{
 test('successful Reload retry clears the action error without replacing page state or address edits',async({page})=>{
  await open(page,mode);await failReload(page);
  await page.getByRole('textbox',{name:'Browser address'}).fill('https://draft.example/kept');
  await page.evaluate(()=>window.browserActionFixture.page({title:'Updated reading title',error:undefined}));
  await expect(page.getByRole('alert')).toHaveText('Synthetic bridge rejection');
  const before=await page.evaluate(()=>window.browserActionFixture.state);
  await page.getByRole('button',{name:'Reload browser',exact:true}).click();await count(page,2);
  await expect(page.getByRole('alert')).toHaveText('Synthetic bridge rejection');
  await page.evaluate(()=>window.browserActionFixture.finish(1,'success'));
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.desktop-browser-toolbar header')).toHaveText(mode==='detached'?'Updated reading titleReturn to workspace':'Updated reading title');
  await expect(page.getByRole('textbox',{name:'Browser address'})).toHaveValue('https://draft.example/kept');
  expect(await page.evaluate(()=>window.browserActionFixture.state)).toEqual(before);
  expect(await page.evaluate(()=>window.browserActionFixture.actions.map(action=>action.command))).toEqual([{type:'reload'},{type:'reload'}]);
 });

 test('keyboard navigation recovers after rejection and follows the trusted page URL',async({page})=>{
  await open(page,mode);await failReload(page);
  const address=page.getByRole('textbox',{name:'Browser address'});
  await address.fill('https://reading.example/two');await address.press('Enter');await count(page,2);
  expect(await page.evaluate(()=>window.browserActionFixture.actions[1].command)).toEqual({type:'navigate',url:'https://reading.example/two'});
  await page.evaluate(()=>{window.browserActionFixture.page({url:'https://reading.example/redirected',title:'Redirected reading page'});window.browserActionFixture.finish(1,'success');});
  await expect(page.getByRole('alert')).toHaveCount(0);await expect(address).toHaveValue('https://reading.example/redirected');await expect(address).toBeFocused();
 });

 test('an obsolete rejection cannot restore an error after newer navigation succeeds',async({page})=>{
  await open(page,mode);await page.getByRole('button',{name:'Reload browser',exact:true}).click();await count(page,1);
  await page.getByRole('textbox',{name:'Browser address'}).fill('https://reading.example/two');await page.getByRole('button',{name:'Go',exact:true}).click();await count(page,2);
  await page.evaluate(()=>window.browserActionFixture.finish(1,'success'));
  await page.evaluate(()=>window.browserActionFixture.finish(0,'error','Obsolete reload rejection'));
  await paint(page);
  await expect(page.getByRole('alert')).toHaveCount(0);
 });

 test('an older success cannot hide the newest action rejection',async({page})=>{
  await open(page,mode);const reload=page.getByRole('button',{name:'Reload browser',exact:true});
  await reload.click();await reload.click();await count(page,2);
  await page.evaluate(()=>window.browserActionFixture.finish(1,'error','Newest reload rejection'));
  await expect(page.getByRole('alert')).toHaveText('Newest reload rejection');
  await page.evaluate(()=>window.browserActionFixture.finish(0,'success'));
  await paint(page);
  await expect(page.getByRole('alert')).toHaveText('Newest reload rejection');
 });

 test('an obsolete rejection stays silent while the latest action is pending',async({page})=>{
  await open(page,mode);const reload=page.getByRole('button',{name:'Reload browser',exact:true});
  await reload.click();await reload.click();await count(page,2);
  await page.evaluate(()=>window.browserActionFixture.finish(0,'error','Obsolete pending rejection'));
  await paint(page);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.evaluate(()=>window.browserActionFixture.finish(1,'error','Current pending rejection'));
  await expect(page.getByRole('alert')).toHaveText('Current pending rejection');
 });

 test('successful action recovery preserves the native page error until a trusted state update clears it',async({page})=>{
  await open(page,mode);await failReload(page);
  await page.evaluate(()=>window.browserActionFixture.page({error:'Synthetic native page failure'}));
  await expect(page.getByRole('alert')).toHaveText('Synthetic bridge rejection');
  await page.getByRole('button',{name:'Reload browser',exact:true}).click();await count(page,2);
  await page.evaluate(()=>window.browserActionFixture.finish(1,'success'));
  await expect(page.getByRole('alert')).toHaveText('Synthetic native page failure');
  await page.evaluate(()=>window.browserActionFixture.page({error:undefined}));
  await expect(page.getByRole('alert')).toHaveCount(0);
 });

 test('a failed retry retains the new action error including non-Error rejection fallback',async({page})=>{
  await open(page,mode);await failReload(page);
  await page.getByRole('button',{name:'Reload browser',exact:true}).click();await count(page,2);
  await page.evaluate(()=>window.browserActionFixture.finish(1,'value','Synthetic non-Error rejection'));
  await expect(page.getByRole('alert')).toHaveText('Browser action failed.');
 });

 for(const action of [{name:'Browser back',type:'back'},{name:'Browser forward',type:'forward'},{name:'Stop browser loading',type:'stop'}])test(`successful ${action.type} clears the local error using current native control state`,async({page})=>{
  await open(page,mode);await expect(page.getByRole('button',{name:'Browser back',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Browser forward',exact:true})).toBeDisabled();await failReload(page);
  await page.evaluate(()=>window.browserActionFixture.page({canGoBack:true,canGoForward:true,loading:true}));
  await page.getByRole('button',{name:action.name,exact:true}).click();await count(page,2);
  expect(await page.evaluate(()=>window.browserActionFixture.actions[1].command)).toEqual({type:action.type});
  await page.evaluate(()=>window.browserActionFixture.finish(1,'success'));
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Stop browser loading',exact:true})).toBeVisible();
 });
});

test('narrow toolbar recovers with keyboard Retry and Go without moving focus',async({page})=>{
 await page.setViewportSize({width:360,height:440});await open(page);await failReload(page);
 const reload=page.getByRole('button',{name:'Reload browser',exact:true});await reload.focus();await page.keyboard.press('Enter');await count(page,2);await page.evaluate(()=>window.browserActionFixture.finish(1,'success'));
 await expect(page.getByRole('alert')).toHaveCount(0);await expect(reload).toBeFocused();
 const address=page.getByRole('textbox',{name:'Browser address'});await page.keyboard.press('Tab');await expect(address).toBeFocused();await address.fill('https://reading.example/narrow');await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'Go',exact:true})).toBeFocused();await page.keyboard.press('Enter');await count(page,3);await page.evaluate(()=>window.browserActionFixture.finish(2,'success'));
 await expect(page.getByRole('alert')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('without a native host the toolbar does not invent browser calls or content',async({page})=>{
 await open(page,'no-host');const address=page.getByRole('textbox',{name:'Browser address'});
 await address.fill('https://reading.example/unhosted');await address.press('Enter');await page.getByRole('button',{name:'Reload browser',exact:true}).click();
 await expect(address).toHaveValue('https://reading.example/unhosted');await expect(page.getByRole('alert')).toHaveCount(0);await expect(page.getByRole('region',{name:'Docked browser'})).toHaveCount(0);await expect(page.locator('iframe,webview')).toHaveCount(0);
 expect(await page.evaluate(()=>({actions:window.browserActionFixture.actions.length,native:typeof window.harnessDesktop}))).toEqual({actions:0,native:'undefined'});
});
