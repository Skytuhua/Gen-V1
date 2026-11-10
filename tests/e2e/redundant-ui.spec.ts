import {expect,test} from '@playwright/test';

test.beforeEach(async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('harness:summary:usage:v1',JSON.stringify({collapsed:false})));
 await page.addInitScript(()=>{const requests:unknown[]=[];Object.defineProperty(window,'wo5Requests',{value:requests});window.addEventListener('redundant-request',event=>requests.push((event as CustomEvent).detail));});
 await page.route('**/api/**',route=>route.abort('blockedbyclient'));
});
for(const width of [1440,1024,768])test(`reduced UI keeps its destinations at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:1000});await page.goto('/redundant-ui');
 await expect(page.getByRole('button',{name:'work/layout',exact:true})).toBeVisible();
 await expect(page.locator('.project-context-card').getByRole('button',{name:/^Changes/})).toHaveCount(0);
 await expect(page.locator('.floating-usage-details dl')).toHaveCount(0);
 const changes=page.getByRole('button',{name:'Inspect changes',exact:true});await changes.focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('region',{name:'Tool destination'})).toContainText('new live value');
 await expect(page.getByRole('region',{name:'Tool destination'})).toContainText('+4 −2');
 expect(await page.evaluate(()=>(window as unknown as {wo5Requests:unknown[]}).wo5Requests)).toContainEqual({path:'/api/projects/project-one/git',threadId:'thread-a',method:'GET'});
 const open=page.getByRole('button',{name:'Open Usage',exact:true});await open.focus();await page.keyboard.press('Enter');
 const dialog=page.getByRole('dialog',{name:'Usage',exact:true});await expect(dialog).toContainText('Audit the workspace');await expect(dialog).not.toContainText('Another owner');
 await expect(dialog).toContainText('0.012345');
 if(process.env.WO5_SCREENSHOTS)await page.screenshot({path:`${process.env.WO5_SCREENSHOTS}/6-usage-${width}.png`,fullPage:true});
 await dialog.getByRole('tab',{name:'Tokens',exact:true}).click();await expect(dialog).toContainText('18,321');await expect(dialog).toContainText('791');
 await dialog.getByRole('tab',{name:'Limits',exact:true}).click();await expect(dialog).toContainText('23.456%');await expect(dialog).toContainText('67.89%');
 await page.keyboard.press('Escape');await expect(open).toBeFocused();
 await page.getByRole('button',{name:'Usage panel',exact:true}).click();await expect(page.locator('.usage-context')).toContainText('18%');
 await page.getByRole('button',{name:'Recorded changes',exact:true}).click();await expect(page.getByRole('region',{name:'Tool destination'})).toContainText('new recorded value');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await expect(page.getByRole('textbox',{name:'Prompt',exact:true})).toHaveValue('Keep my composer draft');
});
for(const mode of ['custom','scoped','detached'])test(`retains the overview route for unproven ${mode} owners`,async({page})=>{
 await page.goto('/redundant-ui?mode='+mode);
 const overview=page.locator('.project-context-card').getByRole('button',{name:/^Changes/});await expect(overview).toBeVisible();await overview.focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('region',{name:'Tool destination'})).toContainText('new live value');
 await expect(page.getByRole('button',{name:'Inspect changes',exact:true})).toHaveCount(0);
 if(mode==='detached'){
  await expect(page.locator('.floating-usage-details')).toContainText('18,321');await expect(page.locator('.floating-usage-details')).toContainText('67.89%');
  await expect(page.getByRole('button',{name:'Open Usage',exact:true})).toHaveCount(0);
 }
});
test('a proven custom owner can use the equivalent composer action',async({page})=>{
 await page.goto('/redundant-ui?mode=custom-proven');await expect(page.getByRole('button',{name:'work/layout',exact:true})).toBeVisible();
 await expect(page.locator('.project-context-card').getByRole('button',{name:/^Changes/})).toHaveCount(0);
 await page.getByRole('button',{name:'Inspect changes',exact:true}).click();await expect(page.locator('.live-diff')).toContainText('new live value');
});
test('ownerless usage retains details rather than assuming a destination',async({page})=>{
 await page.goto('/redundant-ui?mode=ownerless');await expect(page.locator('.floating-usage-details dl')).toContainText('Input tokens');
});
test('Notes preserves its unsaved draft through navigation and reload',async({page})=>{
 await page.goto('/redundant-ui');await page.getByRole('button',{name:'Notes',exact:true}).click();
 const editor=page.getByRole('textbox',{name:'Note decision',exact:true});await expect(editor).toBeEnabled();await editor.fill('Keep this unsaved owner A note.');
 await page.getByRole('button',{name:'Usage panel',exact:true}).click();
 await page.getByRole('button',{name:'Notes',exact:true}).click();await expect(editor).toHaveValue('Keep this unsaved owner A note.');
 await page.reload();await page.getByRole('button',{name:'Notes',exact:true}).click();await expect(editor).toHaveValue('Keep this unsaved owner A note.');
 await expect(page.getByRole('region',{name:'Thread memory',exact:true})).toHaveCount(1);
});
test('retained destinations surface actual loading/error/empty boundaries',async({page})=>{
 await page.goto('/redundant-ui?state=loading');await expect(page.locator('.project-context-card')).toContainText('Reading project');
 await page.evaluate(()=>window.dispatchEvent(new Event('redundant-release')));await expect(page.getByRole('button',{name:'work/layout',exact:true})).toBeVisible();
 await page.goto('/redundant-ui?state=error');await expect(page.locator('.project-context-card').getByRole('alert')).toContainText('could not load');
 await page.goto('/redundant-ui?state=empty');await expect(page.locator('.project-context-card')).toContainText('No project connected.');
 await page.goto('/redundant-ui?state=usage-loading');await page.getByRole('button',{name:'Open Usage',exact:true}).click();await expect(page.getByRole('dialog').getByRole('status')).toContainText('Refreshing usage');
 await page.goto('/redundant-ui?state=usage-error');await page.getByRole('button',{name:'Open Usage',exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Usage refresh failed');
});
for(const motion of ['reduced','off'])test(`light/zoom keyboard destinations respect ${motion} motion`,async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/redundant-ui');
 await page.evaluate(motion=>{document.documentElement.dataset.theme='light';document.documentElement.dataset.motion=motion;document.documentElement.style.zoom='1.25';},motion);
 const opener=page.getByRole('button',{name:'Open Usage',exact:true});await opener.focus();
 expect(await opener.evaluate(el=>getComputedStyle(el).outlineStyle)).not.toBe('none');await page.keyboard.press('Enter');await expect(page.getByRole('dialog',{name:'Usage',exact:true})).toBeVisible();
 await page.keyboard.press('Escape');await expect(opener).toBeFocused();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
