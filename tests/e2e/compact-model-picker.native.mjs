import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const root = process.cwd(), require = createRequire(join(root, 'package.json'));
const { _electron, expect } = require('@playwright/test');
const evidence = process.env.MODEL_PICKER_OUTPUT ?? join(tmpdir(), 'gen-compact-model-native');
await mkdir(evidence, { recursive: true });
await require('esbuild').build({ entryPoints: [resolve('tests/e2e/compact-model-picker-fixture.tsx')],
  bundle: true, format: 'iife', jsx: 'automatic', outfile: join(evidence, 'fixture.js'),
  loader: { '.woff': 'file', '.woff2': 'file' }, define: { 'process.env.NODE_ENV': '"production"' },
});
await writeFile(join(evidence, 'index.html'), '<html data-theme="dark" data-native-titlebar="true"><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
await writeFile(join(evidence, 'main.cjs'), `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(join(evidence, 'isolated-profile'))});
app.whenReady().then(()=>{const w=new BrowserWindow({width:1024,height:768,useContentSize:true,titleBarStyle:'hidden',titleBarOverlay:{height:42,color:'#0f0f0f',symbolColor:'#eeeeee'},webPreferences:{contextIsolation:true,sandbox:true}});w.loadFile(${JSON.stringify(join(evidence, 'index.html'))});});
app.on('window-all-closed',()=>app.quit());`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
const sourceFiles = ['apps/web/src/ModelPicker.tsx', 'apps/web/src/model-picker.css', 'packages/ui-shell/Popover.tsx'];
const result = { electronVersion: require('electron/package.json').version, executable: require('electron'),
  source: Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')]))),
  scope: 'Real Electron leaf renderer with synthetic catalog, shared native modal, and isolated profile. No production backend/provider.',
  matrix: [], errors: [],
};
let app;
try {
  app = await _electron.launch({ executablePath: result.executable, args: [join(evidence, 'main.cjs')], env });
  const page = await app.firstWindow();
  page.on('pageerror', error => result.errors.push(error.message));
  result.display = await app.evaluate(({ screen }) => screen.getPrimaryDisplay());
  for (const size of [{ width: 1024, height: 600 }, { width: 390, height: 420 }]) {
    for (const zoom of [1, 1.25, 1.5]) for (const theme of ['dark', 'light']) {
      await app.evaluate(({ BrowserWindow }, { size }) => {
        BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height);
      }, { size });
      await page.goto(pathToFileURL(join(evidence, 'index.html')).href + '?large=1&native=1');
      // Navigation restores the profile's per-origin zoom, so apply the matrix zoom after load.
      await app.evaluate(({ BrowserWindow }, zoom) => {
        BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(zoom);
      }, zoom);
      const trigger = page.getByRole('combobox', { name: 'Model', exact: true });
      await expect(trigger).toBeVisible();
      await page.evaluate(async theme => { document.documentElement.dataset.theme = theme; await document.fonts.ready; }, theme);
      await trigger.click();
      const search = page.getByRole('searchbox', { name: 'Search models' }); await expect(search).toBeFocused();
      const popup = page.locator('.model-picker-popover');
      await popup.evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished)));
      const geometry = await popup.evaluate(node => {
        const b = node.getBoundingClientRect(), list = node.querySelector('[role="listbox"]').getBoundingClientRect();
        const selected = node.querySelector('[aria-selected="true"]').getBoundingClientRect();
        return { x: b.x, y: b.y, right: b.right, bottom: b.bottom, width: b.width, viewportWidth: innerWidth, viewportHeight: innerHeight,
          selectedTop: selected.top, selectedBottom: selected.bottom, listTop: list.top, listBottom: list.bottom, font: getComputedStyle(node.querySelector('[role="option"]')).fontSize };
      });
      expect(geometry.x).toBeGreaterThanOrEqual(8); expect(geometry.y).toBeGreaterThanOrEqual(50);
      // innerWidth/innerHeight round to whole CSS px at fractional zoom; allow <1px of that rounding.
      expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth - 8 + 1);
      expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight - 8 + 1);
      expect(geometry.selectedTop).toBeGreaterThanOrEqual(geometry.listTop - 0.5);
      expect(geometry.selectedBottom).toBeLessThanOrEqual(geometry.listBottom + 0.5);
      expect(geometry.selectedTop).toBeGreaterThanOrEqual(geometry.y - 0.5);
      expect(geometry.selectedBottom).toBeLessThanOrEqual(geometry.bottom + 0.5);
      const firstCapture = `first-${size.width}x${size.height}-${zoom}-${theme}.png`;
      const firstPng = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
      await writeFile(join(evidence, firstCapture), Buffer.from(firstPng, 'base64'));
      await search.fill('model 99'); await search.press('Home'); await search.press('ArrowRight'); await expect(search).toBeFocused();
      expect(await search.evaluate(n => n.selectionStart)).toBe(1);
      await search.fill(''); await search.press('Tab');
      await expect(page.getByRole('button', { name: 'Add openai/catalog-99 to favorites', exact: true })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('radio', { name: 'High', exact: true })).toBeFocused();
      await page.keyboard.press('ArrowDown'); await page.keyboard.press('End');
      await expect(page.getByRole('radio', { name: 'High', exact: true })).toBeFocused();
      await expect(page.getByLabel('Committed choice')).toHaveText('openai/catalog-99|high');
      const file = `native-${size.width}x${size.height}-${zoom}-${theme}.png`;
      const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
      await writeFile(join(evidence, file), Buffer.from(png, 'base64'));
      await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
      await expect(page.getByRole('dialog', { name: 'Picker owner', exact: true })).toBeVisible();
      await expect(page.getByLabel('Preserved draft')).toHaveValue('Keep this draft');
      const actualZoom = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor());
      expect(actualZoom).toBe(zoom); result.matrix.push({ size, zoom, actualZoom, theme, geometry, firstCapture, capture: file });
      console.log(`PASS native ${size.width}x${size.height} ${zoom} ${theme}`);
    }
  }
  expect(result.errors).toEqual([]);
} catch (error) {
  result.failure = String(error.stack ?? error); process.exitCode = 1;
  if (app) {
    const page = app.windows()[0];
    result.focusAtFailure = await page.evaluate(() => ({ active: document.activeElement?.outerHTML, picker: document.querySelector('.model-picker-popover')?.outerHTML }));
    const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
    await writeFile(join(evidence, 'failure.png'), Buffer.from(png, 'base64'));
  }
}
finally { if (app) await app.close(); await writeFile(join(evidence, 'receipt.json'), JSON.stringify(result, null, 2)); }
console.log(JSON.stringify({ evidence, passed: result.matrix.length, failure: result.failure ?? null }));
