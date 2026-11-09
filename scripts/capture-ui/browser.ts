import type { Page } from '@playwright/test';
import type { Motion } from './helpers';
export async function collect(page: Page, screen: string, state: string, width: number, tracked = false): Promise<Motion[]> {
  return page.evaluate(({ screen, state, width, tracked }) => {
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
    const animations = tracked ? [...((window as unknown as { captureTracked?: Set<Animation> }).captureTracked ?? [])] : document.getAnimations();
    (window as unknown as { captureAnimations: Animation[] }).captureAnimations = animations;
    return animations.map(a => {
      const effect = a.effect as KeyframeEffect | null, timing = effect?.getTiming(), frames = effect?.getKeyframes() ?? [];
      return { screen, state, width, selector: effect?.target ? path(effect.target) : 'html', type: a.constructor.name, animationName: a instanceof CSSAnimation ? a.animationName : '', transitionProperty: a instanceof CSSTransition ? a.transitionProperty : '', properties: [...new Set(frames.flatMap(f => Object.keys(f).filter(k => !['offset', 'computedOffset', 'easing', 'composite'].includes(k))))], duration: typeof timing?.duration === 'number' ? timing.duration : 0, delay: timing?.delay ?? 0, easing: timing?.easing ?? 'linear', iterations: timing?.iterations === Infinity ? 'Infinity' : timing?.iterations ?? 1, fill: timing?.fill ?? 'none', keyframes: frames };
    });
  }, { screen, state, width, tracked });
}
export async function frameStrip(page: Page, tile: Page, index: number, output: string) {
  const frames: string[] = [];
  // Freeze every animation so unrelated motion cannot drift between frames.
  await page.evaluate(() => document.getAnimations().forEach(a => a.pause()));
  for (const fraction of [0, 0.5, 1]) {
    const box = await page.evaluate(({ index, fraction }) => {
      const animation = (window as unknown as { captureAnimations: Animation[] }).captureAnimations[index];
      const effect = animation.effect as KeyframeEffect;
      const timing = effect.getTiming();
      const iterations = Number.isFinite(timing.iterations) ? timing.iterations ?? 1 : 1;
      animation.currentTime = (timing.delay ?? 0) + Number(timing.duration) * iterations * fraction;
      const r = effect.target?.getBoundingClientRect();
      return r ? { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: Math.min(innerWidth - Math.max(0, r.x - 8), r.width + 16), height: Math.min(innerHeight - Math.max(0, r.y - 8), r.height + 16) } : null;
    }, { index, fraction });
    if (!box || box.width <= 0 || box.height <= 0) throw Error('Animation target is outside viewport or has no box');
    frames.push((await page.screenshot({ clip: box, animations: 'allow' })).toString('base64'));
  }
  await tile.setContent(`<html><body style="margin:0;background:#222;color:white;display:flex;align-items:flex-start">${frames.map((f, i) => `<div style="flex:1;min-width:0"><p>${i * 50}%</p><img style="max-width:100%" src="data:image/png;base64,${f}"></div>`).join('')}</body></html>`);
  await tile.locator('img').evaluateAll(images => Promise.all(images.map(img => (img as HTMLImageElement).decode())));
  await tile.screenshot({ path: output, fullPage: true });
}
