import { describe, expect, it, vi } from 'vitest';
import { resolveConfig } from 'vite';
import { captureServerOptions, pdfPrebundleIncludes, pdfWarmupRequests, warmPdfCapture } from '../../scripts/capture-ui/server-startup';
import { captureExitCode, loadWithReadiness } from '../../scripts/capture-ui/runtime-helpers';
import { screens } from '../../scripts/capture-ui/screen-map';

it('isolates resolved optimizer caches between app, fixtures, and capture invocations', async () => {
  const fixtureOptions = captureServerOptions('scripts/capture-ui/vite.config.ts', '/tmp/capture-first', 'fixtures');
  const appOptions = captureServerOptions('tests/e2e/vite.config.ts', '/tmp/capture-first', 'app-shell');
  const fixture = await resolveConfig(fixtureOptions, 'serve');
  const app = await resolveConfig(appOptions, 'serve');
  expect(fixture.root).not.toBe(app.root);
  expect(fixture.cacheDir).not.toBe(app.cacheDir);
  expect(fixture.cacheDir).toBe(fixtureOptions.cacheDir);
  expect(fixture.cacheDir).toContain('node_modules');
  expect(app.cacheDir).toBe(appOptions.cacheDir);
  expect(captureServerOptions('scripts/capture-ui/vite.config.ts', '/tmp/capture-second', 'fixtures').cacheDir).not.toBe(fixture.cacheDir);
  expect(fixture.optimizeDeps.include).toEqual(expect.arrayContaining(pdfPrebundleIncludes));
  expect(fixture.optimizeDeps.entries).toContain('apps/web/src/pdf-draft.worker.ts');
});
it('warms both PDF workers, then waits for static import transforms to finish', async () => {
  const calls: string[] = [];
  const requests = pdfWarmupRequests('/tmp/repo');
  expect(requests.some(url => url.endsWith('/pdf-draft.worker.ts?worker_file&type=module'))).toBe(true);
  expect(requests.some(url => url.endsWith('/pdf.worker.min.mjs'))).toBe(true);
  await warmPdfCapture({
    transformRequest: async url => { calls.push(url); return {code: 'compiled', map: null}; },
    waitForRequestsIdle: async () => { calls.push('idle'); },
  }, requests);
  expect(calls).toEqual([...requests, 'idle']);
});
it('surfaces PDF warmup errors rather than starting captures with broken workers', async () => {
  const error = Error('worker transform failed');
  await expect(warmPdfCapture({transformRequest: async () => {throw error;}, waitForRequestsIdle: async () => {}}, ['worker'])).rejects.toBe(error);
  await expect(warmPdfCapture({transformRequest: async () => null, waitForRequestsIdle: async () => {}}, ['worker'])).rejects.toThrow('no module');
});
it('fails startup when PDF warmup exceeds its deadline', async () => {
  vi.useFakeTimers();
  try {
    const result = expect(warmPdfCapture({transformRequest: () => new Promise(() => {}), waitForRequestsIdle: async () => {}}, ['worker'], 50)).rejects.toThrow('PDF warmup exceeded 50ms deadline');
    await vi.advanceTimersByTimeAsync(50);
    await result;
  } finally { vi.useRealTimers(); }
});
it('also bounds the PDF optimizer-idle wait after module transforms have completed', async () => {
  vi.useFakeTimers();
  try {
    const result = expect(warmPdfCapture({transformRequest: async () => ({code: 'compiled', map: null}), waitForRequestsIdle: () => new Promise(() => {})}, ['worker'], 50)).rejects.toThrow('PDF warmup exceeded 50ms deadline');
    await vi.advanceTimersByTimeAsync(50);
    await result;
  } finally { vi.useRealTimers(); }
});

describe('heavy document readiness', () => {
  const timeout = () => Object.assign(Error('canvas not ready'), {name: 'TimeoutError'});
  it('reloads once only when a declared readiness wait times out', async () => {
    const calls: string[] = [];
    let waits = 0;
    await loadWithReadiness(async () => {calls.push('navigate');}, async () => {calls.push('ready'); if (!waits++) throw timeout();}, true, () => {calls.push('retry');});
    expect(calls).toEqual(['navigate', 'ready', 'retry', 'navigate', 'ready']);
  });
  it('keeps persistent readiness failure fatal after one reload', async () => {
    let loads = 0;
    const failure = timeout();
    await expect(loadWithReadiness(async () => {loads++;}, async () => {throw failure;}, true)).rejects.toBe(failure);
    expect(loads).toBe(2);
    expect(captureExitCode([{status: 'skipped', code: 'L', loadFailure: true}])).toBe(1);
  });
  it('does not retry navigation errors, non-timeout readiness errors, or ordinary screen readiness', async () => {
    for (const [navError, readyError, retry] of [[Error('503'), undefined, true], [undefined, Error('bad PDF'), true], [undefined, timeout(), false]] as const) {
      let loads = 0;
      await expect(loadWithReadiness(async () => {loads++; if (navError) throw navError;}, async () => {if (readyError) throw readyError;}, retry)).rejects.toBe(navError ?? readyError);
      expect(loads).toBe(1);
    }
  });
  it('budgets only the PDF screen while retaining the rendered-canvas condition', () => {
    const pdf = screens.find(screen => screen.id === 'task-document')!;
    expect(pdf.readyTimeout).toBe(30000);
    expect(pdf.retryReadyTimeout).toBe(true);
    expect(pdf.ready).toContain('data-preview-state="ready"');
    expect(pdf.ready).toContain('canvas[width]');
    expect(screens.find(screen => screen.id === 'graph')?.readyTimeout).toBeUndefined();
  });
});
