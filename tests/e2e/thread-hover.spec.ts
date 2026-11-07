import {expect, test, type Page} from '@playwright/test';

const trigger = (page: Page) => page.getByRole('button', {name: 'Thread trigger', exact: true});
const card = (page: Page) => page.getByRole('dialog', {name: /^Thread details:/});
async function fixture(page: Page, query = '') {
  await page.goto('/' + query); await expect(trigger(page)).toBeVisible();
}
async function open(page: Page) {await trigger(page).focus(); await expect(card(page)).toBeVisible();}

test('350ms dwell, 120ms pointer transfer, exact PR action and no pointer autofocus', async ({page}) => {
  await fixture(page); await page.clock.install(); await page.clock.pauseAt(new Date()); await trigger(page).hover();
  await page.clock.runFor(349); await expect(card(page)).toHaveCount(0);
  await page.clock.runFor(1); await expect(card(page)).toBeVisible(); await expect(trigger(page)).not.toBeFocused();
  const anchor = (await trigger(page).boundingBox())!, popup = (await card(page).boundingBox())!;
  expect(popup.y - anchor.y - anchor.height).toBeCloseTo(8, 0);
  await page.mouse.move(popup.x + 20, popup.y - 4); await page.clock.runFor(119); await expect(card(page)).toBeVisible();
  await card(page).hover(); await page.clock.runFor(150); await expect(card(page)).toBeVisible();
  await card(page).getByRole('button', {name: /Open PR/}).click();
  await expect(card(page)).toBeVisible(); expect(await page.evaluate(() => window.hoverFixture.lastOpen)).toMatchObject({target: {id: 'a-pr', owner: 'a', workingCopy: 'C:/worktrees/a'}, scope: {threadId: 'a'}, exact: true});
});

test('keyboard access reaches PRs and Escape restores the trigger without reopening', async ({page}) => {
  await fixture(page); await open(page); await expect(trigger(page)).toHaveAttribute('aria-expanded', 'true');
  await trigger(page).press('Tab'); const action = card(page).getByRole('button', {name: /Open PR/}); await expect(action).toBeFocused();
  await action.press('Enter'); await expect(card(page)).toBeVisible();
  await action.press('Escape'); await expect(card(page)).toHaveCount(0); await expect(trigger(page)).toBeFocused();
  await page.waitForTimeout(400); await expect(card(page)).toHaveCount(0);
  await trigger(page).press('Tab'); await expect(page.getByRole('button', {name: 'Next control'})).toBeFocused();
});

test('Tab exits the card to the next control and Shift Tab returns to its trigger', async ({page}) => {
  await fixture(page); await open(page); await trigger(page).press('Tab');
  await page.keyboard.press('Shift+Tab'); await expect(trigger(page)).toBeFocused(); await expect(card(page)).toBeVisible();
  await trigger(page).press('Tab'); await page.keyboard.press('Tab');
  await expect(page.getByRole('button', {name: 'Next control'})).toBeFocused(); await expect(card(page)).toHaveCount(0);
});

test('pointer exit dismisses after transfer grace and outside focus dismisses immediately', async ({page}) => {
  await fixture(page); await page.clock.install(); await page.clock.pauseAt(new Date()); await trigger(page).hover();
  await page.clock.runFor(350); await expect(card(page)).toBeVisible();
  await page.mouse.move(900, 650); await page.clock.runFor(119); await expect(card(page)).toBeVisible();
  await page.clock.runFor(1); await expect(card(page)).toHaveCount(0);
  await trigger(page).focus(); await expect(card(page)).toBeVisible();
  await page.getByRole('button', {name: 'Next control'}).focus(); await expect(card(page)).toHaveCount(0);
});

test('drag and nested menus suppress pending/open cards', async ({page}) => {
  await fixture(page); await page.clock.install(); await trigger(page).hover();
  await trigger(page).dispatchEvent('dragstart'); await page.clock.runFor(500); await expect(card(page)).toHaveCount(0);
  await trigger(page).dispatchEvent('dragend'); await page.mouse.move(700, 650); await trigger(page).hover(); await page.clock.runFor(350); await expect(card(page)).toBeVisible();
  await page.evaluate(() => window.hoverFixture.setMenuOpen(true)); await expect(card(page)).toHaveCount(0);
  await trigger(page).focus(); await page.clock.runFor(500); await expect(card(page)).toHaveCount(0);
  await expect(trigger(page)).not.toHaveAttribute('title');
});

test('rapid thread/copy/revision changes reject late responses and failures without global reads', async ({page}) => {
  const apiReads: string[] = []; page.on('request', request => {if (/\/api\/|\/events/.test(request.url())) apiReads.push(request.url());});
  await fixture(page, '?async'); await open(page); await expect(card(page)).toContainText('Loading details');
  await page.evaluate(() => window.hoverFixture.setFacts(window.hoverFixture.facts('b')));
  await expect(card(page)).toContainText('Second thread');
  await expect.poll(() => page.evaluate(() => window.hoverFixture.requests.length)).toBe(2);
  await page.evaluate(() => {const [a, b] = window.hoverFixture.requests; b.resolve(window.hoverFixture.facts('b')); a.resolve(window.hoverFixture.facts('a'));});
  await expect(card(page)).toContainText('feature/b'); await expect(card(page)).not.toContainText('feature/a');
  await card(page).getByRole('button', {name: /Open PR/}).click(); expect(await page.evaluate(() => window.hoverFixture.lastOpen?.scope.threadId)).toBe('b');
  await page.evaluate(() => window.hoverFixture.setFacts(window.hoverFixture.facts('b', 'rev-2')));
  await expect(card(page)).not.toContainText('feature/b');
  await expect.poll(() => page.evaluate(() => window.hoverFixture.requests.length)).toBe(3);
  await page.evaluate(() => window.hoverFixture.requests[2].reject(new Error('Synthetic source error')));
  await expect(card(page)).toContainText('Details unavailable'); await expect(card(page).getByRole('button', {name: /Open PR/})).toHaveCount(0);
  expect(apiReads).toEqual([]);
});

test('mismatched working-copy responses fail closed and Retry uses the current exact scope', async ({page}) => {
  await fixture(page, '?async'); expect(await page.evaluate(() => window.hoverFixture.requests.length)).toBe(0); await open(page);
  await page.evaluate(() => window.hoverFixture.requests[0].resolve(window.hoverFixture.facts('b')));
  await expect(card(page)).toContainText('Details unavailable'); await expect(card(page)).not.toContainText('feature/b');
  await card(page).getByRole('button', {name: 'Retry', exact: true}).click();
  await expect.poll(() => page.evaluate(() => window.hoverFixture.requests.length)).toBe(2);
  expect(await page.evaluate(() => window.hoverFixture.requests[1].scope)).toMatchObject({threadId: 'a', workingCopyId: 'C:/worktrees/a', revision: 'rev-1'});
  await page.evaluate(() => window.hoverFixture.requests[1].resolve(window.hoverFixture.facts('a')));
  await trigger(page).focus(); await expect(card(page)).toContainText('feature/a');
});

test('unknown facts are omitted, long text wraps, and all supplied PR actions remain reachable', async ({page}) => {
  await fixture(page);
  await page.evaluate(() => {const facts = window.hoverFixture.facts('a'); window.hoverFixture.setFacts({...facts,
    title: 'UnbrokenTitle'.repeat(18), branch: 'feature/'.repeat(25), workingCopy: 'C:/long/'.repeat(24),
    pullRequests: Array.from({length: 15}, (_, index) => ({id: `pr-${index}`, label: `#${index} ${'LongPRTitle'.repeat(12)}`, target: {id: `pr-${index}`, owner: 'a', workingCopy: 'C:/worktrees/a'}}))});});
  await open(page); await expect(card(page).getByRole('heading')).toHaveText('UnbrokenTitle'.repeat(18));
  const overflow = await card(page).evaluate(node => ({client: node.clientWidth, scroll: node.scrollWidth})); expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
  const last = card(page).getByRole('button', {name: /Open PR #14 /}); await last.scrollIntoViewIfNeeded(); await last.click();
  expect(await page.evaluate(() => window.hoverFixture.lastOpen?.target.id)).toBe('pr-14');
  await page.evaluate(() => window.hoverFixture.setFacts({scope: window.hoverFixture.facts('a').scope, title: 'Only known title'}));
  await expect(card(page)).toContainText('Only known title'); await expect(card(page).locator('dl')).toHaveCount(0); await expect(card(page)).not.toContainText('Unknown');
});

test('shared Popover owns the modal root; Escape dismisses the child before the modal', async ({page}) => {
  await fixture(page, '?modal'); await open(page);
  expect(await card(page).evaluate(node => node.parentElement?.closest('dialog[open]') !== null)).toBe(true);
  await trigger(page).press('Escape'); await expect(card(page)).toHaveCount(0); await expect(page.getByRole('dialog', {name: 'Fixture modal owner', exact: true})).toBeVisible();
  await trigger(page).press('Escape'); await expect(page.getByRole('dialog', {name: 'Fixture modal owner', exact: true})).toHaveCount(0);
});

for (const [theme, width, height, zoom, edge] of [
  ['dark',1120,740,1,false], ['light',1120,740,1,false], ['dark',640,440,1.25,true], ['light',390,400,1.5,true], ['dark',260,300,1,false],
] as const) {
  test(`geometry ${theme} ${width}x${height} CSS zoom ${zoom}`, async ({page}, info) => {
    await page.setViewportSize({width,height}); await page.emulateMedia({reducedMotion: 'reduce'}); await fixture(page, edge ? '?edge' : '');
    await page.evaluate(({theme, zoom}) => {document.documentElement.dataset.theme = theme; document.documentElement.dataset.nativeTitlebar = 'true'; document.documentElement.style.zoom = String(zoom);}, {theme, zoom});
    await open(page);
    const geometry = await card(page).evaluate(node => {const r = node.getBoundingClientRect(), style = getComputedStyle(node), title = getComputedStyle(node.querySelector('h2')!), facts = getComputedStyle(node.querySelector('dl')!); return {left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height, padding:style.padding, title:title.fontSize, facts:facts.fontSize, gap:getComputedStyle(node.querySelector('.thread-hover-body')!).gap, animation:style.animationName, overflow:node.scrollWidth > node.clientWidth + 1};});
    expect(geometry.left).toBeGreaterThanOrEqual(7); expect(geometry.top).toBeGreaterThanOrEqual(49); expect(geometry.right).toBeLessThanOrEqual(width - 7); expect(geometry.bottom).toBeLessThanOrEqual(height - 7); expect(geometry.overflow).toBe(false);
    expect(geometry.padding).toBe('12px'); expect(geometry.title).toBe('16px'); expect(geometry.facts).toBe('12px'); expect(geometry.gap).toBe('8px'); expect(geometry.animation).toBe('none');
    if (width === 1120) {
      expect(geometry.width).toBe(304);
      expect(await card(page).evaluate(node => node.scrollHeight <= node.clientHeight + 1)).toBe(true);
    }
    const last = card(page).getByRole('button', {name: /Open PR/}); await last.scrollIntoViewIfNeeded(); await expect(last).toBeVisible();
    await info.attach('geometry', {body: JSON.stringify(geometry, null, 2), contentType: 'application/json'});
    await page.screenshot({path: info.outputPath(`hover-${theme}-${width}-${zoom}.png`)});
  });
}
