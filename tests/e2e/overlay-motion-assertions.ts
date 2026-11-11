import {expect, type Locator, type Page} from '@playwright/test';

export async function pauseNextEntry(page: Page, selector: string) {
  await page.evaluate(selector => {
    // Catch the first styled frame, before Playwright actionability can wait out entry.
    const observer = new MutationObserver(() => {
      const node = document.querySelector(selector);
      if (!node) return;
      for (const animation of node.getAnimations()) animation.pause();
      observer.disconnect();
    });
    observer.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['data-state']});
  }, selector);
}

export async function expectOpaqueEntry(card: Locator) {
  const entry = await card.evaluate(node => {
    const animations = node.getAnimations();
    for (const animation of animations) animation.pause();
    const samples = [0, 1, 40, 80, 120, 159, 160].map(time => {
      for (const animation of animations) animation.currentTime = time;
      const style = getComputedStyle(node);
      return {time, opacity: style.opacity, background: style.backgroundColor};
    });
    const durations = animations.map(animation => animation.effect!.getTiming().duration);
    const opacities = animations.flatMap(animation => (animation.effect as KeyframeEffect).getKeyframes().map(frame => frame.opacity ?? '1'));
    for (const animation of animations) animation.finish();
    const style = getComputedStyle(node);
    return {durations, opacities, samples, settled: {opacity: style.opacity, background: style.backgroundColor}};
  });
  expect(entry.durations).toEqual([160]);
  expect(entry.opacities.every(opacity => opacity === '1')).toBe(true);
  expect(entry.settled).toEqual({opacity: '1', background: 'rgb(15, 15, 15)'});
  for (const {time, ...sample} of entry.samples) expect(sample, `entry at ${time}ms`).toEqual(entry.settled);
}

export async function expectVisibleKeyboardFocus(trigger: Locator) {
  await expect(trigger).toBeFocused();
  expect(await trigger.evaluate(node => {
    const style = getComputedStyle(node);
    return node.matches(':focus-visible') && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
  })).toBe(true);
}
