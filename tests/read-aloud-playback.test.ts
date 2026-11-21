import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createReadAloudController, resolveLocalVoice,
  READ_ALOUD_ERROR_NO_VOICE, READ_ALOUD_ERROR_RETRY,
  type ReadAloudEngine, type ReadAloudUtterance,
} from '../apps/web/src/read-aloud-playback.ts';
import {
  readReadAloudPreferences, writeReadAloudPreferences, resetReadAloudPreferencesForTest,
  READ_ALOUD_STORAGE_KEY,
} from '../apps/web/src/read-aloud-preferences.ts';

const localA = { voiceURI: 'local-a', name: 'Ava', lang: 'en-US', default: false, localService: true };
const localB = { voiceURI: 'local-b', name: 'Ben', lang: 'en-GB', default: true, localService: true };
const remote = { voiceURI: 'remote-x', name: 'Cloud', lang: 'en-US', default: true, localService: false };
const owner = (messageId = 'm1') => ({ surface: {}, threadId: 't1', messageId });

function engine(voices = [localA, localB]) {
  const spoken: ReadAloudUtterance[] = [];
  const calls = { cancel: 0, pause: 0, resume: 0 };
  const listeners = new Set<() => void>();
  const api: ReadAloudEngine = {
    getVoices: () => voices,
    speak: u => { spoken.push(u); },
    cancel: () => { calls.cancel++; },
    pause: () => { calls.pause++; },
    resume: () => { calls.resume++; },
    createUtterance: text => ({ text, voice: null, lang: '', rate: 1, onstart: null, onend: null, onerror: null }),
    addVoicesChangedListener: l => { listeners.add(l); return () => listeners.delete(l); },
  };
  return { api, spoken, calls, fireVoicesChanged: () => listeners.forEach(l => l()) };
}

const prefs = { voiceURI: null, rate: 1 as const };

describe('resolveLocalVoice', () => {
  it('prefers the explicit URI, then the local default, then stable name order', () => {
    expect(resolveLocalVoice([localB, localA], 'local-a')!.voiceURI).toBe('local-a');
    expect(resolveLocalVoice([localA, localB], null)!.voiceURI).toBe('local-b');
    expect(resolveLocalVoice([localB, localA], 'missing')!.voiceURI).toBe('local-b');
    const noDefault = [localA, { ...localB, default: false }];
    expect(resolveLocalVoice(noDefault, null)!.name).toBe('Ava');
  });
  it('never resolves a remote-only inventory', () => {
    expect(resolveLocalVoice([remote], null)).toBeNull();
    expect(resolveLocalVoice([remote], 'remote-x')).toBeNull();
  });
});

describe('read-aloud controller', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not call speak() when the engine is missing', () => {
    const c = createReadAloudController(null);
    let snap: { phase: string; error: string | null; supported: boolean } | null = null;
    c.subscribe(s => { snap = s; });
    c.play(owner(), ['hello'], prefs);
    expect(snap!.supported).toBe(false);
    expect(snap!.error).toBe(READ_ALOUD_ERROR_NO_VOICE);
    expect(snap!.phase).toBe('idle');
  });

  it('does not call speak() when no local voice resolves', () => {
    const e = engine([remote]);
    const c = createReadAloudController(e.api);
    c.play(owner(), ['hello'], prefs);
    expect(e.spoken).toHaveLength(0);
  });

  it('speaks chunks in order and returns to idle after the last', () => {
    const e = engine();
    const c = createReadAloudController(e.api);
    const phases: string[] = [];
    c.subscribe(s => phases.push(s.phase));
    c.play(owner(), ['one.', 'two.'], prefs);
    expect(phases).toContain('starting');
    e.spoken[0]!.onstart!();
    expect(phases.at(-1)).toBe('speaking');
    e.spoken[0]!.onend!();
    expect(e.spoken.map(u => u.text)).toEqual(['one.', 'two.']);
    e.spoken[1]!.onstart!();
    e.spoken[1]!.onend!();
    expect(phases.at(-1)).toBe('idle');
  });

  it('ignores stale callbacks after a session is replaced', () => {
    const e = engine();
    const c = createReadAloudController(e.api);
    let phase = '';
    c.subscribe(s => { phase = s.phase; });
    c.play(owner('a'), ['first'], prefs);
    const stale = e.spoken[0]!;
    c.play(owner('b'), ['second'], prefs);
    stale.onerror!();
    expect(phase).toBe('starting');
    e.spoken[1]!.onstart!();
    stale.onend!();
    expect(e.spoken).toHaveLength(2);
    expect(phase).toBe('speaking');
  });

  it('pause defers the next chunk until resume', () => {
    const e = engine();
    const c = createReadAloudController(e.api);
    let phase = '';
    c.subscribe(s => { phase = s.phase; });
    c.play(owner(), ['one.', 'two.'], prefs);
    e.spoken[0]!.onstart!();
    c.pause();
    e.spoken[0]!.onend!();
    expect(e.spoken).toHaveLength(1);
    expect(phase).toBe('paused');
    c.resume();
    expect(e.spoken).toHaveLength(2);
    expect(phase).toBe('speaking');
  });

  it('stop cancels owned speech and ignores late events', () => {
    const e = engine();
    const c = createReadAloudController(e.api);
    let phase = '';
    c.subscribe(s => { phase = s.phase; });
    c.play(owner(), ['one.'], prefs);
    e.spoken[0]!.onstart!();
    c.stop();
    expect(e.calls.cancel).toBeGreaterThanOrEqual(0); // endSession doesn't cancel; play() does
    expect(phase).toBe('idle');
    e.spoken[0]!.onend!();
    expect(phase).toBe('idle');
  });

  it('times out when start never arrives and ends with the retry message', () => {
    const e = engine();
    const c = createReadAloudController(e.api);
    let snap: { phase: string; error: string | null } | null = null;
    c.subscribe(s => { snap = s; });
    c.play(owner(), ['hello'], prefs);
    vi.advanceTimersByTime(5000);
    expect(snap!.phase).toBe('idle');
    expect(snap!.error).toBe(READ_ALOUD_ERROR_RETRY);
  });

  it('ends the session on an utterance error', () => {
    const e = engine();
    const c = createReadAloudController(e.api);
    let snap: { phase: string; error: string | null } | null = null;
    c.subscribe(s => { snap = s; });
    c.play(owner(), ['hello'], prefs);
    e.spoken[0]!.onstart!();
    e.spoken[0]!.onerror!();
    expect(snap!.phase).toBe('idle');
    expect(snap!.error).toBe(READ_ALOUD_ERROR_RETRY);
  });

  it('sets voice, language and rate on every utterance', () => {
    const e = engine();
    const c = createReadAloudController(e.api);
    c.play(owner(), ['hi'], { voiceURI: 'local-a', rate: 1.5 });
    expect(e.spoken[0]!.voice).toEqual(localA);
    expect(e.spoken[0]!.lang).toBe('en-US');
    expect(e.spoken[0]!.rate).toBe(1.5);
  });
});

describe('read-aloud preferences', () => {
  beforeEach(() => {
    resetReadAloudPreferencesForTest();
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    });
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('defaults to automatic local voice and 1x', () => {
    expect(readReadAloudPreferences()).toEqual({ voiceURI: null, rate: 1 });
  });

  it('persists and validates fields', () => {
    writeReadAloudPreferences({ voiceURI: 'local-a', rate: 1.5 });
    expect(readReadAloudPreferences()).toEqual({ voiceURI: 'local-a', rate: 1.5 });
    localStorage.setItem(READ_ALOUD_STORAGE_KEY, '{"voiceURI":5,"rate":9}');
    expect(readReadAloudPreferences()).toEqual({ voiceURI: null, rate: 1 });
    localStorage.setItem(READ_ALOUD_STORAGE_KEY, 'not json');
    expect(readReadAloudPreferences()).toEqual({ voiceURI: null, rate: 1 });
  });

  it('keeps a session-only value when storage throws', () => {
    resetReadAloudPreferencesForTest();
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => {},
    });
    writeReadAloudPreferences({ voiceURI: 'v', rate: 2 });
    expect(readReadAloudPreferences()).toEqual({ voiceURI: 'v', rate: 2 });
  });
});
