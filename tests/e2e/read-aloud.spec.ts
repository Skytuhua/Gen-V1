import { test, expect, type Page } from '@playwright/test';

async function fixture(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:5833' || url.pathname.startsWith('/api/')) return route.abort();
    return route.continue();
  });
  await page.goto('/tests/e2e/fixtures/read-aloud.html');
  await expect(page.locator('[data-case="settled"] [aria-label="Read aloud"]')).toBeVisible();
  return { errors };
}
const reset = (page: Page) => page.evaluate(() => window.readAloud.reset());
const spoken = (page: Page) => page.evaluate(() =>
  window.readAloud.spoken.map(u => ({ text: u.text, rate: u.rate, lang: u.lang, voice: (u.voice as { voiceURI?: string } | null)?.voiceURI ?? null })));

test('settled reply has Read aloud before Copy; live, code-only and user rows do not', async ({ page }) => {
  const { errors } = await fixture(page);
  const actions = page.locator('[data-case="settled"] .message-actions');
  await expect(actions.getByRole('button').first()).toHaveAttribute('aria-label', 'Read aloud');
  await expect(actions.getByRole('button', { name: 'Copy message' })).toBeVisible();
  await expect(page.locator('[data-case="live"] [aria-label="Read aloud"]')).toHaveCount(0);
  await expect(page.locator('[data-case="code-only"] [aria-label="Read aloud"]')).toHaveCount(0);
  await expect(page.locator('[data-case="user"] [aria-label="Read aloud"]')).toHaveCount(0);
  // Live and code-only rows keep the floating Copy.
  await expect(page.locator('[data-case="live"] .copy-button')).toHaveCount(1);
  await expect(page.locator('[data-case="code-only"] .copy-button')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('play speaks cleaned prose chunks, pause/resume/stop drive the engine', async ({ page }) => {
  await fixture(page);
  await reset(page);
  const row = page.locator('[data-case="settled"]');
  await row.getByRole('button', { name: 'Read aloud' }).click();
  expect((await spoken(page)).length).toBeGreaterThanOrEqual(1);
  // Drain the session: each end enqueues the next chunk until idle.
  for (let index = 0; index < 12; index++) {
    const u = await page.evaluate(i => Boolean(window.readAloud.spoken[i]?.onend), index);
    if (!u) break;
    await page.evaluate(i => window.readAloud.emit(i, 'start'), index);
    await page.evaluate(i => window.readAloud.emit(i, 'end'), index);
    if (await row.getByRole('button', { name: 'Read aloud' }).count()) break;
  }
  const text = (await spoken(page)).map(u => u.text).join('\n');
  expect(text).toContain('Summary');
  expect(text).toContain('Use Settings and Help to listen.');
  expect(text).toContain('A second paragraph, with more.');
  expect(text).not.toContain('example.com');
  expect(text).not.toContain('skipped');
  await expect(row.getByRole('button', { name: 'Read aloud' })).toBeVisible();
  await reset(page);
  await row.getByRole('button', { name: 'Read aloud' }).click();
  await page.evaluate(() => window.readAloud.emit(0, 'start'));
  await expect(row.getByRole('button', { name: 'Pause reading' })).toBeVisible();
  await row.getByRole('button', { name: 'Pause reading' }).click();
  expect(await page.evaluate(() => window.readAloud.calls)).toContain('pause');
  await expect(row.getByRole('button', { name: 'Resume reading' })).toBeVisible();
  await row.getByRole('button', { name: 'Resume reading' }).click();
  expect(await page.evaluate(() => window.readAloud.calls)).toContain('resume');
  await row.getByRole('button', { name: 'Stop reading' }).click();
  await expect(row.getByRole('button', { name: 'Read aloud' })).toBeVisible();
});

test('chunk progression ends the session and a later play restarts at zero', async ({ page }) => {
  await fixture(page);
  await reset(page);
  const row = page.locator('[data-case="settled"]');
  await row.getByRole('button', { name: 'Read aloud' }).click();
  await page.evaluate(() => window.readAloud.emit(0, 'start'));
  await page.evaluate(() => window.readAloud.emit(0, 'end'));
  await expect(row.getByRole('button', { name: 'Read aloud' })).toBeVisible();
  expect(await page.evaluate(() => window.readAloud.calls)).toContain('speak');
  // A long reply is chunked within the 240-unit cap.
  const longRow = page.locator('[data-case="long"]');
  await longRow.getByRole('button', { name: 'Read aloud' }).click();
  const utterances = await spoken(page);
  const chunks = utterances.map(u => u.text);
  expect(chunks.length).toBeGreaterThanOrEqual(1);
  expect(chunks.every(chunk => chunk.length <= 240)).toBe(true);
});

test('engine error ends the session with the retry message', async ({ page }) => {
  await fixture(page);
  await reset(page);
  const row = page.locator('[data-case="settled"]');
  await row.getByRole('button', { name: 'Read aloud' }).click();
  await page.evaluate(() => window.readAloud.emit(0, 'error'));
  await expect(row.getByRole('button', { name: 'Read aloud' })).toBeVisible();
  await expect(row.locator('.read-aloud-error')).toContainText('Try again');
});

test('stale callbacks from a replaced session are ignored', async ({ page }) => {
  await fixture(page);
  await reset(page);
  const settled = page.locator('[data-case="settled"]');
  await settled.getByRole('button', { name: 'Read aloud' }).click();
  const long = page.locator('[data-case="long"]');
  await long.getByRole('button', { name: 'Read aloud' }).click();
  // Replacing the session cancels the first utterance; its late events must not
  // advance or end the new session.
  await page.evaluate(() => window.readAloud.emit(0, 'end'));
  await page.evaluate(() => window.readAloud.emit(0, 'error'));
  await page.evaluate(() => window.readAloud.emit(1, 'start'));
  await expect(long.getByRole('button', { name: 'Pause reading' })).toBeVisible();
  // Drain the new session: every end advances to the next chunk until idle.
  for (let index = 1; index < 12; index++) {
    await page.evaluate(i => { const u = window.readAloud.spoken[i]; if (u?.onend) u.onend(); }, index);
    if (await long.getByRole('button', { name: 'Read aloud' }).count()) break;
  }
  await expect(long.getByRole('button', { name: 'Read aloud' })).toBeVisible();
});

test('no local voices fails safely without calling speak', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => window.readAloud.setVoices([{ voiceURI: 'r', name: 'Remote', lang: 'en', default: true, localService: false }]));
  const row = page.locator('[data-case="settled"]');
  await row.getByRole('button', { name: 'Read aloud' }).click();
  expect((await spoken(page)).length).toBe(0);
  await expect(row.locator('.read-aloud-error')).toContainText('No local speech voice is available');
});

test('settings voice and speed selects list local voices and persist the choice', async ({ page }) => {
  await fixture(page);
  await reset(page);
  const voice = page.getByRole('combobox', { name: 'Read-aloud voice' });
  await voice.click();
  await expect(page.getByRole('option', { name: 'System default (local)' })).toBeVisible();
  await expect(page.getByRole('option', { name: /Ava Local/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /Ben Local/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /Cloud Remote/ })).toHaveCount(0);
  await page.getByRole('option', { name: /Ben Local/ }).click();
  expect(await page.evaluate(() => localStorage.getItem('harness:read-aloud:v1'))).toBe('{"voiceURI":"fake-b","rate":1}');
  const speed = page.getByRole('combobox', { name: 'Read-aloud speed' });
  await speed.click();
  await page.getByRole('option', { name: '2×' }).click();
  expect(await page.evaluate(() => localStorage.getItem('harness:read-aloud:v1'))).toBe('{"voiceURI":"fake-b","rate":2}');
  // Next play uses the saved voice and rate.
  const row = page.locator('[data-case="settled"]');
  await row.getByRole('button', { name: 'Read aloud' }).click();
  const [utterance] = await spoken(page);
  expect(utterance!.voice).toBe('fake-b');
  expect(utterance!.rate).toBe(2);
  expect(utterance!.lang).toBe('en-GB');
});

test('bars are static under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fixture(page);
  await reset(page);
  const row = page.locator('[data-case="settled"]');
  await row.getByRole('button', { name: 'Read aloud' }).click();
  await page.evaluate(() => window.readAloud.emit(0, 'start'));
  const bars = row.locator('.read-aloud-bars i').first();
  expect(await bars.evaluate(node => getComputedStyle(node).animationName)).toBe('none');
});

test('keyboard activates the control and focus returns after stop', async ({ page }) => {
  await fixture(page);
  await reset(page);
  const row = page.locator('[data-case="settled"]');
  const primary = row.getByRole('button', { name: 'Read aloud' });
  await primary.focus();
  await page.keyboard.press('Enter');
  expect((await spoken(page)).length).toBe(1);
  await page.evaluate(() => window.readAloud.emit(0, 'start'));
  const stop = row.getByRole('button', { name: 'Stop reading' });
  await stop.focus();
  await page.keyboard.press('Enter');
  await expect(primary).toBeFocused();
});
