import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { chromium, expect as pw, type Browser, type Page } from '@playwright/test';
import { expectArtifactGeometry, holdArtifactJournal, releaseArtifactJournal } from './e2e/artifact-settle-host';

// R13/AUD-10: a deliberate disclosure collapse must shrink the whole container
// (artifact height, following conversation position) while restoration and the
// entrance keep their separate stability guarantees.

const fixture = `
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Artifact } from './apps/web/src/Artifact';
import { taskFixture, type TaskSpec } from './tests/e2e/task-interface-fixture';
import './apps/web/src/styles.css';

const params = new URLSearchParams(location.search);
const variant = params.get('variant') ?? 'plain';
const hostOpen = params.get('hostOpen') === 'true';
const rows = Math.max(0, Number(params.get('rows') ?? 6));
const note = 'Keep this saved note';
const row = (index: number) => ({ name: 'Record ' + (index + 1), detail: 'Synthetic source material for the new working object.' });
const longAnswer = 'The delivery can be split per destination before the first pickup is scanned. Each destination receives its own confirmed window and the split stays reversible until pickup. Splitting keeps the original deadline for the unsplit remainder of the order.';
const childAnswer = 'Yes, choose a different date for each destination before confirming.';

function spec(): TaskSpec {
  const table = { type: 'Table', props: { rowsBinding: 'rows', caption: 'Source records', columns: [{ key: 'name', label: 'Name' }, { key: 'detail', label: 'Detail' }] } };
  if (variant === 'disclosure') return { root: 'body', elements: {
    body: { type: 'Stack', props: { gap: 'sm' }, children: ['note', 'details'] },
    note: { type: 'Input', props: { stateKey: 'note', label: 'Artifact note' } },
    details: { type: 'Disclosure', props: { title: 'Recovered details', stateKey: 'open' }, children: ['records'] },
    records: table,
  } };
  if (variant === 'nested') return { root: 'body', elements: {
    body: { type: 'Stack', props: { gap: 'sm' }, children: ['note', 'parent', 'sibling'] },
    note: { type: 'Input', props: { stateKey: 'note', label: 'Artifact note' } },
    parent: { type: 'Disclosure', props: { title: 'Parent question', stateKey: 'open', text: longAnswer }, children: ['innerNote', 'child', 'records'] },
    innerNote: { type: 'Input', props: { stateKey: 'innerNote', label: 'Destination note' } },
    child: { type: 'Disclosure', props: { title: 'Child question', stateKey: 'childOpen', text: childAnswer } },
    records: table,
    sibling: { type: 'Markdown', props: { text: 'Sibling evidence paragraph tracks the collapsed extent.' } },
  } };
  if (variant === 'steps') return { root: 'body', elements: {
    body: { type: 'Stack', props: { gap: 'sm' }, children: ['note', 'details'] },
    note: { type: 'Input', props: { stateKey: 'note', label: 'Artifact note' } },
    details: { type: 'Disclosure', props: { title: 'Recovered details', stateKey: 'open' }, children: ['steps'] },
    steps: { type: 'Steps', props: { stateKey: 'stepChoice', steps: [{ key: 'details', label: 'Details' }, { key: 'confirm', label: 'Confirm' }], defaultStep: 'details' }, children: ['detailNote', 'confirmNote'] },
    detailNote: { type: 'Input', props: { stateKey: 'detailNote', label: 'Detail note' } },
    confirmNote: { type: 'Input', props: { stateKey: 'confirmNote', label: 'Confirm note' } },
  } };
  if (variant === 'tiny') return { root: 'body', elements: {
    body: { type: 'Stack', props: { gap: 'sm' }, children: ['details'] },
    details: { type: 'Disclosure', props: { title: 'Recovered details', stateKey: 'open', text: longAnswer } },
  } };
  if (variant === 'request') return { root: 'body', elements: {
    body: { type: 'Stack', props: { gap: 'sm' }, children: ['note', 'followup'] },
    note: { type: 'Input', props: { stateKey: 'note', label: 'Artifact note' } },
    followup: { type: 'Disclosure', props: { title: 'Prepared question', defaultOpen: true, onOpenActionId: 'ask', payloadFromState: { note: 'note' } } },
  } };
  return { root: 'body', elements: {
    body: { type: 'Stack', props: { gap: 'sm' }, children: ['note', 'records'] },
    note: { type: 'Input', props: { stateKey: 'note', label: 'Artifact note' } },
    records: table,
  } };
}

const source = taskFixture(spec(), { rows: Array.from({ length: rows }, (_, index) => row(index)) }, { note });

function Fixture() {
  const restored = params.has('restored');
  const [snapshot, setSnapshot] = useState(() => structuredClone(source));
  const [visible, setVisible] = useState(restored), [fresh, setFresh] = useState(false), [generation, setGeneration] = useState(0);
  return <main style={{ maxWidth: 1040, margin: '0 auto', padding: 24 }}>
    <nav aria-label="Fixture controls">
      <button onClick={() => { setFresh(true); setVisible(true); }}>Publish artifact</button>
      <button onClick={() => setSnapshot(value => ({ ...value, seq: value.seq + 1, artifacts: value.artifacts.map(artifact => ({ ...artifact, revision: artifact.revision + 1 })), data: value.data.map(entry => entry.id === 'input-rows' ? { ...entry, revision: entry.revision + 1, value: [...(entry.value as unknown[]), row((entry.value as unknown[]).length), row((entry.value as unknown[]).length + 1)] } : entry) }))}>Publish snapshot</button>
      <button onClick={() => { setFresh(false); setGeneration(value => value + 1); setVisible(true); }}>Restore artifact</button>
      <button onClick={() => setVisible(false)}>Unmount artifact</button>
    </nav>
    <input aria-label="Conversation draft" defaultValue="Keep my conversation draft" />
    {visible && <Artifact key={generation} artifact={snapshot.artifacts[0]} snapshot={snapshot} theme="dark" animateEntry={fresh} refresh={async next => { if (next) setSnapshot(next); }} />}
    <p data-after-artifact>Conversation continues after the working object.</p>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
`;

type EntranceRecord = { target: string; journalHeld: boolean; artifactPending: boolean; duration: number; frames: Array<{ opacity?: string; transform?: string }>; height: number; afterTop?: number };
type Paint = { height: number | null; afterTop: number; pending: boolean; restoring: boolean; statusVisible: boolean; artifactVisible: boolean };
type ProbeWindow = Window & { artifactEntrances: EntranceRecord[]; artifactAnimations: Animation[]; artifactPaints: Paint[]; artifactJournalPending?: boolean };
type Geometry = { height: number; afterTop: number; branchOuter: number | null; branchInner: number | null; answerInner: number | null };

// Each page starts with an empty local journal so tests cannot leak state; sessionStorage
// marks the first document so a reload (journal-recovery test) keeps what it saved.
const resetJournal = `if (!sessionStorage.getItem('journal-reset-done')) { indexedDB.deleteDatabase('generative-harness-journal'); sessionStorage.setItem('journal-reset-done', '1'); }`;
const probes = `
  (window.artifactEntrances = [], window.artifactAnimations = [], window.artifactPaints = []);
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (frames, options) {
    const animation = animate.call(this, frames, options);
    if (this.matches('.artifact,.artifact > .artifact-body')) {
      animation.pause();
      const effect = this.getAnimations().find(item => item === animation).effect;
      const shell = this.closest('.artifact');
      window.artifactEntrances.push({ target: this.className, journalHeld: window.artifactJournalPending === true, artifactPending: shell.getAttribute('data-artifact-pending') === 'true', duration: Number(effect.getTiming().duration), frames: effect.getKeyframes().map(frame => ({ opacity: frame.opacity, transform: frame.transform })), height: shell.getBoundingClientRect().height, afterTop: document.querySelector('[data-after-artifact]')?.getBoundingClientRect().top });
      window.artifactAnimations.push(animation);
    }
    return animation;
  };
  const sample = () => {
    const reservation = document.querySelector('.artifact'), following = document.querySelector('[data-after-artifact]'), status = document.querySelector('.artifact-restoring [role="status"]');
    if (following) window.artifactPaints.push({ height: reservation && reservation.getClientRects().length ? reservation.getBoundingClientRect().height : null, afterTop: following.getBoundingClientRect().top, pending: window.artifactJournalPending === true, restoring: reservation?.getAttribute('data-artifact-pending') === 'true', statusVisible: Boolean(status?.getClientRects().length && getComputedStyle(status).visibility !== 'hidden'), artifactVisible: Boolean(reservation && getComputedStyle(reservation).visibility !== 'hidden') });
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
`;

const entranceCount = (page: Page) => page.evaluate(() => (window as unknown as ProbeWindow).artifactEntrances.length);
const paints = (page: Page) => page.evaluate(() => (window as unknown as ProbeWindow).artifactPaints);
const siblingTop = (page: Page) => page.evaluate(() => document.querySelector('.artifact .surface-layout > :last-child')!.getBoundingClientRect().top);

async function geometry(page: Page): Promise<Geometry> {
  return page.evaluate(() => {
    const branch = document.querySelector('.disclosure-branch-region');
    const answer = document.querySelector('.disclosure .task-motion-region');
    return {
      height: document.querySelector('.artifact')?.getBoundingClientRect().height ?? 0,
      afterTop: document.querySelector('[data-after-artifact]')!.getBoundingClientRect().top,
      branchOuter: branch?.getBoundingClientRect().height ?? null,
      branchInner: branch?.querySelector('.task-motion-inner')?.getBoundingClientRect().height ?? null,
      answerInner: answer?.querySelector('.task-motion-inner')?.getBoundingClientRect().height ?? null,
    };
  });
}

async function settleBranch(page: Page, open: boolean) {
  // `open` must be an evaluate argument: closure variables are not serialized
  // into the page, where a bare `open` would resolve to window.open (truthy).
  // Settle the disclosure's own answer AND branch regions: the answer spring
  // (280ms) outlives the branch spring (220ms), so waiting on one races.
  await expect.poll(async () => page.locator('.disclosure-node').first().evaluate((node, open) => {
    const regions = [node.querySelector('.disclosure > .task-motion-region'), node.querySelector(':scope > .disclosure-branch-region')].filter(Boolean) as HTMLElement[];
    const stuck: string[] = [];
    for (const region of regions) {
      const height = region.getBoundingClientRect().height, inner = region.querySelector('.task-motion-inner')!.getBoundingClientRect().height;
      const ok = open ? Math.abs(height - inner) < .1 && region.dataset.motionPhase === 'open' : height < .1 && region.dataset.motionPhase === 'closed';
      if (!ok) stuck.push(`h=${height.toFixed(1)} inner=${inner.toFixed(1)} phase=${region.dataset.motionPhase ?? 'null'} open=${region.dataset.open ?? 'null'}`);
    }
    return stuck.length ? `stuck:${stuck.join('|')}` : 'ok';
  }, open), { timeout: 10_000 }).toBe('ok');
}

async function finishEntrance(page: Page) {
  await expect.poll(() => entranceCount(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
  await page.evaluate(() => (window as unknown as ProbeWindow).artifactAnimations.at(-1)!.finish());
  await pw(page.locator('.artifact')).toHaveAttribute('data-entry-phase', 'settled');
}

const restoringStatus = (page: Page) => pw(page.locator('.artifact-restoring').getByRole('status', { includeHidden: true })).toHaveText('Restoring Task surface…');

async function publish(page: Page, options: { journalHeld?: boolean; note?: boolean } = {}) {
  await page.getByRole('button', { name: 'Publish artifact', exact: true }).click();
  // Without a held journal the restore completes before the first paint, so the status may never be observable.
  if (options.journalHeld) { await restoringStatus(page); await releaseArtifactJournal(page); }
  if (options.note !== false) await pw(page.getByRole('textbox', { name: 'Artifact note', exact: true })).toHaveValue('Keep this saved note');
  await finishEntrance(page);
}

async function openPage(browser: Browser, query: string, options: { hold?: Parameters<typeof holdArtifactJournal>[1] } = {}): Promise<Page> {
  const page = await browser.newPage();
  await page.addInitScript(resetJournal);
  if (options.hold) await holdArtifactJournal(page, options.hold);
  await page.addInitScript(probes);
  await page.route('**/api/**', route => route.fulfill({ status: 404 }));
  await page.setViewportSize({ width: 1024, height: 1000 });
  await page.goto(`${base}/${query}`);
  await pw(page.getByRole('button', { name: 'Publish artifact', exact: true })).toBeVisible();
  return page;
}

async function collapse(page: Page, name = 'Recovered details') {
  await page.getByRole('button', { name, exact: true }).click();
  await settleBranch(page, false);
}

let browser: Browser, server: Server, base: string;

describe('artifact settle and deliberate collapse', () => {
  beforeAll(async () => {
    const script = (await build({ stdin: { contents: fixture, resolveDir: process.cwd(), loader: 'tsx' }, loader: { '.css': 'empty' }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } })).outputFiles[0]!.text;
    const cssFiles = ['packages/ui-shell/tokens.css', 'apps/web/src/styles.css', 'apps/web/src/task-motion.css', 'apps/web/src/task-interface.css', 'apps/web/src/task-table.css', 'apps/web/src/loading-state.css', 'apps/web/src/markdown.css', 'apps/web/src/sentence-reveal.css', 'apps/web/src/frontend-fidelity.css'];
    const css = (await Promise.all(cssFiles.map(file => readFile(file, 'utf8')))).join('\n');
    server = createServer((_request, response) => { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(`<style>${css}</style><div id="root"></div><script>${script}</script>`); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  }, 120_000);
  afterAll(async () => { await browser?.close(); server?.close(); });

  it('deliberate collapse shrinks the whole artifact and lifts following content, reopen restores the saved input', async () => {
    const page = await openPage(browser, '?variant=disclosure&hostOpen=true', { hold: { note: 'Keep this saved note', open: true } });
    await publish(page, { journalHeld: true });
    await settleBranch(page, true);
    const expanded = await geometry(page);
    const hidden = (expanded.branchInner ?? 0) + (expanded.answerInner ?? 0);
    expect(hidden, 'the fixture hides a substantial answer').toBeGreaterThan(40);
    const noteHandle = await page.getByRole('textbox', { name: 'Artifact note', exact: true }).elementHandle();
    await collapse(page);
    const collapsed = await geometry(page);
    const shrink = expanded.height - collapsed.height;
    expect(shrink, 'artifact height decreases by at least the hidden answer height (2px rounding)').toBeGreaterThanOrEqual(hidden - 2);
    expect(expanded.afterTop - collapsed.afterTop, 'following content moves upward').toBeGreaterThanOrEqual(hidden - 2);
    expect(Math.abs(shrink - (expanded.afterTop - collapsed.afterTop)), 'no blank retained slot: movement matches shrinkage').toBeLessThanOrEqual(2);
    const branch = page.locator('.disclosure-branch-region').first();
    await pw(branch).toHaveAttribute('aria-hidden', 'true');
    await pw(branch).toHaveAttribute('inert', '');
    await page.getByRole('button', { name: 'Recovered details', exact: true }).click();
    await settleBranch(page, true);
    const reopened = await geometry(page);
    expect(Math.abs(reopened.height - expanded.height)).toBeLessThanOrEqual(2);
    expect(Math.abs(reopened.afterTop - expanded.afterTop)).toBeLessThanOrEqual(2);
    expect(await page.evaluate(([node, handle]) => node === handle, [await page.getByRole('textbox', { name: 'Artifact note', exact: true }).elementHandle(), noteHandle]), 'the saved input keeps its DOM node').toBe(true);
    await pw(page.getByRole('textbox', { name: 'Artifact note', exact: true })).toHaveValue('Keep this saved note');
    await page.close();
  });

  it('restoration reserves final layout while held and keeps following content fixed (split stability invariant)', async () => {
    const page = await openPage(browser, '?variant=plain&rows=6', { hold: { note: 'Keep this saved note' } });
    await page.getByRole('button', { name: 'Publish artifact', exact: true }).click();
    await restoringStatus(page);
    expect((await paints(page)).some(paint => paint.pending && !paint.artifactVisible), 'the held read samples a hidden artifact reservation').toBe(true);
    await releaseArtifactJournal(page);
    await pw(page.getByRole('textbox', { name: 'Artifact note', exact: true })).toHaveValue('Keep this saved note');
    await finishEntrance(page);
    const result = await expectArtifactGeometry(page);
    expect(result.paints.some(paint => paint.restoring && paint.height !== null), 'restoration reservation is sampled from the first pending paint').toBe(true);
    await page.close();
  });

  it('journal restoration gates the entrance: nothing plays while held, one body reveal after release', async () => {
    const page = await openPage(browser, '?variant=plain', { hold: { note: 'Keep this saved note' } });
    await page.getByRole('button', { name: 'Publish artifact', exact: true }).click();
    await restoringStatus(page);
    expect((await paints(page)).some(paint => paint.pending), 'the journal hold was active during restoration').toBe(true);
    const premature = (await page.evaluate(() => (window as unknown as ProbeWindow).artifactEntrances)).filter(entry => entry.artifactPending || entry.journalHeld);
    expect(premature, 'no entrance animation plays while the artifact is pending').toEqual([]);
    await releaseArtifactJournal(page);
    await pw(page.getByRole('textbox', { name: 'Artifact note', exact: true })).toHaveValue('Keep this saved note');
    await expect.poll(() => entranceCount(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
    const entrances = await page.evaluate(() => (window as unknown as ProbeWindow).artifactEntrances);
    expect(entrances, 'exactly one entrance plays once the artifact is ready').toHaveLength(1);
    expect(entrances[0].target).toBe('artifact-body');
    expect(entrances[0].artifactPending).toBe(false);
    expect(entrances[0].duration).toBe(220);
    expect(entrances[0].frames).toEqual([{ opacity: '0', transform: 'translateY(4px)' }, { opacity: '1', transform: 'translateY(0px)' }]);
    await finishEntrance(page);
    await page.close();
  });

  it('one body entrance keeps outer geometry stable and cleans up when publication is interrupted', async () => {
    const page = await openPage(browser, '?variant=plain&rows=6');
    await publish(page);
    const entrances = await page.evaluate(() => (window as unknown as ProbeWindow).artifactEntrances);
    expect(entrances).toHaveLength(1);
    expect(entrances[0].target).toBe('artifact-body');
    const entry = entrances[0];
    expect(entry.height).toBeGreaterThan(250);
    const samples = await page.locator('.artifact').evaluate(async node => {
      const animation = (window as unknown as ProbeWindow).artifactAnimations[0], duration = Number(animation.effect!.getTiming().duration);
      // Pause before seeking: seeking a finished animation implicitly resumes
      // it with a pending play task that a later pause() cannot stop.
      animation.pause();
      const samples = [];
      for (const progress of [0, .25, .5, .75, .99]) {
        animation.currentTime = duration * progress;
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        const body = node.querySelector('.artifact-body')!, style = getComputedStyle(body), shell = getComputedStyle(node);
        samples.push({ height: node.getBoundingClientRect().height, afterTop: document.querySelector('[data-after-artifact]')!.getBoundingClientRect().top, opacity: Number(style.opacity), translateY: new DOMMatrix(style.transform).m42, shellOpacity: shell.opacity, heightStyle: (node as HTMLElement).style.height, overflowStyle: (node as HTMLElement).style.overflow });
      }
      return samples;
    });
    for (const sample of samples) {
      expect(sample.height, 'outer artifact height is final from the first entrance frame').toBeCloseTo(entry.height, 4);
      expect(sample.afterTop, 'following conversation position is final from the first entrance frame').toBeCloseTo(entry.afterTop!, 4);
      expect(sample).toMatchObject({ shellOpacity: '1', heightStyle: '', overflowStyle: '' });
    }
    expect(samples[0]).toMatchObject({ opacity: 0, translateY: 4 });
    expect(samples.at(-1)!.translateY).toBeCloseTo(0, 2);
    await page.getByRole('button', { name: 'Unmount artifact', exact: true }).click();
    await pw(page.locator('.artifact')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as ProbeWindow).artifactAnimations[0].playState)).toBe('idle');
    await page.getByRole('button', { name: 'Restore artifact', exact: true }).click();
    await pw(page.getByRole('textbox', { name: 'Artifact note', exact: true })).toHaveValue('Keep this saved note');
    expect(await entranceCount(page)).toBe(1);
    await page.close();
  });

  it('nested disclosures, sibling evidence and focus safety shrink without blank slots', async () => {
    const page = await openPage(browser, '?variant=nested&hostOpen=true', { hold: { note: 'Keep this saved note', open: true, childOpen: true, innerNote: 'Keep this saved note' } });
    await publish(page, { journalHeld: true });
    await settleBranch(page, true);
    const innerNote = page.getByRole('textbox', { name: 'Destination note', exact: true });
    const handle = await innerNote.elementHandle();
    await innerNote.focus();
    const expanded = await geometry(page);
    const expandedSibling = await siblingTop(page);
    const hidden = (expanded.branchInner ?? 0) + (expanded.answerInner ?? 0);
    expect(hidden, 'the nested subtree hides a substantial extent').toBeGreaterThan(100);
    await collapse(page, 'Parent question');
    const collapsed = await geometry(page);
    const shrink = expanded.height - collapsed.height;
    expect(shrink, 'parent collapse shrinks by the whole hidden subtree').toBeGreaterThanOrEqual(hidden - 2);
    expect(Math.abs(shrink - (expanded.afterTop - collapsed.afterTop)), 'no blank slot after nested collapse').toBeLessThanOrEqual(2);
    expect(Math.abs(expandedSibling - await siblingTop(page) - shrink), 'sibling evidence moves with the collapsed extent').toBeLessThanOrEqual(2);
    // The collapse click legitimately focuses the trigger; focus safety means
    // it never remains inside the now-inert region.
    expect(await page.evaluate(() => ({ active: document.activeElement?.className ?? null, inert: Boolean(document.activeElement?.closest('[inert]')) }))).toEqual({ active: 'disclosure-trigger', inert: false });
    const parentBranch = page.locator('.disclosure-branch-region').first();
    await pw(parentBranch).toHaveAttribute('inert', '');
    await page.getByRole('button', { name: 'Parent question', exact: true }).click();
    await settleBranch(page, true);
    expect(await page.getByRole('button', { name: 'Child question', exact: true }).getAttribute('aria-expanded')).toBe('true');
    expect(await page.evaluate(([node, handle]) => node === handle, [await innerNote.elementHandle(), handle]), 'the nested input keeps its DOM node').toBe(true);
    await pw(innerNote).toHaveValue('Keep this saved note');
    await page.close();
  });

  it('a Steps panel inside a disclosure collapses and restores its saved step input', async () => {
    const page = await openPage(browser, '?variant=steps&hostOpen=true', { hold: { note: 'Keep this saved note', open: true, detailNote: 'Saved step draft' } });
    await publish(page, { journalHeld: true });
    await settleBranch(page, true);
    const stepInput = page.locator('.artifact .task-step-content > [role="group"]:not([hidden])').getByRole('textbox', { name: 'Detail note', exact: true });
    await pw(stepInput).toHaveValue('Saved step draft');
    const handle = await stepInput.elementHandle();
    const expanded = await geometry(page);
    const hidden = (expanded.branchInner ?? 0) + (expanded.answerInner ?? 0);
    expect(hidden).toBeGreaterThan(20);
    await collapse(page);
    const collapsed = await geometry(page);
    expect(expanded.height - collapsed.height).toBeGreaterThanOrEqual(hidden - 2);
    expect(Math.abs((expanded.height - collapsed.height) - (expanded.afterTop - collapsed.afterTop))).toBeLessThanOrEqual(2);
    await page.getByRole('button', { name: 'Recovered details', exact: true }).click();
    await settleBranch(page, true);
    expect(await page.evaluate(([node, handle]) => node === handle, [await stepInput.elementHandle(), handle]), 'the step input keeps its DOM node').toBe(true);
    await pw(stepInput).toHaveValue('Saved step draft');
    await page.close();
  });

  it('an inline artifact body keeps no empty reserve below its content', async () => {
    const page = await openPage(browser, '?variant=tiny');
    await publish(page, { note: false });
    const trigger = await page.locator('.disclosure-trigger').evaluate(node => node.getBoundingClientRect().height);
    const body = await page.locator('.artifact-body').evaluate(node => node.getBoundingClientRect().height);
    expect(body, 'collapsed body height stays at content plus padding').toBeLessThanOrEqual(trigger + 32 + 2);
    await page.getByRole('button', { name: 'Recovered details', exact: true }).click();
    await settleBranch(page, true);
    const expanded = await geometry(page);
    const hidden = (expanded.answerInner ?? 0) + (expanded.branchInner ?? 0);
    expect(hidden).toBeGreaterThan(20);
    await collapse(page);
    const collapsed = await geometry(page);
    expect(expanded.height - collapsed.height, 'collapse removes the reserved answer extent').toBeGreaterThanOrEqual(hidden - 2);
    const bodyAfter = await page.locator('.artifact-body').evaluate(node => node.getBoundingClientRect().height);
    expect(bodyAfter, 'no empty reserve returns after collapse').toBeLessThanOrEqual(trigger + 32 + 2);
    await page.close();
  });

  it('reduced and off motion collapse instantly and rapid reversal settles the last state', async () => {
    const page = await openPage(browser, '?variant=disclosure&hostOpen=true', { hold: { note: 'Keep this saved note', open: true } });
    await publish(page, { journalHeld: true });
    await settleBranch(page, true);
    const expanded = await geometry(page);
    const hidden = (expanded.branchInner ?? 0) + (expanded.answerInner ?? 0);
    await collapse(page);
    const collapsed = await geometry(page);
    expect(expanded.height - collapsed.height).toBeGreaterThanOrEqual(hidden - 2);
    for (const policy of ['reduced', 'off'] as const) {
      await page.evaluate(policy => { document.documentElement.dataset.motion = policy; }, policy);
      await page.getByRole('button', { name: 'Recovered details', exact: true }).click();
      await settleBranch(page, true);
      expect(Math.abs((await geometry(page)).height - expanded.height)).toBeLessThanOrEqual(2);
      await collapse(page);
      expect(Math.abs((await geometry(page)).height - collapsed.height)).toBeLessThanOrEqual(2);
    }
    await page.evaluate(() => { document.documentElement.dataset.motion = 'system'; });
    const trigger = page.getByRole('button', { name: 'Recovered details', exact: true });
    await trigger.click(); await trigger.click();
    await settleBranch(page, false);
    expect(Math.abs((await geometry(page)).height - collapsed.height)).toBeLessThanOrEqual(2);
    await trigger.click(); await trigger.click(); await trigger.click();
    await settleBranch(page, true);
    expect(Math.abs((await geometry(page)).height - expanded.height)).toBeLessThanOrEqual(2);
    await page.close();
  });

  it('streaming answer growth moves following content down in flow without a gap', async () => {
    const page = await openPage(browser, '?variant=disclosure&hostOpen=true&rows=4', { hold: { note: 'Keep this saved note', open: true } });
    await publish(page, { journalHeld: true });
    await settleBranch(page, true);
    const before = await geometry(page);
    await page.getByRole('button', { name: 'Publish snapshot', exact: true }).click();
    await settleBranch(page, true);
    const after = await geometry(page);
    const growth = after.height - before.height;
    expect(growth).toBeGreaterThan(10);
    expect(Math.abs(growth - (after.afterTop - before.afterTop)), 'following content tracks the grown extent exactly').toBeLessThanOrEqual(2);
    await page.close();
  });

  it('a failed disclosure action keeps error and retry truthful', async () => {
    const page = await openPage(browser, '?variant=request');
    await publish(page);
    const error = page.locator('.disclosure-error');
    await pw(error).toBeVisible();
    await pw(error.getByRole('button', { name: /Try again/ })).toBeEnabled();
    await page.close();
  });

  it('journal reload restores the bound disclosure state without replaying the entrance', async () => {
    const page = await openPage(browser, '?variant=disclosure');
    await publish(page);
    await page.getByRole('button', { name: 'Recovered details', exact: true }).click();
    await settleBranch(page, true);
    const opened = await geometry(page);
    await pw(page.locator('.save-state')).toContainText('Draft retained', { timeout: 10_000 });
    await page.reload();
    await page.getByRole('button', { name: 'Restore artifact', exact: true }).click();
    await pw(page.getByRole('button', { name: 'Recovered details', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await settleBranch(page, true);
    const reloaded = await geometry(page);
    expect(Math.abs(reloaded.height - opened.height)).toBeLessThanOrEqual(2);
    expect(await entranceCount(page)).toBe(0);
    await page.close();
  });
});
