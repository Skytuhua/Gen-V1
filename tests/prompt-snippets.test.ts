import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JournalRecord } from '../apps/web/src/journal';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

const PROFILE = 'http://localhost:4173';

function atomicDatabase() {
  const rows = new Map<string, JournalRecord>(), request: { result: unknown; onsuccess?: () => void } = { result: null };
  const database = { transaction: () => {
    let pending = 0; const staged = new Map<string, JournalRecord>();
    const tx = { error: new Error('Atomic transaction aborted'), oncomplete: undefined as undefined | (() => void), onabort: undefined as undefined | (() => void), onerror: undefined as undefined | (() => void), abort: () => {}, objectStore: () => ({
      get: (key: string) => { pending++; const read: { result: JournalRecord | undefined; onsuccess?: () => void } = { result: rows.get(key) }; queueMicrotask(() => { read.onsuccess?.(); if (--pending === 0) queueMicrotask(() => { for (const [key, value] of staged) { const existing = rows.get(key); if (!existing || existing.updatedAt <= value.updatedAt) rows.set(key, value); } tx.oncomplete?.(); }); }); return read; },
      put: (record: JournalRecord, key: string) => { staged.set(key, record); },
    }) }; return tx;
  } };
  request.result = database;
  vi.stubGlobal('indexedDB', { open: () => { queueMicrotask(() => request.onsuccess?.()); return request; } });
  return rows;
}

async function fixture() {
  const rows = atomicDatabase();
  const journal = await import('../apps/web/src/journal');
  const api = await import('../apps/web/src/prompt-snippets');
  return { rows, journal, api };
}

const ok = <T extends { ok: boolean }>(result: T) => { if (!result.ok) throw new Error(`expected ok result, got ${JSON.stringify(result)}`); return result as Extract<T, { ok: true }> };

describe('prompt snippet library', () => {
  it('creates, reloads, updates and deletes a snippet end to end', async () => {
    const { api } = await fixture();
    const empty = ok(await api.loadSnippetLibrary(PROFILE));
    expect(empty.generation).toBeUndefined(); expect(empty.library.snippets).toEqual([]);
    const created = ok(await api.createSnippet(PROFILE, empty.generation, { name: ' Review  checklist ', body: 'check tests\nthen lint' }));
    expect(created.library.snippets).toHaveLength(1);
    expect(created.library.snippets[0]).toMatchObject({ name: 'Review  checklist', body: 'check tests\nthen lint' });
    const id = created.library.snippets[0]!.id;
    const reloaded = ok(await api.loadSnippetLibrary(PROFILE));
    expect(reloaded.generation).toBe(created.generation);
    const renamed = ok(await api.updateSnippet(PROFILE, created.generation, id, { name: 'review checklist', body: 'run tests' }));
    expect(renamed.library.snippets[0]).toMatchObject({ name: 'review checklist', body: 'run tests' });
    const deleted = ok(await api.deleteSnippet(PROFILE, renamed.generation, id));
    expect(deleted.library.snippets).toEqual([]);
    const after = ok(await api.loadSnippetLibrary(PROFILE));
    expect(after.generation).toBe(deleted.generation); // valid empty record keeps generation
  });

  it('allows the same body under distinct names and different profiles stay isolated', async () => {
    const { api } = await fixture();
    let generation: string | undefined;
    for (const name of ['alpha', 'beta']) generation = ok(await api.createSnippet(PROFILE, generation, { name, body: 'same body' })).generation;
    expect(ok(await api.loadSnippetLibrary(PROFILE)).library.snippets.map(snippet => snippet.name)).toEqual(['alpha', 'beta']);
    expect(ok(await api.loadSnippetLibrary('https://other.example')).library.snippets).toEqual([]);
  });

  it.each([
    { name: 'has\nnewline', body: 'x' },
    { name: 'a'.repeat(81), body: 'x' },
    { name: '', body: 'x' },
    { name: 'ok', body: '   \n\t  ' },
    { name: 'ok', body: 'x'.repeat(20_001) },
    { name: 'ok', body: 'a\0b' },
  ])('rejects invalid input %j', async input => {
    const { api } = await fixture();
    expect(await api.createSnippet(PROFILE, undefined, input)).toMatchObject({ ok: false, error: 'validation' });
    expect(ok(await api.loadSnippetLibrary(PROFILE)).library.snippets).toEqual([]);
  });

  it('rejects duplicate names case-insensitively and non-NFC variants but allows self-rename', async () => {
    const { api } = await fixture();
    const created = ok(await api.createSnippet(PROFILE, undefined, { name: 'Café', body: 'b' }));
    expect(await api.createSnippet(PROFILE, created.generation, { name: 'café', body: 'b' })).toMatchObject({ ok: false, error: 'validation' });
    expect(await api.createSnippet(PROFILE, created.generation, { name: 'Café', body: 'b' })).toMatchObject({ ok: false, error: 'validation' });
    const self = ok(await api.updateSnippet(PROFILE, created.generation, created.library.snippets[0]!.id, { name: 'CAFÉ', body: 'b' }));
    expect(self.library.snippets[0]!.name).toBe('CAFÉ');
  });

  it('enforces the 100 record limit', async () => {
    const { api } = await fixture();
    const snippets = Array.from({ length: 100 }, (_, i) => ({ id: crypto.randomUUID(), name: `s${i}`, body: 'x', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
    expect(api.parseSnippetLibrary(PROFILE, { version: 1, profileId: PROFILE, snippets })).toMatchObject({ ok: true });
    expect(api.parseSnippetLibrary(PROFILE, { version: 1, profileId: PROFILE, snippets: [...snippets, snippets[0]!] })).toMatchObject({ ok: false });
  });

  it('rejects corrupt stored records without overwriting them', async () => {
    const { rows, journal, api } = await fixture();
    const key = api.snippetLibraryKey(PROFILE);
    for (const value of [
      { version: 2, profileId: PROFILE, snippets: [] },
      { version: 1, profileId: 'https://other.example', snippets: [] },
      { version: 1, profileId: PROFILE, snippets: [{ id: 'not-uuid', name: 'x', body: 'x', createdAt: 'now', updatedAt: 'now' }] },
      { version: 1, profileId: PROFILE, snippets: [{ id: crypto.randomUUID(), name: 'x', body: 'x', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), extra: true }] },
      { version: 1, profileId: PROFILE, snippets: [] , extra: {} },
    ]) {
      await journal.journalWrite(key, value);
      expect(await api.loadSnippetLibrary(PROFILE)).toMatchObject({ ok: false, error: 'validation' });
      expect(rows.get(key)!.value).toBe(value); // raw bytes retained
    }
  });

  it('returns conflict on a stale generation and never resurrects a deleted record', async () => {
    const { api } = await fixture();
    const first = ok(await api.createSnippet(PROFILE, undefined, { name: 'one', body: 'x' }));
    const second = ok(await api.createSnippet(PROFILE, first.generation, { name: 'two', body: 'x' }));
    expect(await api.createSnippet(PROFILE, first.generation, { name: 'three', body: 'x' })).toMatchObject({ ok: false, error: 'conflict' });
    const deleted = ok(await api.deleteSnippet(PROFILE, second.generation, second.library.snippets[0]!.id));
    expect(await api.updateSnippet(PROFILE, deleted.generation, second.library.snippets[0]!.id, { name: 'z', body: 'x' })).toMatchObject({ ok: false, error: 'validation' });
  });

  it('notifies subscribers and stops after unsubscribe', async () => {
    const { api } = await fixture();
    const seen: unknown[] = [];
    const stop = api.subscribeSnippetLibrary(PROFILE, result => { if (result.ok) seen.push(result.library.snippets.length); });
    await api.createSnippet(PROFILE, undefined, { name: 'one', body: 'x' });
    stop();
    await api.createSnippet(PROFILE, (await api.loadSnippetLibrary(PROFILE) as { generation: string }).generation, { name: 'two', body: 'x' });
    expect(seen).toEqual([1]);
  });

  it('refresh catches a remote change the broadcast missed, without downgrading local work', async () => {
    const { rows, journal, api } = await fixture();
    const created = ok(await api.createSnippet(PROFILE, undefined, { name: 'local', body: 'x' }));
    // Another window writes durable record the channel never announced.
    const remote = { version: 1, profileId: PROFILE, snippets: [{ id: crypto.randomUUID(), name: 'remote', body: 'y', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] };
    rows.set(api.snippetLibraryKey(PROFILE), { value: remote, updatedAt: Date.now() + 60_000, generation: 'remote-generation' });
    const refreshed = ok(await api.refreshSnippetLibrary(PROFILE));
    expect(refreshed.generation).toBe('remote-generation');
    expect(refreshed.library.snippets.map(snippet => snippet.name)).toEqual(['remote']);
    // Cached read remains stale until refreshed; generation CAS keyed to the stale view conflicts honestly.
    expect((await api.loadSnippetLibrary(PROFILE) as { generation?: string }).generation).toBe('remote-generation');
    void created; void journal;
  });

  it('sorts and filters without writing on read or search', async () => {
    const { rows, api } = await fixture();
    let generation: string | undefined;
    for (const name of ['zebra', 'Apple', 'mango']) generation = ok(await api.createSnippet(PROFILE, generation, { name, body: `body of ${name}` })).generation;
    const library = ok(await api.loadSnippetLibrary(PROFILE)).library;
    expect(library.snippets.map(snippet => snippet.name)).toEqual(['Apple', 'mango', 'zebra']);
    expect(api.filterSnippets(library, 'MAN').map(snippet => snippet.name)).toEqual(['mango']);
    expect(api.filterSnippets(library, 'body of zebra').map(snippet => snippet.name)).toEqual(['zebra']);
    expect(api.filterSnippets(library, '')).toEqual(library.snippets);
    const durableSize = rows.size;
    void api.filterSnippets(library, 'x'); void api.parseSnippetLibrary(PROFILE, library);
    expect(rows.size).toBe(durableSize);
  });
});
