import { lstatSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { Store, digest } from "../storage/store.ts";
import { capabilityEnabled } from "./capability-flags.ts";
import { HarnessError, type ResourceGrant, type RunContext, type RuntimeAdapter, type StartRun, type Thread } from "../contracts/index.ts";
import type { WorkbenchQueuedInput } from './source-workbench.ts';
import { skillIndex } from "./skills.ts";
import { modelProvider } from "./accounts.ts";
import { PLAN_RUNTIME_GUIDANCE } from "./planning-tools.ts";
import { LEARN_REQUEST } from "./learning-context.ts";
import { RequestContextCustody, REQUEST_PREPARATION_LIMITS, type RequestContextBasis, type RequestContextHooks, type RequestPreparationOptions } from './request-custody.ts';
import type { InferenceAdmissionV1, RequestContextV1, RequestPreparationV1 } from '../contracts/request-context.ts';

const text = (p: Record<string, unknown>, key: string, max = 128 * 1024): string => {
  if (typeof p[key] !== "string" || !(p[key] as string).trim() || Buffer.byteLength(p[key] as string) > max) throw new HarnessError("INVALID_INPUT", key + " must be a nonempty string within its size limit");
  return p[key] as string;
};

/** Minimal source integration the request-context domain reads. */
export interface RequestContextSource {
	runtime: { sourceRequest<T>(kind: string, input: unknown): Promise<T> };
}

/** Cross-domain members of `Service` the request-context domain calls back into. */
export interface ServiceRequestContextHost {
	readonly store: Store;
	readonly runtime: RuntimeAdapter;
	requestRegistryDigest(): string;
	isClosing(): boolean;
	thread(threadId: string): Thread;
	assertRun(ctx: RunContext): Thread;
	binding(thread: Thread, providerId: string): { accountId: string | null; bound: boolean };
	planningInspect(threadId: string): unknown;
	source(): RequestContextSource | undefined;
}

/** Request-context + inference domain extracted from `Service` (#1338 PR 3).
 * Pure move: the host keeps the cross-domain methods; this collaborator owns
 * the request custody, the inference owner registry, and all basis/admission
 * and preparation work. */
export class ServiceRequestContext {
	readonly custody: RequestContextCustody;
	private readonly inferenceOwners = new Map<string, { ctx: RunContext; basis: string; sequence: number }>();
	private requestPreparationWork = 0;

	constructor(
		private readonly host: ServiceRequestContextHost,
		hooks: RequestContextHooks,
		private readonly options: { requestContextEnabled?: boolean; prepareWorkspace?: (thread: Thread) => Promise<void> },
	) {
		this.custody = new RequestContextCustody(host.store, hooks);
	}

	enabled(): boolean { return capabilityEnabled('memory.projectV1') || (this.options.requestContextEnabled ?? capabilityEnabled('context.compilerV1')); }

	/** Mint a deterministic candidate from the latest admitted receipt and record the verdict in usage.
	 * Never mutates native history; candidates carry metadata only. */
	latestReceipt(threadId: string): RequestContextV1 | null {
		const row = this.host.store.db.prepare("SELECT body FROM entities WHERE kind='requestContextReceipt' AND thread_id=? ORDER BY rowid DESC LIMIT 1").get(threadId) as { body: string } | undefined;
		if (!row) return null;
		const receipt = (JSON.parse(row.body) as { receipt?: RequestContextV1 }).receipt;
		return receipt ?? null;
	}

	private authorityBasis(thread: Thread, modelId: string, thinkingLevel: string | null | undefined): Omit<RequestContextBasis, 'sourceCutDigest' | 'admissionDigest'> {
		if (this.host.isClosing()) throw new HarnessError('CANCELLED_RUN', 'The request owner has closed.');
		if (this.host.store.get('archivedThread', thread.id) || ['stopped', 'interrupted'].includes(thread.status)) throw new HarnessError('STALE_REQUEST_CONTEXT', 'The request owner no longer admits this draft.');
		const physical = (path: string, expected?: { dev: string; ino: string }) => {
			const info = lstatSync(path, { bigint: true }), actual = realpathSync(path), normalize = (value: string) => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value);
			if (info.isSymbolicLink() || !info.isDirectory() && !info.isFile() || normalize(actual) !== normalize(path) || expected && (String(info.dev) !== expected.dev || String(info.ino) !== expected.ino)) throw new HarnessError('STALE_REQUEST_CONTEXT', 'A prepared context resource changed its physical identity.');
			return { path: actual, dev: String(info.dev), ino: String(info.ino) };
		};
		const profile = physical(this.host.store.dataDir), profileId = digest(profile), accountId = this.host.binding(thread, modelProvider(modelId)).accountId;
		const project = thread.projectId ? this.host.store.get<{ id: string; authority: { kind: string } }>('workspaceProject', thread.projectId) : null;
		const root = thread.projectId ? this.host.store.get<{ path: string; identity: { dev: string; ino: string } }>('workspaceProjectRoot', thread.projectId) : null;
		const workspace = thread.workspaceId ? this.host.store.get<{ id: string; threadId: string; projectId: string; path: string; identity: { dev: string; ino: string } }>('workspaceBinding', thread.workspaceId) : null;
		if (thread.projectId && (!project || project.authority.kind !== 'local' || !root) || thread.workspaceId && (!workspace || workspace.id !== thread.workspaceId || workspace.threadId !== thread.id || workspace.projectId !== thread.projectId)) throw new HarnessError('STALE_REQUEST_CONTEXT', 'The project or workspace binding is unavailable.');
		const rootIdentity = root ? physical(root.path, root.identity) : null, workspaceIdentity = workspace ? physical(workspace.path, workspace.identity) : null;
		const resources = (this.host.store.db.prepare("SELECT body FROM entities WHERE kind='resource' AND thread_id=? ORDER BY id LIMIT 257").all(thread.id) as { body: string }[]).map(row => JSON.parse(row.body) as ResourceGrant);
		if (resources.length > 256) throw new HarnessError('INVALID_REQUEST_CONTEXT', 'The host source cut exceeds its supported bounds.');
		const grantDigest = digest(resources.map(resource => { if (resource.threadId !== thread.id) throw new HarnessError('STALE_REQUEST_CONTEXT', 'A resource grant changed owner.'); return { resource, physical: physical(resource.path, resource.identity) }; }));
		const workspaceId = thread.workspaceId ?? (thread.projectId ? 'project:' + thread.projectId : 'thread:' + thread.id);
		const instructionDigest = digest([PLAN_RUNTIME_GUIDANCE, LEARN_REQUEST, thread.mode ?? 'build', Boolean(this.host.source()), Boolean(thread.sideParentId)]);
		return {
			profileId, threadId: thread.id, projectId: thread.projectId ?? null, workspaceId, modelId, accountId, thinkingLevel: thinkingLevel ?? null,
			bindingDigest: digest({ profileId, threadId: thread.id, projectId: thread.projectId ?? null, workspaceId, project, root, workspace, rootIdentity, workspaceIdentity, sideParentId: thread.sideParentId ?? null, kind: thread.kind ?? 'main', mode: thread.mode ?? 'build', modelId, accountId, thinkingLevel: thinkingLevel ?? null }),
			grantDigest, instructionDigest, toolRegistryDigest: this.host.requestRegistryDigest()
		};
	}

	basis(thread: Thread, modelId: string, thinkingLevel: string | null | undefined): RequestContextBasis {
		const authority = this.authorityBasis(thread, modelId, thinkingLevel);
		const notes = (this.host.store.db.prepare("SELECT body FROM entities WHERE kind='taskMemory' AND thread_id=? ORDER BY id LIMIT 13").all(thread.id) as { body: string }[]).map(row => JSON.parse(row.body));
		if (notes.length > 12) throw new HarnessError('INVALID_REQUEST_CONTEXT', 'The host source cut exceeds its supported bounds.');
		const catalog = this.host.source() ? null : skillIndex(this.host.store), plan = this.host.planningInspect(thread.id), side = thread.sideParentId ? this.host.store.get('sideContext', thread.id) : null;
		const sourceCut = { notes, catalog, plan, side }; if (Buffer.byteLength(JSON.stringify(sourceCut)) > 512 * 1024) throw new HarnessError('INVALID_REQUEST_CONTEXT', 'The host source cut exceeds its byte limit.');
		return {
			...authority, sourceCutDigest: digest(sourceCut),
			admissionDigest: digest({ epoch: thread.epoch, runId: thread.runId, sessionPath: thread.sessionPath, modelId: thread.modelId, thinkingLevel: thread.thinkingLevel ?? null, accountId: thread.accountId ?? null })
		};
	}

	captureOwner(input: StartRun, continuing: boolean): void {
		const thread = this.host.assertRun(input), basis = digest(this.authorityBasis(thread, input.modelId, input.thinkingLevel)), previous = this.inferenceOwners.get(thread.id);
		if (previous && previous.ctx.runId === input.runId && previous.ctx.epoch === input.epoch) {
			if (previous.basis !== basis) throw new HarnessError('STALE_REQUEST_CONTEXT', 'The active inference authority changed.');
			return;
		}
		if (continuing || this.inferenceOwners.size >= 128) throw new HarnessError('STALE_REQUEST_CONTEXT', 'The active inference owner is unavailable.');
		this.inferenceOwners.set(thread.id, { ctx: { threadId: input.threadId, runId: input.runId, epoch: input.epoch }, basis, sequence: 0 });
	}

	releaseOwner(threadId: string, ctx?: RunContext): void {
		if (ctx) {
			const owner = this.inferenceOwners.get(threadId);
			if (owner?.ctx.runId !== ctx.runId || owner.ctx.epoch !== ctx.epoch) return;
		}
		this.inferenceOwners.delete(threadId);
	}

	clearOwners(): void { this.inferenceOwners.clear(); }

	beforeInference(request: InferenceAdmissionV1): void {
		const thread = this.host.assertRun(request.ctx), owner = this.inferenceOwners.get(thread.id);
		const stale = () => new HarnessError('STALE_REQUEST_CONTEXT', 'The next inference no longer matches its admitted owner.');
		if (!capabilityEnabled('context.compilerV1') || !owner || owner.ctx.runId !== request.ctx.runId || owner.ctx.epoch !== request.ctx.epoch ||
			!Number.isSafeInteger(request.sequence) || request.sequence <= owner.sequence || !Array.isArray(request.inputIds) || request.inputIds.length > 4096 || new Set(request.inputIds).size !== request.inputIds.length ||
			thread.modelId !== request.modelId || (thread.thinkingLevel ?? null) !== request.thinkingLevel) throw stale();
		const basis = this.authorityBasis(thread, request.modelId, request.thinkingLevel);
		if (basis.accountId !== request.accountId || digest(basis) !== owner.basis) throw stale();
		for (const id of request.inputIds) { const input = typeof id === 'string' && id.length <= 256 ? this.host.store.get<WorkbenchQueuedInput>('outbox', id) : null;
			if (!input || input.threadId !== thread.id || input.runId !== request.ctx.runId || !['processing', 'handled'].includes(input.status)) throw stale(); }
		owner.sequence = request.sequence;
	}

	/** A preview does not increment run epochs, start a runtime, or edit native history. */
	async prepare(threadId: string, prompt: string, options: RequestPreparationOptions = {}): Promise<RequestPreparationV1> {
		if (!this.enabled()) throw new HarnessError('REQUEST_CONTEXT_DISABLED', 'Request context custody is not enabled by this host.');
		if (options.skills !== undefined) throw new HarnessError('SKILL_ADMISSION_UNAVAILABLE', 'Selected skills are unavailable for this runtime. Your draft is retained.', { sendAccepted: false });
		text({ prompt }, 'prompt', 64 * 1024);
		if (this.requestPreparationWork >= REQUEST_PREPARATION_LIMITS.pending) throw new HarnessError('REQUEST_CONTEXT_BUSY', 'Too many requests are still being prepared.');
		this.requestPreparationWork++;
		try {
			let thread = this.host.thread(threadId);
			if (!thread.runId && !thread.sideParentId && thread.kind !== 'delegate' && this.options.prepareWorkspace) { const before = thread; await this.options.prepareWorkspace(thread); thread = this.host.thread(threadId); if (thread.epoch !== before.epoch || thread.runId !== before.runId || thread.modelId !== before.modelId || thread.accountId !== before.accountId || thread.status !== before.status) throw new HarnessError('STALE_REQUEST_CONTEXT', 'The owner changed while preparing its workspace.'); }
			const modelId = options.modelId ?? thread.modelId; if (typeof modelId !== 'string' || !modelId || modelId.length > 300) throw new HarnessError('MODEL_UNAVAILABLE', 'Choose an authenticated model before preparing a request.');
			const thinkingLevel = options.thinkingLevel === null ? null : options.thinkingLevel ?? (thread.modelId === modelId ? thread.thinkingLevel : undefined);
			const basis = this.basis(thread, modelId, thinkingLevel), current = () => this.basis(this.host.thread(threadId), modelId, thinkingLevel);
			const model = (await this.host.runtime.models({ accountId: basis.accountId })).find(item => item.id === modelId);
			if (!model) throw new HarnessError('MODEL_UNAVAILABLE', 'Connect this account and choose an available model.');
			if (thinkingLevel !== undefined && thinkingLevel !== null && (typeof thinkingLevel !== 'string' || !model.thinkingLevels?.includes(thinkingLevel))) throw new HarnessError('INVALID_INPUT', 'Choose a reasoning level supported by this model.');
			if (digest(basis) !== digest(current())) throw new HarnessError('STALE_REQUEST_CONTEXT', 'The request changed while checking its model.');
			const source = this.host.source(), resolved = source && !thread.sideParentId && /^\/learn(?:\s|$)/i.test(prompt.trim()) ? (await source.runtime.sourceRequest<{ prompt: string }>('learn.prompt', { request: prompt.trim().replace(/^\/learn\s*/i, '') })).prompt : prompt;
			if (typeof resolved !== 'string') throw new HarnessError('INVALID_REQUEST_CONTEXT', 'The prepared source did not return a text prompt.');
			return await this.custody.prepare(basis, prompt, resolved, current);
		} finally { this.requestPreparationWork--; }
	}

	/** Authenticated host read: consumed, expired, or stale previews cannot be edited. */
	getPreparation(threadId: string, requestId: string): RequestPreparationV1 {
		if (!this.enabled()) throw new HarnessError('REQUEST_CONTEXT_DISABLED', 'Request context custody is not enabled by this host.');
		return this.custody.getReady(threadId, requestId, preparation => this.basis(this.host.thread(threadId), preparation.modelId, preparation.thinkingLevel));
	}
}
