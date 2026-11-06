import {test,expect} from '@playwright/test';
import {resolve} from 'node:path';
const fixture='/@fs/'+resolve('tests/e2e/model-composer-refinement-fixture.tsx').replaceAll('\\','/');
test.beforeEach(async({page})=>{
 await page.route(url=>url.pathname==='/model-composer-refinement',route=>route.fulfill({contentType:'text/html',body:`<html data-theme="dark"><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${encodeURI(fixture)}');</script></body></html>`}));
 await page.goto('/model-composer-refinement');
});
test('combined trigger opens advertised models and actual reasoning options with unchanged callbacks',async({page},testInfo)=>{
 const trigger=page.getByRole('combobox',{name:'Model',exact:true});await expect(trigger).toContainText('GPT-6.1 Sol');await expect(trigger).toContainText('Ultra');
 await expect(page.getByRole('combobox',{name:'Thinking effort'})).toHaveCount(0);await trigger.click();
 await expect(page.getByRole('searchbox',{name:'Search models'})).toBeFocused();
 await expect(page.getByRole('group',{name:'Reasoning',exact:true})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('model-picker-desktop.png')});
 await page.getByRole('button',{name:'Reasoning: Ultra',exact:true}).click();
 await page.getByRole('menuitemcheckbox',{name:'High',exact:true}).click();await expect(trigger).toContainText('High');await expect(trigger).toHaveAttribute('aria-expanded','false');
 await trigger.click();await page.getByRole('option',{name:'GPT-6.1 Terra',exact:true}).click();await expect(trigger).toContainText('GPT-6.1 Terra');
 await page.getByRole('button',{name:'Reasoning: Default',exact:true}).click();
 await expect(page.getByRole('menuitemcheckbox',{name:'Ultra',exact:true})).toHaveCount(0);await expect(page.getByRole('menuitemcheckbox',{name:'Max',exact:true})).toBeVisible();
 await page.getByRole('menuitemcheckbox',{name:'Default',exact:true}).click();
 expect(await page.evaluate(()=>(window as any).modelComposerCalls)).toEqual([['effort','high'],['model','openai/terra'],['effort','']]);
 await expect(page.getByRole('textbox',{name:'Fixture draft'})).toHaveValue('Retain my draft');
});
test('provider search retains actual model identities and omits unsupported reasoning',async({page})=>{
 await page.getByRole('combobox',{name:'Model',exact:true}).click();
 await page.getByRole('searchbox',{name:'Search models'}).fill('Claude');
 await expect(page.getByRole('option')).toHaveCount(1);await page.getByRole('option',{name:'Claude Sonnet',exact:true}).click();
 await expect(page.getByRole('group',{name:'Reasoning',exact:true})).toContainText('No reasoning settings');
 await expect(page.getByRole('button',{name:/^Reasoning:/})).toHaveCount(0);
 await page.getByRole('searchbox',{name:'Search models'}).fill('terra');await expect(page.getByRole('option')).toHaveCount(1);
 await page.getByRole('searchbox',{name:'Search models'}).press('Escape');
 expect(await page.evaluate(()=>(window as any).modelComposerCalls)).toEqual([['model','claude-code/sonnet']]);
});
test('keyboard reasoning, working lock, project selection and narrow popup stay usable',async({page},testInfo)=>{
 await page.setViewportSize({width:390,height:844});
 const trigger=page.getByRole('combobox',{name:'Model',exact:true});await trigger.focus();await trigger.press('ArrowDown');
 const bounds=await page.locator('.model-picker-popover').boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(8);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(382);expect(bounds!.y).toBeGreaterThanOrEqual(8);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(836);
 await page.screenshot({path:testInfo.outputPath('model-picker-narrow.png')});
 const search=page.getByRole('searchbox',{name:'Search models'});await search.press('Tab');await expect(page.getByRole('button',{name:'Reasoning: Ultra',exact:true})).toBeFocused();
 await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');
 await expect(page.getByRole('menuitemcheckbox',{name:'Low',exact:true})).toBeFocused();
 await expect(trigger).toContainText('Ultra');await page.keyboard.press('Enter');await expect(trigger).toBeFocused();
 await page.getByRole('button',{name:'Select project',exact:true}).click();
 await trigger.click();await page.getByRole('button',{name:'Toggle working'}).click();await expect(trigger).toBeDisabled();await expect(trigger).toHaveAttribute('aria-expanded','false');
 expect(await page.evaluate(()=>(window as any).modelComposerCalls)).toEqual([['effort','low'],['project']]);
});

test('the original standalone picker API still selects by keyboard and closes',async({page})=>{
 await page.goto('/model-composer-refinement?standalone=1');
 const trigger=page.getByRole('combobox',{name:'Model',exact:true});await trigger.click();
 const search=page.getByRole('searchbox',{name:'Search models'});await search.fill('terra');await search.press('Enter');
 await expect(trigger).toContainText('GPT-6.1 Terra');await expect(trigger).toHaveAttribute('aria-expanded','false');await expect(trigger).toBeFocused();
 expect(await page.evaluate(()=>(window as any).modelComposerCalls)).toEqual([['model','openai/terra']]);
});
