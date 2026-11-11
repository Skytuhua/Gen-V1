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

async function installManualBrowserFixture(page:Page){
  await page.addInitScript(()=>{
    const context={windowId:'main',surface:{kind:'main'},windows:[]},calls:unknown[]=[];
    (window as unknown as {manualBrowserCalls:unknown[]}).manualBrowserCalls=calls;
    window.harnessDesktop={getContext:async()=>context,ready:async()=>context,list:async()=>[],reattach:async()=>{},minimize:async()=>{},resetBounds:async()=>{},focus:async()=>{},browser:async(value:unknown)=>{calls.push(value);},onState:()=>()=>{},onCloseRequested:()=>()=>{},onWorkspaceChanged:()=>()=>{}} as unknown as NonNullable<Window['harnessDesktop']>;
  });
}

test('browser launch leaves the draft and owning modal intact when its save guard rejects',async({page})=>{
  await installManualBrowserFixture(page);const {dialog,nav}=await openSettings(page);
  await page.evaluate(async()=>{const path='/src/editor-handoff.ts';const module=await import(path);module.registerEditorHandoff('synthetic-browser-block',async()=>{throw Error('Keep this draft safe');});});
  await nav.getByRole('button',{name:'Browser',exact:true}).click();await dialog.getByRole('button',{name:'Open browser',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('Keep this draft safe');await expect(dialog).toBeVisible();
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
  await expect(dialog.getByText('No variables configured.', { exact: true })).toBeVisible();
  await dialog.screenshot({ path: info.outputPath('environments.png') });
  expect(await scalarText(dialog.locator('main'))).toEqual([]);
  for (const label of await nav.getByRole('button').allTextContents()) {
    await nav.getByRole('button', { name: label, exact: true }).click();
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(dialog.getByRole('heading', { level: 1, name: label, exact: true })).toBeVisible();
    expect(await scalarText(dialog.locator('main')), `${label}: blank`).toEqual([]);
    await search.fill('chat width');
    await expect(dialog.getByRole('combobox', {name:'Chat width',exact:true})).toBeVisible();
    await expect(nav.locator('[aria-current]')).toHaveCount(0);
    expect(await scalarText(dialog.locator('main')), `${label}: matching`).toEqual([]);
    await search.fill('no-match-9f8c7b6a');
    if (label !== 'Skills & Integrations') await expect(dialog.getByText('No matching settings.', { exact: true })).toBeVisible();
    expect(await scalarText(dialog.locator('main')), `${label}: empty results`).toEqual([]);
    await search.fill('   ');
    await expect(nav.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
    expect(await scalarText(dialog.locator('main')), `${label}: reset`).toEqual([]);
  }
  await nav.getByRole('button', { name: 'About & Licenses', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Gen updates' })).toBeVisible();
  await search.fill('update');
  await expect(dialog.getByRole('region', { name: 'Gen updates' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(composer).toHaveValue('Retain this conversation draft');
});

test('dropdown popovers anchor to their trigger inside the settings dialog with default motion', async ({ page }) => {
  const { dialog, commands } = await openSettings(page);
  // Let the entrance animation finish; a forwards-filled transform used to keep the dialog
  // as the containing block for the fixed popover, shifting it and clipping it at the dialog edge.
  await page.waitForTimeout(300);
  const trigger = dialog.getByRole('combobox', { name: 'Time format', exact: true });
  await trigger.click();
  const list = dialog.getByRole('listbox', { name: 'Time format', exact: true });
  await expect(list).toBeVisible();
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
  await dialog.getByRole('combobox', { name: 'Chat width', exact: true }).click();
  await dialog.getByRole('option', { name: 'Full available width', exact: true }).click();
  await dialog.getByRole('button', {name:'Apply',exact:true}).click();
  await expect.poll(() => commands.filter(command => command.type === 'settings.update').map(command => command.payload.preferences)).toContainEqual(expect.objectContaining({ chatWidth: 'full' }));
  await expect(dialog.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Chat width', exact: true })).toContainText('Full available width');
  await nav.getByRole('button', { name: 'Models & Accounts', exact: true }).click();
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
    const labs = nav.getByRole('button', { name: 'Data & Recovery', exact: true }), about = nav.getByRole('button', { name: 'About & Licenses', exact: true });
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
  await expect(page.locator('.app-shell')).toHaveAttribute('data-chat-width','full');
  await expect(page.locator('html')).toHaveAttribute('data-motion','off');
  expect(await page.locator('html').evaluate(node => node.style.getPropertyValue('--chat-font-size'))).toBe('18px');
  expect(commands.filter(command => command.type === 'settings.update')).toEqual([]);
  await dialog.getByRole('button', {name:'Cancel',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-density','comfortable');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-chat-width','wide');
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
  const {dialog,nav}=await openSettings(page,theme);
  await nav.getByRole('button',{name:'Appearance',exact:true}).click();
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
