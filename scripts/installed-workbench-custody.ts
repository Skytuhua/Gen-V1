import {expect, type Page, type Request} from '@playwright/test';
import {createHash} from 'node:crypto';
import {lstat, mkdir, readFile, realpath} from 'node:fs/promises';
import {isAbsolute, join, resolve} from 'node:path';
import {Store} from '../packages/storage/store.ts';
import {registeredCapabilityFlags} from '../packages/core/capability-flags.ts';
import type {Message, Thread} from '../packages/contracts/index.ts';
import type {InstalledNativeOwner} from './installed-native-save.ts';

export const INSTALLED_WORKBENCH_CASE = Object.freeze({
  owner: {
    threadId: 'installed-workbench-owner', title: 'Installed custody owner',
    messageId: 'installed-workbench-owner-message',
    text: 'Installed custody owner evidence. The alpha fragment belongs to the ask action. The beta fragment belongs to the attach action. The owner message ends here.',
    askFragment: 'alpha fragment belongs to the ask action',
    attachFragment: 'beta fragment belongs to the attach action',
  },
  unrelated: {
    threadId: 'installed-workbench-unrelated', title: 'Installed unrelated task',
    messageId: 'installed-workbench-unrelated-message',
    text: 'Unrelated task evidence with a distinct gamma fragment for isolation.',
  },
  askText: 'Explain this selected source.',
  draftText: 'Installed custody draft retained only under the owning task.',
  detachedAppend: 'Detached window appended custody text.',
});
type DirectoryIdentity = {path: string; dev: string; ino: string};
export interface InstalledWorkbenchSeed {
  evidenceRoot: DirectoryIdentity; profile: DirectoryIdentity;
  owner: {threadId: string; messageId: string}; unrelated: {threadId: string; messageId: string};
}
export type InstalledWorkbenchObservation = Record<string, unknown>;
interface JournalRecordView {value?: unknown; generation?: string; updatedAt?: number}
interface SourceDraftView {
  draftId?: string; logicalOwner?: {threadId?: string; projectId?: string | null; workspaceId?: string | null};
  revision?: number; sourceRefs?: {captureId?: string; keepCaptured?: boolean}[]; sendMode?: string; conflictState?: string;
}
interface SourceCaptureView {
  id: string; threadId: string; label: string; ownerStamp: string; scopeDigest: string; selectedDigest: string;
  source: {kind: string; sourceId: string; logicalOwner: {threadId: string}; range?: {selectedTextDigest?: string}};
}

async function directoryIdentity(path: string): Promise<DirectoryIdentity> {
  if (!isAbsolute(path) || resolve(path) !== path) throw Error('The workbench fixture needs an absolute canonical evidence directory.');
  const info = await lstat(path, {bigint: true});
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path) throw Error('The workbench fixture directory must be ordinary and not redirected.');
  return {path, dev: String(info.dev), ino: String(info.ino)};
}
async function requireAbsent(path: string) {
  try {await lstat(path);} catch (error) {if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error;}
  throw Error('The exclusive installed-workbench profile already exists.');
}
function defaultFlags() {
  const flags = registeredCapabilityFlags();
  if (flags['ui.sourceWorkbenchV1'] || flags['memory.projectV1']) throw Error('Installed workbench verification requires production default-off flags in this process.');
}
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const sourceContextKey = (threadId: string) => `source-context:${encodeURIComponent(threadId)}::`;

/** Only a new disposable profile is seeded. Host flag activation is a separate installed-launch option. */
export async function seedInstalledWorkbenchProfile(directory: string): Promise<InstalledWorkbenchSeed> {
  defaultFlags();
  const evidenceRoot = await directoryIdentity(directory), profilePath = join(directory, 'host');
  await requireAbsent(profilePath); await mkdir(profilePath);
  const profile = await directoryIdentity(profilePath), stamp = new Date().toISOString();
  const store = new Store(profile.path);
  try {
    const fixture = INSTALLED_WORKBENCH_CASE;
    store.internal('installed.workbench.fixture', null, () => {
      for (const owner of [fixture.owner, fixture.unrelated]) {
        const thread: Thread = {id: owner.threadId, title: owner.title, projectName: null, createdAt: stamp, updatedAt: stamp, status: 'ready', epoch: 1, runId: null, modelId: null, accountId: null, sessionPath: null, kind: 'main'};
        store.put('thread', thread.id, thread.id, thread);
        store.put('message', owner.messageId, thread.id, {id: owner.messageId, threadId: thread.id, role: 'assistant', content: owner.text, createdAt: stamp, runId: null} satisfies Message);
      }
      return {fixture: 'installed-workbench-custody', threads: 2, assistantMessages: 2};
    });
    return {evidenceRoot, profile, owner: {threadId: fixture.owner.threadId, messageId: fixture.owner.messageId}, unrelated: {threadId: fixture.unrelated.threadId, messageId: fixture.unrelated.messageId}};
  } finally {store.close();}
}

export async function assertInstalledWorkbenchProfile(seed: InstalledWorkbenchSeed) {
  for (const expected of [seed.evidenceRoot, seed.profile]) {
    const actual = await directoryIdentity(expected.path);
    if (actual.dev !== expected.dev || actual.ino !== expected.ino) throw Error('The installed workbench profile identity changed.');
  }
}
async function screenshot(page: Page, directory: string, name: string) {
  const path = join(directory, name); await page.screenshot({path});
  const bytes = await readFile(path);
  return {file: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), viewport: await page.evaluate(() => ({width: innerWidth, height: innerHeight})), theme: await page.evaluate(() => document.documentElement.dataset.theme ?? document.body.dataset.theme ?? null)};
}

/** IndexedDB reads in the owned renderer. Values are returned, never source bodies. */
async function journalRecord(page: Page, key: string): Promise<JournalRecordView | undefined> {
  return page.evaluate(async key => {
    const db = await new Promise<IDBDatabase>((accept, reject) => {
      const request = indexedDB.open('generative-harness-journal', 1);
      request.onerror = () => reject(request.error); request.onsuccess = () => accept(request.result);
    });
    try {
      return await new Promise<JournalRecordView | undefined>((accept, reject) => {
        const read = db.transaction('entries').objectStore('entries').get(key);
        read.onsuccess = () => accept(read.result as JournalRecordView | undefined); read.onerror = () => reject(read.error);
      });
    } finally {db.close();}
  }, key);
}
async function journalKeyList(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((accept, reject) => {
      const request = indexedDB.open('generative-harness-journal', 1);
      request.onerror = () => reject(request.error); request.onsuccess = () => accept(request.result);
    });
    try {
      return await new Promise<string[]>((accept, reject) => {
        const read = db.transaction('entries').objectStore('entries').getAllKeys();
        read.onsuccess = () => accept(read.result.map(String)); read.onerror = () => reject(read.error);
      });
    } finally {db.close();}
  });
}

/** Draft text and source metadata stay under the owning task; the unrelated owner keeps no records. */
async function journalCustody(page: Page, expectedDraft: string, expectedRefs: number) {
  const fixture = INSTALLED_WORKBENCH_CASE;
  const [draft, source, pending, unrelatedDraft, unrelatedPending, keys] = await Promise.all([
    journalRecord(page, 'draft:' + fixture.owner.threadId), journalRecord(page, sourceContextKey(fixture.owner.threadId)),
    journalRecord(page, 'agents-pending:' + fixture.owner.threadId), journalRecord(page, 'draft:' + fixture.unrelated.threadId),
    journalRecord(page, 'agents-pending:' + fixture.unrelated.threadId), journalKeyList(page),
  ]);
  expect(draft?.value).toBe(expectedDraft);
  const metadata = source?.value as SourceDraftView | undefined;
  expect(metadata).toMatchObject({logicalOwner: {threadId: fixture.owner.threadId, projectId: null, workspaceId: null}, sendMode: 'AFTER_CURRENT', conflictState: 'NONE'});
  expect(metadata?.sourceRefs).toHaveLength(expectedRefs);
  const captureIds = (metadata?.sourceRefs ?? []).map(ref => ref.captureId ?? '');
  expect(captureIds.every(id => id.length > 0)).toBe(true);
  expect(new Set(captureIds).size).toBe(expectedRefs);
  expect(pending).toBeUndefined(); expect(unrelatedDraft).toBeUndefined(); expect(unrelatedPending).toBeUndefined();
  const owned = keys.filter(key => key.startsWith('source-context:') || key.startsWith('draft:') || key.startsWith('agents-pending:') || key.startsWith('workbench-conflict:'));
  expect(owned.sort()).toEqual(['draft:' + fixture.owner.threadId, sourceContextKey(fixture.owner.threadId)].sort());
  return {
    draftSha256: sha256(String(draft?.value)), refs: expectedRefs, captureIds, sendMode: metadata?.sendMode, conflictState: metadata?.conflictState,
    ownerJournalKeys: owned.sort(), pendingSend: false, conflictCopies: keys.filter(key => key.startsWith('workbench-conflict:')).length,
  };
}

/** Places a real DOM selection over a unique seeded fragment inside the message text owner. */
async function selectMessageFragment(page: Page, messageId: string, fragment: string) {
  const message = page.locator(`[data-message-id="${messageId}"]`);
  await message.scrollIntoViewIfNeeded();
  const marked = await page.evaluate(({messageId, fragment}) => {
    const root = document.querySelector(`[data-message-id="${messageId}"] .source-selection-text`);
    if (!(root instanceof HTMLElement)) return null;
    if (document.activeElement instanceof HTMLElement && !root.contains(document.activeElement)) document.activeElement.blur();
    const owner = root.ownerDocument, walker = owner.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = (node.textContent ?? '').indexOf(fragment);
      if (at < 0) continue;
      const range = owner.createRange(); range.setStart(node, at); range.setEnd(node, at + fragment.length);
      const selection = getSelection(); if (!selection) return null;
      selection.removeAllRanges(); selection.addRange(range);
      return selection.toString();
    }
    return null;
  }, {messageId, fragment});
  if (marked !== fragment) throw Error('The seeded message fragment could not be selected in the installed renderer.');
  const toolbar = page.getByRole('toolbar', {name: 'Selected source', exact: true});
  await expect(toolbar).toBeVisible({timeout: 30000});
  return toolbar;
}
const chips = (page: Page) => page.getByRole('article', {name: /^Selected source /});

/** Runs only after the caller verifies the installed executable, unique nonce and owned CDP session. */
export async function verifyInstalledWorkbenchUI(page: Page, seed: InstalledWorkbenchSeed, iteration: number, observations: InstalledWorkbenchObservation[], nativeOwner: InstalledNativeOwner) {
  await assertInstalledWorkbenchProfile(seed);
  const directory = seed.evidenceRoot.path, fixture = INSTALLED_WORKBENCH_CASE;
  const expectedDraft = fixture.draftText + ' ' + fixture.detachedAppend;
  const requests: string[] = [];
  const origin = new URL(page.url()).origin, browserContext = page.context();
  let captures = 0, sends = 0;
  const observeRequest = (request: Request) => {
    try {
      const url = new URL(request.url());
      if (url.origin !== origin || !url.pathname.startsWith('/api/')) return;
      let entry = request.method() + ' ' + url.pathname;
      if (url.pathname === '/api/commands' && request.method() === 'POST') {
        const type = (request.postDataJSON() as {type?: unknown} | null)?.type;
        if (typeof type === 'string') entry += ' ' + type.slice(0, 80);
      }
      if (entry === 'POST /api/workbench/sources/capture') captures++;
      if (entry === 'POST /api/commands message.send') sends++;
      if (requests.length < 200) requests.push(entry);
    } catch { /* Evidence capture is best-effort; assertions use durable records. */ }
  };
  browserContext.on('request', observeRequest);
  const message = page.getByRole('textbox', {name: 'Message', exact: true});
  const workbench = page.getByRole('region', {name: 'Prompt source context', exact: true});
  const ownerRow = page.getByRole('button', {name: fixture.owner.title + ' Ready', exact: true});
  const unrelatedRow = page.getByRole('button', {name: fixture.unrelated.title + ' Ready', exact: true});
  const detachedNotice = page.getByText('Conversation open in another window.');
  const ownedPages = () => {
    const browser = page.context().browser(); if (!browser) throw Error('The owned installed browser is unavailable.');
    return browser.contexts().flatMap(context => context.pages()).filter(candidate => {
      if (candidate === page || candidate.isClosed()) return false;
      try {const url = new URL(candidate.url()); return url.origin === origin && url.searchParams.has('desktopWindow');}
      catch {return false;}
    });
  };
  try {
    if (iteration === 1) {
      await ownerRow.click({timeout: 30000});
      await expect(workbench).toBeVisible({timeout: 30000});
      await expect(workbench).toContainText('Destination: ' + fixture.owner.title);
      observations.push({iteration, step: 'owner-workbench-enabled', destination: fixture.owner.title, chipCount: 0});
      // Case 5 part one: Ask captures and pre-fills a draft, but never submits.
      await (await selectMessageFragment(page, fixture.owner.messageId, fixture.owner.askFragment)).getByRole('button', {name: 'Ask about this', exact: true}).click();
      await expect(chips(page)).toHaveCount(1, {timeout: 30000});
      await expect(message).toHaveValue(fixture.askText);
      await expect.poll(async () => (await journalRecord(page, 'draft:' + fixture.owner.threadId))?.value).toBe(fixture.askText);
      expect(await journalRecord(page, 'agents-pending:' + fixture.owner.threadId)).toBeUndefined();
      expect(sends).toBe(0);
      observations.push({iteration, step: 'ask-captured-no-submit', captures, sends, pendingSend: false, askDraft: true});
      await message.fill(fixture.draftText);
      await expect.poll(async () => (await journalRecord(page, 'draft:' + fixture.owner.threadId))?.value).toBe(fixture.draftText);
      await (await selectMessageFragment(page, fixture.owner.messageId, fixture.owner.attachFragment)).getByRole('button', {name: 'Attach to prompt', exact: true}).click();
      await expect(chips(page)).toHaveCount(2, {timeout: 30000});
      await expect(message).toHaveValue(fixture.draftText);
      observations.push({iteration, step: 'second-source-attached', captures, sends, draftUnchanged: true});
      await page.getByRole('combobox', {name: 'Source delivery mode', exact: true}).click();
      await page.getByRole('option', {name: 'After current run', exact: true}).click();
      await expect.poll(async () => ((await journalRecord(page, sourceContextKey(fixture.owner.threadId)))?.value as SourceDraftView | undefined)?.sendMode).toBe('AFTER_CURRENT');
      await expect(page.getByRole('button', {name: 'Send message', exact: true})).toBeDisabled();
      observations.push({iteration, step: 'queued-delivery-durable', sendMode: 'AFTER_CURRENT', sends, sendDisabledWithoutModel: true,
        queuedDispatch: 'bounded-fixture-only: exact-once owner-bound dispatch after settle stays covered by the deterministic offline fixture; no model endpoint exists in this installed run.'});
      const beforeHandoff = await journalCustody(page, fixture.draftText, 2);
      // Case 2: switch to the unrelated task; the owner keeps draft and sources.
      await unrelatedRow.click();
      await expect(message).toHaveValue('');
      await expect(workbench).toBeVisible();
      await expect(workbench).toContainText('Destination: ' + fixture.unrelated.title);
      await expect(chips(page)).toHaveCount(0);
      expect(await journalRecord(page, 'draft:' + fixture.unrelated.threadId)).toBeUndefined();
      expect(await journalRecord(page, sourceContextKey(fixture.unrelated.threadId))).toBeUndefined();
      observations.push({iteration, step: 'unrelated-owner-untouched', unrelatedDraft: false, unrelatedSourceContext: false, unrelatedChips: 0});
      await ownerRow.click();
      await expect(message).toHaveValue(fixture.draftText);
      await expect(chips(page)).toHaveCount(2);
      // Case 3: the product native window handoff, then return through the bridge.
      await page.getByRole('button', {name: 'Options for ' + fixture.owner.title, exact: true}).click();
      await page.getByRole('menuitem', {name: 'Detach thread', exact: true}).click();
      await expect.poll(ownedPages, {timeout: 60000}).toHaveLength(1);
      const detached = ownedPages()[0]!;
      await expect.poll(() => detached.evaluate(() => window.harnessDesktop ? window.harnessDesktop.getContext() : null).catch(() => null), {timeout: 30000}).toMatchObject({surface: {kind: 'thread', threadId: fixture.owner.threadId}});
      const context = await detached.evaluate(() => window.harnessDesktop!.getContext());
      const detachedMessage = detached.getByRole('textbox', {name: 'Message', exact: true});
      await expect(detachedMessage).toBeEnabled({timeout: 30000});
      await expect(detachedMessage).toHaveValue(fixture.draftText);
      await expect(chips(detached)).toHaveCount(2, {timeout: 30000});
      await expect(detachedNotice).toBeVisible();
      observations.push({iteration, step: 'native-detach', windowId: (context as {windowId?: string}).windowId ?? null, owner: {pid: nativeOwner.pid, executable: nativeOwner.executable},
        detachedSurface: {kind: 'thread', threadId: fixture.owner.threadId}, mainHeldNotice: true, screenshot: await screenshot(detached, directory, 'installed-workbench-detached.png')});
      await detachedMessage.fill(expectedDraft);
      await expect.poll(async () => (await journalRecord(page, 'draft:' + fixture.owner.threadId))?.value).toBe(expectedDraft);
      await detached.evaluate(() => window.harnessDesktop!.reattach()).catch(() => {});
      await expect.poll(() => detached.isClosed(), {timeout: 30000}).toBe(true);
      await expect.poll(ownedPages, {timeout: 30000}).toHaveLength(0);
      await expect(detachedNotice).toHaveCount(0);
      await expect(message).toHaveValue(expectedDraft);
      await expect(chips(page)).toHaveCount(2);
      const custody = await journalCustody(page, expectedDraft, 2);
      expect(custody.captureIds).toEqual(beforeHandoff.captureIds);
      observations.push({iteration, step: 'native-reattach-custody', ...custody, sends, screenshot: await screenshot(page, directory, 'installed-workbench-reattached.png')});
    } else {
      // Case 4: same disposable profile, new installed process — the owner keeps
      // draft and source identity; the unrelated task stays untouched.
      await ownerRow.click({timeout: 30000});
      await expect(message).toHaveValue(expectedDraft);
      await expect(chips(page)).toHaveCount(2, {timeout: 30000});
      const select = page.getByRole('combobox', {name: 'Source delivery mode', exact: true});
      await expect(select).toContainText('After current run');
      const custody = await journalCustody(page, expectedDraft, 2);
      const beforeRestart = observations.find(entry => entry.step === 'native-reattach-custody');
      expect(custody.captureIds).toEqual(beforeRestart?.captureIds);
      observations.push({iteration, step: 'restart-owner-retained', ...custody});
      await unrelatedRow.click();
      await expect(message).toHaveValue('');
      await expect(chips(page)).toHaveCount(0);
      expect(await journalRecord(page, 'draft:' + fixture.unrelated.threadId)).toBeUndefined();
      expect(await journalRecord(page, sourceContextKey(fixture.unrelated.threadId))).toBeUndefined();
      observations.push({iteration, step: 'restart-unrelated-untouched', screenshot: await screenshot(page, directory, 'installed-workbench-restart.png')});
    }
    expect(sends).toBe(0);
  } catch (error) {
    observations.push({iteration, step: 'failed', error: error instanceof Error ? error.message.slice(0, 2000) : 'Installed workbench verification failed.', screenshot: await screenshot(page, directory, 'installed-workbench-launch-' + iteration + '-failure.png').catch(() => null)});
    throw error;
  } finally {
    browserContext.off('request', observeRequest);
    observations.push({iteration, step: 'request-observation', requests, captures, sends, providerNetworkCalls: null, providerNetworkMeasurement: 'Not measured. This proof performs no model-generation or sign-in actions.'});
  }
}

/** Call only after the owned native process exits cleanly and its backend health endpoint stops. */
export async function observeInstalledWorkbenchStorage(seed: InstalledWorkbenchSeed, iteration: number, observations?: readonly InstalledWorkbenchObservation[]) {
  await assertInstalledWorkbenchProfile(seed); defaultFlags();
  const fixture = INSTALLED_WORKBENCH_CASE, store = new Store(seed.profile.path);
  try {
    const captures = store.all<SourceCaptureView>('sourceCapture', fixture.owner.threadId);
    expect(captures).toHaveLength(2);
    const ownerReceipt = observations?.find(entry => entry.step === (iteration === 1 ? 'native-reattach-custody' : 'restart-owner-retained'));
    if (observations) {
      expect(ownerReceipt?.captureIds).toEqual(expect.arrayContaining(captures.map(capture => capture.id)));
    }
    for (const capture of captures) {
      expect(capture.threadId).toBe(fixture.owner.threadId);
      expect(capture.source.kind).toBe('MESSAGE');
      expect(capture.source.sourceId).toBe(fixture.owner.messageId);
      expect(capture.source.logicalOwner.threadId).toBe(fixture.owner.threadId);
    }
    const digests = [...new Set(captures.map(capture => capture.source.range?.selectedTextDigest))].sort();
    expect(digests).toEqual([fixture.owner.askFragment, fixture.owner.attachFragment].map(sha256).sort());
    expect(store.all('sourceCapture', fixture.unrelated.threadId)).toEqual([]);
    expect(store.all('outbox', fixture.owner.threadId)).toEqual([]);
    expect(store.all('outbox', fixture.unrelated.threadId)).toEqual([]);
    const ownerMessages = store.all<Message>('message', fixture.owner.threadId), unrelatedMessages = store.all<Message>('message', fixture.unrelated.threadId);
    expect(ownerMessages.filter(row => row.role === 'user')).toEqual([]);
    expect(ownerMessages.filter(row => row.role === 'assistant')).toHaveLength(1);
    expect(unrelatedMessages).toHaveLength(1);
    expect(store.all('sourceAccountAdmission')).toEqual([]);
    const snapshot = store.snapshot();
    expect(snapshot.threads).toHaveLength(2);
    expect(snapshot.threads).toEqual(expect.arrayContaining([
      expect.objectContaining({id: fixture.owner.threadId, status: 'ready', runId: null, modelId: null, accountId: null}),
      expect.objectContaining({id: fixture.unrelated.threadId, status: 'ready', runId: null, modelId: null, accountId: null}),
    ]));
    expect(snapshot.accounts).toEqual([]); expect(snapshot.usage).toEqual({}); expect(snapshot.modelRequests).toEqual({});
    return {iteration, step: 'post-exit-storage', samePhysicalProfile: true,
      captures: {owner: captures.length, unrelated: 0, selectedDigests: digests},
      outbox: {owner: 0, unrelated: 0}, userMessages: {owner: 0, unrelated: 0}, admissions: 0,
      threads: {owner: {status: 'ready', runId: null, modelId: null, accountId: null}, unrelated: {status: 'ready', runId: null, modelId: null, accountId: null}},
      accountCount: snapshot.accounts!.length, usageOwners: Object.keys(snapshot.usage!).length, modelRequestOwners: Object.keys(snapshot.modelRequests!).length,
      providerNetworkCalls: null};
  } finally {store.close();}
}
