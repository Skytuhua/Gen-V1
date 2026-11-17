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
const findingModel = (freshness = 'CURRENT') => ({verification: {
  label: null, staleBanner: false, summary: {verified: 0, failed: 0, unverified: 0, blocked: 0, missing: []}, rows: [],
  securityFindings: {truncated: false, invalid: 0, items: [{version: 1, findingId: 'review-input',
    source: {path: 'src/' + 'long-source-'.repeat(12) + '.ts', blobSha: 'a'.repeat(40), line: 17},
    authorizedScope: 'Read-only approved workspace source', observation: '<img src=x onerror="window.findingExecuted=true">',
    impact: 'Input reaches the reviewed operation', status: 'OPEN', reproduction: 'Inspect the named source at line 17',
    createdAt: '2026-11-17T07:00:00.000Z', updatedAt: '2026-11-17T07:01:00.000Z', evidenceQuality: 'ADVISORY',
    freshness, scopeAuthority: 'HOST_RECORDED', executionId: 'qa-review-execution'}]},
}});
test('security findings reveal source evidence with the keyboard without grading the task or executing observation text', async ({page}, info) => {
  await page.setViewportSize({width: 340, height: 420});
  await page.route('**/api/threads/thread-one/verification', route => route.fulfill({json: findingModel()}));
  await page.goto('/usage-context?verification&canvas');
  const findings = verification(page).getByRole('region', {name: 'Security findings', exact: true});
  await expect(findings.getByRole('heading', {name: 'Security findings', exact: true})).toBeVisible();
  const trigger = findings.locator('summary'); await trigger.focus(); await page.keyboard.press('Enter');
  await expect(findings.getByLabel('Source blob', {exact: true})).toHaveText('a'.repeat(40));
  await expect(findings.getByLabel('Source line', {exact: true})).toHaveText('17');
  await expect(findings.getByLabel('Evidence quality', {exact: true})).toHaveText('ADVISORY');
  await expect(findings.getByLabel('Recorded observation', {exact: true})).toHaveText('<img src=x onerror="window.findingExecuted=true">');
  await expect(findings.getByLabel('Scope authority', {exact: true})).toHaveText('Recorded by host');
  await page.keyboard.press('Tab');
  await expect(findings.getByLabel('Recorded observation', {exact: true}).locator('pre')).toBeFocused();
  await expect(findings.getByLabel('Recorded observation', {exact: true}).locator('pre')).toBeInViewport();
  await page.screenshot({path: info.outputPath('security-finding-observation.png'), fullPage: true});
  await expect(verification(page).getByText('Verified', {exact: true})).toHaveCount(0);
  await expect(verification(page).locator('.verification-outcome.pass')).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, 'findingExecuted'))).toBeUndefined();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('textbox', {name: 'Reply', exact: true})).toBeInViewport();
  await page.getByRole('textbox', {name: 'Reply', exact: true}).fill('Findings remain advisory.');
  await page.screenshot({path: info.outputPath('security-finding-short-canvas.png'), fullPage: true});
});
test('security finding refresh reports stale evidence and bounded results, then clears on conversation change', async ({page}) => {
  let reads = 0;
  await page.clock.install();
  await page.route('**/api/threads/thread-one/verification', route => {
    const model = findingModel(++reads === 1 ? 'CURRENT' : 'STALE');
    model.verification.securityFindings.truncated = true; model.verification.securityFindings.invalid = 1;
    return route.fulfill({json: model});
  });
  await page.route('**/api/threads/thread-two/verification', () => {});
  await page.goto('/usage-context?verification');
  const findings = verification(page).getByRole('region', {name: 'Security findings', exact: true});
  await findings.locator('summary').click();
  await expect(findings.getByLabel('Current source freshness', {exact: true})).toHaveText('CURRENT');
  await expect(findings).toContainText('Showing the 50 most recent stored records.');
  await expect(findings).toContainText('1 stored record could not be read.');
  await page.clock.runFor(4000);
  await expect(findings.getByLabel('Current source freshness', {exact: true})).toHaveText('STALE');
  await expect(findings.getByLabel('Recorded status', {exact: true})).toHaveText('OPEN');
  await page.getByRole('button', {name: 'Second conversation', exact: true}).click();
  await expect(page.getByRole('region', {name: 'Security findings', exact: true})).toHaveCount(0);
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
  await expect(usage(page).getByRole('status')).toContainText('Loading usage'); await expect(usage(page)).not.toContainText('No usage reported');
  await update(page, 'empty'); await expect(usage(page)).toContainText('No usage reported');
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


const workflowControls = (change: Partial<import('../../packages/contracts/verification-repair.ts').VerificationWorkflowView> = {}): import('../../packages/contracts/verification-repair.ts').VerificationWorkflowView => ({
  ownerKey: 'owner-one', executionId: 'execution-one', recipeId: 'recipe-one', qa: false, canRerun: true, canStartRepair: true,
  unavailableReason: null, suggestedBudget: {tokens: 0, ms: 900_000}, repair: null, ...change,
});
const repairProgress = (change: Partial<NonNullable<ReturnType<typeof workflowControls>['repair']>> = {}): NonNullable<ReturnType<typeof workflowControls>['repair']> => ({
  planId: 'repair-one', revision: 2, attempts: 0, maxAttempts: 3, state: 'AWAITING_APPROVAL', remainingTokens: 2500, reservedTokens: 0,
  remainingMs: 60_000, deadline: '2030-01-01T00:01:00.000Z', stopped: null, stopDetail: null, unavailableReason: null, canContinue: false, canStop: true, ...change,
});
for (const status of [403, 409]) test(`verification shows pending and denied reruns without removing historical rows (HTTP ${status})`, async ({page}) => {
  const commands: {type: string; threadId: string; payload: unknown}[] = [];
  let reply!: () => Promise<void>;
  await page.route('**/api/threads/thread-one/verification', route => route.fulfill({json: {verification: {...verificationResult('Retained prior check').verification, workflow: workflowControls()}}}));
  await page.route('**/api/commands', route => {
    commands.push(route.request().postDataJSON());
    reply = () => route.fulfill({status, json: {error: {code: status === 409 ? 'STALE_REVISION' : 'APPROVAL_REQUIRED', message: 'Review the current verification before retrying.'}}});
  });
  await page.goto('/usage-context?verification');
  const rerun = verification(page).getByRole('button', {name: 'Rerun checks', exact: true});
  await rerun.click(); await expect.poll(() => commands.length).toBe(1);
  await expect(rerun).toBeDisabled(); await expect(verification(page)).toContainText('Preparing rerun...');
  await expect(verification(page)).toContainText('Retained prior check');
  expect(commands[0]).toMatchObject({type: 'verification.rerun', threadId: 'thread-one', payload: {executionId: 'execution-one'}});
  await reply();
  await expect(verification(page).getByRole('alert')).toHaveText('Review the current verification before retrying.');
  await expect(rerun).toBeEnabled(); expect(commands).toHaveLength(1);
});

test('verification exposes the three-attempt budget and keyboard Stop inside a short canvas', async ({page}, info) => {
  let workflow = workflowControls({qa: true, suggestedBudget: {tokens: 3000, ms: 900_000}});
  const commands: {type: string; threadId: string; payload: unknown}[] = [];
  await page.setViewportSize({width: 340, height: 420});
  await page.route('**/api/threads/thread-one/verification', route => route.fulfill({json: {verification: {...verificationResult('Retained failing check').verification, workflow}}}));
  await page.route('**/api/commands', route => {
    const request = route.request().postDataJSON(); commands.push(request);
    workflow = request.type === 'verification.repair.start'
      ? {...workflow, canRerun: false, canStartRepair: false, repair: repairProgress()}
      : {...workflow, canRerun: true, repair: repairProgress({revision: 3, state: 'STOPPED', stopped: 'CANCELLED', canStop: false})};
    return route.fulfill({json: {commandId: request.id, eventSeq: commands.length, result: {}}});
  });
  await page.goto('/usage-context?verification&canvas');
  await verification(page).getByRole('spinbutton', {name: 'Repair time limit (seconds)', exact: true}).fill('60');
  await verification(page).getByRole('spinbutton', {name: 'Repair QA token budget', exact: true}).fill('2500');
  await verification(page).getByRole('button', {name: 'Start bounded repair', exact: true}).click();
  await expect(verification(page)).toContainText('0 of 3 attempts used');
  await expect(verification(page)).toContainText('Awaiting approval');
  await expect(verification(page)).toContainText('Review and approve the prepared operation');
  await expect(verification(page)).toContainText('2500 QA tokens remaining');
  expect(commands[0]).toMatchObject({type: 'verification.repair.start', payload: {executionId: 'execution-one', budget: {tokens: 2500, ms: 60_000}}});
  const stop = verification(page).getByRole('button', {name: 'Stop repair', exact: true});
  await expect(stop).toBeEnabled(); await stop.focus(); await page.keyboard.press('Enter');
  await expect(verification(page)).toContainText('Stop reason: Cancelled');
  await expect(stop).toBeDisabled();
  expect(commands[1]).toMatchObject({type: 'verification.repair.stop', threadId: 'thread-one', payload: {planId: 'repair-one', revision: 2}});
  await expect(verification(page)).toContainText('Retained failing check');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('textbox', {name: 'Reply', exact: true}).fill('The composer remains available.');
  await expect(page.getByRole('textbox', {name: 'Reply', exact: true})).toBeInViewport();
  await verification(page).getByText('Bounded repair', {exact: true}).scrollIntoViewIfNeeded();
  await page.screenshot({path: info.outputPath('verification-repair-short-canvas.png'), fullPage: true});
});

test('verification explains an unchanged-failure stop and preserves the active-parent prerequisite for QA', async ({page}) => {
  await page.route('**/api/threads/thread-one/verification', route => route.fulfill({json: {verification: {...verificationResult('Previous failure').verification,
    workflow: workflowControls({qa: true, canRerun: false, canStartRepair: false, unavailableReason: 'Resume this task before preparing checks that include QA.',
      repair: repairProgress({state: 'STOPPED', stopped: 'UNCHANGED_FAILURE', attempts: 1, canStop: false})})}}}));
  await page.goto('/usage-context?verification');
  await expect(verification(page)).toContainText('Repeated unchanged failure');
  await expect(verification(page)).toContainText('Resume this task before preparing checks that include QA.');
  await expect(verification(page)).toContainText('1 of 3 attempts used');
  await expect(verification(page).getByRole('button', {name: 'Prepare next attempt', exact: true})).toHaveCount(0);
  await expect(verification(page).getByRole('button', {name: 'Rerun checks', exact: true})).toBeDisabled();
  await expect(verification(page).getByRole('button', {name: 'Start bounded repair', exact: true})).toHaveCount(0);
});

test('verification does not retry a prior-owner command after an authentication refresh', async ({page}) => {
  const commands: {type: string; threadId: string}[] = [];
  let reply!: () => Promise<void>;
  await page.route('**/api/threads/thread-one/verification', route => route.fulfill({json: {verification: {...verificationResult('First evidence').verification, workflow: workflowControls()}}}));
  await page.route('**/api/threads/thread-two/verification', route => route.fulfill({json: {verification: {...verificationResult('Second evidence').verification, workflow: workflowControls({ownerKey: 'owner-two', executionId: 'execution-two'})}}}));
  await page.route('**/api/commands', route => {commands.push(route.request().postDataJSON()); reply = () => route.fulfill({status: 401, json: {error: {code: 'UNAUTHENTICATED', message: 'Old owner session expired.'}}});});
  await page.goto('/usage-context?verification');
  await verification(page).getByRole('button', {name: 'Rerun checks', exact: true}).click();
  await expect.poll(() => commands.length).toBe(1);
  await page.getByRole('button', {name: 'Second conversation', exact: true}).click();
  await expect(verification(page)).toContainText('Second evidence');
  const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/bootstrap');
  await reply(); await (await refreshed).finished(); await page.evaluate(() => Promise.resolve());
  expect(commands).toEqual([expect.objectContaining({type: 'verification.rerun', threadId: 'thread-one'})]);
  await expect(verification(page)).not.toContainText('Old owner session expired');
  await expect(verification(page)).not.toContainText('First evidence');
  await expect(verification(page).getByRole('button', {name: 'Rerun checks', exact: true})).toBeEnabled();
});
