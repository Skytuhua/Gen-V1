import { test, expect, type Locator, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const move = 'cubic-bezier(0.4, 0, 0.2, 1)';
type Motion = { property: string; duration: number; easing: string; frames: ComputedKeyframe[] };
type SampledControl = HTMLElement & { composerMotion: Promise<Motion[]> };
type FixtureWindow = Window & { composerPressFixture: { calls: string[]; setDisabled: (disabled: boolean) => void; unmount: () => void } };

async function fixture(page: Page, separate = false) {
  const path = encodeURI('/@fs/' + resolve('tests/e2e/composer-press-fixture.tsx').replaceAll('\\', '/'));
  await page.route('**/composer-press-fixture?*', route => route.fulfill({ contentType: 'text/html', body: `<html data-theme="dark"><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${path}');</script></body></html>` }));
  await page.goto(`/composer-press-fixture?${separate ? 'separate=1' : ''}`);
  await expect(page.getByRole('button', { name: 'Select project', exact: true })).toBeEnabled();
}

// Pause in the first frame so short transitions remain measurable on slower hosts.
async function armMotion(control: Locator, event: 'pointerover' | 'pointerdown') {
  await control.evaluate((node, event) => {
    getComputedStyle(node).transform;
    (node as SampledControl).composerMotion = new Promise(resolve => {
      window.addEventListener(event, () => requestAnimationFrame(() => {
        const animations = node.getAnimations().filter((animation): animation is CSSTransition => animation instanceof CSSTransition);
        const records = animations.map(animation => {
          animation.pause();
          const effect = animation.effect as KeyframeEffect, timing = effect.getTiming();
          return { property: animation.transitionProperty, duration: Number(timing.duration), easing: timing.easing!, frames: effect.getKeyframes() };
        });
        resolve(records);
      }), { once: true });
    });
  }, event);
}
const sampledMotion = (control: Locator) => control.evaluate(node => (node as SampledControl).composerMotion);
const transforms = (control: Locator) => control.evaluate(node => node.getAnimations().filter(animation => animation instanceof CSSTransition && animation.transitionProperty === 'transform').length);
async function finishMotion(control: Locator) {
  await control.evaluate(node => { for (const animation of node.getAnimations()) animation.finish(); });
}
async function pointerPress(page: Page, control: Locator) {
  await control.hover(); await finishMotion(control);
  await armMotion(control, 'pointerdown'); await page.mouse.down();
  const motions = await sampledMotion(control), press = motions.find(motion => motion.property === 'transform');
  expect(press).toMatchObject({ duration: 80, easing: move });
  expect(press!.frames.at(-1)!.transform).toBe('scale(0.97)');
  await finishMotion(control);
  await expect(control).toHaveCSS('transform', 'matrix(0.97, 0, 0, 0.97, 0, 0)');
  await page.mouse.up();
  expect(await control.evaluate(node => getComputedStyle(node).transform)).toBe('none');
  expect(await transforms(control)).toBe(0);
  await expect(control).not.toHaveAttribute('data-pointer-pressed');
}

for (const width of [1024, 1440]) {
  test(`pointer presses use 80ms, .97 and immediate release at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ reducedMotion: 'no-preference' });
    for (const separate of [false, true]) {
      await fixture(page, separate);
      for (const name of ['Select project', 'Inspect changes', 'Create PR', 'Attach files']) await pointerPress(page, page.getByRole('button', { name, exact: true }));
      await pointerPress(page, page.getByRole('combobox', { name: 'Model', exact: true }));
      await expect(page.getByRole('dialog', { name: 'Model and reasoning', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      expect(await page.evaluate(() => (window as unknown as FixtureWindow).composerPressFixture.calls)).toEqual(['project', 'changes', 'pr', 'attach']);
    }
  });

  test(`hover colors use 120ms and move easing at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); await fixture(page, true);
    for (const control of [page.getByRole('button', { name: 'Select project', exact: true }), page.getByRole('button', { name: 'Inspect changes', exact: true }), page.locator('.composer-select')]) {
      await page.mouse.move(0, 0); await finishMotion(control);
      await armMotion(control, 'pointerover'); await control.hover();
      const motions = await sampledMotion(control);
      for (const property of ['background-color', 'color']) expect(motions).toContainEqual(expect.objectContaining({ property, duration: 120, easing: move }));
      expect(motions.some(motion => motion.property === 'transform')).toBe(false);
      await finishMotion(control);
    }
  });

  test(`Space and Enter keep focus and activation without scaling at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); await fixture(page, true);
    // Also check keyboard use after a pointer press on the same control.
    await pointerPress(page, page.getByRole('button', { name: 'Select project', exact: true }));
    await page.mouse.move(0, 0); await page.keyboard.press('Tab');
    for (const name of ['Select project', 'Inspect changes', 'Create PR', 'Attach files']) {
      const control = page.getByRole('button', { name, exact: true }); await control.focus();
      for (const key of ['Space', 'Enter']) {
        await page.keyboard.down(key);
        await expect(control).toBeFocused();
        expect(await control.evaluate(node => node.matches(':focus-visible'))).toBe(true);
        expect(await control.evaluate(node => getComputedStyle(node).transform)).toBe('none');
        expect(await transforms(control)).toBe(0);
        await page.keyboard.up(key);
      }
    }
    expect(await page.evaluate(() => (window as unknown as FixtureWindow).composerPressFixture.calls)).toEqual(['project', 'project', 'project', 'changes', 'changes', 'pr', 'pr', 'attach', 'attach']);
    const model = page.getByRole('combobox', { name: 'Model', exact: true }); await model.focus(); await page.keyboard.down('Enter');
    expect(await model.evaluate(node => getComputedStyle(node).transform)).toBe('none');
    await page.keyboard.up('Enter'); await page.keyboard.press('Escape'); await expect(model).toBeFocused();
  });

  for (const policy of ['os', 'reduced', 'off', 'panels-off'] as const) test(`${policy} has no scale and instant state colors at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ reducedMotion: 'no-preference' }); await fixture(page, true);
    // Changing the preference during a held press must settle it too.
    const project = page.getByRole('button', { name: 'Select project', exact: true });
    await project.hover(); await finishMotion(project); await armMotion(project, 'pointerdown'); await page.mouse.down(); await sampledMotion(project);
    if (policy === 'os') await page.emulateMedia({ reducedMotion: 'reduce' });
    else await page.evaluate(policy => {
      if (policy === 'panels-off') (document.querySelector('.app-shell') as HTMLElement).dataset.panelAnimations = 'false';
      else document.documentElement.dataset.motion = policy;
    }, policy);
    expect(await project.evaluate(node => getComputedStyle(node).transform)).toBe('none'); expect(await transforms(project)).toBe(0); await page.mouse.up();
    for (const control of [project, page.getByRole('button', { name: 'Inspect changes', exact: true }), page.locator('.composer-select')]) {
      await page.mouse.move(0, 0);
      const before = await control.evaluate(node => ({ background: getComputedStyle(node).backgroundColor, color: getComputedStyle(node).color }));
      await control.hover();
      const hovered = await control.evaluate(node => {
        const style = getComputedStyle(node);
        return { background: style.backgroundColor, color: style.color, animations: node.getAnimations().length, duration: style.transitionDuration };
      });
      expect(hovered.background).not.toBe(before.background); expect(hovered.color).not.toBe(before.color);
      expect(hovered.animations).toBe(0); expect(hovered.duration).toBe('0s');
      await page.mouse.down(); expect(await control.evaluate(node => getComputedStyle(node).transform)).toBe('none'); expect(await transforms(control)).toBe(0); await page.mouse.up();
    }
  });
}

test('release outside, cancellation, pointer exit, blur and unmount clear presses', async ({ page }) => {
  await fixture(page, true);
  for (const name of ['Select project', 'Inspect changes']) {
    const control = page.getByRole('button', { name, exact: true });
    for (const action of ['outside', 'cancel', 'blur', 'keyboard'] as const) {
      await control.hover(); await finishMotion(control); await page.mouse.down(); await expect(control).toHaveAttribute('data-pointer-pressed');
      if (action === 'outside') await page.mouse.move(0, 0);
      if (action === 'cancel') await control.dispatchEvent('pointercancel', { pointerId: 1 });
      if (action === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      if (action === 'keyboard') await page.keyboard.press('Escape');
      expect(await control.evaluate(node => getComputedStyle(node).transform)).toBe('none');
      await expect(control).not.toHaveAttribute('data-pointer-pressed'); await page.mouse.up();
    }
  }
  const project = page.getByRole('button', { name: 'Select project', exact: true });
  await project.hover(); await page.mouse.down();
  const held = await project.elementHandle(); await page.evaluate(() => (window as unknown as FixtureWindow).composerPressFixture.unmount());
  expect(await held!.evaluate(node => node.hasAttribute('data-pointer-pressed'))).toBe(false); await page.mouse.up();
});

test('disabled and non-primary presses stay unscaled', async ({ page }) => {
  await fixture(page, true);
  for (const name of ['Select project', 'Inspect changes']) {
    const control = page.getByRole('button', { name, exact: true });
    await control.hover(); await page.mouse.down({ button: 'right' });
    expect(await control.evaluate(node => getComputedStyle(node).transform)).toBe('none'); await expect(control).not.toHaveAttribute('data-pointer-pressed'); await page.mouse.up({ button: 'right' });
    await control.dispatchEvent('pointerdown', { button: 0, isPrimary: false, pointerId: 2 }); await expect(control).not.toHaveAttribute('data-pointer-pressed');
  }
  await page.evaluate(() => (window as unknown as FixtureWindow).composerPressFixture.setDisabled(true));
  for (const name of ['Select project', 'Inspect changes']) {
    const control = page.getByRole('button', { name, exact: true }); await expect(control).toBeDisabled();
    await control.hover({ force: true }); await page.mouse.down();
    expect(await control.evaluate(node => getComputedStyle(node).transform)).toBe('none'); await expect(control).not.toHaveAttribute('data-pointer-pressed'); await page.mouse.up();
  }
});

test('768px secondary desktop retains pointer feedback and draft', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1000 }); await fixture(page, true);
  await pointerPress(page, page.getByRole('button', { name: 'Select project', exact: true }));
  await pointerPress(page, page.getByRole('button', { name: 'Inspect changes', exact: true }));
  await expect(page.getByRole('textbox', { name: 'Draft', exact: true })).toHaveValue('Keep this draft');
});

test.describe('coarse pointer at desktop width', () => {
  test.use({ hasTouch: true });
  test('hover colors and color transitions require hover capability and a fine pointer', async ({ page }) => {
    await fixture(page, true);
    expect(await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches)).toBe(false);
    for (const control of [page.getByRole('button', { name: 'Select project', exact: true }), page.getByRole('button', { name: 'Inspect changes', exact: true }), page.locator('.composer-select')]) {
      const before = await control.evaluate(node => ({ color: getComputedStyle(node).color, background: getComputedStyle(node).backgroundColor }));
      await control.hover();
      expect(await control.evaluate(node => ({ color: getComputedStyle(node).color, background: getComputedStyle(node).backgroundColor }))).toEqual(before);
      expect(await control.evaluate(node => getComputedStyle(node).transitionProperty)).toBe('transform');
    }
  });
});
