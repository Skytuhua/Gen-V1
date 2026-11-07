import {beforeEach, expect, it, vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {ShellSettingsReadModel, ThreadNavigationRow} from '../packages/contracts/shell-read-models';
import {SettingsView, SETTINGS_SECTIONS} from '../apps/web/src/Settings';
import {loadCompactSettings} from '../apps/web/src/compact-settings-data';

const reads = vi.hoisted(() => ({settings: vi.fn(), resources: vi.fn(), navigation: vi.fn()}));
vi.mock('../apps/web/src/shell-read-api', () => ({getShellSettingsReadModel: reads.settings, getShellResources: reads.resources, getShellNavigation: reads.navigation}));
export const metadata = (): ShellSettingsReadModel => ({sequence: 9, settings: {theme: 'dark', modelId: null}, accounts: [], skills: [], skillProposals: [], learning: {supported: true, status: 'idle', lastReview: null}, projects: [{id: 'project', name: 'Real project'}], resources: [{id: 'r1', threadId: 'authorized-thread', kind: 'file', label: 'Exact first label', path: 'C:/authorized/a', writable: false}], resourcePage: {total: 2, nextCursor: 'resource-next'}, counts: {threads: 140, archivedThreads: 2, artifacts: 53, resources: 2, uncertainOperations: 3}});
const archived = (id: string): ThreadNavigationRow => ({id, title: 'Archived ' + id, status: 'ready', projectName: null, runId: null, createdAt: '2026-11-06', updatedAt: '2026-11-06'});
beforeEach(() => {
  vi.clearAllMocks(); reads.settings.mockResolvedValue(metadata());
  reads.resources.mockResolvedValue({sequence: 10, total: 2, items: [{id: 'r2', kind: 'folder', label: 'Exact later label', path: 'C:/authorized/b', writable: true}], nextCursor: null});
  reads.navigation.mockImplementation(({cursor}) => Promise.resolve({sequence: 10, total: 2, items: [archived(cursor ? 'a2' : 'a1')], nextCursor: cursor ? null : 'archive-next'}));
});
it('completes resource and archive metadata pages while keeping authoritative global counts', async () => {
  const controller = new AbortController(), data = await loadCompactSettings(controller.signal);
  expect(data.resources.map(row => row.label)).toEqual(['Exact first label', 'Exact later label']);
  expect(data.archivedThreads.map(row => row.id)).toEqual(['a1', 'a2']);
  expect(data.counts).toEqual(metadata().counts);
  expect(reads.resources).toHaveBeenCalledWith({limit: 100, cursor: 'resource-next'}, controller.signal);
  expect(reads.navigation).toHaveBeenLastCalledWith({archived: true, limit: 100, cursor: 'archive-next'}, controller.signal);
});
it('rejects inconsistent totals, repeated cursors and incomplete pages instead of reporting an empty or complete list', async () => {
  for (const page of [{total: 3, nextCursor: null}, {total: 2, nextCursor: 'resource-next'}, {total: 2, nextCursor: null, items: []}]) {
    reads.resources.mockResolvedValue({sequence: 10, items: [{id: 'r2'}], ...page});
    await expect(loadCompactSettings(new AbortController().signal)).rejects.toThrow(/changed|incomplete|repeat/i);
  }
});
it('rejects an aborted read even if the transport returns a late successful result', async () => {
  const controller = new AbortController(); reads.resources.mockImplementation(async () => {controller.abort(); return {sequence: 10, total: 2, items: [{id: 'r2'}], nextCursor: null};});
  await expect(loadCompactSettings(controller.signal)).rejects.toThrow();
});
it('keeps global archive counts distinct from the complete navigation scope when side threads are excluded', async () => {
  reads.settings.mockResolvedValue({...metadata(), counts: {...metadata().counts, archivedThreads: 3}});
  const data = await loadCompactSettings(new AbortController().signal);
  expect(data.counts.archivedThreads).toBe(3); expect(data.archivedThreads).toHaveLength(2);
});
it('renders all twelve supported sections from truthful compact data without a Snapshot', async () => {
  const data = await loadCompactSettings(new AbortController().signal);
  for (const [id, title] of SETTINGS_SECTIONS) {
    const html = renderToStaticMarkup(createElement(SettingsView, {data, draftReferences: async () => ({threads: [], skills: [], requests: [], userStates: []}), initialSection: id, modelError: '', refresh: async () => {}, loadModels: async () => {}, close: () => {}, addResource: () => {}}));
    expect(html).toContain(title.replaceAll('&', '&amp;'));
    if (id === 'projects') expect(html).toContain('Exact later label');
    if (id === 'appearance') expect(html).toContain('Real project');
    if (id === 'maintenance') {expect(html).toContain('2 archived'); expect(html).toContain('140 threads'); expect(html).toContain('53 artifacts'); expect(html).toContain('Archived a2');}
  }
});
