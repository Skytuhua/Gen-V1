import { test as base, expect, type Page, type TestInfo } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildServer, buildWidgetServer, type MountRegistry } from '../apps/server/server.ts';
import { Service } from '../packages/core/service.ts';
import { Store } from '../packages/storage/store.ts';
import type { ArtifactRecord, DataRecord, HostCommand, Operation, RuntimeAdapter, RuntimeCallbacks, RunContext, Snapshot, StartRun, SurfaceSpec, ToolCall } from '../packages/contracts/index.ts';

export const HOST_URL = 'http://127.0.0.1:4337';
export const FIXTURE_LABEL = 'Host contract fixture (no model inference)';
export const BEFORE = '# Evidence ledger\n\nOriginal test-owned source.\n';
export const AFTER = '# Evidence ledger\n\nApproved test-owned replacement.\n';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

// This is an explicit scripted regression fixture, never a model-generation test.
// Every publication uses the REAL Service.tool callback and the owning active run.
export class ContractRuntime implements RuntimeAdapter {
  callbacks!: RuntimeCallbacks;
  deliveries: Array<{ method: 'start' | 'followUp'; input: StartRun }> = [];
  cancellations: RunContext[] = [];
  activeRunContext: RunContext | undefined;
  constructor(readonly dataDir: string) {}
  configure(callbacks: RuntimeCallbacks) { this.callbacks = callbacks; }
  async models() { return [{ id: 'fixture/host-contract', provider: 'fixture', name: FIXTURE_LABEL }]; }
  async history(sessionPath: string): Promise<string[]> { try { return JSON.parse(await readFile(sessionPath, 'utf8')); } catch { return []; } }
  async start(input: StartRun) { await this.deliver('start', input); }
  async followUp(input: StartRun) { await this.deliver('followUp', input); }
  async cancel(ctx: RunContext) { this.cancellations.push(ctx); }
  async compact() { throw new Error('Compaction is outside this no-inference fixture'); }
  async dispose() {}
  async tool(call: ToolCall) {
    if (!this.activeRunContext) throw new Error('Fixture requires an actual active runtime context');
    return this.callbacks.onTool(call, this.activeRunContext);
  }
  event(type: string, fields: Record<string, unknown> = {}) {
    if (!this.activeRunContext) throw new Error('No owning run');
    this.callbacks.onEvent({ ...this.activeRunContext, type, ...fields });
  }
  private async deliver(method: 'start' | 'followUp', input: StartRun) {
    this.deliveries.push({ method, input });
    this.activeRunContext = { threadId: input.threadId, runId: input.runId, epoch: input.epoch };
    const sessionPath = join(this.dataDir, `fixture-session-${input.threadId}.json`);
    const previous = await this.history(sessionPath);
    await writeFile(sessionPath, JSON.stringify([...new Set([...previous, ...(input.inputIds ?? [input.inputId])])]));
    this.event('session', { sessionPath });
    this.event('input.processing', { inputIds: input.inputIds ?? [input.inputId] });
    if (method === 'followUp') {
      this.event('assistant.message', { messageId: randomUUID(), content: 'Fixture continued the durable decision in the same owning runtime.', inputIds: input.inputIds ?? [input.inputId] });
      return;
    }
    this.event('assistant.message', { messageId: randomUUID(), content: FIXTURE_LABEL, inputIds: input.inputIds ?? [input.inputId] });
    if (input.prompt.includes('[fixture:widget]') || input.prompt.includes('[fixture:loop]')) {
      await this.tool({ name: 'ui_create_widget', args: {
        title: input.prompt.includes('[fixture:loop]') ? 'Untrusted loop fixture' : 'Growing knowledge notebook', purpose: FIXTURE_LABEL,
        html: widgetHtml, inputSchema: { type: 'object', additionalProperties: false },
        eventSchema: { type: 'object', required: ['actionId', 'payload'], properties: { actionId: { const: 'continue' }, payload: { type: 'object', additionalProperties: false } }, additionalProperties: false },
        stateSchema: { type: 'object', required: ['note'], properties: { note: { type: 'string', maxLength: 2000 } }, additionalProperties: false },
        stateSchemaVersion: 1, initialState: { note: 'A small, source-linked notebook.' },
        actions: { continue: { kind: 'agent', prompt: 'Continue knowledge review', schema: { type: 'object', additionalProperties: false } } },
      } });
      return;
    }
    let operation: Operation | undefined;
    let data: DataRecord | undefined;
    const resource = input.resources.find(value => value.kind === 'file');
    if (input.prompt.includes('[fixture:operation]')) {
      if (!resource) throw new Error('Grant the test-owned file before preparing replacement');
      operation = await this.tool({ name: 'file_replace_prepare', args: { resourceId: resource.id, content: AFTER, expectedSha256: sha(BEFORE) } }) as Operation;
    }
    if (resource) {
      data = await this.tool({ name: 'text_import', args: { resourceId: resource.id, title: 'Evidence ledger' } }) as DataRecord;
    }
    await this.tool({ name: 'ui_present', args: {
      title: 'Evidence document', purpose: FIXTURE_LABEL, spec: documentSpec(!!operation, !!data),
      initialState: { note: 'Review the source before continuing.' },
      bindings: data ? { source: { mode: 'snapshot', ref: { id: data.id, revision: data.revision, pointer: '/text' } } } : {},
      actions: operation ? { replace: { kind: 'operation', operationId: operation.id } } : { continue: { kind: 'agent', prompt: 'Continue source review' } },
    } });
    if (input.prompt.includes('[fixture:decision]')) await this.tool({ name: 'ui_request_input', args: {
      title: 'Publish this evidence?', prompt: 'Choose a disposition. This is a scripted host-contract decision.',
      responseSchema: { type: 'object', required: ['choice', 'reason'], properties: { choice: { type: 'string', enum: ['Keep', 'Revise'] }, reason: { type: 'string', title: 'Decision rationale', minLength: 10 } }, additionalProperties: false },
    } });
  }
}

export function documentSpec(operation = false, bound = false): SurfaceSpec {
  return { root: 'root', elements: {
    root: { type: 'Stack', props: { gap: 'lg' }, children: ['document', 'note', 'details', 'action'] },
    document: { type: 'Document', props: { title: 'Evidence ledger', ...(bound ? { dataBinding: 'source' } : { text: '# A working document\n\n## What we know\nThe conversation owns this document and its review notes.\n\n## Next observation\nEdits are saved by the local host and survive reload.\n\nExplicit deterministic regression content; no model inference.' }) } },
    note: { type: 'Input', props: { stateKey: 'note', label: 'Review notes', inputType: 'textarea' } },
    details: { type: 'Disclosure', props: { title: 'Evidence and provenance', text: FIXTURE_LABEL, stateKey: 'evidenceOpen' } },
    action: { type: 'Button', props: { label: operation ? 'Apply document replacement' : 'Continue document review', actionId: operation ? 'replace' : 'continue', tone: 'primary' } },
  } };
}

// Runs on the separate localhost origin, in the production sandbox/CSP wrapper.
// window.harness is the production bridge (not an invented test bridge).
export const widgetHtml = `<!doctype html><html><head><title>Knowledge notebook fixture</title><style>
body{max-width:760px;margin:28px auto;padding:12px}small{color:#777}h1{font:500 28px Georgia,serif}textarea{box-sizing:border-box;width:100%;min-height:100px;padding:12px;border:1px solid #ddd;border-radius:8px;background:var(--card);color:var(--foreground)}button{padding:8px 12px;margin:10px 8px 0 0}article{border-top:1px solid #ddd;margin-top:20px;padding-top:10px}
</style></head><body><small>HOST CONTRACT FIXTURE · NO MODEL INFERENCE</small><h1>Growing knowledge notebook</h1><p>Keep an observation beside its evidence. Checkpoint explicitly before continuing.</p><label>Notebook note<textarea aria-label="Notebook note"></textarea></label><div><button id="save">Checkpoint notebook</button><button id="invalid">Invalid checkpoint</button><button id="continue">Continue notebook</button><button id="spin">Start infinite loop</button></div><p id="status" role="status">Waiting for host init</p><article><h2>Observation 01</h2><p>This document is scripted regression content, delivered through the real host.</p></article><script>
const bridge=window.harness;const note=document.querySelector('textarea');const status=document.querySelector('#status');
bridge.onUpdate(h=>{if(document.activeElement!==note)note.value=h.state.note;if(!status.textContent.startsWith('Host acknowledged'))status.textContent='Host initialized · state revision '+h.stateRevision});
note.oninput=()=>bridge.setDirty(true);
document.querySelector('#save').onclick=async()=>{status.textContent='Waiting for host checkpoint';try{const ack=await bridge.checkpoint({note:note.value});status.textContent='Host acknowledged revision '+ack.stateRevision}catch(e){status.textContent='Checkpoint rejected: '+e.message}};
document.querySelector('#invalid').onclick=async()=>{try{await bridge.checkpoint({note:42});status.textContent='INVALID CHECKPOINT ACCEPTED'}catch(e){status.textContent='Checkpoint rejected: '+e.message}};
document.querySelector('#continue').onclick=()=>bridge.emit('continue',{});
document.querySelector('#spin').onclick=()=>{status.textContent='Infinite loop entered';setTimeout(()=>{while(true){}},150)};
</script></body></html>`;

export class HostFixture {
  store!: Store;
  service!: Service;
  runtime!: ContractRuntime;
  host!: Awaited<ReturnType<typeof buildServer>>;
  widgets!: Awaited<ReturnType<typeof buildWidgetServer>>;
  readonly commands: HostCommand[] = [];
  readonly generations: ContractRuntime[] = [];
  constructor(readonly folder: string, readonly sourceFile: string) {}
  async start() {
    this.store = new Store(join(this.folder, 'storage'));
    this.runtime = new ContractRuntime(this.folder); this.generations.push(this.runtime);
    this.service = new Service(this.store, this.runtime); await this.service.recover();
    const mounts: MountRegistry = new Map();
    this.host = await buildServer(this.service, { port: 4337, widgetPort: 4338, mounts, dev: false });
    this.widgets = await buildWidgetServer(this.service, mounts, 4338);
    this.host.addHook('preHandler', async request => { if (request.url === '/api/commands') this.commands.push(request.body as HostCommand); });
    try {
      // Exclusive bind: an existing listener fails the fixture; never reuse another worker's host.
      await this.host.listen({ port: 4337, host: '127.0.0.1' });
      await this.widgets.listen({ port: 4338, host: 'localhost' });
    } catch (error) { await this.close(); throw error; }
  }
  async close() { await this.host?.close(); await this.widgets?.close(); await this.service?.dispose(); this.store?.close(); }
  async restart() { await this.close(); await this.start(); }
  snapshot(): Snapshot { return this.store.snapshot(); }
  artifact(kind: 'structured' | 'widget'): ArtifactRecord { const item = this.snapshot().artifacts.find(value => value.kind === kind); if (!item) throw new Error(`Missing ${kind} artifact`); return item; }
}

export const test = base.extend<{ host: HostFixture }>({
  host: async ({}, use, info) => {
    await mkdir(info.outputDir, { recursive: true });
    const folder = await mkdtemp(join(info.outputDir, 'isolated-host-'));
    const sourceFile = join(folder, 'evidence-ledger.md'); await writeFile(sourceFile, BEFORE, { flag: 'wx' });
    const host = new HostFixture(folder, sourceFile); await host.start();
    try { await use(host); } finally {
      await writeFile(info.outputPath('host-observations.json'), JSON.stringify({ fixture: FIXTURE_LABEL, ports: [4337, 4338], commands: host.commands, runtimeDeliveries: host.generations.map(runtime => runtime.deliveries), snapshot: host.snapshot() }, null, 2));
      await host.close();
    }
  },
});
export { expect };

export async function openHost(page: Page) {
  await page.goto(HOST_URL);
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toHaveText(FIXTURE_LABEL);
}
export async function sendFixture(page: Page, mode: string) {
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(`[fixture:${mode}] Verify the local host contract.`);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('[data-artifact-id]').first()).toBeVisible();
}
export async function grantFixtureFile(page: Page, host: HostFixture) {
  await page.getByRole('button', { name: 'Add resource', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a resource' });
  await dialog.getByLabel('Resource type').selectOption('file');
  await dialog.getByRole('textbox', { name: 'Absolute local path' }).fill(host.sourceFile);
  await dialog.getByLabel('Allow approved changes').check();
  await dialog.getByRole('button', { name: 'Add resource', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
export async function browserCommand(page: Page, type: string, payload: Record<string, unknown>, threadId?: string) {
  return page.evaluate(async command => {
    const bootstrap = await fetch('/api/bootstrap').then(value => value.json());
    const response = await fetch('/api/commands', { method: 'POST', headers: { 'content-type': 'application/json', 'x-harness-csrf': bootstrap.csrfToken }, body: JSON.stringify(command) });
    return { status: response.status, body: await response.json() };
  }, { id: randomUUID(), type, payload, ...(threadId ? { threadId } : {}) });
}
export async function evidence(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`); await page.screenshot({ path, fullPage: true });
  await info.attach(name, { path, contentType: 'image/png' });
}
