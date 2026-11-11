import { z } from "zod";

const id = z.string().regex(/^[a-zA-Z0-9:_.-]{1,200}$/);
const sha256 = z.string().regex(/^[a-f\d]{64}$/);
const relativePath = z
	.string()
	.min(1)
	.refine(
		(path) =>
			new TextEncoder().encode(path).length <= 1024 &&
			!/[\\\x00-\x1f\x7f:]/.test(path) &&
			!/[\uD800-\uDFFF]/u.test(path) &&
			!path
				.split("/")
				.some(
					(part) =>
						!part ||
						part === "." ||
						part === ".." ||
						/[. ]$/.test(part) ||
						/^(?:\.git|\.harness-directory-guard)$/i.test(part) ||
						/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
				),
		"Search paths must be relative to the project.",
	);
const ownerSchema = z.strictObject({
	projectId: id,
	threadId: id.nullable(),
	workingCopyId: id.nullable(),
	binding: sha256,
});
const matchSchema = z
	.strictObject({
		path: relativePath,
		kind: z.enum(["path", "text"]),
		line: z.number().int().positive().nullable(),
		column: z.number().int().positive().nullable(),
		preview: z
			.string()
			.refine(
				(value) =>
					Array.from(value).length <= 512 && !/[\uD800-\uDFFF]/u.test(value),
			),
		sha256,
	})
	.refine((match) =>
		match.kind === "path"
			? match.line === null && match.column === null
			: match.line !== null && match.column !== null,
	);
const issueSchema = z.strictObject({
	path: relativePath.nullable(),
	reason: z.enum([
		"excluded",
		"binary",
		"too_large",
		"unreadable",
		"changed",
		"file_limit",
		"byte_limit",
		"match_limit",
		"timeout",
		"response_limit",
	]),
});
const pageSchema = z.strictObject({
	owner: ownerSchema,
	matches: z.array(matchSchema).max(100),
	nextCursor: z.string().min(1).max(4096).nullable(),
	complete: z.boolean(),
	issues: z.array(issueSchema).max(100),
	issuesTruncated: z.boolean(),
	exclusions: z.array(z.string()),
	limits: z.strictObject({
		files: z.number().int().nonnegative(),
		bytes: z.number().int().nonnegative(),
		matches: z.number().int().nonnegative(),
		timeoutMs: z.number().int().nonnegative(),
		fileBytes: z.number().int().nonnegative(),
	}),
});

export type ProjectSearchOwner = Pick<
	z.infer<typeof ownerSchema>,
	"projectId" | "threadId"
>;
export type ProjectSearchMatch = z.infer<typeof matchSchema>;
export type ProjectSearchPage = z.infer<typeof pageSchema>;
export interface ProjectSearchRequest {
	owner: ProjectSearchOwner;
	q: string;
	cursor?: string;
	limit: 100;
}
export interface ProjectSearchAdapter {
	available: boolean;
	search: (
		request: ProjectSearchRequest,
		signal: AbortSignal,
	) => Promise<ProjectSearchPage>;
}

// No endpoint is connected yet. Fixture adapters are injected explicitly, never selected by URL in production.
export const unavailableProjectSearch: ProjectSearchAdapter = {
	available: false,
	search: async () => {
		throw new Error(
			"Project search is unavailable until the bounded search service is connected.",
		);
	},
};

export function projectSearchQueryError(q: string): string {
	return Array.from(q.trim()).length > 200
		? "Use 200 characters or fewer to search the project."
		: "";
}

export async function readProjectSearch(
	adapter: ProjectSearchAdapter,
	request: ProjectSearchRequest,
	signal: AbortSignal,
	previous?: ProjectSearchPage,
): Promise<ProjectSearchPage> {
	if (!adapter.available) throw new Error("Project search is unavailable.");
	const q = request.q.trim();
	if (
		!id.safeParse(request.owner.projectId).success ||
		(request.owner.threadId !== null &&
			!id.safeParse(request.owner.threadId).success) ||
		!q ||
		projectSearchQueryError(q) ||
		/[\uD800-\uDFFF]/u.test(q) ||
		request.limit !== 100
	)
		throw new Error("The project search request is invalid.");
	signal.throwIfAborted();
	const response: unknown = await adapter.search({ ...request, q }, signal);
	signal.throwIfAborted();
	const parsed = pageSchema.safeParse(response);
	if (!parsed.success)
		throw new Error(
			"Project search returned invalid results. Refresh to try again.",
		);
	const page = parsed.data;
	if (
		page.owner.projectId !== request.owner.projectId ||
		page.owner.threadId !== request.owner.threadId
	)
		throw new Error(
			"Search results belong to another project or thread. Refresh to try again.",
		);
	if (
		page.complete &&
		page.issues.some(
			(issue) => !["excluded", "binary", "too_large"].includes(issue.reason),
		)
	)
		throw new Error(
			"Project search returned inconsistent completeness information.",
		);
	if (request.cursor && page.nextCursor === request.cursor)
		throw new Error("The search cursor did not advance. Refresh the search.");
	if (
		previous &&
		(page.owner.workingCopyId !== previous.owner.workingCopyId ||
			page.owner.binding !== previous.owner.binding)
	)
		throw new Error(
			"The working copy changed during search. Refresh to search its current binding.",
		);
	return page;
}

export const projectSearchMatchKey = (match: ProjectSearchMatch) =>
	JSON.stringify([match.path, match.kind, match.line, match.column]);

export function appendProjectSearch(
	previous: ProjectSearchPage,
	page: ProjectSearchPage,
): ProjectSearchPage {
	const matches = new Map(
		previous.matches.map((match) => [projectSearchMatchKey(match), match]),
	);
	for (const match of page.matches)
		matches.set(projectSearchMatchKey(match), match);
	const issues = new Map(
		[...previous.issues, ...page.issues].map((issue) => [
			JSON.stringify(issue),
			issue,
		]),
	);
	return {
		...page,
		complete: previous.complete && page.complete && matches.size <= 1000,
		matches: [...matches.values()].slice(0, 1000),
		exclusions: [...new Set([...previous.exclusions, ...page.exclusions])],
		issues: [...issues.values()].slice(0, 100),
		issuesTruncated:
			previous.issuesTruncated || page.issuesTruncated || issues.size > 100,
	};
}
