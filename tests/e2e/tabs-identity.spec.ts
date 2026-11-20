import { test, expect } from '@playwright/test';
import { serveTaskFixture, taskFixture, type TaskSpec } from './task-interface-fixture';
import { quiescent } from './settle';
import { validateSurface } from '../../packages/ui-catalog';

const tabsSpec = (labels: string[]): TaskSpec => ({ root: 'tabs', elements: {
  tabs: { type: 'Tabs', props: { labels, stateKey: 'selectedTab', statusBinding: 'operation' }, children: ['first', 'second'] },
  first: { type: 'Input', props: { label: 'First draft', stateKey: 'firstDraft' } },
  second: { type: 'Input', props: { label: 'Second draft', stateKey: 'secondDraft' } },
} });
const operation = { status: 'pending', items: [{ label: 'Details', status: 'neutral' }, { label: 'Preview', status: 'neutral' }] };

for (const savedSelection of ['Details', 'Stale selection']) {
  test(`persisted ambiguous tabs fail safely without writing state (${savedSelection})`, async ({ page }) => {
    // This synthetic persisted snapshot deliberately bypasses fresh surface admission.
    const host = await serveTaskFixture(page, taskFixture(tabsSpec(['Details', 'Details']), { operation }, { selectedTab: savedSelection }));
    await page.goto('/');
    await expect(page.getByRole('alert')).toHaveCount(1);
    await expect(page.getByRole('alert')).toHaveText('This saved tab view is invalid because its labels are not unique.');
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.locator('.artifact-content').getByRole('tablist', { includeHidden: true })).toHaveCount(0);
    await expect(page.locator('.artifact-content').getByRole('tab', { includeHidden: true })).toHaveCount(0);
    await expect(page.locator('.artifact-content').getByRole('tabpanel', { includeHidden: true })).toHaveCount(0);
    await expect(page.locator('.artifact-content input')).toHaveCount(0);
    // Allow the real state save debounce to elapse before asserting no writes.
    expect(await quiescent(page, 800, () => [host.commands.filter(command => ['state.save', 'action.submit'].includes(command.type)).length, JSON.stringify(host.snapshot.userStates[0].values)])).toHaveLength(1);
    expect(host.commands.filter(command => ['state.save', 'action.submit'].includes(command.type))).toEqual([]);
    expect(host.snapshot.userStates[0].values).toEqual({ selectedTab: savedSelection });
  });
}

test('unique tabs retain saved selection and mounted drafts', async ({ page }) => {
  const spec = tabsSpec(['Details', 'Preview']); validateSurface(spec);
  const host = await serveTaskFixture(page, taskFixture(spec, { operation }, { selectedTab: 'Preview' }));
  await page.goto('/');
  const details = page.locator('.artifact-content').getByRole('tab', { name: 'Details', exact: true });
  const preview = page.locator('.artifact-content').getByRole('tab', { name: 'Preview', exact: true });
  const first = page.getByRole('textbox', { name: 'First draft', includeHidden: true });
  const second = page.getByRole('textbox', { name: 'Second draft', includeHidden: true });
  const assertSelected = async (label: string, mountedPanels = 2) => {
    await expect(page.locator('.artifact-content').getByRole('tab', { selected: true })).toHaveCount(1);
    await expect(page.locator('.artifact-content').getByRole('tab', { name: label, exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.artifact-content').getByRole('tab', { name: label, exact: true })).toHaveAttribute('tabindex', '0');
    await expect(page.locator('.artifact-content [role="tab"][tabindex="0"]')).toHaveCount(1);
    await expect(page.locator('.artifact-content').getByRole('tabpanel')).toHaveCount(1);
    await expect(page.locator('.artifact-content').getByRole('tabpanel', { includeHidden: true })).toHaveCount(mountedPanels);
  };
  await assertSelected('Preview', 1);
  await second.fill('Preview draft retained');
  await details.click(); await assertSelected('Details'); await first.fill('Details draft retained');
  const firstNode = await first.elementHandle(), secondNode = await second.elementHandle();
  await details.press('ArrowRight'); await assertSelected('Preview'); await expect(preview).toBeFocused();
  await preview.press('ArrowLeft'); await assertSelected('Details'); await expect(details).toBeFocused();
  await details.press('End'); await assertSelected('Preview'); await expect(preview).toBeFocused();
  await preview.press('Home'); await assertSelected('Details'); await expect(details).toBeFocused();
  await details.press('ArrowLeft'); await assertSelected('Preview'); await expect(preview).toBeFocused();
  await expect.poll(() => host.snapshot.userStates[0].values.selectedTab).toBe('Preview');
  for (const status of ['running', 'success']) {
    host.setInput('operation', { title: 'Review drafts', status, items: [{ label: 'Details', status }, { label: 'Preview', status }] });
    await host.publish();
    await expect(preview.locator('.task-tab-status-slot')).toHaveClass(`task-tab-status-slot status-${status}`);
    await assertSelected('Preview');
    expect(await first.evaluate((node, old) => node === old, firstNode)).toBe(true);
    expect(await second.evaluate((node, old) => node === old, secondNode)).toBe(true);
    await expect(first).toHaveValue('Details draft retained'); await expect(second).toHaveValue('Preview draft retained');
  }
  await expect.poll(() => host.snapshot.userStates[0].values).toEqual({ selectedTab: 'Preview', firstDraft: 'Details draft retained', secondDraft: 'Preview draft retained' });
  const saves = host.commands.filter(command => command.type === 'state.save');
  expect(saves.length).toBeGreaterThan(0);
  for (const command of saves) expect(['Details', 'Preview']).toContain((command.payload.values as Record<string, unknown>).selectedTab);
  expect(host.commands.filter(command => command.type === 'action.submit')).toEqual([]);
});

test('an unknown saved label falls back without rewriting state on render', async ({ page }) => {
  const spec = tabsSpec(['Details', 'Preview']); validateSurface(spec);
  const host = await serveTaskFixture(page, taskFixture(spec, { operation }, { selectedTab: 'Unknown label' }));
  await page.goto('/');
  await expect(page.locator('.artifact-content').getByRole('tab', { name: 'Details', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.artifact-content').getByRole('tab', { selected: true })).toHaveCount(1);
  await expect(page.locator('.artifact-content').getByRole('tabpanel')).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: 'First draft' })).toBeVisible();
  expect(await quiescent(page, 800, () => [host.commands.filter(command => ['state.save', 'action.submit'].includes(command.type)).length, JSON.stringify(host.snapshot.userStates[0].values)])).toHaveLength(1);
  expect(host.commands.filter(command => ['state.save', 'action.submit'].includes(command.type))).toEqual([]);
  expect(host.snapshot.userStates[0].values).toEqual({ selectedTab: 'Unknown label' });
});

type TabEffectWindow = Window & { tabEffects: { target: string; frames: ComputedKeyframe[] }[]; tabAnimations: Animation[] };

async function recordTabEffects(page: import('@playwright/test').Page, pause = false) {
  await page.addInitScript(pause => {
    const records: { target: string; frames: ComputedKeyframe[] }[] = [], animations: Animation[] = [];
    Object.assign(window, { tabEffects: records, tabAnimations: animations });
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const animation = animate.call(this, frames, options);
      if (this.matches('.task-tab-indicator, .task-tab-panel, .task-tab-panel *')) {
        if (pause) animation.pause();
        records.push({ target: String(this.className), frames: (animation.effect as KeyframeEffect).getKeyframes() });
        animations.push(animation);
      }
      return animation;
    };
  }, pause);
}
const tabEffects = (page: import('@playwright/test').Page) => page.evaluate(() => (window as unknown as TabEffectWindow).tabEffects);
// The indicator's painted box must land on the active tab's box (within 1 CSS px).
const indicatorDelta = (tab: import('@playwright/test').Locator) => tab.evaluate(button => {
  const mark = button.parentElement!.querySelector<HTMLElement>('.task-tab-indicator')!;
  const m = mark.getBoundingClientRect(), b = button.getBoundingClientRect();
  return { dx: m.left - b.left, dw: m.width - b.width, dy: m.bottom - b.bottom, hidden: mark.hasAttribute('hidden'), width: m.width };
});
const expectAligned = async (tab: import('@playwright/test').Locator) => {
  await expect.poll(() => indicatorDelta(tab)).toMatchObject({ hidden: false });
  await expect.poll(async () => {
    const delta = await indicatorDelta(tab);
    return Math.max(Math.abs(delta.dx), Math.abs(delta.dw), Math.abs(delta.dy));
  }, { message: 'indicator settles on the selected tab within 1 CSS px' }).toBeLessThanOrEqual(1);
  expect((await indicatorDelta(tab)).width).toBeGreaterThan(0);
};

test('pointer selection travels one indicator; source updates keep it still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await recordTabEffects(page);
  const spec = tabsSpec(['Details', 'Preview']); validateSurface(spec);
  const host = await serveTaskFixture(page, taskFixture(spec, { operation }, { selectedTab: 'Preview' }));
  await page.goto('/');
  const details = page.locator('.artifact-content').getByRole('tab', { name: 'Details', exact: true });
  const preview = page.locator('.artifact-content').getByRole('tab', { name: 'Preview', exact: true });
  const first = page.getByRole('textbox', { name: 'First draft', includeHidden: true });
  const second = page.getByRole('textbox', { name: 'Second draft', includeHidden: true });
  await expectAligned(preview);
  await second.fill('Preview draft kept');
  await details.click();
  await expect(first).toBeVisible();
  await expect.poll(() => indicatorDelta(details)).toMatchObject({ hidden: false });
  await expectAligned(details);
  const pointerEffects = (await tabEffects(page)).filter(record => record.target === 'task-tab-indicator');
  expect(pointerEffects.length).toBeGreaterThan(0);
  for (const record of pointerEffects) for (const frame of record.frames) expect(Object.keys(frame)).toContain('transform');
  await first.fill('Details draft kept');
  const firstNode = await first.elementHandle(), secondNode = await second.elementHandle();
  await preview.click(); await expectAligned(preview);
  await details.click(); await expectAligned(details);
  expect(await first.evaluate((node, old) => node === old, firstNode)).toBe(true);
  expect(await second.evaluate((node, old) => node === old, secondNode)).toBe(true);
  await expect(first).toHaveValue('Details draft kept');
  await expect(second).toHaveValue('Preview draft kept');
  // Arrow navigation and repeated identical snapshots never travel the indicator.
  const baseline = (await tabEffects(page)).length;
  await details.press('ArrowRight'); await expectAligned(preview); await expect(preview).toBeFocused();
  await preview.press('Home'); await expectAligned(details); await expect(details).toBeFocused();
  await details.press('End'); await expectAligned(preview); await expect(preview).toBeFocused();
  for (let i = 0; i < 3; i++) await host.publish();
  expect((await tabEffects(page)).length).toBe(baseline);
  // A source-status update on the inactive tab keeps selection, draft and geometry.
  host.setInput('operation', { title: 'Review drafts', status: 'running', items: [{ label: 'Details', status: 'running' }, { label: 'Preview', status: 'neutral' }] });
  await host.publish();
  await expect(details.locator('.task-tab-status-slot')).toHaveClass('task-tab-status-slot status-running');
  await expect(preview).toHaveAttribute('aria-selected', 'true');
  await expect(second).toHaveValue('Preview draft kept');
  await expectAligned(preview);
  expect((await tabEffects(page)).length).toBe(baseline);
});

test('reduced mid-flight settles the indicator; wrap and a revealed parent settle without travel', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await recordTabEffects(page, true);
  const spec = tabsSpec(['Details', 'Preview']); validateSurface(spec);
  await serveTaskFixture(page, taskFixture(spec, { operation }, { selectedTab: 'Details' }));
  await page.goto('/');
  const details = page.locator('.artifact-content').getByRole('tab', { name: 'Details', exact: true });
  const preview = page.locator('.artifact-content').getByRole('tab', { name: 'Preview', exact: true });
  await preview.click();
  const paused = () => page.evaluate(() => (window as unknown as TabEffectWindow).tabAnimations.filter(animation => animation.playState === 'paused').length);
  await expect.poll(paused).toBe(1);
  await page.evaluate(() => { document.documentElement.dataset.motion = 'reduced'; });
  await expect.poll(paused).toBe(0);
  await expectAligned(preview);
  await page.evaluate(() => { document.documentElement.dataset.motion = 'system'; });
  // A row wrap lands on a different line: paint the final rect without travel.
  await page.locator('.surface-tabs').evaluate(node => { const el = node as HTMLElement; el.style.flexWrap = 'wrap'; el.style.maxWidth = '140px'; });
  await details.click();
  await expectAligned(details);
  // A hidden parent revealed again recomputes the static rect via ResizeObserver.
  await page.locator('.artifact-content').evaluate(node => { (node as HTMLElement).style.display = 'none'; });
  await page.locator('.artifact-content').evaluate(node => { (node as HTMLElement).style.display = ''; });
  await expectAligned(details);
});

test('nested tablists resolve their own indicators', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await recordTabEffects(page);
  const nested: TaskSpec = { root: 'outer', elements: {
    outer: { type: 'Tabs', props: { labels: ['Outer first', 'Outer second'], stateKey: 'outerTab' }, children: ['inner', 'outerB'] },
    inner: { type: 'Tabs', props: { labels: ['Inner first', 'Inner second'], stateKey: 'innerTab' }, children: ['innerA', 'innerB'] },
    innerA: { type: 'Input', props: { label: 'Inner first draft', stateKey: 'innerFirst' } },
    innerB: { type: 'Input', props: { label: 'Inner second draft', stateKey: 'innerSecond' } },
    outerB: { type: 'Input', props: { label: 'Outer second draft', stateKey: 'outerSecond' } },
  } };
  validateSurface(nested);
  await serveTaskFixture(page, taskFixture(nested, {}, { outerTab: 'Outer first', innerTab: 'Inner first' }));
  await page.goto('/');
  const innerFirst = page.getByRole('tab', { name: 'Inner first', exact: true });
  const innerSecond = page.getByRole('tab', { name: 'Inner second', exact: true });
  const outerFirst = page.getByRole('tab', { name: 'Outer first', exact: true });
  const outerSecond = page.getByRole('tab', { name: 'Outer second', exact: true });
  await expect(page.locator('.task-tab-indicator')).toHaveCount(2);
  await expectAligned(innerFirst); await expectAligned(outerFirst);
  const outerBefore = await indicatorDelta(outerFirst);
  await innerSecond.click();
  await expectAligned(innerSecond);
  const outerAfter = await indicatorDelta(outerFirst);
  expect(outerAfter.dx).toBeCloseTo(outerBefore.dx, 0);
  // Each control resolves its own ref: the outer selection still works alone.
  await outerSecond.click();
  await expectAligned(outerSecond);
  await expect(page.getByRole('textbox', { name: 'Outer second draft' })).toBeVisible();
});
