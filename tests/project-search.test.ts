import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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
		binding: "b".repeat(64),
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
	limits: {
		files: 10000,
		bytes: 33554432,
		matches: 1000,
		timeoutMs: 2000,
		fileBytes: 1048576,
	},
	issues: [],
	issuesTruncated: false,
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
			line: null,
			column: null,
			sha256: "b".repeat(64),
		});
		expect(await read(value, { ...request, q: "[1].*" })).toEqual(value);
	});
	it.each(["", "   ", "x".repeat(201)])(
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
		expect(projectSearchQueryError("x".repeat(200))).toBe("");
		expect(projectSearchQueryError("x".repeat(201))).toContain("200");
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
		".git/config",
		"src/NUL.txt",
		"src/trailing. ",
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
			if (field === "line") Reflect.deleteProperty(value.matches[0], "line");
			if (field === "sha256") value.matches[0].sha256 = "invalid";
			if (field === "matches")
				value.matches = Array.from({ length: 101 }, () => value.matches[0]);
			if (field === "limits") value.limits.timeoutMs = -1;
			await expect(read(value)).rejects.toThrow("invalid results");
		},
	);
	it("retains partial results, exclusions and per-file issues explicitly", async () => {
		const value = page();
		value.complete = false;
		value.exclusions = [".git", "node_modules", "links/reparse points"];
		value.issues = [
			{ path: "secret", reason: "unreadable" },
			{ path: "logo.png", reason: "binary" },
			{ path: null, reason: "timeout" },
		];
		expect(await read(value)).toEqual(value);
		value.complete = true;
		await expect(read(value)).rejects.toThrow("completeness");
	});
	it.each(["binding", "workingCopyId"] as const)(
		"refuses a changed %s between pages",
		async (field) => {
			const next = page();
			next.owner[field] = field === "binding" ? "c".repeat(64) : "changed";
			await expect(
				read(next, { ...request, cursor: "page2" }, page()),
			).rejects.toThrow("working copy changed");
		},
	);
	it("rejects a cursor that does not advance", async () => {
		const value = page();
		value.nextCursor = "page2";
		await expect(read(value, { ...request, cursor: "page2" })).rejects.toThrow(
			"cursor did not advance",
		);
	});
	it("deduplicates page hits while retaining previous exclusions and issues", () => {
		const first = page();
		first.exclusions = ["node_modules"];
		first.issues = [{ path: null, reason: "match_limit" }];
		const next = page();
		next.matches.push({ ...next.matches[0], line: 91 });
		const result = appendProjectSearch(first, next);
		expect(result.matches).toHaveLength(2);
		expect(result.exclusions).toEqual(first.exclusions);
		expect(result.issues).toEqual(first.issues);
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

// Regression cases use the frozen wire shape, independently of the fixture adapter.
describe("QA r1 frozen search contract", () => {
	it("accepts nullable owners and coordinates, binding, issues and a complete paged scan", async () => {
		const value = {
			owner: {
				projectId: "p",
				threadId: null,
				workingCopyId: null,
				binding: "b".repeat(64),
			},
			matches: [
				{
					path: "workspace.ts",
					kind: "path",
					line: null,
					column: null,
					preview: "workspace.ts",
					sha256: "a".repeat(64),
				},
			],
			nextCursor: "page2",
			complete: true,
			issues: [
				{ path: null, reason: "excluded" },
				{ path: "logo.png", reason: "binary" },
			],
			issuesTruncated: true,
			exclusions: [".git", "node_modules", "links/reparse points"],
			limits: {
				files: 10000,
				bytes: 33554432,
				matches: 1000,
				timeoutMs: 2000,
				fileBytes: 1048576,
			},
		};
		await expect(
			read(value, { ...request, owner: { projectId: "p", threadId: null } }),
		).resolves.toEqual(value);
	});
	it("accepts complete scans with a continuation cursor", async () => {
		const value = page();
		value.nextCursor = "page2";
		await expect(read(value)).resolves.toEqual(value);
	});
});

describe("QA r1 trimmed Unicode query boundary", () => {
	it("rejects 201 ASCII code points before calling the adapter", async () => {
		const source = adapter(page());
		await expect(
			readProjectSearch(
				source,
				{ ...request, q: "x".repeat(201) },
				new AbortController().signal,
			),
		).rejects.toThrow("invalid");
		expect(source.search).not.toHaveBeenCalled();
	});
	it("counts code points after trimming, including supplementary characters", async () => {
		expect(projectSearchQueryError("😀".repeat(200))).toBe("");
		expect(projectSearchQueryError("😀".repeat(201))).toContain("200");
		expect(
			projectSearchQueryError(" ".repeat(600) + "workspace" + " ".repeat(600)),
		).toBe("");
		const source = adapter(page());
		await readProjectSearch(
			source,
			{ ...request, q: " ".repeat(600) + "😀".repeat(200) + " ".repeat(600) },
			new AbortController().signal,
		);
		expect(source.search).toHaveBeenCalledWith(
			{ ...request, q: "😀".repeat(200) },
			expect.any(AbortSignal),
		);
	});
});

it("bounds repeated page metadata and preserves omitted issue disclosure", () => {
	const first = page();
	first.issues = Array.from({ length: 100 }, (_, index) => ({
		path: `file-${index}.txt`,
		reason: "unreadable",
	}));
	first.exclusions = ["node_modules"];
	const next = page();
	next.issues = [...first.issues, { path: null, reason: "timeout" }];
	next.exclusions = ["node_modules"];
	const combined = appendProjectSearch(first, next);
	expect(combined.issues).toHaveLength(100);
	expect(combined.issuesTruncated).toBe(true);
	expect(combined.exclusions).toEqual(["node_modules"]);
	expect(appendProjectSearch(combined, page()).issuesTruncated).toBe(true);
});

describe("QA r2 host-compatible paths", () => {
	it.each(["\t", "\n", "\r", "\u001b", "\u007f"])(
		"accepts a valid control character in match and issue paths: %j",
		async (control) => {
			const value = page();
			value.matches.push({
				...value.matches[0],
				path: `src/notes${control}2026.txt`,
			});
			value.complete = false;
			value.issues = [
				{ path: `src/unreadable${control}2026.txt`, reason: "unreadable" },
			];
			await expect(read(value)).resolves.toEqual(value);
		},
	);
	it.each(["src/COM¹.txt", "src/harness.sqlite", "src/.host-lease.sqlite-wal"])(
		"rejects a host-protected path: %s",
		async (path) => {
			const value = page();
			value.matches[0].path = path;
			await expect(read(value)).rejects.toThrow("invalid results");
		},
	);
});

it("keeps every spec and capture script free of external evidence destinations", () => {
	const forbidden = ["gen-company", "ledger"].join("/");
	const referencesDestination = (source: string) => source.includes(forbidden);
	expect(referencesDestination(`await save("${forbidden}/example.png")`)).toBe(
		true,
	);
	const files = ["tests", "scripts"]
		.flatMap((root) =>
			readdirSync(root, { recursive: true })
				.map(String)
				.map((name) => join(root, name).replaceAll("\\", "/")),
		)
		.filter(
			(path) =>
				/\.[cm]?[jt]sx?$/.test(path) &&
				(path.startsWith("tests/") || /capture/.test(path)),
		);
	expect(
		files.filter((path) => referencesDestination(readFileSync(path, "utf8"))),
	).toEqual([]);
	const itemSpec = readFileSync("tests/e2e/project-search.spec.ts", "utf8");
	expect(itemSpec.includes(["WO5", "CAPTURE", "DIR"].join("_"))).toBe(false);
	expect(itemSpec).toContain("testInfo.outputPath(");
});
