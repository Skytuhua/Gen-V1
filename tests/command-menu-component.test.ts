import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {build} from 'esbuild';
import {chromium, type Browser, type Page} from '@playwright/test';

const fixture = `import React from 'react';
import {createRoot} from 'react-dom/client';
import {CommandMenu} from './apps/web/src/CommandMenu';

const calls = [];
(window as any).calls = calls;
(window as any).closeCount = 0;
let threadResults = {items: [], pending: false, error: '', retry: () => calls.push('retry')};
let open = true;
const root = createRoot(document.getElementById('root'));
function render() {
  root.render(
    <CommandMenu
      open={open}
      onClose={() => {open = false; (window as any).closeCount += 1; render();}}
      commands={commands}
      threadResults={() => threadResults}
      chord={binding => binding === 'new-thread' ? 'Ctrl+Shift+O' : undefined}
      reportError={error => calls.push('error:' + String(error))}
    />);
}
(window as any).setThreadResults = value => {threadResults = value; render();};
(window as any).reopen = () => {open = true; render();};

const commands = [
  {id: 'new-thread', group: 'actions', label: 'New thread', bindingId: 'new-thread', run: () => calls.push('new-thread')},
  {id: 'stop-run', group: 'actions', label: 'Stop active run', disabledReason: 'No active run', run: () => calls.push('stop-run')},
  {id: 'files', group: 'panels', label: 'Open Files panel', run: () => calls.push('files')},
  {id: 'appearance', group: 'settings', label: 'Open settings: Appearance', detail: 'Settings', run: () => calls.push('appearance')},
];
render();
`;

describe('CommandMenu component', () => {
  let browser: Browser, script: string;
  beforeAll(async () => {
    script = (await build({
      stdin: {contents: fixture, resolveDir: process.cwd(), loader: 'tsx'},
      bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
      loader: {'.css': 'empty'}, define: {'process.env.NODE_ENV': '"production"'},
    })).outputFiles[0]!.text;
    browser = await chromium.launch({headless: true, ...(process.platform === 'win32' ? {channel: 'msedge'} : {})});
  });
  afterAll(async () => {await browser?.close();});

  const mount = async (page: Page) => {
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({content: script});
    await expect.poll(() => page.getByRole('textbox', {name: 'Search commands'}).isEnabled().catch(() => false)).toBe(true);
  };
  const visible = async (locator: {isVisible(): Promise<boolean>}) => locator.isVisible().catch(() => false);

  it('shows groups on empty query and live-announces counts', async () => {
    const page = await browser.newPage();
    try {
      await mount(page);
      expect(await visible(page.getByRole('group', {name: 'Actions'}))).toBe(true);
      expect(await visible(page.getByRole('group', {name: 'Panels'}))).toBe(true);
      expect(await visible(page.getByRole('group', {name: 'Settings'}))).toBe(true);
      await expect.poll(() => page.locator('.visually-hidden').textContent()).toBe('4 results');
      // Chord hint follows the provided chords.
      expect(await page.locator('.ui-control-shortcut').first().textContent()).toBe('Ctrl+Shift+O');
    } finally {await page.close();}
  });

  it('filters by typing, wraps arrow navigation and skips disabled', async () => {
    const page = await browser.newPage();
    try {
      await mount(page);
      const input = page.getByRole('textbox', {name: 'Search commands'});
      await input.fill('open');
      const options = page.getByRole('option');
      expect(await options.count()).toBe(3); // 'open' also subsequences into 'Stop active run'
      // Groups render in group order: Actions (disabled 'stop-run') then Panels/Settings.
      await expect.poll(() => options.nth(1).getAttribute('aria-selected')).toBe('true');
      // ArrowUp wraps to the last enabled row; the disabled option is skipped.
      await input.press('ArrowUp');
      expect(await options.nth(2).getAttribute('aria-selected')).toBe('true');
      await input.press('ArrowDown');
      expect(await options.nth(1).getAttribute('aria-selected')).toBe('true');
    } finally {await page.close();}
  });

  it('Enter on a pointer-highlighted disabled row does nothing; enabled row closes then runs', async () => {
    const page = await browser.newPage();
    try {
      await mount(page);
      const input = page.getByRole('textbox', {name: 'Search commands'});
      // Pointer can land on a disabled row; Enter stays a no-op.
      await page.getByRole('option', {name: /Stop active run/}).dispatchEvent('pointermove');
      await input.press('Enter');
      expect(await page.evaluate(() => (window as any).calls)).toEqual([]);
      expect(await page.evaluate(() => (window as any).closeCount)).toBe(0);
      // Keyboard moves back onto an enabled row; Enter closes then runs once.
      await input.press('ArrowDown');
      await input.press('Enter');
      await expect.poll(() => page.evaluate(() => (window as any).calls)).toEqual(['files']);
      expect(await page.evaluate(() => (window as any).closeCount)).toBe(1);
    } finally {await page.close();}
  });

  it('runs a clicked row and shows thread pending/error/empty states', async () => {
    const page = await browser.newPage();
    try {
      await mount(page);
      await page.getByRole('option', {name: /Open Files panel/}).click();
      await expect.poll(() => page.evaluate(() => (window as any).calls)).toEqual(['files']);
      // Closed after click; reopen for the query states.
      await page.evaluate(() => (window as any).reopen());
      const input = page.getByRole('textbox', {name: 'Search commands'});
      await input.fill('zzzzz');
      expect(await visible(page.getByText('No results for “zzzzz”'))).toBe(true);
      await expect.poll(() => page.locator('.visually-hidden').textContent()).toBe('No results');
      // Pending threads shows a searching row; error shows retry which calls retry().
      await page.evaluate(() => (window as any).setThreadResults({items: [], pending: true, error: '', retry: () => (window as any).calls.push('retry')}));
      expect(await visible(page.getByText('Searching threads…'))).toBe(true);
      await page.evaluate(() => (window as any).setThreadResults({items: [], pending: false, error: 'offline', retry: () => (window as any).calls.push('retry')}));
      expect(await visible(page.getByText('offline'))).toBe(true);
      await page.getByRole('button', {name: 'Retry'}).click();
      expect(await page.evaluate(() => (window as any).calls)).toEqual(['files', 'retry']);
    } finally {await page.close();}
  });
});
