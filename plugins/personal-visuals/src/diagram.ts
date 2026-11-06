import { diagramDocumentSchema, type DiagramDocument } from "./contracts";

export const nodeColors = {
	component: "#3b82f6",
	service: "#8b5cf6",
	data: "#06b6d4",
	actor: "#f97316",
	step: "#22c55e",
	event: "#f43f5e",
};
export interface DiagramLayout {
	width: number;
	height: number;
	nodes: Record<
		string,
		{ x: number; y: number; width: number; height: number }
	>;
	timeRange?: { start: number; end: number };
}
export function diagramLayout(document: DiagramDocument): DiagramLayout {
	const spec = diagramDocumentSchema.parse(document),
		nodes: DiagramLayout["nodes"] = {};
	if (spec.kind === "timeline") {
		const start = Math.min(...spec.nodes.map((node) => node.start!)),
			end = Math.max(...spec.nodes.map((node) => node.end!)),
			range = Math.max(1, end - start);
		spec.nodes.forEach((node, index) => {
			nodes[node.id] = {
				x: 130 + ((node.start! - start) / range) * 800,
				y: 50 + index * 70,
				width: Math.max(18, ((node.end! - node.start!) / range) * 800),
				height: 40,
			};
		});
		return {
			width: 1030,
			height: Math.max(200, 90 + spec.nodes.length * 70),
			nodes,
			timeRange: { start, end },
		};
	}
	const incoming = new Map(spec.nodes.map((node) => [node.id, 0])),
		depth = new Map<string, number>(),
		queue: string[] = [];
	for (const edge of spec.edges)
		incoming.set(edge.to, incoming.get(edge.to)! + 1);
	for (const node of spec.nodes)
		if (incoming.get(node.id) === 0) {
			queue.push(node.id);
			depth.set(node.id, 0);
		}
	const seen = new Set<string>();
	while (queue.length) {
		const id = queue.shift()!;
		if (seen.has(id)) continue;
		seen.add(id);
		for (const edge of spec.edges.filter((edge) => edge.from === id)) {
			depth.set(
				edge.to,
				Math.max(
					depth.get(edge.to) ?? 0,
					Math.min(15, (depth.get(id) ?? 0) + 1),
				),
			);
			incoming.set(edge.to, incoming.get(edge.to)! - 1);
			if (incoming.get(edge.to) === 0) queue.push(edge.to);
		}
	}
	const rows = new Map<number, number>();
	spec.nodes.forEach((node, index) => {
		const column = depth.get(node.id) ?? Math.floor(index / 8),
			row = rows.get(column) ?? 0;
		rows.set(column, row + 1);
		nodes[node.id] = {
			x: 35 + column * 270,
			y: 40 + row * 120,
			width: 200,
			height: 76,
		};
	});
	return {
		width: Math.max(
			450,
			...Object.values(nodes).map((node) => node.x + node.width + 35),
		),
		height: Math.max(
			240,
			...Object.values(nodes).map((node) => node.y + node.height + 40),
		),
		nodes,
	};
}
export function exampleDiagram(kind: DiagramDocument["kind"]): DiagramDocument {
	const source = {
		id: "example",
		title: "Illustrative example",
		excerpt:
			"This diagram explains a possible structure. It is not an observation of your projects, services or agents.",
	};
	const names =
		kind === "architecture"
			? ["Person", "Web interface", "API service", "Database"]
			: kind === "dependencies"
				? ["Application", "UI package", "Shared contracts", "Storage library"]
				: kind === "flow"
					? [
							"Review request",
							"Validate input",
							"Prepare result",
							"Owner decision",
						]
					: ["Research", "Design", "Build", "Review"];
	const nodes = names.map((label, index) => ({
		id: "node-" + index,
		label,
		kind: (kind === "timeline"
			? "event"
			: kind === "flow"
				? "step"
				: index === 0
					? "actor"
					: index === 3
						? "data"
						: "service") as "event" | "step" | "actor" | "data" | "service",
		description:
			"Example " +
			label.toLowerCase() +
			". Replace this with your actual structure.",
		sourceIds: ["example"],
		...(kind === "timeline"
			? { start: [0, 2, 5, 9][index], end: [3, 6, 10, 12][index] }
			: {}),
	}));
	return diagramDocumentSchema.parse({
		version: 1,
		title:
			kind === "architecture"
				? "Example architecture"
				: kind === "dependencies"
					? "Example dependencies"
					: kind === "flow"
						? "Example system flow"
						: "Example timeline",
		kind,
		provenance: "example",
		description:
			"Illustrative example — import a structured document to explore your own system.",
		...(kind === "timeline" ? { timeUnit: "days" } : {}),
		nodes,
		edges:
			kind === "timeline"
				? []
				: nodes.slice(1).map((node, index) => ({
						id: "edge-" + index,
						from: kind === "dependencies" ? nodes[0].id : nodes[index].id,
						to: node.id,
						label:
							kind === "dependencies"
								? "depends on"
								: kind === "flow"
									? "next"
									: "connects to",
						sourceIds: ["example"],
					})),
		sources: [source],
	});
}
