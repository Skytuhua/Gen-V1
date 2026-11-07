import { test, expect } from '@playwright/test';
import './usage-app-integration.spec';

// Reuse the existing actual-App case with Chrome and the owned, proxy-free host.
const audits = new WeakMap<object, string[]>();
test.afterEach(async ({ page }) => { expect(audits.get(page) ?? []).toEqual([]); });
test.beforeEach(async ({ page }) => {
  const unexpected: string[] = [];
  audits.set(page, unexpected);
  const allowed = new Set(['/api/bootstrap', '/api/models', '/api/snapshot', '/api/shell-settings', '/api/workspace', '/api/commands', '/api/plugins']);
  page.on('request', request => { const url = new URL(request.url()); if (url.pathname.startsWith('/api/') && !allowed.has(url.pathname)) unexpected.push(url.href); });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:5816' || url.pathname.startsWith('/api/')) { unexpected.push(url.href); await route.abort(); }
    else {
      // Install after the shared host's API handler, before the App can request plug-ins.
      if (url.pathname === '/') await page.route('**/api/plugins', route => route.fulfill({ json: { plugins: [] } }));
      await route.continue();
    }
  });
});
