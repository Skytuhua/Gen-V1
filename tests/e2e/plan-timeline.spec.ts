import { expect, test } from "@playwright/test";
import { timelineSnapshot } from "./plan-timeline-fixture";

test.beforeEach(async ({ page }) => {
  await page.goto("/plan-timeline.html");
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector(".plan-overall-bar")!).height === "3px",
  );
  await page.evaluate(() => document.fonts.ready);
});

test("all details are expanded and assigned branches nest and rejoin before the dependent step", async ({
  page,
}) => {
  await expect(page.getByRole("region", { name: "Task plan: Improve the workspace" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Build the detailed timeline", exact: false }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.locator('[data-step-id="build"] [data-agent-id="ui"] [data-agent-id="child"]'),
  ).toBeVisible();
  await expect(page.locator('[data-step-id="verify"]')).toContainText("Review required");
  await expect(page.locator('[data-step-id="verify"]')).toContainText("Build the detailed timeline");
  await page.getByRole("button", { name: "Open transcript for Timeline UI" }).click();
  await expect(page.getByRole("log", { name: "Timeline UI transcript" })).toContainText(
    "The renderer evidence is ready.",
  );
});

test("retains manual collapse, focus and reading position across ordered live updates and rejects stale revisions", async ({
  page,
}) => {
  const button = page.locator('[data-step-id="build"] > .plan-step-summary');
  await button.click();
  await button.focus();
  const y = await page.locator("main").evaluate((el) => {
    el.scrollTop = 120;
    return el.scrollTop;
  });
  const next = timelineSnapshot("thread-a", 3);
  await page.evaluate((snapshot) => window.planFixture.update(snapshot), next);
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(button).toBeFocused();
  expect(await page.locator("main").evaluate((el) => el.scrollTop)).toBeCloseTo(y, 0);
  await page.evaluate((snapshot) => window.planFixture.update(snapshot), timelineSnapshot("thread-a", 1));
  await expect(page.getByText("Rev 3", { exact: true })).toBeVisible();
});

test("resets the snapshot fence on thread switch and retains the old plan during restart publication", async ({
  page,
}) => {
  await page.evaluate((snapshot) => window.planFixture.update(snapshot), timelineSnapshot("thread-a", 8));
  await page.evaluate(
    (snapshot) => window.planFixture.update(snapshot, "thread-b"),
    timelineSnapshot("thread-b", 1),
  );
  await expect(page.getByText("Rev 1", { exact: true })).toBeVisible();
  const stopped = timelineSnapshot("thread-b", 2);
  stopped.threads[0].runId = null;
  await page.evaluate((snapshot) => window.planFixture.update(snapshot, "thread-b"), stopped);
  await expect(page.locator('[data-agent-id="ui"] > .plan-agent-top')).toContainText("Interrupted");
  const restarted = timelineSnapshot("thread-b", 2);
  restarted.threads[0].runId = "run-b";
  restarted.threads[0].epoch = 2;
  await page.evaluate((snapshot) => window.planFixture.update(snapshot, "thread-b"), restarted);
  await expect(page.locator('[data-step-id="build"]')).toBeVisible();
  const fresh = timelineSnapshot("thread-b", 3);
  fresh.threads[0] = restarted.threads[0];
  const plan = fresh.data[0].value as ReturnType<typeof import("./plan-timeline-fixture").timelinePlan>;
  plan.run = { runId: "run-b", epoch: 2 };
  plan.agents.forEach((job) => (job.parentRun = plan.run));
  await page.evaluate((snapshot) => window.planFixture.update(snapshot, "thread-b"), fresh);
  await expect(page.locator('[data-agent-id="ui"] > .plan-agent-top')).toContainText("Working");
});

test("retains a valid plan when the latest canonical graph is malformed", async ({ page }) => {
  const invalid = timelineSnapshot("thread-a", 4);
  const plan = invalid.data[0].value as ReturnType<typeof import("./plan-timeline-fixture").timelinePlan>;
  plan.agents[0].parentJobId = "missing";
  await page.evaluate((snapshot) => window.planFixture.update(snapshot), invalid);
  await expect(page.locator('[data-step-id="build"]')).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("last valid revision");
  await expect(page.getByText("Rev 1", { exact: true })).toBeVisible();
});

test("host replan preserves assignment, collapse and reading anchor when earlier details grow", async ({
  page,
}) => {
  const target = page.locator('[data-step-id="verify"] > .plan-step-summary');
  await target.scrollIntoViewIfNeeded();
  await target.focus();
  const before = (await target.boundingBox())!.y;
  const replan = timelineSnapshot("thread-a", 5);
  const plan = replan.data[0].value as ReturnType<typeof import("./plan-timeline-fixture").timelinePlan>;
  plan.steps[0].details = "Expanded host detail.\n".repeat(30);
  plan.steps[1].title = "Updated timeline objective";
  await page.evaluate((snapshot) => window.planFixture.update(snapshot), replan);
  await expect(page.locator('[data-step-id="build"] [data-agent-id="ui"]')).toHaveCount(1);
  await expect(target).toBeFocused();
  expect((await target.boundingBox())!.y).toBeCloseTo(before, 0);
  await page.getByRole("button", { name: "Jump to current" }).click();
  await expect(page.locator('[data-step-id="build"] > .plan-step-summary')).toBeFocused();
  await page.getByRole("button", { name: "Plan actions" }).click();
  await page.getByRole("menuitem", { name: "Collapse all" }).click();
  await page.getByRole("button", { name: "Plan actions" }).click();
  await page.getByRole("menuitem", { name: "Expand all" }).click();
  await expect(page.locator('[data-step-id="verify"] > .plan-step-summary')).toHaveAttribute(
    "aria-expanded",
    "true",
  );
});

test("collapsed step identity survives returning from another thread and stale epochs never regress it", async ({
  page,
}) => {
  await page.locator('[data-step-id="build"] > .plan-step-summary').click();
  await page.evaluate(
    (snapshot) => window.planFixture.update(snapshot, "thread-b"),
    timelineSnapshot("thread-b"),
  );
  await expect(page.locator('[data-step-id="build"] > .plan-step-summary')).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  const current = timelineSnapshot("thread-a", 6);
  const plan = current.data[0].value as ReturnType<typeof import("./plan-timeline-fixture").timelinePlan>;
  plan.run = { runId: "run-b", epoch: 2 };
  plan.agents.forEach((job) => (job.parentRun = plan.run));
  current.threads[0].runId = "run-b";
  current.threads[0].epoch = 2;
  await page.evaluate((snapshot) => window.planFixture.update(snapshot), current);
  await expect(page.locator('[data-step-id="build"] > .plan-step-summary')).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(page.locator('[data-agent-id="ui"] > .plan-agent-top')).toContainText("Working");
  await page.evaluate((snapshot) => window.planFixture.update(snapshot), timelineSnapshot("thread-a", 10));
  await expect(page.getByText("Rev 6", { exact: true })).toBeVisible();
  await expect(page.locator('[data-agent-id="ui"] > .plan-agent-top')).toContainText("Working");
});

test("deep nested agents and long output labels fit a 280px panel without hiding details", async ({
  page,
}) => {
  await page.setViewportSize({ width: 280, height: 600 });
  const snapshot = timelineSnapshot("thread-a", 2);
  const plan = snapshot.data[0].value as ReturnType<typeof import("./plan-timeline-fixture").timelinePlan>;
  for (let depth = 0; depth < 6; depth++)
    plan.agents.push({
      ...plan.agents[2],
      id: `nested-${depth}`,
      parentJobId: depth ? `nested-${depth - 1}` : "child",
    });
  plan.steps[1].outputs![0].label = "ExtremelyLongOutputLabelWithNoNaturalBreaks".repeat(3);
  await page.evaluate((snapshot) => window.planFixture.update(snapshot), snapshot);
  await expect(page.locator('[data-agent-id="nested-5"]')).toBeVisible();
  expect(await page.locator("main").evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(280);
  await page.locator('[data-step-id="build"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("deep-narrow.png") });
});

for (const theme of ["dark", "light"])
  for (const zoom of [1, 1.25, 1.5]) {
    test(`${theme} narrow/short ${zoom * 100}% geometry and reduced motion`, async ({ page }) => {
      await page.setViewportSize({ width: 560, height: 430 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.evaluate(
        ({ theme, zoom }) => {
          document.documentElement.dataset.theme = theme;
          document.documentElement.dataset.motion = "reduced";
          document.documentElement.style.zoom = String(zoom);
        },
        { theme, zoom },
      );
      await expect(page.locator('[data-step-id="verify"]')).toBeVisible();
      const bounds = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
        inset: getComputedStyle(document.querySelector(".plan-status")!).paddingLeft,
        font: getComputedStyle(document.querySelector(".plan-step-copy strong")!).fontSize,
        toolbar: getComputedStyle(document.querySelector(".plan-context-toolbar")!).height,
      }));
      expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);
      expect(bounds.inset).toBe("16px");
      expect(bounds.font).toBe("14px");
      expect(bounds.toolbar).toBe("36px");
      await page.screenshot({ path: test.info().outputPath(`${theme}-${zoom}.png`), fullPage: true });
    });
  }

for (const theme of ["dark", "light"])
  test(`${theme} desktop parallel branches and join`, async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
    await page.getByRole("button", { name: "Jump to current" }).click();
    const ui = page.locator(
      '[data-step-id="build"] > .plan-step-details .plan-branches > .plan-agents > [data-agent-id="ui"]',
    );
    const core = page.locator(
      '[data-step-id="build"] > .plan-step-details .plan-branches > .plan-agents > [data-agent-id="core"]',
    );
    expect((await ui.boundingBox())!.y).toBe((await core.boundingBox())!.y);
    await expect(page.locator('[data-step-id="build"] .plan-join')).toContainText("Verify the joined work");
    await expect(page.locator('[data-step-id="build"] [data-agent-id="available"]')).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath(`${theme}-branches.png`) });
  });
