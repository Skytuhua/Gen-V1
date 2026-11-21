/**
 * Read-aloud playback controller (#1392). One lazily created controller per
 * renderer Window; rows subscribe to a snapshot and issue commands. All
 * engine access goes through the injectable adapter so tests control voices
 * and utterance events without a DOM speech engine.
 */

import type { ReadAloudPreferences } from './read-aloud-preferences.ts';

export interface LocalVoice { voiceURI: string; name: string; lang: string; default: boolean; }

export interface ReadAloudUtterance {
  text: string;
  voice: unknown;
  lang: string;
  rate: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

export interface ReadAloudEngine {
  getVoices(): Array<{ voiceURI: string; name: string; lang: string; default: boolean; localService: boolean }>;
  speak(utterance: ReadAloudUtterance): void;
  cancel(): void;
  pause(): void;
  resume(): void;
  createUtterance(text: string): ReadAloudUtterance;
  addVoicesChangedListener(listener: () => void): () => void;
}

export type ReadAloudPhase = 'idle' | 'starting' | 'speaking' | 'paused';
export const READ_ALOUD_UNSUPPORTED = 'unavailable';
export const READ_ALOUD_ERROR_RETRY = 'Couldn\'t read this reply aloud. Try again or choose another local voice.';
export const READ_ALOUD_ERROR_NO_VOICE = 'No local speech voice is available. Check Windows speech settings and try again.';

export interface ReadAloudSnapshot {
  phase: ReadAloudPhase;
  /** Opaque owner token of the active session, or null. */
  owner: unknown;
  error: string | null;
  /** false when the API is missing; voices may still arrive asynchronously. */
  supported: boolean;
  voices: LocalVoice[];
}

export interface ReadAloudOwner { surface: object; threadId: string; messageId: string; }

const START_TIMEOUT_MS = 5000;
const END_DEADLINE_BASE_MS = 60000;

function defaultEngine(): ReadAloudEngine | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return null;
  const synthesis = window.speechSynthesis;
  return {
    // Return the native voice objects so they can be assigned back onto utterances.
    getVoices: () => synthesis.getVoices() as unknown as Array<{ voiceURI: string; name: string; lang: string; default: boolean; localService: boolean }>,
    speak: u => synthesis.speak(u as unknown as SpeechSynthesisUtterance),
    cancel: () => synthesis.cancel(),
    pause: () => synthesis.pause(),
    resume: () => synthesis.resume(),
    createUtterance: text => new SpeechSynthesisUtterance(text) as unknown as ReadAloudUtterance,
    addVoicesChangedListener: listener => {
      synthesis.addEventListener('voiceschanged', listener);
      return () => synthesis.removeEventListener('voiceschanged', listener);
    },
  };
}

/** Pick the explicit local voice, else the local default, else the first stable local voice. */
export function resolveLocalVoice<V extends { voiceURI: string; name: string; lang: string; default: boolean; localService: boolean }>(
  voices: V[],
  voiceURI: string | null,
): V | null {
  const local = voices.filter(v => v.localService === true);
  if (!local.length) return null;
  if (voiceURI) {
    const match = local.find(v => v.voiceURI === voiceURI);
    if (match) return match;
  }
  const automatic = local.find(v => v.default);
  if (automatic) return automatic;
  const sorted = [...local].sort((a, b) =>
    a.name.localeCompare(b.name) || a.lang.localeCompare(b.lang) || a.voiceURI.localeCompare(b.voiceURI));
  return sorted[0]!;
}

export function createReadAloudController(engine: ReadAloudEngine | null = defaultEngine()) {
  let phase: ReadAloudPhase = 'idle';
  let owner: ReadAloudOwner | null = null;
  let error: string | null = null;
  let voices: LocalVoice[] = [];
  let generation = 0;
  let chunks: string[] = [];
  let chunkIndex = 0;
  let rate = 1;
  let current: ReadAloudUtterance | null = null;
  let startTimer: ReturnType<typeof setTimeout> | undefined;
  let endTimer: ReturnType<typeof setTimeout> | undefined;
  let endDeadlineStarted = 0;
  let deferredNext = false;
  const listeners = new Set<(snapshot: ReadAloudSnapshot) => void>();

  const refreshVoices = () => {
    voices = engine ? engine.getVoices().filter(v => v.localService === true)
      .map(v => ({ voiceURI: v.voiceURI, name: v.name, lang: v.lang, default: v.default })) : [];
  };
  refreshVoices();
  const removeVoicesListener = engine?.addVoicesChangedListener(() => { refreshVoices(); emit(); });

  const snapshot = (): ReadAloudSnapshot => ({
    phase, owner, error, supported: engine !== null, voices,
  });
  const emit = () => { const s = snapshot(); for (const listener of listeners) listener(s); };

  const clearTimers = () => {
    clearTimeout(startTimer); startTimer = undefined;
    clearTimeout(endTimer); endTimer = undefined;
  };

  const endSession = (generationId: number, nextError: string | null, silent = false) => {
    if (generationId !== generation) return;
    generation++;
    clearTimers();
    current = null;
    chunks = [];
    deferredNext = false;
    phase = 'idle';
    owner = null;
    if (engine) {
      // Clear a possibly-latched native pause so the next Play is audible.
      try { engine.resume(); } catch { /* ignore */ }
    }
    if (!silent) error = nextError;
    emit();
  };

  const scheduleEndDeadline = (generationId: number) => {
    clearTimeout(endTimer);
    const timeout = Math.max(END_DEADLINE_BASE_MS, Math.round(END_DEADLINE_BASE_MS / rate));
    endDeadlineStarted = Date.now();
    endTimer = setTimeout(() => {
      if (generationId !== generation || phase === 'paused') return;
      endSession(generationId, READ_ALOUD_ERROR_RETRY);
    }, timeout);
  };

  const speakChunk = (generationId: number, index: number) => {
    if (generationId !== generation || !engine || index >= chunks.length) {
      if (index >= chunks.length && generationId === generation) endSession(generationId, null);
      return;
    }
    chunkIndex = index;
    const utterance = engine.createUtterance(chunks[index]!);
    const voice = resolved;
    utterance.voice = voice;
    utterance.lang = voice?.lang ?? '';
    utterance.rate = rate;
    utterance.onstart = () => {
      if (generationId !== generation) return;
      clearTimeout(startTimer);
      phase = 'speaking';
      scheduleEndDeadline(generationId);
      emit();
    };
    utterance.onend = () => {
      if (generationId !== generation) return;
      clearTimeout(endTimer);
      if (phase === 'paused') { deferredNext = true; return; }
      speakChunk(generationId, index + 1);
    };
    utterance.onerror = () => {
      if (generationId !== generation) return;
      // App-triggered interruption (cancel) is silent; engine errors are not.
      endSession(generationId, READ_ALOUD_ERROR_RETRY);
    };
    current = utterance;
    startTimer = setTimeout(() => {
      if (generationId !== generation) return;
      endSession(generationId, READ_ALOUD_ERROR_RETRY);
    }, START_TIMEOUT_MS);
    try { engine.speak(utterance); }
    catch { endSession(generationId, READ_ALOUD_ERROR_RETRY); }
  };

  let resolved: { voiceURI: string; name: string; lang: string; default: boolean; localService: boolean } | null = null;

  const play = (nextOwner: ReadAloudOwner, text: string[], prefs: ReadAloudPreferences) => {
    if (!engine) { error = READ_ALOUD_ERROR_NO_VOICE; emit(); return; }
    generation++;
    clearTimers();
    try { engine.cancel(); } catch { /* best effort */ }
    refreshVoices();
    resolved = resolveLocalVoice(engine.getVoices(), prefs.voiceURI);
    if (!resolved) { error = READ_ALOUD_ERROR_NO_VOICE; emit(); return; }
    error = null;
    owner = nextOwner;
    chunks = text.filter(chunk => chunk.length);
    rate = prefs.rate;
    chunkIndex = 0;
    deferredNext = false;
    phase = 'starting';
    emit();
    speakChunk(generation, 0);
  };

  return {
    play,
    pause() {
      if (!engine || (phase !== 'speaking' && phase !== 'starting')) return;
      try { engine.pause(); } catch { /* ignore */ }
      phase = 'paused';
      emit();
    },
    resume() {
      if (!engine || phase !== 'paused') return;
      try { engine.resume(); } catch { /* ignore */ }
      // Extend the end deadline by the time spent paused.
      if (endTimer !== undefined && current) {
        const elapsed = Date.now() - endDeadlineStarted;
        clearTimeout(endTimer);
        const remaining = Math.max(1000, Math.max(END_DEADLINE_BASE_MS, Math.round(END_DEADLINE_BASE_MS / rate)) - elapsed);
        const generationId = generation;
        endTimer = setTimeout(() => {
          if (generationId !== generation || phase === 'paused') return;
          endSession(generationId, READ_ALOUD_ERROR_RETRY);
        }, remaining);
      }
      phase = 'speaking';
      emit();
      if (deferredNext) { deferredNext = false; speakChunk(generation, chunkIndex + 1); }
    },
    stop() { endSession(generation, null, true); error = null; },
    stopOwner(token: ReadAloudOwner) { if (owner === token) endSession(generation, null, true); error = null; },
    refreshVoices() { refreshVoices(); emit(); },
    subscribe(listener: (s: ReadAloudSnapshot) => void) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
    dispose() {
      generation++;
      clearTimers();
      if (engine) try { engine.cancel(); } catch { /* ignore */ }
      removeVoicesListener?.();
      listeners.clear();
      phase = 'idle'; owner = null; error = null; chunks = [];
    },
  };
}

export type ReadAloudController = ReturnType<typeof createReadAloudController>;

let shared: ReadAloudController | undefined;

/** One lazily instantiated controller per renderer Window, shared by embedded owners. */
export function getReadAloudController(): ReadAloudController {
  if (!shared) shared = createReadAloudController();
  return shared;
}

let latestSnapshot: ReadAloudSnapshot = { phase: 'idle', owner: null, error: null, supported: false, voices: [] };
let snapshotBound = false;
const bindSnapshot = () => {
  if (snapshotBound || typeof window === 'undefined') return;
  snapshotBound = true;
  getReadAloudController().subscribe(s => { latestSnapshot = s; });
};
/** Subscription source for useSyncExternalStore over the shared window controller. */
export function subscribeReadAloudSnapshot(listener: () => void): () => void {
  bindSnapshot();
  return getReadAloudController().subscribe(() => listener());
}
export function getReadAloudSnapshot(): ReadAloudSnapshot {
  bindSnapshot();
  return latestSnapshot;
}
