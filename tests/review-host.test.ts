import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { crc32, inflateSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { PDFDocument } from 'pdf-lib';
import { chromium, expect as browserExpect } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openReviewHost, reviewColorStudyPng, type Scenario } from '../scripts/review-host';
import type { ArtifactRecord, DataRecord, Operation, RunContext, UserStateRecord } from '../packages/contracts';
import { disclosureData, relationshipData, tableChangesData } from '../packages/ui-catalog/workflow';

describe('isolated actual-host recording fixtures', () => {
  let folder: string;
  let host: Awaited<ReturnType<typeof openReviewHost>>;
  beforeAll(async () => { folder = await mkdtemp(join(tmpdir(), 'harness-review-fixtures-')); host = await openReviewHost(folder, 4367); });
  afterAll(async () => {
    await host?.close();
    if (folder && resolve(folder).startsWith(resolve(tmpdir()) + '\\') && folder.includes('harness-review-fixtures-')) await rm(folder, { recursive: true, force: true });
  });
  const thread = (scenario: Scenario) => host.threads.get(scenario)!;
  const artifact = (scenario: Scenario) => host.store.all<ArtifactRecord>('artifact', thread(scenario).id)[0]!;
  const source = (scenario: Scenario, alias: string) => host.store.get<DataRecord>('data', host.runtime.aliases.get(thread(scenario).id)!.get(alias)!)!.value;
  const command = (scenario: Scenario, type: string, payload: Record<string, unknown>) => host.service.command({ id: randomUUID(), type, threadId: thread(scenario).id, payload });
  async function settled(scenario: Scenario) {
    await expect.poll(() => host.service.thread(thread(scenario).id).status, { timeout: 12_000, interval: 25 }).toMatch(/^(ready|completed|failed|interrupted)$/);
    const current = host.service.thread(thread(scenario).id);
    expect(current.error ?? null).toBeNull();
    expect(current.status).toMatch(/^(ready|completed)$/);
  }
  async function send(scenario: Scenario) { await command(scenario, 'message.send', { content: 'Show this explicit local review fixture.', modelId: 'review/local-fixture' }); await settled(scenario); }
  async function action(scenario: Scenario, actionId: string, payload: Record<string, unknown> = {}, patch: Record<string, unknown> = {}) {
    const current = artifact(scenario), state = host.store.get<UserStateRecord>('userState', current.stateId)!;
    const dataRevisions = Object.fromEntries(Object.values(current.bindings).map(binding => binding.mode === 'live' ? [binding.id, host.store.get<DataRecord>('data', binding.id)!.revision] : [binding.ref.id, binding.ref.revision]));
    return command(scenario, 'action.submit', { artifactId: current.id, revision: current.revision, actionId, payload, dataRevisions, baseStateRevision: state.revision, submittedState: { ...state.values, ...patch } });
  }
  it('serves the actual local HTTP host with nine fixture threads and an honest model label', async () => {
    const response = await fetch('http://127.0.0.1:4367/api/bootstrap');
    expect(response.status).toBe(200);
    const cookie = response.headers.getSetCookie()[0]!.split(';')[0]!;
    const snapshot = await fetch('http://127.0.0.1:4367/api/snapshot', { headers: { cookie } });
    expect((await snapshot.json() as { threads: unknown[] }).threads).toHaveLength(9);
    expect((await host.runtime.models())[0]!.name).toContain('no model inference');
    expect(host.store.all('resource', thread('signing').id)).toHaveLength(2);
    expect(host.store.all('resource', thread('migration').id)).toHaveLength(1);
    expect(host.store.all('resource', thread('pr-dark').id)).toHaveLength(0);
  });
  it('provides a decodable 256 by 144 color image with correct PNG chunks', async () => {
    const png = reviewColorStudyPng();
    const decoded = await (await PDFDocument.create()).embedPng(png);
    expect([decoded.width, decoded.height]).toEqual([256, 144]);
    let compressed: Buffer | undefined;
    for (let offset = 8; offset < png.length;) {
      const length = png.readUInt32BE(offset), end = offset + 8 + length;
      expect(png.readUInt32BE(end)).toBe(crc32(png.subarray(offset + 4, end)));
      if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') compressed = png.subarray(offset + 8, end);
      offset = end + 4;
    }
    expect(inflateSync(compressed!).length).toBe((256 * 4 + 1) * 144);
  });
  it('prepares and exports a real local PDF only after exact native operation approval', async () => {
    await send('signing');
    expect(artifact('signing').spec!.elements.steps.children).toHaveLength(4);
    await action('signing', 'sign', {}, { email: 'alex@studio.example', accepted: true, signature: { kind: 'typed', text: 'Alex Morgan' } });
    await settled('signing');
    const operation = host.store.all<Operation>('operation', thread('signing').id)[0]!;
    expect(operation).toMatchObject({ kind: 'pdf.export', status: 'prepared', approved: false });
    expect(artifact('signing').spec!.elements.review.children).toContain('export');
    const request = await action('signing', 'export');
    expect(request.result).toMatchObject({ approvalRequired: true });
    expect(host.store.get<Operation>('operation', operation.id)!.status).toBe('prepared');
    await command('signing', 'operation.approve', { operationId: operation.id, revision: operation.revision });
    await expect.poll(() => host.service.thread(thread('signing').id).status, { timeout: 12_000, interval: 25 }).toBe('completed');
    const result = host.store.get<Operation>('operation', operation.id)!.result as { path: string; fieldsFilled: number; signaturesPlaced: number };
    expect(result.signaturesPlaced).toBe(1);
    const exported = await PDFDocument.load(await readFile(join(folder, 'resources', 'exports', result.path)));
    expect(exported.getForm().getTextField('Email').getText()).toBe('alex@studio.example');
  });
  it('shows actual before/after SQLite rows and valid row-change annotations', async () => {
    await send('migration');
    expect(source('migration', 'workspaces')).toEqual([]);
    expect(source('migration', 'users')).toHaveLength(12);
    expect((source('migration', 'users') as { workspace: unknown }[]).every(row => row.workspace === null)).toBe(true);
    const operation = host.store.all<Operation>('operation', thread('migration').id)[0]!;
    expect(operation.status).toBe('prepared');
    await command('migration', 'operation.approve', { operationId: operation.id, revision: operation.revision });
    await expect.poll(() => host.service.thread(thread('migration').id).status, { timeout: 12_000, interval: 25 }).toBe('completed');
    expect(source('migration', 'workspaces')).toHaveLength(3);
    for (const table of ['workspaces', 'users', 'projects', 'messages']) expect(tableChangesData.safeParse(source('migration', table + 'Changes')).success).toBe(true);
    expect((source('migration', 'users') as { workspace: number }[]).map(row => row.workspace)).toEqual([1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3]);
    const db = new DatabaseSync(join(folder, 'resources', 'project.sqlite'), { readOnly: true });
    try { expect(db.prepare('SELECT COUNT(*) AS n FROM users WHERE workspace_id IS NOT NULL').get()!.n).toBe(12); } finally { db.close(); }
  }, 30_000);
  it('opens an inserted custom question and preserves the existing question state', async () => {
    await send('faq');
    await action('faq', 'ask', { question: 'Can I use a wire transfer?' }, { eligibilityOpen: true, question: 'Can I use a wire transfer?' });
    await settled('faq');
    const current = artifact('faq'), state = host.store.get<UserStateRecord>('userState', current.stateId)!;
    expect(state.values).toMatchObject({ eligibilityOpen: true });
    expect(state.values).not.toHaveProperty('custom3Open');
    expect(current.spec!.elements.custom3.props.defaultOpen).toBe(true);
    expect(current.spec!.elements.custom3.props.title).toBe('Can I use a wire transfer?');
    expect(disclosureData.parse(source('faq', 'custom3'))).toMatchObject({ status: 'ready', answer: expect.stringContaining('wire transfers') });
    expect(current.spec!.elements.custom3.children).toContain('custom3plans');
  });
  it('keeps browser input focus while an inserted custom answer becomes visible', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.addInitScript(id => localStorage.setItem('harness:selected-thread', id), thread('faq').id);
      await page.goto('http://127.0.0.1:4367');
      const input = page.getByRole('textbox', { name: 'Your question' });
      // Restored open unanswered branches load on mount. Let that genuine
      // disclosure action settle before beginning a second scripted request.
      await expect.poll(() => disclosureData.parse(source('faq', 'eligibility')).status, { timeout: 5_000, interval: 25 }).toBe('ready');
      await settled('faq');
      await input.fill('Can the example receive wire transfers?');
      await input.press('Enter');
      await browserExpect(page.getByRole('button', { name: 'Can the example receive wire transfers?', exact: true })).toHaveAttribute('aria-expanded', 'true');
      const questionId = Object.entries(artifact('faq').spec!.elements).find(([, node]) => node.props.title === 'Can the example receive wire transfers?')![0];
      await expect.poll(() => disclosureData.parse(source('faq', questionId)).status, { timeout: 5_000, interval: 25 }).toBe('ready');
      await browserExpect(input).toBeFocused();
      await browserExpect(page.getByText('Yes, wire transfers are supported. Review the destination and fee before confirming.', { exact: true }).last()).toBeVisible();
      // Answer arrival precedes the source-declared follow-up phase. Do not
      // leak this still-owned run into the next single-run fixture scenario.
      await settled('faq');
    } finally { await browser.close(); }
  });
  it('keeps PR outcomes illustrative and denies a source mutation with a stale original epoch', async () => {
    for (const scenario of ['pr-dark', 'pr-light'] as const) {
      await send(scenario);
      expect(artifact(scenario).spec!.elements.graph.props.orientation).toBe('vertical');
      const initial = source(scenario, 'graph');
      expect(relationshipData.parse(initial).summary!.label).toContain('3 conflicts');
      await action(scenario, 'resolve');
      const running = host.service.thread(thread(scenario).id);
      const stale: RunContext = { threadId: running.id, runId: running.runId!, epoch: running.epoch - 1 };
      expect(() => host.runtime.source(stale, 'graph', { forged: true })).toThrow(/no longer has authority/);
      await settled(scenario);
      expect(relationshipData.parse(source(scenario, 'graph')).checks![0]!.detail).toContain('42/42');
      expect(relationshipData.parse(source(scenario, 'graph')).source).toContain('simulated');
      await action(scenario, 'merge'); await settled(scenario);
      expect(relationshipData.parse(source(scenario, 'graph')).summary!.status).toBe('merged');
      expect(host.store.all<Operation>('operation', running.id)).toEqual([]);
    }
  }, 20_000);
  it('admits map and catalog through the service instead of production scenario routes', async () => {
    await send('map'); expect((source('map', 'places') as { points: unknown[] }).points).toHaveLength(3);
    await send('catalog'); expect(Object.values(artifact('catalog').spec!.elements).some(element => element.type === 'Image')).toBe(true);
  });
});
