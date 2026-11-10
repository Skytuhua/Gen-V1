import {readFile} from 'node:fs/promises';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {chromium, type Browser} from '@playwright/test';

describe('overlay entry motion', () => {
  let browser: Browser, css: string;
  beforeAll(async () => {
    const paths = ['packages/ui-shell/tokens.css', 'packages/ui-shell/controls.css', 'apps/web/src/styles.css',
      'apps/web/src/shell.css', 'apps/web/src/settings.css', 'apps/web/src/appearance.css',
      'apps/web/src/thread-hover/thread-hover.css', 'apps/web/src/relationship-graph.css'];
    css = (await Promise.all(paths.map(path => readFile(path, 'utf8')))).map(source => source.replace(/@import[^;]+;/g, '')).join('\n');
    browser = await chromium.launch({headless: true, ...(process.platform === 'win32' ? {channel: 'msedge'} : {})});
  });
  afterAll(async () => {await browser?.close();});

  for (const width of [1024, 1440]) it(`keeps cards opaque when focus interrupts an exit at ${width}px`, async () => {
    const page = await browser.newPage({viewport: {width, height: 1000}});
    try {
      await page.setContent('<html data-theme="dark"><body></body></html>');
      await page.addStyleTag({content: css});
      const entries = await page.evaluate(() => ['thread-hover-card', 'task-node-popover'].map(className => {
        const card = document.createElement('div');
        card.className = className;
        card.dataset.state = 'open';
        card.dataset.side = 'below';
        card.textContent = 'Readable details';
        document.body.append(card);
        for (const animation of card.getAnimations()) animation.finish();
        getComputedStyle(card).opacity;
        // Sample the exit halfway through without detaching a paused CSS animation.
        card.style.animationDelay = '-60ms';
        card.style.transitionDelay = '-60ms';
        card.dataset.state = 'closed';
        const exitingOpacity = Number(getComputedStyle(card).opacity);
        card.style.animationDelay = '';
        card.style.transitionDelay = '';
        card.dataset.state = 'open';
        const animations = card.getAnimations();
        for (const animation of animations) animation.pause();
        const samples = [0, 1, 40, 80, 120, 159, 160].map(time => {
          for (const animation of animations) animation.currentTime = time;
          return getComputedStyle(card).opacity;
        });
        card.remove();
        return {className, exitingOpacity, samples};
      }));
      for (const entry of entries) {
        expect(entry.exitingOpacity, entry.className).toBeGreaterThan(0);
        expect(entry.exitingOpacity, entry.className).toBeLessThan(1);
        expect(entry.samples, entry.className).toEqual(Array(7).fill('1'));
      }
      await page.emulateMedia({reducedMotion: 'reduce'});
      const reduced = await page.evaluate(() => ['thread-hover-card', 'task-node-popover'].flatMap(className => ['open', 'closed'].map(state => {
        const card = document.createElement('div');
        card.className = className;
        card.dataset.state = state;
        document.body.append(card);
        const style = getComputedStyle(card), result = {animation: style.animationName,
          transitionMs: Math.max(...style.transitionDuration.split(',').map(value => parseFloat(value) * 1000))};
        card.remove();
        return result;
      })));
      for (const style of reduced) {
        expect(style.animation).toBe('none');
        expect(style.transitionMs).toBeLessThanOrEqual(80);
      }
    } finally {await page.close();}
  });

  for (const width of [768, 1024, 1440]) for (const policy of ['full', 'os-reduced', 'reduced', 'off', 'panels-off'] as const) {
    it(`${policy} backdrop animation at ${width}px`, async () => {
      const page = await browser.newPage({viewport: {width, height: 1000}, reducedMotion: policy === 'os-reduced' ? 'reduce' : 'no-preference'});
      try {
        await page.setContent('<html data-theme="dark"><body><main class="app-shell"></main></body></html>');
        await page.addStyleTag({content: css});
        const measurements = await page.evaluate(policy => {
          document.documentElement.dataset.motion = policy === 'reduced' || policy === 'off' ? policy : 'system';
          const shell = document.querySelector<HTMLElement>('.app-shell')!;
          shell.dataset.panelAnimations = String(policy !== 'panels-off');
          // Settings and shell dialogs share these rules in default, loading and error states.
          return ['dialog', 'ui-modal settings-dialog', 'ui-modal'].map(className => {
            const dialog = document.createElement('dialog');
            dialog.className = className;
            dialog.textContent = 'Dialog content';
            shell.append(dialog);
            dialog.showModal();
            const style = getComputedStyle(dialog, '::backdrop');
            const result = {className, name: style.animationName, blur: style.backdropFilter,
              animations: document.getAnimations().filter(animation => {
                const effect = animation.effect as KeyframeEffect;
                return effect.target === dialog && effect.pseudoElement === '::backdrop';
              }).map(animation => ({duration: animation.effect!.getTiming().duration,
                opacity: (animation.effect as KeyframeEffect).getKeyframes().map(frame => frame.opacity)}))};
            dialog.remove();
            return result;
          });
        }, policy);
        for (const measurement of measurements) {
          expect(measurement.blur).toBe('blur(6px)');
          if (policy === 'full' && measurement.className !== 'ui-modal') {
            // Proves that the real pseudo-element animation is observed by getAnimations().
            expect(measurement.animations).toEqual([{duration: 170, opacity: ['0', '1']}]);
          } else {
            expect(measurement.name, JSON.stringify(measurement)).toBe('none');
            expect(measurement.animations, JSON.stringify(measurement)).toEqual([]);
          }
        }
      } finally {await page.close();}
    });
  }
});
