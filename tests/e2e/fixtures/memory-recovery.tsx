import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Snapshot, TaskMemory as Note } from '../../../packages/contracts';
import { TaskMemory } from '../../../apps/web/src/TaskMemory';
import * as journal from '../../../apps/web/src/journal';
import '@fontsource-variable/inter';
import '../../../apps/web/src/styles.css';
import '../../../apps/web/src/appearance.css';
import './memory-recovery.css';

export type Draft = { key: string; content: string; baseRevision: number };
export type Setup = { notes?: Note[]; drafts?: Record<string, Draft>; staged?: boolean; reads?: Record<string, 'hold' | 'fail'> };
const setup = (window as unknown as { memorySetup?: Setup }).memorySetup ?? {};
const reads = { ...setup.reads }, held = new Map<string, ((fail: boolean) => void)[]>(), counts: Record<string, number> = {};
await new Promise<void>((resolve, reject) => {
  const opening = indexedDB.open('generative-harness-journal', 1);
  opening.onupgradeneeded = () => opening.result.createObjectStore('entries');
  opening.onerror = () => reject(opening.error);
  opening.onsuccess = () => {
    const db = opening.result, transaction = db.transaction('entries', 'readwrite');
    for (const [key, value] of Object.entries(setup.drafts ?? {})) {
      const record = { value, generation: `synthetic:${key}`, updatedAt: Date.now() };
      if (setup.staged) localStorage.setItem(`harness:journal-pending:${encodeURIComponent(key)}`, JSON.stringify(record));
      else transaction.objectStore('entries').put(record, key);
    }
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => reject(transaction.error);
  };
});

// Delay only readonly journal responses; writes and CAS use the real browser transactions.
const nativeGet = IDBObjectStore.prototype.get, descriptor = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'onsuccess')!;
IDBObjectStore.prototype.get = function (key) {
  const request = nativeGet.call(this, key);
  if (this.name === 'entries' && this.transaction.mode === 'readonly' && String(key).startsWith('memory-draft:')) {
    const name = String(key); counts[name] = (counts[name] ?? 0) + 1;
    Object.defineProperty(request, 'onsuccess', { set(listener: (event: Event) => void) {
      descriptor.set!.call(request, (event: Event) => {
        const finish = (fail: boolean) => {
          if (fail) { Object.defineProperty(request, 'error', { value: new DOMException('Synthetic journal read failure') }); request.onerror?.call(request, new Event('error')); }
          else listener.call(request, event);
        };
        if (reads[name] === 'hold') held.set(name, [...(held.get(name) ?? []), finish]);
        else if (reads[name] === 'fail') { delete reads[name]; finish(true); }
        else finish(false);
      });
    } });
  }
  return request;
};

const initialNotes: Note[] = setup.notes ?? [{ id: 'synthetic-note', threadId: 'thread-a', key: 'decision', content: 'Saved decision.', revision: 3, author: 'user', updatedAt: '2026-11-07T00:00:00Z' }];
let change: (threadId: string) => void = () => {}, show: (value: boolean) => void = () => {}, publish: (notes: Note[]) => void = () => {};
const fixture = {
  counts, held: () => [...held.keys()],
  release: (key: string, fail = false) => { delete reads[key]; const callbacks = held.get(key) ?? []; held.delete(key); callbacks.forEach(finish => finish(fail)); },
  change: (threadId: string) => change(threadId), show: (value: boolean) => show(value), publish: (notes: Note[]) => publish(notes),
  read: (key: string) => journal.journalRead<Draft | null>(key), flush: journal.journalFlush,
};
Object.assign(window, { memoryFixture: fixture });
function Fixture() {
  const [threadId, setThreadId] = useState('thread-a'), [mounted, setMounted] = useState(true), [notes, setNotes] = useState(initialNotes);
  change = setThreadId; show = setMounted; publish = setNotes;
  return <main><p className="memory-fixture-label">Synthetic journal and API · production Thread memory</p>{mounted && <TaskMemory threadId={threadId} snapshot={{ memory: notes } as Snapshot} />}<div className="memory-fixture-controls"><button onClick={() => setThreadId(id => id === 'thread-a' ? 'thread-b' : 'thread-a')}>Switch synthetic thread</button><button onClick={() => setMounted(value => !value)}>Toggle memory</button></div></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
export type MemoryFixture = typeof fixture;
