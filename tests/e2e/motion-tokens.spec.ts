import { test, expect, type Locator, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { branchGraphData, branchGraphSpec, growingQaSpec, linkedMapData, linkedMapSpec, serveTaskFixture, taskFixture } from './task-interface-fixture';

const enter = 'cubic-bezier(0.16, 1, 0.3, 1)', move = 'cubic-bezier(0.4, 0, 0.2, 1)';
type MotionRecord = { name: string; target: string; from?: string; to?: string; duration: number; easing: string; frames: ComputedKeyframe[] };
type MotionWindow = Window & { motionRecords: MotionRecord[] };
async function recordMotion(page: Page) {
  await page.addInitScript(() => {
    const records: MotionRecord[] = [];
    Object.assign(window, { motionRecords: records });
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const animation = animate.call(this, frames, options), timing = animation.effect!.getTiming();
      if (this.matches('.floating-window,.document-text-window')) records.push({ name: 'panel', target: this.className, duration: Number(timing.duration), easing: timing.easing!, frames: (animation.effect as KeyframeEffect).getKeyframes() });
      return animation;
    };
    document.addEventListener('animationstart', event => {
      const target = event.target as HTMLElement;
      const animation = target.getAnimations().find(item => item instanceof CSSAnimation && item.animationName === event.animationName);
      if (!animation?.effect) return;
      const frames = (animation.effect as KeyframeEffect).getKeyframes();
      records.push({ name: event.animationName, target: String(target.className), from: target.dataset.from, to: target.dataset.to, duration: Number(animation.effect.getTiming().duration), easing: frames[0].easing, frames });
    });
  });
}
const records = (page: Page) => page.evaluate(() => (window as unknown as MotionWindow).motionRecords);
const draws = async (page: Page) => (await records(page)).filter(item => ['task-path-in', 'task-future-in'].includes(item.name));
async function hoverTiming(control: Locator) {
  await expect(control).toBeVisible();
  const transitions = await control.evaluate(node => {
    const style = getComputedStyle(node), durations = style.transitionDuration.split(', '), easings = style.transitionTimingFunction.split(/, (?=[a-z])/);
    return style.transitionProperty.split(', ').map((property, index) => ({ property, duration: durations[index % durations.length], easing: easings[index % easings.length] }));
  });
  for (const property of ['background-color', 'color']) expect(transitions).toContainEqual({ property, duration: '0.12s', easing: move });
  await control.hover();
  await control.focus();
}
async function standalone(page: Page, name: string) {
  const path = encodeURI('/@fs/' + resolve(`tests/e2e/${name}-fixture.tsx`).replaceAll('\\', '/'));
  await page.route('**/motion-fixture', route => route.fulfill({ contentType: 'text/html', body: `<html data-theme="dark"><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${path}');</script></body></html>` }));
  await page.goto('/motion-fixture');
}

for (const width of [1024, 1440]) {
  test(`project and sidebar hover colors use 120ms at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await standalone(page, 'project-picker');
    await hoverTiming(page.getByRole('button', { name: 'Filter threads', exact: true }));
    await page.getByRole('button', { name: 'Open project picker', exact: true }).click();
    await hoverTiming(page.getByRole('option', { name: 'Beta', exact: true }));
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Options for Existing thread', exact: true }).click();
    await hoverTiming(page.getByRole('menuitem', { name: 'Rename thread', exact: true }));
  });

  test(`file hover colors use 120ms at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.route('**/api/**', route => route.fulfill({ status: 404 }));
    await page.route('**/api/bootstrap', route => route.fulfill({ json: { csrfToken: 'motion-fixture' } }));
    await page.route('**/api/projects/*/files?*', route => route.fulfill({ json: { entries: [{ name: 'motion.txt', path: 'motion.txt', kind: 'file', bytes: 10 }] } }));
    await standalone(page, 'files-reading');
    await hoverTiming(page.getByRole('button', { name: 'motion.txt', exact: true }));
  });

  test(`graph reveals only new connections and never replays expanded snapshots at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ reducedMotion: 'no-preference' }); await recordMotion(page);
    const graph = structuredClone(branchGraphData);
    const host = await serveTaskFixture(page, taskFixture(branchGraphSpec('vertical'), { graph })); await page.goto('/');
    await expect(page.locator('.graph-edge')).toHaveCount(3);
    expect(await draws(page)).toHaveLength(0);
    await hoverTiming(page.locator('.task-node').first());
    await expect(page.locator('.task-graph-check')).toHaveCSS('animation-duration', '0.18s');
    await expect(page.locator('.task-graph-check')).toHaveCSS('animation-timing-function', enter);
    await expect(page.locator('.graph-edge').first()).toHaveCSS('transition-duration', '0.16s');
    await expect(page.locator('.task-graph-dot').first()).toHaveCSS('transition-duration', '0.16s, 0.16s, 0.16s');

    const updated = { ...graph, nodes: [...graph.nodes, { id: 'new', label: 'New connection', lane: 1 }], edges: [...graph.edges, { from: 'head', to: 'new' }, { from: 'topic', to: 'new', prospective: true }] };
    host.setInput('graph', updated); await host.publish();
    await expect.poll(async () => (await draws(page)).length).toBe(2);
    expect((await draws(page)).map(({ name, duration, easing }) => ({ name, duration, easing }))).toEqual([
      { name: 'task-path-in', duration: 180, easing: enter }, { name: 'task-future-in', duration: 180, easing: enter },
    ]);
    await expect(page.locator('.graph-edge[data-reveal]')).toHaveCount(0);
    await host.publish();
    host.snapshot.artifacts[0].placement = 'expanded'; await host.publish();
    await expect(page.getByRole('button', { name: 'Collapse artifact', exact: true })).toBeVisible();
    // Force a renderer remount as well as changing the expanded presentation.
    const previousPath = await page.locator('.graph-edge').first().elementHandle();
    host.snapshot.artifacts[0].spec = { root: 'text', elements: { text: { type: 'Text', props: { text: 'Switching renderer' } } } };
    host.snapshot.artifacts[0].revision++; await host.publish(); await expect(page.locator('.graph-edge')).toHaveCount(0);
    host.snapshot.artifacts[0].spec = branchGraphSpec('vertical'); host.snapshot.artifacts[0].revision++; await host.publish();
    await expect(page.locator('.graph-edge')).toHaveCount(5);
    expect(await previousPath!.evaluate(node => node.isConnected)).toBe(false);
    expect(await page.locator('.graph-edge').evaluateAll(paths => paths.every(path => getComputedStyle(path).animationName === 'none' && getComputedStyle(path).strokeDashoffset === '0px'))).toBe(true);
    expect(await draws(page)).toHaveLength(2);
    host.snapshot.artifacts[0].placement = 'inline'; await host.publish();
    await expect(page.locator('.graph-edge')).toHaveCount(5);
    host.setInput('graph', graph); await host.publish(); await expect(page.locator('.graph-edge')).toHaveCount(3);
    host.setInput('graph', { ...updated, edges: [...updated.edges].reverse() }); await host.publish();
    await expect(page.locator('.graph-edge')).toHaveCount(5);
    expect(await draws(page)).toHaveLength(2);
    expect(await page.locator('.graph-edge').evaluateAll(paths => paths.every(path => getComputedStyle(path).animationName === 'none'))).toBe(true);
  });

  test(`map draws and disclosure insertions use 180ms approved entrances at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); await recordMotion(page);
    await serveTaskFixture(page, taskFixture(linkedMapSpec, { places: linkedMapData })); await page.goto('/');
    await expect(page.locator('.task-map-route')).toHaveCSS('animation-duration', '0.18s');
    await expect(page.locator('.task-map-route')).toHaveCSS('animation-timing-function', enter);
    await expect.poll(async () => (await records(page)).filter(item => item.name === 'task-map-route-in').map(item => item.duration)).toEqual([180]);
    await serveTaskFixture(page, taskFixture(growingQaSpec, { answer: { status: 'ready', answer: 'Yes.' } }, { deliveryOpen: true })); await page.goto('/');
    const parent = page.getByRole('button', { name: 'Can delivery be split?', exact: true });
    await expect(parent).toBeVisible();
    if (await parent.getAttribute('aria-expanded') !== 'true') await parent.click();
    const child = page.locator('.disclosure-children>.disclosure-node').first();
    await expect(child).toBeVisible();
    await expect(child).toHaveCSS('animation-duration', '0.18s');
    await expect(child).toHaveCSS('animation-timing-function', enter);
  });

  test(`side chat and document windows enter in 220ms without overshoot at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); await recordMotion(page);
    const host = await serveTaskFixture(page, taskFixture({ root: 'doc', elements: { doc: { type: 'Document', props: { title: 'Handoff', text: 'Prepared document.', presentation: 'window', editableStateKey: 'draft' } } } })); await page.goto('/');
    const main = page.getByRole('textbox', { name: 'Message', exact: true }); await main.fill('/side'); await main.press('Enter');
    const side = page.getByRole('region', { name: 'Side conversation window', exact: true }); await expect(side).toBeVisible();
    await expect(side).toHaveCSS('transition-timing-function', [move, move, move, move].join(', '));
    await side.getByRole('button', { name: 'Close Side conversation', exact: true }).click();
    await page.getByRole('button', { name: 'Open document', exact: true }).click();
    await expect(page.locator('.document-text-window')).toBeVisible();
    const panels = (await records(page)).filter(item => item.name === 'panel');
    expect(panels).toHaveLength(2);
    for (const panel of panels) {
      expect(panel.duration).toBe(220); expect(panel.easing).toBe(enter);
      expect(panel.frames).toHaveLength(2);
      expect(panel.frames[1].transform).toMatch(/translate[XY]\(0(?:px)?\) scale\(1\)/);
    }
    await host.publish();
    expect((await records(page)).filter(item => item.name === 'panel')).toHaveLength(2);
  });
}

for (const policy of ['reduced', 'off'] as const) test(`panel token resolution preserves app ${policy} policy`, async ({ page }) => {
  await recordMotion(page);
  await serveTaskFixture(page, taskFixture({ root: 'doc', elements: { doc: { type: 'Document', props: { title: 'Handoff', text: 'Prepared document.', presentation: 'window' } } } })); await page.goto('/');
  await expect(page.getByRole('button', { name: 'Open document', exact: true })).toBeVisible();
  await page.evaluate(policy => { document.documentElement.dataset.motion = policy; }, policy);
  await page.getByRole('button', { name: 'Open document', exact: true }).click();
  await expect(page.locator('.document-text-window')).toBeVisible();
  const panels = (await records(page)).filter(item => item.name === 'panel');
  if (policy === 'off') expect(panels).toHaveLength(0);
  else { expect(panels).toHaveLength(1); expect(panels[0].duration).toBeLessThanOrEqual(80); expect(panels[0].frames.every(frame => !('transform' in frame))).toBe(true); }
});

test('reduced motion reveals new solid and prospective graph edges immediately', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await recordMotion(page);
  const host = await serveTaskFixture(page, taskFixture(branchGraphSpec('vertical'), { graph: branchGraphData })); await page.goto('/');
  await expect(page.locator('.graph-edge')).toHaveCount(3);
  host.setInput('graph', { ...branchGraphData, nodes: [...branchGraphData.nodes, { id: 'new', label: 'New point' }], edges: [...branchGraphData.edges, { from: 'head', to: 'new' }, { from: 'topic', to: 'new', prospective: true }] }); await host.publish();
  await expect(page.locator('.graph-edge')).toHaveCount(5);
  expect(await page.locator('.graph-edge').evaluateAll(paths => paths.every(path => getComputedStyle(path).animationName === 'none'))).toBe(true);
  expect(await draws(page)).toHaveLength(0);
});

test('imperative panel motion resolves inherited tokens and the selected speed', async ({ page }) => {
  await recordMotion(page);
  await serveTaskFixture(page, taskFixture({ root: 'doc', elements: { doc: { type: 'Document', props: { title: 'Handoff', text: 'Prepared document.', presentation: 'window' } } } })); await page.goto('/');
  const launcher = page.getByRole('button', { name: 'Open document', exact: true }); await expect(launcher).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--ui-motion-panel-enter', '.3s');
    document.documentElement.style.setProperty('--ui-ease-enter', 'linear');
    document.documentElement.style.setProperty('--motion-speed', '1.25');
  });
  await launcher.click(); await expect(page.locator('.document-text-window')).toBeVisible();
  const panels = (await records(page)).filter(item => item.name === 'panel');
  expect(panels).toHaveLength(1); expect(panels[0].duration).toBe(240); expect(panels[0].easing).toBe('linear');
});

test('tab crossfade and shared control press feedback resolve motion tokens and policies', async ({ page }) => {
  await serveTaskFixture(page, taskFixture({ root: 'text', elements: { text: { type: 'Text', props: { text: 'Motion contract' } } } })); await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled({ timeout: 15000 });
  const probe = () => page.evaluate(() => {
    document.querySelectorAll('.motion-contract-probe').forEach(node => node.remove());
    const header = document.createElement('div'); header.className = 'workspace-right-header motion-contract-probe'; header.style.cssText = 'position:fixed;top:0;left:0;z-index:10000;';
    const tab = document.createElement('button'); tab.setAttribute('role', 'tab'); header.append(tab);
    const trigger = document.createElement('button'); trigger.className = 'ui-action-trigger motion-contract-probe'; trigger.textContent = 'Press'; trigger.style.cssText = 'position:fixed;top:60px;left:10px;z-index:10000;';
    document.body.append(header, trigger);
    const box = trigger.getBoundingClientRect();
    return { tabProperty: getComputedStyle(tab).transitionProperty, tabDuration: getComputedStyle(tab).transitionDuration, triggerTransition: getComputedStyle(trigger).transition, x: box.x, y: box.y, width: box.width, height: box.height };
  });
  const press = async (point: { x: number; y: number; width: number; height: number }) => {
    await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2); await page.mouse.down(); await page.waitForTimeout(120);
    const transform = await page.evaluate(() => getComputedStyle(document.querySelector('.ui-action-trigger.motion-contract-probe')!).transform);
    await page.mouse.up(); return transform;
  };
  const initial = await probe();
  expect(initial.tabProperty.split(', ')).toEqual(['color', 'border-bottom-color']);
  expect(initial.tabDuration).toBe('0.14s, 0.14s');
  expect(initial.triggerTransition).toContain('transform 0.08s');
  expect(await press(initial)).toMatch(/^matrix\(0\.97, 0, 0, 0\.97/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await probe();
  expect(reduced.tabDuration.split(', ').every(value => parseFloat(value) <= 0.01)).toBe(true);
  expect(await press(reduced)).toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => { document.documentElement.dataset.motion = 'off'; });
  const off = await probe();
  expect(off.tabDuration).toBe('0s');
  expect(off.triggerTransition).not.toContain('0.08s');
});
