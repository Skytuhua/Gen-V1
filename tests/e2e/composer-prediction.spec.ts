import { test, expect, type Page } from '@playwright/test';
import { taskFixture, serveTaskFixture } from './task-interface-fixture';

const text = 'Could you show me the smallest useful change?';
const flushEffects = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
async function fixture(page: Page, pending = false, suggestion = text) {
  const snapshot = taskFixture({ root: 'text', elements: { text: { type: 'Text', props: { text: 'Prediction integration fixture' } } } });
  snapshot.settings.preferences = { composerPredictions: true };
  const host = await serveTaskFixture(page, snapshot);
  const calls: { threadId: string; replyId: string; modelId: string }[] = [];
  let release: (() => Promise<void>) | undefined;
  await page.route('**/api/composer-prediction', async route => {
    const body = route.request().postDataJSON(); calls.push(body);
    expect(route.request().headers()['x-harness-csrf']).toBe('fixture-csrf');
    const respond = () => route.fulfill({ json: { suggestion, replyId: body.replyId, modelId: body.modelId } }).catch(() => {});
    if (pending) release = respond; else await respond();
  });
  await page.goto('/');
  const draft = page.getByRole('textbox', { name: 'Message', exact: true });
  await expect(draft).toBeEnabled(); await draft.focus();
  const settle = async (suffix = 'one') => {
    const thread = snapshot.threads[0]; thread.runId = `run-${suffix}`; thread.epoch++; thread.status = 'working';
    await host.publish(); await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toBeVisible();
    snapshot.messages.push({ id: `reply-${suffix}`, threadId: thread.id, role: 'assistant', runId: thread.runId, content: 'The current reply has settled.', createdAt: new Date().toISOString() });
    thread.runId = null; thread.status = 'ready'; await host.publish();
  };
  return { ...host, calls, draft, settle, release: () => release?.() };
}

test('only a witnessed settlement produces ghost text; Tab creates a durable draft and never sends', async ({ page }) => {
  const host = await fixture(page);
  await flushEffects(page); expect(host.calls).toHaveLength(0);
  await host.settle(); const ghost = page.locator('.composer-prediction-text'); await expect(ghost).toHaveText(text);
  await expect(host.draft).toHaveValue(''); await host.draft.press('Enter'); expect(host.commands.some(c => c.type === 'message.send')).toBe(false);
  const stored = await page.evaluate(async () => { const path = '/src/journal.ts'; return (await import(path)).journalEntries() as Promise<{ record: { value: unknown } }[]>; });
  expect(stored.some(row => row.record.value === text)).toBe(false);
  await host.draft.press('Tab'); await expect(host.draft).toHaveValue(text); await expect(host.draft).toBeFocused(); await expect(ghost).toHaveCount(0);
  expect(await host.draft.evaluate(input => (input as HTMLTextAreaElement).selectionStart)).toBe(text.length);
  expect(host.commands.some(c => c.type === 'message.send')).toBe(false);
  await page.reload(); await expect(host.draft).toHaveValue(text); expect(host.calls).toHaveLength(1);
  await host.draft.press('Enter'); await expect.poll(() => host.commands.find(c => c.type === 'message.send')?.payload.content).toBe(text);
});

test('typing owns the draft while a response is pending and an emptied draft does not retry', async ({ page }) => {
  const host = await fixture(page, true); await host.settle(); await expect.poll(() => host.calls.length).toBe(1);
  await host.draft.fill('My newer words'); await host.release(); await expect(host.draft).toHaveValue('My newer words'); await expect(page.locator('.composer-prediction-text')).toHaveCount(0);
  await host.draft.fill(''); await flushEffects(page); expect(host.calls).toHaveLength(1);
});

test('a maximum-length suggestion that exceeds the narrow large-font composer is wholly suppressed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  const long = 'Could you show the smallest useful change and explain how each part fits with the current implementation? '.repeat(3).slice(0, 280);
  const host = await fixture(page, false, long);
  host.snapshot.settings.preferences = { composerPredictions: true, fontSize: 20 }; await host.publish();
  await expect(host.draft).toHaveCSS('font-size', '20px');
  const response = page.waitForResponse('**/api/composer-prediction'); await host.settle(); await (await response).finished();
  await flushEffects(page);
  await expect(page.locator('.composer-prediction-text')).toHaveCount(0);
  await host.draft.press('Tab'); await expect(host.draft).toHaveValue(''); expect(host.commands.some(c => c.type === 'message.send')).toBe(false);
  await page.route('**/api/composer-prediction', route => { const body = route.request().postDataJSON(); return route.fulfill({ json: { suggestion: text, replyId: body.replyId, modelId: body.modelId } }); });
  await host.draft.focus(); await host.settle('short'); await expect(page.locator('.composer-prediction-text')).toHaveText(text);
  await host.draft.press('Tab'); await expect(host.draft).toHaveValue(text);
});

test('Escape dismisses once, and modifiers, navigation and post-composition keyCode 229 do not accept or send', async ({ page }) => {
  const host = await fixture(page); await host.settle(); await expect(page.locator('.composer-prediction-text')).toBeVisible();
  for (const key of ['Shift+Tab', 'Control+Tab', 'Alt+Tab']) {
    await host.draft.focus(); await host.draft.dispatchEvent('keydown', { key: 'Tab', shiftKey: key === 'Shift+Tab', ctrlKey: key === 'Control+Tab', altKey: key === 'Alt+Tab' });
    await expect(host.draft).toHaveValue('');
  }
  await host.draft.dispatchEvent('compositionend');
  await host.draft.dispatchEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: false });
  await host.draft.dispatchEvent('keydown', { key: 'Tab', keyCode: 229, isComposing: false });
  await expect(host.draft).toHaveValue(''); expect(host.commands.some(c => c.type === 'message.send')).toBe(false);
  await host.draft.press('Escape'); await expect(page.locator('.composer-prediction-text')).toHaveCount(0);
  expect(host.commands.some(c => c.type === 'run.stop')).toBe(false); await host.publish(); await flushEffects(page); expect(host.calls).toHaveLength(1);
});

test('context changes, disabling, blur and a new real run invalidate pending results', async ({ page }) => {
  const host = await fixture(page, true); await host.settle(); await expect.poll(() => host.calls.length).toBe(1);
  host.snapshot.messages.push({ id: 'user-new', threadId: 'task-thread', role: 'user', runId: null, content: 'More current context', createdAt: '' }); await host.publish(); await host.release();
  await expect(page.locator('.composer-prediction-text')).toHaveCount(0);
  await host.settle('two'); await expect.poll(() => host.calls.length).toBe(2);
  host.snapshot.settings.preferences = { composerPredictions: false }; await host.publish(); await host.release(); await expect(page.locator('.composer-prediction-text')).toHaveCount(0);
  host.snapshot.settings.preferences = { composerPredictions: true }; await host.publish(); await flushEffects(page); expect(host.calls).toHaveLength(2);
  await host.draft.focus(); await host.settle('three'); await expect.poll(() => host.calls.length).toBe(3);
  await host.draft.blur(); await host.release(); await expect(page.locator('.composer-prediction-text')).toHaveCount(0);
  await host.draft.focus(); await host.settle('four'); await expect.poll(() => host.calls.length).toBe(4);
  host.snapshot.threads[0].runId = 'real-work'; host.snapshot.threads[0].status = 'working'; await host.publish(); await host.release(); await expect(page.locator('.composer-prediction-text')).toHaveCount(0);
});

test('the Chat setting defaults off and exposes the selected-model quota control', async ({ page }) => {
  const snapshot = taskFixture({ root: 'text', elements: { text: { type: 'Text', props: { text: 'Settings fixture' } } } });
  const host = await serveTaskFixture(page, snapshot); await page.goto('/'); await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.getByRole('button', { name: 'Chat', exact: true }).click();
  const toggle = page.getByRole('switch', { name: 'Suggest my next message', exact: true }); await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByText('Uses your selected model and subscription quota.', { exact: true })).toBeVisible(); await toggle.click();
  await expect.poll(() => host.commands.find(c => c.type === 'settings.update')?.payload).toMatchObject({ preferences: { composerPredictions: true } });
});

test('custom send shortcuts and IME confirmation preserve an accepted real draft', async ({ page }) => {
  const host = await fixture(page);
  host.snapshot.settings.preferences = { composerPredictions: true, sendShortcut: 'mod-enter' }; await host.publish();
  await host.settle(); await expect(page.locator('.composer-prediction-text')).toBeVisible(); await host.draft.press('Tab');
  await host.draft.dispatchEvent('compositionend'); await host.draft.dispatchEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: false });
  await expect(host.draft).toHaveValue(text); expect(host.commands.some(c => c.type === 'message.send')).toBe(false);
  await host.draft.press('Enter'); await expect(host.draft).toHaveValue(text + '\n'); expect(host.commands.some(c => c.type === 'message.send')).toBe(false);
  await host.draft.press('Control+Enter'); await expect.poll(() => host.commands.find(c => c.type === 'message.send')?.payload.content).toBe(text);
});

test('a concurrent empty journal generation and PR insertion both take ownership', async ({ page }) => {
  const host = await fixture(page, true); await host.settle(); await expect.poll(() => host.calls.length).toBe(1);
  await page.evaluate(async () => { const path = '/src/journal.ts'; await (await import(path)).journalWrite('draft:task-thread', ''); });
  await host.release(); await expect(page.locator('.composer-prediction-text')).toHaveCount(0); await expect(host.draft).toHaveValue('');
  await host.settle('two'); await expect.poll(() => host.calls.length).toBe(2); await host.release(); await expect(page.locator('.composer-prediction-text')).toBeVisible();
  await page.getByRole('button', { name: 'Create PR', exact: true }).click(); await expect(host.draft).toHaveValue('Create a pull request for the current changes.'); await expect(page.locator('.composer-prediction-text')).toHaveCount(0);
});

test('model, account and thread changes reject late results and do not restore historical eligibility', async ({ page }) => {
  const host = await fixture(page, true); await host.settle(); await expect.poll(() => host.calls.length).toBe(1);
  host.snapshot.threads[0].accountId = 'new-pinned-account'; await host.publish(); await host.release(); await expect(page.locator('.composer-prediction-text')).toHaveCount(0);
  await host.settle('two'); await expect.poll(() => host.calls.length).toBe(2);
  host.snapshot.threads[0].modelId = 'test/replaced'; await host.publish(); await host.release(); await expect(page.locator('.composer-prediction-text')).toHaveCount(0);
  const current = host.snapshot.threads[0]; host.snapshot.threads = [{ ...current, id: 'different-thread', modelId: 'test/model' }]; host.snapshot.activeThreadId = 'different-thread'; await host.publish();
  await host.draft.focus(); await flushEffects(page); expect(host.calls).toHaveLength(2); await expect(page.locator('.composer-prediction-text')).toHaveCount(0);
});

test('desktop workspace snapshot notifications witness the run without SSE event types', async ({ page }) => {
  await page.addInitScript(() => {
    const context = { windowId: 'main', surface: { kind: 'main' as const }, windows: [] };
    window.harnessDesktop = {
      getContext: async () => context, ready: async () => context, list: async () => [],
      detach: async surface => ({ id: 'detached', surface, ready: true, minimized: false }),
      reattach: async () => {}, minimize: async () => {}, signIn: async () => {}, resetBounds: async () => {}, focus: async () => {}, browser: async () => {},
      onState: () => () => {}, onCloseRequested: () => () => {},
      onWorkspaceChanged: listener => { const receive = () => listener({ connected: true, sequence: 1 }); window.addEventListener('task-fixture-update', receive); return () => window.removeEventListener('task-fixture-update', receive); },
    };
  });
  const host = await fixture(page); await host.settle(); await expect(page.locator('.composer-prediction-text')).toHaveText(text);
  await host.publish(); await expect(page.locator('.composer [role="status"]')).toHaveText(`Suggested message: ${text} Tab to accept. Escape to dismiss.`); expect(host.calls).toHaveLength(1);
  await page.reload(); await host.draft.focus(); await flushEffects(page); await expect(page.locator('.composer-prediction-text')).toHaveCount(0); expect(host.calls).toHaveLength(1);
});

test('desktop/narrow light/dark and reduced motion retain ghost metrics and accept in place', async ({ page }, info) => {
  const host = await fixture(page); await host.settle(); const ghost = page.locator('.composer-prediction-text'); await expect(ghost).toBeVisible();
  for (const width of [1440, 390]) for (const theme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await expect(ghost).toBeVisible();
    const metrics = await host.draft.evaluate(input => { const ghost = document.querySelector('.composer-prediction-text')!; const a = input.getBoundingClientRect(), b = ghost.getBoundingClientRect(), x = getComputedStyle(input), y = getComputedStyle(ghost); return { left: a.left - b.left, top: a.top - b.top, width: a.width - b.width, font: x.font === y.font, lineHeight: x.lineHeight === y.lineHeight, animation: y.animationName }; });
    expect(metrics).toEqual({ left: 0, top: 0, width: 0, font: true, lineHeight: true, animation: 'none' });
    await page.locator('.composer-dock').screenshot({ path: info.outputPath(`composer-${width}-${theme}.png`) });
  }
  const before = await host.draft.boundingBox(); const toolbar = await page.locator('.composer-toolbar').boundingBox();
  await host.draft.press('Tab'); await expect(host.draft).toHaveValue(text); expect(await host.draft.boundingBox()).toEqual(before); expect(await page.locator('.composer-toolbar').boundingBox()).toEqual(toolbar);
});

test.describe('touch composer', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  test('offers a real Use suggestion button and accepts without sending', async ({ page }) => {
    const host = await fixture(page); await host.settle(); const use = page.getByRole('button', { name: 'Use suggestion', exact: true }); await expect(use).toBeVisible(); await use.tap();
    await expect(host.draft).toHaveValue(text); await expect(host.draft).toBeFocused(); expect(host.commands.some(c => c.type === 'message.send')).toBe(false);
  });
});
