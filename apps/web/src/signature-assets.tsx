import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { useStateStore } from '@json-render/react';
import type { ResourceGrant } from '../../../packages/contracts';
import { MAX_SIGNATURE_PNG_BYTES, validateSignaturePng } from '../../../packages/ui-catalog/signature-data';
import { bootstrap, command, getResourceContent } from './api';

type Pending = { id: string; stateKey: string; base64: string; resourceId?: string; error?: string };
const prefix = 'harness:signature-assets:v1:';
const listeners = new Set<() => void>();
const inFlight = new Set<string>();
const preparationCounts=new Map<string,number>();
const cache = new Map<string, Uint8Array>();
let version = 0;
const emit = () => { version++; listeners.forEach(listener => listener()); };
const keyFor = (threadId: string, stateId = '') => `${prefix}${encodeURIComponent(threadId)}:${encodeURIComponent(stateId)}`;
const pathFor = (key: string) => `/values/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
function read(key: string): Pending[] {
  const raw = localStorage.getItem(key);
  if (!raw) return [];
  let records: unknown;
  try { records = JSON.parse(raw); }
  catch { throw new Error('The pending signature journal is invalid. Clear the mark to continue.'); }
  if (!Array.isArray(records) || records.length > 100 || records.some(record => !record || typeof record.id !== 'string' || typeof record.stateKey !== 'string' || typeof record.base64 !== 'string' || record.base64.length > 700_000)) throw new Error('The pending signature journal is invalid. Clear the mark to continue.');
  return records;
}
function write(key: string, records: Pending[]) {
  if (records.length) localStorage.setItem(key, JSON.stringify(records)); else localStorage.removeItem(key);
  emit();
}
export function hasPendingDocumentAssets(threadId?: string, stateId?: string) {
  if (threadId !== undefined && stateId !== undefined) {const key=keyFor(threadId,stateId);return (preparationCounts.get(key)??0)>0||read(key).length>0;}
  const start = threadId === undefined ? prefix : `${prefix}${encodeURIComponent(threadId)}:`;
  if([...preparationCounts].some(([key,count])=>key.startsWith(start)&&count>0))return true;
  for (let index = 0; index < localStorage.length; index++) { const key = localStorage.key(index); if (key?.startsWith(start) && read(key).length) return true; }
  return false;
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function base64Bytes(value: string) { return Uint8Array.from(atob(value), character => character.charCodeAt(0)); }
export function pngDataUrl(bytes: Uint8Array) {
  let binary = ''; for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return `data:image/png;base64,${btoa(binary)}`;
}

export async function fetchSignaturePng(resourceId: string, signal?: AbortSignal): Promise<Uint8Array> {
  if (!/^[^\u0000-\u0020/\\?#]{1,200}$/.test(resourceId) || ['.', '..'].includes(resourceId)) throw new Error('Choose a signature resource belonging to this thread.');
  const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(new Error('The signature PNG download timed out. Retry the preview.')), 15_000);
  const boundedSignal = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
  try {
  await bootstrap(); boundedSignal.throwIfAborted();
  const response = await getResourceContent(resourceId, '', boundedSignal);
  if (!response.ok || !response.body) throw new Error('The signature PNG is no longer available. Upload it again.');
  if (Number(response.headers.get('content-length')) > MAX_SIGNATURE_PNG_BYTES) { await response.body.cancel(); throw new Error('The signature PNG exceeds 512 KiB.'); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > MAX_SIGNATURE_PNG_BYTES) throw new Error('The signature PNG exceeds 512 KiB.'); chunks.push(part.value); } }
  catch (error) { await reader.cancel().catch(() => {}); throw error; } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  validateSignaturePng(bytes); return bytes;
  } finally { clearTimeout(timer); }
}

type Assets = { beginPreparation():()=>void; preview(stateKey: string): string | undefined; error(stateKey: string): string | undefined; save(stateKey: string, bytes: Uint8Array): void; clear(stateKey: string): void; retry(): void; get(resourceId: string, signal?: AbortSignal): Promise<Uint8Array> };
const Context = createContext<Assets | null>(null);
export const useDocumentAssets = () => useContext(Context);

/** Write-ahead PNG journal survives refresh; replay uses the same host command ID. */
export function DocumentAssetProvider({ threadId, stateId = '', active = true, children }: { threadId: string; stateId?: string; active?: boolean; children: ReactNode }) {
  const store = useStateStore(), key = keyFor(threadId, stateId);
  const revision = useSyncExternalStore(subscribe, () => version);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    for (const record of read(key)) {
      if (record.resourceId) { store.set(pathFor(record.stateKey), { kind: 'image', resourceId: record.resourceId }); write(key, read(key).filter(item => item.id !== record.id)); continue; }
      if (record.error || inFlight.has(record.id)) continue;
      inFlight.add(record.id);
      void Promise.resolve().then(() => { validateSignaturePng(base64Bytes(record.base64)); return command('resource.upload', { name: 'signature.png', mimeType: 'image/png', base64: record.base64 }, threadId, record.id); }).then(receipt => {
        const grant = receipt.result as ResourceGrant;
        if (!grant || grant.threadId !== threadId || grant.kind !== 'attachment' || typeof grant.id !== 'string') throw new Error('The host did not return a signature resource for this thread.');
        const current = read(key); if (!current.some(item => item.id === record.id)) return;
        if (cache.size >= 64) cache.delete(cache.keys().next().value!);
        cache.set(`${threadId}:${grant.id}`, base64Bytes(record.base64));
        if (alive) { store.set(pathFor(record.stateKey), { kind: 'image', resourceId: grant.id }); write(key, current.filter(item => item.id !== record.id)); }
        else write(key, current.map(item => item.id === record.id ? { ...item, resourceId: grant.id } : item));
      }).catch(error => { write(key, read(key).map(item => item.id === record.id ? { ...item, error: error instanceof Error ? error.message : 'Signature upload failed. Retry to continue.' } : item)); }).finally(() => { inFlight.delete(record.id); emit(); });
    }
    return () => { alive = false; };
  }, [key, threadId, revision, store, active]);
  const value = useMemo<Assets>(() => ({
    beginPreparation:()=>{preparationCounts.set(key,(preparationCounts.get(key)??0)+1);emit();let completed=false;return()=>{if(completed)return;completed=true;const remaining=(preparationCounts.get(key)??1)-1;if(remaining>0)preparationCounts.set(key,remaining);else preparationCounts.delete(key);emit();};},
    preview: stateKey => { const record = read(key).find(item => item.stateKey === stateKey); return record ? `data:image/png;base64,${record.base64}` : undefined; },
    error: stateKey => read(key).find(item => item.stateKey === stateKey)?.error,
    save: (stateKey, bytes) => { validateSignaturePng(bytes); const record = { id: crypto.randomUUID(), stateKey, base64: pngDataUrl(bytes).split(',')[1] }; write(key, [...read(key).filter(item => item.stateKey !== stateKey), record]); },
    clear: stateKey => write(key, read(key).filter(item => item.stateKey !== stateKey)),
    retry: () => write(key, read(key).map(({ error: _error, ...record }) => record)),
    get: async (resourceId, signal) => { const identity = `${threadId}:${resourceId}`; const saved = cache.get(identity); if (saved) return saved.slice(); const bytes = await fetchSignaturePng(resourceId, signal); if (cache.size >= 64) cache.delete(cache.keys().next().value!); cache.set(identity, bytes); return bytes.slice(); },
  }), [key, threadId, revision]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
