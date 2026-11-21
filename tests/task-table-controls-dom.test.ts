import {afterAll, beforeAll, describe, it} from 'vitest';
import {build} from 'esbuild';
import {chromium, expect, type Browser, type Page} from '@playwright/test';

// Decision-level coverage for useTableControls (issue #1360): sort cycling,
// query filtering, and column moves change what the table renders.
const fixture = `
import React, {useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {useTableControls} from './apps/web/src/TaskTableControls';

const columns = [
  {key: 'name', label: 'Name'},
  {key: 'count', label: 'Count', type: 'number'},
  {key: 'state', label: 'State'},
];
const rows = [
  {name: 'beta', count: 2, state: 'done'},
  {name: 'alpha', count: 5, state: 'running'},
  {name: 'gamma', count: 1, state: 'queued'},
];

function Fixture() {
  const scroll = useRef<HTMLDivElement>(null);
  const table = useTableControls(columns, rows, scroll, () => {}, false);
  return <div ref={scroll}>
    {table.filter}
    <table>
      <thead><tr>{table.headers}</tr></thead>
      <tbody>{table.view.map(entry => <tr key={entry.index}>{table.columns.map(column => <td key={column.key} data-column-key={column.key}>{String(entry.item[column.key] ?? '')}</td>)}</tr>)}</tbody>
    </table>
    {table.decorations}{table.live}
  </div>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
`;

describe('useTableControls', () => {
  let browser: Browser, script: string;
  beforeAll(async () => {
    script = (await build({stdin: {contents: fixture, resolveDir: process.cwd(), loader: 'tsx'}, loader: {'.css': 'empty'}, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: {'process.env.NODE_ENV': '"production"'}})).outputFiles[0]!.text;
    browser = await chromium.launch({headless: true, ...(process.platform === 'win32' ? {channel: 'msedge'} : {})});
  });
  afterAll(async () => { await browser?.close(); }, 45000);
  async function open(): Promise<Page> {
    const page = await browser.newPage();
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({content: script});
    await expect(page.locator('tbody tr')).toHaveCount(3);
    return page;
  }
  const names = (page: Page) => page.locator('tbody td[data-column-key="name"]').allTextContents();

  it('cycles sort ascending then descending then off', async () => {
    const page = await open();
    expect(await names(page)).toEqual(['beta', 'alpha', 'gamma']);
    const sortName = page.getByRole('button', {name: 'Sort Name'});
    await sortName.click();
    await expect.poll(() => names(page)).toEqual(['alpha', 'beta', 'gamma']);
    await expect(page.locator('th[data-column-key="name"]')).toHaveAttribute('aria-sort', 'ascending');
    await sortName.click();
    await expect.poll(() => names(page)).toEqual(['gamma', 'beta', 'alpha']);
    await expect(page.locator('th[data-column-key="name"]')).toHaveAttribute('aria-sort', 'descending');
    await sortName.click();
    await expect.poll(() => names(page)).toEqual(['beta', 'alpha', 'gamma']);
    await expect(page.locator('th[data-column-key="name"]')).not.toHaveAttribute('aria-sort', /./);
  });

  it('filters rows by query and Clear restores the full list', async () => {
    const page = await open();
    await page.getByLabel('Filter rows').fill('alp');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.getByRole('button', {name: 'Clear'})).toBeVisible();
    await page.getByRole('button', {name: 'Clear'}).click();
    await expect(page.locator('tbody tr')).toHaveCount(3);
    await expect(page.getByLabel('Filter rows')).toHaveValue('');
  });

  it('moves a column with Alt+Arrow keys and announces it', async () => {
    const page = await open();
    expect(await page.locator('th[data-column-key]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.columnKey))).toEqual(['name', 'count', 'state']);
    await page.getByRole('button', {name: 'Move Name column'}).press('Alt+ArrowRight');
    await expect.poll(async () => page.locator('th[data-column-key]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.columnKey))).toEqual(['count', 'name', 'state']);
    await expect(page.locator('[role="status"]')).toContainText('Name moved to position 2 of 3');
  });
});
