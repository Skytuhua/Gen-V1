import { readFile, stat, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import type { Frame, Page, TestInfo } from '@playwright/test';
import { AFTER, BEFORE, browserCommand, documentSpec, evidence, FIXTURE_LABEL, grantFixtureFile, HOST_URL, openHost, sendFixture, test, expect } from '../host-fixture.ts';
import { GENERATED_APPS_ENABLED } from '../../packages/core/widgets.ts';

// Integration verification only. No route interception, mocked fetch/EventSource,
// real-provider calls, user projects, production setup data, or shell effects.
const notes = (page: Page) => page.getByRole('textbox', { name: 'Review notes' });
const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true }).or(page.getByRole('dialog', { name, exact: true }));
async function widgetFrame(page: Page): Promise<Frame> {
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect.poll(() => page.frames().some(value => value.url().startsWith('http://localhost:4338/widget/'))).toBe(true);
  const frame = page.frames().find(value => value.url().startsWith('http://localhost:4338/widget/'));
  if (!frame) throw new Error('Separate-origin widget frame did not mount');
  await expect(frame.getByRole('textbox', { name: 'Notebook note' })).toHaveValue('A small, source-linked notebook.');
  return frame;
}
async function performanceEvidence(info: TestInfo, observations: Record<string, unknown>) {
  await writeFile(info.outputPath('performance-observations.json'), JSON.stringify({ fixture: FIXTURE_LABEL, browser: 'Chromium', scope: 'Single local fixture run; measurements are not model latency or a performance benchmark.', ...observations }, null, 2));
}
async function bounded<T>(promise: Promise<T>, label: string, milliseconds = 3000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`${label} did not respond within ${milliseconds}ms`)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

test('actual create/send, cookies/CSRF/SSE and structured host autosave survive reload', async ({ page, host }, info) => {
  const started = performance.now();
  const commands: Array<{ type: string; csrf: boolean }> = [];
  page.on('request', request => { if (request.url() === `${HOST_URL}/api/commands`) commands.push({ type: request.postDataJSON().type, csrf: !!request.headers()['x-harness-csrf'] }); });
  await openHost(page);
  const cookie = (await page.context().cookies()).find(value => value.name === 'harness_session');
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict' });
  const noCookie = await page.evaluate(async () => { const result = await fetch('/api/snapshot', { credentials: 'omit' }); return result.status; });
  expect(noCookie).toBe(401);
  const noCsrf = await page.evaluate(async () => { const result = await fetch('/api/commands', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: crypto.randomUUID(), type: 'settings.update', payload: { theme: 'dark' } }) }); return result.status; });
  expect(noCsrf).toBe(403);
  await sendFixture(page, 'document');
  await expect(notes(page)).toBeVisible();
  expect(host.snapshot().threads).toHaveLength(1);
  expect(host.runtime.deliveries).toHaveLength(1);
  const thread = host.snapshot().threads[0]!;
  expect(host.runtime.activeRunContext).toEqual({ threadId: thread.id, runId: thread.runId, epoch: thread.epoch });
  // A publication after the send response must reach the page through real SSE.
  const eventResponse = page.waitForResponse(response => response.url().includes('/api/events?'));
  await page.evaluate(seq => {
    const source = new EventSource(`/api/events?after=${seq}`);
    Object.assign(window, { fixtureSSE: source, fixtureSequences: [] as number[] });
    source.addEventListener('workspace', event => (window as unknown as { fixtureSequences: number[] }).fixtureSequences.push(JSON.parse((event as MessageEvent).data).seq));
  }, host.snapshot().seq);
  expect((await eventResponse).headers()['content-type']).toContain('text/event-stream');
  host.runtime.event('assistant.message', { messageId: 'fixture-sse-observation', content: 'Live evidence arrived over the host event stream.' });
  await expect(page.getByText('Live evidence arrived over the host event stream.', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { fixtureSequences: number[] }).fixtureSequences.length)).toBeGreaterThan(0);
  const readyMs = performance.now() - started;
  const saveStarted = performance.now();
  await notes(page).fill('Local review survives a full browser reload.');
  await expect.poll(() => host.snapshot().userStates[0]?.values.note).toBe('Local review survives a full browser reload.');
  const autosaveMs = performance.now() - saveStarted;
  await expect(region(page, 'Evidence document').getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  await page.reload();
  await expect(notes(page)).toHaveValue('Local review survives a full browser reload.');
  expect(commands.filter(value => ['thread.create', 'message.send', 'state.save'].includes(value.type)).every(value => value.csrf)).toBe(true);
  expect(commands.some(value => value.type === 'thread.create')).toBe(true);
  expect(commands.some(value => value.type === 'message.send')).toBe(true);
  await evidence(page, info, 'document-host-autosave');
  await performanceEvidence(info, { createSendAndSseVisibleMs: readyMs, structuredAutosaveMs: autosaveMs });
});

test('durable decision validation and acceptance continue the same owning runtime once', async ({ page, host }, info) => {
  await openHost(page); await sendFixture(page, 'decision');
  const decision = region(page, 'Publish this evidence?');
  await expect(decision).toBeVisible();
  const request = host.snapshot().requests[0]!;
  const owning = { ...host.runtime.activeRunContext! };
  const invalid = await browserCommand(page, 'request.respond', { requestId: request.id, revision: request.revision, response: { choice: 'INVALID' } }, request.threadId);
  expect(invalid).toMatchObject({ status: 400, body: { error: { code: 'INVALID_INPUT' } } });
  await expect(decision).toBeVisible(); expect(host.snapshot().requests[0]?.status).toBe('pending');
  expect(host.runtime.deliveries).toHaveLength(1);
  await decision.getByLabel('choice').selectOption('Keep');
  await decision.getByRole('textbox', { name: 'Decision rationale' }).fill('short');
  await decision.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(decision.getByRole('alert')).toContainText('The response does not match the requested schema. Check the required fields and values.');
  await expect(decision.getByRole('textbox', { name: 'Decision rationale' })).toHaveValue('short');
  expect(host.snapshot().requests[0]?.status).toBe('pending');
  expect(host.runtime.deliveries).toHaveLength(1);
  await decision.getByRole('textbox', { name: 'Decision rationale' }).fill('Verified source evidence.');
  const started = performance.now();
  await decision.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Fixture continued the durable decision in the same owning runtime.', { exact: true })).toBeVisible();
  const followUpMs = performance.now() - started;
  const accepted = host.snapshot().requests[0]!;
  expect(accepted).toMatchObject({ status: 'accepted', revision: 2, response: { choice: 'Keep', reason: 'Verified source evidence.' } });
  expect(host.runtime.deliveries.map(value => value.method)).toEqual(['start', 'followUp']);
  expect(host.runtime.activeRunContext).toEqual(owning);
  const delivery = host.runtime.deliveries[1]!.input;
  expect(delivery).toMatchObject(owning); expect(delivery.prompt).toContain(request.id);
  const outbox = host.store.get<{ status: string; runId: string }>('outbox', delivery.inputId);
  expect(outbox).toMatchObject({ status: 'processing', runId: owning.runId });
  const stale = await browserCommand(page, 'request.respond', { requestId: request.id, revision: request.revision, response: { choice: 'Revise' } }, request.threadId);
  expect(stale).toMatchObject({ status: 400, body: { error: { code: 'STALE_REQUEST' } } });
  expect(host.runtime.deliveries).toHaveLength(2);
  await page.reload(); await expect(page.getByText('Fixture continued the durable decision in the same owning runtime.', { exact: true })).toBeVisible();
  expect(host.snapshot().requests[0]?.response).toEqual({ choice: 'Keep', reason: 'Verified source evidence.' });
  await evidence(page, info, 'durable-decision');
  await performanceEvidence(info, { decisionAcceptanceToFollowUpVisibleMs: followUpMs });
});

test('generated operation button requires native approval; restart restores without repeating effects', async ({ page, host }, info) => {
  await openHost(page); await grantFixtureFile(page, host); await sendFixture(page, 'operation');
  const artifact = region(page, 'Evidence document');
  await expect(artifact.getByRole('button', { name: 'Apply document replacement' })).toBeVisible();
  await artifact.getByRole('button', { name: 'Expand artifact', exact: true }).click();
  await artifact.getByRole('button', { name: 'Apply document replacement' }).click();
  const approval = region(page, 'Operation approval');
  await expect(approval.getByRole('button', { name: 'Approve operation', exact: true })).toBeFocused();
  expect(host.snapshot().operations[0]).toMatchObject({ approved: false, status: 'prepared' });
  expect(await readFile(host.sourceFile, 'utf8')).toBe(BEFORE);
  expect(host.commands.filter(value => value.type === 'operation.approve')).toHaveLength(0);
  const op = host.snapshot().operations[0]!;
  const stale = await browserCommand(page, 'operation.approve', { operationId: op.id, revision: op.revision + 1 }, op.threadId);
  expect(stale).toMatchObject({ status: 400, body: { error: { code: 'STALE_REVISION' } } });
  await expect(approval).toBeVisible(); expect(await readFile(host.sourceFile, 'utf8')).toBe(BEFORE);
  await evidence(page, info, 'native-operation-approval');
  const started = performance.now();
  await approval.getByRole('button', { name: 'Approve operation', exact: true }).click();
  await expect.poll(() => host.snapshot().operations[0]?.status).toBe('succeeded');
  expect(await readFile(host.sourceFile, 'utf8')).toBe(AFTER);
  await expect(region(page, 'Operation outcome')).toContainText('Succeeded');
  const effectMs = performance.now() - started;
  const modified = (await stat(host.sourceFile)).mtimeMs;
  const beforeRestart = host.snapshot();
  await page.goto('about:blank'); await host.restart();
  expect(host.runtime.deliveries).toHaveLength(0);
  expect(host.snapshot().operations).toEqual(beforeRestart.operations);
  expect(host.snapshot().artifacts).toEqual(beforeRestart.artifacts);
  expect(host.snapshot().userStates).toEqual(beforeRestart.userStates);
  expect(host.snapshot().threads[0]?.status).toBe('interrupted');
  await openHost(page);
  await expect(region(page, 'Operation outcome')).toContainText('Succeeded');
  await expect(region(page, 'Evidence document')).toBeVisible();
  expect(await readFile(host.sourceFile, 'utf8')).toBe(AFTER);
  expect((await stat(host.sourceFile)).mtimeMs).toBe(modified);
  expect(host.runtime.deliveries).toHaveLength(0);
  expect(host.store.eventsAfter(0).filter(value => value.type === 'operation.started')).toHaveLength(1);
  await evidence(page, info, 'restart-restored-receipt');
  await performanceEvidence(info, { approveToRecordedEffectMs: effectMs, recoveryRuntimeCalls: host.runtime.deliveries.length });
});

test('stale structured action shows rejection and retains its local review UI', async ({ page, host }, info) => {
  await openHost(page); await sendFixture(page, 'document');
  await expect(notes(page)).toBeVisible();
  await notes(page).fill('Keep this locally owned review on stale rejection.');
  await expect.poll(() => host.commands.some(value => value.type === 'edit.begin')).toBe(true);
  const artifact = host.artifact('structured');
  await host.runtime.tool({ name: 'ui_present', args: { artifactId: artifact.id, baseRevision: artifact.revision, spec: documentSpec(), title: artifact.title } });
  // Submit while the old revision is held by the draft. The notice is delayed
  // and can disappear after autosave; waiting for it misses the stale action.
  await region(page, 'Evidence document').getByRole('button', { name: 'Continue document review' }).click();
  await expect(region(page, 'Evidence document').getByRole('alert')).toContainText('interface changed');
  await expect(notes(page)).toHaveValue('Keep this locally owned review on stale rejection.');
  expect(host.runtime.deliveries).toHaveLength(1);
  await evidence(page, info, 'stale-action-retains-review');
});

test('generated app validates mount tickets, source/channel/current nonce/state; acknowledges checkpoint and preserves same iframe', async ({ page, host }, info) => {
  test.skip(!GENERATED_APPS_ENABLED, 'Positive isolation scenario retained for future enablement; generated apps are disabled in the current host.');
  await openHost(page); await sendFixture(page, 'widget');
  const frame = await widgetFrame(page);
  const artifact = host.artifact('widget');
  const iframe = page.locator('iframe');
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
  const firstUrl = await iframe.getAttribute('src');
  expect(new URL(firstUrl!).origin).toBe('http://localhost:4338');
  expect(new URL(firstUrl!).origin).not.toBe(new URL(page.url()).origin);
  expect(await frame.evaluate(() => location.origin)).toBe('http://localhost:4338');
  const replay = await page.request.get(firstUrl!); expect(replay.status()).toBe(403);
  const ticketless = await page.request.get(`http://localhost:4338/widget/${artifact.id}/${artifact.revision}`); expect(ticketless.status()).toBe(403);
  const sourceResponse = await page.request.get(`${HOST_URL}/api/artifacts/${artifact.id}/source`);
  expect(sourceResponse.ok()).toBe(true); expect(await sourceResponse.text()).toContain('window.harness');
  expect(await frame.evaluate(() => typeof (window as unknown as { harness?: unknown }).harness)).toBe('undefined');
  const frameHandle = await iframe.elementHandle();
  await iframe.evaluate(element => Object.assign(window, { fixtureIframe: element }));
  await frame.getByRole('textbox', { name: 'Notebook note' }).fill('State remains in this exact iframe while expanded.');
  await region(page, 'Growing knowledge notebook').getByRole('button', { name: 'Expand artifact', exact: true }).click();
  await expect(region(page, 'Growing knowledge notebook')).toHaveClass(/artifact-expanded/);
  expect(await iframe.evaluate(element => element === (window as unknown as { fixtureIframe: Element }).fixtureIframe)).toBe(true);
  expect(await iframe.getAttribute('src')).toBe(firstUrl);
  await expect(frame.getByRole('textbox', { name: 'Notebook note' })).toHaveValue('State remains in this exact iframe while expanded.');
  await region(page, 'Growing knowledge notebook').getByRole('button', { name: 'Collapse artifact', exact: true }).click();
  const valid = Object.fromEntries(new URLSearchParams(new URL(firstUrl!).hash.slice(1)));
  const initialCheckpoints = host.commands.filter(value => value.type === 'widget.checkpoint').length;
  // Same identities, wrong source WindowProxy: an actual parent postMessage.
  await page.evaluate(({ valid, artifactId }) => window.postMessage({ channel: 'harness-widget', ...valid, artifactId, type: 'checkpoint', payload: { requestId: 'wrong-source', stateSchemaVersion: 1, values: { note: 'forged parent' } } }, '*'), { valid, artifactId: artifact.id });
  // Real child WindowProxy, wrong channel/token/mount/artifact: actual child postMessages.
  await frame.evaluate(({ valid, artifactId }) => {
    const message = { channel: 'harness-widget', ...valid, artifactId, type: 'checkpoint', payload: { requestId: 'forgery', stateSchemaVersion: 1, values: { note: 'forged child' } } };
    for (const patch of [{ channel: 'wrong' }, { token: 'stale-nonce' }, { mountId: 'stale-mount' }, { artifactId: 'other-artifact' }]) parent.postMessage({ ...message, ...patch }, '*');
  }, { valid, artifactId: artifact.id });
  await frame.getByRole('button', { name: 'Invalid checkpoint', exact: true }).click();
  await expect(frame.getByRole('status')).toContainText('Checkpoint rejected');
  expect(host.commands.filter(value => value.type === 'widget.checkpoint')).toHaveLength(initialCheckpoints);
  expect(host.snapshot().userStates.find(value => value.id === artifact.stateId)?.values.note).toBe('A small, source-linked notebook.');
  await frame.evaluate(({ valid, artifactId }) => parent.postMessage({ channel: 'harness-widget', ...valid, artifactId, type: 'checkpoint', payload: { requestId: 'wrong-state-schema', stateSchemaVersion: 99, values: { note: 'schema changed' } } }, '*'), { valid, artifactId: artifact.id });
  expect(host.commands.filter(value => value.type === 'widget.checkpoint')).toHaveLength(initialCheckpoints);
  const actionCount = host.commands.filter(value => value.type === 'action.submit').length;
  await frame.evaluate(({ valid, artifactId }) => parent.postMessage({ channel: 'harness-widget', ...valid, artifactId, type: 'action', payload: { actionId: 'not-declared', payload: {} } }, '*'), { valid, artifactId: artifact.id });
  expect(host.commands.filter(value => value.type === 'action.submit')).toHaveLength(actionCount);
  const started = performance.now();
  const commandResponse = page.waitForResponse(async response => response.url().endsWith('/api/commands') && response.request().postDataJSON()?.type === 'widget.checkpoint');
  await frame.getByRole('button', { name: 'Checkpoint notebook', exact: true }).click();
  const receipt = await (await commandResponse).json();
  await expect(frame.getByRole('status')).toContainText(`Host acknowledged revision ${receipt.result.revision}`);
  expect(host.snapshot().userStates.find(value => value.id === artifact.stateId)).toMatchObject({ revision: receipt.result.revision, values: { note: 'State remains in this exact iframe while expanded.' } });
  const checkpointMs = performance.now() - started;
  await evidence(page, info, 'knowledge-notebook-checkpoint');
  await page.reload();
  await expect(page.frameLocator('iframe').getByRole('textbox', { name: 'Notebook note' })).toHaveValue('State remains in this exact iframe while expanded.');
  const freshFrame = page.frames().find(value => value.url().startsWith('http://localhost:4338/widget/'))!;
  const freshUrl = await page.locator('iframe').getAttribute('src');
  expect(freshUrl).not.toBe(firstUrl);
  const count = host.commands.filter(value => value.type === 'widget.checkpoint').length;
  await freshFrame.evaluate(({ old, artifactId }) => parent.postMessage({ channel: 'harness-widget', ...old, artifactId, type: 'checkpoint', payload: { requestId: 'old-generation', stateSchemaVersion: 1, values: { note: 'old mount' } } }, '*'), { old: valid, artifactId: artifact.id });
  await freshFrame.getByRole('button', { name: 'Invalid checkpoint' }).click();
  await expect(freshFrame.getByRole('status')).toContainText('Checkpoint rejected');
  expect(host.commands.filter(value => value.type === 'widget.checkpoint')).toHaveLength(count);
  const invalidHost = await browserCommand(page, 'widget.checkpoint', { artifactId: artifact.id, revision: artifact.revision, baseStateRevision: receipt.result.revision, stateSchemaVersion: 1, values: { note: 42 }, clientId: 'adversarial-client' }, artifact.threadId);
  expect(invalidHost).toMatchObject({ status: 400, body: { error: { code: 'INVALID_INPUT' } } });
  const staleHost = await browserCommand(page, 'widget.checkpoint', { artifactId: artifact.id, revision: artifact.revision, baseStateRevision: 0, stateSchemaVersion: 1, values: { note: 'stale' }, clientId: 'adversarial-client' }, artifact.threadId);
  expect(staleHost).toMatchObject({ status: 400, body: { error: { code: 'STALE_USER_STATE' } } });
  await expect(page.frameLocator('iframe').getByRole('textbox', { name: 'Notebook note' })).toHaveValue('State remains in this exact iframe while expanded.');
  await freshFrame.getByRole('button', { name: 'Continue notebook', exact: true }).click();
  await expect(page.getByText('Fixture continued the durable decision in the same owning runtime.', { exact: true })).toBeVisible();
  expect(host.runtime.deliveries.map(value => value.method)).toEqual(['start', 'followUp']);
  await frameHandle?.dispose();
  await evidence(page, info, 'knowledge-notebook-reloaded');
  await performanceEvidence(info, { checkpointToDurableAcknowledgmentMs: checkpointMs, sameIframeExpansion: true });
});

test('cross-site infinite-loop widget leaves Settings, Stop and host navigation responsive', async ({ page, host }, info) => {
  test.skip(!GENERATED_APPS_ENABLED, 'Positive execution scenario retained for future enablement; generated apps are disabled in the current host.');
  test.setTimeout(30_000);
  await openHost(page); await sendFixture(page, 'loop');
  const frame = await widgetFrame(page);
  await evidence(page, info, 'untrusted-widget-before-loop');
  // The loop marker is emitted before entry; a timed, independent host interaction
  // below is the pass condition. Sandbox/CSP alone are not responsiveness evidence.
  await frame.getByRole('button', { name: 'Start infinite loop' }).click();
  await expect(frame.getByRole('status')).toContainText('Infinite loop entered');
  const observations: Record<string, unknown> = { loop: 'while(true) in a dedicated worker; trusted iframe localhost, host127.0.0.1', capabilityRequirementOnFailure: 'Disable generated-app execution unless a separate renderer/process watchdog keeps the host responsive.' };
  try {
    // CDP browser process is independent of the renderer; waiting here proves the
    // scheduled loop had time to start without waiting on the child renderer.
    await new Promise(resolve => setTimeout(resolve, 300));
    const health = await bounded(page.request.get(`${HOST_URL}/health`), 'Host HTTP health');
    observations.hostHttpHealth = health.status();
    const heartbeatStart = performance.now();
    await bounded(page.evaluate(() => { Object.assign(window, { fixtureHostHeartbeat: performance.now() }); return true; }), 'Host main-frame JavaScript');
    observations.hostMainFrameJavaScriptMs = performance.now() - heartbeatStart;
    let start = performance.now();
    await bounded(page.getByRole('button', { name: 'Settings', exact: true }).click({ timeout: 3000 }), 'Host Settings click');
    await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible({ timeout: 3000 });
    observations.settingsOpenMs = performance.now() - start;
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click({ timeout: 3000 });
    start = performance.now();
    await page.getByRole('button', { name: 'Stop agent', exact: true }).click({ timeout: 3000 });
    await expect.poll(() => host.snapshot().threads[0]?.status, { timeout: 3000 }).toBe('stopped');
    observations.stopRecordedMs = performance.now() - start;
    expect(host.runtime.cancellations).toHaveLength(1);
    await expect(region(page, 'Untrusted loop fixture').getByRole('alert')).toContainText('worker was terminated');
    start = performance.now();
    await page.getByRole('button', { name: 'New thread', exact: false }).click({ timeout: 3000 });
    await expect.poll(() => host.snapshot().threads.length, { timeout: 3000 }).toBe(2);
    await expect(page.locator('.breadcrumb')).toContainText('New thread', { timeout: 3000 });
    observations.navigationMs = performance.now() - start;
    observations.outcome = 'Host Settings, Stop and new-thread navigation responded after child loop entry.';
    await evidence(page, info, 'host-responsive-after-infinite-loop');
  } catch (error) {
    observations.outcome = 'FAIL: generated-app responsiveness capability is not established; disable capability until isolated/watchdog execution is verified.';
    observations.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await performanceEvidence(info, observations);
    // Context disposal runs in the browser process, even if its renderer is stuck.
    await bounded(page.context().close(), 'Dispose only this test browser context', 5000).catch(() => {});
  }
});

test('the real host rejects generated apps while preserving its trusted interface', async ({ page, host }) => {
  test.skip(GENERATED_APPS_ENABLED, 'Exercises the current disabled-feature boundary.');
  await openHost(page); await sendFixture(page, 'document');
  await expect(notes(page)).toBeVisible();
  const artifact = host.artifact('structured');
  await expect(host.runtime.tool({ name: 'ui_create_widget', args: {} })).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
  expect(host.snapshot().artifacts).toHaveLength(1);
  expect(host.snapshot().artifacts[0]?.id).toBe(artifact.id);
  await expect(page.locator('iframe')).toHaveCount(0);
  await notes(page).fill('The trusted interface remains usable.');
  await expect.poll(() => host.snapshot().userStates.find(state => state.id === artifact.stateId)?.values.note).toBe('The trusted interface remains usable.');
});
