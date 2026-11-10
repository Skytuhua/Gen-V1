import { describe, expect, it, vi } from "vitest";
import {
	appendProjectSearch,
	projectSearchQueryError,
	readProjectSearch,
	unavailableProjectSearch,
	type ProjectSearchAdapter,
	type ProjectSearchPage,
	type ProjectSearchRequest,
} from "../apps/web/src/files/project-search-api";

const request: ProjectSearchRequest = {
	owner: { projectId: "p", threadId: "t" },
	q: "workspace",
	limit: 100,
};
const page = (): ProjectSearchPage => ({
	owner: {
		projectId: "p",
		threadId: "t",
		workingCopyId: "copy",
		revision: "r1",
	},
	matches: [
		{
			path: "src/workspace.ts",
			kind: "text",
			line: 48,
			column: 7,
			preview: "const workspace = restoreLayout();",
			sha256: "a".repeat(64),
		},
	],
	nextCursor: null,
	complete: true,
	exclusions: [],
	limits: { files: 5000, bytes: 104857600, matches: 100, timeoutMs: 2000 },
	errors: [],
});
const adapter = (value: unknown): ProjectSearchAdapter => ({
	available: true,
	search: vi.fn(async () => value as ProjectSearchPage),
});
const read = (value: unknown, input = request, previous?: ProjectSearchPage) =>
	readProjectSearch(
		adapter(value),
		input,
		new AbortController().signal,
		previous,
	);

describe("bounded project search adapter", () => {
	it("keeps production unavailable without making a network request", async () => {
		expect(unavailableProjectSearch.available).toBe(false);
		await expect(
			readProjectSearch(
				unavailableProjectSearch,
				request,
				new AbortController().signal,
			),
		).rejects.toThrow("unavailable");
	});
	it("accepts literal filename and text hits with exact owner, checksum and limits", async () => {
		const value = page();
		value.matches.push({
			path: "workspace[1].ts",
			kind: "path",
			preview: "A literal file name",
			sha256: "b".repeat(64),
		});
		expect(await read(value, { ...request, q: "[1].*" })).toEqual(value);
	});
	it.each(["", "   ", "x".repeat(513)])(
		"rejects blank and overlong queries before the adapter",
		async (q) => {
			const source = adapter(page());
			await expect(
				readProjectSearch(
					source,
					{ ...request, q },
					new AbortController().signal,
				),
			).rejects.toThrow("invalid");
			expect(source.search).not.toHaveBeenCalled();
		},
	);
	it("reports the query bound without changing literal query content", () => {
		expect(projectSearchQueryError("x".repeat(512))).toBe("");
		expect(projectSearchQueryError("x".repeat(513))).toContain("512");
	});
	it.each([
		"../secret",
		"/etc/passwd",
		"C:/secret",
		"a\\b",
		"a/../b",
		"a//b",
		"./a",
		"a\u0000b",
	])("rejects an unsafe result path %s", async (path) => {
		const value = page();
		value.matches[0].path = path;
		await expect(read(value)).rejects.toThrow("invalid results");
	});
	it.each(["projectId", "threadId"] as const)(
		"rejects another %s",
		async (field) => {
			const value = page();
			value.owner[field] = "other";
			await expect(read(value)).rejects.toThrow("another project or thread");
		},
	);
	it.each(["line", "sha256", "matches", "limits"])(
		"rejects invalid %s metadata",
		async (field) => {
			const value = page();
			if (field === "line") value.matches[0].line = undefined;
			if (field === "sha256") value.matches[0].sha256 = "invalid";
			if (field === "matches")
				value.matches = Array.from({ length: 101 }, () => value.matches[0]);
			if (field === "limits") value.limits.timeoutMs = -1;
			await expect(read(value)).rejects.toThrow("invalid results");
		},
	);
	it("retains partial results, exclusions and per-file errors explicitly", async () => {
		const value = page();
		value.complete = false;
		value.exclusions = [
			{ path: "secret", reason: "Access denied" },
			{ reason: "Outside authorized root" },
			{ path: "logo.png", reason: "Binary" },
		];
		value.errors = [{ code: "TIMEOUT", message: "Search timed out" }];
		expect(await read(value)).toEqual(value);
		value.complete = true;
		await expect(read(value)).rejects.toThrow("completeness");
	});
	it.each(["revision", "workingCopyId"] as const)(
		"refuses a changed %s between pages",
		async (field) => {
			const next = page();
			next.owner[field] = "changed";
			await expect(
				read(next, { ...request, cursor: "page2" }, page()),
			).rejects.toThrow("working copy changed");
		},
	);
	it("rejects a cursor that does not advance or claims complete with more pages", async () => {
		const value = page();
		value.nextCursor = "page2";
		await expect(read(value)).rejects.toThrow("completeness");
		value.complete = false;
		await expect(read(value, { ...request, cursor: "page2" })).rejects.toThrow(
			"cursor did not advance",
		);
	});
	it("deduplicates page hits while retaining previous exclusions and errors", () => {
		const first = page();
		first.exclusions = [{ reason: "Binary" }];
		first.errors = [{ code: "LIMIT", message: "Limited" }];
		const next = page();
		next.matches.push({ ...next.matches[0], line: 91 });
		const result = appendProjectSearch(first, next);
		expect(result.matches).toHaveLength(2);
		expect(result.exclusions).toEqual(first.exclusions);
		expect(result.errors).toEqual(first.errors);
	});
	it("labels an uneven final page as incomplete when the client cap discards hits", () => {
		const first = page();
		first.matches = Array.from({ length: 950 }, (_, index) => ({
			...first.matches[0],
			line: index + 1,
		}));
		const final = page();
		final.matches = Array.from({ length: 100 }, (_, index) => ({
			...final.matches[0],
			line: index + 951,
		}));
		const result = appendProjectSearch(first, final);
		expect(result.matches).toHaveLength(1000);
		expect(result.complete).toBe(false);
		expect(result.nextCursor).toBeNull();
	});

	it("rejects a late success even when the injected adapter ignores cancellation", async () => {
		let resolve!: (value: ProjectSearchPage) => void;
		const source: ProjectSearchAdapter = {
			available: true,
			search: () =>
				new Promise((done) => {
					resolve = done;
				}),
		};
		const controller = new AbortController();
		const pending = readProjectSearch(source, request, controller.signal);
		controller.abort();
		resolve(page());
		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
	});
});
