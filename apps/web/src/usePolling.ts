import { useEffect, useRef } from 'react';

/**
 * Poll `fn` every `intervalMs` while the document is visible. Polling pauses
 * while `document.hidden`, runs once immediately when visibility returns, and
 * backs off (doubling up to 60 s) after consecutive failures of `fn`.
 * Returns a disposer that stops polling.
 */
export function startPolling(fn: () => void | Promise<unknown>, intervalMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false, delay = intervalMs;
  const tick = async () => {
    if (disposed || document.hidden) return;
    try { await fn(); delay = intervalMs; }
    catch { delay = Math.min(delay * 2, 60000); }
    if (!disposed && !document.hidden) timer = setTimeout(tick, delay);
  };
  const onVisibility = () => {
    if (disposed || document.hidden) return;
    clearTimeout(timer); timer = undefined; delay = intervalMs;
    void tick();
  };
  void tick();
  document.addEventListener('visibilitychange', onVisibility);
  return () => { disposed = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility); };
}

/** React wrapper around {@link startPolling} that always calls the latest `fn`. */
export function usePolling(fn: () => void | Promise<unknown>, intervalMs: number) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => startPolling(() => saved.current(), intervalMs), [intervalMs]);
}
