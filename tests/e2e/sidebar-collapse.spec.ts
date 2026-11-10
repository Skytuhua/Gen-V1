import {test, expect, type Page} from '@playwright/test';
import {serveTaskFixture, taskFixture} from './task-interface-fixture';

type MotionWindow = Window & {sidebarAnimations: Animation[]};
const enter = 'cubic-bezier(0.16, 1, 0.3, 1)';
const shell = (page: Page) => page.locator('.app-shell').first();
const sidebar = (page: Page) => shell(page).locator(':scope > .sidebar');
const overlay = (page: Page) => page.locator('.sidebar-collapse-overlay');
const collapse = (page: Page) => sidebar(page).getByRole('button', {name: 'Collapse sidebar', exact: true});
const open = (page: Page) => shell(page).getByRole('button', {name: 'Open sidebar', exact: true});
async function fixture(page: Page, preferences: Record<string, unknown> = {}, monitor = false) {
  await page.emulateMedia({reducedMotion: 'no-preference'});
  await page.addInitScript(() => {
    localStorage.setItem('harness:shell-layout:v1', JSON.stringify({sidebarCollapsed: false, sidebarWidth: 248}));
    const animations: Animation[] = [];
    Object.assign(window, {sidebarAnimations: animations});
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const animation = animate.call(this, frames, options);
      if (this.closest('.sidebar-collapse-overlay')) {
        animations.push(animation);
        animation.pause(); animation.currentTime = 0;
      }
      return animation;
    };
  });
  const snapshot = taskFixture({root: 'text', elements: {text: {type: 'Text', props: {text: 'Sidebar geometry fixture'}}}});
  snapshot.settings = {theme: 'dark', modelId: 'test/model', preferences: {showUsageFooter: false, ...preferences}};
  await serveTaskFixture(page, snapshot);
  await page.route('**/api/shell/navigation?*', route => route.fulfill({json: {
    sequence: 1, total: 1, items: snapshot.threads, nextCursor: null, order: 'created-desc',
    stats: {pinned: 0, working: 0, waiting: 0, settled: 0, minOrder: 0, maxOrder: 0},
  }}));
  await page.route('**/api/plugins', route => route.fulfill({json: {plugins: []}}));
  if (monitor) {
    await page.route('**/api/workspace', route => route.fulfill({json: {projects: [], state: {
      version: 1, revision: 1, activeCanvasId: 'all-agents',
      canvases: [{id: 'all-agents', name: 'All Agents', preset: 'all-agents', panels: [], viewport: {x: 0, y: 0, zoom: 1}}],
      profiles: [], disabledKinds: [], integrations: {},
    }}}));
    await page.route('**/api/agents**', route => route.fulfill({json: {
      authority: 'personal', scopeKey: 'sidebar-fixture', sequence: 1, items: [], ancestors: [], nextCursor: null,
    }}));
  }
  await page.goto('/');
  await expect(collapse(page)).toBeVisible();
  await expect(sidebar(page).getByRole('button', {name: 'Source-bound task fixture Ready', exact: true})).toBeVisible();
}
async function motions(page: Page) {
  return page.evaluate(() => (window as unknown as MotionWindow).sidebarAnimations.map(animation => ({
    id: animation.id, state: animation.playState, duration: animation.effect!.getTiming().duration,
    easing: animation.effect!.getTiming().easing,
    frames: (animation.effect as KeyframeEffect).getKeyframes().map(frame => ({opacity: frame.opacity, transform: frame.transform})),
  })));
}
async function finish(page: Page) {
  await page.evaluate(() => (window as unknown as MotionWindow).sidebarAnimations.at(-1)!.finish());
  await expect(overlay(page)).toHaveCount(0);
}
async function bounds(page: Page) {
  return shell(page).locator(':scope > .workspace-layout-workarea, :scope > .workspace-host-main').evaluate(node => {
    const {x, width} = node.getBoundingClientRect(); return {x, width};
  });
}
async function noLayoutTween(page: Page) {
  const live = await sidebar(page).evaluate(node => ({transition: getComputedStyle(node).transitionProperty, animations: node.getAnimations().length}));
  expect(live.animations).toBe(0);
  expect(live.transition).not.toMatch(/\b(all|width|flex-basis|padding(?:-[a-z]+)?)\b/);
  expect(await shell(page).evaluate(node => node.getAnimations({subtree: true}).flatMap(animation => {
    const frames = (animation.effect as KeyframeEffect).getKeyframes();
    return frames.flatMap(frame => Object.keys(frame).filter(key => /^(width|flexBasis|padding.*)$/.test(key)));
  }))).toEqual([]);
  expect(await sidebar(page).locator('.thread-list').evaluate(node => node.getAnimations().length)).toBe(0);
}

for (const width of [768, 1024, 1440]) {
  test(`pointer geometry commits once; only the inert clipped copy tweens at ${width}`, async ({page}, info) => {
    await page.setViewportSize({width, height: 1000}); await fixture(page);
    const expanded = await bounds(page);
    for (const closed of [true, false]) {
      await (closed ? collapse(page) : open(page)).click();
      await expect(shell(page)).toHaveAttribute('data-sidebar-collapsed', String(closed));
      const committed = await bounds(page);
      expect(committed.width).toBe(expanded.width + (closed ? 248 : 0));
      expect(committed.x).toBe(expanded.x - (closed ? 248 : 0));
      await noLayoutTween(page);
      await expect(sidebar(page)).toHaveCSS('width', closed ? '0px' : '248px');
      await expect(sidebar(page)).toHaveCSS('visibility', closed ? 'hidden' : 'visible');
      await expect(overlay(page)).toHaveAttribute('inert', '');
      await expect(overlay(page)).toHaveAttribute('aria-hidden', 'true');
      await expect(overlay(page)).toHaveCSS('overflow', 'hidden');
      await expect(overlay(page)).toHaveCSS('pointer-events', 'none');
      await expect(page.getByRole('complementary', {name: 'Thread navigation', exact: true})).toHaveCount(closed ? 0 : 1);
      expect(await overlay(page).locator('[id]').count()).toBe(0);
      const motion = (await motions(page)).at(-1)!;
      expect(motion).toMatchObject({id: closed ? 'sidebar-collapse-close' : 'sidebar-collapse-open', duration: closed ? 180 : 220, easing: enter});
      expect(motion.frames).toEqual(closed ? [{opacity: '1', transform: 'translateX(0px)'}, {opacity: '0', transform: 'translateX(-4px)'}] : [{opacity: '0', transform: 'translateX(-4px)'}, {opacity: '1', transform: 'translateX(0px)'}]);
      for (const fraction of [0, .5, 1]) {
        await page.evaluate(fraction => {
          const animation = (window as unknown as MotionWindow).sidebarAnimations.at(-1)!;
          animation.currentTime = Number(animation.effect!.getTiming().duration) * fraction;
        }, fraction);
        expect(await bounds(page)).toEqual(committed);
        await expect(overlay(page)).toHaveCSS('width', '248px');
        if (width === 1440) await page.screenshot({path: info.outputPath(`${closed ? 'close' : 'open'}-${fraction * 100}.png`)});
      }
      await info.attach(closed ? 'close-timing' : 'open-timing', {body: JSON.stringify({width, ...motion}), contentType: 'application/json'});
      await finish(page);
      expect(await bounds(page)).toEqual(committed);
      await expect(sidebar(page)).toHaveCSS('opacity', '1');
    }
  });

  test(`pointer reversal retargets the current visual in both directions at ${width}`, async ({page}) => {
    await page.setViewportSize({width, height: 1000}); await fixture(page);
    await collapse(page).click();
    for (const closed of [false, true, false]) {
      const before = await page.evaluate(() => {
        const animation = (window as unknown as MotionWindow).sidebarAnimations.at(-1)!;
        animation.currentTime = 24;
        const style = getComputedStyle((animation.effect as KeyframeEffect).target!);
        return {opacity: style.opacity, transform: style.transform};
      });
      await (closed ? collapse(page) : open(page)).click();
      const records = await motions(page);
      expect(records.at(-2)!.state).toBe('idle');
      expect(records.at(-1)!.frames[0]).toEqual(before);
      expect(records.at(-1)!.duration).toBe(closed ? 180 : 220);
      await expect(overlay(page)).toHaveCount(1);
      expect(await overlay(page).locator('.sidebar').evaluate(node => node.getAnimations().length)).toBe(1);
      await noLayoutTween(page);
    }
    await finish(page);
    await expect(sidebar(page)).not.toHaveAttribute('inert');
  });

  test(`keyboard buttons, shortcuts and search settle immediately with focus at ${width}`, async ({page}) => {
    await page.setViewportSize({width, height: 1000}); await fixture(page);
    await collapse(page).focus(); await page.keyboard.press('Enter');
    await expect(open(page)).toBeFocused();
    await page.keyboard.press('Space');
    await expect(sidebar(page).getByRole('textbox', {name: 'Search threads'})).toBeFocused();
    await page.keyboard.press('Shift+Tab'); await expect(collapse(page)).toBeFocused();
    await page.keyboard.press('Control+b'); await expect(open(page)).toBeFocused();
    await page.keyboard.press('Control+k');
    await expect(sidebar(page).getByRole('textbox', {name: 'Search threads'})).toBeFocused();
    await expect(overlay(page)).toHaveCount(0); expect(await motions(page)).toEqual([]);
    await noLayoutTween(page);
    // A keyboard action also releases a running pointer handoff.
    await collapse(page).click(); await page.keyboard.press('Control+b');
    await expect(shell(page)).toHaveAttribute('data-sidebar-collapsed', 'false');
    await expect(overlay(page)).toHaveCount(0);
    expect((await motions(page)).map(value => value.state)).toEqual(['idle']);
    await expect(sidebar(page)).toHaveCSS('opacity', '1');
  });
}

test('pointer handoffs finish naturally and release the snapshot without moving the conversation', async ({page}, info) => {
  await fixture(page);
  for (const closed of [true, false]) {
    await (closed ? collapse(page) : open(page)).click();
    const measured = await page.evaluate(async () => {
      const animation = (window as unknown as MotionWindow).sidebarAnimations.at(-1)!;
      const conversation = document.querySelector('.conversation')!;
      const frames: {x: number; width: number}[] = [];
      const start = performance.now();
      animation.play();
      while (animation.playState === 'running' || animation.pending) {
        const {x, width} = conversation.getBoundingClientRect(); frames.push({x, width});
        await new Promise(requestAnimationFrame);
      }
      return {elapsed: performance.now() - start, duration: animation.effect!.getTiming().duration, frames};
    });
    expect(measured.duration).toBe(closed ? 180 : 220);
    expect(measured.frames.length).toBeGreaterThan(1);
    for (const frame of measured.frames) expect(frame).toEqual(measured.frames[0]);
    await expect(overlay(page)).toHaveCount(0); await expect(sidebar(page)).toHaveCSS('opacity', '1');
    await info.attach(closed ? 'natural-close' : 'natural-open', {body: JSON.stringify(measured), contentType: 'application/json'});
  }
});

for (const width of [1024, 1440]) {
  for (const policy of ['os', 'reduced', 'off', 'panels', 'duration'] as const) {
    test(`${policy} motion policy makes pointer toggles immediate at ${width}`, async ({page}) => {
      await page.setViewportSize({width, height: 1000});
      await fixture(page, policy === 'panels' ? {panelAnimations: false} : policy === 'duration' ? {motionDuration: 0} : {});
      if (policy === 'os') await page.emulateMedia({reducedMotion: 'reduce'});
      else if (policy === 'reduced' || policy === 'off') await page.evaluate(policy => {document.documentElement.dataset.motion = policy;}, policy);
      const expanded = await bounds(page);
      await collapse(page).click(); await expect(sidebar(page)).toHaveCSS('width', '0px');
      expect((await bounds(page)).width).toBe(expanded.width + 248);
      await open(page).click(); expect(await bounds(page)).toEqual(expanded);
      await expect(overlay(page)).toHaveCount(0); expect(await motions(page)).toEqual([]);
      await noLayoutTween(page);
    });
  }
}

for (const width of [1024, 1440]) test(`WorkspaceHost uses the same pointer handoff and immediate keyboard path at ${width}`, async ({page}) => {
  await page.setViewportSize({width, height: 1000}); await fixture(page, {}, true);
  await expect(shell(page)).toHaveClass(/workspace-host/);
  const expanded = await bounds(page);
  await collapse(page).click(); expect((await bounds(page)).width).toBe(expanded.width + 248);
  expect((await motions(page)).at(-1)).toMatchObject({duration: 180, easing: enter}); await finish(page);
  await open(page).click(); expect(await bounds(page)).toEqual(expanded);
  expect((await motions(page)).at(-1)).toMatchObject({duration: 220, easing: enter}); await finish(page);
  await collapse(page).focus(); await page.keyboard.press('Enter'); await expect(open(page)).toBeFocused();
  await page.keyboard.press('Control+k'); await expect(sidebar(page).getByRole('textbox', {name: 'Search threads'})).toBeFocused();
  await expect(overlay(page)).toHaveCount(0); expect(await motions(page)).toHaveLength(2);
  await noLayoutTween(page);
});

test('inherited tokens and motion speed control both directions', async ({page}) => {
  await fixture(page);
  await shell(page).evaluate(node => {
    const style = (node as HTMLElement).style;
    style.setProperty('--ui-motion-panel-enter', '.3s'); style.setProperty('--ui-motion-panel-exit', '250ms');
    style.setProperty('--ui-ease-enter', 'linear'); document.documentElement.style.setProperty('--motion-speed', '1.25');
  });
  await collapse(page).click(); expect((await motions(page)).at(-1)).toMatchObject({duration: 200, easing: 'linear'}); await finish(page);
  await open(page).click(); expect((await motions(page)).at(-1)).toMatchObject({duration: 240, easing: 'linear'}); await finish(page);
});

for (const policy of ['os', 'reduced', 'off', 'panels', 'resize'] as const) {
  test(`a running pointer tween settles when ${policy} changes`, async ({page}) => {
    await fixture(page); await collapse(page).click(); await finish(page); await open(page).click();
    if (policy === 'os') await page.emulateMedia({reducedMotion: 'reduce'});
    else if (policy === 'resize') await page.setViewportSize({width: 1024, height: 1000});
    else await page.evaluate(policy => {
      if (policy === 'panels') document.querySelector<HTMLElement>('.app-shell')!.dataset.panelAnimations = 'false';
      else document.documentElement.dataset.motion = policy;
    }, policy);
    await expect(overlay(page)).toHaveCount(0); await expect(sidebar(page)).toHaveCSS('opacity', '1');
    expect((await motions(page)).at(-1)!.state).toBe('idle'); await noLayoutTween(page);
  });
}
