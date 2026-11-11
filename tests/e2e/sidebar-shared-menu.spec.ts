import {test, expect, type Page} from '@playwright/test';
import {resolve} from 'node:path';
import {expectOpaqueEntry, expectVisibleKeyboardFocus, pauseNextEntry} from './overlay-motion-assertions';

const fixture = '/@fs/' + encodeURI(resolve(import.meta.dirname, 'sidebar-shared-menu-fixture.tsx').replaceAll('\\', '/'));
const calls = (page: Page) => page.evaluate(() => (window as unknown as {sidebarMenuCalls: unknown[]}).sidebarMenuCalls);
const options = (page: Page, title = 'Other conversation') => page.getByRole('button', {name: `Options for ${title}`, exact: true});
const menu = (page: Page, title = 'Other conversation') => page.getByRole('menu', {name: `Options for ${title}`, exact: true});
for (const width of [1024, 1440]) test(`sidebar focus and hover cards stay opaque throughout entry at ${width}px`, async ({page}) => {
  await page.setViewportSize({width, height: 1000});
  const row = page.getByRole('button', {name: 'Other conversation Working', exact: true});
  const card = page.getByRole('dialog', {name: 'Thread details: Other conversation', exact: true});
  await pauseNextEntry(page, '.thread-hover-card[data-state="open"]');
  await row.focus(); await expectVisibleKeyboardFocus(row); await expectOpaqueEntry(card);
  await row.press('Escape'); await expect(card).toHaveCount(0);
  await page.getByRole('button', {name: 'Outside target', exact: true}).focus();
  await pauseNextEntry(page, '.thread-hover-card[data-state="open"]'); await row.hover();
  await expect(card).toBeVisible(); await expectOpaqueEntry(card);
});
test.beforeEach(async ({page}) => {
  await page.route('**/api/**', route => route.fulfill({json: {}}));
  await page.route('**/sidebar-shared-menu-check*', route => route.fulfill({contentType: 'text/html', body: `<html data-theme="${new URL(route.request().url()).searchParams.get('theme') === 'light' ? 'light' : 'dark'}"><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${fixture}');</script></body></html>`}));
  await page.goto('/sidebar-shared-menu-check');
});

test('options open a shared menu without selecting or detaching its thread', async ({page}) => {
  await options(page).click();
  await expect(menu(page)).toBeVisible();
  await expect(options(page)).toHaveAttribute('aria-haspopup', 'menu');
  await expect(menu(page).getByRole('menuitem')).toHaveText(['Place in workspaceAlt Enter', 'Rename thread', 'Pin thread', 'Mark as unread', 'Settle thread', 'Move to top', 'Move to bottom', 'Archive thread']);
  await expect(menu(page).getByRole('menuitem', {name: 'Place in workspace'}).locator('kbd')).toHaveText('Alt Enter');
  expect(await calls(page)).toEqual([]);
  await expect(page.locator('.thread-item[aria-current="page"]')).toHaveAttribute('aria-label', 'Selected conversation Ready');
});

test('keyboard navigation skips disabled archive, supports typeahead and ignores IME', async ({page}) => {
  const trigger = options(page);
  await trigger.focus(); await page.keyboard.press('ArrowUp');
  await expect(menu(page).getByRole('menuitem', {name: 'Move to bottom'})).toBeFocused();
  const archive = menu(page).getByRole('menuitem', {name: 'Archive thread'});
  await expect(archive).toBeDisabled();
  await expect(archive).toHaveAttribute('title', 'Stop the task before archiving.');
  await archive.dispatchEvent('click'); expect(await calls(page)).toEqual([]);
  await page.keyboard.press('Home'); await expect(menu(page).getByRole('menuitem', {name: 'Place in workspace'})).toBeFocused();
  await page.keyboard.press('ArrowUp'); await expect(menu(page).getByRole('menuitem', {name: 'Move to bottom'})).toBeFocused();
  await page.keyboard.press('r'); const rename = menu(page).getByRole('menuitem', {name: 'Rename thread'}); await expect(rename).toBeFocused();
  for (const key of ['Enter', ' ', 'Escape', 'ArrowDown', 'p']) await rename.dispatchEvent('keydown', {key, isComposing: true});
  await rename.dispatchEvent('keydown', {key: 'Enter', keyCode: 229});
  await expect(rename).toBeFocused(); await expect(menu(page)).toBeVisible(); expect(await calls(page)).toEqual([]);
  await page.keyboard.press('Escape'); await expect(menu(page)).toHaveCount(0); await expect(trigger).toBeFocused();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Tab'); await expect(menu(page)).toHaveCount(0);
  await expect(trigger).not.toBeFocused();
  await trigger.click(); await page.getByRole('button', {name: 'Outside target', exact: true}).click();
  await expect(menu(page)).toHaveCount(0); await expect(page.getByRole('button', {name: 'Outside target', exact: true})).toBeFocused();
});

for (const [label, value] of [['Pin thread', {pinned: true}], ['Mark as unread', {unread: true}], ['Settle thread', {settled: true}], ['Move to top', {order: -51}], ['Move to bottom', {order: 81}]] as const) {
  test(`${label} preserves the exact thread owner and presentation payload`, async ({page}) => {
    await options(page).click(); await menu(page).getByRole('menuitem', {name: label, exact: true}).click();
    expect(await calls(page)).toEqual([{presentation: expect.objectContaining({id: 'thread-1', projectId: 'project-1', workspaceId: 'copy-1', runId: 'run-other'}), value}]);
    await expect(menu(page)).toHaveCount(0); await expect(options(page)).toBeFocused();
  });
}

test('inverse flags and fallback ordering preserve existing payloads', async ({page}) => {
  await page.goto('/sidebar-shared-menu-check?flags&fallback');
  for (const label of ['Unpin thread', 'Mark as read', 'Return to inbox', 'Move to top', 'Move to bottom']) {
    await options(page).click(); await menu(page).getByRole('menuitem', {name: label, exact: true}).click();
  }
  expect((await calls(page)).map(value => (value as {value: unknown}).value)).toEqual([{pinned: false}, {unread: false}, {settled: false}, {order: -5}, {order: 1}]);
});

test('placement and rename hand off the original owner while runless working archive stays enabled', async ({page}) => {
  for (const label of ['Place in workspace', 'Rename thread']) {
    await options(page).click(); await menu(page).getByRole('menuitem', {name: label, exact: true}).click();
  }
  const working = 'Working without run';
  await options(page, working).click(); await menu(page, working).getByRole('menuitem', {name: 'Archive thread'}).click();
  expect(await calls(page)).toEqual([{place: expect.objectContaining({id: 'thread-1', projectId: 'project-1', workspaceId: 'copy-1'})}, {rename: expect.objectContaining({id: 'thread-1', projectId: 'project-1', workspaceId: 'copy-1'})}, {archive: 'thread-2'}]);
  await expect(options(page, working)).toBeFocused();
  await page.getByRole('button', {name: 'Other conversation Working', exact: true}).focus(); await page.keyboard.press('Alt+Enter');
  expect(await calls(page)).toHaveLength(4);
  expect((await calls(page))[3]).toEqual({place: expect.objectContaining({id: 'thread-1', workspaceId: 'copy-1'})});
});

test('Custom has no placement action or shortcut and row context keys add no menu', async ({page}) => {
  await page.goto('/sidebar-shared-menu-check?custom');
  const row = page.getByRole('button', {name: 'Other conversation Working', exact: true});
  await row.dispatchEvent('contextmenu'); await row.focus(); await page.keyboard.press('Shift+F10');
  await row.dispatchEvent('keydown', {key: 'ContextMenu'}); await expect(page.getByRole('menu')).toHaveCount(0);
  await page.keyboard.press('Alt+Enter'); expect(await calls(page)).toEqual([]);
  await expect(row).not.toHaveAttribute('aria-keyshortcuts');
  await options(page).click(); await expect(menu(page).getByRole('menuitem', {name: 'Place in workspace'})).toHaveCount(0);
});

test('hover is suppressed while the menu is open and drag retains its scoped payload', async ({page}) => {
  const row = page.getByRole('button', {name: 'Other conversation Working', exact: true});
  await row.hover(); await expect(page.locator('.thread-hover-card[data-state="open"]')).toBeVisible();
  await options(page).click(); await expect(menu(page)).toBeVisible();
  await expect(page.locator('.thread-hover-card[data-state="open"]')).toHaveCount(0);
  await row.hover(); await expect(page.locator('.thread-hover-card[data-state="open"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  const payload = await row.evaluate(node => {const dataTransfer = new DataTransfer(); node.dispatchEvent(new DragEvent('dragstart', {bubbles: true, dataTransfer})); const value = dataTransfer.getData('application/x-gen-thread'); node.dispatchEvent(new DragEvent('dragend', {bubbles: true, dataTransfer})); return JSON.parse(value);});
  expect(payload).toEqual({threadId: 'thread-1', binding: {authority: {kind: 'local'}, threadId: 'thread-1', projectId: 'project-1'}});
  expect(await calls(page)).toEqual([]);
});

test('hover reads keep the thread project scope and side or delegate copies never start personal reads', async ({page}) => {
  const reads: string[] = [];
  await page.route('**/api/projects/**', route => {reads.push(new URL(route.request().url()).pathname + new URL(route.request().url()).search); return route.fulfill({json: {}});});
  for (const title of ['Side conversation Ready', 'Delegate conversation Ready']) {
    await page.getByRole('button', {name: title, exact: true}).hover();
    await expect(page.locator('.thread-hover-card[data-state="open"]')).toContainText(title.replace(' Ready', ''));
    await page.mouse.move(700, 600);
    await expect(page.locator('.thread-hover-card[data-state="open"]')).toHaveCount(0);
  }
  expect(reads).toEqual([]);
  await page.getByRole('button', {name: 'Other conversation Working', exact: true}).hover();
  await expect.poll(() => reads.length).toBe(2);
  expect(reads.sort()).toEqual(['/api/projects/project-1/context?threadId=thread-1', '/api/projects/project-1/pull-requests?linked=1&threadId=thread-1']);
  expect(await calls(page)).toEqual([]);
});

test('fold, hide, collapse and removed owners dismiss without leaving a popup', async ({page}) => {
  await page.goto('/sidebar-shared-menu-check?flags');
  await options(page).focus(); await page.keyboard.press('ArrowDown');
  await page.getByRole('button', {name: /^Pinned/}).click(); await expect(page.getByRole('menu')).toHaveCount(0);
  for (const [query, action] of [['mobile', 'Hide mobile sidebar'], ['', 'Collapse sidebar'], ['', 'Remove threads']]) {
    await page.goto('/sidebar-shared-menu-check?' + query); await options(page).focus(); await page.keyboard.press('ArrowDown');
    await page.getByRole('button', {name: action, exact: true}).last().evaluate(node => (node as HTMLButtonElement).click());
    await expect(page.getByRole('menu')).toHaveCount(0);
    expect(await calls(page)).toEqual([]);
  }
});

test('short viewport keeps the portalled menu bounded and its last enabled item reachable', async ({page}, info) => {
  await page.setViewportSize({width: 760, height: 240}); await options(page).click();
  const popup = menu(page); await expect(popup).toBeVisible();
  const box = (await popup.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(8); expect(box.y).toBeGreaterThanOrEqual(8);
  expect(box.x + box.width).toBeLessThanOrEqual(752); expect(box.y + box.height).toBeLessThanOrEqual(232);
  await page.keyboard.press('End'); const last = popup.getByRole('menuitem', {name: 'Move to bottom'}); await expect(last).toBeFocused();
  const lastBox = (await last.boundingBox())!; expect(lastBox.y).toBeGreaterThanOrEqual(box.y); expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(box.y + box.height);
  await page.screenshot({path: info.outputPath('short-sidebar-menu.png')});
});

for (const theme of ['dark', 'light']) test(`${theme} menu retains shared surface colors and the compact trigger`, async ({page}, info) => {
  await page.goto('/sidebar-shared-menu-check?theme=' + theme); await options(page).click();
  await expect(menu(page)).toHaveCSS('background-color', theme === 'dark' ? 'rgb(15, 15, 15)' : 'rgb(255, 255, 255)');
  expect((await options(page).boundingBox())!.width).toBe(23);
  expect((await options(page).boundingBox())!.height).toBe(23);
  await page.screenshot({path: info.outputPath(`${theme}-sidebar-menu.png`)});
});
