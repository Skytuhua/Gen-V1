import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {expect as visible} from '@playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {createServer, type Server} from 'node:http';
import {chromium, type Browser, type Page} from '@playwright/test';
import {fixture} from './agents-workspace-grid-fixture';
import type {AgentsWorkspaceController} from '../apps/web/src/agents-workspace/controller';

declare global { interface Window { controller: AgentsWorkspaceController } }

const cards = (page: Page) => page.locator('.agents-agent:not(.agents-child)');

describe('agents workspace grid layout', () => {
  let browser: Browser, server: Server, base: string, script: string, css: string;
  beforeAll(async () => {
    script = (await build({stdin: {contents: fixture, resolveDir: process.cwd(), loader: 'tsx'}, loader: {'.css': 'empty'}, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: {'process.env.NODE_ENV': '"production"'}})).outputFiles[0]!.text;
    css = (await Promise.all([
      'packages/ui-shell/tokens.css', 'packages/ui-shell/controls.css', 'packages/ui-shell/feedback.css', 'apps/web/src/styles.css',
      'apps/web/src/loading-state.css', 'apps/web/src/markdown.css', 'apps/web/src/composer-commands.css', 'apps/web/src/native-chrome.css',
      'apps/web/src/agents-workspace/agents-workspace.css',
    ].map(file => readFile(file, 'utf8')))).join('\n');
    server = createServer((_request, response) => {response.setHeader('content-type', 'text/html'); response.end(`<style>${css}</style><div id="root"></div><script>${script}</script>`);});
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    browser = await chromium.launch({headless: true, ...(process.platform === 'win32' ? {channel: 'msedge'} : {})});
  });
  afterAll(async () => {await browser?.close(); server?.close();});
  async function open(width: number, height = 1000): Promise<Page> {
    const page = await browser.newPage({viewport: {width, height}});
    await page.goto(`${base}/`);
    await page.waitForSelector('html[data-ready="true"]');
    return page;
  }
  const trackCount = (page: Page) => page.locator('.agents-agent-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length);
  const projectSlotCoversGrid = (page: Page) => page.locator('.agents-project-slot').evaluate(slot => {
    const grid = slot.querySelector('.agents-agent-grid')!;
    return slot.getBoundingClientRect().height >= grid.getBoundingClientRect().height - 1;
  });
  const noHorizontalOverflow = (page: Page, width: number) => page.evaluate(width => ({
    page: document.documentElement.scrollWidth <= width,
    workspace: Math.max(document.querySelector('.agents-projects')!.scrollWidth - document.querySelector('.agents-projects')!.clientWidth, 0) <= 1,
  }), width);

  it('lays out four equal columns at desktop content width and reaches every card vertically without horizontal overflow', async () => {
    const page = await open(1440);
    try {
      expect(await trackCount(page)).toBe(4);
      const tops = await cards(page).evaluateAll(elements => elements.map(element => Math.round(element.getBoundingClientRect().top)));
      expect(tops.slice(0, 4)).toEqual(new Array(4).fill(tops[0]));
      expect(tops.slice(4, 8)).toEqual(new Array(4).fill(tops[4]));
      expect(tops[4]).toBeGreaterThan(tops[0]);
      expect(await projectSlotCoversGrid(page)).toBe(true);
      expect(await noHorizontalOverflow(page, 1440)).toEqual({page: true, workspace: true});
      await cards(page).nth(7).scrollIntoViewIfNeeded();
      expect(await cards(page).nth(7).evaluate(element => {
        const card = element.getBoundingClientRect(), view = element.closest('.agents-projects')!.getBoundingClientRect();
        return card.top >= view.top - 1 && card.bottom <= view.bottom + 1;
      })).toBe(true);
      await page.setViewportSize({width: 1920, height: 1000});
      expect(await trackCount(page)).toBe(4);
      expect(await noHorizontalOverflow(page, 1920)).toEqual({page: true, workspace: true});
    } finally {await page.close();}
  });

  it('stretches every card to fill its grid slot width', async () => {
    const page = await open(1440);
    try {
      const fills = await page.locator('.agents-grid-slot').evaluateAll(slots => slots.map(slot => {
        const card = slot.querySelector('.agents-agent');
        return card !== null && Math.abs(slot.getBoundingClientRect().width - card.getBoundingClientRect().width) <= 1;
      }));
      expect(fills.length).toBe(8);
      expect(fills.every(Boolean)).toBe(true);
    } finally {await page.close();}
  });

  it('collapses to two columns at narrow content width and one below 768', async () => {
    const page = await open(900);
    try {
      expect(await trackCount(page)).toBe(2);
      expect(await noHorizontalOverflow(page, 900)).toEqual({page: true, workspace: true});
      await page.setViewportSize({width: 600, height: 1000});
      expect(await trackCount(page)).toBe(1);
      expect(await noHorizontalOverflow(page, 600)).toEqual({page: true, workspace: true});
    } finally {await page.close();}
  });

  it('navigates cards with arrow keys in grid order and leaves transcript scrolling alone', async () => {
    const page = await open(1440);
    try {
      const label = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
      await page.locator('.agents-agent-grid').focus();
      await page.keyboard.press('ArrowRight');
      expect(await label()).toBe('Agent parent-00');
      await page.keyboard.press('ArrowRight');
      expect(await label()).toBe('Agent parent-01');
      await page.keyboard.press('ArrowDown');
      expect(await label()).toBe('Agent parent-05');
      expect(await cards(page).nth(4).evaluate(element => {
        const card = element.getBoundingClientRect(), view = element.closest('.agents-projects')!.getBoundingClientRect();
        return card.top >= view.top - 1 && card.bottom <= view.bottom + 1;
      })).toBe(true);
      await page.keyboard.press('ArrowLeft');
      expect(await label()).toBe('Agent parent-04');
      await page.keyboard.press('ArrowUp');
      expect(await label()).toBe('Agent parent-00');
      await page.keyboard.press('ArrowUp');
      expect(await label()).toBe('Agent parent-00');
      await page.locator('.agents-transcript').first().focus();
      await page.keyboard.press('ArrowDown');
      expect(await label()).toBe('parent-00 messages');
    } finally {await page.close();}
  });

  it('reserves a 420px card, gives the transcript two thirds of the body and keeps the composer at one 72px-capped line', async () => {
    const page = await open(1440);
    try {
      const card = cards(page).nth(3);
      await visible(card.locator('.agents-message p')).toBeVisible({timeout: 5000});
      const metrics = await card.evaluate(element => {
        const height = element.getBoundingClientRect().height;
        const header = element.querySelector('.agents-agent-header')!.getBoundingClientRect().height;
        const activity = element.querySelector('.agents-activity')!.getBoundingClientRect().height;
        const transcript = element.querySelector('.agents-transcript-wrap')!.getBoundingClientRect().height;
        const composer = element.querySelector('.agents-composer')!.getBoundingClientRect().height;
        const textarea = element.querySelector('textarea')!;
        const messageFont = getComputedStyle(element.querySelector('.agents-message p')!).fontSize;
        return {height, body: height - header - activity, transcript, composer, textareaHeight: textarea.getBoundingClientRect().height, textareaMax: getComputedStyle(textarea).maxHeight, messageFont};
      });
      expect(metrics.height).toBeGreaterThanOrEqual(416);
      expect(metrics.height).toBeLessThanOrEqual(430);
      expect(metrics.messageFont).toBe('14px');
      expect(metrics.transcript).toBeGreaterThanOrEqual(metrics.body * 2 / 3);
      expect(metrics.textareaHeight).toBeGreaterThanOrEqual(30);
      expect(metrics.textareaHeight).toBeLessThanOrEqual(42);
      expect(metrics.textareaMax).toBe('72px');
      const textarea = card.locator('textarea');
      await textarea.fill('first\nsecond\nthird\nfourth');
      const grown = await textarea.evaluate(element => ({height: element.getBoundingClientRect().height, scrollable: element.scrollHeight > element.clientHeight}));
      expect(grown.height).toBeLessThanOrEqual(74);
      expect(grown.scrollable).toBe(true);
    } finally {await page.close();}
  });

  it('adopts external controller scope text without clobbering active edits or looping', async () => {
    const page = await open(1440);
    try {
      await page.getByRole('button', {name: 'Search agents'}).click();
      const input = page.getByRole('searchbox', {name: 'Filter agents'});
      await visible(input).toBeVisible();
      await input.blur();
      await page.evaluate(() => window.controller.setScope({text: 'external'}));
      await visible(input).toHaveValue('external', {timeout: 2000});
      await page.waitForTimeout(400);
      await visible(input).toHaveValue('external');
      await input.focus();
      await input.fill('in-progress');
      await page.evaluate(() => window.controller.setScope({text: 'other'}));
      await visible(input).toHaveValue('in-progress');
      await page.waitForTimeout(400);
      await visible(input).toHaveValue('in-progress');
      expect(await page.evaluate(() => window.controller.getSnapshot().scope.text)).toBe('in-progress');
    } finally {await page.close();}
  });
});
