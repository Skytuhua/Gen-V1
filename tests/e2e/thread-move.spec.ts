import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const easeMove = 'cubic-bezier(0.4, 0, 0.2, 1)';
type MoveRecord = { id: string; duration: number; easing: string; delay: number; frames: ComputedKeyframe[]; y: number; observed: boolean };
type MoveWindow = Window & { threadMoves: MoveRecord[]; holdThreadMoves: boolean };
const row = (page: Page, id: string) => page.locator(`.sidebar-thread-row[data-thread-id="${id}"]`);
const records = (page: Page) => page.evaluate(() => (window as unknown as MoveWindow).threadMoves);
const order = (page: Page) => page.locator('.thread-flat-list>.sidebar-thread-row').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.threadId));
async function load(page: Page, query = '', hold = true) {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(hold => {
    const state = window as unknown as MoveWindow;
    state.threadMoves = []; state.holdThreadMoves = hold;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const animation = animate.call(this, frames, options);
      if (this.matches('.sidebar-thread-row')) {
        if (state.holdThreadMoves) animation.pause();
        const timing = animation.effect!.getTiming();
        state.threadMoves.push({ id: (this as HTMLElement).dataset.threadId!, duration: Number(timing.duration), easing: timing.easing!,
          delay: timing.delay!, frames: (animation.effect as KeyframeEffect).getKeyframes(), y: this.getBoundingClientRect().top,
          observed: this.getAnimations().includes(animation) });
      }
      return animation;
    };
  }, hold);
  const path = encodeURI('/@fs/' + resolve('tests/e2e/thread-move-fixture.tsx').replaceAll('\\', '/'));
  await page.route('**/thread-move-fixture?*', route => route.fulfill({ contentType: 'text/html', body: `<html data-theme="dark"><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${path}');</script></body></html>` }));
  await page.goto(`/thread-move-fixture?${query}`);
  await expect(row(page, 'thread-4')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}
async function move(page: Page, id: string, edge: 'top' | 'bottom', key?: 'Enter' | 'Space') {
  const trigger = page.getByRole('button', { name: `Options for Thread ${id.slice('thread-'.length)}`, exact: true });
  // Pointer-open + keyboard-select must still settle immediately.
  await trigger.click();
  const item = page.getByRole('menuitem', { name: `Move to ${edge}`, exact: true });
  if (key) { await item.focus(); await page.keyboard.press(key); }
  else await item.click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(trigger).toBeFocused();
}
async function finish(page: Page) {
  await page.locator('.sidebar-thread-row').evaluateAll(nodes => nodes.forEach(node => node.getAnimations().forEach(animation => animation.finish())));
  await expect.poll(() => page.locator('.sidebar-thread-row').evaluateAll(nodes => nodes.flatMap(node => node.getAnimations()).length)).toBe(0);
  await expect(page.locator('[data-thread-moving]')).toHaveCount(0);
}
async function immediate(page: Page) {
  expect(await records(page)).toEqual([]);
  expect(await page.locator('.sidebar-thread-row').evaluateAll(nodes => nodes.every(node => !node.getAnimations().length && getComputedStyle(node).transform === 'none'))).toBe(true);
}

for (const width of [1024, 1440]) {
  test(`pointer moves FLIP only affected visible rows for 180ms with no stagger at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); await load(page, 'bounds');
    const before = await page.locator('.sidebar-thread-row').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [(node as HTMLElement).dataset.threadId!, node.getBoundingClientRect().top])));
    await move(page, 'thread-4', 'top');
    expect(await order(page)).toEqual(['thread-4', 'thread-1', 'thread-2', 'thread-3', 'thread-5', 'thread-6']);
    const moves = await records(page);
    expect(moves.map(item => item.id).sort()).toEqual(['thread-1', 'thread-2', 'thread-3', 'thread-4']);
    for (const item of moves) {
      expect(item).toMatchObject({ duration: 180, easing: easeMove, delay: 0, observed: true });
      expect(item.y).toBeCloseTo(before[item.id], 1);
      expect(item.frames).toHaveLength(2);
      expect(item.frames.every(frame => Object.keys(frame).every(key => ['offset', 'computedOffset', 'easing', 'composite', 'transform'].includes(key)))).toBe(true);
      expect(item.frames[1].transform).toBe('translate(0px, 0px)');
    }
    const live = await page.locator('.sidebar-thread-row').evaluateAll(nodes => nodes.flatMap(node => node.getAnimations().map(animation => ({
      id: (node as HTMLElement).dataset.threadId, time: animation.currentTime, delay: animation.effect!.getTiming().delay,
    }))));
    expect(live).toHaveLength(4); expect(live.every(item => item.time === 0 && item.delay === 0)).toBe(true);
    await finish(page);
    await page.evaluate(() => { (window as unknown as MoveWindow).threadMoves = []; });
    await move(page, 'thread-4', 'bottom');
    expect((await order(page)).at(-1)).toBe('thread-4');
    expect((await records(page)).map(item => item.id).sort()).toEqual(Array.from({ length: 6 }, (_, i) => `thread-${i + 1}`));
    await finish(page);
    expect(await page.locator('.sidebar-thread-row').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).transform === 'none'))).toBe(true);
    console.log(`thread-move ${width}: affected rows 180ms / ${easeMove}, delay 0ms`);
  });

  for (const key of ['Enter', 'Space'] as const) test(`${key} selection changes order immediately at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); await load(page);
    await move(page, 'thread-4', 'top', key); expect((await order(page))[0]).toBe('thread-4');
    await move(page, 'thread-4', 'bottom', key); expect((await order(page)).at(-1)).toBe('thread-4');
    await immediate(page);
  });

  test(`pointer no-ops, background sorting and restoration do not animate at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); await load(page);
    await move(page, 'thread-1', 'top'); await move(page, 'thread-6', 'bottom'); await immediate(page);
    await page.getByRole('button', { name: 'Background sort', exact: true }).click();
    expect((await order(page))[0]).toBe('thread-6'); await immediate(page);
    await page.getByRole('button', { name: 'Restore sidebar', exact: true }).click();
    expect((await order(page))[0]).toBe('thread-6'); await immediate(page);
  });

  for (const policy of ['os', 'reduced', 'off'] as const) test(`${policy} motion policy settles moves immediately at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); await load(page);
    if (policy === 'os') await page.emulateMedia({ reducedMotion: 'reduce' });
    else await page.evaluate(policy => { document.documentElement.dataset.motion = policy; }, policy);
    await move(page, 'thread-4', 'top'); expect((await order(page))[0]).toBe('thread-4');
    await move(page, 'thread-4', 'bottom'); expect((await order(page)).at(-1)).toBe('thread-4'); await immediate(page);
  });
}

test('delayed success retargets running rows from their current visual positions', async ({ page }) => {
  await load(page, 'deferred');
  await move(page, 'thread-4', 'top'); await immediate(page);
  await page.getByRole('button', { name: 'Publish move', exact: true }).click();
  await expect.poll(async () => (await records(page)).length).toBe(4);
  await page.locator('.sidebar-thread-row').evaluateAll(nodes => nodes.forEach(node => node.getAnimations().forEach(animation => { animation.currentTime = 50; })));
  await move(page, 'thread-4', 'bottom');
  // The first transition continues while the next host publication is pending.
  await page.locator('.sidebar-thread-row').evaluateAll(nodes => nodes.forEach(node => node.getAnimations().forEach(animation => { animation.currentTime = 110; })));
  const before = await page.locator('.sidebar-thread-row').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [(node as HTMLElement).dataset.threadId!, node.getBoundingClientRect().top])));
  await page.getByRole('button', { name: 'Publish move', exact: true }).click();
  await expect.poll(async () => (await records(page)).length).toBe(10);
  for (const item of (await records(page)).slice(4)) expect(item.y).toBeCloseTo(before[item.id], 1);
  expect(await page.locator('.sidebar-thread-row').evaluateAll(nodes => nodes.every(node => node.getAnimations().length <= 1))).toBe(true);
  await finish(page); expect((await order(page)).at(-1)).toBe('thread-4');
});

test('failed moves and nonmanual sorting never arm a later publication', async ({ page }) => {
  await load(page, 'deferred'); await move(page, 'thread-4', 'top');
  await page.getByRole('button', { name: 'Reject move', exact: true }).click();
  await page.getByRole('button', { name: 'Background sort', exact: true }).click(); await immediate(page);
  await load(page, 'recent'); await move(page, 'thread-4', 'top');
  expect((await order(page))[0]).toBe('thread-1'); await immediate(page);
});

test('offscreen and folded rows are excluded from a move', async ({ page }) => {
  await load(page, 'overflow');
  const visible = await page.locator('.sidebar-thread-row').evaluateAll(nodes => nodes.filter(node => {
    const rect = node.getBoundingClientRect(), clip = node.closest('.thread-list')!.getBoundingClientRect();
    return !node.closest('[inert],[aria-hidden="true"]') && rect.bottom > clip.top && rect.top < clip.bottom;
  }).map(node => (node as HTMLElement).dataset.threadId));
  await move(page, 'thread-4', 'top');
  expect((await records(page)).map(item => item.id).sort()).toEqual(['thread-1', 'thread-2', 'thread-3', 'thread-4']);
  expect((await records(page)).every(item => visible.includes(item.id))).toBe(true);
  await finish(page);
});

test('moving a row out of the viewport still animates displaced visible rows', async ({ page }) => {
  await load(page, 'overflow');
  await move(page, 'thread-1', 'bottom');
  expect((await order(page)).at(-1)).toBe('thread-1');
  const moves = await records(page);
  expect(moves.length).toBeGreaterThan(0);
  expect(moves.some(item => ['thread-1', 'pinned', 'folded'].includes(item.id))).toBe(false);
  const affectedVisible = await page.locator('.thread-flat-list>.sidebar-thread-row').evaluateAll(nodes => nodes.filter(node => {
    const rect = node.getBoundingClientRect(), transform = getComputedStyle(node).transform;
    const y = rect.top - (transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42);
    const clip = node.closest('.thread-list')!.getBoundingClientRect();
    return y + rect.height > clip.top && y < clip.bottom;
  }).map(node => (node as HTMLElement).dataset.threadId));
  expect(moves.map(item => item.id)).toEqual(affectedVisible);
  await finish(page);
});

test('keyboard activation interrupts a pointer move immediately', async ({ page }) => {
  await load(page); await move(page, 'thread-4', 'top');
  await move(page, 'thread-4', 'bottom', 'Enter');
  expect((await order(page)).at(-1)).toBe('thread-4'); expect(await records(page)).toHaveLength(4);
  expect(await page.locator('.sidebar-thread-row').evaluateAll(nodes => nodes.every(node => !node.getAnimations().length && getComputedStyle(node).transform === 'none'))).toBe(true);
});

for (const policy of ['os', 'reduced', 'off'] as const) test(`switching to ${policy} cancels an active move`, async ({ page }) => {
  await load(page); await move(page, 'thread-4', 'top');
  if (policy === 'os') await page.emulateMedia({ reducedMotion: 'reduce' });
  else await page.evaluate(policy => { document.documentElement.dataset.motion = policy; }, policy);
  await expect.poll(() => page.locator('.sidebar-thread-row').evaluateAll(nodes => nodes.flatMap(node => node.getAnimations()).length)).toBe(0);
  expect((await order(page))[0]).toBe('thread-4');
});

test('row moves resolve inherited tokens and the selected motion speed', async ({ page }) => {
  await load(page);
  await page.locator('.sidebar').evaluate(node => {
    (node as HTMLElement).style.setProperty('--ui-motion-insert', '.3s');
    (node as HTMLElement).style.setProperty('--ui-ease-move', 'linear');
    document.documentElement.style.setProperty('--motion-speed', '1.25');
  });
  await move(page, 'thread-4', 'top');
  expect((await records(page)).every(item => item.duration === 240 && item.easing === 'linear' && item.delay === 0)).toBe(true);
});

test('settled moves clean up without a retained transform or animation', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1000 }); await load(page, '', false);
  await move(page, 'thread-4', 'top'); expect((await order(page))[0]).toBe('thread-4');
  await expect.poll(() => page.locator('.sidebar-thread-row').evaluateAll(nodes => nodes.flatMap(node => node.getAnimations()).length)).toBe(0);
  expect(await records(page)).toHaveLength(4);
  expect(await row(page, 'thread-4').evaluate(node => getComputedStyle(node).transform)).toBe('none');
});
