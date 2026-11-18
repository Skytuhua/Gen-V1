import type { Page } from '@playwright/test';
import { memoryPreparedRequestSchema, type MemoryPreparedRequest, type MemoryTombstoneV1 } from '../../packages/contracts/project-memory.ts';
import { MEMORY_CLAIM, MEMORY_FIXTURE_LABEL, MEMORY_HOST_URL, MEMORY_SOURCE, MEMORY_SOURCE_PROMPT, type MemoryHostFixture, test, expect } from '../project-memory-host-fixture.ts';

const review = (page: Page) => page.getByRole('dialog', { name: 'Project memory', exact: true });
const inspector = (page: Page) => page.getByRole('dialog', { name: 'Context inspector', exact: true });
const composer = (page: Page) => page.getByRole('textbox', { name: 'Message', exact: true });
async function writeDraft(page: Page, prompt: string) {
  // Use the normal pointer gesture after modal focus restoration. A bare fill
  // can race the launcher's queued focus without delivering an input event.
  await composer(page).click(); await composer(page).fill(prompt);
  await expect(composer(page)).toHaveValue(prompt);
}
async function openReview(page: Page) {
  const expand = page.getByRole('button', { name: 'Expand Project overview', exact: true });
  if (await expand.isVisible()) await expand.click();
  await page.getByRole('button', { name: 'Project memory', exact: true }).click();
  await expect(review(page).getByRole('tab', { name: 'Accepted', exact: true })).toBeVisible();
}
async function preview(page: Page, memoryHost: MemoryHostFixture, threadId: string, prompt: string): Promise<MemoryPreparedRequest> {
  await writeDraft(page, prompt);
  const observedBefore = memoryHost.preparedResponses.length;
  const response = page.waitForResponse(value => {
    if (!value.url().endsWith('/memory/requests/prepare') || value.request().method() !== 'POST') return false;
    const body = value.request().postDataJSON() as { threadId?: unknown; prompt?: unknown } | null;
    return body?.threadId === threadId && body.prompt === prompt;
  }, { timeout: 10_000 });
  await page.getByRole('button', { name: 'Inspect context usage', exact: true }).click();
  const result = await response; expect(result.status()).toBe(200);
  expect(memoryHost.preparedResponseCaptureError).toBeNull();
  const observations = memoryHost.preparedResponses.slice(observedBefore).filter(value => value.url === new URL(result.url()).pathname && value.threadId === threadId && value.prompt === prompt);
  expect(observations).toHaveLength(1);
  expect(observations[0]).toMatchObject({ status: 200, captureError: null });
  const prepared = memoryPreparedRequestSchema.parse(observations[0]!.response);
  await expect(inspector(page)).toContainText('Prepared for the current draft.');
  await expect(inspector(page)).toContainText(`Request ${prepared.requestId}`);
  return prepared;
}

test('enabled project memory uses real HTTP through proposal, recall, request exclusion, Forget and Store restart', async ({ page, memoryHost }, info) => {
  // No page.route(), injected fetch/EventSource or seeded memory records.
  // The only fixture substitution is the explicitly scripted RuntimeAdapter.
  await page.goto(MEMORY_HOST_URL);
  await expect(composer(page)).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toHaveText(MEMORY_FIXTURE_LABEL);
  expect((await page.context().cookies()).find(cookie => cookie.name === 'harness_session')).toMatchObject({ httpOnly: true, sameSite: 'Strict' });
  expect(await page.evaluate(async () => (await fetch('/api/snapshot', { credentials: 'omit' })).status)).toBe(401);

  await page.getByRole('button', { name: 'New thread', exact: true }).click();
  await page.getByRole('button', { name: 'Add project', exact: true }).click();
  const connection = page.getByRole('dialog', { name: 'Connect project', exact: true });
  await connection.getByRole('textbox', { name: 'Project name', exact: true }).fill('Memory lifecycle project');
  await connection.getByRole('textbox', { name: 'Local folder', exact: true }).fill(memoryHost.projectPath);
  await connection.getByRole('button', { name: 'Connect project', exact: true }).click();
  await page.getByRole('option', { name: 'Memory lifecycle project', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Select project', exact: true })).toHaveCount(0);
  await expect.poll(() => memoryHost.store.snapshot().threads.length).toBe(1);
  const thread = memoryHost.store.snapshot().threads[0]!;

  await openReview(page);
  await expect(review(page)).toContainText('Not enabled for this project');
  await review(page).getByRole('checkbox', { name: thread.title, exact: true }).check();
  await review(page).getByRole('button', { name: 'Enable for this project', exact: true }).click();
  await expect(review(page)).toContainText('Enabled for this project');
  expect((await memoryHost.memory(thread.id)).sourceThreadIds).toEqual([thread.id]);
  await review(page).getByRole('button', { name: 'Close dialog', exact: true }).click();

  await writeDraft(page, MEMORY_SOURCE_PROMPT);
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText(MEMORY_SOURCE, { exact: true })).toBeVisible();
  await expect.poll(async () => (await memoryHost.memory(thread.id)).items.length).toBe(1);
  const proposed = (await memoryHost.memory(thread.id)).items[0]!.item;
  expect(proposed).toMatchObject({ state: 'PROPOSED', text: MEMORY_CLAIM, assertedBy: { kind: 'AGENT' } });
  expect(memoryHost.extractions).toHaveLength(1);
  expect(memoryHost.extractions[0]!.deliveries[0]).toMatchObject({ accountId: null, resources: [], sessionPath: null });
  expect(memoryHost.extractions[0]!.deliveries[0].threadId).not.toBe(thread.id);
  await expect.poll(() => memoryHost.extractions[0]!.disposed).toBe(true);

  await openReview(page);
  await review(page).getByRole('tab', { name: 'Proposals', exact: true }).click();
  const row = review(page).getByRole('article', { name: `Memory ${proposed.id}`, exact: true });
  await row.getByRole('button', { name: `View source ${proposed.id} 1`, exact: true }).click();
  await expect(review(page).getByRole('region', { name: 'Supporting source', exact: true })).toContainText(MEMORY_SOURCE);
  await review(page).getByRole('button', { name: 'Close source', exact: true }).click();
  const noCsrf = await page.evaluate(async ({ projectId, scope, itemId, revision }) => {
    const response = await fetch(`/api/projects/${projectId}/memory/actions`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commandId: crypto.randomUUID(), scope, operation: { action: 'accept', itemId, baseRevision: revision } }) });
    return response.status;
  }, { projectId: thread.projectId, scope: (await memoryHost.memory(thread.id)).scope, itemId: proposed.id, revision: proposed.revision });
  expect(noCsrf).toBe(403);
  expect((await memoryHost.memory(thread.id)).items[0]!.item.state).toBe('PROPOSED');
  await row.getByRole('button', { name: `Accept ${proposed.id}`, exact: true }).click();
  await review(page).getByRole('tab', { name: 'Accepted', exact: true }).click();
  await expect(row).toContainText('Accepted · revision 2');
  await row.getByRole('button', { name: `View source ${proposed.id} 1`, exact: true }).click();
  await expect(review(page).getByRole('region', { name: 'Supporting source', exact: true })).toContainText(MEMORY_SOURCE);
  await review(page).getByRole('button', { name: 'Close dialog', exact: true }).click();

  const draft = 'Explain SQLite persistence for this project.';
  const prepared = await preview(page, memoryHost, thread.id, draft);
  expect(prepared.items.map(item => item.id)).toEqual([proposed.id]);
  expect(prepared.injectedBytes).toBeGreaterThan(0); expect(prepared.injectedBytes).toBeLessThanOrEqual(4096);
  const exclusion = page.waitForResponse(value => value.url().endsWith(`/memory/requests/${encodeURIComponent(prepared.requestId)}/exclude`), { timeout: 10_000 });
  await inspector(page).getByRole('button', { name: 'Exclude from this request', exact: true }).click();
  expect((await exclusion).status()).toBe(200);
  await expect(inspector(page)).toContainText('No memory was selected for this request.');
  const preparations = memoryHost.requests.filter(request => request.url.endsWith('/memory/requests/prepare')).length;
  await page.keyboard.press('Escape'); await expect(inspector(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Inspect context usage', exact: true }).click();
  await expect(inspector(page)).toContainText(`Request ${prepared.requestId}`);
  await expect(inspector(page)).toContainText('No memory was selected for this request.');
  expect(memoryHost.requests.filter(request => request.url.endsWith('/memory/requests/prepare'))).toHaveLength(preparations);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => memoryHost.runtime.deliveries.length).toBe(2);
  expect(memoryHost.runtime.deliveries[1]!.requestContext?.requestId).toBe(prepared.requestId);
  expect(memoryHost.runtime.deliveries[1]!.prompt).not.toContain(MEMORY_CLAIM);
  await expect.poll(() => memoryHost.service.thread(thread.id).runId).toBeNull();
  expect(memoryHost.service.thread(thread.id).status).toBe('ready');

  // Exclusion is request-local: a different draft recalls the accepted revision.
  const next = await preview(page, memoryHost, thread.id, 'Explain SQLite persistence for the next project task.');
  expect(next.requestId).not.toBe(prepared.requestId);
  expect(next.items.map(item => item.id)).toEqual([proposed.id]);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => memoryHost.runtime.deliveries.length).toBe(3);
  expect(memoryHost.runtime.deliveries[2]!.requestContext?.requestId).toBe(next.requestId);
  expect(memoryHost.runtime.deliveries[2]!.prompt).toContain(MEMORY_CLAIM);
  await expect.poll(() => memoryHost.service.thread(thread.id).runId).toBeNull();
  expect(memoryHost.service.thread(thread.id).status).toBe('ready');

  await openReview(page);
  await row.getByRole('button', { name: `Forget ${proposed.id}`, exact: true }).click();
  const forget = review(page).getByRole('region', { name: 'Forget preview', exact: true });
  await expect(forget).toContainText('immediately excludes');
  await expect(forget).toContainText('Physical purge is pending');
  await forget.getByRole('button', { name: 'Confirm forget', exact: true }).click();
  await review(page).getByRole('tab', { name: 'Deleted history', exact: true }).click();
  await expect(review(page)).toContainText(proposed.id);
  await expect(review(page)).toContainText('Physical purge pending');
  const beforeRestart = await memoryHost.memory(thread.id), tombstone = beforeRestart.tombstones[0]!;
  expect(tombstone.itemId).toBe(proposed.id); expect(tombstone.affectedDerivedArtifacts.length).toBeGreaterThan(0);
  await review(page).getByRole('button', { name: 'Close dialog', exact: true }).click();
  expect((await preview(page, memoryHost, thread.id, 'Check SQLite persistence after forgetting.')).items).toEqual([]);
  await page.keyboard.press('Escape');

  // Close both HTTP servers and Service, close SQLite, then reopen the same profile.
  await memoryHost.restart(); await page.reload(); await expect(composer(page)).toBeVisible();
  await openReview(page);
  await review(page).getByRole('tab', { name: 'Deleted history', exact: true }).click();
  await expect(review(page)).toContainText(proposed.id);
  const restored = await memoryHost.memory(thread.id);
  expect(restored.scope).toEqual(beforeRestart.scope); expect(restored.items).toEqual([]);
  expect(restored.tombstones[0]).toEqual(tombstone);
  expect(memoryHost.store.get<{ tombstone: MemoryTombstoneV1 }>('projectMemoryTombstone', proposed.id)?.tombstone).toEqual(tombstone);
  await review(page).getByRole('button', { name: 'Close dialog', exact: true }).click();
  expect((await preview(page, memoryHost, thread.id, 'Check SQLite persistence after the host restart.')).items).toEqual([]);
  const memoryWrites = memoryHost.requests.filter(request => request.method === 'POST' && request.url.includes('/memory/') && request.status === 200);
  expect(memoryWrites.length).toBeGreaterThan(5); expect(memoryWrites.every(request => request.csrf)).toBe(true);
  const image = info.outputPath('memory-host-forget-restart.png');
  await page.screenshot({ path: image, fullPage: true });
  await info.attach('memory-host-forget-restart', { path: image, contentType: 'image/png' });
});
