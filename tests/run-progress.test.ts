import {describe, expect, it} from 'vitest';
import {formatElapsed, threadWorking, RUN_ACTIVITY_LABELS} from '../apps/web/src/run-progress';
import type {Thread} from '../packages/contracts';

const thread = (patch: Partial<Thread>): Thread => ({
  id: 't1', projectId: 'p1', title: 'Run', status: 'ready', runId: null, createdAt: '0', updatedAt: '0', ...patch,
} as Thread);

describe('formatElapsed', () => {
  it('formats mm:ss, no hours clamp', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(59_999)).toBe('0:59');
    expect(formatElapsed(60_000)).toBe('1:00');
    expect(formatElapsed(72_000)).toBe('1:12');
    expect(formatElapsed(3_661_000)).toBe('61:01');
  });
  it('clamps negative to 0:00', () => {
    expect(formatElapsed(-500)).toBe('0:00');
  });
});

describe('threadWorking', () => {
  it('true on runId or working status', () => {
    expect(threadWorking(thread({runId: 'r1'}))).toBe(true);
    expect(threadWorking(thread({status: 'working'}))).toBe(true);
    expect(threadWorking(thread({status: 'ready'}))).toBe(false);
    expect(threadWorking(undefined)).toBe(false);
  });
});

describe('RUN_ACTIVITY_LABELS', () => {
  it('maps each activity to a label', () => {
    expect(RUN_ACTIVITY_LABELS.generating).toBe('Generating…');
    expect(RUN_ACTIVITY_LABELS.tool).toBe('Running tool…');
    expect(RUN_ACTIVITY_LABELS.queued).toBe('Queued for account…');
  });
});
