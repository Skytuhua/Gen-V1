import { randomUUID } from "node:crypto";
import { existsSync } from 'node:fs';
import { Store } from "../storage/store.ts";
import { capabilityEnabled } from "./capability-flags.ts";
import { HarnessError, type Message, type Operation, type RunContext, type Snapshot, type Thread } from "../contracts/index.ts";
import type { MemoryAccess, MemoryAction, MemoryScope } from '../contracts/project-memory.ts';
import type { UiPreferences } from '../contracts/preferences.ts';
import type { LearningCoordinator, LearningJob } from './learning.ts';
import { learningReviewPrompt } from './learning-context.ts';
import { curateSkills, skillIndex } from './skills.ts';
import { modelProvider } from './accounts.ts';
import { isConnectionProviderId } from '../contracts/connections.ts';
import { projectMemoryDeletionLedgerPath } from './security.ts';
import { ProjectMemoryHost } from './project-memory-host.ts';
import type { SourceWorkbench, WorkbenchQueuedInput } from './source-workbench.ts';
import type { RequestPreparationV1 } from '../contracts/request-context.ts';
import type { RequestPreparationOptions } from './request-custody.ts';

const now = () => new Date().toISOString();

/** Cross-domain members of `Service` the memory domain calls back into. */
export interface ServiceMemoryHost {
	readonly store: Store;
	readonly sourceWorkbench: SourceWorkbench;
	readonly learning: LearningCoordinator;
	readonly learningCalls: Map<string, number>;
	isClosed(): boolean;
	isClosing(): boolean;
	reviewing(): boolean;
	cancelReview(): Promise<void>;
	preferences(): UiPreferences;
	lastActivity(): number;
	markActivity(stamp: number): void;
	learningSupported(): boolean;
	predictionMutations(): number;
	hasGate(threadId: string): boolean;
	source(): { library: { command(command: unknown): Promise<unknown> } } | undefined;
	background(promise: Promise<unknown>): void;
	prepareRequest(threadId: string, prompt: string, options: RequestPreparationOptions): Promise<RequestPreparationV1>;
	getPreparation(threadId: string, requestId: string): RequestPreparationV1;
	releaseRequest(requestId: string): void;
}

/** Project memory + curator domain extracted from `Service` (#1338 PR 4).
 * Pure move: the host keeps the cross-domain methods; this collaborator owns
 * the lazily built `ProjectMemoryHost`, retention purge, idle curation and
 * the post-run learning review admission. */
export class ServiceMemory {
	private instance?: ProjectMemoryHost;
	private purgeFailure: string | null = null;

	constructor(
		private readonly host: ServiceMemoryHost,
		private readonly options: {
			extractionFactory?: NonNullable<ConstructorParameters<typeof ProjectMemoryHost>[1]>['extractionFactory'];
			extractionAdmission?: NonNullable<ConstructorParameters<typeof ProjectMemoryHost>[1]>['extractionAdmission'];
		},
	) { }

	/** The lazily built memory host; absent until first use so `busy`/`dispose`
	 * checks on a never-used host stay cheap. */
	get memoryHostInstance(): ProjectMemoryHost | undefined { return this.instance; }

	memoryHost(): ProjectMemoryHost {
		if (this.host.isClosed()) throw new HarnessError('CANCELLED_RUN', 'The memory host has closed.');
		return this.instance ??= new ProjectMemoryHost(this.host.store, {
			extractionFactory: this.options.extractionFactory, extractionAdmission: this.options.extractionAdmission,
			readFileSource: (owner, ref) => this.host.sourceWorkbench.retainedFile({ logicalOwner: owner, ref }),
			canExtract: () => !this.host.isClosed() && !this.host.isClosing() && !this.host.predictionMutations() && !this.host.store.all<Thread>('thread').some(thread => !!thread.runId || thread.status === 'working' || thread.status === 'awaiting_input'),
			beforeExtract: async () => { if (this.host.reviewing()) await this.host.cancelReview(); },
		});
	}

	get memory() { return this.memoryHost().memory; }

	async prepare(projectId: string, threadId: string, prompt: string, options: RequestPreparationOptions = {}) {
		const memory = this.memory, access = await memory.access(projectId, threadId);
		if (!capabilityEnabled('memory.projectV1') || !memory.isEnabled(access)) return null;
		const preparation = await this.host.prepareRequest(threadId, prompt, options), view = this.memoryHost().preparedView(preparation);
		if (!view) this.host.releaseRequest(preparation.requestId);
		return view;
	}

	latest(projectId: string, threadId: string) { return this.memoryHost().latest(projectId, threadId); }

	exclude(requestId: string, input: { scope: MemoryScope; contextGeneration: number; itemId: string; revision: number }) {
		const preparation = this.host.getPreparation(input.scope.threadId, requestId); return this.memoryHost().exclude(preparation, input);
	}

	reviewed(access: MemoryAccess, operation: MemoryAction): void { this.host.background(this.memoryHost().reviewed(access, operation)); }

	/** Retire eligible local copies even if memory injection was disabled after Forget. */
	purgeRetention(): void {
		if (this.host.isClosed() || this.host.isClosing() || !this.host.store.db.isOpen || this.instance?.busy) return;
		try {
			const hasTombstones = Boolean(this.host.store.db.prepare("SELECT 1 FROM entities WHERE kind='projectMemoryTombstone' LIMIT 1").get());
			if (!this.instance && !hasTombstones && !existsSync(projectMemoryDeletionLedgerPath(this.host.store.dataDir))) return;
			(this.instance ?? this.memoryHost()).memory.purge(Date.now(), 20);
			this.purgeFailure = null;
		} catch (error) {
			// Leave the tombstone PENDING. Do not report a completed physical purge.
			const code = error instanceof HarnessError ? error.code : 'MEMORY_PURGE_DEFERRED';
			if (this.purgeFailure !== code) { this.purgeFailure = code; console.warn('Project memory purge deferred:', code); }
		}
	}

	async reviewAfter(ctx: RunContext, force = false): Promise<boolean> {
		const store = this.host.store, host = this.host;
		if (host.source()) return false;
		if (host.isClosed() || !host.learningSupported() || host.learning.busy) return false;
		const thread = store.get<Thread>('thread', ctx.threadId), preferences = host.preferences();
		if (!thread || thread.sideParentId || thread.mode === 'plan' || thread.epoch !== ctx.epoch || thread.runId || !thread.modelId || !isConnectionProviderId(modelProvider(thread.modelId)) || !['ready', 'completed'].includes(thread.status) || store.get('archivedThread', thread.id) || store.all<Thread>('thread').some(item => item.runId) || host.hasGate(thread.id) || store.all<WorkbenchQueuedInput>('outbox', thread.id).some(input => input.status !== 'handled') || store.all<Operation>('operation', thread.id).some(op => ['prepared', 'running', 'unknown'].includes(op.status)) || !preferences.learningEnabled || !force && (!preferences.learningInterval || (host.learningCalls.get(thread.id) ?? 0) < preferences.learningInterval)) return false;
		if (!store.all<Message>('message', thread.id).some(message => message.role === 'assistant' && message.runId === ctx.runId)) return false;
		const job: LearningJob = { source: { ...ctx }, modelId: thread.modelId, accountId: thread.accountId ?? null, thinkingLevel: thread.thinkingLevel, prompt: learningReviewPrompt(store, thread, ctx, skillIndex(store)) };
		host.learningCalls.set(thread.id, 0);
		store.internal('learning.started', thread.id, () => { const old = store.get<Snapshot['learning']>('learningStatus', 'global'); store.put('learningStatus', 'global', null, { ...old, supported: true, status: 'reviewing', lastReview: { sourceThreadId: thread.id, sourceRunId: ctx.runId, modelId: job.modelId, accountId: job.accountId, status: 'reviewing', startedAt: now(), toolCalls: 0, inputBytes: Buffer.byteLength(job.prompt), appliedChanges: 0 } }); });
		return host.learning.start(job);
	}

	curateIdle(): void {
		const preferences = this.host.preferences(), stamp = Date.now(), store = this.host.store, host = this.host;
		if (!preferences.skillCurator || host.reviewing() || stamp - host.lastActivity() < 2 * 60 * 60 * 1000 || store.all<Thread>('thread').some(thread => thread.runId)) return;
		const old = store.get<{ lastCuratedAt?: string }>('learningStatus', 'global');
		if (old?.lastCuratedAt && stamp - Date.parse(old.lastCuratedAt) < 7 * 24 * 60 * 60 * 1000) return;
		const source = host.source();
		if (source) { host.markActivity(stamp); host.background(source.library.command({ id: randomUUID(), type: 'learning.curate', payload: {} })); return; }
		store.internal('learning.curated', null, () => { if (old?.lastCuratedAt) curateSkills(store); store.put('learningStatus', 'global', null, { ...old, supported: host.learningSupported(), status: 'idle', lastReview: store.get<Snapshot['learning']>('learningStatus', 'global')?.lastReview ?? null, lastCuratedAt: now() }); });
	}
}
