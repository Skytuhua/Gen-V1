import type { Page } from '@playwright/test';

// Samples a probe once per animation frame for `ms` and returns the distinct
// JSON signatures observed. A single signature proves the probed state never
// changed during the window; multiple signatures localize when it did.
export const quiescent = async (page: Page, ms: number, probe: () => unknown | Promise<unknown>) => {
  const seen = new Set<string>(); const end = Date.now() + ms;
  do { seen.add(JSON.stringify(await probe())); await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))); } while (Date.now() < end);
  return [...seen];
};
