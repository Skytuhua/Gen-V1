import {test, expect, type Page} from '@playwright/test';

async function fixture(page: Page) {
  const requests: string[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:5802' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/widget-runtime')) {
      requests.push(url.href); return route.abort();
    }
    return route.continue();
  });
  await page.goto('/tests/e2e/fixtures/inbox-controls.html');
  await expect(page.locator('.ui-list-row')).toHaveCount(5);
  return {requests, errors};
}
const filter = (page: Page) => page.getByRole('combobox', {name: 'Inbox filter', exact: true});
const rows = (page: Page) => page.locator('.ui-list-row-main');
const calls = (page: Page) => page.evaluate(() => window.inboxControls.calls);
async function choose(page: Page, label: string) {
  await filter(page).click(); await page.getByRole('option', {name: label, exact: true}).click();
  await expect(filter(page)).toBeFocused(); await expect(filter(page)).toHaveText(label);
}

test('filter keyboard owns its listbox without selecting or reading Inbox rows', async ({page}) => {
  const {requests, errors} = await fixture(page);
  await filter(page).focus(); await page.keyboard.press('Home'); await page.keyboard.press('End');
  await filter(page).dispatchEvent('keydown', {key: 'j', isComposing: true});
  expect(await calls(page)).toEqual([]);
  await page.keyboard.press('ArrowDown');
  const list = page.getByRole('listbox', {name: 'Inbox filter', exact: true});
  await expect(list).toBeVisible(); await expect(list.getByRole('option', {selected: true})).toHaveText('All');
  await expect(page.getByRole('option', {name: 'All', exact: true})).toBeFocused();
  expect(await calls(page)).toEqual([]);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(filter(page)).toHaveText('Needs you'); await expect(filter(page)).toBeFocused();
  await expect(rows(page)).toHaveCount(3);
  await filter(page).press('ArrowUp'); await expect(page.getByRole('option', {name: 'Completed', exact: true})).toBeFocused();
  await expect(list.getByRole('option', {selected: true})).toHaveText('Needs you');
  await page.keyboard.press('Home'); await page.keyboard.press('End'); await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0); await expect(filter(page)).toBeFocused();
  await expect(filter(page)).toHaveText('Needs you');
  await filter(page).press('u'); await page.keyboard.press('Enter');
  await expect(filter(page)).toHaveText('Unread'); await expect(rows(page)).toHaveCount(3);
  await expect(page.locator('.ui-list-row[data-current=true]')).toHaveCount(0);
  expect(await calls(page)).toEqual([]); expect(requests).toEqual([]); expect(errors).toEqual([]);
});

test('exclusive filters preserve selected reader, search and source action state', async ({page}) => {
  await fixture(page);
  await rows(page).filter({hasText: 'Review'}).click();
  const reader = page.getByRole('region', {name: 'Review', exact: true});
  await expect(reader).toBeVisible();
  for (const [label, titles] of [
    ['Needs you', ['Question', 'Review', 'Failed task']],
    ['Unread', ['Question', 'Failed task', 'Completed task']],
    ['Completed', ['Completed task', 'Resolved question']],
    ['All', ['Question', 'Review', 'Failed task', 'Completed task', 'Resolved question']],
  ] as const) {
    await choose(page, label); await expect(page.locator('.ui-list-row-title')).toHaveText(titles.map(title => title === 'Question' || title === 'Failed task' || title === 'Completed task' ? 'Unread. ' + title : title));
    await expect(reader).toBeVisible(); await expect(reader.getByRole('button', {name: 'Open conversation'})).toBeVisible();
    await filter(page).click(); await expect(page.getByRole('option', {selected: true})).toHaveText(label); await page.keyboard.press('Escape');
  }
  await page.getByRole('searchbox', {name: 'Search Inbox'}).fill('Failed');
  await choose(page, 'Completed'); await expect(page.getByText('Nothing matches', {exact: true})).toBeVisible();
  await choose(page, 'Needs you'); await expect(rows(page)).toHaveCount(1);
  await page.getByRole('searchbox').press('Escape'); await expect(rows(page)).toHaveCount(3);
  expect(await calls(page)).toEqual([]);
  expect(await page.evaluate(() => window.inboxControls.items.map(item => [item.id, item.state, item.actionable]))).toEqual([
    ['question', 'needs-input', true], ['review', 'needs-review', true], ['failed', 'failed', false], ['completed', 'completed', false], ['resolved', 'resolved', false],
  ]);
});

test('Escape, outside click, focus departure and Tab dismiss without changing the filter', async ({page}) => {
  await fixture(page); await choose(page, 'Completed');
  await filter(page).click(); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Escape');
  await expect(filter(page)).toBeFocused(); await expect(filter(page)).toHaveText('Completed');
  await filter(page).click(); await page.getByRole('heading', {name: 'Inbox', exact: true}).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await filter(page).click(); await page.getByRole('searchbox').focus();
  await expect(page.getByRole('listbox')).toHaveCount(0); await expect(page.getByRole('searchbox')).toBeFocused();
  await filter(page).click(); await page.keyboard.press('Tab');
  await expect(page.getByRole('listbox')).toHaveCount(0); await expect(page.getByRole('button', {name: 'Refresh inbox', exact: true})).toBeFocused();
  await expect(filter(page)).toHaveText('Completed');
  expect(await calls(page)).toEqual([]);
});

test('refresh succeeds through the supplied handler while retaining filter, selection and unread state', async ({page}) => {
  const {requests, errors} = await fixture(page);
  await rows(page).filter({hasText: 'Review'}).click(); await choose(page, 'Needs you');
  const refresh = page.getByRole('button', {name: 'Refresh inbox', exact: true});
  await refresh.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('region', {name: 'Review', exact: true})).toContainText('Refreshed.');
  await expect(filter(page)).toHaveText('Needs you'); await expect(rows(page)).toHaveCount(3); await expect(refresh).toBeFocused();
  expect(await calls(page)).toEqual([{type: 'refresh'}]);
  expect(await page.evaluate(() => window.inboxControls.items.filter(item => !item.read).map(item => item.id))).toEqual(['question', 'failed', 'completed']);
  expect(requests).toEqual([]); expect(errors).toEqual([]);
});

for (const mode of ['reject', 'throw', 'source-error'] as const) {
  test(`refresh ${mode} retains records and reports the existing failure`, async ({page}) => {
    const {errors} = await fixture(page);
    await page.evaluate(mode => {window.inboxControls.refreshMode = mode;}, mode);
    await choose(page, 'Unread'); await page.getByRole('button', {name: 'Refresh inbox', exact: true}).click();
    await expect(page.getByRole('alert')).toContainText(mode === 'source-error' ? 'Inbox could not load.' : 'Refresh failed.');
    await expect(filter(page)).toHaveText('Unread'); await expect(rows(page)).toHaveCount(3);
    expect(await calls(page)).toEqual([{type: 'refresh'}]); expect(errors).toEqual([]);
  });
}

test('reading and failed canonical navigation never approve or falsely mark an unread item read', async ({page}) => {
  const {requests, errors} = await fixture(page);
  await rows(page).filter({hasText: 'Question'}).first().click();
  await expect(page.getByRole('button', {name: 'Question, Needs your input', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Mark unread'}).click();
  await page.evaluate(() => {window.inboxControls.openMode = 'reject';});
  await page.getByRole('button', {name: 'Open conversation'}).click();
  await expect(page.getByRole('alert')).toContainText('Navigation failed.');
  await expect(page.getByRole('button', {name: 'Question, Needs your input, unread', exact: true})).toHaveAttribute('aria-current', 'page');
  expect(await calls(page)).toEqual([{type: 'read', id: 'question'}, {type: 'unread', id: 'question'}, {type: 'open', id: 'thread-question'}]);
  expect(await page.evaluate(() => window.inboxControls.items.find(item => item.id === 'question'))).toMatchObject({read: false, state: 'needs-input', actionable: true});
  expect(requests).toEqual([]); expect(errors).toEqual([]);
});

test('read-state rejection remains visible without changing read state or invoking navigation', async ({page}) => {
  await fixture(page); await page.evaluate(() => {window.inboxControls.readMode = 'reject';});
  await rows(page).filter({hasText: 'Question'}).first().click();
  await expect(page.getByRole('alert')).toHaveText('Read state could not save.');
  expect(await calls(page)).toEqual([{type: 'read', id: 'question'}]);
  expect(await page.evaluate(() => window.inboxControls.items[0])).toMatchObject({read: false, state: 'needs-input', actionable: true});
});

test('narrow themed controls and popup fit without overflow and retain list/reader Escape ownership', async ({page}, info) => {
  await fixture(page); await page.emulateMedia({reducedMotion: 'reduce'});
  for (const [theme, width] of [['dark', 320], ['light', 390], ['light', 1100], ['dark', 1100]] as const) {
    await page.setViewportSize({width, height: 620}); await page.evaluate(theme => {document.documentElement.dataset.theme = theme;}, theme);
    await choose(page, 'Completed'); await filter(page).click();
    const popup = page.getByRole('listbox'); await expect(popup).toBeVisible();
    for (const control of [filter(page), page.getByRole('button', {name: 'Refresh inbox', exact: true}), popup]) {
      const box = await control.boundingBox(); expect(box).not.toBeNull(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path: info.outputPath(`${theme}-${width}.png`)});
    await page.keyboard.press('Escape'); await expect(filter(page)).toBeFocused();
  }
  await page.setViewportSize({width: 390, height: 620}); await choose(page, 'All');
  await rows(page).first().click(); await expect(page.locator('.agent-inbox')).toHaveAttribute('data-columns', 'item');
  await page.keyboard.press('Escape'); await expect(page.locator('.agent-inbox')).toHaveAttribute('data-columns', 'list'); await expect(rows(page).first()).toBeFocused();
});
