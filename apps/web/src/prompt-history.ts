import type {Message, Thread} from '../../../packages/contracts';

export interface PromptHistoryEntry { id: string; threadId: string; text: string; createdAt: string; current: boolean }
export const EXCERPT_MARKER = '\n\nTerminal excerpt · project ';
export const EXCERPT_PREFIX = 'Terminal excerpt · project ';
export const HISTORY_LIMIT = 1000, SEARCH_LIMIT = 50;

/** The text the user typed, without appended terminal-excerpt blocks; '' when nothing speakable remains. */
export function promptText(content: string): string {
  const marker = content.indexOf(EXCERPT_MARKER);
  const text = (marker === -1 ? content : content.slice(0, marker));
  if (text.trimStart().startsWith(EXCERPT_PREFIX)) return '';
  return text.trim();
}

const byNewest = (a: {createdAt: string}, b: {createdAt: string}) => b.createdAt.localeCompare(a.createdAt);

/** User prompts, newest first, current thread before every other thread; cleaned, de-duplicated, capped. */
export function collectPromptHistory(input: {messages: readonly Message[]; threads: readonly Thread[]; currentThreadId?: string; older?: readonly Message[]}): PromptHistoryEntry[] {
  const threadIds = new Set(input.threads.map(thread => thread.id));
  const seen = new Set<string>(), pool: {message: Message; current: boolean}[] = [];
  const add = (message: Message, current: boolean) => {
    if (seen.has(message.id)) return;
    seen.add(message.id);
    pool.push({message, current});
  };
  for (const message of input.messages) if (message.role === 'user' && threadIds.has(message.threadId)) add(message, message.threadId === input.currentThreadId);
  for (const message of input.older ?? []) if (message.role === 'user' && message.threadId === input.currentThreadId) add(message, true);
  const collect = (current: boolean) => pool
    .filter(item => item.current === current)
    .sort((a, b) => byNewest(a.message, b.message))
    .flatMap(item => {
      const text = promptText(item.message.content);
      return text ? [{id: item.message.id, threadId: item.message.threadId, text, createdAt: item.message.createdAt, current}] : [];
    });
  const entries: PromptHistoryEntry[] = [];
  for (const entry of [...collect(true), ...collect(false)]) {
    const previous = entries[entries.length - 1];
    if (previous && previous.text.replace(/\s+$/, '') === entry.text.replace(/\s+$/, '')) continue;
    entries.push(entry);
    if (entries.length >= HISTORY_LIMIT) break;
  }
  return entries;
}

export function searchPromptHistory(entries: readonly PromptHistoryEntry[], query: string): PromptHistoryEntry[] {
  const q = query.trim().toLowerCase();
  return (q ? entries.filter(entry => entry.text.toLowerCase().includes(q)) : [...entries]).slice(0, SEARCH_LIMIT);
}

export type HistoryState = {mode: 'idle'} | {mode: 'browsing'; index: number; entryId: string; stash: string};

/** One history step. Returns the text to show, or null when the key must keep its default caret behavior. */
export function stepHistory(state: HistoryState, entries: readonly PromptHistoryEntry[], direction: 'older' | 'newer', draft: string): {state: HistoryState; text: string} | null {
  if (direction === 'older') {
    if (state.mode === 'idle') return draft.trim() || !entries.length ? null : {state: {mode: 'browsing', index: 0, entryId: entries[0]!.id, stash: draft}, text: entries[0]!.text};
    const next = state.index + 1;
    return next >= entries.length ? null : {state: {...state, index: next, entryId: entries[next]!.id}, text: entries[next]!.text};
  }
  if (state.mode === 'idle') return null;
  const next = state.index - 1;
  return next < 0 ? {state: {mode: 'idle'}, text: state.stash} : {state: {...state, index: next, entryId: entries[next]!.id}, text: entries[next]!.text};
}
