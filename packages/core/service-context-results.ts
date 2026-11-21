import { randomUUID } from "node:crypto";
import { Store, digest } from "../storage/store.ts";
import { capabilityEnabled } from "./capability-flags.ts";
import { type Thread } from "../contracts/index.ts";
import { createContextResults, encodeContextResult, CONTEXT_PREVIEW_CAP_BYTES, MAX_TRACKED_RESULTS, type ContextResultStorage } from './context-results.ts';
import { createContextResultLineage } from './context-result-lineage.ts';
import { openContextResultCustody } from './context-result-custody.ts';
import { createHostRelevanceObserver } from './context-relevance-host.ts';
import { createRepositoryMapReader } from './repository-map-host.ts';
import { modelProvider } from './accounts.ts';

/** Cross-domain members of `Service` the context-results domain calls back into. */
export interface ServiceContextResultsHost {
	readonly store: Store;
	readonly hostToolRegistryDigest: string;
	isClosed(): boolean;
	binding(thread: Thread, providerId: string): { accountId: string | null; bound: boolean };
}

/** Context-result vault + relevance observation domain extracted from
 * `Service` (#1338 PR 2). Pure move: owns the deferred-result storage,
 * authority proofs, the active-read counter, the relevance observer and the
 * repository-map reader; the host keeps thread/binding truth. */
export class ServiceContextResults {
	private contextStorage?: Promise<ContextResultStorage>;
	private results?: ReturnType<typeof createContextResults>;
	activeReads = 0;
	readonly authorities = new Map<string, { expiresAtMs: number; authorized: () => Promise<boolean> }>();
	readonly observer = createHostRelevanceObserver();
	readonly maps = createRepositoryMapReader();

	constructor(private readonly host: ServiceContextResultsHost) { }

	dispose(): void {
		this.observer.clear();
		this.maps.clear();
		this.authorities.clear();
	}

	relevanceOwner(thread: Thread) {
		if (!capabilityEnabled('context.compilerV1') || this.host.isClosed() || !thread.runId || !thread.modelId || thread.sideParentId || thread.kind === 'delegate') return null;
		const resources = this.host.store.db.prepare("SELECT body FROM entities WHERE kind='resource' AND thread_id=? ORDER BY id LIMIT 257").all(thread.id);
		if (resources.length > 256) return null;
		return { threadId: thread.id, binding: digest([thread.runId, thread.epoch, thread.modelId, thread.thinkingLevel ?? null,
			this.host.binding(thread, modelProvider(thread.modelId)).accountId, thread.projectId ?? null, thread.workspaceId ?? null,
			thread.projectId ? this.host.store.get('workspaceProjectRoot', thread.projectId) : null,
			thread.workspaceId ? this.host.store.get('workspaceBinding', thread.workspaceId) : null, resources]) };
	}
	observeReadRelevance(thread: Thread, sequence: number) {
		try {
			const owner = this.relevanceOwner(thread);
			if (!owner) return undefined;
			// Limit both the query and its projection. If history overflows this
			// window, unknown older work is protected rather than scanned or assumed settled.
			const unresolved = (kind: string, pending: readonly string[]) => {
				const rows = this.host.store.db.prepare("SELECT json_extract(body,'$.status') AS status FROM entities WHERE kind=? AND thread_id=? ORDER BY rowid DESC LIMIT 129").all(kind, thread.id) as { status: unknown }[];
				return rows.length > 128 || rows.some(row => typeof row.status !== 'string' || pending.includes(row.status));
			};
			const protect = unresolved('request', ['pending']) || unresolved('operation', ['prepared', 'running', 'unknown']);
			return this.observer.observe(owner, sequence, protect);
		} catch { return undefined; } // Read-only diagnostics cannot block a foreground request.
	}
	enabled() { return capabilityEnabled('context.compilerV1') && capabilityEnabled('tools.deferredV1'); }
	owner(thread: Thread) {
		return { threadId: thread.id, workspaceId: JSON.stringify([thread.workspaceId ?? null, thread.projectId ?? null]), accountId: thread.accountId ?? null };
	}
	invocation(thread: Thread) { return digest([thread.id, thread.epoch, thread.runId, thread.modelId ?? null,
		thread.accountId ?? null, thread.projectId ?? null, thread.workspaceId ?? null, thread.thinkingLevel ?? null, thread.mode ?? null,
		this.host.hostToolRegistryDigest, thread.projectId ? this.host.store.get('workspaceProjectRoot', thread.projectId) : null,
		thread.workspaceId ? this.host.store.get('workspaceBinding', thread.workspaceId) : null]); }
	vault() {
		const open = () => this.contextStorage ??= openContextResultCustody(this.host.store.dataDir).catch(cause => { this.contextStorage = undefined; throw cause; });
		return this.results ??= createContextResults({
			now: Date.now,
			isAuthorized: async (owner, invocation) => {
				const proof = this.authorities.get(invocation);
				if (!proof || proof.expiresAtMs <= Date.now()) { this.authorities.delete(invocation); return false; }
				const current = () => {
					const thread = this.host.store.get<Thread>('thread', owner.threadId);
					if (this.host.isClosed() || !this.enabled() || !thread?.runId || !['working', 'awaiting_input'].includes(thread.status) || thread.kind === 'delegate' || thread.sideParentId || this.host.store.get('archivedThread', thread.id)) return false;
					const binding = this.owner(thread);
					return invocation.startsWith(this.invocation(thread) + ':') && binding.workspaceId === owner.workspaceId && binding.accountId === owner.accountId;
				};
				return current() && await proof.authorized() && current();
			},
			storage: {
				put: async (key, bytes, record) => (await open()).put(key, bytes, record),
				get: async key => (await open()).get(key),
				getRecord: async key => (await open()).getRecord?.(key),
				pruneExpired: async now => (await open()).pruneExpired?.(now) ?? 0,
			},
		});
	}
	async deliver(value: unknown, publicCatalog: boolean, thread: Thread, assertCurrent: () => void, lineage?: ReturnType<typeof createContextResultLineage>) {
		const encoded = encodeContextResult(value);
		const absent = { status: 'FULL_RESULT_UNAVAILABLE' as const, handle: null, preview: '', omittedBytes: encoded.totalBytes, totalBytes: encoded.totalBytes };
		try { assertCurrent(); lineage?.assertCurrent(); } catch { return absent; }
		if (encoded.bytes && encoded.totalBytes! <= CONTEXT_PREVIEW_CAP_BYTES) return value;
		if (lineage?.observed && !await lineage.authorized()) return absent;
		try { assertCurrent(); } catch { return absent; }
		const fallback = { status: 'FULL_RESULT_UNAVAILABLE' as const, handle: null, preview: encoded.preview, omittedBytes: encoded.omittedBytes, totalBytes: encoded.totalBytes };
		if (!encoded.bytes || !publicCatalog && !lineage?.observed) return fallback;
		const now = Date.now();
		for (const [id, proof] of this.authorities) if (proof.expiresAtMs <= now) this.authorities.delete(id);
		if (this.authorities.size >= MAX_TRACKED_RESULTS) return fallback;
		const invocationId = this.invocation(thread) + ':' + randomUUID(), expiresAtMs = now + 60 * 60_000;
		this.authorities.set(invocationId, { expiresAtMs, authorized: async () => {
			try { assertCurrent(); return publicCatalog || Boolean(lineage && await lineage.authorized()); } catch { return false; }
		} });
		const result = await this.vault().spill({ owner: this.owner(thread), invocationId, bytes: encoded.bytes, mediaType: encoded.mediaType, expiresAtMs });
		if (!result.handle) this.authorities.delete(invocationId);
		try { assertCurrent(); lineage?.assertCurrent(); } catch { this.authorities.delete(invocationId); return absent; }
		return { ...result, totalBytes: encoded.totalBytes };
	}
}
