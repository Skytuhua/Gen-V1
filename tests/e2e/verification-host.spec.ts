import {randomUUID} from 'node:crypto';
import {rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {Page, TestInfo} from '@playwright/test';
import type {Operation, Thread} from '../../packages/contracts/index.ts';
import type {ApprovalV1, ToolEffectRecord} from '../../packages/contracts/tool-effects.ts';
import type {VerificationIntent} from '../../packages/contracts/verification-workflow.ts';
import type {VerificationPanelModel} from '../../packages/core/verification-read-models.ts';
import {INJECTED_LOG, VERIFICATION_CHANGED_SOURCE, VERIFICATION_FIXTURE_LABEL, VERIFICATION_HOST_URL, VERIFICATION_REPAIR_PROMPT, type VerificationHostFixture, test, expect} from '../verification-host-fixture.ts';

// No page.route, mocked fetch/SSE, direct approval/observation insert, native
// guard replacement, user project, provider call or real process execution.
const panel = (page: Page) => page.getByRole('region', {name: 'Verification', exact: true});
async function post(page: Page, type: string, payload: unknown, threadId: string, id = randomUUID()) {
  return page.evaluate(async command => {
    const bootstrap = await fetch('/api/bootstrap').then(response => response.json());
    const response = await fetch('/api/commands', {method: 'POST', headers: {'content-type': 'application/json', 'x-harness-csrf': bootstrap.csrfToken}, body: JSON.stringify(command)});
    return {status: response.status, body: await response.json()};
  }, {id, type, threadId, payload});
}
async function readVerification(page: Page, threadId: string): Promise<VerificationPanelModel> {
  const result = await page.evaluate(async id => {
    const response = await fetch(`/api/threads/${id}/verification`, {cache: 'no-store'});
    return {status: response.status, body: await response.json()};
  }, threadId);
  expect(result.status).toBe(200);
  return result.body.verification;
}
async function receipt(info: TestInfo, name: string, value: unknown) {
  const path = info.outputPath(name);
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
  await info.attach(name, {path, contentType: 'application/json'});
}
async function createProject(page: Page, host: VerificationHostFixture, prompt = 'Keep this parent task open while its verification is reviewed.') {
  await page.goto(VERIFICATION_HOST_URL);
  await expect(page.getByRole('textbox', {name: 'Message', exact: true})).toBeVisible();
  await expect(page.getByRole('combobox', {name: 'Model', exact: true})).toHaveText(VERIFICATION_FIXTURE_LABEL);
  expect((await page.context().cookies()).find(cookie => cookie.name === 'harness_session')).toMatchObject({httpOnly: true, sameSite: 'Strict'});
  expect(await page.evaluate(async () => (await fetch('/api/snapshot', {credentials: 'omit'})).status)).toBe(401);
  await page.getByRole('button', {name: 'New thread', exact: true}).click();
  await page.getByRole('button', {name: 'Add project', exact: true}).click();
  const connection = page.getByRole('dialog', {name: 'Connect project', exact: true});
  await connection.getByRole('textbox', {name: 'Project name', exact: true}).fill('Verification contract project');
  await connection.getByRole('textbox', {name: 'Local folder', exact: true}).fill(host.projectPath);
  await connection.getByRole('button', {name: 'Connect project', exact: true}).click();
  await page.getByRole('option', {name: 'Verification contract project', exact: true}).click();
  await expect(page.getByRole('dialog', {name: 'Select project', exact: true})).toHaveCount(0);
  await expect.poll(() => host.store.snapshot().threads.length).toBe(1);
  const thread = host.store.snapshot().threads[0]!;
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await page.getByRole('dialog', {name: 'Settings', exact: true}).getByRole('button', {name: 'Projects & Working Copies', exact: true}).click();
  await page.getByRole('button', {name: 'Add resource', exact: true}).click();
  const resource = page.getByRole('dialog', {name: 'Add a resource', exact: true});
  await resource.getByRole('combobox', {name: 'Resource type', exact: true}).click();
  await resource.getByRole('option', {name: 'File', exact: true}).click();
  await resource.getByRole('textbox', {name: 'Absolute local path', exact: true}).fill(host.sourcePath);
  await resource.getByRole('button', {name: 'Add resource', exact: true}).click();
  await expect(resource).toHaveCount(0);
  expect(host.store.snapshot().resources).toEqual([expect.objectContaining({threadId: thread.id, path: host.sourcePath, writable: false})]);
  if (host.configured) await host.configureProject(thread);
  await page.getByRole('textbox', {name: 'Message', exact: true}).fill(prompt);
  await page.getByRole('button', {name: 'Send message', exact: true}).click();
  await expect.poll(() => host.runtime.deliveries.length).toBe(1);
  await expect(page.getByText(VERIFICATION_FIXTURE_LABEL, {exact: true}).last()).toBeVisible();
  return host.store.get<Thread>('thread', thread.id)!;
}
async function approve(page: Page, host: VerificationHostFixture, operation: Operation, outcome: 'succeeded' | 'failed' = 'succeeded') {
  const approval = page.locator(`[data-operation-id="${operation.id}"]`).filter({has: page.getByRole('button', {name: 'Approve operation', exact: true})});
  await expect(approval).toBeVisible();
  await approval.getByText('Changes and preconditions', {exact: true}).click();
  await expect(approval).toContainText('"fixture-tool"');
  await expect(approval).toContainText('"check"');
  await expect(approval).toContainText('app.ts');
  await approval.getByRole('button', {name: 'Approve operation', exact: true}).click();
  await expect.poll(() => host.store.get<Operation>('operation', operation.id)?.status).toBe(outcome);
  const effect = host.store.get<ToolEffectRecord>('toolEffect', `operation:${operation.id}@${operation.revision}`)!;
  expect(effect.state).toBe(outcome === 'succeeded' ? 'SUCCEEDED' : 'FAILED');
  expect(host.store.get<ApprovalV1>('approval', effect.approvalId!)).toMatchObject({issuer: 'authenticated_user', remainingUses: 0});
  expect(host.requests.some(request => request.method === 'POST' && request.url === '/api/commands' && request.status === 200 && request.csrf &&
    (request.body as {type?: string; payload?: {operationId?: string}})?.type === 'operation.approve' &&
    (request.body as {payload?: {operationId?: string}}).payload?.operationId === operation.id)).toBe(true);
}

test.describe('without an approved host executor', () => {
  test.use({verificationBackend: false});
  test('reports the unavailable backend through authenticated preparation without creating evidence or approval', async ({page, verificationHost: host}, info) => {
    const thread = await createProject(page, host);
    const result = await post(page, 'verification.prepare', host.proposal(), thread.id);
    expect(result).toMatchObject({status: 400, body: {error: {code: 'VERIFICATION_BACKEND_UNAVAILABLE'}}});
    expect(host.store.all('operation')).toEqual([]); expect(host.store.all('approval')).toEqual([]);
    expect(host.store.all('checkObservation')).toEqual([]); expect(host.launches).toEqual([]); expect(host.qa).toEqual([]);
    await expect(page.getByRole('button', {name: 'Approve operation', exact: true})).toHaveCount(0);
    await receipt(info, 'backend-unavailable-http.json', result);
  });
});

test('ordinary approval records injected checks and advisory QA; primary conversation shows retained evidence and fresh rerun review', async ({page, verificationHost: host}, info) => {
  const thread = await createProject(page, host), commandId = randomUUID(), proposal = host.proposal(true);
  const noCsrf = await page.evaluate(async command => {
    const response = await fetch('/api/commands', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(command)});
    return {status: response.status, body: await response.json()};
  }, {id: randomUUID(), type: 'verification.prepare', threadId: thread.id, payload: proposal});
  expect(noCsrf).toMatchObject({status: 403, body: {error: {code: 'CSRF_REQUIRED'}}});
  expect(host.store.all('operation')).toEqual([]);
  const prepared = await post(page, 'verification.prepare', proposal, thread.id, commandId);
  expect(prepared.status).toBe(200);
  const operation = prepared.body.result as Operation, intent = operation.args.intent as VerificationIntent;
  expect(operation).toMatchObject({kind: 'verification.run', status: 'prepared', approved: false});
  expect(host.store.all('approval')).toEqual([]); expect(host.store.all('checkObservation')).toEqual([]); expect(host.launches).toEqual([]); expect(host.qa).toEqual([]);
  expect(await post(page, 'verification.prepare', proposal, thread.id, commandId)).toEqual(prepared);
  expect(host.store.all('operation')).toHaveLength(1);
  await approve(page, host, operation);
  expect(host.launches).toEqual([expect.objectContaining({executionId: intent.executionId, argv: ['check'], terminated: true})]);
  expect(host.qa).toEqual([expect.objectContaining({policy: ['qa_run', 'qa_observe', 'qa_context', 'qa_result'], disposed: 1, error: null})]);
  expect(host.store.all('verificationQaReview')).toEqual([expect.objectContaining({executionId: intent.executionId, evidenceQuality: 'ADVISORY', observedTokens: 10})]);
  await expect.poll(async () => (await readVerification(page, thread.id)).label).toBe('VERIFIED');
  const first = await readVerification(page, thread.id);
  await receipt(info, 'recorded-evidence-http.json', first);
  expect(first.label).toBe('VERIFIED');
  const observed = first.rows.find(row => row.phase === 'TEST')!;
  expect(observed).toMatchObject({requirement: 'contract-check', outcome: 'PASS', freshness: 'CURRENT'});
  // Deliberately stays in the real primary conversation, never a panel fixture.
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByText('Verified', {exact: true})).toBeVisible();
  await panel(page).getByRole('button', {name: `Check details for ${observed.checkId} (contract-check)`, exact: true}).click();
  const log = page.getByLabel('Retained log', {exact: true});
  await expect(log).toHaveText(INJECTED_LOG);
  await log.focus();
  await expect(log).toBeFocused();
  await expect(log).toBeInViewport();
  expect(await page.evaluate(() => 'verificationLogExecuted' in window)).toBe(false);
  await page.screenshot({path: info.outputPath('verification-retained-log.png'), fullPage: true});

  await page.setViewportSize({width: 900, height: 600});
  const checks = panel(page).getByRole('region', {name: 'Verification checks', exact: true});
  await checks.focus();
  await expect(checks).toBeFocused();
  await expect.poll(() => checks.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await checks.press('ArrowRight');
  await expect.poll(() => checks.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await panel(page).boundingBox())!.width).toBeLessThan(900);
  await page.screenshot({path: info.outputPath('verification-narrow-window.png'), fullPage: true});
  await page.setViewportSize({width: 1440, height: 1000});

  await writeFile(host.sourcePath, VERIFICATION_CHANGED_SOURCE);
  await expect.poll(async () => (await readVerification(page, thread.id)).rows.find(row => row.checkId === observed.checkId)?.freshness).toBe('STALE');
  await expect(panel(page)).toContainText('Stale results');
  await expect(page.getByLabel('Recorded outcome', {exact: true})).toHaveText('PASS');
  await expect(page.getByLabel('Current freshness', {exact: true})).toHaveText('STALE');
  await page.screenshot({path: info.outputPath('verification-stale-source.png'), fullPage: true});

  await panel(page).getByRole('button', {name: 'Rerun checks', exact: true}).click();
  await expect.poll(() => host.store.all<Operation>('operation', thread.id).filter(value => value.kind === 'verification.run' && value.id !== operation.id).length).toBe(1);
  const next = host.store.all<Operation>('operation', thread.id).find(value => value.kind === 'verification.run' && value.id !== operation.id)!, nextIntent = next.args.intent as VerificationIntent;
  await expect.poll(() => host.requests.some(request => request.csrf && request.status === 200 && (request.body as {type?: string})?.type === 'verification.rerun')).toBe(true);
  expect(next.id).not.toBe(operation.id); expect(nextIntent.executionId).not.toBe(intent.executionId);
  expect(nextIntent.sourceCut.codeDigest).not.toBe(intent.sourceCut.codeDigest);
  expect(host.launches).toHaveLength(1); expect(host.store.all('approval')).toHaveLength(1);
  await approve(page, host, next);
  await expect.poll(async () => (await readVerification(page, thread.id)).label).toBe('VERIFIED');
  expect(host.launches).toHaveLength(2); expect(host.launches.every(value => value.terminated)).toBe(true);
  expect(host.store.all('approval')).toHaveLength(2);

  const current = await readVerification(page, thread.id), currentCheck = current.rows.find(row => row.phase === 'TEST')!;
  expect(currentCheck).toMatchObject({requirement: 'contract-check', verifier: nextIntent.executionId, freshness: 'CURRENT', outcome: 'PASS'});
  expect(current.rows.find(row => row.checkId === observed.checkId)).toMatchObject({requirement: '—', freshness: 'STALE', outcome: 'PASS'});
  await expect(panel(page).getByRole('row').filter({has: page.getByRole('button', {name: `Check details for ${currentCheck.checkId} (contract-check)`, exact: true})})).toContainText('CURRENT');
  await expect(panel(page)).toContainText('Stale results');
  const completion = panel(page).getByText('Verified', {exact: true});
  await expect(completion).toBeVisible();
  await receipt(info, 'rerun-current-and-historical-http.json', current);
  await page.screenshot({path: info.outputPath('verification-rerun-history.png'), fullPage: true});
  // Historical rows stay stale; they must not strike through a fresh completion.
  await expect.soft(completion).not.toHaveCSS('text-decoration-line', 'line-through');

  await page.reload();
  await expect(panel(page).getByText('Verified', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'New thread', exact: true}).click();
  await page.getByRole('dialog', {name: 'Select project', exact: true}).getByRole('option', {name: 'Verification contract project', exact: true}).click();
  await expect(page.getByRole('dialog', {name: 'Select project', exact: true})).toHaveCount(0);
  await expect(panel(page)).toHaveCount(0);
  await page.getByRole('textbox', {name: 'Message', exact: true}).fill('Alternate conversation without verification evidence.');
  await page.getByRole('button', {name: 'Send message', exact: true}).click();
  await expect.poll(() => host.store.snapshot().threads.find(value => value.title === 'Alternate conversation without verification evidence.')?.id).toBeTruthy();
  const alternate = host.store.snapshot().threads.find(value => value.title === 'Alternate conversation without verification evidence.')!;
  await expect.poll(() => host.runtime.deliveries.some(value => value.threadId === alternate.id)).toBe(true);
  expect(await readVerification(page, alternate.id)).toMatchObject({label: null, rows: []});
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByLabel('Retained log', {exact: true})).toHaveCount(0);
  await page.getByRole('navigation', {name: 'Threads', exact: true}).getByRole('button', {name: /^Keep this parent task open while its verification is reviewed\./}).click();
  await expect(panel(page).getByText('Verified', {exact: true})).toBeVisible();

  const logRef = currentCheck.evidence.find(ref => ref.startsWith('verification-artifact:'))!;
  expect(logRef).toMatch(/^verification-artifact:[a-f0-9-]+$/);
  await rm(join(host.store.dataDir, 'artifacts', 'verification-v1', logRef.slice('verification-artifact:'.length) + '.bin'));
  await page.reload();
  await expect(panel(page)).toBeVisible();
  await panel(page).getByRole('button', {name: `Check details for ${currentCheck.checkId} (contract-check)`, exact: true}).click();
  const unavailable = panel(page).getByText('Retained artifact unavailable.', {exact: true});
  await unavailable.scrollIntoViewIfNeeded();
  await expect(unavailable).toBeInViewport();
  await expect.poll(async () => (await readVerification(page, thread.id)).label).toBe('BLOCKED');
  await expect(panel(page).getByText('Blocked', {exact: true})).toBeVisible();
  await receipt(info, 'missing-retained-log-http.json', await readVerification(page, thread.id));
  await page.screenshot({path: info.outputPath('verification-missing-log.png'), fullPage: true});
  await panel(page).getByText('Blocked', {exact: true}).scrollIntoViewIfNeeded();
  await page.screenshot({path: info.outputPath('verification-missing-log-grade.png'), fullPage: true});
});


async function failedComposerCheck(page: Page, host: VerificationHostFixture) {
  const thread = await createProject(page, host, VERIFICATION_REPAIR_PROMPT);
  await expect.poll(() => host.runtime.prepared.length).toBe(1);
  expect(host.runtime.prepared[0]).toMatchObject({threadId: thread.id, runId: thread.runId, epoch: thread.epoch});
  const operation = host.store.get<Operation>('operation', host.runtime.prepared[0]!.operationId)!;
  expect(operation).toMatchObject({kind: 'verification.run', status: 'prepared', approved: false});
  expect(host.requests.some(request => (request.body as {type?: string})?.type === 'verification.prepare')).toBe(false);
  expect(host.store.all('approval')).toEqual([]); expect(host.launches).toEqual([]);
  await approve(page, host, operation, 'failed');
  await expect(panel(page).getByRole('button', {name: 'Start bounded repair', exact: true})).toBeEnabled();
  return {thread, operation};
}
async function preparedRepair(host: VerificationHostFixture, count: number) {
  const operations = () => host.store.all<Operation>('operation').filter(value => value.kind === 'verification.run' && (value.args.intent as VerificationIntent).repair);
  await expect.poll(() => operations().length).toBe(count);
  return operations().at(-1)!;
}

test.describe('visible bounded repair from an ordinary composer message', () => {
  test.use({verificationExitCodes: [1, 2, 3, 4], verificationComposerQa: true});
  test('requires visible approval for each of three attempts and keeps its failures after the limit', async ({page, verificationHost: host}, info) => {
    const {thread, operation: baseline} = await failedComposerCheck(page, host);
    const initial = await readVerification(page, thread.id), baselineRow = initial.rows.find(row => row.phase === 'TEST')!;
    const priorObservation = host.store.get('checkObservation', baselineRow.checkId!);
    await panel(page).getByRole('spinbutton', {name: 'Repair time limit (seconds)', exact: true}).fill('180');
    await panel(page).getByRole('spinbutton', {name: 'Repair QA token budget', exact: true}).fill('4000');
    for (let attempt = 1; attempt <= 3; attempt++) {
      await writeFile(host.sourcePath, `export const contractVersion = ${attempt + 1};\n`);
      await panel(page).getByRole('button', {name: attempt === 1 ? 'Start bounded repair' : 'Prepare next attempt', exact: true}).click();
      const prepared = await preparedRepair(host, attempt), intent = prepared.args.intent as VerificationIntent;
      expect(intent.repair).toMatchObject({attempt, budget: {tokens: 4000, ms: 180_000}});
      expect(prepared.approved).toBe(false);
      expect(host.store.all('approval')).toHaveLength(attempt);
      expect(host.launches).toHaveLength(attempt); expect(host.qa).toHaveLength(attempt);
      await expect(panel(page)).toContainText('Awaiting approval');
      await expect(panel(page)).toContainText(`${attempt - 1} of 3 attempts used`);
      await approve(page, host, prepared, 'failed');
      await expect(panel(page)).toContainText(`${attempt} of 3 attempts used`);
      if (attempt < 3) await expect(panel(page).getByRole('button', {name: 'Prepare next attempt', exact: true})).toBeEnabled();
    }
    await expect(panel(page)).toContainText('Stop reason: Budget exhausted');
    await expect(panel(page)).toContainText('1000 QA tokens remaining');
    await expect(panel(page).getByRole('button', {name: 'Prepare next attempt', exact: true})).toHaveCount(0);
    await expect(panel(page).getByRole('button', {name: 'Start bounded repair', exact: true})).toHaveCount(0);
    await expect(panel(page).getByRole('button', {name: 'Stop repair', exact: true})).toBeDisabled();
    expect(host.launches.map(value => value.exitCode)).toEqual([1, 2, 3, 4]);
    expect(host.launches.every(value => value.terminated)).toBe(true);
    expect(host.store.all('approval')).toHaveLength(4);
    expect(host.store.get('checkObservation', baselineRow.checkId!)).toEqual(priorObservation);
    const current = await readVerification(page, thread.id);
    expect(current.rows.filter(row => row.phase === 'TEST')).toHaveLength(4);
    expect(current.rows.find(row => row.checkId === baselineRow.checkId)).toMatchObject({outcome: 'FAIL', freshness: 'STALE'});
    expect(current.workflow?.repair).toMatchObject({attempts: 3, maxAttempts: 3, stopped: 'BUDGET', remainingTokens: 1000});
    expect(host.requests.filter(request => ['verification.repair.start', 'verification.repair.next'].includes((request.body as {type?: string})?.type ?? '')).map(request => ({status: request.status, csrf: request.csrf}))).toEqual(Array.from({length: 3}, () => ({status: 200, csrf: true})));
    await receipt(info, 'visible-repair-limit-http.json', {baselineOperationId: baseline.id, current});
    await page.reload();
    await expect(panel(page)).toContainText('3 of 3 attempts used');
    await expect(panel(page)).toContainText('Stop reason: Budget exhausted');
    await panel(page).getByText('Bounded repair', {exact: true}).scrollIntoViewIfNeeded();
    await page.screenshot({path: info.outputPath('verification-visible-repair-limit.png'), fullPage: true});
  });

  for (const action of ['stop', 'decline'] as const) test(`visible ${action} cancels pending repair without another execution or approval`, async ({page, verificationHost: host}, info) => {
    const {thread} = await failedComposerCheck(page, host);
    await panel(page).getByRole('button', {name: 'Start bounded repair', exact: true}).click();
    const prepared = await preparedRepair(host, 1);
    await expect(panel(page)).toContainText('Awaiting approval');
    if (action === 'stop') {
      await panel(page).getByRole('button', {name: 'Stop repair', exact: true}).focus();
      await page.keyboard.press('Enter');
    } else {
      await page.locator(`[data-operation-id="${prepared.id}"]`).getByRole('button', {name: 'Decline operation', exact: true}).click();
    }
    await expect.poll(() => host.store.get<Operation>('operation', prepared.id)?.status).toBe('cancelled');
    await expect(panel(page)).toContainText('Stop reason: Cancelled');
    await expect(panel(page)).toContainText('0 of 3 attempts used');
    expect(host.launches).toHaveLength(1); expect(host.qa).toHaveLength(1); expect(host.store.all('approval')).toHaveLength(1);
    expect((await readVerification(page, thread.id)).rows.filter(row => row.phase === 'TEST')).toEqual([expect.objectContaining({outcome: 'FAIL'})]);
    await page.reload(); await expect(panel(page)).toContainText('Stop reason: Cancelled');
    await page.getByRole('button', {name: 'New thread', exact: true}).click();
    await page.getByRole('dialog', {name: 'Select project', exact: true}).getByRole('option', {name: 'Verification contract project', exact: true}).click();
    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByRole('button', {name: 'Stop repair', exact: true})).toHaveCount(0);
    await receipt(info, `visible-repair-${action}-http.json`, await readVerification(page, thread.id));
  });

  test('stale prepared source stops repair before approval consumption and preserves the previous failure', async ({page, verificationHost: host}, info) => {
    const {thread} = await failedComposerCheck(page, host);
    await panel(page).getByRole('button', {name: 'Start bounded repair', exact: true}).click();
    const prepared = await preparedRepair(host, 1);
    await writeFile(host.sourcePath, VERIFICATION_CHANGED_SOURCE);
    const approval = page.locator(`[data-operation-id="${prepared.id}"]`).filter({has: page.getByRole('button', {name: 'Approve operation', exact: true})});
    await approval.getByRole('button', {name: 'Approve operation', exact: true}).click();
    await expect.poll(() => host.store.get<Operation>('operation', prepared.id)?.status).toBe('failed');
    await expect(panel(page)).toContainText('Stop reason: Source or owner changed');
    expect(host.store.get<Operation>('operation', prepared.id)).toMatchObject({approved: true, error: expect.stringMatching(/source|changed/i)});
    expect(host.store.all<ApprovalV1>('approval').map(value => value.remainingUses).sort()).toEqual([0, 1]);
    expect(host.launches).toHaveLength(1); expect(host.qa).toHaveLength(1);
    await expect(panel(page).getByRole('button', {name: 'Stop repair', exact: true})).toBeDisabled();
    const current = await readVerification(page, thread.id);
    expect(current.workflow?.repair).toMatchObject({stopped: 'CONFLICT', attempts: 0, canContinue: false});
    expect(current.rows.filter(row => row.phase === 'TEST')).toEqual([expect.objectContaining({outcome: 'FAIL', freshness: 'STALE'})]);
    await receipt(info, 'visible-repair-stale-approval-http.json', current);
    await page.screenshot({path: info.outputPath('verification-visible-repair-stale-approval.png'), fullPage: true});
  });
});
