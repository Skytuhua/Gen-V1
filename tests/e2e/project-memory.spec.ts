import {test, expect, type Page} from '@playwright/test';
import {createHash} from 'node:crypto';
import type {MemoryAction, MemoryItemV1, MemoryScope, ProjectMemoryView, MemoryPreparedRequest} from '../../packages/contracts/project-memory';

const scope: MemoryScope = {projectId: 'project-a', projectIdentity: 'a'.repeat(64), threadId: 'thread-a', accountId: 'account-a', bindingDigest: 'b'.repeat(64)};
const stamp = '2026-11-15T00:00:00Z';
const sourceContent = '<script>window.memoryExecuted=true</script>\nUser source at revision source-r1.';
const sourceDigest = createHash('sha256').update(sourceContent).digest('hex');
function memory(id: string, state: MemoryItemV1['state'], text: string, revision = 1): MemoryItemV1 {
  return {id, projectIdentity: scope.projectIdentity, scope: 'PROJECT', kind: 'CONSTRAINT', text, revision, state, sourceRefs: [{ownerThreadId: 'thread-a', sourceKind: 'MESSAGE', sourceId: 'message-' + id, sourceRevision: 'source-r1', capturedSeq: 4, digest: sourceDigest, observedStatus: 'REPORTED'}], assertedBy: {kind: 'AGENT', id: 'agent-a'}, observedAt: stamp, expiresAt: null, supersedes: [], sensitivity: 'NORMAL', reviewDecision: null};
}
async function host(page: Page, options: {available?: boolean; enabled?: boolean; stale?: boolean} = {}) {
  const accepted = memory('accepted', 'ACCEPTED', 'Use UTC for exported dates.'), conflict = memory('conflict', 'CONFLICT', 'Use API version two.', 3);
  const view: ProjectMemoryView = {scope, projectName: 'Project A', available: options.available ?? true, disabledReason: options.available === false ? 'Project memory is disabled by the host.' : null, enabled: options.enabled ?? true, configRevision: 1, sourceThreadIds: options.enabled === false ? [] : ['thread-a'], eligibleThreads: [{id: 'thread-a', title: 'Source conversation'}, {id: 'thread-extra', title: 'Other source conversation'}], items: [{item: accepted, lastUsedAt: stamp, conflictRevisions: []}, {item: memory('proposal', 'PROPOSED', 'Keep reports in CSV.'), lastUsedAt: null, conflictRevisions: []}, {item: conflict, lastUsedAt: null, conflictRevisions: [memory('conflict', 'CONFLICT', 'Use API version one.', 2), conflict]}], tombstones: []};
  const writes: {commandId: string; scope: MemoryScope; operation: MemoryAction}[] = [], reads: string[] = [];
  const preparations: {prompt: string; modelId: string; thinkingLevel: string; request: MemoryPreparedRequest}[] = [], exclusions: unknown[] = [], sends: {id: string; payload: {content: string; requestContextId?: string}}[] = [];
  let captured: MemoryPreparedRequest | null = null;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/bootstrap') return route.fulfill({json: {csrfToken: 'synthetic-csrf'}});
    if (url.pathname === '/api/commands') {
      expect(route.request().headers()['x-harness-csrf']).toBe('synthetic-csrf'); const body = route.request().postDataJSON() as typeof sends[number]; sends.push(body);
      const selected = preparations.find(value => value.request.requestId === body.payload.requestContextId)?.request;
      if (selected) captured = {...structuredClone(selected), phase: 'CAPTURED'};
      return route.fulfill({json: {commandId: body.id, eventSeq: 50, result: {accepted: true}}});
    }
    if (url.pathname.endsWith('/context')) {const second = url.pathname.includes('/project-b/'); return route.fulfill({json: {project: {id: second ? 'project-b' : scope.projectId, name: second ? 'Project B' : 'Project A', rootPath: second ? '/synthetic/project-b' : '/synthetic/project-a', authority: {kind: 'local'}, createdAt: stamp}, threadId: second ? 'thread-b' : scope.threadId, machineName: 'Fixture', editor: {available: false, label: 'Editor'}, branch: null, head: null, changes: {added: null, removed: null, files: null}, lineage: [], scripts: [], capabilities: {git: false, terminal: false, pullRequests: false}}});}
    if (!url.pathname.includes('/memory')) return route.abort();
    reads.push(url.pathname + url.search);
    if (url.pathname.endsWith('/requests/prepare')) {
      expect(route.request().headers()['x-harness-csrf']).toBe('synthetic-csrf'); const body = route.request().postDataJSON();
      const other = url.pathname.includes('/project-b/'), owner = other ? {...scope, projectId: 'project-b', threadId: 'thread-b', projectIdentity: 'e'.repeat(64)} : scope;
      const requestId = `prepared-${preparations.length + 1}`, contextGeneration = preparations.length + 1, items = other ? [] : [structuredClone(accepted)];
      const request: MemoryPreparedRequest = {scope: owner, requestId, contextGeneration, phase: 'PREPARING', items, injectedBytes: items.length ? 240 : 0, expiresAt: new Date(Date.now() + 60000).toISOString(), recall: {requestId, contextGeneration, projectIdentity: owner.projectIdentity, queryDigest: createHash('sha256').update(body.prompt).digest('hex'), candidateIds: items.map(item => item.id), selectedRevisions: items.map(item => ({itemId: item.id, revision: item.revision})), scores: [], exclusions: [], budgetBytes: 4096, producedAt: stamp, status: 'COMPLETE'}};
      preparations.push({...body, request}); return route.fulfill({json: request});
    }
    if (url.pathname.endsWith('/requests/latest')) return route.fulfill({json: captured});
    if (url.pathname.includes('/requests/') && url.pathname.endsWith('/exclude')) {
      expect(route.request().headers()['x-harness-csrf']).toBe('synthetic-csrf'); const body = route.request().postDataJSON(); exclusions.push(body);
      const value = preparations.find(value => url.pathname.includes('/' + value.request.requestId + '/'))!.request;
      expect(body.scope).toEqual(value.scope); expect(body.contextGeneration).toBe(value.contextGeneration);
      value.items = value.items.filter(item => item.id !== body.itemId); value.recall.selectedRevisions = value.recall.selectedRevisions.filter(item => item.itemId !== body.itemId); value.recall.exclusions.push({itemId: body.itemId, reason: 'USER_EXCLUDED'}); value.injectedBytes = 0;
      return route.fulfill({json: value});
    }
    if (url.pathname.includes('/project-b/')) return route.fulfill({json: {...view, scope: {...scope, projectId: 'project-b', threadId: 'thread-b', projectIdentity: 'e'.repeat(64)}, projectName: 'Project B', items: [], tombstones: []}});
    if (url.pathname.endsWith('/memory')) return route.fulfill({json: view});
    const itemId = url.searchParams.get('itemId'), item = view.items.find(row => row.item.id === itemId)?.item;
    if (url.pathname.endsWith('/source')) {expect(JSON.parse(url.searchParams.get('sourceRef')!)).toEqual(item!.sourceRefs[0]); return route.fulfill({json: {scope, ref: item!.sourceRefs[0], label: 'Exact supporting message', content: sourceContent}});}
    if (url.pathname.endsWith('/forget')) return route.fulfill({json: {scope, itemId, revision: item!.revision, affectedDerivedArtifacts: ['index-project-a', 'summary-project-a'], immediateExclusion: true, localPurgeAfter: '2026-11-22T00:00:00Z', externalDeletion: 'NOT_SUPPORTED'}});
    if (url.pathname.endsWith('/export')) return route.fulfill({json: {scope, redacted: true, items: view.items.map(({item}) => ({id: item.id, revision: item.revision, kind: item.kind, state: item.state, text: item.text, sourceDigests: item.sourceRefs.map(ref => ref.digest)})), tombstones: []}});
    if (url.pathname.endsWith('/actions')) {
      expect(route.request().headers()['x-harness-csrf']).toBe('synthetic-csrf');
      const body = route.request().postDataJSON() as typeof writes[number]; writes.push(body); const op = body.operation;
      if (options.stale && op.action === 'edit') return route.fulfill({status: 409, json: {error: {code: 'STALE_MEMORY', message: 'This revision changed. Review the conflict before retrying.'}}});
      if (op.action === 'configure') {view.enabled = op.enabled; view.sourceThreadIds = op.sourceThreadIds; view.configRevision++;}
      else {
        const row = view.items.find(row => row.item.id === op.itemId)!;
        if (op.action === 'forget') {view.items = view.items.filter(value => value !== row); view.tombstones.push({itemId: row.item.id, projectIdentity: scope.projectIdentity, deletionRevision: row.item.revision + 1, deletedAt: stamp, sourceExclusions: row.item.sourceRefs, affectedDerivedArtifacts: ['index-project-a', 'summary-project-a'], purgeStatus: 'PENDING'});}
        else {row.item = {...row.item, revision: row.item.revision + 1, text: op.action === 'edit' || op.action === 'confirm-preference' ? op.text : row.item.text, kind: op.action === 'confirm-preference' ? 'PREFERENCE' : row.item.kind, state: op.action === 'reject' || op.action === 'expire' ? 'EXPIRED' : 'ACCEPTED'}; row.conflictRevisions = [];}
      }
      return route.fulfill({json: {commandId: body.commandId, eventSeq: 10 + writes.length, result: {revision: op.baseRevision + 1, state: op.action === 'configure' ? 'CONFIGURED' : op.action === 'forget' ? 'DELETED' : 'ACCEPTED', ...('itemId' in op ? {itemId: op.itemId} : {})}}});
    }
    return route.abort();
  });
  await page.emulateMedia({reducedMotion: 'reduce'});
  return {view, writes, reads, preparations, exclusions, sends};
}
const modal = (page: Page) => page.getByRole('dialog', {name: 'Project memory', exact: true});
async function open(page: Page) {await page.goto('/project-memory'); await page.getByRole('button', {name: 'Project memory', exact: true}).click(); await expect(modal(page).getByRole('tab', {name: 'Accepted', exact: true})).toBeVisible();}

test('opens lazily, keeps all four tabs keyboard accessible and fits a narrow viewport', async ({page}) => {
  const fixture = await host(page); await page.setViewportSize({width: 390, height: 844}); await page.goto('/project-memory'); expect(fixture.reads).toEqual([]);
  await page.getByRole('button', {name: 'Project memory', exact: true}).click(); const panel = modal(page);
  await expect(panel).toContainText('Use UTC for exported dates.'); await expect(panel).toContainText('Last used'); await expect(panel).toContainText('Reported');
  await panel.getByRole('tab', {name: 'Accepted', exact: true}).focus(); await page.keyboard.press('ArrowRight'); await expect(panel.getByRole('tab', {name: 'Proposals', exact: true})).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End'); await expect(panel.getByRole('tab', {name: 'Deleted history', exact: true})).toHaveAttribute('aria-selected', 'true');
  expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  const bounds = (await panel.boundingBox())!; expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.keyboard.press('Escape'); await expect(panel).toHaveCount(0); await expect(page.getByRole('button', {name: 'Project memory', exact: true})).toBeFocused();
});

test('requires an explicit source selection before enabling the project', async ({page}) => {
  const fixture = await host(page, {enabled: false}); await open(page); const panel = modal(page);
  const enable = panel.getByRole('button', {name: 'Enable for this project', exact: true}); await expect(enable).toBeDisabled();
  await panel.getByRole('checkbox', {name: 'Source conversation', exact: true}).check(); await enable.click();
  await expect.poll(() => fixture.writes.length).toBe(1); expect(fixture.writes[0].operation).toEqual({action: 'configure', baseRevision: 1, enabled: true, sourceThreadIds: ['thread-a']}); await expect(panel).toContainText('Enabled for this project');
});

test('disabled host prevents new opt-in and preserves correction of retained records', async ({page}) => {
  const fixture = await host(page, {available: false, enabled: false}); await open(page); const panel = modal(page);
  await expect(panel.getByRole('button', {name: 'Enable for this project', exact: true})).toBeDisabled();
  await panel.getByRole('button', {name: 'Edit accepted', exact: true}).click(); await panel.getByRole('textbox', {name: 'Memory text', exact: true}).fill('Use ISO dates.'); await panel.getByRole('button', {name: 'Save correction', exact: true}).click();
  await expect(panel).toContainText('Use ISO dates.'); expect(fixture.writes[0].operation).toMatchObject({action: 'edit', itemId: 'accepted', baseRevision: 1});
});

test('opens an exact source as inert text and accepts a proposal by its reviewed revision', async ({page}) => {
  const fixture = await host(page); await open(page); const panel = modal(page); await panel.getByRole('tab', {name: 'Proposals', exact: true}).click();
  await panel.getByRole('button', {name: 'View source proposal 1', exact: true}).click(); await expect(panel.getByRole('region', {name: 'Supporting source'})).toContainText('source-r1');
  await expect(panel.getByRole('region', {name: 'Supporting source'})).toContainText('<script>window.memoryExecuted=true</script>'); expect(await page.evaluate(() => (window as unknown as {memoryExecuted?: boolean}).memoryExecuted)).toBeUndefined();
  expect(fixture.reads.some(url => url.includes('itemId=proposal&revision=1&sourceDigest='))).toBe(true);
  await panel.getByRole('button', {name: 'Accept proposal', exact: true}).click(); await expect(panel).not.toContainText('Keep reports in CSV.');
  expect(fixture.writes[0].operation).toEqual({action: 'accept', itemId: 'proposal', baseRevision: 1});
});

test('retains the exact correction draft when the reviewed revision is stale', async ({page}) => {
  await host(page, {stale: true}); await open(page); const panel = modal(page);
  await panel.getByRole('button', {name: 'Edit accepted', exact: true}).click(); const draft = panel.getByRole('textbox', {name: 'Memory text', exact: true}); await draft.fill('Keep this unsaved correction.'); await panel.getByRole('button', {name: 'Save correction', exact: true}).click();
  await expect(panel.getByRole('alert')).toContainText('This revision changed'); await expect(draft).toHaveValue('Keep this unsaved correction.');
});

test('conflict resolution requires explicit revisions and a note before preserving both', async ({page}) => {
  const fixture = await host(page); await open(page); const panel = modal(page); await panel.getByRole('tab', {name: 'Conflicts', exact: true}).click();
  const resolve = panel.getByRole('button', {name: 'Resolve conflict', exact: true}); await expect(resolve).toBeDisabled();
  await panel.getByRole('checkbox', {name: 'Keep revision 2', exact: true}).check(); await panel.getByRole('checkbox', {name: 'Keep revision 3', exact: true}).check(); await expect(resolve).toBeDisabled();
  await panel.getByRole('textbox', {name: 'Resolution note', exact: true}).fill('Both versions apply to different deployment targets.'); await resolve.click();
  await expect.poll(() => fixture.writes.length).toBe(1); expect(fixture.writes[0].operation).toEqual({action: 'resolve', itemId: 'conflict', baseRevision: 3, survivingRevisions: [2, 3], note: 'Both versions apply to different deployment targets.'});
});

test('a completed conflict draft cannot be submitted after the review becomes read-only', async ({page}) => {
  const fixture = await host(page); await page.goto('/project-memory?review-permissions');
  const panel = modal(page); await panel.getByRole('tab', {name: 'Conflicts', exact: true}).click();
  const revision = panel.getByRole('checkbox', {name: 'Keep revision 2', exact: true}), note = panel.getByRole('textbox', {name: 'Resolution note', exact: true});
  const resolve = panel.getByRole('button', {name: 'Resolve conflict', exact: true});
  await revision.check(); await note.fill('Keep the earlier API version.'); await expect(resolve).toBeEnabled();
  await page.evaluate(() => (window as unknown as {setReviewReadOnly(value: boolean): void}).setReviewReadOnly(true));
  await expect(revision).toBeChecked(); await expect(revision).toBeDisabled();
  await expect(note).toHaveValue('Keep the earlier API version.'); await expect(note).toBeDisabled(); await expect(resolve).toBeDisabled();
  await resolve.evaluate(button => (button as HTMLButtonElement).form!.requestSubmit());
  await panel.getByRole('button', {name: 'View source for revision 2', exact: true}).click();
  await expect(panel.getByRole('region', {name: 'Supporting source'})).toContainText(sourceContent); expect(fixture.writes).toEqual([]);
});

test('forget names invalidated artifacts before committing and shows pending purge afterward', async ({page}) => {
  const fixture = await host(page); await open(page); const panel = modal(page); await panel.getByRole('button', {name: 'Forget accepted', exact: true}).click();
  const preview = panel.getByRole('region', {name: 'Forget preview'}); await expect(preview).toContainText('index-project-a'); await expect(preview).toContainText('summary-project-a'); await expect(preview).toContainText('immediately'); expect(fixture.writes).toHaveLength(0);
  await preview.getByRole('button', {name: 'Confirm forget', exact: true}).click(); await expect(panel).not.toContainText('Use UTC for exported dates.'); await panel.getByRole('tab', {name: 'Deleted history', exact: true}).click();
  await expect(panel).toContainText('Physical purge pending'); expect(fixture.writes[0].operation).toEqual({action: 'forget', itemId: 'accepted', baseRevision: 1});
});

test('owner change closes the old review without retaining the previous project text', async ({page}) => {
  await host(page); await open(page); await page.evaluate(() => (window as unknown as {switchMemoryOwner(): void}).switchMemoryOwner());
  await expect(modal(page)).toHaveCount(0); await page.getByRole('button', {name: 'Project memory', exact: true}).click(); await expect(modal(page)).toContainText('Project B'); await expect(modal(page)).not.toContainText('Use UTC for exported dates.');
});

test('explicit export produces only the host redacted export envelope', async ({page}) => {
  const fixture = await host(page); await open(page); expect(fixture.reads.some(url => url.endsWith('/export'))).toBe(false);
  const downloaded = page.waitForEvent('download'); await modal(page).getByRole('button', {name: 'Export redacted JSON', exact: true}).click();
  expect((await downloaded).suggestedFilename()).toMatch(/^project-memory-project-a.*\.json$/);
});

test('recall explains exact source and disables exclusion without a request preparation adapter', async ({page}) => {
  await host(page); await page.goto('/project-memory'); await page.getByRole('button', {name: 'Inspect prepared context', exact: true}).click();
  const inspector = page.getByRole('dialog', {name: 'Context inspector', exact: true}); await expect(inspector).toContainText('Why recalled'); await expect(inspector).toContainText('UTC'); await expect(inspector).toContainText('message-accepted');
  await expect(inspector.getByRole('button', {name: 'Exclude from this request', exact: true})).toBeDisabled(); await expect(inspector).toContainText('Request exclusion is unavailable');
});

test('confirms a reusable preference only after explicit project-only confirmation', async ({page}) => {
  const fixture = await host(page); await open(page); const panel = modal(page);
  await panel.getByRole('button', {name: 'Edit accepted', exact: true}).click();
  const confirmation = panel.getByRole('checkbox', {name: 'Confirm this as a reusable preference for this project only', exact: true}); await expect(confirmation).not.toBeChecked();
  await confirmation.check(); await panel.getByRole('textbox', {name: 'Memory text', exact: true}).fill('Prefer UTC in this project.'); await panel.getByRole('button', {name: 'Save correction', exact: true}).click();
  await expect.poll(() => fixture.writes.length).toBe(1); expect(fixture.writes[0].operation).toMatchObject({action: 'confirm-preference', confirmation: 'PROJECT_ONLY', itemId: 'accepted', baseRevision: 1, text: 'Prefer UTC in this project.'});
  await expect(panel).toContainText('Preference');
});

test('prepares the exact draft with terminal excerpts, excludes a revision, and sends its host token', async ({page}) => {
  const fixture = await host(page); await page.goto('/project-memory?prepare=1');
  await page.getByRole('checkbox', {name: 'Attach terminal excerpt', exact: true}).check(); expect(fixture.preparations).toHaveLength(0);
  await page.getByRole('button', {name: 'Inspect prepared context', exact: true}).click(); const inspector = page.getByRole('dialog', {name: 'Context inspector', exact: true});
  await expect(inspector).toContainText('Prepared for the current draft.'); expect(fixture.preparations[0]).toMatchObject({modelId: 'model-a', thinkingLevel: 'high'});
  expect(fixture.preparations[0].prompt).toContain('Terminal excerpt'); expect(fixture.preparations[0].prompt).toContain('UTC export verified.');
  await inspector.getByRole('button', {name: 'Exclude from this request', exact: true}).click(); await expect(inspector).toContainText('No memory was selected for this request.');
  expect(fixture.exclusions).toHaveLength(1); await page.keyboard.press('Escape'); await page.getByRole('button', {name: 'Send draft', exact: true}).click();
  await expect.poll(() => fixture.sends.length).toBe(1); expect(fixture.sends[0].payload).toMatchObject({requestContextId: 'prepared-1', content: fixture.preparations[0].prompt});
});

test('keeps a confirmed exclusion when the unchanged draft is inspected again', async ({page}) => {
  const fixture = await host(page); await page.goto('/project-memory?prepare=1');
  await page.getByRole('button', {name: 'Inspect prepared context', exact: true}).click();
  const inspector = page.getByRole('dialog', {name: 'Context inspector', exact: true});
  await inspector.getByRole('button', {name: 'Exclude from this request', exact: true}).click();
  await expect(inspector).toContainText('No memory was selected for this request.');
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name: 'Inspect prepared context', exact: true}).click();
  await expect(inspector).toContainText('No memory was selected for this request.');
  expect(fixture.preparations).toHaveLength(1);
  await page.keyboard.press('Escape'); await page.getByRole('button', {name: 'Send draft', exact: true}).click();
  await expect.poll(() => fixture.sends.length).toBe(1);
  expect(fixture.sends[0].payload.requestContextId).toBe('prepared-1');
});

test('keeps a failed exclusion blocked when the unchanged draft is inspected again', async ({page}) => {
  const fixture = await host(page);
  await page.route('**/memory/requests/*/exclude', route => route.fulfill({status: 409, json: {error: {code: 'STALE_MEMORY', message: 'Exclusion was not confirmed.'}}}));
  await page.goto('/project-memory?prepare=1'); await page.getByRole('button', {name: 'Inspect prepared context', exact: true}).click();
  const inspector = page.getByRole('dialog', {name: 'Context inspector', exact: true});
  await inspector.getByRole('button', {name: 'Exclude from this request', exact: true}).click();
  await expect(inspector.getByRole('alert').first()).toContainText('Exclusion was not confirmed.');
  await page.keyboard.press('Escape'); await page.getByRole('button', {name: 'Inspect prepared context', exact: true}).click();
  await expect(inspector.getByRole('alert').first()).toContainText('Exclusion was not confirmed.');
  await expect(page.getByRole('button', {name: 'Send draft', exact: true})).toBeDisabled();
  expect(fixture.preparations).toHaveLength(1); expect(fixture.sends).toHaveLength(0);
});

test('invalidates exclusions when the draft changes and does not reuse its previous token', async ({page}) => {
  const fixture = await host(page); await page.goto('/project-memory?prepare=1'); await page.getByRole('button', {name: 'Inspect prepared context', exact: true}).click();
  const inspector = page.getByRole('dialog', {name: 'Context inspector', exact: true}); await inspector.getByRole('button', {name: 'Exclude from this request', exact: true}).click(); await expect(inspector).toContainText('No memory was selected');
  await page.keyboard.press('Escape'); await page.getByRole('textbox', {name: 'Request draft', exact: true}).fill('A different export request.'); await page.getByRole('button', {name: 'Send draft', exact: true}).click();
  await expect.poll(() => fixture.sends.length).toBe(1); expect(fixture.sends[0].payload).not.toHaveProperty('requestContextId'); expect(fixture.sends[0].payload.content).toBe('A different export request.'); expect(fixture.preparations).toHaveLength(1);
});

test('blocks send during exclusion and after failure until explicit refresh', async ({page}) => {
  const fixture = await host(page); let release!: () => void; const pending = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/memory/requests/*/exclude', async route => {await pending; await route.fulfill({status: 409, json: {error: {code: 'STALE_MEMORY', message: 'Exclusion was not confirmed.'}}});});
  await page.goto('/project-memory?prepare=1'); await page.getByRole('button', {name: 'Inspect prepared context', exact: true}).click(); const inspector = page.getByRole('dialog', {name: 'Context inspector', exact: true});
  await inspector.getByRole('button', {name: 'Exclude from this request', exact: true}).click(); await expect(page.getByRole('button', {name: 'Send draft', exact: true})).toBeDisabled();
  release(); await expect(inspector.getByRole('alert').first()).toContainText('Exclusion was not confirmed.'); await expect(page.getByRole('button', {name: 'Send draft', exact: true})).toBeDisabled(); expect(fixture.sends).toHaveLength(0);
  await inspector.getByRole('button', {name: 'Refresh prepared context', exact: true}).click(); await expect.poll(() => fixture.preparations.length).toBe(2); await expect(page.getByRole('button', {name: 'Send draft', exact: true})).toBeEnabled();
  await page.keyboard.press('Escape'); await page.getByRole('button', {name: 'Send draft', exact: true}).click(); await expect.poll(() => fixture.sends.length).toBe(1); expect(fixture.sends[0].payload.requestContextId).toBe('prepared-2');
});

test('an empty draft shows the last captured request with exclusion disabled', async ({page}) => {
  const fixture = await host(page); await page.goto('/project-memory?prepare=1'); await page.getByRole('button', {name: 'Inspect prepared context', exact: true}).click();
  await expect(page.getByRole('dialog', {name: 'Context inspector', exact: true})).toContainText('Prepared for the current draft.'); await page.keyboard.press('Escape'); await page.getByRole('button', {name: 'Send draft', exact: true}).click();
  await expect.poll(() => fixture.sends.length).toBe(1); await expect(page.getByRole('textbox', {name: 'Request draft', exact: true})).toHaveValue(''); await page.getByRole('button', {name: 'Inspect prepared context', exact: true}).click();
  const inspector = page.getByRole('dialog', {name: 'Context inspector', exact: true}); await expect(inspector).toContainText('Captured for the last sent request.'); await expect(inspector.getByRole('button', {name: 'Exclude from this request', exact: true})).toBeDisabled();
});
