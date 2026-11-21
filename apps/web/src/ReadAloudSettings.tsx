/**
 * Settings → Chat controls for read-aloud voice and speed (#1392).
 * Values live in the versioned renderer key harness:read-aloud:v1, not the
 * synced UiPreferences; the voice list comes from the shared controller so
 * late-arriving voices update the options.
 */

import { useSyncExternalStore } from 'react';
import { Select } from '../../../packages/ui-shell/Select';
import { getReadAloudController, type ReadAloudSnapshot } from './read-aloud-playback.ts';
import {
  READ_ALOUD_RATES, readReadAloudPreferences, subscribeReadAloudPreferences,
  writeReadAloudPreferences, type ReadAloudPreferences, type ReadAloudRate,
} from './read-aloud-preferences.ts';

let latestSnapshot: ReadAloudSnapshot = { phase: 'idle', owner: null, error: null, supported: false, voices: [] };
let snapshotBound = false;
const bind = () => {
  if (snapshotBound || typeof window === 'undefined') return;
  snapshotBound = true;
  getReadAloudController().subscribe(s => { latestSnapshot = s; });
};
const subscribeSnapshot = (listener: () => void) => { bind(); return getReadAloudController().subscribe(() => listener()); };
const getSnapshot = (): ReadAloudSnapshot => { bind(); return latestSnapshot; };

const voiceLabel = (voice: { name: string; lang: string; voiceURI: string }) =>
  `${voice.name} (${voice.lang || voice.voiceURI})`;

export function useReadAloudPreferences(): ReadAloudPreferences {
  return useSyncExternalStore(subscribeReadAloudPreferences, readReadAloudPreferences, readReadAloudPreferences);
}

function useReadAloudSnapshot(): ReadAloudSnapshot {
  return useSyncExternalStore(subscribeSnapshot, getSnapshot, getSnapshot);
}

const setVoiceURI = (voiceURI: string) =>
  writeReadAloudPreferences({ ...readReadAloudPreferences(), voiceURI: voiceURI || null });
const setRate = (rate: string) =>
  writeReadAloudPreferences({ ...readReadAloudPreferences(), rate: Number(rate) as ReadAloudRate });

export function ReadAloudVoiceControl() {
  const preferences = useReadAloudPreferences();
  const snapshot = useReadAloudSnapshot();
  const options = [{ value: '', label: 'System default (local)' },
    ...snapshot.voices.map(voice => ({ value: voice.voiceURI, label: voiceLabel(voice) }))];
  if (preferences.voiceURI && !snapshot.voices.some(voice => voice.voiceURI === preferences.voiceURI)) {
    options.push({ value: preferences.voiceURI, label: `${preferences.voiceURI} (unavailable)` });
  }
  return <Select aria-label="Read-aloud voice" disabled={!snapshot.supported}
    value={preferences.voiceURI ?? ''} onValueChange={setVoiceURI} options={options}/>;
}

export function ReadAloudRateControl() {
  const preferences = useReadAloudPreferences();
  return <Select aria-label="Read-aloud speed" value={String(preferences.rate)} onValueChange={setRate}
    options={READ_ALOUD_RATES.map(rate => ({ value: String(rate), label: `${rate}×` }))}/>;
}

/** Short status line for the row description: explains fallback or unavailable voice. */
export function readAloudVoiceDescription(snapshot: ReadAloudSnapshot, preferences: ReadAloudPreferences): string {
  if (!snapshot.supported) return 'Local speech is unavailable in this build; the speed choice still applies when it becomes available.';
  if (!snapshot.voices.length) return 'No local speech voices were found yet; check the system speech settings if none appear.';
  if (preferences.voiceURI && !snapshot.voices.some(voice => voice.voiceURI === preferences.voiceURI))
    return 'The saved voice is missing; playback falls back to the local default without changing the saved choice.';
  return 'Read assistant replies aloud with a local voice.';
}
