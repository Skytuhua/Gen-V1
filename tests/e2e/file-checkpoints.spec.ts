import {expect,test} from '@playwright/test';

test.beforeEach(async({page})=>{await page.route('**/api/**',route=>route.abort('blockedbyclient'));});
for(const width of [1440,1024,768])test(`History and existing diff review fit ${width}`,async({page})=>{
 await page.setViewportSize({width,height:1000});await page.goto('/file-checkpoints');
 await expect(page.getByRole('heading',{name:'File checkpoints',exact:true})).toBeVisible();
 await expect(page.locator('time').first()).toHaveAttribute('datetime','2026-11-10T18:42:00Z');
 await expect(page.getByText('src/workspace-layout.test.ts',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Review Before updating workspace layout',exact:true}).click();
 await expect(page.getByRole('button',{name:'Back to History'})).toBeFocused();
 await expect(page.locator('.workspace-diff-pair').first()).toContainText('const panelWidth = 360;');
 await expect(page.locator('.workspace-diff-pair').first()).toContainText('const panelWidth = 420;');
 await expect(page.getByRole('button',{name:'Restore selected files'})).toBeDisabled();
 if(process.env.WO5_SCREENSHOTS)await page.screenshot({path:`${process.env.WO5_SCREENSHOTS}/5-review-${width}.png`,fullPage:true});
 await page.getByRole('button',{name:'Back to History'}).press('Enter');
 await expect(page.getByRole('button',{name:'Review Before updating workspace layout',exact:true})).toBeFocused();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('Current and Recorded remain separate, keyboard reachable sources',async({page})=>{
 await page.goto('/file-checkpoints');const history=page.getByRole('tab',{name:'History',exact:true});await history.focus();
 await history.press('Home');await expect(page.getByRole('tab',{name:'Current',exact:true})).toBeFocused();
 await expect(page.getByText('Live working-copy changes',{exact:true})).toBeVisible();
 await page.keyboard.press('ArrowRight');await expect(page.getByText('Synthetic recorded executor comparison',{exact:true})).toBeVisible();
 await page.getByRole('tab',{name:'Recorded',exact:true}).dispatchEvent('keydown',{key:'ArrowRight',isComposing:true});
 await expect(page.getByRole('tab',{name:'Recorded',exact:true})).toHaveAttribute('aria-selected','true');
 await page.keyboard.press('End');await expect(history).toBeFocused();
 expect(await history.evaluate(el=>getComputedStyle(el).outlineStyle)).not.toBe('none');
});
test('empty, failed/retry, denied and unavailable are honest read states',async({page})=>{
 await page.goto('/file-checkpoints?state=empty');await expect(page.getByText('No file checkpoints available.',{exact:true})).toBeVisible();
 await page.goto('/file-checkpoints?state=error');await expect(page.getByRole('alert')).toContainText('could not be read');
 await page.getByRole('button',{name:'Retry',exact:true}).click();await expect(page.getByRole('button',{name:'Review Before updating workspace layout',exact:true})).toBeVisible();
 await page.goto('/file-checkpoints?state=denied');await expect(page.getByRole('alert')).toContainText('denied');
 await page.goto('/file-checkpoints?state=unavailable');await expect(page.getByRole('alert')).toContainText('No checkpoint service is connected');
 await expect(page.getByRole('button',{name:/Restore/})).toHaveCount(0);
});
test('held responses are cancelled on owner changes and cannot paint stale history',async({page})=>{
 await page.goto('/file-checkpoints?state=race');await expect(page.getByRole('status')).toContainText('Loading checkpoints');
 await page.getByRole('button',{name:'Switch owner'}).click();await expect(page.getByText('No file checkpoints available.',{exact:true})).toBeVisible();
 await page.evaluate(()=>window.dispatchEvent(new Event('checkpoint-release')));
 await expect(page.getByRole('button',{name:/Review Before/})).toHaveCount(0);
});
test('review holds, rejects foreign/expired revisions, and never invokes writes',async({page})=>{
 const requests:string[]=[];page.on('request',request=>{if(request.method()!=='GET')requests.push(request.url());});
 for(const [state,message] of [['foreign','revision changed'],['expired','review expired'],['conflict','working copy changed']]){
  await page.goto('/file-checkpoints?state='+state);await page.getByRole('button',{name:'Review Before updating workspace layout',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText(message);await expect(page.getByRole('button',{name:'Restore selected files'})).toHaveCount(0);
 }
 await page.goto('/file-checkpoints?state=review-loading');await page.getByRole('button',{name:'Review Before updating workspace layout',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('Loading checkpoint review');await page.getByRole('button',{name:'Back to History'}).click();
 await page.evaluate(()=>window.dispatchEvent(new Event('checkpoint-release')));await expect(page.getByRole('region',{name:'Checkpoint review'})).toHaveCount(0);
 expect(requests).toEqual([]);
});
test('binary, missing and renamed files retain provenance',async({page})=>{
 for(const state of ['binary','missing','rename']){
  await page.goto('/file-checkpoints?state='+state);await page.getByRole('button',{name:'Review Before updating workspace layout',exact:true}).click();
  await expect(page.getByRole('region',{name:'Checkpoint review'})).toContainText(state==='rename'?'Renamed from src/old-name.ts':state);
  await expect(page.getByRole('button',{name:'Restore selected files'})).toBeDisabled();
 }
});
test('stress names, light theme and 150% zoom preserve actions and immediate motion',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:1024,height:1000});await page.goto('/file-checkpoints?state=stress');
 await page.evaluate(()=>{document.documentElement.dataset.theme='light';document.documentElement.dataset.motion='off';document.documentElement.style.zoom='1.5';});
 const button=page.getByRole('button',{name:/Review Before updating/});await expect(button).toBeVisible();await button.focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('button',{name:'Back to History'})).toBeFocused();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(await page.locator('.file-checkpoints').evaluate(el=>el.getAnimations({subtree:true}).length)).toBe(0);
});
