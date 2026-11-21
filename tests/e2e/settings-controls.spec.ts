import { expect, test, type Locator, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import type { HostCommand } from '../../packages/contracts';
import { getPreferences, type UiPreferences } from '../../packages/contracts/preferences';
import { serveTaskFixture, taskFixture } from './task-interface-fixture';

async function openSettings(page: Page, theme: 'dark' | 'light' = 'dark') {
  const snapshot = taskFixture({ root: 'text', elements: { text: { type: 'Text', props: { text: 'Settings regression fixture' } } } });
  snapshot.settings.theme = theme;
  const host = await serveTaskFixture(page, snapshot);
  await page.route('**/api/commands', async route => {
    const command = route.request().postDataJSON() as HostCommand;
    if (command.type !== 'settings.update') return route.fallback();
    host.commands.push(command);
    snapshot.settings.preferences = { ...getPreferences(snapshot.settings), ...(command.payload.preferences as Partial<UiPreferences>) };
    snapshot.seq++;
    await route.fulfill({ json: { commandId: command.id, seq: snapshot.seq, result: {} } });
  });
  await page.route('**/api/workspace', route => route.fulfill({ json: { projects: [], state: { version: 1, revision: 0, activeCanvasId: 'workspace-default', canvases: [{ version: 1, id: 'workspace-default', name: 'Workspace', preset: 'workspace', viewport: { x: 0, y: 0, zoom: 1 }, panels: [], filter: 'active', projectIds: [] }], profiles: [], disabledKinds: [], integrations: {} } } }));
  await page.route('**/api/environment', route => route.fulfill({ json: { revision: 0, entries: [], secretStorageAvailable: false } }));
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await expect(composer).toBeEnabled();
  await composer.fill('Retain this conversation draft');
  if ((page.viewportSize()?.width ?? 1440) < 760) await composer.press('Control+,');
  else await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(dialog).toBeVisible();
  return { ...host, dialog, composer, nav: dialog.getByRole('navigation', { name: 'Settings sections' }), search: dialog.getByRole('searchbox', { name: 'Search all settings' }) };
}

async function scalarText(content: Locator) {
  return content.evaluate(node => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const numbers: string[] = [];
    while (walker.nextNode()) if (/^\s*\d+\s*$/.test(walker.currentNode.textContent ?? '') && walker.currentNode.parentElement === node) numbers.push(walker.currentNode.textContent!.trim());
    return numbers;
  });
}

test('font sizes accept individual keystrokes and commit only bounded values',async({page})=>{
  const {dialog,nav,commands}=await openSettings(page);await nav.getByRole('button',{name:'Appearance',exact:true}).click();
  const size=dialog.getByRole('spinbutton',{name:'Chat size',exact:true});await size.focus();await size.press('Control+a');await size.pressSequentially('20');
  await expect(size).toHaveValue('20');await dialog.getByRole('button',{name:'Apply',exact:true}).click();
  await expect.poll(()=>commands.filter(command=>command.type==='settings.update').at(-1)?.payload.preferences).toMatchObject({chatFontSize:20});
  await size.focus();await size.press('Control+a');await size.press('Backspace');await size.press('Tab');await expect(size).toHaveValue('20');
  await size.focus();await size.press('Control+a');await size.pressSequentially('99');await size.press('Tab');await expect(size).toHaveValue('20');
});

test('saving a project color preserves the active appearance preview',async({page})=>{
  const host=await openSettings(page);host.snapshot.threads[0].projectId='preview-project';host.snapshot.threads[0].projectName='Preview project';await host.publish();
  await host.nav.getByRole('button',{name:'Appearance',exact:true}).click();await host.dialog.getByRole('combobox',{name:'Density',exact:true}).click();await page.getByRole('option',{name:/^Touch/}).click();
  await host.dialog.getByRole('button',{name:'Preview',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-density','touch');
  await host.dialog.getByRole('textbox',{name:'Custom color for Preview project',exact:true}).fill('#123abc');await host.dialog.getByRole('button',{name:'Save color',exact:true}).click();
  await expect(host.dialog.getByRole('button',{name:'Reset color for Preview project',exact:true})).toBeVisible();
  const painted=await page.evaluate(async()=>{const values=[];for(let index=0;index<5;index++){await new Promise(requestAnimationFrame);values.push(document.documentElement.dataset.density);}return values;});
  expect(painted.every(value=>value==='touch')).toBe(true);await expect(host.dialog.getByRole('status').filter({hasText:/^Preview$/})).toBeVisible();
  await host.dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-density','comfortable');
  expect(getPreferences(host.snapshot.settings).projectColors['["local","preview-project"]']).toBe('#123abc');
});

test('an invalid project color found through search shows its error and sends no write (AUD-09)',async({page})=>{
  const host=await openSettings(page);host.snapshot.threads[0].projectId='preview-project';host.snapshot.threads[0].projectName='Preview project';await host.publish();
  await host.search.fill('project colors');
  await host.dialog.getByRole('button',{name:/Project colors/}).click();
  const field=host.dialog.getByRole('textbox',{name:'Custom color for Preview project',exact:true});
  await expect(field).toBeVisible();
  await field.fill('#12345');
  const before=host.commands.length;
  await host.dialog.getByRole('button',{name:'Save color',exact:true}).click();
  await expect(host.dialog.getByRole('status').filter({hasText:'six-digit project hex'})).toBeVisible();
  expect(host.commands.slice(before).filter(command=>command.type==='settings.update')).toHaveLength(0);
});

async function installManualBrowserFixture(page:Page){
  await page.addInitScript(()=>{
    const context:{windowId:string;surface:{kind:string};windows:unknown[];dockedBrowser?:{browserId:string;state:{url:string;title:string;canGoBack:boolean;canGoForward:boolean;loading:boolean}}}={windowId:'main',surface:{kind:'main'},windows:[]},calls:unknown[]=[];
    (window as unknown as {manualBrowserCalls:unknown[]}).manualBrowserCalls=calls;
    window.harnessDesktop={getContext:async()=>context,ready:async()=>context,list:async()=>[],reattach:async()=>{},minimize:async()=>{},resetBounds:async()=>{},focus:async()=>{},browser:async(value:unknown)=>{calls.push(value);if((value as {type?:string})?.type==='open')context.dockedBrowser={browserId:'browser-fixture',state:{url:'about:blank',title:'',canGoBack:false,canGoForward:false,loading:false}};},onState:()=>()=>{},onCloseRequested:()=>()=>{},onWorkspaceChanged:()=>()=>{}} as unknown as NonNullable<Window['harnessDesktop']>;
  });
}

test('browser launch leaves the draft and owning modal intact when its save guard rejects',async({page})=>{
  await installManualBrowserFixture(page);const {dialog,nav}=await openSettings(page);
  await page.evaluate(async()=>{const path='/src/editor-handoff.ts';const module=await import(path);module.registerEditorHandoff('synthetic-browser-block',async()=>{throw Error('Keep this draft safe');});});
  await nav.getByRole('button',{name:'Browser',exact:true}).click();await dialog.getByRole('button',{name:'Open browser',exact:true}).click();
  await expect(dialog.getByRole('status').filter({hasText:'Keep this draft safe'})).toBeVisible();await expect(dialog).toBeVisible();
  expect(await page.evaluate(()=>(window as unknown as {manualBrowserCalls:unknown[]}).manualBrowserCalls)).toEqual([]);
  await expect(page.locator('textarea[aria-label="Message"]')).toHaveValue('Retain this conversation draft');
});

test('desktop browser opens from the default anchored workspace after the save guard',async({page})=>{
  await installManualBrowserFixture(page);
  const {dialog,nav,commands}=await openSettings(page);await nav.getByRole('button',{name:'Browser',exact:true}).click();
  await dialog.getByRole('button',{name:'Open browser',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {manualBrowserCalls:unknown[]}).manualBrowserCalls)).toContainEqual({type:'open'});
  await expect(dialog).toHaveCount(0);expect(commands.filter(command=>command.type==='thread.create')).toHaveLength(0);
});

test('Environments and every section stay free of stray scalars through blank, matching, empty and reset search', async ({ page }, info) => {
  const { dialog, nav, search, composer } = await openSettings(page);
  await nav.getByRole('button', { name: 'Models & Accounts', exact: true }).click();
  await dialog.getByText('Environment variables and advanced runtime settings',{exact:true}).click();
  await expect(dialog.getByText('No variables configured.', { exact: true })).toBeVisible();
  await dialog.screenshot({ path: info.outputPath('environments.png') });
  expect(await scalarText(dialog.locator('main'))).toEqual([]);
  for (const label of await nav.getByRole('button').allTextContents()) {
    await nav.getByRole('button', { name: label, exact: true }).click();
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(dialog.getByRole('heading', { level: 1, name: label, exact: true })).toBeVisible();
    expect(await scalarText(dialog.locator('main')), `${label}: blank`).toEqual([]);
    await search.fill('chat width');
    const chatWidthResult = dialog.getByRole('button', { name: /^Chat width/ });
    await expect(chatWidthResult).toBeVisible();
    await expect(nav.locator('[aria-current]')).toHaveCount(0);
    expect(await scalarText(dialog.locator('main')), `${label}: matching`).toEqual([]);
    await chatWidthResult.click();
    await expect(dialog.getByRole('combobox', { name: 'Chat width', exact: true })).toBeVisible();
    await nav.getByRole('button', { name: label, exact: true }).click();
    await search.fill('no-match-9f8c7b6a');
    await expect(dialog.getByText('No matching settings.', { exact: true })).toBeVisible();
    expect(await scalarText(dialog.locator('main')), `${label}: empty results`).toEqual([]);
    await search.fill('   ');
    await expect(nav.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
    expect(await scalarText(dialog.locator('main')), `${label}: reset`).toEqual([]);
  }
  await nav.getByRole('button', { name: 'About & Licenses', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Gen updates' })).toBeVisible();
  await search.fill('update');
  await dialog.getByRole('button', { name: /^Version & updates/ }).click();
  await expect(dialog.getByRole('region', { name: 'Gen updates' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(composer).toHaveValue('Retain this conversation draft');
});

test('search results navigate to the real target with reveal and focus; Escape clears search before closing (T06)', async ({ page }) => {
  const { dialog, nav, search } = await openSettings(page);
  await search.fill('theme');
  await expect(dialog.getByRole('heading', { name: 'Search results (2)', exact: true })).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Density', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: /^Theme/ }).click();
  await expect(nav.getByRole('button', { name: 'Appearance', exact: true })).toHaveAttribute('aria-current', 'page');
  const scheme = dialog.getByRole('combobox', { name: 'Color scheme', exact: true });
  await expect(scheme).toBeVisible();
  await expect(scheme).toBeFocused();
  expect(await dialog.locator('[data-setting-id="appearance-theme"]').evaluate(node=>getComputedStyle(node).outlineStyle)).toBe('none');
  // The whole appearance panel renders — no independent child query filter remains.
  await expect(dialog.getByRole('combobox', { name: 'Density', exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Project colors', exact: true })).toBeVisible();
  await search.fill('density');
  await expect(dialog.getByRole('heading', { name: /Search results/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('heading', { name: 'Appearance', exact: true })).toBeVisible();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('provider search selects its detail and repeats without probing unrelated providers',async({page})=>{
  const {dialog,search}=await openSettings(page),reads:string[]=[];
  await page.route('**/api/account-auth?*',route=>{const providerId=new URL(route.request().url()).searchParams.get('providerId')!;reads.push(providerId);return route.fulfill({json:{providerId,accountId:null,state:'unknown',identity:{availability:'unavailable'},lastCheckedAt:null,localSignout:false,message:'Synthetic selected-provider status.'}});});
  for(const provider of [{id:'gemini-cli',query:'Gemini'},{id:'cursor-sdk',query:'Cursor'},{id:'gemini-cli',query:'Gemini'}]){
    await search.fill(provider.query);await dialog.getByRole('button',{name:new RegExp('^'+provider.query)}).click();
    const target=dialog.locator(`[data-setting-id="provider-${provider.id}"]`);await expect(target).toBeVisible();
    await expect(target.locator('.connection-account-auth')).toHaveAttribute('data-state','unknown');await expect(target.locator('.connection-auth-summary strong')).toHaveText('Status unknown');await expect(dialog.locator('.connection-row')).toHaveCount(1);
    await expect(dialog.getByRole('navigation',{name:'Subscription providers'}).getByRole('button',{name:provider.query,exact:true})).toHaveAttribute('aria-pressed','true');
    await expect.poll(()=>target.evaluate(node=>node===document.activeElement||node.contains(document.activeElement))).toBe(true);
  }
  expect(reads).toEqual(['gemini-cli','cursor-sdk','gemini-cli']);
});

for(const provider of [{query:'OpenCode runtime',id:'opencode',name:/^OpenCode runtime/},{query:'Meta / Muse',id:'meta',name:/^Meta \/ Muse/}])test(`unavailable-provider search keeps keyboard focus on an enabled target (${provider.id})`,async({page})=>{
  const {dialog,search}=await openSettings(page);await search.fill(provider.query);await dialog.getByRole('button',{name:provider.name}).click();
  const target=dialog.locator(`[data-setting-id="provider-${provider.id}"]`);await expect(target).toBeVisible();
  await expect(target.locator('summary')).toBeFocused();
});

test('runtime search reveals one environment controls target and keeps focus in its section',async({page})=>{
  const {dialog,search}=await openSettings(page);await search.fill('environment variables');await dialog.getByRole('button',{name:/^Local runtime & environments/}).click();
  await expect(dialog.locator('[data-setting-id="harness-runtime"]')).toHaveCount(1);
  const target=dialog.locator('[data-setting-id="harness-runtime"]');await expect(target.locator('.environment-settings')).toBeVisible();
  await expect.poll(()=>target.evaluate(node=>node===document.activeElement||node.contains(document.activeElement))).toBe(true);
});

test('browser task-notification preference saves without permission requests and labels platform delivery (T07)', async ({ page }) => {
  const { dialog, nav, commands } = await openSettings(page);
  await page.evaluate(() => {
    (window as unknown as { __notifRequests: number }).__notifRequests = 0;
    Object.defineProperty(window, 'Notification', { configurable: true, value: { requestPermission: async () => { (window as unknown as { __notifRequests: number }).__notifRequests++; return 'denied'; } } });
  });
  await nav.getByRole('button', { name: 'Notifications & Usage', exact: true }).click();
  await expect(dialog.getByText(/System popups and sound are unavailable in this browser build/)).toBeVisible();
  await expect(dialog.getByText('System notifications and sound require the Windows app.')).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Task notifications', exact: true }).click();
  await dialog.getByRole('option', { name: 'Popups and sound', exact: true }).click();
  await expect.poll(() => commands.filter(command => command.type === 'settings.update').length).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as unknown as { __notifRequests: number }).__notifRequests)).toBe(0);
  await expect(dialog.getByRole('combobox', { name: 'Task notifications', exact: true })).toContainText('Popups and sound');
  await expect(dialog.getByRole('switch', { name: 'In-app notifications', exact: true })).toBeEnabled();
});

test('dropdown popovers anchor to their trigger inside the settings dialog with default motion', async ({ page }) => {
  const { dialog, commands } = await openSettings(page);
  // Let the entrance animation finish; a forwards-filled transform used to keep the dialog
  // as the containing block for the fixed popover, shifting it and clipping it at the dialog edge.
  await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.playState === 'running' ).map(animation => animation.finished.catch(() => {}))));
  const trigger = dialog.getByRole('combobox', { name: 'Time format', exact: true });
  await trigger.click();
  const list = dialog.getByRole('listbox', { name: 'Time format', exact: true });
  await expect(list).toBeVisible();
  await list.evaluate(node => Promise.all(node.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').map(animation => animation.finished.catch(() => {}))));
  const anchor = await trigger.boundingBox(), popup = await list.boundingBox();
  expect(Math.abs(popup!.x + popup!.width - (anchor!.x + anchor!.width))).toBeLessThanOrEqual(2);
  expect(Math.abs(popup!.y - (anchor!.y + anchor!.height + 8))).toBeLessThanOrEqual(2);
  const viewport = page.viewportSize()!;
  expect(popup!.x).toBeGreaterThanOrEqual(0);
  expect(popup!.x + popup!.width).toBeLessThanOrEqual(viewport.width);
  expect(popup!.y + popup!.height).toBeLessThanOrEqual(viewport.height);
  expect(await list.evaluate(node => (node as HTMLElement).offsetParent)).toBeNull();
  await list.getByRole('option', { name: '24 hour', exact: true }).click();
  await expect(trigger).toContainText('24 hour');
  await expect.poll(() => commands.filter(command => command.type === 'settings.update').at(-1)?.payload.preferences).toMatchObject({ timeFormat: '24h' });
});

test('a dropdown opened during the dialog entrance re-anchors when the entrance ends', async ({ page }) => {
  const { dialog } = await openSettings(page);
  const trigger = dialog.getByRole('combobox', { name: 'Time format', exact: true });
  await trigger.click();
  const list = dialog.getByRole('listbox', { name: 'Time format', exact: true });
  await expect(list).toBeVisible();
  await expect.poll(async () => {
    const anchor = await trigger.boundingBox(), popup = await list.boundingBox();
    return Math.abs(popup!.x + popup!.width - (anchor!.x + anchor!.width)) <= 2 && Math.abs(popup!.y - (anchor!.y + anchor!.height + 8)) <= 2;
  }, { timeout: 3000 }).toBe(true);
  await list.getByRole('option', { name: '12 hour', exact: true }).click();
  await expect(trigger).toContainText('12 hour');
});

test('preferences and supported environment actions remain usable after search reset', async ({ page }) => {
  const { dialog, nav, search, snapshot, commands } = await openSettings(page);
  await search.fill('chat width');
  await dialog.getByRole('button', { name: /^Chat width/ }).click();
  await dialog.getByRole('combobox', { name: 'Chat width', exact: true }).click();
  await dialog.getByRole('option', { name: 'Full available width', exact: true }).click();
  await dialog.getByRole('button', {name:'Apply',exact:true}).click();
  await expect.poll(() => commands.filter(command => command.type === 'settings.update').map(command => command.payload.preferences)).toContainEqual(expect.objectContaining({ chatWidth: 'full' }));
  await expect(dialog.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Chat width', exact: true })).toContainText('Full available width');
  await nav.getByRole('button', { name: 'Models & Accounts', exact: true }).click();
  await dialog.getByText('Environment variables and advanced runtime settings',{exact:true}).click();
  await expect(search).toHaveValue('');
  const entry = { scope: 'device', name: 'EXAMPLE_VALUE', secret: false, updatedAt: '2026-11-05T00:00:00.000Z' };
  const mutations: { method: string; payload: Record<string, unknown> }[] = [];
  await page.route('**/api/environment', async route => {
    const request = route.request();
    mutations.push({ method: request.method(), payload: request.postDataJSON() });
    await route.fulfill({ json: { revision: mutations.length, entries: request.method() === 'PUT' ? [entry] : [], secretStorageAvailable: false } });
  });
  await dialog.getByLabel('Store as a protected secret', { exact: true }).uncheck();
  await dialog.getByLabel('Variable name', { exact: true }).fill('EXAMPLE_VALUE');
  await dialog.getByLabel('Value', { exact: true }).fill('synthetic-value');
  snapshot.seq++;
  await page.evaluate(seq => window.dispatchEvent(new CustomEvent('task-fixture-update', { detail: seq })), snapshot.seq);
  await expect(dialog.getByLabel('Value', { exact: true })).toHaveValue('synthetic-value');
  await dialog.getByRole('button', { name: 'Save variable', exact: true }).click();
  await expect(dialog.getByText('EXAMPLE_VALUE', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(dialog.getByText('No variables configured.', { exact: true })).toBeVisible();
  expect(mutations).toEqual([
    { method: 'PUT', payload: { scope: 'device', name: 'EXAMPLE_VALUE', value: 'synthetic-value', secret: false, baseRevision: 0 } },
    { method: 'DELETE', payload: { scope: 'device', name: 'EXAMPLE_VALUE', baseRevision: 1 } },
  ]);
});

for (const theme of ['dark', 'light'] as const) for (const zoom of [1, 1.25, 1.5]) {
  test(`${theme} navigation keeps selection, hover and keyboard focus separate at ${zoom * 100}% CSS zoom`, async ({ page }, info) => {
    const { dialog, nav } = await openSettings(page, theme);
    await page.evaluate(value => { document.documentElement.style.zoom = String(value); }, zoom);
    const labs = nav.getByRole('button', { name: 'Projects & Working Copies', exact: true }), about = nav.getByRole('button', { name: 'Source Control & Reviews', exact: true });
    await labs.click();
    await about.hover();
    await dialog.screenshot({ path: info.outputPath('navigation.png') });
    const selected = await labs.boundingBox(), hovered = await about.boundingBox();
    expect(hovered!.y - selected!.y - selected!.height).toBeGreaterThanOrEqual(4 * zoom - 0.1);
    await expect(nav.locator('[aria-current]')).toHaveCount(1);
    await expect(labs).toHaveAttribute('aria-current', 'page');
    await expect(about).not.toHaveAttribute('aria-current');
    const selectedStyle = await labs.evaluate(node => { const style = getComputedStyle(node); return [style.backgroundColor, style.boxShadow]; });
    await expect.poll(() => about.evaluate(node => { const style = getComputedStyle(node); return [style.backgroundColor, style.boxShadow]; })).not.toEqual(selectedStyle);
    await page.keyboard.press('Tab');
    await expect(about).toBeFocused();
    const focus = await about.evaluate(node => { const style = getComputedStyle(node); return { visible: node.matches(':focus-visible'), width: style.outlineWidth, offset: style.outlineOffset, style: style.outlineStyle, pixelRatio: devicePixelRatio }; });
    expect(focus.visible).toBe(true);
    expect(focus.style).toBe('solid');
    expect(parseFloat(focus.width) * zoom).toBeGreaterThanOrEqual(1.9);
    // CSS zoom can round outline width and offset differently; bound the outer edge in device pixels.
    const inset = -(parseFloat(focus.offset) + parseFloat(focus.width)) * zoom * focus.pixelRatio;
    expect(inset).toBeGreaterThanOrEqual(0);
    expect(inset).toBeLessThanOrEqual(1);
    await expect(labs).toHaveAttribute('aria-current', 'page');
    const geometry = await nav.getByRole('button').evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(node);
      const text = range.getBoundingClientRect();
      return { label: node.textContent, height: rect.height, width: rect.width, unclipped: text.left >= rect.left && text.right <= rect.right && text.top >= rect.top && text.bottom <= rect.bottom, overflow: node.scrollWidth > node.clientWidth };
    }));
    expect(geometry.filter(row => row.height < 32 * zoom - 0.1 || row.width < 32 * zoom - 0.1 || !row.unclipped || row.overflow)).toEqual([]);
    const longLabel = nav.getByRole('button', { name: 'Skills & Integrations' });
    await longLabel.evaluate(node => { node.textContent = 'Skills & Integrations with a longer localized label'; });
    await longLabel.scrollIntoViewIfNeeded();
    expect(await longLabel.evaluate(node => { const range = document.createRange(); range.selectNodeContents(node); const text = range.getBoundingClientRect(), rect = node.getBoundingClientRect(); return text.right <= rect.right && text.bottom <= rect.bottom && node.scrollWidth <= node.clientWidth; })).toBe(true);
    await dialog.screenshot({ path: info.outputPath('long-label.png') });
    await page.setViewportSize({width:1440,height:520});
    const search=dialog.getByRole('searchbox',{name:'Search all settings'});
    for(const label of ['Composer font','Code font','Chat width']){
      await search.fill(label);await dialog.getByRole('button',{name:new RegExp('^'+label)}).click();
      const field=dialog.getByRole('combobox',{name:label,exact:true});await expect(field).toBeFocused();
      const bounds=await field.boundingBox(),content=await dialog.locator('main').boundingBox(),frame=await dialog.boundingBox(),title=await dialog.getByRole('heading',{name:'Settings',exact:true}).boundingBox();
      expect(bounds!.y).toBeGreaterThanOrEqual(content!.y);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(content!.y+content!.height);expect(title!.y).toBeGreaterThanOrEqual(frame!.y);
    }
  });
}

test('appearance preview, cancel, failed apply and retry preserve accepted preferences', async ({ page }) => {
  const { dialog, nav, snapshot, commands } = await openSettings(page);
  await nav.getByRole('button', { name: 'Appearance', exact: true }).click();
  await dialog.getByRole('combobox', {name:'Density',exact:true}).click();
  await dialog.getByRole('option', {name:'Touch · 44 px',exact:true}).click();
  await dialog.getByRole('spinbutton', {name:'Chat size',exact:true}).fill('18');
  await dialog.getByRole('combobox', {name:'Chat width',exact:true}).click();
  await dialog.getByRole('option', {name:'Full available width',exact:true}).click();
  await dialog.getByRole('combobox', {name:'Motion',exact:true}).click();
  await dialog.getByRole('option', {name:'Off',exact:true}).click();
  await dialog.getByRole('button', {name:'Preview',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-density','touch');
  await expect(page.locator('.app-shell:not(.embedded-thread-app)')).toHaveAttribute('data-chat-width','full');
  await expect(page.locator('html')).toHaveAttribute('data-motion','off');
  expect(await page.locator('html').evaluate(node => node.style.getPropertyValue('--chat-font-size'))).toBe('18px');
  expect(commands.filter(command => command.type === 'settings.update')).toEqual([]);
  await dialog.getByRole('button', {name:'Cancel',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-density','comfortable');
  await expect(page.locator('.app-shell:not(.embedded-thread-app)')).toHaveAttribute('data-chat-width','wide');
  await dialog.getByRole('spinbutton', {name:'Chat size',exact:true}).fill('19');
  await page.route('**/api/commands', route => route.request().postDataJSON().type === 'settings.update' ? route.fulfill({status:503,json:{error:{message:'Synthetic save failure'}}}) : route.fallback());
  await dialog.getByRole('button', {name:'Apply',exact:true}).click();
  await expect(dialog.getByText('Appearance could not be saved. Your changes are ready to retry.',{exact:true})).toBeVisible();
  await expect(dialog.getByRole('spinbutton',{name:'Chat size',exact:true})).toHaveValue('19');
  expect(getPreferences(snapshot.settings).chatFontSize).toBe(14);
  await page.unroute('**/api/commands');
  await page.route('**/api/commands', async route => {
    const command=route.request().postDataJSON() as HostCommand; commands.push(command);
    if(command.type==='settings.update') snapshot.settings.preferences={...getPreferences(snapshot.settings),...command.payload.preferences as Partial<UiPreferences>};
    snapshot.seq++; await route.fulfill({json:{commandId:command.id,seq:snapshot.seq,result:{}}});
  });
  await dialog.getByRole('button',{name:'Apply',exact:true}).click();
  await expect.poll(()=>getPreferences(snapshot.settings).chatFontSize).toBe(19);
  await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-density','comfortable');
  expect(await page.locator('html').evaluate(node=>node.style.getPropertyValue('--chat-font-size'))).toBe('19px');
});

for(const theme of ['dark','light'] as const) test(`${theme} short narrow settings keep nav, controls and keyboard menus within the modal`,async({page},info)=>{
  await page.setViewportSize({width:520,height:520});
  const {dialog}=await openSettings(page,theme),sections=dialog.getByRole('combobox',{name:'Settings section',exact:true});
  await sections.focus();await sections.press('ArrowDown');await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await expect(dialog.getByRole('heading',{level:1})).toHaveText('Appearance');
  const density=dialog.getByRole('combobox',{name:'Density',exact:true});
  await density.focus(); await density.press('ArrowDown');
  const options=dialog.getByRole('listbox',{name:'Density',exact:true});
  await expect(options).toBeVisible();
  const rect=await options.boundingBox(); expect(rect!.x).toBeGreaterThanOrEqual(8);expect(rect!.x+rect!.width).toBeLessThanOrEqual(512);expect(rect!.y+rect!.height).toBeLessThanOrEqual(512);
  await page.keyboard.press('Escape');await expect(density).toBeFocused();
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  expect(await dialog.locator('main').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  await dialog.screenshot({path:info.outputPath('appearance-short-narrow.png')});
});

test('manual-browser start page persists and the injected adapter opens the accepted value',async({page})=>{
  const snapshot=taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Synthetic browser preference fixture'}}}});
  await serveTaskFixture(page,snapshot);
  await page.addInitScript(value=>Object.assign(window,{settingsFixture:value,openedUrls:[]}),snapshot);
  await page.route('**/api/commands',async route=>{
    const command=route.request().postDataJSON() as HostCommand;
    if(command.type==='settings.update') snapshot.settings.preferences={...getPreferences(snapshot.settings),...command.payload.preferences as Partial<UiPreferences>};
    snapshot.seq++;await route.fulfill({json:{commandId:command.id,seq:snapshot.seq,result:{}}});
  });
  const fixture='/@fs/'+resolve('tests/e2e/settings-manual-browser-fixture.tsx').replaceAll('\\','/');
  await page.route(url=>url.pathname==='/settings-manual-fixture',route=>route.fulfill({contentType:'text/html',body:`<html data-theme="dark"><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${encodeURI(fixture)}');</script></body></html>`}));
  await page.goto('/settings-manual-fixture');
  const dialog=page.getByRole('dialog',{name:'Settings',exact:true});
  await dialog.getByRole('textbox',{name:'Browser start page',exact:true}).fill('https://example.com/review');
  await dialog.getByRole('button',{name:'Save start page',exact:true}).click();
  await expect.poll(()=>getPreferences(snapshot.settings).browserStartUrl).toBe('https://example.com/review');
  await dialog.getByRole('textbox',{name:'Browser start page',exact:true}).fill('https://example.com/unsaved');
  await dialog.getByRole('button',{name:'Open browser',exact:true}).click();
  expect(await page.evaluate(()=>(window as unknown as {openedUrls:string[]}).openedUrls)).toEqual(['https://example.com/review']);
  await expect(dialog).toHaveCount(0);
});

for (const [theme, width] of [['dark', 1440], ['light', 1440], ['dark', 390], ['light', 390]] as const) test(`all Settings sections remain clear and reachable ${theme} ${width}`, async ({page}, info) => {
  await page.setViewportSize({width, height: 900}); await page.emulateMedia({reducedMotion: 'reduce'});
  const host = await openSettings(page, theme), picker = host.dialog.getByRole('combobox', {name: 'Settings section', exact: true});
  const sections = ['General', 'Appearance', 'Chat & Composer', 'Models & Accounts', 'Projects & Working Copies', 'Source Control & Reviews', 'Skills & Integrations', 'Notifications & Usage', 'Browser', 'Keyboard Shortcuts', 'Data & Recovery', 'About & Licenses'];
  if (width < 700) await expect(picker).toBeVisible(); else await expect(host.nav).toBeVisible();
  for (const [index, label] of sections.entries()) {
    if (width < 700) { await picker.click(); await host.dialog.getByRole('option', {name: label, exact: true}).click(); }
    else await host.nav.getByRole('button', {name: label, exact: true}).click();
    await expect(host.dialog.getByRole('heading', {level: 1})).toHaveText(label);
    if (width >= 700 && label === 'General') {
      expect((await host.dialog.boundingBox())!.width).toBeLessThanOrEqual(960);
      expect((await host.nav.getByRole('button',{name:'General',exact:true}).boundingBox())!.height).toBeLessThanOrEqual(36);
      expect((await host.dialog.locator('.settings-row').first().boundingBox())!.height).toBeLessThanOrEqual(66);
    }
    const tones = await host.dialog.evaluate((node, narrow) => {
      const label = node.querySelector(narrow ? '.settings-section-select .ui-select-trigger>span' : '.settings-navigation [aria-current="page"] span')!;
      const style = getComputedStyle(label), parent = getComputedStyle(label.parentElement!), probe=document.createElement('span');
      probe.style.color=getComputedStyle(node).getPropertyValue('--text').trim();node.append(probe);const neutral=getComputedStyle(probe).color;probe.remove();
      return {label:style.color,parent:parent.color,background:style.backgroundColor,heading:getComputedStyle(node.querySelector('h1')!).color,neutral};
    }, width < 700);
    expect(tones.background).toBe('rgba(0, 0, 0, 0)');expect(tones.label).toBe(tones.parent);expect(tones.heading).toBe(tones.neutral);
    expect(await host.dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    if (process.env.HARNESS_CAPTURE_UI === '1' && ((theme === 'dark' && width === 1440) || label === 'Models & Accounts' || (label === 'Appearance' && width === 390 && theme === 'light') || (label === 'General' && width === 1440 && theme === 'light'))) await host.dialog.screenshot({path: info.outputPath(`settings-${theme}-${width}-${index}.png`)});
  }
  expect(host.commands.filter(command => command.type === 'settings.update' || command.type.startsWith('account.') || command.type === 'message.send')).toEqual([]);
  await page.keyboard.press('Escape'); await expect(host.dialog).toHaveCount(0); await expect(host.composer).toHaveValue('Retain this conversation draft');
});


for (const theme of ['dark','light'] as const) test(`keyboard focus stays neutral without section frames or composer glow in ${theme}`,async({page})=>{
  const host=await openSettings(page,theme);
  host.snapshot.settings.preferences={...getPreferences(host.snapshot.settings),customAccent:'#c026d3'};await host.publish();
  await expect.poll(()=>page.locator('html').evaluate(node=>node.style.getPropertyValue('--project-accent-ink'))).toBe('#c026d3');
  await host.search.focus();await page.keyboard.press('Tab');await host.search.focus();
  const search=await host.search.evaluate(node=>{const label=node.closest('label')!,probe=document.createElement('span');probe.style.color='var(--ui-focus-ring)';label.append(probe);const neutral=getComputedStyle(probe).color;probe.remove();const style=getComputedStyle(label);return{neutral,color:style.outlineColor,style:style.outlineStyle,width:style.outlineWidth};});
  expect(search.color).toBe(search.neutral);expect(search.style).toBe('solid');expect(search.width).toBe('2px');
  const button=host.nav.getByRole('button',{name:'General',exact:true});await button.focus();
  expect(await button.evaluate(node=>getComputedStyle(node).outlineColor)).toBe(search.neutral);
  await page.keyboard.press('Escape');await expect(host.dialog).toHaveCount(0);await host.composer.focus();
  const composer=await host.composer.evaluate(node=>{const style=getComputedStyle(node.closest('.composer')!);return{border:style.borderColor,shadow:style.boxShadow};});
  expect(composer).toEqual({border:search.neutral,shadow:'none'});await expect(host.composer).toHaveValue('Retain this conversation draft');
  await host.composer.blur();const box=page.locator('form.composer:visible');await box.dispatchEvent('dragover');await expect(box).toHaveClass(/dragging/);
  expect(await box.evaluate(node=>getComputedStyle(node).borderColor)).toBe(search.neutral);
  const drop=await box.evaluate(node=>{const probe=document.createElement('span');probe.style.background='var(--hover)';node.append(probe);const neutral=getComputedStyle(probe).backgroundColor;probe.remove();return{neutral,paint:getComputedStyle(node).backgroundColor};});expect(drop.paint).toBe(drop.neutral);
  await box.dispatchEvent('dragleave');await expect(box).not.toHaveClass(/dragging/);await expect(host.composer).toHaveValue('Retain this conversation draft');
});


test.describe('touch Settings targets',()=>{
  test.use({hasTouch:true,isMobile:true,viewport:{width:390,height:844}});
  test('compact navigation preserves full search and section-picker touch targets',async({page})=>{
    const host=await openSettings(page),picker=host.dialog.getByRole('combobox',{name:'Settings section',exact:true});await host.dialog.evaluate(node=>Promise.all(node.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
    expect((await host.dialog.locator('.settings-search').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await picker.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await picker.tap();const option=host.dialog.getByRole('option',{name:'Appearance',exact:true});await expect(option).toBeVisible();await option.evaluate(node=>Promise.all(node.parentElement!.getAnimations().map(animation=>animation.finished)));expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(44);await option.tap();
    await expect(host.dialog.getByRole('heading',{level:1})).toHaveText('Appearance');
    expect(await host.dialog.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  });
  test('advanced runtime disclosure keeps a full touch target on wide layouts',async({page})=>{
    await page.setViewportSize({width:1440,height:1000});const host=await openSettings(page);
    await host.nav.getByRole('button',{name:'Models & Accounts',exact:true}).tap();
    const summary=host.dialog.locator('.settings-runtime-details>summary');await expect(summary).toBeVisible();
    expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);await summary.tap();
    await expect(host.dialog.getByText('No variables configured.',{exact:true})).toBeVisible();
  });
});
