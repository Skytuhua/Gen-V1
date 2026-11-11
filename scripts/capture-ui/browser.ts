import type { Frame, Page } from '@playwright/test';
import { frameTag, paddedClip, type Motion } from './helpers';
import { withDeadline } from './runtime-helpers';
const stripTargets = new WeakMap<Page, { frame: Frame; index: number }[]>();
function tag(frame: Frame) {
  const indices: number[] = [];
  for (let child = frame, parent = child.parentFrame(); parent; child = parent, parent = child.parentFrame()) indices.unshift(parent.childFrames().indexOf(child));
  return frameTag(indices, frame.url());
}
export async function collect(page: Page, screen: string, state: string, width: number, tracked = false): Promise<Motion[]> {
  const batches = await Promise.all(page.frames().map(async frame => {
    const records = await withDeadline(frame.evaluate(({ screen, state, width, tracked, frame }) => {
    function path(el: Element): string {
      if (el.id) return `#${CSS.escape(el.id)}`;
      const parts: string[] = [];
      for (let node: Element | null = el; node && parts.length < 8; node = node.parentElement) {
        const parent: Element | null = node.parentElement;
        parts.unshift(`${node.localName}:nth-child(${parent ? [...parent.children].indexOf(node) + 1 : 1})`);
        if (node === document.body) break;
      }
      return parts.join(' > ');
    }
    const animations = (tracked ? [...((window as unknown as { captureTracked?: Set<Animation> }).captureTracked ?? [])] : document.getAnimations()).filter(a => a.effect instanceof KeyframeEffect && a.effect.target?.isConnected && a.effect.target.getClientRects().length>0 && getComputedStyle(a.effect.target).visibility!=='hidden' && a.playState !== 'idle');
    (window as unknown as { captureAnimations: Animation[] }).captureAnimations = animations;
    return animations.map(a => {
      const effect = a.effect as KeyframeEffect | null, timing = effect?.getTiming(), frames = effect?.getKeyframes() ?? [];
      return { screen, state, width, frame, selector: effect?.target ? path(effect.target) : 'html', type: a.constructor.name, animationName: a instanceof CSSAnimation ? a.animationName : '', transitionProperty: a instanceof CSSTransition ? a.transitionProperty : '', properties: [...new Set(frames.flatMap(f => Object.keys(f).filter(k => !['offset', 'computedOffset', 'easing', 'composite'].includes(k))))], duration: typeof timing?.duration === 'number' ? timing.duration : 0, delay: timing?.delay ?? 0, easing: timing?.easing ?? 'linear', iterations: timing?.iterations === Infinity ? 'Infinity' : timing?.iterations ?? 1, fill: timing?.fill ?? 'none', keyframes: frames };
    });
    }, { screen, state, width, tracked, frame: tag(frame) }), 5000, `Motion collection (${tag(frame)})`);
    return {frame, records};
  }));
  stripTargets.set(page, batches.flatMap(({frame, records}) => records.map((_, index) => ({frame, index}))));
  return batches.flatMap(batch => batch.records);
}
export async function frameStrip(page: Page, tile: Page, index: number, output: string) {
  const target = stripTargets.get(page)?.[index];
  if (!target) throw Error('Animation strip has no frame-local target');
  const { frame, index: localIndex } = target;
  const frames: string[] = [];
  // Scroll an existing target into view before clipping. Hidden/detached/cancelled effects
  // are not document animations; collect() filters those rather than inventing pixels.
  const handle = await frame.evaluateHandle(index => (window as unknown as {captureAnimations: Animation[]}).captureAnimations[index].effect instanceof KeyframeEffect ? ((window as unknown as {captureAnimations: Animation[]}).captureAnimations[index].effect as KeyframeEffect).target : null, localIndex);
  const element = handle.asElement();
  if (!element) throw Error('Animation target has no screenshot element');
  await element.scrollIntoViewIfNeeded({timeout: 4000});
  // Freeze every animation so unrelated motion cannot drift between frames.
  await Promise.all(page.frames().map(frame => frame.evaluate(() => {
    const tracked = (window as unknown as { captureAnimations?: Animation[] }).captureAnimations ?? [];
    new Set([...document.getAnimations(), ...tracked]).forEach(a => a.pause());
  })));
  try {
  for (const fraction of [0, 0.5, 1]) {
    await frame.evaluate(({ index, fraction }) => {
      const animation = (window as unknown as { captureAnimations: Animation[] }).captureAnimations[index];
      const effect = animation.effect as KeyframeEffect;
      const timing = effect.getTiming();
      const iterations = Number.isFinite(timing.iterations) ? timing.iterations ?? 1 : 1;
      animation.currentTime = (timing.delay ?? 0) + Number(timing.duration) * iterations * fraction;
    }, { index: localIndex, fraction });
    // boundingBox translates through sandboxed/nested iframes into the main
    // viewport. Padding also preserves zero-height endpoints of reveal effects.
    const bounds = await element.boundingBox(), viewport = page.viewportSize();
    const clip = bounds && viewport && paddedClip(bounds, viewport);
    if (!clip) throw Error('Animation target is outside the main viewport or has no screenshot box');
    frames.push((await page.screenshot({ clip, animations: 'allow', timeout: 5000 })).toString('base64'));
  }
  await tile.setContent(`<html><body style="margin:0;background:#222;color:white;display:flex;align-items:flex-start">${frames.map((f, i) => `<div style="flex:1;min-width:0"><p>${i * 50}%</p><img style="max-width:100%" src="data:image/png;base64,${f}"></div>`).join('')}</body></html>`);
  await tile.locator('img').evaluateAll(images => Promise.all(images.map(img => (img as HTMLImageElement).decode())));
  await tile.screenshot({ path: output, fullPage: true });
  } finally { await handle.dispose(); }
}
