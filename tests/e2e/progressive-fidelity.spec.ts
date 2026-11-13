import { test, expect } from '@playwright/test';
import type { RuntimeUsage } from '../../packages/contracts';
import { growingQaSpec, migrationTableSpec, serveTaskFixture, taskFixture } from './task-interface-fixture';

const usage = (patch: Partial<RuntimeUsage> = {}): RuntimeUsage => ({ contextTokens: 604_100, contextWindow: 1_000_000, inputTokens: 38_000, outputTokens: 14_200, cost: null, activity: 'idle', sessionPercent: 68, weeklyPercent: 24, contextBreakdown: [{ label: 'System', tokens: 32_900 }, { label: 'MCP', tokens: 21_300 }, { label: 'Skills', tokens: 8_300 }, { label: 'Messages', tokens: 541_600 }], ...patch });

test('question loading, answer and source-declared follow-ups remain distinct without repeating requests', async ({ page }) => {
  const initial = taskFixture(growingQaSpec, { answer: { status: 'idle', followupsPending: false } });
  const fixture = await serveTaskFixture(page, initial);
  await page.goto('/');
  const question = page.getByRole('button', { name: 'Can delivery be split?', exact: true });
  await question.click();
  await expect(page.locator('.disclosure-question-mark').first()).toBeVisible();
  await expect(page.locator('.disclosure-pending')).toBeVisible();
  await expect(page.locator('.disclosure-pending')).toHaveText('Preparing an answer…');
  await expect(page.locator('.disclosure-pending')).toHaveCSS('font-size', '0px');
  await question.click(); await question.click();
  await expect.poll(() => fixture.commands.filter(command => command.type === 'action.submit').length).toBe(1);
  fixture.setInput('answer', { status: 'ready', answer: 'Yes. Choose a destination for each package.', followupsPending: true }); await fixture.publish();
  await expect(page.getByText('Yes. Choose a destination for each package.', { exact: true })).toBeVisible();
  await expect(page.locator('.disclosure-followups-pending')).toBeVisible();
  await expect(page.locator('.disclosure-pending')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Ask another question' }).fill('Keep this draft');
  fixture.setInput('answer', { status: 'ready', answer: 'Yes. Choose a destination for each package.', followupsPending: false }); await fixture.publish();
  await expect(page.locator('.disclosure-followups-pending')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Ask another question' })).toHaveValue('Keep this draft');
  await expect(page.getByRole('textbox', { name: 'Ask another question' })).toBeFocused();
});

test('appending answer content reveals only new glyphs and keeps the committed answer opaque', async ({ page }) => {
  const initial = taskFixture(growingQaSpec, { answer: { status: 'pending', answer: 'Choose a destination.' } }, { deliveryOpen: true });
  await page.addInitScript(() => {
    const recorded: { target: string; opacity: unknown }[] = [];
    Object.assign(window, { recordedAnswerAnimations: recorded });
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) { if (this.closest('.task-incoming-answer')) recorded.push({ target: this.className, opacity: frames }); return animate.call(this, frames, options); };
  });
  const fixture = await serveTaskFixture(page, initial); await page.goto('/');
  await expect(page.getByText('Choose a destination.', { exact: true })).toBeVisible();
  await page.evaluate(() => (window as unknown as { recordedAnswerAnimations: unknown[] }).recordedAnswerAnimations.splice(0));
  fixture.setInput('answer', { status: 'pending', answer: 'Choose a destination. Then choose a delivery date.' }); await fixture.publish();
  await expect(page.getByText('Choose a destination. Then choose a delivery date.', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { recordedAnswerAnimations: { target: string }[] }).recordedAnswerAnimations.map(item => item.target))).toContain('task-answer-reveal');
  const targets = await page.evaluate(() => (window as unknown as { recordedAnswerAnimations: { target: string }[] }).recordedAnswerAnimations.map(item => item.target));
  expect(targets).not.toContain('');
  await expect(page.locator('.task-incoming-answer .markdown').first()).toHaveCSS('opacity', '1');
});

test('unchanged cell change metadata does not replay while newly changed cells animate once', async ({ page }) => {
  await page.addInitScript(() => {
    const recorded: string[] = []; Object.assign(window, { changedCellAnimations: recorded });
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) { if (this.matches('.task-table td[data-change]')) recorded.push(`${this.closest('tr')?.getAttribute('data-row-id')}:${this.getAttribute('data-column-key')}`); return animate.call(this, frames, options); };
  });
  const initial = taskFixture(migrationTableSpec, { rows: [{ id: 'one', name: 'Ada', workspace_id: 'studio' }, { id: 'two', name: 'Lin', workspace_id: null }], projects: [], changes: { revision: 1, rows: [{ id: 'one', cells: [{ key: 'workspace_id', status: 'updated', before: null }] }] } });
  const fixture = await serveTaskFixture(page, initial); await page.goto('/');
  await expect(page.getByRole('cell', { name: /studio/ })).toBeVisible();
  await page.evaluate(() => (window as unknown as { changedCellAnimations: string[] }).changedCellAnimations.splice(0));
  fixture.setInput('changes', structuredClone(initial.data.find(item => item.id === 'input-changes')!.value)); await fixture.publish();
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => (window as unknown as { changedCellAnimations: string[] }).changedCellAnimations)).toEqual([]);
  fixture.setInput('rows', [{ id: 'one', name: 'Ada', workspace_id: 'studio' }, { id: 'two', name: 'Lin', workspace_id: 'garden' }]);
  fixture.setInput('changes', { revision: 2, rows: [{ id: 'one', cells: [{ key: 'workspace_id', status: 'updated', before: null }] }, { id: 'two', cells: [{ key: 'workspace_id', status: 'updated', before: null }] }] }); await fixture.publish();
  await expect.poll(() => page.evaluate(() => (window as unknown as { changedCellAnimations: string[] }).changedCellAnimations)).toEqual(['two:workspace_id']);
});

test('context uses numeric category bands with an honest compaction status and a settled total retained across reveal', async ({ page }) => {
  const initial = taskFixture({ root: 'text', elements: { text: { type: 'Text', props: { text: 'Illustrative telemetry fixture; no provider calls.' } } } }); initial.usage['task-thread'] = usage();
  const fixture = await serveTaskFixture(page, initial); await page.goto('/');
  await page.getByRole('button', { name: /Inspect context usage/ }).click();
  const inspector = page.getByRole('dialog', { name: 'Context inspector' });
  await expect(inspector.locator('header')).toContainText('Context 60%');
  await expect(inspector.locator('.context-inspector-total')).toContainText('604.1K of 1M');
  await expect(inspector.getByRole('button', { name: 'System 32.9K', exact: true })).toBeVisible();
  await expect(inspector.getByRole('button', { name: 'Tools & MCP 21.3K', exact: true })).toBeVisible();
  await expect(inspector.getByRole('button', { name: 'Close context inspector' })).toHaveCount(0);
  await expect(inspector.getByRole('progressbar', { name: 'Session limit' })).toHaveCount(0);
  await expect(inspector.getByRole('progressbar', { name: 'Weekly limit' })).toHaveCount(0);
  await inspector.evaluate(async node => { await Promise.all(node.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))); });
  await page.screenshot({ path: test.info().outputPath('context-desktop.png') });
  await inspector.getByRole('button', { name: 'Compact now' }).click();
  initial.usage['task-thread'] = usage({ activity: 'compacting' }); await fixture.publish();
  await expect(inspector.getByRole('status')).toContainText('Compacting context…');
  initial.usage['task-thread'] = usage({ contextTokens: 76_700, contextBreakdown: [{ label: 'System', tokens: 32_900 }, { label: 'MCP', tokens: 21_300 }, { label: 'Skills', tokens: 8_300 }, { label: 'Messages', tokens: 14_200 }] }); await fixture.publish();
  // The compact inspector reports measured totals immediately (no invented count-down); only a real receipt animates segments.
  await expect(inspector.locator('.context-inspector-total')).toContainText('76.7K of 1M');
  // The app has no host-accepted compaction report here, so a token decrease alone must not claim a receipt.
  await expect(inspector.getByRole('status')).toContainText('Result not reported');
  await inspector.getByRole('button', { name: 'Compact now', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(inspector).toHaveCount(0);
  await page.getByRole('button', { name: /Inspect context usage/ }).click();
  await expect(page.getByRole('dialog', { name: 'Context inspector' }).locator('.context-inspector-total')).toContainText('76.7K of 1M');
});

test('the compact popover stays quota-free when categories are unreported and reduced motion settles measurements immediately', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const initial = taskFixture({ root: 'text', elements: { text: { type: 'Text', props: { text: 'Unknown telemetry fixture.' } } } }); initial.usage['task-thread'] = usage({ sessionPercent: null, weeklyPercent: null, contextBreakdown: undefined });
  const fixture = await serveTaskFixture(page, initial); await page.goto('/'); await page.getByRole('button', { name: /Inspect context usage/ }).click();
  const inspector = page.getByRole('dialog', { name: 'Context inspector' });
  await expect(inspector.locator('.context-quota')).toHaveCount(0);
  await expect(inspector.getByRole('progressbar', { name: 'Session limit' })).toHaveCount(0);
  await expect(inspector.getByRole('progressbar', { name: 'Weekly limit' })).toHaveCount(0);
  await expect(inspector.getByText('Category breakdown not reported')).toBeVisible();
  initial.usage['task-thread'] = usage({ contextTokens: 76_700, contextBreakdown: undefined, sessionPercent: null, weeklyPercent: null }); await fixture.publish();
  await expect(inspector.locator('.context-inspector-total')).toContainText('76.7K');
});

test('unrelated committed snapshots do not restart an accepted context transition', async ({ page }) => {
  const initial = taskFixture({ root: 'text', elements: { text: { type: 'Text', props: { text: 'Repeated snapshot fixture.' } } } }); initial.usage['task-thread'] = usage();
  const fixture = await serveTaskFixture(page, initial); await page.goto('/'); await page.getByRole('button', { name: /Inspect context usage/ }).click();
  const total = page.getByRole('dialog', { name: 'Context inspector' }).locator('.context-inspector-total');
  initial.usage['task-thread'] = usage({ contextTokens: 76_700, contextBreakdown: undefined }); await fixture.publish();
  await Promise.all([
    expect(total).toContainText('76.7K', { timeout: 2300 }),
    (async () => { for (let index = 0; index < 12; index++) { await page.waitForTimeout(100); await fixture.publish(); } })(),
  ]);
});

test('the context bands remain inside a narrow viewport and category detail is keyboard accessible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const initial = taskFixture({ root: 'text', elements: { text: { type: 'Text', props: { text: 'Narrow context fixture.' } } } }); initial.usage['task-thread'] = usage();
  await serveTaskFixture(page, initial); await page.goto('/'); await page.getByRole('button', { name: /Inspect context usage/ }).click();
  const inspector = page.getByRole('dialog', { name: 'Context inspector' });
  const bounds = await inspector.boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(8); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(382);
  await inspector.locator('.context-category-row', { hasText: 'System' }).focus();
  await expect(page.getByRole('tooltip')).toContainText('32,900 tokens');
  await expect(page.getByRole('tooltip')).toContainText('3.3%');
  await inspector.evaluate(async node => { await Promise.all(node.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))); });
  await page.screenshot({ path: test.info().outputPath('context-narrow.png') });
});
