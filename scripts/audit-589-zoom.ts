/** Issue #589 audit: layout resilience at UI zoom and OS text scale.
 * Method (plan rev-1): effective viewport = 1280/z x 800/z CSS px with deviceScaleFactor=z
 * (equivalent to browser zoom z at 1280x800). Text-scale leg sets
 * documentElement.style.fontSize='200%' + reload (WCAG 1.4.4 proxy).
 * Usage: pnpm exec tsx scripts/audit-589-zoom.ts [--output dir] [--zoom 1.5,2]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { openReviewHost } from './review-host.ts';

const arg = (key: string) => { const i = process.argv.indexOf(key); return i >= 0 ? process.argv[i + 1] : undefined; };
const OUT = resolve(arg('--output') ?? `test-results/zoom-589-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const ZOOMS = (arg('--zoom')?.split(',').map(Number) ?? [1.10, 1.25, 1.50, 1.75, 2.00]);
const BASE = { w: 1280, h: 800 };

const PROBE = `(() => {
  const vw = innerWidth, vh = innerHeight;
  const doc = document.documentElement;
  const seen = new Set(); const out = { vw, vh, hscroll: doc.scrollWidth - doc.clientWidth, clipped: [], truncated: [], overlaps: [] };
  const name = el => (el.getAttribute('aria-label') || el.title || el.textContent || el.className || el.tagName).trim().slice(0, 70);
  const vis = el => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; };
  const reachable = el => { // inside a scrollable ancestor, an off-canvas drawer, or hidden subtree
    for (let n = el.parentElement; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (n.hasAttribute('inert') || s.transform !== 'none' || s.translate !== 'none' || n.getAttribute('aria-hidden') === 'true') return true;
      if (/(auto|scroll)/.test(s.overflowY + s.overflowX) && (n.scrollHeight > n.clientHeight + 4 || n.scrollWidth > n.clientWidth + 4)) return true;
    }
    return false;
  };
  for (const el of document.querySelectorAll('button,[role=tab],select,input[type=text],input[type=search],textarea')) {
    if (!vis(el) || seen.has(el)) continue; seen.add(el);
    const r = el.getBoundingClientRect();
    if (r.right < -1 || r.bottom < -1 || r.left > vw + 1 || r.top > vh + 1) { if (!reachable(el)) out.clipped.push({ kind: 'off-viewport', what: name(el), rect: [r.left | 0, r.top | 0, r.width | 0, r.height | 0] }); }
    else if ((r.width < 20 && el.tagName !== 'SELECT') || r.height < 14) out.clipped.push({ kind: 'undersize', what: name(el), rect: [r.left | 0, r.top | 0, r.width | 0, r.height | 0] });
  }
  for (const el of document.querySelectorAll('button,[role=tab],strong,span,label,th')) {
    if (!vis(el) || seen.has(el)) continue;
    const cs = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 2 && cs.textOverflow === 'ellipsis' && !el.title && !el.getAttribute('aria-label') && !el.closest('[title],[aria-label]')) out.truncated.push(name(el) || el.className.slice(0, 70));
  }
  const dock = document.querySelector('.ui-tool-dock,.workspace-tools,.desktop-browser-dock');
  const convo = document.querySelector('.canvas-thread-view,.conversation-scroll,.workspace');
  if (dock && convo && vis(dock) && vis(convo)) {
    const a = dock.getBoundingClientRect(), b = convo.getBoundingClientRect();
    const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ox > 2 && oy > 2) out.overlaps.push({ what: 'dock-vs-conversation', px: [ox | 0, oy | 0] });
  }
  return out;
})()`;

type Cell = { zoom: number; textScale: number; surface: string; result: string; detail?: unknown };

async function boot(page: import('@playwright/test').Page, threadId: string, host: Awaited<ReturnType<typeof openReviewHost>>) {
  await host.service.command({ id: randomUUID(), type: 'settings.update', payload: { theme: 'dark', modelId: 'review/local-fixture', preferences: { archiveConfirmation: false } } });
  await page.goto('http://127.0.0.1:4347');
  await page.evaluate(id => { localStorage.setItem('harness:selected-thread', id); localStorage.removeItem('harness:shell-layout:v1'); }, threadId);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible({ timeout: 20000 });
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const host = await openReviewHost(join(OUT, 'fixture-' + randomUUID().slice(0, 8)));
  const browser = await chromium.launch({ headless: true, args: ['--disable-background-timer-throttling'] });
  const cells: Cell[] = [];
  const tag = (z: number) => `z${String(z).replace('.', '')}`;
  try {
    const shell = host.threads.get('shell')!, signing = host.threads.get('signing')!;
    for (const z of ZOOMS) {
      const ctx = await browser.newContext({ viewport: { width: Math.round(BASE.w / z), height: Math.round(BASE.h / z) }, deviceScaleFactor: z });
      const page = await ctx.newPage();
      await boot(page, shell.id, host);
      cells.push({ zoom: z, textScale: 1, surface: 'chrome+composer', result: JSON.stringify(await page.evaluate(PROBE)) });
      await page.screenshot({ path: join(OUT, `${tag(z)}-chrome.png`) });

      // Settings surface (open the nav drawer first when the sidebar collapsed)
      const settings = page.getByRole('button', { name: 'Settings', exact: true });
      try {
        try { await settings.click({ timeout: 3000 }); }
        catch {
          const nav = page.getByRole('button', { name: /open navigation|toggle sidebar|menu/i }).first();
          await nav.click(); await page.waitForTimeout(600);
          await page.screenshot({ path: join(OUT, `${tag(z)}-navdrawer.png`) });
          await settings.click({ timeout: 5000 });
        }
        await page.waitForTimeout(400);
        cells.push({ zoom: z, textScale: 1, surface: 'settings', result: JSON.stringify(await page.evaluate(PROBE)) });
        await page.screenshot({ path: join(OUT, `${tag(z)}-settings.png`) });
        const close = page.getByRole('button', { name: 'Close settings' }); if (await close.isVisible()) await close.click();
      } catch { cells.push({ zoom: z, textScale: 1, surface: 'settings', result: 'SKIP:unreachable' }); }

      // Side chat (floating window surface) via /btw composer command
      try {
        await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toHaveText('Local UI demo · no model inference', { timeout: 8000 });
        const box = page.getByRole('textbox', { name: 'Message', exact: true });
        await box.fill('/btw audit question');
        await page.getByRole('button', { name: 'Send message', exact: true }).click({ timeout: 8000 });
        await page.waitForTimeout(900);
        const floatWin = page.locator('.floating-window,.side-chat-window').first();
        if (await floatWin.isVisible()) {
          cells.push({ zoom: z, textScale: 1, surface: 'side-chat+floating', result: JSON.stringify(await page.evaluate(PROBE)) });
          await page.screenshot({ path: join(OUT, `${tag(z)}-sidechat.png`) });
          const closeBtn = floatWin.getByRole('button', { name: /close/i }).first(); if (await closeBtn.isVisible()) await closeBtn.click().catch(() => {});
        } else cells.push({ zoom: z, textScale: 1, surface: 'side-chat', result: 'SKIP:no-window' });
      } catch { cells.push({ zoom: z, textScale: 1, surface: 'side-chat', result: 'SKIP:send-disabled' }); }

      // Document preview surface
      await page.evaluate(id => { localStorage.setItem('harness:selected-thread', id); }, signing.id);
      await page.reload();
      await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible({ timeout: 20000 });
      await page.waitForTimeout(600);
      cells.push({ zoom: z, textScale: 1, surface: 'document-preview', result: JSON.stringify(await page.evaluate(PROBE)) });
      await page.screenshot({ path: join(OUT, `${tag(z)}-docpreview.png`) });
      await ctx.close();
    }

    // Text-scale leg: documentElement fontSize 200% + reload, zoom 1.0 viewport
    {
      const ctx = await browser.newContext({ viewport: { width: BASE.w, height: BASE.h }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await boot(page, shell.id, host);
      await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
      await page.reload();
      await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
      await page.waitForTimeout(600);
      cells.push({ zoom: 1, textScale: 2, surface: 'chrome+composer', result: JSON.stringify(await page.evaluate(PROBE)) });
      await page.screenshot({ path: join(OUT, 'ts200-chrome.png') });
      const settings = page.getByRole('button', { name: 'Settings', exact: true });
      if (await settings.isVisible()) {
        await settings.click(); await page.waitForTimeout(400);
        cells.push({ zoom: 1, textScale: 2, surface: 'settings', result: JSON.stringify(await page.evaluate(PROBE)) });
        await page.screenshot({ path: join(OUT, 'ts200-settings.png') });
        const close = page.getByRole('button', { name: 'Close settings' }); if (await close.isVisible()) await close.click();
      }
      await ctx.close();
    }

    // Reduced-motion leg: verify token-gated motion collapse at zoom 1 (styles.css reduce block)
    {
      const ctx = await browser.newContext({ viewport: { width: BASE.w, height: BASE.h }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      await boot(page, shell.id, host);
      const motion = await page.evaluate(() => {
        const el = document.querySelector('.sidebar,.workspace-header,button');
        return el ? getComputedStyle(el).transitionDuration : 'n/a';
      });
      cells.push({ zoom: 1, textScale: 1, surface: 'reduced-motion', result: `transitionDuration=${motion}` });
      await ctx.close();
    }
  } finally {
    await writeFile(join(OUT, 'cells.json'), JSON.stringify(cells, null, 2));
    await browser.close(); await host.close();
  }
  console.log('AUDIT_OUTPUT ' + OUT);
  console.log(cells.map(c => `${c.zoom}x ts=${c.textScale} ${c.surface}: ${String(c.result).slice(0, 200)}`).join('\n'));
}
await main();
