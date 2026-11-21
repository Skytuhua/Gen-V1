import { describe, expect, it, vi } from "vitest";
import { applyJumpList, buildJumpList, JUMP_LIST_PROJECT_LIMIT, jumpListKey, jumpListTitle } from "../apps/desktop/jump-list.ts";

const projects = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `project-${index + 1}`, name: `Project ${index + 1}` }));

describe("jumpListTitle", () => {
 it("trims and strips control characters", () => {
  expect(jumpListTitle("  Hello\tWorld\u0007  ")).toBe("HelloWorld");
 });
 it("caps at 60 code points plus ellipsis", () => {
  const long = "a".repeat(70);
  expect(jumpListTitle(long)).toBe("a".repeat(60) + "…");
  expect([...jumpListTitle("🔥".repeat(70))].length).toBe(61);
 });
});

describe("buildJumpList", () => {
 it("always contains exactly one New thread task", () => {
  const categories = buildJumpList({ execPath: "C:/App/Gen V1.exe", projects: [], includeProjects: false });
  expect(categories).toHaveLength(1);
  expect(categories[0]!.type).toBe("custom");
  const item = categories[0]!.items![0]!;
  expect(item).toMatchObject({ type: "task", title: "New thread", description: "Start a new thread in Gen V1", args: "--gen-jump=new-thread", program: "C:/App/Gen V1.exe", iconPath: "C:/App/Gen V1.exe", iconIndex: 0 });
 });
 it("adds up to five recent projects in order", () => {
  const categories = buildJumpList({ execPath: "C:/App/Gen V1.exe", projects: projects(8), includeProjects: true });
  const recent = categories[1]!;
  expect(recent.name).toBe("Recent projects");
  expect(recent.items).toHaveLength(JUMP_LIST_PROJECT_LIMIT);
  const first = recent.items![0]!;
  expect(first.title).toBe("Project 1");
  expect(first.description).toBe("Open Project 1 in Gen V1");
  expect(first.args).toBe("--gen-jump=open-project --gen-project-id=project-1");
 });
 it("never includes filesystem paths in args or labels", () => {
  const categories = buildJumpList({ execPath: "C:/App/Gen V1.exe", projects: [{ id: "p1", name: "C:/Users/x/secret" }], includeProjects: true });
  for (const category of categories) for (const item of category.items ?? []) {
   expect(item.args).not.toContain("/");
   expect(item.args).not.toMatch(/^[A-Za-z]:/);
  }
 });
 it("filters items whose exact args were removed by the user", () => {
  const categories = buildJumpList({ execPath: "C:/App/Gen V1.exe", projects: projects(2), includeProjects: true, removedArgs: ["--gen-jump=open-project --gen-project-id=project-1"] });
  expect(categories[1]!.items).toHaveLength(1);
  expect(categories[1]!.items![0]!.title).toBe("Project 2");
 });
 it("replaces a removed New thread task with a separator", () => {
  const categories = buildJumpList({ execPath: "C:/App/Gen V1.exe", projects: [], includeProjects: false, removedArgs: ["--gen-jump=new-thread"] });
  expect(categories[0]!.items![0]!.type).toBe("separator");
 });
 it("key is order-sensitive", () => {
  const a = buildJumpList({ execPath: "e", projects: [{ id: "a", name: "A" }, { id: "b", name: "B" }], includeProjects: true });
  const b = buildJumpList({ execPath: "e", projects: [{ id: "b", name: "B" }, { id: "a", name: "A" }], includeProjects: true });
  expect(jumpListKey(a)).not.toBe(jumpListKey(b));
  expect(jumpListKey(a)).toBe(jumpListKey(a));
 });
});

describe("applyJumpList", () => {
 const target = (results: string[]) => ({
  removedItems: [] as { args: string }[],
  setJumpList: vi.fn((_categories: unknown) => results.length ? results.shift()! : "ok"),
  getJumpListSettings: () => ({ removedItems: [{ args: "removed-args" }] }),
 });
 it("returns the applied key on ok", () => {
  const app = target(["ok"]);
  const applied = applyJumpList(app, { execPath: "e", projects: projects(1), includeProjects: true });
  expect(app.setJumpList).toHaveBeenCalledTimes(1);
  expect(applied.suppressed).toBe(false);
  expect(applied.key).toBe(jumpListKey(buildJumpList({ execPath: "e", projects: projects(1), includeProjects: true, removedArgs: ["removed-args"] })));
 });
 it("retries once without projects on failure, then stops", () => {
  const app = target(["failed", "ok"]);
  const applied = applyJumpList(app, { execPath: "e", projects: projects(1), includeProjects: true });
  expect(app.setJumpList).toHaveBeenCalledTimes(2);
  expect(app.setJumpList.mock.calls[1]![0]).toHaveLength(1);
  expect(applied.suppressed).toBe(true);
 });
 it("returns suppressed without a key when everything fails", () => {
  const app = target(["failed", "failed"]);
  const applied = applyJumpList(app, { execPath: "e", projects: projects(1), includeProjects: true });
  expect(applied).toEqual({ key: "", suppressed: true });
 });
});
