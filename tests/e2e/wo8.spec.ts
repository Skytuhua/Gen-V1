import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { taskFixture, serveTaskFixture } from './task-interface-fixture';

const stage = process.env.WO8_STAGE === 'before' ? 'before' : 'after';
for (const theme of ['dark', 'light'] as const) for (const width of [1440, 1024]) {
  test(`thread diff ${theme} ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const snapshot = taskFixture({ root: 'diff', elements: { diff: { type: 'Diff', props: { diff: '  function restoreLayout() {\n-   return defaultLayout;\n+   return savedLayout ?? defaultLayout;\n  }' } } } });
    snapshot.settings.theme = theme;
    snapshot.threads[0].title = 'Review changes'; snapshot.threads[0].projectName = 'Gen-V1';
    snapshot.artifacts[0].title = 'Changes';
    snapshot.messages[0].content = 'Updated the layout. See the [diff](#diff) and [files](#files).';
    snapshot.messages.unshift({ ...snapshot.messages[0], id: 'question', role: 'user', content: 'Review the workspace changes.' });
    await serveTaskFixture(page, snapshot); await page.goto('/');
    await expect(page.locator('.diff')).toBeVisible();
    await page.screenshot({ path: info.outputPath(`thread-diff-${stage}-${theme}-${width}.png`) });
  });
  test(`usage and context ${theme} ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = '/@fs/' + resolve('tests/e2e/usage-context-fixture.tsx').replaceAll('\\', '/');
    await page.route('**/api/bootstrap', route => route.fulfill({ json: { csrfToken: 'synthetic' } }));
    await page.route('**/wo8-usage', route => route.fulfill({ contentType: 'text/html', body: `<html data-theme="${theme}"><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${fixture}');</script></body></html>` }));
    await page.goto('/wo8-usage');
    await expect(page.locator('html')).toHaveAttribute('data-usage-fixture-ready', 'true');
    await page.getByRole('button', { name: 'Open Usage', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Usage', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Tokens', exact: true }).click();
    await page.screenshot({ path: info.outputPath(`usage-dialog-${stage}-${theme}-${width}.png`) });
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('usage-fixture', { detail: 'categories' })));
    await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Context inspector' })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`context-inspector-${stage}-${theme}-${width}.png`) });
  });
}
