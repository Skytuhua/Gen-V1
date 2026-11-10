import { test, expect, type Page } from '@playwright/test';
import { serveTaskFixture, taskFixture } from './task-interface-fixture';
import { expectArtifactGeometry, holdArtifactJournal, releaseArtifactJournal, serveArtifactSettleFixture as fixture } from './artifact-settle-host';

const enter = 'cubic-bezier(0.16, 1, 0.3, 1)';
type EntranceRecord = { target: string; duration: number; easing: string; durationToken: string; easingToken: string; frames: ComputedKeyframe[]; height: number; afterTop?: number };
type EntranceWindow = Window & { artifactEntrances: EntranceRecord[]; artifactAnimations: Animation[] };

async function recordEntrances(page: Page) {
  await page.addInitScript(() => {
    const records: EntranceRecord[] = [], animations: Animation[] = [];
    Object.assign(window, { artifactEntrances: records, artifactAnimations: animations });
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const animation = animate.call(this, frames, options);
      if (this.matches('.artifact,.artifact > .artifact-body')) {
        // Hold the real effect so assertions can sample every part of its timeline.
        animation.pause();
        const effect = this.getAnimations().find(item => item === animation)!.effect as KeyframeEffect;
        const timing = effect.getTiming(), style = getComputedStyle(this), shell = this.closest('.artifact')!;
        records.push({ target: this.className, duration: Number(timing.duration), easing: timing.easing!, durationToken: style.getPropertyValue('--ui-motion-panel-enter').trim(), easingToken: style.getPropertyValue('--ui-ease-enter').trim(), frames: effect.getKeyframes(), height: shell.getBoundingClientRect().height, afterTop: document.querySelector('[data-after-artifact]')?.getBoundingClientRect().top });
        animations.push(animation);
      }
      return animation;
    };
  });
}
const records = (page: Page) => page.evaluate(() => (window as unknown as EntranceWindow).artifactEntrances);
async function publish(page: Page, journalHeld = false) {
  await page.getByRole('button', { name: 'Publish artifact', exact: true }).click();
  if (journalHeld) await releaseArtifactJournal(page);
  await expect(page.getByRole('textbox', { name: 'Artifact note', exact: true })).toHaveValue('Keep this saved note');
  const { paints } = await expectArtifactGeometry(page);
  if (journalHeld) expect(paints.filter(paint => paint.pending).length).toBeGreaterThanOrEqual(4);
}
async function finish(page: Page) {
  await page.evaluate(() => (window as unknown as EntranceWindow).artifactAnimations.at(-1)!.finish());
  await expect(page.locator('.artifact')).toHaveAttribute('data-entry-phase', 'settled');
}
async function settled(page: Page) {
  const state = await page.locator('.artifact').evaluate(node => {
    const body = node.querySelector('.artifact-body')!, style = getComputedStyle(body);
    // Chromium can still list a finished fill:none effect until its finish event.
    return { activeAnimations: body.getAnimations().filter(animation => ['running', 'paused'].includes(animation.playState)).length, opacity: style.opacity, transform: style.transform, height: (node as HTMLElement).style.height, overflow: (node as HTMLElement).style.overflow };
  });
  expect(state).toEqual({ activeAnimations: 0, opacity: '1', transform: 'none', height: '', overflow: '' });
}

for (const width of [1024, 1440, 768]) {
  test(`the inner layer reveals with panel tokens and stable outer geometry at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await holdArtifactJournal(page); await recordEntrances(page); await fixture(page); await publish(page, true);
    const entries = await records(page); expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.target).toBe('artifact-body');
    expect(entry.durationToken).toBe('220ms'); expect(entry.duration).toBe(220);
    expect(entry.easing).toBe(enter); expect(entry.easingToken.replaceAll(' ', '')).toBe('cubic-bezier(.16,1,.3,1)');
    expect(entry.frames).toHaveLength(2);
    expect(entry.frames.map(frame => [frame.opacity, frame.transform])).toEqual([['0', 'translateY(4px)'], ['1', 'translateY(0px)']]);
    for (const frame of entry.frames) expect(Object.keys(frame).filter(key => !['offset', 'computedOffset', 'easing', 'composite'].includes(key)).sort()).toEqual(['opacity', 'transform']);
    expect(entry.height).toBeGreaterThan(250);

    const samples = await page.locator('.artifact').evaluate(async node => {
      const animation = (window as unknown as EntranceWindow).artifactAnimations[0], duration = Number(animation.effect!.getTiming().duration);
      const samples = [];
      for (const progress of [0, .25, .5, .75, .99]) {
        animation.currentTime = duration * progress;
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        const body = node.querySelector('.artifact-body')!, style = getComputedStyle(body), shell = getComputedStyle(node);
        samples.push({ height: node.getBoundingClientRect().height, afterTop: document.querySelector('[data-after-artifact]')!.getBoundingClientRect().top, opacity: Number(style.opacity), translateY: new DOMMatrix(style.transform).m42, shellOpacity: shell.opacity, shellTransform: shell.transform, shellFilter: shell.filter, heightStyle: (node as HTMLElement).style.height, overflowStyle: (node as HTMLElement).style.overflow, heightEffects: node.getAnimations({ subtree: true }).flatMap(effect => (effect.effect as KeyframeEffect).getKeyframes()).some(frame => ['height', 'minHeight', 'maxHeight'].some(key => key in frame)) });
      }
      return samples;
    });
    for (const sample of samples) {
      expect(sample.height).toBeCloseTo(entry.height, 4); expect(sample.afterTop).toBeCloseTo(entry.afterTop!, 4);
      expect(sample).toMatchObject({ shellOpacity: '1', shellTransform: 'none', shellFilter: 'none', heightStyle: '', overflowStyle: '', heightEffects: false });
    }
    expect(samples[0]).toMatchObject({ opacity: 0, translateY: 4 });
    expect(samples[2].opacity).toBeGreaterThan(0); expect(samples[2].opacity).toBeLessThan(1);
    expect(samples.at(-1)!.translateY).toBeCloseTo(0, 2);
    await finish(page); await settled(page);
    expect((await page.locator('.artifact').boundingBox())!.height).toBeCloseTo(entry.height, 4);
    await testInfo.attach(`artifact-settle-${width}.json`, { body: JSON.stringify({ entry, samples }, null, 2), contentType: 'application/json' });
  });
}

test('entrance resolves inherited panel tokens and the existing motion speed', async ({ page }) => {
  await recordEntrances(page); await fixture(page);
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--motion-speed', '2');
    const host = document.querySelector('main')!;
    host.style.setProperty('--ui-motion-panel-enter', '.48s');
    host.style.setProperty('--ui-ease-enter', 'cubic-bezier(.2,.8,.4,1)');
  });
  await publish(page);
  expect((await records(page))[0]).toMatchObject({ duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.4, 1)', durationToken: '.48s' });
  await page.evaluate(async () => {
    const animation = (window as unknown as EntranceWindow).artifactAnimations[0];
    animation.play(); await animation.finished;
  });
  await expect(page.locator('.artifact')).toHaveAttribute('data-entry-phase', 'settled'); await settled(page);
});

for (const width of [1024, 1440]) for (const policy of ['os-reduced', 'reduced', 'off'] as const) {
  test(`${policy} publishes immediately without a transform at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: policy === 'os-reduced' ? 'reduce' : 'no-preference' });
    await holdArtifactJournal(page); await recordEntrances(page); await fixture(page);
    if (policy !== 'os-reduced') await page.evaluate(policy => { document.documentElement.dataset.motion = policy; }, policy);
    await publish(page, true);
    expect(await records(page)).toHaveLength(0);
    await expect(page.locator('.artifact')).toHaveAttribute('data-entry-phase', 'settled'); await settled(page);
    const height = (await page.locator('.artifact').boundingBox())!.height; expect(height).toBeGreaterThan(250);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => { document.documentElement.dataset.motion = 'system'; });
    await page.getByRole('button', { name: 'Publish snapshot', exact: true }).click();
    expect(await records(page)).toHaveLength(0); await settled(page);
    expect((await page.locator('.artifact').boundingBox())!.height).toBe(height);
  });
}

for (const interaction of ['keyboard', 'pointer'] as const) {
  test(`${interaction} stops the reveal and preserves the editing target`, async ({ page }) => {
    await recordEntrances(page); await fixture(page); await publish(page);
    const draft = page.getByRole('textbox', { name: 'Conversation draft', exact: true }), note = page.getByRole('textbox', { name: 'Artifact note', exact: true });
    await draft.focus(); const height = (await page.locator('.artifact').boundingBox())!.height;
    if (interaction === 'keyboard') await page.keyboard.press('Tab');
    else await note.dispatchEvent('pointerdown');
    await expect(page.locator('.artifact')).toHaveAttribute('data-entry-phase', 'settled'); await settled(page);
    if (interaction === 'keyboard') {
      await expect(page.locator('.artifact-header button').first()).toBeFocused();
      const controls = await page.locator('.artifact-header button').count();
      for (let step = 0; step < controls; step++) await page.keyboard.press('Tab');
    } else await note.click();
    await expect(note).toBeFocused(); await expect(note).toHaveValue('Keep this saved note');
    await expect(draft).toHaveValue('Keep my conversation draft');
    await page.getByRole('button', { name: 'Publish snapshot', exact: true }).click();
    expect(await records(page)).toHaveLength(1); expect((await page.locator('.artifact').boundingBox())!.height).toBe(height);
  });
}

for (const policy of ['os-reduced', 'reduced', 'off'] as const) {
  test(`${policy} settles an active entrance without changing geometry or replaying`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await recordEntrances(page); await fixture(page); await publish(page);
    const height = (await page.locator('.artifact').boundingBox())!.height;
    if (policy === 'os-reduced') await page.emulateMedia({ reducedMotion: 'reduce' });
    else await page.evaluate(policy => { document.documentElement.dataset.motion = policy; }, policy);
    await expect(page.locator('.artifact')).toHaveAttribute('data-entry-phase', 'settled'); await settled(page);
    expect((await page.locator('.artifact').boundingBox())!.height).toBe(height);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => { document.documentElement.dataset.motion = 'system'; });
    await page.getByRole('button', { name: 'Publish snapshot', exact: true }).click();
    expect(await records(page)).toHaveLength(1); await settled(page);
  });
}

for (const expanded of [false, true]) test(`delayed journal restoration preserves first-paint geometry and ${expanded ? 'modal' : 'inline'} focus`, async ({ page }) => {
  await holdArtifactJournal(page); await recordEntrances(page);
  await fixture(page, '?restored' + (expanded ? '&expanded' : ''));
  const publishButton = page.getByRole('button', { name: 'Publish artifact', exact: true });
  await publishButton.focus();
  await releaseArtifactJournal(page);
  const note = page.getByRole('textbox', { name: 'Artifact note', exact: true });
  await expect(note).toHaveValue('Keep this saved note');
  const { paints } = await expectArtifactGeometry(page);
  expect(paints.filter(paint => paint.pending).length).toBeGreaterThanOrEqual(4);
  expect(await records(page)).toHaveLength(0); await settled(page);
  if (expanded) {
    await expect(page.getByRole('button', { name: 'Collapse artifact', exact: true })).toBeFocused();
    await page.locator('.artifact .task-table-scroll').focus(); await page.keyboard.press('Tab');
    await expect(page.locator('.artifact-header button').first()).toBeFocused();
  } else await expect(publishButton).toBeFocused();
});

test('journal failure displays the full artifact without a smaller loading shell', async ({ page }) => {
  await page.addInitScript(() => { indexedDB.open = () => { throw new Error('Synthetic unavailable journal'); }; });
  await recordEntrances(page); await fixture(page); await publish(page);
  await expect(page.locator('.save-state')).toContainText('Local journal unavailable');
  await finish(page); await settled(page);
});

test('unmount cancels the active reveal and a restored host never replays', async ({ page }) => {
  await recordEntrances(page); await fixture(page); await publish(page);
  await page.getByRole('button', { name: 'Unmount artifact', exact: true }).click();
  await expect(page.locator('.artifact')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as EntranceWindow).artifactAnimations[0].playState)).toBe('idle');
  await page.getByRole('button', { name: 'Restore artifact', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Artifact note', exact: true })).toHaveValue('Keep this saved note');
  expect(await records(page)).toHaveLength(1); await settled(page);
  await fixture(page, '?restored');
  await expect(page.getByRole('textbox', { name: 'Artifact note', exact: true })).toBeVisible();
  expect(await records(page)).toHaveLength(0); await settled(page);
});

test('the conversation host animates a live publication once and keeps restored snapshots quiet', async ({ page }) => {
  await recordEntrances(page);
  const snapshot = taskFixture({ root: 'note', elements: { note: { type: 'Input', props: { label: 'Live note', stateKey: 'note' } } } }, {}, { note: 'Saved from the host' });
  const artifact = snapshot.artifacts[0]; snapshot.artifacts = [];
  const host = await serveTaskFixture(page, snapshot); await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
  snapshot.artifacts = [artifact]; await host.publish();
  await expect(page.getByRole('textbox', { name: 'Live note', exact: true })).toHaveValue('Saved from the host');
  expect(await records(page)).toHaveLength(1); expect((await records(page))[0].target).toBe('artifact-body');
  await finish(page); await host.publish(); expect(await records(page)).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Live note', exact: true })).toHaveValue('Saved from the host');
  expect(await records(page)).toHaveLength(0); await settled(page);
});
