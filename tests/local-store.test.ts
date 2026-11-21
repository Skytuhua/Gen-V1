import { afterEach, describe, expect, it, vi } from 'vitest';
import { readJson, readString, readWorkspaceMode, remove, storageKeys, writeString } from '../apps/web/src/local-store';

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const store = {
    get length() { return data.size; },
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, String(value)); },
    removeItem: (key: string) => { data.delete(key); },
    key: (index: number) => [...data.keys()][index] ?? null,
    clear: () => data.clear(),
    data,
  };
  vi.stubGlobal('localStorage', store);
  return store;
}
afterEach(() => vi.unstubAllGlobals());

describe('readWorkspaceMode', () => {
  it('returns a persisted v3 mode', () => {
    fakeStorage({ [storageKeys.workspaceModeV3]: 'split' });
    expect(readWorkspaceMode()).toBe('split');
  });
  it('migrates v2 to v3 once on read and deletes the legacy key', () => {
    const store = fakeStorage({ [storageKeys.workspaceModeV2]: 'retained-canvas' });
    expect(readWorkspaceMode()).toBe('retained-canvas');
    expect(store.data.get(storageKeys.workspaceModeV3)).toBe('retained-canvas');
    expect(store.data.has(storageKeys.workspaceModeV2)).toBe(false);
    expect(readWorkspaceMode()).toBe('retained-canvas');
  });
  it('prefers v3 over a stale v2 value and reports unknown values as chat', () => {
    fakeStorage({ [storageKeys.workspaceModeV3]: 'bogus', [storageKeys.workspaceModeV2]: 'split' });
    expect(readWorkspaceMode()).toBe('chat');
  });
  it('reports chat when nothing is stored', () => {
    fakeStorage();
    expect(readWorkspaceMode()).toBe('chat');
  });
});

describe('storage-unavailable path', () => {
  it('readString and readJson return fallbacks and writes report failure', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    });
    expect(readString('x')).toBeNull();
    expect(readJson('x', { a: 1 })).toEqual({ a: 1 });
    expect(readWorkspaceMode()).toBe('chat');
    expect(writeString('x', 'y')).toBe(false);
    expect(remove('x')).toBe(false);
  });
  it('readJson falls back on malformed stored JSON', () => {
    fakeStorage({ k: '{broken' });
    expect(readJson('k', 'fallback')).toBe('fallback');
  });
});
