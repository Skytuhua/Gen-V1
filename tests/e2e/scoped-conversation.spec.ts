import {test, expect, type Page} from '@playwright/test';
import {scopedContext as context, scopedMessage as message, scopedEnvelope as envelope} from '../scoped-conversation-fixture';

async function fixture(page: Page, count = 15, long = false) {
  let epoch = 37, admittedEpoch = 37, sequence = 10, changed = false, revoked = false, working = false;
  let contextGate: Promise<void> | undefined, release: (() => void) | undefined;
  const reads: string[] = [];
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()); reads.push(url.pathname);
    if (url.pathname === '/api/bootstrap') {await route.fulfill({json: {csrfToken: 'synthetic'}}); return;}
    if (revoked) {await route.fulfill({status: 403, json: {error: {code: 'CAPABILITY_DENIED'}}}); return;}
    if (url.pathname.endsWith('/updates')) {
      if (epoch !== admittedEpoch) {await route.fulfill({status: 409, json: {error: {code: 'RESYNC_REQUIRED'}}}); return;}
      const fromSequence = sequence++;
      await route.fulfill({json: {...envelope, fromSequence, sequence, owner: working ? {...context, owner: {...context.owner, status: 'working', runId: 'synthetic-run'}, revision: 'd'.repeat(64), sequence, checkpoint: 'cp' + sequence} : null, transcriptChanged: changed, checkpoint: 'cp' + sequence}}); changed = false; return;
    }
    if (url.pathname.endsWith('/transcript')) {
      const older = url.searchParams.has('cursor');
      const messages = Array.from({length: older ? 8 : count}, (_, index) => long ? {...message('long', 'A😀'), contentLength: 5, nextContentCursor: 'part-2'} : message((older ? 'old-' : 'm-') + index, `Synthetic ${older ? 'older' : 'current'} message ${index}\n` + 'Reading content. '.repeat(15)));
      await route.fulfill({json: {...envelope, sequence, messages, nextCursor: older ? null : 'older'}}); return;
    }
    if (url.pathname.endsWith('/content')) {await route.fulfill({json: {...envelope, sequence, message: {...message('long', 'é𐐀'), contentOffset: 2, contentLength: 5}}}); return;}
    if (contextGate) await contextGate;
    admittedEpoch = epoch;
    await route.fulfill({json: {...context, owner: {...context.owner, epoch}, sequence, checkpoint: 'cp' + sequence}});
  });
  await page.goto('/tests/e2e/fixtures/scoped-conversation.html');
  await expect(page.getByRole('textbox', {name: 'Supplied composer'})).toBeVisible();
  await expect(page.locator('[data-message-id]')).toHaveCount(count);
  return {reads, change: () => {changed = true; count++;}, epoch: () => {epoch++;}, activity: () => {working = true;}, holdContext: () => {contextGate = new Promise<void>(done => {release = done;}); return () => release?.();}, revoke: () => {revoked = true;}};
}
const scroll = (page: Page) => page.getByRole('region', {name: 'Conversation transcript'});
test('uses the actual module with a supplied composer and real epoch, with no global reads', async ({page}) => {
  const f = await fixture(page); await expect(page.getByLabel('Parent epoch')).toHaveText('37');
  await expect(page.getByRole('textbox')).toHaveValue('Parent-owned draft');
  expect(f.reads.every(path => path === '/api/bootstrap' || path.startsWith('/api/conversations/exact-owner'))).toBe(true);
  await page.getByRole('textbox').focus(); await page.getByRole('textbox').dispatchEvent('keydown', {key: 'Enter', isComposing: true});
  await expect(page.getByRole('textbox')).toBeFocused(); await expect(page.getByRole('textbox')).toHaveValue('Parent-owned draft');
});
test('preserves an earlier reading anchor and composer focus on refresh, with a jump hint', async ({page}) => {
  const f = await fixture(page);
  await scroll(page).evaluate(element => {element.scrollTop = 220; element.dispatchEvent(new Event('scroll'));});
  const before = await page.locator('[data-message-id="m-2"]').evaluate(el => el.getBoundingClientRect().top);
  await page.getByRole('textbox').focus(); f.change(); await page.evaluate(() => window.scopedFixture.poll());
  await expect(page.locator('[data-message-id]')).toHaveCount(16);
  expect(await page.locator('[data-message-id="m-2"]').evaluate(el => el.getBoundingClientRect().top)).toBeCloseTo(before, 0);
  await expect(page.getByRole('textbox')).toBeFocused();
  await page.getByRole('button', {name: /Jump to latest/}).click();
  await expect.poll(() => scroll(page).evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(2);
});
test('prepends older pages without moving the visible message or losing keyboard focus', async ({page}) => {
  await fixture(page); await scroll(page).evaluate(el => {el.scrollTop = 0; el.dispatchEvent(new Event('scroll'));});
  const before = await page.locator('[data-message-id="m-0"]').evaluate(el => el.getBoundingClientRect().top);
  await page.getByRole('button', {name: 'Load older messages'}).focus(); await page.keyboard.press('Enter');
  await expect(page.locator('[data-message-id]')).toHaveCount(23);
  expect(Math.abs(await page.locator('[data-message-id="m-0"]').evaluate(el => el.getBoundingClientRect().top) - before)).toBeLessThan(1);
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
});
test('keeps hidden chat mounted and invalidates the parent context on resync and revocation', async ({page}) => {
  const f = await fixture(page); await page.getByRole('textbox').fill('Kept draft'); await page.getByRole('button', {name: 'Toggle chat'}).click();
  await expect(scroll(page)).toBeHidden(); f.epoch(); await page.evaluate(() => window.scopedFixture.poll());
  await expect(page.getByLabel('Parent epoch')).toHaveText('38');
  expect(await page.evaluate(() => window.scopedFixture.states.some(state => state.phase === 'resync' && state.epoch === null))).toBe(true);
  await page.getByRole('button', {name: 'Toggle chat'}).click(); await expect(page.getByRole('textbox')).toHaveValue('Kept draft');
  f.revoke(); await page.evaluate(() => window.scopedFixture.poll()); await expect(page.getByLabel('Parent epoch')).toHaveText('invalid');
  await expect(page.locator('[data-message-id]')).toHaveCount(0);
});
test('follows new messages only while already at the bottom', async ({page}) => {
  const f = await fixture(page); f.change(); await page.evaluate(() => window.scopedFixture.poll());
  await expect(page.locator('[data-message-id]')).toHaveCount(16);
  await expect.poll(() => scroll(page).evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(2);
});
test('stays within short narrow light and dark panes at 200% zoom with reduced motion', async ({page}, testInfo) => {
  await fixture(page, 2); await page.screenshot({path: testInfo.outputPath('01-dark-transcript.png')});
  await page.emulateMedia({reducedMotion: 'reduce'}); await page.setViewportSize({width: 540, height: 400});
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => {document.documentElement.dataset.theme = theme; document.body.style.zoom = '2';}, theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('textbox')).toBeVisible();
    expect(await scroll(page).evaluate(el => el.clientHeight)).toBeGreaterThan(0);
    await page.getByRole('textbox').scrollIntoViewIfNeeded();
    await expect(page.getByRole('textbox')).toBeInViewport();
    await page.screenshot({path: testInfo.outputPath(theme === 'light' ? '02-light-short-zoom.png' : '03-dark-short-zoom.png')});
  }
});
test('delivers invalidation while reacquisition is still pending and removes stale transcript', async ({page}) => {
  const f = await fixture(page); const release = f.holdContext(); f.epoch();
  await page.evaluate(() => {void window.scopedFixture.poll();});
  await expect(page.getByLabel('Parent epoch')).toHaveText('invalid');
  await expect(page.locator('[data-message-id]')).toHaveCount(0);
    await expect(scroll(page).getByRole('status')).toContainText('Refreshing');
  release(); await expect(page.getByLabel('Parent epoch')).toHaveText('38');
  await expect(page.locator('[data-message-id]')).toHaveCount(15);
});
test('automatically polls owner status while chat is hidden and keeps the same supplied node', async ({page}) => {
  const f = await fixture(page); await page.getByRole('textbox').fill('Hidden draft');
  await page.getByRole('button', {name: 'Toggle chat'}).click(); f.activity();
  await expect.poll(() => page.evaluate(() => window.scopedFixture.states.at(-1)?.status)).toBe('working');
  await page.getByRole('button', {name: 'Toggle chat'}).click(); await expect(page.getByRole('textbox')).toHaveValue('Hidden draft');
});
test('renders bounded Unicode continuation exactly and restores keyboard focus', async ({page}) => {
  const f = await fixture(page, 1, true);
  expect(f.reads.filter(path => path.endsWith('/content'))).toHaveLength(0);
  await page.getByRole('button', {name: 'Read more'}).focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.scoped-conversation-text')).toHaveText('A😀é𐐀');
  await expect(page.getByRole('article', {name: 'Assistant'})).toBeFocused();
  expect(f.reads.filter(path => path.endsWith('/content'))).toHaveLength(1);
});
test('clears context and transcript on explicit close', async ({page}) => {
  await fixture(page); await page.evaluate(() => window.scopedFixture.close());
  await expect(page.getByLabel('Parent epoch')).toHaveText('invalid');
  await expect(page.locator('[data-message-id]')).toHaveCount(0);
});
test('shows concise loading, error, retry and empty states using real API failures', async ({page}) => {
  let fail = true;
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/bootstrap') return route.fulfill({json: {csrfToken: 'synthetic'}});
    if (fail) return route.fulfill({status: 503, json: {error: {code: 'UNAVAILABLE'}}});
    return route.fulfill({json: url.pathname.endsWith('/transcript') ? {...envelope, messages: [], nextCursor: null} : context});
  });
  await page.goto('/tests/e2e/fixtures/scoped-conversation.html');
  await expect(page.getByRole('alert')).toContainText('Could not load'); await expect(page.getByLabel('Parent epoch')).toHaveText('invalid');
  fail = false; await page.getByRole('button', {name: 'Retry', exact: true}).click();
  await expect(scroll(page)).toContainText('No messages yet.'); await expect(page.getByLabel('Parent epoch')).toHaveText('37');
});
test('fences the rendered owner during canonical navigation, then uses the next exact real epoch', async ({page}) => {
  await fixture(page); let release!: () => void; const gate = new Promise<void>(done => {release = done;});
  await page.route('**/api/conversations/second-owner**', async route => {
    await gate;
    const url = new URL(route.request().url());
    await route.fulfill({json: url.pathname.endsWith('/transcript') ? {...envelope, threadId: 'second-owner', scopeKey: 'e'.repeat(64), messages: [{...message('second-message', 'Synthetic second owner'), threadId: 'second-owner'}], nextCursor: null} : {...context, owner: {...context.owner, threadId: 'second-owner', epoch: 91, projectId: null, projectName: null, modelId: 'synthetic/second'}, scopeKey: 'e'.repeat(64)}});
  });
  await page.evaluate(() => window.scopedFixture.navigate());
  await expect(page.getByLabel('Parent epoch')).toHaveText('invalid'); await expect(page.locator('[data-message-id]')).toHaveCount(0);
  release(); await expect(page.getByLabel('Parent epoch')).toHaveText('91');
  await expect(scroll(page)).toContainText('Synthetic second owner');
  expect(await page.evaluate(() => window.scopedFixture.states.at(-1)?.threadId)).toBe('second-owner');
});
