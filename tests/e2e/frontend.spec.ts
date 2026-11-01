import { test, expect, type Page } from '@playwright/test';
import type { ArtifactRecord, HostCommand, Snapshot, Thread } from '../../packages/contracts';
import { widgetDocument } from '../../packages/core/widgets';
import { build } from 'esbuild';
import { WIDGET_WORKER_CSP } from '../../packages/widgets/protocol';

const workerBundle = build({ entryPoints: ['packages/widgets/worker.ts'], bundle: true, platform: 'browser', format: 'iife', write: false });

// Explicit protocol fixtures: no production startup data or model calls are used.
const timestamp = '2026-10-29T23:00:00.000Z';
const thread = (id: string, title: string): Thread => ({ id, title, projectName: null, createdAt: timestamp, updatedAt: timestamp, status: 'ready', epoch: 0, runId: null, modelId: 'test/model', sessionPath: 'test-session' });
function snapshot(): Snapshot { return { seq: 1, threads: [], messages: [], artifacts: [], userStates: [], data: [], requests: [], operations: [], resources: [], usage: {}, settings: { theme: 'system', modelId: 'test/model' }, activeThreadId: null }; }
function structured(): ArtifactRecord {
  return { id: 'artifact-one', threadId: 'one', messageId: 'assistant-one', title: 'Review workspace', purpose: 'Explicit synthetic protocol fixture', kind: 'structured', revision: 1, spec: { root: 'root', elements: {
    root: { type: 'Stack', props: { gap: 'md' }, children: ['name', 'rows', 'faq', 'tabs', 'button'] },
    name: { type: 'Input', props: { stateKey: 'name', label: 'Review name' } },
    rows: { type: 'Table', props: { rowsBinding: 'records', columns: [{ key: 'name', label: 'Record' }], stateKey: 'selection', rowKey: 'id' } },
    faq: { type: 'Disclosure', props: { title: 'Review details', stateKey: 'detailsOpen', text: 'Details remain associated with this artifact.' } },
    tabs: { type: 'Tabs', props: { labels: ['Evidence', 'Source'], stateKey: 'tab' }, children: ['evidence', 'source'] },
    evidence: { type: 'Text', props: { text: 'Bound record evidence' } }, source: { type: 'Code', props: { code: 'const fixture = true;' } },
    button: { type: 'Button', props: { label: 'Continue review', actionId: 'continue', tone: 'primary' } },
  } }, widget: null, bindings: { records: { mode: 'snapshot', ref: { id: 'data-one', revision: 1 } } }, actions: { continue: { kind: 'agent', schema: { type: 'object' } } }, stateId: 'state-one', lifecycle: 'active', placement: 'inline', pinned: false, catalogVersion: '1.0.0', createdAt: timestamp, updatedAt: timestamp };
}
function populated() {
  const value = snapshot(); value.threads = [thread('one', 'First task'), thread('two', 'Second task')]; value.activeThreadId = 'one';
  value.messages = [{ id: 'assistant-one', threadId: 'one', role: 'assistant', content: 'Review the source-backed records below.', createdAt: timestamp, runId: null }];
  value.artifacts = [structured()]; value.userStates = [{ id: 'state-one', threadId: 'one', revision: 0, schemaVersion: 1, values: {} }];
  value.data = [{ id: 'data-one', threadId: 'one', revision: 1, value: [{ id: 'record-one', name: 'Synthetic record' }], provenance: 'Playwright fixture', createdAt: timestamp }]; return value;
}
function widgetWorkspace() {
  const initial = populated(); const artifact = initial.artifacts[0]!;
  artifact.kind = 'widget'; artifact.spec = null; artifact.bindings = {}; artifact.actions = {};
  artifact.widget = { hash: 'fixture-hash', html: `<label>Widget note<input id="note" aria-label="Widget note"></label><button id="save">Checkpoint note</button><button id="invalid">Invalid checkpoint</button><output id="receipt"></output><output id="theme"></output><script>
    let edited = false;
    harness.onUpdate(h => { if (!edited) document.getElementById('note').value = h.state.note || ''; document.getElementById('theme').textContent = h.theme.colorScheme + '|' + h.theme['--background']; });
    document.getElementById('note').oninput = () => { edited = true; harness.setDirty(true); };
    document.getElementById('invalid').onclick = async () => { try { await harness.checkpoint({ note: 42 }); } catch (error) { document.getElementById('receipt').textContent = error.message; } };
    document.getElementById('save').onclick = async () => { try { const result = await harness.checkpoint({ note: document.getElementById('note').value }); edited = false; document.getElementById('receipt').textContent = 'Saved revision ' + result.stateRevision; } catch (error) { document.getElementById('receipt').textContent = error.message; } };
  </script>`, inputSchema: { type: 'object' }, eventSchema: { type: 'object' }, stateSchema: { type: 'object', required: ['note'], properties: { note: { type: 'string' } }, additionalProperties: false }, stateSchemaVersion: 1 };
  initial.userStates[0]!.values = { note: 'Original checkpoint' };
  return initial;
}
async function host(page: Page, initial = snapshot(), hasModels = true) {
  const state = { snapshot: initial, commands: [] as HostCommand[], csrf: [] as string[], snapshotReads: 0, failSave: false, failRelease: false, failArchive: false, mounts: 0, abortMessageOnce: false, bootstraps: 0, expired: false, csrfExpired: false, leases: new Map<string, string>(), afterCommand: undefined as ((command: HostCommand) => Promise<void>) | undefined };
  await page.addInitScript(() => {
    const streams: EventTarget[] = [];
    class MockEventSource extends EventTarget {
      onopen: (() => void) | null = null; onerror: (() => void) | null = null; onmessage: ((event: MessageEvent) => void) | null = null;
      constructor(_url: string) { super(); streams.push(this); queueMicrotask(() => this.onopen?.()); }
      close() { const index = streams.indexOf(this); if (index >= 0) streams.splice(index, 1); }
    }
    Object.defineProperty(window, 'EventSource', { value: MockEventSource });
    Object.assign(window, { __disconnect: () => streams.forEach(stream => (stream as MockEventSource).onerror?.()), __emitWorkspace: (seq: number) => streams.forEach(stream => stream.dispatchEvent(new MessageEvent('workspace', { data: JSON.stringify({ seq, id: `event-${seq}`, type: 'test', threadId: null, payload: {}, occurredAt: new Date().toISOString() }) }))) });
  });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/bootstrap') { state.bootstraps++; state.expired = false; state.csrfExpired = false; return route.fulfill({ json: { csrfToken: 'test-csrf-token', widgetOrigin: 'http://localhost:4318' } }); }
    if (state.expired && url.pathname !== '/api/commands') return route.fulfill({ status: 401, json: { error: { code: 'AUTH_REQUIRED', message: 'Reconnect to the local host' } } });
    if (url.pathname === '/api/models') return route.fulfill({ json: { models: hasModels ? [{ id: 'test/model', provider: 'test', name: 'Test model' }] : [], ...(!hasModels ? { error: 'No authenticated model is available.' } : {}) } });
    if (url.pathname === '/api/snapshot') { state.snapshotReads++; return route.fulfill({ json: state.snapshot }); }
    if (url.pathname.endsWith('/mount')) {
      state.mounts++;
      const artifact = state.snapshot.artifacts.find(item => item.id === url.pathname.split('/')[3])!;
      return route.fulfill({ json: { url: `http://localhost:4318/widget/${artifact.id}/${artifact.revision}?ticket=test-${state.mounts}#token=token-${state.mounts}&mountId=mount-${state.mounts}`, token: `token-${state.mounts}`, mountId: `mount-${state.mounts}`, revision: artifact.revision } });
    }
    if (url.pathname.endsWith('/source')) return route.fulfill({ body: JSON.stringify(state.snapshot.artifacts[0]?.spec ?? {}) });
    if (url.pathname !== '/api/commands') return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Unknown test API route.' } } });
    const cmd = route.request().postDataJSON() as HostCommand;
    state.commands.push(cmd); state.csrf.push(route.request().headers()['x-harness-csrf'] ?? '');
    if (state.expired || state.csrfExpired) return route.fulfill({ status: state.expired ? 401 : 403, json: { error: { code: state.expired ? 'AUTH_REQUIRED' : 'CSRF_REQUIRED', message: 'Renew the local session' } } });
    if (state.abortMessageOnce && cmd.type === 'message.send') { state.abortMessageOnce = false; return route.abort('connectionreset'); }
    const p = cmd.payload; let result: unknown = {};
    if (cmd.type === 'edit.begin') {
      const owner = state.leases.get(String(p.stateId));
      if (owner && owner !== p.clientId) return route.fulfill({ status: 409, json: { error: { code: 'USER_EDIT_CONFLICT', message: 'Another client owns this edit.' } } });
      state.leases.set(String(p.stateId), String(p.clientId));
    }
    if (cmd.type === 'edit.end' && state.failRelease) return route.fulfill({ status: 409, json: { error: { code: 'USER_EDIT_CONFLICT', message: 'Lease release failed; retain your draft.' } } });
    if (cmd.type === 'edit.end' && state.leases.get(String(p.stateId)) === p.clientId) state.leases.delete(String(p.stateId));
    if (cmd.type === 'state.save' && state.failSave) return route.fulfill({ status: 409, json: { error: { code: 'STALE_USER_STATE', message: 'The saved draft changed; keep both versions.' } } });
    if (cmd.type === 'thread.create') { const item = thread(`new-${state.commands.length}`, 'New thread'); state.snapshot.threads.push(item); result = item; }
    if (cmd.type === 'thread.rename') state.snapshot.threads.find(item => item.id === cmd.threadId)!.title = String(p.title);
    if (cmd.type === 'thread.archive') { state.snapshot.threads = state.snapshot.threads.filter(item => item.id !== cmd.threadId); if (state.snapshot.activeThreadId === cmd.threadId) state.snapshot.activeThreadId = null; }
    if (cmd.type === 'settings.update') {
      const preferences = { ...state.snapshot.settings.preferences, ...(p.preferences as object ?? {}) };
      Object.assign(state.snapshot.settings, p, { preferences });
    }
    if (cmd.type === 'thread.presentation') {
      const item = state.snapshot.threads.find(item => item.id === cmd.threadId)!;
      item.presentation = { ...item.presentation, ...p };
    }
    if (cmd.type === 'resource.grant' || cmd.type === 'resource.upload') state.snapshot.resources.push({ id: `resource-${state.commands.length}`, threadId: cmd.threadId!, kind: cmd.type === 'resource.upload' ? 'attachment' : p.kind as 'project', label: String(p.name ?? p.path), path: String(p.path ?? '/test/attachment'), writable: p.writable === true, createdAt: timestamp });
    if (cmd.type === 'message.send') state.snapshot.messages.push({ id: `message-${state.commands.length}`, threadId: cmd.threadId!, role: 'user', content: String(p.content), createdAt: timestamp, runId: null });
    if (cmd.type === 'state.save' || cmd.type === 'widget.checkpoint') {
      const record = state.snapshot.userStates.find(item => item.id === (p.stateId ?? state.snapshot.artifacts.find(item => item.id === p.artifactId)?.stateId))!;
      if (cmd.type === 'widget.checkpoint' && state.leases.get(record.id) !== p.clientId) return route.fulfill({ status: 409, json: { error: { code: 'EDIT_LEASE_REQUIRED', message: 'Checkpoint must own the edit lease.' } } });
      if ((p.baseRevision ?? p.baseStateRevision) !== record.revision) return route.fulfill({ status: 409, json: { error: { code: 'STALE_USER_STATE', message: 'Revision mismatch.' } } });
      record.values = p.values as Record<string, unknown>; record.revision++; result = record;
    }
    if (cmd.type === 'artifact.expand') state.snapshot.artifacts.find(item => item.id === p.artifactId)!.placement = p.expanded ? 'expanded' : 'inline';
    if (cmd.type === 'artifact.pin') state.snapshot.artifacts.find(item => item.id === p.artifactId)!.pinned = p.pinned === true;
    if (cmd.type === 'artifact.archive') {
      const artifact = state.snapshot.artifacts.find(item => item.id === p.artifactId)!;
      if (artifact.pinned || state.leases.has(artifact.stateId)) return route.fulfill({ status: 409, json: { error: { code: 'USER_EDIT_CONFLICT', message: 'Unpin and finish editing before archiving.' } } });
      if (state.failArchive) return route.fulfill({ status: 409, json: { error: { code: 'ARCHIVE_FAILED', message: 'Archive failed; retain your draft.' } } });
      artifact.lifecycle = 'archived';
    }
    if (cmd.type === 'request.respond' || cmd.type === 'request.withdraw') state.snapshot.requests.find(item => item.id === p.requestId)!.status = cmd.type === 'request.respond' ? 'accepted' : 'withdrawn';
    if (cmd.type === 'operation.approve') { const operation = state.snapshot.operations.find(item => item.id === p.operationId)!; operation.approved = true; }
    if (cmd.type === 'operation.reject') { const operation = state.snapshot.operations.find(item => item.id === p.operationId)!; operation.status = 'cancelled'; }
    if (cmd.type === 'action.submit') {
      const record = state.snapshot.userStates.find(item => item.id === state.snapshot.artifacts.find(item => item.id === p.artifactId)?.stateId)!;
      const artifact = state.snapshot.artifacts.find(item => item.id === p.artifactId)!;
      const owner = state.leases.get(record.id);
      if (typeof p.clientId !== 'string' || owner && owner !== p.clientId) return route.fulfill({ status: 409, json: { error: { code: 'USER_EDIT_CONFLICT', message: 'Action must identify the editing client.' } } });
      const dataIds = Object.values(artifact.bindings).map(binding => binding.mode === 'snapshot' ? binding.ref.id : binding.id);
      if (p.baseStateRevision !== record.revision || !dataIds.every(id => Object.hasOwn(p.dataRevisions as object, id))) return route.fulfill({ status: 409, json: { error: { code: 'STALE_USER_STATE', message: 'Action must include accepted state and data ID revisions.' } } });
      if (p.submittedState !== undefined) { record.values = p.submittedState as Record<string, unknown>; record.revision++; }
      const action = state.snapshot.artifacts.find(item => item.id === p.artifactId)!.actions[String(p.actionId)]!;
      result = action.kind === 'operation' ? { approvalRequired: true, operation: state.snapshot.operations.find(item => item.id === action.operationId) } : { inputId: 'test-action-input' };
    }
    state.snapshot.seq++;
    await state.afterCommand?.(cmd);
    return route.fulfill({ json: { commandId: cmd.id, eventSeq: state.snapshot.seq, result } });
  });
  await page.route('http://localhost:4318/widget/**', async route => {
    const id = new URL(route.request().url()).pathname.split('/')[2];
    const artifact = state.snapshot.artifacts.find(item => item.id === id)!;
    return route.fulfill({ contentType: 'text/html', body: widgetDocument(artifact.widget!, artifact.id) });
  });
  await page.route('**/widget-runtime/worker.js', async route => route.fulfill({ contentType: 'text/javascript', headers: { 'Content-Security-Policy': WIDGET_WORKER_CSP, 'X-Content-Type-Options': 'nosniff' }, body: Buffer.from((await workerBundle).outputFiles[0]!.contents) }));
  return state;
}

test('the accepted Settings model reaches a new task composer and its next sent message', async ({ page }) => {
  const initial = snapshot(); initial.settings.modelId = 'test/first';
  const state = await host(page, initial);
  await page.route('**/api/models*', route => route.fulfill({ json: { models: [{ id: 'test/first', name: 'First', provider: 'test' }, { id: 'test/second', name: 'Second', provider: 'test' }] } }));
  await page.goto('/');
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toHaveText('First');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Threads', exact: true }).click();
  await page.getByRole('combobox', { name: 'Default model', exact: true }).selectOption('test/second');
  await expect.poll(() => state.snapshot.settings.modelId).toBe('test/second');
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toHaveText('Second');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Continue with the selected subscription model.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => state.commands.find(command => command.type === 'message.send')?.payload.modelId).toBe('test/second');
});

test('operation receipts keep full evidence identities behind explicit inspection', async ({ page }) => {
  const initial = populated(), digest = 'a'.repeat(64);
  initial.operations.push({ id: 'receipt-one', threadId: 'one', revision: 1, kind: 'database.migration', description: `Apply 4 statements with exact counts and resource version ${digest}`, args: {}, resourceIds: [], preconditions: { sourceSha256: digest }, status: 'succeeded', approved: true, createdAt: timestamp });
  await host(page, initial); await page.goto('/');
  const receipt = page.locator('.decision[data-operation-id="receipt-one"]');
  const summary = receipt.locator(':scope > details > summary');
  await expect(summary).not.toContainText(digest);
  await expect(summary).toContainText('Apply 4 statements with exact counts');
  await summary.click();
  await receipt.getByText('Changes and preconditions', { exact: true }).click();
  await expect(receipt.locator('details pre').first()).toContainText(digest);
});

test('wide inline artifacts match the composer while narrative text remains bounded', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const initial = populated(); initial.artifacts[0].presentation = { width: 'wide', frame: 'card' };
  await host(page, initial); await page.goto('/');
  const artifact = page.locator('.artifact-width-wide'); await expect(artifact).toBeVisible();
  expect((await artifact.boundingBox())!.width).toBeCloseTo((await page.locator('.composer').boundingBox())!.width,0);
  expect((await page.locator('.message-assistant .message-content').first().boundingBox())!.width).toBeLessThanOrEqual(760);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('the default interface loads the pinned T3 variable font while explicit font choices remain authoritative', async ({ page }) => {
  const state = await host(page, populated()); await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(() => page.evaluate(() => [...document.fonts].filter(font => font.family.includes('Inter Variable') && font.status === 'loaded').length)).toBeGreaterThan(0);
  await expect(page.locator('.app-shell')).toHaveCSS('font-family', /Inter Variable/);
  state.snapshot.settings.preferences = { interfaceFont: 'Arial' }; state.snapshot.seq++;
  await page.evaluate(seq => (window as unknown as { __emitWorkspace: (seq: number) => void }).__emitWorkspace(seq), state.snapshot.seq);
  await expect(page.locator('.app-shell')).toHaveCSS('font-family', 'Arial');
});

test('source-bound operation tabs retain selection and mount identity while status and contextual SQL update', async ({ page }) => {
  const initial = populated(), artifact = initial.artifacts[0];
  artifact.spec = { root: 'tabs', elements: {
    tabs: { type: 'Tabs', props: { stateKey: 'table', labels: ['users', 'projects'], statusBinding: 'operationTabs' }, children: ['users', 'projects'] },
    users: { type: 'Input', props: { stateKey: 'note', label: 'Review note' } }, projects: { type: 'Text', props: { text: 'Prepared project rows' } },
  } };
  artifact.bindings = { operationTabs: { mode: 'live', id: 'tabs-status' } };
  initial.data.push({ id: 'tabs-status', threadId: 'one', revision: 1, provenance: 'Explicit fixture, not database execution', createdAt: timestamp, value: { title: 'add_workspaces', detail: 'Prepared · 2 tables', status: 'pending', items: [{ label: 'users', status: 'neutral', code: 'UPDATE users SET workspace_id = 1' }, { label: 'projects', status: 'neutral', code: 'UPDATE projects SET workspace_id = 1' }], footer: { label: 'Prepared' } } });
  const state = await host(page, initial); await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Review note', exact: true });
  await input.fill('Keep this local edit'); const identity = await input.elementHandle();
  await page.getByRole('tab', { name: 'projects', exact: true }).click();
  const record = state.snapshot.data.find(item => item.id === 'tabs-status')!; record.revision++;
  record.value = { title: 'add_workspaces', detail: 'Applied locally', status: 'success', items: [{ label: 'users', status: 'success', detail: '12 records verified', code: 'UPDATE users SET workspace_id = 1' }, { label: 'projects', status: 'success', detail: '8 records verified', code: 'UPDATE projects SET workspace_id = 1' }], footer: { label: 'Applied' } }; state.snapshot.seq++; await emit(page, state.snapshot.seq);
  await expect(page.getByRole('tab', { name: 'projects', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.task-tabs-operation-footer')).toContainText('8 records verified');
  await expect(page.locator('.task-tabs-operation-footer code')).toHaveText('UPDATE projects SET workspace_id = 1');
  await page.getByRole('tab', { name: 'users', exact: true }).click();
  await expect(input).toHaveValue('Keep this local edit'); expect(await input.evaluate((node, previous) => node === previous, identity)).toBe(true);
});

test('canvas artifacts preserve fixed expanded and workspace geometry with the same mounted editor', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const initial = populated(); initial.artifacts[0].presentation = { width: 'compact', frame: 'canvas' };
  await host(page, initial); await page.goto('/');
  const artifact = page.locator('.artifact'), input = page.getByRole('textbox', { name: 'Review name', exact: true });
  const identity = await input.elementHandle();
  await artifact.getByRole('button', { name: 'Expand artifact', exact: true }).focus();
  await artifact.getByRole('button', { name: 'Expand artifact', exact: true }).click();
  await expect(artifact).toHaveCSS('position', 'fixed');
  expect((await artifact.boundingBox())!.height).toBeGreaterThan(800);
  await artifact.getByRole('button', { name: 'Collapse artifact', exact: true }).click();
  await artifact.getByRole('button', { name: 'Open artifact in workspace', exact: true }).focus();
  await artifact.getByRole('button', { name: 'Open artifact in workspace', exact: true }).click();
  await expect(artifact).toHaveCSS('position', 'fixed');
  expect(await input.evaluate((node, previous) => node === previous, identity)).toBe(true);
});

test('question glyphs use the reference blue accent independently of disclosure chevrons', async ({ page }) => {
  await host(page, populated()); await page.goto('/');
  const colors = await page.locator('.disclosure-question-mark').evaluate(mark => ({ expected: getComputedStyle(mark).color, actual: getComputedStyle(mark.querySelector('svg')!).color }));
  expect(colors.actual).toBe(colors.expected);
});
const emit = (page: Page, sequence: number) => page.evaluate(seq => (window as unknown as { __emitWorkspace: (seq: number) => void }).__emitWorkspace(seq), sequence);
function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
const readJournal = (page: Page, key: string) => page.evaluate(async key => { const path = '/src/journal.ts'; return (await import(path)).journalRead(key); }, key);

test('settings inventory is searchable across all sections and unavailable capabilities cannot be enabled', async ({ page }) => {
  await host(page, populated()); await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  for (const label of ['General', 'Appearance', 'Chat', 'Diffs & pull requests', 'Keybindings', 'SnapShots', 'Providers', 'Threads', 'Browser', 'Devices', 'Scheduled tasks', 'Projects', 'Source control', 'Worktrees', 'Environments', 'Sharing & access', 'Secrets', 'Maintenance', 'Labs', 'About', 'Archive', 'Diagnostics', 'Licenses']) {
    await expect(settings.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
  await settings.getByRole('searchbox', { name: 'Search all settings' }).fill('recording');
  await expect(settings.getByText('Browser recording frame rate', { exact: true })).toBeVisible();
  const row = settings.locator('[data-setting-id="browser-recording-frame-rate"]');
  await expect(row).toContainText('Unavailable');
  await expect(row.getByRole('button')).toBeDisabled();
  expect(await settings.locator('[data-setting-id]').count()).toBeGreaterThan(2);
});

test('accepted preferences survive reload and preserve the composer and structured draft', async ({ page }) => {
  await page.setViewportSize({width:1920,height:1080});
  const state = await host(page, populated()); state.failSave = true;
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Review name' }).fill('Keep my local review');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep my next message');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.getByRole('button', { name: 'Appearance', exact: true }).click();
  await settings.getByRole('combobox', { name: 'Chat width', exact: true }).selectOption('full');
  await expect.poll(() => state.snapshot.settings.preferences?.chatWidth).toBe('full');
  await settings.getByRole('button', { name: 'Chat', exact: true }).click();
  await settings.getByRole('combobox', { name: 'Send shortcut', exact: true }).selectOption('mod-enter');
  await expect.poll(() => state.snapshot.settings.preferences?.sendShortcut).toBe('mod-enter');
  await settings.getByRole('button', { name: 'Close settings' }).click();
  expect((await page.locator('.composer-dock').boundingBox())!.width).toBeGreaterThan(760);
  await expect(page.getByRole('textbox', { name: 'Review name' })).toHaveValue('Keep my local review');
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Keep my next message');
  await page.getByRole('textbox', { name: 'Message', exact: true }).press('Enter');
  expect(state.commands.some(item => item.type === 'message.send')).toBe(false);
  await page.reload();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-chat-width', 'full');
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Keep my next message\n');
});

test('workspace layout persists and context unknowns never appear as zero', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await host(page, populated()); await page.goto('/');
  await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sidebar-collapsed', 'true');
  await page.getByRole('button', { name: 'Open workspace panel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Open a surface', exact: true })).toBeVisible();
  const launcher = page.getByRole('region', { name: 'Workspace launcher' });
  for (const name of ['Browser', 'Terminal', 'Pull request', 'Linked pull requests', 'Device']) await expect(launcher.getByRole('button', { name, exact: true })).toBeDisabled();
  await expect(launcher.getByRole('button', { name: 'Files', exact: true })).toBeEnabled();
  await page.getByRole('tab', { name: 'Usage', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Workspace panel' })).toContainText('Unavailable');
  await page.reload();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sidebar-collapsed', 'true');
  await expect(page.getByRole('tab', { name: 'Usage', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Close workspace panel', exact: true }).click();
  await page.getByRole('button', { name: 'Inspect context usage' }).click();
  await expect(page.getByRole('dialog', { name: 'Context inspector' })).toContainText('Unavailable');
  await expect(page.getByRole('progressbar', { name: 'Context used' })).toHaveCount(0);
});

test('workspace artifact tabs preserve the exact authenticated widget mount and unsaved editor', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const state = await host(page, widgetWorkspace()); await page.goto('/');
  const frame = page.frameLocator('iframe[title="Review workspace"]');
  await frame.getByRole('textbox', { name: 'Widget note' }).fill('Keep the same mounted editor');
  await page.evaluate(() => Object.assign(window, { __workspaceEditor: document.querySelector('iframe') }));
  await page.getByRole('button', { name: 'Open artifact in workspace', exact: true }).click();
  await expect(page.locator('.artifact-in-workspace')).toBeVisible();
  await expect(frame.getByRole('textbox', { name: 'Widget note' })).toHaveValue('Keep the same mounted editor');
  await page.getByRole('tab', { name: 'Usage', exact: true }).click();
  await page.getByRole('tab', { name: 'Artifact', exact: true }).click();
  await page.getByRole('button', { name: 'Maximize workspace panel' }).click();
  await page.getByRole('button', { name: 'Restore workspace panel' }).click();
  await page.getByRole('button', { name: 'Return artifact to conversation', exact: true }).click();
  await expect(frame.getByRole('textbox', { name: 'Widget note' })).toHaveValue('Keep the same mounted editor');
  expect(await page.evaluate(() => document.querySelector('iframe') === (window as unknown as { __workspaceEditor: Element }).__workspaceEditor)).toBe(true);
  expect(state.mounts).toBe(1);
});

test('workspace files, diffs and executor output show actual scoped snapshot evidence', async ({ page }) => {
  const initial = populated();
  initial.resources.push({ id: 'project-one', threadId: 'one', kind: 'project', path: '/fixture', label: 'Fixture project', writable: false, createdAt: timestamp });
  initial.data.push({ id: 'diff-one', threadId: 'one', revision: 1, value: { before: 'old value', after: 'new value', title: 'Recorded comparison' }, provenance: 'Explicit executor comparison fixture', createdAt: timestamp });
  initial.operations.push({ id: 'check-one', threadId: 'one', revision: 2, kind: 'repository.test', description: 'Recorded test receipt', args: {}, resourceIds: ['project-one'], preconditions: {}, status: 'succeeded', approved: true, result: { stdout: 'one real fixture check passed', exitCode: 0 }, createdAt: timestamp });
  await host(page, initial);
  const reads: string[] = [];
  await page.route('**/api/resources/project-one/tree**', async route => { reads.push(new URL(route.request().url()).pathname); await route.fulfill({ json: { path: '', entries: [{ name: 'example.txt', path: 'example.txt', kind: 'file', bytes: 22 }], truncated: false } }); });
  await page.route('**/api/resources/project-one/content**', async route => { reads.push(new URL(route.request().url()).search); await route.fulfill({ contentType: 'text/plain', body: 'Scoped fixture contents' }); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open workspace panel', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Workspace panel' });
  await panel.getByRole('tab', { name: 'Files', exact: true }).click();
  await panel.getByRole('button', { name: /example.txt/ }).click();
  await expect(panel.getByText('Scoped fixture contents', { exact: true })).toBeVisible();
  expect(reads).toEqual(['/api/resources/project-one/tree', '?path=example.txt']);
  await panel.getByRole('tab', { name: 'Diff', exact: true }).click();
  await expect(panel.getByText('old value', { exact: true })).toBeVisible();
  await expect(panel.getByText('new value', { exact: true })).toBeVisible();
  await panel.getByRole('tab', { name: 'Output', exact: true }).click();
  await expect(panel).toContainText('one real fixture check passed');
  await expect(panel).toContainText('Interactive terminals and PTY input are unavailable.');
});

test('sidebar presentation, ordering and keyboard resize leave runtime status unchanged', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const state = await host(page, populated()); await page.goto('/');
  await page.getByRole('button', { name: 'Options for First task' }).click();
  await page.getByRole('button', { name: 'Pin thread', exact: true }).click();
  await expect.poll(() => state.snapshot.threads[0]?.presentation?.pinned).toBe(true);
  expect(state.snapshot.threads[0]!.status).toBe('ready');
  await page.getByRole('button', { name: 'Options for Second task' }).click();
  await page.getByRole('button', { name: 'Settle thread', exact: true }).click();
  await expect.poll(() => state.snapshot.threads[1]?.presentation?.settled).toBe(true);
  expect(state.snapshot.threads[1]!.status).toBe('ready');
  const resize = page.getByRole('separator', { name: 'Resize sidebar' });
  await resize.focus(); await resize.press('ArrowRight');
  await expect(resize).toHaveAttribute('aria-valuenow', '268');
  await page.reload();
  await expect(resize).toHaveAttribute('aria-valuenow', '268');
});

test('reported context categories and accepted compaction remain anchored and keyboard accessible', async ({ page }) => {
  const initial = populated();
  initial.usage.one = { contextTokens: 42000, contextWindow: 100000, inputTokens: 39000, outputTokens: 3000, cost: null, activity: 'idle', sessionPercent: null, weeklyPercent: null, contextBreakdown: [{ label: 'System', tokens: 14000 }, { label: 'Conversation', tokens: 28000 }] };
  const state = await host(page, initial), compaction = gate();
  state.afterCommand = async cmd => {
    if (cmd.type !== 'run.compact') return;
    state.snapshot.usage.one!.activity = 'compacting'; state.snapshot.seq += 10; await emit(page, state.snapshot.seq);
    await compaction.promise;
    state.snapshot.usage.one!.contextTokens = 26000; state.snapshot.usage.one!.contextBreakdown = undefined; state.snapshot.usage.one!.activity = 'idle'; state.snapshot.seq += 10;
  };
  await page.goto('/');
  const anchor = page.getByRole('button', { name: 'Inspect context usage' }); await anchor.click();
  const inspector = page.getByRole('dialog', { name: 'Context inspector' });
  const inspectorBox = (await inspector.boundingBox())!;
  expect(inspectorBox.width).toBeGreaterThanOrEqual(320);
  expect(inspectorBox.x).toBeGreaterThanOrEqual(0);
  expect(inspectorBox.x + inspectorBox.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  const category = inspector.getByRole('button', { name: 'System: 14K tokens', exact: true }); await category.focus();
  await expect(category).toBeFocused();
  await expect(inspector.getByRole('progressbar', { name: 'Context used' })).toHaveAttribute('value', '42');
  await inspector.getByRole('button', { name: 'Compact now' }).click();
  await expect(inspector.getByRole('button', { name: 'Compacting…', exact: true })).toBeDisabled();
  compaction.release();
  await expect(inspector.getByRole('progressbar', { name: 'Context used' })).toHaveAttribute('value', '26');
  await expect(inspector).toContainText('Category breakdown unavailable');
  expect(state.commands.filter(item => item.type === 'run.compact')).toHaveLength(1);
  state.snapshot.threads[0]!.runId = 'active-keyboard-run'; state.snapshot.threads[0]!.status = 'working'; state.snapshot.seq += 10; await emit(page, state.snapshot.seq);
  await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(inspector).toHaveCount(0); await expect(anchor).toBeFocused();
  expect(state.commands.some(item => item.type === 'run.stop')).toBe(false);
  await page.keyboard.press('Escape');
  await expect.poll(() => state.commands.filter(item => item.type === 'run.stop').length).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await anchor.click();
  const narrowBox = (await inspector.boundingBox())!;
  expect(narrowBox.width).toBeGreaterThanOrEqual(320);
  expect(narrowBox.x).toBeGreaterThanOrEqual(0);
  expect(narrowBox.x + narrowBox.width).toBeLessThanOrEqual(390);
});

test('capture shell and settings review batch', async ({ page }, testInfo) => {
  test.skip(process.env.HARNESS_CAPTURE_SHELL !== '1', 'Opt-in bounded shell evidence batch.');
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  const initial = populated();
  // Explicit synthetic UI partitions; these are not real runtime telemetry.
  initial.usage.one = { contextTokens: 42000, contextWindow: 100000, inputTokens: 39000, outputTokens: 3000, cost: null, activity: 'idle', sessionPercent: null, weeklyPercent: null, contextBreakdown: [{ label: 'System', tokens: 14000 }, { label: 'Conversation', tokens: 28000 }] };
  await host(page, initial); await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Review name' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('shell-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Open artifact in workspace', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('shell-workspace.png'), fullPage: true });
  await page.getByRole('button', { name: 'Close workspace panel', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('shell-settings.png'), fullPage: true });
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await page.getByRole('button', { name: 'Inspect context usage' }).click();
  await page.getByRole('button', { name: 'System: 14K tokens', exact: true }).focus();
  await page.screenshot({ path: testInfo.outputPath('shell-context.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator('.app-shell').evaluate(element => Math.round(element.getBoundingClientRect().height))).toBe(844);
  await page.screenshot({ path: testInfo.outputPath('shell-narrow.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const kind of ['structured', 'widget'] as const) test(`work activity groups empty tool turns without remounting the ${kind} artifact`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const initial = kind === 'widget' ? widgetWorkspace() : populated();
  initial.threads[0]!.status = 'working'; initial.threads[0]!.runId = 'live-run';
  const events = [
    'resource_read: running', 'resource_read: progress', 'resource_read: finished',
    'catalog_tools: running', 'catalog_tools: finished', 'resource_read: running',
    'resource_read: finished', 'artifact_create: running', 'artifact_create: finished',
    'input_request: running', 'input_request: progress', 'input_request: finished',
  ];
  initial.messages = [
    { id: 'user-one', threadId: 'one', role: 'user', content: 'Inspect the observing kit.', createdAt: timestamp, runId: 'live-run' },
    ...events.flatMap((content, index) => [
      { id: `empty-${index}`, threadId: 'one', role: 'assistant' as const, content: index % 2 ? ' \n ' : '', createdAt: timestamp, runId: 'live-run' },
      { id: `activity-${index}`, threadId: 'one', role: 'activity' as const, content, createdAt: timestamp, runId: 'live-run' },
    ]),
    { id: 'assistant-one', threadId: 'one', role: 'assistant', content: '', createdAt: timestamp, runId: 'live-run' },
  ];
  const state = await host(page, initial); await page.goto('/');
  const input = kind === 'widget' ? page.frameLocator('iframe[title="Review workspace"]').getByRole('textbox', { name: 'Widget note' }) : page.getByRole('textbox', { name: 'Review name' });
  await input.fill('Keep this in-progress artifact edit');
  const activity = page.locator('details.activity'), summary = activity.locator('summary');
  await expect(activity).toHaveCount(1);
  await expect(activity).not.toHaveAttribute('open', '');
  await expect(summary).toHaveAccessibleName('Work activity · 12 updates · input_request: finished');
  await expect(page.locator('.message-assistant')).toHaveCount(1);
  await expect(activity.getByRole('listitem').first()).not.toBeVisible();
  expect(await summary.evaluate(element => getComputedStyle(element).fontSize)).toBe('14px');
  expect((await summary.boundingBox())!.height).toBeLessThan(32);
  const gap = await page.evaluate(() => document.querySelector('.artifact')!.getBoundingClientRect().top - document.querySelector('details.activity')!.getBoundingClientRect().bottom);
  expect(gap).toBeLessThanOrEqual(24);
  await page.evaluate(() => Object.assign(window, { __activityMount: document.querySelector('.artifact input, .artifact iframe'), __artifactMessage: document.querySelector('.message-assistant'), __activityDisclosure: document.querySelector('details.activity') }));
  const append = async (content: string) => {
    state.snapshot.messages.splice(-1, 0, { id: `progress-${state.snapshot.seq}`, threadId: 'one', role: 'activity', content, createdAt: timestamp, runId: 'live-run' });
    state.snapshot.seq += 10; await emit(page, state.snapshot.seq);
  };
  await append('artifact_update: progress');
  await expect(summary).toHaveAccessibleName('Work activity · 13 updates · artifact_update: progress');
  await expect(activity).not.toHaveAttribute('open', '');
  await expect(input).toHaveValue('Keep this in-progress artifact edit'); await expect(input).toBeFocused();
  expect(await page.evaluate(() => {
    const previous = window as unknown as { __activityMount: unknown; __artifactMessage: unknown; __activityDisclosure: unknown };
    return previous.__activityMount === document.querySelector('.artifact input, .artifact iframe') && previous.__artifactMessage === document.querySelector('.message-assistant') && previous.__activityDisclosure === document.querySelector('details.activity');
  })).toBe(true);
  if (kind === 'widget') expect(state.mounts).toBe(1);
  if (process.env.HARNESS_CAPTURE_UI === '1') await page.screenshot({ path: testInfo.outputPath(`work-activity-${kind}.png`), fullPage: true });
  await summary.focus(); await summary.press('Enter');
  await expect(activity).toHaveAttribute('open', '');
  await expect(activity.getByRole('list', { name: 'Activity updates' }).getByRole('listitem')).toHaveText([...events, 'artifact_update: progress']);
  await append('artifact_update: failed');
  await expect(activity).toHaveAttribute('open', '');
  await expect(summary).toHaveAccessibleName('Work activity · 14 updates · artifact_update: failed');
  await expect(activity.getByRole('listitem')).toHaveText([...events, 'artifact_update: progress', 'artifact_update: failed']);
  await expect(page.getByRole('status')).toContainText('Working');
  await expect(activity.locator('.tone-success')).toHaveCount(0);
  await summary.press('Space'); await expect(activity).not.toHaveAttribute('open', '');
  expect(errors).toEqual([]);
});

test('work activity stops at assistant text, user turns and empty artifact messages', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const initial = populated();
  initial.messages = [
    ['a1', 'activity', 'resource_read: running'], ['empty-one', 'assistant', ''], ['a2', 'activity', 'resource_read: finished'],
    ['explanation', 'assistant', 'The source is ready for review.'], ['a3', 'activity', 'catalog_tools: running'],
    ['followup', 'user', 'Use the first kit.'], ['a4', 'activity', 'artifact_create: finished'],
    ['assistant-one', 'assistant', ''], ['a5', 'activity', 'artifact_update: running'], ['empty-two', 'assistant', ' \n '],
    ['a6', 'activity', `tool_${'long_name_'.repeat(25)}: failed <img src=x onerror=alert(1)>`],
  ].map(([id, role, content]) => ({ id: id!, threadId: 'one', role: role as 'assistant' | 'activity' | 'user', content: content!, createdAt: timestamp, runId: 'live-run' }));
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await host(page, initial); await page.goto('/');
  const summaries = page.locator('details.activity > summary');
  await expect(summaries).toHaveCount(4);
  await expect(summaries).toHaveText([
    'Work activity · 2 updates · resource_read: finished', 'Work activity · 1 update · catalog_tools: running',
    'Work activity · 1 update · artifact_create: finished', `Work activity · 2 updates · tool_${'long_name_'.repeat(25)}: failed <img src=x onerror=alert(1)>`,
  ]);
  await expect(page.getByRole('textbox', { name: 'Review name' })).toBeVisible();
  await expect(page.locator('.message-assistant')).toHaveCount(2);
  expect(await page.locator('.message-activity').first().evaluate(element => parseFloat(getComputedStyle(element).marginBottom))).toBeLessThanOrEqual(16);
  expect(await page.locator('.conversation').evaluate(element => Array.from(element.children).map(child => child.querySelector('.activity') ? 'activity' : child.querySelector('.artifact') ? 'artifact' : child.textContent))).toEqual(['activity', 'The source is ready for review.', 'activity', 'Use the first kit.', 'activity', 'artifact', 'activity']);
  await summaries.last().focus(); await summaries.last().press('Enter');
  await expect(page.locator('details.activity[open]').getByRole('listitem')).toHaveCount(2);
  await expect(page.locator('details.activity img')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('work activity updates preserve the reading position and keep following an expanded tail', async ({ page }) => {
  const initial = populated(); initial.artifacts = [];
  initial.messages = Array.from({ length: 25 }, (_, index) => ({ id: `body-${index}`, threadId: 'one', role: 'assistant' as const, content: `Conversation entry ${index}\n\n${'Readable conversation body. '.repeat(10)}`, createdAt: timestamp, runId: null }));
  initial.messages.push({ id: 'first-activity', threadId: 'one', role: 'activity', content: 'resource_read: running', createdAt: timestamp, runId: 'live-run' });
  const state = await host(page, initial); await page.goto('/');
  const scroller = page.locator('.conversation-scroll'), summary = page.locator('details.activity > summary');
  await expect(summary).toContainText('1 update');
  await scroller.evaluate(element => { element.scrollTop = 160; element.dispatchEvent(new Event('scroll')); });
  const position = await scroller.evaluate(element => element.scrollTop);
  const append = async (id: string, content: string) => {
    state.snapshot.messages.push({ id: `empty-${id}`, threadId: 'one', role: 'assistant', content: '', createdAt: timestamp, runId: 'live-run' }, { id, threadId: 'one', role: 'activity', content, createdAt: timestamp, runId: 'live-run' });
    state.snapshot.seq += 10; await emit(page, state.snapshot.seq);
  };
  await append('next-activity', 'resource_read: progress');
  await expect(summary).toContainText('2 updates');
  expect(await scroller.evaluate(element => element.scrollTop)).toBeCloseTo(position, 0);
  await page.getByRole('button', { name: 'Jump to latest' }).click();
  await summary.focus(); await summary.press('Enter');
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')); });
  await append('last-activity', `resource_read: progress\n\n${'Actual recorded detail.\n\n'.repeat(25)}`);
  await expect(page.locator('details.activity[open]').getByRole('listitem')).toHaveCount(3);
  await expect.poll(() => scroller.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(5);
  await expect(page.locator('details.activity')).toHaveCount(1);
});

test('work activity keeps the full ordered group across the history limit', async ({ page }) => {
  const initial = populated();
  const events = Array.from({ length: 120 }, (_, index) => `resource_read: progress ${index + 1}`);
  initial.messages = [
    ...events.flatMap((content, index) => [
      { id: `activity-${index}`, threadId: 'one', role: 'activity' as const, content, createdAt: timestamp, runId: 'live-run' },
      { id: `empty-${index}`, threadId: 'one', role: 'assistant' as const, content: '', createdAt: timestamp, runId: 'live-run' },
    ]),
    { id: 'assistant-one', threadId: 'one', role: 'assistant', content: '', createdAt: timestamp, runId: 'live-run' },
  ];
  await host(page, initial); await page.goto('/');
  const activity = page.locator('details.activity');
  await expect(activity.locator('summary')).toHaveAccessibleName('Work activity · 120 updates · resource_read: progress 120');
  await activity.locator('summary').focus(); await activity.locator('summary').press('Enter');
  await expect(activity.getByRole('listitem')).toHaveText(events);
  await page.evaluate(() => Object.assign(window, { __historyActivity: document.querySelector('details.activity') }));
  await page.getByRole('button', { name: 'Load earlier messages' }).click();
  await expect(activity).toHaveCount(1); await expect(activity).toHaveAttribute('open', '');
  expect(await page.evaluate(() => (window as unknown as { __historyActivity: unknown }).__historyActivity === document.querySelector('details.activity'))).toBe(true);
});

test('P2: concurrent first-thread composer actions share creation and retain the next draft', async ({ page }) => {
  const state = await host(page, snapshot()); const creation = gate(), sending = gate();
  state.afterCommand = async cmd => { if (cmd.type === 'thread.create') await creation.promise; if (cmd.type === 'message.send') await sending.promise; };
  await page.goto('/'); const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill('First submitted message'); await input.press('Enter');
  await expect.poll(() => state.commands.filter(cmd => cmd.type === 'thread.create').length).toBe(1);
  // The creation response is still held while genuinely conflicting handlers run.
  await input.fill('Next draft typed behind the creation barrier');
  await page.getByRole('button', { name: 'Add resource', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  await page.locator('input[type=file]').setInputFiles({ name: 'conflicting.txt', mimeType: 'text/plain', buffer: Buffer.from('Intercepted fixture') });
  await input.press('Enter'); await page.keyboard.press('Control+Shift+O');
  creation.release();
  await expect.poll(() => state.commands.filter(cmd => cmd.type === 'message.send').length).toBe(1);
  try {
    expect(state.snapshot.threads).toHaveLength(1);
    await expect(page.getByRole('button', { name: 'Add resource', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
    await expect(page.locator('button.new-thread')).toBeDisabled();
    await expect(input).toHaveValue('Next draft typed behind the creation barrier');
    await input.fill('Next draft typed after composer migration');
  } finally { sending.release(); }
  await expect(page.getByRole('button', { name: 'Add resource', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Add resource', exact: true }).click();
  await page.getByRole('textbox', { name: 'Absolute local path' }).fill('C:\\fixture\\project');
  await page.getByRole('dialog', { name: 'Add a resource' }).getByRole('button', { name: 'Add resource', exact: true }).click();
  await expect.poll(() => state.commands.filter(cmd => cmd.type === 'resource.grant').length).toBe(1);
  const sent = state.commands.find(cmd => cmd.type === 'message.send')!;
  expect(sent.payload.content).toBe('First submitted message');
  expect(state.commands.find(cmd => cmd.type === 'resource.grant')?.threadId).toBe(sent.threadId);
  expect(state.commands.filter(cmd => cmd.type === 'resource.upload')).toHaveLength(0);
  await expect(input).toHaveValue('Next draft typed after composer migration');
  await page.reload(); await expect(input).toHaveValue('Next draft typed after composer migration');
  expect(await readJournal(page, 'draft:new')).toBe('');
  expect(state.snapshot.threads).toHaveLength(1);
});

test('P2: typing between initial draft migration and composer activation stays on the created thread', async ({ page }) => {
  const state = await host(page, snapshot()); const creation = gate(), refreshing = gate(), refreshStarted = gate();
  let holdSnapshot = false;
  state.afterCommand = async cmd => { if (cmd.type === 'thread.create') await creation.promise; };
  await page.route('**/api/snapshot', async route => { if (holdSnapshot) { refreshStarted.release(); await refreshing.promise; } await route.fallback(); });
  await page.goto('/'); const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill('Draft before migration');
  await page.getByRole('button', { name: 'Add resource', exact: true }).click();
  await expect.poll(() => state.commands.filter(cmd => cmd.type === 'thread.create').length).toBe(1);
  holdSnapshot = true; creation.release(); await refreshStarted.promise;
  await input.fill('Typed after migration before activation');
  holdSnapshot = false; refreshing.release();
  await page.getByRole('dialog', { name: 'Add a resource' }).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(input).toHaveValue('Typed after migration before activation');
  expect(await readJournal(page, 'draft:new')).toBe('');
  await page.reload(); await expect(input).toHaveValue('Typed after migration before activation');
  expect(state.snapshot.threads).toHaveLength(1);
});

function optionalDecision() {
  const initial = populated(); initial.requests.push({ id: 'optional', threadId: 'one', artifactId: null, revision: 1, title: 'Optional details', prompt: 'Contact and reviewers may be omitted.', responseSchema: { type: 'object', properties: {
    contact: { type: 'object', title: 'Contact', required: ['name'], properties: { name: { type: 'string', title: 'Contact name' }, aliases: { type: 'array', title: 'Aliases', minItems: 1, items: { type: 'string' } } } },
    reviewers: { type: 'array', title: 'Reviewers', minItems: 1, items: { type: 'object', required: ['name'], properties: { name: { type: 'string', title: 'Reviewer name' } } } },
    note: { type: 'string', title: 'Decision note' },
  } }, basis: [], status: 'pending' }); return initial;
}

test('P2: absent optional nested objects and arrays stay omitted from decisions', async ({ page }) => {
  const state = await host(page, optionalDecision()); await page.goto('/');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect.poll(() => state.commands.find(cmd => cmd.type === 'request.respond')?.payload).toEqual({ requestId: 'optional', revision: 1, response: {} });
});

test('P2: optional containers activate validation and retain drafts through opt-out and opt-in', async ({ page }) => {
  const state = await host(page, optionalDecision()); await page.goto('/');
  const contact = page.getByRole('checkbox', { name: 'Include Contact', exact: true });
  await page.getByRole('textbox', { name: 'Decision note', exact: true }).fill('Unrelated draft stays');
  await contact.check();
  const name = page.getByRole('textbox', { name: 'Contact name', exact: true });
  await expect(name).toHaveAttribute('required', '');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  expect(state.commands.filter(cmd => cmd.type === 'request.respond')).toHaveLength(0);
  await name.fill('Avery'); await contact.uncheck();
  await expect(name).toBeHidden();
  await expect.poll(() => readJournal(page, 'request:optional:1')).toMatchObject({ response: { note: 'Unrelated draft stays' } });
  expect((await readJournal(page, 'request:optional:1') as { response: object }).response).not.toHaveProperty('contact');
  await contact.check(); await expect(name).toHaveValue('Avery');
  await page.getByRole('checkbox', { name: 'Include Aliases', exact: true }).check();
  await page.getByRole('button', { name: 'Add Aliases', exact: true }).click();
  await page.getByRole('textbox', { name: 'Aliases 1', exact: true }).fill('Primary');
  await page.getByRole('checkbox', { name: 'Include Reviewers', exact: true }).check();
  await page.getByRole('button', { name: 'Add Reviewers', exact: true }).click();
  await page.getByRole('textbox', { name: 'Reviewer name', exact: true }).fill('Blair');
  await page.getByRole('checkbox', { name: 'Include Reviewers', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'Include Reviewers', exact: true }).check();
  await expect(page.getByRole('textbox', { name: 'Reviewer name', exact: true })).toHaveValue('Blair');
  await page.reload(); await expect(name).toHaveValue('Avery');
  await expect(page.getByRole('textbox', { name: 'Aliases 1', exact: true })).toHaveValue('Primary');
  await expect(page.getByRole('textbox', { name: 'Decision note', exact: true })).toHaveValue('Unrelated draft stays');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect.poll(() => state.commands.find(cmd => cmd.type === 'request.respond')?.payload.response).toEqual({ contact: { name: 'Avery', aliases: ['Primary'] }, reviewers: [{ name: 'Blair' }], note: 'Unrelated draft stays' });
});

for (const rejection of ['dirty', 'http409'] as const) test(`P2: widget ${rejection} action errors appear in trusted UI without replacing its draft`, async ({ page }) => {
  const initial = widgetWorkspace(); initial.artifacts[0]!.actions = { continue: { kind: 'agent', schema: { type: 'object' } } };
  initial.artifacts[0]!.widget!.html += `<button id="act">Submit widget action</button><script>document.getElementById('act').onclick=()=>harness.emit('continue', {});</script>`;
  const state = await host(page, initial); await page.goto('/');
  const frame = page.frameLocator('iframe[title="Review workspace"]'), iframe = await page.locator('iframe').elementHandle();
  const note = frame.getByRole('textbox', { name: 'Widget note' });
  await expect(note).toHaveValue('Original checkpoint');
  await note.fill('Unsynced action draft');
  await expect.poll(() => state.leases.get('state-one')).toBe('widget:artifact-one:mount-1');
  if (rejection === 'http409') {
    await frame.getByRole('button', { name: 'Checkpoint note', exact: true }).click();
    await expect(frame.locator('#receipt')).toHaveText('Saved revision 1');
    state.leases.set('state-one', 'other-client');
  }
  await frame.getByRole('button', { name: 'Submit widget action', exact: true }).click();
  const error = page.locator('.widget-container').getByRole('alert');
  await expect(error).toContainText(rejection === 'dirty' ? 'Checkpoint your widget edits before submitting' : 'Action must identify the editing client');
  await expect(page.getByRole('button', { name: 'Retry widget', exact: true })).toHaveCount(0);
  await expect(note).toHaveValue('Unsynced action draft');
  expect(await iframe!.evaluate(node => node === document.querySelector('iframe'))).toBe(true); expect(state.mounts).toBe(1);
  if (rejection === 'dirty') {
    expect(state.commands.filter(cmd => cmd.type === 'action.submit')).toHaveLength(0);
    expect(await unloadIsGuarded(page)).toBe(true);
    await page.getByRole('button', { name: 'Dismiss widget action error', exact: true }).click(); await expect(error).toHaveCount(0);
    await frame.getByRole('button', { name: 'Checkpoint note', exact: true }).click(); await expect(frame.locator('#receipt')).toHaveText('Saved revision 1');
  } else state.leases.delete('state-one');
  await frame.getByRole('button', { name: 'Submit widget action', exact: true }).click();
  await expect.poll(() => state.snapshot.userStates[0]!.revision).toBe(2);
  await expect(error).toHaveCount(0); await expect(note).toHaveValue('Unsynced action draft'); expect(state.mounts).toBe(1);
});

for (const resource of ['upload', 'picker'] as const) test(`regression: delayed resource ${resource} migrates the newest composer generation`, async ({ page }) => {
  const state = await host(page, snapshot()); const held = gate();
  state.afterCommand = async cmd => { if (cmd.type === 'thread.create') await held.promise; };
  await page.goto('/'); const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill('Old resource draft');
  if (resource === 'upload') await page.locator('input[type=file]').setInputFiles({ name: 'draft.txt', mimeType: 'text/plain', buffer: Buffer.from('Fixture bytes') });
  else await page.getByRole('button', { name: 'Add resource', exact: true }).click();
  await expect.poll(() => state.commands.filter(cmd => cmd.type === 'thread.create').length).toBe(1);
  await input.fill('New text typed during resource creation'); held.release();
  if (resource === 'picker') { await expect(page.getByRole('dialog', { name: 'Add a resource' })).toBeVisible(); await page.getByRole('button', { name: 'Cancel', exact: true }).click(); }
  else await expect.poll(() => state.commands.filter(cmd => cmd.type === 'resource.upload').length).toBe(1);
  await expect(input).toHaveValue('New text typed during resource creation');
  const id = state.snapshot.threads[0]!.id;
  expect(await readJournal(page, `draft:${id}`)).toBe('New text typed during resource creation');
  expect(await readJournal(page, 'draft:new')).toBe('');
  await page.reload(); await expect(input).toHaveValue('New text typed during resource creation');
  expect(state.commands.filter(cmd => cmd.type === 'message.send')).toHaveLength(0);
});

for (const failure of ['release', 'archive'] as const) test(`regression: widget ${failure} failure preserves the draft and allows archive retry`, async ({ page }) => {
  const state = await host(page, widgetWorkspace()); await page.goto('/');
  const frame = page.frameLocator('iframe[title="Review workspace"]');
  await frame.getByRole('textbox', { name: 'Widget note' }).fill('Retain after failed discard');
  await expect.poll(() => state.leases.get('state-one')).toBe('widget:artifact-one:mount-1');
  await page.getByRole('button', { name: 'Archive artifact', exact: true }).click();
  if (failure === 'release') state.failRelease = true; else state.failArchive = true;
  await page.getByRole('button', { name: 'Discard edits and archive', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: `${failure === 'release' ? 'Lease release' : 'Archive'} failed` })).toBeVisible();
  await expect(frame.getByRole('textbox', { name: 'Widget note' })).toHaveValue('Retain after failed discard');
  expect(state.mounts).toBe(1); expect(await unloadIsGuarded(page)).toBe(true);
  expect(state.snapshot.artifacts[0]!.lifecycle).toBe('active');
  if (failure === 'release') expect(state.commands.filter(cmd => cmd.type === 'artifact.archive')).toHaveLength(0);
  state.failRelease = false; state.failArchive = false;
  await page.getByRole('button', { name: 'Discard edits and archive', exact: true }).click();
  await expect(page.locator('iframe')).toHaveCount(0);
  const archiveIndex = state.commands.findIndex(cmd => cmd.type === 'artifact.archive');
  expect(state.commands.slice(0, archiveIndex).some(cmd => cmd.type === 'edit.end')).toBe(true);
  expect(state.leases.has('state-one')).toBe(false); expect(await unloadIsGuarded(page)).toBe(false);
  expect(state.snapshot.userStates[0]!.values).toEqual({ note: 'Original checkpoint' });
});

test('regression: nested object and array decisions retain typed drafts and revision identity', async ({ page }) => {
  const initial = populated(); initial.requests.push({ id: 'nested', threadId: 'one', artifactId: null, revision: 4, title: 'Nested choice', prompt: 'Choose a contact and reviewers.', responseSchema: { type: 'object', properties: {
    contact: { type: 'object', title: 'Contact', required: ['label'], properties: { label: { type: 'string', title: 'Contact label' } } },
    reviewers: { type: 'array', title: 'Reviewers', minItems: 1, items: { type: 'object', required: ['name', 'priority'], properties: { name: { type: 'string', title: 'Reviewer name' }, priority: { type: 'integer', title: 'Priority' }, active: { type: 'boolean', title: 'Active' } } } },
  }, required: ['contact', 'reviewers'] }, basis: [], status: 'pending' });
  const state = await host(page, initial); await page.goto('/');
  await page.getByRole('textbox', { name: 'Contact label', exact: true }).fill('Primary contact');
  await page.getByRole('button', { name: 'Add Reviewers', exact: true }).click();
  await page.getByRole('textbox', { name: 'Reviewer name', exact: true }).fill('Avery');
  await page.getByRole('spinbutton', { name: 'Priority', exact: true }).fill('2');
  await page.getByRole('checkbox', { name: 'Active', exact: true }).check();
  await page.reload(); await expect(page.getByRole('textbox', { name: 'Contact label', exact: true })).toHaveValue('Primary contact');
  await expect(page.getByRole('textbox', { name: 'Reviewer name', exact: true })).toHaveValue('Avery');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect.poll(() => state.commands.find(cmd => cmd.type === 'request.respond')?.payload).toEqual({ requestId: 'nested', revision: 4, response: { contact: { label: 'Primary contact' }, reviewers: [{ name: 'Avery', priority: 2, active: true }] } });
});

test('regression: invalid nested array values cannot submit and remain recoverable', async ({ page }) => {
  const initial = populated(); initial.requests.push({ id: 'array', threadId: 'one', artifactId: null, revision: 1, title: 'Array choice', prompt: 'Choose whole numbers.', responseSchema: { type: 'array', minItems: 1, items: { type: 'integer', minimum: 1 } }, basis: [], status: 'pending' });
  const state = await host(page, initial); await page.goto('/');
  await page.getByRole('button', { name: 'Add Response', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Response 1', exact: true }).fill('0');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  expect(state.commands.filter(cmd => cmd.type === 'request.respond')).toHaveLength(0);
  await page.reload(); await expect(page.getByRole('spinbutton', { name: 'Response 1', exact: true })).toHaveValue('0');
  state.snapshot.requests[0]!.revision = 2; state.snapshot.seq += 10; await emit(page, state.snapshot.seq);
  await expect(page.getByRole('spinbutton', { name: 'Response 1', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add Response', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Response 1', exact: true }).fill('3');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect.poll(() => state.commands.find(cmd => cmd.type === 'request.respond')?.payload).toEqual({ requestId: 'array', revision: 2, response: [3] });
});

test('regression: Escape from the focused widget collapses its retained expanded mount', async ({ page }) => {
  const state = await host(page, widgetWorkspace()); await page.goto('/');
  const frame = page.frameLocator('iframe[title="Review workspace"]');
  await expect(frame.getByRole('textbox', { name: 'Widget note' })).toHaveValue('Original checkpoint');
  await frame.getByRole('textbox', { name: 'Widget note' }).fill('Retain while collapsing');
  await expect.poll(() => state.leases.get('state-one')).toBe('widget:artifact-one:mount-1');
  await page.getByRole('button', { name: 'Expand artifact', exact: true }).click();
  await page.evaluate(() => window.postMessage({ channel: 'harness-widget', token: 'token-1', mountId: 'mount-1', artifactId: 'artifact-one', type: 'shell.escape', payload: {} }, '*'));
  await expect(page.locator('.artifact')).toHaveClass(/artifact-expanded/);
  await frame.getByRole('textbox', { name: 'Widget note' }).press('Escape');
  await expect(page.locator('.artifact')).not.toHaveClass(/artifact-expanded/);
  await expect(page.getByRole('button', { name: 'Expand artifact', exact: true })).toBeFocused();
  await expect(frame.getByRole('textbox', { name: 'Widget note' })).toHaveValue('Retain while collapsing'); expect(state.mounts).toBe(1);
});

test('regression: structured actions carry the same edit client identity', async ({ page }) => {
  const state = await host(page, populated()); await page.goto('/');
  await page.getByRole('textbox', { name: 'Review name' }).fill('Owned structured action');
  await page.getByRole('button', { name: 'Continue review', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  await expect.poll(() => state.snapshot.userStates[0]!.revision).toBe(2);
  const edit = state.commands.find(cmd => cmd.type === 'edit.begin')!;
  expect(state.commands.find(cmd => cmd.type === 'action.submit')?.payload.clientId).toBe(edit.payload.clientId);
});

test('regression: widget actions carry their current mount edit client identity', async ({ page }) => {
  const initial = widgetWorkspace(); initial.artifacts[0]!.actions = { continue: { kind: 'agent', schema: { type: 'object' } } };
  initial.artifacts[0]!.widget!.html += `<button id="act">Submit widget action</button><script>document.getElementById('act').onclick=()=>harness.emit('continue', {});</script>`;
  const state = await host(page, initial); await page.goto('/'); const frame = page.frameLocator('iframe[title="Review workspace"]');
  await frame.getByRole('textbox', { name: 'Widget note' }).fill('Owned widget checkpoint');
  await frame.getByRole('button', { name: 'Checkpoint note', exact: true }).click(); await expect(frame.locator('#receipt')).toHaveText('Saved revision 1');
  state.leases.set('state-one', 'widget:artifact-one:mount-1');
  await frame.getByRole('button', { name: 'Submit widget action', exact: true }).click();
  await expect.poll(() => state.snapshot.userStates[0]!.revision).toBe(2);
  expect(state.commands.find(cmd => cmd.type === 'action.submit')?.payload.clientId).toBe('widget:artifact-one:mount-1');
  expect(state.commands.find(cmd => cmd.type === 'widget.checkpoint')?.payload.clientId).toBe('widget:artifact-one:mount-1');
});

test('an old save acknowledgment cannot erase a newer remounted journal or overlap its save', async ({ page }) => {
  const state = await host(page, populated()); const held = gate();
  state.afterCommand = async cmd => { if (cmd.type === 'state.save' && cmd.payload.values && (cmd.payload.values as Record<string, unknown>).name === 'Old generation') await held.promise; };
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Review name' }).fill('Old generation');
  await expect.poll(() => state.commands.filter(cmd => cmd.type === 'state.save').length).toBe(1);
  await page.getByRole('button', { name: 'Second task Ready' }).click();
  await page.getByRole('button', { name: 'First task Ready' }).click();
  await page.getByRole('textbox', { name: 'Review name' }).fill('New remounted generation');
  await page.getByRole('button', { name: 'Unsaved changes', exact: true }).click();
  expect(state.commands.filter(cmd => cmd.type === 'state.save')).toHaveLength(1);
  state.failSave = true; held.release();
  await expect.poll(() => state.commands.filter(cmd => cmd.type === 'edit.end').length).toBeGreaterThan(0);
  expect(await readJournal(page, 'state:state-one')).toMatchObject({ values: { name: 'New remounted generation' }, baseRevision: 1 });
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Review name' })).toHaveValue('New remounted generation');
});

for (const fresh of [false, true]) test(`send acknowledgment preserves the next draft (${fresh ? 'new thread migration' : 'existing thread'})`, async ({ page }) => {
  const state = await host(page, fresh ? snapshot() : populated()); const held = gate();
  state.afterCommand = async cmd => { if (cmd.type === 'message.send') await held.promise; };
  await page.goto('/'); const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill('Submitted generation'); await input.press('Enter');
  await expect.poll(() => state.commands.filter(cmd => cmd.type === 'message.send').length).toBe(1);
  await input.fill('Next unsent draft'); held.release();
  await expect(page.getByText('Submitted generation', { exact: true })).toBeVisible();
  await expect(input).toHaveValue('Next unsent draft');
  await page.reload(); await expect(input).toHaveValue('Next unsent draft');
});

test('action acceptance advances the save base without dropping edits typed during submit', async ({ page }) => {
  const state = await host(page, populated()); const held = gate();
  state.afterCommand = async cmd => { if (cmd.type === 'action.submit') await held.promise; };
  await page.goto('/'); await page.getByRole('button', { name: 'Continue review', exact: true }).click();
  await expect.poll(() => state.commands.filter(cmd => cmd.type === 'action.submit').length).toBe(1);
  await page.getByRole('textbox', { name: 'Review name' }).fill('Typed during action'); held.release();
  await expect.poll(() => state.snapshot.userStates[0].values.name).toBe('Typed during action');
  expect(state.commands.find(cmd => cmd.type === 'state.save')?.payload.baseRevision).toBe(1);
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
});

test('a recovered composer draft clears after sending without another keystroke', async ({ page }) => {
  await host(page, populated()); await page.goto('/'); const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill('Recovered submission'); await page.reload(); await expect(input).toHaveValue('Recovered submission');
  await input.press('Enter'); await expect(page.locator('.message-user')).toContainText('Recovered submission'); await expect(input).toHaveValue('');
  await page.reload(); await expect(input).toHaveValue('');
});

test('typing while thread creation is pending migrates the next draft without resubmitting it', async ({ page }) => {
  const state = await host(page, snapshot()); const held = gate(); state.afterCommand = async cmd => { if (cmd.type === 'thread.create') await held.promise; };
  await page.goto('/'); const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill('Submitted before creation'); await input.press('Enter'); await expect.poll(() => state.commands.filter(cmd => cmd.type === 'thread.create').length).toBe(1);
  await input.fill('Typed during creation'); held.release();
  await expect(page.locator('.message-user')).toContainText('Submitted before creation'); await expect(input).toHaveValue('Typed during creation');
  await page.reload(); await expect(input).toHaveValue('Typed during creation'); expect(state.commands.filter(cmd => cmd.type === 'message.send')).toHaveLength(1);
});

test('a rejected renewed session stops after one renewal and retains the draft', async ({ page }) => {
  const state = await host(page, populated()); let attempts = 0;
  await page.goto('/'); await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Retain after rejection');
  await page.route('**/api/commands', route => { attempts++; return route.fulfill({ status: 403, json: { error: { code: 'CSRF_REQUIRED', message: 'Session still rejected' } } }); });
  await page.getByRole('button', { name: 'Send message', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('Session still rejected');
  expect(attempts).toBe(2); expect(state.bootstraps).toBe(2); await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Retain after rejection');
});

for (const csrf of [false, true]) test(`session renewal retries the exact command after ${csrf ? 'CSRF rejection' : 'host restart'}`, async ({ page }) => {
  const state = await host(page, populated()); await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Message', exact: true }); await input.fill('Keep through renewal');
  if (csrf) state.csrfExpired = true; else state.expired = true;
  await input.press('Enter'); await expect(page.locator('.message-user').getByText('Keep through renewal', { exact: true })).toBeVisible();
  const attempts = state.commands.filter(cmd => cmd.type === 'message.send'); expect(attempts).toHaveLength(2); expect(attempts[0]).toEqual(attempts[1]); expect(state.bootstraps).toBe(2);
});

test('disconnected events renew the session and refresh the snapshot while retaining drafts', async ({ page }) => {
  const state = await host(page, populated()); await page.goto('/');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Offline draft');
  state.expired = true; state.snapshot.seq = 20; state.snapshot.messages[0].content = 'Restored after host restart';
  await page.evaluate(() => (window as unknown as { __disconnect: () => void }).__disconnect());
  await expect(page.getByText('Restored after host restart')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Offline draft'); expect(state.bootstraps).toBe(2);
});

test('decision drafts survive navigation and reload but are isolated by request revision', async ({ page }) => {
  const initial = populated(); initial.requests.push({ id: 'draft-request', threadId: 'one', artifactId: null, revision: 1, title: 'Draft decision', prompt: 'Review it.', responseSchema: { type: 'object', properties: { label: { type: 'string', title: 'Decision label' }, approved: { type: 'boolean', title: 'Accept terms' } }, required: ['label', 'approved'] }, basis: [], status: 'pending' });
  const state = await host(page, initial); await page.goto('/');
  await page.getByRole('textbox', { name: 'Decision label' }).fill('Retained decision');
  await page.getByRole('button', { name: 'Second task Ready' }).click(); await page.getByRole('button', { name: 'First task Ready' }).click();
  await expect(page.getByRole('textbox', { name: 'Decision label' })).toHaveValue('Retained decision');
  await page.reload(); await expect(page.getByRole('textbox', { name: 'Decision label' })).toHaveValue('Retained decision');
  state.snapshot.requests[0].revision = 2; state.snapshot.seq += 10; await emit(page, state.snapshot.seq);
  await expect(page.getByRole('textbox', { name: 'Decision label' })).toHaveValue('');
  await page.getByRole('textbox', { name: 'Decision label' }).fill('New decision'); await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect.poll(() => state.commands.find(cmd => cmd.type === 'request.respond')?.payload.response).toEqual({ label: 'New decision', approved: false });
});

for (const [type, value, response] of [['number', '12.5', 12.5], ['integer', '12', 12], ['boolean', '', false]] as const) test(`primitive ${type} decisions submit schema values`, async ({ page }) => {
  const initial = populated(); initial.requests.push({ id: 'primitive', threadId: 'one', artifactId: null, revision: 1, title: 'Primitive choice', prompt: 'Choose.', responseSchema: { type }, basis: [], status: 'pending' });
  const state = await host(page, initial); await page.goto('/');
  if (type !== 'boolean') await page.getByLabel('Response', { exact: true }).fill(value);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect.poll(() => state.commands.find(cmd => cmd.type === 'request.respond')?.payload.response).toBe(response);
});

test('markdown headings stop at their own line and preserve the following paragraph', async ({ page }) => {
  const initial = populated(); initial.messages[0].content = '# First heading\nFirst body.\n## Second heading\nSecond body.\n### Third heading\nThird body.';
  await host(page, initial); await page.goto('/');
  await expect(page.getByRole('heading', { name: 'First heading', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Second heading', exact: true, level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Third heading', exact: true, level: 3 })).toBeVisible();
  await expect(page.locator('.message-assistant p').filter({ hasText: 'Third body.' })).toBeVisible();
});

const unloadIsGuarded = (page: Page) => page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; });

test('dirty widgets require a checkpoint or explicit discard before thread archive and unload', async ({ page }) => {
  const state = await host(page, widgetWorkspace()); await page.goto('/'); const frame = page.frameLocator('iframe[title="Review workspace"]');
  await frame.getByRole('textbox', { name: 'Widget note' }).fill('Preserve before archive');
  await expect(page.getByText('Uncheckpointed edits', { exact: true })).toBeVisible(); expect(await unloadIsGuarded(page)).toBe(true);
  await page.getByRole('button', { name: 'Thread options' }).click(); await page.getByRole('button', { name: 'Archive thread', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Uncheckpointed widget edits' })).toBeVisible(); expect(state.commands.filter(cmd => cmd.type === 'thread.archive')).toHaveLength(0);
  await page.getByRole('button', { name: 'Return to checkpoint' }).click();
  await expect(frame.getByRole('textbox', { name: 'Widget note' })).toHaveValue('Preserve before archive'); expect(state.mounts).toBe(1);
  await frame.getByRole('button', { name: 'Checkpoint note' }).click(); await expect(frame.locator('#receipt')).toHaveText('Saved revision 1'); expect(await unloadIsGuarded(page)).toBe(false);
  await frame.getByRole('textbox', { name: 'Widget note' }).fill('Explicitly discarded'); await expect(page.getByText('Uncheckpointed edits', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Thread options' }).click(); await page.getByRole('button', { name: 'Archive thread', exact: true }).click();
  await page.getByRole('button', { name: 'Discard edits and archive', exact: true }).click(); await expect(page.locator('iframe')).toHaveCount(0);
  expect(state.snapshot.userStates[0].values).toEqual({ note: 'Preserve before archive' }); expect(await unloadIsGuarded(page)).toBe(false);
});

test('dirty widget artifact archive retains its mount until explicit discard', async ({ page }) => {
  const state = await host(page, widgetWorkspace()); await page.goto('/'); const frame = page.frameLocator('iframe[title="Review workspace"]');
  await frame.getByRole('textbox', { name: 'Widget note' }).fill('Keep artifact draft'); await expect(page.getByText('Uncheckpointed edits', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Archive artifact', exact: true }).click(); await expect(page.getByRole('button', { name: 'Return to checkpoint' })).toBeVisible();
  expect(state.commands.filter(cmd => cmd.type === 'artifact.archive')).toHaveLength(0);
  await page.getByRole('button', { name: 'Return to checkpoint' }).click(); await expect(frame.getByRole('textbox', { name: 'Widget note' })).toHaveValue('Keep artifact draft'); expect(state.mounts).toBe(1);
  await page.getByRole('button', { name: 'Archive artifact', exact: true }).click(); await page.getByRole('button', { name: 'Discard edits and archive', exact: true }).click();
  await expect(page.locator('iframe')).toHaveCount(0); expect(state.snapshot.userStates[0].values).toEqual({ note: 'Original checkpoint' }); expect(await unloadIsGuarded(page)).toBe(false);
});

test('widget initialization and theme changes receive matching root color tokens', async ({ page }) => {
  const initial = widgetWorkspace(); initial.settings.theme = 'dark'; const state = await host(page, initial); await page.goto('/');
  const frame = page.frameLocator('iframe[title="Review workspace"]'); await expect(frame.locator('#theme')).toHaveText('dark|#000');
  await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button', { name: 'Appearance', exact: true }).click(); await page.getByRole('combobox', { name: 'Color scheme', exact: true }).selectOption('light'); await page.keyboard.press('Escape');
  await expect(frame.locator('#theme')).toHaveText('light|#fff'); expect(state.mounts).toBe(1);
});

test('bounded history loads earlier messages without remounting dirty artifacts', async ({ page }) => {
  const initial = populated(); for (let index = 0; index < 150; index++) initial.messages.push({ id: `later-${index}`, threadId: 'one', role: 'assistant', content: `Later history ${index}`, createdAt: timestamp, runId: null });
  const state = await host(page, initial); state.failSave = true; await page.goto('/'); await expect(page.locator('.message-assistant')).toHaveCount(101);
  await page.getByRole('textbox', { name: 'Review name' }).fill('Protected older artifact');
  await page.evaluate(() => Object.assign(window, { __historyInput: document.querySelector('.artifact input') }));
  await page.getByRole('button', { name: 'Load earlier messages' }).click(); await expect(page.locator('.message-assistant')).toHaveCount(151);
  await expect(page.getByRole('textbox', { name: 'Review name' })).toHaveValue('Protected older artifact');
  expect(await page.evaluate(() => (window as unknown as { __historyInput: unknown }).__historyInput === document.querySelector('.artifact input'))).toBe(true);
});

test('closed mobile navigation is inert and expansion contains and restores focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await host(page, populated()); await page.goto('/');
  await expect(page.locator('.sidebar')).toHaveAttribute('inert', '');
  await page.getByRole('button', { name: 'Open navigation' }).click(); await expect(page.getByRole('textbox', { name: 'Search threads' })).toBeFocused();
  await expect.poll(()=>page.locator('.workspace').evaluate(element=>Boolean(element.closest('[inert]')))).toBe(true); await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();
  await page.getByRole('button', { name: 'Expand artifact', exact: true }).click();
  await expect.poll(() => page.locator('.composer-dock').evaluate(node => Boolean(node.closest('[inert]')))).toBe(true);
  await expect(page.getByRole('button', { name: 'Collapse artifact' })).toBeFocused();
  await page.keyboard.press('Shift+Tab'); expect(await page.locator('.artifact').evaluate(el => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: 'Expand artifact', exact: true })).toBeFocused();
});

test('long conversations restore reading positions and follow the tail only near latest', async ({ page }) => {
  const initial = populated(); initial.messages = Array.from({ length: 150 }, (_, index) => ({ id: `history-${index}`, threadId: 'one', role: 'assistant' as const, content: `History entry ${index}\n\n${'Readable conversation body. '.repeat(10)}`, createdAt: timestamp, runId: null })); initial.artifacts = [];
  const state = await host(page, initial); await page.goto('/'); const scroller = page.locator('.conversation-scroll');
  await expect(page.getByText('History entry 149', { exact: false })).toBeVisible();
  await scroller.evaluate(el => { el.scrollTop = 160; el.dispatchEvent(new Event('scroll')); });
  const position = await scroller.evaluate(el => el.scrollTop);
  state.snapshot.messages.push({ id: 'new-tail', threadId: 'one', role: 'assistant', content: 'New assistant update', createdAt: timestamp, runId: null }); state.snapshot.seq += 10; await emit(page, state.snapshot.seq);
  await expect(page.getByRole('button', { name: 'Jump to latest' })).toBeVisible(); expect(await scroller.evaluate(el => el.scrollTop)).toBeCloseTo(position, -1);
  await expect(page.locator('[aria-live="polite"]')).toContainText('New');
  await page.getByRole('button', { name: 'Second task Ready' }).click(); await page.getByRole('button', { name: 'First task Ready' }).click();
  expect(await scroller.evaluate(el => el.scrollTop)).toBeCloseTo(position, -1);
  await page.getByRole('button', { name: 'Jump to latest' }).click();
  await expect.poll(() => scroller.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(5);
});

test('empty workspace, unavailable models, system theme, recovery and navigation', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const state = await host(page, snapshot(), false);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'What are we working on?' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep my draft');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Keep my draft');
  await page.getByRole('button', { name: 'Connect a model to get started' }).click();
  await expect(page.getByText('pnpm agent:login --provider openai', { exact: true })).toBeVisible();
  await page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button', { name: 'Appearance', exact: true }).click(); await page.getByRole('combobox', { name: 'Color scheme', exact: true }).selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'New thread', exact: false }).click();
  await page.getByRole('button', { name: 'Thread options' }).click();
  await page.getByRole('button', { name: 'Rename thread' }).click();
  await page.getByRole('textbox', { name: 'Thread name' }).fill('My local task');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.locator('.breadcrumb')).toContainText('My local task');
  await page.getByRole('textbox', { name: 'Search threads' }).fill('absent');
  await expect(page.getByText('No matching threads.')).toBeVisible();
  expect(state.csrf.every(token => token === 'test-csrf-token')).toBe(true);
});

test('SSE refresh accepts newer sequences and ignores duplicates and stale events', async ({ page }) => {
  const state = await host(page, populated()); await page.goto('/');
  await expect(page.getByText('Review the source-backed records below.')).toBeVisible();
  state.snapshot.seq = 10;
  state.snapshot.messages.push({ id: 'streamed', threadId: 'one', role: 'assistant', content: 'An accepted streamed update.', createdAt: timestamp, runId: null });
  await emit(page, 10);
  await expect(page.getByText('An accepted streamed update.')).toBeVisible();
  const reads = state.snapshotReads;
  await emit(page, 10); await emit(page, 9);
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('still responsive');
  expect(state.snapshotReads).toBe(reads);
});

test('first message creates a real thread, retries the identical command and clears its migrated draft', async ({ page }) => {
  const state = await host(page, snapshot()); state.abortMessageOnce = true;
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Start this real task');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Start this real task', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('');
  const attempts = state.commands.filter(item => item.type === 'message.send');
  expect(attempts).toHaveLength(2); expect(attempts[0]).toEqual(attempts[1]);
  expect(state.snapshot.threads).toHaveLength(1); expect(state.snapshot.messages).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('');
});

test('resource picker survives thread creation and uploads contain the selected bytes', async ({ page }) => {
  const state = await host(page, snapshot()); await page.goto('/');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('A draft before granting access');
  await page.getByRole('button', { name: 'Add resource', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Add a resource' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Absolute local path' }).fill('C:\\test-project');
  await page.getByRole('button', { name: 'Add resource', exact: true }).last().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('A draft before granting access');
  await page.locator('input[type=file]').setInputFiles({ name: 'evidence.txt', mimeType: 'text/plain', buffer: Buffer.from('Actual attachment bytes') });
  await expect.poll(() => state.commands.find(item => item.type === 'resource.upload')?.payload).toEqual({ name: 'evidence.txt', mimeType: 'text/plain', base64: Buffer.from('Actual attachment bytes').toString('base64') });
});

test('drafts, row selection, disclosure and the same mounted expanded artifact survive refresh and reload', async ({ page }) => {
  const state = await host(page, populated()); await page.goto('/');
  const name = page.getByRole('textbox', { name: 'Review name' }); await expect(name).toBeVisible();
  await name.fill('Unsaved review name');
  await page.getByRole('checkbox', { name: 'Select row 1' }).check();
  await page.getByRole('button', { name: 'Review details', exact: true }).click();
  await page.getByRole('tab', { name: 'Source', exact: true }).click();
  await expect.poll(() => state.snapshot.userStates[0].values.name).toBe('Unsaved review name');
  await page.evaluate(() => Object.assign(window, { __retainedNode: document.querySelector('input[value="Unsaved review name"]') }));
  await page.getByRole('button', { name: 'Expand artifact', exact: true }).click();
  await expect(page.locator('.artifact')).toHaveClass(/artifact-expanded/);
  expect(await page.evaluate(() => (window as unknown as { __retainedNode: unknown }).__retainedNode === document.querySelector('input[value="Unsaved review name"]'))).toBe(true);
  await expect(page.getByRole('checkbox', { name: 'Select row 1' })).toBeChecked();
  await page.getByRole('button', { name: 'Continue review', exact: true }).click();
  await expect.poll(() => state.commands.filter(item => item.type === 'action.submit').length).toBe(1);
  const action = state.commands.find(item => item.type === 'action.submit')!;
  expect(action.payload.baseStateRevision).toBe(state.snapshot.userStates[0].revision - 1);
  expect(action.payload.dataRevisions).toEqual({ 'data-one': 1 });
  const collapseRequested = gate(), collapseResponse = gate();
  state.afterCommand = async command => {
    if (command.type === 'artifact.expand' && command.payload.expanded === false) {
      collapseRequested.release(); await collapseResponse.promise;
    }
  };
  await page.getByRole('button', { name: 'Collapse artifact' }).click();
  await collapseRequested.promise;
  await expect.poll(() => page.locator('.composer-dock').evaluate(node => Boolean(node.closest('[inert]')))).toBe(true);
  collapseResponse.release();
  // Clicking starts an async host command; fill() does not wait for inert ancestors.
  await expect.poll(() => page.locator('.composer-dock').evaluate(node => Boolean(node.closest('[inert]')))).toBe(false);
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Thread one draft');
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Thread one draft');
  await expect(name).toHaveValue('Unsaved review name');
  await page.getByRole('button', { name: 'Second task Ready' }).click();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Thread two draft');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Thread two draft');
  await page.getByRole('button', { name: 'First task Ready' }).click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Thread one draft');
  await expect(name).toHaveValue('Unsaved review name');
  await expect(page.getByRole('tab', { name: 'Source', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Review details', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Pin artifact', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unpin artifact' })).toBeVisible();
});

test('presentation changes crossing an edit lease retain the active structured input', async ({ page }) => {
  const state = await host(page, populated()); state.failSave = true;
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Review name' }).fill('Locally protected');
  await expect(page.getByRole('button', { name: /Draft retained/ })).toBeVisible();
  state.snapshot.artifacts[0]!.revision = 2;
  state.snapshot.artifacts[0]!.spec!.elements.name = { type: 'Text', props: { text: 'A presentation that crossed the lease' } };
  state.snapshot.seq += 10;
  await emit(page, state.snapshot.seq);
  await expect(page.getByText('An updated interface is ready.', { exact: false })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Review name' })).toHaveValue('Locally protected');
  await expect(page.getByText('A presentation that crossed the lease', { exact: true })).toHaveCount(0);
  expect(state.commands.some(item => item.type === 'edit.begin')).toBe(true);
});

test('reconcile is read only, interrupted startup can resume, and a gated active run can stop', async ({ page }) => {
  const initial = populated(); initial.threads[0]!.status = 'interrupted'; initial.threads[0]!.sessionPath = null;
  initial.operations = [{ id: 'uncertain', threadId: 'one', revision: 4, kind: 'file.write', description: 'An interrupted write requires inspection.', args: {}, resourceIds: [], preconditions: {}, status: 'unknown', approved: true, createdAt: timestamp }];
  const state = await host(page, initial); await page.goto('/');
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Reconcile outcome' }).click();
  await expect.poll(() => state.commands.filter(item => item.type === 'operation.reconcile').length).toBe(1);
  expect(state.commands.some(item => item.type === 'operation.approve')).toBe(false);
  state.snapshot.threads[0]!.status = 'awaiting_input'; state.snapshot.threads[0]!.runId = 'active-gated-run'; state.snapshot.seq += 10;
  await emit(page, state.snapshot.seq);
  await page.getByRole('button', { name: 'Stop agent', exact: true }).click();
  await expect.poll(() => state.commands.filter(item => item.type === 'run.stop').length).toBe(1);
});

test('capture reference-sized desktop and narrow compositions', async ({ page }) => {
  test.skip(process.env.HARNESS_CAPTURE_UI !== '1', 'Opt-in UI evidence capture.');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await host(page, populated()); await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Review name' })).toBeVisible();
  await page.screenshot({ path: 'tests/e2e/evidence/desktop-light.png', fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: 'tests/e2e/evidence/desktop-dark.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({ path: 'tests/e2e/evidence/mobile-light.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('state conflicts retain a recoverable local draft and prevent stale actions', async ({ page }) => {
  const state = await host(page, populated()); state.failSave = true; await page.goto('/');
  await page.getByRole('textbox', { name: 'Review name' }).fill('Keep both versions');
  await expect(page.getByRole('button', { name: /Draft retained/ })).toBeVisible();
  state.snapshot.userStates[0].values = { name: 'Remote change' }; state.snapshot.userStates[0].revision = 2; state.snapshot.seq += 10;
  await emit(page, state.snapshot.seq);
  await expect(page.getByRole('textbox', { name: 'Review name' })).toHaveValue('Keep both versions');
  await page.getByRole('button', { name: 'Continue review', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('The saved draft changed');
  expect(state.commands.some(item => item.type === 'action.submit')).toBe(false);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Review name' })).toHaveValue('Keep both versions');
});

test('real submit, pending input and operation approval carry exact host identities', async ({ page }) => {
  const initial = populated(); initial.requests.push({ id: 'request-one', threadId: 'one', artifactId: null, revision: 3, title: 'Choose a label', prompt: 'Give the prepared output a label.', responseSchema: { type: 'object', properties: { label: { type: 'string', title: 'Output label' } }, required: ['label'] }, basis: [], status: 'pending' });
  initial.operations.push({ id: 'operation-one', threadId: 'one', revision: 2, kind: 'file.write', description: 'Write the reviewed output to the granted file.', args: { content: 'reviewed content' }, resourceIds: ['file-one'], preconditions: { 'file-one': 'expected-hash' }, status: 'prepared', approved: false, createdAt: timestamp });
  const state = await host(page, initial); await page.goto('/');
  await page.getByRole('textbox', { name: 'Output label' }).fill('Approved label');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect.poll(() => state.commands.find(item => item.type === 'request.respond')?.payload).toEqual({ requestId: 'request-one', revision: 3, response: { label: 'Approved label' } });
  await page.getByRole('button', { name: 'Approve operation', exact: true }).click();
  await expect.poll(() => state.commands.find(item => item.type === 'operation.approve')?.payload).toEqual({ operationId: 'operation-one', revision: 2 });
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Inspect the actual project');
  await page.getByRole('textbox', { name: 'Message', exact: true }).press('Enter');
  await expect(page.getByText('Inspect the actual project', { exact: true })).toBeVisible();
  expect(state.commands.find(item => item.type === 'message.send')?.payload).toEqual({ content: 'Inspect the actual project', modelId: 'test/model',thinkingLevel:null });
});

test('arbitrary sandboxed widget checkpoints only through its current authenticated mount', async ({ page }) => {
  const initial = widgetWorkspace();
  const state = await host(page, initial); await page.goto('/');
  const frame = page.frameLocator('iframe[title="Review workspace"]');
  await expect(frame.getByRole('textbox', { name: 'Widget note' })).toHaveValue('Original checkpoint');
  await expect(page.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
  await page.evaluate(() => window.postMessage({ channel: 'harness-widget', token: 'token-1', mountId: 'mount-1', artifactId: 'artifact-one', type: 'checkpoint', payload: { values: { note: 'forged' }, stateSchemaVersion: 1, requestId: 'forged' } }, '*'));
  await frame.getByRole('textbox', { name: 'Widget note' }).fill('Edited inside the sandbox');
  await page.getByRole('button', { name: 'Second task Ready' }).click();
  await expect(page.getByText('Widget edits are kept open in another thread.')).toBeVisible();
  expect(state.mounts).toBe(1);
  await page.getByRole('button', { name: 'First task Ready' }).click();
  await expect(frame.getByRole('textbox', { name: 'Widget note' })).toHaveValue('Edited inside the sandbox');
  await page.getByRole('button', { name: 'Expand artifact', exact: true }).click();
  await expect(frame.getByRole('textbox', { name: 'Widget note' })).toHaveValue('Edited inside the sandbox');
  expect(state.mounts).toBe(1);
  await frame.getByRole('button', { name: 'Checkpoint note' }).click();
  await expect(frame.getByText('Saved revision 1')).toBeVisible();
  expect(state.snapshot.userStates[0]!.values).toEqual({ note: 'Edited inside the sandbox' });
  expect(state.commands.filter(item => item.type === 'widget.checkpoint')).toHaveLength(1);
  await frame.getByRole('button', { name: 'Invalid checkpoint', exact: true }).click();
  await expect(frame.locator('#receipt')).toContainText('schema');
  expect(state.commands.filter(item => item.type === 'widget.checkpoint')).toHaveLength(1);
  await page.evaluate(() => Object.assign(window, { __oldWidgetWindow: document.querySelector('iframe')?.contentWindow }));
  state.snapshot.artifacts[0]!.revision = 2; state.snapshot.seq += 10;
  await emit(page, state.snapshot.seq);
  await expect.poll(() => state.mounts).toBe(2);
  await expect(frame.getByRole('textbox', { name: 'Widget note' })).toHaveValue('Edited inside the sandbox');
  await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { source: (window as unknown as { __oldWidgetWindow: Window }).__oldWidgetWindow, data: { channel: 'harness-widget', token: 'token-1', mountId: 'mount-1', artifactId: 'artifact-one', type: 'checkpoint', payload: { values: { note: 'stale mount' }, stateSchemaVersion: 1, requestId: 'stale' } } })));
  await frame.getByRole('textbox', { name: 'Widget note' }).fill('Current mount edit');
  expect(state.commands.filter(item => item.type === 'widget.checkpoint')).toHaveLength(1);
  await page.getByRole('button', { name: 'Collapse artifact', exact: true }).click();
  await page.getByRole('button', { name: 'Second task Ready' }).click();
  await page.getByRole('button', { name: 'Discard hidden widget edits', exact: true }).click();
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.getByRole('button', { name: 'First task Ready' }).click();
  await expect(frame.getByRole('textbox', { name: 'Widget note' })).toHaveValue('Edited inside the sandbox');
  expect(state.mounts).toBe(3);
});

test('model-labelled operation action focuses its exact approval without executing it', async ({ page }) => {
  const initial = populated(); initial.artifacts[0]!.actions.continue = { kind: 'operation', operationId: 'exact-operation' };
  initial.operations = ['unrelated-operation', 'exact-operation'].map(id => ({ id, threadId: 'one', revision: 7, kind: 'file.write', description: id, args: {}, resourceIds: [], preconditions: {}, status: 'prepared' as const, approved: false, createdAt: timestamp }));
  const state = await host(page, initial); await page.goto('/');
  await page.getByRole('button', { name: 'Expand artifact', exact: true }).click();
  await page.getByRole('button', { name: 'Continue review', exact: true }).click();
  const approve = page.locator('[data-operation-id="exact-operation"]').getByRole('button', { name: 'Approve operation', exact: true });
  await expect(approve).toBeFocused();
  await expect(page.locator('.artifact')).not.toHaveClass(/artifact-expanded/);
  expect(state.commands.filter(item => item.type === 'operation.approve')).toHaveLength(0);
  await approve.click();
  await expect.poll(() => state.commands.find(item => item.type === 'operation.approve')?.payload).toEqual({ operationId: 'exact-operation', revision: 7 });
  await page.locator('[data-operation-id="unrelated-operation"]').getByRole('button', { name: 'Decline operation', exact: true }).click();
  await expect.poll(() => state.commands.find(item => item.type === 'operation.reject')?.payload).toEqual({ operationId: 'unrelated-operation', revision: 7 });
});

test('keyboard, narrow layout and reduced motion remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  const state = await host(page, populated()); await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Review name' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('textbox', { name: 'Search threads' })).toBeVisible();
  await page.getByRole('button', { name: 'Second task Ready' }).click();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('textbox', { name: 'Search threads' })).toBeFocused();
  await page.keyboard.press('Escape');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('First line');
  await page.getByRole('textbox', { name: 'Message', exact: true }).press('Shift+Enter');
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('First line\n');
  expect(state.commands.filter(item => item.type === 'message.send')).toHaveLength(0);
  const duration = await page.locator('.sidebar').evaluate(element => getComputedStyle(element).transitionDuration);
  expect(parseFloat(duration)).toBeLessThan(.01);
});
