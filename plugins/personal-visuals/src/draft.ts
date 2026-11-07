import {
	diagramDocumentSchema,
	type DiagramDocument,
	VISUAL_LIMITS,
} from "./contracts";

/** Prepare every staged state owner before the editor changes anything. */
export function prepareVisualDraft(value: DiagramDocument): {
	document: DiagramDocument;
	text: string;
	selected: string;
} {
	const document = diagramDocumentSchema.parse(value),
		text = JSON.stringify(document, null, 2);
	if (new TextEncoder().encode(text).length > VISUAL_LIMITS.documentBytes)
		throw Error("The draft exceeds the 96 KiB limit.");
	return { document, text, selected: "node:" + document.nodes[0].id };
}
