import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { z } from 'zod';
import type { ModelInfo } from '../../../packages/contracts';
import { authenticated, command, getModels, read, subscribe } from './api';
import { SchemaFields, schemaDefaults } from './registry';
import { Select } from '../../../packages/ui-shell/Select';
import './background-work.css';

/** M10 task-owned background drawer. The presentational view is fixture-
 * testable; the container binds the real host read/command paths. Dismissing
 * a notification never completes or approves work. */

const ownerSchema = z.object({ threadId: z.string(), runId: z.string().nullable(), epoch: z.number(), projectId: z.string().nullable(), workspaceId: z.string().nullable(), accountBinding: z.string().nullable() });
const workSchema = z.object({
  workId: z.string(), owner: ownerSchema, kind: z.string(), lifetime: z.string(), state: z.string(),
  outcome: z.string().nullable(), blockedReason: z.string().nullable(), title: z.string(),
  command: z.object({ executable: z.string(), argv: z.array(z.string()), cwd: z.string() }).nullable(),
  processIdentity: z.object({ pid: z.number(), creationToken: z.string().nullable() }).nullable(),
  deadlineMs: z.number(), startedAtMs: z.number().nullable(), settledAtMs: z.number().nullable(),
  outputRef: z.string().nullable(), error: z.string().nullable(), createdAt: z.string(), updatedAt: z.string(),
});
const scheduleSchema = z.object({
  wakeupId: z.string(), taskId: z.string(), state: z.string(), paused: z.boolean(),
  trigger: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('AT_UTC'), dueAtMs: z.number() }),
    z.object({ kind: z.literal('INTERVAL_UTC'), anchorMs: z.number(), intervalMs: z.number() }),
    z.object({ kind: z.literal('HOST_EVENT'), eventKind: z.string(), correlationKey: z.string() }),
  ]),
  scheduleTimezone: z.string().nullable(), nextDueAtMs: z.number().nullable(), lastRunAtMs: z.number().nullable(), skippedTotal: z.number(),
});
const stepSchema = z.object({ requestId: z.string(), owner: ownerSchema, questionRevision: z.number(), responseSchema: z.record(z.string(), z.unknown()), requiredAction: z.string(), deliveryState: z.string(), resumeBinding: z.object({ workId: z.string(), threadId: z.string() }) });
const intakeRecordSchema = z.object({ intakeId: z.string(), sourceInstallation: z.string(), repositoryId: z.number(), eventId: z.string(), receivedAt: z.string(), disposition: z.string(), rejectionReason: z.string().nullable(), proposedTask: z.object({ title: z.string(), sourceUrl: z.string(), issueNumber: z.number() }), decision: z.object({ threadId: z.string().nullable() }).nullable() });
const viewSchema = z.object({
  sequence: z.number(),
  works: z.array(workSchema).max(200),
  schedules: z.array(scheduleSchema).max(200),
  humanSteps: z.array(stepSchema).max(200),
  intake: z.object({
    status: z.object({ enabled: z.boolean(), available: z.boolean(), config: z.object({ repositoryId: z.number(), enabled: z.boolean(), sourceInstallation: z.string().nullable() }).nullable(), lastPollAt: z.string().nullable(), lastError: z.string().nullable() }),
    records: z.array(intakeRecordSchema).max(200),
  }),
  closeSummary: z.object({ serviceSupervisorProven: z.boolean(), runWorkStopsWithApp: z.boolean(), uncertainWork: z.number(), activeWork: z.number() }),
});
export type BackgroundViewData = z.infer<typeof viewSchema>;
type Work = z.infer<typeof workSchema>;
type Schedule = z.infer<typeof scheduleSchema>;
type Step = z.infer<typeof stepSchema>;

export interface OutputPage { output: string; cursor: number; exited: boolean; exitCode: number | null }
export interface BackgroundWorkViewProps {
  data: BackgroundViewData | null;
  loading: boolean;
  error: string;
  models: ModelInfo[];
  defaultModelId: string | null;
  onRefresh: () => void;
  onRespond: (requestId: string, revision: number, response: unknown, threadId: string) => Promise<void>;
  onDecline: (requestId: string, revision: number, threadId: string) => Promise<void>;
  onApprove: (intakeId: string, modelId: string) => Promise<void>;
  onReject: (intakeId: string) => Promise<void>;
  onPause: (wakeupId: string) => Promise<void>;
  onResume: (wakeupId: string) => Promise<void>;
  onCancel: (workId: string, threadId: string) => Promise<void>;
  onOpenThread: (threadId: string) => void;
  loadOutput: (workId: string, threadId: string, cursor: number) => Promise<OutputPage>;
}

export function stateLabel(work: Work): string {
  switch (work.state) {
    case 'QUEUED': case 'WAITING_EVENT': return 'Waiting';
    case 'RUNNING': return 'Running';
    case 'WAITING_HUMAN': return 'Waiting for you';
    case 'BLOCKED': return 'Blocked';
    case 'SETTLED': return 'Completed';
    default: return 'Outcome unknown';
  }
}
export function outcomeLabel(outcome: string | null): string {
  return outcome === 'SUCCEEDED' ? 'Succeeded' : outcome === 'FAILED' ? 'Failed' : outcome === 'CANCELLED' ? 'Cancelled' : '';
}
const when = (ms: number | null): string => ms === null ? '—' : new Date(ms).toLocaleString();
const elapsed = (work: Work): string => {
  const start = work.startedAtMs ?? Date.parse(work.createdAt);
  const end = work.settledAtMs ?? Date.now();
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  return seconds < 60 ? `${String(seconds)}s` : `${String(Math.floor(seconds / 60))}m ${String(seconds % 60)}s`;
};
const triggerLabel = (schedule: Schedule): string => {
  if (schedule.trigger.kind === 'AT_UTC') return `One-shot at ${when(schedule.trigger.dueAtMs)}`;
  if (schedule.trigger.kind === 'INTERVAL_UTC') return `Every ${String(Math.round(schedule.trigger.intervalMs / 1000))}s (UTC interval)`;
  return `Host event ${schedule.trigger.eventKind}`;
};
/** A pressed control disables while its action is in flight and its row can
 * unmount when the action settles; either drops focus to <body>. Return the
 * keyboard position to the acted-on unit once the update has committed.
 * Deliberately conservative: only a focus that already fell to <body> is
 * restored, so a deliberate move elsewhere is never stolen, and a hidden tab
 * (where animation frames do not run) loses the restore rather than guessing. */
const restoreFocus = (anchor: () => HTMLElement | null) => requestAnimationFrame(() => {
  if (document.activeElement === document.body) anchor()?.focus();
});

function HumanStepCard({ step, work, onRespond, onDecline, onSettled }: { step: Step; work: Work; onRespond: BackgroundWorkViewProps['onRespond']; onDecline: BackgroundWorkViewProps['onDecline']; onSettled: () => void }) {
  const [values, setValues] = useState<Record<string, unknown>>(() => (schemaDefaults(step.responseSchema) ?? {}) as Record<string, unknown>);
  const [busy, setBusy] = useState(false);
  const [cardError, setCardError] = useState('');
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setCardError('');
    try { await action(); } catch (cause) { setCardError(cause instanceof Error ? cause.message : 'The response could not be delivered.'); } finally { setBusy(false); onSettled(); }
  };
  return <section className="background-human" aria-label={`Human step for ${work.title}`}>
    <header><span className="background-state" data-state="waiting-human">Waiting for you</span><strong>{step.requestId}</strong><span className="background-muted">revision {String(step.questionRevision)}</span></header>
    {step.requiredAction === 'credential'
      ? <p className="background-note">This step needs a credential. Use the secure credential surface in Settings; never type secrets into a message or this card.</p>
      : <form onSubmit={event => { event.preventDefault(); void run(() => onRespond(step.requestId, step.questionRevision, values, step.owner.threadId)); }}>
        <p className="background-note">{step.requiredAction === 'approval' ? 'Answering correlates input only. Approving an operation still requires its exact approval envelope in the task.' : 'Answer the exact blocked step to resume this work.'}</p>
        <fieldset disabled={busy}><SchemaFields schema={step.responseSchema} value={values} onChange={setValues} /></fieldset>
        {cardError && <p role="status" className="error-text">{cardError}</p>}
        <div className="background-actions">
          <button type="button" className="quiet" disabled={busy} onClick={() => void run(() => onDecline(step.requestId, step.questionRevision, step.owner.threadId))}>Decline</button>
          <button className="primary" disabled={busy}>{busy ? 'Submitting…' : 'Respond'}</button>
        </div>
      </form>}
    {step.requiredAction === 'credential' && cardError && <p role="status" className="error-text">{cardError}</p>}
  </section>;
}

function WorkCard({ work, step, props }: { work: Work; step: Step | undefined; props: BackgroundWorkViewProps }) {
  const [output, setOutput] = useState<OutputPage | null>(null);
  const [outputError, setOutputError] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const card = useRef<HTMLElement>(null), outputId = useId();
  const restore = () => restoreFocus(() => card.current);
  const load = async (cursor: number) => {
    setOutputError('');
    try { setOutput(await props.loadOutput(work.workId, work.owner.threadId, cursor)); } catch (cause) { setOutputError(cause instanceof Error ? cause.message : 'Output could not load.'); }
  };
  const cancel = async () => {
    setBusy(true); setActionError('');
    try { await props.onCancel(work.workId, work.owner.threadId); } catch (cause) { setActionError(cause instanceof Error ? cause.message : 'The work could not be cancelled.'); } finally { setBusy(false); restore(); }
  };
  return <article ref={card} tabIndex={-1} className="background-card" aria-label={work.title} data-work-id={work.workId}>
    <header>
      <span className="background-state" data-state={work.state.toLowerCase()}>{stateLabel(work)}</span>
      {work.state === 'SETTLED' && <span className="background-outcome">{outcomeLabel(work.outcome)}</span>}
      <strong>{work.title}</strong>
      <span className="background-muted">{work.kind} · {work.lifetime}</span>
    </header>
    <dl className="background-meta">
      <div><dt>Owner</dt><dd>{work.owner.threadId}</dd></div>
      <div><dt>Elapsed</dt><dd>{elapsed(work)}</dd></div>
      {work.command && <div><dt>Command</dt><dd className="background-command">{work.command.executable} {work.command.argv.join(' ')}</dd></div>}
      {work.processIdentity && <div><dt>Process</dt><dd>pid {String(work.processIdentity.pid)}{work.processIdentity.creationToken ? '' : ' (identity unproven)'}</dd></div>}
      {work.state === 'BLOCKED' && work.blockedReason && <div><dt>Blocked</dt><dd>{work.blockedReason}</dd></div>}
      {work.state === 'UNKNOWN' && <div><dt>Uncertainty</dt><dd>{work.error ?? 'The outcome was not observed.'}</dd></div>}
    </dl>
    {actionError && <p role="status" className="error-text">{actionError}</p>}
    <div className="background-actions">
      <button type="button" className="quiet" onClick={() => props.onOpenThread(work.owner.threadId)}>Open child task</button>
      <button type="button" className="quiet" aria-expanded={output !== null} aria-controls={output !== null ? outputId : undefined} onClick={() => output === null ? void load(0) : setOutput(null)}>Output</button>
      {['QUEUED', 'RUNNING', 'WAITING_EVENT', 'WAITING_HUMAN'].includes(work.state) && <button type="button" className="quiet" disabled={busy} onClick={() => void cancel()}>Cancel</button>}
    </div>
    {output && <div className="background-output" id={outputId} role="region" aria-label={`Output for ${work.title}`}>
      <pre>{output.output || '(no output yet)'}</pre>
      <div className="background-actions">
        <span className="background-muted">cursor {String(output.cursor)} · {output.exited ? `exited ${String(output.exitCode ?? 'unknown')}` : 'running'}</span>
        <button type="button" className="quiet" onClick={() => void load(output.cursor)}>Refresh output</button>
      </div>
    </div>}
    {outputError && <p role="status" className="error-text">{outputError}</p>}
    {step && step.deliveryState === 'PENDING' && work.state === 'WAITING_HUMAN' && <HumanStepCard step={step} work={work} onRespond={props.onRespond} onDecline={props.onDecline} onSettled={restore} />}
  </article>;
}

function ScheduleRow({ schedule, props }: { schedule: Schedule; props: BackgroundWorkViewProps }) {
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState('');
  const row = useRef<HTMLLIElement>(null);
  const toggle = async () => {
    setBusy(true); setRowError('');
    try { schedule.paused ? await props.onResume(schedule.wakeupId) : await props.onPause(schedule.wakeupId); } catch (cause) { setRowError(cause instanceof Error ? cause.message : 'The schedule could not change.'); } finally { setBusy(false); restoreFocus(() => row.current); }
  };
  return <li ref={row} tabIndex={-1} className="background-schedule" data-wakeup-id={schedule.wakeupId}>
    <div>
      <strong>{triggerLabel(schedule)}</strong>
      <span className="background-muted">next {when(schedule.nextDueAtMs)} · timezone {schedule.scheduleTimezone ?? 'UTC'} (display only) · last run {when(schedule.lastRunAtMs)} · skipped {String(schedule.skippedTotal)}</span>
    </div>
    <div className="background-actions">
      <span className="background-state" data-state={schedule.state.toLowerCase()}>{schedule.paused ? 'Paused' : schedule.state}</span>
      <button type="button" className="quiet" disabled={busy || schedule.state === 'CANCELLED'} onClick={() => void toggle()}>{schedule.paused ? 'Resume' : 'Pause'}</button>
    </div>
    {rowError && <p role="status" className="error-text">{rowError}</p>}
  </li>;
}

function IntakeSection({ intake, models, defaultModelId, props }: { intake: BackgroundViewData['intake']; models: ModelInfo[]; defaultModelId: string | null; props: BackgroundWorkViewProps }) {
  const [modelId, setModelId] = useState(defaultModelId ?? '');
  const [busyId, setBusyId] = useState('');
  const [intakeError, setIntakeError] = useState('');
  const proposed = intake.records.filter(record => record.disposition === 'PROPOSED');
  const approved = intake.records.filter(record => record.disposition === 'APPROVED');
  const rejected = intake.records.filter(record => record.disposition === 'REJECTED');
  const section = useRef<HTMLElement>(null);
  const act = async (intakeId: string, action: () => Promise<void>) => {
    setBusyId(intakeId); setIntakeError('');
    try { await action(); } catch (cause) { setIntakeError(cause instanceof Error ? cause.message : 'The decision could not be recorded.'); } finally {
      setBusyId('');
      restoreFocus(() => Array.from(section.current?.querySelectorAll<HTMLElement>('[data-intake-id]') ?? []).find(row => row.dataset.intakeId === intakeId) ?? section.current ?? null);
    }
  };
  return <section ref={section} tabIndex={-1} className="background-intake" aria-label="External task inbox">
    <h3>External tasks</h3>
    {!intake.status.available && <p className="background-note">Intake is unavailable: connect the authenticated GitHub connection and enable polling. No webhook listener exists.</p>}
    {intake.status.available && !intake.status.enabled && <p className="background-note">Polling is paused by configuration.</p>}
    {intake.status.config && <p className="background-muted">repository {String(intake.status.config.repositoryId)} · source {intake.status.config.sourceInstallation ?? 'authenticated GitHub'} · last poll {intake.status.lastPollAt ?? 'never'}{intake.status.lastError ? ` · ${intake.status.lastError}` : ''}</p>}
    {intakeError && <p role="status" className="error-text">{intakeError}</p>}
    <h4>Proposed</h4>
    {proposed.length === 0 && <p className="background-muted">No proposed external work.</p>}
    <ul data-intake-list="proposed">
      {proposed.map(record => <li key={record.intakeId} tabIndex={-1} className="background-intake-row" data-intake-id={record.intakeId}>
        <div><strong>{record.proposedTask.title}</strong><span className="background-muted">issue {String(record.proposedTask.issueNumber)} · {record.sourceInstallation} · {record.receivedAt}</span></div>
        <div className="background-actions">
          <div className="background-model">
            <Select aria-label="Approval model" value={modelId} onValueChange={setModelId} disabled={models.length === 0}
              options={[{ value: '', label: 'Choose a model' }, ...models.map(model => ({ value: model.id, label: model.name }))]} />
          </div>
          <button type="button" className="quiet" disabled={busyId === record.intakeId} onClick={() => void act(record.intakeId, () => props.onReject(record.intakeId))}>Reject</button>
          <button type="button" className="primary" disabled={busyId === record.intakeId || !modelId} onClick={() => void act(record.intakeId, () => props.onApprove(record.intakeId, modelId))}>Approve</button>
        </div>
      </li>)}
    </ul>
    <h4>Approved</h4>
    {approved.length === 0 && <p className="background-muted">No approved external work.</p>}
    <ul data-intake-list="approved">
      {approved.map(record => <li key={record.intakeId} tabIndex={-1} className="background-intake-row" data-intake-id={record.intakeId}>
        <div><strong>{record.proposedTask.title}</strong><span className="background-muted">approved · {record.sourceInstallation}</span></div>
        {record.decision?.threadId && <button type="button" className="quiet" onClick={() => props.onOpenThread(record.decision!.threadId!)}>Open child task</button>}
      </li>)}
    </ul>
    {rejected.length > 0 && <p className="background-muted">Rejected or duplicate deliveries: {String(rejected.length)}{rejected[0]?.rejectionReason ? ` (${rejected[0].rejectionReason})` : ''}</p>}
  </section>;
}

export function BackgroundWorkView(props: BackgroundWorkViewProps) {
  const { data, loading, error } = props;
  return <div className="background-work">
    <header className="background-toolbar">
      <h2>Background work</h2>
      <button type="button" className="quiet" onClick={props.onRefresh}>Refresh</button>
    </header>
    <p className="background-close-warning" role="note">
      {data?.closeSummary.serviceSupervisorProven
        ? 'An approved service supervisor keeps proven service work running after close.'
        : 'Background work stops when Gen closes. No proven service supervisor is installed, and laptop sleep never runs work.'}
      {data && data.closeSummary.uncertainWork > 0 ? ` ${String(data.closeSummary.uncertainWork)} uncertain outcome(s) remain quarantined for inspection.` : ''}
    </p>
    {error && <p role="alert" className="error-text background-error">{error} <button type="button" className="quiet" onClick={props.onRefresh}>Retry</button></p>}
    {loading && !data && <p role="status" className="background-muted">Loading background work…</p>}
    {data && data.works.length === 0 && data.schedules.length === 0 && data.intake.records.length === 0 && <p className="background-empty">No background work yet. Owned jobs, schedules and external proposals appear here.</p>}
    {data && <div className="background-body">
      <section aria-label="Owned background work">
        {data.works.map(work => <WorkCard key={work.workId} work={work} step={data.humanSteps.find(step => step.resumeBinding.workId === work.workId && step.deliveryState === 'PENDING') ?? data.humanSteps.find(step => step.resumeBinding.workId === work.workId)} props={props} />)}
      </section>
      <section className="background-schedules" aria-label="Schedules">
        <h3>Schedules</h3>
        {data.schedules.length === 0 ? <p className="background-muted">No schedules.</p> : <ul>{data.schedules.map(schedule => <ScheduleRow key={schedule.wakeupId} schedule={schedule} props={props} />)}</ul>}
      </section>
      <IntakeSection intake={data.intake} models={props.models} defaultModelId={props.defaultModelId} props={props} />
    </div>}
  </div>;
}

// ---- live host binding ----

interface BackgroundState { data: BackgroundViewData | null; loading: boolean; error: string; sequence: number }
let state: BackgroundState = { data: null, loading: false, error: '', sequence: 0 };
const listeners = new Set<() => void>();
let stop: (() => void) | undefined, flight: Promise<void> | undefined, timer: ReturnType<typeof setTimeout> | undefined;
const publish = () => { for (const listener of listeners) listener(); };
export function refreshBackgroundWork(): Promise<void> {
  return flight ??= (async () => {
    state = { ...state, loading: true }; publish();
    try {
      const value = await authenticated(() => fetch('/api/background', { credentials: 'same-origin', cache: 'no-store', redirect: 'error' })).then(read<unknown>);
      const parsed = viewSchema.parse(value);
      state = { data: parsed, loading: false, error: '', sequence: parsed.sequence }; publish();
    } catch (cause) {
      state = { ...state, loading: false, error: cause instanceof Error ? cause.message : 'Background work could not load.' }; publish();
    } finally { flight = undefined; }
  })();
}
function listen(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    let cancelled = false, disconnect: (() => void) | undefined;
    const changed = () => { clearTimeout(timer); timer = setTimeout(() => void refreshBackgroundWork(), 60); };
    void refreshBackgroundWork().then(() => {
      if (cancelled || !listeners.size) return;
      disconnect = subscribe(state.sequence, changed, connected => { if (!connected) { state = { ...state, error: 'Background work is reconnecting…' }; publish(); } }, refreshBackgroundWork);
    });
    window.addEventListener('focus', changed);
    stop = () => { cancelled = true; disconnect?.(); window.removeEventListener('focus', changed); };
  }
  return () => { listeners.delete(listener); if (!listeners.size) { clearTimeout(timer); stop?.(); stop = undefined; } };
}
export function useBackgroundWork(enabled = true) {
  const current = useSyncExternalStore(enabled ? listen : () => () => {}, () => state, () => state);
  useEffect(() => { if (enabled) void refreshBackgroundWork(); }, [enabled]);
  return current;
}

export function BackgroundWork({ active = true, onOpenThread, defaultModelId = null }: { active?: boolean; onOpenThread: (threadId: string) => void | Promise<void>; defaultModelId?: string | null }) {
  const { data, loading, error } = useBackgroundWork(active);
  const [models, setModels] = useState<ModelInfo[]>([]);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void getModels().then(value => { if (!cancelled) setModels(value.models); }).catch(() => {});
    return () => { cancelled = true; };
  }, [active]);
  const mutate = async (type: string, payload: Record<string, unknown>, threadId?: string) => {
    await command(type, payload, threadId);
    await refreshBackgroundWork();
  };
  return <BackgroundWorkView
    data={data} loading={loading} error={error} models={models} defaultModelId={defaultModelId}
    onRefresh={() => void refreshBackgroundWork()}
    onRespond={(requestId, revision, response, threadId) => mutate('background.human.respond', { requestId, revision, response }, threadId)}
    onDecline={(requestId, revision, threadId) => mutate('background.human.decline', { requestId, revision }, threadId)}
    onApprove={(intakeId, modelId) => mutate('intake.approve', { intakeId, modelId })}
    onReject={intakeId => mutate('intake.reject', { intakeId })}
    onPause={wakeupId => mutate('background.wakeup.pause', { wakeupId })}
    onResume={wakeupId => mutate('background.wakeup.resume', { wakeupId })}
    onCancel={(workId, threadId) => mutate('background.work.cancel', { workId }, threadId)}
    onOpenThread={id => void onOpenThread(id)}
    loadOutput={async (workId, threadId, cursor) => {
      const query = new URLSearchParams({ threadId, cursor: String(cursor) });
      return authenticated(() => fetch(`/api/background/work/${encodeURIComponent(workId)}/output?${query}`, { credentials: 'same-origin', cache: 'no-store', redirect: 'error' })).then(read<OutputPage>);
    }}
  />;
}
