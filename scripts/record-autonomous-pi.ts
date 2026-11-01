/** Genuine subscription-only acceptance. No authored specs, host tools or UI instructions. */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, request } from '@playwright/test';
import type { CommandReceipt, Snapshot, Thread, WorkspaceEvent } from '../packages/contracts/index.ts';
import { openCaptureBrowser, recordWindow, closeCapture } from './review-capture.ts';
import { createFixtures } from './create-fixtures.ts';
import { createSigningPdfFixture } from '../tests/e2e/document-preview-fixture.ts';

const arg = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const output = resolve(arg('--output') ?? `docs/evidence/autonomous-ui-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const baseURL = 'http://127.0.0.1:4317', modelId = 'openai/gpt-6.1-sol';
await mkdir(output); await mkdir(join(output, 'sources'));
const terms = '# Account terms\n\nPersonal applicants must be18 or older with photo ID and proof of a US address. Registered businesses and sole proprietors can apply with business registration or tax identification. The monthly plan costs8 credits and includes10 local payments. Additional local payments cost0.5 credits each. Local payments normally settle the same business day. International transfers take1–3 business days and have a quoted fee before confirmation. Supported balances: USD and EUR. There is no quoted overdraft facility or booking service.\n';
await writeFile(join(output, 'sources/account-terms.md'), terms, { flag: 'wx' });
await writeFile(join(output, 'sources/agreement.pdf'), await createSigningPdfFixture({ pages: 1 }), { flag: 'wx' });
await mkdir(join(output, 'sources/exports'));
const fixtures = await createFixtures(join(output, 'sources/branch-fixture'));
const cases = [
  { id: 'account', title: 'Understand the account', source: join(output, 'sources/account-terms.md'), kind: 'file', prompt: 'Help me understand who can join this account, how payments work and what it costs. Use the attached terms.', next: 'I am a sole proprietor with photo ID and proof of address. What else do I need, and what will my first month cost with14 local payments?' },
  { id: 'agreement', title: 'Complete the agreement', source: join(output, 'sources/agreement.pdf'), kind: 'file', prompt: 'Help me complete this agreement for Alex Morgan, Designer, alex@studio.example, dated October30,2026, and add my signature. Keep it ready for my final review.', next: 'Use legal@studio.example for notices instead. Keep the agreement ready for my review before saving anything.' },
  { id: 'conflict', title: 'Understand the branch conflict', source: fixtures.repository, kind: 'project', prompt: 'Help me understand why this branch cannot merge and what I should do. Inspect the attached repository; do not apply changes.', next: 'Keep both branches’ decisions. What is the smallest resolution I should review before applying anything?' },
  { id:'software',title:'Investigate the quantity failure',source:fixtures.repository,kind:'project',prompt:'Investigate why quantity.test.mjs fails in this disposable repository. Use two independent source checks in parallel: compare the implementation with its assertion, and assess nearby regression risks. Recommend the smallest correction. Do not apply changes or run project code.',next:'The public total(items) call must stay unchanged. Compare the one-line fix with rewriting the reducer and retain the verification requirement.'},
];
// Acceptance input guard only; production has no keyword classifier or UI gate.
for (const item of cases) if (/\b(?:UI|interface|artifact|accordion|json-render|follow-up questions|three root questions)\b/i.test(item.prompt + ' ' + item.next)) throw Error('Natural acceptance prompts must not prescribe presentation.');
await writeFile(join(output, 'cases.json'), JSON.stringify({ modelId, provenance: 'Fictional/disposable local sources; genuine model-authored UI. No API billing or authored interface prompt.', cases }, null, 2));
const api = await request.newContext({ baseURL }); await api.get('/api/bootstrap');
const state = async () => { const r = await api.get('/api/snapshot'); if (!r.ok()) throw Error('Snapshot failed'); return await r.json() as Snapshot; };
const command = async (type: string, payload: Record<string, unknown>, threadId?: string) => {
  const bootstrap = await (await api.get('/api/bootstrap')).json();
  const r = await api.post('/api/commands', { headers: { 'x-harness-csrf': bootstrap.csrfToken }, data: { id: randomUUID(), type, payload, ...(threadId ? { threadId } : {}) } });
  if (!r.ok()) throw Error(`${type}: ${await r.text()}`); return await r.json() as CommandReceipt;
};
const initial = await state(); if (initial.threads.some(t => t.runId)) throw Error('Another run is active; no model call started.');
const models = await (await api.get('/api/models')).json(); if (!models.models?.some((m: {id:string}) => m.id === modelId)) throw Error('Subscription model unavailable; no fallback.');
const capture = await openCaptureBrowser(), results: Record<string, unknown>[] = [];
let owner = '', stop: Awaited<ReturnType<typeof recordWindow>> | undefined;
const scope = (s: Snapshot, id: string) => ({ ...s, threads: s.threads.filter(t => t.id === id), archivedThreads: [], messages: s.messages.filter(x => x.threadId === id), artifacts: s.artifacts.filter(x => x.threadId === id), userStates: s.userStates.filter(x => x.threadId === id), data: s.data.filter(x => x.threadId === id), operations: s.operations.filter(x => x.threadId === id), requests: s.requests.filter(x => x.threadId === id), resources: s.resources.filter(x => x.threadId === id), usage: { [id]: s.usage[id] }, activeThreadId: id });
async function waitSettled(after: number, milliseconds = 300_000) {
  const start = performance.now();
  while (performance.now() - start < milliseconds) {
    const s = await state(), t = s.threads.find(t => t.id === owner)!;
    if(['failed','interrupted','stopped'].includes(t.status))throw Error(`Runtime ${t.status}: ${t.error??'Execution ended before settlement'}`);
    const events = await capture.page.evaluate(() => (window as unknown as { naturalEvents: WorkspaceEvent[] }).naturalEvents ?? []);
    if (events.some(e => e.seq > after && e.type === 'runtime.settled') && (!t.runId || t.status === 'awaiting_input') && !s.operations.some(o => o.threadId === owner && o.status === 'running')) {
      if (['failed', 'interrupted', 'stopped'].includes(t.status)) throw Error(`Runtime ${t.status}: ${t.error}`);
      return s;
    }
    await capture.page.waitForTimeout(700);
  }
  throw Error('Genuine run exceeded its five-minute bound');
}
async function send(text: string) { const input = capture.page.getByRole('textbox', { name: 'Message', exact: true }); await input.fill(text); await capture.page.getByRole('button', { name: 'Send message', exact: true }).click(); }
try {
  for (const item of cases.filter(item => !arg('--case') || arg('--case')!.split(',').includes(item.id))) {
    const folder = join(output, item.id); await mkdir(folder);
    const proof: Record<string, unknown> = { case: item.id, status: 'running', modelId, prompt: item.prompt, continuation: item.next, explicitUiInstructions: false, repairPrompts: [], provenance: 'Actual subscription Pi; natural task prompt; no authored spec or direct host UI tool call.' };
    results.push(proof);
    try {
      await command('settings.update', { modelId, theme: item.id === 'conflict' ? 'dark' : 'light' });
      owner = ((await command('thread.create', { title: item.title })).result as Thread).id; proof.threadId = owner;
      if(item.id==='software')await command('thread.mode',{mode:'plan'},owner);
      const grant = await command('resource.grant', { path: item.source, kind: item.kind, writable: false }, owner); proof.sourceGrant = grant.result;
      if (item.id === 'agreement') await command('resource.grant', { path: join(output, 'sources/exports'), kind: 'export', writable: true }, owner);
      await capture.page.goto(baseURL); await capture.page.evaluate(id => localStorage.setItem('harness:selected-thread', id), owner); await capture.page.reload();
      await expect(capture.page.getByRole('combobox', { name: 'Model', exact: true })).toHaveValue(modelId);
      const before = await state();
      await capture.page.evaluate(({ after, id }) => { const events: WorkspaceEvent[] = []; Object.assign(window, { naturalEvents: events }); const source = new EventSource(`/api/events?after=${after}`); source.addEventListener('workspace', event => { const e = JSON.parse((event as MessageEvent<string>).data); if (e.threadId === id) events.push(e); }); }, { after: before.seq, id: owner });
      stop = await recordWindow(capture.server, capture.page, join(folder, 'genuine.mp4'));
      const started = performance.now(); proof.chapters = [{ title: 'Natural task request', startSeconds: 0 }];
      await send(item.prompt); console.log(`NATURAL_START ${item.id}`);
      const generated = await waitSettled(before.seq); proof.generationSeconds = (performance.now() - started) / 1000;
      await writeFile(join(folder, 'generated.json'), JSON.stringify(scope(generated, owner), null, 2));
      const artifacts = generated.artifacts.filter(a => a.threadId === owner && a.kind === 'structured' && a.lifecycle === 'active');
      if (!artifacts.length) throw Error('Natural request produced no interactive artifact; not repaired by explicitly asking for UI.');
      const interactive = artifacts.some(a => Object.values(a.spec?.elements ?? {}).some(n => ['Disclosure', 'Form', 'Input', 'Steps', 'Table', 'ChoiceList', 'RelationshipGraph', 'DocumentPreview','Diagnostics','ChangeSet','ApiExplorer','Pipeline','ImageCompare'].includes(n.type)));
      if (!interactive) throw Error('Only static presentation was produced.');
      proof.artifactsBefore = artifacts.map(({id,revision,stateId}) => ({id,revision,stateId}));
      if(item.id==='software'){proof.plan=generated.data.find(data=>data.threadId===owner&&data.provenance==='harness:plan')?.value;await capture.page.getByRole('button',{name:'Thread options',exact:true}).click();await capture.page.getByRole('button',{name:'Show plan',exact:true}).click();await expect(capture.page.getByRole('region',{name:'Task plan',exact:true})).toBeVisible();await capture.page.waitForTimeout(1000);await capture.page.getByRole('button',{name:'Close Task plan',exact:true}).click();}
      (proof.chapters as object[]).push({ title: 'Agent-selected interface', startSeconds: (performance.now() - started) / 1000 });
      await capture.page.screenshot({ path: join(folder, 'generated.png') });
      const firstDisclosure = capture.page.locator('.artifact .disclosure-trigger').first(); if (await firstDisclosure.isVisible()) await firstDisclosure.click();
      const beforeContinuation = await state();
      if (beforeContinuation.threads.find(t => t.id === owner)?.status === 'awaiting_input') {
        proof.pendingDecision = true;
        throw Error('A decision is pending; requires human-content driver rather than invented acceptance.');
      }
      await send(item.next); const continued = await waitSettled(beforeContinuation.seq);
      await writeFile(join(folder, 'continued.json'), JSON.stringify(scope(continued, owner), null, 2));
      const updated = continued.artifacts.filter(a => artifacts.some(old => old.id === a.id && a.revision > old.revision));
      if (!updated.length) throw Error('Continuation did not evolve an existing artifact.');
      proof.sameArtifactContinuation = updated.map(({id,revision,stateId}) => ({id,revision,stateId})); proof.continuationChannel = 'ordinary conversation';
      if (item.id === 'conflict' && updated.some(a=>Object.values(a.spec?.elements??{}).some(node=>node.type==='RelationshipGraph'))) {
        await expect(capture.page.locator('.artifact .task-graph-vertical').first()).toBeAttached();
        await capture.page.locator('.artifact .task-graph-vertical').first().scrollIntoViewIfNeeded();
        await expect(capture.page.locator('.artifact .task-graph-vertical').first()).toBeVisible();
        proof.relationshipRendered=true;
      }
      if (item.id === 'agreement') {
        const surface = updated.find(a => Object.values(a.spec?.elements ?? {}).some(node => node.type === 'DocumentPreview'));
        const preview = Object.values(surface?.spec?.elements ?? {}).find(node => node.type === 'DocumentPreview');
        const fields = preview?.props.fieldStateKeys as Record<string, string> | undefined;
        const emailKey = fields?.Email;
        if (!surface || !emailKey) throw Error('Agreement continuation removed the live Email binding.');
        let saved = (await state()).userStates.find(s => s.id === surface.stateId);
        if (saved?.values[emailKey] !== 'legal@studio.example') {
          const choice = Object.values(surface.spec?.elements ?? {}).find(node => node.type === 'ChoiceList' && node.props.stateKey === emailKey && Array.isArray(node.props.options) && node.props.options.some((option: {value?:unknown}) => option.value === 'legal@studio.example'));
          const option = (choice?.props.options as {value:unknown;label:string}[] | undefined)?.find(option => option.value === 'legal@studio.example');
          if (!option) throw Error('Agreement did not offer the requested replacement through a bound local control.');
          const control = capture.page.getByRole('radio', { name: option.label, exact: false });
          await control.click();
          await expect.poll(async () => (await state()).userStates.find(s => s.id === surface.stateId)?.values[emailKey]).toBe('legal@studio.example');
          proof.localContentAction = { kind: 'agent-selected choice', label: option.label, stateKey: emailKey, value: 'legal@studio.example', inferenceRequired: false };
          saved = (await state()).userStates.find(s => s.id === surface.stateId);
        }
        await expect(capture.page.locator('.document-preview canvas').first()).toBeVisible();
        await expect(capture.page.locator('.document-preview').first().getByRole('status')).toContainText(/preview.*Page/);
        proof.agreementQuality = { liveEmailBinding: emailKey, savedEmail: saved?.values[emailKey], canvasReady: true, exportExecuted: false };
      }
      const states = (await state()).userStates.filter(s => s.threadId === owner);
      await capture.page.reload(); await expect(capture.page.locator('.artifact').first()).toBeVisible();
      const restored = await state();
      if (JSON.stringify(states) !== JSON.stringify(restored.userStates.filter(s => s.threadId === owner))) throw Error('Reload changed saved user state.');
      proof.reloadPreserved = true; await writeFile(join(folder, 'reloaded.json'), JSON.stringify(scope(restored, owner), null, 2));
      await capture.page.screenshot({ path: join(folder, 'reloaded.png') }); await capture.page.waitForTimeout(1500);
      proof.status = 'passed'; proof.recording = await stop(); stop = undefined;
      console.log(`NATURAL_PASSED ${item.id}`);
    } catch (error) {
      proof.status = 'failed'; proof.error = String(error); await capture.page.screenshot({ path: join(folder, 'failure.png') }).catch(() => {});
      if (stop) { proof.recording = await stop().catch(e => ({ error: String(e) })); stop = undefined; }
      console.log(`NATURAL_FAILED ${item.id}: ${String(error)}`);
    } finally {
      const latest = await state();
      await writeFile(join(folder, 'final.json'), JSON.stringify(scope(latest, owner), null, 2));
      await writeFile(join(folder, 'events.json'), JSON.stringify(await capture.page.evaluate(() => (window as unknown as {naturalEvents:unknown[]}).naturalEvents ?? []), null, 2));
      if (owner && latest.threads.find(t => t.id === owner)?.runId) { await command('run.stop', {}, owner); proof.stoppedOwnPendingRun = true; }
      await writeFile(join(folder, 'proof.json'), JSON.stringify(proof, null, 2)); await writeFile(join(output, 'results.json'), JSON.stringify({ modelId, results }, null, 2));
    }
  }
} finally { await closeCapture(capture); await api.dispose(); }
if (results.some(r => r.status !== 'passed')) process.exitCode = 1;
