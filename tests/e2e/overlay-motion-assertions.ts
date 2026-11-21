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

// Spec C7: thread hover cards enter on the tooltip contract — opacity 0→1
// plus a 4px settle toward the trigger over --ui-motion-tooltip-enter (160ms).
export async function expectTooltipEntry(card: Locator) {
  const entry = await card.evaluate(node => {
    const animations = node.getAnimations();
    for (const animation of animations) animation.pause();
    const samples = [0, 1, 40, 80, 120, 159, 160].map(time => {
      for (const animation of animations) animation.currentTime = time;
      const style = getComputedStyle(node);
      return {time, opacity: style.opacity, background: style.backgroundColor, transform: style.transform};
    });
    const durations = animations.map(animation => animation.effect!.getTiming().duration);
    const opacities = animations.flatMap(animation => (animation.effect as KeyframeEffect).getKeyframes().map(frame => frame.opacity ?? '1'));
    for (const animation of animations) animation.finish();
    const style = getComputedStyle(node);
    return {durations, opacities, samples, settled: {opacity: style.opacity, background: style.backgroundColor, transform: style.transform}};
  });
  expect(entry.durations).toEqual([160]);
  expect(entry.opacities).toContain('0');
  expect(entry.settled.opacity).toBe('1');
  expect(entry.settled.background).toBe('rgb(15, 15, 15)');
  expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(entry.settled.transform);
  const opacities = entry.samples.map(sample => Number(sample.opacity));
  expect(opacities[0]).toBe(0);
  expect(opacities[opacities.length - 1]).toBe(1);
  expect(opacities.every((value, index) => index === 0 || value >= opacities[index - 1])).toBe(true);
  expect(entry.samples[0].transform).not.toBe('none');
  for (const {time, background} of entry.samples) expect(background, `entry at ${time}ms`).toBe(entry.settled.background);
}

export async function expectVisibleKeyboardFocus(trigger: Locator) {
  await expect(trigger).toBeFocused();
  expect(await trigger.evaluate(node => {
    const style = getComputedStyle(node);
    return node.matches(':focus-visible') && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
  })).toBe(true);
}
