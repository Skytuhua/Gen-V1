import {expect, test, type Locator, type Page} from '@playwright/test';
import {mkdir, readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {serveTaskFixture, taskFixture} from './task-interface-fixture';
import {planDataId, PLANNING_PROVENANCE} from '../../packages/contracts/planning';
import {createSplitWorkspaceLayout, applySplitWorkspaceCommand} from '../../packages/core/split-workspace-layout';

const captures = resolve(process.env.GEN_VISUAL_MATRIX_DIR ?? '.harness-visual-matrix/captures');
const sections = ['General', 'Appearance', 'Chat & Composer', 'Models & Accounts', 'Projects & Working Copies', 'Source Control & Reviews', 'Skills & Integrations', 'Notifications & Usage', 'Browser', 'Keyboard Shortcuts', 'Data & Recovery', 'About & Licenses'];
const surfaces = ['split', 'docked', 'floating', 'overview', 'full-plan', 'inbox', ...sections.map(section => `settings-${section}`)];
const viewports = {standard: {width: 1280, height: 800}, large: {width: 1920, height: 1080}, narrow: {width: 700, height: 844}, short: {width: 1280, height: 600}};
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');

async function fixtureModule(page: Page, module: string, theme: string) {
  const style = module === 'fixtures/inbox-controls.tsx' ? (await readFile(resolve('tests/e2e/fixtures/inbox-controls.html'), 'utf8')).match(/<style>(.*?)<\/style>/s)?.[0] ?? '' : '';
  await page.route('**/visual-matrix', route => route.fulfill({contentType: 'text/html', body: `<html data-theme="${theme}"><meta name="viewport" content="width=device-width, initial-scale=1">${style}<body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('/@fs/${resolve('tests/e2e', module)}');</script></body></html>`}));
  await page.goto('/visual-matrix');
}

async function render(page: Page, surface: string, theme: 'dark' | 'light', captureName: string) {
  const snapshot = taskFixture({root: 'text', elements: {text: {type: 'Text', props: {text: 'Synthetic visual acceptance fixture'}}}});
  snapshot.artifacts = []; snapshot.settings.theme = theme;
  snapshot.settings.preferences = {showUsageFooter: false};
  snapshot.threads[0].title = 'Workspace acceptance';
  if (surface === 'docked') {
    snapshot.threads.push({...snapshot.threads[0], id: 'docked-thread', title: 'Docked investigation'});
    snapshot.messages.push({...snapshot.messages[0], id: 'docked-message', threadId: 'docked-thread', content: 'This conversation has its own docked body and composer.'});
  }
  snapshot.data.push({id: planDataId('task-thread'), threadId: 'task-thread', revision: 1, provenance: PLANNING_PROVENANCE, createdAt: '2026-11-01T00:00:00Z', value: {version: 1, title: 'Validate split workspace', steps: [{id: 'capture', title: 'Capture the workspace matrix', status: 'working', requirements: [{id: 'geometry', label: 'Check first-visible geometry', completed: false}]}], agents: []}});
  await serveTaskFixture(page, snapshot);
  if (surface.startsWith('settings-')) {
    await page.route('**/api/shell/settings', route => route.fulfill({json: {sequence: 1, settings: snapshot.settings, accounts: [], skills: [], skillProposals: [], learning: {supported: true, status: 'idle', lastReview: null}, projects: [], resources: [], resourcePage: {total: 0, nextCursor: null}, counts: {threads: 1, archivedThreads: 0, artifacts: 0, resources: 0, uncertainOperations: 0}}}));
    await page.route('**/api/environment', route => route.fulfill({json: {revision: 0, entries: [], secretStorageAvailable: false}}));
    await page.route('**/api/integrations', route => route.fulfill({json: {integrations: []}}));
    await page.route('**/api/shell/archive?*', route => route.fulfill({json: {sequence: 1, total: 0, items: [], nextCursor: null}}));
    await fixtureModule(page, 'compact-settings-fixture.tsx', theme);
    const dialog = page.getByRole('dialog', {name: 'Settings', exact: true});
    await expect(dialog.locator('.settings-content')).toBeVisible();
    const label = surface.slice(9), picker = dialog.locator('.settings-section-select').getByRole('combobox');
    if (await picker.isVisible()) {
      await picker.click();
      await contained(page, page.getByRole('listbox'));
      await page.screenshot({path: resolve(captures, `${captureName}-picker.png`), animations: 'disabled'});
      await page.getByRole('option', {name: label, exact: true}).click();
      await expect(page.getByRole('listbox')).toHaveCount(0);
    } else await dialog.getByRole('navigation', {name: 'Settings sections'}).getByRole('button', {name: label, exact: true}).click();
    await expect(dialog.getByRole('heading', {name: label, exact: true, level: 1})).toBeVisible();
    return {root: dialog, controls: dialog.locator('.ui-modal-header button, .settings-search, .settings-page-heading'), padding: dialog.locator('.settings-content')};
  }
  if (surface === 'inbox') {
    await fixtureModule(page, 'fixtures/inbox-controls.tsx', theme);
    await expect(page.locator('.ui-list-row')).toHaveCount(5);
    return {root: page.locator('.agent-inbox'), controls: page.locator('.inbox-list-head button, .inbox-search'), padding: page.locator('.inbox-tasks-body')};
  }
  let layout = createSplitWorkspaceLayout();
  layout = applySplitWorkspaceCommand(layout, 'view.open', {view: {id: 'thread:task-thread', kind: 'thread', binding: {authority: {kind: 'local'}, threadId: 'task-thread'}}});
  if (surface === 'split' || surface === 'docked' || surface === 'full-plan') layout = applySplitWorkspaceCommand(layout, 'pane.split', {paneId: layout.focusedPaneId, newPaneId: 'pane-detail', splitId: 'split-detail', axis: surface === 'docked' ? 'vertical' : 'horizontal', view: surface === 'docked' ? {id: 'thread:docked-thread', kind: 'thread', binding: {authority: {kind: 'local'}, threadId: 'docked-thread'}} : {id: 'plan:task-thread', kind: 'plan', binding: {authority: {kind: 'local'}, threadId: 'task-thread'}}});
  if (surface === 'split') layout = applySplitWorkspaceCommand(layout, 'pane.focus', {paneId: 'pane-main'});
  await page.route('**/api/split-workspace?*', route => route.fulfill({json: layout}));
  await page.route('**/api/split-workspace/commands', route => {
    const command = route.request().postDataJSON();
    layout = applySplitWorkspaceCommand(layout, command.type, command.payload);
    return route.fulfill({json: {commandId: command.id, eventSeq: snapshot.seq, result: layout}});
  });
  await page.goto('/');
  const chat = page.locator(`[data-split-view="thread:${surface === 'docked' ? 'docked-thread' : 'task-thread'}"]`);
  await expect(page.locator('.split-workspace').first()).toBeVisible();
  if (surface !== 'full-plan') await expect(chat.getByRole('textbox', {name: 'Message', exact: true})).toBeEnabled();
  else await expect(page.getByRole('region', {name: 'Task plan: Validate split workspace', exact: true})).toBeVisible();
  if (surface === 'floating') {
    await page.getByRole('button', {name: 'Move chat', exact: true}).click();
    await page.getByRole('menuitem', {name: 'Float', exact: true}).click();
    await expect(chat).toHaveAttribute('data-floating', 'true');
  }
  if (surface === 'overview') {
    const root = page.getByRole('region', {name: 'Project overview window', exact: true});
    if (await root.getByRole('button', {name: 'Expand Project overview', exact: true}).isVisible()) await root.getByRole('button', {name: 'Expand Project overview', exact: true}).click();
    await expect(root.getByRole('region', {name: 'Plan summary'})).toBeVisible();
    return {root, controls: root.locator('.docked-summary-toggle'), padding: root.locator('.project-context-plan-summary')};
  }
  const root = surface === 'floating' ? chat : surface === 'full-plan' ? page.locator('[data-split-view="plan:task-thread"]') : page.locator('.split-workspace').first();
  return {root, controls: surface === 'full-plan' ? root.getByRole('group', {name: 'Plan progress and actions'}) : chat.locator('.composer, .composer button:visible, .composer textarea'), padding: surface === 'full-plan' ? root.locator('.plan-status') : chat.locator('.conversation-scroll')};
}

async function contained(page: Page, locator: Locator) {
  const viewport = page.viewportSize()!;
  for (const node of await locator.all()) {
    await expect(node).toBeVisible();
    const box = (await node.boundingBox())!;
    expect(box.x, 'left edge').toBeGreaterThanOrEqual(-1);
    expect(box.y, 'top edge').toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width, 'right edge').toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height, 'bottom edge').toBeLessThanOrEqual(viewport.height + 1);
  }
}

for (const theme of ['dark', 'light'] as const) for (const [viewportName, physical] of Object.entries(viewports)) for (const zoom of [100, 125, 150, ...(viewportName === 'standard' ? [200] : [])]) {
  test.describe(`${theme}-${viewportName}-${zoom}`, () => {
    // Browser zoom reduces the CSS viewport and increases raster density together.
    // DPR alone would not exercise responsive layout or clipping at enlarged text.
    test.use({viewport: {width: Math.floor(physical.width * 100 / zoom), height: Math.floor(physical.height * 100 / zoom)}, deviceScaleFactor: zoom / 100, contextOptions: {reducedMotion: zoom === 200 ? 'reduce' : 'no-preference'}, colorScheme: theme});
    for (const surface of surfaces) test(`${slug(surface)} first-visible and keyboard`, async ({page}) => {
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      await mkdir(captures, {recursive: true});
      const name = `${slug(surface)}-${theme}-${viewportName}-${zoom}`;
      const {root, controls, padding} = await render(page, surface, theme, name);
      await page.screenshot({path: resolve(captures, `${name}.png`), animations: 'disabled'});
      await contained(page, root); await contained(page, controls);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (padding) {
        const inset = await padding.evaluate(node => parseFloat(getComputedStyle(node).paddingLeft));
        const width = page.viewportSize()!.width;
        const expectedInset = surface.startsWith('settings-') ? width <= 460 ? 12 : width <= 700 ? 16 : 20 : surface === 'overview' ? 12 : surface === 'inbox' || surface === 'full-plan' ? 16 : width <= 700 ? 12 : width <= 1000 ? 20 : 32;
        expect(inset, 'DESIGN inset (including the existing compact responsive variants)').toBe(expectedInset);
      }
      const panes = page.locator('.split-pane:visible');
      const boxes = await Promise.all((await panes.all()).map(node => node.boundingBox()));
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!, b = boxes[j]!;
        expect(Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) <= 1 || Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) <= 1, 'panes do not overlap').toBe(true);
      }
      let focused = false;
      for (let i = 0; i < 80; i++) {
        await page.keyboard.press('Tab');
        focused = await root.evaluate(node => node.contains(document.activeElement) && document.activeElement?.matches(':focus-visible') === true);
        if (focused) break;
      }
      expect(focused, 'Tab reaches a focus-visible control in the surface').toBe(true);
      await contained(page, page.locator(':focus-visible'));
      if (zoom === 200) {
        expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
        for (const button of await root.getByRole('button').all()) {
          if (!(await button.isVisible()) || !(await button.isEnabled())) continue;
          await button.scrollIntoViewIfNeeded();
          await contained(page, button);
          await expect(button).toBeInViewport();
          await button.focus();
          await page.keyboard.press('Tab');
          await page.keyboard.press('Shift+Tab');
          await expect(button).toBeFocused();
        }
      }
      await page.screenshot({path: resolve(captures, `${name}-keyboard.png`), animations: 'disabled'});
      expect(errors).toEqual([]);
    });
  });
}
