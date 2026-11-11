import { isReducedOffender, motionKey, normalizeMotion, type CaptureEntry, type Motion } from './helpers';
import {captureWidths, keyStates, requiredOutputScreenIds} from './screen-map';

export type CaptureOutcome = Pick<CaptureEntry, 'status' | 'code' | 'loadFailure' | 'reduced'> & { optional?: boolean; declaredSkip?: boolean };
export function captureExitCode(entries: readonly CaptureOutcome[], strips: readonly CaptureOutcome[] = [], errors: readonly string[] = []): 0 | 1 {
  const failed = [...entries, ...strips].some(entry => {
    if (entry.optional || entry.declaredSkip) return false;
    if (entry.loadFailure || entry.code === 'L' || entry.code === 'F') return true;
    if (entry.status === 'skipped' && (entry.code === 'U' || entry.code === 'E')) return false;
    return entry.status !== 'captured' && entry.status !== 'identical-to-default';
  });
  return failed || errors.length > 0 ? 1 : 0;
}

export function mergeMotionRecords(...batches: readonly (readonly Motion[])[]): Motion[] {
  const records = new Map<string, Motion>();
  for (const batch of batches) for (const sample of batch) {
    const record = normalizeMotion(sample);
    // motionKey intentionally ignores state and width for strip uniqueness.
    const key = JSON.stringify([record.state, record.width, motionKey(record)]);
    if (!records.has(key)) records.set(key, record);
  }
  return [...records.values()];
}

export type StripMotionReference = { status: string; motionKey?: string; screen?: string; state?: string; width?: number; selector?: string; frame?: string };

export function stripMotionErrors(strips: readonly StripMotionReference[], records: readonly Motion[]): string[] {
  return strips.flatMap((strip, index) => {
    if (strip.status !== 'captured') return [];
    const matches = strip.motionKey && records.some(record =>
      motionKey(record) === strip.motionKey &&
      (['screen', 'state', 'width', 'selector', 'frame'] as const).every(field => strip[field] === undefined || strip[field] === record[field]));
    return matches ? [] : [`Captured strip ${index + 1} (${strip.screen ?? '?'} / ${strip.selector ?? '?'}) has no corresponding motion record`];
  });
}

export async function withDeadline<T>(operation: Promise<T>, milliseconds: number, name: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {timer = setTimeout(() => reject(Error(`${name} exceeded ${milliseconds}ms deadline`)), milliseconds);})]);
  } finally { clearTimeout(timer); }
}

/** Bounded viewport jobs; a rejection never cancels the remaining audit jobs. */
export async function settlePool<T>(items: readonly T[], concurrency: number, work: (item: T) => Promise<void>): Promise<PromiseSettledResult<void>[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw Error('Pool concurrency must be a positive integer');
  const results: PromiseSettledResult<void>[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({length: Math.min(concurrency, items.length)}, async () => {
    while (next < items.length) {
      const index = next++;
      try { await work(items[index]); results[index] = {status: 'fulfilled', value: undefined}; }
      catch (reason) { results[index] = {status: 'rejected', reason}; }
    }
  }));
  return results;
}

export async function closeAll(closers: readonly { name: string; close: () => unknown | Promise<unknown> }[], timeoutMs = 10000): Promise<string[]> {
  const results = await Promise.allSettled(closers.map(closer => withDeadline(Promise.resolve().then(() => closer.close()), timeoutMs, closer.name)));
  return results.flatMap((result, index) => result.status === 'rejected' ? [`${closers[index].name}: ${String(result.reason)}`] : []);
}

export function frameMotionErrors(ids: readonly string[], motion: readonly Motion[]): string[] {
  return ids.includes('plugin-frame') && !motion.some(isPluginIframe) ? ['plugin-frame has no iframe motion rows in motion.json; frame coverage is incomplete'] : [];
}

type FramedOutput = {screen?: string; frame?: string};
function isPluginIframe(row: FramedOutput) {
  return row.screen === 'plugin-frame' && typeof row.frame === 'string' && row.frame.trim().length > 0 && row.frame !== 'main';
}
export type CaptureOutputManifest = {screens: readonly string[]; widths: readonly number[]; entries: readonly CaptureEntry[]};
export type ReducedMotionOutput = {records: readonly Motion[]; offenders: readonly Motion[]};

/** Validate the actual output payloads before deciding the run's exit status. */
export function verifyCaptureOutputs(manifest: CaptureOutputManifest, motion: readonly Motion[], reduced: ReducedMotionOutput, strips: readonly StripMotionReference[]): string[] {
  const errors = [...stripMotionErrors(strips, motion), ...frameMotionErrors(manifest.screens, motion)];
  if (manifest.screens.includes('plugin-frame')) {
    if (!strips.some(row => row.status === 'captured' && isPluginIframe(row))) errors.push('plugin-frame has no captured iframe strip');
    if (!reduced.records.some(isPluginIframe)) errors.push('plugin-frame has no iframe rows in reduced-motion.json records');
  }
  const sampleKey = (row: Motion) => JSON.stringify([row.state, row.width, motionKey(normalizeMotion(row))]);
  const offenderKeys = new Set(reduced.offenders.map(sampleKey));
  for (const row of reduced.records.filter(isReducedOffender)) {
    if (!offenderKeys.has(sampleKey(row))) errors.push(`${row.screen}/${row.state}/${row.width} (${row.frame}) is missing from reduced-motion.json offenders`);
  }
  const required = requiredOutputScreenIds.filter(screen => manifest.screens.includes(screen));
  if (required.length && captureWidths.some(width => !manifest.widths.includes(width))) errors.push('manifest.widths must include 375, 768 and 1440 for output coverage');
  for (const screen of required) for (const state of keyStates) for (const width of captureWidths) {
    const rows = manifest.entries.filter(row => row.screen === screen && row.state === state && row.width === width && !row.reduced);
    const complete = rows.some(row => row.status === 'captured' || row.status === 'identical-to-default' || row.status === 'skipped' && Boolean(row.reason?.trim()));
    if (!complete) errors.push(`${screen}/${state}/${width}: missing captured/identical outcome or skipped outcome with a non-empty reason`);
  }
  return errors;
}

/** Reserve one slot for mandatory plugin iframe evidence without exceeding cap. */
export function canCaptureStrip(reservations: number, maxStrips: number, needsPluginIframe: boolean, isPluginCandidate: boolean) {
  return reservations < maxStrips - (needsPluginIframe && !isPluginCandidate ? 1 : 0);
}

export async function retryNavigation<T>(navigate: (attempt: 0 | 1) => Promise<T>): Promise<T> {
  try { return await navigate(0); }
  catch (error) {
    if (typeof error !== 'object' || error === null || !('name' in error) || error.name !== 'TimeoutError') throw error;
    return navigate(1);
  }
}

export function isSameOriginWebSocket(url: string, base: string): boolean {
  try {
    const socket = new URL(url);
    if (socket.protocol !== 'ws:' && socket.protocol !== 'wss:') return false;
    socket.protocol = socket.protocol === 'ws:' ? 'http:' : 'https:';
    return socket.origin === new URL(base).origin;
  } catch { return false; }
}

/** Only a declared heavy screen may reload once after a readiness timeout. */
export async function loadWithReadiness(
  navigate: () => Promise<void>,
  waitReady: () => Promise<void>,
  retryReadyTimeout = false,
  onRetry: () => void = () => {},
): Promise<void> {
  await navigate();
  try { await waitReady(); }
  catch (error) {
    if (!retryReadyTimeout || typeof error !== 'object' || error === null || !('name' in error) || error.name !== 'TimeoutError') throw error;
    onRetry();
    await navigate();
    await waitReady();
  }
}
