import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startPolling } from '../apps/web/src/usePolling.ts';

type Listener = () => void;
const listeners = new Set<Listener>();
const doc = {
  hidden: false,
  addEventListener: (_type: string, fn: Listener) => { listeners.add(fn); },
  removeEventListener: (_type: string, fn: Listener) => { listeners.delete(fn); },
  visibility() { for (const fn of [...listeners]) fn(); },
};

beforeEach(() => { vi.useFakeTimers(); listeners.clear(); doc.hidden = false; vi.stubGlobal('document', doc); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('polls immediately and on the interval while visible', async () => {
  const fn = vi.fn().mockResolvedValue(undefined);
  const stop = startPolling(fn, 1000);
  await vi.advanceTimersByTimeAsync(0);
  expect(fn).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(3000);
  expect(fn).toHaveBeenCalledTimes(4);
  stop();
});

it('makes no requests while the window is hidden and resumes immediately on visible', async () => {
  const fn = vi.fn().mockResolvedValue(undefined);
  const stop = startPolling(fn, 1000);
  await vi.advanceTimersByTimeAsync(0);
  expect(fn).toHaveBeenCalledTimes(1);
  doc.hidden = true;
  await vi.advanceTimersByTimeAsync(10000);
  expect(fn).toHaveBeenCalledTimes(1);
  doc.hidden = false;
  doc.visibility();
  await vi.advanceTimersByTimeAsync(0);
  expect(fn).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1000);
  expect(fn).toHaveBeenCalledTimes(3);
  stop();
});

it('does not fire the initial poll when the document starts hidden', async () => {
  doc.hidden = true;
  const fn = vi.fn().mockResolvedValue(undefined);
  const stop = startPolling(fn, 1000);
  await vi.advanceTimersByTimeAsync(5000);
  expect(fn).not.toHaveBeenCalled();
  doc.hidden = false;
  doc.visibility();
  await vi.advanceTimersByTimeAsync(0);
  expect(fn).toHaveBeenCalledTimes(1);
  stop();
});

it('backs off exponentially after consecutive failures and resets after a success', async () => {
  const fn = vi.fn()
    .mockRejectedValueOnce(new Error('fail 1'))
    .mockRejectedValueOnce(new Error('fail 2'))
    .mockResolvedValue(undefined);
  const stop = startPolling(fn, 1000);
  await vi.advanceTimersByTimeAsync(0);   // t=0 call fails -> next at +2000
  expect(fn).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1999);
  expect(fn).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);   // t=2000 call fails -> next at +4000
  expect(fn).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(3999);
  expect(fn).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);   // t=6000 call succeeds -> back to 1000
  expect(fn).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(1000);
  expect(fn).toHaveBeenCalledTimes(4);
  stop();
});

it('caps the backoff at 60 seconds and stops cleanly', async () => {
  const fn = vi.fn().mockRejectedValue(new Error('down'));
  const stop = startPolling(fn, 30000);
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(60000);   // first retry at +60s (30000*2 capped)
  expect(fn).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(60000);   // subsequent retries stay at 60s
  expect(fn).toHaveBeenCalledTimes(3);
  const calls = fn.mock.calls.length;
  stop();
  await vi.advanceTimersByTimeAsync(120000);
  expect(fn).toHaveBeenCalledTimes(calls);
});
