import type { Message, Thread } from '../../../packages/contracts';
import type { UiPreferences } from '../../../packages/contracts/preferences';

export type HistoricalThreadMatches = {query: string; ids: ReadonlySet<string>};

export function matchingThreads(threads: readonly Thread[], messages: readonly Pick<Message, 'threadId' | 'content'>[], search: string, order: UiPreferences['projectOrder'], historical?: HistoricalThreadMatches): Thread[] {
  const query = search.toLowerCase(), histories = new Map<string, string[]>();
  if (query) for (const message of messages) {
    const id = message.threadId;
    if (!histories.has(id)) histories.set(id, []);
    histories.get(id)!.push(message.content);
  }
  const local = threads.filter(item => !item.sideParentId && (!query || `${item.title} ${item.projectName ?? ''} ${histories.get(item.id)?.join(' ') ?? ''}`.toLowerCase().includes(query))).toSorted((a, b) => order === 'manual' ? (a.presentation?.order ?? 0) - (b.presentation?.order ?? 0) || b.updatedAt.localeCompare(a.updatedAt) : b.updatedAt.localeCompare(a.updatedAt));
  const historyQuery = search.trim();
  if (!historyQuery || historical?.query !== historyQuery) return local;
  const localIds = new Set(local.map(item => item.id));
  return [...local, ...threads.filter(item => !item.sideParentId && historical.ids.has(item.id) && !localIds.has(item.id))];
}
