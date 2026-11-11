import type { Snapshot, Thread } from "../../packages/contracts";
import type { AgentJob, PlanRecord } from "../../packages/contracts/planning";

const now = "2026-11-06T00:00:00Z";
const job = (id: string, extra: Partial<AgentJob> = {}): AgentJob => ({
  id,
  commandId: `command-${id}`,
  taskId: `task-${id}`,
  name:
    id === "ui"
      ? "Timeline UI"
      : id === "child"
        ? "Evidence helper"
        : id === "core"
          ? "Plan core"
          : "Available reviewer",
  task: "Capture renderer evidence",
  status: "working",
  requirements: [],
  completedRequirementIds: [],
  reportedPercent: null,
  createdAt: now,
  updatedAt: now,
  parentRun: { runId: "run-a", epoch: 1 },
  ...extra,
});
export function timelinePlan(): PlanRecord {
  return {
    version: 1,
    title: "Improve the workspace",
    authority: "proposal",
    run: { runId: "run-a", epoch: 1 },
    runState: "running",
    steps: [
      {
        id: "scope",
        title: "Read the approved brief",
        status: "completed",
        state: "accepted",
        objective: "Preserve ownership and source evidence.",
        requirements: [],
        checks: [{ id: "scope-check", label: "Ownership confirmed", status: "verified_passed" }],
        result: "Scope recorded.",
        dependsOn: [],
      },
      {
        id: "build",
        title: "Build the detailed timeline",
        status: "working",
        state: "running",
        objective: "Keep reading position during updates.",
        details: "Show canonical assignments, checks and results without moving the reader.",
        requirements: [],
        dependsOn: ["scope"],
        blockers: ["Awaiting a source receipt"],
        checks: [
          {
            id: "ui-check",
            label: "Expanded detail remains readable",
            status: "reported_passed",
            details: "Renderer checks are reported separately from native acceptance.",
          },
        ],
        outputs: [
          { id: "screen", label: "Renderer evidence", ref: { id: "evidence:timeline", revision: 2 } },
        ],
      },
      {
        id: "audit",
        title: "Audit independent failures",
        status: "blocked",
        state: "failed",
        requirements: [],
        dependsOn: ["scope"],
        checks: [
          {
            id: "audit-check",
            label: "Native acceptance",
            status: "verified_failed",
            details: "Native acceptance still needs a separate run.",
          },
        ],
      },
      {
        id: "verify",
        title: "Verify the joined work",
        status: "blocked",
        state: "review_required",
        objective: "Review both branches before accepting.",
        requirements: [],
        dependsOn: ["build", "audit"],
      },
    ],
    agents: [
      job("ui", { stepId: "build", childThreadId: "child-ui", summary: "Working on the expanded timeline." }),
      job("core", {
        stepId: "build",
        status: "needs_review",
        reportedPercent: 100,
        summary: "Ready for independent review.",
      }),
      job("child", { parentJobId: "ui", status: "completed", summary: "Evidence captured." }),
      job("available", { status: "queued" }),
    ],
  };
}
export function timelineSnapshot(threadId = "thread-a", revision = 1): Snapshot {
  return {
    threads: [
      {
        id: threadId,
        title: "Timeline fixture",
        projectName: null,
        createdAt: now,
        updatedAt: now,
        runId: "run-a",
        epoch: 1,
        status: "working",
        modelId: null,
        sessionPath: null,
      } satisfies Thread,
    ],
    data: [
      {
        id: `plan:${threadId}`,
        threadId,
        revision,
        provenance: "harness:plan",
        createdAt: now,
        value: timelinePlan(),
      },
    ],
    messages: [
      {
        id: "message-ui",
        threadId: "child-ui",
        role: "assistant",
        content: "The renderer evidence is ready.",
        createdAt: now,
      },
    ],
  } as Snapshot;
}
