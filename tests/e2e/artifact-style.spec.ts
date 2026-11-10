import { test, expect, type Page } from '@playwright/test';
import type { ArtifactRecord, HostCommand, Snapshot } from '../../packages/contracts';
import { validateSurface } from '../../packages/ui-catalog';
import { createSigningPdfFixture, SIGNING_FIELD_STATE_KEYS, SIGNING_SIGNATURE_BOX } from './document-preview-fixture';
import { mkdir, writeFile } from 'node:fs/promises';

// Hand-authored synthetic compositions. They exercise the renderer and source bindings;
// they do not establish model generation, execution, signing, or a real external result.
const timestamp = '2026-10-29T23:00:00.000Z';
type Spec = NonNullable<ArtifactRecord['spec']>;
const signing: Spec = { root: 'pair', elements: {
  pair: { type: 'Split', props: { ratio: .52 }, children: ['document', 'steps'] },
  document: { type: 'DocumentPreview', props: { title: 'Agreement.pdf', resourceId: 'synthetic-pdf', fieldStateKeys: SIGNING_FIELD_STATE_KEYS, activeFieldStateKey: 'currentStep', signatureStateKey: 'signature', signatureBox: SIGNING_SIGNATURE_BOX } },
  steps: { type: 'Steps', props: { stateKey: 'currentStep', steps: [{ key: 'Email', label: 'Notices' }, { key: 'Signature', label: 'Signature' }, { key: 'Review', label: 'Review' }] }, children: ['notices', 'signature', 'review'] },
  notices: { type: 'Panel', props: { title: 'Where should notices go?' }, children: ['choices', 'custom'] },
  choices: { type: 'ChoiceList', props: { stateKey: 'email', label: 'Notice address', options: [{ value: 'alex@example.test', label: 'alex@example.test', detail: 'Work' }, { value: 'alex@home.test', label: 'alex@home.test', detail: 'Personal' }] } },
  custom: { type: 'Input', props: { stateKey: 'customAddress', label: 'Another email address', inputType: 'email', placeholder: 'An email address' } },
  signature: { type: 'SignaturePad', props: { stateKey: 'signature', label: 'Add your visual signature', initialMode: 'type' } },
  review: { type: 'Form', props: { title: 'Confirm your details', actionId: 'confirm', submitLabel: 'Confirm details', payloadFromState: { email: 'email', customEmail: 'customAddress' } }, children: ['reviewText'] },
  reviewText: { type: 'Text', props: { text: 'Confirming saves these values to this synthetic fixture. It does not sign a document.', tone: 'muted', size: 'sm' } },
} };
const operational: Spec = { root: 'operation', elements: {
  operation: { type: 'Stack', props: { gap: 'sm' }, children: ['graph', 'status', 'tabs', 'continue'] },
  graph: { type: 'RelationshipGraph', props: { dataBinding: 'graph', stateKey: 'selectedNode', label: 'Delivery dependencies' } },
  status: { type: 'Status', props: { dataBinding: 'status' } },
  tabs: { type: 'Tabs', props: { labels: ['Files', 'Changes'], stateKey: 'view' }, children: ['files', 'changes'] },
  files: { type: 'Table', props: { rowsBinding: 'files', columns: [{ key: 'name', label: 'File' }, { key: 'state', label: 'State' }] } },
  changes: { type: 'Diff', props: { before: 'refresh(session)', after: 'await refresh(session)' } },
  continue: { type: 'Button', props: { label: 'Inspect selected item', actionId: 'inspect', payload: { source: 'fixture' }, payloadFromState: { nodeId: 'selectedNode' } } },
} };
const faq: Spec = { root: 'faq', elements: {
  faq: { type: 'Stack', props: { gap: 'sm' }, children: ['transfers', 'cost', 'question'] },
  transfers: { type: 'Disclosure', props: { title: 'How do transfers work?', stateKey: 'transfersOpen', defaultOpen: true, text: 'These answers are synthetic examples for the interaction test.' }, children: ['timing', 'currencies'] },
  timing: { type: 'Disclosure', props: { title: 'How long do international transfers take?', stateKey: 'timingOpen', text: 'The timing depends on the selected payment network.' } },
  currencies: { type: 'Disclosure', props: { title: 'Which currencies can I hold?', stateKey: 'currenciesOpen', text: 'Check the connected account for supported currencies.' } },
  cost: { type: 'Disclosure', props: { title: 'What does it cost?', stateKey: 'costOpen', text: 'View the account terms for the current fee schedule.' } },
  question: { type: 'Input', props: { stateKey: 'question', label: 'Ask a follow-up', placeholder: 'Type in your question…' } },
} };

function fixture(spec: Spec, title = 'Service agreement', compact = false): Snapshot {
  const artifact: ArtifactRecord = { id: 'task-object', threadId: 'one', messageId: 'assistant', title, purpose: 'Hand-authored synthetic composition; no model or external execution.', kind: 'structured', revision: 1, spec, widget: null, bindings: { graph: { mode: 'snapshot', ref: { id: 'graph-data', revision: 1 } }, status: { mode: 'snapshot', ref: { id: 'status-data', revision: 1 } }, files: { mode: 'snapshot', ref: { id: 'files-data', revision: 1 } } }, actions: { confirm: { kind: 'agent', schema: { type: 'object', properties: { email: { type: 'string' }, customEmail: { type: 'string' } }, required: ['email'], additionalProperties: false } }, inspect: { kind: 'agent' } }, stateId: 'task-state', lifecycle: 'active', placement: 'inline', pinned: false, catalogVersion: '1.0.0', createdAt: timestamp, updatedAt: timestamp, presentation: { width: compact ? 'compact' : 'standard', frame: compact ? 'canvas' : 'card' } };
  return { seq: 1, threads: ['one', 'two'].map((id, i) => ({ id, title: i ? 'Other task' : title, projectName: 'Reference compositions', createdAt: timestamp, updatedAt: timestamp, status: 'ready', epoch: 0, runId: null, modelId: 'test/model', sessionPath: 'fixture' })), activeThreadId: 'one', messages: [{ id: 'assistant', threadId: 'one', role: 'assistant', content: 'Synthetic composition fixture — values and outcomes below are illustrative.', createdAt: timestamp, runId: null }], artifacts: [artifact], userStates: [{ id: 'task-state', threadId: 'one', revision: 0, schemaVersion: 1, values: {} }], data: [
    { id: 'graph-data', value: { nodes: [{ id: 'source', label: 'Source snapshot', detail: 'fixture/source', status: 'success', lane: 0 }, { id: 'review', label: 'Review changes', detail: 'Awaiting inspection', status: 'pending', lane: 1 }, { id: 'checks', label: 'Run focused checks', detail: 'Fixture only · not run', status: 'neutral', lane: 1 }, { id: 'deliver', label: 'Prepare delivery', status: 'neutral', lane: 0 }], edges: [{ from: 'source', to: 'review' }, { from: 'source', to: 'checks' }, { from: 'review', to: 'deliver' }, { from: 'checks', to: 'deliver' }] } },
    { id: 'status-data', value: { status: 'pending', label: 'Inspection required', detail: 'Synthetic data · no checks have run' } },
    { id: 'files-data', value: [{ name: 'session.ts', state: 'Awaiting review' }, { name: 'session.test.ts', state: 'Not run' }] },
  ].map(item => ({ ...item, threadId: 'one', revision: 1, provenance: 'Hand-authored Playwright synthetic fixture', createdAt: timestamp })), requests: [], operations: [], resources: [], usage: {}, settings: { theme: 'system', modelId: 'test/model' } };
}
async function host(page: Page, snapshot: Snapshot) {
  const commands: HostCommand[] = [];
  const signatureAssets = new Map<string, Buffer>();
  const hasPdf = snapshot.artifacts[0].spec?.elements.document?.type === 'DocumentPreview';
  const pdf = hasPdf ? await createSigningPdfFixture({ pages: 1 }) : null;
  if (hasPdf) {
    snapshot.userStates[0].values = { name: 'Alex Morgan', title: 'Designer', signedDate: 'October 29, 2026', currentStep: 'Email', ...snapshot.userStates[0].values };
    snapshot.resources.push({ id: 'synthetic-pdf', threadId: 'one', kind: 'attachment', label: 'Agreement.pdf', path: '/synthetic/Agreement.pdf', writable: false, createdAt: timestamp });
  }
  await page.addInitScript(() => { class FixtureEventSource { onopen: (() => void) | null = null; onerror = null; constructor() { queueMicrotask(() => this.onopen?.()); } addEventListener() {} close() {} } Object.defineProperty(window, 'EventSource', { value: FixtureEventSource }); });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/bootstrap') return route.fulfill({ json: { csrfToken: 'fixture-csrf', widgetOrigin: 'http://localhost:4318' } });
    if (path === '/api/models') return route.fulfill({ json: { models: [{ id: 'test/model', provider: 'test', name: 'Fixture' }] } });
    if (path === '/api/snapshot') return route.fulfill({ json: snapshot });
    if (path === '/api/resources/synthetic-pdf/content' && pdf) return route.fulfill({ contentType: 'application/pdf', body: Buffer.from(pdf) });
    const signatureId = path.match(/^\/api\/resources\/([^/]+)\/content$/)?.[1];
    if (signatureId && signatureAssets.has(signatureId)) return route.fulfill({ contentType: 'image/png', body: signatureAssets.get(signatureId)! });
    if (path !== '/api/commands') return route.fulfill({ status: 404 });
    const cmd = route.request().postDataJSON() as HostCommand; commands.push(cmd);
    let result: unknown = {};
    if (cmd.type === 'resource.upload') {
      const id = `signature-${cmd.id}`;
      signatureAssets.set(id, Buffer.from(String(cmd.payload.base64), 'base64'));
      result = { id, threadId: cmd.threadId, kind: 'attachment', label: 'signature.png', path: `/synthetic/${id}.png`, writable: false, createdAt: timestamp };
      if (!snapshot.resources.some(resource => resource.id === id)) snapshot.resources.push(result as Snapshot['resources'][number]);
    }
    if (cmd.type === 'state.save') { const record = snapshot.userStates[0]; record.values = cmd.payload.values as Record<string, unknown>; record.revision++; result = record; }
    if (cmd.type === 'artifact.expand') snapshot.artifacts[0].placement = cmd.payload.expanded ? 'expanded' : 'inline';
    if (cmd.type === 'artifact.pin') snapshot.artifacts[0].pinned = cmd.payload.pinned === true;
    snapshot.seq++;
    return route.fulfill({ json: { commandId: cmd.id, result, seq: snapshot.seq } });
  });
  return { snapshot, commands };
}

for (const width of [1440, 960]) test(`long email choices retain readable width and compact navigation at ${width}px`, async ({page}) => {
  await page.setViewportSize({width,height:1000});
  const copy=structuredClone(signing);
  copy.elements.choices.props.options=[{value:'legal@studio.example',label:'legal@studio.example',detail:'Select to replace the PDF Email field in the preview.'},{value:'alex@studio.example',label:'alex@studio.example',detail:'Previous address'}];
  const state=await host(page,fixture(copy));await page.goto('/');
  await expect(page.locator('.document-preview')).toHaveAttribute('data-preview-state','ready',{timeout:15000});
  const choice=page.locator('.task-choice').first(),label=choice.locator('.task-choice-copy');
  const row=await choice.boundingBox(),text=await label.boundingBox();
  expect(text!.width).toBeGreaterThan(row!.width*.75);expect(row!.height).toBeLessThan(130);
  expect(await choice.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  const content=await page.locator('.task-step-content').boundingBox(),navigation=await page.locator('.task-step-navigation').boundingBox();
  expect(navigation!.y-content!.y-content!.height).toBeLessThan(36);
  await page.getByRole('radio',{name:/legal@studio.example/}).check();
  await expect.poll(()=>state.snapshot.userStates[0].values.email).toBe('legal@studio.example');
  await page.reload();await expect(page.getByRole('radio',{name:/legal@studio.example/})).toBeChecked();
});

test('new composition schemas are strict, bounded and preserve stable step identities', () => {
  for (const spec of [signing, operational, faq]) expect(() => validateSurface(spec)).not.toThrow();
  const single = (type: string, props: Record<string, unknown>) => ({ root: 'a', elements: { a: { type, props } } });
  expect(() => validateSurface(single('ChoiceList', { stateKey: 'choice', label: 'Pick one', options: [{ value: 'one', label: 'One', surprise: true }] }))).toThrow();
  expect(() => validateSurface(single('ChoiceList', { stateKey: 'choice', label: 'Pick one', options: Array.from({ length: 51 }, (_, i) => ({ value: String(i), label: String(i) })) }))).toThrow();
  expect(() => validateSurface(single('Steps', { stateKey: 'step', steps: [{ key: 'same', label: 'One' }, { key: 'same', label: 'Two' }] }))).toThrow();
  expect(() => validateSurface(single('Button', { label: 'Send', actionId: 'send', payloadFromState: { email: '/inputs/secret' } }))).toThrow();
  expect(() => validateSurface(single('RelationshipGraph', { dataBinding: 'source', nodes: [{ id: 'invented' }] }))).toThrow();
  expect(() => validateSurface(single('RelationshipGraph', { label: 'Source review plan', source: 'Synthetic source organization; no work executed.', nodes: [{ id: '9c2a7', label: 'Review source' }, { id: 'a2e61', label: 'Choose next action' }], edges: [{ from: '9c2a7', to: 'a2e61' }] }))).not.toThrow();
  expect(() => validateSurface(single('RelationshipGraph', { source: 'Synthetic plan', nodes: [{ id: 'one', label: 'One' }], edges: [{ from: 'one', to: 'missing' }] }))).toThrow();
});

test('current question and mapped form values survive expansion, thread switching and reload', async ({ page }) => {
  const state = await host(page, fixture(signing)); await page.goto('/');
  await page.getByRole('radio', { name: /alex@example.test/ }).check();
  await page.getByRole('textbox', { name: 'Another email address' }).fill('legal@example.test');
  await page.getByRole('button', { name: 'Next step', exact: true }).click();
  await page.getByRole('textbox', { name: 'Type your name' }).fill('Alex Morgan');
  await expect.poll(() => (state.snapshot.userStates[0].values.signature as { kind?: string } | undefined)?.kind).toBe('image');
  const signatureResource = (state.snapshot.userStates[0].values.signature as { resourceId: string }).resourceId;
  await page.getByRole('button', { name: 'Next step', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Confirm your details' })).toBeVisible();
  await page.getByRole('button', { name: 'Expand artifact', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Confirm your details' })).toBeVisible();
  await page.getByRole('button', { name: 'Collapse artifact', exact: true }).click();
  await expect.poll(() => state.snapshot.userStates[0].values.currentStep).toBe('Review');
  await page.getByRole('button', { name: 'Other task Ready' }).click();
  await page.getByRole('button', { name: 'Service agreement Ready' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Confirm your details' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm details', exact: true }).click();
  await expect.poll(() => state.commands.find(cmd => cmd.type === 'action.submit')?.payload.payload).toEqual({ email: 'alex@example.test', customEmail: 'legal@example.test' });
  await page.getByRole('button', { name: 'Previous step', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Selected visual signature' })).toBeVisible();
  expect((state.snapshot.userStates[0].values.signature as { resourceId: string }).resourceId).toBe(signatureResource);
  await page.getByRole('button', { name: 'Previous step', exact: true }).click();
  await expect(page.getByRole('radio', { name: /alex@example.test/ })).toBeChecked();
});

test('the initial question persists its default step and focuses its matching PDF field', async ({page})=>{
 const initial=fixture(signing);initial.userStates[0].values={name:'Alex Morgan',title:'Designer',signedDate:'October 29, 2026'};
 await host(page,initial);delete initial.userStates[0].values.currentStep;await page.goto('/');
 await expect(page.locator('.document-active-field')).toBeVisible();
 await expect.poll(()=>initial.userStates[0].values.currentStep).toBe('Email');
 await page.reload();await expect(page.locator('.document-active-field')).toBeVisible();
});

test('bound relationships expose source status and map the selected stable node to actions', async ({ page }) => {
  const state = await host(page, fixture(operational, 'Delivery dependencies')); await page.goto('/');
  await expect(page.getByText('Synthetic data · no checks have run', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await page.getByRole('button', { name: 'Inspect selected item' }).click();
  await expect.poll(() => state.commands.find(cmd => cmd.type === 'action.submit')?.payload.payload).toEqual({ source: 'fixture', nodeId: 'review' });
  await page.getByRole('tab', { name: 'Changes', exact: true }).focus(); await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'Files', exact: true })).toBeFocused();
  await page.keyboard.press('End'); await expect(page.locator('.diff')).toBeVisible();
  await page.reload(); await expect(page.getByRole('tab', { name: 'Changes', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'View artifact source' }).click();
  await expect(page.locator('.artifact-source')).toContainText('Immutable source');
});

test('status reads actual host operation states and keeps receipt details available', async ({ page }) => {
  const initial = fixture(operational, 'Delivery dependencies');
  initial.artifacts[0].spec!.elements.status.props.label = 'Fixture checks';
  const record = initial.data.find(item => item.id === 'status-data')!;
  record.value = { operationId: 'fixture-operation', kind: 'command.run', status: 'prepared', approved: false, result: null, error: null };
  await host(page, initial); await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: 'Fixture checks' })).toContainText('Awaiting approval');
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await page.getByRole('button', { name: 'Inspect selected item' }).click();
  await expect(page.locator('.task-status')).toHaveClass(/status-pending/);
  record.value = { operationId: 'fixture-operation', kind: 'command.run', status: 'running', approved: true, result: null, error: null, progress: { message: 'Inspecting source files' } };
  await page.reload(); await expect(page.locator('.task-status')).toHaveClass(/status-running/);
  await expect(page.getByRole('status').filter({ hasText: 'Fixture checks' })).toContainText('Inspecting source files');
  record.value = { operationId: 'fixture-operation', kind: 'command.run', status: 'failed', approved: true, result: { exitCode: 2, stderr: 'Synthetic failure receipt' }, error: 'Command exited with code 2' };
  await page.reload(); await expect(page.locator('.task-status')).toHaveClass(/status-error/);
  await page.getByText('Operation details', { exact: true }).click();
  await expect(page.locator('.task-status-receipt')).toContainText('Synthetic failure receipt');
  record.value = { operationId: 'fixture-operation', kind: 'command.run', status: 'succeeded', approved: true, result: { exitCode: 0, stdout: 'Synthetic success receipt' }, error: null };
  await page.reload(); await expect(page.locator('.task-status')).toHaveClass(/status-success/);
  await expect(page.getByRole('status').filter({ hasText: 'Fixture checks' })).toContainText('Exit code 0');
  record.value = { operationId: 'fixture-operation', kind: 'command.run', approved: true, result: { exitCode: 0 } };
  await page.reload(); await expect(page.getByText('Status is unavailable from the connected source.')).toBeVisible();
});

test('connected FAQ branches and follow-up draft retain independent state', async ({ page }) => {
  await host(page, fixture(faq, 'Account questions', true)); await page.goto('/');
  await page.getByRole('button', { name: 'How long do international transfers take?' }).click();
  await page.getByRole('textbox', { name: 'Ask a follow-up' }).fill('Can I schedule a transfer?');
  await page.getByRole('button', { name: 'How do transfers work?' }).click();
  await page.getByRole('button', { name: 'How do transfers work?' }).click();
  await expect(page.getByText('The timing depends on the selected payment network.')).toBeVisible();
  await page.getByRole('button', { name: 'Expand artifact' }).click();
  await expect(page.getByRole('textbox', { name: 'Ask a follow-up' })).toHaveValue('Can I schedule a transfer?');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Expand artifact' })).toBeFocused();
});

test('capture synthetic signing, operations and FAQ against supplied reference compositions', async ({ page }) => {
  test.skip(process.env.HARNESS_CAPTURE_ARTIFACTS !== '1', 'Opt-in single batched visual pass.');
  const evidencePath = 'tests/e2e/evidence/generated-style';
  await mkdir(evidencePath, { recursive: true });
  for (const [name, spec, title, compact] of [['signing', signing, 'Service agreement', false], ['operations', operational, 'Delivery dependencies', false], ['faq', faq, 'Account questions', true]] as const) {
    await page.unrouteAll({ behavior: 'wait' }); await host(page, fixture(spec, title, compact));
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' }); await page.goto('/');
    await expect(page.locator('.artifact-body')).toBeVisible();
    if (name === 'signing') { await expect(page.getByRole('radio').first()).toBeVisible(); await expect(page.locator('.document-preview-footer')).toContainText(/(?:Draft|PDF) preview · Page/); await expect(page.locator('.document-preview canvas')).toBeVisible(); }
    if (name === 'faq') await page.getByRole('button', { name: 'How long do international transfers take?' }).click();
    await expect(page.locator('.save-state')).toHaveText('Saved');
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `${evidencePath}/${name}-light.png`, fullPage: true });
    await page.emulateMedia({ colorScheme: 'dark' }); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    if (name === 'signing') await expect(page.locator('.document-preview')).toHaveAttribute('aria-busy', 'false');
    await page.screenshot({ path: `${evidencePath}/${name}-dark.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'light' }); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    if (name === 'signing') await expect(page.locator('.document-preview')).toHaveAttribute('aria-busy', 'false');
    await page.screenshot({ path: `${evidencePath}/${name}-narrow.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await writeFile(`${evidencePath}/README.md`, '# Synthetic composition evidence\n\nThese captures are hand-authored Playwright fixtures from tests/e2e/artifact-style.spec.ts. They do not demonstrate model generation, real operations, or a signed/exported customer document. The PDF is a real render of the synthetic AcroForm created by document-preview-fixture.ts; its fields share durable state with the current-question panel. Graph, status and table values are labeled synthetic source records, with checks explicitly not run.\n\nVisual references: docs/reference/signing-18.png (document/current-question pair), graph-14.png and merge-16.png (compact connected operational rows), migration-16.png (table/tabs/status), faq-24.png (connected expansion), context-10.png (quiet contextual chrome). Light and dark use 1440x1000; narrow uses 390x844. Expanding, switching threads, refreshing, mapped submissions and branch continuity are covered by behavioral tests.\n');
});
