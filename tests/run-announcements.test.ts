import { describe, expect, it } from 'vitest';
import { runEventAnnouncements } from '../apps/web/src/run-announcements';

const base = { previousStatus: 'working' as string | null, status: 'working' as string | null, previousPendingApprovals: 0, pendingApprovals: 0 };

describe('runEventAnnouncements', () => {
  it('announces nothing while a reply streams (no transition)', () => {
    expect(runEventAnnouncements({ ...base })).toEqual([]);
  });
  it('politely announces a finished reply on working -> completed', () => {
    expect(runEventAnnouncements({ ...base, status: 'completed' })).toEqual([{ text: 'Assistant reply finished.', assertive: false }]);
  });
  it('does not announce finished for non-working transitions', () => {
    expect(runEventAnnouncements({ ...base, previousStatus: 'ready', status: 'completed' })).toEqual([]);
  });
  it('assertively announces a failed run, including the error text', () => {
    expect(runEventAnnouncements({ ...base, status: 'failed', error: 'model offline' })).toEqual([{ text: 'Run failed: model offline', assertive: true }]);
    expect(runEventAnnouncements({ ...base, status: 'failed' })).toEqual([{ text: 'Run failed.', assertive: true }]);
  });
  it('announces a cancelled run politely for stopped and interrupted', () => {
    for (const status of ['stopped', 'interrupted']) {
      expect(runEventAnnouncements({ ...base, status })).toEqual([{ text: 'Run cancelled.', assertive: false }]);
    }
  });
  it('assertively announces a new approval request', () => {
    expect(runEventAnnouncements({ ...base, pendingApprovals: 1 })).toEqual([{ text: 'Approval requested.', assertive: true }]);
  });
  it('does not re-announce approvals that were already pending', () => {
    expect(runEventAnnouncements({ ...base, previousPendingApprovals: 2, pendingApprovals: 2 })).toEqual([]);
    expect(runEventAnnouncements({ ...base, previousPendingApprovals: 2, pendingApprovals: 1 })).toEqual([]);
  });
  it('emits both announcements when a failure arrives with a new approval', () => {
    expect(runEventAnnouncements({ ...base, status: 'failed', pendingApprovals: 1 })).toEqual([
      { text: 'Run failed.', assertive: true },
      { text: 'Approval requested.', assertive: true },
    ]);
  });
});
