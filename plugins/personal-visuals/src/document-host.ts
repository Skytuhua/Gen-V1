import { createHash, randomUUID } from "node:crypto";
import { constants, lstatSync, realpathSync } from "node:fs";
import { lstat, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
	diagramDocumentSchema,
	documentReadSchema,
	documentWriteSchema,
	visualIdSchema,
	VISUAL_LIMITS,
	type VisualDocumentRecord,
} from "./contracts";

const boundedDraft = z
	.string()
	.refine((value) => Buffer.byteLength(value) <= VISUAL_LIMITS.documentBytes);
const receiptSchema = z.strictObject({
	requestId: visualIdSchema,
	fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
	revision: z.number().int().positive(),
});
const savedDocumentSchema = z.strictObject({
	documentId: visualIdSchema,
	revision: z.number().int().nonnegative(),
	document: diagramDocumentSchema.nullable(),
	draft: boundedDraft.nullable(),
	receipts: z.array(receiptSchema).max(VISUAL_LIMITS.receipts),
});
const savedStateSchema = z
	.strictObject({
		version: z.literal(1),
		documents: z.record(visualIdSchema, savedDocumentSchema),
	})
	.superRefine((value, context) => {
		if (Object.keys(value.documents).length > VISUAL_LIMITS.documents)
			context.addIssue({
				code: "custom",
				message: "Too many visual documents.",
			});
		for (const [id, document] of Object.entries(value.documents))
			if (
				document.documentId !== id ||
				new Set(document.receipts.map((receipt) => receipt.requestId)).size !==
					document.receipts.length
			)
				context.addIssue({
					code: "custom",
					message: "Stored document identities must match.",
				});
	});
type SavedState = z.infer<typeof savedStateSchema>;
const fingerprint = (value: unknown) =>
	createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Own-directory records only. No personal Store, account, model or filesystem grant. */
export interface VisualHostContext {
	dataDir: string;
	genVersion: string;
}
export interface VisualDocumentHost {
	operations: Record<
		string,
		(input: unknown, signal: AbortSignal) => Promise<unknown>
	>;
	isBusy: () => Promise<boolean>;
	close: () => Promise<void>;
	validateSurface?: never;
}
export async function createVisualDocumentHost(
	context: VisualHostContext,
	acquireProfileLease: (directory: string) => {
		dataDir: string;
		close(): void;
	},
): Promise<VisualDocumentHost> {
	const lease = acquireProfileLease(context.dataDir),
		directory = lease.dataDir,
		path = join(directory, "visual-documents.json"),
		owner = lstatSync(directory, { bigint: true });
	let closed = false,
		closing = false,
		active = 0,
		tail: Promise<unknown> = Promise.resolve();
	const unconfirmed = new Map<string, string>();
	const assertOwner = () => {
		const current = lstatSync(directory, { bigint: true });
		if (
			!current.isDirectory() ||
			current.isSymbolicLink() ||
			current.dev !== owner.dev ||
			current.ino !== owner.ino ||
			realpathSync(directory) !== directory
		)
			throw Error("The visual document directory changed.");
	};
	const ready = (signal?: AbortSignal) => {
		if (closed || closing) throw Error("The visual document host is closing.");
		if (signal?.aborted)
			throw Error("The visual document request was cancelled.");
		assertOwner();
	};
	async function load(): Promise<SavedState> {
		assertOwner();
		let before: Awaited<ReturnType<typeof lstat>>;
		try {
			before = await lstat(path);
		} catch (cause) {
			if ((cause as NodeJS.ErrnoException).code === "ENOENT")
				return { version: 1, documents: {} };
			throw Error("Saved visual data could not be recovered.");
		}
		if (
			!before.isFile() ||
			before.isSymbolicLink() ||
			before.nlink !== 1 ||
			before.size > VISUAL_LIMITS.fileBytes
		)
			throw Error("Saved visual data must be a bounded ordinary file.");
		const handle = await open(
			path,
			constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
		);
		try {
			const current = await handle.stat();
			if (
				current.dev !== before.dev ||
				current.ino !== before.ino ||
				current.size !== before.size ||
				!current.isFile() ||
				current.nlink !== 1
			)
				throw Error("Saved visual data changed during recovery.");
			const bytes = Buffer.alloc(current.size + 1),
				read = await handle.read(bytes, 0, bytes.length, 0),
				after = await handle.stat();
			if (
				read.bytesRead !== current.size ||
				after.size !== current.size ||
				after.mtimeMs !== current.mtimeMs ||
				after.ctimeMs !== current.ctimeMs
			)
				throw Error("Saved visual data changed during recovery.");
			assertOwner();
			return savedStateSchema.parse(
				JSON.parse(
					new TextDecoder("utf-8", { fatal: true }).decode(
						bytes.subarray(0, read.bytesRead),
					),
				),
			);
		} finally {
			await handle.close();
		}
	}
	async function persist(state: SavedState) {
		const bytes = Buffer.from(
			JSON.stringify(savedStateSchema.parse(state)) + "\n",
		);
		if (bytes.length > VISUAL_LIMITS.fileBytes)
			throw Error("Visual storage is full. Keep the unsaved document open.");
		assertOwner();
		try {
			const existing = await lstat(path);
			if (
				!existing.isFile() ||
				existing.isSymbolicLink() ||
				existing.nlink !== 1
			)
				throw Error("The saved visual document is unavailable.");
		} catch (cause) {
			if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
		}
		const temporary = join(
				directory,
				".visual-documents-" + randomUUID() + ".tmp",
			),
			handle = await open(temporary, "wx", 0o600);
		let renamed = false;
		try {
			await handle.writeFile(bytes);
			await handle.sync();
			await handle.close();
			assertOwner();
			try {
				const current = await lstat(path);
				if (
					!current.isFile() ||
					current.isSymbolicLink() ||
					current.nlink !== 1
				)
					throw Error("The saved visual document changed.");
			} catch (cause) {
				if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
			}
			await rename(temporary, path);
			renamed = true;
			assertOwner();
			let directoryHandle: Awaited<ReturnType<typeof open>> | undefined;
			try {
				directoryHandle = await open(directory, "r");
				await directoryHandle.sync();
			} catch (cause) {
				const code = (cause as NodeJS.ErrnoException).code;
				if (
					![
						"EINVAL",
						"ENOTSUP",
						...(process.platform === "win32" ? ["EPERM", "EISDIR"] : []),
					].includes(code ?? "")
				)
					throw cause;
			} finally {
				await directoryHandle?.close();
			}
		} finally {
			await handle.close().catch(() => {});
			if (!renamed) await rm(temporary, { force: true }).catch(() => {});
		}
	}
	try {
		await load();
	} catch (cause) {
		lease.close();
		throw cause;
	}
	function result(
		record: z.infer<typeof savedDocumentSchema>,
	): VisualDocumentRecord {
		return {
			documentId: record.documentId,
			revision: record.revision,
			document: record.document,
			draft: record.draft,
		};
	}
	async function write(input: unknown, signal: AbortSignal) {
		ready(signal);
		const request = documentWriteSchema.parse(input),
			key = request.documentId + ":" + request.requestId,
			hash = fingerprint(request);
		if (unconfirmed.size && unconfirmed.get(key) !== hash)
			throw Error(
				"A previous save is unconfirmed. Retry its exact saved request first.",
			);
		active++;
		const execute = async () => {
			ready(signal);
			if (unconfirmed.size && unconfirmed.get(key) !== hash)
				throw Error(
					"A previous save is unconfirmed. Retry its exact saved request first.",
				);
			let state: SavedState;
			try {
				state = await load();
			} catch {
				unconfirmed.set(key, hash);
				throw Error(
					"The visual save is unconfirmed. Keep this editor open and retry the same request.",
				);
			}
			const current = (Object.hasOwn(state.documents, request.documentId)
					? state.documents[request.documentId]
					: undefined) ?? {
					documentId: request.documentId,
					revision: 0,
					document: null,
					draft: null,
					receipts: [],
				},
				old = current.receipts.find(
					(receipt) => receipt.requestId === request.requestId,
				);
			if (old) {
				if (old.fingerprint !== hash)
					throw Error(
						"This request identity conflicts with another visual save.",
					);
				unconfirmed.delete(key);
				return {
					documentId: request.documentId,
					revision: old.revision,
					requestId: request.requestId,
				};
			}
			if (current.revision !== request.baseRevision)
				throw Error(
					"The visual document revision changed. Recover the current document before another save.",
				);
			const revision = current.revision + 1,
				next = {
					...current,
					revision,
					...(request.action === "draft"
						? { draft: request.draft }
						: { document: request.document, draft: null }),
					receipts: [
						...current.receipts,
						{ requestId: request.requestId, fingerprint: hash, revision },
					].slice(-VISUAL_LIMITS.receipts),
				};
			state.documents[request.documentId] = next;
			unconfirmed.set(key, hash);
			try {
				await persist(state);
				unconfirmed.delete(key);
				return {
					documentId: request.documentId,
					revision,
					requestId: request.requestId,
				};
			} catch {
				throw Error(
					"The visual save is unconfirmed. Keep this editor open and retry the same request.",
				);
			}
		};
		const operation = tail.then(execute, execute);
		tail = operation.catch(() => {});
		return operation.finally(() => {
			active--;
		});
	}
	return {
		operations: {
			"visual.document.read": async (input, signal) => {
				ready(signal);
				const { documentId, requestId } = documentReadSchema.parse(input),
					state = await load(),
					record = Object.hasOwn(state.documents, documentId)
						? state.documents[documentId]
						: undefined,
					value = record
						? result(record)
						: { documentId, revision: 0, document: null, draft: null };
				if (requestId) {
					const receipt = record?.receipts.find(
						(value) => value.requestId === requestId,
					);
					return {
						...value,
						receipt: receipt
							? { requestId: receipt.requestId, revision: receipt.revision }
							: null,
						pending: unconfirmed.has(documentId + ":" + requestId),
					};
				}
				return value;
			},
			"visual.document.write": write,
		},
		isBusy: async () => active > 0 || unconfirmed.size > 0,
		async close() {
			if (closed) return;
			closing = true;
			try {
				await tail;
				if (active || unconfirmed.size)
					throw Error("A visual save is unconfirmed. Keep the editor open.");
				closed = true;
				lease.close();
			} catch (cause) {
				closing = false;
				throw cause;
			}
		},
	};
}
