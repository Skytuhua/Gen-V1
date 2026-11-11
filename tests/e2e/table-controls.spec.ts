import { test, expect, type Page } from '@playwright/test';
import { serveTaskFixture, taskFixture, type TaskSpec } from './task-interface-fixture';
const columns = [{ key: 'task', label: 'Task' }, { key: 'owner', label: 'Owner' }, { key: 'status', label: 'Status' }, { key: 'due', label: 'Due' }, { key: 'hours', label: 'Hours' }];
const rows = [
  { id: 'a', task: 'Draft release notes', owner: 'Avery Chen', status: 'In progress', due: 'Nov 12', hours: 3 },
  { id: 'b', task: 'Prepare release build', owner: 'Sam Rivera', status: 'Ready', due: 'Nov 13', hours: 4 },
  { id: 'c', task: 'Review release checklist', owner: 'Jordan Lee', status: 'In progress', due: 'Nov 13', hours: 2 },
  { id: 'd', task: 'Verify release package', owner: 'Morgan Patel', status: 'Blocked', due: 'Nov 14', hours: 5 },
  { id: 'e', task: 'Update documentation', owner: 'Avery Chen', status: 'Ready', due: 'Nov 12', hours: 1 },
  { id: 'f', task: 'Check accessibility', owner: 'Sam Rivera', status: 'Ready', due: 'Nov 13', hours: 2 },
  { id: 'g', task: 'Refresh screenshots', owner: 'Jordan Lee', status: 'In progress', due: 'Nov 14', hours: 3 },
  { id: 'h', task: 'Publish changelog', owner: 'Morgan Patel', status: 'Blocked', due: 'Nov 15', hours: 2 },
];
const spec = (cols = columns): TaskSpec => ({ root: 'table', elements: { table: { type: 'Table', props: { rowsBinding: 'rows', columns: cols, stateKey: 'selected', caption: 'Release tasks' } } } });
async function open(page: Page, data: unknown[] = rows, theme: 'dark' | 'light' = 'dark', cols = columns) {
  const snapshot = taskFixture(spec(cols), { rows: data }, { selected: ['a'] });
  snapshot.settings.theme = theme; snapshot.threads[0].title = 'Review changes'; snapshot.threads[0].projectName = 'Gen-V1';
  snapshot.messages[0].content = 'Here are the tasks for the release.'; snapshot.artifacts[0].title = 'Release tasks';
  const host = await serveTaskFixture(page, snapshot); await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sort Task', exact: true })).toBeVisible();
  return host;
}
const headerKeys = (page: Page) => page.locator('th[data-column-key]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.columnKey));
const rowIds = (page: Page) => page.locator('.task-table tbody tr').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.rowId));
const separator = (page: Page, label = 'Task') => page.getByRole('separator', { name: `Resize ${label} column` });
async function drag(page: Page, source: { x: number; y: number }, destination: { x: number; y: number }) {
  await page.mouse.move(source.x, source.y); await page.mouse.down(); await page.mouse.move(destination.x, destination.y, { steps: 6 });
}

test('resize anchors the grid until release, cancels, fits on double-click and obeys keyboard bounds', async ({ page }) => {
  await open(page); const resize = separator(page), task = page.locator('th[data-column-key=task]');
  const start = Number(await resize.getAttribute('aria-valuenow')), box = (await resize.boundingBox())!, grid = (await task.boundingBox())!;
  await drag(page, { x: box.x + 12, y: box.y + 16 }, { x: box.x + 72, y: box.y + 16 });
  await expect(page.locator('.task-table-resize-guide')).toBeVisible();
  expect((await task.boundingBox())!.width).toBeCloseTo(grid.width, 0); await expect(resize).toHaveAttribute('aria-valuenow', String(start));
  await page.mouse.up(); await expect(resize).toHaveAttribute('aria-valuenow', String(start + 60));
  await expect(page.locator('.task-table [role=status]')).toHaveText(`Task column width ${start + 60} pixels.`);
  const next = (await resize.boundingBox())!;
  await drag(page, { x: next.x + 12, y: next.y + 16 }, { x: next.x - 100, y: next.y + 16 }); await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(resize).toHaveAttribute('aria-valuenow', String(start + 60)); await expect(page.locator('.task-table [role=status]')).toHaveText('Resize cancelled.');
  await resize.focus(); await resize.press('Home'); await expect(resize).toHaveAttribute('aria-valuenow', '90');
  await resize.press('Shift+ArrowRight'); await expect(resize).toHaveAttribute('aria-valuenow', '110');
  await resize.press('End'); await expect(resize).toHaveAttribute('aria-valuenow', '420');
  await resize.press('ArrowRight'); await expect(resize).toHaveAttribute('aria-valuenow', '420');
  await resize.dblclick(); const fit = Number(await resize.getAttribute('aria-valuenow')); expect(fit).toBeGreaterThan(150); expect(fit).toBeLessThan(420);
  await expect(page.locator('.task-table [data-row-id=a] input')).toBeChecked();
});

test('mouse reorder uses separate grip and drop marker, commits once and keeps selection and focus', async ({ page }) => {
  await open(page); const grip = page.getByRole('button', { name: 'Move Due column' });
  await grip.hover(); const box = (await grip.boundingBox())!, destination = (await page.locator('th[data-column-key=owner]').boundingBox())!;
  await drag(page, { x: box.x + 8, y: box.y + 12 }, { x: destination.x + 16, y: destination.y + 16 });
  await expect(page.locator('.task-table-drag-preview')).toBeVisible(); await expect(page.locator('.task-table-drop-line')).toBeVisible();
  expect(await headerKeys(page)).toEqual(columns.map(column => column.key));
  await page.mouse.up(); expect(await headerKeys(page)).toEqual(['task', 'due', 'owner', 'status', 'hours']); await expect(grip).toBeFocused();
  await expect(page.locator('thead th').first()).not.toHaveAttribute('data-column-key');
  await expect(page.locator('th[aria-sort]')).toHaveCount(0); await expect(page.locator('.task-table [data-row-id=a] input')).toBeChecked();
  const now = (await grip.boundingBox())!;
  await drag(page, { x: now.x + 8, y: now.y + 12 }, { x: destination.x, y: destination.y + 16 }); await page.keyboard.press('Escape'); await page.mouse.up();
  expect(await headerKeys(page)).toEqual(['task', 'due', 'owner', 'status', 'hours']);
  await drag(page, { x: now.x + 8, y: now.y + 12 }, { x: 300, y: 700 }); await page.mouse.up();
  expect(await headerKeys(page)).toEqual(['task', 'due', 'owner', 'status', 'hours']);
});

test('keyboard reorder moves first data column, announces endpoints and keeps widths by key without animation', async ({ page }) => {
  await open(page); await separator(page).focus(); await separator(page).press('Home');
  const grip = page.getByRole('button', { name: 'Move Task column' }); await grip.focus(); await grip.press('Alt+ArrowLeft');
  await expect(page.locator('.task-table [role=status]')).toHaveText('Task is already first.');
  await grip.press('Alt+ArrowRight'); expect(await headerKeys(page)).toEqual(['owner', 'task', 'status', 'due', 'hours']);
  await expect(grip).toBeFocused(); await expect(separator(page)).toHaveAttribute('aria-valuenow', '90');
  expect(await page.locator('.task-table').evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation.effect instanceof KeyframeEffect && animation.effect.getKeyframes().some(frame => frame.transform)).length)).toBe(0);
  const last = page.getByRole('button', { name: 'Move Hours column' }); await last.focus(); await last.press('Alt+ArrowRight');
  await expect(page.locator('.task-table [role=status]')).toHaveText('Hours is already last.');
});

test('sort cycles numerically with one aria-sort and filter is literal, clearable and composition-safe', async ({ page }) => {
  await open(page); const sort = page.getByRole('button', { name: 'Sort Hours', exact: true }), filter = page.getByRole('textbox', { name: 'Filter rows' });
  await sort.click(); expect(await rowIds(page)).toEqual(['e', 'c', 'f', 'h', 'a', 'g', 'b', 'd']);
  await expect(page.locator('th[aria-sort]')).toHaveCount(1); await expect(page.locator('th[data-column-key=hours]')).toHaveAttribute('aria-sort', 'ascending');
  await sort.press('Space'); expect((await rowIds(page))[0]).toBe('d'); await sort.press('Enter'); expect(await rowIds(page)).toEqual(rows.map(row => row.id));
  await page.getByRole('button', { name: 'Sort Owner', exact: true }).click(); await sort.click(); await expect(page.locator('th[aria-sort]')).toHaveCount(1);
  await filter.fill('  RELEASE  '); await expect(page.locator('.task-table tbody tr')).toHaveCount(4); await expect(filter).toBeFocused();
  await expect(page.locator('.task-table-summary')).toContainText('4 of 8 rows');
  await filter.dispatchEvent('compositionstart'); await filter.fill('no match'); await expect(page.locator('.task-table tbody tr')).toHaveCount(4);
  await filter.dispatchEvent('compositionend'); await expect(page.getByText('No matching rows.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filter', exact: true }).click(); await expect(filter).toBeFocused(); await expect(page.locator('.task-table tbody tr')).toHaveCount(8);
  await filter.fill('.*'); await expect(page.locator('.task-table tbody tr')).toHaveCount(0); await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.locator('.task-table [data-row-id=a] input')).toBeChecked();
});

test('live rows and columns retain compatible settings; removing sorted column clears sort; remount resets controls', async ({ page }) => {
  const host = await open(page); await separator(page).focus(); await separator(page).press('Home');
  const grip = page.getByRole('button', { name: 'Move Task column' }); await grip.focus(); await grip.press('Alt+ArrowRight');
  await page.getByRole('button', { name: 'Sort Hours', exact: true }).click(); await page.getByRole('textbox', { name: 'Filter rows' }).fill('release');
  host.setInput('rows', [...rows].reverse()); await host.publish(); await expect(page.locator('.task-table [data-row-id=a] input')).toBeChecked();
  const nextColumns = [...columns.filter(column => column.key !== 'hours'), { key: 'new', label: 'New' }];
  host.snapshot.artifacts[0].spec = spec(nextColumns); host.snapshot.artifacts[0].revision++; await host.publish();
  await expect(page.getByRole('button', { name: 'Sort New', exact: true })).toBeVisible();
  expect(await headerKeys(page)).toEqual(['owner', 'task', 'status', 'due', 'new']); await expect(separator(page)).toHaveAttribute('aria-valuenow', '90');
  await expect(page.locator('th[aria-sort]')).toHaveCount(0); await expect(page.getByRole('textbox', { name: 'Filter rows' })).toHaveValue('release');
  await page.reload(); await expect(page.getByRole('textbox', { name: 'Filter rows' })).toHaveValue('');
  expect(await headerKeys(page)).toEqual(nextColumns.map(column => column.key));
});

for (const identity of ['missing', 'duplicate'] as const) test(`${identity} ids clear index selection on source reorder and local operations retain it`, async ({ page }) => {
  const data = rows.map((row, index) => ({ ...row, id: identity === 'missing' && index === 0 ? undefined : identity === 'duplicate' ? 'same' : row.id }));
  const host = await open(page, data); await page.getByRole('checkbox', { name: 'Select row 1', exact: true }).check();
  await page.getByRole('button', { name: 'Sort Hours', exact: true }).click(); await expect(page.locator('[data-row-id="0"] input')).toBeChecked();
  host.setInput('rows', [...data].reverse()); await host.publish(); await expect(page.locator('.task-table input:checked')).toHaveCount(0);
});

test('empty source retains headers, query and clear control; autofit includes hidden rows', async ({ page }) => {
  const host = await open(page); const filter = page.getByRole('textbox', { name: 'Filter rows' }); await filter.fill('missing');
  host.setInput('rows', []); await host.publish(); await expect(page.getByText('No rows in this data source.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear filter', exact: true })).toHaveCount(0); await expect(filter).toHaveValue('missing');
  await page.getByRole('button', { name: 'Clear', exact: true }).click(); await separator(page).dblclick(); expect(Number(await separator(page).getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(90);
  expect(Number(await separator(page).getAttribute('aria-valuenow'))).toBeLessThan(140);
  host.setInput('rows', [{ ...rows[0], task: 'W'.repeat(300) }]); await host.publish(); await filter.fill('missing'); await separator(page).dblclick();
  await expect(separator(page)).toHaveAttribute('aria-valuenow', '420');
});

for (const theme of ['dark', 'light'] as const) test(`inline overflow, forced colors, keyboard and 200% zoom in ${theme}; capture`, async ({ page }, info) => {
  await open(page, rows, theme); await page.getByRole('textbox', { name: 'Filter rows' }).fill('release'); await page.getByRole('button', { name: 'Sort Task', exact: true }).click();
  await page.screenshot({ path: info.outputPath(`after-${theme}-1440.png`) });
  for (const label of columns.map(column => column.label)) { await separator(page, label).focus(); await separator(page, label).press('End'); }
  const region = page.locator('.task-table-scroll');
  expect(await region.evaluate(node => ({ x: getComputedStyle(node).overflowX, nested: node.scrollHeight > node.clientHeight, wide: node.scrollWidth > node.clientWidth }))).toEqual({ x: 'auto', nested: false, wide: true });
  await region.focus(); await region.press('ArrowRight'); await expect.poll(() => region.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' }); await separator(page).focus();
  const color = await separator(page).evaluate(node => getComputedStyle(node).outlineColor); expect(color).not.toBe('rgba(0, 0, 0, 0)');
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await region.evaluate(node => node.scrollHeight <= node.clientHeight)).toBe(true);
});

test('edge drag auto-scrolls and pointer cancellation does not commit either gesture', async ({ page }) => {
  await open(page); for (const label of columns.map(column => column.label)) { await separator(page, label).focus(); await separator(page, label).press('End'); }
  const region = page.locator('.task-table-scroll'); await region.evaluate(node => { node.scrollLeft = 0; });
  const grip = page.getByRole('button', { name: 'Move Task column' }); await grip.hover(); const box = (await grip.boundingBox())!, bounds = (await region.boundingBox())!;
  await drag(page, { x: box.x + 8, y: box.y + 12 }, { x: bounds.x + bounds.width - 10, y: box.y + 12 });
  await expect.poll(() => region.evaluate(node => node.scrollLeft)).toBeGreaterThan(30);
  await grip.evaluate(node => node.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true })));
  await page.mouse.up(); expect(await headerKeys(page)).toEqual(columns.map(column => column.key));
  await region.evaluate(node => { node.scrollLeft = 0; }); const resize = separator(page), initial = await resize.getAttribute('aria-valuenow'), size = (await resize.boundingBox())!;
  await drag(page, { x: size.x + 12, y: size.y + 16 }, { x: size.x - 40, y: size.y + 16 });
  await resize.evaluate(node => node.releasePointerCapture(1)); await page.mouse.up(); await expect(resize).toHaveAttribute('aria-valuenow', initial!);
});

test('custom rowKey preserves selected rows and valid scroll offsets across local operations', async ({ page }) => {
  const data = Array.from({ length: 60 }, (_, index) => ({ code: String(index), task: `Task ${index}`, owner: `Owner ${index}`, status: 'Ready', due: 'Nov 12', hours: 60 - index }));
  const customSpec = spec(); customSpec.elements.table.props.rowKey = 'code'; customSpec.elements.table.props.changesBinding = 'changes';
  const snapshot = taskFixture(customSpec, { rows: data, changes: { rows: [] } }, { selected: ['10'] }); snapshot.artifacts[0].placement = 'expanded';
  const host = await serveTaskFixture(page, snapshot); await page.goto('/');
  const region = page.locator('.task-table-scroll'); await expect(region).toBeVisible();
  for (const column of columns) { await separator(page, column.label).focus(); await separator(page, column.label).press('End'); }
  await region.evaluate(node => { node.scrollTop = 200; node.scrollLeft = 120; });
  const offsets = () => region.evaluate(node => [node.scrollLeft, node.scrollTop]);
  await page.getByRole('button', { name: 'Sort Task', exact: true }).evaluate(node => (node as HTMLButtonElement).click()); expect(await offsets()).toEqual([120, 200]);
  const filter = page.getByRole('textbox', { name: 'Filter rows' }); await filter.fill('Ready'); expect(await offsets()).toEqual([120, 200]);
  await page.getByRole('button', { name: 'Move Owner column' }).evaluate(node => node.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true })));
  expect(await offsets()).toEqual([120, 200]); await expect(page.locator('[data-row-id="10"] input')).toBeChecked();
  host.setInput('rows', [...data].reverse()); await host.publish(); await expect(page.locator('[data-row-id="10"] input')).toBeChecked();
  await expect(region).toHaveAttribute('data-following', 'false');
});

test('live removal cancels a gesture and typed numeric values remain complete at their effective minimum', async ({ page }) => {
  const host = await open(page, [{ ...rows[0], hours: Number('123456789012345678901234') }]);
  await separator(page, 'Hours').focus(); await separator(page, 'Hours').press('Home');
  const number = page.locator('td[data-column-key=hours]');
  expect(await number.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  const resize = separator(page), box = (await resize.boundingBox())!;
  await drag(page, { x: box.x + 12, y: box.y + 16 }, { x: box.x + 72, y: box.y + 16 });
  const next = columns.filter(column => column.key !== 'task'); host.snapshot.artifacts[0].spec = spec(next); host.snapshot.artifacts[0].revision++; await host.publish();
  await expect(resize).toHaveCount(0); await expect(page.locator('.task-table-resize-guide')).toHaveCount(0); await page.mouse.up();
  expect(await headerKeys(page)).toEqual(next.map(column => column.key));
});

test('truncated repeated labels expose full text on focus and keep separate column keys', async ({ page }) => {
  const long = 'A long supplied column label that must remain available to keyboard users';
  await open(page, rows, 'light', columns.map(column => ['owner', 'status'].includes(column.key) ? { ...column, label: long } : column));
  const owner = page.locator('th[data-column-key=owner]'); await owner.getByRole('separator').focus(); await owner.getByRole('separator').press('Home');
  await owner.getByRole('button', { name: `Sort ${long}`, exact: true }).focus(); await expect(page.getByRole('tooltip')).toHaveText(long);
  await owner.getByRole('button', { name: `Move ${long} column`, exact: true }).focus(); await owner.getByRole('button', { name: `Move ${long} column`, exact: true }).press('Alt+ArrowRight');
  expect(await headerKeys(page)).toEqual(['task', 'status', 'owner', 'due', 'hours']);
});

test('pointer resize tracks CSS widths at 200% zoom', async ({ page }) => {
  await open(page); await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  const resize = separator(page); await resize.focus(); await resize.press('Home'); await resize.scrollIntoViewIfNeeded();
  const box = (await resize.boundingBox())!;
  await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: box.x + box.width / 2 + 40, y: box.y + box.height / 2 });
  await page.mouse.up(); await expect(resize).toHaveAttribute('aria-valuenow', '110');
});
