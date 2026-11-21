/**
 * Versioned renderer storage for read-aloud voice/rate choices (#1392).
 * Never persists browser voice objects; falls back to a session-only value
 * when localStorage is unavailable.
 */

export type ReadAloudRate = 0.75 | 1 | 1.25 | 1.5 | 2;
export interface ReadAloudPreferences { voiceURI: string | null; rate: ReadAloudRate; }

export const READ_ALOUD_STORAGE_KEY = 'harness:read-aloud:v1';
export const READ_ALOUD_RATES: readonly ReadAloudRate[] = [0.75, 1, 1.25, 1.5, 2];

const defaults: ReadAloudPreferences = { voiceURI: null, rate: 1 };
let sessionOnly: ReadAloudPreferences = { ...defaults };
let storageBlocked = false;

function storage(): Storage | null {
  if (storageBlocked) return null;
  try { return localStorage; } catch { storageBlocked = true; return null; }
}

let cached: ReadAloudPreferences | null = null;

export function readReadAloudPreferences(): ReadAloudPreferences {
  const store = storage();
  let raw: string | null = null;
  if (store) {
    try { raw = store.getItem(READ_ALOUD_STORAGE_KEY); } catch { storageBlocked = true; }
  }
  let value: ReadAloudPreferences;
  if (raw === null) value = { ...sessionOnly };
  else {
    try {
      const parsed = JSON.parse(raw) as { voiceURI?: unknown; rate?: unknown };
      value = {
        voiceURI: typeof parsed.voiceURI === 'string' ? parsed.voiceURI : null,
        rate: READ_ALOUD_RATES.includes(parsed.rate as ReadAloudRate) ? parsed.rate as ReadAloudRate : 1,
      };
    } catch { value = { ...defaults }; }
  }
  // Stable reference: useSyncExternalStore must see an identical object when nothing changed.
  if (!cached || cached.voiceURI !== value.voiceURI || cached.rate !== value.rate) cached = value;
  return cached;
}

export function writeReadAloudPreferences(next: ReadAloudPreferences): ReadAloudPreferences {
  const value: ReadAloudPreferences = {
    voiceURI: typeof next.voiceURI === 'string' ? next.voiceURI : null,
    rate: READ_ALOUD_RATES.includes(next.rate) ? next.rate : 1,
  };
  const store = storage();
  if (store) {
    try { store.setItem(READ_ALOUD_STORAGE_KEY, JSON.stringify(value)); } catch { storageBlocked = true; }
  }
  sessionOnly = value;
  notify();
  return value;
}

const listeners = new Set<(value: ReadAloudPreferences) => void>();
const notify = () => { const value = readReadAloudPreferences(); for (const listener of listeners) listener(value); };

/** Subscribe to preference changes; fires for same-document writes and cross-document `storage` events. */
export function subscribeReadAloudPreferences(listener: (value: ReadAloudPreferences) => void): () => void {
  listeners.add(listener);
  if (typeof window === 'undefined') return () => listeners.delete(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === READ_ALOUD_STORAGE_KEY) listener(readReadAloudPreferences());
  };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage); };
}

/** Test hook: reset the session-only fallback and blocked flag. */
export function resetReadAloudPreferencesForTest() {
  sessionOnly = { ...defaults };
  storageBlocked = false;
}
