import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../packages/storage/store';
import { Service } from '../packages/core/service';
import type { RuntimeAdapter } from '../packages/contracts';
import { DEFAULT_PREFERENCES, getPreferences, mergePreferences, projectIdentityKeySchema } from '../packages/contracts/preferences';

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach(clean => clean()));
const key = '["local","project-a"]';
const runtime: RuntimeAdapter = { configure() {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };

describe('project model defaults preferences', () => {
  it('round-trips a valid entry through mergePreferences', () => {
    const updated = mergePreferences(DEFAULT_PREFERENCES, { projectModelDefaults: { [key]: { modelId: 'model-x', thinkingLevel: 'high' } } });
    expect(updated.projectModelDefaults[key]).toEqual({ modelId: 'model-x', thinkingLevel: 'high' });
    expect(mergePreferences(updated, { density: 'touch' }).projectModelDefaults[key]).toEqual({ modelId: 'model-x', thinkingLevel: 'high' });
  });

  it('accepts plugin keys and a null reasoning level', () => {
    const pluginKey = JSON.stringify(['plugin', 'provider', 'scope', 'project-b']);
    const updated = mergePreferences(DEFAULT_PREFERENCES, { projectModelDefaults: { [pluginKey]: { modelId: 'model-y', thinkingLevel: null } } });
    expect(updated.projectModelDefaults[pluginKey]).toEqual({ modelId: 'model-y', thinkingLevel: null });
  });

  it.each(['project name', '["local","../x"]', '["plugin","p","s"]', '["local","p","extra"]', 42])('rejects malformed identity key %s', invalid => {
    expect(() => mergePreferences(DEFAULT_PREFERENCES, { projectModelDefaults: { [String(invalid)]: { modelId: 'm', thinkingLevel: null } } })).toThrow();
  });

  it('bounds the map at 200 entries', () => {
    const entries = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [JSON.stringify(['local', `p-${i}`]), { modelId: 'm', thinkingLevel: null }]));
    expect(Object.keys(mergePreferences(DEFAULT_PREFERENCES, { projectModelDefaults: entries }).projectModelDefaults)).toHaveLength(200);
    expect(() => mergePreferences(DEFAULT_PREFERENCES, { projectModelDefaults: { ...entries, [key]: { modelId: 'm', thinkingLevel: null } } })).toThrow();
  });

  it.each([
    { modelId: '', thinkingLevel: null },
    { modelId: 'm'.repeat(201), thinkingLevel: null },
    { modelId: 'm', thinkingLevel: 'has spaces' },
    { modelId: 'm', thinkingLevel: 'x'.repeat(41) },
    { modelId: 'm', thinkingLevel: null, extra: true },
    { thinkingLevel: null },
  ])('rejects invalid entry %j', entry => {
    expect(() => mergePreferences(DEFAULT_PREFERENCES, { projectModelDefaults: { [key]: entry } })).toThrow();
  });

  it('surfaces settings.update with an invalid map as INVALID_INPUT', async () => {
    const root = mkdtempSync(join(tmpdir(), 'project-model-defaults-'));
    const store = new Store(join(root, 'a'));
    cleanup.push(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
    await expect(new Service(store, runtime).command({ id: 'bad-save', type: 'settings.update', payload: { preferences: { projectModelDefaults: { 'not-a-key': { modelId: 'm', thinkingLevel: null } } } } }))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('persists through settings.update and stays isolated per profile', async () => {
    const root = mkdtempSync(join(tmpdir(), 'project-model-defaults-'));
    let store = new Store(join(root, 'a'));
    const other = new Store(join(root, 'b'));
    cleanup.push(() => { store.close(); other.close(); rmSync(root, { recursive: true, force: true }); });
    await new Service(store, runtime).command({ id: 'model-save', type: 'settings.update', payload: { preferences: { projectModelDefaults: { [key]: { modelId: 'model-x', thinkingLevel: 'low' } } } } });
    store.close(); store = new Store(join(root, 'a'));
    expect(getPreferences(store.snapshot().settings).projectModelDefaults[key]).toEqual({ modelId: 'model-x', thinkingLevel: 'low' });
    expect(getPreferences(other.snapshot().settings).projectModelDefaults).toEqual({});
    await new Service(store, runtime).command({ id: 'model-reset', type: 'settings.update', payload: { preferences: { projectModelDefaults: {} } } });
    expect(getPreferences(store.snapshot().settings).projectModelDefaults).toEqual({});
  });

  it('exports one identity schema reused by colors and model defaults', () => {
    expect(projectIdentityKeySchema.safeParse(key).success).toBe(true);
    expect(projectIdentityKeySchema.safeParse('project name').success).toBe(false);
  });
});
