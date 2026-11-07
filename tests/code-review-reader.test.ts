import { expect, it } from "vitest";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeChecks, readLocalComparison, remotePatch } from "../packages/workspace/code-review.ts";
import type { ComparisonFile, PullRequestComparisonIdentity } from "../packages/contracts/code-review.ts";

const identity: PullRequestComparisonIdentity = {
  kind: "pull-request",
  id: "a".repeat(64),
  repo: "example/fixture",
  number: 12,
  pullRequestId: "PR_fixture",
  baseOid: "b".repeat(40),
  headOid: "c".repeat(40),
  mergeBaseOid: "d".repeat(40),
  baseRef: "main",
  headRef: "feature",
  semantics: "merge-base",
};
const file: ComparisonFile = { path: "file", status: "modified", untracked: false, additions: 1, deletions: 1 };
it('keeps active GitHub CLI CheckRuns pending when their conclusion is an empty string', () => {
  const statuses = ['QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED'];
  expect(normalizeChecks(statuses.map(status => ({__typename: 'CheckRun', name: status, status, conclusion: ''})))).toEqual(statuses.map(name => ({name, status: 'pending'})));
  expect(normalizeChecks([{name: 'finished', status: 'COMPLETED', conclusion: 'SUCCESS'}, {name: 'unrecognized', status: 'FUTURE_STATUS', conclusion: ''}])).toEqual([{name: 'finished', status: 'passed'}, {name: 'unrecognized', status: 'unknown'}]);
});
it.each([
  ["IN_PROGRESS", ""],
  ["IN_PROGRESS", null],
  ["QUEUED", ""],
  ["QUEUED", null],
  ["WAITING", ""],
  ["WAITING", null],
  ["PENDING", ""],
  ["PENDING", null],
  ["REQUESTED", ""],
  ["REQUESTED", null],
  ["PENDING_DEPLOYMENT", ""],
  ["PENDING_DEPLOYMENT", null],
])("retains pending check status %s with conclusion %j", (status, conclusion) => {
  expect(normalizeChecks([{ __typename: "CheckRun", name: "unit", status, conclusion }])).toEqual([
    { name: "unit", status: "pending" },
  ]);
});
it("preserves completed and unknown check conclusions and pending status contexts", () => {
  expect(normalizeChecks([
    { __typename: "CheckRun", name: "unit", status: "COMPLETED", conclusion: "SUCCESS" },
    { __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "FAILURE" },
    { __typename: "CheckRun", name: "optional", status: "COMPLETED", conclusion: "SKIPPED" },
    { __typename: "CheckRun", name: "empty", status: "COMPLETED", conclusion: "" },
    { __typename: "CheckRun", name: "null", status: "COMPLETED", conclusion: null },
    { __typename: "CheckRun", name: "future", status: "IN_PROGRESS", conclusion: "FUTURE_CONCLUSION" },
    { __typename: "CheckRun", name: "unknown", status: "FUTURE_STATUS", conclusion: "" },
    { __typename: "StatusContext", context: "lint", state: "PENDING", targetUrl: null },
  ])).toEqual([
    { name: "unit", status: "passed" },
    { name: "build", status: "failed" },
    { name: "optional", status: "neutral" },
    { name: "empty", status: "unknown" },
    { name: "null", status: "unknown" },
    { name: "future", status: "unknown" },
    { name: "unknown", status: "unknown" },
    { name: "lint", status: "pending" },
  ]);
  expect(normalizeChecks(null)).toEqual([]);
});
it("does not claim completeness when the hunk context was truncated but changed-line totals still match", () => {
  expect(remotePatch(identity, file, "@@ -1,3 +1,3 @@\n-one\n+two\n context")).toMatchObject({
    state: "truncated",
    text: null,
  });
  expect(remotePatch(identity, file, "@@ -1,3 +1,3 @@\n-one\n+two\n context\n final context")).toMatchObject({
    state: "text",
  });
});
it("bounds complete local hashing before reading an oversized sparse file", async () => {
  const path = await mkdtemp(join(tmpdir(), "gen-review-bounded-"));
  try {
    await writeFile(join(path, "large"), "");
    await truncate(join(path, "large"), 65 * 1024 * 1024);
    const git = async (args: string[]) => {
      if (args[0] === "rev-parse") return "a".repeat(40);
      if (args[0] === "branch") return "fixture";
      if (args[0] === "ls-files") return "";
      if (args[0] === "status") return "?? large\0";
      throw Error("Unexpected command");
    };
    await expect(
      readLocalComparison(
        { git, path, owner: "fixture", managed: true, signal: new AbortController().signal },
        "worktree",
      ),
    ).rejects.toMatchObject({ code: "RESOURCE_LIMIT" });
  } finally {
    await rm(path, { recursive: true, force: true, maxRetries: 5 });
  }
}, 60000);
