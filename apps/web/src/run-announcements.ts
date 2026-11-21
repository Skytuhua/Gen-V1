// Maps conversation run state transitions to screen-reader announcements.
// Announce once when an event finishes; streamed tokens announce nothing.
export interface RunEventInput {
  previousStatus: string | null;
  status: string | null;
  error?: string | null;
  previousPendingApprovals: number;
  pendingApprovals: number;
}
export interface RunAnnouncement {
  text: string;
  assertive: boolean;
}
export function runEventAnnouncements(input: RunEventInput): RunAnnouncement[] {
  const out: RunAnnouncement[] = [];
  if (input.status && input.previousStatus && input.status !== input.previousStatus) {
    if (input.status === 'failed') {
      out.push({ text: input.error ? `Run failed: ${input.error}` : 'Run failed.', assertive: true });
    } else if (input.status === 'completed' && input.previousStatus === 'working') {
      out.push({ text: 'Assistant reply finished.', assertive: false });
    } else if (input.status === 'stopped' || input.status === 'interrupted') {
      out.push({ text: 'Run cancelled.', assertive: false });
    }
  }
  if (input.pendingApprovals > input.previousPendingApprovals) {
    out.push({ text: 'Approval requested.', assertive: true });
  }
  return out;
}
