import {test, expect, type Page} from '@playwright/test';
import {taskFixture, serveTaskFixture} from './task-interface-fixture';
const ref = (id: string) => ({version: 1, scope: {kind: 'personal'}, sourceId: 'personal:test', skillId: id, locator: 'a'.repeat(64), revision: 'b'.repeat(64), digest: 'c'.repeat(64), sourceBinding: 'd'.repeat(64)});
async function fixture(page: Page) {
  const snapshot = taskFixture({root: 'text', elements: {text: {type: 'Text', props: {text: 'Command menu integration fixture'}}}});
  const host = await serveTaskFixture(page, snapshot), reads: string[] = [];
  await page.route('**/api/skill-catalog?*', async route => {
    const url = new URL(route.request().url()), query = url.searchParams.get('query')?.toLowerCase() ?? '', offset = url.searchParams.get('cursor') === 'page-two' ? 50 : 0; reads.push(url.search);
    const all = Array.from({length: 77}, (_, index) => ({id: 'skill-' + index, sourceId: 'personal:test', name: `Procedure ${String(index).padStart(2, '0')}`, description: 'A concise procedure for this task', files: 1, availability: {status: 'available'}, ref: ref('skill-' + index)})).filter(item => item.name.toLowerCase().includes(query));
    await route.fulfill({json: {scope: {kind: 'personal'}, sources: [{id: 'personal:test', kind: 'personal', label: 'Personal', availability: {status: 'available'}}], skills: all.slice(offset, offset + 50), inventoryRevision: 'e'.repeat(64), nextCursor: offset + 50 < all.length ? 'page-two' : null}});
  });
  await page.goto('/'); const input = page.getByRole('textbox', {name: 'Message', exact: true}); await expect(input).toBeEnabled(); await input.focus();
  return {...host, input, reads};
}
test('slash opens a compact command and paged installed-skill menu, preserving focus and never sending on selection', async ({page}) => {
  const f = await fixture(page); await f.input.fill('Explain this /');
  const menu = page.getByRole('listbox', {name: 'Commands and skills'}); await expect(menu).toBeVisible();
  await expect(menu.getByRole('option', {name: '/model Choose a model'})).toBeVisible();
  await expect(menu.getByRole('option', {name: /Procedure 00/})).toBeVisible();
  await menu.getByRole('option', {name: /Procedure 00/}).click();
  await expect(page.getByRole('group', {name: 'Selected skills'})).toContainText('Procedure 00');
  await expect(f.input).toHaveValue('Explain this '); await expect(f.input).toBeFocused();
  expect(f.commands.filter(command => command.type === 'message.send')).toHaveLength(0);
  await f.input.fill('/skill:'); await expect(menu.getByRole('option', {name: /Procedure 49/})).toBeAttached();
  await page.getByRole('button', {name: 'Load more skills'}).click(); await expect(menu.getByRole('option', {name: /Procedure 76/})).toBeAttached();
  expect(f.reads.some(query => query.includes('cursor=page-two'))).toBe(true);
});
test('keyboard model selection opens the existing picker, while hover and Escape never commit commands', async ({page}) => {
  const f = await fixture(page); await f.input.fill('/model'); await expect(page.getByRole('listbox', {name: 'Commands and skills'})).toBeVisible();
  await f.input.press('Enter'); await expect(page.getByRole('searchbox', {name: 'Search models'})).toBeVisible();
  await expect(f.input).toHaveValue(''); expect(f.commands.filter(command => command.type === 'message.send')).toHaveLength(0);
  await page.getByRole('searchbox', {name: 'Search models'}).press('Escape'); await f.input.focus(); await f.input.fill('/plan'); await f.input.press('Escape');
  await expect(page.getByRole('listbox', {name: 'Commands and skills'})).toHaveCount(0); expect(f.commands.filter(command => command.type === 'thread.mode')).toHaveLength(0);
});
test('URLs, filesystem paths and composing Enter do not accidentally activate commands', async ({page}) => {
  const f = await fixture(page);
  for (const text of ['https://example.test/model', 'C:/model', '/usr/local', 'text/model']) {await f.input.fill(text); await expect(page.getByRole('listbox', {name: 'Commands and skills'})).toHaveCount(0);}
  await f.input.fill('/plan'); await expect(page.getByRole('listbox', {name: 'Commands and skills'})).toBeVisible();
  await f.input.dispatchEvent('compositionstart'); await f.input.dispatchEvent('keydown', {key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true});
  expect(f.commands.filter(command => ['thread.mode', 'message.send'].includes(command.type))).toHaveLength(0);
  await f.input.dispatchEvent('compositionend');
});
test('plan and default use canonical mode commands, while Escape can reopen after editing', async ({page}) => {
  const f = await fixture(page); await f.input.fill('/plan'); await expect(page.getByRole('listbox', {name: 'Commands and skills'})).toBeVisible();
  await f.input.press('Escape'); await f.input.press('Backspace'); await expect(page.getByRole('listbox', {name: 'Commands and skills'})).toBeVisible();
  await f.input.press('n'); await expect(page.getByRole('listbox', {name: 'Commands and skills'})).toBeVisible();
  await f.input.press('Enter'); await expect.poll(() => f.commands.filter(command => command.type === 'thread.mode').map(command => command.payload)).toEqual([{mode: 'plan'}]);
  await f.input.fill('/default'); await expect(page.getByRole('listbox', {name: 'Commands and skills'})).toBeVisible(); await f.input.press('Enter');
  await expect.poll(() => f.commands.filter(command => command.type === 'thread.mode').map(command => command.payload)).toEqual([{mode: 'plan'}, {mode: 'build'}]);
  expect(f.commands.filter(command => command.type === 'message.send')).toHaveLength(0);
});
test('selected skill identity survives reload and the Send payload retains the exact reference', async ({page}) => {
  const f = await fixture(page); await f.input.fill('/skill:Procedure 03');
  // Names with spaces are searched by typing the query without a slash-token-breaking space.
  await f.input.fill('/03'); await expect(page.getByRole('option', {name: /Procedure 03/})).toBeVisible();
  await page.getByRole('option', {name: /Procedure 03/}).click(); await f.input.fill('Use this procedure');
  await page.reload(); const input = page.getByRole('textbox', {name: 'Message', exact: true}); await expect(input).toHaveValue('Use this procedure');
  await expect(page.getByRole('group', {name: 'Selected skills'})).toContainText('Procedure 03');
  await page.getByRole('button', {name: 'Send message', exact: true}).click();
  await expect.poll(() => f.commands.filter(command => command.type === 'message.send').length).toBe(1);
  expect(f.commands.find(command => command.type === 'message.send')?.payload.skills).toEqual([ref('skill-3')]);
  await expect(page.getByRole('group', {name: 'Selected skills'})).toHaveCount(0);
});
test('a selected Personal skill cannot silently disappear into a side-question send',async({page})=>{
  const f=await fixture(page);await f.input.fill('/03');await page.getByRole('option',{name:/Procedure 03/}).click();
  await f.input.fill('/btw Explain the next step');await f.input.press('Enter');
  await expect(page.getByRole('alert').filter({hasText:'Selected skills apply to the main conversation'})).toBeVisible();
  expect(f.commands.filter(command=>command.type==='message.send')).toHaveLength(0);await expect(f.input).toHaveValue('/btw Explain the next step');
  await expect(page.getByRole('group',{name:'Selected skills'})).toContainText('Procedure 03');
});
test('disconnected and unsupported sources remain visible without inventing skill entries',async({page})=>{
  const f=await fixture(page);await page.route('**/api/skill-catalog?*',route=>route.fulfill({json:{scope:{kind:'personal'},sources:[{id:'app',kind:'app',label:'Installed apps',availability:{status:'unavailable',reason:'unsupported'}},{id:'project',kind:'project',label:'Project',availability:{status:'unavailable',reason:'disconnected'}}],skills:[],inventoryRevision:'a'.repeat(64),nextCursor:null}}));
  await f.input.fill('/skill:');const status=page.getByRole('status',{name:'Unavailable skill sources'});await expect(status).toContainText('Installed appsUnavailable');await expect(status).toContainText('ProjectDisconnected');
  await expect(page.getByRole('listbox',{name:'Commands and skills'}).getByRole('option')).toHaveCount(0);
  expect(f.commands.filter(command=>command.type==='message.send')).toHaveLength(0);
});
for (const [theme,width,height,zoom] of [['dark',1280,800,1],['light',900,600,1.25],['dark',640,440,1.5],['light',390,700,1]] as const) {
  test(`command menu geometry ${theme} ${width}x${height} ${zoom}`, async ({page}, info) => {
    await page.setViewportSize({width,height}); const f = await fixture(page);
    await page.evaluate(({theme,zoom}) => {document.documentElement.dataset.theme=theme;document.documentElement.style.zoom=String(zoom);document.documentElement.dataset.nativeTitlebar='true';}, {theme,zoom});
    await f.input.fill('/'); const menu=page.getByRole('listbox',{name:'Commands and skills'}); await expect(menu.getByRole('option',{name:/Procedure 00/})).toBeVisible();
    const rect = await page.locator('.composer-command-popover').evaluate(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};});
    expect(rect.x).toBeGreaterThanOrEqual(0);expect(rect.y).toBeGreaterThanOrEqual(42);expect(rect.right).toBeLessThanOrEqual(width+1);expect(rect.bottom).toBeLessThanOrEqual(height+1);
    expect(rect.height).toBeGreaterThan(80);
    if(width===1280){const inputRect=await f.input.boundingBox();expect(rect.x).toBeGreaterThanOrEqual(inputRect!.x-1);}
    const surface=await page.locator('.composer-command-popover').evaluate(node=>{const style=getComputedStyle(node);return{background:style.backgroundColor,border:parseFloat(style.borderTopWidth),radius:parseFloat(style.borderTopLeftRadius)};});expect(surface.background).not.toBe('rgba(0, 0, 0, 0)');expect(surface.border*zoom).toBeGreaterThanOrEqual(.99);expect(surface.radius).toBeGreaterThanOrEqual(8);await page.screenshot({path:info.outputPath(`command-menu-${theme}-${width}-${zoom}.png`)});
  });
}
