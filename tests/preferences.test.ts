import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/storage/store.ts';
import { Service } from '../packages/core/service.ts';
import type { RuntimeAdapter, Thread } from '../packages/contracts/index.ts';
import { DEFAULT_PREFERENCES, getPreferences, mergePreferences } from '../packages/contracts/preferences.ts';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const clean of cleanups.splice(0)) clean(); });
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'harness-preferences-'));
  const store = new Store(dir);
  const runtime: RuntimeAdapter = { configure() {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
  cleanups.push(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const service = new Service(store, runtime);
  let sequence = 0;
  const command = (type: string, payload: Record<string, unknown>, threadId?: string) => service.command({ id: 'prefs-' + ++sequence, type, payload, threadId });
  return { store, service, command };
}
describe('UI preferences and thread presentation', () => {
  it('adds wide defaults without rewriting the old theme or selected model', async () => {
    const { store, command } = setup();
    store.internal('fixture.settings', null, () => store.put('settings', 'global', null, { theme: 'dark', modelId: 'subscription/model' }));
    expect(getPreferences(store.snapshot().settings).chatWidth).toBe('wide');
    await command('settings.update', { preferences: { fontSize: 16, chatWidth: 'full' } });
    expect(store.snapshot().settings).toMatchObject({ theme: 'dark', modelId: 'subscription/model', preferences: { fontSize: 16, chatWidth: 'full' } });
    expect(getPreferences(store.snapshot().settings).sendShortcut).toBe('enter');
  });
  it('merges keybinding changes without dropping other bindings and returns independent defaults', () => {
    const a = getPreferences({}); a.keybindings.search = 'Alt+K';
    expect(getPreferences({}).keybindings.search).toBe('Ctrl+K');
    const b = mergePreferences(DEFAULT_PREFERENCES, { keybindings: { search: 'Alt+K' } });
    expect(b.keybindings.newThread).toBe('Ctrl+Shift+O'); expect(b.keybindings.search).toBe('Alt+K');
  });
  it.each([{ remoteAccess: true }, { fontSize: 90 }, { panelAnimations: 'yes' }, { motionDuration: -1 }, { keybindings: { executeShell: 'Ctrl+X' } }])('rejects unsupported or invalid preference values %j', value => {
    expect(() => mergePreferences(DEFAULT_PREFERENCES, value)).toThrow();
  });
  it('rejects unsupported host settings without committing a receipt or event', async () => {
    const { store, command } = setup(); const seq = store.sequence;
    await expect(command('settings.update', { apiKey: 'not-a-real-secret' })).rejects.toThrow();
    expect(store.sequence).toBe(seq);
  });
  it('updates view metadata without changing runtime authority and restores archived tasks', async () => {
    const { store, command } = setup();
    const made = await command('thread.create', { title: 'Kept task' }); const thread = made.result as Thread;
    await command('thread.presentation', { pinned: true, unread: true, settled: true }, thread.id);
    expect(store.get<Thread>('thread', thread.id)).toMatchObject({ status: 'ready', epoch: 0, runId: null, presentation: { pinned: true, unread: true, settled: true } });
    await command('thread.archive', {}, thread.id);
    expect(store.snapshot().threads).toHaveLength(0);
    expect(store.snapshot().archivedThreads).toEqual([expect.objectContaining({ id: thread.id })]);
    await command('thread.restore', {}, thread.id);
    expect(store.snapshot().threads[0].id).toBe(thread.id);
    expect(store.snapshot().archivedThreads).toHaveLength(0);
  });
});
