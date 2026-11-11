import { test, expect } from '@playwright/test';
import {resolve} from 'node:path';
import { taskFixture, serveTaskFixture } from './task-interface-fixture';

test.beforeEach(async ({page})=>{
  await page.route('**/wo8-pairing',route=>route.fulfill({contentType:'text/html',body:`<html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('/@fs/${resolve(process.env.WO8_SOURCE_ROOT??'.','tests/e2e/wo8-pairing-fixture.tsx')}');</script></body></html>`}));
});
const stage = process.env.WO8_STAGE === 'before' ? 'before' : 'after';
for (const theme of ['dark', 'light'] as const) for (const width of [1440, 1024]) {
  test(`thread diff ${theme} ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const snapshot = taskFixture({ root: 'diff', elements: { diff: { type: 'Diff', props: { diff: '  function restoreLayout() {\n-   return defaultLayout;\n+   return savedLayout ?? defaultLayout;\n  }' } } } });
    snapshot.settings.theme = theme;
    snapshot.threads[0].title = 'Review changes'; snapshot.threads[0].projectName = 'Gen-V1';
    snapshot.artifacts[0].title = 'Changes';
    snapshot.messages[0].content = 'Updated the layout. See the [diff](#diff) and [files](#files).';
    snapshot.messages.unshift({ ...snapshot.messages[0], id: 'question', role: 'user', content: 'Review the workspace changes.' });
    await serveTaskFixture(page, snapshot); await page.goto('/');
    await expect(page.locator('.diff')).toBeVisible({timeout:15000});
    if(stage==='after'){
      await expect(page.locator('.message-role')).toHaveCount(0);
      for(const name of ['diff','files']){const link=page.locator('.message-assistant').getByRole('link',{name,exact:true});await expect(link).toHaveAttribute('href',`#${name}`);await expect(link).toHaveCSS('text-decoration-line','underline');}
    }
    await page.screenshot({ path: info.outputPath(`thread-diff-${stage}-${theme}-${width}.png`) });
  });
  test(`usage and context ${theme} ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = '/@fs/'+resolve(process.env.WO8_SOURCE_ROOT??'.','tests/e2e/usage-context-fixture.tsx');
    await page.route('**/api/bootstrap', route => route.fulfill({ json: { csrfToken: 'synthetic' } }));
    await page.route('**/wo8-usage', route => route.fulfill({ contentType: 'text/html', body: `<html data-theme="${theme}"><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${fixture}');</script></body></html>` }));
    await page.goto('/wo8-usage');
    await expect(page.locator('html')).toHaveAttribute('data-usage-fixture-ready', 'true');
    await page.getByRole('button', { name: 'Open Usage', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Usage', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Tokens', exact: true }).click();
    await page.screenshot({ path: info.outputPath(`usage-dialog-${stage}-${theme}-${width}.png`) });
    await page.getByRole('tab',{name:'Limits',exact:true}).click();
    if(stage==='after'){
      const dialog=page.getByRole('dialog',{name:'Usage',exact:true});
      await expect(dialog).toContainText('23.5%');await expect(dialog).toContainText('2030');await expect(dialog).not.toContainText('2030-01-01T12:34:56Z');
      await expect(dialog.locator('dd').first()).toHaveCSS('text-align','right');
      await expect(dialog.locator('.ui-modal-close>svg')).toHaveCSS('color',theme==='dark'?'rgb(160, 160, 160)':'rgb(112, 112, 112)');
    }
    await page.screenshot({path:info.outputPath(`usage-limits-${stage}-${theme}-${width}.png`)});
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('usage-fixture', { detail: 'categories' })));
    await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Context inspector' })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`context-inspector-${stage}-${theme}-${width}.png`) });
  });
}

for (const theme of ['dark','light'] as const) {
  test(`right-aligned stats and full-width numeric tables ${theme}`, async ({page},info) => {
    test.skip(stage==='before');
    await page.goto('/wo8-pairing');
    await page.evaluate(value=>{document.documentElement.dataset.theme=value;},theme);
    await expect(page.locator('.everyday-comparison-table')).toBeVisible();
    await expect(page.locator('.task-step-label')).toBeVisible();
    for(const selector of ['.usage-summary>dl']){
      const measurements=await page.locator(selector).evaluate(element=>{
        const style=getComputedStyle(element),label=element.querySelector('dt')!,value=element.querySelector('dd')!;
        return {gap:style.columnGap,width:element.getBoundingClientRect().width,label:label.getBoundingClientRect().width,valueLeft:value.getBoundingClientRect().left-label.getBoundingClientRect().right,valueRight:value.getBoundingClientRect().right,right:element.getBoundingClientRect().right,align:getComputedStyle(value).textAlign,weight:getComputedStyle(value).fontWeight};
      });
      expect(measurements.gap).toBe('13px');expect(measurements.valueLeft).toBeCloseTo(13);expect(measurements.width).toBeCloseTo(688);expect(measurements.valueRight).toBeCloseTo(measurements.right);expect(measurements.align).toBe('right');expect(measurements.weight).toBe('400');
    }
    for(const selector of ['.surface-metric','.surface-progress>div']){
      await expect(page.locator(selector)).toHaveCSS('column-gap','8px');
      await expect(page.locator(selector)).toHaveCSS('justify-content','space-between');
    }
    await expect(page.locator('.task-table th[data-column-key="count"]')).toHaveCSS('text-align','right');
    await expect(page.locator('.task-table td[data-column-key="count"]').first()).toHaveCSS('text-align','right');
    await expect(page.locator('.task-table td[data-column-key="code"]').first()).toHaveCSS('text-align','left');
    await expect(page.locator('.task-table td[data-column-key="code"]').first()).toHaveText('0012');
    await expect(page.locator('.everyday-comparison-table td.number').first()).toHaveCSS('text-align','right');
    const volume=page.locator('.settings-card-row').filter({has:page.getByRole('slider',{name:'Notification volume'})});
    await expect(volume.locator('.settings-inline-controls>output')).toHaveText('35.0%');
    await expect(page.locator('.usage-context strong')).toHaveText('80.0%');
    await expect(page.locator('.usage-summary dd').last()).toHaveText('0.0%');
    await expect(page.locator('.surface-metric strong')).toHaveText('124,800');
    for(const selector of ['.task-table-scroll','.everyday-comparison-table']){const width=await page.locator(selector).evaluate(element=>element.getBoundingClientRect().width);expect(width).toBeCloseTo(728);}
    await page.screenshot({path:info.outputPath(`metrics-${stage}-${theme}-1440.png`)});
    await page.screenshot({path:info.outputPath(`metrics-full-${stage}-${theme}-1440.png`),fullPage:true});
    // A 720 CSS-pixel viewport represents a 1440px window at 200% zoom.
    for(const width of [720,375]){
      await page.setViewportSize({width,height:900});
      await expect(page.locator('.task-table td[data-column-key="count"]').first()).toHaveText('123,456,789,012,345');
      const scroll=page.locator('.task-table-scroll');
      if(width===375)await page.addStyleTag({content:'.task-table { width:160px; max-width:100%; }'});
      const overflowing=await scroll.evaluate(element=>element.scrollWidth>element.clientWidth||element.scrollHeight>element.clientHeight);
      if(overflowing){await expect(scroll).toHaveAttribute('tabindex','0');await scroll.focus();await expect(scroll).toBeFocused();}
      else await expect(scroll).not.toHaveAttribute('tabindex','0');
      if(width===375)expect(overflowing).toBe(true);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
  });
  test(`rendered semantic pairs pass AA ${theme}`, async ({page}) => {
    test.skip(stage==='before');
    await page.goto('/wo8-pairing');
    await expect(page.locator('.surface-metric')).toBeVisible();
    const ratios=await page.evaluate(value=>{
      document.documentElement.dataset.theme=value;
      const style=getComputedStyle(document.documentElement);
      const luminance=(hex:string)=>{const channels=hex.trim().slice(1).match(/.{2}/g)!.map(value=>parseInt(value,16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;};
      return ['accent','success','danger','warning','category'].map(name=>{const a=luminance(style.getPropertyValue(`--${name}-fg`)),b=luminance(style.getPropertyValue(`--${name}-bg`));return {name,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});
    },theme);
    for(const {name,ratio} of ratios)expect(ratio,`${theme} ${name}`).toBeGreaterThanOrEqual(4.5);
  });
}

for(const theme of ['dark','light'] as const)test(`inline numeric table preserves full numbers ${theme}`,async({page})=>{
  test.skip(stage==='before');
  await page.setViewportSize({width:375,height:900});
  const snapshot=taskFixture({root:'records',elements:{records:{type:'Table',props:{rowsBinding:'records',columns:[{key:'label',label:'Source record'},{key:'value',label:'Reported count',type:'number'},{key:'code',label:'Code'}]}}}}, {records:[{label:'Source record with a long label',value:123456789012345,code:'00123456789'}]});
  snapshot.settings.theme=theme;await serveTaskFixture(page,snapshot);await page.goto('/');
  const value=page.locator('.task-table td.number');await expect(value).toHaveText('123,456,789,012,345');await expect(value).toHaveCSS('white-space','nowrap');
  const scroll=page.locator('.task-table-scroll');await expect.poll(()=>scroll.evaluate(element=>element.scrollWidth>element.clientWidth)).toBe(true);await expect(scroll).toHaveAttribute('tabindex','0');await scroll.focus();await expect(scroll).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

for(const theme of ['dark','light'] as const)for(const width of [1440,1024,768])test(`long metric values stay visible ${theme} ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});
  const sentence='The reported source value remains readable beside its owning label. '.repeat(12).trim();
  const identifier='sourceBoundMetricValue'.repeat(24);
  const snapshot=taskFixture({root:'metrics',elements:{
    metrics:{type:'Stack',props:{gap:'lg'},children:['count','sentence','identifier']},
    count:{type:'Metric',props:{label:'Files reviewed',value:124800,unit:'files'}},
    sentence:{type:'Metric',props:{label:'Reported description',value:sentence}},
    identifier:{type:'Metric',props:{label:'Reported identifier',value:identifier}},
  }});
  snapshot.settings.theme=theme;snapshot.artifacts[0].title='Reported metrics';
  await serveTaskFixture(page,snapshot);await page.goto('/');
  const metrics=page.locator('.surface-metric');await expect(metrics).toHaveCount(3);await page.evaluate(()=>document.fonts.ready);
  if(width===1440)await page.screenshot({path:info.outputPath(`metric-long-value-${stage}-${theme}-${width}.png`),animations:'disabled'});
  const numeric=metrics.nth(0);await expect(numeric.locator('strong')).toHaveText('124,800 files');
  const pair=await numeric.evaluate(element=>{const label=element.querySelector('span')!.getBoundingClientRect(),value=element.querySelector('strong')!.getBoundingClientRect();return {gap:value.left-label.right,right:value.right,ownerRight:element.getBoundingClientRect().right,overlap:Math.min(label.bottom,value.bottom)-Math.max(label.top,value.top)};});
  expect(pair.gap).toBeGreaterThanOrEqual(8);expect(pair.right).toBeCloseTo(pair.ownerRight);expect(pair.overlap).toBeGreaterThan(0);
  for(const [index,value] of [[1,sentence],[2,identifier]] as const){
    const metric=metrics.nth(index);await expect(metric.locator('strong')).toHaveText(value);
    const bounds=await metric.locator('strong').evaluate(element=>{
      const box=element.getBoundingClientRect(),owner=element.closest('.artifact')!.getBoundingClientRect();
      return {width:box.width,available:owner.width,right:box.right,ownerRight:owner.right,scroll:element.scrollWidth,client:element.clientWidth||box.width};
    });
    expect(bounds.width,`${theme}/${width}: complete metric fits its artifact`).toBeLessThanOrEqual(bounds.available);
    expect(bounds.right).toBeLessThanOrEqual(bounds.ownerRight);
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.client+1);
    await expect(metric).toHaveCSS('column-gap','8px');
  }
});
