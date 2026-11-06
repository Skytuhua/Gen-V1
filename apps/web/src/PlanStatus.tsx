import { useEffect, useId, useMemo, useState, type CSSProperties } from 'react';
import { Bot, Check, ChevronDown, ChevronRight, Circle, Flag, GitBranch, TriangleAlert } from 'lucide-react';
import type { Snapshot } from '../../../packages/contracts';
import { agentProgress, type AgentJob, type PlanStep } from '../../../packages/contracts/planning';
import { selectPlanRecord } from './plan-visibility';
import { MotionRegion } from './task-motion';
import './plan-status.css';

const agentLabels: Record<AgentJob['status'], string> = {
  queued: 'Queued',
  working: 'Working',
  completed: 'Completed',
  needs_review: 'Needs review',
  failed: 'Failed',
  cancelled: 'Cancelled',
  interrupted: 'Interrupted',
};

const stepLabels: Record<PlanStep['status'], string> = {
  pending: 'Pending',
  working: 'In progress',
  completed: 'Completed',
  blocked: 'Blocked',
};

const stepEmptyNotes: Record<PlanStep['status'], string> = {
  completed: 'Completed with no sub-checks recorded.',
  working: 'Currently in progress.',
  blocked: 'Blocked — waiting on resolution.',
  pending: 'Not started.',
};

const number = (value: number) =>
  new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);

const currency = (value: number) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(value);

function Requirement({ label, completed }: { label: string; completed: boolean }) {
  return (
    <li className={completed ? 'is-complete' : ''}>
      {completed ? <Check size={13} aria-hidden="true" /> : <Circle size={11} aria-hidden="true" />}
      <span>{label}</span>
      <span className="sr-only">{completed ? 'Complete' : 'Not complete'}</span>
    </li>
  );
}

function AgentRow({ job }: { job: AgentJob; threadId?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const progress = agentProgress(job);
  const radius = 17;
  const circumference = 2 * Math.PI * radius;
  const usage = job.usage;
  const hasUsage = Boolean(usage && (usage.inputTokens != null || usage.outputTokens != null || usage.cost != null));
  const totalTokens = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);

  return (
    <li className={`plan-agent agent-${job.status}`} data-agent-id={job.id}>
      <button
        type="button"
        className="plan-agent-summary"
        aria-label={`Inspect ${job.name}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(value => !value)}
      >
        <span
          className={`plan-agent-ring${progress === null ? ' is-indeterminate' : ''}`}
          role="progressbar"
          aria-label={`${job.name} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress ?? undefined}
          aria-valuetext={
            progress === null
              ? 'Progress not reported'
              : `${progress}%${job.requirements.length ? ' of requirements completed' : ' reported by agent'}`
          }
        >
          <svg viewBox="0 0 42 42" aria-hidden="true">
            <circle className="plan-ring-track" cx="21" cy="21" r={radius} />
            <circle
              className="plan-ring-value"
              cx="21"
              cy="21"
              r={radius}
              style={
                {
                  strokeDasharray: progress === null ? '7 5' : circumference,
                  strokeDashoffset: progress === null ? 0 : circumference * (1 - progress / 100),
                } as CSSProperties
              }
            />
          </svg>
          <Bot size={16} aria-hidden="true" />
        </span>
        <span className="plan-agent-copy">
          <strong>{job.name}</strong>
          <span>{job.task}</span>
          {(job.requirements.length > 0 || hasUsage) && (
            <span className="plan-agent-inline-meta" aria-hidden="true">
              {job.requirements.length > 0 && (
                <span className="plan-inline-chip">
                  {job.completedRequirementIds.length}/{job.requirements.length} checks
                </span>
              )}
              {usage?.cost != null ? (
                <span className="plan-inline-chip">{currency(usage.cost)}</span>
              ) : totalTokens > 0 ? (
                <span className="plan-inline-chip">{number(totalTokens)} tok</span>
              ) : null}
            </span>
          )}
        </span>
        <span className="plan-agent-state">
          <span className="plan-agent-badge">{agentLabels[job.status]}</span>
          {progress !== null && <strong aria-hidden="true">{progress}%</strong>}
          <ChevronDown size={12} aria-hidden="true" />
        </span>
      </button>

      <MotionRegion open={open} id={id} className="plan-agent-details">
        {job.summary && <p className="plan-agent-summary-text">{job.summary}</p>}
        {job.error && (
          <p className="error-text plan-agent-error" role="status">
            {job.error}
          </p>
        )}
        {job.requirements.length > 0 ? (
          <>
            <p className="plan-progress-basis">
              {job.completedRequirementIds.length} of {job.requirements.length} requirements complete
            </p>
            <ul className="plan-requirements">
              {job.requirements.map(requirement => (
                <Requirement
                  key={requirement.id}
                  label={requirement.label}
                  completed={job.completedRequirementIds.includes(requirement.id)}
                />
              ))}
            </ul>
          </>
        ) : (
          <p className="plan-progress-basis">
            {progress === null ? 'Progress has not been reported.' : 'Progress reported by this agent.'}
          </p>
        )}
        {hasUsage && usage && (
          <dl className="plan-agent-usage">
            {usage.inputTokens != null && (
              <>
                <dt>Input tokens</dt>
                <dd>{number(usage.inputTokens)}</dd>
              </>
            )}
            {usage.outputTokens != null && (
              <>
                <dt>Output tokens</dt>
                <dd>{number(usage.outputTokens)}</dd>
              </>
            )}
            {usage.cost != null && (
              <>
                <dt>Reported cost</dt>
                <dd>{currency(usage.cost)}</dd>
              </>
            )}
          </dl>
        )}
      </MotionRegion>
    </li>
  );
}

function StepRow({
  step,
  index,
  agents,
  threadId,
  expandSignal,
}: {
  step: PlanStep;
  index: number;
  agents: AgentJob[];
  threadId?: string;
  expandSignal: { seq: number; open: boolean } | null;
}) {
  const [open, setOpen] = useState(step.status === 'working' || step.status === 'blocked');
  const id = useId();

  useEffect(() => {
    if (expandSignal) setOpen(expandSignal.open);
  }, [expandSignal]);

  const completedChecks = step.requirements.filter(req => req.completed).length;

  return (
    <li className={`plan-step step-${step.status}`} data-step-id={step.id}>
      <button
        className="plan-step-summary"
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(value => !value)}
      >
        <span className="plan-step-node" aria-hidden="true">
          {step.status === 'completed' ? (
            <Check size={13} />
          ) : step.status === 'blocked' ? (
            <TriangleAlert size={12} />
          ) : (
            <span />
          )}
        </span>
        <span className="plan-step-copy">
          <strong>{step.title}</strong>
          <span className="plan-step-meta-row">
            <span className="plan-step-index" aria-hidden="true">
              Step {index + 1}
            </span>
            <small className="plan-step-badge">{stepLabels[step.status]}</small>
            {step.requirements.length > 0 && (
              <span className="plan-step-count" aria-hidden="true">
                {completedChecks}/{step.requirements.length} checks
              </span>
            )}
            {agents.length > 0 && (
              <span className="plan-step-count" aria-hidden="true">
                {agents.length} {agents.length === 1 ? 'agent' : 'agents'}
              </span>
            )}
          </span>
        </span>
        <ChevronRight size={14} aria-hidden="true" />
      </button>
      <MotionRegion open={open} id={id} className="plan-step-details">
        {step.requirements.length > 0 && (
          <ul className="plan-requirements">
            {step.requirements.map(requirement => (
              <Requirement key={requirement.id} label={requirement.label} completed={requirement.completed} />
            ))}
          </ul>
        )}
        {step.requirements.length === 0 && agents.length === 0 && (
          <p className="plan-step-empty-note">{stepEmptyNotes[step.status]}</p>
        )}
        {agents.length > 0 && (
          <div className="plan-step-agents-group">
            <span className="plan-subsection-label">Assigned agents</span>
            <ul className="plan-agents">
              {agents.map(job => (
                <AgentRow key={job.id} job={job} threadId={threadId} />
              ))}
            </ul>
          </div>
        )}
      </MotionRegion>
    </li>
  );
}

export function PlanStatus({ snapshot, threadId }: { snapshot: Snapshot; threadId?: string }) {
  const record = useMemo(() => selectPlanRecord(snapshot, threadId), [snapshot.data, threadId]);
  const [expandSignal, setExpandSignal] = useState<{ seq: number; open: boolean } | null>(null);

  if (!record)
    return (
      <section className="plan-status plan-empty" aria-label="Task plan">
        <GitBranch size={23} aria-hidden="true" />
        <h3>No plan yet</h3>
        <p>The task’s steps and delegated work will appear here when the agent publishes a plan.</p>
      </section>
    );
  if (!record.plan)
    return (
      <section className="plan-status plan-empty" aria-label="Task plan">
        <TriangleAlert size={22} aria-hidden="true" />
        <h3>Plan unavailable</h3>
        <p>The recorded plan is invalid. Ask the agent to refresh it.</p>
      </section>
    );

  const plan = record.plan;
  const assigned = new Set(plan.steps.flatMap(step => step.agentIds ?? []));
  const unassigned = plan.agents.filter(job => !assigned.has(job.id));
  const complete = plan.steps.filter(step => step.status === 'completed').length;
  const workingCount = plan.steps.filter(step => step.status === 'working').length;
  const blockedCount = plan.steps.filter(step => step.status === 'blocked').length;
  const pendingCount = plan.steps.filter(step => step.status === 'pending').length;

  const allRequirements = plan.steps.flatMap(step => step.requirements);
  const totalReqs = allRequirements.length;
  const completedReqs = allRequirements.filter(req => req.completed).length;

  const stepPercent = plan.steps.length > 0 ? Math.round((complete / plan.steps.length) * 100) : 0;

  const bulkOpen = expandSignal?.open ?? false;

  return (
    <section className="plan-status" aria-label="Task plan">
      <header className="plan-status-header">
        <div className="plan-header-top">
          <Flag size={16} aria-hidden="true" />
          <div className="plan-header-title-wrap">
            <h3>{plan.title}</h3>
            <span className="plan-revision-pill">Rev {record.revision}</span>
          </div>
          {plan.steps.length > 0 && (
            <button
              type="button"
              className="plan-expand-all quiet"
              onClick={() => setExpandSignal(prev => ({ seq: (prev?.seq ?? 0) + 1, open: !bulkOpen }))}
            >
              {bulkOpen ? 'Collapse all' : 'Expand all'}
            </button>
          )}
        </div>

        {plan.steps.length > 0 && (
          <div className="plan-overall-progress">
            <div className="plan-overall-caption">
              <p>{complete} of {plan.steps.length} tasks complete</p>
              <span>{totalReqs > 0 ? `${completedReqs}/${totalReqs} checks verified` : `${stepPercent}%`}</span>
            </div>
            <div className="plan-overall-bar" aria-hidden="true">
              <span className="plan-overall-fill" style={{ width: `${stepPercent}%` }} />
            </div>
          </div>
        )}

        {(plan.steps.length > 0 || plan.agents.length > 0) && (
          <div className="plan-metrics-row" aria-label="Plan status summary">
            <span className="plan-metric-pill" data-tone="completed">
              {complete} completed
            </span>
            {workingCount > 0 && (
              <span className="plan-metric-pill" data-tone="working">
                {workingCount} active
              </span>
            )}
            {blockedCount > 0 && (
              <span className="plan-metric-pill" data-tone="blocked">
                {blockedCount} blocked
              </span>
            )}
            {pendingCount > 0 && (
              <span className="plan-metric-pill">
                {pendingCount} pending
              </span>
            )}
            {plan.agents.length > 0 && (
              <span className="plan-metric-pill">
                {plan.agents.length} {plan.agents.length === 1 ? 'agent' : 'agents'}
              </span>
            )}
          </div>
        )}
      </header>

      {plan.steps.length > 0 ? (
        <ol className="plan-steps">
          {plan.steps.map((step, index) => (
            <StepRow
              key={step.id}
              index={index}
              threadId={threadId}
              step={step}
              expandSignal={expandSignal}
              agents={plan.agents.filter(job => step.agentIds?.includes(job.id))}
            />
          ))}
        </ol>
      ) : (
        <p className="plan-status-note">No task steps have been published.</p>
      )}

      {unassigned.length > 0 && (
        <section className="plan-unassigned" aria-label="Delegated work">
          <h4>Delegated work</h4>
          <ul className="plan-agents">
            {unassigned.map(job => (
              <AgentRow key={job.id} job={job} threadId={threadId} />
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
