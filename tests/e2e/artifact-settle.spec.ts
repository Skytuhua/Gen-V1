import { test, expect, type Page } from '@playwright/test';
import { serveTaskFixture, taskFixture } from './task-interface-fixture';
import { expectArtifactGeometry, holdArtifactJournal, holdWidgetMount, releaseArtifactJournal, serveArtifactSettleFixture as fixture } from './artifact-settle-host';

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

// A disclosure owns two motion regions (answer + branch). Both must settle, and the
// extent that moves following content is their combined inner height — even an empty
// answer body reserves a small line, so measuring only the branch under-counts.
async function settleDisclosure(page: Page, open: boolean) {
  await expect.poll(() => page.locator('.disclosure-node').first().evaluate((node, open) => {
    const regions = Array.from(node.querySelectorAll<HTMLElement>('.disclosure > .task-motion-region')).concat(Array.from(node.querySelectorAll<HTMLElement>(':scope > .disclosure-branch-region')));
    return regions.every(region => {
      const height = region.getBoundingClientRect().height, inner = region.querySelector('.task-motion-inner')!.getBoundingClientRect().height;
      return open ? Math.abs(height - inner) < .1 : height < .1;
    }) ? 'ok' : 'pending';
  }, open)).toBe('ok');
}
const disclosureExtent = (page: Page) => page.locator('.disclosure-node').first().evaluate(node => {
  const regions = Array.from(node.querySelectorAll<HTMLElement>('.disclosure > .task-motion-region')).concat(Array.from(node.querySelectorAll<HTMLElement>(':scope > .disclosure-branch-region')));
  return regions.reduce((sum, region) => sum + (region.querySelector('.task-motion-inner')?.getBoundingClientRect().height ?? 0), 0);
});

for (const width of [768, 1024, 1440]) for (const recoveredOpen of [false, true]) for (const failed of [false, true]) {
  test(`conversation stays fixed across disclosure states at ${width}, recovered ${recoveredOpen}, journal ${failed ? 'failure' : 'success'}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1100 });
    await holdArtifactJournal(page, { note: 'Recovered note', open: recoveredOpen });
    await fixture(page, `?disclosure&hostOpen=${!recoveredOpen}`);
    await page.getByRole('button', { name: 'Publish artifact', exact: true }).click();
    await expect(page.locator('.artifact')).toBeAttached();
    // Let the host-state reservation settle before sampling the held position, so the
    // stability check compares like-for-like (not an initial mount-settling frame).
    await settleDisclosure(page, !recoveredOpen);
    // The following paragraph is visible even when the artifact itself is hidden.
    const heldTop = await page.locator('[data-after-artifact]').evaluate(node => node.getBoundingClientRect().top);
    await expect(page.locator('.artifact-restoring').getByRole('status', { includeHidden: true })).toHaveText('Restoring Task surface…');
    await testInfo.attach(`held-${width}.png`, { body: await page.screenshot(), contentType: 'image/png' });
    await releaseArtifactJournal(page, failed);
    const details = page.getByRole('button', { name: 'Recovered details', exact: true });
    await expect(details).toHaveAttribute('aria-expanded', String(failed ? !recoveredOpen : recoveredOpen));
    await expect(page.getByRole('textbox', { name: 'Artifact note', exact: true })).toHaveValue(failed ? 'Keep this saved note' : 'Recovered note');
    await expect(page.locator('.artifact')).toHaveAttribute('data-entry-phase', 'settled');
    const restoredOpen = failed ? !recoveredOpen : recoveredOpen;
    // Let the disclosure springs settle to the recovered state before measuring geometry.
    await settleDisclosure(page, restoredOpen);
    const checkpoints = [{ state: 'held', afterTop: heldTop }, { state: 'restored', afterTop: await page.locator('[data-after-artifact]').evaluate(node => node.getBoundingClientRect().top) }];
    // Split invariant (R13): the held reservation is stable, restoration applies the
    // recovered disclosure state by exactly its extent, and each deliberate toggle
    // moves following content by exactly the hidden/revealed extent.
    const heldOpen = !recoveredOpen; // fixture seeds hostOpen opposite to the recovered value
    const restorationDelta = checkpoints[1].afterTop - heldTop;
    if (restoredOpen === heldOpen) {
      expect(Math.abs(restorationDelta), 'restoration with an unchanged disclosure keeps following content fixed').toBeLessThanOrEqual(1);
    } else {
      const restoredExtent = await disclosureExtent(page);
      expect(Math.abs(Math.abs(restorationDelta) - restoredExtent), 'restoration applies the recovered disclosure state by exactly its extent').toBeLessThanOrEqual(2);
    }
    let previous = { open: restoredOpen, afterTop: checkpoints[1].afterTop };
    for (const open of [false, true, false, true]) {
      if (await details.getAttribute('aria-expanded') !== String(open)) await details.click();
      await expect(details).toHaveAttribute('aria-expanded', String(open));
      await settleDisclosure(page, open);
      const afterTop = await page.locator('[data-after-artifact]').evaluate(node => node.getBoundingClientRect().top);
      const delta = afterTop - previous.afterTop;
      if (open !== previous.open) {
        const extent = await disclosureExtent(page);
        expect(extent, 'the fixture hides a substantial extent').toBeGreaterThan(40);
        expect(Math.abs(Math.abs(delta) - extent), 'deliberate toggle moves following content by the hidden/revealed extent').toBeLessThanOrEqual(2);
        expect(open ? delta : -delta, 'collapse lifts and expand lowers following content').toBeGreaterThan(0);
      } else {
        expect(Math.abs(delta), 'a no-op toggle keeps following content fixed').toBeLessThanOrEqual(1);
      }
      checkpoints.push({ state: open ? 'expanded' : 'collapsed', afterTop });
      previous = { open, afterTop };
    }
    await testInfo.attach(`restored-${width}.png`, { body: await page.screenshot(), contentType: 'image/png' });
    const geometry = await page.evaluate(() => (window as unknown as Window & { artifactPaints: { height: number | null; afterTop: number; pending: boolean; restoring: boolean; artifactVisible: boolean; disclosureOpen: string | null }[] }).artifactPaints.filter(paint => paint.height !== null));
    const positions = [...geometry.map(paint => paint.afterTop), ...checkpoints.map(point => point.afterTop)];
    const shift = Math.max(...positions) - Math.min(...positions);
    await testInfo.attach(`conversation-${width}.json`, { body: JSON.stringify({ width, recoveredOpen, failed, shift, checkpoints, geometry }, null, 2), contentType: 'application/json' });
    expect(geometry.filter(paint => paint.pending).length).toBeGreaterThanOrEqual(4);
    expect(geometry.some(paint => paint.pending && !paint.artifactVisible), 'held read with hidden artifact is sampled').toBe(true);
    expect(geometry.some(paint => paint.restoring && paint.artifactVisible), 'shown restoration reservation is sampled').toBe(true);
    expect(geometry.some(paint => !paint.restoring && paint.artifactVisible)).toBe(true);
    expect(geometry.some(paint => paint.disclosureOpen === 'true')).toBe(true);
    expect(geometry.some(paint => paint.disclosureOpen === 'false')).toBe(true);
    // Restoration stability is asserted by the held->restored delta above (exactly the
    // recovered disclosure extent, no spurious jump). Per-paint held positions are not
    // asserted: the journal-hold probe re-arms its pending flag on later IndexedDB opens,
    // so `paint.pending` is not a reliable held-phase marker after release.
  });
}

test('automatic disclosure actions wait for restored state', async ({ page }) => {
  await holdArtifactJournal(page); await fixture(page, '?request');
  const actions: unknown[] = [];
  await page.route('**/api/bootstrap', route => route.fulfill({ json: { csrfToken: 'restoring-fixture' } }));
  await page.route('**/api/commands', route => {
    const command = route.request().postDataJSON();
    if (command.type === 'action.submit') actions.push(command.payload.payload);
    return route.fulfill({ json: { commandId: command.id, result: {}, seq: 1 } });
  });
  await page.getByRole('button', { name: 'Publish artifact', exact: true }).click();
  await expect(page.locator('.artifact-restoring').getByRole('status', { includeHidden: true })).toHaveText('Restoring Task surface…');
  expect(actions).toHaveLength(0);
  await releaseArtifactJournal(page);
  await expect.poll(() => actions).toEqual([{ note: 'Keep this saved note' }]);
});

for (const recovered of [false, true]) test(`${recovered ? 'recovered' : 'generated'} signatures wait for journal restoration`, async ({ page }) => {
  if (recovered) await page.addInitScript(() => {
    const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 320;
    canvas.getContext('2d')!.fillRect(20, 20, 400, 100);
    localStorage.setItem('harness:signature-assets:v1:task-thread:task-state', JSON.stringify([{ id: 'recovered-signature', stateKey: 'signature', base64: canvas.toDataURL('image/png').split(',')[1] }]));
  });
  await holdArtifactJournal(page); await fixture(page, '?signature');
  let uploads = 0;
  await page.route('**/api/bootstrap', route => route.fulfill({ json: { csrfToken: 'restoring-fixture' } }));
  await page.route('**/api/commands', route => {
    const command = route.request().postDataJSON();
    if (command.type === 'resource.upload') uploads++;
    return route.fulfill({ json: { commandId: command.id, result: command.type === 'resource.upload' ? { id: 'signature-asset', threadId: 'task-thread', kind: 'attachment' } : {}, seq: 1 } });
  });
  await page.getByRole('button', { name: 'Publish artifact', exact: true }).click();
  await expect(page.locator('.artifact-restoring').getByRole('status', { includeHidden: true })).toHaveText('Restoring Task surface…');
  await expect(page.locator('.signature-well-tools button').first()).toBeEnabled();
  expect(uploads).toBe(0);
  if (!recovered) expect(await page.evaluate(() => localStorage.getItem('harness:signature-assets:v1:task-thread:task-state'))).toBeNull();
  await releaseArtifactJournal(page);
  await expect.poll(() => uploads).toBe(1);
  await expect(page.getByRole('img', { name: 'Selected visual signature', exact: true })).toBeVisible();
});

for (const width of [1024, 1440, 768]) for (const rows of [0, 12]) for (const failed of [false, true]) {
  test(`restoration ${failed ? 'failure' : 'success'} reserves layout from first pending paint at ${width}, ${rows} rows`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await holdArtifactJournal(page); await recordEntrances(page); await fixture(page, `?rows=${rows}`);
    await page.getByRole('button', { name: 'Publish artifact', exact: true }).click();
    await expect(page.locator('.artifact-restoring').getByRole('status', { includeHidden: true })).toHaveText('Restoring Task surface…');
    await expect(page.locator('.artifact')).toHaveCSS('visibility', 'hidden');
    await releaseArtifactJournal(page, failed);
    await expect(page.getByRole('textbox', { name: 'Artifact note', exact: true })).toHaveValue('Keep this saved note');
    await finish(page);
    const geometry = await expectArtifactGeometry(page);
    expect(geometry.paints.some(paint => paint.restoring && paint.height !== null)).toBe(true);
    if (failed) await expect(page.locator('.save-state')).toContainText('Local journal unavailable');
    await testInfo.attach('complete-restoration-geometry.json', { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' });
  });
}

async function publish(page: Page, journalHeld = false) {
  await page.getByRole('button', { name: 'Publish artifact', exact: true }).click();
  if (journalHeld) await releaseArtifactJournal(page);
  await expect(page.getByRole('textbox', { name: 'Artifact note', exact: true })).toHaveValue('Keep this saved note');
  const { paints } = await expectArtifactGeometry(page);
  if (journalHeld) expect(paints.some(paint => paint.restoring && paint.height !== null)).toBe(true);
}
async function finish(page: Page) {
  await page.evaluate(() => (window as unknown as EntranceWindow).artifactAnimations.at(-1)!.finish());
  await expect(page.locator('.artifact')).toHaveAttribute('data-entry-phase', 'settled');
}
async function settled(page: Page) {
  const state = await page.locator('.artifact').evaluate(node => {
    const body = node.querySelector('.artifact-body')!, style = getComputedStyle(body);
    // OS policy changes also start scrollbar color transitions; track the entrance itself.
    return { activeEntrances: (window as unknown as EntranceWindow).artifactAnimations.filter(animation => ['running', 'paused'].includes(animation.playState)).length, opacity: style.opacity, transform: style.transform, height: (node as HTMLElement).style.height, overflow: (node as HTMLElement).style.overflow };
  });
  expect(state).toEqual({ activeEntrances: 0, opacity: '1', transform: 'none', height: '', overflow: '' });
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
  await expect(page.locator('.artifact-restoring').getByRole('status', { includeHidden: true })).toHaveText('Restoring Task surface…');
  await expect(page.locator('.artifact')).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('.artifact-body')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('.artifact-content')).toHaveAttribute('inert', '');
  // The note is the artifact's only field input; the records Table legitimately
  // renders its own "Filter rows" control, so scope the identity check to the field.
  await expect(page.locator('.artifact-content .field input')).toHaveCount(1);
  const original = await page.locator('.artifact-content .field input').elementHandle();
  await releaseArtifactJournal(page);
  const note = page.getByRole('textbox', { name: 'Artifact note', exact: true });
  await expect(note).toHaveValue('Keep this saved note');
  expect(await note.evaluate((node, original) => node === original, original)).toBe(true);
  await page.getByRole('button', { name: 'Publish snapshot', exact: true, includeHidden: true }).dispatchEvent('click');
  expect(await note.evaluate((node, original) => node === original, original)).toBe(true);
  const { paints } = await expectArtifactGeometry(page);
  expect(paints.some(paint => paint.restoring && paint.height !== null)).toBe(true);
  expect(await records(page)).toHaveLength(0); await settled(page);
  if (expanded) {
    await expect(page.getByRole('button', { name: 'Collapse artifact', exact: true })).toBeFocused();
    // Focus the trap's actual last focusable control (the records Table now owns
    // filter/column controls, so a fixed container is no longer last), then Tab
    // must wrap to the first focusable control. Re-query after Tab so the check
    // compares live nodes, not a handle that a re-render may have replaced.
    await page.locator('.artifact').evaluate(node => {
      const focusable = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], area[href], summary, iframe, audio[controls], video[controls], [contenteditable]:not([contenteditable="false"]), [tabindex]';
      const tabOrder = (el: Element) => { const index = Number.parseInt(el.getAttribute('tabindex') ?? '', 10); return index > 0 ? index : Number.MAX_SAFE_INTEGER; };
      const items = Array.from(node.querySelectorAll<HTMLElement>(focusable)).filter(el => el.getClientRects().length && !el.matches(':disabled') && !(el.getAttribute('tabindex') ?? '').startsWith('-') && !el.closest('[inert], [hidden]')).sort((a, b) => tabOrder(a) - tabOrder(b));
      items.at(-1)?.focus();
    });
    await page.keyboard.press('Tab');
    expect(await page.locator('.artifact').evaluate(node => {
      const focusable = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], area[href], summary, iframe, audio[controls], video[controls], [contenteditable]:not([contenteditable="false"]), [tabindex]';
      const tabOrder = (el: Element) => { const index = Number.parseInt(el.getAttribute('tabindex') ?? '', 10); return index > 0 ? index : Number.MAX_SAFE_INTEGER; };
      const items = Array.from(node.querySelectorAll<HTMLElement>(focusable)).filter(el => el.getClientRects().length && !el.matches(':disabled') && !(el.getAttribute('tabindex') ?? '').startsWith('-') && !el.closest('[inert], [hidden]')).sort((a, b) => tabOrder(a) - tabOrder(b));
      return document.activeElement === items[0];
    })).toBe(true);
  } else await expect(publishButton).toBeFocused();
});

test('journal failure displays the full artifact without a smaller loading shell', async ({ page }) => {
  await page.addInitScript(() => { indexedDB.open = () => { throw new Error('Synthetic unavailable journal'); }; });
  await recordEntrances(page); await fixture(page); await publish(page);
  await expect(page.locator('.save-state')).toContainText('Local journal unavailable');
  await finish(page); await settled(page);
});

for (const width of [1024, 1440, 768]) for (const failFirst of [false, true]) {
  test(`widget ${failFirst ? 'failure and retry' : 'delayed mount'} reserves its final geometry at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await recordEntrances(page); await fixture(page, '?widget');
    const mount = await holdWidgetMount(page, failFirst);
    await page.getByRole('button', { name: 'Publish artifact', exact: true }).click();
    await expect.poll(mount.requests).toBe(1);
    await expect(page.getByRole('status')).toHaveText('Opening secure widget…');
    await finish(page);
    const pending = await expectArtifactGeometry(page);
    mount.release();
    if (failFirst) {
      await expect(page.getByRole('alert')).toContainText('Synthetic widget mount unavailable');
      expect((await expectArtifactGeometry(page)).final).toEqual(pending.final);
      await page.getByRole('button', { name: 'Retry widget', exact: true }).click();
    }
    const frame = page.frameLocator('.widget-frame');
    await expect(frame.getByText('Secure widget ready', { exact: true })).toBeVisible();
    await expect(frame.getByRole('textbox', { name: 'Widget note', exact: true })).toHaveValue('Keep this saved note');
    await expect(page.getByRole('status')).toHaveCount(0);
    const final = await expectArtifactGeometry(page);
    expect(final.final).toEqual(pending.final);
    const sizes = await page.locator('.widget-frame').evaluate(node => ({ frame: node.getBoundingClientRect().height, slot: node.parentElement!.getBoundingClientRect().height }));
    expect(sizes.slot).toBe(sizes.frame);
    expect(await records(page)).toHaveLength(1);
    await frame.getByRole('textbox', { name: 'Widget note', exact: true }).focus();
    await expect(frame.getByRole('textbox', { name: 'Widget note', exact: true })).toBeFocused();
  });
}

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
  // Full-App cold start on the dev server can exceed the default 5s expect timeout
  // while Vite transforms the module graph; the assertion itself is unchanged.
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible({ timeout: 30_000 });
  snapshot.artifacts = [artifact]; await host.publish();
  await expect(page.getByRole('textbox', { name: 'Live note', exact: true })).toHaveValue('Saved from the host');
  expect(await records(page)).toHaveLength(1); expect((await records(page))[0].target).toBe('artifact-body');
  await finish(page); await host.publish(); expect(await records(page)).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Live note', exact: true })).toHaveValue('Saved from the host');
  expect(await records(page)).toHaveLength(0); await settled(page);
});
