import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JournalRecord } from '../apps/web/src/journal';

const store = new Map<string, JournalRecord>();
const subscribers = new Map<string, Set<(value: unknown) => void>>();
let failReads = 0, failWrites = 0;

const readImpl = async (key: string) => {
  if (failReads-- > 0) throw new Error('journal read unavailable');
  return store.get(key);
};
const casImpl = async (key: string, generation: string | undefined, value: unknown) => {
  if (failWrites-- > 0) throw new Error('journal write unavailable');
  if (store.get(key)?.generation !== generation) return false;
  const record = {value, updatedAt: Date.now(), generation: `gen-${Math.random()}`};
  store.set(key, record);
  for (const listener of subscribers.get(key) ?? []) listener(value);
  return true;
};
const subscribeImpl = (key: string, listener: (value: unknown) => void) => {
  let set = subscribers.get(key);
  if (!set) subscribers.set(key, set = new Set());
  set.add(listener);
  return () => { set.delete(listener); };
};

vi.mock('../apps/web/src/journal', () => ({
  journalReadRecord: vi.fn(readImpl),
  journalCompareAndSwap: vi.fn(casImpl),
  journalSubscribe: vi.fn(subscribeImpl),
}));

const { addBookmark, removeBookmark, readBookmarks, subscribeBookmarks, parseBookmarkRecord, bookmarkKey, BOOKMARK_LIMIT } =
  await import('../apps/web/src/message-bookmarks');

const item = (id: string, role: 'user' | 'assistant' = 'user', savedAt = 1) => ({messageId: id, role, savedAt});
let seedSeq = 0;
const seed = (threadId: string, items: {messageId: string; role: 'user' | 'assistant'; savedAt: number}[]) =>
  store.set(bookmarkKey(threadId), {value: {version: 1, items}, updatedAt: 1, generation: `g${seedSeq++}`});

beforeEach(async () => {
  store.clear(); subscribers.clear(); failReads = failWrites = 0;
  const journal = await import('../apps/web/src/journal');
  vi.mocked(journal.journalReadRecord).mockImplementation(readImpl);
  vi.mocked(journal.journalCompareAndSwap).mockImplementation(casImpl);
  vi.mocked(journal.journalSubscribe).mockImplementation(subscribeImpl);
});

describe('record validation', () => {
  it('accepts a strict version-1 record and normalizes order newest-first', () => {
    const parsed = parseBookmarkRecord({version: 1, items: [item('m2', 'assistant', 5), item('m1', 'user', 9)]});
    expect(parsed?.items.map(row => row.messageId)).toEqual(['m1', 'm2']);
  });
  it('rejects malformed, oversized, duplicated and unsupported records', () => {
    expect(parseBookmarkRecord({version: 2, items: []})).toBeUndefined();
    expect(parseBookmarkRecord({version: 1, items: 'x'})).toBeUndefined();
    expect(parseBookmarkRecord({version: 1, items: [{...item('m1'), body: 'leak'}]})).toBeUndefined();
    expect(parseBookmarkRecord({version: 1, items: [{messageId: '', role: 'user', savedAt: 1}]})).toBeUndefined();
    expect(parseBookmarkRecord({version: 1, items: [{messageId: 'm1', role: 'activity', savedAt: 1}]})).toBeUndefined();
    expect(parseBookmarkRecord({version: 1, items: [{messageId: 'm1', role: 'user', savedAt: 1.5}]})).toBeUndefined();
    expect(parseBookmarkRecord({version: 1, items: [item('m1'), item('m1', 'assistant')]})).toBeUndefined();
    expect(parseBookmarkRecord({version: 1, items: Array.from({length: BOOKMARK_LIMIT + 1}, (_, i) => item(`m${i}`))})).toBeUndefined();
  });
  it('keeps bookmark keys outside every draft-transfer prefix and serializes no body field', async () => {
    const key = bookmarkKey('thread-1');
    for (const prefix of ['draft:', 'thinking:', 'state:', 'request:', 'source-context:', 'skill-draft:'])
      expect(key.startsWith(prefix)).toBe(false);
    await addBookmark('thread-1', {messageId: 'm1', role: 'user'});
    const value = store.get(key)?.value as {items: Record<string, unknown>[]};
    expect(Object.keys(value.items[0]).sort()).toEqual(['messageId', 'role', 'savedAt']);
  });
});

describe('add/remove', () => {
  it('saves both roles idempotently with newest first', async () => {
    expect(await addBookmark('t1', {messageId: 'm1', role: 'user'})).toBe('saved');
    expect(await addBookmark('t1', {messageId: 'm2', role: 'assistant'})).toBe('saved');
    expect(await addBookmark('t1', {messageId: 'm1', role: 'user'})).toBe('already');
    const list = await readBookmarks('t1');
    expect(list.kind).toBe('ready');
    if (list.kind !== 'ready') return;
    expect(list.items.map(row => [row.messageId, row.role])).toEqual([['m2', 'assistant'], ['m1', 'user']]);
  });
  it('keeps independent records per thread', async () => {
    await addBookmark('t1', {messageId: 'm1', role: 'user'});
    await addBookmark('t2', {messageId: 'm2', role: 'user'});
    const [a, b] = await Promise.all([readBookmarks('t1'), readBookmarks('t2')]);
    expect(a.kind === 'ready' && a.items[0].messageId).toBe('m1');
    expect(b.kind === 'ready' && b.items[0].messageId).toBe('m2');
    expect((await readBookmarks('t3')).kind).toBe('empty');
  });
  it('removes an existing bookmark and reports absent otherwise', async () => {
    seed('t1', [item('m1'), item('m2')]);
    expect(await removeBookmark('t1', 'm1')).toBe('removed');
    expect(await removeBookmark('t1', 'm1')).toBe('absent');
    const list = await readBookmarks('t1');
    expect(list.kind === 'ready' && list.items.length).toBe(1);
  });
  it('refuses the 101st bookmark without evicting', async () => {
    seed('t1', Array.from({length: BOOKMARK_LIMIT}, (_, i) => item(`m${i}`, 'user', i)));
    expect(await addBookmark('t1', {messageId: 'new-id', role: 'user'})).toBe('full');
    expect((store.get(bookmarkKey('t1'))!.value as {items: unknown[]}).items.length).toBe(BOOKMARK_LIMIT);
    expect(await removeBookmark('t1', 'm0')).toBe('removed');
    expect(await addBookmark('t1', {messageId: 'new-id', role: 'user'})).toBe('saved');
  });
  it('retries a CAS conflict, then reports conflict after three attempts', async () => {
    seed('t1', [item('m1')]);
    const {journalCompareAndSwap} = await import('../apps/web/src/journal');
    let calls = 0;
    vi.mocked(journalCompareAndSwap).mockImplementationOnce(async (key, generation, value) => {
      calls++;
      seed('t1', [item('m1'), item('other')]); // a competing write
      expect(store.get(key)?.generation).not.toBe(generation);
      return false;
    });
    expect(await addBookmark('t1', {messageId: 'm9', role: 'user'})).toBe('saved');
    expect(calls).toBe(1);

    vi.mocked(journalCompareAndSwap).mockImplementation(async () => { seed('t1', [item('flip')]); return false; });
    expect(await addBookmark('t1', {messageId: 'm10', role: 'user'})).toBe('conflict');
  });
});

describe('failure visibility', () => {
  it('reports corrupt records without overwriting them', async () => {
    store.set(bookmarkKey('t1'), {value: {version: 9, items: []}, updatedAt: 1, generation: 'corrupt'});
    expect((await readBookmarks('t1')).kind).toBe('corrupt');
    expect(await addBookmark('t1', {messageId: 'm1', role: 'user'})).toBe('corrupt');
    expect((store.get(bookmarkKey('t1'))!.value as {version: number}).version).toBe(9);
  });
  it('surfaces storage failures as unsaved and leaves durable state intact', async () => {
    seed('t1', [item('m1')]);
    failReads = 1;
    expect(await addBookmark('t1', {messageId: 'm2', role: 'user'})).toBe('failed');
    failWrites = 1;
    expect(await addBookmark('t1', {messageId: 'm2', role: 'user'})).toBe('failed');
    const list = await readBookmarks('t1');
    expect(list.kind === 'ready' && list.items.length).toBe(1);
    failReads = 3;
    expect((await readBookmarks('t1')).kind).toBe('unavailable');
  });
});

describe('subscription', () => {
  it('publishes committed list changes to same-profile subscribers', async () => {
    const seen: string[] = [];
    const off = subscribeBookmarks('t1', list => seen.push(list.kind));
    await addBookmark('t1', {messageId: 'm1', role: 'assistant'});
    expect(seen).toEqual(['ready']);
    off();
    await addBookmark('t1', {messageId: 'm2', role: 'user'});
    expect(seen).toEqual(['ready']);
  });
});
