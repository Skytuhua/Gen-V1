import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, platform, release, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import type { ArtifactRecord, DataBinding, DataRecord, SurfaceSpec } from '../../packages/contracts/index.ts';
import { browserCommand, FIXTURE_LABEL, HostFixture, openHost, sendFixture, test, expect } from '../host-fixture.ts';

const ROW_COUNT = 2000, COLUMN_COUNT = 6, EVENT_COUNT = 30;
const SENTINEL = '__snapshotPerformanceCell';
const label = process.env.SNAPSHOT_PERFORMANCE_LABEL;
const evidenceRoot = label ? resolve('docs/evidence/snapshot-performance-20261031', label) : null;
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
type Counters = { rowGeometryReads: number; objectCellFormats: number };
type Observation = { content: string; startedEpochMs: number; observedEpochMs: number; committedEventSeq: number; domObservedLatencyMs: number };
type BrowserProbe = {
  observation: Promise<number>;
  work: Counters;
  timing: { longTasks: { startTime: number; duration: number }[]; frameGaps: number[]; eventTiming: { name: string; duration: number; interactionId: number; processingStart: number; processingEnd: number }[]; supportedEntryTypes: string[]; recording: boolean };
};
const percentile = (values: number[], p = .95) => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1] : null;

function dataRows(count = ROW_COUNT, version = 'original') {
  return Array.from({ length: count }, (_, row) => Object.fromEntries([
    ['id', `row-${row}`],
    ...Array.from({ length: COLUMN_COUNT }, (_, column) => [`column${column}`, { [SENTINEL]: true, value: `${version} ${row}:${column}` }]),
  ]));
}
function tableSpec(): SurfaceSpec {
  return { root: 'root', elements: {
    root: { type: 'Stack', props: { gap: 'md' }, children: ['note', 'table'] },
    note: { type: 'Input', props: { stateKey: 'note', label: 'Performance review note' } },
    table: { type: 'Table', props: { rowsBinding: 'rows', stateKey: 'selection', rowKey: 'id', caption: 'Synthetic source records', columns: Array.from({ length: COLUMN_COUNT }, (_, column) => ({ key: `column${column}`, label: `Column ${column + 1}` })) } },
  } };
}
async function prepare(page: Page, host: HostFixture, count = ROW_COUNT) {
  await openHost(page); await sendFixture(page, 'document');
  const threadId = host.snapshot().threads[0]!.id;
  const data = host.service.publishData(threadId, { rows: dataRows(count) }, 'Synthetic performance fixture; immutable source id/revision; no live provider');
  const original = host.artifact('structured');
  const spec = tableSpec();
  expect(Buffer.byteLength(JSON.stringify(spec))).toBeLessThan(128 * 1024);
  expect(Buffer.byteLength(JSON.stringify(data.value))).toBeLessThan(8 * 1024 * 1024);
  await host.runtime.tool({ name: 'ui_present', args: { artifactId: original.id, baseRevision: original.revision, title: 'Synthetic snapshot performance', spec, initialState: { note: '', selection: [] }, bindings: { rows: { mode: 'live', id: data.id, pointer: '/rows' } } } });
  const artifact = host.artifact('structured');
  await expect(page.locator('.task-table tbody tr')).toHaveCount(count);
  await page.getByRole('checkbox', { name: 'Select row 1', exact: true }).check();
  await page.getByRole('textbox', { name: 'Performance review note', exact: true }).fill('Retain my review and selection across snapshots.');
  await expect.poll(() => host.snapshot().userStates.find(state => state.id === artifact.stateId)?.values.note).toBe('Retain my review and selection across snapshots.');
  await expect(page.locator(`[data-artifact-id="${artifact.id}"] .save-state`)).toHaveText('Saved');
  await page.getByLabel('Synthetic source records', { exact: true }).evaluate(node => { node.scrollTop = 900; });
  await settle(page);
  const scrollTop = await page.getByLabel('Synthetic source records', { exact: true }).evaluate(node => node.scrollTop);
  return { data, artifact, scrollTop };
}
// A scheduling barrier for completed effects only; this does not prove paint or presentation.
async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
async function observeEvent(page: Page, host: HostFixture, index: number, prefix: string): Promise<Observation> {
  const content = `${prefix} unrelated committed assistant event ${index}`;
  await page.evaluate(text => {
    (window as unknown as BrowserProbe).observation = new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Committed assistant event did not reach the DOM')); }, 15_000);
      const observer = new MutationObserver(() => {
        if (!document.body.textContent?.includes(text)) return;
        clearTimeout(timer); observer.disconnect(); resolve(performance.timeOrigin + performance.now());
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    });
  }, content);
  const startedEpochMs = Date.now();
  host.runtime.event('assistant.message', { messageId: `${prefix}-event-${index}`, content });
  const committedEventSeq = host.snapshot().seq;
  const observedEpochMs = await page.evaluate(() => (window as unknown as BrowserProbe).observation);
  await settle(page);
  return { content, startedEpochMs, observedEpochMs, committedEventSeq, domObservedLatencyMs: observedEpochMs - startedEpochMs };
}
async function installWorkCounters(page: Page) {
  await page.evaluate(sentinel => {
    const work = { rowGeometryReads: 0, objectCellFormats: 0 };
    (window as unknown as BrowserProbe).work = work;
    const geometry = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      if (this.matches('.task-table tbody tr')) work.rowGeometryReads++;
      return geometry.call(this);
    };
    const stringify = JSON.stringify;
    JSON.stringify = ((...args: Parameters<typeof JSON.stringify>) => {
      const value = args[0];
      if (value && typeof value === 'object' && Object.hasOwn(value, sentinel)) work.objectCellFormats++;
      return Reflect.apply(stringify, JSON, args);
    }) as typeof JSON.stringify;
  }, SENTINEL);
}
async function installTimingObservers(page: Page) {
  await page.evaluate(() => {
    const timing: BrowserProbe['timing'] = { longTasks: [], frameGaps: [], eventTiming: [], supportedEntryTypes: [...PerformanceObserver.supportedEntryTypes], recording: true };
    (window as unknown as BrowserProbe).timing = timing;
    if (timing.supportedEntryTypes.includes('longtask')) new PerformanceObserver(list => {
      for (const entry of list.getEntries()) if (timing.recording) timing.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
    }).observe({ type: 'longtask' });
    if (timing.supportedEntryTypes.includes('event')) new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        const event = entry as PerformanceEventTiming & { interactionId: number };
        if (timing.recording) timing.eventTiming.push({ name: event.name, duration: event.duration, interactionId: event.interactionId, processingStart: event.processingStart, processingEnd: event.processingEnd });
      }
    }).observe({ type: 'event', durationThreshold: 16 } as PerformanceObserverInit);
    let previous: number | undefined;
    const frame = (time: number) => { if (!timing.recording) return; if (previous !== undefined) timing.frameGaps.push(time - previous); previous = time; requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
  });
}
async function metadata(page: Page, artifact: ArtifactRecord, data: DataRecord) {
  const html = await readFile(resolve('dist/web/index.html'), 'utf8');
  const entryPath = html.match(/<script[^>]+src="([^"]+)"/)?.[1];
  if (!entryPath?.startsWith('/assets/')) throw new Error('Production HTML entry is unavailable');
  const files = ['tests/e2e/snapshot-performance.spec.ts', 'tests/e2e/snapshot-performance.playwright.config.ts', 'apps/web/src/TaskTable.tsx', 'apps/web/src/artifact-state.ts', 'apps/web/src/Artifact.tsx'];
  return {
    fixture: FIXTURE_LABEL, label,
    scope: 'Synthetic source-backed ContractRuntime + Service fixture over real HTTP/SSE, production dist/web; no interception, live provider, model inference, cold startup or hosted/native acceptance.',
    interpretation: 'DOM-observed latency ends at MutationObserver delivery, not actual paint/presentation. Frame gaps and longtasks are observations, not INP. Work counters are instrumented work proxies collected in a separate test.',
    hardware: { platform: platform(), release: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalMemoryBytes: totalmem() },
    runtime: { node: process.version, browser: page.context().browser()?.version(), viewport: page.viewportSize(), headless: true, cpuThrottleRate: 1, artificialNetworkThrottle: false, trace: 'retain-on-failure' },
    dataset: { rows: ROW_COUNT, displayedColumns: COLUMN_COUNT, objectCells: ROW_COUNT * COLUMN_COUNT, bytes: Buffer.byteLength(JSON.stringify(data.value)), sha256: sha(JSON.stringify(data.value)), sourceId: data.id, sourceRevision: data.revision },
    specification: { bytes: Buffer.byteLength(JSON.stringify(artifact.spec)), sha256: sha(JSON.stringify(artifact.spec)), artifactId: artifact.id, revision: artifact.revision },
    productionBuild: { htmlSha256: sha(html), entryPath, entrySha256: sha(await readFile(resolve('dist/web', entryPath.slice(1)))) },
    workingTreeSources: Object.fromEntries(await Promise.all(files.map(async file => [file, sha(await readFile(resolve(file)))]))),
  };
}
async function saveEvidence(info: TestInfo, name: string, value: unknown) {
  const body = JSON.stringify(value, null, 2);
  // Ordinary runs belong to Playwright's unique output directory. Publishing
  // dated evidence is explicit and must never overwrite an earlier recording.
  if (evidenceRoot) {
    await mkdir(evidenceRoot, { recursive: true });
    await writeFile(join(evidenceRoot, `${name}.json`), body, { flag: 'wx' });
  }
  await writeFile(info.outputPath(`${name}.json`), body);
  await info.attach(name, { body, contentType: 'application/json' });
}

test('profiles 30 unrelated committed events with an uninstrumented 2000 by 6 source table', async ({ page, host }, info) => {
  const fixture = await prepare(page, host);
  await installTimingObservers(page);
  const samples: Observation[] = [];
  for (let index = 0; index < EVENT_COUNT; index++) samples.push(await observeEvent(page, host, index, 'timing'));
  // Playwright generates trusted input. EventTiming may legitimately contain no >=16ms entries.
  const checkbox = page.getByRole('checkbox', { name: 'Select row 1', exact: true });
  const grid = page.getByLabel('Synthetic source records', { exact: true });
  await grid.evaluate(node => { node.scrollTop = 0; });
  for (const checked of [false, true, false, true]) {
    await checkbox.click();
    await expect(checkbox).toBeChecked({ checked });
  }
  await settle(page);
  const timing = await page.evaluate(() => { const timing = (window as unknown as BrowserProbe).timing; timing.recording = false; return timing; });
  const report = { ...await metadata(page, fixture.artifact, fixture.data), samples, timing, summaries: {
    domObservedLatencyP95Ms: percentile(samples.map(sample => sample.domObservedLatencyMs)),
    longTaskCount: timing.longTasks.length, longTaskTotalMs: timing.longTasks.reduce((sum, entry) => sum + entry.duration, 0), longestTaskMs: timing.longTasks.length ? Math.max(...timing.longTasks.map(entry => entry.duration)) : null,
    frameGapP95Ms: percentile(timing.frameGaps), maximumFrameGapMs: timing.frameGaps.length ? Math.max(...timing.frameGaps) : null,
    eventTimingSupported: timing.supportedEntryTypes.includes('event'), trustedInputEventTimingEntries: timing.eventTiming.length,
  } };
  await saveEvidence(info, 'uninstrumented-profile', report);
  expect(samples).toHaveLength(EVENT_COUNT);
  expect(host.snapshot().data.find(data => data.id === fixture.data.id)?.revision).toBe(1);
  await expect(checkbox).toBeChecked();
  await expect.poll(() => host.snapshot().userStates.find(state => state.id === fixture.artifact.stateId)?.values.selection).toEqual(['row-0']);
  await expect(page.getByRole('textbox', { name: 'Performance review note', exact: true })).toHaveValue('Retain my review and selection across snapshots.');
});

test('unrelated committed events and snapshot acknowledgements preserve source geometry work', async ({ page, host }, info) => {
  const fixture = await prepare(page, host);
  await installWorkCounters(page);
  const samples: Array<{ event: Observation; cumulativeWork: Counters }> = [];
  for (let index = 0; index < EVENT_COUNT; index++) {
    const event = await observeEvent(page, host, index, 'diagnostic');
    samples.push({ event, cumulativeWork: await page.evaluate(() => ({ ...(window as unknown as BrowserProbe).work })) });
  }
  const eventWork = await page.evaluate(() => ({ ...(window as unknown as BrowserProbe).work }));
  // A same-value settings command produces a real HTTP acknowledgement and SSE snapshot.
  const expectedAckSequence = host.snapshot().seq + 1;
  const acknowledgedSnapshot = page.waitForResponse(async response => response.url().endsWith('/api/snapshot') && response.status() === 200 && (await response.json()).seq >= expectedAckSequence);
  const receipt = await browserCommand(page, 'settings.update', { theme: host.snapshot().settings.theme });
  expect(receipt.status).toBe(200);
  const appliedAckSequence = (await (await acknowledgedSnapshot).json()).seq as number;
  expect(appliedAckSequence).toBeGreaterThanOrEqual((receipt.body as { eventSeq: number }).eventSeq);
  await settle(page);
  const totalWork = await page.evaluate(() => ({ ...(window as unknown as BrowserProbe).work }));
  const report = { ...await metadata(page, fixture.artifact, fixture.data), diagnosticOnly: true, workMeaning: 'getBoundingClientRect on table tbody tr and JSON.stringify whose first argument is a sentinel object cell; proxies for actual repeated source work, not paint or inference.', samples, eventWork, totalWork, acknowledgementReceipt: receipt.body, acknowledgedSnapshotSequence: appliedAckSequence };
  await saveEvidence(info, 'instrumented-work-regression', report);
  const grid = page.getByLabel('Synthetic source records', { exact: true });
  expect(await grid.evaluate(node => node.scrollTop)).toBe(fixture.scrollTop);
  await expect(page.getByRole('checkbox', { name: 'Select row 1', exact: true })).toBeChecked();
  await expect(page.getByRole('textbox', { name: 'Performance review note', exact: true })).toHaveValue('Retain my review and selection across snapshots.');
  expect(host.snapshot().artifacts.find(artifact => artifact.id === fixture.artifact.id)?.revision).toBe(fixture.artifact.revision);
  expect(host.snapshot().data.find(data => data.id === fixture.data.id)?.revision).toBe(1);
  // Deliberate deterministic RED before the production fix. No elapsed-time threshold.
  expect.soft(totalWork.rowGeometryReads, 'unchanged source revisions must not rescan every row geometry').toBe(0);
  expect.soft(totalWork.objectCellFormats, 'unchanged source revisions must not reformat every object cell').toBe(0);
});

test('live revision updates and snapshot bindings retain selection and draft values', async ({ page, host }, info) => {
  const fixture = await prepare(page, host, 4);
  const spec = tableSpec();
  spec.elements.root.children!.push('pinned');
  spec.elements.pinned = { type: 'Table', props: { ...spec.elements.table.props, rowsBinding: 'pinnedRows', stateKey: 'pinnedSelection', caption: 'Pinned source records' } };
  const bindings: Record<string, DataBinding> = { rows: { mode: 'live', id: fixture.data.id, pointer: '/rows' }, pinnedRows: { mode: 'snapshot', ref: { id: fixture.data.id, revision: 1, pointer: '/rows' } } };
  await host.runtime.tool({ name: 'ui_present', args: { artifactId: fixture.artifact.id, baseRevision: fixture.artifact.revision, spec, bindings } });
  await expect(page.getByLabel('Pinned source records', { exact: true }).locator('tbody tr')).toHaveCount(4);
  const pendingDraft = 'Keep this local draft when new source evidence arrives.';
  await page.getByRole('textbox', { name: 'Performance review note', exact: true }).fill(pendingDraft);
  const next: DataRecord = { ...fixture.data, revision: 2, value: { rows: dataRows(4, 'accepted revision two') }, createdAt: new Date().toISOString() };
  // Explicit synthetic producer commit. Service.publishData has no same-id revision API;
  // retain production Store history and deliver its real data.published SSE event.
  host.store.internal('data.published', next.threadId, () => {
    host.store.put('data', next.id, next.threadId, next);
    host.store.put('dataVersion', `${next.id}@2`, next.threadId, next);
    return { id: next.id, revision: 2, synthetic: true };
  });
  const live = page.getByLabel('Synthetic source records', { exact: true }), pinned = page.getByLabel('Pinned source records', { exact: true });
  await expect(live.locator('tbody tr').first()).toContainText('accepted revision two 0:0');
  await expect(pinned.locator('tbody tr').first()).toContainText('original 0:0');
  await expect(live.getByRole('checkbox', { name: 'Select row 1', exact: true })).toBeChecked();
  await expect(page.getByRole('textbox', { name: 'Performance review note', exact: true })).toHaveValue(pendingDraft);
  await expect.poll(() => host.snapshot().userStates.find(state => state.id === fixture.artifact.stateId)?.values.note).toBe(pendingDraft);
  await expect(page.locator(`[data-artifact-id="${fixture.artifact.id}"] .save-state`)).toHaveText('Saved');
  const current = host.artifact('structured');
  await host.runtime.tool({ name: 'ui_present', args: { artifactId: current.id, baseRevision: current.revision, spec, bindings: { ...bindings, pinnedRows: { mode: 'snapshot', ref: { id: fixture.data.id, revision: 2, pointer: '/rows' } } } } });
  await expect(pinned.locator('tbody tr').first()).toContainText('accepted revision two 0:0');
  await saveEvidence(info, 'positive-source-revisions', { fixture: FIXTURE_LABEL, sourceId: next.id, revisions: [1, 2], actualHTTPAndSSE: true, syntheticRevisionProducer: 'Store.internal data.published; no same-id Service.publishData API', verified: ['live revision 2 visible', 'snapshot revision 1 retained', 'snapshot retargeted to revision 2', 'selection retained', 'pending local draft retained and subsequently autosaved'] });
});

test('trusted row selection and following changes retain formatted source cells', async ({ page, host }, info) => {
  const fixture = await prepare(page, host, 200);
  const changes = host.service.publishData(fixture.artifact.threadId, { rows: [] }, 'Synthetic empty table change metadata; no operation or inference');
  const spec = tableSpec();
  spec.elements.table.props.changesBinding = 'changes';
  await host.runtime.tool({ name: 'ui_present', args: {
    artifactId: fixture.artifact.id, baseRevision: fixture.artifact.revision, spec,
    bindings: { rows: { mode: 'live', id: fixture.data.id, pointer: '/rows' }, changes: { mode: 'live', id: changes.id } },
  } });
  const grid = page.getByLabel('Synthetic source records', { exact: true });
  // Inline tables use the conversation scroller. Following controls belong to
  // the bounded expanded table, where selection can take over its own scroll.
  await expect(page.getByRole('button', { name: 'Resume following changes', exact: true })).toHaveCount(0);
  await page.locator(`[data-artifact-id="${fixture.artifact.id}"]`).getByRole('button', { name: 'Expand artifact', exact: true }).click();
  await grid.press('Home');
  await expect(grid).toHaveAttribute('data-following', 'false');
  await page.getByRole('button', { name: 'Resume following changes', exact: true }).click();
  await expect(grid).toHaveAttribute('data-following', 'true');
  await settle(page);
  await grid.locator('tbody tr').first().evaluate(row => { (window as unknown as { snapshotSelectionRow: Element }).snapshotSelectionRow = row; });
  await installWorkCounters(page);
  await settle(page);
  // Keep this reset separate from setup/source effects and from subsequent reload work.
  await page.evaluate(() => Object.assign((window as unknown as BrowserProbe).work, { rowGeometryReads: 0, objectCellFormats: 0 }));
  await grid.getByRole('checkbox', { name: 'Select row 2', exact: true }).click();
  await expect(grid.getByRole('checkbox', { name: 'Select row 2', exact: true })).toBeChecked();
  await expect(grid).toHaveAttribute('data-following', 'false');
  await expect.poll(() => host.snapshot().userStates.find(state => state.id === fixture.artifact.stateId)?.values.selection).toEqual(['row-0', 'row-1']);
  await expect(page.locator(`[data-artifact-id="${fixture.artifact.id}"] .save-state`)).toHaveText('Saved');
  await settle(page);
  const retainedRow = await grid.locator('tbody tr').first().evaluate(row => row === (window as unknown as { snapshotSelectionRow: Element }).snapshotSelectionRow);
  const work = await page.evaluate(() => ({ ...(window as unknown as BrowserProbe).work }));
  const sourceRevision = host.snapshot().data.find(data => data.id === fixture.data.id)?.revision;
  await page.reload();
  await expect(page.getByLabel('Synthetic source records', { exact: true }).getByRole('checkbox', { name: 'Select row 1', exact: true })).toBeChecked();
  await expect(page.getByLabel('Synthetic source records', { exact: true }).getByRole('checkbox', { name: 'Select row 2', exact: true })).toBeChecked();
  await saveEvidence(info, 'selection-work-regression', {
    fixture: FIXTURE_LABEL, label, rows: 200, displayedColumns: COLUMN_COUNT, objectCells: 200 * COLUMN_COUNT,
    scope: 'Trusted checkbox selection and local following change, followed by real host autosave acknowledgement; counters exclude source setup and reload.',
    sourceId: fixture.data.id, sourceRevision, retainedRow, work,
    verified: ['trusted selection checked', 'following taken over', 'selection autosaved', 'both selected rows durable after reload'],
  });
  expect(retainedRow, 'local selection must preserve existing tbody row DOM').toBe(true);
  expect(sourceRevision).toBe(1);
  expect.soft(work.rowGeometryReads, 'local selection and following must not rebuild source row geometry').toBe(0);
  expect.soft(work.objectCellFormats, 'local selection and following must not reformat unchanged object cells').toBe(0);
});
