import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlanStatus } from "../apps/web/src/PlanStatus";
import { timelineSnapshot } from "./e2e/plan-timeline-fixture";
import type { PlanRecord } from "../packages/contracts/planning";

const render = (snapshot = timelineSnapshot()) =>
  renderToStaticMarkup(createElement(PlanStatus, { snapshot, threadId: "thread-a" }));

describe("plan timeline presentation", () => {
  it("expands all steps and agent details, with the plan title only in accessible context", () => {
    const html = render();
    expect(html).not.toContain("<h3>Improve the workspace</h3>");
    expect(html).toContain('aria-label="Task plan: Improve the workspace"');
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(8);
    expect(html).toContain("Keep reading position during updates.");
  });
  it("renders precise states, dependency joins and nested canonical assignments", () => {
    const html = render();
    expect(html).toContain("Review required");
    expect(html).toContain("Reported passed");
    expect(html).toContain("Verified failed");
    expect(html).toContain("Capture renderer evidence");
    expect(html).toContain('data-agent-id="child"');
    expect(html).toContain('data-step-id="verify"');
    expect(html).toContain("After");
    expect(html).toContain("Available agents");
    expect(html).toContain("Open transcript");
  });
  it("does not promote reported 100% to completed or accepted", () => {
    const html = render();
    expect(html).toContain("100%");
    expect(html).toContain("Needs review");
    expect(html).toContain("1/4 complete");
    expect(html).not.toContain("checks verified");
  });
  it("distinguishes absent, invalid and empty plans", () => {
    expect(render({ ...timelineSnapshot(), data: [] })).toContain("No plan yet");
    const invalid = timelineSnapshot();
    invalid.data[0].value = { version: 1 };
    expect(render(invalid)).toContain("Plan unavailable");
    const empty = timelineSnapshot();
    (empty.data[0].value as { steps: unknown[]; agents: unknown[] }).steps = [];
    (empty.data[0].value as { agents: unknown[] }).agents = [];
    expect(render(empty)).toContain("No steps published");
  });
  it("does not render another thread’s plan", () => {
    expect(
      renderToStaticMarkup(createElement(PlanStatus, { snapshot: timelineSnapshot(), threadId: "other" })),
    ).toContain("No plan yet");
  });
  it.each([
    "proposed",
    "running",
    "blocked",
    "review_required",
    "completed",
    "accepted",
    "failed",
    "cancelled",
    "interrupted",
  ] as const)("preserves the precise %s state", (state) => {
    const snapshot = timelineSnapshot();
    const plan = snapshot.data[0].value as PlanRecord;
    plan.agents = [];
    plan.steps = [{ ...plan.steps[0], state, dependsOn: [] }];
    expect(render(snapshot)).toContain(`step-${state}`);
  });
  it("supports explicit loading and actionable fetch errors", () => {
    const snapshot = { ...timelineSnapshot(), data: [] };
    expect(
      renderToStaticMarkup(createElement(PlanStatus, { snapshot, loading: true, threadId: "thread-a" })),
    ).toContain('aria-busy="true"');
    expect(
      renderToStaticMarkup(
        createElement(PlanStatus, {
          snapshot,
          error: "Reconnect and refresh the plan.",
          threadId: "thread-a",
        }),
      ),
    ).toContain("Reconnect and refresh the plan.");
  });
});
