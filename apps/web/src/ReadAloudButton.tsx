/**
 * Per-row read-aloud controls (#1392). Renders on eligible assistant rows
 * inside the in-flow `.message-actions` group before Copy; hides itself on
 * rows with nothing speakable. One shared controller per window keeps a
 * single active reply across panes and surfaces.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Pause, Play, Square, Volume2 } from 'lucide-react';
import {
  getReadAloudController, getReadAloudSnapshot, subscribeReadAloudSnapshot,
  type ReadAloudOwner, type ReadAloudPhase,
} from './read-aloud-playback.ts';
import { readReadAloudPreferences } from './read-aloud-preferences.ts';
import { chunkSpeechText, toSpeechText } from './read-aloud-text.ts';
import './read-aloud.css';

const ANNOUNCE: Record<ReadAloudPhase, string> = {
  idle: '', starting: 'Starting read aloud.', speaking: 'Reading the reply aloud.', paused: 'Reading paused.',
};

export function ReadAloudButton({ threadId, messageId, text, live, active }: {
  threadId: string; messageId: string; text: string;
  /** Row belongs to an unsettled/live run, or the owner has no reliable run ID. */
  live: boolean;
  /** Owner surface is visible and not held; hiding must stop playback. */
  active: boolean;
}) {
  const controller = getReadAloudController();
  const snapshot = useSyncExternalStore(subscribeReadAloudSnapshot, getReadAloudSnapshot, getReadAloudSnapshot);
  const surface = useRef<object>({});
  const owner = useMemo<ReadAloudOwner>(() => ({ surface: surface.current, threadId, messageId }),
    [threadId, messageId]);
  const eligible = useMemo(() => !live && Boolean(toSpeechText(text)), [live, text]);
  const mine = snapshot.owner === owner;
  const owned = useRef(false);
  if (mine) owned.current = true;
  const phase: ReadAloudPhase = mine ? snapshot.phase : 'idle';
  const primary = useRef<HTMLButtonElement>(null);
  const stopFocused = useRef(false);
  const previous = useRef<ReadAloudPhase>('idle');
  const [announcement, setAnnouncement] = useState('');

  // One polite announcement per lifecycle transition, never per chunk.
  useEffect(() => {
    if (previous.current !== 'idle' && phase === 'idle') setAnnouncement(previous.current === 'starting' ? 'Reading stopped.' : 'Stopped reading.');
    else if (phase !== previous.current) setAnnouncement(ANNOUNCE[phase]);
    previous.current = phase;
  }, [phase]);
  useEffect(() => { if (snapshot.error) setAnnouncement(snapshot.error); }, [snapshot.error]);

  // Return focus to the stable primary button when a focused Stop disappears.
  useLayoutEffect(() => {
    if (phase === 'idle' && stopFocused.current) { stopFocused.current = false; primary.current?.focus(); }
  }, [phase]);

  // Stop only this row's own session on unmount, identity change, hiding or live updates.
  useEffect(() => () => controller.stopOwner(owner), [controller, owner]);
  useEffect(() => { if (!active || live) controller.stopOwner(owner); }, [controller, owner, active, live]);
  useEffect(() => {
    const onHide = () => controller.stopOwner(owner);
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [controller, owner]);

  if (!eligible && !mine) return null;
  if (!snapshot.supported) {
    return <button type="button" ref={primary} className="icon-button read-aloud-button" aria-label="Read aloud" aria-disabled="true"
      title="Read aloud is unavailable: this build has no local speech engine."
      onClick={event => event.preventDefault()}><Volume2 size={14} aria-hidden="true"/></button>;
  }

  const start = () => {
    owned.current = true;
    const chunks = chunkSpeechText(toSpeechText(text));
    if (!chunks.length) return;
    controller.refreshVoices();
    controller.play(owner, chunks, readReadAloudPreferences());
  };

  return <>
    {phase === 'idle'
      ? <button type="button" ref={primary} className="icon-button read-aloud-button" aria-label="Read aloud" title="Read aloud" onClick={start}><Volume2 size={14} aria-hidden="true"/></button>
      : <button type="button" ref={primary}
          className={`icon-button read-aloud-button read-aloud-${phase}`}
          aria-label={phase === 'starting' ? 'Starting read aloud…' : phase === 'speaking' ? 'Pause reading' : 'Resume reading'}
          aria-disabled={phase === 'starting' || undefined}
          title={phase === 'starting' ? 'Starting read aloud…' : phase === 'speaking' ? 'Pause reading' : 'Resume reading'}
          onClick={phase === 'speaking' ? () => controller.pause() : phase === 'paused' ? () => controller.resume() : event => event.preventDefault()}>
          {phase === 'starting' ? <Volume2 size={14} aria-hidden="true"/> : phase === 'speaking' ? <Pause size={14} aria-hidden="true"/> : <Play size={14} aria-hidden="true"/>}
          <span className="read-aloud-bars" aria-hidden="true"><i/><i/><i/></span>
        </button>}
    {phase !== 'idle' && <button type="button" className="icon-button read-aloud-stop" aria-label="Stop reading" title="Stop reading"
      onFocus={() => { stopFocused.current = true; }}
      onBlur={() => { stopFocused.current = false; }}
      onClick={() => controller.stop()}><Square size={13} aria-hidden="true"/></button>}
    <span className="sr-only" role="status">{announcement}</span>
    {owned.current && snapshot.error && <span className="read-aloud-error" role="status">{snapshot.error}</span>}
  </>;
}
