import { HarnessError, type TaskMemory } from '../contracts/index.ts';
import type { Store } from '../storage/store.ts';

export const MEMORY_LIMITS = { entries: 12, entryBytes: 768, totalBytes: 4096 } as const;
const idFor = (threadId: string, key: string) => `${threadId}:${key}`;
export function taskMemories(store: Store, threadId: string): TaskMemory[] {
  return store.all<TaskMemory>('taskMemory', threadId).sort((a, b) => a.key.localeCompare(b.key));
}
/** Invoke inside the owning command transaction. Notes never grant capabilities. */
export function changeTaskMemory(store: Store, threadId: string, action: 'save' | 'delete', args: Record<string, unknown>, author: 'user' | 'agent'): TaskMemory | { deleted: true } {
  const key = args.key;
  if (typeof key !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(key)) throw new HarnessError('INVALID_MEMORY', 'Choose a short note key using letters, digits, periods or dashes.');
  const old = store.get<TaskMemory>('taskMemory', idFor(threadId, key));
  if (action === 'delete' && !old) throw new HarnessError('NOT_FOUND', 'This thread has no note with that key.');
  if (!Number.isSafeInteger(args.baseRevision) || args.baseRevision !== (old?.revision ?? 0)) throw new HarnessError('STALE_MEMORY', 'This note changed. Inspect it before saving again.');
  if (action === 'delete') { store.put('memoryVersion', idFor(threadId, key), threadId, { revision: old!.revision }); store.remove('taskMemory', idFor(threadId, key)); return { deleted: true }; }
  const content = args.content;
  if (typeof content !== 'string' || !content.trim() || Buffer.byteLength(content) > MEMORY_LIMITS.entryBytes || /\b(?:sk-(?:proj-|ant-)?[a-zA-Z0-9_-]{20,}|gh[pousr]_[a-zA-Z0-9]{20,}|AIza[a-zA-Z0-9_-]{25,})\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(content)) throw new HarnessError('INVALID_MEMORY', 'Keep notes brief and omit passwords, tokens and private keys.');
  const others = taskMemories(store, threadId).filter(note => note.key !== key);
  if (others.length >= MEMORY_LIMITS.entries || Buffer.byteLength(JSON.stringify([...others.map(({ key, content }) => ({ key, content })), { key, content }])) > MEMORY_LIMITS.totalBytes) throw new HarnessError('MEMORY_FULL', 'Thread notes are full. Shorten or forget an older note first.');
  const previousRevision = old?.revision ?? store.get<{ revision: number }>('memoryVersion', idFor(threadId, key))?.revision ?? 0;
  const note: TaskMemory = { id: idFor(threadId, key), threadId, key, content: content.trim(), revision: previousRevision + 1, author, updatedAt: new Date().toISOString() };
  store.put('taskMemory', note.id, threadId, note);
  return note;
}
export function taskMemoryContext(store: Store, threadId: string): string | undefined {
  const notes = taskMemories(store, threadId);
  return notes.length ? JSON.stringify(notes.map(({ key, content }) => ({ key, content }))) : undefined;
}
