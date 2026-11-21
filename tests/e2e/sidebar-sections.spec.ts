import {test, expect, type Page} from '@playwright/test';
import {resolve} from 'node:path';

const fixture = '/@fs/' + encodeURI(resolve(import.meta.dirname, 'sidebar-sections-fixture.tsx').replaceAll('\\', '/'));
const calls = (page: Page) => page.evaluate(() => (window as unknown as {sidebarSectionCalls: unknown[]}).sidebarSectionCalls);

const goto = async (page: Page, suffix = '') => {
  await page.route('**/api/**', route => route.fulfill({json: {}}));
  await page.route('**/api/bootstrap', route => route.fulfill({json: {csrfToken: 'synthetic'}}));
  await page.route('**/sidebar-sections-check*', route => route.fulfill({contentType: 'text/html', body: `<html data-theme="dark"><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${fixture}');</script></body></html>`}));
  await page.goto(`/sidebar-sections-check${suffix}`);
};

test.beforeEach(async ({page}) => { await goto(page); });

test('sections render after Working with members; settled members stay under Settled', async ({page}) => {
  const reviews = page.getByRole('button', {name: 'Reviews, 2 threads', exact: true});
  const later = page.getByRole('button', {name: 'Later, 0 threads', exact: true});
  await expect(reviews).toBeVisible();
  await expect(later).toBeVisible();
  const sectionList = page.locator('[data-thread-list="section:sec_reviews"]');
  await expect(sectionList.getByRole('button', {name: 'Review the parser fix Ready'})).toBeVisible();
  await expect(sectionList.getByRole('button', {name: 'Review the docs pass Ready'})).toBeVisible();
  // Settled wins over membership (R04 DECIDED): the settled member stays under Settled.
  await expect(page.locator('[data-thread-list="settled"]').getByRole('button', {name: 'Settled member Ready', exact: true})).toBeVisible();
  await expect(page.locator('[data-thread-list="flat"]').getByRole('button', {name: 'Loose conversation Ready'})).toBeVisible();
});

test('header menu renames a section and duplicate names report inline', async ({page}) => {
  await page.getByRole('button', {name: 'Options for section Reviews', exact: true}).click();
  const menu = page.getByRole('menu', {name: 'Options for section Reviews'});
  await expect(menu.getByRole('menuitem')).toHaveText(['Rename', 'Move up', 'Move down', 'Delete section']);
  await expect(menu.getByRole('menuitem', {name: 'Move up'})).toBeDisabled();
  await menu.getByRole('menuitem', {name: 'Rename'}).click();
  const field = page.getByRole('textbox', {name: 'Section name'});
  await expect(field).toBeVisible();
  await field.fill('Later');
  await field.press('Enter');
  await expect(page.getByText('A section named \u201CLater\u201D already exists')).toBeVisible();
  await field.fill('Triage');
  await field.press('Enter');
  await expect(page.getByRole('button', {name: 'Triage, 2 threads'})).toBeVisible();
  expect((await calls(page)).filter(item => (item as {command?: string}).command)).toEqual([{command: 'sidebar.section.rename', payload: {sectionId: 'sec_reviews', name: 'Triage'}}]);
});

test('New section ghost row creates a named section', async ({page}) => {
  await page.getByRole('button', {name: 'New section', exact: true}).click();
  const field = page.getByRole('textbox', {name: 'Section name'});
  await expect(field).toBeFocused();
  await field.press('Escape');
  await expect(field).toHaveCount(0);
  await page.getByRole('button', {name: 'New section', exact: true}).click();
  await field.fill('');
  await field.press('Enter');
  await expect(page.getByText('Enter a name')).toBeVisible();
  await field.fill('Waiting room');
  await field.press('Enter');
  await expect(page.getByRole('button', {name: 'Waiting room, 0 threads'})).toBeVisible();
  expect(await calls(page)).toEqual([{command: 'sidebar.section.create', payload: {name: 'Waiting room'}}]);
});

test('Move to section moves a member and announces the landing', async ({page}) => {
  await page.getByRole('button', {name: 'Move Loose conversation to a section', exact: true}).click();
  const menu = page.getByRole('menu', {name: 'Move Loose conversation to a section'});
  await expect(menu.getByRole('menuitem')).toHaveText(['Reviews', 'Later', 'New section\u2026']);
  await menu.getByRole('menuitem', {name: 'Reviews'}).click();
  expect(await calls(page)).toEqual([{presentation: 'thread-3', value: {pinned: false, settled: false, sectionId: 'sec_reviews'}}]);
  await expect(page.locator('[data-thread-list="section:sec_reviews"]').getByRole('button', {name: 'Loose conversation Ready'})).toBeVisible();
  await expect(page.getByRole('status').last()).toHaveText('Moved \u201CLoose conversation\u201D to Reviews');
});

test('Move to section offers removal for a member and disables its current section', async ({page}) => {
  await page.getByRole('button', {name: 'Move Review the parser fix to a section', exact: true}).click();
  const menu = page.getByRole('menu', {name: 'Move Review the parser fix to a section'});
  await expect(menu.getByRole('menuitem', {name: 'Reviews'})).toBeDisabled();
  await menu.getByRole('menuitem', {name: 'Remove from section'}).click();
  expect(await calls(page)).toEqual([{presentation: 'thread-1', value: {pinned: false, sectionId: null}}]);
});

test('empty section deletes with toast undo; non-empty section asks for confirmation', async ({page}) => {
  await page.getByRole('button', {name: 'Options for section Later', exact: true}).click();
  await page.getByRole('menu', {name: 'Options for section Later'}).getByRole('menuitem', {name: 'Delete section'}).click();
  await expect(page.getByRole('button', {name: 'Later, 0 threads'})).toHaveCount(0);
  const toast = page.locator('.ui-toast');
  await expect(toast).toContainText('Section deleted');
  await toast.getByRole('button', {name: 'Undo'}).click();
  await expect(page.getByRole('button', {name: 'Later, 0 threads'})).toBeVisible();

  await page.getByRole('button', {name: 'Options for section Reviews', exact: true}).click();
  await page.getByRole('menu', {name: 'Options for section Reviews'}).getByRole('menuitem', {name: 'Delete section'}).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', {name: 'Delete \u201CReviews\u201D?'})).toBeVisible();
  await expect(dialog).toContainText('Its 2 threads move back to your thread list. No threads are deleted.');
  await dialog.getByRole('button', {name: 'Cancel'}).click();
  await expect(page.getByRole('button', {name: 'Reviews, 2 threads'})).toBeVisible();
  await page.getByRole('button', {name: 'Options for section Reviews', exact: true}).click();
  await page.getByRole('menu', {name: 'Options for section Reviews'}).getByRole('menuitem', {name: 'Delete section'}).click();
  await page.getByRole('dialog').getByRole('button', {name: 'Delete section'}).click();
  await expect(page.locator('[data-thread-list="flat"]').getByRole('button', {name: 'Review the parser fix Ready'})).toBeVisible();
});

test('Move up/down reorders sections through the host command', async ({page}) => {
  await page.getByRole('button', {name: 'Options for section Later', exact: true}).click();
  await page.getByRole('menu', {name: 'Options for section Later'}).getByRole('menuitem', {name: 'Move up'}).click();
  expect(await calls(page)).toEqual([{command: 'sidebar.section.move', payload: {sectionId: 'sec_later', order: 0}}]);
});

test('flag off renders the baseline sidebar with no section chrome', async ({page}) => {
  await goto(page, '?off');
  await expect(page.getByRole('button', {name: 'New section'})).toHaveCount(0);
  await expect(page.locator('[data-thread-list^="section:"]')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Move Loose conversation to a section', exact: true})).toHaveCount(0);
  await expect(page.locator('[data-thread-list="flat"]').getByRole('button', {name: 'Loose conversation Ready'})).toBeVisible();
});

test('collapsed section stays folded and drop target highlight is absent at rest', async ({page}) => {
  const header = page.getByRole('button', {name: 'Reviews, 2 threads'});
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  await header.click();
  await expect(header).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('[data-thread-list="section:sec_reviews"] .sidebar-thread-row').first()).toBeHidden();
  await header.click();
  await expect(page.locator('[data-thread-list="section:sec_reviews"] .sidebar-thread-row').first()).toBeVisible();
});
