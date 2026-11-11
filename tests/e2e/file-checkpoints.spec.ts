import {expect,test} from '@playwright/test';

test.beforeEach(async({page})=>{await page.addInitScript(()=>{const calls:unknown[]=[];Object.defineProperty(window,'checkpointCalls',{value:calls});window.addEventListener('checkpoint-call',event=>calls.push((event as CustomEvent).detail));});await page.route('**/api/**',route=>route.abort('blockedbyclient'));});
for(const width of [1440,1024,768])test(`History and existing diff review fit ${width}`,async({page},testInfo)=>{
 await page.setViewportSize({width,height:1000});await page.goto('/file-checkpoints');
 await expect(page.getByRole('heading',{name:'File checkpoints',exact:true})).toBeVisible();
 await expect(page.locator('time').first()).toHaveAttribute('datetime','2026-11-10T18:42:00Z');
 await expect(page.getByRole('tabpanel')).toContainText('2 files');
 await page.screenshot({path:testInfo.outputPath(`5-after-${width}.png`),fullPage:true});
 await page.getByRole('button',{name:'Review Before updating workspace layout',exact:true}).click();
 await expect(page.getByRole('button',{name:'Back to History'})).toBeFocused();
 await expect(page.locator('.unified-diff').first()).toContainText('const panelWidth = 360;');
 await expect(page.locator('.unified-diff').first()).toContainText('const panelWidth = 420;');
 await expect(page.getByRole('button',{name:'Restore selected files'})).toBeDisabled();
 await page.screenshot({path:testInfo.outputPath(`5-review-${width}.png`),fullPage:true});
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
  await expect(page.getByRole('region',{name:'Checkpoint review'})).toContainText(state==='rename'?'unsupported':state);
  await expect(page.getByRole('region',{name:'Checkpoint review'})).not.toContainText('No recorded diffs');
  await expect(page.getByRole('button',{name:'Restore selected files'})).toBeDisabled();
 }
});
test('stress names, light theme and 150% zoom preserve actions and immediate motion',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:1024,height:1000});await page.goto('/file-checkpoints?state=stress');
 await page.evaluate(()=>{document.documentElement.dataset.theme='light';document.documentElement.dataset.motion='off';document.documentElement.style.zoom='1.5';});
 const button=page.getByRole('button',{name:/Review Before updating/});await expect(button).toBeVisible();await button.focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('button',{name:'Back to History'})).toBeFocused();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('.file-checkpoints h3').first().evaluate(el=>{const color=getComputedStyle(el).color;el.animate([{color},{color}],{duration:0.01,iterations:Infinity});});
 const motion=await page.locator('.file-checkpoints').evaluate(el=>{
  const metadata=new Set(['offset','computedOffset','easing','composite']);
  const effects=el.getAnimations({subtree:true}).map(animation=>({duration:Number(animation.effect!.getComputedTiming().duration),properties:animation.effect instanceof KeyframeEffect?animation.effect.getKeyframes().flatMap(frame=>Object.keys(frame).filter(key=>!metadata.has(key))):[]}));
  const durations=[el,...el.querySelectorAll('*')].flatMap(element=>{const style=getComputedStyle(element);return [style.transitionDuration,style.animationDuration].flatMap(value=>value.split(',').map(time=>parseFloat(time)*(time.trim().endsWith('ms')?1:1000)));});
  return {reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,durations,effects};
 });
 expect(motion.reduced).toBe(true);expect(Math.max(...motion.durations)).toBeLessThanOrEqual(0.01);
 for(const effect of motion.effects){expect(effect.duration).toBeLessThanOrEqual(0.01);expect(effect.properties.every(property=>['color','backgroundColor','scrollbarColor','opacity'].includes(property))).toBe(true);}
});

test('frozen detail supplies all 100 paths before review, without summary paths',async({page})=>{
 await page.goto('/file-checkpoints?state=full-100');
 await page.getByRole('button',{name:'Review Before updating workspace layout',exact:true}).click({timeout:2000});
 await expect(page.getByRole('region',{name:'Checkpoint review'}).locator('.workspace-diff')).toHaveCount(100);
 const calls=await page.evaluate(()=>(window as unknown as {checkpointCalls:{kind:string;paths?:string[]}[]}).checkpointCalls);
 expect(calls.map(call=>call.kind)).toEqual(['list','detail','review']);
 expect(calls[2].paths).toHaveLength(100);expect(calls[2].paths?.at(-1)).toBe('src/file-99.ts');
 await expect(page.getByRole('button',{name:'Restore selected files'})).toBeDisabled();
});
test('leading-space paths reach the review adapter unchanged',async({page})=>{
 await page.goto('/file-checkpoints?state=leading-space');await page.getByRole('button',{name:'Review Before updating workspace layout',exact:true}).click();
 await expect(page.getByRole('region',{name:'Checkpoint review'}).locator('.workspace-diff')).toHaveCount(2);
 expect(await page.getByRole('region',{name:'Checkpoint review'}).locator('.workspace-diff summary').first().textContent()).toBe(' src/a');
 expect(await page.getByRole('region',{name:'Checkpoint review'}).locator('.workspace-diff summary').first().evaluate(el=>getComputedStyle(el).whiteSpace)).toBe('break-spaces');
 const calls=await page.evaluate(()=>(window as unknown as {checkpointCalls:{kind:string;paths?:string[]}[]}).checkpointCalls);
 expect(calls.find(call=>call.kind==='review')?.paths).toEqual([' src/a','src/a']);
});
test('incomplete detail or review is explicit and cannot masquerade as a full comparison',async({page})=>{
 for(const state of ['partial-detail','partial-review','empty-review']){
  await page.goto('/file-checkpoints?state='+state);await page.getByRole('button',{name:'Review Before updating workspace layout',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('incomplete');await expect(page.getByRole('region',{name:'Checkpoint review'}).locator('.workspace-diff')).toHaveCount(0);
  if(state==='partial-detail')expect(await page.evaluate(()=>(window as unknown as {checkpointCalls:{kind:string}[]}).checkpointCalls.some(call=>call.kind==='review'))).toBe(false);
 }
});
test('root binding and unified diff truncation stay visible without inventing a file pair',async({page},testInfo)=>{
 for(const state of ['root','truncated']){
  await page.goto('/file-checkpoints?state='+state);await page.getByRole('button',{name:'Review Before updating workspace layout',exact:true}).click();
  await expect(page.locator('.unified-diff').first()).toContainText('@@ -1 +1 @@');await expect(page.getByRole('region',{name:'Checkpoint review'}).locator('.workspace-diff-pair')).toHaveCount(0);
  if(state==='truncated')await expect(page.getByText('Diff truncated. Only part of this comparison is shown.').first()).toBeVisible();
  if(state==='truncated')await page.screenshot({path:testInfo.outputPath('5-review-truncated-1440.png'),fullPage:true});
  await expect(page.getByRole('region',{name:'Checkpoint review'})).toContainText('layout-edit');
 }
});
test('leaving during detail loading cancels the review request',async({page})=>{
 await page.goto('/file-checkpoints?state=detail-loading');await page.getByRole('button',{name:'Review Before updating workspace layout',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('Loading checkpoint review');await page.getByRole('button',{name:'Back to History'}).click();
 await page.evaluate(()=>window.dispatchEvent(new Event('checkpoint-release')));
 expect(await page.evaluate(()=>(window as unknown as {checkpointCalls:{kind:string}[]}).checkpointCalls.some(call=>call.kind==='review'))).toBe(false);
});

for(const width of [1440,1024,768])test(`QA r2: held list does not move the painted caption at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:1000});await page.goto('/file-checkpoints?state=loading');await expect(page.getByRole('status')).toBeVisible();
 const caption=page.locator('.file-checkpoints-caption'),before=(await caption.boundingBox())!;
 await page.evaluate(()=>{const shifts:number[]=[];Object.defineProperty(window,'checkpointShifts',{value:shifts});new PerformanceObserver(list=>{for(const entry of list.getEntries())if(!(entry as PerformanceEntry&{hadRecentInput:boolean}).hadRecentInput)shifts.push((entry as PerformanceEntry&{value:number}).value);}).observe({type:'layout-shift'});});
 await page.waitForTimeout(700);await page.evaluate(()=>window.dispatchEvent(new Event('checkpoint-release')));
 await expect(page.getByRole('button',{name:'Review Before updating workspace layout',exact:true})).toBeVisible();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 expect((await caption.boundingBox())!.y).toBeCloseTo(before.y,2);
 expect(await page.evaluate(()=>(window as unknown as {checkpointShifts:number[]}).checkpointShifts.reduce((sum,value)=>sum+value,0))).toBe(0);
});
test('QA r2: long checkpoint requests remain bounded and every part keeps its identity',async({page})=>{
 await page.goto('/file-checkpoints?state=long-100');await page.getByRole('button',{name:'Review Before updating workspace layout',exact:true}).click();
 await expect(page.getByRole('region',{name:'Checkpoint review'}).locator('.workspace-diff')).toHaveCount(100);
 const calls=await page.evaluate(()=>(window as unknown as {checkpointCalls:{kind:string;owner:{threadId:string};paths?:string[]}[]}).checkpointCalls.filter(call=>call.kind==='review'));
 expect(calls.length).toBeGreaterThan(1);expect(calls.flatMap(call=>call.paths??[])).toHaveLength(100);
 for(const call of calls)expect(new TextEncoder().encode(JSON.stringify({threadId:call.owner.threadId,paths:call.paths})).byteLength).toBeLessThanOrEqual(32*1024);
 const parts=page.getByRole('region',{name:/Review part/});await expect(parts).toHaveCount(calls.length);
 for(let i=0;i<calls.length;i++)await expect(parts.nth(i)).toContainText(`review-layout-${i+1}`);
 await expect(page.getByRole('button',{name:'Restore selected files'})).toBeDisabled();
});
test('later review failures or duplicate identities never present a complete checkpoint',async({page})=>{
 for(const state of ['long-fail','long-partial','long-duplicate']){
  await page.goto('/file-checkpoints?state='+state);await page.getByRole('button',{name:'Review Before updating workspace layout',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Review part 2 of 2 is incomplete.');
  await expect(page.getByRole('region',{name:'Checkpoint review'}).locator('.workspace-diff')).toHaveCount(0);
 }
});
