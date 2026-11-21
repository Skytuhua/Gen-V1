import { test, expect, type Page } from '@playwright/test';
import { serveTaskFixture, taskFixture, type TaskSpec } from './task-interface-fixture';
import { validateSurface } from '../../packages/ui-catalog';

type EffectRecord = { target: string; duration: number; easing: string; frames: ComputedKeyframe[] };
type EffectWindow = Window & { generativeEffects: EffectRecord[]; generativeAnimations: Animation[] };

// Same test-side WAAPI interception as artifact-settle.spec.ts: hold every recorded
// effect so mid-flight states and policy downgrades can be sampled deterministically.
async function recordEffects(page: Page) {
  await page.addInitScript(() => {
    const records: EffectRecord[] = [], animations: Animation[] = [];
    Object.assign(window, { generativeEffects: records, generativeAnimations: animations });
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const animation = animate.call(this, frames, options);
      if (this.matches('.artifact > .artifact-body, .artifact > .artifact-body *, .task-status-block .task-status')) {
        animation.pause();
        const effect = animation.effect as KeyframeEffect, timing = effect.getTiming();
        records.push({ target: String(this.className), duration: Number(timing.duration), easing: timing.easing!, frames: effect.getKeyframes() });
        animations.push(animation);
      }
      return animation;
    };
  });
}
const records = (page: Page) => page.evaluate(() => (window as unknown as EffectWindow).generativeEffects);
const entrances = async (page: Page) => (await records(page)).filter(record => record.target.includes('artifact-body'));

const spec: TaskSpec = { root: 'wrap', elements: {
  wrap: { type: 'Stack', props: { gap: 'md' }, children: ['status', 'note'] },
  status: { type: 'Status', props: { dataBinding: 'operation' } },
  note: { type: 'Input', props: { label: 'Live note', stateKey: 'note' } },
} };

test('a live publication enters once and stays quiet across republish, unrelated input and theme change', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await recordEffects(page);
  validateSurface(spec);
  const snapshot = taskFixture(spec, { operation: { status: 'pending', label: 'Backup' }, unrelated: 'seed' }, { note: 'Kept through republish' });
  const artifact = snapshot.artifacts[0]; snapshot.artifacts = [];
  const host = await serveTaskFixture(page, snapshot);
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible({ timeout: 30_000 });
  snapshot.artifacts = [artifact];
  await host.publish();
  const note = page.getByRole('textbox', { name: 'Live note', exact: true });
  await expect(note).toBeVisible();
  await expect(page.locator('.artifact')).toHaveAttribute('data-entry-phase', 'entering');
  expect(await entrances(page)).toHaveLength(1);
  // Interaction during the entrance settles it and the mounted input stays usable.
  await note.click();
  await expect(page.locator('.artifact')).toHaveAttribute('data-entry-phase', 'settled');
  await note.fill('Edited during and after entrance');
  await expect(note).toHaveValue('Edited during and after entrance');
  for (let i = 0; i < 3; i++) await host.publish();
  host.setInput('unrelated', 'other-1');
  await host.publish();
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await host.publish();
  expect(await entrances(page)).toHaveLength(1);
  await expect(note).toHaveValue('Edited during and after entrance');
});

test('a bootstrap-restored artifact has no entry effect in a second context', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await recordEffects(page);
    const snapshot = taskFixture(spec, { operation: { status: 'pending', label: 'Backup' } }, { note: 'Restored draft' });
    await serveTaskFixture(page, snapshot);
    await page.goto('/');
    const note = page.getByRole('textbox', { name: 'Live note', exact: true });
    await expect(note).toHaveValue('Restored draft');
    expect(await entrances(page)).toHaveLength(0);
    await expect(page.locator('.artifact')).not.toHaveAttribute('data-entry-phase', 'entering');
  } finally { await context.close(); }
});

test('off mid-entrance settles the artifact, and an opacity-only full effect settles on reduced', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await recordEffects(page);
  const snapshot = taskFixture(spec, { operation: { status: 'pending', label: 'Backup' } }, { note: 'Draft' });
  const artifact = snapshot.artifacts[0]; snapshot.artifacts = [];
  const host = await serveTaskFixture(page, snapshot);
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible({ timeout: 30_000 });
  snapshot.artifacts = [artifact];
  await host.publish();
  await expect(page.locator('.artifact')).toHaveAttribute('data-entry-phase', 'entering');
  expect(await entrances(page)).toHaveLength(1);
  // App-level off finishes a running full entrance immediately.
  await page.evaluate(() => { document.documentElement.dataset.motion = 'off'; });
  await expect(page.locator('.artifact')).toHaveAttribute('data-entry-phase', 'settled');
  const note = page.getByRole('textbox', { name: 'Live note', exact: true });
  await note.fill('Still editable');
  await expect(note).toHaveValue('Still editable');
  await page.evaluate(() => { document.documentElement.dataset.motion = 'system'; });
  // A Status source change produces an isolated opacity-only effect under full policy.
  host.setInput('operation', { status: 'running', label: 'Backup' });
  await host.publish();
  await expect.poll(async () => (await records(page)).filter(record => record.target.includes('task-status')).length).toBeGreaterThan(0);
  const statusRecords = (await records(page)).filter(record => record.target.includes('task-status'));
  for (const record of statusRecords)
    for (const frame of record.frames)
      expect(Object.keys(frame).filter(key => !['offset', 'computedOffset', 'easing', 'composite'].includes(key)).sort()).toEqual(['opacity']);
  const openAnimations = () => page.evaluate(() => (window as unknown as EffectWindow).generativeAnimations.filter(animation => animation.playState === 'running' || animation.playState === 'paused').length);
  expect(await openAnimations()).toBeGreaterThan(0);
  // A running opacity-only full effect settles when effective policy becomes reduced.
  await page.evaluate(() => { document.documentElement.dataset.motion = 'reduced'; });
  await expect.poll(openAnimations).toBe(0);
  await page.evaluate(() => { document.documentElement.dataset.motion = 'system'; });
});
