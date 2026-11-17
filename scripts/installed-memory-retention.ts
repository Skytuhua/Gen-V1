import {expect, type Page} from '@playwright/test';
import {createHash, randomUUID} from 'node:crypto';
import {lstat, mkdir, readFile, realpath} from 'node:fs/promises';
import {isAbsolute, join, resolve} from 'node:path';
import {Store} from '../packages/storage/store.ts';
import {ProjectMemory} from '../packages/core/project-memory.ts';
import {registeredCapabilityFlags} from '../packages/core/capability-flags.ts';
import {memoryExportSchema, projectMemoryViewSchema, type MemoryAction, type MemorySourceRefV1} from '../packages/contracts/project-memory.ts';
import type {Message, Thread} from '../packages/contracts/index.ts';
import {prepareInstalledNativeSave, readInstalledNativeSave, saveInstalledMemoryThroughNativeDialog, type InstalledNativeOwner, type InstalledNativeSaveObservation} from './installed-native-save.ts';

export const INSTALLED_MEMORY_CASE = Object.freeze({
  projectId: 'installed-memory-project', threadId: 'installed-memory-thread',
  projectName: 'Installed retention proof', threadTitle: 'Installed memory review',
  initialText: 'Use UTC for installed retention reports.',
  editedText: 'Use ISO 8601 UTC dates for installed retention reports.',
  sourceText: 'Pinned source: use UTC for installed retention reports.\n<script>window.installedMemorySourceExecuted=true</script>',
  changedSourceText: 'A later message revision changed this instruction. The retained source must remain exact.',
  acceptText: 'Keep the installed retention checklist with the project.',
  rejectText: 'Proposed: publish the disposable retention checklist globally.',
  sensitiveText: 'Private disposable retention note: keep the amber launch schedule local.',
});
type DirectoryIdentity = {path: string; dev: string; ino: string};
type SeedItem = {id: string; revision: number; source: MemorySourceRefV1};
export interface InstalledMemorySeed {
  evidenceRoot: DirectoryIdentity; profile: DirectoryIdentity; project: DirectoryIdentity;
  profileId: string; projectIdentity: string; projectId: string; threadId: string;
  items: Record<'edit' | 'accept' | 'reject' | 'forget', SeedItem>;
}
export type InstalledMemoryObservation = Record<string, unknown>;

async function directoryIdentity(path: string): Promise<DirectoryIdentity> {
  if (!isAbsolute(path) || resolve(path) !== path) throw Error('The memory fixture needs an absolute canonical evidence directory.');
  const info = await lstat(path, {bigint: true});
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path) throw Error('The memory fixture directory must be ordinary and not redirected.');
  return {path, dev: String(info.dev), ino: String(info.ino)};
}
async function requireAbsent(path: string) {
  try {await lstat(path);} catch (error) {if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error;}
  throw Error('The exclusive installed-memory profile or project already exists.');
}
function defaultFlags() {
  const flags = registeredCapabilityFlags();
  if (flags['memory.projectV1'] || flags['memory.externalRecallExperimentV1']) throw Error('Installed retention verification requires production default-off memory flags.');
}

/** Only a new disposable profile is seeded. The installed executable receives no activation or replacement host. */
export async function seedInstalledMemoryProfile(directory: string): Promise<InstalledMemorySeed> {
  defaultFlags();
  const evidenceRoot = await directoryIdentity(directory), profilePath = join(directory, 'host'), projectPath = join(directory, 'memory-project');
  await requireAbsent(profilePath); await requireAbsent(projectPath);
  await mkdir(profilePath); await mkdir(projectPath);
  const profile = await directoryIdentity(profilePath), project = await directoryIdentity(projectPath);
  const store = new Store(profile.path), stamp = new Date().toISOString();
  try {
    const fixture = INSTALLED_MEMORY_CASE;
    const thread: Thread = {id: fixture.threadId, title: fixture.threadTitle, projectId: fixture.projectId, projectName: fixture.projectName, createdAt: stamp, updatedAt: stamp, status: 'completed', epoch: 1, runId: null, modelId: null, accountId: null, sessionPath: null, kind: 'main'};
    const sources = {edit: fixture.sourceText, accept: fixture.acceptText, reject: fixture.rejectText, forget: fixture.sensitiveText};
    store.internal('installed.memory.fixture', null, () => {
      store.put('workspaceProject', fixture.projectId, null, {id: fixture.projectId, name: fixture.projectName, authority: {kind: 'local'}, rootPath: project.path, createdAt: stamp});
      store.put('workspaceProjectRoot', fixture.projectId, null, {path: project.path, identity: {dev: project.dev, ino: project.ino}});
      store.put('thread', thread.id, thread.id, thread);
      for (const [kind, content] of Object.entries(sources)) {
        const id = 'installed-memory-source-' + kind;
        store.put('message', id, thread.id, {id, threadId: thread.id, role: 'user', content, createdAt: stamp, runId: null} satisfies Message);
      }
      return {fixture: 'installed-memory-retention', sourceCount: 4};
    });
    // This constructor-local predicate never changes the process capability registry.
    const memory = new ProjectMemory(store, {enabled: () => true}), access = await memory.access(fixture.projectId, fixture.threadId);
    const review = (operation: MemoryAction) => memory.review(access, {id: randomUUID(), type: 'project.memory.review', threadId: thread.id, payload: {operation}}, 'installed-retention-fixture');
    review({action: 'configure', baseRevision: 0, enabled: true, sourceThreadIds: [thread.id]});
    const items = {} as InstalledMemorySeed['items'];
    for (const kind of ['edit', 'accept', 'reject', 'forget'] as const) {
      const source = memory.captureMessage(access, 'installed-memory-source-' + kind);
      const item = memory.propose(access, {kind: 'CONSTRAINT', text: kind === 'edit' ? fixture.initialText : sources[kind], sourceRefs: [source], sensitivity: kind === 'forget' ? 'SENSITIVE' : 'NORMAL'}, {kind: 'USER', id: 'installed-retention-fixture'});
      if (kind === 'edit' || kind === 'forget') review({action: 'accept', itemId: item.id, baseRevision: item.revision});
      items[kind] = {id: item.id, revision: kind === 'edit' || kind === 'forget' ? 2 : 1, source};
    }
    // The installed source view must resolve the captured bytes, not today's message body.
    store.internal('installed.memory.source.changed', thread.id, () => {
      const message = store.get<Message>('message', items.edit.source.sourceId)!;
      store.put('message', message.id, thread.id, {...message, content: fixture.changedSourceText});
      return {sourceId: message.id};
    });
    review({action: 'configure', baseRevision: 1, enabled: false, sourceThreadIds: [thread.id]});
    defaultFlags();
    return {evidenceRoot, profile, project, profileId: access.profileId, projectIdentity: access.projectIdentity, projectId: fixture.projectId, threadId: fixture.threadId, items};
  } finally {store.close();}
}

export async function assertInstalledMemoryProfile(seed: InstalledMemorySeed) {
  for (const expected of [seed.evidenceRoot, seed.profile, seed.project]) {
    const actual = await directoryIdentity(expected.path);
    if (actual.dev !== expected.dev || actual.ino !== expected.ino) throw Error('The installed memory profile or project identity changed.');
  }
}
async function readView(page: Page, seed: InstalledMemorySeed) {
  const result = await page.evaluate(async ({projectId, threadId}) => {
    const response = await fetch('/api/projects/' + encodeURIComponent(projectId) + '/memory?' + new URLSearchParams({threadId}), {credentials: 'same-origin', cache: 'no-store', redirect: 'error'});
    if (!response.ok || response.headers.get('cache-control') !== 'no-store') throw Error('Installed memory read failed or was cacheable.');
    return response.json();
  }, {projectId: seed.projectId, threadId: seed.threadId});
  const view = projectMemoryViewSchema.parse(result);
  expect(view.scope).toMatchObject({projectId: seed.projectId, projectIdentity: seed.projectIdentity, threadId: seed.threadId, accountId: null});
  expect(view).toMatchObject({available: false, enabled: false, sourceThreadIds: [seed.threadId]});
  return view;
}
async function screenshot(page: Page, directory: string, name: string) {
  const path = join(directory, name); await page.screenshot({path});
  const bytes = await readFile(path);
  return {file: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), viewport: await page.evaluate(() => ({width: innerWidth, height: innerHeight})), theme: await page.evaluate(() => document.documentElement.dataset.theme ?? document.body.dataset.theme ?? null)};
}

/** Runs only after the caller verifies the installed executable, unique nonce and owned CDP session. */
export async function verifyInstalledMemoryUI(page: Page, seed: InstalledMemorySeed, iteration: number, observations: InstalledMemoryObservation[], nativeOwner: InstalledNativeOwner) {
  await assertInstalledMemoryProfile(seed);
  const directory = seed.evidenceRoot.path, fixture = INSTALLED_MEMORY_CASE;
  const commandTypes: string[] = [];
  let nativeDialog: InstalledNativeSaveObservation | undefined, nativeDownloadBehaviorRestored = false;
  const observeCommand = (request: import('@playwright/test').Request) => {
    if (new URL(request.url()).pathname !== '/api/commands' || request.method() !== 'POST') return;
    const type = (request.postDataJSON() as {type?: unknown})?.type;
    if (typeof type === 'string' && commandTypes.length < 100) commandTypes.push(type.slice(0, 100));
  };
  page.on('request', observeCommand);
  try {
    await page.getByRole('button', {name: fixture.threadTitle + ' Completed', exact: true}).click({timeout: 30000});
    const overview = page.getByRole('region', {name: 'Project overview window', exact: true});
    await expect(overview).toBeVisible({timeout: 30000});
    await expect(overview).toHaveAttribute('data-collapsed', /^(true|false)$/);
    if (await overview.getAttribute('data-collapsed') === 'true') await overview.getByRole('button', {name: 'Expand Project overview', exact: true}).click();
    await expect(overview).toHaveAttribute('data-collapsed', 'false');
    const memoryButton = overview.getByRole('button', {name: 'Project memory', exact: true});
    await expect(memoryButton).toBeEnabled({timeout: 30000});
    await memoryButton.click({timeout: 30000});
    const panel = page.getByRole('dialog', {name: 'Project memory', exact: true});
    await expect(panel.getByRole('button', {name: 'Enable for this project', exact: true})).toBeDisabled();
    await expect(panel).toContainText('Project memory is disabled by this host. Existing records remain reviewable.');
    const before = await readView(page, seed);
    observations.push({iteration, step: 'installed-default-off-read', available: before.available, enabled: before.enabled, accountId: before.scope.accountId, itemCount: before.items.length, tombstoneCount: before.tombstones.length});
    const row = (id: string) => panel.getByRole('article', {name: 'Memory ' + id, exact: true});
    if (iteration === 1) {
      await expect(row(seed.items.edit.id)).toContainText(fixture.initialText);
      await row(seed.items.edit.id).getByRole('button', {name: 'View source ' + seed.items.edit.id + ' 1', exact: true}).click();
      const source = panel.getByRole('region', {name: 'Supporting source', exact: true});
      await expect(source.locator('pre')).toHaveText(fixture.sourceText);
      expect(await source.locator('pre').textContent()).toBe(fixture.sourceText);
      await expect(source).toContainText(seed.items.edit.source.sourceRevision);
      await expect(source).toContainText(seed.items.edit.source.digest);
      expect(await page.evaluate(() => (window as unknown as {installedMemorySourceExecuted?: boolean}).installedMemorySourceExecuted)).toBeUndefined();
      await source.scrollIntoViewIfNeeded(); await expect(source.locator('pre')).toBeVisible();
      observations.push({iteration, step: 'exact-pinned-source', itemId: seed.items.edit.id, source: seed.items.edit.source, capturedTextMatched: true, changedMessageNotSubstituted: true, inertText: true, screenshot: await screenshot(page, directory, 'installed-memory-source.png')});
      await source.getByRole('button', {name: 'Close source', exact: true}).click();
      await row(seed.items.edit.id).getByRole('button', {name: 'Edit ' + seed.items.edit.id, exact: true}).click();
      await panel.getByRole('textbox', {name: 'Memory text', exact: true}).fill(fixture.editedText);
      await panel.getByRole('button', {name: 'Save correction', exact: true}).click();
      await expect(row(seed.items.edit.id)).toContainText(fixture.editedText);
      await expect(row(seed.items.edit.id)).toContainText('Accepted · revision 3');
      await panel.getByRole('tab', {name: 'Proposals', exact: true}).click();
      await row(seed.items.accept.id).getByRole('button', {name: 'Accept ' + seed.items.accept.id, exact: true}).click();
      await expect(row(seed.items.accept.id)).toHaveCount(0);
      await row(seed.items.reject.id).getByRole('button', {name: 'Reject ' + seed.items.reject.id, exact: true}).click();
      await expect(row(seed.items.reject.id)).toContainText('Rejected · revision 2');
      await expect(row(seed.items.reject.id).getByRole('button', {name: 'Accept ' + seed.items.reject.id, exact: true})).toHaveCount(0);
      await panel.getByRole('tab', {name: 'Accepted', exact: true}).click();
      await expect(row(seed.items.accept.id)).toContainText('Accepted · revision 2');
      await expect(row(seed.items.reject.id)).toHaveCount(0);
      await row(seed.items.edit.id).scrollIntoViewIfNeeded();
      observations.push({iteration, step: 'review-edit-accept-reject', editedRevision: 3, acceptedRevision: 2, rejectedState: 'EXPIRED', screenshot: await screenshot(page, directory, 'installed-memory-reviewed.png')});
      await panel.getByRole('tab', {name: 'Proposals', exact: true}).click();
      await expect(row(seed.items.reject.id)).toContainText('Rejected · revision 2');
      await row(seed.items.reject.id).scrollIntoViewIfNeeded();
      observations.push({iteration, step: 'rejected-record-retained', screenshot: await screenshot(page, directory, 'installed-memory-rejected.png')});
      await panel.getByRole('tab', {name: 'Accepted', exact: true}).click();
      // connectOverCDP implicitly installs allowAndName. Restore Electron's real Save flow before proof.
      const browser = page.context().browser(); if (!browser) throw Error('The owned installed browser is unavailable.');
      const downloadControl = await browser.newBrowserCDPSession();
      try {await downloadControl.send('Browser.setDownloadBehavior', {behavior: 'default', eventsEnabled: false}); nativeDownloadBehaviorRestored = true;}
      finally {await downloadControl.detach();}
      await assertInstalledMemoryProfile(seed);
      const exportTarget = await prepareInstalledNativeSave(directory), exportName = 'installed-memory-redacted-export.json';
      await expect(panel.locator('[data-memory-export-status="saved"]')).toHaveCount(0);
      const saved = await saveInstalledMemoryThroughNativeDialog(nativeOwner, exportTarget,
        () => panel.getByRole('button', {name: 'Export redacted JSON', exact: true}).click(), async () => {
          const completion = panel.locator('[data-memory-export-status="saved"]');
          await expect(completion).toHaveText('Redacted export downloaded.', {timeout: 30000});
          await expect(completion).toHaveAttribute('data-memory-export-admitted', 'true');
          await expect(completion).toHaveAttribute('data-memory-export-filename', 'project-memory-' + seed.projectId + '.json');
          await assertInstalledMemoryProfile(seed);
          const bytes = await readInstalledNativeSave(exportTarget), digest = createHash('sha256').update(bytes).digest('hex');
          await expect(completion).toHaveAttribute('data-memory-export-bytes', String(bytes.length));
          await expect(completion).toHaveAttribute('data-memory-export-sha256', digest);
          return {bytes, digest};
        }, value => {nativeDialog = value;});
      nativeDialog = saved.dialog;
      const exportBytes = saved.value.bytes, exportDigest = saved.value.digest;
      if (exportBytes.length > 1024 * 1024) throw Error('The installed memory export exceeded its fixture bound.');
      const output = memoryExportSchema.parse(JSON.parse(exportBytes.toString('utf8')));
      expect(output.scope).toEqual((await readView(page, seed)).scope);
      expect(output.items.find(item => item.id === seed.items.forget.id)?.text).toBe('[redacted]');
      expect(exportBytes.toString('utf8')).not.toContain(fixture.sensitiveText);
      expect(exportBytes.toString('utf8')).not.toContain(fixture.sourceText);
      observations.push({iteration, step: 'explicit-redacted-export', file: exportName, bytes: exportBytes.length, sha256: exportDigest, redacted: output.redacted, sensitiveItemRedacted: true, sourceBodiesAbsent: true,
        nativeSave: {downloadBehavior: 'default', downloadBehaviorResetAcknowledged: nativeDownloadBehaviorRestored, owner: {pid: nativeOwner.pid, executable: nativeOwner.executable},
          destination: {file: exportName, evidenceRoot: seed.evidenceRoot, absentBeforeDispatch: true, regularFileReadBack: true, identityLeaseHeldThroughReadback: true}, dialog: nativeDialog,
          completion: {status: 'saved', admitted: true, filename: 'project-memory-' + seed.projectId + '.json', bytes: exportBytes.length, sha256: exportDigest}}});
      await row(seed.items.forget.id).getByRole('button', {name: 'Forget ' + seed.items.forget.id, exact: true}).click();
      const preview = panel.getByRole('region', {name: 'Forget preview', exact: true});
      await expect(preview).toContainText('immediately excludes the item from retrieval');
      await expect(preview).toContainText('Deletion from external providers is not supported.');
      await preview.getByRole('button', {name: 'Confirm forget', exact: true}).click();
      await expect(row(seed.items.forget.id)).toHaveCount(0);
    } else {
      await expect(row(seed.items.edit.id)).toContainText(fixture.editedText);
      await expect(row(seed.items.edit.id)).toContainText('Accepted · revision 3');
      await expect(row(seed.items.accept.id)).toContainText('Accepted · revision 2');
      await expect(row(seed.items.reject.id)).toHaveCount(0);
      await expect(row(seed.items.forget.id)).toHaveCount(0);
      await row(seed.items.edit.id).scrollIntoViewIfNeeded();
      observations.push({iteration, step: 'restart-retained-review', editedRevision: 3, acceptedRevision: 2, rejectedState: 'EXPIRED', screenshot: await screenshot(page, directory, 'installed-memory-restart-reviewed.png')});
      await panel.getByRole('tab', {name: 'Proposals', exact: true}).click();
      await expect(row(seed.items.reject.id)).toContainText('Rejected · revision 2');
      await expect(row(seed.items.reject.id).getByRole('button', {name: 'Accept ' + seed.items.reject.id, exact: true})).toHaveCount(0);
      await row(seed.items.reject.id).scrollIntoViewIfNeeded();
      observations.push({iteration, step: 'restart-rejected-proposal', rejectedState: 'EXPIRED', screenshot: await screenshot(page, directory, 'installed-memory-restart-rejected.png')});
    }
    await panel.getByRole('tab', {name: 'Deleted history', exact: true}).click();
    await expect(panel.getByRole('tabpanel')).toContainText(seed.items.forget.id);
    await expect(panel.getByRole('tabpanel')).toContainText('Deletion revision 3');
    await expect(panel.getByRole('tabpanel')).toContainText('Physical purge pending');
    await expect(panel).not.toContainText(fixture.sensitiveText);
    const after = await readView(page, seed);
    expect(after.items.some(value => value.item.id === seed.items.forget.id)).toBe(false);
    expect(after.tombstones).toHaveLength(1);
    expect(after.tombstones[0]).toMatchObject({itemId: seed.items.forget.id, deletionRevision: 3, purgeStatus: 'PENDING'});
    observations.push({iteration, step: iteration === 1 ? 'forget-tombstone' : 'restart-tombstone', tombstone: {itemId: after.tombstones[0].itemId, deletionRevision: after.tombstones[0].deletionRevision, purgeStatus: after.tombstones[0].purgeStatus}, screenshot: await screenshot(page, directory, iteration === 1 ? 'installed-memory-forgotten.png' : 'installed-memory-restart-tombstone.png')});
    await panel.getByRole('button', {name: 'Close dialog', exact: true}).click();
  } catch (error) {
    observations.push({iteration, step: 'failed', error: error instanceof Error ? error.message.slice(0, 2000) : 'Installed memory review failed.', screenshot: await screenshot(page, directory, 'installed-memory-launch-' + iteration + '-failure.png').catch(() => null),
      ...(nativeDownloadBehaviorRestored ? {nativeSave: {downloadBehavior: 'default', owner: {pid: nativeOwner.pid, executable: nativeOwner.executable}, dialog: nativeDialog ?? null}} : {})});
    throw error;
  } finally {
    page.off('request', observeCommand);
    observations.push({iteration, step: 'review-command-observation', commandTypes, providerNetworkCalls: null, providerNetworkMeasurement: 'Not measured. This proof performs no model-generation or sign-in actions.'});
  }
}

/** Call only after the owned native process exits cleanly and its backend health endpoint stops. */
export async function observeInstalledMemoryStorage(seed: InstalledMemorySeed, iteration: number) {
  await assertInstalledMemoryProfile(seed); defaultFlags();
  const store = new Store(seed.profile.path);
  try {
    const memory = new ProjectMemory(store), access = await memory.access(seed.projectId, seed.threadId), view = memory.read(access), snapshot = store.snapshot();
    expect(access.profileId).toBe(seed.profileId); expect(access.projectIdentity).toBe(seed.projectIdentity);
    expect(view).toMatchObject({available: false, enabled: false});
    expect(view.items.find(row => row.item.id === seed.items.edit.id)?.item).toMatchObject({text: INSTALLED_MEMORY_CASE.editedText, revision: 3, state: 'ACCEPTED'});
    expect(view.items.find(row => row.item.id === seed.items.reject.id)?.item.reviewDecision?.action).toBe('REJECT');
    expect(view.tombstones).toHaveLength(1); expect(view.tombstones[0]).toMatchObject({itemId: seed.items.forget.id, deletionRevision: 3});
    expect(snapshot.accounts).toEqual([]); expect(snapshot.usage).toEqual({}); expect(snapshot.modelRequests).toEqual({});
    expect(snapshot.threads).toHaveLength(1); expect(snapshot.threads[0]).toMatchObject({id: seed.threadId, runId: null, modelId: null, accountId: null});
    const recordCounts = Object.fromEntries(['outbox', 'modelRequest', 'projectMemoryAuxiliaryUsage', 'projectMemoryRequestUsage', 'projectMemoryExtraction'].map(kind => [kind, store.all(kind).length]));
    for (const count of Object.values(recordCounts)) expect(count).toBe(0);
    return {iteration, step: 'post-exit-storage', samePhysicalProfile: true, available: view.available, enabled: view.enabled, accountCount: snapshot.accounts!.length, activeRunCount: snapshot.threads.filter(thread => thread.runId).length, usageOwners: Object.keys(snapshot.usage).length, recordCounts, providerNetworkCalls: null};
  } finally {store.close();}
}
