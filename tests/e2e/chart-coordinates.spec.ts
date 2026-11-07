import {test, expect, type Page, type TestInfo} from '@playwright/test';
import {serveTaskFixture, taskFixture, type TaskSpec} from './task-interface-fixture';

type Row = {x: string | number; y: string | number};
async function chart(page: Page, rows: Row[], kind: 'bar' | 'line' | 'scatter', title = 'Coordinate chart') {
  const spec: TaskSpec = {root: 'chart', elements: {chart: {type: 'Chart', props: {kind, rowsBinding: 'series', xKey: 'x', yKey: 'y', title}}}};
  await serveTaskFixture(page, taskFixture(spec, {series: rows}));
  await page.goto('/');
  await expect(page.locator('.chart')).toBeVisible({timeout: 30000});
}

async function geometry(page: Page, info: TestInfo) {
  const result = await page.locator('.chart svg').evaluate(svg => ({
    viewBox: svg.getAttribute('viewBox'),
    points: Array.from(svg.querySelectorAll('circle'), circle => ({x: Number(circle.getAttribute('cx')), y: Number(circle.getAttribute('cy'))})),
    labels: Array.from(svg.querySelectorAll('g > text'), label => Number(label.getAttribute('x'))),
    polyline: svg.querySelector('polyline')?.getAttribute('points') ?? null,
  }));
  await info.attach('chart-geometry', {body: JSON.stringify(result, null, 2), contentType: 'application/json'});
  return result;
}

async function rawRows(page: Page, rows: Row[]) {
  await page.getByText('View chart data', {exact: true}).click();
  const raw = page.locator('.chart details pre');
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
  // JSON cannot represent NaN or numeric infinities. These transported strings
  // exercise invalid/nonfinite Number coercion while preserving the source rows.
  {name: 'invalid and nonfinite y coercions use finite zero coordinates', kind: 'scatter', rows: [{x: 0, y: 'not numeric'}, {x: 1, y: 'Infinity'}, {x: 2, y: '-Infinity'}, {x: 3, y: '5'}], xs: [30, 210, 390, 570], ys: [210, 210, 210, 30]},
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
  await expect(page.locator('.chart svg')).toHaveAttribute('viewBox', '0 0 600 80');
  await expect(page.locator('.chart svg g > text').nth(1)).toHaveText('3');
  await expect(page.locator('.chart svg g > text').nth(3)).toHaveText('8');
  await expect(page.locator('.chart circle, .chart polyline')).toHaveCount(0);
  await rawRows(page, rows);
});
