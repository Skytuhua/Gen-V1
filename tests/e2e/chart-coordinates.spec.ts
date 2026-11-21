import {test, expect, type Page, type TestInfo} from '@playwright/test';
import {serveTaskFixture, taskFixture, type TaskSpec} from './task-interface-fixture';

type Row = {x: string | number; y?: unknown};
async function chart(page: Page, rows: Row[], kind: 'bar' | 'line' | 'scatter', title = 'Coordinate chart', labels: {xLabel?: string; yLabel?: string; yUnit?: string} = {}) {
  const spec: TaskSpec = {root: 'chart', elements: {chart: {type: 'Chart', props: {kind, rowsBinding: 'series', xKey: 'x', yKey: 'y', title, ...labels}}}};
  const host = await serveTaskFixture(page, taskFixture(spec, {series: rows}));
  await page.goto('/');
  await expect(page.locator('.chart')).toBeVisible({timeout: 30000});
  return host;
}

async function geometry(page: Page, info: TestInfo) {
  const result = await page.locator('.chart-plot svg').evaluate(svg => ({
    viewBox: svg.getAttribute('viewBox'),
    points: Array.from(svg.querySelectorAll('circle'), circle => ({x: Number(circle.getAttribute('cx')), y: Number(circle.getAttribute('cy'))})),
    labels: Array.from(svg.querySelectorAll('.chart-x-label'), label => Number(label.getAttribute('x'))),
    polyline: svg.querySelector('polyline')?.getAttribute('points') ?? null,
  }));
  await info.attach('chart-geometry', {body: JSON.stringify(result, null, 2), contentType: 'application/json'});
  return result;
}

async function rawRows(page: Page, rows: Row[]) {
  await page.getByRole('button', {name: 'View chart data'}).click();
  const table = page.locator('.chart-data-table');
  await expect(table).toBeVisible();
  expect(await table.locator('tbody tr').count()).toBe(rows.length);
  await page.locator('.chart-raw summary').dispatchEvent('click');
  const raw = page.locator('.chart-raw pre');
  await expect(raw).toBeVisible();
  const text = await raw.innerText();
  await test.info().attach('chart-raw-data', {body: text, contentType: 'application/json'});
  expect(JSON.parse(text)).toEqual(rows);
}

function coordinates(actual: {x: number; y: number}[], xs: number[], ys: number[]) {
  expect(actual).toHaveLength(xs.length);
  for (const [index, point] of actual.entries()) {
    expect.soft(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
    expect.soft(point.x).toBeGreaterThanOrEqual(30);
    expect.soft(point.x).toBeLessThanOrEqual(570);
    expect.soft(point.y).toBeGreaterThanOrEqual(30);
    expect.soft(point.y).toBeLessThanOrEqual(210);
    expect.soft(point.x).toBeCloseTo(xs[index], 5);
    expect.soft(point.y).toBeCloseTo(ys[index], 5);
  }
}

test.beforeEach(async ({browser, context}, info) => {
  // Retain a synthetic response while page-scoped routes are torn down.
  await context.route('**/api/**', route => route.fulfill({status: 404}));
  await info.attach('browser', {body: JSON.stringify({name: browser.browserType().name(), version: browser.version(), headless: true, channel: 'unset'}), contentType: 'application/json'});
});

test('signed scatter retains every point and numeric spacing', async ({page}, info) => {
  const rows = [{x: 0, y: -10}, {x: 1, y: 0}, {x: 100, y: 10}];
  await chart(page, rows, 'scatter', 'Signed scatter');
  const result = await geometry(page, info);
  expect(result.viewBox).toBe('0 0 600 250');
  coordinates(result.points, [30, 35.4, 570], [210, 120, 30]);
  expect.soft(result.points[0].y).toBeGreaterThan(result.points[1].y);
  expect.soft(result.points[1].y).toBeGreaterThan(result.points[2].y);
  expect.soft(result.labels).toEqual(result.points.map(point => point.x));
  await expect(page.locator('.chart polyline')).toHaveCount(0);
  await rawRows(page, rows);
});

test('line uses the same signed y transform with categorical x', async ({page}, info) => {
  const rows = [{x: 'A', y: -10}, {x: 'B', y: 0}, {x: 'C', y: 10}];
  await chart(page, rows, 'line');
  const result = await geometry(page, info);
  coordinates(result.points, [30, 300, 570], [210, 120, 30]);
  expect(result.polyline).toBe(result.points.map(point => `${point.x},${point.y}`).join(' '));
  expect(result.labels).toEqual(result.points.map(point => point.x));
  await rawRows(page, rows);
});

const cases: {name: string; kind: 'line' | 'scatter'; rows: Row[]; xs: number[]; ys: number[]}[] = [
  {name: 'all-negative y includes zero', kind: 'scatter', rows: [{x: 0, y: -10}, {x: 100, y: -5}], xs: [30, 570], ys: [210, 120]},
  {name: 'all-zero y stays on baseline', kind: 'scatter', rows: [{x: 0, y: 0}, {x: 1, y: 0}], xs: [30, 570], ys: [210, 210]},
  {name: 'one numeric row centers x', kind: 'scatter', rows: [{x: 7, y: 5}], xs: [300], ys: [30]},
  {name: 'one categorical row retains index spacing', kind: 'line', rows: [{x: 'A', y: 0}], xs: [30], ys: [210]},
  {name: 'repeated numeric x shares one position', kind: 'scatter', rows: [{x: 1, y: 0}, {x: 1, y: 5}, {x: 3, y: 10}], xs: [30, 30, 570], ys: [210, 120, 30]},
  {name: 'zero-width numeric x domain centers every point', kind: 'scatter', rows: [{x: 7, y: -10}, {x: 7, y: 10}], xs: [300, 300], ys: [210, 30]},
  {name: 'numeric strings retain categorical spacing', kind: 'scatter', rows: [{x: '0', y: -10}, {x: '1', y: 0}, {x: '100', y: 10}], xs: [30, 300, 570], ys: [210, 120, 30]},
  {name: 'mixed numeric and categorical x retains index spacing for every row', kind: 'scatter', rows: [{x: 0, y: 0}, {x: 'B', y: 5}, {x: 100, y: 10}], xs: [30, 300, 570], ys: [210, 120, 30]},
  {name: 'numeric line x retains categorical spacing', kind: 'line', rows: [{x: 0, y: 0}, {x: 1, y: 5}, {x: 100, y: 10}], xs: [30, 300, 570], ys: [210, 120, 30]},
  {name: 'extreme finite signed endpoints do not overflow', kind: 'scatter', rows: [{x: -Number.MAX_VALUE, y: -Number.MAX_VALUE}, {x: 0, y: 0}, {x: Number.MAX_VALUE, y: Number.MAX_VALUE}], xs: [30, 300, 570], ys: [210, 120, 30]},

];

for (const entry of cases) test(entry.name, async ({page}, info) => {
  await chart(page, entry.rows, entry.kind);
  const result = await geometry(page, info);
  coordinates(result.points, entry.xs, entry.ys);
  expect(result.labels).toEqual(result.points.map(point => point.x));
  if (entry.kind === 'line') expect(result.polyline).toBe(result.points.map(point => `${point.x},${point.y}`).join(' '));
  await rawRows(page, entry.rows);
});

test('empty series retains its no-data state', async ({page}) => {
  await chart(page, [], 'scatter');
  await expect(page.getByText('No chart data available.', {exact: true})).toBeVisible();
  await expect(page.locator('.chart svg, .chart details')).toHaveCount(0);
});

test('positive bars and raw data remain unchanged', async ({page}, info) => {
  const rows = [{x: 'Before', y: 3}, {x: 'After', y: 8}];
  await chart(page, rows, 'bar');
  const widths = await page.locator('.chart rect').evaluateAll(rects => rects.map(rect => Number(rect.getAttribute('width'))));
  await info.attach('bar-widths', {body: JSON.stringify(widths), contentType: 'application/json'});
  expect(widths).toEqual([146.25, 390]);
  await expect(page.locator('.chart-plot svg')).toHaveAttribute('viewBox', '0 0 600 80');
  await expect(page.locator('.chart-plot svg g > text').nth(1)).toHaveText('3');
  await expect(page.locator('.chart-plot svg g > text').nth(3)).toHaveText('8');
  await expect(page.locator('.chart circle, .chart polyline')).toHaveCount(0);
  await rawRows(page, rows);
});

test('missing y keeps x slots, breaks the line and marks cells unavailable', async ({page}, info) => {
  const rows = [{x: 0, y: 'not numeric'}, {x: 1, y: 'Infinity'}, {x: 2, y: '-Infinity'}, {x: 3, y: '5'}];
  await chart(page, rows, 'scatter');
  const result = await geometry(page, info);
  coordinates(result.points, [570], [30]);
  expect(result.labels).toEqual([30, 210, 390, 570]);
  await page.getByRole('button', {name: 'View chart data'}).click();
  await expect(page.locator('.chart-data-table td').filter({hasText: 'Unavailable'})).toHaveCount(3);
  await rawRows(page, rows);
});

test('a middle null breaks the line into contiguous runs without marks', async ({page}, info) => {
  const rows = [{x: 'A', y: 2}, {x: 'B', y: 4}, {x: 'C', y: null}, {x: 'D', y: 6}, {x: 'E', y: 8}];
  await chart(page, rows, 'line');
  const result = await geometry(page, info);
  coordinates(result.points, [30, 165, 435, 570], [165, 120, 75, 30]);
  expect(await page.locator('.chart polyline').count()).toBe(2);
  await rawRows(page, rows);
});

test('all-missing y keeps rows and exposes them through the table', async ({page}) => {
  const rows = [{x: 'A', y: ''}, {x: 'B', y: null}];
  await chart(page, rows, 'line');
  await expect(page.getByText('No numeric values supplied.', {exact: true})).toBeVisible();
  await expect(page.locator('.chart-plot svg')).toHaveCount(0);
  await rawRows(page, rows);
});

test('signed bars map into the 135-525 interval with a zero rule', async ({page}) => {
  const rows = [{x: 'low', y: -5}, {x: 'mid', y: 0}, {x: 'high', y: 5}];
  await chart(page, rows, 'bar');
  const rects = page.locator('.chart rect');
  const boxes = await rects.evaluateAll(nodes => nodes.map(node => ({x: Number(node.getAttribute('x')), width: Number(node.getAttribute('width'))})));
  expect(boxes).toHaveLength(3);
  const zeroX = await page.locator('.chart-plot svg line').evaluate(node => Number(node.getAttribute('x1')));
  expect(boxes[0].x + boxes[0].width).toBeCloseTo(zeroX, 3);
  expect(boxes[0].x).toBeLessThan(zeroX);
  expect(boxes[2].x).toBeCloseTo(zeroX, 3);
  expect(boxes[2].width).toBeGreaterThan(0);
  await rawRows(page, rows);
});

test('chart source table has five compact rows and accessible scale and values', async ({page}) => {
  const rows = [{x: 'Mon', y: 8}, {x: 'Tue', y: 13}, {x: 'Wed', y: 10}, {x: 'Thu', y: 18}, {x: 'Fri', y: 16}];
  await chart(page, rows, 'line', 'Reviewed days', {xLabel: 'Day', yLabel: 'Reviews', yUnit: 'reviews'});
  const toggle = page.getByRole('button', {name: 'View chart data'});
  const before = (await toggle.boundingBox())!.y;
  await toggle.click();
  const table = page.locator('.chart-data-table');
  await expect(table).toBeVisible();
  expect((await table.boundingBox())!.height).toBeLessThanOrEqual(210);
  await expect(table.locator('th[scope=col]')).toHaveText(['Day', 'Reviews (reviews)']);
  await expect(table.locator('tbody td')).toHaveText(['8', '13', '10', '18', '16']);
  expect((await toggle.boundingBox())!.y - before).toBeLessThanOrEqual(1);
  expect(await page.locator('.chart-raw').evaluate(node => (node as HTMLDetailsElement).open)).toBe(false);
  await expect(page.locator('.chart-y-scale')).toContainText('9');
  await expect(page.locator('.chart-y-scale')).toContainText('18');
  await expect(page.locator('.chart-y-scale')).toContainText('0');
  const select = page.getByRole('combobox', {name: 'Inspect chart value'});
  await select.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(page.locator('.chart-readout')).toHaveText('Mon: 8 reviews');
  await page.locator('.chart circle').nth(2).click();
  await expect(page.locator('.chart-readout')).toHaveText('Wed: 10 reviews');
});

test('clipboard copy reports success and failure through a local status', async ({page}) => {
  const rows = [{x: 'A', y: 1}];
  await chart(page, rows, 'bar');
  await page.getByRole('button', {name: 'View chart data'}).click();
  await page.locator('.chart-raw summary').dispatchEvent('click');
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', {value: {writeText: () => Promise.reject(new Error('denied'))}, configurable: true}); });
  await page.getByRole('button', {name: 'Copy raw data'}).click();
  await expect(page.locator('.chart-raw [role=status]')).toHaveText('Select the raw data to copy.');
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', {value: {writeText: () => Promise.resolve()}, configurable: true}); });
  await page.getByRole('button', {name: 'Copy raw data'}).click();
  await expect(page.locator('.chart-raw [role=status]')).toHaveText('Copied');
});

test('a changed unique mark pulses once while reorders keep selection and ambiguity clears it', async ({page}) => {
  const rows = [{x: 'A', y: 2}, {x: 'B', y: 4}, {x: 'C', y: 6}];
  const host = await chart(page, rows, 'line');
  const bMark = page.locator('.chart circle[data-row-index="1"]');
  host.setInput('series', [{x: 'A', y: 2}, {x: 'B', y: 5}, {x: 'C', y: 6}]); await host.publish();
  await expect.poll(() => bMark.evaluate(node => node.getAnimations().filter(a => a.playState === 'running').length)).toBeGreaterThan(0);
  await expect.poll(() => page.locator('.chart circle').evaluateAll(nodes => nodes.flatMap(node => node.getAnimations()).filter(a => a.playState === 'running').length)).toBe(1);
  await expect.poll(() => page.locator('.chart circle').evaluateAll(nodes => nodes.flatMap(node => node.getAnimations()).filter(a => a.playState === 'running').length)).toBe(0);
  host.setInput('series', [{x: 'A', y: 2}, {x: 'B', y: 5}, {x: 'C', y: 6}]); await host.publish();
  expect(await page.locator('.chart circle').evaluateAll(nodes => nodes.flatMap(node => node.getAnimations()).filter(a => a.playState === 'running').length)).toBe(0);
  const select = page.getByRole('combobox', {name: 'Inspect chart value'});
  await select.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(page.locator('.chart-readout')).toHaveText('B: 5');
  host.setInput('series', [{x: 'C', y: 6}, {x: 'B', y: 5}, {x: 'A', y: 2}]); await host.publish();
  await expect(page.locator('.chart-readout')).toHaveText('B: 5');
  host.setInput('series', [{x: 'B', y: 5}, {x: 'B', y: 5}, {x: 'A', y: 2}]); await host.publish();
  await expect(page.locator('.chart-readout')).toHaveCount(0);
});
