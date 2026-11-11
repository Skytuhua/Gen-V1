import { expect, it } from "vitest";
import { prepareVisualDraft } from "../plugins/personal-visuals/src/draft";
import {
	diagramDocumentSchema,
	type DiagramDocument,
	VISUAL_LIMITS,
} from "../plugins/personal-visuals/src/contracts";

function boundaryDocument(bytes: number, multibyte = false): DiagramDocument {
	const document: DiagramDocument = {
		version: 1,
		title: "Boundary",
		kind: "architecture",
		provenance: "provided",
		nodes: Array.from({ length: 128 }, (_, i) => ({
			id: `n${i}`,
			label: `Node ${i}`,
			kind: "component",
			sourceIds: [],
			description: "",
		})),
		edges: [],
		sources: [],
	};
	if (multibyte) document.nodes[0].description = "é界🧭".repeat(100);
	let remaining =
		bytes - new TextEncoder().encode(JSON.stringify(document, null, 2)).length;
	for (const node of document.nodes) {
		const count = Math.min(remaining, 4000 - node.description!.length);
		node.description += "x".repeat(count);
		remaining -= count;
	}
	expect(remaining).toBe(0);
	return document;
}

it.each([false, true])(
	"formatted UTF-8 boundary is inclusive (multibyte=%s)",
	(multibyte) => {
		const exact = boundaryDocument(98_304, multibyte),
			oversize = boundaryDocument(98_305, multibyte);
		expect(diagramDocumentSchema.safeParse(exact).success).toBe(true);
		expect(diagramDocumentSchema.safeParse(oversize).success).toBe(true);
		const prepared = prepareVisualDraft(exact);
		expect(new TextEncoder().encode(prepared.text).length).toBe(
			VISUAL_LIMITS.documentBytes,
		);
		expect(JSON.parse(prepared.text)).toEqual(prepared.document);
		expect(prepared.selected).toBe("node:n0");
		if (multibyte) expect(prepared.text.length).toBeLessThan(98_304);
		expect(() => prepareVisualDraft(oversize)).toThrow(
			"The draft exceeds the 96 KiB limit.",
		);
	},
);

it("preparation validates references without mutating input", () => {
	const input = boundaryDocument(20_000);
	input.title = "  Normalized title  ";
	const before = structuredClone(input);
	const prepared = prepareVisualDraft(input);
	expect(prepared.document.title).toBe("Normalized title");
	expect(input).toEqual(before);
	expect(prepared.document).not.toBe(input);
	for (const invalid of [
		{ ...input, version: 2 },
		{ ...input, nodes: [...input.nodes.slice(1), input.nodes[1]] },
		{
			...input,
			edges: [
				{ id: "edge", from: "missing", to: "n0", label: "", sourceIds: [] },
			],
		},
		{ ...input, nodes: [{ ...input.nodes[0], sourceIds: ["missing"] }] },
	]) {
		expect(() => prepareVisualDraft(invalid as DiagramDocument)).toThrow();
		expect(input).toEqual(before);
	}
});
