import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Service } from "../packages/core/service.ts";
import { Store } from "../packages/storage/store.ts";
import { ShellReadModels } from "../packages/core/shell-read-models.ts";
import { __setCapabilityFlagForTests } from "../packages/core/capability-flags.ts";
import type { RuntimeAdapter, SidebarSectionV1, Thread } from "../packages/contracts/index.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); __setCapabilityFlagForTests('ui.sidebarSectionsV1', undefined); });

async function setup() {
  const base = mkdtempSync(join(tmpdir(), "harness-sections-")), store = new Store(join(base, "state"));
  const runtime: RuntimeAdapter = { configure: () => {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
  const service = new Service(store, runtime); await service.recover();
  cleanups.push(async () => { await service.dispose(); store.close(); rmSync(base, { recursive: true, force: true }); });
  const send = (type: string, payload: Record<string, unknown> = {}, threadId?: string, id = crypto.randomUUID()) => service.command({ id, type, payload, threadId });
  const reads = new ShellReadModels(store);
  return { service, store, send, reads };
}

it('denies every section command and hides section fields while the flag is off', async () => {
  const x = await setup();
  for (const type of ['sidebar.section.create', 'sidebar.section.rename', 'sidebar.section.move', 'sidebar.section.delete', 'sidebar.section.restore'])
    await expect(x.send(type, type === 'sidebar.section.create' ? { name: 'A' } : {})).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
  const first = await x.send('thread.create', { title: 'A' }), thread = first.result as Thread;
  await expect(x.send('thread.presentation', { sectionId: 'sec_x' }, thread.id)).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
  x.store.internal('fixture', null, () => {
    x.store.put('sidebar_section', 'sec_hidden', null, { id: 'sec_hidden', name: 'Hidden', order: 1, createdAt: '', updatedAt: '' });
    x.store.put('thread', thread.id, thread.id, { ...thread, presentation: { sectionId: 'sec_hidden' } });
  });
  const page = x.reads.navigation({});
  expect(page.sections).toBeUndefined();
  expect(page.items.find(item => item.id === thread.id)?.presentation?.sectionId).toBeUndefined();
});

it('creates, names, orders, deletes and restores sections with membership intact', async () => {
  const x = await setup();
  __setCapabilityFlagForTests('ui.sidebarSectionsV1', true);
  const first = await x.send('thread.create', { title: 'A' }), second = await x.send('thread.create', { title: 'B' });
  const threadA = first.result as Thread, threadB = second.result as Thread;
  const reviews = (await x.send('sidebar.section.create', { name: '  Reviews  ' })).result as SidebarSectionV1;
  expect(reviews).toMatchObject({ name: 'Reviews', order: 1 });
  expect(reviews.id.startsWith('sec_')).toBe(true);
  const triage = (await x.send('sidebar.section.create', { name: 'Triage' })).result as SidebarSectionV1;
  expect(triage.order).toBe(2);
  await expect(x.send('sidebar.section.create', { name: 'reviews' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await expect(x.send('sidebar.section.create', { name: ' ' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await expect(x.send('sidebar.section.create', { name: 'x'.repeat(61) })).rejects.toMatchObject({ code: 'INVALID_INPUT' });

  await x.send('thread.presentation', { sectionId: reviews.id }, threadA.id);
  await x.send('thread.presentation', { sectionId: reviews.id }, threadB.id);
  await expect(x.send('thread.presentation', { sectionId: 'sec_missing' }, threadA.id)).rejects.toMatchObject({ code: 'INVALID_INPUT', message: 'Unknown section' });
  let page = x.reads.navigation({});
  expect(page.sections?.map(section => section.name)).toEqual(['Reviews', 'Triage']);
  expect(page.items.find(item => item.id === threadA.id)?.presentation?.sectionId).toBe(reviews.id);

  await x.send('sidebar.section.move', { sectionId: triage.id, order: 0.5 });
  page = x.reads.navigation({});
  expect(page.sections?.map(section => section.name)).toEqual(['Triage', 'Reviews']);
  await expect(x.send('sidebar.section.move', { sectionId: triage.id, order: Number.NaN })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await expect(x.send('sidebar.section.move', { sectionId: 'sec_missing', order: 1 })).rejects.toMatchObject({ code: 'NOT_FOUND' });

  const renamed = (await x.send('sidebar.section.rename', { sectionId: triage.id, name: 'Inbox Triage' })).result as SidebarSectionV1;
  expect(renamed.name).toBe('Inbox Triage');
  await expect(x.send('sidebar.section.rename', { sectionId: triage.id, name: 'reviews' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });

  const deleted = (await x.send('sidebar.section.delete', { sectionId: reviews.id })).result as { deleted: string; released: string[] };
  expect(deleted.released.sort()).toEqual([threadA.id, threadB.id].sort());
  page = x.reads.navigation({});
  expect(page.sections?.map(section => section.name)).toEqual(['Inbox Triage']);
  expect(page.items.find(item => item.id === threadA.id)?.presentation?.sectionId).toBeUndefined();
  await expect(x.send('sidebar.section.delete', { sectionId: reviews.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });

  const restored = (await x.send('sidebar.section.restore', { section: reviews })).result as SidebarSectionV1;
  expect(restored.id).toBe(reviews.id);
  expect((await x.send('thread.presentation', { sectionId: restored.id }, threadA.id)).result).toMatchObject({ id: threadA.id });
  await expect(x.send('sidebar.section.restore', { section: restored })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
});

it('treats a stale sectionId as no section on read and survives archive', async () => {
  const x = await setup();
  __setCapabilityFlagForTests('ui.sidebarSectionsV1', true);
  const thread = (await x.send('thread.create', { title: 'A' })).result as Thread;
  const section = (await x.send('sidebar.section.create', { name: 'Reviews' })).result as SidebarSectionV1;
  await x.send('thread.presentation', { sectionId: section.id }, thread.id);
  await x.send('sidebar.section.delete', { sectionId: section.id });
  await x.send('thread.archive', {}, thread.id);
  const archive = x.reads.archive({});
  expect(archive.items.find(item => item.id === thread.id)?.presentation?.sectionId).toBeUndefined();
});
