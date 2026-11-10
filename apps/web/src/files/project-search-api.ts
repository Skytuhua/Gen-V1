import { z } from "zod";

const relativePath = z
	.string()
	.min(1)
	.max(4096)
	.refine(
		(path) =>
			!/[\\\x00-\x1f\x7f:]/.test(path) &&
			!path.startsWith("/") &&
			!path.split("/").some((part) => !part || part === "." || part === ".."),
		"Search paths must be relative to the project.",
	);
const ownerSchema = z.object({
	projectId: z.string().min(1),
	threadId: z.string().min(1).optional(),
	workingCopyId: z.string().min(1),
	revision: z.string().min(1),
});
const matchSchema = z
	.object({
		path: relativePath,
		kind: z.enum(["path", "text"]),
		line: z.number().int().positive().optional(),
		column: z.number().int().positive().optional(),
		preview: z.string().max(4096),
		sha256: z.string().regex(/^[a-f\d]{64}$/i),
	})
	.refine((match) => match.kind !== "text" || match.line !== undefined);
const pageSchema = z.object({
	owner: ownerSchema,
	matches: z.array(matchSchema).max(100),
	nextCursor: z.string().min(1).max(4096).nullable(),
	complete: z.boolean(),
	exclusions: z
		.array(
			z.object({
				path: relativePath.optional(),
				reason: z.string().min(1).max(1024),
			}),
		)
		.max(500),
	limits: z.object({
		files: z.number().int().nonnegative(),
		bytes: z.number().int().nonnegative(),
		matches: z.number().int().nonnegative(),
		timeoutMs: z.number().int().nonnegative(),
	}),
	errors: z
		.array(
			z.object({
				path: relativePath.optional(),
				code: z.string().min(1),
				message: z.string().min(1).max(1024),
			}),
		)
		.max(100),
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
	return q.length > 512
		? "Use 512 characters or fewer to search the project."
		: "";
}

export async function readProjectSearch(
	adapter: ProjectSearchAdapter,
	request: ProjectSearchRequest,
	signal: AbortSignal,
	previous?: ProjectSearchPage,
): Promise<ProjectSearchPage> {
	if (!adapter.available) throw new Error("Project search is unavailable.");
	if (
		!request.owner.projectId ||
		!request.q.trim() ||
		projectSearchQueryError(request.q) ||
		request.limit !== 100
	)
		throw new Error("The project search request is invalid.");
	signal.throwIfAborted();
	const response: unknown = await adapter.search(request, signal);
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
	if (page.complete && (page.nextCursor || page.errors.length))
		throw new Error(
			"Project search returned inconsistent completeness information.",
		);
	if (request.cursor && page.nextCursor === request.cursor)
		throw new Error("The search cursor did not advance. Refresh the search.");
	if (
		previous &&
		(page.owner.workingCopyId !== previous.owner.workingCopyId ||
			page.owner.revision !== previous.owner.revision)
	)
		throw new Error(
			"The working copy changed during search. Refresh to search its current revision.",
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
	return {
		...page,
		complete: page.complete && matches.size <= 1000,
		matches: [...matches.values()].slice(0, 1000),
		exclusions: [...previous.exclusions, ...page.exclusions],
		errors: [...previous.errors, ...page.errors],
	};
}
