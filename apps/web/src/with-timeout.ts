/** Rejects with Error('settings-load-timeout') when `promise` does not settle within `ms`.
 * Optional `signal` cancels the timer early (component unmount) and rejects with 'settings-load-cancelled'. */
export function withTimeout<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { settled = true; reject(new Error('settings-load-timeout')); }, ms);
    const cancel = () => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error('settings-load-cancelled')); } };
    signal?.addEventListener('abort', cancel, { once: true });
    promise.then(
      value => { if (!settled) { settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel); resolve(value); } },
      cause => { if (!settled) { settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(cause); } },
    );
  });
}
