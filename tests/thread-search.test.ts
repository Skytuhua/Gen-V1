import { expect, it } from 'vitest';
import type { Message, Thread } from '../packages/contracts';
import { matchingThreads } from '../apps/web/src/thread-search';

const thread = (id: string, title = id, projectName: string | null = null, updatedAt = '2026-11-01T00:00:00Z'): Thread => ({ id, title, projectName, updatedAt, createdAt: updatedAt, status: 'ready', epoch: 0, runId: null, modelId: null, sessionPath: null });
it('empty search never reads messages and excludes side conversations without mutating source order', () => {
  const threads = Object.freeze([thread('old'), { ...thread('side'), sideParentId: 'old' }, thread('new', 'New', null, '2026-11-02T00:00:00Z')]);
  const messages = new Proxy([] as Message[], { get() { throw new Error('Empty search must not inspect message history'); } });
  expect(matchingThreads(threads, messages, '', 'recent').map(item => item.id)).toEqual(['new', 'old']);
  expect(threads.map(item => item.id)).toEqual(['old', 'side', 'new']);
});
it('matches title, project and ordered cross-message phrases case-insensitively with one content read per message', () => {
  const threads = [thread('one', 'Refactor', 'Acme'), thread('two', 'Fix checkout')];
  let reads = 0, identities = 0;
  const messages = [{ get threadId() { identities++; return 'one'; }, get content() { reads++; return 'First'; } }, { get threadId() { identities++; return 'two'; }, get content() { reads++; return 'Unrelated'; } }, { get threadId() { identities++; return 'one'; }, get content() { reads++; return 'Second'; } }];
  expect(matchingThreads(threads, messages, 'first SECOND', 'recent').map(item => item.id)).toEqual(['one']);
  expect(reads).toBe(messages.length);
  expect(identities).toBe(messages.length);
  for (const search of ['REFACTOR', 'acme', 'Refactor Acme First', 'First Second']) expect(matchingThreads(threads, messages, search, 'recent').map(item => item.id)).toEqual(['one']);
  expect(matchingThreads(threads, messages, 'Second First', 'recent')).toEqual([]);
});
it('preserves literal whitespace search and manual ordering with updated-time ties', () => {
  const threads = [thread('old'), { ...thread('top'), presentation: { order: -1 } }, thread('new', 'New', null, '2026-11-02T00:00:00Z')];
  expect(matchingThreads(threads, [], ' ', 'manual').map(item => item.id)).toEqual(['top', 'new', 'old']);
  expect(matchingThreads(threads, [], '', 'created').map(item => item.id)).toEqual(['new', 'old', 'top']);
});

it('only shows historical hits for the current non-empty sidebar query', () => {
  const threads = [thread('historic'), thread('current', 'Second query'), {...thread('side'), sideParentId: 'historic'}];
  const historical = {query: 'first', ids: new Set(['historic', 'side'])};
  expect(matchingThreads(threads, [], 'first', 'recent', historical).map(item => item.id)).toEqual(['historic']);
  expect(matchingThreads(threads, [], 'second', 'recent', historical).map(item => item.id)).toEqual(['current']);
  expect(matchingThreads(threads, [], 'nothing', 'recent', historical)).toEqual([]);
});
