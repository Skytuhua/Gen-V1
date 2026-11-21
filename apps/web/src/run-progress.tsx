import { useEffect, useMemo, useRef, useState } from 'react';
import type { Snapshot, Thread } from '../../../packages/contracts';

export const RUN_ACTIVITY_LABELS: Record<string, string> = {
  queued: 'Queued for account…',
  starting: 'Starting runtime…',
  generating: 'Generating…',
  tool: 'Running tool…',
  cleanup: 'Cleaning up…',
  compacting: 'Compacting context…',
};

export const threadWorking = (thread: Thread | undefined | null) =>
  Boolean(thread?.runId) || thread?.status === 'working';

export function formatElapsed(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

// When a run started as far as this session can tell; keyed per run so a new
// run on the same thread resets the clock.
const firstSeen = new Map<string, number>();

function useRunProgress(thread: Thread | undefined, snapshot: Snapshot) {
  const working = threadWorking(thread);
  const id = thread?.id;
  const runKey = id ? `${id}:${thread?.runId ?? ''}` : undefined;
  const [now, setNow] = useState(() => Date.now());

  const activity = id ? snapshot.usage[id]?.activity : undefined;
  const label = activity ? RUN_ACTIVITY_LABELS[activity] : undefined;

  const lastActivity = useRef(activity);
  const lastEvent = useRef(0);
  if (runKey && !firstSeen.has(runKey)) firstSeen.set(runKey, Date.now());
  if (lastActivity.current !== activity) {
    lastActivity.current = activity;
    lastEvent.current = Date.now();
  }

  const lastMessageAt = useMemo(() => {
    if (!id) return 0;
    let latest = 0;
    for (const message of snapshot.messages)
      if (message.threadId === id) {
        const at = Date.parse(message.createdAt);
        if (at > latest) latest = at;
      }
    return latest;
  }, [id, snapshot.messages]);

  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [working, runKey]);

  useEffect(() => {
    if (working || !runKey) return;
    firstSeen.delete(runKey);
  }, [working, runKey]);

  const startedAt = runKey ? firstSeen.get(runKey) ?? now : now;
  const eventAt = Math.max(lastEvent.current, lastMessageAt, startedAt);
  const quietFor = Math.max(0, now - eventAt);
  const stalled = working && quietFor >= 30_000;

  return {
    working,
    statusText: (fallback: string) =>
      stalled ? `Still working — no update for ${formatElapsed(quietFor)}` : label ?? fallback,
    elapsed: working ? Math.max(0, now - startedAt) : 0,
  };
}

function RunSpinner({ size }: { size: number }) {
  return <span className="run-spinner" style={{ width: size, height: size }} aria-hidden="true" />;
}

export function RunProgressCard({ thread, snapshot, onStop }: { thread: Thread | undefined; snapshot: Snapshot; onStop: () => void }) {
  const progress = useRunProgress(thread, snapshot);
  return (
    <div className="run-progress-card" role="status">
      <RunSpinner size={28} />
      <h1 className="run-progress-title">Working on it…</h1>
      <p className="run-progress-status" aria-live="polite">{progress.statusText('Thinking')}</p>
      <p className="run-progress-elapsed">{formatElapsed(progress.elapsed)}</p>
      <button type="button" className="secondary run-progress-stop" onClick={onStop}>Stop agent</button>
    </div>
  );
}

export function RunStrip({ thread, snapshot, onStop }: { thread: Thread | undefined; snapshot: Snapshot; onStop: () => void }) {
  const progress = useRunProgress(thread, snapshot);
  return (
    <div className="working-status run-strip" role="status">
      <RunSpinner size={12} />
      <span className="run-strip-label">Agent is working — {progress.statusText('Working…')}</span>
      <span className="run-strip-right">
        <span className="run-strip-elapsed">{formatElapsed(progress.elapsed)}</span>
        <button type="button" className="quiet run-strip-stop" onClick={onStop}>Stop</button>
      </span>
    </div>
  );
}
