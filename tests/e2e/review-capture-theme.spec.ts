import {expect, test} from '@playwright/test';
import {captureTheme, installThemeAudit} from '../../scripts/review-capture.ts';

test('capture theme defaults dark and rejects accidental unrecognized values', () => {
  expect(captureTheme()).toBe('dark');
  expect(captureTheme('light')).toBe('light');
  expect(() => captureTheme('system')).toThrow('dark or light');
});

test('theme audit catches a transient opposite theme even after it returns', async ({page}) => {
  const audit = await installThemeAudit(page, 'dark');
  await page.goto('data:text/html,<html data-theme="dark"><body>Capture</body></html>');
  await audit.assert();
  await page.evaluate(async () => {
    document.documentElement.dataset.theme = 'light';
    await new Promise(resolve => setTimeout(resolve, 0));
    document.documentElement.dataset.theme = 'dark';
  });
  await expect(audit.assert()).rejects.toThrow('Expected only dark');
  expect(audit.records().map(record => record.theme)).toContain('light');
  audit.reset();
  await audit.assert();
  expect(audit.records().every(record => record.theme === 'dark')).toBe(true);
  await page.reload();
  await audit.assert();
});
