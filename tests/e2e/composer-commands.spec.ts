import {test, expect, type Page} from '@playwright/test';
import {taskFixture, serveTaskFixture} from './task-interface-fixture';
const ref = (id: string) => ({version: 1, scope: {kind: 'personal'}, sourceId: 'personal:test', skillId: id, locator: 'a'.repeat(64), revision: 'b'.repeat(64), digest: 'c'.repeat(64), sourceBinding: 'd'.repeat(64)});
async function retainSkill(page: Page, draft: string, retry = false) {
  const binding = {id: '75ca7aab-c47b-4350-8b62-5a1776d17f3e', name: 'Procedure 03', source: 'Personal', ref: ref('skill-3')};
  const pending = {commandId: '2ffde78e-3b25-4c4d-a987-25cc687a6588', content: 'Original request', generation: 'original-draft', modelId: 'test/original-model', thinkingLevel: 'high', skills: [binding]};
  const entries: [string, unknown, string][] = [['draft:task-thread', draft, 'current-draft'], ['draft-skills:task-thread', [binding], 'current-skills']];
  if (retry) entries.push(['agents-pending:task-thread', pending, 'original-pending']);
  await page.addInitScript(entries => {
    if (sessionStorage.getItem('retained-skill-fixture')) return;
    sessionStorage.setItem('retained-skill-fixture', 'true');
    for (const [key, value, generation] of entries) localStorage.setItem('harness:journal-pending:' + encodeURIComponent(key), JSON.stringify({value, generation, updatedAt: Date.now()}));
  }, entries);
  return {binding, pending};
}
async function journalValue(page: Page, key: string) {
  return page.evaluate(key => new Promise<unknown>((resolve, reject) => {
    const open = indexedDB.open('generative-harness-journal', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, request = db.transaction('entries').objectStore('entries').get(key);
      request.onsuccess = () => {resolve(request.result?.value); db.close();};
      request.onerror = () => {reject(request.error); db.close();};
    };
  }), key);
}
async function fixture(page: Page) {
  const snapshot = taskFixture({root: 'text', elements: {text: {type: 'Text', props: {text: 'Command menu integration fixture'}}}});
  const host = await serveTaskFixture(page, snapshot), reads: string[] = [];
  await page.route('**/api/commands', async route => {
    const command = route.request().postDataJSON() as typeof host.commands[number];
    if (command.type !== 'message.send' || command.payload.skills === undefined) return route.fallback();
    host.commands.push(command);
    // Match the current Service boundary: catalog readability never enables skill admission.
    await route.fulfill({status: 400, json: {error: {code: 'SKILL_ADMISSION_UNAVAILABLE', message: 'Selected skills are unavailable for this runtime. Your draft is retained.', details: {sendAccepted: false}}}});
  });
  await page.route('**/api/skill-catalog?*', async route => {
    const url = new URL(route.request().url()), query = url.searchParams.get('query')?.toLowerCase() ?? '', offset = url.searchParams.get('cursor') === 'page-two' ? 50 : 0; reads.push(url.search);
    const all = Array.from({length: 77}, (_, index) => ({id: 'skill-' + index, sourceId: 'personal:test', name: `Procedure ${String(index).padStart(2, '0')}`, description: 'A concise procedure for this task', files: 1, availability: {status: 'available'}, ref: ref('skill-' + index)})).filter(item => item.name.toLowerCase().includes(query));
    await route.fulfill({json: {scope: {kind: 'personal'}, sources: [{id: 'personal:test', kind: 'personal', label: 'Personal', availability: {status: 'available'}}], skills: all.slice(offset, offset + 50), inventoryRevision: 'e'.repeat(64), nextCursor: offset + 50 < all.length ? 'page-two' : null}});
  });
  await page.goto('/'); const input = page.getByRole('textbox', {name: 'Message', exact: true}); await expect(input).toBeEnabled(); await input.focus();
  return {...host, input, reads};
}
test('slash keeps installed skills browsable but unavailable for selection or sending', async ({page}) => {
  const f = await fixture(page); await f.input.fill('Explain this /');
  const menu = page.getByRole('listbox', {name: 'Commands and skills'}); await expect(menu).toBeVisible();
  await expect(menu.getByRole('option', {name: '/model Choose a model'})).toBeVisible();
  await expect(menu.getByRole('option', {name: /Procedure 00/})).toBeVisible();
  await expect(menu.getByRole('option', {name: /Procedure 00/})).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('status', {name: 'Skill selection unavailable'})).toContainText('Skill selection is unavailable for this runtime');
  await menu.getByRole('option', {name: /Procedure 00/}).click({force: true});
  await expect(page.getByRole('group', {name: 'Selected skills'})).toHaveCount(0);
  await expect(f.input).toHaveValue('Explain this /'); await expect(f.input).toBeFocused();
  await f.input.fill('/skill:00'); await expect(menu.getByRole('option', {name: /Procedure 00/})).toBeVisible(); await f.input.press('Enter');
  await expect(f.input).toHaveValue('/skill:00');
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
test('retained unavailable skills survive reload and require explicit removal before a new send', async ({page}) => {
  const {binding} = await retainSkill(page, 'Use this procedure');
  const f = await fixture(page);
  await expect(page.getByRole('status', {name: 'Selected skills unavailable'})).toContainText('Remove them to send a new message without skills');
  await expect(page.getByRole('button', {name: 'Send message', exact: true})).toBeDisabled(); await f.input.press('Enter');
  expect(f.commands.filter(command => command.type === 'message.send')).toHaveLength(0);
  await page.reload(); const input = page.getByRole('textbox', {name: 'Message', exact: true}); await expect(input).toHaveValue('Use this procedure');
  await expect(page.getByRole('group', {name: 'Selected skills'})).toContainText('Procedure 03');
  await expect.poll(() => journalValue(page, 'draft-skills:task-thread')).toEqual([binding]);
  await expect(page.getByRole('button', {name: 'Send message', exact: true})).toBeDisabled();
  await page.getByRole('button', {name: 'Remove skill Procedure 03'}).click(); await expect(input).toHaveValue('Use this procedure');
  await expect(page.getByRole('button', {name: 'Send message', exact: true})).toBeEnabled();
  await page.getByRole('button', {name: 'Send message', exact: true}).click();
  await expect.poll(() => f.commands.filter(command => command.type === 'message.send').length).toBe(1);
  expect(f.commands.find(command => command.type === 'message.send')?.payload).not.toHaveProperty('skills');
  await expect(page.getByRole('group', {name: 'Selected skills'})).toHaveCount(0);
  await expect(input).toHaveValue(''); await page.reload(); await expect(input).toHaveValue('');
});
test('a retained Personal skill cannot silently disappear into a side-question send',async({page})=>{
  await retainSkill(page, '/btw Explain the next step'); const f=await fixture(page); await f.input.press('Enter');
  await expect(page.getByRole('status', {name: 'Selected skills unavailable'})).toBeVisible();
  expect(f.commands.filter(command=>command.type==='message.send')).toHaveLength(0);await expect(f.input).toHaveValue('/btw Explain the next step');
  await expect(page.getByRole('group',{name:'Selected skills'})).toContainText('Procedure 03');
});
test('a retained retry keeps its original identity after removal, reload and a later side-question draft', async ({page}) => {
  const {pending} = await retainSkill(page, 'A later draft', true), f = await fixture(page);
  await expect(page.getByRole('button', {name: 'Retry send', exact: true})).toBeEnabled();
  await page.getByRole('button', {name: 'Remove skill Procedure 03'}).click();
  await expect(page.getByRole('group', {name: 'Selected skills'})).toHaveCount(0);
  await expect(page.getByRole('status').filter({hasText: 'Retry keeps the original message and skill selections'})).toBeVisible();
  await f.input.fill('/btw A later side question'); await page.reload();
  await expect(f.input).toHaveValue('/btw A later side question');
  await expect.poll(() => journalValue(page, 'agents-pending:task-thread')).toEqual(pending);
  await expect.poll(() => journalValue(page, 'draft-skills:task-thread')).toEqual([]);
  await page.getByRole('button', {name: 'Retry send', exact: true}).click();
  await expect.poll(() => f.commands.filter(command => command.type === 'message.send').length).toBe(1);
  const retried = f.commands.find(command => command.type === 'message.send')!;
  expect(retried).toEqual({id: pending.commandId, type: 'message.send', threadId: 'task-thread', payload: {content: pending.content, modelId: pending.modelId, thinkingLevel: pending.thinkingLevel, skills: [ref('skill-3')]}});
  await expect(page.getByRole('alert').filter({hasText: 'Selected skills are unavailable for this runtime. Your draft is retained.'})).toBeVisible();
  await expect(f.input).toHaveValue('/btw A later side question');
  await expect.poll(() => journalValue(page, 'agents-pending:task-thread')).toBeNull();
  expect(f.commands.filter(command => command.type.startsWith('side.'))).toHaveLength(0);
  await f.input.fill('Send the later draft without skills'); await page.getByRole('button', {name: 'Send message', exact: true}).click();
  await expect.poll(() => f.commands.filter(command => command.type === 'message.send').length).toBe(2);
  const next = f.commands.filter(command => command.type === 'message.send')[1];
  expect(next.id).not.toBe(pending.commandId); expect(next.payload).not.toHaveProperty('skills');
  expect(next.payload.content).toBe('Send the later draft without skills'); await expect(f.input).toHaveValue('');
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
