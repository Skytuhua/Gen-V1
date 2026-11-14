import { useCallback, useEffect, useRef, useState } from 'react';
import { createStateStore } from '@json-render/react';
import type { ArtifactRecord, Snapshot, UserStateRecord } from '../../../packages/contracts';
import { command, getSnapshot } from './api';
import { journalCompareAndSwap, journalRead, journalReadRecord, journalSubscribe, journalWrite } from './journal';

interface PendingState { baseRevision: number; values: Record<string, unknown> }
const clientId = crypto.randomUUID();
let clientSequence = 0;
interface SaveLane { revision: { current: number }; acknowledgedRevision: number; pending: { current: Promise<void> | null }; lease: { current: Promise<unknown> | null }; owner: symbol; action: Promise<unknown> | null }
const lanes = new Map<string, SaveLane>();

export function useArtifactState(artifact: ArtifactRecord, record: UserStateRecord | undefined, inputs: Record<string, unknown>, refresh: (snapshot: Snapshot) => void, editable=true) {
  const [store] = useState(() => createStateStore({ values: record?.values ?? {}, inputs }));
  const [status, setStatus] = useState('Saved');
  const [loaded, setLoaded] = useState(false);
  const [owner] = useState(() => Symbol(artifact.stateId));
  const [lane] = useState(() => {
    let lane = lanes.get(artifact.stateId);
    if (!lane) { lane = { revision: { current: record?.revision ?? 0 }, acknowledgedRevision: -1, pending: { current: null }, lease: { current: null }, owner, action: null }; lanes.set(artifact.stateId, lane); }
    lane.owner = owner;
    return lane;
  });
  const revision = lane.revision;
  const appliedRevision = useRef(record?.revision ?? 0);
  const dirty = useRef(false);
  const syncing = useRef(false);
  const generation = useRef(0);
  const pending = lane.pending;
  const leasePending = lane.lease;
  const refreshRef = useRef(refresh); refreshRef.current = refresh;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const key = `state:${artifact.stateId}`;
  const acquireLease = useCallback(() => leasePending.current ??= command('edit.begin', { stateId: artifact.stateId, fields: Object.keys(store.getSnapshot().values as object), clientId }, artifact.threadId).finally(() => { leasePending.current = null; }), [artifact.stateId, artifact.threadId, store]);

  const flush = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current);
    if (lane.action) await lane.action;
    if (pending.current) { await pending.current; if (dirty.current) return flush(); return; }
    if (!dirty.current || lane.owner !== owner) return;
    const task = async () => {
      const version = generation.current;
      const values = store.getSnapshot().values as Record<string, unknown>;
      setStatus('Saving…');
      try {
        const journalVersion = await journalWrite(key, { baseRevision: revision.current, values });
        await acquireLease();
        const baseRevision = revision.current;
        const receipt = await command('state.save', { stateId: artifact.stateId, baseRevision, values, clientId, clientSequence: ++clientSequence }, artifact.threadId);
        const accepted = receipt.result as UserStateRecord;
        if (accepted?.id !== artifact.stateId || !Number.isSafeInteger(accepted.revision)) throw new Error('Saved state is not present in the host receipt.');
        revision.current = Math.max(revision.current, accepted.revision);
        lane.acknowledgedRevision = revision.current;
        dirty.current = generation.current !== version;
        if (!await journalCompareAndSwap(key, journalVersion, null)) {
          const newer = await journalReadRecord<PendingState | null>(key);
          if (newer?.value && newer.value.baseRevision === baseRevision) await journalCompareAndSwap(key, newer.generation, { ...newer.value, baseRevision: revision.current });
        }
        await command('edit.end', { stateId: artifact.stateId, clientId }, artifact.threadId);
        setStatus(dirty.current ? 'Unsaved changes' : 'Saved');
        refreshRef.current(await getSnapshot());
      } catch (error) {
        setStatus(`Draft retained · ${error instanceof Error ? error.message : 'Save failed'}`);
        throw error;
      }
    };
    pending.current = task();
    try { await pending.current; } finally { pending.current = null; }
    if (dirty.current && lane.owner === owner) return flush();
  }, [artifact.stateId, artifact.threadId, key, store, acquireLease, lane, owner]);

  const submit = useCallback(async (send: (baseRevision: number, values: unknown) => Promise<unknown>) => {
    await flush();
    // Autosaves and subsequent mounts share this barrier until action acceptance
    // advances the host revision. Keep new values local while the action is pending.
    if (lane.action) await lane.action;
    const baseRevision = revision.current;
    const task = send(baseRevision, store.getSnapshot().values).then(async receipt => {
      revision.current = Math.max(revision.current, baseRevision + 1);
      lane.acknowledgedRevision = revision.current;
      const newer = await journalReadRecord<PendingState | null>(key);
      if (newer?.value && newer.value.baseRevision === baseRevision) await journalCompareAndSwap(key, newer.generation, { ...newer.value, baseRevision: revision.current });
      return receipt;
    });
    lane.action = task;
    try { return await task; } finally { lane.action = null; }
  }, [flush, lane, revision, store, key]);

  useEffect(() => {
    let alive = true;
    void journalRead<PendingState | null>(key).then(saved => {
      if (!alive) return;
      if (saved) {
        revision.current = Math.max(revision.current, lane.acknowledgedRevision, saved.baseRevision);
        store.set('/values', saved.values);
        dirty.current = true;
        setStatus('Recovered draft · save to sync');
      }
      setLoaded(true);
    }).catch(() => { if (alive) { setStatus('Local journal unavailable'); setLoaded(true); } });
    return () => { alive = false; clearTimeout(timer.current); };
  }, [key, store]);

  useEffect(() => {
    if (!loaded || !editable) return;
    let alive = true;
    const restore = (value: unknown) => {
      if (!alive) return;
      if (!value || typeof value !== 'object' || Array.isArray(value) || dirty.current || pending.current || lane.action) return;
      const saved = value as Partial<PendingState>;
      if (saved.baseRevision !== revision.current || !saved.values || typeof saved.values !== 'object' || Array.isArray(saved.values)) return;
      syncing.current = true;
      try { store.set('/values', saved.values); } finally { syncing.current = false; }
      dirty.current = true; lane.owner = owner; generation.current += 1;
      setStatus('Recovered draft · save to sync');
    };
    const unsubscribe = journalSubscribe(key, restore);
    void journalReadRecord<PendingState | null>(key).then(saved => restore(saved?.value)).catch(() => {});
    return () => { alive = false; unsubscribe(); };
  }, [loaded, editable, key, store, lane, owner]);

  useEffect(() => {
    if (!loaded || !editable) return;
    let values = store.getSnapshot().values;
    return store.subscribe(() => {
      const next = store.getSnapshot().values;
      if (next === values) return;
      values = next;
      if (syncing.current) return;
      dirty.current = true;
      lane.owner = owner;
      generation.current += 1;
      setStatus('Unsaved changes');
      void acquireLease().catch(error => setStatus(`Draft retained · ${error instanceof Error ? error.message : 'Lease failed'}`));
      void journalWrite(key, { baseRevision: revision.current, values: next }).catch(() => setStatus('Local journal failed · keep this tab open'));
      clearTimeout(timer.current);
      timer.current = setTimeout(() => { void flush().catch(() => {}); }, 500);
    });
  }, [store, loaded, key, flush, acquireLease, lane, owner,editable]);

  useEffect(() => {
    store.set('/inputs', inputs);
    // A save receipt can advance the revision before its full snapshot arrives.
    if (!loaded || dirty.current || !record || record.revision <= appliedRevision.current || record.revision < revision.current) return;
    revision.current = Math.max(revision.current, record.revision);
    appliedRevision.current = record.revision;
    // Suppress autosave for an accepted host update.
    const values = record.values;
    syncing.current = true;
    try { store.set('/values', values); } finally { syncing.current = false; }
    setStatus('Saved');
  }, [inputs, record, loaded, store]);

  const release=useCallback(async()=>{try{await flush();}finally{await command('edit.end',{stateId:artifact.stateId,clientId},artifact.threadId);}},[flush,artifact.stateId,artifact.threadId]);
  return { store, status, loaded, flush, submit, release,dirty, clientId, getRevision: () => revision.current };
}
