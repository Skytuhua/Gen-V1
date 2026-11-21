import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import {crc32, deflateSync} from 'node:zlib';
const fixture = '/@fs/' + resolve('tests/e2e/usage-context-fixture.tsx').replaceAll('\\', '/');
const update = async (page: Page, action: string) => {
  await expect(page.locator('html')).toHaveAttribute('data-usage-fixture-ready', 'true');
  await page.evaluate(value => window.dispatchEvent(new CustomEvent('usage-fixture', { detail: value })), action);
};
const context = (page: Page) => page.getByRole('dialog', { name: 'Context inspector' });
const usage = (page: Page) => page.getByRole('dialog', { name: 'Usage', exact: true });
const verification = (page: Page) => page.getByRole('region', {name: 'Verification', exact: true});
const verificationResult = (requirement: string, freshness = 'CURRENT') => ({verification: {
  label: 'VERIFIED', staleBanner: false,
  summary: {verified: 1, failed: 0, unverified: 0, blocked: 0, missing: []},
  rows: [{requirement, checkId: 'check-one', check: 'node verify.js', phase: 'TEST', sourceRevision: 'abc123', outcome: 'PASS', freshness, verifier: 'execution-one', evidence: [], missing: []}],
}});
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route(url => url.pathname === '/usage-context', route => route.fulfill({ contentType: 'text/html', body: `<html data-theme="dark" data-native-titlebar="true"><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${encodeURI(fixture)}');</script></body></html>` }));
  await page.route('**/api/bootstrap', route => route.fulfill({ json: { csrfToken: 'synthetic' } }));
});
test('verification hides previous-owner evidence while the newly selected conversation loads', async ({page}) => {
  let release: (() => Promise<void>) | undefined;
  await page.route('**/api/threads/thread-one/verification', route => route.fulfill({json: verificationResult('Private first requirement')}));
  await page.route('**/api/threads/thread-two/verification', route => {release = () => route.fulfill({json: verificationResult('Second requirement')});});
  await page.goto('/usage-context?verification');
  await expect(verification(page)).toContainText('Private first requirement');
  await page.getByRole('button', {name: 'Second conversation', exact: true}).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await expect(page.getByText('Private first requirement', {exact: true})).toHaveCount(0);
  await release!();
  await expect(verification(page)).toContainText('Second requirement');
});
test('verification rereads a revisited conversation before displaying its previous evidence', async ({page}) => {
  let reads = 0, release: (() => Promise<void>) | undefined;
  await page.route('**/api/threads/thread-one/verification', route => {
    if (++reads === 1) return route.fulfill({json: verificationResult('Previous first evidence')});
    release = () => route.fulfill({json: verificationResult('Current first evidence')});
  });
  await page.route('**/api/threads/thread-two/verification', () => {});
  await page.goto('/usage-context?verification');
  await expect(verification(page)).toContainText('Previous first evidence');
  await page.getByRole('button', {name: 'Second conversation', exact: true}).click();
  await page.getByRole('button', {name: 'First conversation', exact: true}).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await expect(page.getByText('Previous first evidence', {exact: true})).toHaveCount(0);
  await release!();
  await expect(verification(page)).toContainText('Current first evidence');
});
test('verification refresh failure removes the current-success label and reports unavailable evidence', async ({page}) => {
  let reads = 0;
  await page.route('**/api/threads/thread-one/verification', route => ++reads === 1
    ? route.fulfill({json: verificationResult('Build passes')})
    : route.fulfill({status: 503, json: {error: {code: 'UNAVAILABLE', message: 'Verification read failed.'}}}));
  await page.goto('/usage-context?verification');
  await expect(verification(page)).toContainText('Build passes');
  await expect(verification(page).getByText('Verified', {exact: true})).toBeVisible();
  await expect.poll(() => reads, {timeout: 7000}).toBeGreaterThan(1);
  await expect(verification(page).getByRole('status')).toContainText('Verification unavailable');
  await expect(verification(page).getByText('Verified', {exact: true})).toHaveCount(0);
  await expect(verification(page).locator('.verification-outcome.pass')).toHaveCount(0);
});
test('verification does not overlap polling reads or replace newer evidence with an older response', async ({page}) => {
  let reads = 0, release: (() => Promise<void>) | undefined;
  const requested: string[] = [];
  page.on('request', request => { if (request.url().endsWith('/verification')) requested.push(request.url()); });
  await page.clock.install();
  await page.route('**/api/threads/thread-one/verification', route => {
    reads++;
    if (reads === 1) return route.fulfill({json: verificationResult('Initial evidence')});
    release = () => route.fulfill({json: verificationResult('Refreshed evidence')});
  });
  await page.goto('/usage-context?verification');
  await expect(verification(page)).toContainText('Initial evidence');
  await page.clock.runFor(4000);
  await expect.poll(() => Boolean(release), {timeout: 7000}).toBe(true);
  // More polling intervals must not create another read while the response is held.
  await page.clock.runFor(8000);
  expect(requested).toHaveLength(2);
  await release!();
  await expect(verification(page)).toContainText('Refreshed evidence');
});
test('verification does not color a historical pass green when freshness is indeterminate', async ({page}) => {
  await page.route('**/api/threads/thread-one/verification', route => route.fulfill({json: {
    verification: {...verificationResult('Unavailable source', 'INDETERMINATE').verification, label: 'COMPLETED_UNVERIFIED'},
  }}));
  await page.goto('/usage-context?verification');
  await expect(verification(page)).toContainText('INDETERMINATE');
  await expect(verification(page).locator('.verification-outcome.pass')).toHaveCount(0);
});
const exactCheckDetails = () => ({
  argv: ['node', 'checks/argument boundaries.mjs', '', 'a b', '"quoted"', 'line\nbreak', '--target=' + 'tail'.repeat(70)],
  cwdIdentity: '/fixture/physical-workspace/with spaces/dev=17/ino=2039',
  codeDigest: 'a'.repeat(64), dependencyDigest: 'b'.repeat(64), recipeDigest: 'c'.repeat(64),
  environmentId: 'fixture/linux/node24/pnpm10.30.3/exact-environment',
  startedAt: '2026-11-17T07:00:00.123Z', endedAt: '2026-11-17T07:00:01.456Z',
  exitCode: 0, observationKind: 'process', detail: 'Observed exit 0. Literal output: <script>not executable</script>', visual: null,
});

const retainedRef = (tail: number) => `verification-artifact:00000000-0000-4000-8000-${String(tail).padStart(12, '0')}`;
const retainedPath = (tail: number) => `**/api/threads/thread-one/verification/artifacts/${retainedRef(tail).slice('verification-artifact:'.length)}`;
function retainedImage() {
  const chunk = (name: string, data: Buffer) => {const bytes = Buffer.alloc(data.length + 12); bytes.writeUInt32BE(data.length); bytes.write(name, 4); data.copy(bytes, 8); bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4); return bytes;};
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0, 255]))), chunk('IEND', Buffer.alloc(0))]);
}
test('verification opens bounded retained logs as text and a screenshot at its captured viewport', async ({page}) => {
  const model = verificationResult('Retained evidence').verification, text = 'Observed output\n<script>window.artifactExecuted=true</script>\n', image = retainedImage();
  await page.route('**/api/threads/thread-one/verification', route => route.fulfill({json: {verification: {...model, rows: [{...model.rows[0], details: exactCheckDetails(), evidence: [retainedRef(1), retainedRef(2)]}]}}}));
  await page.route(retainedPath(1), route => route.fulfill({contentType: 'text/plain; charset=utf-8', headers: {'content-length': String(Buffer.byteLength(text)), 'x-verification-artifact-truncated': 'true'}, body: text}));
  await page.route(retainedPath(2), route => route.fulfill({contentType: 'image/png', headers: {'content-length': String(image.length), 'x-verification-viewport-width': '1', 'x-verification-viewport-height': '1'}, body: image}));
  await page.goto('/usage-context?verification');
  await verification(page).getByRole('button', {name: 'Check details for check-one (Retained evidence)', exact: true}).click();
  const detail = verification(page).getByRole('region', {name: 'Check details for check-one (Retained evidence)', exact: true});
  await expect(detail.getByLabel('Retained log', {exact: true})).toHaveText(text);
  await expect(detail).toContainText('Log truncated at capture');
  expect(await page.evaluate(() => (window as unknown as {artifactExecuted?: boolean}).artifactExecuted)).toBeUndefined();
  await detail.getByRole('button', {name: 'Artifact 2', exact: true}).click();
  const capture = detail.getByRole('img', {name: 'Captured verification screenshot', exact: true});
  await expect(capture).toBeVisible(); await expect.poll(() => capture.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1);
  await expect(detail).toContainText('Captured at 1 × 1');
  await expect(detail.getByLabel('Retained log', {exact: true})).toHaveCount(0);
});

test('verification discards a late artifact read after another retained reference is selected', async ({page}) => {
  const model = verificationResult('Switch evidence').verification;
  await page.route('**/api/threads/thread-one/verification', route => route.fulfill({json: {verification: {...model, rows: [{...model.rows[0], details: exactCheckDetails(), evidence: [retainedRef(1), retainedRef(2)]}]}}}));
  let release: (() => Promise<void>) | undefined;
  await page.route(retainedPath(1), route => {release = () => route.fulfill({contentType: 'text/plain; charset=utf-8', headers: {'content-length': '16'}, body: 'Old private body'}).catch(() => {});});
  await page.route(retainedPath(2), route => route.fulfill({contentType: 'text/plain; charset=utf-8', headers: {'content-length': '17'}, body: 'Current log bytes'}));
  await page.goto('/usage-context?verification');
  await verification(page).getByRole('button', {name: 'Check details for check-one (Switch evidence)', exact: true}).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  const detail = verification(page).getByRole('region', {name: 'Check details for check-one (Switch evidence)', exact: true});
  await detail.getByRole('button', {name: 'Artifact 2', exact: true}).click();
  await expect(detail.getByLabel('Retained log', {exact: true})).toHaveText('Current log bytes');
  await release!(); await expect(detail).not.toContainText('Old private body');
});

test('verification reports an unavailable retained artifact without rendering its bytes', async ({page}) => {
  const model = verificationResult('Unavailable artifact').verification;
  await page.route('**/api/threads/thread-one/verification', route => route.fulfill({json: {verification: {...model, rows: [{...model.rows[0], details: exactCheckDetails(), evidence: [retainedRef(1)]}]}}}));
  await page.route(retainedPath(1), route => route.fulfill({status: 404, json: {error: {code: 'NOT_FOUND', message: 'Verification artifact unavailable'}}}));
  await page.goto('/usage-context?verification');
  await verification(page).getByRole('button', {name: 'Check details for check-one (Unavailable artifact)', exact: true}).click();
  const detail = verification(page).getByRole('region', {name: 'Check details for check-one (Unavailable artifact)', exact: true});
  await expect(detail.getByRole('status')).toHaveText('Retained artifact unavailable.');
  await expect(detail.getByRole('img')).toHaveCount(0); await expect(detail.getByLabel('Retained log', {exact: true})).toHaveCount(0);
});
test('verification check details preserve exact arguments, execution identities and historical outcome', async ({page}) => {
  const details = exactCheckDetails(), model = verificationResult('Exact process check', 'STALE').verification;
  await page.route('**/api/threads/thread-one/verification', route => route.fulfill({json: {verification: {
    ...model, label: 'COMPLETED_UNVERIFIED', staleBanner: true, rows: [{...model.rows[0], details, evidence: ['artifact:bounded-log:sha256:' + 'd'.repeat(64)]}],
  }}}));
  await page.goto('/usage-context?verification');
  const trigger = verification(page).getByRole('button', {name: 'Check details for check-one (Exact process check)', exact: true});
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.focus(); await page.keyboard.press('Enter');
  const detail = verification(page).getByRole('region', {name: 'Check details for check-one (Exact process check)', exact: true});
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(JSON.parse(await detail.getByLabel('Arguments (JSON)', {exact: true}).innerText())).toEqual(details.argv);
  for (const value of [details.cwdIdentity, details.codeDigest, details.dependencyDigest, details.recipeDigest, details.environmentId, details.startedAt, details.endedAt, details.detail]) await expect(detail.getByText(value, {exact: true})).toBeVisible();
  await expect(detail.getByLabel('Recorded outcome', {exact: true})).toHaveText('PASS');
  await expect(detail.getByLabel('Current freshness', {exact: true})).toHaveText('STALE');
  await expect(detail.getByLabel('Exit code', {exact: true})).toHaveText('0');
  await expect(detail.locator('.verification-outcome.pass')).toHaveCount(0);
  await expect(detail.getByRole('img')).toHaveCount(0); await expect(detail.getByRole('link')).toHaveCount(0);
  await detail.getByRole('button', {name: 'Close check details', exact: true}).click();
  await expect(trigger).toBeFocused(); await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});
test('verification shows browser expected and observed fields with null exit and screenshot identities', async ({page}) => {
  const model = verificationResult('Browser behavior').verification;
  const visual = {checklistItemId: 'save-button', actionTraceId: 'trace:button-save', origin: 'http://127.0.0.1:4100', viewport: {width: 390, height: 844}, assertion: 'Clicking Save displays the saved state.', observed: 'Saved state remained hidden.', screenshotDigest: 'e'.repeat(64)};
  await page.route('**/api/threads/thread-one/verification', route => route.fulfill({json: {verification: {
    ...model, label: 'FAILED', rows: [{...model.rows[0], outcome: 'FAIL', phase: 'BROWSER', details: {...exactCheckDetails(), observationKind: 'browser', exitCode: null, visual}}],
  }}}));
  await page.goto('/usage-context?verification');
  await verification(page).getByRole('button', {name: 'Check details for check-one (Browser behavior)', exact: true}).click();
  const detail = verification(page).getByRole('region', {name: 'Check details for check-one (Browser behavior)', exact: true});
  await expect(detail.getByLabel('Expected', {exact: true})).toHaveText(visual.assertion);
  await expect(detail.getByLabel('Observed', {exact: true})).toHaveText(visual.observed);
  await expect(detail.getByLabel('Viewport', {exact: true})).toHaveText('390 × 844');
  await expect(detail.getByLabel('Exit code', {exact: true})).toHaveText('Not reported');
  for (const value of [visual.origin, visual.actionTraceId, visual.checklistItemId, visual.screenshotDigest]) await expect(detail.getByText(value, {exact: true})).toBeVisible();
  await expect(detail.getByRole('img')).toHaveCount(0);
});
test('verification keeps one check bound to two requirements independently addressable', async ({page}) => {
  const errors: string[] = [], model = verificationResult('First requirement').verification;
  page.on('console', message => {if (message.type() === 'error') errors.push(message.text());});
  await page.route('**/api/threads/thread-one/verification', route => route.fulfill({json: {verification: {...model, rows: [
    {...model.rows[0], details: exactCheckDetails()}, {...model.rows[0], requirement: 'Second requirement', details: exactCheckDetails()},
  ]}}}));
  await page.goto('/usage-context?verification');
  await expect(verification(page)).toContainText('Second requirement');
  expect(errors.filter(error => /same key/i.test(error))).toEqual([]);
  await verification(page).getByRole('button', {name: 'Check details for check-one (Second requirement)', exact: true}).click();
  await expect(verification(page).getByRole('region', {name: 'Check details for check-one (Second requirement)', exact: true})).toBeVisible();
  await expect(verification(page).getByRole('button', {name: 'Check details for check-one (First requirement)', exact: true})).toHaveAttribute('aria-expanded', 'false');
});
test('verification expansion keeps the composer reachable in a short canvas', async ({page}, info) => {
  const model = verificationResult('Check inside conversation').verification;
  await page.setViewportSize({width: 340, height: 420});
  await page.route('**/api/threads/thread-one/verification', route => route.fulfill({json: {verification: {
    ...model, rows: [{...model.rows[0], details: exactCheckDetails()}],
  }}}));
  await page.goto('/usage-context?verification&canvas');
  const trigger = verification(page).getByRole('button', {name: 'Check details for check-one (Check inside conversation)', exact: true});
  await trigger.click();
  const detail = verification(page).getByRole('region', {name: 'Check details for check-one (Check inside conversation)', exact: true});
  await expect(detail).toBeFocused();
  await expect(page.getByRole('textbox', {name: 'Reply', exact: true})).toBeInViewport();
  const panel = verification(page);
  expect(await panel.evaluate(node => node.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
  await panel.focus(); await expect(panel).toBeFocused();
  const before = await panel.evaluate(node => node.scrollTop);
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => panel.evaluate(node => node.scrollTop)).toBeGreaterThan(before);
  await detail.getByRole('button', {name: 'Close check details', exact: true}).click();
  await expect(trigger).toBeFocused();
  await page.getByRole('textbox', {name: 'Reply', exact: true}).fill('Reply remains reachable.');
  await expect(page.getByRole('textbox', {name: 'Reply', exact: true})).toHaveValue('Reply remains reachable.');
  await trigger.click();
  await page.screenshot({path: info.outputPath('verification-short-canvas.png'), fullPage: true});
});
for (const theme of ['dark', 'light']) test(`verification stays inside a narrow window with keyboard scrolling and wrapped details in ${theme}`, async ({page}, info) => {
  const model = verificationResult('requirement-' + 'long-identity-'.repeat(10), 'STALE').verification;
  const details = {...exactCheckDetails(), cwdIdentity: '/physical/' + 'path-segment/'.repeat(30), environmentId: 'environment:' + 'host-identity-'.repeat(12)};
  await page.setViewportSize({width: 340, height: 420});
  await page.route('**/api/threads/thread-one/verification', route => route.fulfill({json: {verification: {
    ...model, label: 'COMPLETED_UNVERIFIED', staleBanner: true, rows: [{...model.rows[0], verifier: 'execution:' + 'identity-'.repeat(16), evidence: ['artifact:sha256:' + 'f'.repeat(64)], details}],
  }}}));
  await page.goto('/usage-context?verification');
  await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
  await expect(verification(page)).toContainText('Completed unverified');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const scroller = verification(page).getByRole('region', {name: 'Verification checks', exact: true});
  await scroller.focus(); await expect(scroller).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => scroller.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
  await verification(page).getByRole('button', {name: `Check details for check-one (${model.rows[0].requirement})`, exact: true}).click();
  const detail = verification(page).getByRole('region', {name: `Check details for check-one (${model.rows[0].requirement})`, exact: true});
  await expect(detail).toBeVisible();
  expect(await detail.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(JSON.parse(await detail.getByLabel('Arguments (JSON)', {exact: true}).innerText())).toEqual(details.argv);
  await page.screenshot({path: info.outputPath(`verification-${theme}-narrow.png`), fullPage: true});
});
test('a token decrease after a command acknowledgement is not a compaction receipt', async ({ page }) => {
  const commands: { type: string; threadId: string }[] = [];
  await page.route('**/api/commands', route => { commands.push(route.request().postDataJSON()); return route.fulfill({ json: { commandId: 'fixture', eventSeq: 1, result: {} } }); });
  await page.goto('/usage-context'); await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
  await context(page).getByRole('button', { name: 'Compact now', exact: true }).click(); await update(page, 'decrease');
  await expect(context(page)).toBeVisible(); await expect(context(page)).not.toContainText('Freed');
  expect(commands.map(value => [value.type, value.threadId])).toEqual([['run.compact', 'thread-one']]);
});
test('a compaction error does not follow a different thread or session', async ({ page }) => {
  await page.route('**/api/commands', route => route.fulfill({ status: 500, json: { error: { code: 'TEST', message: 'Synthetic compaction failure' } } }));
  await page.goto('/usage-context'); await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
  await page.getByRole('button', { name: 'Compact now', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('Synthetic compaction failure');
  await update(page, 'session'); await expect(context(page)).toBeVisible(); await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Compact now', exact: true }).click(); await expect(page.getByRole('alert')).toBeVisible();
  await update(page, 'thread'); await expect(context(page)).toBeVisible(); await expect(page.getByRole('alert')).toHaveCount(0);
});
test('a late failure from a prior session cannot update the newly selected context', async ({ page }) => {
  let reply: (() => Promise<void>) | undefined;
  await page.route('**/api/commands', route => { reply = () => route.fulfill({ status: 500, json: { error: { code: 'LATE', message: 'Late old-session failure' } } }); });
  await page.goto('/usage-context'); await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
  await context(page).getByRole('button', { name: 'Compact now', exact: true }).click();
  await expect.poll(() => Boolean(reply)).toBe(true); await update(page, 'session'); await reply!();
  await expect(context(page)).toBeVisible(); await expect(context(page).getByRole('alert')).toHaveCount(0);
  await expect(context(page).getByRole('button', { name: 'Compact now', exact: true })).toBeEnabled();
});
test('context takes keyboard focus on reveal and protects IME Escape before restoring its trigger', async ({ page }) => {
  await page.goto('/usage-context'); const opener = page.getByRole('button', { name: 'Inspect context', exact: true }); await opener.click();
  await expect(context(page)).toBeFocused(); await context(page).dispatchEvent('keydown', { key: 'Escape', isComposing: true });
  await expect(context(page)).toBeVisible(); await page.keyboard.press('Escape'); await expect(context(page)).toHaveCount(0); await expect(opener).toBeFocused();
});
test('first reveal in a short window clears native caption chrome and all viewport edges', async ({ page }) => {
  await page.setViewportSize({ width: 340, height: 240 }); await page.goto('/usage-context');
  await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
  const bounds = (await context(page).boundingBox())!;
  expect(bounds.y).toBeGreaterThanOrEqual(50); expect(bounds.x).toBeGreaterThanOrEqual(8);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(332); expect(bounds.y + bounds.height).toBeLessThanOrEqual(232);
});
test('Requests lists measured requests with stage timings, and absent fields stay unknown', async ({ page }) => {
  await page.goto('/usage-context?requests'); await page.getByRole('button', { name: 'Open Usage', exact: true }).click();
  await usage(page).getByRole('tab', { name: 'Requests', exact: true }).click();
  await expect(usage(page)).toContainText('openai/model'); await expect(usage(page)).toContainText('provider-a');
  await expect(usage(page)).toContainText('completed');
  await expect(usage(page)).toContainText('First output'); await expect(usage(page)).toContainText('1980 ms');
  await expect(usage(page)).toContainText('Cache read'); await expect(usage(page)).toContainText('512');
  // `queued` is an epoch admission point, not an elapsed duration — it renders
  // as a time and never as a millisecond figure.
  const queued = usage(page).locator('.usage-request-stages>li').filter({ hasText: 'Queued' }).first();
  await expect(queued).not.toContainText('ms');
  await expect(usage(page)).toContainText('gemini-cli/model'); await expect(usage(page)).toContainText('failed');
  // Missing measurements render as '—' chips, never as invented zeros.
  await expect(usage(page)).toContainText('—'); await expect(usage(page)).toContainText('Synthetic request failure.');
});
for (const theme of ['dark', 'light']) test(`request outcomes keep fixed semantic colors in ${theme}: completed green, failed red, cancelled neutral (T14/R17)`, async ({ page }) => {
  await page.goto('/usage-context?requests'); await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
  await page.getByRole('button', { name: 'Open Usage', exact: true }).click();
  await usage(page).getByRole('tab', { name: 'Requests', exact: true }).click();
  const outcomeColor = (outcome: string) => usage(page).locator(`.usage-request-outcome-${outcome}`).evaluate(node => getComputedStyle(node).color);
  const tokenColor = (name: string) => page.evaluate(token => { const probe = document.createElement('span'); probe.style.color = `var(${token})`; document.body.appendChild(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; }, name);
  await expect(usage(page).locator('.usage-request-outcome-cancelled')).toContainText('cancelled');
  expect(await outcomeColor('completed')).toBe(await tokenColor('--success-fg'));
  expect(await outcomeColor('failed')).toBe(await tokenColor('--danger-fg'));
  // A cancelled request is a neutral terminal state, never a warning/needs-input amber.
  expect(await outcomeColor('cancelled')).toBe(await tokenColor('--muted'));
  expect(await outcomeColor('cancelled')).not.toBe(await tokenColor('--warning-fg'));
});
test('Usage has separate Cost, Tokens and Limits with exact reported data and per-metric unknowns', async ({ page }) => {
  await page.goto('/usage-context'); await page.getByRole('button', { name: 'Open Usage', exact: true }).click();
  await expect(usage(page)).toBeVisible(); await expect(usage(page)).toContainText('0.00123456 USD');
  await usage(page).getByRole('tab', { name: 'Tokens', exact: true }).click();
  await expect(usage(page)).toContainText('Input tokens'); await expect(usage(page)).toContainText('Not reported');
  await usage(page).getByRole('tab', { name: 'Limits', exact: true }).click();
  await expect(usage(page)).toContainText('23.5%'); await expect(usage(page)).toContainText('2030'); await expect(usage(page)).not.toContainText('2030-01-01T12:34:56Z');
  await expect(usage(page)).not.toContainText('Compact'); await expect(usage(page)).not.toContainText('Thread memory');
});
test('accepted receipt needs exact ownership; measured freed count is optional and reset on restart', async ({ page }) => {
  await page.goto('/usage-context'); await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
  await update(page, 'foreign'); await expect(context(page)).not.toContainText('Freed'); await expect(context(page)).not.toContainText('Context compacted');
  await update(page, 'unmeasured'); await expect(context(page)).toContainText('Context compacted'); await expect(context(page)).not.toContainText('Freed');
  await update(page, 'accepted'); await expect(context(page)).toContainText('Freed 4K tokens');
  await update(page, 'restart'); await expect(context(page)).not.toContainText('Freed');
});
test('reported segments fit their capacity track without cumulative separator overflow', async ({ page }) => {
  await page.goto('/usage-context'); await update(page, 'categories'); await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
  const track = (await context(page).locator('.context-segment-bar').boundingBox())!;
  const end = (await context(page).locator('.context-segment').last().boundingBox())!;
  expect(end.x + end.width).toBeLessThanOrEqual(track.x + track.width + 0.1);
});
test('pending sweep is actual-pending only and stopped state is not accepted success', async ({ page }) => {
  await page.goto('/usage-context'); await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
  await expect(context(page).locator('.context-compaction-shimmer')).toHaveCount(0); await update(page, 'pending');
  await expect(context(page).getByRole('button', { name: 'Compacting…', exact: true })).toBeDisabled();
  await update(page, 'cancelled'); await expect(context(page)).toContainText('Compaction stopped'); await expect(context(page).locator('.context-compaction-shimmer')).toHaveCount(0);
});
test('reported categories reveal token/share/subitems on focus after dwell; IME and nested Escape work', async ({ page }) => {
  await page.goto('/usage-context'); await update(page, 'categories'); await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
  await expect(context(page)).not.toContainText('Session limit'); await expect(context(page)).not.toContainText('Cost');
  const tools = context(page).getByRole('button', { name: 'Tools & MCP', exact: false }); await tools.focus();
  await expect(page.getByRole('tooltip')).toContainText('500 tokens'); await expect(page.getByRole('tooltip')).toContainText('5.0%');
  await expect(page.getByRole('tooltip')).toContainText('Reported tool instructions');
  await tools.dispatchEvent('keydown', { key: 'Escape', isComposing: true }); await expect(page.getByRole('tooltip')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('tooltip')).toHaveCount(0); await expect(context(page)).toBeVisible();
  await page.keyboard.press('Escape'); await expect(context(page)).toHaveCount(0); await expect(page.getByRole('button', { name: 'Inspect context', exact: true })).toBeFocused();
});
test('unknown and invalid category measurements never retain stale values', async ({ page }) => {
  await page.goto('/usage-context'); await update(page, 'categories'); await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
  await expect(context(page)).toContainText('System'); await update(page, 'unknown');
  await expect(context(page)).toContainText('Not reported'); await expect(context(page)).not.toContainText('System'); await expect(context(page)).not.toContainText('6K');
});
test('scope/provider filters remain in the owning modal and refresh preserves tab and selection', async ({ page }) => {
  await page.goto('/usage-context'); await page.getByRole('button', { name: 'Open Usage', exact: true }).click();
  await usage(page).getByRole('tab', { name: 'Tokens', exact: true }).focus(); await page.keyboard.press('ArrowRight');
  await expect(usage(page).getByRole('tab', { name: 'Limits', exact: true })).toHaveAttribute('aria-selected', 'true');
  await usage(page).getByRole('combobox', { name: 'Usage scope', exact: true }).click();
  const list = usage(page).getByRole('listbox', { name: 'Usage scope', exact: true }); await expect(list).toBeVisible();
  await list.getByRole('option', { name: 'Synthetic Alpha', exact: true }).click();
  await usage(page).getByRole('button', { name: 'Refresh usage', exact: true }).click();
  await expect(usage(page).getByRole('tabpanel')).not.toContainText('Synthetic Beta');
  await usage(page).getByRole('combobox', { name: 'Usage provider', exact: true }).click();
  await page.keyboard.press('Escape'); await expect(usage(page)).toBeVisible(); await page.keyboard.press('Escape'); await expect(usage(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open Usage', exact: true })).toBeFocused();
});
test('loading, empty, provider failure and refresh failure preserve honest per-metric state', async ({ page }) => {
  await page.goto('/usage-context'); await update(page, 'loading'); await page.getByRole('button', { name: 'Open Usage', exact: true }).click();
  await expect(usage(page).getByRole('status')).toContainText('Loading usage'); await expect(usage(page)).not.toContainText('No usage recorded');
  await update(page, 'empty'); await expect(usage(page)).toContainText('No usage recorded');
  await update(page, 'error'); await expect(usage(page).getByRole('alert')).toContainText('Synthetic provider failure');
  await update(page, 'refresh-error'); await usage(page).getByRole('button', { name: 'Refresh usage', exact: true }).click();
  await expect(usage(page).getByRole('alert')).toContainText('Synthetic refresh failure'); await expect(usage(page)).toContainText('0.00123456 USD');
});
for (const theme of ['dark', 'light']) test(`overflow keeps header fixed, rows scroll, short/narrow ${theme}`, async ({ page }, info) => {
  await page.setViewportSize({ width: 340, height: 320 }); await page.goto('/usage-context?overflow=1');
  await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
  await page.getByRole('button', { name: 'Open Usage', exact: true }).click();
  const modal = usage(page), rows = modal.getByRole('tabpanel'), header = modal.locator('.ui-modal-header');
  const before = await header.boundingBox(); await rows.evaluate(node => node.scrollTop = node.scrollHeight);
  expect(await header.boundingBox()).toEqual(before); expect(await rows.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  const bounds = (await modal.boundingBox())!; expect(bounds.x).toBeGreaterThanOrEqual(8); expect(bounds.y).toBeGreaterThanOrEqual(50);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(332); expect(bounds.y + bounds.height).toBeLessThanOrEqual(312);
  expect(await modal.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`usage-${theme}-short.png`) });
});
for (const theme of ['dark', 'light']) test(`context category overflow and details stay reachable in ${theme}`, async ({ page }, info) => {
  await page.setViewportSize({ width: 340, height: 320 }); await page.goto('/usage-context');
  await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
  await update(page, 'categories'); await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
  const dialog = context(page), tools = dialog.getByRole('button', { name: /Tools & MCP/ });
  await tools.focus(); await expect(page.getByRole('tooltip')).toContainText('Reported tool instructions');
  const detail = (await page.getByRole('tooltip').boundingBox())!;
  expect(detail.x).toBeGreaterThanOrEqual(8); expect(detail.y).toBeGreaterThanOrEqual(50);
  expect(detail.x + detail.width).toBeLessThanOrEqual(332); expect(detail.y + detail.height).toBeLessThanOrEqual(312);
  await page.screenshot({ path: info.outputPath(`context-${theme}-short.png`) });
  await page.keyboard.press('Escape'); await dialog.getByRole('button', { name: /^Free/ }).focus();
  await expect(page.getByRole('tooltip')).toContainText('3,000 tokens');
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
});
test('accepted transition uses reference timing; reduced motion suppresses travel and sweep', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.goto('/usage-context'); await update(page, 'categories');
  await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
  expect(await context(page).evaluate(node => getComputedStyle(node).animationDuration)).toBe('0.18s');
  await update(page, 'accepted'); await expect(context(page)).toContainText('Freed 4K tokens');
  expect(await context(page).locator('.context-segment').evaluateAll(nodes => nodes.some(node => node.getAnimations().some(animation => animation.effect?.getTiming().duration === 600)))).toBe(true);
  expect(await context(page).locator('.context-segment').first().evaluate(node => getComputedStyle(node).transitionDuration)).toBe('0.6s');
  expect(await context(page).getByRole('status').evaluate(node => getComputedStyle(node).animationDuration)).toBe('0.24s');
  await page.emulateMedia({ reducedMotion: 'reduce' }); await update(page, 'pending');
  await expect(context(page).locator('.context-compaction-shimmer')).toBeHidden();
  expect(await context(page).evaluate(node => getComputedStyle(node).animationName)).toBe('none');
});
test('optional summary keeps whole-header disclosure and opens the same Usage through its independent body action', async ({ page }) => {
  await page.goto('/usage-context'); const summary = page.getByRole('region', { name: 'Live usage', exact: true });
  const header = summary.getByRole('button', { name: 'Inspect live usage', exact: true });
  await header.focus(); await page.keyboard.press('Space'); await expect(summary.getByRole('button', { name: 'Open Usage', exact: true })).toBeVisible();
  await summary.getByRole('button', { name: 'Open Usage', exact: true }).click(); await expect(usage(page)).toBeVisible();
});

test('invalidating a receipt ends accepted motion immediately and after its timer deadline',async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});await page.goto('/usage-context');await update(page,'categories');
  await page.getByRole('button',{name:'Inspect context',exact:true}).click();await update(page,'accepted');
  await expect(context(page).locator('.context-measurement-accepted')).toHaveCount(1);
  await update(page,'cancelled');await expect(context(page)).toContainText('Compaction stopped');
  expect(await context(page).locator('.context-measurement-accepted').count()).toBe(0);
  expect(await context(page).locator('.context-receipt-pulse').count()).toBe(0);
  await expect(context(page).locator('.context-measurement-accepted,.context-receipt-pulse')).toHaveCount(0);
});

test('last request shows observed broker bytes, then drops them on a new epoch', async ({ page }) => {
  await page.goto('/usage-context');
  await update(page, 'request-proof');
  await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
  const last = context(page).getByRole('region', { name: 'Last request' });
  await expect(last).toContainText('13 observed prompt bytes');
  await expect(last).toContainText('Provider tokens and roles were not inferred');
  const tabs = last.getByRole('tablist');
  await expect(tabs.getByRole('tab')).toHaveCount(4);
  await tabs.getByRole('tab', { name: 'Last request' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'Sources' })).toHaveAttribute('aria-selected', 'true');
  await expect(last.getByRole('tabpanel')).toContainText('1 known input');
  await expect(last.getByRole('tabpanel')).toContainText('user · revision 1 · 13 bytes');
  await tabs.getByRole('tab', { name: 'Tools' }).click();
  await expect(last.getByRole('tabpanel')).toContainText('Schema counts were not reported');
  await update(page, 'request-schemas');
  await expect(last.getByRole('tabpanel')).toContainText('7 host tool schemas · 428 serialized bytes');
  await tabs.getByRole('tab', { name: 'Compaction' }).click();
  await expect(last.getByRole('tabpanel')).toContainText('No loss-aware compaction receipt');
  await update(page, 'restart');
  await expect(last).toHaveCount(0);
});

test('shows bounded read-only relevance candidates without claiming native history was compacted', async ({ page }) => {
  await page.goto('/usage-context');
  await update(page, 'request-relevance');
  await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
  await context(page).getByRole('tab', { name: 'Compaction', exact: true }).click();
  const observation = context(page).getByRole('region', { name: 'Read-only relevance observation' });
  await expect(observation).toContainText('1 old host read result for review');
  await expect(observation).toContainText('1.2K bytes potential savings (estimate)');
  await expect(observation).toContainText('Nothing was removed. Native context is opaque');
  await expect(observation).toContainText('2 outside the observation window');
  await observation.getByText('Candidate result observations', { exact: true }).click();
  await expect(observation).toContainText('host-result:1');
  await expect(context(page)).toContainText('No loss-aware compaction receipt');
  await update(page, 'restart');
  await expect(observation).toHaveCount(0);
});

test('compaction details expose retained references and separate byte measurements from unavailable cost', async ({ page }) => {
  await page.goto('/usage-context'); await update(page, 'request-compaction');
  await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
  await context(page).getByRole('tab', { name: 'Compaction', exact: true }).click();
  const candidates = context(page).getByRole('list', { name: 'Compaction candidates' });
  await candidates.getByText('Retained constraint references', { exact: true }).click();
  await expect(candidates).toContainText('DECISION:taskMemory:keep-tests');
  await expect(candidates).toContainText('PENDING_APPROVAL:request:review-change');
  await expect(candidates).toContainText('Estimated reduction: 0 bytes (estimate)');
  await expect(candidates).toContainText('Measured source: 1.2K bytes; measured result: 600 bytes');
  await expect(context(page)).toContainText('Omitted native categories: unavailable');
  await expect(context(page)).toContainText('Complete auxiliary model cost: unavailable');
  await expect(context(page)).toContainText('Recorded admitted candidates: 1');
  await expect(context(page)).toContainText('Historical completeness and provider-call counts are unavailable');
  await expect(context(page)).not.toContainText('cost 0');
});

test('compaction details keep absent estimates and measurements unavailable', async ({ page }) => {
  await page.goto('/usage-context'); await update(page, 'request-compaction-unavailable');
  await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
  await context(page).getByRole('tab', { name: 'Compaction', exact: true }).click();
  const candidates = context(page).getByRole('list', { name: 'Compaction candidates' });
  await expect(candidates).toContainText('failed');
  await expect(candidates).toContainText('Estimated reduction: unavailable');
  await expect(candidates).toContainText('Measured source: unavailable; measured result: unavailable');
  await expect(context(page)).toContainText('Recorded admitted candidates: 1 · 0 discarded · 1 failed');
  await expect(context(page)).toContainText('Auxiliary byte accounting: unavailable');
  await expect(context(page)).not.toContainText('0 bytes (estimate)');
});

test('compaction details keep a recovered candidate without a receipt unconfirmed', async ({ page }) => {
  await page.goto('/usage-context'); await update(page, 'request-compaction-unconfirmed');
  await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
  await context(page).getByRole('tab', { name: 'Compaction', exact: true }).click();
  await expect(context(page)).toContainText('Native outcome unconfirmed. No applied receipt was recorded.');
  await expect(context(page)).toContainText('Measured source: unavailable; measured result: unavailable');
  await expect(context(page)).not.toContainText('Context compacted');
  await expect(context(page)).not.toContainText('Freed');
});

test('compaction details page long retained-reference lists without hiding their remaining count', async ({ page }) => {
  await page.goto('/usage-context'); await update(page, 'request-compaction-many');
  await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
  await context(page).getByRole('tab', { name: 'Compaction', exact: true }).click();
  const candidates = context(page).getByRole('list', { name: 'Compaction candidates' });
  await candidates.getByText('Retained constraint references', { exact: true }).click();
  const references = candidates.getByRole('list', { name: 'Retained constraint references' });
  await expect(references.getByRole('listitem')).toHaveCount(32);
  await expect(candidates).toContainText('Showing 32 of 34 references');
  await candidates.getByRole('button', { name: 'Show 2 more references', exact: true }).click();
  await expect(references.getByRole('listitem')).toHaveCount(34);
  await expect(references).toContainText('native-record:' + 'd'.repeat(64) + ':33');
  await expect(candidates.getByRole('button', { name: /more references/ })).toHaveCount(0);
  expect(await references.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
});

test('compaction history stays visible after maintenance advances the epoch without reviving old request bytes', async ({ page }) => {
  await page.goto('/usage-context'); await update(page, 'request-compaction');
  const opener = page.getByRole('button', {name: 'Inspect context', exact: true});
  await opener.click(); await context(page).getByRole('tab', {name: 'Compaction', exact: true}).click();
  await expect(context(page).getByRole('list', {name: 'Compaction candidates'})).toBeVisible();
  await update(page, 'restart');
  const history = context(page).getByRole('region', {name: 'Compaction history', exact: true});
  await expect(history).toBeVisible();
  await expect(history.getByRole('tab', {name: 'Compaction', exact: true})).toHaveAttribute('aria-selected', 'true');
  await expect(history.getByRole('list', {name: 'Compaction candidates'})).toBeVisible();
  await expect(context(page).getByRole('region', {name: 'Last request', exact: true})).toHaveCount(0);
  await history.getByRole('tab', {name: 'Last request', exact: true}).click();
  await expect(history.getByRole('tabpanel')).toContainText('Current request observation unavailable');
  await expect(context(page)).not.toContainText('13 observed prompt bytes');
  await page.keyboard.press('Escape'); await opener.click();
  await expect(history.getByRole('list', {name: 'Compaction candidates'})).toBeVisible();
});

for (const field of ['project', 'workspace', 'model', 'account', 'session']) test(`compaction history rejects cached ${field} ownership across close and reopen`, async ({ page }) => {
  await page.goto('/usage-context'); await update(page, 'request-compaction-project');
  const opener = page.getByRole('button', {name: 'Inspect context', exact: true});
  await opener.click(); await context(page).getByRole('tab', {name: 'Compaction', exact: true}).click();
  await expect(context(page).getByRole('list', {name: 'Compaction candidates'})).toBeVisible();
  await update(page, field === 'session' ? 'session' : 'compaction-owner-' + field);
  await expect(context(page).getByRole('list', {name: 'Compaction candidates'})).toHaveCount(0);
  await page.keyboard.press('Escape'); await update(page, 'clone-compaction'); await opener.click();
  await context(page).getByRole('tab', {name: 'Compaction', exact: true}).click();
  await expect(context(page).getByRole('list', {name: 'Compaction candidates'})).toHaveCount(0);
  await expect(context(page)).not.toContainText('DECISION:taskMemory:keep-tests');
});

test('compaction history rejects an owner change while the inspector has never been opened', async ({ page }) => {
  await page.goto('/usage-context'); await update(page, 'request-compaction-project');
  await update(page, 'compaction-owner-project'); await update(page, 'clone-compaction');
  await page.getByRole('button', {name: 'Inspect context', exact: true}).click();
  await context(page).getByRole('tab', {name: 'Compaction', exact: true}).click();
  await expect(context(page).getByRole('list', {name: 'Compaction candidates'})).toHaveCount(0);
});

test('compaction history uses the selected host usage row when request observation is disabled', async ({ page }) => {
  await page.goto('/usage-context'); await update(page, 'request-compaction-no-observation');
  await update(page, 'restart');
  const opener = page.getByRole('button', {name: 'Inspect context', exact: true}); await opener.click();
  await expect(context(page).getByRole('region', {name: 'Compaction history', exact: true})).toBeVisible();
  await expect(context(page).getByRole('list', {name: 'Compaction candidates'})).toBeVisible();
  await expect(context(page).getByRole('region', {name: 'Last request', exact: true})).toHaveCount(0);
  await page.keyboard.press('Escape'); await opener.click();
  await expect(context(page).getByRole('list', {name: 'Compaction candidates'})).toBeVisible();
});

for (const owner of ['no-usage-owner', 'foreign-usage-owner']) test(`compaction history without observations rejects ${owner}`, async ({ page }) => {
  await page.goto('/usage-context?' + owner); await update(page, 'request-compaction-no-observation');
  await page.getByRole('button', {name: 'Inspect context', exact: true}).click();
  await expect(context(page).getByRole('list', {name: 'Compaction candidates'})).toHaveCount(0);
});

test('a selected host usage row never overrides a conflicting request witness', async ({ page }) => {
  await page.goto('/usage-context'); await update(page, 'request-compaction'); await update(page, 'foreign-request-witness');
  await page.getByRole('button', {name: 'Inspect context', exact: true}).click();
  await expect(context(page).getByRole('list', {name: 'Compaction candidates'})).toHaveCount(0);
});

test('shows admitted instruction revisions, overlap precedence and refused directives in the existing Sources tab', async ({ page }) => {
  await page.goto('/usage-context'); await update(page, 'request-instructions');
  await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
  await context(page).getByRole('tab', { name: 'Sources', exact: true }).click();
  const instructions = context(page).getByRole('region', { name: 'Approved project instructions' });
  await expect(instructions).toContainText('AGENTS.md · resource project · scope approved-root · precedence 0 · 120 bytes');
  await expect(instructions).toContainText('SHA-256 ' + 'c'.repeat(64));
  await expect(instructions).toContainText('Host authorization always takes precedence');
  await expect(instructions).toContainText('Overlapping instruction sources');
  await expect(instructions).toContainText('semantic contradictions were not inferred');
  await expect(instructions).toContainText('GEMINI.md · resource project · excluded: unsupported directive');
});

test('distinguishes incremental native source metadata from the opaque provider request', async ({ page }) => {
  await page.goto('/usage-context'); await update(page, 'request-native-sources');
  await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
  await expect(context(page)).toContainText('120 observed prompt bytes');
  await expect(context(page)).toContainText('Native context is opaque');
  await context(page).getByRole('tab', { name: 'Sources', exact: true }).click();
  const native = context(page).getByRole('region', { name: 'Original Hermes source metadata' });
  await expect(native).toContainText('Source generation 1 · 3 source records · 90 serialized source bytes');
  await expect(native).toContainText('2 compiled records reused · 1 new records compiled');
  await expect(native).toContainText('native worker fingerprinted 3 records');
  await expect(native).toContainText('Provider context remains opaque; tokens were not inferred');
  await expect(native).toContainText('tool · native:1:2 · revision 1 · 40 bytes');
  await expect(native).toContainText('c'.repeat(64));
  await update(page, 'restart'); await expect(native).toHaveCount(0);
});

test('reports unavailable native source metadata without claiming a reconstructed context', async ({ page }) => {
  await page.goto('/usage-context'); await update(page, 'request-native-unavailable');
  await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
  await context(page).getByRole('tab', { name: 'Sources', exact: true }).click();
  await expect(context(page)).toContainText('Native source capture unavailable: source limit');
  await expect(context(page).getByRole('region', { name: 'Original Hermes source metadata' })).toHaveCount(0);
});

test('shows actual next-inference bytes while keeping provider input, cache and context reports separate', async ({ page }) => {
  await page.goto('/usage-context'); await update(page, 'budget-known');
  await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
  const budget = context(page).getByRole('region', { name: 'Next inference budget' });
  await expect(budget).toContainText('Request 2: 220 prompt bytes');
  await expect(budget).toContainText('12 provider-reported input tokens; 80 cache-read tokens');
  await expect(budget).toContainText('Reported context: 5K tokens');
  await expect(budget).toContainText('not substituted for input usage');
  await expect(budget).toContainText('100 native source bytes, including 80 tool-result bytes across 1 result');
  await expect(budget).toContainText('actual output reserve were not reported');
  await expect(budget).toContainText('No automatic compaction decision');
  await update(page, 'restart'); await expect(budget).toHaveCount(0);
});

test('shows a blocked byte admission even when no provider request was dispatched', async ({ page }) => {
  await page.goto('/usage-context'); await update(page, 'budget-blocked');
  await page.getByRole('button', { name: 'Inspect context', exact: true }).click();
  const budget = context(page).getByRole('region', { name: 'Next inference budget' });
  await expect(budget).toContainText('Request blocked by the host byte limit. No provider call was started.');
  await expect(budget).toContainText('Source continuity is unavailable');
  await expect(budget).toContainText('Token budget unavailable');
  await expect(context(page).getByRole('region', { name: 'Last request', exact: true })).toHaveCount(0);
  await update(page, 'thread'); await expect(budget).toHaveCount(0);
});

test('Requests can filter measured providers even when no usage report exists', async ({ page }) => {
  await page.goto('/usage-context?requests'); await update(page, 'empty');
  await page.getByRole('button', { name: 'Open Usage', exact: true }).click();
  const modal = usage(page);
  await modal.getByRole('tab', { name: 'Requests', exact: true }).click();
  const panel = modal.getByRole('tabpanel');
  await expect(panel).toContainText('openai/model');
  await expect(panel).toContainText('gemini-cli/model');
  await modal.getByRole('combobox', { name: 'Usage provider', exact: true }).click();
  await modal.getByRole('option', { name: 'provider-b', exact: true }).click();
  await expect(panel).toContainText('gemini-cli/model');
  await expect(panel).not.toContainText('openai/model');
  await expect(modal.getByRole('combobox', { name: 'Usage scope', exact: true })).toHaveCount(0);
  await modal.getByRole('tab', { name: 'Cost', exact: true }).click();
  await expect(modal.getByRole('combobox', { name: 'Usage scope', exact: true })).toBeVisible();
});

const compactionCostUrl = '/api/threads/thread-one/compaction/candidate-visible/model-requests';
const compactionRequest = (sequence: number, cost: number | null = 0.125): import('../../packages/contracts/model-request').ModelRequestObservationV1 => ({
  version: 1, requestId: 'compaction-request-' + sequence,
  owner: {threadId: 'thread-one', runId: 'compaction:candidate-visible', epoch: 1, sequence, inputIds: [], phase: 'foreground'},
  binding: {providerId: 'openai', modelId: 'openai/model', accountId: null},
  timings: {queued: 1700000000000, acquired: 1, runtimeReady: 2, requestSent: 3, firstProviderDelta: null, firstPublicDelta: null, settled: 5, teardownConfirmed: 6},
  usage: {inputTokens: 12, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, cost},
  usageConvention: 'provider-reported', measurementSource: 'scripted-component-fixture', outcome: 'failed',
});
const costRegion = (page: Page) => context(page).getByRole('region', {name: 'Compaction model costs', exact: true});
const costChip = (page: Page, sequence: number) => costRegion(page).getByRole('region', {name: 'Model request ' + sequence, exact: true})
  .locator('.usage-request-metrics > li').filter({has: page.getByText('Cost', {exact: true})}).locator('.usage-request-chip-value');
async function openCompactionCosts(page: Page, action = 'request-compaction-unavailable') {
  await page.goto('/usage-context'); await update(page, action);
  await page.getByRole('button', {name: 'Inspect context'}).click();
  await context(page).getByRole('tab', {name: 'Compaction', exact: true}).click();
}

test('compaction model costs show failed observations, reported zero and unknown without a total', async ({page}, info) => {
  await page.setViewportSize({width: 340, height: 420});
  const zero = {...compactionRequest(2, 0), outcome: 'completed' as const}, unknown = {...compactionRequest(3, null), outcome: 'cancelled' as const};
  await page.route('**' + compactionCostUrl, route => route.fulfill({json: [compactionRequest(1), zero, unknown]}));
  await openCompactionCosts(page);
  await costRegion(page).getByRole('button', {name: 'Load model request costs', exact: true}).click();
  await expect(costChip(page, 1)).toHaveText('0.125 (currency not reported)');
  await expect(costRegion(page).getByRole('region', {name: 'Model request 1', exact: true})).toContainText('failed');
  await expect(costChip(page, 2)).toHaveText('0 (currency not reported)');
  await expect(costChip(page, 3)).toHaveText('—');
  await expect(costRegion(page)).toContainText('Complete spend is unavailable.');
  await expect(costRegion(page)).toContainText('unreported or interrupted requests');
  await costChip(page, 1).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: info.outputPath('compaction-retained-model-costs.png'), fullPage: true});
});

test('compaction model costs page older observations with the exact owned request cursor', async ({page}) => {
  const cursors: Array<string | null> = [];
  await page.route('**' + compactionCostUrl + '*', route => {
    const before = new URL(route.request().url()).searchParams.get('beforeRequestId'); cursors.push(before);
    return route.fulfill({json: before === null ? Array.from({length: 64}, (_, i) => compactionRequest(66 - i)) : [compactionRequest(2), compactionRequest(1)]});
  });
  await openCompactionCosts(page); await costRegion(page).getByRole('button', {name: 'Load model request costs', exact: true}).click();
  await expect(costRegion(page).locator('.usage-request')).toHaveCount(64);
  await costRegion(page).getByRole('button', {name: 'Load older model requests', exact: true}).click();
  await expect(costRegion(page).locator('.usage-request')).toHaveCount(66);
  expect(cursors).toEqual([null, 'compaction-request-3']);
  await expect(costRegion(page).getByRole('button', {name: 'Load older model requests', exact: true})).toHaveCount(0);
  await expect(costRegion(page)).toContainText('Complete spend is unavailable.');
});

test('compaction model costs reject an older page that repeats an already displayed request', async ({page}) => {
  await page.route('**' + compactionCostUrl + '*', route => route.fulfill({json: new URL(route.request().url()).searchParams.has('beforeRequestId')
    ? [compactionRequest(64)] : Array.from({length: 64}, (_, i) => compactionRequest(64 - i))}));
  await openCompactionCosts(page); await costRegion(page).getByRole('button', {name: 'Load model request costs', exact: true}).click();
  await expect(costRegion(page).locator('.usage-request')).toHaveCount(64);
  await costRegion(page).getByRole('button', {name: 'Load older model requests', exact: true}).click();
  await expect(costRegion(page)).toContainText('Compaction measurement response could not be verified.');
  await expect(costRegion(page).locator('.usage-request')).toHaveCount(0);
});

test('compaction model costs keep missing measurements unknown and clear retained rows after a denied refresh', async ({page}) => {
  let reads = 0;
  await page.route('**' + compactionCostUrl, route => ++reads === 1 ? route.fulfill({json: []}) : reads === 2 ? route.fulfill({json: [compactionRequest(1)]})
    : route.fulfill({status: 403, json: {error: {code: 'CAPABILITY_DENIED', message: 'Compaction measurements are unavailable for this owner.'}}}));
  await openCompactionCosts(page); await costRegion(page).getByRole('button', {name: 'Load model request costs', exact: true}).click();
  await expect(costRegion(page)).toContainText('No retained model request measurements are available.');
  await expect(costRegion(page).locator('.usage-request')).toHaveCount(0);
  await costRegion(page).getByRole('button', {name: 'Refresh model request costs', exact: true}).click();
  await expect(costChip(page, 1)).toHaveText('0.125 (currency not reported)');
  await costRegion(page).getByRole('button', {name: 'Refresh model request costs', exact: true}).click();
  await expect(costRegion(page)).toContainText('Compaction measurements are unavailable for this owner.');
  await expect(costRegion(page).locator('.usage-request')).toHaveCount(0);
});

for (const field of ['project', 'workspace', 'model', 'account', 'session', 'thread']) test(`compaction model costs discard pending ${field} responses across owner changes`, async ({page}) => {
  let release: (() => Promise<void>) | undefined;
  await page.route('**' + compactionCostUrl, route => {release = () => route.fulfill({json: [compactionRequest(1, 987.654)]});});
  await openCompactionCosts(page, 'request-compaction-project');
  await costRegion(page).getByRole('button', {name: 'Load model request costs', exact: true}).click();
  await expect(costRegion(page).getByRole('status')).toHaveText('Loading model request costs…');
  await expect.poll(() => Boolean(release)).toBe(true);
  await update(page, field === 'session' || field === 'thread' ? field : 'compaction-owner-' + field);
  await release!();
  await expect(context(page).locator('.usage-request')).toHaveCount(0);
  await update(page, 'clone-compaction'); await page.keyboard.press('Escape');
  await page.getByRole('button', {name: 'Inspect context'}).click();
  await expect(context(page).locator('.usage-request')).toHaveCount(0);
  await expect(page.getByText('987.654 (currency not reported)', {exact: true})).toHaveCount(0);
});

test('compaction model costs reread after close and maintenance epoch advance without accepting a late response', async ({page}) => {
  let reads = 0, release: (() => Promise<void>) | undefined;
  await page.route('**' + compactionCostUrl, route => {
    if (++reads === 1) {release = () => route.fulfill({json: [compactionRequest(1, 987.654)]}); return;}
    return route.fulfill({json: [compactionRequest(1, 0)]});
  });
  await openCompactionCosts(page); await costRegion(page).getByRole('button', {name: 'Load model request costs', exact: true}).click();
  await expect.poll(() => Boolean(release)).toBe(true); await page.keyboard.press('Escape');
  await update(page, 'restart'); await page.getByRole('button', {name: 'Inspect context'}).click();
  await expect(costRegion(page).locator('.usage-request')).toHaveCount(0);
  await costRegion(page).getByRole('button', {name: 'Load model request costs', exact: true}).click();
  await expect(costChip(page, 1)).toHaveText('0 (currency not reported)');
  await release!(); await expect(costChip(page, 1)).toHaveText('0 (currency not reported)');
  expect(reads).toBe(2); await expect(context(page)).toContainText('Current request observation unavailable.');
});

for (const invalid of ['foreign thread', 'foreign candidate', 'foreign account', 'future epoch', 'duplicate', 'negative cost']) test(`compaction model costs reject ${invalid} response data`, async ({page}) => {
  const value = compactionRequest(1);
  if (invalid === 'foreign thread') value.owner.threadId = 'foreign';
  if (invalid === 'foreign candidate') value.owner.runId = 'compaction:foreign';
  if (invalid === 'foreign account') value.binding.accountId = 'foreign';
  if (invalid === 'future epoch') value.owner.epoch++;
  if (invalid === 'negative cost') value.usage.cost = -1;
  await page.route('**' + compactionCostUrl, route => route.fulfill({json: invalid === 'duplicate' ? [value, value] : [value]}));
  await openCompactionCosts(page); await costRegion(page).getByRole('button', {name: 'Load model request costs', exact: true}).click();
  await expect(costRegion(page)).toContainText('Compaction measurement response could not be verified.');
  await expect(costRegion(page).locator('.usage-request')).toHaveCount(0);
});
