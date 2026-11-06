import {readFile} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {chromium, type Browser} from '@playwright/test';

const startupPath = fileURLToPath(new URL('../apps/desktop/startup.html', import.meta.url));
const startupUrl = pathToFileURL(startupPath).href;
const viewports = [
  {width: 420, height: 190},
  {width: 390, height: 190},
  {width: 420, height: 160},
  {width: 390, height: 160},
  {width: 420, height: 148},
  {width: 390, height: 148},
];

describe('static startup feedback', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({headless: true, ...(process.platform === 'win32' ? {channel: 'msedge'} : {})});
  });

  afterAll(async () => {
    await browser?.close();
  });

  for (const viewport of viewports) {
    it(`keeps all feedback below OS controls without overflow at ${viewport.width}x${viewport.height}`, async () => {
      const page = await browser.newPage({viewport, reducedMotion: 'reduce'});
      try {
        await page.goto(startupUrl);
        const geometry = await page.evaluate(() => {
          const bounds = (selector: string) => {
            const node = document.querySelector(selector);
            if (!node) return null;
            const rect = node.getBoundingClientRect();
            return {left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height};
          };
          return {
            scrollWidth: document.documentElement.scrollWidth,
            scrollHeight: document.documentElement.scrollHeight,
            chrome: bounds('.startup-chrome'),
            heading: bounds('h1'),
            description: bounds('p'),
            mark: bounds('.startup-mark'),
            pending: bounds('.startup-pending'),
          };
        });
        expect(geometry.scrollWidth).toBeLessThanOrEqual(viewport.width);
        expect(geometry.scrollHeight).toBeLessThanOrEqual(viewport.height);
        expect(geometry.chrome?.height).toBe(42);
        for (const [name, rect] of Object.entries({heading: geometry.heading, description: geometry.description, mark: geometry.mark, pending: geometry.pending})) {
          expect(rect, `${name} must exist`).not.toBeNull();
          expect(rect!.top, `${name} overlaps OS overlay`).toBeGreaterThanOrEqual(42);
          expect(rect!.left).toBeGreaterThanOrEqual(12);
          expect(rect!.right).toBeLessThanOrEqual(viewport.width - 12);
          expect(rect!.bottom, `${name} is clipped`).toBeLessThanOrEqual(viewport.height - 8);
          expect(rect!.height).toBeGreaterThan(0);
        }
        expect(geometry.description!.top).toBeGreaterThanOrEqual(geometry.heading!.bottom);
      } finally {
        await page.close();
      }
    });
  }

  it('keeps startup feedback accessible and self-contained without fake controls or scripts', async () => {
    const source = await readFile(startupPath, 'utf8');
    const page = await browser.newPage();
    try {
      await page.goto(startupUrl);
      expect(await page.getByRole('heading', {name: 'Opening your workspace', level: 1}).count()).toBe(1);
      expect(await page.getByRole('status').count()).toBe(1);
      expect(await page.getByRole('status').getAttribute('aria-live')).toBe('polite');
      expect(await page.getByRole('progressbar').count()).toBe(0);
      expect(await page.locator('[aria-valuenow]').count()).toBe(0);
      expect(await page.locator('p').count()).toBe(1);
      expect((await page.locator('p').innerText()).length).toBeLessThan(45);
      expect(await page.locator('script, iframe, button, input, a, [onclick]').count()).toBe(0);
      expect(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')).toBe("default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'");
      expect(source).not.toMatch(/https?:\/\//i);
      expect(await page.locator('html').getAttribute('lang')).toBe('en');
    } finally {
      await page.close();
    }
  });

  it('keeps a static pending glyph in full and reduced motion without an idle animation loop', async () => {
    const page = await browser.newPage({viewport: {width: 420, height: 190}});
    try {
      await page.goto(startupUrl);
      expect(await page.locator('.startup-pending').count()).toBe(1);
      const marker = () => page.locator('.startup-pending').evaluate(node => {
        const style = getComputedStyle(node);
        return {animation: style.animationName, width: parseFloat(style.width), height: parseFloat(style.height), opacity: style.opacity};
      });
      expect((await marker()).animation).toBe('none');
      await page.emulateMedia({reducedMotion: 'reduce'});
      const reduced = await marker();
      expect(reduced.animation).toBe('none');
      expect(reduced.width).toBeGreaterThan(0);
      expect(reduced.height).toBeGreaterThan(0);
      expect(Number(reduced.opacity)).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  });
});
