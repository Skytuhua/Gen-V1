import { useId, useState } from "react";
import { Bot, Check, ChevronRight, Circle, GitMerge, TriangleAlert } from "lucide-react";
import type { Snapshot } from "../../../../packages/contracts";
import { agentProgress, type AgentJob } from "../../../../packages/contracts/planning";
import type { PlanAgentLane, PlanTimelineStep } from "../../../../packages/core/plan-timeline";
import { MotionRegion } from "../task-motion";
import { Markdown } from "../Markdown";

const states: Record<PlanTimelineStep["status"], string> = {
  proposed: "Proposed",
  running: "Running",
  blocked: "Blocked",
  review_required: "Review required",
  completed: "Completed",
  accepted: "Accepted",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
};
const jobs: Record<AgentJob["status"], string> = {
  queued: "Queued",
  working: "Working",
  needs_review: "Needs review",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
};
const checks = {
  pending: "Pending",
  reported_passed: "Reported passed",
  reported_failed: "Reported failed",
  verified_passed: "Verified passed",
  verified_failed: "Verified failed",
};
interface RowProps {
  open(kind: string, id: string): boolean;
  toggle(kind: string, id: string): void;
  snapshot: Snapshot;
  threadId: string;
  onOpenAgentTranscript?: (job: AgentJob, threadId: string) => void;
}

export function AgentLane({ lane, ...props }: RowProps & { lane: PlanAgentLane }) {
  const job = lane.job,
    expanded = props.open("agent", job.id),
    id = useId();
  const [transcript, setTranscript] = useState(false);
  const progress = agentProgress(job);
  const messages = job.childThreadId
    ? props.snapshot.messages.filter((message) => message.threadId === job.childThreadId)
    : [];
  return (
    <li className={`plan-agent agent-${job.status}`} data-agent-id={job.id}>
      <div className="plan-agent-top">
        <button
          type="button"
          className="plan-agent-summary"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => props.toggle("agent", job.id)}
        >
          <Bot size={16} aria-hidden="true" />
          <span className="plan-agent-copy">
            <strong>{job.name}</strong>
            <span>
              {jobs[job.status]}
              {progress !== null ? ` · ${progress}%` : ""}
            </span>
          </span>
          <ChevronRight size={14} aria-hidden="true" />
        </button>
        {job.childThreadId && (
          <button
            type="button"
            className="quiet plan-transcript-action"
            aria-label={`Open transcript for ${job.name}`}
            onClick={() =>
              props.onOpenAgentTranscript
                ? props.onOpenAgentTranscript(job, props.threadId)
                : setTranscript((value) => !value)
            }
          >
            {transcript ? "Close transcript" : "Open transcript"}
          </button>
        )}
      </div>
      <MotionRegion id={id} open={expanded} className="plan-agent-details" animate={false}>
        <p className="plan-agent-task">{job.task}</p>
        {job.summary && (
          <div className="plan-fact">
            <strong>
              {job.status === "working" || job.status === "queued" ? "Current activity" : "Result"}
            </strong>
            <p>{job.summary}</p>
          </div>
        )}
        {job.error && <p className="plan-update-error">{job.error}</p>}
        {job.requirements.length > 0 && (
          <ul className="plan-requirements">
            {job.requirements.map((check) => (
              <li key={check.id}>
                <span>{check.label}</span>
                <small>
                  {job.completedRequirementIds.includes(check.id) ? "Reported passed" : "Pending"}
                </small>
              </li>
            ))}
          </ul>
        )}
        {progress === null && <p className="plan-muted">Progress not reported.</p>}
        {job.evidence?.length ? (
          <div className="plan-fact">
            <strong>Evidence</strong>
            <ul>
              {job.evidence.map((ref) => (
                <li key={ref.id}>
                  {ref.id} · revision {ref.revision}
                </li>
              ))}
            </ul>
            {job.evidenceTruncated && <p>More evidence is recorded in the transcript.</p>}
          </div>
        ) : null}
        {job.usage && (
          <dl className="plan-agent-usage">
            {job.usage.inputTokens != null && (
              <>
                <dt>Input tokens</dt>
                <dd>{job.usage.inputTokens.toLocaleString()}</dd>
              </>
            )}
            {job.usage.outputTokens != null && (
              <>
                <dt>Output tokens</dt>
                <dd>{job.usage.outputTokens.toLocaleString()}</dd>
              </>
            )}
            {job.usage.cost != null && (
              <>
                <dt>Reported cost</dt>
                <dd>
                  {new Intl.NumberFormat(undefined, {
                    style: "currency",
                    currency: "USD",
                    maximumFractionDigits: 4,
                  }).format(job.usage.cost)}
                </dd>
              </>
            )}
          </dl>
        )}
      </MotionRegion>
      {transcript && (
        <div className="plan-agent-transcript" role="log" aria-label={`${job.name} transcript`}>
          <p className="plan-muted">Read-only transcript</p>
          {messages.length ? (
            messages.map((message) => (
              <div key={message.id}>
                <strong>{message.role}</strong>
                <Markdown text={message.content} />
              </div>
            ))
          ) : (
            <p>No transcript messages loaded.</p>
          )}
        </div>
      )}
      {lane.children.length > 0 && (
        <ul className="plan-agents plan-agent-children" aria-label={`${job.name} child agents`}>
          {lane.children.map((child) => (
            <AgentLane key={child.job.id} lane={child} {...props} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function TimelineStep({
  step,
  index,
  steps,
  domId,
  stepDomId,
  ...props
}: RowProps & {
  step: PlanTimelineStep;
  index: number;
  steps: PlanTimelineStep[];
  domId: string;
  stepDomId(id: string): string;
}) {
  const expanded = props.open("step", step.id),
    id = useId();
  const dependents = steps.filter((next) => next.dependsOn.includes(step.id));
  return (
    <li id={domId} className={`plan-step step-${step.status}`} data-step-id={step.id}>
      {step.dependsOn.length > 0 && (
        <div className="plan-dependencies">
          <GitMerge size={13} aria-hidden="true" />
          <span>After</span>
          {step.dependsOn.map((dependency) => (
            <a key={dependency} href={`#${stepDomId(dependency)}`}>
              {steps.find((item) => item.id === dependency)!.title}
            </a>
          ))}
        </div>
      )}
      <button
        className="plan-step-summary"
        type="button"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => props.toggle("step", step.id)}
      >
        <span className="plan-step-node" aria-hidden="true">
          {step.status === "accepted" || step.status === "completed" ? (
            <Check size={13} />
          ) : step.status === "failed" || step.status === "blocked" ? (
            <TriangleAlert size={13} />
          ) : (
            <Circle size={10} />
          )}
        </span>
        <span className="plan-step-copy">
          <strong>{step.title}</strong>
          <span>
            Step {index + 1} <span className="plan-step-badge">{states[step.status]}</span>
          </span>
        </span>
        <ChevronRight size={14} aria-hidden="true" />
      </button>
      <MotionRegion id={id} open={expanded} className="plan-step-details" animate={false}>
        {step.reportedStatus !== step.status && (
          <p className="plan-muted">Reported step state: {states[step.reportedStatus]}</p>
        )}
        {step.objective && (
          <div className="plan-fact">
            <strong>Objective</strong>
            <p>{step.objective}</p>
          </div>
        )}
        {step.details && <p className="plan-step-description">{step.details}</p>}
        {step.blockers?.length ? (
          <div className="plan-fact plan-blockers">
            <strong>Blockers</strong>
            <ul>
              {step.blockers.map((blocker, index) => (
                <li key={index}>{blocker}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {step.checks.length > 0 && (
          <div className="plan-fact">
            <strong>Checks</strong>
            <ul className="plan-requirements">
              {step.checks.map((check) => (
                <li key={check.id} data-check-state={check.status}>
                  <span>
                    {check.label}
                    {check.details && <span className="plan-check-details">{check.details}</span>}
                    {check.evidence?.map((ref) => (
                      <span className="plan-check-details" key={ref.id}>
                        {ref.id} · revision {ref.revision}
                      </span>
                    ))}
                  </span>
                  <small>{checks[check.status]}</small>
                </li>
              ))}
            </ul>
          </div>
        )}
        {step.agents.length > 0 && (
          <div className="plan-branches">
            <span className="plan-subsection-label">
              Assigned agents{step.agents.length > 1 ? " · Parallel branches" : ""}
            </span>
            <ul className="plan-agents">
              {step.agents.map((lane) => (
                <AgentLane key={lane.job.id} lane={lane} {...props} />
              ))}
            </ul>
            {dependents.length > 0 && (
              <p className="plan-join">
                <GitMerge size={13} aria-hidden="true" />
                Rejoin before {dependents.map((next) => next.title).join(", ")}
              </p>
            )}
          </div>
        )}
        {step.result && (
          <div className="plan-fact">
            <strong>Result</strong>
            <p>{step.result}</p>
          </div>
        )}
        {step.outputs?.length ? (
          <div className="plan-fact">
            <strong>Outputs</strong>
            <ul>
              {step.outputs.map((output) => (
                <li key={output.id}>
                  {output.label}
                  {output.ref && (
                    <span className="plan-check-details">
                      {output.ref.id} · revision {output.ref.revision}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {!step.objective &&
          !step.details &&
          !step.checks.length &&
          !step.agents.length &&
          !step.result &&
          !step.outputs?.length && <p className="plan-muted">No details reported.</p>}
      </MotionRegion>
    </li>
  );
}
