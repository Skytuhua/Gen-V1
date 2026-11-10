import { describe, expect, it } from 'vitest';
import { motionKey, type Motion } from '../../scripts/capture-ui/helpers';
import { captureExitCode, closeAll, isSameOriginWebSocket, mergeMotionRecords, retryNavigation, stripMotionErrors, type CaptureOutcome } from '../../scripts/capture-ui/runtime-helpers';

const motion: Motion = { screen: 'workspace', state: 'default', width: 375, selector: 'button', type: 'CSSAnimation', animationName: 'enter', transitionProperty: '', properties: ['opacity'], duration: 100, delay: 0, easing: 'ease', iterations: 1, fill: 'both', keyframes: [{ opacity: 0 }, { opacity: 1 }] };

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
