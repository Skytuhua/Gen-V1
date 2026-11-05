import { z } from "zod";

export const VISUAL_LIMITS = {
	nodes: 128,
	edges: 256,
	sources: 64,
	documentBytes: 96 * 1024,
	documents: 32,
	receipts: 100,
	fileBytes: 8 * 1024 * 1024,
} as const;
export const visualIdSchema = z
	.string()
	.min(1)
	.max(80)
	.regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/)
	.refine(
		(value) => !["constructor", "prototype", "__proto__"].includes(value),
	);
const label = z.string().trim().min(1).max(200),
	detail = z.string().max(4000),
	refs = z.array(visualIdSchema).max(16).default([]);
export const diagramNodeSchema = z.strictObject({
	id: visualIdSchema,
	label,
	kind: z.enum(["component", "service", "data", "actor", "step", "event"]),
	description: detail.optional(),
	sourceIds: refs,
	start: z.number().finite().min(-1e12).max(1e12).optional(),
	end: z.number().finite().min(-1e12).max(1e12).optional(),
});
export const diagramEdgeSchema = z.strictObject({
	id: visualIdSchema,
	from: visualIdSchema,
	to: visualIdSchema,
	label: z.string().max(200).default(""),
	sourceIds: refs,
});
export const diagramDocumentSchema = z
	.strictObject({
		version: z.literal(1),
		title: label,
		kind: z.enum(["architecture", "dependencies", "flow", "timeline"]),
		provenance: z.enum(["example", "provided", "derived"]),
		description: detail.optional(),
		timeUnit: z.enum(["ms", "seconds", "minutes", "days"]).optional(),
		nodes: z.array(diagramNodeSchema).min(1).max(VISUAL_LIMITS.nodes),
		edges: z.array(diagramEdgeSchema).max(VISUAL_LIMITS.edges),
		sources: z
			.array(
				z.strictObject({
					id: visualIdSchema,
					title: label,
					locator: z.string().max(500).optional(),
					excerpt: detail.optional(),
				}),
			)
			.max(VISUAL_LIMITS.sources),
	})
	.superRefine((value, context) => {
		const nodes = new Set(value.nodes.map((node) => node.id)),
			edges = new Set(value.edges.map((edge) => edge.id)),
			sources = new Set(value.sources.map((source) => source.id));
		if (
			nodes.size !== value.nodes.length ||
			edges.size !== value.edges.length ||
			sources.size !== value.sources.length
		)
			context.addIssue({
				code: "custom",
				message: "Diagram IDs must be unique.",
			});
		for (const edge of value.edges)
			if (!nodes.has(edge.from) || !nodes.has(edge.to))
				context.addIssue({
					code: "custom",
					message: "Edges must refer to existing diagram nodes.",
				});
		for (const item of [...value.nodes, ...value.edges])
			if (item.sourceIds.some((id) => !sources.has(id)))
				context.addIssue({
					code: "custom",
					message: "Source references must resolve to this document.",
				});
		if (
			value.kind === "timeline" &&
			value.nodes.some(
				(node) =>
					node.start === undefined ||
					node.end === undefined ||
					node.end < node.start,
			)
		)
			context.addIssue({
				code: "custom",
				message: "Timeline items need finite start and end values in order.",
			});
		if (
			new TextEncoder().encode(JSON.stringify(value)).length >
			VISUAL_LIMITS.documentBytes
		)
			context.addIssue({
				code: "custom",
				message: "The visual document exceeds its byte limit.",
			});
	});
export type DiagramDocument = z.infer<typeof diagramDocumentSchema>;
export type DiagramNode = z.infer<typeof diagramNodeSchema>;
export type DiagramEdge = z.infer<typeof diagramEdgeSchema>;
export function parseDiagramJson(value: string): DiagramDocument {
	if (new TextEncoder().encode(value).length > VISUAL_LIMITS.documentBytes)
		throw Error("The diagram exceeds the 96 KiB import limit.");
	let decoded: unknown;
	try {
		decoded = JSON.parse(value);
	} catch {
		throw Error("Use a valid JSON diagram document.");
	}
	const parsed = diagramDocumentSchema.safeParse(decoded);
	if (!parsed.success)
		throw Error(
			"The diagram needs unique bounded nodes, valid edges and matching sources.",
		);
	return parsed.data;
}
export const documentReadSchema = z.strictObject({
	documentId: visualIdSchema,
	requestId: visualIdSchema.optional(),
});
const writeFields = {
	documentId: visualIdSchema,
	baseRevision: z.number().int().nonnegative(),
	requestId: visualIdSchema,
};
export const documentWriteSchema = z.discriminatedUnion("action", [
	z.strictObject({
		...writeFields,
		action: z.literal("draft"),
		draft: z
			.string()
			.refine(
				(value) =>
					new TextEncoder().encode(value).length <= VISUAL_LIMITS.documentBytes,
				"The draft exceeds its byte limit.",
			),
	}),
	z.strictObject({
		...writeFields,
		action: z.literal("commit"),
		document: diagramDocumentSchema,
	}),
]);
export type DocumentWrite = z.infer<typeof documentWriteSchema>;
export interface VisualDocumentRecord {
	documentId: string;
	revision: number;
	document: DiagramDocument | null;
	draft: string | null;
	receipt?: { requestId: string; revision: number } | null;
	pending?: boolean;
}
