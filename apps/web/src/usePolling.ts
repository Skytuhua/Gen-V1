import {useEffect} from 'react';

/** Shared polling driver for panels that refresh on a fixed timer. Pauses
 * while the document is hidden, runs once immediately when the document
 * becomes visible again, and backs off (doubling the interval, capped at
 * 60 s) after consecutive task failures. Task rejections are counted and
 * surfaced through `onError` when provided — panels keep their existing
 * silent or error-state UI. */

const MAX_BACKOFF_MS = 60_000;

export interface Polling {
  /** Cancels any pending run and stops listening for visibility changes. */
  stop: () => void;
}

export function createPolling(task: () => Promise<unknown>, intervalMs: number, onError?: (cause: unknown) => void): Polling {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let running = false;
  let stopped = false;
  const schedule = (delay: number) => { if (!stopped) timer = setTimeout(fire, delay); };
  const fire = () => {
    timer = null;
    if (stopped || running || document.visibilityState === 'hidden') return;
    running = true;
    void task()
      .then(() => { failures = 0; })
      .catch(cause => { failures += 1; onError?.(cause); })
      .finally(() => { running = false; schedule(Math.min(intervalMs * 2 ** failures, MAX_BACKOFF_MS)); });
  };
  const visible = () => { if (document.visibilityState === 'visible') { failures = 0; fire(); } };
  document.addEventListener('visibilitychange', visible);
  schedule(0);
  return {
    stop() {
      stopped = true;
      if (timer) { clearTimeout(timer); timer = null; }
      document.removeEventListener('visibilitychange', visible);
    },
  };
}

export function usePolling(task: () => Promise<unknown>, intervalMs: number, onError?: (cause: unknown) => void) {
  useEffect(() => createPolling(task, intervalMs, onError).stop, [task, intervalMs, onError]);
}
