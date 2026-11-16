import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlanStatus } from "../apps/web/src/PlanStatus";
import { DelegatedAgentTranscript } from "../apps/web/src/DelegatedAgentTranscript";
import { timelineSnapshot } from "./e2e/plan-timeline-fixture";
import type { PlanRecord } from "../packages/contracts/planning";

const render = (snapshot = timelineSnapshot(), threadId = "thread-a") =>
  renderToStaticMarkup(createElement(PlanStatus, { snapshot, threadId }));

// Mirror of the component identity: [threadId, kind, id].
const collapseKey = (kind: string, id: string, threadId = "thread-a") =>
  JSON.stringify([threadId, kind, id]);
const collapseStorageKey = "harness:plan-collapse:v2";
const legacyCollapseStorageKey = "harness:plan-collapse:v1";

const summaryState = (html: string, marker: string): string | undefined => {
  const at = html.indexOf(marker);
  if (at < 0) return undefined;
  return html.slice(at).match(/aria-expanded="(true|false)"/)?.[1];
};

const withStorage = <T,>(
  values: Record<string, string>,
  run: () => T,
): { result: T; values: Record<string, string> } => {
  const saved = (globalThis as { localStorage?: Storage }).localStorage;
  const store = { ...values };
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const key of Object.keys(store)) delete store[key];
    },
  } as unknown as Storage;
  try {
    return { result: run(), values: store };
  } finally {
    (globalThis as { localStorage?: Storage }).localStorage = saved;
  }
};

describe("plan timeline presentation", () => {
  it("renders the existing nested delegated transcript from its complete canonical plan", () => {
    const html = renderToStaticMarkup(createElement(DelegatedAgentTranscript, {snapshot: timelineSnapshot(), threadId: 'thread-a', agentId: 'child'}));
    expect(html).toContain('Evidence helper');
    expect(html).toContain('Completed');
    expect(html).not.toContain('Plan unavailable');
    expect(html).not.toContain('data-agent-id="core"');
    expect(html).toContain('Read-only delegated transcript');
  });
  it("keeps the summary compact: completion count first, completed details closed, active and waiting work open", () => {
    const html = render();
    expect(html).not.toContain("<h3>Improve the workspace</h3>");
    expect(html).toContain('aria-label="Task plan: Improve the workspace"');
    expect(html).toContain("Keep reading position during updates.");
    // Completion count and current action lead the summary metadata.
    expect(html.indexOf("1/4 complete")).toBeGreaterThan(-1);
    expect(html.indexOf("1/4 complete")).toBeLessThan(html.indexOf("4 agents"));
    expect(html.indexOf("4 agents")).toBeLessThan(html.indexOf("Rev 1"));
    // Completed step and agent details start closed.
    expect(summaryState(html, 'data-step-id="scope"')).toBe("false");
    expect(summaryState(html, 'data-agent-id="child"')).toBe("false");
    // Active and waiting work remains visible without user overrides.
    for (const marker of [
      'data-step-id="build"',
      'data-step-id="audit"',
      'data-step-id="verify"',
      'data-agent-id="ui"',
      'data-agent-id="core"',
      'data-agent-id="available"',
    ])
      expect(summaryState(html, marker)).toBe("true");
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(6);
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

describe("explicit disclosure choices", () => {
  it("retains exact manual choices across reload, live updates and thread switches", () => {
    const overrides = {
      [collapseKey("step", "scope")]: false, // user expanded the completed step
      [collapseKey("agent", "child")]: false, // user expanded the completed child
      [collapseKey("step", "build")]: true, // user closed the running step
    };
    const stored = { [collapseStorageKey]: JSON.stringify(overrides) };
    for (const html of [
      withStorage(stored, () => render()).result,
      withStorage(stored, () => render()).result, // reload: fresh mount, same record
      withStorage(stored, () =>
        render(timelineSnapshot("thread-a", 2)),
      ).result, // live update to a newer revision
    ]) {
      expect(summaryState(html, 'data-step-id="scope"')).toBe("true");
      expect(summaryState(html, 'data-agent-id="child"')).toBe("true");
      expect(summaryState(html, 'data-step-id="build"')).toBe("false");
    }
    // Switching away renders the other thread and back restores the exact choices.
    expect(
      renderToStaticMarkup(createElement(PlanStatus, { snapshot: timelineSnapshot(), threadId: "thread-b" })),
    ).toContain("No plan yet");
    const back = withStorage(stored, () => render()).result;
    expect(summaryState(back, 'data-step-id="scope"')).toBe("true");
    expect(summaryState(back, 'data-agent-id="child"')).toBe("true");
    expect(summaryState(back, 'data-step-id="build"')).toBe("false");
  });
  it("prefers the v2 record over stale legacy values and ignores malformed records", () => {
    const open = withStorage(
      {
        [legacyCollapseStorageKey]: JSON.stringify({ [collapseKey("step", "scope")]: true }),
        [collapseStorageKey]: JSON.stringify({ [collapseKey("step", "scope")]: false }),
      },
      () => render(),
    );
    expect(summaryState(open.result, 'data-step-id="scope"')).toBe("true");
    const fallback = withStorage(
      {
        [legacyCollapseStorageKey]: JSON.stringify({ [collapseKey("step", "scope")]: true }),
        [collapseStorageKey]: "{broken",
      },
      () => render(),
    );
    expect(summaryState(fallback.result, 'data-step-id="scope"')).toBe("false");
  });
  it("migrates legacy v1 closed choices into v2 and preserves the legacy record", () => {
    const legacy = JSON.stringify({
      [collapseKey("step", "scope")]: true, // legacy explicit closed choice
      [collapseKey("step", "build")]: false, // legacy default-open noise, not a choice
      [collapseKey("agent", "child")]: "yes", // malformed entry ignored
    });
    const { result, values } = withStorage({ [legacyCollapseStorageKey]: legacy }, () => render());
    expect(summaryState(result, 'data-step-id="scope"')).toBe("false");
    expect(summaryState(result, 'data-step-id="build"')).toBe("true");
    expect(summaryState(result, 'data-agent-id="child"')).toBe("false");
    // The old record is preserved verbatim; rendering never rewrites it.
    expect(values[legacyCollapseStorageKey]).toBe(legacy);
  });
  it("toggle stores the opposite of the resolved current visibility", async () => {
    const { togglePlanCollapse, resolvePlanOpen, planDefaultCollapsed } = await import("../apps/web/src/PlanStatus");
    const scopeKey = collapseKey("step", "scope");
    // A completed step resolves closed, so toggling must record explicit open (false).
    expect(togglePlanCollapse({}, scopeKey, "step", "completed")).toEqual({ [scopeKey]: false });
    // A running step resolves open, so toggling records explicit closed (true).
    const buildKey = collapseKey("step", "build");
    expect(togglePlanCollapse({}, buildKey, "step", "running")).toEqual({ [buildKey]: true });
    // An explicit closed choice toggles back to explicit open.
    expect(togglePlanCollapse({ [scopeKey]: true }, scopeKey, "step", "completed")).toEqual({ [scopeKey]: false });
    expect(resolvePlanOpen({}, scopeKey, "step", "completed")).toBe(false);
    expect(resolvePlanOpen({ [scopeKey]: false }, scopeKey, "step", "completed")).toBe(true);
    expect(planDefaultCollapsed("step", "accepted")).toBe(true);
    expect(planDefaultCollapsed("step", "blocked")).toBe(false);
    expect(planDefaultCollapsed("agent", "completed")).toBe(true);
    expect(planDefaultCollapsed("agent", "queued")).toBe(false);
  });
  it("keeps a recently changed old choice when persisting at capacity", async () => {
    const { togglePlanCollapse, resolvePlanOpen, boundPlanCollapse, readPlanCollapse, collapseStorageKey } = await import("../apps/web/src/PlanStatus");
    const oldest = collapseKey("step", "scope");
    const nextOldest = collapseKey("step", "other-0");
    const old: Record<string, boolean> = { [oldest]: true };
    for (let i = 0; i < 127; i++) old[collapseKey("step", `other-${i}`)] = true;

    const reopened = togglePlanCollapse(old, oldest, "step", "completed");
    const newest = togglePlanCollapse(reopened, collapseKey("step", "new"), "step", "running");
    const stored = JSON.stringify(boundPlanCollapse(newest));
    const reloaded = readPlanCollapse((key) => key === collapseStorageKey ? stored : null);

    expect(Object.keys(reloaded)).toHaveLength(128);
    expect(resolvePlanOpen(reloaded, oldest, "step", "completed")).toBe(true);
    expect(reloaded[nextOldest]).toBeUndefined();
  });
  it("reads the v2 record, merging legacy closed choices without dropping explicit opens", async () => {
    const { readPlanCollapse, boundPlanCollapse, collapseStorageKey: v2Key } = await import("../apps/web/src/PlanStatus");
    const legacy = JSON.stringify({
      [collapseKey("step", "scope")]: true,
      [collapseKey("step", "build")]: false,
      bad: "yes",
    });
    expect(
      readPlanCollapse((key) =>
        key === v2Key ? JSON.stringify({ [collapseKey("step", "scope")]: false }) : key === legacyCollapseStorageKey ? legacy : null,
      ),
    ).toEqual({ [collapseKey("step", "scope")]: false });
    expect(readPlanCollapse((key) => (key === legacyCollapseStorageKey ? legacy : null))).toEqual({
      [collapseKey("step", "scope")]: true,
    });
    expect(readPlanCollapse(() => null)).toEqual({});
    // Bounds and malformed entries never crash the record.
    const entries: Record<string, unknown> = {};
    for (let i = 0; i < 300; i++) entries[`k${i}`] = true;
    entries["x".repeat(401)] = true;
    entries.bad = "yes";
    expect(Object.keys(boundPlanCollapse(entries))).toHaveLength(128);
    expect(Object.keys(boundPlanCollapse(entries)).every((key) => key.length <= 400)).toBe(true);
    expect(boundPlanCollapse(entries).bad).toBeUndefined();
    expect(boundPlanCollapse(null)).toEqual({});
  });
});

describe("nested subtree disclosure (AUD-11)", () => {
  it("hides the descendant detail subtree inside the collapsed parent’s region while the parent summary remains", () => {
    const { result } = withStorage(
      {
        [collapseStorageKey]: JSON.stringify({
          [collapseKey("agent", "ui")]: true, // parent collapsed
          [collapseKey("agent", "child")]: false, // child keeps its own open choice
        }),
      },
      () => render(),
    );
    const parent = result.indexOf('data-agent-id="ui"');
    const region = result.indexOf("task-motion-region plan-agent-details", parent);
    expect(region).toBeGreaterThan(parent);
    const child = result.indexOf('data-agent-id="child"', region);
    expect(child).toBeGreaterThan(region);
    // The child lane must sit inside the parent's (closed) motion region, so the
    // mounted region's inert/hidden behavior covers the whole descendant subtree.
    const between = result.slice(region, child);
    const opens = (between.match(/<div\b/g) ?? []).length;
    const closes = (between.match(/<\/div/g) ?? []).length;
    expect(opens).toBeGreaterThan(closes);
    expect(between).toContain('data-open="false"');
    // The child keeps its own explicit open choice inside the hidden subtree.
    expect(result.slice(child).match(/class="task-motion-region plan-agent-details" data-open="true"/)).toBeTruthy();
    // The parent summary remains and still signals relevant activity.
    expect(result.slice(parent, region)).toContain("Timeline UI");
    expect(result.slice(parent, region)).toContain("Working");
  });
  it("restores the nested subtree with its own choices when the parent reopens", () => {
    const { result } = withStorage(
      { [collapseStorageKey]: JSON.stringify({ [collapseKey("agent", "child")]: false }) },
      () => render(),
    );
    const parent = result.indexOf('data-agent-id="ui"');
    const region = result.indexOf("task-motion-region plan-agent-details", parent);
    expect(result.slice(region, region + 120)).toContain('data-open="true"');
    const child = result.indexOf('data-agent-id="child"', region);
    expect(child).toBeGreaterThan(region);
    expect(result.slice(child).match(/class="task-motion-region plan-agent-details" data-open="true"/)).toBeTruthy();
  });
});
