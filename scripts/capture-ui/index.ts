import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs, normalizeMotion, isReducedOffender, motionKey, table, hasDistinctRecipe, imageStatus, coverageMatrix, type Motion, type CaptureEntry } from './helpers';
import { screens, keyStates, captureWidths, type Action } from './screen-map';
import { resolveScope } from './scope';
import { collect, frameStrip } from './browser';
import { apiResponse } from './api';
import { shellSnapshot, shellRoute, shellInit } from './shell-api';
import { scopeMarkdown, skipEntry, reducedMotionMarkdown } from './reports';
import { captureExitCode, mergeMotionRecords, verifyCaptureOutputs, canCaptureStrip, closeAll, retryNavigation, loadWithReadiness, isSameOriginWebSocket, withDeadline, settlePool, type StripMotionReference, type CaptureOutcome } from './runtime-helpers';
import { browserApiResponse } from './browser-data';
import { taskAssetResponse } from './task-assets';
import { createTaskSnapshot, taskSurface, TASK_RESOURCE_IDS } from './task-data';
import { pluginDocument, pluginAssets } from './plugin-assets';
import { captureServerOptions, warmPdfCapture } from './server-startup';

type StripEntry = StripMotionReference & CaptureOutcome & { path?: string; reason?: string };

async function main() {
  const started = performance.now();
  const args = parseArgs(process.argv.slice(2));
  const scope = resolveScope(args);
  const ids = args.screens.length ? args.screens : args.scope === 'diff' ? scope.screens : screens.map(s => s.id);
  for (const id of ids) if (!screens.some(s => s.id === id)) throw Error(`Unknown screen ${id}`);
  const selected = screens.filter(s => ids.includes(s.id));
  const requirePluginEvidence = selected.some(screen => screen.id === 'plugin-frame');
  const out = resolve(args.out || `artifacts/ui-capture/${new Date().toISOString().replaceAll(':', '-')}`);
  await Promise.all(['strips', 'screenshots'].map(dir => mkdir(resolve(out, dir), { recursive: true })));
  const json = (name: string, data: unknown) => writeFile(resolve(out, `${name}.json`), JSON.stringify(data, null, 2));
  const md = (name: string, body: string) => writeFile(resolve(out, `${name}.md`), body);
  await json('scope', scope);
  await md('scope', scopeMarkdown(scope));
  const entries: CaptureEntry[] = [], stripEntries: StripEntry[] = [];
  let motion: Motion[] = [], reduced: Motion[] = [];
  let stripReservations = 0;
  let pluginIframeStripReserved = false;
  const runErrors: string[] = [];
  const readinessRetries: { screen: string; state: string; width: number; reduced: boolean }[] = [];
  const seen = new Set<string>(), defaults = new Map<string, string>();
  const servers: Awaited<ReturnType<typeof createServer>>[] = [];

  let cacheRoot: string | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    if (!process.env.BASE_URL && selected.length) cacheRoot = await mkdtemp(join(tmpdir(), 'gen-ui-capture-vite-'));
    const start = async (configFile: string, role: 'fixtures' | 'app-shell') => {
      const server = await createServer(captureServerOptions(configFile, cacheRoot!, role));
      servers.push(server);
      await server.listen();
      if (role === 'fixtures' && selected.some(screen => screen.id === 'task-document')) await warmPdfCapture(server);
      return server.resolvedUrls!.local[0];
    };
    const fixtureBase = process.env.BASE_URL ?? (selected.some(s => s.id !== 'app-shell') ? await start('scripts/capture-ui/vite.config.ts', 'fixtures') : '');
    // The actual application uses its own unchanged root config and page /.
    const appBase = process.env.BASE_URL ?? (selected.some(s => s.id === 'app-shell') ? await start('tests/e2e/vite.config.ts', 'app-shell') : '');
    browser = await chromium.launch({ headless: true });
    const captureBrowser = browser;
    // States stay ordered per viewport, so identity checks have their default.
    // A bounded pool avoids idle workers behind a screen with many slow states.
    const jobs = selected.flatMap(screen => captureWidths.map(width => ({screen, width})));
    const viewports = await settlePool(jobs, 6, async ({screen, width}) => {
      const tile = await captureBrowser.newPage({ viewport: { width: 1200, height: 500 } });
      try { for (const state of keyStates) {
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
        let releasePlugin!: () => void;
        const pluginConnected = new Promise<void>(resolve => { releasePlugin = resolve; });
        const context = await captureBrowser.newContext({ viewport: { width, height: 1000 }, reducedMotion: reduce ? 'reduce' : 'no-preference', serviceWorkers: screen.id === 'plugin-frame' ? 'allow' : 'block' });
        const snapshot = shellSnapshot(recipe.api === 'empty');
        const errors: string[] = [];
        try {
          await context.routeWebSocket('**/*', socket => {
            if (isSameOriginWebSocket(socket.url(), base)) socket.connectToServer();
            else void socket.close({ code: 1008, reason: 'External WebSocket blocked by capture' });
          });
          const page = await context.newPage();
          page.setDefaultTimeout(10000);
          // tsx's function-name helper must also exist in evaluated Chromium callbacks.
          await context.addInitScript({ content: `
            globalThis.__name = (fn) => fn;
            ${screen.id === 'plugin-frame' ? `try { const sw = navigator.serviceWorker; if (sw) Object.defineProperty(sw, 'register', { value: () => Promise.reject(new Error('Capture does not start service workers')) }); } catch { /* Opaque sandbox already forbids service workers. */ }` : ''}
            globalThis.captureTracked = new Set();
            (function sample() { document.getAnimations().forEach(a => globalThis.captureTracked.add(a)); requestAnimationFrame(sample); })();
            ${screen.id === 'app-shell' ? shellInit : ''}
          ` });
          page.on('pageerror', e => errors.push(e.message));
          await context.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (!['http:', 'https:'].includes(url.protocol)) return route.continue();
            if (url.origin !== new URL(base).origin) return route.abort('blockedbyclient');
            if (url.pathname === '/capture-plugin/runtime.js') return route.fulfill({ contentType: 'text/javascript', body: (await pluginAssets()).js });
            if (url.pathname === '/capture-plugin/runtime.css') return route.fulfill({ contentType: 'text/css', body: (await pluginAssets()).css });
            if (url.pathname === '/capture-plugin/barrier.js') { await pluginConnected; try { await route.fulfill({ contentType: 'text/javascript', body: 'void 0;' }); } catch { /* Closing context. */ } return; }
            if (url.pathname.endsWith('/rpc') && url.pathname.startsWith('/api/plugins/')) releasePlugin();
            if (url.pathname === '/plugins/personal-visuals/frame') return route.fulfill({ contentType: 'text/html', body: await pluginDocument() });
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
            if (url.pathname.startsWith('/api/resources/') && url.pathname.endsWith('/content')) {
              const asset = await taskAssetResponse(decodeURIComponent(url.pathname.split('/')[3]));
              if (asset) return route.fulfill({ contentType: asset.contentType, body: recipe.api === 'empty' && decodeURIComponent(url.pathname.split('/')[3]) === TASK_RESOURCE_IDS.document ? '' : typeof asset.body === 'string' ? asset.body : Buffer.from(asset.body) });
            }
            if (screen.entry?.endsWith('task-surfaces.tsx') && url.pathname === '/api/snapshot') return route.fulfill({ json: createTaskSnapshot(taskSurface(new URLSearchParams(recipe.query).get('surface')), recipe.api === 'empty') });
            const payload = route.request().method() === 'POST' ? route.request().postDataJSON() as Record<string, unknown> : undefined;
            const browserResponse = screen.entry?.endsWith('browser-surfaces.tsx') ? browserApiResponse(url, payload, recipe.api === 'empty') : undefined;
            if (browserResponse !== undefined) return route.fulfill({ json: browserResponse });
            const response = apiResponse(url, false, recipe.api === 'empty');
            if (response) return route.fulfill({ json: response });
            if (url.pathname === '/api/bootstrap') return route.fulfill({ json: { csrfToken: 'capture-fixture' } });
            if (url.pathname === '/api/agents') return route.fulfill({ json: { authority: 'personal', scopeKey: 'capture', sequence: 0, items: [], ancestors: [], nextCursor: null } });
            if (url.pathname.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': capture\n\n' });
            if (url.pathname.endsWith('/updates')) return route.fulfill({ json: { sequence: 0, upserts: [], removed: [], ancestors: [], transcripts: [] } });
            return route.fulfill({ status: 503, json: { error: { code: 'CAPTURE_FIXTURE', message: 'No live host in capture harness' } } });
          });
          const pathname = screen.page ?? `/capture/${screen.id}`;
          await loadWithReadiness(async () => {
            const response = await retryNavigation(attempt => page.goto(`${base.replace(/\/$/, '')}${pathname}${recipe.query ? `?${recipe.query}` : ''}`, { waitUntil: recipe.api === 'loading' || attempt ? 'domcontentloaded' : 'load', timeout: 30000 }));
            if (!response?.ok()) throw Error(`HTTP ${response?.status()}`);
          }, () => page.locator(recipe.ready ?? screen.ready).first().waitFor({ timeout: screen.readyTimeout ?? 10000 }), screen.retryReadyTimeout, () => {
            readinessRetries.push({ screen: screen.id, state, width, reduced: reduce });
            console.warn(`${screen.id}/${state}/${width}${reduce ? ':reduce' : ''}: readiness timeout; reloading once`);
          });
          if (!await page.locator('#root').evaluate(el => el.childElementCount > 0)) throw Error('Empty fixture root');
          if (errors.length) throw Error(errors.join('; '));
          loaded = true;
          const initial = (await collect(page, screen.id, `${state}:load`, width, true)).map(normalizeMotion);
          if (recipe.event) await page.evaluate(({name, detail}) => window.dispatchEvent(new CustomEvent(name, {detail})), recipe.event);
          const actions: Action[] = recipe.steps ?? (recipe.selector && recipe.action ? [{ selector: recipe.selector, action: recipe.action, key: recipe.key, value: recipe.value, frame: recipe.frame }] : []);
          for (const action of actions) {
            const target = (action.frame ? page.frameLocator(action.frame) : page).locator(action.selector).first();
            if (action.optional && !await target.isVisible()) continue;
            if (action.action === 'press') await target.press(action.key ?? 'Enter', { timeout: 4000 });
            else if (action.action === 'fill') await target.fill(action.value ?? '', { timeout: 4000 });
            else await target[action.action]({ timeout: 4000 });
          }
          if (recipe.waitFor) await (recipe.frame ? page.frameLocator(recipe.frame) : page).locator(recipe.waitFor).first().waitFor({ timeout: 4000 });
          if (recipe.waitMs) await page.waitForTimeout(recipe.waitMs);
          if (recipe.api === 'loading') await Promise.race([holdStarted, page.waitForTimeout(4000).then(() => { throw Error('Loading recipe did not intercept a data request'); })]);
          await withDeadline(page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))), 5000, 'Post-action animation frame');
          const records = (await collect(page, screen.id, state, width, true)).map(normalizeMotion);
          if (errors.length) throw Error(errors.join('; '));
          if (reduce) reduced = mergeMotionRecords(reduced, initial, records);
          else {
            motion = mergeMotionRecords(motion, initial, records);
            await mkdir(resolve(out, 'screenshots', screen.id), { recursive: true });
            const path = `screenshots/${screen.id}/${state}-${width}.png`;
            const bytes = await page.screenshot({ path: resolve(out, path), fullPage: true });
            const hash = createHash('sha256').update(bytes).digest('hex');
            const baselineKey = `${screen.id}/${width}`;
            const status = state === 'default' ? 'captured' : imageStatus(defaults.get(baselineKey), hash);
            if (state === 'default') defaults.set(baselineKey, hash);
            entries.push({ screen: screen.id, state, width, status, path, hash, ...(recipe.api === 'loading' ? { heldRequests } : {}), ...(status === 'identical-to-default' ? { code: 'I', reason: 'PNG bytes match default at the same viewport width' } : {}) });
            const stripRecords = (await collect(page, screen.id, state, width, true)).map(normalizeMotion);
            motion = mergeMotionRecords(motion, stripRecords);
            for (let i = 0; i < stripRecords.length; i++) {
              const record = stripRecords[i], key = motionKey(record);
              if (seen.has(key)) continue;
              seen.add(key);
              const pluginCandidate = record.screen === 'plugin-frame' && record.frame !== 'main' && Boolean(record.frame.trim());
              const needsPluginIframe = requirePluginEvidence && !pluginIframeStripReserved;
              if (!canCaptureStrip(stripReservations, args.maxStrips, needsPluginIframe, pluginCandidate)) { stripEntries.push({ screen: screen.id, state, width, frame: record.frame, selector: record.selector, motionKey: key, status: 'skipped', reason: needsPluginIframe && args.maxStrips > 0 ? 'max-strips cap (one slot reserved for plugin iframe evidence)' : 'max-strips cap', declaredSkip: true }); continue; }
              stripReservations++;
              if (pluginCandidate) pluginIframeStripReserved = true;
              const path = `strips/${String(seen.size).padStart(3, '0')}-${screen.id}.png`;
              try { await frameStrip(page, tile, i, resolve(out, path)); stripEntries.push({ screen: screen.id, state, width, frame: record.frame, selector: record.selector, motionKey: key, path, status: 'captured' }); }
              catch (error) { stripEntries.push({ screen: screen.id, state, width, frame: record.frame, selector: record.selector, motionKey: key, status: 'failed', code: 'F', reason: String(error), optional: recipe.optional }); }
            }
          }
        } catch (error) {
          console.warn(`${screen.id}/${state}/${width}${reduce ? ':reduce' : ''}: ${String(error)}`);
          entries.push({ ...skipEntry(screen.id, state, width, String(error), loaded ? 'F' : 'L'), reduced: reduce, loadFailure: !loaded, optional: recipe.optional });
        } finally {
          release();
          releasePlugin();
          const errors = await closeAll([{ name: `${screen.id}/${state}/${width} context`, close: () => context.close() }]);
          runErrors.push(...errors);
        }
      }
      console.log(`${screen.id}/${state}/${width}`);
      } } finally { runErrors.push(...await closeAll([{name: `${screen.id}/${width} strip tiler`, close: () => tile.close()}])); }
    });
    viewports.forEach((result, index) => {if (result.status === 'rejected') runErrors.push(`${jobs[index].screen.id}/${jobs[index].width}: ${String(result.reason)}`);});
  } catch (error) { runErrors.push(String(error)); }
  finally {
    runErrors.push(...await closeAll([
      { name: 'Chromium', close: () => browser?.close() },
      ...servers.map((server, index) => ({ name: `Vite ${index + 1}`, close: () => server.close() })),
    ]));
    if (cacheRoot) runErrors.push(...await closeAll([{ name: 'Vite optimizer cache', close: () => rm(cacheRoot!, { recursive: true, force: true }) }]));
  }
  const outputManifest = {screens: selected.map(screen => screen.id), widths: captureWidths, entries};
  const offenders = reduced.filter(isReducedOffender);
  const reducedReport = {thresholdMs: 1, records: reduced, offenders};
  const outputErrors = verifyCaptureOutputs(outputManifest, motion, reducedReport, stripEntries);
  runErrors.push(...outputErrors.map(reason => `Output check: ${reason}`));
  if (scope.unmapped.length) runErrors.push(`Unmapped renderer files: ${scope.unmapped.join(', ')}`);
  const exitCode = captureExitCode(entries, stripEntries, runErrors);
  const failed = exitCode !== 0;
  const failures = [
    ...entries.filter(e => captureExitCode([e]) !== 0),
    ...stripEntries.filter(e => captureExitCode([], [e]) !== 0),
    ...runErrors.map(reason => ({ status: 'failed', code: 'F', reason })),
  ];
  const totals = { screens: selected.length, screenshots: entries.filter(e => e.status === 'captured').length, identicalToDefault: entries.filter(e => e.status === 'identical-to-default').length, motionRows: motion.length, uniqueAnimations: new Set(motion.map(motionKey)).size, strips: stripEntries.filter(e => e.status === 'captured').length, reducedMotionOffendersUnique: new Set(offenders.map(motionKey)).size, reducedMotionOffendersTotal: offenders.length };
  const matrix = coverageMatrix(selected.map(s => s.id), entries);
  const manifest = { scope: args.scope, ...outputManifest, desktopOnly: scope.desktopOnly, desktopNote: 'Native desktop surfaces are not captured by the web harness.', totals, screenshots: totals.screenshots, motionRecords: motion.length, reducedMotionOffenders: offenders.length, coverage: matrix, strips: stripEntries, outputCheck: {passed: outputErrors.length === 0, errors: outputErrors}, failed, failures, readinessRetries, runtimeSeconds: Math.round((performance.now() - started) / 1000) };
  await Promise.all([
    json('motion', motion), md('motion', '# Motion\n\n' + table(motion.map(({ keyframes: _frames, ...m }) => m))),
    json('reduced-motion', reducedReport), md('reduced-motion', reducedMotionMarkdown(reducedReport)),
    json('manifest', manifest),
    md('index', `# UI capture\n\n${table([totals])}\nRuntime: ${manifest.runtimeSeconds}s. Readiness reloads: ${readinessRetries.length}.\n\n## Coverage matrix\n\nCells list captured widths. U = unsupported/explicit exclusion; E = empty recipe; I = identical to default; F = state action failure; L = screen load failure. Codes are followed by viewport width. Full reasons below and in manifest.json.\n\n${table(matrix)}\n${manifest.desktopNote}\n\n[Scope](scope.md) · [Motion](motion.md) · [Reduced motion](reduced-motion.md) · [Manifest](manifest.json)\n\n## Output checks\n\n${outputErrors.length ? table(outputErrors.map(reason => ({code: 'F', reason}))) : 'Passed. Iframe motion/strip/reduced-motion evidence and required state/width outcomes are complete.\n'}\n## Failures\n\n${table(failures)}\n## State outcomes and skipped reasons\n\n${table(entries.map(e => ({ screen: e.screen, state: e.state, width: e.width, reduced: e.reduced ?? false, status: e.status, path: e.path ?? '', reason: e.reason ?? '' })))}\n## Frame strips\n\n${table(stripEntries)}`),
  ]);
  console.log(`Capture written to ${out} (${manifest.runtimeSeconds}s)`);
  process.exitCode = exitCode;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
