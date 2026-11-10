import { motionKey, normalizeMotion, type CaptureEntry, type Motion } from './helpers';

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

export type StripMotionReference = { status: string; motionKey?: string; screen?: string; state?: string; width?: number; selector?: string };

export function stripMotionErrors(strips: readonly StripMotionReference[], records: readonly Motion[]): string[] {
  return strips.flatMap((strip, index) => {
    if (strip.status !== 'captured') return [];
    const matches = strip.motionKey && records.some(record =>
      motionKey(record) === strip.motionKey &&
      (['screen', 'state', 'width', 'selector'] as const).every(field => strip[field] === undefined || strip[field] === record[field]));
    return matches ? [] : [`Captured strip ${index + 1} (${strip.screen ?? '?'} / ${strip.selector ?? '?'}) has no corresponding motion record`];
  });
}

export async function closeAll(closers: readonly { name: string; close: () => unknown | Promise<unknown> }[]): Promise<string[]> {
  const results = await Promise.allSettled(closers.map(closer => Promise.resolve().then(() => closer.close())));
  return results.flatMap((result, index) => result.status === 'rejected' ? [`${closers[index].name}: ${String(result.reason)}`] : []);
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
