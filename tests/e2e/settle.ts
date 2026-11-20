import type { Page } from '@playwright/test';

// Samples a probe once per animation frame for `ms` and returns the distinct
// JSON signatures observed. A single signature proves the probed state never
// changed during the window; multiple signatures localize when it did.
// The window is the wall clock, never extended to reach a frame count: a starved
// host that renders too few frames inside it fails loudly instead of quietly
// taking three times as long to prove less.
export const quiescent = async (page: Page, ms: number, probe: () => unknown | Promise<unknown>) => {
  const seen = new Set<string>(); const end = Date.now() + ms;
  let samples = 0;
  do {
    seen.add(JSON.stringify(await probe())); samples++;
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  } while (Date.now() < end);
  const floor = Math.max(2, Math.round(ms / 100));
  if (samples < floor) throw new Error(`Only ${samples} animation frames inside ${ms}ms (need ${floor}); this host is too contended for the measurement to mean anything.`);
  return [...seen];
};

// The reshape defect has a signature that survives frame coalescing: a plateau
// (the fade finished, height unchanged) followed by un-animated travel. Four pixels
// is the tolerance for rounding in a pass; on the step fixture a real late drop is
// ~320px, so the two cases separate cleanly. A slow host renders fewer frames, but
// never fabricates a plateau followed by a jump.
const DISCONTINUOUS_TRAVEL_PX = 4;
export const plateauThenJump = (samples: readonly { h: number }[]) => {
  const heights = samples.map(sample => sample.h), travel = Math.max(...heights) - Math.min(...heights);
  let plateau = 0, jump = 0;
  for (let index = 1; index < heights.length; index++) {
    const step = Math.abs(heights[index]! - heights[index - 1]!);
    if (step < .5) plateau++;
    else { if (plateau >= 6 && step > DISCONTINUOUS_TRAVEL_PX) jump = Math.max(jump, step); plateau = 0; }
  }
  return { travel, jump, distinct: new Set(heights.map(height => Math.round(height))).size };
};
