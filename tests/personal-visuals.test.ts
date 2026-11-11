import { afterEach, describe, expect, it } from "vitest";
import {
	link,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	parseDiagramJson,
	diagramDocumentSchema,
} from "../plugins/personal-visuals/src/contracts";
import {
	diagramLayout,
	exampleDiagram,
} from "../plugins/personal-visuals/src/diagram";
import {
	createVisualDocumentHost as createDocumentHost,
	type VisualHostContext,
} from "../plugins/personal-visuals/src/document-host";
import { acquireProfileLease } from "../apps/server/profile-lease";
const createVisualDocumentHost = (context: VisualHostContext) =>
	createDocumentHost(context, acquireProfileLease);

const folders: string[] = [],
	hosts: Awaited<ReturnType<typeof createVisualDocumentHost>>[] = [];
const signal = () => new AbortController().signal;
async function host() {
	const directory = await mkdtemp(join(tmpdir(), "gen-personal-visuals-"));
	folders.push(directory);
	const value = await createVisualDocumentHost({
		dataDir: directory,
		genVersion: "0.6.5",
	});
	hosts.push(value);
	return { value, directory };
}
afterEach(async () => {
	for (const value of hosts.splice(0)) await value.close();
	for (const folder of folders.splice(0))
		await rm(folder, { recursive: true, force: true });
});

describe("bounded personal visual documents", () => {
	it("rejects duplicate/dangling IDs, excess data, arbitrary HTML fields and invalid intervals", () => {
		const sample = exampleDiagram("architecture");
		expect(
			diagramDocumentSchema.safeParse({
				...sample,
				nodes: [sample.nodes[0], sample.nodes[0]],
			}).success,
		).toBe(false);
		expect(
			diagramDocumentSchema.safeParse({
				...sample,
				edges: [
					{
						id: "bad",
						from: "absent",
						to: sample.nodes[0].id,
						label: "Invalid",
						sourceIds: [],
					},
				],
			}).success,
		).toBe(false);
		expect(
			diagramDocumentSchema.safeParse({
				...sample,
				nodes: [{ ...sample.nodes[0], html: "<script>alert(1)</script>" }],
			}).success,
		).toBe(false);
		expect(() => parseDiagramJson("x".repeat(100000))).toThrow(/limit/i);
		expect(
			diagramDocumentSchema.safeParse({
				...exampleDiagram("timeline"),
				nodes: [{ ...sample.nodes[0], start: 5, end: 2 }],
			}).success,
		).toBe(false);
	});
	it("lays out real topology and bounded cyclic flows deterministically without inventing activity", () => {
		for (const kind of [
			"architecture",
			"dependencies",
			"flow",
			"timeline",
		] as const) {
			const doc = exampleDiagram(kind),
				first = diagramLayout(doc);
			expect(first).toEqual(diagramLayout(doc));
			expect(Object.keys(first.nodes)).toHaveLength(doc.nodes.length);
			expect(doc.provenance).toBe("example");
			expect(first.width).toBeGreaterThan(0);
		}
		const doc = exampleDiagram("flow");
		doc.edges.push({
			id: "feedback",
			from: doc.nodes.at(-1)!.id,
			to: doc.nodes[0].id,
			label: "Feedback",
			sourceIds: [],
		});
		expect(Object.keys(diagramLayout(doc).nodes)).toHaveLength(
			doc.nodes.length,
		);
	});
});

describe("personal plug-in own-directory document host", () => {
	it("persists validated documents and partial drafts with exact revisions and idempotent request identity", async () => {
		const { value, directory } = await host();
		expect(
			await value.operations["visual.document.read"](
				{ documentId: "main" },
				signal(),
			),
		).toMatchObject({ revision: 0, document: null, draft: null });
		const draft = {
			documentId: "main",
			baseRevision: 0,
			requestId: "draft-1",
			action: "draft",
			draft: '{"version":',
		};
		expect(
			await value.operations["visual.document.write"](draft, signal()),
		).toMatchObject({ revision: 1, requestId: "draft-1" });
		expect(
			await value.operations["visual.document.write"](draft, signal()),
		).toMatchObject({ revision: 1 });
		await expect(
			value.operations["visual.document.write"](
				{ ...draft, draft: "different" },
				signal(),
			),
		).rejects.toThrow(/identity|conflict/i);
		await expect(
			value.operations["visual.document.write"](
				{ ...draft, requestId: "stale" },
				signal(),
			),
		).rejects.toThrow(/revision/i);
		const commit = {
			documentId: "main",
			baseRevision: 1,
			requestId: "commit-1",
			action: "commit",
			document: exampleDiagram("architecture"),
		};
		expect(
			await value.operations["visual.document.write"](commit, signal()),
		).toMatchObject({ revision: 2 });
		expect(
			await value.operations["visual.document.read"](
				{ documentId: "main" },
				signal(),
			),
		).toMatchObject({ revision: 2, document: commit.document, draft: null });
		expect(
			await value.operations["visual.document.read"](
				{ documentId: "main", requestId: "draft-1" },
				signal(),
			),
		).toMatchObject({
			revision: 2,
			receipt: { requestId: "draft-1", revision: 1 },
			pending: false,
		});
		await expect(
			createVisualDocumentHost({ dataDir: directory, genVersion: "0.6.5" }),
		).rejects.toThrow();
		await value.close();
		hosts.splice(hosts.indexOf(value), 1);
		const restored = await createVisualDocumentHost({
			dataDir: directory,
			genVersion: "0.6.5",
		});
		hosts.push(restored);
		expect(
			await restored.operations["visual.document.read"](
				{ documentId: "main" },
				signal(),
			),
		).toMatchObject({ revision: 2, document: commit.document });
		expect(
			JSON.stringify(
				await readFile(join(directory, "visual-documents.json"), "utf8"),
			),
		).not.toContain("message.send");
	});
	it("rejects outside keys, unknown operations and aborted writes without granting personal authority", async () => {
		const { value } = await host();
		for (const documentId of [
			"../escape",
			"constructor",
			"personal:account",
			"/absolute",
		])
			await expect(
				value.operations["visual.document.read"]({ documentId }, signal()),
			).rejects.toThrow();
		expect(value.operations["message.send"]).toBeUndefined();
		expect(value.operations["state.read"]).toBeUndefined();
		expect(value.validateSurface).toBeUndefined();
		const aborted = new AbortController();
		aborted.abort();
		await expect(
			value.operations["visual.document.write"](
				{
					documentId: "main",
					baseRevision: 0,
					requestId: "aborted",
					action: "draft",
					draft: "kept",
				},
				aborted.signal,
			),
		).rejects.toThrow(/cancel/i);
		expect(await value.isBusy!()).toBe(false);
		expect(
			await value.operations["visual.document.read"](
				{ documentId: "toString" },
				signal(),
			),
		).toMatchObject({ documentId: "toString", revision: 0 });
	});
	it("keeps an unconfirmed save busy, blocks close, then recovers only its exact retry", async () => {
		const { value, directory } = await host();
		await mkdir(join(directory, "visual-documents.json"));
		const write = {
			documentId: "main",
			baseRevision: 0,
			requestId: "retry-1",
			action: "draft",
			draft: "do not lose this",
		};
		await expect(
			value.operations["visual.document.write"](write, signal()),
		).rejects.toThrow();
		expect(await value.isBusy!()).toBe(true);
		await expect(value.close()).rejects.toThrow(/save|unconfirmed/i);
		await expect(
			value.operations["visual.document.write"](
				{ ...write, requestId: "different" },
				signal(),
			),
		).rejects.toThrow(/unconfirmed|retry/i);
		await rm(join(directory, "visual-documents.json"), { recursive: true });
		await expect(
			value.operations["visual.document.write"](write, signal()),
		).resolves.toMatchObject({ revision: 1 });
		expect(await value.isBusy!()).toBe(false);
	});

	it("does not let an already queued different write cross an unconfirmed-save barrier", async () => {
		const { value, directory } = await host();
		await mkdir(join(directory, "visual-documents.json"));
		const first = {
			documentId: "main",
			baseRevision: 0,
			requestId: "first-pending",
			action: "draft",
			draft: "retained",
		};
		const one = value.operations["visual.document.write"](first, signal()),
			two = value.operations["visual.document.write"](
				{ ...first, requestId: "queued-other" },
				signal(),
			);
		await expect(one).rejects.toThrow();
		await expect(two).rejects.toThrow();
		await rm(join(directory, "visual-documents.json"), { recursive: true });
		expect(
			await value.operations["visual.document.read"](
				{ documentId: "main", requestId: "queued-other" },
				signal(),
			),
		).toMatchObject({ pending: false });
		await value.operations["visual.document.write"](first, signal());
		expect(await value.isBusy!()).toBe(false);
	});
	it("refuses linked storage or invalid recovered bytes rather than following or replacing them", async () => {
		const directory = await mkdtemp(
			join(tmpdir(), "gen-personal-visuals-corrupt-"),
		);
		folders.push(directory);
		await writeFile(join(directory, "visual-documents.json"), "{broken");
		await expect(
			createVisualDocumentHost({ dataDir: directory, genVersion: "0.6.5" }),
		).rejects.toThrow();
		const linked = await mkdtemp(
			join(tmpdir(), "gen-personal-visuals-linked-"),
		);
		folders.push(linked);
		const source = join(linked, "outside-record.json");
		await writeFile(source, '{"version":1,"documents":{}}');
		await link(source, join(linked, "visual-documents.json"));
		await expect(
			createVisualDocumentHost({ dataDir: linked, genVersion: "0.6.5" }),
		).rejects.toThrow(/ordinary/i);
		expect(await readFile(source, "utf8")).toBe('{"version":1,"documents":{}}');
	});
});
