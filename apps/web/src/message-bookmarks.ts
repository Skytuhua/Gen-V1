import { journalCompareAndSwap, journalReadRecord, journalSubscribe } from './journal';

/**
 * Per-thread, per-profile message bookmarks. Records hold IDs and display
 * metadata only — never message bodies, transcripts, or owner authority.
 */
export interface MessageBookmark {
  readonly messageId: string;
  readonly role: 'user' | 'assistant';
  readonly savedAt: number;
}
export interface BookmarkRecord {
  readonly version: 1;
  readonly items: readonly MessageBookmark[];
}
export type BookmarkList =
  | { readonly kind: 'ready'; readonly items: readonly MessageBookmark[] }
  | { readonly kind: 'empty' }
  | { readonly kind: 'corrupt' }
  | { readonly kind: 'unavailable' };
export type BookmarkWrite =
  | 'saved'
  | 'removed'
  | 'already'
  | 'absent'
  | 'full'
  | 'corrupt'
  | 'conflict'
  | 'failed';

export const BOOKMARK_LIMIT = 100;
export const BOOKMARK_FULL_MESSAGE = 'This thread has 100 bookmarks. Remove one to save another.';
const MESSAGE_ID = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,199}$/;
const MAX_ATTEMPTS = 3;

/** One durable key per canonical local thread, outside the draft-transfer prefixes. */
export function bookmarkKey(threadId: string): string {
  return 'message-bookmarks:v1:' + JSON.stringify(threadId);
}

function eligibleId(messageId: unknown): messageId is string {
  return typeof messageId === 'string' && MESSAGE_ID.test(messageId);
}
function validItem(value: unknown): value is MessageBookmark {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).length === 3 &&
    eligibleId(item.messageId) &&
    (item.role === 'user' || item.role === 'assistant') &&
    Number.isSafeInteger(item.savedAt) && (item.savedAt as number) >= 0;
}
/** Strict shape only; a malformed or unsupported record is never rewritten. */
export function parseBookmarkRecord(value: unknown): BookmarkRecord | undefined {
  if (!value || typeof value !== 'object' || (value as {version?: unknown}).version !== 1) return;
  const items = (value as {items?: unknown}).items;
  if (!Array.isArray(items) || items.length > BOOKMARK_LIMIT || !items.every(validItem)) return;
  if (new Set(items.map(item => item.messageId)).size !== items.length) return;
  return {version: 1, items: [...items].sort((a, b) => b.savedAt - a.savedAt || (a.messageId < b.messageId ? 1 : -1))};
}

export async function readBookmarks(threadId: string): Promise<BookmarkList> {
  try {
    const record = await journalReadRecord<unknown>(bookmarkKey(threadId));
    if (!record) return {kind: 'empty'};
    const parsed = parseBookmarkRecord(record.value);
    if (!parsed) return {kind: 'corrupt'};
    return parsed.items.length ? {kind: 'ready', items: parsed.items} : {kind: 'empty'};
  } catch {
    return {kind: 'unavailable'};
  }
}

/** Same-profile notification via the existing journal subscription. */
export function subscribeBookmarks(threadId: string, listener: (list: BookmarkList) => void): () => void {
  return journalSubscribe(bookmarkKey(threadId), value => {
    if (value === undefined) { listener({kind: 'empty'}); return; }
    const parsed = parseBookmarkRecord(value);
    if (!parsed) { listener({kind: 'corrupt'}); return; }
    listener(parsed.items.length ? {kind: 'ready', items: parsed.items} : {kind: 'empty'});
  });
}

interface Mutation {
  /** Returns the replacement record, or a result short-circuit when no write is needed. */
  apply(items: readonly MessageBookmark[]): BookmarkRecord | BookmarkWrite;
  commit: BookmarkWrite;
}
async function mutate(threadId: string, mutation: Mutation): Promise<BookmarkWrite> {
  const key = bookmarkKey(threadId);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let record;
    try {
      record = await journalReadRecord<unknown>(key);
    } catch {
      return 'failed';
    }
    const parsed = parseBookmarkRecord(record?.value);
    if (record && !parsed) return 'corrupt';
    const applied = mutation.apply(parsed?.items ?? []);
    if (typeof applied === 'string') return applied;
    let committed: boolean;
    try {
      committed = await journalCompareAndSwap(key, record?.generation, applied);
    } catch {
      return 'failed';
    }
    if (committed) return mutation.commit;
  }
  return 'conflict';
}

/** Idempotent add: re-add of the same message is a no-op success signal, not a rewrite. */
export function addBookmark(threadId: string, input: { messageId: string; role: 'user' | 'assistant' }): Promise<BookmarkWrite> {
  if (!eligibleId(input.messageId)) return Promise.resolve('failed');
  return mutate(threadId, {
    apply: items => {
      if (items.some(item => item.messageId === input.messageId)) return 'already';
      if (items.length >= BOOKMARK_LIMIT) return 'full';
      const next = [...items, {messageId: input.messageId, role: input.role, savedAt: Date.now()}]
        .sort((a, b) => b.savedAt - a.savedAt || (a.messageId < b.messageId ? 1 : -1));
      return {version: 1, items: next};
    },
    commit: 'saved',
  });
}

export function removeBookmark(threadId: string, messageId: string): Promise<BookmarkWrite> {
  return mutate(threadId, {
    apply: items => {
      if (!items.some(item => item.messageId === messageId)) return 'absent';
      const next = items.filter(item => item.messageId !== messageId);
      return {version: 1, items: next};
    },
    commit: 'removed',
  });
}
