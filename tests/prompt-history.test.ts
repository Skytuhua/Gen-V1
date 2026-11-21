import {expect, it} from 'vitest';
import type {Message, Thread} from '../packages/contracts';
import {collectPromptHistory, promptText, searchPromptHistory, stepHistory, EXCERPT_MARKER, HISTORY_LIMIT, SEARCH_LIMIT, type PromptHistoryEntry} from '../apps/web/src/prompt-history';

const thread = (id: string, title = id): Thread => ({id, title, projectName: null, updatedAt: '2026-11-01T00:00:00Z', createdAt: '2026-11-01T00:00:00Z', status: 'ready', epoch: 0, runId: null, modelId: null, sessionPath: null});
const user = (id: string, threadId: string, content: string, createdAt = `2026-11-01T00:00:${id.padStart(2, '0')}Z`): Message => ({id, threadId, role: 'user', content, createdAt, runId: null});

it('orders the current thread first, then other threads by createdAt, and keeps only user prompts', () => {
  const entries = collectPromptHistory({
    threads: [thread('a'), thread('b')],
    currentThreadId: 'a',
    messages: [
      user('01', 'a', 'alpha a'),
      {id: '02', threadId: 'a', role: 'assistant', content: 'reply', createdAt: '2026-11-01T00:00:02Z', runId: null},
      user('03', 'b', 'other beta', '2026-11-02T00:00:00Z'),
      user('04', 'a', 'alpha b', '2026-11-03T00:00:00Z'),
      {id: '05', threadId: 'b', role: 'activity', content: 'act', createdAt: '2026-11-04T00:00:00Z', runId: null},
      user('06', 'ghost', 'unknown thread', '2026-11-05T00:00:00Z'),
    ],
  });
  expect(entries.map(entry => entry.text)).toEqual(['alpha b', 'alpha a', 'other beta']);
  expect(entries.map(entry => entry.current)).toEqual([true, true, false]);
});

it('excludes messages of archived threads because they are absent from snapshot.threads', () => {
  const entries = collectPromptHistory({
    threads: [thread('live')],
    messages: [user('01', 'arch', 'old prompt'), user('02', 'live', 'new prompt')],
  });
  expect(entries.map(entry => entry.text)).toEqual(['new prompt']);
});

it('strips terminal excerpt blocks and drops excerpt-only messages', () => {
  expect(promptText(`fix it${EXCERPT_MARKER}"p" · terminal "t"\nstuff\nEnd terminal excerpt`)).toBe('fix it');
  expect(promptText('Terminal excerpt · project "p"\nstuff')).toBe('');
  expect(promptText('   ')).toBe('');
  const entries = collectPromptHistory({
    threads: [thread('a')],
    messages: [
      user('01', 'a', `keep me${EXCERPT_MARKER}"p"\nx\nEnd terminal excerpt`),
      user('02', 'a', 'Terminal excerpt · project "p"\nonly'),
    ],
  });
  expect(entries.map(entry => entry.text)).toEqual(['keep me']);
});

it('collapses consecutive duplicates keeping the newest', () => {
  const entries = collectPromptHistory({
    threads: [thread('a')],
    messages: [
      user('01', 'a', 'same', '2026-11-01T00:00:01Z'),
      user('02', 'a', 'same   ', '2026-11-01T00:00:02Z'),
      user('03', 'a', 'different', '2026-11-01T00:00:03Z'),
      user('04', 'a', 'same', '2026-11-01T00:00:04Z'),
    ],
  });
  expect(entries.map(entry => entry.id)).toEqual(['04', '03', '02']);
});

it('merges the older page into the current thread and de-duplicates by message id', () => {
  const entries = collectPromptHistory({
    threads: [thread('a'), thread('b')],
    currentThreadId: 'a',
    messages: [user('03', 'a', 'newest a', '2026-11-03T00:00:00Z'), user('04', 'b', 'other', '2026-11-04T00:00:00Z')],
    older: [user('01', 'a', 'oldest a', '2026-11-01T00:00:00Z'), user('03', 'a', 'dup', '2026-11-03T00:00:00Z'), user('05', 'b', 'not current', '2026-11-05T00:00:00Z')],
  });
  expect(entries.map(entry => entry.text)).toEqual(['newest a', 'oldest a', 'other']);
});

it('caps history at the limit', () => {
  const messages = Array.from({length: HISTORY_LIMIT + 10}, (_, i) => user(`m${i}`, 'a', `p${i}`, `2026-11-${String(1 + (i % 28)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z`));
  expect(collectPromptHistory({threads: [thread('a')], messages}).length).toBe(HISTORY_LIMIT);
});

it('search is case-insensitive, keeps order and caps rows', () => {
  const base = collectPromptHistory({threads: [thread('a')], messages: [user('01', 'a', 'Alpha'), user('02', 'a', 'beta ALPHA two'), user('03', 'a', 'gamma')]});
  expect(searchPromptHistory(base, 'alpha').map(e => e.text)).toEqual(['beta ALPHA two', 'Alpha']);
  const many: PromptHistoryEntry[] = Array.from({length: SEARCH_LIMIT + 5}, (_, i) => ({id: `e${i}`, threadId: 'a', text: `p${i}`, createdAt: '', current: true}));
  expect(searchPromptHistory(many, '').length).toBe(SEARCH_LIMIT);
  expect(searchPromptHistory(base, 'zzz')).toEqual([]);
});

it('steps older from idle only with an empty draft, newer past the start restores the stash', () => {
  const entries = collectPromptHistory({threads: [thread('a')], messages: [user('01', 'a', 'first'), user('02', 'a', 'second', '2026-11-02T00:00:00Z')]});
  expect(stepHistory({mode: 'idle'}, entries, 'older', 'typed draft')).toBeNull();
  expect(stepHistory({mode: 'idle'}, [], 'older', '')).toBeNull();
  const one = stepHistory({mode: 'idle'}, entries, 'older', '')!;
  expect(one.text).toBe('second');
  const two = stepHistory(one.state, entries, 'older', '')!;
  expect(two.text).toBe('first');
  expect(stepHistory(two.state, entries, 'older', '')).toBeNull();
  const back = stepHistory(two.state, entries, 'newer', '')!;
  expect(back.text).toBe('second');
  const out = stepHistory(one.state, entries, 'newer', '')!;
  expect(out.state.mode).toBe('idle');
  expect(out.text).toBe('');
});

it('stashed whitespace drafts come back exactly', () => {
  const entries = collectPromptHistory({threads: [thread('a')], messages: [user('01', 'a', 'p')]});
  const step = stepHistory({mode: 'idle'}, entries, 'older', '   ')!;
  expect(step.state.mode).toBe('browsing');
  const out = stepHistory(step.state, entries, 'newer', '')!;
  expect(out.text).toBe('   ');
});
