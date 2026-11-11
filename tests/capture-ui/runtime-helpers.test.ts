import { describe, expect, it, vi } from 'vitest';
import { motionKey, type Motion } from '../../scripts/capture-ui/helpers';
import { captureExitCode, closeAll, isSameOriginWebSocket, mergeMotionRecords, retryNavigation, stripMotionErrors, withDeadline, settlePool, frameMotionErrors, type CaptureOutcome } from '../../scripts/capture-ui/runtime-helpers';

const motion: Motion = { screen: 'workspace', state: 'default', width: 375, frame: 'main', selector: 'button', type: 'CSSAnimation', animationName: 'enter', transitionProperty: '', properties: ['opacity'], duration: 100, delay: 0, easing: 'ease', iterations: 1, fill: 'both', keyframes: [{ opacity: 0 }, { opacity: 1 }] };

describe('capture exit decision', () => {
  it.each<CaptureOutcome>([
    { status: 'skipped', code: 'L', loadFailure: true },
    { status: 'skipped', code: 'F', loadFailure: false },
    { status: 'skipped', code: 'F', reduced: true },
    { status: 'failed' },
    { status: 'skipped' },
  ])('fails on an unexpected capture outcome %j', outcome => {
    expect(captureExitCode([outcome])).toBe(1);
  });

  it('fails on a strip sampling failure', () => {
    expect(captureExitCode([], [{ status: 'failed' }])).toBe(1);
  });

  it('fails on a surfaced cleanup or correspondence error', () => {
    expect(captureExitCode([], [], ['browser: close failed'])).toBe(1);
  });

  it('accepts captures, identical images, and explicitly excluded outcomes', () => {
    expect(captureExitCode([
      { status: 'captured' }, { status: 'identical-to-default', code: 'I' },
      { status: 'skipped', code: 'U' }, { status: 'skipped', code: 'E' },
      { status: 'failed', optional: true }, { status: 'skipped', declaredSkip: true },
    ], [{ status: 'skipped', declaredSkip: true }])).toBe(0);
    expect(captureExitCode([])).toBe(0);
  });
});

describe('merged motion inventory', () => {
  it('retains identical selectors and animation names from different frames', () => {
    const main = {...motion, frame: 'main'}, child = {...motion, frame: 'frame:0 /plugins/tools'};
    expect(motionKey(main)).not.toBe(motionKey(child));
    expect(mergeMotionRecords([main, child, child])).toHaveLength(2);
    expect(frameMotionErrors(['plugin-frame'], [{...main, screen: 'plugin-frame'}])).toHaveLength(1);
    expect(frameMotionErrors(['plugin-frame'], [{...child, screen: 'plugin-frame'}])).toEqual([]);
    expect(frameMotionErrors(['workspace'], [])).toEqual([]);
  });
  it('dedupes repeated load, action, and strip samples without losing state or width', () => {
    const result = mergeMotionRecords(
      [motion, { ...motion, state: 'default:load' }],
      [{ ...motion, width: 768 }, { ...motion, state: 'hover' }],
      [motion, { ...motion, animationName: 'strip-only' }],
    );
    expect(result.map(row => [row.state, row.width, row.animationName])).toEqual([
      ['default', 375, 'enter'], ['default:load', 375, 'enter'],
      ['default', 768, 'enter'], ['hover', 375, 'enter'], ['default', 375, 'strip-only'],
    ]);
  });

  it('normalizes duplicate properties before deduping but retains distinct keyframes', () => {
    const result = mergeMotionRecords(
      [{ ...motion, properties: ['transform', 'opacity', 'opacity'] }],
      [{ ...motion, properties: ['opacity', 'transform'] }, { ...motion, keyframes: [{ opacity: 0.5 }] }],
    );
    expect(result).toHaveLength(2);
    expect(result[0].properties).toEqual(['opacity', 'transform']);
    expect(result[1].keyframes).toEqual([{ opacity: 0.5 }]);
    expect(motion.properties).toEqual(['opacity']);
  });

  it('requires every captured strip to correspond to an inventoried motion record', () => {
    const key = motionKey(motion);
    expect(stripMotionErrors([{ status: 'captured', motionKey: key, screen: 'workspace', state: 'default', width: 375 }], [motion])).toEqual([]);
    expect(stripMotionErrors([{ status: 'captured', motionKey: key }], [])).toHaveLength(1);
    expect(stripMotionErrors([{ status: 'captured' }], [motion])).toHaveLength(1);
    expect(stripMotionErrors([{ status: 'captured', motionKey: key, width: 768 }], [motion])).toHaveLength(1);
    expect(stripMotionErrors([{ status: 'captured', motionKey: key, state: 'hover' }], [motion])).toHaveLength(1);
    expect(stripMotionErrors([{ status: 'captured', motionKey: key, selector: 'dialog' }], [motion])).toHaveLength(1);
    expect(stripMotionErrors([{ status: 'skipped' }], [])).toEqual([]);
  });
});

describe('resource cleanup', () => {
  it('applies the default 10-second deadline independently to every stalled closer', async () => {
    vi.useFakeTimers();
    try {
      let settled = false, released = false;
      const closing = closeAll([
        {name: 'first', close: () => new Promise(() => {})},
        {name: 'second', close: () => new Promise(() => {})},
        {name: 'third', close: () => {released = true;}},
      ]).then(errors => {settled = true; return errors;});
      await vi.advanceTimersByTimeAsync(9999);
      expect(released).toBe(true);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await closing).toEqual(['first: Error: first exceeded 10000ms deadline', 'second: Error: second exceeded 10000ms deadline']);
    } finally { vi.useRealTimers(); }
  });
  it('times out a stalled closer while still attempting every other closer', async () => {
    vi.useFakeTimers();
    try {
      const released: string[] = [];
      const closing = closeAll([{name: 'stalled', close: () => new Promise(() => {})}, {name: 'server', close: () => {released.push('server');}}], 20);
      await vi.advanceTimersByTimeAsync(20);
      expect(released).toEqual(['server']);
      expect(await closing).toEqual(['stalled: Error: stalled exceeded 20ms deadline']);
    } finally { vi.useRealTimers(); }
  });
  it('runs subsequent closers after a synchronous throw and surfaces every failure', async () => {
    const released: string[] = [];
    const errors = await closeAll([
      { name: 'browser', close: () => { throw new Error('browser close failed'); } },
      { name: 'server', close: () => { released.push('server'); } },
      { name: 'context', close: async () => { throw new Error('context close failed'); } },
    ]);
    expect(released).toEqual(['server']);
    expect(errors).toEqual(['browser: Error: browser close failed', 'context: Error: context close failed']);
  });

  it('reports no cleanup errors when every resource closes', async () => {
    expect(await closeAll([{ name: 'server', close: async () => undefined }])).toEqual([]);
  });
});

describe('operation deadlines', () => {
  it('settles success and failure and cancels the deadline timer', async () => {
    vi.useFakeTimers();
    try {
      expect(await withDeadline(Promise.resolve('ok'), 50, 'ready')).toBe('ok');
      await expect(withDeadline(Promise.reject(Error('broken')), 50, 'ready')).rejects.toThrow('broken');
      expect(vi.getTimerCount()).toBe(0);
      const result = expect(withDeadline(new Promise(() => {}), 50, 'animation frame')).rejects.toThrow('animation frame exceeded 50ms deadline');
      await vi.advanceTimersByTimeAsync(50);
      await result;
      expect(captureExitCode([{status:'skipped', code:'F'}])).toBe(1);
    } finally { vi.useRealTimers(); }
  });
});

it('bounds concurrent jobs and settles every item even after a rejection', async () => {
  let active = 0, peak = 0;
  const completed: number[] = [];
  const results = await settlePool([0, 1, 2, 3, 4], 2, async item => {
    active++; peak = Math.max(peak, active);
    await Promise.resolve();
    active--; completed.push(item);
    if (item === 1) throw Error('viewport failed');
  });
  expect(peak).toBe(2);
  expect(completed).toEqual([0, 1, 2, 3, 4]);
  expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled', 'fulfilled', 'fulfilled']);
  expect(results[1]).toMatchObject({reason: Error('viewport failed')});
  expect(await settlePool([], 6, async () => {})).toEqual([]);
  await expect(settlePool([1], 0, async () => {})).rejects.toThrow('positive integer');
});

describe('navigation retry', () => {
  it('retries the fallback exactly once after a timeout', async () => {
    const attempts: number[] = [];
    const result = await retryNavigation(async attempt => {
      attempts.push(attempt);
      if (attempt === 0) throw Object.assign(new Error('navigation timed out'), { name: 'TimeoutError' });
      return 'loaded';
    });
    expect(result).toBe('loaded');
    expect(attempts).toEqual([0, 1]);
  });

  it('does not retry network or ordinary errors that mention timeout', async () => {
    const attempts: number[] = [];
    const error = new Error('ERR_CONNECTION_REFUSED timeout');
    await expect(retryNavigation(async attempt => { attempts.push(attempt); throw error; })).rejects.toBe(error);
    expect(attempts).toEqual([0]);
  });

  it('surfaces the second timeout without attempting another retry', async () => {
    const attempts: number[] = [];
    const error = Object.assign(new Error('still timed out'), { name: 'TimeoutError' });
    await expect(retryNavigation(async attempt => { attempts.push(attempt); throw error; })).rejects.toBe(error);
    expect(attempts).toEqual([0, 1]);
  });

  it('returns a successful first navigation without a retry', async () => {
    const attempts: number[] = [];
    expect(await retryNavigation(async attempt => { attempts.push(attempt); return 204; })).toBe(204);
    expect(attempts).toEqual([0]);
  });
});

describe('WebSocket origin checks', () => {
  it.each([
    ['ws://localhost:5173/hmr', 'http://localhost:5173/', true],
    ['wss://capture.test/events', 'https://capture.test/', true],
    ['ws://capture.test:80/events', 'http://capture.test/', true],
    ['wss://capture.test:443/events', 'https://capture.test/', true],
    ['ws://foreign.test:5173/events', 'http://localhost:5173/', false],
    ['ws://localhost:5174/events', 'http://localhost:5173/', false],
    ['ws://capture.test/events', 'https://capture.test/', false],
    ['https://capture.test/events', 'https://capture.test/', false],
    ['invalid', 'http://localhost:5173/', false],
    ['ws://capture.test/events', 'invalid', false],
  ])('checks %s against %s', (url, base, allowed) => {
    expect(isSameOriginWebSocket(url, base)).toBe(allowed);
  });
});
