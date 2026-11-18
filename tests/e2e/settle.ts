import type { Page } from '@playwright/test';

// Samples a probe once per animation frame for `ms` and returns the distinct
// JSON signatures observed. A single signature proves the probed state never
// changed during the window; multiple signatures localize when it did.
// A starved runner can deliver frames far slower than the window expects, so the
// window alone is not enough: a frame floor keeps the observation count honest
// instead of returning one sample and proving nothing.
export const quiescent = async (page: Page, ms: number, probe: () => unknown | Promise<unknown>) => {
  const seen = new Set<string>(); const end = Date.now() + ms, frames = Math.max(2, Math.round(ms / 16));
  for (let taken = 0; Date.now() < end || taken < frames; taken++) {
    seen.add(JSON.stringify(await probe()));
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  }
  return [...seen];
};

// The reshape defect has a signature that survives frame coalescing: a plateau
// (the fade finished, height unchanged) followed by one jump larger than a fifth of
// the total travel. Interpolated reshaping never produces that pair, however few
// frames a loaded compositor renders.
export const plateauThenJump = (samples: readonly { h: number }[]) => {
  const heights = samples.map(sample => sample.h), travel = Math.max(...heights) - Math.min(...heights);
  let plateau = 0, jump = 0;
  for (let index = 1; index < heights.length; index++) {
    const step = Math.abs(heights[index]! - heights[index - 1]!);
    if (step < .5) plateau++;
    else { if (plateau >= 6 && step > travel * .2) jump = Math.max(jump, step); plateau = 0; }
  }
  return { travel, jump, distinct: new Set(heights.map(height => Math.round(height))).size };
};
