import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { aggregate, parseArgs, normalizeMotion, isReducedOffender, motionKey, table, hasDistinctRecipe, imageStatus, coverageMatrix, type Motion, type CaptureEntry } from './helpers';
import { screens, keyStates, type Action } from './screen-map';
import { discover } from './scope';
import { collect, frameStrip } from './browser';
import { apiResponse } from './api';
import { shellSnapshot, shellRoute, shellInit } from './shell-api';
import { scopeMarkdown, skipEntry } from './reports';

async function main() {
  const started = performance.now();
  const args = parseArgs(process.argv.slice(2));
  const scope = args.scope === 'baseline' ? { ...aggregate([]), source: 'baseline', warnings: [] } : discover(args.sinceDays);
  const ids = args.screens.length ? args.screens : args.scope === 'diff' ? scope.screens : screens.map(s => s.id);
  for (const id of ids) if (!screens.some(s => s.id === id)) throw Error(`Unknown screen ${id}`);
  const selected = screens.filter(s => ids.includes(s.id));
  const out = resolve(args.out || `artifacts/ui-capture/${new Date().toISOString().replaceAll(':', '-')}`);
  await Promise.all(['strips', 'screenshots'].map(dir => mkdir(resolve(out, dir), { recursive: true })));
  const json = (name: string, data: unknown) => writeFile(resolve(out, `${name}.json`), JSON.stringify(data, null, 2));
  const md = (name: string, body: string) => writeFile(resolve(out, `${name}.md`), body);
  await json('scope', scope);
  await md('scope', scopeMarkdown(scope));
  const entries: CaptureEntry[] = [], stripEntries: Record<string, unknown>[] = [], motion: Motion[] = [], reduced: Motion[] = [];
  const seen = new Set<string>(), defaults = new Map<string, string>();
  const servers: Awaited<ReturnType<typeof createServer>>[] = [];
  let failed = false;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const start = async (configFile: string) => {
      const server = await createServer({ configFile: resolve(configFile), server: { port: 0, strictPort: false } });
      servers.push(server);
      await server.listen();
      return server.resolvedUrls!.local[0];
    };
    const fixtureBase = process.env.BASE_URL ?? (selected.some(s => s.id !== 'app-shell') ? await start('scripts/capture-ui/vite.config.ts') : '');
    // The actual application uses its own unchanged root config and page /.
    const appBase = process.env.BASE_URL ?? (selected.some(s => s.id === 'app-shell') ? await start('tests/e2e/vite.config.ts') : '');
    browser = await chromium.launch({ headless: true });
    const tile = await browser.newPage({ viewport: { width: 1200, height: 500 } });
    for (const screen of selected) for (const width of [375, 768, 1440]) for (const state of keyStates) {
      const recipe = screen.states[state];
      if (!recipe || recipe.skip) {
        entries.push(skipEntry(screen.id, state, width, recipe?.skip ?? (state === 'loading' ? 'Synchronous fixture: no fetch/loading query boundary' : 'No reachable state recipe in the existing fixture')));
        continue;
      }
      if (state !== 'default' && !hasDistinctRecipe(recipe, screen.states.default)) {
        entries.push(skipEntry(screen.id, state, width, 'Empty recipe cannot represent a distinct state', 'E'));
        continue;
      }
      const base = screen.id === 'app-shell' ? appBase : fixtureBase;
      for (const reduce of [false, true]) {
        let heldRequests = 0, observedHold!: () => void;
        const holdStarted = new Promise<void>(resolve => { observedHold = resolve; });
        let loaded = false, release!: () => void;
        const held = new Promise<void>(resolve => { release = resolve; });
        const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: reduce ? 'reduce' : 'no-preference', serviceWorkers: 'block' });
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        // tsx's function-name helper must also exist in evaluated Chromium callbacks.
        await page.addInitScript({ content: `
          globalThis.__name = (fn) => fn;
          globalThis.captureTracked = new Set();
          (function sample() { document.getAnimations().forEach(a => globalThis.captureTracked.add(a)); requestAnimationFrame(sample); })();
          ${screen.id === 'app-shell' ? shellInit : ''}
        ` });
        const snapshot = shellSnapshot(recipe.api === 'empty');
        const errors: string[] = [];
        page.on('pageerror', e => errors.push(e.message));
        try {
          await context.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (!['http:', 'https:'].includes(url.protocol)) return route.continue();
            if (url.origin !== new URL(base).origin) return route.abort('blockedbyclient');
            if (!url.pathname.startsWith('/api/')) return route.continue();
            if (recipe.api === 'loading' && recipe.hold && new RegExp(recipe.hold).test(url.pathname)) {
              heldRequests++;
              observedHold();
              await held; // Remains unresolved through screenshot and motion/strip sampling.
              try { await route.abort(); } catch { /* Context may already be closing. */ }
              return;
            }
            if (screen.id === 'app-shell') return shellRoute(route, snapshot, recipe.api === 'error');
            if (recipe.api === 'error' && url.pathname !== '/api/bootstrap') return route.fulfill({ status: 503, json: { error: { code: 'CAPTURE_503', message: 'Synthetic data unavailable. Retry.' } } });
            const response = apiResponse(url, false, recipe.api === 'empty');
            if (response) return route.fulfill({ json: response });
            if (url.pathname === '/api/bootstrap') return route.fulfill({ json: { csrfToken: 'capture-fixture' } });
            if (url.pathname === '/api/agents') return route.fulfill({ json: { authority: 'personal', scopeKey: 'capture', sequence: 0, items: [], ancestors: [], nextCursor: null } });
            if (url.pathname.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': capture\n\n' });
            if (url.pathname.endsWith('/updates')) return route.fulfill({ json: { sequence: 0, upserts: [], removed: [], ancestors: [], transcripts: [] } });
            return route.fulfill({ status: 503, json: { error: { code: 'CAPTURE_FIXTURE', message: 'No live host in capture harness' } } });
          });
          const pathname = screen.page ?? `/capture/${screen.id}`;
          const response = await page.goto(`${base.replace(/\/$/, '')}${pathname}${recipe.query ? `?${recipe.query}` : ''}`, { waitUntil: recipe.api === 'loading' ? 'domcontentloaded' : 'networkidle', timeout: 30000 });
          if (!response?.ok()) throw Error(`HTTP ${response?.status()}`);
          await page.locator(recipe.ready ?? screen.ready).first().waitFor();
          if (!await page.locator('#root').evaluate(el => el.childElementCount > 0)) throw Error('Empty fixture root');
          if (errors.length) throw Error(errors.join('; '));
          loaded = true;
          const initial = (await collect(page, screen.id, `${state}:load`, width, true)).map(normalizeMotion);
          const actions: Action[] = recipe.steps ?? (recipe.selector && recipe.action ? [{ selector: recipe.selector, action: recipe.action, key: recipe.key }] : []);
          for (const action of actions) {
            const target = page.locator(action.selector).first();
            if (action.optional && !await target.isVisible()) continue;
            if (action.action === 'press') await target.press(action.key ?? 'Enter', { timeout: 4000 });
            else await target[action.action]({ timeout: 4000 });
          }
          if (recipe.waitFor) await page.locator(recipe.waitFor).first().waitFor({ timeout: 4000 });
          if (recipe.waitMs) await page.waitForTimeout(recipe.waitMs);
          if (recipe.api === 'loading') await Promise.race([holdStarted, page.waitForTimeout(4000).then(() => { throw Error('Loading recipe did not intercept a data request'); })]);
          await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
          const records = (await collect(page, screen.id, state, width)).map(normalizeMotion);
          if (errors.length) throw Error(errors.join('; '));
          if (reduce) reduced.push(...initial, ...records);
          else {
            motion.push(...initial, ...records);
            await mkdir(resolve(out, 'screenshots', screen.id), { recursive: true });
            const path = `screenshots/${screen.id}/${state}-${width}.png`;
            const bytes = await page.screenshot({ path: resolve(out, path), fullPage: true });
            const hash = createHash('sha256').update(bytes).digest('hex');
            const baselineKey = `${screen.id}/${width}`;
            const status = state === 'default' ? 'captured' : imageStatus(defaults.get(baselineKey), hash);
            if (state === 'default') defaults.set(baselineKey, hash);
            entries.push({ screen: screen.id, state, width, status, path, hash, ...(recipe.api === 'loading' ? { heldRequests } : {}), ...(status === 'identical-to-default' ? { code: 'I', reason: 'PNG bytes match default at the same viewport width' } : {}) });
            const stripRecords = (await collect(page, screen.id, state, width, true)).map(normalizeMotion);
            for (let i = 0; i < stripRecords.length; i++) {
              const record = stripRecords[i], key = motionKey(record);
              if (seen.has(key)) continue;
              seen.add(key);
              if (stripEntries.filter(s => s.status === 'captured').length >= args.maxStrips) { stripEntries.push({ screen: screen.id, selector: record.selector, status: 'skipped', reason: 'max-strips cap' }); continue; }
              const path = `strips/${String(seen.size).padStart(3, '0')}-${screen.id}.png`;
              try { await frameStrip(page, tile, i, resolve(out, path)); stripEntries.push({ screen: screen.id, selector: record.selector, path, status: 'captured' }); }
              catch (error) { stripEntries.push({ screen: screen.id, selector: record.selector, status: 'skipped', reason: String(error) }); }
            }
          }
        } catch (error) {
          console.warn(`${screen.id}/${state}/${width}${reduce ? ':reduce' : ''}: ${String(error)}`);
          if (!loaded) failed = true;
          entries.push({ ...skipEntry(screen.id, state, width, String(error), loaded ? 'F' : 'L'), reduced: reduce, loadFailure: !loaded });
        } finally { release(); await context.close(); }
      }
      console.log(`${screen.id}/${state}/${width}`);
    }
  } finally { await browser?.close(); await Promise.all(servers.map(s => s.close())); }
  const offenders = reduced.filter(isReducedOffender);
  const totals = { screens: selected.length, screenshots: entries.filter(e => e.status === 'captured').length, identicalToDefault: entries.filter(e => e.status === 'identical-to-default').length, motionRows: motion.length, uniqueAnimations: new Set(motion.map(motionKey)).size, strips: stripEntries.filter(e => e.status === 'captured').length, reducedMotionOffendersUnique: new Set(offenders.map(motionKey)).size, reducedMotionOffendersTotal: offenders.length };
  const matrix = coverageMatrix(selected.map(s => s.id), entries);
  const manifest = { scope: args.scope, screens: selected.map(s => s.id), widths: [375, 768, 1440], desktopOnly: scope.desktopOnly, desktopNote: 'Native desktop surfaces are not captured by the web harness.', totals, screenshots: totals.screenshots, motionRecords: motion.length, reducedMotionOffenders: offenders.length, coverage: matrix, strips: stripEntries, entries, failed, runtimeSeconds: Math.round((performance.now() - started) / 1000) };
  await Promise.all([
    json('motion', motion), md('motion', '# Motion\n\n' + table(motion.map(({ keyframes: _frames, ...m }) => m))),
    json('reduced-motion', { thresholdMs: 1, records: reduced, offenders }), md('reduced-motion', '# Reduced motion offenders (>1ms)\n\n' + table(offenders.map(({ keyframes: _frames, ...m }) => m))),
    json('manifest', manifest),
    md('index', `# UI capture\n\n${table([totals])}\nRuntime: ${manifest.runtimeSeconds}s.\n\n## Coverage matrix\n\nCells list captured widths. U = unsupported/explicit exclusion; E = empty recipe; I = identical to default; F = state action failure; L = screen load failure. Codes are followed by viewport width. Full reasons below and in manifest.json.\n\n${table(matrix)}\n${manifest.desktopNote}\n\n[Scope](scope.md) · [Motion](motion.md) · [Reduced motion](reduced-motion.md) · [Manifest](manifest.json)\n\n## State outcomes and skipped reasons\n\n${table(entries.map(e => ({ screen: e.screen, state: e.state, width: e.width, reduced: e.reduced ?? false, status: e.status, path: e.path ?? '', reason: e.reason ?? '' })))}\n## Frame strips\n\n${table(stripEntries)}`),
  ]);
  console.log(`Capture written to ${out} (${manifest.runtimeSeconds}s)`);
  if (failed) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
