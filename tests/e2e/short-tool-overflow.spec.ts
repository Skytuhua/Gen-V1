import {test, expect, type Page} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {taskFixture, serveTaskFixture} from './task-interface-fixture';

async function fixture(page: Page, width: number, height: number, artifact = false) {
  await page.setViewportSize({width, height});
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.addInitScript((selectedArtifact: boolean) => {
    localStorage.setItem('harness:workspace-mode:v3', 'chat');
    localStorage.setItem('harness:selected-thread', 'task-thread');
    localStorage.setItem('harness:shell-layout:v1', JSON.stringify({sidebarCollapsed: true, rightPanelOpen: selectedArtifact, activeTab: 'artifact', activeArtifactId: selectedArtifact ? 'task-surface' : null}));
    const context = {windowId: 'main', nativeTitleBar: true, surface: {kind: 'main'}, windows: [{id: 'main', surface: {kind: 'main'}, ready: true, minimized: false}], dockedBrowser: {browserId: 'browser', state: {url: 'about:blank', title: 'Browser', loading: false, canGoBack: false, canGoForward: false}}};
    const calls: Record<string, unknown>[] = [];
    const listeners = new Set<(value: unknown) => void>();
    Object.assign(window, {shortToolCalls: calls, setShortToolBrowserVisible: (visible: boolean) => {for (const listener of listeners) listener({...context, dockedBrowser: visible ? context.dockedBrowser : undefined});}, harnessDesktop: {getContext: async () => context, ready: async () => context, setTheme: async () => {}, onState: (listener: (value: unknown) => void) => {listeners.add(listener); return () => listeners.delete(listener);}, onCloseRequested: () => () => {}, browser: async (value: Record<string, unknown>) => {calls.push(value);}, focus: async () => {}, list: async () => context.windows}});
  }, artifact);
  const snapshot = taskFixture({root: 'text', elements: {text: {type: 'Text', props: {text: 'Synthetic geometry fixture'}}}});
  if (!artifact) {snapshot.artifacts = []; snapshot.messages = []; snapshot.userStates = []; snapshot.data = [];}
  await serveTaskFixture(page, snapshot);
  await page.route('**/api/workspace', route => route.fulfill({json: {projects: [], state: {version: 1, revision: 0, activeCanvasId: 'main', canvases: [{id: 'main', name: 'Workspace', preset: 'workspace', panels: [], viewport: {x: 0, y: 0, zoom: 1}}], profiles: [], disabledKinds: [], integrations: {}}}}));
  await page.route('**/api/plugins', route => route.fulfill({json: {plugins: []}}));
  const module = '/@fs/' + encodeURI(fileURLToPath(new URL('./workspace-app-fixture.tsx', import.meta.url)).replaceAll('\\', '/'));
  await page.route('**/short-tools', route => route.fulfill({contentType: 'text/html', body: `<html><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${module}');</script></body></html>`}));
  await page.goto('/short-tools');
  await expect(page.getByRole('textbox', {name: 'Message', exact: true})).toBeVisible();
  await expect(page.locator('.desktop-browser-native')).toHaveCount(1);
}
async function geometry(page: Page) {
  return page.evaluate(() => {
    const rect = (selector: string) => {const node = document.querySelector(selector); if (!node) return null; const box = node.getBoundingClientRect(); return {top: box.top, bottom: box.bottom, height: box.height, left: box.left, right: box.right};};
    const owner = document.querySelector('.shell-workarea')!;
    return {switcher: rect('.workspace-switcher')!, owner: rect('.shell-workarea')!, browser: rect('.desktop-browser-native')!, dock: rect('.desktop-browser-dock')!, panel: rect('.workspace-panel-content'), documentOverflow: document.documentElement.scrollWidth - innerWidth, scrollHeight: owner.scrollHeight, clientHeight: owner.clientHeight};
  });
}

for (const both of [false, true]) test(`cold short window keeps ${both ? 'both tool bodies' : 'Browser content'} reachable without resizing`, async ({page}) => {
  await fixture(page, 600, 400);
  const message = page.getByRole('textbox', {name: 'Message', exact: true});
  await message.fill('Retain the anchored draft');
  await message.evaluate(node => {Object.assign(window, {shortToolOriginalComposer: node});});
  if (both) await page.getByRole('button', {name: 'Open workspace panel', exact: true}).click();
  await expect.poll(async () => (await geometry(page)).browser.height).toBeGreaterThanOrEqual(128);
  if (both) await expect.poll(async () => (await geometry(page)).panel?.height ?? 0).toBeGreaterThanOrEqual(128);
  await page.locator('.desktop-browser-native').scrollIntoViewIfNeeded();
  await expect.poll(async () => {
    const g = await geometry(page);
    return g.browser.top >= g.switcher.bottom && g.browser.bottom <= g.owner.bottom + 1;
  }).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const calls = Reflect.get(window, 'shortToolCalls') as {type: string; bounds?: {height: number}}[];
    return calls.filter(call => call.type === 'bounds').at(-1)?.bounds?.height ?? 0;
  })).toBeGreaterThanOrEqual(128);
  const g = await geometry(page);
  expect(g.owner.top).toBeGreaterThanOrEqual(g.switcher.bottom - 1);
  expect(g.documentOverflow).toBeLessThanOrEqual(1);
  if (both) {
    await page.getByRole('button', {name: 'Close workspace panel', exact: true}).click();
    await expect(page.locator('.workspace-right')).toHaveCount(0);
    await expect.poll(async () => (await geometry(page)).scrollHeight).toBeLessThan(g.scrollHeight);
  }
  await message.scrollIntoViewIfNeeded();
  await expect(message).toHaveValue('Retain the anchored draft');
  expect(await message.evaluate(node => Reflect.get(window, 'shortToolOriginalComposer') === node)).toBe(true);
});

for (const size of [{width: 600, height: 500}, {width: 1440, height: 900}]) test(`retains useful content at ${size.width} by ${size.height}`, async ({page}) => {
  await fixture(page, size.width, size.height);
  await expect.poll(async () => (await geometry(page)).browser.height).toBeGreaterThanOrEqual(128);
  await page.locator('.desktop-browser-native').scrollIntoViewIfNeeded();
  const g = await geometry(page);
  expect(g.documentOverflow).toBeLessThanOrEqual(1);
  expect(g.browser.top).toBeGreaterThanOrEqual(g.switcher.bottom);
  expect(g.browser.bottom).toBeLessThanOrEqual(g.owner.bottom + 1);
});

for (const theme of ['dark', 'light']) for (const zoom of [1.25, 1.5]) test(`${theme} short stack remains reachable at CSS zoom ${zoom}`, async ({page}) => {
  await fixture(page, 750, 600);
  await page.evaluate(({theme, zoom}) => {document.documentElement.dataset.theme = theme; document.documentElement.style.zoom = String(zoom);}, {theme, zoom});
  await page.getByRole('button', {name: 'Open workspace panel', exact: true}).click();
  await expect.poll(async () => (await geometry(page)).panel?.height ?? 0).toBeGreaterThanOrEqual(128);
  await page.locator('.desktop-browser-native').scrollIntoViewIfNeeded();
  await expect.poll(async () => {
    const g = await geometry(page);
    return g.browser.top >= g.switcher.bottom - 1 && g.browser.bottom <= g.owner.bottom + 1 && g.documentOverflow <= 1;
  }).toBe(true);
});

test('removing Browser before the panel releases its normal-flow space without replacing chat', async ({page}) => {
  await fixture(page, 600, 400);
  const message = page.getByRole('textbox', {name: 'Message', exact: true}); await message.fill('Still the same conversation');
  await page.getByRole('button', {name: 'Open workspace panel', exact: true}).click();
  const before = await geometry(page);
  await page.evaluate(() => Reflect.get(window, 'setShortToolBrowserVisible')(false));
  await expect(page.locator('.desktop-browser-dock')).toHaveCount(0);
  await expect.poll(() => page.locator('.shell-workarea').evaluate(node => node.scrollHeight)).toBeLessThan(before.scrollHeight);
  await expect(page.locator('.workspace-panel-content')).toHaveCount(1);
  await page.getByRole('button', {name: 'Close workspace panel', exact: true}).click();
  await expect(page.locator('.workspace-tools')).toHaveCount(0);
  await message.scrollIntoViewIfNeeded(); await expect(message).toHaveValue('Still the same conversation');
});

test('keeps the selected artifact in its scrolled owner without remounting or painting outside the tool area', async ({page}) => {
  await fixture(page, 600, 400, true);
  const artifact = page.locator('.artifact-in-workspace');
  await expect(artifact).toHaveCount(1);
  await artifact.evaluate(node => Object.assign(window, {originalShortArtifact: node}));
  await page.locator('.shell-workarea').evaluate(node => {node.scrollTop = 150;});
  await expect.poll(() => artifact.evaluate(node => {
    const box = node.getBoundingClientRect(), body = document.querySelector('.workspace-panel-content')!.getBoundingClientRect(), owner = document.querySelector('.shell-workarea')!.getBoundingClientRect();
    return box.top >= Math.max(body.top, owner.top) && box.bottom <= Math.min(body.bottom, owner.bottom) && box.height > 0;
  })).toBe(true);
  await page.locator('.shell-workarea').evaluate(node => {node.scrollTop = 0;});
  await expect.poll(() => artifact.evaluate(node => {
    const box = node.getBoundingClientRect(), body = document.querySelector('.workspace-panel-content')!.getBoundingClientRect(), owner = document.querySelector('.shell-workarea')!.getBoundingClientRect();
    const top = Math.max(0, body.top, owner.top), bottom = Math.min(innerHeight, body.bottom, owner.bottom);
    const hidden = getComputedStyle(node).visibility === 'hidden' || getComputedStyle(node).display === 'none';
    return bottom - top <= 24 ? hidden : hidden || box.top >= top && box.bottom <= bottom && box.height > 0;
  })).toBe(true);
  await page.locator('.workspace-panel-content').scrollIntoViewIfNeeded();
  await expect(artifact).toBeVisible();
  expect(await artifact.evaluate(node => Reflect.get(window, 'originalShortArtifact') === node)).toBe(true);
});

test('keeps the permanent sidebar recovery target clear of workspace navigation', async ({page}) => {
  await fixture(page, 600, 400);
  const recovery = page.locator('.sidebar-recovery'); await expect(recovery).toHaveCount(1);
  const workspace = page.locator('.workspace-switcher').getByRole('button', {name: 'Workspace', exact: true});
  const a = (await recovery.boundingBox())!, b = (await workspace.boundingBox())!;
  const context = await recovery.evaluate(node => ({parent: node.parentElement?.className, ancestor: node.parentElement?.parentElement?.className, switcherParent: document.querySelector('.workspace-switcher')?.parentElement?.className, padding: getComputedStyle(document.querySelector('.workspace-switcher')!).paddingLeft}));
  expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, JSON.stringify({a, b, context})).toBe(true);
});


test('artifact dock follows a tool entrance transform without losing its scrolled viewport intersection', async ({page}) => {
  await fixture(page, 1440, 900, true);
  const artifact = page.locator('.artifact-in-workspace');
  await expect(artifact).toBeVisible();
  await page.addStyleTag({content: '@keyframes testToolEntrance {from {transform: translateX(72px)} to {transform: translateX(0)}} .workspace-right.test-tool-entrance {animation: testToolEntrance 1200ms linear !important}'});
  await page.locator('.workspace-panel-content').evaluate(async body => {
    body.parentElement!.classList.add('test-tool-entrance');
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  });
  const delta = await artifact.evaluate(node => node.getBoundingClientRect().left - document.querySelector('.workspace-panel-content')!.getBoundingClientRect().left - 12);
  expect(Math.abs(delta)).toBeLessThanOrEqual(3);
});
