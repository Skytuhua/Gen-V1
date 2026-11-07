import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../packages/storage/store';
import { Service } from '../packages/core/service';
import type { RuntimeAdapter } from '../packages/contracts';
import { DEFAULT_PREFERENCES, getPreferences, mergePreferences } from '../packages/contracts/preferences';

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach(clean => clean()));
const key = '["local","project-a"]';

describe('project color preferences', () => {
  it('migrates old palette preferences additively and accepts six-digit custom colors', () => {
    const old = getPreferences({ preferences: { fontSize: 16, projectColors: { [key]: '#4F6EFF' } } });
    const updated = mergePreferences(old, { projectColors: { ...old.projectColors, '["local","project-b"]': '#aB12fF' } });
    expect(updated.fontSize).toBe(16);
    expect(updated.projectColors).toEqual({ [key]: '#4F6EFF', '["local","project-b"]': '#aB12fF' });
  });

  it.each(['red', '#fff', '#12345678', 'url(https://example.test)', '#12345g'])('rejects invalid custom color %s', value => {
    expect(() => mergePreferences(DEFAULT_PREFERENCES, { projectColors: { [key]: value } })).toThrow();
  });

  it('rejects malformed authority keys and bounds override count', () => {
    for (const invalid of ['project name', '["local","../x"]', '["plugin","p","s"]', '["local","p","extra"]']) {
      expect(() => mergePreferences(DEFAULT_PREFERENCES, { projectColors: { [invalid]: '#123abc' } })).toThrow();
    }
    const colors = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [JSON.stringify(['local', `p-${i}`]), '#123abc']));
    expect(Object.keys(mergePreferences(DEFAULT_PREFERENCES, { projectColors: colors }).projectColors)).toHaveLength(200);
    expect(() => mergePreferences(DEFAULT_PREFERENCES, { projectColors: { ...colors, [key]: '#123abc' } })).toThrow();
  });

  it('persists an explicit custom override only in its owning profile and supports reset', async () => {
    const root = mkdtempSync(join(tmpdir(), 'project-color-profiles-'));
    const runtime: RuntimeAdapter = { configure() {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
    let store = new Store(join(root, 'a'));
    const other = new Store(join(root, 'b'));
    cleanup.push(() => { store.close(); other.close(); rmSync(root, { recursive: true, force: true }); });
    await new Service(store, runtime).command({ id: 'color-save', type: 'settings.update', payload: { preferences: { projectColors: { [key]: '#123abc' } } } });
    store.close(); store = new Store(join(root, 'a'));
    expect(getPreferences(store.snapshot().settings).projectColors[key]).toBe('#123abc');
    expect(getPreferences(other.snapshot().settings).projectColors).toEqual({});
    await new Service(store, runtime).command({ id: 'color-reset', type: 'settings.update', payload: { preferences: { projectColors: {} } } });
    expect(getPreferences(store.snapshot().settings).projectColors).toEqual({});
  });
});
