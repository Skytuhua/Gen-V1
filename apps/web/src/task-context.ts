import { createContext, useContext, useRef, useState } from 'react';

export const ArtifactTitle = createContext('');
export const ArtifactInline = createContext(false);
export const ArtifactActions = createContext<(actionId: string, payload?: unknown) => Promise<void>>(async () => {});
export const escapeKey = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');
export const statePath = (key: unknown) => `/values/${escapeKey(String(key))}`;
export const inputPath = (key: string) => `/inputs/${escapeKey(key)}`;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function mapActionPayload(props: Record<string, unknown>, values: unknown) {
  const state = record(values);
  return Object.fromEntries([...Object.entries(record(props.payload)), ...Object.entries(record(props.payloadFromState)).map(([name, key]) => [name, typeof key === 'string' && Object.hasOwn(state, key) ? state[key] : undefined])]);
}
export function useTaskAction() {
  const action = useContext(ArtifactActions);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (actionId: string, payload: unknown) => {
    if (pending.current) return false;
    pending.current = true; setBusy(true); setError('');
    try { await action(actionId, payload); return true; }
    catch (error) { setError(error instanceof Error ? error.message : 'The request failed. Try again.'); return false; }
    finally { pending.current = false; setBusy(false); }
  };
  return { run, busy, error };
}
