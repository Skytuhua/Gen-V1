import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BackgroundWorkView, type BackgroundViewData, type OutputPage } from '../../../apps/web/src/BackgroundWork';
import '../../../apps/web/src/styles.css';

type Mode = 'success' | 'reject' | 'stale';
type Call = { type: string; id?: string; revision?: number; response?: unknown; modelId?: string; cursor?: number };
declare global { interface Window { backgroundWork: { calls: Call[]; respondMode: Mode; declineMode: Mode; approveMode: Mode; refreshMode: 'success' | 'error' | 'empty' | 'loading'; outputMode: 'success' | 'reject' } } }
window.backgroundWork = { calls: [], respondMode: 'success', declineMode: 'success', approveMode: 'success', refreshMode: 'success', outputMode: 'success' };

const owner = (threadId: string) => ({ threadId, runId: null, epoch: 0, projectId: null, workspaceId: null, accountBinding: null });
const base = { lifetime: 'RUN', outputRef: null, error: null, deadlineMs: 1_700_000_600_000, startedAtMs: 1_700_000_000_000, settledAtMs: null, createdAt: '2026-11-16T00:00:00Z', updatedAt: '2026-11-16T00:00:00Z', processIdentity: null };
const initial: BackgroundViewData = {
  sequence: 7,
  works: [
    { ...base, workId: 'w-queued', owner: owner('thread-a'), kind: 'MAINTENANCE', state: 'QUEUED', outcome: null, blockedReason: null, title: 'Nightly verification', command: null, startedAtMs: null },
    { ...base, workId: 'w-running', owner: owner('thread-b'), kind: 'COMMAND', state: 'RUNNING', outcome: null, blockedReason: null, title: 'Owned command', command: { executable: '/usr/bin/node', argv: ['-e', 'console.log(1)'], cwd: '/tmp/project' }, processIdentity: { pid: 4242, creationToken: '9911' } },
    { ...base, workId: 'w-human', owner: owner('thread-c'), kind: 'EXTERNAL_TASK', state: 'WAITING_HUMAN', outcome: null, blockedReason: null, title: 'Blocked external step', command: null },
    { ...base, workId: 'w-credential', owner: owner('thread-f'), kind: 'EXTERNAL_TASK', state: 'WAITING_HUMAN', outcome: null, blockedReason: null, title: 'Credential step', command: null },
    { ...base, workId: 'w-blocked', owner: owner('thread-d'), kind: 'REVIEW', state: 'BLOCKED', outcome: null, blockedReason: 'HOLD_FORK_API', title: 'Review fork', command: null },
    { ...base, workId: 'w-ok', owner: owner('thread-e'), kind: 'COMMAND', state: 'SETTLED', outcome: 'SUCCEEDED', blockedReason: null, title: 'Finished command', command: null, settledAtMs: 1_700_000_030_000 },
    { ...base, workId: 'w-failed', owner: owner('thread-e'), kind: 'COMMAND', state: 'SETTLED', outcome: 'FAILED', blockedReason: null, title: 'Failed command', command: null, settledAtMs: 1_700_000_030_000 },
    { ...base, workId: 'w-cancelled', owner: owner('thread-e'), kind: 'MAINTENANCE', state: 'SETTLED', outcome: 'CANCELLED', blockedReason: null, title: 'Cancelled idle', command: null, settledAtMs: 1_700_000_030_000 },
    { ...base, workId: 'w-unknown', owner: owner('thread-g'), kind: 'COMMAND', state: 'UNKNOWN', outcome: null, blockedReason: null, title: 'Orphaned command', command: null, error: 'The host restarted before an exit receipt was observed.' },
  ],
  schedules: [
    { wakeupId: 's-interval', taskId: 'w-queued', state: 'PENDING', paused: false, trigger: { kind: 'INTERVAL_UTC', anchorMs: 1_700_000_000_000, intervalMs: 60_000 }, scheduleTimezone: 'Europe/Berlin', nextDueAtMs: 1_700_000_060_000, lastRunAtMs: 1_700_000_000_000, skippedTotal: 4 },
    { wakeupId: 's-once', taskId: 'w-running', state: 'DELIVERED', paused: true, trigger: { kind: 'AT_UTC', dueAtMs: 1_700_000_000_000 }, scheduleTimezone: null, nextDueAtMs: null, lastRunAtMs: 1_700_000_000_000, skippedTotal: 0 },
  ],
  humanSteps: [
    { requestId: 'req-1', owner: owner('thread-c'), questionRevision: 2, responseSchema: { type: 'object', properties: { answer: { type: 'string', title: 'Answer' } }, required: ['answer'] }, requiredAction: 'answer', deliveryState: 'PENDING', resumeBinding: { workId: 'w-human', threadId: 'thread-c' } },
    { requestId: 'req-2', owner: owner('thread-f'), questionRevision: 1, responseSchema: {}, requiredAction: 'credential', deliveryState: 'PENDING', resumeBinding: { workId: 'w-credential', threadId: 'thread-f' } },
  ],
  intake: {
    status: { enabled: true, available: true, config: { repositoryId: 1442565952, enabled: true, sourceInstallation: 'octocat' }, lastPollAt: '2026-11-16T00:01:00Z', lastError: null },
    records: [
      { intakeId: 'i-proposed', sourceInstallation: 'octocat', repositoryId: 1442565952, eventId: 'I_1', receivedAt: '2026-11-16T00:00:30Z', disposition: 'PROPOSED', rejectionReason: null, proposedTask: { title: 'Repair the export path', sourceUrl: 'https://github.com/skytuhua-org/Gen-V1/issues/7', issueNumber: 7 }, decision: null },
      { intakeId: 'i-approved', sourceInstallation: 'octocat', repositoryId: 1442565952, eventId: 'I_2', receivedAt: '2026-11-16T00:00:20Z', disposition: 'APPROVED', rejectionReason: null, proposedTask: { title: 'Document the scheduler', sourceUrl: 'https://github.com/skytuhua-org/Gen-V1/issues/8', issueNumber: 8 }, decision: { threadId: 'thread-approved' } },
      { intakeId: 'i-rejected', sourceInstallation: 'octocat', repositoryId: 1442565952, eventId: 'I_3', receivedAt: '2026-11-16T00:00:10Z', disposition: 'REJECTED', rejectionReason: 'WRONG_REPOSITORY', proposedTask: { title: 'Wrong repo', sourceUrl: 'https://github.com/other/repo/issues/1', issueNumber: 1 }, decision: null },
    ],
  },
  closeSummary: { serviceSupervisorProven: false, runWorkStopsWithApp: true, uncertainWork: 1, activeWork: 4 },
};
const empty: BackgroundViewData = { ...initial, works: [], schedules: [], humanSteps: [], intake: { ...initial.intake, records: [] }, closeSummary: { serviceSupervisorProven: false, runWorkStopsWithApp: true, uncertainWork: 0, activeWork: 0 } };

function Fixture() {
  const [data, setData] = useState<BackgroundViewData | null>(initial);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const result = (mode: Mode, message: string) => {
    if (mode === 'reject') return Promise.reject(new Error(message));
    if (mode === 'stale') return Promise.reject(new Error('This question revision is no longer pending.'));
    return Promise.resolve();
  };
  return <main><p>Synthetic source fixture · no live host or approval authority</p><div className="fixture-background">
    <BackgroundWorkView
      data={data} loading={loading} error={error}
      models={[{ id: 'test/model', provider: 'test', name: 'Test model' }]} defaultModelId={null}
      onRefresh={() => {
        window.backgroundWork.calls.push({ type: 'refresh' });
        const mode = window.backgroundWork.refreshMode;
        if (mode === 'error') { setError('Background work is reconnecting…'); return; }
        setError('');
        if (mode === 'empty') { setData(empty); return; }
        if (mode === 'loading') { setLoading(true); setData(null); return; }
        setLoading(false); setData(initial);
      }}
      onRespond={async (requestId, revision, response, threadId) => {
        window.backgroundWork.calls.push({ type: 'respond', id: requestId, revision, response });
        void threadId;
        await result(window.backgroundWork.respondMode, 'The response could not be delivered.');
        setData(current => current && { ...current, humanSteps: current.humanSteps.map(step => step.requestId === requestId ? { ...step, deliveryState: 'ANSWERED' } : step), works: current.works.map(work => work.workId === 'w-human' ? { ...work, state: 'QUEUED' } : work) });
      }}
      onDecline={async (requestId, revision) => {
        window.backgroundWork.calls.push({ type: 'decline', id: requestId, revision });
        await result(window.backgroundWork.declineMode, 'The decline could not be recorded.');
        setData(current => current && { ...current, humanSteps: current.humanSteps.map(step => step.requestId === requestId ? { ...step, deliveryState: 'DECLINED' } : step), works: current.works.map(work => work.workId === 'w-human' ? { ...work, state: 'SETTLED', outcome: 'CANCELLED' } : work) });
      }}
      onApprove={async (intakeId, modelId) => {
        window.backgroundWork.calls.push({ type: 'approve', id: intakeId, modelId });
        await result(window.backgroundWork.approveMode, 'The decision could not be recorded.');
        setData(current => current && { ...current, intake: { ...current.intake, records: current.intake.records.map(record => record.intakeId === intakeId ? { ...record, disposition: 'APPROVED', decision: { threadId: 'thread-approved' } } : record) } });
      }}
      onReject={async intakeId => {
        window.backgroundWork.calls.push({ type: 'reject', id: intakeId });
        setData(current => current && { ...current, intake: { ...current.intake, records: current.intake.records.map(record => record.intakeId === intakeId ? { ...record, disposition: 'REJECTED', rejectionReason: 'USER_REJECTED' } : record) } });
      }}
      onPause={async wakeupId => { window.backgroundWork.calls.push({ type: 'pause', id: wakeupId }); setData(current => current && { ...current, schedules: current.schedules.map(schedule => schedule.wakeupId === wakeupId ? { ...schedule, paused: true } : schedule) }); }}
      onResume={async wakeupId => { window.backgroundWork.calls.push({ type: 'resume', id: wakeupId }); setData(current => current && { ...current, schedules: current.schedules.map(schedule => schedule.wakeupId === wakeupId ? { ...schedule, paused: false } : schedule) }); }}
      onCancel={async (workId, threadId) => { window.backgroundWork.calls.push({ type: 'cancel', id: workId }); void threadId; setData(current => current && { ...current, works: current.works.map(work => work.workId === workId ? { ...work, state: 'SETTLED', outcome: 'CANCELLED' } : work) }); }}
      onOpenThread={threadId => { window.backgroundWork.calls.push({ type: 'open', id: threadId }); }}
      loadOutput={async (workId, _threadId, cursor) => {
        window.backgroundWork.calls.push({ type: 'output', id: workId, cursor });
        if (window.backgroundWork.outputMode === 'reject') throw new Error('Output could not load.');
        return { output: `line one\ncursor was ${String(cursor)}`, cursor: cursor + 9, exited: false, exitCode: null } satisfies OutputPage;
      }}
    />
  </div></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
