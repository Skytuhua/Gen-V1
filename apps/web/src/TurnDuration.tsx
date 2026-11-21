import { useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import type { TurnTimingV1 } from '../../../packages/contracts';
import type { TimeFormat } from './time-format';
import { formatLocalClock, formatLocalDateTime, formatTurnDuration, isoDuration } from './time-format';

const sameLocalDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

/** Finished-turn line ("Worked for 1m 12s") rendered under a run's last
 * transcript row. Presentation only: a plain <p> + <time>, no focus and no
 * tab stop; `arrival` marks a line that appeared while this mount watched. */
export function TurnDuration({ timing, timeFormat, arrival }: { timing: TurnTimingV1; timeFormat: TimeFormat; arrival: boolean }) {
  const start = Date.parse(timing.startedAt);
  const end = Date.parse(timing.endedAt ?? '');
  const ms = Number.isFinite(start) && Number.isFinite(end) ? end - start : NaN;
  const label = timing.outcome === 'completed' ? 'Worked for' : timing.outcome === 'stopped' ? 'Stopped after' : 'Interrupted after';
  const clock = (value: number) => sameLocalDay(start, end)
    ? formatLocalClock(value, timeFormat)
    : formatLocalDateTime(value, timeFormat, undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const title = Number.isFinite(ms) ? `Started ${clock(start)} · ended ${clock(end)}` : undefined;
  return (
    <p className="turn-duration" data-arrival={arrival ? 'true' : undefined} title={title}>
      <Timer size={12} strokeWidth={1.75} aria-hidden="true" />
      {label} <time dateTime={isoDuration(ms)}>{formatTurnDuration(ms)}</time>
    </p>
  );
}

/** Arms a once-per-second elapsed ticker that pauses while the document is
 * hidden and recomputes when it becomes visible again (never drifts).
 * Returns the disarm function. Injectable document for tests. */
export function armTurnElapsed(start: number, tick: (ms: number) => void, doc: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> = document): () => void {
  const update = () => tick(Math.max(0, Date.now() - start));
  let timer: ReturnType<typeof setInterval> | undefined;
  const arm = () => { update(); if (doc.visibilityState !== 'hidden') timer = setInterval(update, 1000); };
  const unarm = () => { if (timer !== undefined) { clearInterval(timer); timer = undefined; } };
  const onVisibility = () => { unarm(); if (doc.visibilityState !== 'hidden') arm(); };
  arm();
  doc.addEventListener('visibilitychange', onVisibility);
  return () => { unarm(); doc.removeEventListener('visibilitychange', onVisibility); };
}

/** Elapsed ms for the live working-status count; null until armed or when
 * the record has not landed in the snapshot yet. */
export function useTurnElapsed(startedAt?: string): number | null {
  const [elapsed, setElapsed] = useState<number | null>(null);
  useEffect(() => {
    const start = startedAt === undefined ? NaN : Date.parse(startedAt);
    if (!Number.isFinite(start)) { setElapsed(null); return; }
    return armTurnElapsed(start, setElapsed);
  }, [startedAt]);
  return elapsed;
}
