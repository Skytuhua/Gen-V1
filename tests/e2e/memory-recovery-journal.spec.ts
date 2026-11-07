import { test, expect } from '@playwright/test';
import './journal-reload.spec';

const audits = new WeakMap<object, string[]>();
test.beforeEach(async ({ context }) => {
  const blocked: string[] = []; audits.set(context, blocked);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:5816' || url.pathname.startsWith('/api/')) { blocked.push(url.href); await route.abort(); }
    else if (url.pathname === '/') await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic journal only</title>' });
    else await route.continue();
  });
});
test.afterEach(async ({ context }) => { expect(audits.get(context) ?? []).toEqual([]); });
