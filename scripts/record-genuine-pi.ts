import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { expect, request, type APIRequestContext } from '@playwright/test';
import type { ArtifactRecord, CommandReceipt, Snapshot, Thread, WorkspaceEvent } from '../packages/contracts/index.ts';
import { openCaptureBrowser, recordWindow, closeCapture } from './review-capture.ts';

const arg = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const baseURL = 'http://127.0.0.1:4317', modelId = 'openai/gpt-6.1-sol';
const output = resolve(arg('--output') ?? `docs/evidence/frontend-review/genuine-pi-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const packet = `# Harbor Room workshop: visit information\n\nThis is a fictional, disposable local source packet for a genuine agent composition test. It is not a real venue booking. Facts below are the only authority for this task.\n\n## Access\nMembers can visit Monday through Thursday 09:00-19:00, Friday 09:00-17:00, and Saturday 10:00-16:00. The workshop is closed Sunday. Visitor passes are available Tuesday and Thursday 13:00-17:00. Book visitors by 17:00 on the previous day; same-day visitor bookings are unavailable. Each member can bring up to two accompanied guests. Guests may observe but cannot operate workshop tools.\n\n## Laser room\nThe laser room requires a completed safety tour before use. Reservations are limited to 90 minutes and two active reservations per member. Cancel at least four hours ahead. A reservation request is not a confirmed booking.\n\n## Quiet work\nThe west alcove has quiet desks. Calls belong in the call booth, reserved in 30-minute slots. The packet does not state desk prices, room capacity, weather policy, or any email/send capability. Treat missing information as unknown.\n\n## Example visit to evaluate after the user acts\nThe user is considering Thursday at 14:30 with one guest, quiet work, and laser use after a safety tour. Explain eligibility and the steps that need checking. No booking, calendar event, message, or external mutation should be performed.\n`;
await mkdir(resolve(output, '..'), { recursive: true });
if (process.argv.includes('--prepare')) {
  await mkdir(output); await mkdir(join(output, 'resources'));
  await writeFile(join(output, 'resources', 'harbor-room-visit-notes.md'), packet, { flag: 'wx' });
  await writeFile(join(output, 'plan.json'), JSON.stringify({ baseURL, modelId, source: 'Fictional local workshop source packet, written for this recording.', recording: '10-genuine-pi-composition.mp4', runtime: 'Existing authenticated subscription Pi; no credentials read and no API-billing fallback.', constraints: 'One bounded generation and one semantic continuation; at most two repair prompts; no authored spec or service.tool calls.' }, null, 2), { flag: 'wx' });
}
const sourcePath = join(output, 'resources', 'harbor-room-visit-notes.md');
const sourceBytes = await readFile(sourcePath); if (sourceBytes.toString() !== packet) throw new Error('Evidence packet differs from the prepared source.');
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
const inspectApi = await request.newContext({ baseURL });
await inspectApi.get('/api/bootstrap');
async function snapshot(api: APIRequestContext) { const response = await api.get(`${baseURL}/api/snapshot`); if (!response.ok()) throw new Error(`Snapshot unavailable (${response.status()})`); return await response.json() as Snapshot; }
const initial = await snapshot(inspectApi);
const active = initial.threads.filter(thread => thread.runId || thread.status === 'working');
if (active.length) throw new Error('Another genuine run is active; no generation started: ' + active.map(thread => thread.id).join(', '));
const modelsResponse = await inspectApi.get('/api/models'), models = await modelsResponse.json();
if (!models.models?.some((model: { id: string }) => model.id === modelId)) throw new Error('The requested subscription Pi model is unavailable. No fallback permitted.');
await writeFile(join(output, 'preflight.json'), JSON.stringify({ checkedAt: new Date().toISOString(), seq: initial.seq, activeRuns: active, modelId, requestedModelAvailable: true, existingThreads: initial.threads.map(({ id, status, runId }) => ({ id, status, runId })), sourcePath, sourceSha256 }, null, 2));
await inspectApi.dispose();
console.log(`GENUINE_PI_READY ${output}`);
if (process.argv.includes('--prepare')) process.exit(0);

const capture = await openCaptureBrowser();
let threadId = '', stop: Awaited<ReturnType<typeof recordWindow>> | undefined;
let lastSettledSeq = 0;
const began = performance.now(), chapters: { name: string; wallTime: string; seconds: number }[] = [], repairs: string[] = [];
const proof: Record<string, unknown> = { status: 'running', provenance: 'Actual production host, genuine subscription Pi generation and continuation. Source packet is fictional; UI/spec is model-authored through real host tools. No fixture host, authored spec, service.tool calls, time interpolation, credential reads, or API-billing fallback.', baseURL, modelId, sourcePath, sourceSha256, chapters, repairPrompts: repairs };
const mark = (name: string) => { const item = { name, wallTime: new Date().toISOString(), seconds: (performance.now() - began) / 1000 }; chapters.push(item); console.log(`CHAPTER ${name} ${item.seconds.toFixed(1)}s`); };
const saveProof = () => writeFile(join(output, 'proof.json'), JSON.stringify(proof, null, 2));
const scoped = (value: Snapshot) => ({ ...value, threads: value.threads.filter(item => item.id === threadId), archivedThreads: value.archivedThreads?.filter(item => item.id === threadId), messages: value.messages.filter(item => item.threadId === threadId), artifacts: value.artifacts.filter(item => item.threadId === threadId), userStates: value.userStates.filter(item => item.threadId === threadId), data: value.data.filter(item => item.threadId === threadId), requests: value.requests.filter(item => item.threadId === threadId), operations: value.operations.filter(item => item.threadId === threadId), resources: value.resources.filter(item => item.threadId === threadId), usage: threadId ? { [threadId]: value.usage[threadId] } : {} });
const saveSnapshot = async (name: string) => { const value = await snapshot(capture.context.request); await writeFile(join(output, `snapshot-${name}.json`), JSON.stringify(scoped(value), null, 2)); return value; };
const command = async (type: string, payload: Record<string, unknown> = {}, owner = threadId) => {
  const bootstrap = await (await capture.context.request.get(`${baseURL}/api/bootstrap`)).json();
  const response = await capture.context.request.post(`${baseURL}/api/commands`, { headers: { 'x-harness-csrf': bootstrap.csrfToken }, data: { id: randomUUID(), type, payload, ...(owner ? { threadId: owner } : {}) } });
  const result = await response.json(); if (!response.ok()) throw new Error(`${type}: ${JSON.stringify(result)}`); return result as CommandReceipt;
};
async function waitForRun(label: string, timeout: number) {
  const started = performance.now(); let observed = false, lastLog = 0, result: Snapshot;
  while (performance.now() - started < timeout) {
    result = await snapshot(capture.context.request); const thread = result.threads.find(item => item.id === threadId)!;
    if (thread.runId) observed = true;
    const events = await capture.page.evaluate(() => (window as unknown as { __genuineEvents?: WorkspaceEvent[] }).__genuineEvents ?? []);
    const settledEvents = events.filter(event => event.type === 'runtime.settled' && event.seq > lastSettledSeq);
    const settled = settledEvents.length > 0;
    if (!thread.runId && (observed || settled)) {
      if (['failed', 'interrupted', 'stopped'].includes(thread.status)) throw new Error(`${label} ended ${thread.status}: ${thread.error ?? ''}`);
      lastSettledSeq = Math.max(lastSettledSeq, ...settledEvents.map(event => event.seq));
      mark(`${label}-settled`); proof[`${label}WaitSeconds`] = (performance.now() - started) / 1000; return result;
    }
    if (performance.now() - started - lastLog >= 15_000) { lastLog = performance.now() - started; console.log(`WAIT ${label} ${Math.round(lastLog / 1000)}s status=${thread.status} run=${thread.runId ?? 'pending'}`); }
    await capture.page.waitForTimeout(800);
  }
  throw new Error(`${label} exceeded its ${timeout / 1000}s bounded wait`);
}
async function sendPrompt(content: string) {
  await expect(capture.page.getByRole('combobox', { name: 'Model', exact: true })).toHaveValue(modelId);
  const input = capture.page.getByRole('textbox', { name: 'Message', exact: true }); await input.fill(content); await capture.page.getByRole('button', { name: 'Send message', exact: true }).click();
}
function workingArtifact(value: Snapshot) { return value.artifacts.find(item => item.threadId === threadId && item.lifecycle === 'active' && item.kind === 'structured'); }
function compositionIssues(artifact: ArtifactRecord | undefined) {
  if (!artifact?.spec) return ['No structured artifact was composed.'];
  const elements = Object.values(artifact.spec.elements), issues: string[] = [];
  const parented = new Set(elements.flatMap(item => item.children ?? []));
  const disclosures = Object.entries(artifact.spec.elements).filter(([, item]) => item.type === 'Disclosure');
  const nested = disclosures.filter(([id]) => elements.some(item => item.type === 'Disclosure' && item.children?.includes(id)));
  if (disclosures.length - nested.length !== 3) issues.push('Need exactly three initial root questions.');
  if (!nested.length) issues.push('Need at least one nested follow-up question.');
  if (!elements.some(item => item.type === 'Input' && item.props.label === 'My visit notes')) issues.push('Need a durable My visit notes input.');
  if (!Object.values(artifact.actions).some(action => action.kind === 'agent')) issues.push('Need a meaningful registered agent continuation action.');
  return issues;
}
try {
  await capture.page.goto(baseURL); await expect(capture.page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
  const before = await snapshot(capture.context.request); if (before.threads.some(item => item.runId || item.status === 'working')) throw new Error('Another genuine run became active; stopped before thread creation.');
  const created = await command('thread.create', { title: 'Harbor Room: plan a workshop visit' }, ''); threadId = (created.result as Thread).id;
  const grant = await command('resource.grant', { path: sourcePath, kind: 'file', writable: false }); const resource = grant.result as { id: string };
  proof.threadId = threadId; proof.resourceId = resource.id;
  await capture.page.evaluate(id => { localStorage.setItem('harness:selected-thread', id); localStorage.removeItem('harness:shell-layout:v1'); }, threadId); await capture.page.reload();
  await expect(capture.page.getByRole('combobox', { name: 'Model', exact: true })).toHaveValue(modelId);
  await capture.page.evaluate(({ after, owner }) => {
    const state = window as unknown as { __genuineEvents: WorkspaceEvent[]; __genuineSource: EventSource };
    state.__genuineEvents = []; state.__genuineSource = new EventSource(`/api/events?after=${after}`);
    state.__genuineSource.addEventListener('workspace', event => { const value = JSON.parse((event as MessageEvent<string>).data) as WorkspaceEvent; if (value.threadId === owner) state.__genuineEvents.push(value); });
  }, { after: before.seq, owner: threadId });
  await saveSnapshot('before-generation'); await saveProof();
  stop = await recordWindow(capture.server, capture.page, join(output, '10-genuine-pi-composition.mp4')); mark('recording-start');
  const prompt = `Use only the granted local source packet resource ${resource.id} to help me plan a Harbor Room workshop visit. This is a fictional source-backed planning task, not a booking. Discover your actual UI components first, then read the source through an actual source tool. Choose and compose one compact progressive Q&A artifact yourself: exactly three concise initial questions, independent retained open states, and at least one relevant nested follow-up. Keep answers short and source-grounded. Include a durable editable field labelled "My visit notes" and one meaningful registered agent action labelled "Review my visit plan" that submits those notes. Preload the factual answers so opening questions is local, without agent calls. Put source/provenance detail under a closed evidence disclosure only if it does not add a fourth root question; a compact evidence note elsewhere is also fine. On that plan action, inspect and revise this SAME artifact ID/current revision in place, preserve all stable element/state keys, expanded branches and visit-note text, and add a concise source-grounded plan review. Do not clear the visit notes on action success. The action's registered prompt must tell the continuation to perform that same-artifact update. Do not book, email, mutate files or ask me to approve operations. Finish once the interactive artifact is ready. No hardcoded app/scenario route and no giant transcript card.`;
  await writeFile(join(output, 'generation-prompt.txt'), prompt, { flag: 'wx' }); mark('generation-prompt'); await sendPrompt(prompt);
  let generated = await waitForRun('generation', 240_000), artifact = workingArtifact(generated);
  while (compositionIssues(artifact).length && repairs.length < 2) {
    const repair = `Please repair the existing Harbor Room artifact in place using your real tools: ${compositionIssues(artifact).join(' ')} Preserve its ID and durable state keys. Keep the My visit notes draft after the Review my visit plan action, and register that action to inspect/revise the SAME artifact on continuation. No new duplicate artifact, no external effect. Finish when repaired.`;
    repairs.push(repair); mark('generation-repair-prompt'); await sendPrompt(repair); generated = await waitForRun(`repair-${repairs.length}`, 150_000); artifact = workingArtifact(generated);
  }
  const issues = compositionIssues(artifact); if (issues.length || !artifact) throw new Error('Composition did not satisfy the task: ' + issues.join(' '));
  proof.artifactId = artifact.id; proof.initialArtifactRevision = artifact.revision; proof.stateId = artifact.stateId;
  const region = capture.page.locator(`[data-artifact-id="${artifact.id}"]`); await expect(region).toBeVisible();
  await saveSnapshot('before-interaction'); await capture.page.screenshot({ path: join(output, 'before-interaction.png') }); mark('local-exploration');
  const disclosures = region.locator('.disclosure-trigger'); const titles = await disclosures.allTextContents(); proof.questionLabels = titles;
  await disclosures.nth(0).click(); await capture.page.waitForTimeout(650);
  const visible = region.locator('.disclosure-trigger:visible'); if (await visible.count() > 1) await visible.nth(1).click(); await capture.page.waitForTimeout(650);
  const roots = region.locator('.disclosure-node').filter({ has: region.locator('.disclosure-trigger') });
  const inputNode = Object.values(artifact.spec!.elements).find(item => item.type === 'Input' && item.props.label === 'My visit notes')!;
  const draft = 'Thursday 14:30 with one guest; quiet work first, laser after the safety tour. What must I arrange ahead?';
  const notes = region.getByRole('textbox', { name: 'My visit notes', exact: true }); await notes.fill(draft);
  await capture.page.waitForTimeout(1000); const beforeAction = await saveSnapshot('before-action');
  const stateBefore = beforeAction.userStates.find(item => item.id === artifact!.stateId)!;
  const opened = await region.locator('.disclosure-trigger[aria-expanded="true"]').allTextContents();
  proof.notesStateKey = inputNode.props.stateKey; proof.draft = draft; proof.openBefore = opened; proof.userStateBefore = stateBefore;
  await capture.page.screenshot({ path: join(output, 'before-action.png') }); mark('semantic-action');
  const actionResponse = capture.page.waitForResponse(response => response.url().endsWith('/api/commands') && response.request().method() === 'POST' && response.request().postDataJSON()?.type === 'action.submit');
  await region.getByRole('button', { name: 'Review my visit plan', exact: true }).click(); const accepted = await actionResponse;
  if (!accepted.ok()) throw new Error('The semantic action was not accepted: ' + await accepted.text());
  const actionCommand = accepted.request().postDataJSON(); proof.actionCommand = actionCommand; proof.actionReceipt = await accepted.json();
  let afterAction = await waitForRun('continuation', 180_000), updated = afterAction.artifacts.find(item => item.id === artifact!.id);
  if ((!updated || updated.revision <= artifact.revision) && repairs.length < 2) {
    const repair = `The accepted visit-plan action must update the existing artifact ${artifact.id} using its current baseRevision. Please inspect it and add the concise source-grounded review of the submitted notes IN PLACE, preserving open-state keys and the un-cleared notes. Do not create a second artifact. Finish after the same artifact revision changes.`;
    repairs.push(repair); mark('continuation-repair-prompt'); await sendPrompt(repair); afterAction = await waitForRun(`repair-${repairs.length}`, 150_000); updated = afterAction.artifacts.find(item => item.id === artifact!.id);
  }
  if (!updated || updated.revision <= artifact.revision) throw new Error('Continuation did not advance the original artifact revision.');
  const preserved = afterAction.userStates.find(item => item.id === artifact!.stateId)!;
  if (preserved.values[String(inputNode.props.stateKey)] !== draft) throw new Error('The continuation discarded the visit-note draft.');
  for (const [key, value] of Object.entries(stateBefore.values)) if (value === true && preserved.values[key] !== true) throw new Error('The continuation discarded an expanded exploration state: ' + key);
  proof.updatedArtifactRevision = updated.revision; proof.sameArtifact = true;
  await saveSnapshot('after-action'); await capture.page.waitForTimeout(900); await capture.page.screenshot({ path: join(output, 'after-action.png') }); mark('reload');
  const events = await capture.page.evaluate(() => (window as unknown as { __genuineEvents: WorkspaceEvent[] }).__genuineEvents); await writeFile(join(output, 'events.json'), JSON.stringify(events, null, 2));
  await capture.page.reload(); await expect(capture.page.locator(`[data-artifact-id="${artifact.id}"]`)).toBeVisible(); await expect(capture.page.locator(`[data-artifact-id="${artifact.id}"]`).getByRole('textbox', { name: 'My visit notes', exact: true })).toHaveValue(draft);
  for (const label of opened) await expect(capture.page.locator(`[data-artifact-id="${artifact.id}"]`).getByRole('button', { name: label.trim(), exact: true })).toHaveAttribute('aria-expanded', 'true');
  const reload = await saveSnapshot('after-reload'); const current = reload.artifacts.find(item => item.id === artifact!.id); if (current?.revision !== updated.revision) throw new Error('Reload did not retain the accepted artifact revision.');
  proof.reloadPreserved = true; proof.finalArtifactRevision = current.revision;
  proof.tools = reload.messages.filter(item => item.threadId === threadId && item.role === 'activity').map(item => ({ id: item.id, runId: item.runId, content: item.content }));
  proof.eventSummary = events.map(({ seq, type, occurredAt }) => ({ seq, type, occurredAt }));
  proof.sourceData = reload.data.filter(item => item.threadId === threadId).map(({ id, revision, provenance }) => ({ id, revision, provenance }));
  proof.runIds = [...new Set(reload.messages.filter(item => item.threadId === threadId).map(item => item.runId).filter(Boolean))];
  await capture.page.waitForTimeout(1800); await capture.page.screenshot({ path: join(output, 'after-reload.png') }); mark('recording-end');
  proof.recording = await stop(); stop = undefined; proof.status = 'passed'; await saveProof(); console.log(`GENUINE_PI_PASSED ${output}`);
} catch (error) {
  proof.status = 'failed'; proof.error = error instanceof Error ? error.stack : String(error); console.error(String(error));
  if (threadId) { const latest = await snapshot(capture.context.request).catch(() => null); const own = latest?.threads.find(item => item.id === threadId); if (own?.runId) { proof.stoppedOwnRunAtBound = own.runId; await command('run.stop').catch(() => {}); } await saveSnapshot('failure').catch(() => {}); }
  await capture.page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  if (stop) { proof.recording = await stop().catch(cause => ({ error: String(cause) })); stop = undefined; }
  await saveProof(); process.exitCode = 1;
} finally { await closeCapture(capture); }
