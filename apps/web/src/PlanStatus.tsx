import { useEffect, useId, useMemo, useState } from "react";
import { ArrowDownToLine, GitBranch, MoreHorizontal, TriangleAlert } from "lucide-react";
import type { Snapshot, Thread } from "../../../packages/contracts";
import type { AgentJob } from "../../../packages/contracts/planning";
import {
  isNewerPlanSnapshot,
  projectPlanTimeline,
  type PlanSnapshot,
} from "../../../packages/core/plan-timeline";
import { ActionMenu } from "../../../packages/ui-shell/ActionMenu";
import { LoadingState } from "./LoadingState";
import { TimelineStep, AgentLane } from "./plan-timeline/TimelineRows";
import { ReadingPosition } from "./plan-timeline/ReadingPosition";
import "./plan-status.css";

export interface PlanStatusProps {
  snapshot: Snapshot;
  threadId?: string;
  loading?: boolean;
  error?: string;
  onOpenAgentTranscript?: (job: AgentJob, threadId: string) => void;
}
type PlanContext = Pick<Thread, "runId" | "epoch" | "status">;
const collapseStorageKey = "harness:plan-collapse:v1";
const boundedCollapse = (value: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(value)
      .filter(([key, collapsed]) => key.length <= 400 && collapsed === true)
      .slice(-128),
  ) as Record<string, boolean>;
function readCollapse(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(collapseStorageKey);
    if (!raw || raw.length > 65536) return {};
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? boundedCollapse(value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function PlanStatus({ snapshot, threadId, loading, error, onOpenAgentTranscript }: PlanStatusProps) {
  const prefix = useId();
  const incoming = snapshot.data
    .filter(
      (row) =>
        row.threadId === threadId && row.id === `plan:${threadId}` && row.provenance === "harness:plan",
    )
    .sort((a, b) => b.revision - a.revision)[0] as PlanSnapshot | undefined;
  const [retained, setRetained] = useState<{
    threadId?: string;
    record: PlanSnapshot | null;
    owner?: PlanContext;
  }>({
    threadId,
    record: null,
  });
  const previous = retained.threadId === threadId ? retained.record : null;
  const previousOwner = retained.threadId === threadId ? retained.owner : undefined;
  let owner: PlanContext | undefined = snapshot.threads.find((thread) => thread.id === threadId);
  if (
    previousOwner &&
    (!owner ||
      owner.epoch < previousOwner.epoch ||
      (owner.epoch === previousOwner.epoch && owner.runId !== null && owner.runId !== previousOwner.runId))
  )
    owner = previousOwner;
  if (
    previousOwner &&
    owner?.epoch === previousOwner.epoch &&
    owner.runId === previousOwner.runId &&
    owner.status === previousOwner.status
  )
    owner = previousOwner;
  let record = incoming && isNewerPlanSnapshot(previous, incoming) ? incoming : previous;
  let invalidLinks = false;
  if (record && record !== previous) {
    try {
      projectPlanTimeline(record, owner);
    } catch {
      record = previous;
      invalidLinks = true;
    }
  }
  // A revision belongs to one thread. Clear the fence before accepting its replacement.
  if (retained.threadId !== threadId || retained.record !== record || retained.owner !== owner)
    setRetained({ threadId, record, owner });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readCollapse);
  useEffect(() => {
    try {
      localStorage.setItem(collapseStorageKey, JSON.stringify(boundedCollapse(collapsed)));
    } catch {
      /* Optional disclosure preferences never block the plan. */
    }
  }, [collapsed]);
  const [menuOpen, setMenuOpen] = useState(false);
  const identity = (kind: string, id: string) => JSON.stringify([threadId, kind, id]);
  const open = (kind: string, id: string) => !collapsed[identity(kind, id)];
  const toggle = (kind: string, id: string) =>
    setCollapsed((old) => ({ ...old, [identity(kind, id)]: !old[identity(kind, id)] }));
  const projection = useMemo(() => {
    if (!record) return null;
    try {
      return { timeline: projectPlanTimeline(record, owner) };
    } catch {
      return { timeline: null };
    }
  }, [record, owner]);
  const invalid =
    invalidLinks ||
    Boolean(
      incoming && (!record || incoming.revision > record.revision) && !isNewerPlanSnapshot(null, incoming),
    ) ||
    projection?.timeline === null;

  if (!record || !projection?.timeline)
    return (
      <section className="plan-status plan-empty" aria-label="Task plan" aria-busy={loading || undefined}>
        {loading ? (
          <LoadingState pending hasContent={false} label="Loading plan">
            {null}
          </LoadingState>
        ) : (
          <>
            {invalid || error ? (
              <TriangleAlert size={22} aria-hidden="true" />
            ) : (
              <GitBranch size={22} aria-hidden="true" />
            )}
            <h3>{invalid || error ? "Plan unavailable" : "No plan yet"}</h3>
            <p role={invalid || error ? "alert" : undefined}>
              {error ||
                (invalid
                  ? "Ask the agent to refresh the plan."
                  : "Steps and assigned work appear when a plan is published.")}
            </p>
          </>
        )}
      </section>
    );

  const timeline = projection.timeline;
  const plan = record.value;
  const complete = timeline.steps.filter(
    (step) => step.status === "completed" || step.status === "accepted",
  ).length;
  const percent = timeline.steps.length ? Math.round((100 * complete) / timeline.steps.length) : 0;
  const current =
    timeline.steps.find((step) => step.status === "running") ??
    timeline.steps.find((step) =>
      ["blocked", "review_required", "failed", "interrupted"].includes(step.status),
    );
  const stepDomId = (id: string) => `${prefix}-step-${id}`;
  const allOpen =
    timeline.steps.every((step) => open("step", step.id)) &&
    plan.agents.every((job) => open("agent", job.id));
  const agentProps = { open, toggle, snapshot, threadId: timeline.threadId, onOpenAgentTranscript };
  const jump = () => {
    if (!current) return;
    setCollapsed((old) => ({ ...old, [identity("step", current.id)]: false }));
    const target = document.getElementById(stepDomId(current.id));
    target?.scrollIntoView({ block: "start", behavior: "instant" });
    target?.querySelector<HTMLButtonElement>(".plan-step-summary")?.focus({ preventScroll: true });
  };
  return (
    <ReadingPosition updateKey={`${record.revision}:${owner?.runId}:${owner?.epoch}`} key={threadId}>
      <section
        className="plan-status"
        aria-label={`Task plan: ${record.value.title}`}
        aria-busy={loading || undefined}
      >
        <header className="plan-status-header">
          <div className="plan-context-toolbar" aria-label="Plan progress and actions">
            <span className="plan-completion">
              {complete}/{timeline.steps.length} complete
            </span>
            <span>
              {record.value.agents.length} {record.value.agents.length === 1 ? "agent" : "agents"}
            </span>
            <span className="plan-revision-pill">Rev {timeline.revision}</span>
            <div className="plan-toolbar-actions">
              {current && (
                <button type="button" className="quiet plan-jump" aria-label="Jump to current" onClick={jump}>
                  <ArrowDownToLine size={14} aria-hidden="true" />
                  <span>Jump to current</span>
                </button>
              )}
              {timeline.steps.length > 0 && (
                <div className="plan-toolbar-disclosure">
                  <ActionMenu
                    label="Plan actions"
                    icon={<MoreHorizontal size={16} aria-hidden="true" />}
                    open={menuOpen}
                    onOpenChange={setMenuOpen}
                    items={[
                      {
                        id: "disclose",
                        label: allOpen ? "Collapse all" : "Expand all",
                        onSelect: () =>
                          setCollapsed((old) => {
                            const next = { ...old };
                            for (const step of timeline.steps) next[identity("step", step.id)] = allOpen;
                            for (const job of plan.agents) next[identity("agent", job.id)] = allOpen;
                            return next;
                          }),
                      },
                    ]}
                  />
                </div>
              )}
            </div>
          </div>
          <div
            className="plan-overall-bar"
            role="progressbar"
            aria-label="Completed or accepted steps"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-valuetext={`${complete} of ${timeline.steps.length} steps completed or accepted`}
          >
            <span className="plan-overall-fill" style={{ width: `${percent}%` }} />
          </div>
        </header>
        {(error || invalid) && (
          <p className="plan-update-error" role="alert">
            {error ||
              "The latest plan is invalid. Showing the last valid revision; ask the agent to refresh it."}
          </p>
        )}
        {timeline.steps.length ? (
          <>
            <p className="plan-boundary">
              Start <span>{timeline.authority === "approved" ? "Approved plan" : "Proposed plan"}</span>
            </p>
            <ol className="plan-steps">
              {timeline.steps.map((step, index) => (
                <TimelineStep
                  key={step.id}
                  step={step}
                  index={index}
                  steps={timeline.steps}
                  domId={stepDomId(step.id)}
                  stepDomId={stepDomId}
                  {...agentProps}
                />
              ))}
            </ol>
            <p className="plan-boundary plan-end">End of published plan</p>
          </>
        ) : (
          <p className="plan-status-note">No steps published.</p>
        )}
        {timeline.unassignedAgents.length > 0 && (
          <section className="plan-unassigned" aria-label="Available agents">
            <h4>
              Available agents <span>No assigned step</span>
            </h4>
            <ul className="plan-agents">
              {timeline.unassignedAgents.map((lane) => (
                <AgentLane key={lane.job.id} lane={lane} {...agentProps} />
              ))}
            </ul>
          </section>
        )}
      </section>
    </ReadingPosition>
  );
}
