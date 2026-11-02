import type { Message, Thread } from '../../../packages/contracts';
import type { UiPreferences } from '../../../packages/contracts/preferences';

export function matchingThreads(threads: readonly Thread[], messages: readonly Pick<Message, 'threadId' | 'content'>[], search: string, order: UiPreferences['projectOrder']): Thread[] {
  const query = search.toLocaleLowerCase(), histories = new Map<string, string[]>();
  if (query) for (const message of messages) {
    const id = message.threadId;
    if (!histories.has(id)) histories.set(id, []);
    histories.get(id)!.push(message.content);
  }
  return threads.filter(item => !item.sideParentId && (!query || `${item.title} ${item.projectName ?? ''} ${histories.get(item.id)?.join(' ') ?? ''}`.toLocaleLowerCase().includes(query))).toSorted((a, b) => order === 'manual' ? (a.presentation?.order ?? 0) - (b.presentation?.order ?? 0) || b.updatedAt.localeCompare(a.updatedAt) : b.updatedAt.localeCompare(a.updatedAt));
}
