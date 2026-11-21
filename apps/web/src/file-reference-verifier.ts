import { useEffect, useRef, useSyncExternalStore } from 'react';
import { authenticated, read } from './api';
import { referenceFolder } from './file-references';

export interface FileReferenceOwner { projectId: string; threadId: string }
export type FileReferenceStatus = 'unknown' | 'file' | 'absent';
export interface FileReferenceVerifier {
  status(path: string): FileReferenceStatus;
  request(path: string): void;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

interface FolderEntry { name: string; kind: string }
type FolderRecord = { at: number; files: Set<string> } | { at: number; failed: true };
type FetchFolder = (folder: string, signal: AbortSignal) => Promise<{ entries: FolderEntry[] }>;

const TTL = 30_000, MAX_INFLIGHT = 4;

export function createFileReferenceVerifier(owner: FileReferenceOwner, options: { ttlMs?: number; concurrency?: number; fetchFolder?: FetchFolder } = {}): FileReferenceVerifier {
  const ttl = options.ttlMs ?? TTL, concurrency = options.concurrency ?? MAX_INFLIGHT;
  const fetchFolder: FetchFolder = options.fetchFolder ?? (async (folder, signal) => {
    const query = new URLSearchParams({ threadId: owner.threadId });
    if (folder) query.set('path', folder);
    return read<{ entries: FolderEntry[] }>(await authenticated(() => fetch(`/api/projects/${encodeURIComponent(owner.projectId)}/files?${query}`, { credentials: 'same-origin', cache: 'no-store', signal })));
  });
  const folders = new Map<string, FolderRecord | Promise<void>>();
  const queue: string[] = [];
  const inflight = new Map<string, AbortController>();
  const listeners = new Set<() => void>();
  let disposed = false;
  const notify = () => { for (const listener of listeners) listener(); };

  const status = (path: string): FileReferenceStatus => {
    const record = folders.get(referenceFolder(path));
    if (!record || record instanceof Promise) return 'unknown';
    if ('failed' in record) return 'absent';
    if (record.at + ttl < Date.now()) return 'unknown';
    return record.files.has(referenceFileName(path)) ? 'file' : 'absent';
  };
  const referenceFileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

  const pump = () => {
    if (disposed) return;
    while (inflight.size < concurrency && queue.length) {
      const folder = queue.shift()!;
      const control = new AbortController();
      inflight.set(folder, control);
      const pending = fetchFolder(folder, control.signal)
        .then(result => { folders.set(folder, { at: Date.now(), files: new Set(result.entries.filter(entry => entry.kind === 'file').map(entry => entry.name)) }); })
        .catch(() => { folders.set(folder, { at: Date.now(), failed: true }); })
        .finally(() => { inflight.delete(folder); notify(); pump(); });
      folders.set(folder, pending);
    }
  };
  const request = (path: string) => {
    const folder = referenceFolder(path);
    const record = folders.get(folder);
    if (record instanceof Promise || (record && record.at + ttl >= Date.now()) || queue.includes(folder) || inflight.has(folder)) return;
    queue.push(folder);
    pump();
  };
  return {
    status, request,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() {
      disposed = true;
      queue.length = 0;
      for (const control of inflight.values()) control.abort();
      listeners.clear();
    },
  };
}

/** Requests verification once the element nears the viewport; re-renders when the folder listing lands. */
export function useFileReferenceStatus(path: string, verifier: FileReferenceVerifier | null): readonly [FileReferenceStatus, React.RefObject<HTMLSpanElement | null>] {
  const element = useRef<HTMLSpanElement | null>(null);
  const subscribe = (listener: () => void) => verifier?.subscribe(listener) ?? (() => {});
  const status = useSyncExternalStore(subscribe, () => verifier?.status(path) ?? 'absent');
  useEffect(() => {
    if (!verifier || status !== 'unknown') return;
    const node = element.current;
    if (!node || typeof IntersectionObserver !== 'function') { verifier.request(path); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { verifier.request(path); observer.disconnect(); }
    }, { rootMargin: '200px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [verifier, path, status]);
  return [status, element] as const;
}
